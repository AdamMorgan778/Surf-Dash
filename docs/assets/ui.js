// Shared parts for the home page (home.js) and the Rules report (rules.js, housekeeping.js): DOM helpers, tiles, bars,
// visual cards, sortable tables and data loading. Both pages are built from these, so they look and behave the same.
// Anything with logic (rule results, counts, housekeeping status) is worked out in Python; the scripts only draw it.
window.ModelDocs = (function () {
  var SEVS = [
    { id: "error", label: "Error", icon: "✖" },
    { id: "warning", label: "Warning", icon: "▲" },
    { id: "info", label: "Info", icon: "ℹ" }
  ];
  var SEV_ORDER = { error: 0, warning: 1, info: 2 };

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
  function plural(n, word) { return n + " " + (n === 1 ? word : word === "person" ? "people" : word + (/(s|x|ch|sh)$/.test(word) ? "es" : "s")); }
  function clickable(node, fn, label) {
    node.setAttribute("role", "button"); node.setAttribute("tabindex", "0");
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", fn);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
    return node;
  }

  // ---- labels
  function tableLabel(t) { return t === "(model)" ? "Whole model" : t; }
  function sevIcon(id) { return el("span", { class: "bar-icon sev-" + id, text: SEVS[SEV_ORDER[id]].icon, "aria-hidden": "true" }); }
  function sevChip(id) { return el("span", { class: "sev-chip" }, [sevIcon(id), " " + SEVS[SEV_ORDER[id]].label]); }

  // ---- tile: {label, value, sub, sev, onClick, dim, on}. `label` and `sub` may be text or a node.
  function tile(t) {
    var node = el("div", { class: "dash-tile" + (t.onClick ? " tile-click" : "") + (t.dim ? " is-dim" : "") + (t.on ? " is-on" : "") }, [
      el("div", { class: "tile-label" }, [t.sev ? sevIcon(t.sev) : null, t.label]),
      el("div", { class: "tile-value", text: String(t.value) }),
      el("div", { class: "tile-sub" }, [t.sub])]);
    return t.onClick ? clickable(node, t.onClick, t.tip) : node;
  }

  // ---- visual: a card with a title, an optional sub-line and an optional button. Returns the card's body.
  // opts: {span, sub, cls, button: {label, title, onClick(buttonNode)}}
  function visual(host, title, opts) {
    opts = opts || {};
    var body = el("div", { class: "rpt-visual-body" });
    var bar = el("div", { class: "rpt-visual-bar" }, [el("div", {}, [el("h3", { text: title }), opts.sub ? el("p", { class: "rpt-sub", text: opts.sub }) : null])]);
    if (opts.button) {
      var btn = el("button", { type: "button", class: "rpt-data-btn", title: opts.button.title }, [opts.button.label]);
      btn.addEventListener("click", function () { opts.button.onClick(btn); });
      bar.appendChild(btn);
    }
    host.appendChild(el("section", { class: "rpt-visual span-" + (opts.span || 12) + (opts.cls ? " " + opts.cls : "") }, [bar, body]));
    return body;
  }

  // ---- horizontal bars, one row each, value at the end.
  // items: {label, value, display, cls, segments: [{cls, value}], icon, href, onClick, dim, on, tip}
  // opts: {max, empty, wide (label wraps), track (show the unfilled part)}
  function bars(host, items, opts) {
    opts = opts || {};
    clear(host);
    if (!items.length) { host.appendChild(el("p", { class: "dash-empty", text: opts.empty || "Nothing to show." })); return; }
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    items.forEach(function (i) {
      var width = "width:" + (100 * i.value / max) + "%", fill;
      if (i.segments) {
        fill = el("div", { class: "sbar", style: width }, i.segments.filter(function (s) { return s.value; }).map(function (s) {
          return el("span", { class: "sbar-seg " + s.cls, style: "flex-grow:" + s.value });
        }));
      } else {
        fill = el("div", { class: (i.value > 0 ? "bar-fill " : "bar-zero ") + (i.cls || ""), style: width });
      }
      var display = i.display === undefined ? String(i.value) : i.display, tip = i.tip || i.label + ": " + display;
      var row = el("div", { class: "bar-row" + (i.onClick ? " sbar-row" : "") + (opts.wide ? " wide" : "") + (i.dim ? " is-dim" : "") + (i.on ? " is-on" : ""), title: tip }, [
        el("div", { class: "bar-label" }, [i.icon, i.href ? el("a", { href: i.href, text: i.label }) : i.label]),
        el("div", { class: "bar-track" + (opts.track ? " rate-track" : "") }, [fill]),
        el("div", { class: "bar-value", text: display })]);
      host.appendChild(i.onClick ? clickable(row, i.onClick, tip) : row);
    });
  }

  // ---- sortable table in a scrolling panel with a sticky header.
  // sort: {key, dir}, changed in place when a heading is clicked; opts.onSort then redraws.
  // columns: [{key, label, num, cls, cell(row)}]; rows carry the sort keys and `_tie`.
  // opts: {height, empty, onSort, detail(row, columnCount) -> an extra <tr> or null}
  function sortable(host, sort, columns, rows, opts) {
    rows.sort(function (a, b) {
      var x = a[sort.key], y = b[sort.key];
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x === undefined ? "" : x).localeCompare(String(y === undefined ? "" : y));
      return sort.dir * d || String(a._tie).localeCompare(String(b._tie));
    });
    host.querySelectorAll(":scope > .rpt-scroll, :scope > .dash-empty").forEach(function (n) { n.remove(); });
    var before = host.querySelector(":scope > .rpt-more");
    if (!rows.length) { host.insertBefore(el("p", { class: "dash-empty", text: opts.empty }), before); return; }
    var head = el("tr", {}, columns.map(function (c) {
      var th = el("th", { scope: "col", class: (c.num ? "num " : "") + (c.cls || ""), "aria-sort": c.key && sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : null });
      if (!c.key) { if (c.label) th.textContent = c.label; return th; }
      th.appendChild(el("button", { type: "button", class: "sort-btn", onclick: function () {
        sort.dir = sort.key === c.key ? -sort.dir : (c.num ? -1 : 1);
        sort.key = c.key;
        opts.onSort();
      } }, [c.label + " ", el("span", { class: "sort-mark", "aria-hidden": "true", text: sort.key === c.key ? (sort.dir > 0 ? "▲" : "▼") : "⇅" })]));
      return th;
    }));
    var body = el("tbody");
    rows.forEach(function (r) {
      body.appendChild(el("tr", {}, columns.map(function (c) { return el("td", { class: (c.num ? "num " : "") + (c.cls || "") }, [c.cell(r)]); })));
      if (opts.detail) { var d = opts.detail(r, columns.length); if (d) body.appendChild(d); }
    });
    host.insertBefore(el("div", { class: "rpt-scroll", style: "max-height:" + (opts.height || "30rem"), tabindex: "0",
                                  "aria-label": "Scrollable table, " + plural(rows.length, "row") },
      [el("table", { class: "rpt-table" }, [el("thead", {}, [head]), body])]), before);
  }

  // ---- data: load(root, ["results", "summary"], ["issues"]) -> {results, summary, issues}; the optional ones may be null.
  function load(root, names, optional) {
    function get(n, must) {
      return fetch(root + "data/" + n + ".json").then(function (r) {
        if (!r.ok) { if (must) throw new Error(n + ".json " + r.status); return null; }
        return r.json();
      }).catch(function (e) { if (must) throw e; return null; });
    }
    var all = names.map(function (n) { return get(n, true); }).concat((optional || []).map(function (n) { return get(n, false); }));
    return Promise.all(all).then(function (d) {
      var out = {};
      names.concat(optional || []).forEach(function (n, i) { out[n] = d[i]; });
      return out;
    });
  }

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
  function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
  ready(initDictFilter);

  return { SEVS: SEVS, SEV_ORDER: SEV_ORDER, el: el, clear: clear, cap: cap, uniq: uniq, plural: plural, clickable: clickable,
           tableLabel: tableLabel, sevIcon: sevIcon, sevChip: sevChip, tile: tile, visual: visual, bars: bars, sortable: sortable,
           load: load, ready: ready };
})();
