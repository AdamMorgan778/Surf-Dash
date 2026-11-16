"""Turn build/*.json into the markdown pages and data files under docs/.

The generated pages live in docs/documentation/ (bus matrix, catalogue, glossary, and the dictionary with a page per
table), so the sidebar shows them as one Documentation section. docs/documentation/index.md is hand-written."""
import json
import os
import shutil

from fetch_issues import match_tables
from gaps import gaps
from housekeeping import annotate
from planning import build as build_planning
from tmdl import BUILD, ROOT, settings
from work import collect

DOCS = os.path.join(ROOT, "docs")
SECTION = os.path.join(DOCS, "documentation")
OLD = ["dictionary", "catalogue.md", "bus-matrix.md", "glossary.md"]   # where these pages were before the section existed
MISSING = "*Missing*"


def load(name):
    with open(os.path.join(BUILD, name), encoding="utf-8") as f:
        return json.load(f)


def cell(text):
    return str(text if text not in (None, "") else "").replace("|", "\\|").replace("\n", " ")


def table(header, rows):
    if not rows:
        return "*None.*\n"
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def column_notes(c, rel_by_from):
    notes = []
    if c["isKey"] or c["isPrimaryKey"]:
        notes.append("Key")
    if c["isForeignKey"]:
        notes.append("Joins to " + ", ".join(f"[{t}]({t}.md)" for t in rel_by_from.get(c["name"], [])))
    if c["isHidden"]:
        notes.append("Hidden")
    if c["sortByColumn"]:
        notes.append(f"Sorted by {c['sortByColumn']}")
    if c["dataCategory"]:
        notes.append(c["dataCategory"])
    return "; ".join(notes)


def table_page(t, model, results, issues):
    meta = t["meta"]
    rels = [r for r in model["relationships"] if t["name"] in (r["fromTable"], r["toTable"])]
    rel_by_from = {}
    for r in rels:
        if r["fromTable"] == t["name"]:
            rel_by_from.setdefault(r["fromColumn"], []).append(r["toTable"])
    options = "".join(f'<option value="../{n}/"{" selected" if n == t["name"] else ""}>{n}</option>'
                      for n in sorted(x["name"] for x in model["tables"]))
    L = [f"# {t['name']}", "",
         f'<p class="doc-crumb"><a href="../">Data dictionary</a> › <label>Table <select class="doc-switch">{options}</select></label></p>',
         "", t["description"] or MISSING, ""]
    facts = [("Type", t["kind"].capitalize()), ("Business process", meta.get("business_process")), ("Grain", meta.get("grain")),
             ("Owner", meta.get("owner")), ("Steward", meta.get("steward")), ("Source", t["source"]),
             ("Rows", f"{t['rowCount']:,}" if t["rowCount"] is not None else None),
             ("Sensitivity", meta.get("sensitivity")),
             ("Definition", f"[{t['file']}]({t['link']})" if t["link"] else f"`{t['file']}`")]
    L += [table(["Property", "Value"], [f for f in facts if f[1]]), "## Columns", ""]
    L += [table(["Column", "Type", "Format", "Description", "Notes"],
                [[f"`{c['name']}`", c["dataType"], f"`{c['formatString']}`" if c["formatString"] else "",
                  c["description"] or MISSING, column_notes(c, rel_by_from)] for c in t["columns"]])]
    if t["measures"]:
        L += ["## Measures", "", table(["Measure", "Format", "Folder", "Description"],
                                       [[f"`{m['name']}`", f"`{m['formatString']}`" if m["formatString"] else "",
                                         m["displayFolder"], m["description"] or MISSING] for m in t["measures"]]),
              "### DAX", "", "```dax"]
        L += [f"{m['name']} = {m['expression']}" for m in t["measures"]] + ["```", ""]
        L += ["### Dependencies", "", "What each measure is built from, and which measures would change if it changed.", "",
              table(["Measure", "Uses", "Used by"], [
                  [f"`{m['name']}`", ", ".join(f"`{x}`" for x in m["dependsOn"]["measures"] + m["dependsOn"]["columns"]),
                   ", ".join(f"`{x}`" for x in m["usedBy"])] for m in t["measures"]])]
    L += ["## Relationships", "", table(["From (many)", "To (one)", "Filter direction", "Active"], [
        [f"[{r['fromTable']}]({r['fromTable']}.md)[{r['fromColumn']}]", f"[{r['toTable']}]({r['toTable']}.md)[{r['toColumn']}]",
         "Both" if r["crossFilter"] == "bothDirections" else "Single", "Yes" if r["isActive"] else "No"] for r in rels])]
    rule_text = {r["id"]: r["description"] for r in results["rules"]}
    order = {"error": 0, "warning": 1, "info": 2}
    fails = sorted((r for r in results["results"] if r["table"] == t["name"]),
                   key=lambda r: (order[r["severity"]], r["category"], r["object"]))
    L += ["## Rule failures", "", table(["Object", "Rule", "Category", "Severity"], [
        [f"[`{r['object']}`]({r['link']})" if r["link"] else f"`{r['object']}`", rule_text[r["rule"]],
         r.get("category", ""), r["severity"].capitalize()]
        for r in fails])]
    open_issues = [i for i in issues["issues"] if i["table"] == t["name"] and i["state"] == "open"]
    L += ["## Open issues", "", table(["Issue", "Title", "Type", "Priority"], [
        [f"[#{i['number']}]({i['url']})", i["title"], i["requestType"], i["priority"]] for i in open_issues])]
    return "\n".join(L)


def coverage(t):
    """(described, total) over the table itself, its visible columns and its measures."""
    objs = [t] + [c for c in t["columns"] if not c["isHidden"]] + t["measures"]
    return sum(1 for o in objs if o["description"]), len(objs)


def _filter(target, placeholder, label):
    return f'<input class="doc-filter" type="search" data-filter="#{target}" placeholder="{placeholder}" aria-label="{label}">'


def dictionary_index(model):
    tables = []
    for t in sorted(model["tables"], key=lambda t: t["name"]):
        d, n = coverage(t)
        tables.append([f"[{t['name']}]({t['name']}.md)", t["kind"].capitalize(), len(t["columns"]), len(t["measures"]),
                       f"{round(100 * d / n) if n else 0}%", t["description"] or MISSING])
    rows = []
    for t in model["tables"]:
        link = f"[{t['name']}]({t['name']}.md)"
        rows += [[link, f"`{c['name']}`", "Column" + (" (hidden)" if c["isHidden"] else ""), c["dataType"],
                  c["description"] or MISSING] for c in t["columns"]]
        rows += [[link, f"`{m['name']}`", "Measure", m["formatString"] and f"`{m['formatString']}`",
                  m["description"] or MISSING] for m in t["measures"]]
    return "\n".join([
        "# Data dictionary", "",
        f"Every table, column and measure in the **{model['name']}** model. Generated from the TMDL on {model['generated']}.", "",
        "## Tables", "", "Open a table for its columns, measures, DAX, relationships and rule failures.", "",
        _filter("dict-tables", "Filter tables", "Filter the tables"), "",
        '<div id="dict-tables" class="doc-scroll" markdown="1">', "",
        table(["Table", "Type", "Columns", "Measures", "Described", "Description"], tables), "</div>", "",
        "## All fields", "",
        _filter("dict-fields", "Filter fields, for example revenue or key", "Filter the fields"), "",
        '<div id="dict-fields" class="doc-scroll doc-scroll-tall" markdown="1">', "",
        table(["Table", "Field", "Kind", "Type / format", "Description"], rows), "</div>"])


def catalogue(model):
    L = ["# Data catalogue", "", "One entry per table in the model: what it holds, where it comes from and who looks after it.", "",
         table(["Table", "Type", "Rows", "Owner", "Description"], [
             [f"[{t['name']}](dictionary/{t['name']}.md)", t["kind"].capitalize(),
              f"{t['rowCount']:,}" if t["rowCount"] is not None else "", t["meta"].get("owner"), t["description"] or MISSING]
             for t in model["tables"]])]
    for t in model["tables"]:
        m = t["meta"]
        visible = sum(1 for c in t["columns"] if not c["isHidden"])
        L += [f"## {t['name']}", "", t["description"] or MISSING, "", table(["Property", "Value"], [f for f in [
            ("Type", t["kind"].capitalize()), ("Business process", m.get("business_process")), ("Grain", m.get("grain")),
            ("Owner", m.get("owner")), ("Steward", m.get("steward")), ("Source", t["source"]),
            ("Refresh", m.get("refresh")), ("Rows", f"{t['rowCount']:,}" if t["rowCount"] is not None else None),
            ("Columns", f"{len(t['columns'])} ({visible} visible)"), ("Measures", len(t["measures"]) or None),
            ("Sensitivity", m.get("sensitivity")), ("Tags", ", ".join(m.get("tags", []))),
            ("Dictionary", f"[{t['name']} fields](dictionary/{t['name']}.md)")] if f[1]])]
    return "\n".join(L)


def bus_matrix(model):
    facts = [t for t in model["tables"] if t["kind"] == "fact"]
    dims = [t for t in model["tables"] if t["kind"] == "dimension"]
    joins = {(r["fromTable"], r["toTable"]) for r in model["relationships"]}
    rows = [[f"{t['meta'].get('business_process', t['name'])} ([{t['name']}](dictionary/{t['name']}.md))"]
            + ["✓" if (t["name"], d["name"]) in joins else "" for d in dims] for t in facts]
    used = {d["name"]: [f["name"] for f in facts if (f["name"], d["name"]) in joins] for d in dims}
    return "\n".join([
        "# Bus matrix", "",
        "Which dimensions describe which business process. A tick means the fact table has a relationship to that dimension.", "",
        table(["Business process"] + [d["name"] for d in dims], rows),
        "## Fact tables", "",
        table(["Fact table", "Business process", "Grain", "Measures"], [
            [f"[{t['name']}](dictionary/{t['name']}.md)", t["meta"].get("business_process"), t["meta"].get("grain"), len(t["measures"])]
            for t in facts]),
        "## Dimensions", "",
        "A conformed dimension is shared by more than one fact table, so results from those facts can be compared side by side.", "",
        table(["Dimension", "Used by", "Conformed"], [
            [f"[{d['name']}](dictionary/{d['name']}.md)", ", ".join(used[d["name"]]), "Yes" if len(used[d["name"]]) > 1 else "No"]
            for d in dims])])


BPA_SOURCE = "https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules"


def rules_page(results):
    counts = {}
    for row in results["counts"]:
        c = counts.setdefault(row["rule"], {"pass": 0, "fail": 0})
        c["pass"] += row["pass"]
        c["fail"] += row["fail"]
    rules = results["rules"]
    L = ["# Rule library", "",
         "What each rule checks and how to fix a failure. For charts, filters and the failing objects, see the "
         "[Best practice report](index.md).", "",
         f"The {len(rules)} rules the model is checked against on every build. "
         f"{sum(1 for r in rules if r.get('bpaId'))} of them match a rule in Microsoft's "
         f"[Best Practice Analyzer rule set]({BPA_SOURCE}) (BPA) and carry its ID. The rest are this project's own "
         "documentation and naming rules.", "",
         "Rules, their severities and their settings are in `rules.json`; the checks are written in Python in `tools/run_rules.py`. "
         "BPA rules that need Vertipaq statistics or a live model, or that cover features this model does not use "
         "(row-level security, calculation groups, DirectQuery and similar), are not included.", "",
         table(["Severity", "Failing", "Passing"], [
             [s.capitalize(), results["failures"][s],
              sum(counts.get(r["id"], {}).get("pass", 0) for r in rules if r["severity"] == s)]
             for s in ("error", "warning", "info")])]
    for cat in sorted({r.get("category") or "Other" for r in rules}):
        L += [f"## {cat}", "", table(["Rule", "What it checks", "How to fix", "Severity", "Failing", "Passing", "BPA rule"], [
            [f"**{r.get('name', r['id'])}**", r["description"], r.get("fix", ""), r["severity"].capitalize(), counts.get(r["id"], {}).get("fail", 0),
             counts.get(r["id"], {}).get("pass", 0), f"`{r['bpaId']}`" if r.get("bpaId") else "Project rule"]
            for r in rules if (r.get("category") or "Other") == cat])]
    return "\n".join(L)


def glossary(model):
    terms = sorted(model.get("glossary") or [], key=lambda t: t["term"].lower())
    return "\n".join(["# Glossary", "", "Business terms used in the model.", "",
                      table(["Term", "Definition", "Where it appears"],
                            [[f"**{t['term']}**", t["definition"], ", ".join(f"`{r}`" for r in t.get("related", []))] for t in terms])])


DOC_CATEGORY = "Documentation"   # rules in this category are shown with the documentation, not with best practice


def best_practice(results):
    """Pass rate over the checks of every rule outside the Documentation category."""
    doc = {r["id"] for r in results["rules"] if r.get("category") == DOC_CATEGORY}
    passed = sum(c["pass"] for c in results["counts"] if c["rule"] not in doc)
    total = passed + sum(c["fail"] for c in results["counts"] if c["rule"] not in doc)
    return {"pass": passed, "total": total, "pct": round(100 * passed / total, 1) if total else 0.0}


def summary(model, results):
    """The few facts about the model that the site's pages need. The full model.json stays in build/."""
    tables = []
    for t in model["tables"]:
        d, n = coverage(t)
        tables.append({"name": t["name"], "kind": t["kind"], "owner": t["meta"].get("owner", ""),
                       "columns": len(t["columns"]), "measures": len(t["measures"]), "described": d, "total": n})
    return {"name": model["name"], "siteName": model["siteName"], "repo": model["repo"], "generated": model["generated"],
            "score": results["score"], "bestPractice": best_practice(results), "failures": results["failures"],
            "tables": tables}   # work.json has its own file


def write_json(name, data):
    os.makedirs(os.path.join(DOCS, "data"), exist_ok=True)
    with open(os.path.join(DOCS, "data", name), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


def main():
    model, results, issues = load("model.json"), load("results.json"), load("issues.json")
    match_tables(issues["issues"], [t["name"] for t in model["tables"]])
    annotate(results, issues["issues"])
    for name in OLD:   # generated files left in a working copy from the old layout would be built as extra pages
        path = os.path.join(DOCS, name)
        shutil.rmtree(path, ignore_errors=True) if os.path.isdir(path) else os.path.exists(path) and os.remove(path)
    shutil.rmtree(os.path.join(SECTION, "dictionary"), ignore_errors=True)
    shutil.rmtree(os.path.join(DOCS, "data"), ignore_errors=True)
    write(os.path.join(SECTION, "dictionary", "index.md"), dictionary_index(model))
    for t in model["tables"]:
        write(os.path.join(SECTION, "dictionary", f"{t['name']}.md"), table_page(t, model, results, issues))
    write(os.path.join(SECTION, "catalogue.md"), catalogue(model))
    write(os.path.join(SECTION, "bus-matrix.md"), bus_matrix(model))
    write(os.path.join(SECTION, "glossary.md"), glossary(model))
    write(os.path.join(DOCS, "rules", "reference.md"), rules_page(results))
    work = collect(model, issues)
    write_json("summary.json", {**summary(model, results), "work": {"items": len(work["items"]), "people": len(work["people"]),
                                                                     "overlaps": len(work["overlaps"])}})
    write_json("results.json", results)
    write_json("issues.json", issues)
    plan = build_planning(issues["issues"], model)
    write_json("planning.json", plan)
    print(f"planning: {len(plan['requirements'])} requirements, {plan['totals']['pct']}% complete")
    write_json("gaps.json", gaps(model, settings().get("catalogue_fields")))
    write_json("work.json", work)
    print(f"work: {len(work['branches'])} unmerged branches, {len(work['items'])} items, {len(work['overlaps'])} overlaps"
          + (f". NOTE: {work['note']}" if work["note"] else ""))
    print(f"docs: {len(model['tables'])} table pages, dictionary index, catalogue, bus matrix, glossary, rule library")


if __name__ == "__main__":
    main()
