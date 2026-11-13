// Rules dashboard (/rules/) and breakdown (/rules/breakdown/). Reads docs/data/results.json and model.json.
// Filters live in the page address (?category=Formatting&severity=warning) so views can be shared and the
// two pages stay in step.
(function () {
  var SEVS = [
    { id: "error", label: "Error", icon: "✖" },
    { id: "warning", label: "Warning", icon: "▲" },
    { id: "info", label: "Info", icon: "ℹ" }
  ];
  var SEV_ORDER = { error: 0, warning: 1, info: 2 };
  var FILTER_KEYS = ["category", "severity", "table", "type", "source", "rule", "status", "q"];
  var FILTER_LABEL = { category: "Category", severity: "Severity", table: "Table", type: "Object type",
                       source: "Source", rule: "Rule", status: "Status", q: "Search" };
  var PAGE_SIZE = 25;

  var app, page, root, results, model, ruleById = {}, state = {}, ui = {};
  var sorts = { rules: { key: "fail", dir: -1 }, tables: { key: "fail", dir: -1 }, all: { key: "severity", dir: 1 } };
  var expanded = {}, pageNo = 0, showPassing = false;

  // ---- small DOM helpers
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "onclick") node.addEventListener("click", attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function count(rows, fn) { var n = 0; rows.forEach(function (r) { if (fn(r)) n++; }); return n; }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } }); return out; }
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
  function valueLabel(key, v) {
    if (key === "table") return tableLabel(v);
    if (key === "source") return sourceLabel(v);
    if (key === "rule") return ruleText(v);
    if (key === "q") return "“" + v + "”";
    if (key === "status") return v === "fail" ? "Failing" : v === "pass" ? "Passing" : "All";
    return cap(v);
  }
  function sevChip(id) {
    var s = SEVS[SEV_ORDER[id]];
    return el("span", { class: "sev-chip" }, [el("span", { class: "bar-icon sev-" + id, text: s.icon, "aria-hidden": "true" }), " " + s.label]);
  }

  // ---- filter state <-> address
  function readState() {
    var p = new URLSearchParams(location.search);
    state = {};
    FILTER_KEYS.forEach(function (k) { if (p.get(k)) state[k] = p.get(k); });
    if (page === "breakdown" && !p.has("status")) state.status = "fail";
  }
  function query(extra) {
    var p = new URLSearchParams(), s = {};
    FILTER_KEYS.forEach(function (k) { if (state[k]) s[k] = state[k]; });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) s[k] = extra[k]; else delete s[k]; });
    if (page === "breakdown" && !s.status) s.status = "all";   // "all" must survive a reload; the default is failing
    Object.keys(s).forEach(function (k) { p.set(k, s[k]); });
    var q = p.toString();
    return q ? "?" + q : "";
  }
  function drillQuery(extra) {   // dashboard -> breakdown: carry filters, leave status to the breakdown default
    var p = new URLSearchParams();
    FILTER_KEYS.forEach(function (k) { if (state[k] && k !== "status" && k !== "q") p.set(k, state[k]); });
    Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); });
    var q = p.toString();
    return q ? "?" + q : "";
  }
  function setFilter(key, value) {
    if (value) state[key] = value; else delete state[key];
    pageNo = 0;
    history.replaceState(null, "", location.pathname + query());
    render();
  }
  function toggle(key, value) { setFilter(key, state[key] === value ? "" : value); }
  function matches(r, except) {
    var keys = ["category", "severity", "table", "type", "rule"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (state[k] && k !== except && r[k] !== state[k]) return false;
    }
    return !(state.source && except !== "source" && sourceOf(r) !== state.source);
  }
  function scoped(except) { return results.results.filter(function (r) { return matches(r, except); }); }

  // ---- filter row and chips
  function buildFilters(host) {
    var defs = [
      ["category", uniq(results.rules.map(function (r) { return r.category; })).sort()],
      ["severity", SEVS.map(function (s) { return s.id; })],
      ["table", uniq(results.results.map(function (r) { return r.table; })).sort(function (a, b) {
        return (a === "(model)") - (b === "(model)") || a.localeCompare(b); })],
      ["type", uniq(results.results.map(function (r) { return r.type; })).sort()],
      ["source", ["bpa", "project"]]
    ];
    if (page === "breakdown") defs.push(["status", ["fail", "pass", "all"]]);
    var row = el("div", { class: "dash-filters", role: "group", "aria-label": "Filters" });
    ui.selects = {};
    defs.forEach(function (d) {
      var key = d[0], sel = el("select", { id: "rf-" + key });
      if (key !== "status") sel.appendChild(el("option", { value: "", text: "All" }));
      d[1].forEach(function (v) { sel.appendChild(el("option", { value: v, text: valueLabel(key, v) })); });
      sel.addEventListener("change", function () { setFilter(key, sel.value); });
      ui.selects[key] = sel;
      row.appendChild(el("label", {}, [FILTER_LABEL[key], sel]));
    });
    if (page === "breakdown") {
      ui.search = el("input", { type: "search", class: "doc-filter rules-search", placeholder: "Object, table or rule" });
      ui.search.addEventListener("input", function () { setFilter("q", ui.search.value.trim()); });
      row.appendChild(el("label", {}, ["Search results", ui.search]));
    }
    host.appendChild(row);
    ui.chips = el("div", { class: "rules-chips" });
    host.appendChild(ui.chips);
  }
  function syncFilters() {
    Object.keys(ui.selects).forEach(function (k) { ui.selects[k].value = state[k] || (k === "status" ? "fail" : ""); });
    if (ui.search && document.activeElement !== ui.search) ui.search.value = state.q || "";
    clear(ui.chips);
    var active = FILTER_KEYS.filter(function (k) { return state[k] && !(k === "status" && page === "breakdown"); });
    active.forEach(function (k) {
      var chip = el("button", { type: "button", class: "rules-chip", title: "Remove this filter", onclick: function () { setFilter(k, ""); } },
        [FILTER_LABEL[k] + ": " + valueLabel(k, state[k]) + " ", el("span", { "aria-hidden": "true", text: "×" })]);
      ui.chips.appendChild(chip);
    });
    if (active.length > 1) {
      ui.chips.appendChild(el("button", { type: "button", class: "rules-chip rules-chip-clear", text: "Clear all", onclick: function () {
        active.forEach(function (k) { delete state[k]; });
        pageNo = 0; history.replaceState(null, "", location.pathname + query()); render();
      } }));
    }
  }

  // ---- charts
  function sevCounts(rows) {
    var c = { error: 0, warning: 0, info: 0, total: 0 };
    rows.forEach(function (r) { if (r.status === "fail") { c[r.severity]++; c.total++; } });
    return c;
  }
  function sevSummary(c) { return c.error + " error, " + c.warning + " warning, " + c.info + " info"; }

  // One horizontal bar per item, split into severity segments. items: [{key, label, counts, onClick, dim}]
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
      var row = el("div", { class: "bar-row sbar-row" + (wide ? " wide" : "") + (i.dim ? " is-dim" : ""), title: tip }, [
        el("div", { class: "bar-label", text: i.label }), el("div", { class: "bar-track" }, [track]),
        el("div", { class: "bar-value", text: String(i.counts.total) })]);
      host.appendChild(clickable(row, i.onClick, tip));
    });
  }
  function group(rows, key) {
    var g = {};
    rows.forEach(function (r) { (g[r[key]] = g[r[key]] || []).push(r); });
    return g;
  }
  function dimensionChart(host, dim, labelFn, empty) {
    var g = group(scoped(dim), dim);
    var items = Object.keys(g).map(function (k) {
      return { key: k, label: labelFn(k), counts: sevCounts(g[k]), dim: !!state[dim] && state[dim] !== k,
               onClick: function () { toggle(dim, k); } };
    }).filter(function (i) { return i.counts.total > 0; });
    items.sort(function (a, b) { return b.counts.total - a.counts.total || a.label.localeCompare(b.label); });
    stackedBars(host, items, empty);
  }

  function renderDashboard() {
    var rows = scoped(), fails = rows.filter(function (r) { return r.status === "fail"; }), c = sevCounts(rows);

    // tiles
    clear(ui.tiles);
    var rate = rows.length ? Math.round(1000 * (rows.length - fails.length) / rows.length) / 10 + "%" : "n/a";
    [["Rules checked", uniq(rows.map(function (r) { return r.rule; })).length, "of " + results.rules.length + " rules"],
     ["Checks run", rows.length, "one per object per rule"],
     ["Pass rate", rate, (rows.length - fails.length) + " of " + rows.length + " checks pass"],
     ["Failing rules", uniq(fails.map(function (r) { return r.rule; })).length, fails.length + " failing checks"]
    ].forEach(function (t) {
      ui.tiles.appendChild(el("div", { class: "dash-tile" }, [el("div", { class: "tile-label", text: t[0] }),
        el("div", { class: "tile-value", text: String(t[1]) }), el("div", { class: "tile-sub", text: t[2] })]));
    });
    SEVS.forEach(function (s) {
      var tile = el("div", { class: "dash-tile tile-click" + (state.severity && state.severity !== s.id ? " is-dim" : "") }, [
        el("div", { class: "tile-label" }, [el("span", { class: "bar-icon sev-" + s.id, text: s.icon, "aria-hidden": "true" }), s.label + " failures"]),
        el("div", { class: "tile-value", text: String(sevCounts(scoped("severity"))[s.id]) }),
        el("div", { class: "tile-sub", text: state.severity === s.id ? "click to clear" : "click to filter" })]);
      ui.tiles.appendChild(clickable(tile, function () { toggle("severity", s.id); }, "Filter to " + s.label));
    });

    // charts
    dimensionChart(ui.byCategory, "category", cap, "No failures match the filters.");
    dimensionChart(ui.byTable, "table", tableLabel, "No failures match the filters.");

    var byRule = group(fails, "rule");
    stackedBars(ui.topRules, Object.keys(byRule).map(function (id) {
      return { key: id, label: ruleText(id), counts: sevCounts(byRule[id]),
               onClick: function () { location.href = "breakdown/" + drillQuery({ rule: id }); } };
    }).sort(function (a, b) { return b.counts.total - a.counts.total || a.label.localeCompare(b.label); }).slice(0, 10),
      "No failures match the filters.", true);

    // pass rate by category
    clear(ui.passRate);
    var g = group(scoped("category"), "category");
    Object.keys(g).sort().forEach(function (k) {
      var total = g[k].length, pass = count(g[k], function (r) { return r.status === "pass"; });
      var pct = Math.round(1000 * pass / total) / 10, tip = k + ": " + pct + "% pass (" + pass + " of " + total + " checks)";
      var row = el("div", { class: "bar-row sbar-row" + (state.category && state.category !== k ? " is-dim" : ""), title: tip }, [
        el("div", { class: "bar-label", text: k }),
        el("div", { class: "bar-track rate-track" }, [el("div", { class: "bar-fill", style: "width:" + pct + "%" })]),
        el("div", { class: "bar-value", text: pct + "%" })]);
      ui.passRate.appendChild(clickable(row, function () { toggle("category", k); }, tip));
    });

    renderGrid();
    ui.drill.setAttribute("href", "breakdown/" + drillQuery());
    ui.drill.textContent = "View breakdown of " + fails.length + " failing check" + (fails.length === 1 ? "" : "s") + " →";
  }

  function renderGrid() {
    clear(ui.grid);
    var keys = ["severity", "type", "rule"], rows = results.results.filter(function (r) {
      for (var i = 0; i < keys.length; i++) if (state[keys[i]] && r[keys[i]] !== state[keys[i]]) return false;
      return r.status === "fail" && !(state.source && sourceOf(r) !== state.source);
    });
    var cats = uniq(results.rules.map(function (r) { return r.category; })).sort();
    var tables = uniq(results.results.map(function (r) { return r.table; })).sort(function (a, b) {
      return (a === "(model)") - (b === "(model)") || a.localeCompare(b); });
    var n = {}, max = 1;
    rows.forEach(function (r) { var k = r.table + "|" + r.category; n[k] = (n[k] || 0) + 1; if (n[k] > max) max = n[k]; });
    function hbtn(text, fn, active) {
      return el("button", { type: "button", class: "grid-head" + (active ? " is-active" : ""), text: text, onclick: fn });
    }
    var head = el("tr", {}, [el("th", { text: "Table" })].concat(cats.map(function (cname) {
      return el("th", {}, [hbtn(cname, function () { toggle("category", cname); }, state.category === cname)]);
    })).concat([el("th", { text: "Total" })]));
    var body = el("tbody");
    tables.forEach(function (t) {
      var total = 0, tr = el("tr", {}, [el("th", {}, [hbtn(tableLabel(t), function () { toggle("table", t); }, state.table === t)])]);
      cats.forEach(function (cname) {
        var v = n[t + "|" + cname] || 0;
        total += v;
        var on = state.table === t && state.category === cname;
        var dim = (state.table && state.table !== t) || (state.category && state.category !== cname);
        if (!v) { tr.appendChild(el("td", { class: "grid-zero" + (dim ? " is-dim" : ""), text: "·" })); return; }
        var btn = el("button", { type: "button", class: "grid-cell" + (on ? " is-active" : "") + (dim ? " is-dim" : ""),
          style: "background:color-mix(in srgb, var(--dash-bar) " + Math.round(12 + 43 * v / max) + "%, transparent)",
          title: tableLabel(t) + ", " + cname + ": " + v + " failing", text: String(v),
          onclick: function () {
            if (on) { delete state.table; delete state.category; } else { state.table = t; state.category = cname; }
            setFilter("table", state.table || "");
          } });
        tr.appendChild(el("td", {}, [btn]));
      });
      tr.appendChild(el("td", { class: "grid-total", text: String(total) }));
      body.appendChild(tr);
    });
    ui.grid.appendChild(el("div", { class: "md-typeset__scrollwrap" }, [el("div", { class: "md-typeset__table rules-grid" }, [
      el("table", {}, [el("thead", {}, [head]), body])])]));
  }

  // ---- breakdown tables
  function sortable(host, id, columns, rows, opts) {
    // columns: [{key, label, num, cell(row)}]; rows: plain objects with the sort keys
    var s = sorts[id];
    rows.sort(function (a, b) {
      var x = a[s.key], y = b[s.key];
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return s.dir * d || String(a._tie).localeCompare(String(b._tie));
    });
    clear(host);
    if (!rows.length) { host.appendChild(el("p", { class: "dash-empty", text: opts.empty })); return; }
    var head = el("tr", {}, columns.map(function (c) {
      var th = el("th", { class: c.num ? "num" : "", "aria-sort": s.key === c.key ? (s.dir > 0 ? "ascending" : "descending") : "none" });
      if (!c.key) { th.textContent = c.label; return th; }
      th.appendChild(el("button", { type: "button", class: "sort-btn", onclick: function () {
        sorts[id] = { key: c.key, dir: s.key === c.key ? -s.dir : (c.num ? -1 : 1) };
        pageNo = 0; render();
      } }, [c.label + " ", el("span", { class: "sort-mark", "aria-hidden": "true", text: s.key === c.key ? (s.dir > 0 ? "▲" : "▼") : "⇅" })]));
      return th;
    }));
    var body = el("tbody");
    var shown = opts.paged ? rows.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE) : rows;
    shown.forEach(function (r) {
      body.appendChild(el("tr", {}, columns.map(function (c) {
        var v = c.cell(r);
        return el("td", { class: c.num ? "num" : "" }, [typeof v === "number" ? String(v) : v]);
      })));
      if (opts.detail) { var d = opts.detail(r, columns.length); if (d) body.appendChild(d); }
    });
    host.appendChild(el("div", { class: "md-typeset__scrollwrap" }, [el("div", { class: "md-typeset__table rules-table" }, [
      el("table", {}, [el("thead", {}, [head]), body])])]));
    if (opts.paged && rows.length > PAGE_SIZE) {
      var pages = Math.ceil(rows.length / PAGE_SIZE);
      host.appendChild(el("div", { class: "rules-pager" }, [
        el("button", { type: "button", text: "Previous", disabled: pageNo === 0 ? "" : null, onclick: function () { pageNo--; render(); } }),
        el("span", { text: (pageNo * PAGE_SIZE + 1) + " to " + Math.min(rows.length, (pageNo + 1) * PAGE_SIZE) + " of " + rows.length }),
        el("button", { type: "button", text: "Next", disabled: pageNo >= pages - 1 ? "" : null, onclick: function () { pageNo++; render(); } })]));
    }
  }
  function objectLink(r) {
    var text = r.type === "table" || r.type === "model" || r.type === "relationship" ? r.object : tableLabel(r.table) + "[" + r.object + "]";
    return r.link ? el("a", { href: r.link, text: text }) : el("span", { text: text });
  }
  function tableCell(t) {
    return t === "(model)" ? el("span", { text: "Whole model" }) : el("a", { href: root + "dictionary/" + t + "/", text: t });
  }

  function renderBreakdown() {
    var rows = scoped(), byRule = group(rows, "rule"), byTable = group(rows, "table");
    var c = sevCounts(rows);
    ui.summary.textContent = rows.length + " checks in scope: " + c.total + " failing (" + sevSummary(c) + "), " + (rows.length - c.total) + " passing.";
    ui.back.setAttribute("href", "../" + drillQuery());

    var clean = 0, ruleRows;
    sortable(ui.rulesTable, "rules", [
      { key: "", label: "", cell: function (r) {
          if (!r.fail) return "";
          return el("button", { type: "button", class: "expand-btn", "aria-expanded": expanded[r.id] ? "true" : "false",
            "aria-label": (expanded[r.id] ? "Hide" : "Show") + " failing objects", text: expanded[r.id] ? "▾" : "▸",
            onclick: function () { expanded[r.id] = !expanded[r.id]; render(); } }); } },
      { key: "text", label: "Rule", cell: function (r) { return r.text; } },
      { key: "category", label: "Category", cell: function (r) { return r.category; } },
      { key: "sev", label: "Severity", cell: function (r) { return sevChip(r.severity); } },
      { key: "source", label: "Source", cell: function (r) { return r.bpaId ? el("span", { text: "BPA", title: "Best Practice Analyzer rule " + r.bpaId }) : "Project"; } },
      { key: "fail", label: "Failing", num: true, cell: function (r) { return r.fail; } },
      { key: "pass", label: "Passing", num: true, cell: function (r) { return r.pass; } }
    ], ruleRows = Object.keys(byRule).map(function (id) {
      var rule = ruleById[id] || {}, fail = byRule[id].filter(function (r) { return r.status === "fail"; });
      return { id: id, _tie: ruleText(id), text: ruleText(id), category: rule.category || "", severity: rule.severity,
               sev: SEV_ORDER[rule.severity], source: rule.bpaId ? "a" + rule.bpaId : "z", bpaId: rule.bpaId,
               fail: fail.length, pass: byRule[id].length - fail.length, fails: fail };
    }).filter(function (r) { if (!r.fail) clean++; return showPassing || r.fail; }),
    { empty: clean ? "No rules are failing for these filters." : "No rules match the filters.", detail: function (r, span) {
      if (!expanded[r.id] || !r.fail) return null;
      var list = el("ul", { class: "fail-list" }, r.fails.map(function (f) { return el("li", {}, [objectLink(f)]); }));
      return el("tr", { class: "detail-row" }, [el("td", {}), el("td", { colspan: String(span - 1) }, [
        el("div", { class: "fail-list-title", text: r.fail + " failing object" + (r.fail === 1 ? "" : "s") }), list])]);
    } });

    ui.rulesToggle.hidden = !clean;
    ui.rulesToggle.textContent = showPassing ? "Hide rules with no failures" : "Show " + clean + " rule" + (clean === 1 ? "" : "s") + " with no failures";

    sortable(ui.tablesTable, "tables", [
      { key: "label", label: "Table", cell: function (r) { return tableCell(r.table); } },
      { key: "error", label: "Error", num: true, cell: function (r) { return r.error; } },
      { key: "warning", label: "Warning", num: true, cell: function (r) { return r.warning; } },
      { key: "info", label: "Info", num: true, cell: function (r) { return r.info; } },
      { key: "fail", label: "Failing", num: true, cell: function (r) { return r.fail; } },
      { key: "pass", label: "Passing", num: true, cell: function (r) { return r.pass; } },
      { key: "", label: "", cell: function (r) {
          return el("button", { type: "button", class: "rules-chip", text: state.table === r.table ? "Clear filter" : "Filter",
            onclick: function () { toggle("table", r.table); } }); } }
    ], Object.keys(byTable).map(function (t) {
      var k = sevCounts(byTable[t]);
      return { table: t, _tie: t, label: tableLabel(t), error: k.error, warning: k.warning, info: k.info, fail: k.total,
               pass: byTable[t].length - k.total };
    }), { empty: "No tables match the filters." });

    var q = (state.q || "").toLowerCase();
    var list = rows.filter(function (r) {
      if (state.status && state.status !== "all" && r.status !== state.status) return false;
      return !q || (r.object + " " + r.table + " " + ruleText(r.rule) + " " + r.category).toLowerCase().indexOf(q) !== -1;
    }).map(function (r) {
      return { r: r, _tie: r.table + r.object + r.rule, severity: SEV_ORDER[r.severity], category: r.category, table: tableLabel(r.table),
               object: r.object, type: r.type, rule: ruleText(r.rule), status: r.status };
    });
    ui.allHeading.textContent = "All results (" + list.length + ")";
    ui.csv.disabled = !list.length;
    ui.csv.onclick = function () { downloadCsv(list.map(function (x) { return x.r; })); };
    sortable(ui.allTable, "all", [
      { key: "severity", label: "Severity", cell: function (x) { return sevChip(x.r.severity); } },
      { key: "category", label: "Category", cell: function (x) { return x.category; } },
      { key: "table", label: "Table", cell: function (x) { return tableCell(x.r.table); } },
      { key: "object", label: "Object", cell: function (x) { return x.r.link ? el("a", { href: x.r.link, text: x.object }) : x.object; } },
      { key: "type", label: "Type", cell: function (x) { return cap(x.type); } },
      { key: "rule", label: "Rule", cell: function (x) { return x.rule; } },
      { key: "status", label: "Status", cell: function (x) { return x.status === "fail" ? "Fail" : "Pass"; } }
    ], list, { empty: "Nothing matches the filters.", paged: true });
  }

  function downloadCsv(rows) {
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
    var a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" })), download: "rule-results.csv" });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- page skeletons
  function section(title, id, cls) {
    ui[id] = el("div", {});
    return el("section", { class: cls || "" }, [el("h3", { text: title }), ui[id]]);
  }
  function build() {
    clear(app);
    buildFilters(app);
    app.appendChild(el("p", { class: "dash-note", text: "Model read " + (results.generated || model.generated) + "." }));
    if (page === "dashboard") {
      ui.tiles = el("div", { class: "dash-tiles" });
      app.appendChild(ui.tiles);
      var legend = el("div", { class: "rules-legend", "aria-label": "Severity legend" }, SEVS.map(function (s) {
        return el("button", { type: "button", class: "legend-item", title: "Filter to " + s.label, onclick: function () { toggle("severity", s.id); } },
          [el("span", { class: "legend-swatch sev-" + s.id, "aria-hidden": "true" }), el("span", { class: "bar-icon sev-" + s.id, text: s.icon, "aria-hidden": "true" }), s.label]);
      }).concat([el("span", { class: "legend-hint", text: "Click a bar, tile or cell to filter. Click it again to clear." })]));
      app.appendChild(legend);
      app.appendChild(el("div", { class: "dash-charts" }, [
        section("Failures by category", "byCategory"), section("Failures by table", "byTable"),
        section("Pass rate by category", "passRate"),
        section("Most-failed rules (click to see the objects)", "topRules", "span-all"),
        section("Failures by table and category", "grid", "span-all")]));
      ui.drill = el("a", { class: "md-button md-button--primary rules-drill", href: "breakdown/" });
      app.appendChild(el("p", {}, [ui.drill]));
    } else {
      ui.back = el("a", { href: "../", text: "← Back to the rules dashboard" });
      ui.summary = el("span", {});
      app.appendChild(el("p", { class: "rules-summary" }, [ui.back, el("br"), ui.summary]));
      ui.rulesTable = el("div"); ui.tablesTable = el("div"); ui.allTable = el("div");
      ui.allHeading = el("h2", { text: "All results" });
      ui.csv = el("button", { type: "button", class: "md-button rules-csv", text: "Download CSV" });
      ui.rulesToggle = el("button", { type: "button", class: "rules-chip", onclick: function () { showPassing = !showPassing; render(); } });
      app.appendChild(el("h2", { text: "By rule" })); app.appendChild(ui.rulesTable); app.appendChild(el("p", {}, [ui.rulesToggle]));
      app.appendChild(el("h2", { text: "By table" })); app.appendChild(ui.tablesTable);
      app.appendChild(ui.allHeading);
      app.appendChild(el("p", { class: "dash-note" }, ["Filtered by the Status and Search boxes above as well. ", ui.csv]));
      app.appendChild(ui.allTable);
    }
  }
  function render() {
    syncFilters();
    if (page === "dashboard") renderDashboard(); else renderBreakdown();
  }

  function init() {
    app = document.getElementById("rules-app");
    if (!app) return;
    page = app.getAttribute("data-page");
    root = app.getAttribute("data-root") || "";
    Promise.all(["results", "model"].map(function (n) {
      return fetch(root + "data/" + n + ".json").then(function (r) { if (!r.ok) throw new Error(n + ".json " + r.status); return r.json(); });
    })).then(function (d) {
      results = d[0]; model = d[1];
      results.rules.forEach(function (r) { ruleById[r.id] = r; });
      readState(); build(); render();
    }).catch(function (e) {
      clear(app);
      app.appendChild(el("p", { class: "dash-empty", text: "Could not load the rule results: " + e.message }));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
