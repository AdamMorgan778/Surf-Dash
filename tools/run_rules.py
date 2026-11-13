"""Apply rules.json to build/model.json and write build/results.json."""
import json
import os
import re

from tmdl import BUILD, ROOT

NUMERIC = {"int64", "double", "decimal"}
SMALL_WORDS = {"in", "per", "of", "vs", "and", "the", "to", "by", "on", "at", "for"}
PASCAL = re.compile(r"^[A-Z][A-Za-z0-9]*$")


def _row(obj, typ, table, ok, link):
    return {"object": obj, "type": typ, "table": table, "status": "pass" if ok else "fail", "link": link}


def _columns(model, visible_only=False):
    for t in model["tables"]:
        for c in t["columns"]:
            if not (visible_only and c["isHidden"]):
                yield t, c


def _measures(model):
    for t in model["tables"]:
        for m in t["measures"]:
            yield t, m


def table_description(model):
    return [_row(t["name"], "table", t["name"], bool(t["description"]), t["link"]) for t in model["tables"]]


def column_description(model):
    return [_row(c["name"], "column", t["name"], bool(c["description"]), c["link"]) for t, c in _columns(model, True)]


def measure_description(model):
    return [_row(m["name"], "measure", t["name"], bool(m["description"]), m["link"]) for t, m in _measures(model)]


def measure_format(model):
    return [_row(m["name"], "measure", t["name"], bool(m["formatString"]), m["link"]) for t, m in _measures(model)]


def date_table_marked(model):
    rows = []
    for t in model["tables"]:
        looks_like_date = re.search(r"date|calendar", t["name"], re.I)
        if t["dataCategory"] == "Time" or looks_like_date:
            ok = t["dataCategory"] == "Time" and any(c["isKey"] and c["dataType"] == "dateTime" for c in t["columns"])
            rows.append(_row(t["name"], "table", t["name"], ok, t["link"]))
    return rows


def fk_hidden(model):
    return [_row(c["name"], "column", t["name"], c["isHidden"], c["link"]) for t, c in _columns(model) if c["isForeignKey"]]


def table_naming(model):
    return [_row(t["name"], "table", t["name"], bool(re.match(r"^(Dim|Fact)[A-Z][A-Za-z0-9]*$", t["name"])), t["link"])
            for t in model["tables"]]


def column_naming(model):
    return [_row(c["name"], "column", t["name"], bool(PASCAL.match(c["name"])), c["link"]) for t, c in _columns(model)]


def _title_case(name):
    words = name.split(" ")
    if not name or "" in words:
        return False
    for i, w in enumerate(words):
        if w == "%" or re.match(r"^\(.+\)$", w) or (i > 0 and w in SMALL_WORDS):
            continue
        if not re.match(r"^[A-Z0-9][A-Za-z0-9]*$", w):
            return False
    return True


def measure_naming(model):
    return [_row(m["name"], "measure", t["name"], _title_case(m["name"]), m["link"]) for t, m in _measures(model)]


def column_table_prefix(model):
    return [_row(c["name"], "column", t["name"], not c["name"].lower().startswith(t["name"].lower()), c["link"])
            for t, c in _columns(model)]


def no_bidirectional(model):
    return [_row(f"{r['fromTable']}[{r['fromColumn']}] to {r['toTable']}[{r['toColumn']}]", "relationship",
                 r["fromTable"], r["crossFilter"] != "bothDirections", r["link"]) for r in model["relationships"]]


def implicit_measure(model):
    return [_row(c["name"], "column", t["name"], c["summarizeBy"] in ("none", ""), c["link"])
            for t, c in _columns(model, True) if t["kind"] == "fact" and c["dataType"] in NUMERIC]


CHECKS = {f.__name__: f for f in (table_description, column_description, measure_description, measure_format,
                                  date_table_marked, fk_hidden, table_naming, column_naming, measure_naming,
                                  column_table_prefix, no_bidirectional, implicit_measure)}


def documentation_score(model):
    objs = [t for t in model["tables"]] + [c for _, c in _columns(model, True)] + [m for _, m in _measures(model)]
    described = sum(1 for o in objs if o["description"])
    return {"described": described, "total": len(objs), "pct": round(100 * described / len(objs), 1) if objs else 0.0}


def run(model, rules):
    results = []
    for rule in rules:
        for row in CHECKS[rule["check"]](model):
            results.append({**row, "rule": rule["id"], "severity": rule["severity"]})
    fails = {s: sum(1 for r in results if r["status"] == "fail" and r["severity"] == s) for s in ("error", "warning", "info")}
    return {"generated": model.get("generated", ""), "score": documentation_score(model), "failures": fails,
            "rules": rules, "results": results}


def main():
    with open(os.path.join(BUILD, "model.json"), encoding="utf-8") as f:
        model = json.load(f)
    with open(os.path.join(ROOT, "rules.json"), encoding="utf-8") as f:
        rules = json.load(f)
    out = run(model, rules)
    with open(os.path.join(BUILD, "results.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    s, fl = out["score"], out["failures"]
    print(f"results.json: score {s['pct']}% ({s['described']}/{s['total']}), "
          f"failures: {fl['error']} error, {fl['warning']} warning, {fl['info']} info")


if __name__ == "__main__":
    main()
