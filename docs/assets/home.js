// Overview: how the project is going, at a glance. Three headline scores (requirements complete, documentation,
// best practice), each opening its section, then the next deadlines and what was finished most recently.
// The detail lives on the pages they link to: Planning, Work in progress, Documentation and Best practice.
// Requirements come from data/planning.json (tools/planning.py); the date maths is shared with planning.js.
(function () {
  var M = window.ModelDocs, el = M.el;
  var SHOWN = 3;   // rows in each list
  var ICONS = {
    wave: '<svg viewBox="0 0 24 24"><path d="M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>',
    tick: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
  };

  // a headline tile: the whole tile is a link to the section behind the number
  function headline(t) {
    var icon = el("span", { class: "home-tile-icon", "aria-hidden": "true" });
    icon.innerHTML = ICONS[t.icon];
    return el("a", { class: "dash-tile home-tile tone-" + t.tone, href: t.href, title: t.tip }, [
      el("span", { class: "home-tile-top" }, [icon, el("span", { class: "tile-label", text: t.label })]),
      el("span", { class: "tile-value", text: t.value }),
      el("span", { class: "bar-track", role: "img", "aria-label": t.tip }, [el("span", { class: "bar-fill", style: "display:block;width:" + t.pct + "%" })]),
      el("span", { class: "home-tile-go", text: t.go + " →" })]);
  }

  // a short list: a link on the left, a coloured tag on the right, and a link to the page with the rest
  function rows(host, items, empty, more) {
    if (!items.length) host.appendChild(el("p", { class: "dash-empty", text: empty }));
    else host.appendChild(el("ul", { class: "plan-list" }, items.map(function (i) {
      return el("li", {}, [el("a", { href: i.href, text: i.title, title: i.tip }), el("span", { class: "plan-tag " + i.cls, text: i.tag })]);
    })));
    host.appendChild(el("a", { class: "plan-more", href: more.href, text: more.text + " →" }));
  }

  function draw(app, root, summary, plan, issues) {
    M.clear(app);
    var P = M.planning, today = P.todayIso(), reqs = plan.requirements, t = P.tally(reqs, today);
    var bp = summary.bestPractice || { pct: 0, pass: 0, total: 0 }, f = summary.failures, fails = f.error + f.warning + f.info;
    var kicker = document.querySelector(".surf-kicker");
    if (kicker) kicker.textContent += " · " + P.fmtDate(today);

    app.appendChild(el("div", { class: "home-tiles" }, [
      { label: "Requirements complete", value: t.pieces ? t.pct + "%" : "–", pct: t.pct, tone: "ocean", icon: "wave", href: root + "planning/", go: "Planning",
        tip: t.pieces ? t.complete + " of " + t.pieces + " complete" : "No requirements yet" },
      { label: "Documented", value: summary.score.pct + "%", pct: summary.score.pct, tone: "orange", icon: "book", href: root + "documentation/", go: "Documentation",
        tip: summary.score.described + " of " + summary.score.total + " objects described" },
      { label: "Best practice checks passing", value: bp.pct + "%", pct: bp.pct, tone: "teal", icon: "tick", href: root + "rules/", go: "Best practice",
        tip: bp.pass + " of " + bp.total + " checks pass, " + M.plural(fails, "failure") }
    ].map(headline)));

    var canvas = el("div", { class: "rpt-canvas home-canvas" });
    app.appendChild(canvas);

    // the next deadlines, with anything already late first
    var open = reqs.filter(function (r) { return r.leaf && r.due && r.status !== "complete" && r.status !== "dropped"; });
    rows(M.visual(canvas, "Coming up", { span: 6, cls: "dot-coral" }),
      open.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number; }).slice(0, SHOWN).map(function (r) {
        var s = P.dueState(r, today).state;
        return { href: r.url, title: "#" + r.number + " " + r.title, tip: P.people(r) + " · due " + P.fmtDate(r.due),
                 tag: P.dueText(r, today).replace(/^due /, ""), cls: s === "overdue" ? "is-late" : s === "soon" ? "is-soon" : "" };
      }), reqs.length ? "No open requirement has a due date." : "Deadlines appear here once requirements have due dates.",
      { href: root + "planning/?view=calendar", text: "See the calendar" });

    // finished most recently: requirements completed and pull requests merged in the last 30 days
    var since = P.addDays(today, -30);
    var done = reqs.filter(function (r) { return r.status === "complete" && r.closed >= since; }).map(function (r) {
      return { date: r.closed, href: r.url, title: "#" + r.number + " " + r.title, tip: "Requirement · " + P.people(r) };
    }).concat((issues.merged || []).filter(function (p) { return p.merged >= since; }).map(function (p) {
      return { date: p.merged, href: p.url, title: "#" + p.number + " " + p.title, tip: "Pull request merged" + (p.author ? " · @" + p.author : "") };
    })).sort(function (a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });
    rows(M.visual(canvas, "Recently done", { span: 6, cls: "dot-teal" }),
      done.slice(0, SHOWN).map(function (d) { d.tag = P.fmtDate(d.date).replace(/ \d{4}$/, ""); d.cls = "is-done"; return d; }),
      "Nothing has been completed in the last 30 days.", { href: root + "work/", text: "See work in progress" });
  }

  M.ready(function () {
    var app = document.getElementById("home-app");
    if (!app) return;
    var root = app.getAttribute("data-root") || "";
    M.load(root, ["summary", "planning"], ["issues"]).then(function (d) { draw(app, root, d.summary, d.planning, d.issues || { issues: [] }); })
      .catch(function (e) { M.clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the site data: " + e.message })); });
  });
})();
