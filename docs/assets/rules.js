// Rules report (/rules/): a Power BI-style report over docs/data/results.json with four tabs (Overview, Matrix,
// Rules, Tables) that share one set of filters. Filters and the active tab live in the page address
// (?view=matrix&category=Formatting) so views can be bookmarked and the back button moves between tabs.
(function () {
  var SEVS = [
    { id: "error", label: "Error", icon: "✖" },
    { id: "warning", label: "Warning", icon: "▲" },
    { id: "info", label: "Info", icon: "ℹ" }
  ];
  var SEV_ORDER = { error: 0, warning: 1, info: 2 };
  var VIEWS = [
    { id: "overview", label: "Overview" },
    { id: "matrix", label: "Matrix" },
    { id: "rules", label: "Rules" },
    { id: "tables", label: "Tables" }
  ];
  var GLOBAL_KEYS = ["category", "severity", "table", "type", "source", "work", "rule"];
  var STATE_KEYS = GLOBAL_KEYS.concat(["status", "q"]);   // status and q only filter the "All results" table
  var LABEL = { category: "Category", severity: "Severity", table: "Table", type: "Object type",
                source: "Source", work: "Fix status", rule: "Rule", status: "Status", q: "Search" };
  // Where a failing check stands in the housekeeping workflow.
  var WORK = [
    { id: "none", label: "Not raised" },
    { id: "raised", label: "Raised" },
    { id: "in-progress", label: "In progress" },
    { id: "done", label: "Done" }
  ];

  var app, root, results, model, issues, ruleById = {}, state = {}, view = "overview", ui = {};
  // Housekeeping list: failing checks a viewer has picked, kept in this browser only.
  var HK_KEY = "surf-dash-housekeeping-v1", basket = [], basketMeta = {}, raised = {}, failByKey = {}, droppedRaised = 0;
  var sorts = { rules: { key: "fail", dir: -1 }, tables: { key: "fail", dir: -1 }, all: { key: "severity", dir: 1 },
                drawer: { key: "severity", dir: 1 } };
  var expanded = {}, showPassing = false, drawer = null;

  // ---- DOM helpers
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "onclick") node.addEventListener("click", attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c !== null && c !== undefined && c !== "") node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } }); return out; }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : /(s|x|ch|sh)$/.test(word) ? "es" : "s"); }
  function clickable(node, fn, label) {
    node.setAttribute("role", "button"); node.setAttribute("tabindex", "0");
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", fn);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
    return node;
  }

  // ---- labels
  function tableLabel(t) { return t === "(model)" ? "Whole model" : t; }
  function sourceOf(r) { return ruleById[r.rule] && ruleById[r.rule].bpaId ? "bpa" : "project"; }
  function sourceLabel(s) { return s === "bpa" ? "Best Practice Analyzer" : "Project rule"; }
  function ruleText(id) { return ruleById[id] ? ruleById[id].description : id; }
  function ruleName(id) { return ruleById[id] ? ruleById[id].name || ruleById[id].description : id; }
  function valueLabel(key, v) {
    if (key === "table") return tableLabel(v);
    if (key === "source") return sourceLabel(v);
    if (key === "work") return workLabel(v);
    if (key === "rule") return ruleText(v);
    if (key === "q") return "“" + v + "”";
    if (key === "status") return v === "fail" ? "Failing" : v === "pass" ? "Passing" : "All";
    return cap(v);
  }
  function sevChip(id) {
    var s = SEVS[SEV_ORDER[id]];
    return el("span", { class: "sev-chip" }, [el("span", { class: "bar-icon sev-" + id, text: s.icon, "aria-hidden": "true" }), " " + s.label]);
  }
  function objectText(r) {
    return r.type === "table" || r.type === "model" || r.type === "relationship" ? r.object : tableLabel(r.table) + "[" + r.object + "]";
  }
  function objectLink(r) { return r.link ? el("a", { href: r.link, text: objectText(r) }) : el("span", { text: objectText(r) }); }
  function tableCell(t) {
    return t === "(model)" ? el("span", { text: "Whole model" }) : el("a", { href: root + "dictionary/" + t + "/", text: t });
  }
  function sortTables(a, b) { return (a === "(model)") - (b === "(model)") || a.localeCompare(b); }

  // ---- state <-> address
  function readState() {
    var p = new URLSearchParams(location.search);
    state = {};
    STATE_KEYS.forEach(function (k) { if (p.get(k)) state[k] = p.get(k); });
    if (!state.status) state.status = "fail";
    view = VIEWS.some(function (v) { return v.id === p.get("view"); }) ? p.get("view") : "overview";
  }
  function address() {
    var p = new URLSearchParams();
    if (view !== "overview") p.set("view", view);
    STATE_KEYS.forEach(function (k) { if (state[k] && !(k === "status" && state[k] === "fail")) p.set(k, state[k]); });
    var q = p.toString();
    return location.pathname + (q ? "?" + q : "");
  }
  function commit(push) {
    history[push ? "pushState" : "replaceState"](null, "", address());
    render();
  }
  function setFilter(key, value) { if (value) state[key] = value; else delete state[key]; commit(false); }
  function toggle(key, value) { setFilter(key, state[key] === value ? "" : value); }
  function setView(id) { if (id !== view) { view = id; commit(true); window.scrollTo({ top: ui.header.offsetTop - 60 }); } }

  function matches(r, except) {
    except = except || [];
    for (var i = 0; i < GLOBAL_KEYS.length; i++) {
      var k = GLOBAL_KEYS[i];
      if (!state[k] || except.indexOf(k) !== -1) continue;
      var v = k === "source" ? sourceOf(r) : k === "work" ? workOf(r) : r[k];
      if (v !== state[k]) return false;
    }
    return true;
  }
  function scoped(except) { return results.results.filter(function (r) { return matches(r, except); }); }
  function failing(rows) { return rows.filter(function (r) { return r.status === "fail"; }); }
  function sevCounts(rows) {
    var c = { error: 0, warning: 0, info: 0, total: 0 };
    rows.forEach(function (r) { if (r.status === "fail") { c[r.severity]++; c.total++; } });
    return c;
  }
  function sevSummary(c) { return c.error + " error, " + c.warning + " warning, " + c.info + " info"; }
  function group(rows, fn) {
    var g = {};
    rows.forEach(function (r) { var k = typeof fn === "function" ? fn(r) : r[fn]; (g[k] = g[k] || []).push(r); });
    return g;
  }

  // ---- report shell
  function buildShell() {
    clear(app);
    document.body.classList.add("report-mode");

    ui.header = el("div", { class: "rpt-header" });
    var selects = el("div", { class: "rpt-slicers", role: "group", "aria-label": "Report filters" });
    ui.selects = {};
    [["category", uniq(results.rules.map(function (r) { return r.category; })).sort()],
     ["severity", SEVS.map(function (s) { return s.id; })],
     ["table", uniq(results.results.map(function (r) { return r.table; })).sort(sortTables)],
     ["type", uniq(results.results.map(function (r) { return r.type; })).sort()],
     ["source", ["bpa", "project"]],
     ["work", WORK.map(function (w) { return w.id; })]].forEach(function (d) {
      var key = d[0], sel = el("select", { id: "rf-" + key }, [el("option", { value: "", text: "All" })]);
      d[1].forEach(function (v) { sel.appendChild(el("option", { value: v, text: valueLabel(key, v) })); });
      sel.addEventListener("change", function () { setFilter(key, sel.value); });
      ui.selects[key] = sel;
      selects.appendChild(el("label", {}, [LABEL[key], sel]));
    });
    ui.chips = el("div", { class: "rules-chips" });
    ui.stamp = el("div", { class: "rpt-stamp", text: "Model read " + (results.generated || model.generated) });
    ui.header.appendChild(el("div", { class: "rpt-header-row" }, [selects]));
    ui.header.appendChild(el("div", { class: "rpt-chip-row" }, [ui.chips, ui.stamp]));
    app.appendChild(ui.header);

    ui.tabs = el("div", { class: "rpt-tabs", role: "tablist", "aria-label": "Report pages" });
    ui.tabButtons = {};
    VIEWS.forEach(function (v) {
      var b = el("button", { type: "button", role: "tab", id: "tab-" + v.id, "aria-controls": "rpt-canvas", text: v.label,
                             onclick: function () { setView(v.id); } });
      b.addEventListener("keydown", function (e) {
        var i = VIEWS.indexOf(v), next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -2;
        if (next === -2) return;
        next = (next + VIEWS.length) % VIEWS.length;
        e.preventDefault(); setView(VIEWS[next].id); ui.tabButtons[VIEWS[next].id].focus();
      });
      ui.tabButtons[v.id] = b;
      ui.tabs.appendChild(b);
    });
    app.appendChild(ui.tabs);

    ui.canvas = el("div", { class: "rpt-canvas", id: "rpt-canvas", role: "tabpanel" });
    app.appendChild(ui.canvas);

    // "Show data" drawer
    ui.drawerBackdrop = el("div", { class: "rpt-backdrop", hidden: "", onclick: closeDrawer });
    ui.drawer = el("aside", { class: "rpt-drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "rpt-drawer-title", hidden: "" });
    document.body.appendChild(ui.drawerBackdrop);
    document.body.appendChild(ui.drawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer) closeDrawer(); });
    window.addEventListener("popstate", function () { readState(); render(); });
  }

  function syncHeader() {
    Object.keys(ui.selects).forEach(function (k) { ui.selects[k].value = state[k] || ""; });
    clear(ui.chips);
    var active = GLOBAL_KEYS.filter(function (k) { return state[k]; });
    if (!active.length) {
      ui.chips.appendChild(el("span", { class: "rpt-hint", text: "Click any bar, card or matrix cell to filter every page. Click it again to clear." }));
    }
    active.forEach(function (k) {
      ui.chips.appendChild(el("button", { type: "button", class: "rules-chip", title: "Remove this filter", onclick: function () { setFilter(k, ""); } },
        [LABEL[k] + ": " + valueLabel(k, state[k]) + " ", el("span", { "aria-hidden": "true", text: "×" })]));
    });
    if (active.length > 1) {
      ui.chips.appendChild(el("button", { type: "button", class: "rules-chip rules-chip-clear", text: "Clear all", onclick: function () {
        active.forEach(function (k) { delete state[k]; }); commit(false);
      } }));
    }
    VIEWS.forEach(function (v) {
      var on = v.id === view, b = ui.tabButtons[v.id];
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
      b.classList.toggle("is-active", on);
    });
    ui.canvas.setAttribute("aria-labelledby", "tab-" + view);
  }

  // A visual: card with a title bar, optional "Show data" button, and a body. opts: {span, sub, data, dataTitle}
  function visual(title, opts) {
    var body = el("div", { class: "rpt-visual-body" });
    var bar = el("div", { class: "rpt-visual-bar" }, [el("div", {}, [el("h3", { text: title }), opts.sub ? el("p", { class: "rpt-sub", text: opts.sub }) : null])]);
    if (opts.data) {
      var btn = el("button", { type: "button", class: "rpt-data-btn", title: "Show the rows behind this visual as a table" },
        [el("span", { "aria-hidden": "true", text: "☷ " }), "Show data"]);
      btn.addEventListener("click", function () { openDrawer(opts.dataTitle || title, opts.data(), btn); });
      bar.appendChild(btn);
    }
    var card = el("section", { class: "rpt-visual span-" + (opts.span || 12) + (opts.cls ? " " + opts.cls : "") }, [bar, body]);
    ui.canvas.appendChild(card);
    return body;
  }

  // ---- visuals
  function stackedBars(host, items, empty, wide) {
    clear(host);
    if (!items.length) { host.appendChild(el("p", { class: "dash-empty", text: empty })); return; }
    var max = Math.max.apply(null, items.map(function (i) { return i.counts.total; })) || 1;
    items.forEach(function (i) {
      var track = el("div", { class: "sbar", style: "width:" + (100 * i.counts.total / max) + "%" });
      SEVS.forEach(function (s) {
        if (i.counts[s.id]) track.appendChild(el("span", { class: "sbar-seg sev-" + s.id, style: "flex-grow:" + i.counts[s.id] }));
      });
      var tip = i.label + ": " + i.counts.total + " failing (" + sevSummary(i.counts) + ")";
      var row = el("div", { class: "bar-row sbar-row" + (wide ? " wide" : "") + (i.dim ? " is-dim" : "") + (i.on ? " is-on" : ""), title: tip }, [
        el("div", { class: "bar-label", text: i.label }), el("div", { class: "bar-track" }, [track]),
        el("div", { class: "bar-value", text: String(i.counts.total) })]);
      host.appendChild(clickable(row, i.onClick, tip));
    });
  }
  function dimensionBars(host, dim, labelFn) {
    var g = group(scoped([dim]), dim);
    var items = Object.keys(g).map(function (k) {
      return { label: labelFn(k), counts: sevCounts(g[k]), dim: !!state[dim] && state[dim] !== k, on: state[dim] === k,
               onClick: function () { toggle(dim, k); } };
    }).filter(function (i) { return i.counts.total > 0; });
    items.sort(function (a, b) { return b.counts.total - a.counts.total || a.label.localeCompare(b.label); });
    stackedBars(host, items, "No failures match the filters.");
  }
  function ruleBars(host, limit) {
    var g = group(failing(scoped(["rule"])), "rule");
    var items = Object.keys(g).map(function (id) {
      return { label: ruleText(id), counts: sevCounts(g[id]), dim: !!state.rule && state.rule !== id, on: state.rule === id,
               onClick: function () { toggle("rule", id); } };
    }).sort(function (a, b) { return b.counts.total - a.counts.total || a.label.localeCompare(b.label); });
    stackedBars(host, limit ? items.slice(0, limit) : items, "No failures match the filters.", true);
  }
  function passRate(host) {
    clear(host);
    var g = group(scoped(["category"]), "category");
    Object.keys(g).sort().forEach(function (k) {
      var total = g[k].length, pass = total - failing(g[k]).length;
      var pct = Math.round(1000 * pass / total) / 10, tip = k + ": " + pct + "% pass (" + pass + " of " + total + " checks)";
      var row = el("div", { class: "bar-row sbar-row" + (state.category && state.category !== k ? " is-dim" : ""), title: tip }, [
        el("div", { class: "bar-label", text: k }),
        el("div", { class: "bar-track rate-track" }, [el("div", { class: "bar-fill", style: "width:" + pct + "%" })]),
        el("div", { class: "bar-value", text: pct + "%" })]);
      host.appendChild(clickable(row, function () { toggle("category", k); }, tip));
    });
  }
  function sourceBars(host) {
    var g = group(scoped(["source"]), sourceOf);
    stackedBars(host, ["bpa", "project"].filter(function (s) { return g[s]; }).map(function (s) {
      return { label: sourceLabel(s), counts: sevCounts(g[s]), dim: !!state.source && state.source !== s, on: state.source === s,
               onClick: function () { toggle("source", s); } };
    }), "No failures match the filters.");
  }

  // Table x category matrix of failing checks. Ignores the table and category filters so the whole grid stays visible.
  function matrixRows() { return failing(scoped(["table", "category"])); }
  function matrix(host, compact) {
    clear(host);
    var rows = matrixRows();
    var cats = uniq(results.rules.map(function (r) { return r.category; })).sort();
    var tables = uniq(results.results.map(function (r) { return r.table; })).sort(sortTables);
    var cell = {}, rowTot = {}, colTot = {}, max = 1;
    rows.forEach(function (r) {
      var k = r.table + "|" + r.category;
      var c = cell[k] = cell[k] || { error: 0, warning: 0, info: 0, total: 0 };
      c[r.severity]++; c.total++;
      rowTot[r.table] = (rowTot[r.table] || 0) + 1; colTot[r.category] = (colTot[r.category] || 0) + 1;
      if (c.total > max) max = c.total;
    });
    function selectRow(t) { delete state.category; toggle("table", t); }
    function selectCol(c) { delete state.table; toggle("category", c); }
    function head(text, fn, on, dim) {
      return el("button", { type: "button", class: "grid-head" + (on ? " is-active" : "") + (dim ? " is-dim" : ""), text: text, onclick: fn });
    }
    var rowOn = state.table && !state.category, colOn = state.category && !state.table;
    var thead = el("thead", {}, [el("tr", {}, [el("th", { class: "corner", scope: "col", text: "Table" })].concat(cats.map(function (c) {
      return el("th", { scope: "col" }, [head(c, function () { selectCol(c); }, colOn && state.category === c, state.category && state.category !== c)]);
    })).concat([el("th", { scope: "col", class: "num", text: "Total" })]))]);
    var tbody = el("tbody");
    tables.forEach(function (t) {
      var tr = el("tr", {}, [el("th", { scope: "row" }, [head(tableLabel(t), function () { selectRow(t); }, rowOn && state.table === t, state.table && state.table !== t)])]);
      cats.forEach(function (c) {
        var v = cell[t + "|" + c], dim = (state.table && state.table !== t) || (state.category && state.category !== c);
        if (!v) { tr.appendChild(el("td", { class: "grid-zero" + (dim ? " is-dim" : ""), text: "·" })); return; }
        var on = state.table === t && state.category === c;
        tr.appendChild(el("td", {}, [el("button", {
          type: "button", class: "grid-cell" + (on ? " is-active" : "") + (dim ? " is-dim" : ""),
          style: "background:color-mix(in srgb, var(--dash-bar) " + Math.round(12 + 48 * v.total / max) + "%, transparent)",
          title: tableLabel(t) + ", " + c + ": " + v.total + " failing (" + sevSummary(v) + ")", text: String(v.total),
          "aria-pressed": on ? "true" : "false",
          onclick: function () {
            if (on) { delete state.table; delete state.category; } else { state.table = t; state.category = c; }
            commit(false);
          } })]));
      });
      tr.appendChild(el("td", { class: "grid-total num", text: String(rowTot[t] || 0) }));
      tbody.appendChild(tr);
    });
    var foot = el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total" })].concat(cats.map(function (c) {
      return el("td", { class: "grid-total", text: String(colTot[c] || 0) });
    })).concat([el("td", { class: "grid-total num", text: String(rows.length) })]))]);
    host.appendChild(el("div", { class: "rpt-matrix-wrap" }, [el("table", { class: "rpt-matrix" + (compact ? " compact" : "") }, [thead, tbody, foot])]));
  }

  // Failing objects for the current selection, grouped by rule.
  function details(host, emptyHint) {
    clear(host);
    var rows = failing(scoped()), c = sevCounts(rows);
    var sel = ["table", "category", "rule"].filter(function (k) { return state[k]; }).map(function (k) { return valueLabel(k, state[k]); });
    host.appendChild(el("p", { class: "rpt-details-title" }, [
      el("strong", { text: sel.length ? sel.join(" · ") : "Everything in scope" }), el("br"),
      plural(c.total, "failing check") + (c.total ? " (" + sevSummary(c) + ")" : "")]));
    if (!sel.length) host.appendChild(el("p", { class: "rpt-hint", text: emptyHint }));
    if (!rows.length) { host.appendChild(el("p", { class: "dash-empty", text: "Nothing failing here." })); return; }
    var g = group(rows, "rule");
    Object.keys(g).sort(function (a, b) {
      return SEV_ORDER[g[a][0].severity] - SEV_ORDER[g[b][0].severity] || g[b].length - g[a].length || ruleText(a).localeCompare(ruleText(b));
    }).forEach(function (id) {
      host.appendChild(el("div", { class: "rpt-details-group" }, [
        el("div", { class: "rpt-details-rule" }, [sevChip(g[id][0].severity), el("span", { text: ruleText(id) }),
          el("span", { class: "rpt-count", text: String(g[id].length) })]),
        el("div", { class: "rpt-details-actions" }, [addAllButton(g[id])]),
        el("ul", { class: "fail-list hk-list" }, g[id].map(function (r) { return el("li", {}, [addButton(r), objectLink(r), statusTag(r)]); }))]));
    });
  }

  function kpis() {
    var rows = scoped(), fails = failing(rows);
    var row = el("div", { class: "rpt-kpis span-12" });
    var rate = rows.length ? Math.round(1000 * (rows.length - fails.length) / rows.length) / 10 + "%" : "n/a";
    [["Pass rate", rate, (rows.length - fails.length) + " of " + rows.length + " checks pass"],
     ["Checks run", rows.length, plural(uniq(rows.map(function (r) { return r.rule; })).length, "rule") + " checked"],
     ["Failing rules", uniq(fails.map(function (r) { return r.rule; })).length, plural(fails.length, "failing check")]
    ].forEach(function (t) {
      row.appendChild(el("div", { class: "dash-tile" }, [el("div", { class: "tile-label", text: t[0] }),
        el("div", { class: "tile-value", text: String(t[1]) }), el("div", { class: "tile-sub", text: t[2] })]));
    });
    var bySev = sevCounts(scoped(["severity"]));
    SEVS.forEach(function (s) {
      var tile = el("div", { class: "dash-tile tile-click" + (state.severity && state.severity !== s.id ? " is-dim" : "") + (state.severity === s.id ? " is-on" : "") }, [
        el("div", { class: "tile-label" }, [el("span", { class: "bar-icon sev-" + s.id, text: s.icon, "aria-hidden": "true" }), s.label + " failures"]),
        el("div", { class: "tile-value", text: String(bySev[s.id]) }),
        el("div", { class: "tile-sub", text: state.severity === s.id ? "click to clear" : "click to filter" })]);
      row.appendChild(clickable(tile, function () { toggle("severity", s.id); }, "Filter to " + s.label + " failures"));
    });
    ui.canvas.appendChild(row);
  }
  function legend() {
    ui.canvas.appendChild(el("div", { class: "rules-legend span-12", "aria-label": "Severity legend" }, SEVS.map(function (s) {
      return el("button", { type: "button", class: "legend-item", title: "Filter to " + s.label, onclick: function () { toggle("severity", s.id); } },
        [el("span", { class: "legend-swatch sev-" + s.id, "aria-hidden": "true" }), el("span", { class: "bar-icon sev-" + s.id, text: s.icon, "aria-hidden": "true" }), s.label]);
    })));
  }

  // ---- pages
  function pageOverview() {
    kpis();
    legend();
    dimensionBars(visual("Failures by category", { span: 4, data: function () { return failing(scoped(["category"])); } }), "category", cap);
    dimensionBars(visual("Failures by table", { span: 4, data: function () { return failing(scoped(["table"])); } }), "table", tableLabel);
    passRate(visual("Pass rate by category", { span: 4, data: function () { return scoped(["category"]); } }));
    var m = visual("Failures by table and category", { span: 8, sub: "Click a cell, row or column to filter. Open the Matrix page for the failing objects.",
                                                       data: matrixRows });
    matrix(m, true);
    m.appendChild(el("p", { class: "rpt-more" }, [el("button", { type: "button", class: "rules-chip", text: "Open the Matrix page →",
      onclick: function () { setView("matrix"); } })]));
    ruleBars(visual("Most-failed rules", { span: 4, sub: "Top 5. Click a rule to filter.", data: function () { return failing(scoped(["rule"])); } }), 5);
  }
  function pageMatrix() {
    var m = visual("Failures by table and category", { span: 7, cls: "rpt-tall",
      sub: "Click a cell to select that table and category, or a heading to select a whole row or column. Hover a cell for its severity split.",
      data: matrixRows });
    matrix(m, false);
    details(visual("Failing objects", { span: 5, cls: "rpt-details", sub: "Click + to add an item to your housekeeping list.", data: function () { return failing(scoped()); } }),
            "Select a cell, row or column in the matrix to narrow this list.");
  }
  function pageRules() {
    ruleBars(visual("Most-failed rules", { span: 7, sub: "Every rule with at least one failure. Click a rule to select it.",
                                           data: function () { return failing(scoped(["rule"])); } }));
    details(visual("Failing objects", { span: 5, cls: "rpt-details", sub: "Click + to add an item to your housekeeping list.", data: function () { return failing(scoped()); } }),
            "Click a rule on the left to list only its failing objects.");
    workBars(visual("Housekeeping status", { span: 4, sub: "Where the failing checks stand. Click a bar to filter.",
                                             data: function () { return failing(scoped(["work"])); } }));
    passRate(visual("Pass rate by category", { span: 4, data: function () { return scoped(["category"]); } }));
    sourceBars(visual("Failures by source", { span: 4, sub: "Best Practice Analyzer rules against this project's own rules.",
                                              data: function () { return failing(scoped(["source"])); } }));
  }
  function workBars(host) {
    clear(host);
    var g = group(failing(scoped(["work"])), workOf), max = 1;
    WORK.forEach(function (w) { max = Math.max(max, (g[w.id] || []).length); });
    WORK.forEach(function (w) {
      var n = (g[w.id] || []).length, tip = w.label + ": " + plural(n, "failing check");
      var row = el("div", { class: "bar-row sbar-row" + (state.work && state.work !== w.id ? " is-dim" : "") + (state.work === w.id ? " is-on" : ""), title: tip }, [
        el("div", { class: "bar-label" }, [el("span", { class: "hk-tag-dot work-" + w.id, "aria-hidden": "true", text: w.id === "done" ? "\u2713" : "" }), " " + w.label]),
        el("div", { class: "bar-track" }, [el("div", { class: "bar-fill work-fill-" + w.id, style: "width:" + (100 * n / max) + "%" })]),
        el("div", { class: "bar-value", text: String(n) })]);
      host.appendChild(clickable(row, function () { toggle("work", w.id); }, tip));
    });
  }
  function pageTables() {
    var rows = scoped(), byRule = group(rows, "rule"), byTable = group(rows, "table"), c = sevCounts(rows);
    ui.canvas.appendChild(el("p", { class: "rpt-summary span-12",
      text: rows.length + " checks in scope: " + c.total + " failing (" + sevSummary(c) + "), " + (rows.length - c.total) + " passing." }));

    var clean = 0;
    var ruleRows = Object.keys(byRule).map(function (id) {
      var rule = ruleById[id] || {}, fail = failing(byRule[id]);
      return { id: id, _tie: ruleText(id), text: ruleText(id), category: rule.category || "", severity: rule.severity,
               sev: SEV_ORDER[rule.severity], source: rule.bpaId ? "a" : "z", bpaId: rule.bpaId,
               fail: fail.length, pass: byRule[id].length - fail.length, fails: fail };
    }).filter(function (r) { if (!r.fail) clean++; return showPassing || r.fail; });
    var byRuleHost = visual("By rule", { span: 12, sub: "Click ▸ to list a rule's failing objects.", data: function () { return failing(scoped()); } });
    sortable(byRuleHost, "rules", [
      { key: "", label: "", cls: "expand-col", cell: function (r) {
          if (!r.fail) return "";
          return el("button", { type: "button", class: "expand-btn", "aria-expanded": expanded[r.id] ? "true" : "false",
            "aria-label": (expanded[r.id] ? "Hide" : "Show") + " failing objects for: " + r.text, text: expanded[r.id] ? "▾" : "▸",
            onclick: function () { expanded[r.id] = !expanded[r.id]; render(); } }); } },
      { key: "text", label: "Rule", cell: function (r) {
          return el("span", {}, [el("strong", { class: "rule-name", text: ruleName(r.id) }), el("br"), el("span", { class: "rule-desc", text: r.text })]); } },
      { key: "category", label: "Category", cell: function (r) { return r.category; } },
      { key: "sev", label: "Severity", cell: function (r) { return sevChip(r.severity); } },
      { key: "source", label: "Source", cell: function (r) { return r.bpaId ? el("span", { text: "BPA", title: "Best Practice Analyzer rule " + r.bpaId }) : "Project"; } },
      { key: "fail", label: "Failing", num: true, cell: function (r) { return r.fail; } },
      { key: "pass", label: "Passing", num: true, cell: function (r) { return r.pass; } }
    ], ruleRows, { height: "26rem", empty: clean ? "No rules are failing for these filters." : "No rules match the filters.", detail: function (r, span) {
      if (!expanded[r.id] || !r.fail) return null;
      var rule = ruleById[r.id] || {};
      return el("tr", { class: "detail-row" }, [el("td", {}), el("td", { colspan: String(span - 1) }, [
        el("div", { class: "fail-list-title" }, [plural(r.fail, "failing object") + " ", addAllButton(r.fails)]),
        rule.fix ? el("p", { class: "hk-fix" }, [el("span", { class: "hk-fix-label", text: "How to fix " }), rule.fix]) : null,
        el("ul", { class: "fail-list hk-list" }, r.fails.map(function (f) { return el("li", {}, [addButton(f), objectLink(f), statusTag(f)]); }))])]);
    } });
    if (clean) {
      byRuleHost.appendChild(el("p", { class: "rpt-more" }, [el("button", { type: "button", class: "rules-chip",
        text: showPassing ? "Hide rules with no failures" : "Show " + plural(clean, "rule") + " with no failures",
        onclick: function () { showPassing = !showPassing; render(); } })]));
    }

    sortable(visual("By table", { span: 12, data: function () { return failing(scoped()); } }), "tables", [
      { key: "label", label: "Table", cell: function (r) { return tableCell(r.table); } },
      { key: "error", label: "Error", num: true, cell: function (r) { return r.error; } },
      { key: "warning", label: "Warning", num: true, cell: function (r) { return r.warning; } },
      { key: "info", label: "Info", num: true, cell: function (r) { return r.info; } },
      { key: "fail", label: "Failing", num: true, cell: function (r) { return r.fail; } },
      { key: "pass", label: "Passing", num: true, cell: function (r) { return r.pass; } },
      { key: "", label: "", cell: function (r) {
          return el("button", { type: "button", class: "rules-chip", text: state.table === r.table ? "Clear" : "Filter",
            "aria-label": (state.table === r.table ? "Clear the filter on " : "Filter to ") + tableLabel(r.table),
            onclick: function () { toggle("table", r.table); } }); } }
    ], Object.keys(byTable).map(function (t) {
      var k = sevCounts(byTable[t]);
      return { table: t, _tie: t, label: tableLabel(t), error: k.error, warning: k.warning, info: k.info, fail: k.total, pass: byTable[t].length - k.total };
    }), { height: "26rem", empty: "No tables match the filters." });

    var q = (state.q || "").toLowerCase();
    var list = rows.filter(function (r) {
      if (state.status !== "all" && r.status !== state.status) return false;
      return !q || (r.object + " " + r.table + " " + ruleText(r.rule) + " " + r.category).toLowerCase().indexOf(q) !== -1;
    });
    var all = visual("All results (" + list.length + ")", { span: 12 });
    var status = el("select", { "aria-label": "Status" }, ["fail", "pass", "all"].map(function (v) {
      return el("option", { value: v, text: valueLabel("status", v), selected: state.status === v ? "" : null });
    }));
    status.addEventListener("change", function () { setFilter("status", status.value === "fail" ? "" : status.value); });
    var search = el("input", { type: "search", class: "doc-filter", placeholder: "Object, table or rule", value: state.q || "", "aria-label": "Search results" });
    search.addEventListener("input", function () { state.q = search.value.trim(); if (!state.q) delete state.q;
      history.replaceState(null, "", address()); renderAll(list.length); });
    var csv = el("button", { type: "button", class: "rpt-data-btn", text: "Download CSV", onclick: function () {
      downloadCsv(currentAll(), "rule-results.csv"); } });
    all.appendChild(el("div", { class: "rpt-toolbar" }, [el("label", {}, ["Status ", status]), el("label", {}, ["Search ", search]), csv]));
    var allHost = el("div");
    all.appendChild(allHost);

    function currentAll() {
      var qq = (state.q || "").toLowerCase();
      return rows.filter(function (r) {
        if (state.status !== "all" && r.status !== state.status) return false;
        return !qq || (r.object + " " + r.table + " " + ruleText(r.rule) + " " + r.category).toLowerCase().indexOf(qq) !== -1;
      });
    }
    function renderAll() {
      var items = currentAll();
      all.parentNode.querySelector("h3").textContent = "All results (" + items.length + ")";
      resultsTable(allHost, "all", items, "34rem", "Nothing matches the filters.");
    }
    renderAll();
  }

  // ---- tables
  function resultsTable(host, id, rows, height, empty) {
    sortable(host, id, [
      { key: "", label: "", cls: "expand-col", cell: function (x) { return addButton(x.r) || ""; } },
      { key: "severity", label: "Severity", cell: function (x) { return sevChip(x.r.severity); } },
      { key: "category", label: "Category", cell: function (x) { return x.category; } },
      { key: "table", label: "Table", cell: function (x) { return tableCell(x.r.table); } },
      { key: "object", label: "Object", cell: function (x) {
          var a = x.r.link ? el("a", { href: x.r.link, text: x.object }) : el("span", { text: x.object }), b = statusTag(x.r);
          return b ? el("span", {}, [a, " ", b]) : a; } },
      { key: "type", label: "Type", cell: function (x) { return cap(x.type); } },
      { key: "rule", label: "Rule", cell: function (x) { return x.rule; } },
      { key: "status", label: "Status", cell: function (x) { return x.status === "fail" ? "Fail" : "Pass"; } }
    ], rows.map(function (r) {
      return { r: r, _tie: r.table + r.object + r.rule, severity: SEV_ORDER[r.severity], category: r.category, table: tableLabel(r.table),
               object: r.object, type: r.type, rule: ruleText(r.rule), status: r.status };
    }), { height: height, empty: empty });
  }

  // Sortable table in a scrolling panel with a sticky header. columns: [{key, label, num, cell(row)}]
  function sortable(host, id, columns, rows, opts) {
    var s = sorts[id];
    rows.sort(function (a, b) {
      var x = a[s.key], y = b[s.key];
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x === undefined ? "" : x).localeCompare(String(y === undefined ? "" : y));
      return s.dir * d || String(a._tie).localeCompare(String(b._tie));
    });
    var prev = host.querySelector(":scope > .rpt-scroll");
    if (prev) prev.remove();
    var prevEmpty = host.querySelector(":scope > .dash-empty");
    if (prevEmpty) prevEmpty.remove();
    if (!rows.length) { host.insertBefore(el("p", { class: "dash-empty", text: opts.empty }), host.querySelector(":scope > .rpt-more")); return; }
    var head = el("tr", {}, columns.map(function (c) {
      var th = el("th", { scope: "col", class: (c.num ? "num " : "") + (c.cls || ""), "aria-sort": c.key && s.key === c.key ? (s.dir > 0 ? "ascending" : "descending") : null });
      if (!c.key) { if (c.label) th.textContent = c.label; return th; }
      th.appendChild(el("button", { type: "button", class: "sort-btn", onclick: function () {
        sorts[id] = { key: c.key, dir: s.key === c.key ? -s.dir : (c.num ? -1 : 1) };
        if (id === "drawer") renderDrawer(); else render();
      } }, [c.label + " ", el("span", { class: "sort-mark", "aria-hidden": "true", text: s.key === c.key ? (s.dir > 0 ? "▲" : "▼") : "⇅" })]));
      return th;
    }));
    var body = el("tbody");
    rows.forEach(function (r) {
      body.appendChild(el("tr", {}, columns.map(function (c) {
        var v = c.cell(r);
        return el("td", { class: (c.num ? "num " : "") + (c.cls || "") }, [typeof v === "number" ? String(v) : v]);
      })));
      if (opts.detail) { var d = opts.detail(r, columns.length); if (d) body.appendChild(d); }
    });
    var panel = el("div", { class: "rpt-scroll", style: "max-height:" + (opts.height || "30rem"), tabindex: "0",
                            "aria-label": "Scrollable table, " + plural(rows.length, "row") },
      [el("table", { class: "rpt-table" }, [el("thead", {}, [head]), body])]);
    host.insertBefore(panel, host.querySelector(":scope > .rpt-more"));
  }

  // ---- Show data drawer
  function openDrawer(title, rows, opener) {
    drawer = { mode: "data", title: title, rows: rows, opener: opener };
    sorts.drawer = { key: "severity", dir: 1 };
    ui.drawerBackdrop.hidden = false;
    ui.drawer.hidden = false;
    document.body.classList.add("rpt-drawer-open");
    renderDrawer();
    ui.drawer.querySelector(".rpt-drawer-close").focus();
  }
  function renderDrawer() {
    if (drawer.mode === "list") { renderList(); return; }
    clear(ui.drawer);
    ui.drawer.classList.remove("is-list");
    var c = sevCounts(drawer.rows);
    ui.drawer.appendChild(el("div", { class: "rpt-drawer-head" }, [
      el("div", {}, [el("h2", { id: "rpt-drawer-title", text: drawer.title }),
        el("p", { class: "rpt-sub", text: plural(drawer.rows.length, "row") + ": " + c.total + " failing (" + sevSummary(c) + ")" +
          (GLOBAL_KEYS.some(function (k) { return state[k]; }) ? ", with the report filters applied" : "") })]),
      el("div", { class: "rpt-drawer-actions" }, [
        el("button", { type: "button", class: "rpt-data-btn", text: "Download CSV", onclick: function () {
          downloadCsv(drawer.rows, drawer.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv"); } }),
        el("button", { type: "button", class: "rpt-drawer-close", "aria-label": "Close", text: "×", onclick: closeDrawer })])]));
    var host = el("div", { class: "rpt-drawer-body" });
    ui.drawer.appendChild(host);
    resultsTable(host, "drawer", drawer.rows.slice(), "none", "No rows.");
  }
  function closeDrawer() {
    if (!drawer) return;
    var opener = drawer.opener;
    drawer = null;
    ui.drawer.hidden = true;
    ui.drawerBackdrop.hidden = true;
    document.body.classList.remove("rpt-drawer-open");
    if (opener && document.body.contains(opener)) opener.focus();
  }

  function downloadCsv(rows, name) {
    function cell(v) {
      v = String(v === null || v === undefined ? "" : v);
      if (/^[=+\-@]/.test(v)) v = "'" + v;   // stop spreadsheets reading a value as a formula
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var lines = [["severity", "category", "table", "object", "type", "rule_id", "rule", "bpa_id", "status", "link"].join(",")];
    rows.forEach(function (r) {
      lines.push([r.severity, r.category, tableLabel(r.table), r.object, r.type, r.rule, ruleText(r.rule),
                  (ruleById[r.rule] || {}).bpaId || "", r.status, r.link].map(cell).join(","));
    });
    var a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- housekeeping list
  function hkKey(r) { return r.table + "|" + r.object + "|" + r.rule; }
  function loadBasket() {
    try {
      var saved = JSON.parse(localStorage.getItem(HK_KEY) || "{}");
      var kept = (saved.items || []).filter(function (k) { return failByKey[k]; });   // drop items that now pass
      basket = kept.filter(function (k) { return !isLocked(failByKey[k]); });          // and items someone has raised
      droppedRaised = kept.length - basket.length;
      if (droppedRaised) saveBasket();
      basketMeta = saved.meta || {};
    } catch (e) { basket = []; basketMeta = {}; }
  }
  function saveBasket() {
    try { localStorage.setItem(HK_KEY, JSON.stringify({ items: basket, meta: basketMeta })); } catch (e) { /* private mode: list lasts this visit */ }
  }
  function inBasket(k) { return basket.indexOf(k) !== -1; }
  function setInBasket(keys, on) {
    var changed = 0;
    keys.forEach(function (k) {
      var i = basket.indexOf(k);
      if (on && i === -1) { basket.push(k); changed++; }
      if (!on && i !== -1) { basket.splice(i, 1); changed++; }
    });
    if (!changed) return;
    if (!basket.length) basketMeta = {};
    saveBasket();
    syncAddButtons();
    updatePill(on);
    if (drawer && drawer.mode === "list") renderDrawer();
  }
  // The issue an item was raised in, preferring one where someone is working on it.
  function raisedHit(r) {
    var hits = raised[hkKey(r)];
    if (!hits) return null;
    return hits.filter(function (h) { return h.work === "in-progress" && !h.done; })[0] || hits[0];
  }
  function workOf(r) {
    if (r.status !== "fail") return "";
    var h = raisedHit(r);
    return !h ? "none" : h.done ? "done" : h.work === "in-progress" ? "in-progress" : "raised";
  }
  function workLabel(id) { return (WORK.filter(function (w) { return w.id === id; })[0] || {}).label || id; }
  function isLocked(r) { return !!raisedHit(r); }
  function statusTag(r) {
    var h = raisedHit(r);
    if (!h) return null;
    var w = workOf(r), who = h.assignees.length ? "@" + h.assignees.join(", @") : "";
    var tip = workLabel(w) + " in issue #" + h.number +
      (w === "in-progress" ? (who ? ", assigned to " + who : "") + (h.branches.length ? ", branch " + h.branches.join(", ") : "") +
                             (!who && !h.branches.length ? " (labelled in-progress)" : "") :
       w === "raised" ? ". Nobody has picked it up yet: assign yourself or use Create a branch on the issue." :
       ". Ticked on the issue; it clears from the report once the fix reaches main.");
    return el("a", { class: "hk-tag is-" + w, href: h.url, title: tip }, [
      el("span", { class: "hk-tag-dot", "aria-hidden": "true", text: w === "done" ? "\u2713" : "" }),
      el("span", { text: workLabel(w) }),
      w === "in-progress" && who ? el("span", { class: "hk-tag-who", text: who }) : null,
      el("span", { class: "hk-tag-num", text: "#" + h.number })]);
  }
  // The + / ✓ toggle for one failing check.
  function addButton(r) {
    if (r.status !== "fail" || isLocked(r)) return null;   // raised items are locked; their status tag shows instead
    var k = hkKey(r);
    var b = el("button", { type: "button", class: "hk-add", "data-hk": k });
    b.addEventListener("click", function (e) { e.stopPropagation(); setInBasket([k], !inBasket(k)); });
    paintAdd(b);
    return b;
  }
  function paintAdd(b) {
    var k = b.getAttribute("data-hk"), on = inBasket(k), r = failByKey[k];
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "✓" : "+";
    var what = r ? objectText(r) : "this item";
    b.setAttribute("aria-label", (on ? "Remove " : "Add ") + what + (on ? " from" : " to") + " the housekeeping list");
    b.title = on ? "In your housekeeping list. Click to remove." : "Add to your housekeeping list";
  }
  function syncAddButtons() {
    document.querySelectorAll(".hk-add").forEach(paintAdd);
    document.querySelectorAll(".hk-add-all").forEach(function (b) { paintAddAll(b, b._keys); });
  }
  function addAllButton(rows) {
    var keys = rows.filter(function (r) { return r.status === "fail" && !isLocked(r); }).map(hkKey);
    var b = el("button", { type: "button", class: "hk-add-all" });
    b._keys = keys;
    b.addEventListener("click", function () {
      setInBasket(keys, !keys.every(inBasket));
    });
    paintAddAll(b, keys);
    return b;
  }
  function paintAddAll(b, keys) {
    if (!keys.length) {
      b.disabled = true; b.classList.add("is-on");
      b.textContent = "All raised"; b.title = "Every item under this rule is already in a housekeeping issue";
      return;
    }
    var all = keys.every(inBasket);
    b.classList.toggle("is-on", all);
    b.textContent = all ? "✓ All added" : "+ Add all (" + keys.length + ")";
    b.title = all ? "Remove these from your housekeeping list" : "Add every item under this rule to your housekeeping list";
  }

  function buildHousekeeping() {
    ui.pill = el("button", { type: "button", class: "hk-pill", hidden: "", "aria-haspopup": "dialog" });
    ui.pill.addEventListener("click", function () { openList(ui.pill); });
    ui.pill.addEventListener("animationend", function () { ui.pill.classList.remove("bump"); });
    ui.toast = el("div", { class: "hk-toast", role: "status", "aria-live": "polite", hidden: "" });
    document.body.appendChild(ui.pill);
    document.body.appendChild(ui.toast);
    updatePill(false);
    if (droppedRaised) toast(plural(droppedRaised, "item") + " in your housekeeping list " + (droppedRaised === 1 ? "has" : "have") +
                             " since been raised in an issue, so " + (droppedRaised === 1 ? "it was" : "they were") + " taken off your list.");
  }
  function updatePill(bump) {
    ui.pill.hidden = !basket.length;
    clear(ui.pill);
    ui.pill.appendChild(el("span", { class: "hk-pill-icon", "aria-hidden": "true", text: "🧹" }));
    ui.pill.appendChild(el("span", { text: "Housekeeping list" }));
    ui.pill.appendChild(el("span", { class: "hk-pill-count", text: String(basket.length) }));
    ui.pill.setAttribute("aria-label", "Open your housekeeping list, " + plural(basket.length, "item"));
    if (bump) { ui.pill.classList.remove("bump"); void ui.pill.offsetWidth; ui.pill.classList.add("bump"); }
  }
  var toastTimer;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 6000);
  }

  function basketRows() { return basket.map(function (k) { return failByKey[k]; }).filter(Boolean); }
  function defaultTitle(rows) {
    var tables = uniq(rows.map(function (r) { return tableLabel(r.table); }));
    var where = tables.slice(0, 3).join(", ") + (tables.length > 3 ? " and " + (tables.length - 3) + " more" : "");
    return "Housekeeping: " + plural(rows.length, "fix") + " across " + where;
  }
  // One short checklist line per item, so even long lists fit in GitHub's "new issue" link. The
  // housekeeping-details workflow adds each item's full description (rule, what breaks it, how to fix) after Submit.
  function itemsMarkdown(rows) {
    return rows.slice().sort(function (a, b) {
      return SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || ruleName(a.rule).localeCompare(ruleName(b.rule)) ||
             sortTables(a.table, b.table) || a.object.localeCompare(b.object);
    }).map(function (r) {
      return "- [ ] " + tableLabel(r.table) + " · " + r.object + " — " + ruleName(r.rule) + " (rule: " + r.rule + ")";
    }).join("\n");
  }
  function issueUrl(title, items, notes) {
    var p = new URLSearchParams();
    p.set("template", "housekeeping.yml");
    p.set("title", title);
    p.set("items", items);
    if (notes) p.set("notes", notes);
    return "https://github.com/" + model.repo + "/issues/new?" + p.toString();
  }
  // Copy inside the click itself, so the browser treats it as user-initiated. Returns true when it worked.
  function copySync(text) {
    var active = document.activeElement, ta = el("textarea", { style: "position:fixed;top:0;left:0;opacity:0", "aria-hidden": "true" });
    ta.value = text; document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    if (active && active.focus) active.focus();
    return ok;
  }
  function copyText(text) {
    if (copySync(text)) return Promise.resolve();
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error("copy blocked"));
  }
  function createIssue() {
    var rows = basketRows(), title = (basketMeta.title || "").trim() || defaultTitle(rows);
    var items = itemsMarkdown(rows), notes = (basketMeta.notes || "").trim();
    var url = issueUrl(title, items, notes);
    if (url.length <= 7000) {
      window.open(url, "_blank", "noopener");
      toast("GitHub opened in a new tab with the issue filled in. Press Submit there.");
      return;
    }
    // Too long for a link: copy the list, and open GitHub straight away (opening later would be popup-blocked).
    var copied = copySync(items);
    window.open(issueUrl(title, "Paste the list from your clipboard here (it was too long to send in the link).", notes), "_blank", "noopener");
    if (copied) {
      toast("The list was too long for a link, so it is on your clipboard. Paste it into Items on GitHub, then press Submit.");
    } else {
      toast("The list was too long for a link and your browser blocked the clipboard. Use Copy as Markdown here, then paste it into Items on GitHub.");
    }
  }

  function openList(opener) {
    drawer = { mode: "list", opener: opener };
    ui.drawerBackdrop.hidden = false;
    ui.drawer.hidden = false;
    document.body.classList.add("rpt-drawer-open");
    renderDrawer();
    ui.drawer.querySelector(".rpt-drawer-close").focus();
  }
  function renderList() {
    clear(ui.drawer);
    ui.drawer.classList.add("is-list");
    var rows = basketRows(), tables = uniq(rows.map(function (r) { return tableLabel(r.table); }));
    ui.drawer.appendChild(el("div", { class: "rpt-drawer-head hk-head" }, [
      el("div", {}, [el("h2", { id: "rpt-drawer-title" }, [el("span", { "aria-hidden": "true", text: "🧹 " }), "Housekeeping list"]),
        el("p", { class: "rpt-sub", text: rows.length ? plural(rows.length, "item") + " across " + plural(tables.length, "table") + ". Kept in this browser until you raise it."
                                                       : "Nothing picked yet." })]),
      el("button", { type: "button", class: "rpt-drawer-close", "aria-label": "Close", text: "×", onclick: closeDrawer })]));
    var body = el("div", { class: "rpt-drawer-body hk-body" });
    ui.drawer.appendChild(body);
    if (!rows.length) {
      body.appendChild(el("div", { class: "hk-empty" }, [
        el("p", { class: "hk-empty-icon", "aria-hidden": "true", text: "🧹" }),
        el("p", { text: "Click + next to a failing object, or Add all on a rule, to collect clean-up work. Then raise it as one GitHub issue." })]));
      return;
    }

    var titleIn = el("input", { type: "text", class: "hk-input", id: "hk-title", value: basketMeta.title || defaultTitle(rows) });
    titleIn.addEventListener("input", function () { basketMeta.title = titleIn.value; saveBasket(); });
    var notesIn = el("textarea", { class: "hk-input", id: "hk-notes", rows: "2", placeholder: "Optional: context for whoever picks this up" });
    notesIn.value = basketMeta.notes || "";
    notesIn.addEventListener("input", function () { basketMeta.notes = notesIn.value; saveBasket(); });
    body.appendChild(el("div", { class: "hk-fields" }, [
      el("label", { for: "hk-title", text: "Issue title" }), titleIn,
      el("label", { for: "hk-notes", text: "Notes" }), notesIn]));

    var list = el("div", { class: "hk-groups" });
    var g = group(rows, "rule");
    Object.keys(g).sort(function (a, b) {
      return SEV_ORDER[g[a][0].severity] - SEV_ORDER[g[b][0].severity] || ruleText(a).localeCompare(ruleText(b));
    }).forEach(function (id) {
      var rule = ruleById[id] || {};
      list.appendChild(el("section", { class: "hk-group sev-edge-" + rule.severity }, [
        el("div", { class: "hk-group-head" }, [sevChip(rule.severity), el("strong", { text: ruleName(id) }), el("span", { class: "rpt-count", text: String(g[id].length) })]),
        el("p", { class: "hk-rule-desc", text: ruleText(id) }),
        rule.fix ? el("p", { class: "hk-fix" }, [el("span", { class: "hk-fix-label", text: "How to fix " }), rule.fix]) : null,
        el("ul", { class: "hk-items" }, g[id].map(function (r) {
          return el("li", {}, [objectLink(r), statusTag(r),
            el("button", { type: "button", class: "hk-remove", "aria-label": "Remove " + objectText(r), title: "Remove", text: "×",
                           onclick: function () { setInBasket([hkKey(r)], false); } })]);
        }))]));
    });
    body.appendChild(list);

    var create = el("button", { type: "button", class: "hk-primary", disabled: model.repo ? null : "" },
      [el("span", { "aria-hidden": "true", text: "↗ " }), "Create issue on GitHub"]);
    create.addEventListener("click", createIssue);
    var copy = el("button", { type: "button", class: "rpt-data-btn", text: "Copy as Markdown", onclick: function () {
      copyText(itemsMarkdown(basketRows())).then(function () { toast("Copied. Paste it into any GitHub issue or comment."); },
                                                 function () { toast("Your browser blocked the clipboard."); });
    } });
    var clearBtn = el("button", { type: "button", class: "rpt-data-btn hk-clear", text: "Clear list", onclick: function () {
      if (confirm("Remove all " + plural(basket.length, "item") + " from your housekeeping list?")) setInBasket(basket.slice(), false);
    } });
    ui.drawer.appendChild(el("div", { class: "hk-foot" }, [
      el("p", { class: "hk-how" }, model.repo ? [
        "Opens a pre-filled ", el("strong", { text: "Housekeeping" }), " issue on GitHub. Press ", el("strong", { text: "Submit" }),
        " there. A description of every item (the rule, what is breaking it and how to fix it) is added to the issue automatically. Then use ",
        el("strong", { text: "Development → Create a branch" }), " on the issue to start the work."]
        : ["This site does not know its GitHub repository, so it can't open an issue. Use Copy as Markdown instead."]),
      el("div", { class: "hk-actions" }, [create, copy, clearBtn])]));
  }

  // ---- render
  function render() {
    syncHeader();
    clear(ui.canvas);
    ({ overview: pageOverview, matrix: pageMatrix, rules: pageRules, tables: pageTables })[view]();
  }

  function init() {
    app = document.getElementById("rules-app");
    if (!app) return;
    root = app.getAttribute("data-root") || "";
    Promise.all(["results", "model"].map(function (n) {
      return fetch(root + "data/" + n + ".json").then(function (r) { if (!r.ok) throw new Error(n + ".json " + r.status); return r.json(); });
    }).concat([fetch(root + "data/issues.json").then(function (r) { return r.ok ? r.json() : { issues: [] }; })
      .catch(function () { return { issues: [] }; })])).then(function (d) {
      results = d[0]; model = d[1]; issues = d[2] || { issues: [] };
      results.rules.forEach(function (r) { ruleById[r.id] = r; });
      results.results.forEach(function (r) { if (r.status === "fail") failByKey[hkKey(r)] = r; });
      (issues.issues || []).forEach(function (i) {
        if (i.state !== "open") return;
        (i.items || []).forEach(function (it) {
          var k = it.table + "|" + it.object + "|" + it.rule;
          (raised[k] = raised[k] || []).push({ number: i.number, url: i.url, done: it.done, work: i.work || "raised",
                                              assignees: i.assignees || [], branches: i.branches || [] });
        });
      });
      loadBasket();
      readState(); buildShell(); buildHousekeeping(); render();
    }).catch(function (e) {
      clear(app);
      app.appendChild(el("p", { class: "dash-empty", text: "Could not load the rule results: " + e.message }));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
