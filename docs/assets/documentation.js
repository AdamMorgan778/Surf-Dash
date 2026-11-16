// Documentation page: what the documentation is missing. Reads docs/data/gaps.json (worked out in tools/gaps.py)
// and draws it with the shared parts in ui.js, so it matches the home page and the Best practice report.
(function () {
  var M = window.ModelDocs, el = M.el;

  function draw(app, root, gaps, summary) {
    M.clear(app);
    var c = gaps.counts, tables = summary.tables;
    function tableLink(name) { return name ? el("a", { href: "dictionary/" + name + "/", text: name }) : "Whole model"; }

    app.appendChild(el("div", { class: "dash-tiles" }, [
      { label: "Documentation score", value: c.score.pct + "%", sub: c.score.described + " of " + c.score.total + " objects described" },
      { label: "Missing descriptions", value: c.descriptions, sub: "tables, visible columns and measures" },
      { label: "Incomplete catalogue entries", value: c.incompleteTables, sub: "of " + M.plural(c.tables, "table") },
      { label: "Glossary terms", value: c.glossaryTerms, sub: M.plural(c.brokenReferences, "broken reference") }
    ].map(M.tile)));

    var canvas = el("div", { class: "rpt-canvas home-canvas" });
    app.appendChild(canvas);

    M.bars(M.visual(canvas, "Documentation coverage by table", { sub: "Share of each table's visible columns, measures and the table itself that have a description." }),
      tables.map(function (t) {
        var pct = t.total ? Math.round(100 * t.described / t.total) : 0;
        return { label: t.name, value: pct, display: pct + "% (" + t.described + "/" + t.total + ")", href: "dictionary/" + t.name + "/" };
      }), { max: 100, track: true, empty: "The model has no tables." });

    // table x catalogue field: a tick where it is filled in, "Missing" where it is not, a dash where it does not apply
    var grid = M.visual(canvas, "Catalogue completeness", { sub: "The fields each table should have in metadata/tables.yaml. Business process applies to fact tables." });
    var gridSort = { key: "table", dir: 1 };
    function drawGrid() {
      M.sortable(grid, gridSort, [{ key: "table", label: "Table", cell: function (r) { return tableLink(r.table); } }].concat(gaps.fields.map(function (f) {
        return { key: f.id, label: f.label, cell: function (r) {
          var v = r.fields[f.id];
          return v === undefined ? el("span", { class: "gap-na", text: "–", title: "Does not apply" })
               : v ? el("span", { class: "gap-ok", text: "✓", title: f.label + " filled in" })
                   : el("span", { class: "gap-missing", text: "Missing" });
        } };
      })), gaps.catalogue.map(function (r) {
        var row = { table: r.table, fields: r.fields, _tie: r.table };
        gaps.fields.forEach(function (f) { row[f.id] = r.fields[f.id] === undefined ? 2 : r.fields[f.id] ? 1 : 0; });
        return row;
      }), { height: "22rem", onSort: drawGrid, empty: "The model has no tables." });
    }
    drawGrid();

    var list = M.visual(canvas, "What is missing (" + gaps.rows.length + ")", { sub: "Every gap, with a link to the line or file to edit." });
    var listSort = { key: "kindOrder", dir: 1 }, ORDER = { Table: 0, Column: 1, Measure: 2, Catalogue: 3, Glossary: 4 };
    function drawList() {
      M.sortable(list, listSort, [
        { key: "table", label: "Table", cell: function (r) { return tableLink(r.table); } },
        { key: "item", label: "Item", cell: function (r) { return r.link ? el("a", { href: r.link, text: r.item }) : r.item; } },
        { key: "kindOrder", label: "Kind", cell: function (r) { return r.kind; } },
        { key: "missing", label: "What is missing", cell: function (r) { return r.missing; } }
      ], gaps.rows.map(function (r) { r.kindOrder = ORDER[r.kind]; r._tie = r.table + r.item + r.missing; return r; }),
      { height: "34rem", onSort: drawList, empty: "Nothing is missing. Every table, visible column and measure is described, and every catalogue entry is complete." });
    }
    drawList();
    if (c.descriptions) {
      list.appendChild(el("p", { class: "rpt-more rpt-hint" }, ["Missing descriptions are also rule failures. To share the work out, add them to a housekeeping list on the ",
        el("a", { href: root + "rules/?category=Maintenance", text: "Best practice report" }), "."]));
    }
  }

  M.ready(function () {
    var app = document.getElementById("docs-app");
    if (!app) return;
    var root = app.getAttribute("data-root") || "";
    M.load(root, ["gaps", "summary"]).then(function (d) { draw(app, root, d.gaps, d.summary); })
      .catch(function (e) { M.clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the documentation data: " + e.message })); });
  });
})();
