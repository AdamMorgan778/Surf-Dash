// Overview: how the project is going. Requirements complete, what is due next, who has what out, and what was
// finished recently, with the documentation, best-practice and work-in-progress headlines linking to their pages.
// Requirements come from data/planning.json (tools/planning.py); the date maths is shared with planning.js.
(function () {
  var M = window.ModelDocs, el = M.el, plural = M.plural;

  function rows(host, items, empty) {   // a compact list: date or number on the left, title and a line of detail
    if (!items.length) { host.appendChild(el("p", { class: "dash-empty", text: empty })); return; }
    host.appendChild(el("ul", { class: "plan-list" }, items.map(function (i) {
      return el("li", {}, [
        el("span", { class: "plan-when" + (i.late ? " is-late" : ""), text: i.when }),
        el("span", { class: "plan-what" }, [el("a", { href: i.href, text: i.title }), i.chip || null, el("span", { class: "req-meta", text: i.meta })])]);
    })));
  }

  function draw(app, root, summary, plan, issues) {
    M.clear(app);
    var P = M.planning, today = P.todayIso(), reqs = plan.requirements, t = P.tally(reqs, today);
    var bp = summary.bestPractice || { pct: 0, pass: 0, total: 0 }, f = summary.failures, fails = f.error + f.warning + f.info;
    app.appendChild(el("p", { class: "dash-note", text: "Model read " + summary.generated + "." +
      (issues.fetched ? " Issues fetched " + issues.fetched + "." : "") + (issues.note ? " " + issues.note : "") }));

    function link(href, text) { return el("a", { href: root + href, text: text }); }
    app.appendChild(el("div", { class: "dash-tiles" }, [
      { label: "Requirements complete", value: t.pieces ? t.pct + "%" : "–",
        sub: link("planning/", t.pieces ? t.complete + " of " + t.pieces + " complete. Open Planning" : "No requirements yet. Add the first one") },
      { label: "Due in " + P.SOON + " days", value: t.soon, sub: link("planning/?view=calendar", "See the calendar") },
      { label: "Overdue", value: t.overdue, sub: t.overdue ? link("planning/?view=requirements", "See what is late") : "nothing is late" },
      { label: "Documentation score", value: summary.score.pct + "%", sub: link("documentation/", summary.score.described + " of " + summary.score.total + " described. See what is missing") },
      { label: "Best practice", value: bp.pct + "%", sub: link("rules/", "of checks pass, " + plural(fails, "failure")) },
      { label: "Work in progress", value: summary.work.items, sub: link("work/", plural(summary.work.people, "person") + ", " + plural(summary.work.overlaps, "overlap")) }
    ].map(M.tile)));

    var canvas = el("div", { class: "rpt-canvas home-canvas" });
    app.appendChild(canvas);
    var open = reqs.filter(function (r) { return r.leaf && r.status !== "complete" && r.status !== "dropped"; });

    // what is due in the next 30 days, and anything already late
    var horizon = P.addDays(today, 30);
    rows(M.visual(canvas, "Upcoming deadlines", { span: 6, sub: "Due in the next 30 days, and anything overdue. Soonest first." }),
      open.filter(function (r) { return r.due && r.due <= horizon; }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number; })
        .map(function (r) {
          return { when: P.fmtDate(r.due), late: P.dueState(r, today).state === "overdue", href: r.url, title: "#" + r.number + " " + r.title,
                   chip: P.chip(r, today), meta: P.people(r) + " · " + P.dueText(r, today) };
        }), reqs.length ? "Nothing is due in the next 30 days." : "Deadlines appear here once requirements have due dates.");

    rows(M.visual(canvas, "In progress now", { span: 6, sub: "Requirements someone has taken out, most recent first." }),
      reqs.filter(function (r) { return r.status === "taken-out" || (r.status === "reopened" && (r.takenOut || r.assignees.length)); })
        .sort(function (a, b) { var x = (a.takenOut || {}).on || "", y = (b.takenOut || {}).on || ""; return x > y ? -1 : x < y ? 1 : b.number - a.number; })
        .map(function (r) {
          return { when: r.takenOut && r.takenOut.on ? P.fmtDate(r.takenOut.on) : "Assigned", href: r.url, title: "#" + r.number + " " + r.title, chip: P.chip(r, today),
                   meta: (P.takenText(r) || P.people(r)) + (r.due ? " · due " + P.fmtDate(r.due) : "") };
        }), "Nobody has a requirement out at the moment.");

    // finished in the last 30 days: requirements completed and pull requests merged
    var since = P.addDays(today, -30);
    var done = reqs.filter(function (r) { return r.status === "complete" && r.closed >= since; }).map(function (r) {
      return { date: r.closed, when: P.fmtDate(r.closed), href: r.url, title: "#" + r.number + " " + r.title, chip: P.chip(r, today), meta: "Requirement · " + P.people(r) };
    }).concat((issues.merged || []).filter(function (p) { return p.merged >= since; }).map(function (p) {
      return { date: p.merged, when: P.fmtDate(p.merged), href: p.url, title: "#" + p.number + " " + p.title, meta: "Pull request merged" + (p.author ? " · @" + p.author : "") };
    })).sort(function (a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });
    rows(M.visual(canvas, "Recently completed", { span: 6, sub: "Requirements completed and pull requests merged in the last 30 days." }),
      done.slice(0, 12), "Nothing has been completed in the last 30 days.");

    var other = (issues.issues || []).filter(function (i) { return i.state === "open" && !i.requirement; });
    rows(M.visual(canvas, "Other open issues", { span: 6, sub: "Housekeeping, claims and anything else that is not a requirement." }),
      other.sort(function (a, b) { return b.number - a.number; }).slice(0, 12).map(function (i) {
        var state = i.work === "in-progress" ? "In progress" + (i.assignees && i.assignees.length ? " · @" + i.assignees.join(", @") : "") : "Not picked up";
        if (i.progress && i.progress.total) state += " · " + i.progress.done + "/" + i.progress.total + " done";
        return { when: "#" + i.number, href: i.url, title: i.title, meta: (i.requestType || "Issue") + " · " + state };
      }), summary.repo ? "No other open issues." : "Issues appear here once the repository is on GitHub.");
  }

  M.ready(function () {
    var app = document.getElementById("home-app");
    if (!app) return;
    var root = app.getAttribute("data-root") || "";
    M.load(root, ["summary", "planning"], ["issues"]).then(function (d) { draw(app, root, d.summary, d.planning, d.issues || { issues: [] }); })
      .catch(function (e) { M.clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the site data: " + e.message })); });
  });
})();
