// Overview dashboard and dictionary filter. Reads the JSON files that tools/generate_docs.py copies to docs/data/.
(function () {
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function link(text, href) { return href ? el("a", { href: href, text: text }) : el("span", { text: text }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- dictionary index: filter rows as you type
  function initDictFilter() {
    var input = document.getElementById("dict-filter");
    if (!input) return;
    var rows = document.querySelectorAll(".md-typeset table tbody tr");
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      rows.forEach(function (r) { r.hidden = q !== "" && r.textContent.toLowerCase().indexOf(q) === -1; });
    });
  }

  // ---- overview dashboard
  var SEVERITIES = [
    { id: "error", label: "Error", icon: "✖" },
    { id: "warning", label: "Warning", icon: "▲" },
    { id: "info", label: "Info", icon: "ℹ" }
  ];

  function bars(target, items, opts) {
    // items: [{label, value, display, cls, href, icon}] ; one horizontal bar each, value labelled at the end
    clear(target);
    if (!items.length) { target.appendChild(el("p", { class: "dash-empty", text: opts.empty })); return; }
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    items.forEach(function (i) {
      var fill = el("div", { class: (i.value > 0 ? "bar-fill " : "bar-zero ") + (i.cls || ""), style: "width:" + (100 * i.value / max) + "%" });
      var name = el("div", { class: "bar-label" }, [i.icon ? el("span", { class: "bar-icon " + (i.cls || ""), text: i.icon, "aria-hidden": "true" }) : null, link(i.label, i.href)]);
      target.appendChild(el("div", { class: "bar-row", title: i.label + ": " + i.display }, [
        name, el("div", { class: "bar-track" }, [fill]), el("div", { class: "bar-value", text: i.display })]));
    });
  }

  function dataTable(target, header, rows, empty) {
    clear(target);
    if (!rows.length) { target.appendChild(el("p", { class: "dash-empty", text: empty })); return; }
    var thead = el("thead", {}, [el("tr", {}, header.map(function (h) { return el("th", { text: h }); }))]);
    var tbody = el("tbody", {}, rows.map(function (r) {
      return el("tr", {}, r.map(function (c) { return el("td", {}, [typeof c === "string" ? document.createTextNode(c) : c]); }));
    }));
    target.appendChild(el("div", { class: "md-typeset__scrollwrap" }, [el("div", { class: "md-typeset__table" }, [el("table", {}, [thead, tbody])])]));
  }

  function initDashboard() {
    var root = document.getElementById("dashboard");
    if (!root) return;
    Promise.all(["model", "results", "issues"].map(function (n) {
      return fetch("data/" + n + ".json").then(function (r) { if (!r.ok) throw new Error(n + ".json " + r.status); return r.json(); });
    })).then(function (d) { run(d[0], d[1], d[2]); }).catch(function (e) {
      document.getElementById("dash-note").textContent = "Could not load the dashboard data: " + e.message;
    });
  }

  function run(model, results, issues) {
    var f = { table: document.getElementById("f-table"), owner: document.getElementById("f-owner"),
              severity: document.getElementById("f-severity"), status: document.getElementById("f-status") };
    var ownerOf = {}, owners = [];
    model.tables.forEach(function (t) {
      var o = (t.meta && t.meta.owner) || "Unassigned";
      ownerOf[t.name] = o;
      if (owners.indexOf(o) === -1) owners.push(o);
      f.table.appendChild(el("option", { value: t.name, text: t.name }));
    });
    owners.sort().forEach(function (o) { f.owner.appendChild(el("option", { value: o, text: o })); });
    var ruleText = {};
    results.rules.forEach(function (r) { ruleText[r.id] = r.description; });
    var note = "Model read " + model.generated + ". Issues fetched " + issues.fetched + ".";
    if (issues.note) note += " " + issues.note;
    document.getElementById("dash-note").textContent = note;

    function tableInScope(name) {
      return (!f.table.value || f.table.value === name) && (!f.owner.value || ownerOf[name] === f.owner.value);
    }
    function coverage(t) {
      var objs = [t].concat(t.columns.filter(function (c) { return !c.isHidden; }), t.measures);
      return { described: objs.filter(function (o) { return o.description; }).length, total: objs.length };
    }

    function render() {
      var tables = model.tables.filter(function (t) { return tableInScope(t.name); });
      var scoped = results.results.filter(function (r) { return tableInScope(r.table); });
      var fails = scoped.filter(function (r) { return r.status === "fail" && (!f.severity.value || r.severity === f.severity.value); });
      var openIssues = issues.issues.filter(function (i) {
        return i.state === "open" && (i.table === "Unassigned" || i.table === "Whole model" ? !f.table.value && !f.owner.value : tableInScope(i.table));
      });
      var cov = tables.map(coverage), described = 0, total = 0;
      cov.forEach(function (c) { described += c.described; total += c.total; });

      // tiles
      var tiles = document.getElementById("dash-tiles");
      clear(tiles);
      [["Documentation score", total ? Math.round(100 * described / total) + "%" : "n/a", described + " of " + total + " objects described"],
       ["Tables", String(tables.length), tables.filter(function (t) { return t.kind === "fact"; }).length + " fact, " +
         tables.filter(function (t) { return t.kind === "dimension"; }).length + " dimension"],
       ["Columns and measures", String(tables.reduce(function (n, t) { return n + t.columns.length + t.measures.length; }, 0)),
         tables.reduce(function (n, t) { return n + t.measures.length; }, 0) + " measures"],
       ["Rule failures", String(fails.length), fails.filter(function (r) { return r.severity === "error"; }).length + " at error severity"],
       ["Open issues", String(openIssues.length), issues.repo ? "on GitHub" : "no repository linked yet"]
      ].forEach(function (t) {
        tiles.appendChild(el("div", { class: "dash-tile" }, [
          el("div", { class: "tile-label", text: t[0] }), el("div", { class: "tile-value", text: t[1] }), el("div", { class: "tile-sub", text: t[2] })]));
      });

      // charts
      bars(document.getElementById("chart-coverage"), tables.map(function (t, i) {
        var pct = cov[i].total ? Math.round(100 * cov[i].described / cov[i].total) : 0;
        return { label: t.name, value: pct, display: pct + "% (" + cov[i].described + "/" + cov[i].total + ")", href: "dictionary/" + t.name + "/" };
      }), { max: 100, empty: "No tables match the filters." });
      bars(document.getElementById("chart-severity"), SEVERITIES.filter(function (s) { return !f.severity.value || f.severity.value === s.id; }).map(function (s) {
        var n = scoped.filter(function (r) { return r.status === "fail" && r.severity === s.id; }).length;
        return { label: s.label, value: n, display: String(n), cls: "sev-" + s.id, icon: s.icon };
      }), { empty: "No rule results match the filters." });
      var byTable = {};
      openIssues.forEach(function (i) { byTable[i.table] = (byTable[i.table] || 0) + 1; });
      bars(document.getElementById("chart-issues"), Object.keys(byTable).sort(function (a, b) { return byTable[b] - byTable[a]; }).map(function (k) {
        return { label: k, value: byTable[k], display: String(byTable[k]) };
      }), { empty: issues.repo ? "No open issues." : "Issues appear here once the repository is on GitHub." });

      // rule results table
      var rows = scoped.filter(function (r) {
        return (!f.status.value || r.status === f.status.value) && (!f.severity.value || r.severity === f.severity.value);
      });
      var order = { error: 0, warning: 1, info: 2 };
      rows.sort(function (a, b) { return order[a.severity] - order[b.severity] || a.table.localeCompare(b.table) || a.object.localeCompare(b.object); });
      document.getElementById("rules-heading").textContent = "Rule results (" + rows.length + ")";
      dataTable(document.getElementById("rules-table"), ["Severity", "Table", "Object", "Rule", "Status"], rows.slice(0, 500).map(function (r) {
        var sev = SEVERITIES.filter(function (s) { return s.id === r.severity; })[0];
        return [el("span", { class: "sev-chip" }, [el("span", { class: "bar-icon sev-" + r.severity, text: sev.icon, "aria-hidden": "true" }), document.createTextNode(" " + sev.label)]),
                link(r.table, "dictionary/" + r.table + "/"), link(r.object, r.link), ruleText[r.rule] || r.rule, cap(r.status)];
      }), "Nothing matches the filters.");

      // issues table
      var list = issues.issues.filter(function (i) {
        return i.table === "Unassigned" || i.table === "Whole model" ? !f.table.value && !f.owner.value : tableInScope(i.table);
      });
      dataTable(document.getElementById("issues-table"), ["Issue", "Title", "Table", "Type", "Priority", "State"], list.map(function (i) {
        return [link("#" + i.number, i.url), i.title, i.table, i.requestType, i.priority, i.state === "open" ? "Open" : "Closed " + i.closed];
      }), issues.repo ? "No open issues, and none closed in the last " + issues.closedDays + " days." : "Issues appear here once the repository is on GitHub.");
    }

    Object.keys(f).forEach(function (k) { f[k].addEventListener("change", render); });
    render();
  }

  function init() { initDictFilter(); initDashboard(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
