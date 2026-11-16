// Work in progress page: who is changing what, so people can avoid each other's work and prevent merge conflicts.
// Reads docs/data/work.json (worked out in tools/work.py from unmerged branches, housekeeping issues in progress and
// "Working on" claims) and draws it with the shared parts in ui.js. Ticking tables or report pages and pressing
// Claim selected opens a pre-filled Working on issue on GitHub.
(function () {
  var M = window.ModelDocs, el = M.el, plural = M.plural;
  var SOURCE = { branch: "Branch", housekeeping: "Housekeeping issue", claim: "Claim" };
  var AREA = { table: "Table", page: "Report page", shared: "Shared files" };
  var CHANGE = { added: "Added", changed: "Changed", removed: "Removed", housekeeping: "Housekeeping fix", claimed: "Claimed" };

  function where(p) {   // a link to the branch, pull request or issue
    var text = p.source === "branch" ? p.ref + (p.pr ? " (#" + p.pr + ")" : "") : p.ref;
    return p.url ? el("a", { href: p.url, text: text, title: SOURCE[p.source] }) : el("span", { text: text });
  }
  function workers(list) {
    if (!list.length) return el("span", { class: "work-free", text: "Free" });
    var out = el("span", { class: "work-busy" });
    list.forEach(function (w, i) {
      if (i) out.appendChild(document.createTextNode("; "));
      out.appendChild(document.createTextNode((w.who || SOURCE[w.source]) + " · "));
      out.appendChild(where(w));
    });
    return out;
  }

  function draw(app, work) {
    M.clear(app);
    var picked = {};   // "kind|name" -> true, the areas ticked for a claim
    var objects = work.items.filter(function (i) { return i.source !== "claim"; }).length;
    app.appendChild(el("div", { class: "dash-tiles" }, [
      { label: "Unmerged branches", value: work.branches.length, sub: "with changes to the model or report" },
      { label: "People", value: work.people.length, sub: work.people.join(", ") || "nobody has work in progress" },
      { label: "Objects being changed", value: objects, sub: plural(work.items.length - objects, "claim") + " on tables or pages" },
      { label: "Overlaps", value: work.overlaps.length, sub: work.overlaps.length ? "more than one person on the same thing" : "no two people on the same thing" }
    ].map(M.tile)));

    var canvas = el("div", { class: "rpt-canvas home-canvas" });
    app.appendChild(canvas);

    if (work.overlaps.length) {
      var ov = M.visual(canvas, "Overlaps (" + work.overlaps.length + ")", { cls: "work-overlaps",
        sub: "The same thing in more than one person's hands. Agree who goes first before either of you merges." });
      var ovSort = { key: "area", dir: 1 };
      (function table() {
        M.sortable(ov, ovSort, [
          { key: "area", label: "Where", cell: function (o) { return o.area; } },
          { key: "object", label: "What", cell: function (o) { return M.cap(o.kind) + " " + o.object; } },
          { key: "reason", label: "Why", cell: function (o) { return o.reason; } },
          { key: "", label: "Who", cell: function (o) { return workers(o.parties); } }
        ], work.overlaps.map(function (o) { o._tie = o.area + o.object; return o; }), { height: "20rem", onSort: table, empty: "" });
      })();
    }

    // every table and report page: free, or who is on it; tick to claim
    var claim = el("button", { type: "button", class: "hk-primary work-claim", disabled: "" });
    var areasHost = M.visual(canvas, "Tables and report pages", {
      sub: "Free means nobody has a branch, a housekeeping fix or a claim on it. Tick what you are about to change, then claim it." });
    var areaSort = { key: "busy", dir: -1 };
    function paintClaim() {
      var n = Object.keys(picked).length;
      claim.disabled = !n || !work.repo;
      claim.textContent = n ? "Claim selected (" + n + ")" : "Claim selected";
      claim.title = work.repo ? "Opens a pre-filled Working on issue on GitHub" : "This site does not know its GitHub repository";
    }
    function drawAreas() {
      M.sortable(areasHost, areaSort, [
        { key: "", label: "", cls: "expand-col", cell: function (a) {
            if (a.kind === "shared") return "";
            var box = el("input", { type: "checkbox", "aria-label": "Claim " + a.name, checked: picked[a.kind + "|" + a.name] ? "" : null });
            box.addEventListener("change", function () {
              if (box.checked) picked[a.kind + "|" + a.name] = true; else delete picked[a.kind + "|" + a.name];
              paintClaim();
            });
            return box; } },
        { key: "kindLabel", label: "Kind", cell: function (a) { return a.kindLabel; } },
        { key: "name", label: "Name", cell: function (a) { return a.name; } },
        { key: "busy", label: "Being changed", num: true, cell: function (a) { return a.items || ""; } },
        { key: "", label: "Who and where", cell: function (a) { return workers(a.workers); } }
      ], work.areas.map(function (a) { a.kindLabel = AREA[a.kind]; a.busy = a.items; a._tie = a.kindLabel + a.name; return a; }),
      { height: "30rem", onSort: drawAreas, empty: "The model has no tables." });
    }
    drawAreas();
    claim.addEventListener("click", function () {
      var keys = Object.keys(picked).sort(), names = keys.map(function (k) { return k.split("|").slice(1).join("|"); });
      var p = new URLSearchParams();
      p.set("template", "working-on.yml");
      p.set("title", "Working on: " + names.slice(0, 4).join(", ") + (names.length > 4 ? " and " + (names.length - 4) + " more" : ""));
      p.set("items", keys.map(function (k, i) { return "- " + (k.indexOf("table|") === 0 ? "Table" : "Report page") + " · " + names[i]; }).join("\n"));
      window.open("https://github.com/" + work.repo + "/issues/new?" + p.toString(), "_blank", "noopener");
    });
    areasHost.appendChild(el("p", { class: "rpt-more" }, [claim, el("span", { class: "rpt-hint work-claim-hint",
      text: " Opens an issue on GitHub; press Submit there. Close the issue when your work is merged to release the claim." })]));
    paintClaim();

    // every change, one row each
    var all = M.visual(canvas, "All changes", {});
    var allSort = { key: "area", dir: 1 }, q = "", tableHost = el("div");
    var search = el("input", { type: "search", class: "doc-filter", placeholder: "Table, object, person or branch", "aria-label": "Search changes" });
    search.addEventListener("input", function () { q = search.value.trim().toLowerCase(); drawAll(); });
    all.appendChild(el("div", { class: "rpt-toolbar" }, [el("label", {}, ["Search ", search])]));
    all.appendChild(tableHost);
    function drawAll() {
      var rows = work.items.filter(function (i) {
        return !q || (i.area + " " + i.object + " " + i.kind + " " + i.who + " " + i.ref + " " + CHANGE[i.change]).toLowerCase().indexOf(q) !== -1;
      });
      all.parentNode.querySelector("h3").textContent = "All changes (" + rows.length + ")";
      M.sortable(tableHost, allSort, [
        { key: "area", label: "Table or page", cell: function (i) { return i.area; } },
        { key: "object", label: "Object", cell: function (i) { return i.object; } },
        { key: "kind", label: "Kind", cell: function (i) { return M.cap(i.kind); } },
        { key: "changeLabel", label: "Change", cell: function (i) { return i.changeLabel; } },
        { key: "who", label: "Who", cell: function (i) { return i.who; } },
        { key: "ref", label: "Where", cell: function (i) { return where(i); } },
        { key: "since", label: "Last change", cell: function (i) {
            return i.stale ? el("span", { class: "work-stale", text: i.since + " (stale)", title: "No commits for over " + work.staleDays + " days" }) : i.since; } }
      ], rows.map(function (i) { i.changeLabel = CHANGE[i.change] || i.change; i._tie = i.area + i.object + i.ref; return i; }),
      { height: "40rem", onSort: drawAll, empty: work.items.length ? "Nothing matches the search." : "Nothing is being worked on: no unmerged branches, housekeeping fixes in progress or claims." });
    }
    drawAll();
    app.appendChild(el("p", { class: "rpt-hint work-note", text: "Work that has not been pushed to GitHub does not show here, so claim what you are about to change." +
      (work.note ? " " + work.note : "") }));
  }

  M.ready(function () {
    var app = document.getElementById("work-app");
    if (!app) return;
    M.load(app.getAttribute("data-root") || "", ["work"]).then(function (d) { draw(app, d.work); })
      .catch(function (e) { M.clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the work data: " + e.message })); });
  });
})();
