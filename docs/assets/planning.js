// Planning page: the requirements raised on GitHub, who has them, when they are due and how far along the project is.
// Three tabs (Dashboard, Requirements, Calendar) over docs/data/planning.json, which tools/planning.py builds from
// the Requirement issues. The site cannot save anything, so every button opens the right place on GitHub.
// The date helpers at the top have no browser dependencies, so tests/planning.test.js runs them in Node; the
// Overview (home.js) uses them too.
(function () {
  "use strict";

  // ---- dates, as YYYY-MM-DD text. Worked out from the viewer's own date, so "overdue" is right between builds.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SOON = 14;   // days ahead that count as "due soon"
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) { var t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); }
  function todayIso(now) { now = now || new Date(); return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()); }
  function days(from, to) { return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000); }
  function addDays(date, n) { var p = date.split("-"); return iso(+p[0], +p[1] - 1, +p[2] + n); }
  function fmtDate(date) { if (!date) return ""; var p = date.split("-"); return +p[2] + " " + MONTHS[+p[1] - 1].slice(0, 3) + " " + p[0]; }

  // Where a requirement stands against its due date: none (no date), done, overdue, soon (within 14 days) or later.
  function dueState(r, today) {
    if (r.status === "complete" || r.status === "dropped") return { state: "done", days: null };
    if (!r.due) return { state: "none", days: null };
    var d = days(today, r.due);
    return { state: d < 0 ? "overdue" : d <= SOON ? "soon" : "later", days: d };
  }
  function dueText(r, today) {
    var s = dueState(r, today);
    if (s.state === "overdue") return s.days === -1 ? "1 day overdue" : -s.days + " days overdue";
    if (s.state === "soon" || s.state === "later") return s.days === 0 ? "due today" : s.days === 1 ? "due tomorrow" : "due in " + s.days + " days";
    return "";
  }
  // The weeks of a month, Monday first: [[{date, day, inMonth}, x7], ...]
  function monthGrid(year, month) {
    var first = new Date(Date.UTC(year, month, 1)), lead = (first.getUTCDay() + 6) % 7;
    var count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(), weeks = [];
    for (var start = 1 - lead; start <= count; start += 7) {
      var week = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(Date.UTC(year, month, start + i));
        week.push({ date: iso(year, month, start + i), day: d.getUTCDate(), inMonth: d.getUTCMonth() === ((month % 12) + 12) % 12 });
      }
      weeks.push(week);
    }
    return weeks;
  }
  // Counts over the pieces of work still to do (requirements that have not been broken down further).
  function tally(reqs, today) {
    var t = { pieces: 0, complete: 0, open: 0, overdue: 0, soon: 0, reopened: 0, needsDate: 0 };
    reqs.forEach(function (r) {
      if (!r.leaf || r.status === "dropped") return;
      t.pieces++;
      if (r.status === "complete") { t.complete++; return; }
      t.open++;
      if (r.status === "reopened") t.reopened++;
      var s = dueState(r, today).state;
      if (s === "overdue") t.overdue++; else if (s === "soon") t.soon++; else if (s === "none") t.needsDate++;
    });
    t.pct = t.pieces ? Math.round(1000 * t.complete / t.pieces) / 10 : 0;
    return t;
  }

  var pure = { todayIso: todayIso, days: days, addDays: addDays, fmtDate: fmtDate, dueState: dueState, dueText: dueText,
               monthGrid: monthGrid, tally: tally, MONTHS: MONTHS, SOON: SOON };
  if (typeof module === "object" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  // ---- shared with the Overview
  var M = window.ModelDocs, el = M.el, clear = M.clear, plural = M.plural;
  var STATUS = {
    "not-started": { label: "Not started", icon: "○" }, "taken-out": { label: "Taken out", icon: "◐" },
    complete: { label: "Complete", icon: "✓" }, reopened: { label: "Reopened", icon: "↺" }, dropped: { label: "Dropped", icon: "–" }
  };
  var ORDER = { reopened: 0, "taken-out": 1, "not-started": 2, complete: 3, dropped: 4 };
  function chip(r, today) {
    var s = STATUS[r.status], late = dueState(r, today).state === "overdue";
    return el("span", { class: "req-status is-" + r.status + (late ? " is-overdue" : "") },
      [el("span", { "aria-hidden": "true", text: s.icon }), s.label + (late ? ", overdue" : "")]);
  }
  function people(r) { return r.assignees.length ? "@" + r.assignees.join(", @") : "Unassigned"; }
  function takenText(r) {
    var t = r.takenOut;
    if (!t) return "";
    return (t.by ? "@" + t.by : "Someone") + (t.on ? " on " + fmtDate(t.on) : "") + (t.branch ? ", branch " + t.branch : "");
  }
  pure.STATUS = STATUS; pure.chip = chip; pure.people = people; pure.takenText = takenText;
  M.planning = pure;

  // ---- the page
  var VIEWS = [{ id: "dashboard", label: "Dashboard" }, { id: "requirements", label: "Requirements" }, { id: "calendar", label: "Calendar" }];
  var app, root, plan, by = {}, today, state = {}, view = "dashboard", ui = {}, expanded = {}, month = null;
  var sort = { key: "due", dir: 1 };

  function readState() {
    var p = new URLSearchParams(location.search);
    state = {};
    ["person", "status"].forEach(function (k) { if (p.get(k)) state[k] = p.get(k); });
    view = VIEWS.some(function (v) { return v.id === p.get("view"); }) ? p.get("view") : "dashboard";
  }
  function commit(push) {
    var p = new URLSearchParams();
    if (view !== "dashboard") p.set("view", view);
    Object.keys(state).forEach(function (k) { p.set(k, state[k]); });
    var q = p.toString();
    history[push ? "pushState" : "replaceState"](null, "", location.pathname + (q ? "?" + q : ""));
    render();
  }
  function matches(r) {
    if (state.status && r.status !== state.status) return false;
    if (state.person && (state.person === "Unassigned" ? r.assignees.length : r.assignees.indexOf(state.person) === -1)) return false;
    return true;
  }
  function family(r) { return [r].concat(r.children.reduce(function (all, n) { return all.concat(family(by[n])); }, [])); }
  function scoped() { return plan.requirements.filter(matches); }

  function issueUrl(fields) {
    var p = new URLSearchParams();
    p.set("template", "requirement.yml");
    Object.keys(fields).forEach(function (k) { if (fields[k]) p.set(k, fields[k]); });
    return "https://github.com/" + plan.repo + "/issues/new?" + p.toString();
  }

  // ---- Add requirement: a short form with a date picker, then on to GitHub with it filled in
  function openDialog(parent) {
    var dlg = el("dialog", { class: "req-dialog", "aria-labelledby": "req-dialog-title" });
    function field(label, node, hint) { return el("label", { class: "req-field" }, [el("span", { text: label }), node, hint ? el("small", { text: hint }) : null]); }
    var title = el("input", { type: "text", required: "", maxlength: "200", placeholder: "A short name for it" });
    var details = el("textarea", { rows: "3", required: "", placeholder: "What is needed, and why" });
    var accept = el("textarea", { rows: "2", placeholder: "How we will know it is satisfied" });
    var area = el("select", {}, [el("option", { value: "", text: "Not one table or page" })]);
    [["Tables", plan.areas.tables], ["Report pages", plan.areas.pages]].forEach(function (g) {
      if (!g[1].length) return;
      area.appendChild(el("optgroup", { label: g[0] }, g[1].map(function (n) { return el("option", { value: n, text: n }); })));
    });
    var who = el("input", { type: "text", list: "req-logins", placeholder: "GitHub username (optional)" });
    var logins = el("datalist", { id: "req-logins" }, plan.logins.map(function (n) { return el("option", { value: n }); }));
    var due = el("input", { type: "date", min: today });
    var priority = el("select", {}, ["High", "Medium", "Low"].map(function (p) { return el("option", { value: p, text: p, selected: p === "Medium" ? "" : null }); }));
    if (parent) area.value = parent.area && [].some.call(area.options, function (o) { return o.value === parent.area; }) ? parent.area : "";
    var form = el("form", { method: "dialog" }, [
      el("h2", { id: "req-dialog-title", text: parent ? "Add a sub-requirement" : "Add a requirement" }),
      parent ? el("p", { class: "req-dialog-note", text: "Part of #" + parent.number + " " + parent.title }) : null,
      field("Title", title), field("Details", details), field("Acceptance criteria", accept),
      el("div", { class: "req-field-row" }, [field("Area", area), field("Priority", priority)]),
      el("div", { class: "req-field-row" }, [field("Assign to", who), field("Due date", due)]), logins,
      el("p", { class: "req-dialog-note", text: "This opens the Requirement form on GitHub with everything filled in. Press Submit there to save it." }),
      el("div", { class: "req-dialog-actions" }, [
        el("button", { type: "button", class: "rpt-data-btn", text: "Cancel", value: "cancel" }),
        el("button", { type: "submit", class: "hk-primary", text: "Continue on GitHub" })])]);
    form.querySelector("button[value=cancel]").addEventListener("click", function () { dlg.close(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      window.open(issueUrl({ title: "[Requirement] " + title.value.trim(), details: details.value.trim(), acceptance: accept.value.trim(),
                             area: area.value, priority: priority.value, due: due.value, parent: parent ? String(parent.number) : "",
                             assignees: who.value.trim().replace(/^@/, "") }), "_blank", "noopener");
      dlg.close();
    });
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    title.focus();
  }

  // ---- shell: filters, Add button, tabs
  function buildShell() {
    clear(app);
    var selects = el("div", { class: "rpt-slicers", role: "group", "aria-label": "Filters" });
    ui.selects = {};
    [["person", "Person", plan.logins.filter(function (n) { return plan.requirements.some(function (r) { return r.assignees.indexOf(n) !== -1; }); }).concat(["Unassigned"]),
      function (v) { return v === "Unassigned" ? v : "@" + v; }],
     ["status", "Status", Object.keys(STATUS), function (v) { return STATUS[v].label; }]].forEach(function (d) {
      var sel = el("select", { id: "pf-" + d[0] }, [el("option", { value: "", text: "All" })]);
      d[2].forEach(function (v) { sel.appendChild(el("option", { value: v, text: d[3](v) })); });
      sel.addEventListener("change", function () { if (sel.value) state[d[0]] = sel.value; else delete state[d[0]]; commit(false); });
      ui.selects[d[0]] = sel;
      selects.appendChild(el("label", {}, [d[1], sel]));
    });
    var add = el("button", { type: "button", class: "hk-primary req-add", disabled: plan.repo ? null : "" }, [el("span", { "aria-hidden": "true", text: "+ " }), "Add requirement"]);
    add.addEventListener("click", function () { openDialog(null); });
    app.appendChild(el("div", { class: "rpt-header req-header" }, [el("div", { class: "rpt-header-row" }, [selects, add])]));
    ui.tabs = {};
    var tabs = el("div", { class: "rpt-tabs", role: "tablist", "aria-label": "Planning pages" });
    VIEWS.forEach(function (v) {
      var b = el("button", { type: "button", role: "tab", text: v.label });
      b.addEventListener("click", function () { if (view !== v.id) { view = v.id; commit(true); } });
      ui.tabs[v.id] = b; tabs.appendChild(b);
    });
    app.appendChild(tabs);
    ui.canvas = el("div", { class: "rpt-canvas", role: "tabpanel" });
    app.appendChild(ui.canvas);
    window.addEventListener("popstate", function () { readState(); render(); });
  }

  // ---- Dashboard
  function pageDashboard() {
    var list = scoped(), t = tally(list, today);
    var hero = M.visual(ui.canvas, "Progress", { span: 12, sub: "Share of the work that is complete. A requirement that has been broken down is counted through its sub-requirements." });
    hero.appendChild(el("div", { class: "req-progress" }, [
      el("div", { class: "req-progress-value", text: t.pct + "%" }),
      el("div", { class: "req-progress-side" }, [
        el("div", { class: "req-progress-track", role: "img", "aria-label": t.pct + "% complete" }, [el("div", { class: "req-progress-fill", style: "width:" + t.pct + "%" })]),
        el("div", { class: "req-progress-text", text: t.pieces ? t.complete + " of " + plural(t.pieces, "piece") + " of work complete" : "No requirements match yet. Add the first one with Add requirement." })])]));
    function go(status) { return function () { if (status) state.status = status; else delete state.status; view = "requirements"; commit(true); }; }
    ui.canvas.appendChild(el("div", { class: "rpt-kpis span-12 req-kpis" }, [
      { label: "Still to do", value: t.open, sub: "open requirements", onClick: go(""), tip: "List the requirements" },
      { label: "Overdue", value: t.overdue, sub: t.overdue ? "past their due date" : "nothing is late" },
      { label: "Due in " + SOON + " days", value: t.soon, sub: "coming up" },
      { label: "Reopened", value: t.reopened, sub: "not satisfied first time", onClick: go("reopened"), tip: "List reopened requirements" },
      { label: "Needs a date", value: t.needsDate, sub: "open with no due date" }
    ].map(M.tile)));

    var per = {};
    list.forEach(function (r) {
      if (!r.leaf || r.status === "dropped") return;
      (r.assignees.length ? r.assignees : ["Unassigned"]).forEach(function (w) {
        var p = per[w] = per[w] || { total: 0, complete: 0 };
        p.total++; if (r.status === "complete") p.complete++;
      });
    });
    M.bars(M.visual(ui.canvas, "Completion by person", { span: 6, sub: "Complete out of everything assigned to them. Click a person to filter." }),
      Object.keys(per).sort(function (a, b) { return (a === "Unassigned") - (b === "Unassigned") || a.localeCompare(b); }).map(function (w) {
        var p = per[w], rate = Math.round(100 * p.complete / p.total);
        return { label: w === "Unassigned" ? w : "@" + w, value: rate, display: p.complete + "/" + p.total, tip: (w === "Unassigned" ? w : "@" + w) + ": " + p.complete + " of " + p.total + " complete",
                 dim: state.person && state.person !== w, on: state.person === w,
                 onClick: function () { if (state.person === w) delete state.person; else state.person = w; commit(false); } };
      }), { max: 100, track: true, empty: "Nothing assigned yet." });

    var months = {};
    list.forEach(function (r) { if (r.leaf && r.due && r.status !== "complete" && r.status !== "dropped") { var k = r.due.slice(0, 7); months[k] = (months[k] || 0) + 1; } });
    M.bars(M.visual(ui.canvas, "Still to do, by month due", { span: 6, sub: "Open requirements by the month they are due. Click a month to see it on the calendar." }),
      Object.keys(months).sort().slice(0, 12).map(function (k) {
        var label = MONTHS[+k.slice(5) - 1].slice(0, 3) + " " + k.slice(0, 4), late = k < today.slice(0, 7);
        return { label: label, value: months[k], cls: late ? "sev-error" : "", tip: label + ": " + plural(months[k], "requirement") + " due" + (late ? ", overdue" : ""),
                 onClick: function () { month = { y: +k.slice(0, 4), m: +k.slice(5) - 1 }; view = "calendar"; commit(true); } };
      }), { empty: "No open requirement has a due date." });
  }

  // ---- Requirements
  function actions(r) {
    var out = [el("a", { class: "rpt-data-btn", href: r.url, target: "_blank", rel: "noopener",
      text: r.status === "complete" ? "Not satisfied? Reopen it on GitHub" : r.status === "dropped" ? "Open on GitHub" :
            r.takenOut || r.assignees.length ? "Open on GitHub" : "Take out: open on GitHub and Create a branch" })];
    if (r.status !== "dropped" && plan.repo) {
      var sub = el("button", { type: "button", class: "rpt-data-btn", text: "+ Add sub-requirement" });
      sub.addEventListener("click", function () { openDialog(r); });
      out.push(sub);
    }
    return el("div", { class: "req-actions" }, out);
  }
  function subList(r) {
    return el("ul", { class: "req-subs" }, r.children.map(function (n) {
      var c = by[n];
      return el("li", {}, [
        el("div", { class: "req-sub" }, [chip(c, today), el("a", { href: c.url, text: "#" + c.number + " " + c.title }),
          el("span", { class: "req-meta", text: [people(c), c.due ? "due " + fmtDate(c.due) : "no date", takenText(c)].filter(Boolean).join(" · ") }),
          c.status !== "dropped" && plan.repo ? (function () {
            var b = el("button", { type: "button", class: "req-mini", title: "Add a sub-requirement to #" + c.number, "aria-label": "Add a sub-requirement to #" + c.number, text: "+" });
            b.addEventListener("click", function () { openDialog(c); });
            return b;
          })() : null]),
        c.children.length ? subList(c) : null]);
    }));
  }
  function pageRequirements() {
    // top-level requirements; one is shown if it, or anything under it, matches the filters
    var tops = plan.requirements.filter(function (r) { return !r.parent && family(r).some(matches); });
    var host = M.visual(ui.canvas, "Requirements (" + tops.length + ")", { span: 12,
      sub: "Click ▸ for the acceptance criteria and sub-requirements. To take one out, open it on GitHub and use Create a branch; merging that branch completes it." });
    function draw() {
      M.sortable(host, sort, [
        { key: "", label: "", cls: "expand-col", cell: function (x) {
            var r = x.r, open = !!expanded[r.number];
            var b = el("button", { type: "button", class: "expand-btn", "aria-expanded": open ? "true" : "false",
                                   "aria-label": (open ? "Hide" : "Show") + " details for #" + r.number, text: open ? "▾" : "▸" });
            b.addEventListener("click", function () { expanded[r.number] = !open; draw(); });
            return b; } },
        { key: "number", label: "#", num: true, cell: function (x) { return el("a", { href: x.r.url, text: "#" + x.r.number }); } },
        { key: "title", label: "Requirement", cell: function (x) { return el("strong", { text: x.r.title }); } },
        { key: "who", label: "Assigned to", cell: function (x) { return people(x.r); } },
        { key: "due", label: "Due", cell: function (x) {
            var r = x.r, text = dueText(r, today);
            return r.due ? el("span", { title: text }, [fmtDate(r.due), text && dueState(r, today).state !== "later" ? el("span", { class: "req-meta", text: " " + text }) : null])
                         : el("span", { class: "req-meta", text: r.dueText ? "Unreadable date: " + r.dueText : "No date" }); } },
        { key: "order", label: "Status", cell: function (x) { return chip(x.r, today); } },
        { key: "done", label: "Parts done", num: true, cell: function (x) { return x.r.children.length ? x.r.progress.done + " of " + x.r.progress.total : ""; } },
        { key: "taken", label: "Taken out", cell: function (x) { return takenText(x.r); } }
      ], tops.map(function (r) {
        return { r: r, _tie: pad(r.number), number: r.number, title: r.title, who: people(r), due: r.due || "9999", order: ORDER[r.status],
                 done: r.children.length ? r.progress.done / (r.progress.total || 1) : -1, taken: r.takenOut ? (r.takenOut.on || "0") : "" };
      }), { height: "none", onSort: draw, empty: plan.requirements.length ? "No requirement matches the filters." : "No requirements yet. Add the first one with Add requirement.",
        detail: function (x, span) {
          var r = x.r;
          if (!expanded[r.number]) return null;
          function block(label, text) { return text ? el("div", { class: "req-block" }, [el("div", { class: "req-block-label", text: label }), el("div", { class: "req-block-text", text: text })]) : null; }
          return el("tr", { class: "detail-row" }, [el("td", {}), el("td", { colspan: String(span - 1) }, [
            el("div", { class: "req-detail" }, [block("Details", r.details), block("Acceptance criteria", r.acceptance),
              block("About", [r.area ? "Area: " + r.area : "", r.priority ? "Priority: " + r.priority : "", "Raised " + fmtDate(r.created) + (r.author ? " by @" + r.author : ""),
                              r.closed && r.status === "complete" ? "Completed " + fmtDate(r.closed) : ""].filter(Boolean).join(" · "))]),
            r.children.length ? el("div", { class: "req-block-label", text: "Sub-requirements: " + r.progress.done + " of " + r.progress.total + " done" }) : null,
            r.children.length ? subList(r) : null, actions(r)])]);
        } });
    }
    draw();
  }

  // ---- Calendar
  function pageCalendar() {
    var list = scoped().filter(function (r) { return r.due && r.status !== "dropped"; });
    if (!month) {
      var next = list.filter(function (r) { return r.status !== "complete" && r.due >= today; }).map(function (r) { return r.due; }).sort()[0] || today;
      month = { y: +next.slice(0, 4), m: +next.slice(5, 7) - 1 };
    }
    var host = M.visual(ui.canvas, "", { span: 12 }), head = host.parentNode.querySelector("h3");
    function move(n) { return function () { var d = new Date(Date.UTC(month.y, month.m + n, 1)); month = { y: d.getUTCFullYear(), m: d.getUTCMonth() }; draw(); }; }
    var nav = el("div", { class: "cal-nav" }, [
      el("button", { type: "button", class: "rpt-data-btn", "aria-label": "Previous month", text: "‹ Previous", onclick: move(-1) }),
      el("button", { type: "button", class: "rpt-data-btn", text: "Today", onclick: function () { month = { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }; draw(); } }),
      el("button", { type: "button", class: "rpt-data-btn", "aria-label": "Next month", text: "Next ›", onclick: move(1) })]);
    var grid = el("div");
    host.appendChild(nav); host.appendChild(grid);
    var byDate = {};
    list.forEach(function (r) { (byDate[r.due] = byDate[r.due] || []).push(r); });
    function draw() {
      head.textContent = MONTHS[month.m] + " " + month.y;
      clear(grid);
      var table = el("table", { class: "cal" }, [el("thead", {}, [el("tr", {}, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (d) { return el("th", { scope: "col", text: d }); }))])]);
      var body = el("tbody");
      monthGrid(month.y, month.m).forEach(function (week) {
        body.appendChild(el("tr", {}, week.map(function (c) {
          var items = (byDate[c.date] || []).sort(function (a, b) { return ORDER[a.status] - ORDER[b.status] || a.number - b.number; });
          return el("td", { class: (c.inMonth ? "" : "cal-out ") + (c.date === today ? "cal-today" : "") }, [
            el("div", { class: "cal-day", text: String(c.day) + (c.date === today ? " · today" : "") })].concat(items.map(function (r) {
              return el("a", { class: "cal-chip is-" + r.status + (dueState(r, today).state === "overdue" ? " is-overdue" : ""), href: r.url,
                               title: "#" + r.number + " " + r.title + " · " + people(r) + " · " + STATUS[r.status].label + (dueText(r, today) ? ", " + dueText(r, today) : "") },
                [el("span", { "aria-hidden": "true", text: STATUS[r.status].icon + " " }), "#" + r.number + " " + r.title]);
            })));
        })));
      });
      table.appendChild(body);
      grid.appendChild(el("div", { class: "cal-wrap" }, [table]));
      var count = list.filter(function (r) { return r.due.slice(0, 7) === month.y + "-" + pad(month.m + 1); }).length;
      grid.appendChild(el("p", { class: "rpt-hint", text: plural(count, "requirement") + " due this month. Requirements with no due date are not shown." }));
    }
    draw();
  }

  function render() {
    Object.keys(ui.selects).forEach(function (k) { ui.selects[k].value = state[k] || ""; });
    VIEWS.forEach(function (v) {
      var on = v.id === view;
      ui.tabs[v.id].classList.toggle("is-active", on);
      ui.tabs[v.id].setAttribute("aria-selected", on ? "true" : "false");
    });
    clear(ui.canvas);
    ({ dashboard: pageDashboard, requirements: pageRequirements, calendar: pageCalendar })[view]();
  }

  M.ready(function () {
    app = document.getElementById("planning-app");
    if (!app) return;
    root = app.getAttribute("data-root") || "";
    document.body.classList.add("report-mode");
    M.load(root, ["planning"]).then(function (d) {
      plan = d.planning; today = todayIso();
      plan.requirements.forEach(function (r) { by[r.number] = r; });
      readState(); buildShell(); render();
    }).catch(function (e) { clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the requirements: " + e.message })); });
  });
})();
