// Best practice report (/rules/): four tabs (Summary, By table, By rule, All failures) over docs/data/results.json that share one set of
// filters. Filters and the active tab live in the page address (?view=rules&category=Formatting), so views can be
// bookmarked and the back button moves between tabs. results.json holds the failing checks, plus pass and fail
// counts per rule and table for the pass rates. Shared parts come from ui.js; the housekeeping list is housekeeping.js.
(function () {
  var M = window.ModelDocs, el = M.el, clear = M.clear, cap = M.cap, uniq = M.uniq, plural = M.plural;
  var SEVS = M.SEVS, SEV_ORDER = M.SEV_ORDER, tableLabel = M.tableLabel, sevChip = M.sevChip;

  var VIEWS = [{ id: "summary", label: "Summary" }, { id: "table", label: "By table" }, { id: "rule", label: "By rule" },
               { id: "failures", label: "All failures" }];
  // addresses from earlier versions of the report keep working
  var OLD_VIEWS = { overview: "summary", matrix: "table", rules: "rule", tables: "rule", results: "failures" };
  var FILTERS = ["category", "severity", "table", "work", "rule"];
  var STATE_KEYS = FILTERS.concat(["q"]);   // q only searches the Results table
  var LABEL = { category: "Category", severity: "Severity", table: "Table", work: "Fix status", rule: "Rule", q: "Search" };
  // Where a failing check stands in the housekeeping workflow (worked out in tools/housekeeping.py).
  var WORK = [{ id: "none", label: "Not raised" }, { id: "raised", label: "Raised" },
              { id: "in-progress", label: "In progress" }, { id: "done", label: "Done" }];

  var app, root, results, rows, ruleById = {}, state = {}, view = "summary", ui = {}, hk, drawer = null;
  var sorts = { rules: { key: "fail", dir: -1 }, results: { key: "severity", dir: 1 }, drawer: { key: "severity", dir: 1 } };
  var showPassing = false;

  // ---- labels
  function ruleText(id) { return ruleById[id] ? ruleById[id].description : id; }
  function ruleName(id) { return ruleById[id] ? ruleById[id].name || ruleById[id].description : id; }
  function workLabel(id) { return (WORK.filter(function (w) { return w.id === id; })[0] || {}).label || id; }
  function valueLabel(key, v) {
    if (key === "table") return tableLabel(v);
    if (key === "work") return workLabel(v);
    if (key === "rule") return ruleName(v);
    if (key === "q") return "“" + v + "”";
    return cap(v);
  }
  function objectText(r) {
    return r.table === "(model)" || r.type === "table" || r.type === "relationship" ? r.object : r.table + "[" + r.object + "]";
  }
  function objectLink(r) { return r.link ? el("a", { href: r.link, text: objectText(r) }) : el("span", { text: objectText(r) }); }
  function tableCell(t) {
    return t === "(model)" ? el("span", { text: "Whole model" }) : el("a", { href: root + "documentation/dictionary/" + t + "/", text: t });
  }
  function sortTables(a, b) { return (a === "(model)") - (b === "(model)") || a.localeCompare(b); }
  function sevSummary(c) { return c.error + " error, " + c.warning + " warning, " + c.info + " info"; }

  // ---- state <-> address
  function readState() {
    var p = new URLSearchParams(location.search), v = p.get("view");
    state = {};
    STATE_KEYS.forEach(function (k) { if (p.get(k)) state[k] = p.get(k); });
    v = OLD_VIEWS[v] || v;
    view = VIEWS.some(function (x) { return x.id === v; }) ? v : "summary";
  }
  function address() {
    var p = new URLSearchParams();
    if (view !== "summary") p.set("view", view);
    STATE_KEYS.forEach(function (k) { if (state[k]) p.set(k, state[k]); });
    var q = p.toString();
    return location.pathname + (q ? "?" + q : "");
  }
  function commit(push) { history[push ? "pushState" : "replaceState"](null, "", address()); render(); }
  function setFilter(key, value) { if (value) state[key] = value; else delete state[key]; commit(false); }
  function toggle(key, value) { setFilter(key, state[key] === value ? "" : value); }
  function setView(id) { if (id !== view) { view = id; commit(true); window.scrollTo({ top: ui.header.offsetTop - 60 }); } }

  // ---- what is in scope. `except` lists filters to ignore, so a chart can show every value of its own dimension.
  function on(key, except) { return state[key] && (except || []).indexOf(key) === -1; }
  function fails(except) {
    return rows.filter(function (r) {
      return FILTERS.every(function (k) { return !on(k, except) || (k === "work" ? r.work.status : r[k]) === state[k]; });
    });
  }
  // Pass and fail counts for the checks in scope. Fix status only exists for failures, so with that filter on
  // there is no meaningful count of passes and this returns null.
  function checks(except, each) {
    if (on("work", except)) return null;
    var total = { pass: 0, fail: 0 };
    results.counts.forEach(function (c) {
      var rule = ruleById[c.rule];
      if ((on("category", except) && rule.category !== state.category) || (on("severity", except) && rule.severity !== state.severity) ||
          (on("rule", except) && c.rule !== state.rule) || (on("table", except) && c.table !== state.table)) return;
      total.pass += c.pass; total.fail += c.fail;
      if (each) each(c, rule);
    });
    return total;
  }
  function pct(pass, total) { return total ? Math.round(1000 * pass / total) / 10 + "%" : "n/a"; }
  function sevCounts(list) {
    var c = { error: 0, warning: 0, info: 0, total: list.length };
    list.forEach(function (r) { c[r.severity]++; });
    return c;
  }
  function group(list, key) {
    var g = {};
    list.forEach(function (r) { var k = typeof key === "function" ? key(r) : r[key]; (g[k] = g[k] || []).push(r); });
    return g;
  }
  function segments(c) { return SEVS.map(function (s) { return { cls: "sev-" + s.id, value: c[s.id] }; }); }

  // ---- report shell
  function buildShell() {
    clear(app);
    document.body.classList.add("report-mode");
    ui.header = el("div", { class: "rpt-header" });
    var selects = el("div", { class: "rpt-slicers", role: "group", "aria-label": "Report filters" });
    ui.selects = {};
    [["category", uniq(results.rules.map(function (r) { return r.category; })).sort()],
     ["severity", SEVS.map(function (s) { return s.id; })],
     ["table", uniq(results.counts.map(function (c) { return c.table; })).sort(sortTables)],
     ["work", WORK.map(function (w) { return w.id; })]].forEach(function (d) {
      var key = d[0], sel = el("select", { id: "rf-" + key }, [el("option", { value: "", text: "All" })]);
      d[1].forEach(function (v) { sel.appendChild(el("option", { value: v, text: valueLabel(key, v) })); });
      sel.addEventListener("change", function () { setFilter(key, sel.value); });
      ui.selects[key] = sel;
      selects.appendChild(el("label", {}, [LABEL[key], sel]));
    });
    ui.chips = el("div", { class: "rules-chips" });
    ui.header.appendChild(el("div", { class: "rpt-header-row" }, [selects]));
    ui.header.appendChild(el("div", { class: "rpt-chip-row" }, [ui.chips, el("div", { class: "rpt-stamp", text: "Model read " + results.generated })]));
    app.appendChild(ui.header);

    ui.tabs = el("div", { class: "rpt-tabs", role: "tablist", "aria-label": "Report pages" });
    ui.tabButtons = {};
    VIEWS.forEach(function (v, i) {
      var b = el("button", { type: "button", role: "tab", id: "tab-" + v.id, "aria-controls": "rpt-canvas", text: v.label,
                             onclick: function () { setView(v.id); } });
      b.addEventListener("keydown", function (e) {
        var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        var next = VIEWS[(i + step + VIEWS.length) % VIEWS.length].id;
        e.preventDefault(); setView(next); ui.tabButtons[next].focus();
      });
      ui.tabButtons[v.id] = b;
      ui.tabs.appendChild(b);
    });
    app.appendChild(ui.tabs);
    ui.canvas = el("div", { class: "rpt-canvas", id: "rpt-canvas", role: "tabpanel" });
    app.appendChild(ui.canvas);

    // One side panel, used for "Show data" and for the housekeeping list.
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
    var active = FILTERS.filter(function (k) { return state[k]; });
    if (!active.length) {
      ui.chips.appendChild(el("span", { class: "rpt-hint", text: "Click any bar, tile or matrix cell to filter every page. Click it again to clear." }));
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
      var active = v.id === view, b = ui.tabButtons[v.id];
      b.setAttribute("aria-selected", active ? "true" : "false");
      b.setAttribute("tabindex", active ? "0" : "-1");
      b.classList.toggle("is-active", active);
    });
    ui.canvas.setAttribute("aria-labelledby", "tab-" + view);
  }

  // A visual on the canvas. opts.data() returns the failing checks behind it, for the Show data button.
  function visual(title, opts) {
    if (opts.data) {
      opts.button = { label: "☷ Show data", title: "Show the rows behind this visual as a table",
                      onClick: function (btn) { showData(opts.dataTitle || title, opts.data(), btn); } };
    }
    return M.visual(ui.canvas, title, opts);
  }

  // ---- visuals
  function kpis() {
    var list = fails(), c = checks(), bySev = sevCounts(fails(["severity"]));
    var tiles = [
      { label: "Pass rate", value: c ? pct(c.pass, c.pass + c.fail) : "n/a",
        sub: c ? c.pass + " of " + (c.pass + c.fail) + " checks pass" : "not shown with a Fix status filter" },
      { label: "Checks run", value: c ? c.pass + c.fail : "n/a", sub: plural(results.rules.length, "rule") + " switched on" },
      { label: "Failing rules", value: uniq(list.map(function (r) { return r.rule; })).length, sub: plural(list.length, "failing check") }
    ].concat(SEVS.map(function (s) {
      return { label: s.label + " failures", sev: s.id, value: bySev[s.id], sub: state.severity === s.id ? "click to clear" : "click to filter",
               dim: state.severity && state.severity !== s.id, on: state.severity === s.id, tip: "Filter to " + s.label + " failures",
               onClick: function () { toggle("severity", s.id); } };
    }));
    ui.canvas.appendChild(el("div", { class: "rpt-kpis span-12" }, tiles.map(M.tile)));
  }

  function ruleBars(host, limit) {
    var g = group(fails(["rule"]), "rule");
    var items = Object.keys(g).map(function (id) {
      var c = sevCounts(g[id]);
      return { label: ruleName(id), value: c.total, segments: segments(c), dim: state.rule && state.rule !== id, on: state.rule === id,
               tip: ruleName(id) + ": " + c.total + " failing (" + sevSummary(c) + "). " + ruleText(id),
               onClick: function () { toggle("rule", id); } };
    }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
    M.bars(host, limit ? items.slice(0, limit) : items, { wide: true, empty: "No failures match the filters." });
  }
  function workBars(host) {
    var g = group(fails(["work"]), function (r) { return r.work.status; });
    M.bars(host, WORK.map(function (w) {
      var n = (g[w.id] || []).length;
      return { label: w.label, value: n, cls: "work-fill-" + w.id, tip: w.label + ": " + plural(n, "failing check"),
               icon: el("span", { class: "hk-tag-dot work-" + w.id, "aria-hidden": "true", text: w.id === "done" ? "✓" : "" }),
               dim: state.work && state.work !== w.id, on: state.work === w.id, onClick: function () { toggle("work", w.id); } };
    }));
  }
  function passRate(host) {
    var by = {};
    var any = checks(["category"], function (c, rule) {
      var b = by[rule.category] = by[rule.category] || { pass: 0, total: 0 };
      b.pass += c.pass; b.total += c.pass + c.fail;
    });
    if (!any) { clear(host); host.appendChild(el("p", { class: "dash-empty", text: "Pass rates are not shown while a Fix status filter is on." })); return; }
    M.bars(host, Object.keys(by).sort().map(function (k) {
      var rate = Math.round(1000 * by[k].pass / by[k].total) / 10;
      return { label: k, value: rate, display: rate + "%", tip: k + ": " + rate + "% pass (" + by[k].pass + " of " + by[k].total + " checks)",
               dim: state.category && state.category !== k, on: state.category === k, onClick: function () { toggle("category", k); } };
    }), { max: 100, track: true, empty: "No checks match the filters." });
  }

  // Table x category matrix of failing checks. Ignores the table and category filters so the whole grid stays visible.
  function matrixRows() { return fails(["table", "category"]); }
  function matrix(host) {
    clear(host);
    var list = matrixRows();
    var cats = uniq(results.rules.map(function (r) { return r.category; })).sort();
    var tables = uniq(results.counts.map(function (c) { return c.table; })).sort(sortTables);
    var cell = {}, rowTot = {}, colTot = {}, max = 1;
    list.forEach(function (r) {
      var k = r.table + "|" + r.category;
      var c = cell[k] = cell[k] || { error: 0, warning: 0, info: 0, total: 0 };
      c[r.severity]++; c.total++;
      rowTot[r.table] = (rowTot[r.table] || 0) + 1; colTot[r.category] = (colTot[r.category] || 0) + 1;
      if (c.total > max) max = c.total;
    });
    function head(text, fn, active, dim) {
      return el("button", { type: "button", class: "grid-head" + (active ? " is-active" : "") + (dim ? " is-dim" : ""), text: text, onclick: fn });
    }
    var rowOn = state.table && !state.category, colOn = state.category && !state.table;
    var thead = el("thead", {}, [el("tr", {}, [el("th", { class: "corner", scope: "col", text: "Table" })].concat(cats.map(function (c) {
      return el("th", { scope: "col" }, [head(c, function () { delete state.table; toggle("category", c); }, colOn && state.category === c, state.category && state.category !== c)]);
    })).concat([el("th", { scope: "col", class: "num", text: "Total" })]))]);
    var tbody = el("tbody");
    tables.forEach(function (t) {
      var tr = el("tr", {}, [el("th", { scope: "row" }, [head(tableLabel(t), function () { delete state.category; toggle("table", t); }, rowOn && state.table === t, state.table && state.table !== t)])]);
      cats.forEach(function (c) {
        var v = cell[t + "|" + c], dim = (state.table && state.table !== t) || (state.category && state.category !== c);
        if (!v) { tr.appendChild(el("td", { class: "grid-zero" + (dim ? " is-dim" : ""), text: "·" })); return; }
        var active = state.table === t && state.category === c;
        tr.appendChild(el("td", {}, [el("button", {
          type: "button", class: "grid-cell" + (active ? " is-active" : "") + (dim ? " is-dim" : ""),
          style: "background:color-mix(in srgb, var(--dash-bar) " + Math.round(12 + 48 * v.total / max) + "%, transparent)",
          title: tableLabel(t) + ", " + c + ": " + v.total + " failing (" + sevSummary(v) + ")", text: String(v.total),
          "aria-pressed": active ? "true" : "false",
          onclick: function () {
            if (active) { delete state.table; delete state.category; } else { state.table = t; state.category = c; }
            commit(false);
          } })]));
      });
      tr.appendChild(el("td", { class: "grid-total num", text: String(rowTot[t] || 0) }));
      tbody.appendChild(tr);
    });
    var foot = el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total" })].concat(cats.map(function (c) {
      return el("td", { class: "grid-total", text: String(colTot[c] || 0) });
    })).concat([el("td", { class: "grid-total num", text: String(list.length) })]))]);
    host.appendChild(el("div", { class: "rpt-matrix-wrap" }, [el("table", { class: "rpt-matrix" }, [thead, tbody, foot])]));
  }

  function failItems(list) {
    return el("ul", { class: "fail-list hk-list" }, list.map(function (r) { return el("li", {}, [hk.addButton(r), objectLink(r), hk.statusTag(r)]); }));
  }
  // Failing objects for the current selection, grouped by rule.
  function details(host) {
    clear(host);
    var list = fails(), c = sevCounts(list);
    var sel = ["table", "category", "rule"].filter(function (k) { return state[k]; }).map(function (k) { return valueLabel(k, state[k]); });
    host.appendChild(el("p", { class: "rpt-details-title" }, [
      el("strong", { text: sel.length ? sel.join(" · ") : "Everything in scope" }), el("br"),
      plural(c.total, "failing check") + (c.total ? " (" + sevSummary(c) + ")" : "")]));
    if (!sel.length) host.appendChild(el("p", { class: "rpt-hint", text: "Select a cell, row or column in the matrix, or a rule below, to narrow this list." }));
    if (!list.length) { host.appendChild(el("p", { class: "dash-empty", text: "Nothing failing here." })); return; }
    var g = group(list, "rule");
    Object.keys(g).sort(function (a, b) {
      return SEV_ORDER[g[a][0].severity] - SEV_ORDER[g[b][0].severity] || g[b].length - g[a].length || ruleName(a).localeCompare(ruleName(b));
    }).forEach(function (id) {
      host.appendChild(el("div", { class: "rpt-details-group" }, [
        el("div", { class: "rpt-details-rule", title: ruleText(id) }, [sevChip(g[id][0].severity), el("span", { text: ruleName(id) }),
          el("span", { class: "rpt-count", text: String(g[id].length) })]),
        el("div", { class: "rpt-details-actions" }, [hk.addAllButton(g[id])]),
        failItems(g[id])]));
    });
  }

  // ---- pages
  function tableBars(host) {
    var g = group(fails(["table"]), "table");
    var items = Object.keys(g).map(function (t) {
      var c = sevCounts(g[t]);
      return { label: tableLabel(t), value: c.total, segments: segments(c), dim: state.table && state.table !== t, on: state.table === t,
               tip: tableLabel(t) + ": " + c.total + " failing (" + sevSummary(c) + ")", onClick: function () { toggle("table", t); } };
    }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
    M.bars(host, items, { empty: "No failures match the filters." });
  }

  // ---- pages
  function pageSummary() {
    kpis();
    ruleBars(visual("Most-failed rules", { span: 6, sub: "Click a rule to filter every tab. By rule lists them all, with how to fix each one.",
                                           data: function () { return fails(["rule"]); } }), 8);
    tableBars(visual("Failures by table", { span: 6, sub: "Click a table to filter. By table shows them against each category.",
                                            data: function () { return fails(["table"]); } }));
    workBars(visual("Housekeeping status", { span: 6, sub: "Where the failing checks stand. Click a bar to filter.", data: function () { return fails(["work"]); } }));
    passRate(visual("Pass rate by category", { span: 6, sub: "Share of checks that pass. Click a category to filter." }));
  }

  function pageTable() {
    matrix(visual("Failures by table and category", { span: 7, cls: "rpt-tall", data: matrixRows,
      sub: "Click a cell to select that table and category, or a heading to select a whole row or column. Hover a cell for its severity split." }));
    details(visual("Failing objects", { span: 5, cls: "rpt-details", sub: "Click + to add an item to your housekeeping list.", data: function () { return fails(); } }));
  }

  // Every failing rule as one long list, most serious first, each with what it checks, how to fix it and its objects.
  function pageRule() {
    var byRule = group(fails(), "rule"), passes = {};
    results.counts.forEach(function (c) {
      var rule = ruleById[c.rule];
      if ((state.category && rule.category !== state.category) || (state.severity && rule.severity !== state.severity) ||
          (state.rule && c.rule !== state.rule) || (state.table && c.table !== state.table)) return;
      passes[c.rule] = (passes[c.rule] || 0) + c.pass;
    });
    var failing = Object.keys(byRule).sort(function (a, b) {
      return SEV_ORDER[ruleById[a].severity] - SEV_ORDER[ruleById[b].severity] || byRule[b].length - byRule[a].length ||
             ruleName(a).localeCompare(ruleName(b));
    });
    var clean = Object.keys(passes).filter(function (id) { return !byRule[id]; }).sort(function (a, b) { return ruleName(a).localeCompare(ruleName(b)); });
    var host = visual("Rules to fix (" + failing.length + ")", { data: function () { return fails(); },
      sub: "Every rule the model breaks, most serious first, with how to fix it and the objects failing it. Click + to add an object to your housekeeping list." });
    if (!failing.length) host.appendChild(el("p", { class: "dash-empty", text: "No rules are failing for these filters." }));
    failing.forEach(function (id) {
      var rule = ruleById[id], f = byRule[id];
      host.appendChild(el("section", { class: "rule-card sev-edge-" + rule.severity }, [
        el("div", { class: "rule-card-head" }, [sevChip(rule.severity), el("strong", { class: "rule-name", text: rule.name }),
          el("span", { class: "rule-card-meta", text: rule.category + " · " + (rule.bpaId ? "Best Practice Analyzer" : "Project rule") + " · " +
            plural(f.length, "failing object") + ", " + (passes[id] || 0) + " passing" })]),
        el("p", { class: "rule-desc", text: rule.description }),
        rule.fix ? el("p", { class: "hk-fix" }, [el("span", { class: "hk-fix-label", text: "How to fix " }), rule.fix]) : null,
        el("div", { class: "rpt-details-actions" }, [hk.addAllButton(f)]),
        failItems(f)]));
    });
    if (clean.length) {
      host.appendChild(el("p", { class: "rpt-more" }, [el("button", { type: "button", class: "rules-chip", "aria-expanded": showPassing ? "true" : "false",
        text: showPassing ? "Hide rules with no failures" : "Show " + plural(clean.length, "rule") + " with no failures",
        onclick: function () { showPassing = !showPassing; render(); } })]));
      if (showPassing) {
        host.appendChild(el("ul", { class: "rule-clean-list" }, clean.map(function (id) {
          return el("li", { title: ruleText(id) }, [el("strong", { text: ruleName(id) }), " · " + (passes[id] || 0) + " passing"]);
        })));
      }
    }
  }

  function pageResults() {
    var list = fails(), host = visual("All failures", {});
    function current() {
      var q = (state.q || "").toLowerCase();
      return list.filter(function (r) {
        return !q || (r.object + " " + r.table + " " + ruleName(r.rule) + " " + ruleText(r.rule) + " " + r.category).toLowerCase().indexOf(q) !== -1;
      });
    }
    var table = el("div");
    function draw() {
      var items = current();
      host.parentNode.querySelector("h3").textContent = "All failures (" + items.length + ")";
      resultsTable(table, sorts.results, items, "40rem", "Nothing matches the filters.", draw);
    }
    var search = el("input", { type: "search", class: "doc-filter", placeholder: "Object, table or rule", value: state.q || "", "aria-label": "Search results" });
    search.addEventListener("input", function () {
      state.q = search.value.trim(); if (!state.q) delete state.q;
      history.replaceState(null, "", address()); draw();
    });
    host.appendChild(el("div", { class: "rpt-toolbar" }, [el("label", {}, ["Search ", search]),
      el("button", { type: "button", class: "rpt-data-btn", text: "Download CSV", onclick: function () { downloadCsv(current(), "rule-failures.csv"); } })]));
    host.appendChild(table);
    draw();
  }

  // ---- the table of failing checks, used on the Results page and in Show data
  function resultsTable(host, sort, list, height, empty, onSort) {
    M.sortable(host, sort, [
      { key: "", label: "", cls: "expand-col", cell: function (x) { return hk.addButton(x.r) || ""; } },
      { key: "severity", label: "Severity", cell: function (x) { return sevChip(x.r.severity); } },
      { key: "category", label: "Category", cell: function (x) { return x.category; } },
      { key: "table", label: "Table", cell: function (x) { return tableCell(x.r.table); } },
      { key: "object", label: "Object", cell: function (x) {
          var a = x.r.link ? el("a", { href: x.r.link, text: x.object }) : el("span", { text: x.object }), tag = hk.statusTag(x.r);
          return tag ? el("span", {}, [a, " ", tag]) : a; } },
      { key: "type", label: "Type", cell: function (x) { return cap(x.type); } },
      { key: "rule", label: "Rule", cell: function (x) { return el("span", { text: x.rule, title: ruleText(x.r.rule) }); } }
    ], list.map(function (r) {
      return { r: r, _tie: r.table + r.object + r.rule, severity: SEV_ORDER[r.severity], category: r.category, table: tableLabel(r.table),
               object: r.object, type: r.type, rule: ruleName(r.rule) };
    }), { height: height, empty: empty, onSort: onSort });
  }

  // ---- side panel. `draw(panel)` fills it; the housekeeping list uses the same panel.
  function openDrawer(draw, opener) {
    drawer = { draw: draw, opener: opener };
    ui.drawerBackdrop.hidden = false;
    ui.drawer.hidden = false;
    document.body.classList.add("rpt-drawer-open");
    drawDrawer();
    ui.drawer.querySelector(".rpt-drawer-close").focus();
  }
  function drawDrawer() { clear(ui.drawer); ui.drawer.classList.remove("is-list"); drawer.draw(ui.drawer); }
  function closeDrawer() {
    if (!drawer) return;
    var opener = drawer.opener;
    drawer = null;
    ui.drawer.hidden = true;
    ui.drawerBackdrop.hidden = true;
    document.body.classList.remove("rpt-drawer-open");
    if (opener && document.body.contains(opener)) opener.focus();
  }
  function closeButton() { return el("button", { type: "button", class: "rpt-drawer-close", "aria-label": "Close", text: "×", onclick: closeDrawer }); }
  function showData(title, list, opener) {
    sorts.drawer = { key: "severity", dir: 1 };
    openDrawer(function (panel) {
      var c = sevCounts(list);
      panel.appendChild(el("div", { class: "rpt-drawer-head" }, [
        el("div", {}, [el("h2", { id: "rpt-drawer-title", text: title }),
          el("p", { class: "rpt-sub", text: plural(c.total, "failing check") + " (" + sevSummary(c) + ")" +
            (FILTERS.some(function (k) { return state[k]; }) ? ", with the report filters applied" : "") })]),
        el("div", { class: "rpt-drawer-actions" }, [
          el("button", { type: "button", class: "rpt-data-btn", text: "Download CSV", onclick: function () {
            downloadCsv(list, title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv"); } }),
          closeButton()])]));
      var host = el("div", { class: "rpt-drawer-body" });
      panel.appendChild(host);
      resultsTable(host, sorts.drawer, list.slice(), "none", "No rows.", drawDrawer);
    }, opener);
  }

  function downloadCsv(list, name) {
    function cell(v) {
      v = String(v === null || v === undefined ? "" : v);
      if (/^[=+\-@]/.test(v)) v = "'" + v;   // stop spreadsheets reading a value as a formula
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var lines = [["severity", "category", "table", "object", "type", "rule_id", "rule", "bpa_id", "fix_status", "issue", "link"].join(",")];
    list.forEach(function (r) {
      lines.push([r.severity, r.category, tableLabel(r.table), r.object, r.type, r.rule, ruleName(r.rule), (ruleById[r.rule] || {}).bpaId || "",
                  workLabel(r.work.status), r.work.number ? "#" + r.work.number : "", r.link].map(cell).join(","));
    });
    var a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- render
  function render() {
    syncHeader();
    clear(ui.canvas);
    ({ summary: pageSummary, table: pageTable, rule: pageRule, failures: pageResults })[view]();
  }

  M.ready(function () {
    app = document.getElementById("rules-app");
    if (!app) return;
    root = app.getAttribute("data-root") || "";
    M.load(root, ["results"]).then(function (d) {
      results = d.results; rows = results.results;
      results.rules.forEach(function (r) { ruleById[r.id] = r; });
      readState(); buildShell();
      hk = M.housekeeping({ rows: rows, ruleById: ruleById, repo: results.repo, workLabel: workLabel, ruleName: ruleName, ruleText: ruleText,
                            objectText: objectText, objectLink: objectLink, sortTables: sortTables,
                            openDrawer: openDrawer, closeButton: closeButton,
                            redraw: function (draw) { if (drawer && drawer.draw === draw) drawDrawer(); } });
      render();
    }).catch(function (e) {
      clear(app);
      app.appendChild(el("p", { class: "dash-empty", text: "Could not load the rule results: " + e.message }));
    });
  });
})();
