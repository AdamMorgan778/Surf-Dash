"""Turn build/*.json and metadata/*.yaml into the markdown pages and data files under docs/."""
import json
import os
import shutil

import yaml

from tmdl import BUILD, ROOT

DOCS = os.path.join(ROOT, "docs")
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
    L = [f"# {t['name']}", "", t["description"] or MISSING, ""]
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
    L += ["## Relationships", "", table(["From (many)", "To (one)", "Filter direction", "Active"], [
        [f"[{r['fromTable']}]({r['fromTable']}.md)[{r['fromColumn']}]", f"[{r['toTable']}]({r['toTable']}.md)[{r['toColumn']}]",
         "Both" if r["crossFilter"] == "bothDirections" else "Single", "Yes" if r["isActive"] else "No"] for r in rels])]
    rule_text = {r["id"]: r["description"] for r in results["rules"]}
    order = {"error": 0, "warning": 1, "info": 2}
    fails = sorted((r for r in results["results"] if r["table"] == t["name"] and r["status"] == "fail"),
                   key=lambda r: (order[r["severity"]], r["category"], r["object"]))
    L += ["## Rule failures", "", table(["Object", "Rule", "Category", "Severity"], [
        [f"[`{r['object']}`]({r['link']})" if r["link"] else f"`{r['object']}`", rule_text[r["rule"]],
         r.get("category", ""), r["severity"].capitalize()]
        for r in fails])]
    open_issues = [i for i in issues["issues"] if i["table"] == t["name"] and i["state"] == "open"]
    L += ["## Open issues", "", table(["Issue", "Title", "Type", "Priority"], [
        [f"[#{i['number']}]({i['url']})", i["title"], i["requestType"], i["priority"]] for i in open_issues])]
    return "\n".join(L)


def dictionary_index(model):
    rows = []
    for t in model["tables"]:
        link = f"[{t['name']}]({t['name']}.md)"
        rows += [[link, f"`{c['name']}`", "Column" + (" (hidden)" if c["isHidden"] else ""), c["dataType"],
                  c["description"] or MISSING] for c in t["columns"]]
        rows += [[link, f"`{m['name']}`", "Measure", m["formatString"] and f"`{m['formatString']}`",
                  m["description"] or MISSING] for m in t["measures"]]
    return "\n".join([
        "# Data dictionary", "",
        f"Every column and measure in the **{model['name']}** model. Generated from the TMDL on {model['generated']}.", "",
        '<input id="dict-filter" class="doc-filter" type="search" placeholder="Filter fields, for example revenue or key" aria-label="Filter the dictionary">',
        "", table(["Table", "Field", "Kind", "Type / format", "Description"], rows)])


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
    for r in results["results"]:
        c = counts.setdefault(r["rule"], {"pass": 0, "fail": 0})
        c[r["status"]] += 1
    rules = results["rules"]
    L = ["# Rules", "",
         f"The {len(rules)} rules the model is checked against on every build. "
         f"{sum(1 for r in rules if r.get('bpaId'))} of them match a rule in Microsoft's "
         f"[Best Practice Analyzer rule set]({BPA_SOURCE}) (BPA) and carry its ID. The rest are this project's own "
         "documentation and naming rules.", "",
         "Rules are defined in `rules.json` and the checks are written in Python in `tools/run_rules.py`. "
         "BPA rules that need Vertipaq statistics or a live model, or that cover features this model does not use "
         "(row-level security, calculation groups, DirectQuery and similar), are not included.", "",
         table(["Severity", "Failing", "Passing"], [
             [s.capitalize(), results["failures"][s],
              sum(counts.get(r["id"], {}).get("pass", 0) for r in rules if r["severity"] == s)]
             for s in ("error", "warning", "info")])]
    for cat in sorted({r.get("category") or "Other" for r in rules}):
        L += [f"## {cat}", "", table(["Rule", "Severity", "Failing", "Passing", "BPA rule"], [
            [r["description"], r["severity"].capitalize(), counts.get(r["id"], {}).get("fail", 0),
             counts.get(r["id"], {}).get("pass", 0), f"`{r['bpaId']}`" if r.get("bpaId") else "Project rule"]
            for r in rules if (r.get("category") or "Other") == cat])]
    return "\n".join(L)


def glossary():
    path = os.path.join(ROOT, "metadata", "glossary.yaml")
    terms = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            terms = yaml.safe_load(f) or []
    terms.sort(key=lambda t: t["term"].lower())
    return "\n".join(["# Glossary", "", "Surf and business terms used in the model.", "",
                      table(["Term", "Definition", "Where it appears"],
                            [[f"**{t['term']}**", t["definition"], ", ".join(f"`{r}`" for r in t.get("related", []))] for t in terms])])


def main():
    model, results, issues = load("model.json"), load("results.json"), load("issues.json")
    shutil.rmtree(os.path.join(DOCS, "dictionary"), ignore_errors=True)
    write(os.path.join(DOCS, "dictionary", "index.md"), dictionary_index(model))
    for t in model["tables"]:
        write(os.path.join(DOCS, "dictionary", f"{t['name']}.md"), table_page(t, model, results, issues))
    write(os.path.join(DOCS, "catalogue.md"), catalogue(model))
    write(os.path.join(DOCS, "bus-matrix.md"), bus_matrix(model))
    write(os.path.join(DOCS, "glossary.md"), glossary())
    write(os.path.join(DOCS, "rules.md"), rules_page(results))
    os.makedirs(os.path.join(DOCS, "data"), exist_ok=True)
    for name in ("model.json", "results.json", "issues.json"):
        shutil.copyfile(os.path.join(BUILD, name), os.path.join(DOCS, "data", name))
    print(f"docs: {len(model['tables'])} table pages, dictionary index, catalogue, bus matrix, glossary, rules")


if __name__ == "__main__":
    main()
