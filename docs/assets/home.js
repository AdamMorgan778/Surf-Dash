// Home page: headline tiles and the issues raised on GitHub. Each tile links to the page that owns the detail:
// documentation gaps are on the Documentation page, rule results on the Best practice report.
(function () {
  var M = window.ModelDocs, el = M.el;

  function issueState(i) {
    var state = i.state === "open" ? "Open" : "Closed " + i.closed;
    if (i.work === "in-progress") state = "In progress" + (i.assignees && i.assignees.length ? " · @" + i.assignees.join(", @") : "");
    else if (i.work === "raised" && i.items) state = "Raised, not picked up";
    if (i.progress && i.progress.total) state += " · " + i.progress.done + "/" + i.progress.total + " done";
    return state;
  }

  function draw(app, root, summary, issues) {
    M.clear(app);
    var tables = summary.tables, list = issues.issues || [];
    var open = list.filter(function (i) { return i.state === "open"; });
    var f = summary.failures, fails = f.error + f.warning + f.info;
    app.appendChild(el("p", { class: "dash-note", text: "Model read " + summary.generated + "." +
      (issues.fetched ? " Issues fetched " + issues.fetched + "." : "") + (issues.note ? " " + issues.note : "") }));

    var count = function (kind) { return tables.filter(function (t) { return t.kind === kind; }).length; };
    var sum = function (key) { return tables.reduce(function (n, t) { return n + t[key]; }, 0); };
    app.appendChild(el("div", { class: "dash-tiles" }, [
      { label: "Documentation score", value: summary.score.pct + "%", sub: el("a", { href: root + "documentation/", text: summary.score.described + " of " + summary.score.total + " objects described. See what is missing" }) },
      { label: "Tables", value: tables.length, sub: count("fact") + " fact, " + count("dimension") + " dimension" },
      { label: "Columns and measures", value: sum("columns") + sum("measures"), sub: sum("measures") + " measures" },
      { label: "Rule failures", value: fails, sub: el("a", { href: root + "rules/", text: f.error + " at error severity. Open the Best practice report" }) },
      { label: "Open issues", value: open.length, sub: summary.repo ? "on GitHub" : "no repository linked yet" },
      { label: "Work in progress", value: summary.work.items, sub: el("a", { href: root + "work/",
          text: M.plural(summary.work.people, "person") + ", " + M.plural(summary.work.overlaps, "overlap") + ". See who is changing what" }) }
    ].map(M.tile)));

    var canvas = el("div", { class: "rpt-canvas home-canvas" });
    app.appendChild(canvas);
    var host = M.visual(canvas, "Issues", { sub: "Open issues, and those closed in the last " + (issues.closedDays || 30) + " days." });
    var sort = { key: "number", dir: -1 };
    function table() {
      M.sortable(host, sort, [
        { key: "number", label: "Issue", num: true, cell: function (i) { return el("a", { href: i.url, text: "#" + i.number }); } },
        { key: "title", label: "Title", cell: function (i) { return i.title; } },
        { key: "table", label: "Table", cell: function (i) { return i.table; } },
        { key: "requestType", label: "Type", cell: function (i) { return i.requestType; } },
        { key: "priority", label: "Priority", cell: function (i) { return i.priority; } },
        { key: "stateText", label: "State", cell: function (i) { return i.stateText; } }
      ], list.map(function (i) { i._tie = i.number; i.stateText = issueState(i); return i; }),
      { height: "24rem", onSort: table,
        empty: summary.repo ? "No open issues, and none closed recently." : "Issues appear here once the repository is on GitHub." });
    }
    table();
  }

  M.ready(function () {
    var app = document.getElementById("home-app");
    if (!app) return;
    var root = app.getAttribute("data-root") || "";
    M.load(root, ["summary"], ["issues"]).then(function (d) { draw(app, root, d.summary, d.issues || { issues: [] }); })
      .catch(function (e) { M.clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the site data: " + e.message })); });
  });
})();
