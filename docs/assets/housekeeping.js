// Housekeeping list for the Rules report: pick failing checks with +, review them in a side panel, and raise them
// as one GitHub issue. The list is kept in this browser until it is raised.
// Each failing check arrives from Python (tools/housekeeping.py) with its checklist line (`item`) and where it
// stands in an open issue (`work`), so this file only draws and collects. Checks already in an issue are locked.
// rules.js calls ModelDocs.housekeeping(ctx) and gets back {addButton, addAllButton, statusTag}.
window.ModelDocs.housekeeping = function (ctx) {
  var M = window.ModelDocs, el = M.el, clear = M.clear, plural = M.plural, uniq = M.uniq, SEV_ORDER = M.SEV_ORDER;
  var KEY = "housekeeping:" + (ctx.repo || location.pathname);
  var LINK_LIMIT = 7000;   // GitHub rejects longer "new issue" links
  var byKey = {}, basket = [], meta = {}, pill, toastBox, toastTimer;

  function keyOf(r) { return r.table + "|" + r.object + "|" + r.rule; }
  function isLocked(r) { return r.work.status !== "none"; }
  function inBasket(k) { return basket.indexOf(k) !== -1; }
  function basketRows() { return basket.map(function (k) { return byKey[k]; }).filter(Boolean); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ items: basket, meta: meta })); } catch (e) { /* private mode: the list lasts this visit */ }
  }
  function load() {
    var dropped = 0;
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      var kept = (saved.items || []).filter(function (k) { return byKey[k]; });   // drop items that now pass
      basket = kept.filter(function (k) { return !isLocked(byKey[k]); });          // and items someone has raised
      dropped = kept.length - basket.length;
      meta = saved.meta || {};
      if (dropped) save();
    } catch (e) { basket = []; meta = {}; }
    return dropped;
  }
  function setInBasket(keys, add) {
    var changed = 0;
    keys.forEach(function (k) {
      var i = basket.indexOf(k);
      if (add && i === -1) { basket.push(k); changed++; }
      if (!add && i !== -1) { basket.splice(i, 1); changed++; }
    });
    if (!changed) return;
    if (!basket.length) meta = {};
    save();
    document.querySelectorAll(".hk-add").forEach(paintAdd);
    document.querySelectorAll(".hk-add-all").forEach(paintAddAll);
    updatePill(add);
    ctx.redraw(drawList);
  }

  // ---- status tag for a check that is already in an issue
  function statusTag(r) {
    var w = r.work, s = w.status;
    if (s === "none") return null;
    var who = w.assignees.length ? "@" + w.assignees.join(", @") : "";
    var tip = ctx.workLabel(s) + " in issue #" + w.number +
      (s === "in-progress" ? (who ? ", assigned to " + who : "") + (w.branches.length ? ", branch " + w.branches.join(", ") : "") +
                             (!who && !w.branches.length ? " (labelled in-progress)" : "") :
       s === "raised" ? ". Nobody has picked it up yet: assign yourself or use Create a branch on the issue." :
       ". Ticked on the issue; it clears from the report once the fix reaches the main branch.");
    return el("a", { class: "hk-tag is-" + s, href: w.url, title: tip }, [
      el("span", { class: "hk-tag-dot", "aria-hidden": "true", text: s === "done" ? "✓" : "" }),
      el("span", { text: ctx.workLabel(s) }),
      s === "in-progress" && who ? el("span", { class: "hk-tag-who", text: who }) : null,
      el("span", { class: "hk-tag-num", text: "#" + w.number })]);
  }

  // ---- the + / ✓ toggle for one failing check, and "Add all" for a group
  function addButton(r) {
    if (isLocked(r)) return null;   // its status tag shows instead
    var k = keyOf(r), b = el("button", { type: "button", class: "hk-add", "data-hk": k });
    b.addEventListener("click", function (e) { e.stopPropagation(); setInBasket([k], !inBasket(k)); });
    paintAdd(b);
    return b;
  }
  function paintAdd(b) {
    var k = b.getAttribute("data-hk"), added = inBasket(k), what = byKey[k] ? ctx.objectText(byKey[k]) : "this item";
    b.classList.toggle("is-on", added);
    b.setAttribute("aria-pressed", added ? "true" : "false");
    b.textContent = added ? "✓" : "+";
    b.setAttribute("aria-label", (added ? "Remove " : "Add ") + what + (added ? " from" : " to") + " the housekeeping list");
    b.title = added ? "In your housekeeping list. Click to remove." : "Add to your housekeeping list";
  }
  function addAllButton(list) {
    var b = el("button", { type: "button", class: "hk-add-all" });
    b._keys = list.filter(function (r) { return !isLocked(r); }).map(keyOf);
    b.addEventListener("click", function () { setInBasket(b._keys, !b._keys.every(inBasket)); });
    paintAddAll(b);
    return b;
  }
  function paintAddAll(b) {
    var keys = b._keys;
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

  // ---- floating pill and toast
  function updatePill(bump) {
    pill.hidden = !basket.length;
    clear(pill);
    pill.appendChild(el("span", { class: "hk-pill-icon", "aria-hidden": "true", text: "🧹" }));
    pill.appendChild(el("span", { text: "Housekeeping list" }));
    pill.appendChild(el("span", { class: "hk-pill-count", text: String(basket.length) }));
    pill.setAttribute("aria-label", "Open your housekeeping list, " + plural(basket.length, "item"));
    if (bump) { pill.classList.remove("bump"); void pill.offsetWidth; pill.classList.add("bump"); }
  }
  function toast(msg) {
    toastBox.textContent = msg;
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.hidden = true; }, 6000);
  }

  // ---- raising the issue
  function defaultTitle(list) {
    var tables = uniq(list.map(function (r) { return M.tableLabel(r.table); }));
    return "Housekeeping: " + plural(list.length, "fix") + " across " + tables.slice(0, 3).join(", ") + (tables.length > 3 ? " and " + (tables.length - 3) + " more" : "");
  }
  // One short checklist line per item, so long lists fit in the link. The housekeeping-details workflow adds each
  // item's description after Submit.
  function itemsMarkdown(list) {
    return list.slice().sort(function (a, b) {
      return SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || ctx.ruleName(a.rule).localeCompare(ctx.ruleName(b.rule)) ||
             ctx.sortTables(a.table, b.table) || a.object.localeCompare(b.object);
    }).map(function (r) { return r.item; }).join("\n");
  }
  function issueUrl(title, items, notes) {
    var p = new URLSearchParams();
    p.set("template", "housekeeping.yml");
    p.set("title", title);
    p.set("items", items);
    if (notes) p.set("notes", notes);
    return "https://github.com/" + ctx.repo + "/issues/new?" + p.toString();
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
  function createIssue() {
    var list = basketRows(), title = (meta.title || "").trim() || defaultTitle(list);
    var items = itemsMarkdown(list), notes = (meta.notes || "").trim(), url = issueUrl(title, items, notes);
    if (url.length <= LINK_LIMIT) {
      window.open(url, "_blank", "noopener");
      toast("GitHub opened in a new tab with the issue filled in. Press Submit there.");
      return;
    }
    // Too long for a link: copy the list, and open GitHub straight away (opening later would be popup-blocked).
    var copied = copySync(items);
    window.open(issueUrl(title, "Paste the list from your clipboard here (it was too long to send in the link).", notes), "_blank", "noopener");
    toast(copied ? "The list was too long for a link, so it is on your clipboard. Paste it into Items on GitHub, then press Submit."
                 : "The list was too long for a link and your browser blocked the clipboard. Use Copy as Markdown here, then paste it into Items on GitHub.");
  }

  // ---- the list panel
  function drawList(panel) {
    panel.classList.add("is-list");
    var list = basketRows(), tables = uniq(list.map(function (r) { return r.table; }));
    panel.appendChild(el("div", { class: "rpt-drawer-head hk-head" }, [
      el("div", {}, [el("h2", { id: "rpt-drawer-title" }, [el("span", { "aria-hidden": "true", text: "🧹 " }), "Housekeeping list"]),
        el("p", { class: "rpt-sub", text: list.length ? plural(list.length, "item") + " across " + plural(tables.length, "table") + ". Kept in this browser until you raise it."
                                                       : "Nothing picked yet." })]),
      ctx.closeButton()]));
    var body = el("div", { class: "rpt-drawer-body hk-body" });
    panel.appendChild(body);
    if (!list.length) {
      body.appendChild(el("div", { class: "hk-empty" }, [
        el("p", { class: "hk-empty-icon", "aria-hidden": "true", text: "🧹" }),
        el("p", { text: "Click + next to a failing object, or Add all on a rule, to collect clean-up work. Then raise it as one GitHub issue." })]));
      return;
    }
    var titleIn = el("input", { type: "text", class: "hk-input", id: "hk-title", value: meta.title || defaultTitle(list) });
    titleIn.addEventListener("input", function () { meta.title = titleIn.value; save(); });
    var notesIn = el("textarea", { class: "hk-input", id: "hk-notes", rows: "2", placeholder: "Optional: context for whoever picks this up" });
    notesIn.value = meta.notes || "";
    notesIn.addEventListener("input", function () { meta.notes = notesIn.value; save(); });
    body.appendChild(el("div", { class: "hk-fields" }, [
      el("label", { for: "hk-title", text: "Issue title" }), titleIn, el("label", { for: "hk-notes", text: "Notes" }), notesIn]));

    var groups = el("div", { class: "hk-groups" }), g = {};
    list.forEach(function (r) { (g[r.rule] = g[r.rule] || []).push(r); });
    Object.keys(g).sort(function (a, b) {
      return SEV_ORDER[g[a][0].severity] - SEV_ORDER[g[b][0].severity] || ctx.ruleName(a).localeCompare(ctx.ruleName(b));
    }).forEach(function (id) {
      var rule = ctx.ruleById[id] || {};
      groups.appendChild(el("section", { class: "hk-group sev-edge-" + rule.severity }, [
        el("div", { class: "hk-group-head" }, [M.sevChip(rule.severity), el("strong", { text: ctx.ruleName(id) }), el("span", { class: "rpt-count", text: String(g[id].length) })]),
        el("p", { class: "hk-rule-desc", text: ctx.ruleText(id) }),
        rule.fix ? el("p", { class: "hk-fix" }, [el("span", { class: "hk-fix-label", text: "How to fix " }), rule.fix]) : null,
        el("ul", { class: "hk-items" }, g[id].map(function (r) {
          return el("li", {}, [ctx.objectLink(r),
            el("button", { type: "button", class: "hk-remove", "aria-label": "Remove " + ctx.objectText(r), title: "Remove", text: "×",
                           onclick: function () { setInBasket([keyOf(r)], false); } })]);
        }))]));
    });
    body.appendChild(groups);

    var create = el("button", { type: "button", class: "hk-primary", disabled: ctx.repo ? null : "" },
      [el("span", { "aria-hidden": "true", text: "↗ " }), "Create issue on GitHub"]);
    create.addEventListener("click", createIssue);
    var copy = el("button", { type: "button", class: "rpt-data-btn", text: "Copy as Markdown", onclick: function () {
      toast(copySync(itemsMarkdown(basketRows())) ? "Copied. Paste it into any GitHub issue or comment." : "Your browser blocked the clipboard.");
    } });
    var clearBtn = el("button", { type: "button", class: "rpt-data-btn hk-clear", text: "Clear list", onclick: function () {
      if (confirm("Remove all " + plural(basket.length, "item") + " from your housekeeping list?")) setInBasket(basket.slice(), false);
    } });
    panel.appendChild(el("div", { class: "hk-foot" }, [
      el("p", { class: "hk-how" }, ctx.repo ? [
        "Opens a pre-filled ", el("strong", { text: "Housekeeping" }), " issue on GitHub. Press ", el("strong", { text: "Submit" }),
        " there. A description of every item (the rule, what is breaking it and how to fix it) is added to the issue automatically. Then use ",
        el("strong", { text: "Development → Create a branch" }), " on the issue to start the work."]
        : ["This site does not know its GitHub repository, so it can't open an issue. Use Copy as Markdown instead."]),
      el("div", { class: "hk-actions" }, [create, copy, clearBtn])]));
  }

  // ---- set up
  ctx.rows.forEach(function (r) { byKey[keyOf(r)] = r; });
  var dropped = load();
  pill = el("button", { type: "button", class: "hk-pill", hidden: "", "aria-haspopup": "dialog" });
  pill.addEventListener("click", function () { ctx.openDrawer(drawList, pill); });
  pill.addEventListener("animationend", function () { pill.classList.remove("bump"); });
  toastBox = el("div", { class: "hk-toast", role: "status", "aria-live": "polite", hidden: "" });
  document.body.appendChild(pill);
  document.body.appendChild(toastBox);
  updatePill(false);
  if (dropped) toast(plural(dropped, "item") + " in your housekeeping list " + (dropped === 1 ? "has" : "have") +
                     " since been raised in an issue, so " + (dropped === 1 ? "it was" : "they were") + " taken off your list.");

  return { addButton: addButton, addAllButton: addAllButton, statusTag: statusTag };
};
