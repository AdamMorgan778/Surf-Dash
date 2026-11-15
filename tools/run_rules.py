"""Apply rules.json to build/model.json and write build/results.json.

Each rule in rules.json names a `check`: a function in this file that takes the model and returns one row per
object in the rule's scope, with status pass or fail. A rule's optional `params` are passed to its check as keyword
arguments, and `"enabled": false` switches a rule off. results.json holds the failing rows and, for every rule and
table, how many checks passed and failed. Most of the checks below `# ---- Best Practice Analyzer`
are Python ports of rules in Microsoft's standard Tabular Editor BPA rule set; their BPA IDs are in rules.json.
They read only what the TMDL files hold, so BPA rules that need Vertipaq statistics or a live model are not here.
"""
import json
import os
import re

from dax import clean as _dax, refs as _refs
from housekeeping import MODEL_TABLE
from tmdl import BUILD, ROOT

NUMERIC = {"int64", "double", "decimal"}
SMALL_WORDS = {"in", "per", "of", "vs", "and", "the", "to", "by", "on", "at", "for"}
PASCAL = r"^[A-Z][A-Za-z0-9]*$"
DIM_FACT = r"^(Dim|Fact)[A-Z][A-Za-z0-9]*$"


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


def table_naming(model, pattern=DIM_FACT):
    return [_row(t["name"], "table", t["name"], bool(re.match(pattern, t["name"])), t["link"]) for t in model["tables"]]


def column_naming(model, pattern=PASCAL):
    return [_row(c["name"], "column", t["name"], bool(re.match(pattern, c["name"])), c["link"]) for t, c in _columns(model)]


def _title_case(name, small_words=SMALL_WORDS):
    words = name.split(" ")
    if not name or "" in words:
        return False
    for i, w in enumerate(words):
        if w == "%" or re.match(r"^\(.+\)$", w) or (i > 0 and w in small_words):
            continue
        if not re.match(r"^[A-Z0-9][A-Za-z0-9]*$", w):
            return False
    return True


def measure_naming(model, small_words=SMALL_WORDS):
    return [_row(m["name"], "measure", t["name"], _title_case(m["name"], set(small_words)), m["link"]) for t, m in _measures(model)]


def column_table_prefix(model):
    return [_row(c["name"], "column", t["name"], not c["name"].lower().startswith(t["name"].lower()), c["link"])
            for t, c in _columns(model)]


def no_bidirectional(model):
    return [_row(_rel_name(r), "relationship", r["fromTable"], r["crossFilter"] != "bothDirections", r["link"])
            for r in model["relationships"]]


def implicit_measure(model):
    # Columns a measure already aggregates are left to hide_fact_columns, so one problem is one failure.
    aggregated = _aggregated_columns(model)
    return [_row(c["name"], "column", t["name"], c["summarizeBy"] in ("none", ""), c["link"])
            for t, c in _columns(model, True)
            if t["kind"] == "fact" and c["dataType"] in NUMERIC and (t["name"].lower(), c["name"].lower()) not in aggregated]


def table_metadata(model, required=("owner", "grain")):
    return [_row(t["name"], "table", t["name"], all((t.get("meta") or {}).get(k) for k in required),
                 model.get("metadataLink", "")) for t in model["tables"]]


def _plain(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def description_quality(model, min_words=2):
    """A description that is there, but only repeats the name or is too short to say anything."""
    rows = []
    for typ, table, o in _objects(model):
        if typ == "partition" or not o.get("description") or (typ == "column" and o["isHidden"]):
            continue
        d = o["description"]
        rows.append(_row(o["name"], typ, table, _plain(d) != _plain(o["name"]) and len(d.split()) >= min_words, o["link"]))
    return rows


def metadata_references(model):
    """metadata/tables.yaml and the glossary only name things that are in the model."""
    tables = {t["name"]: t for t in model["tables"]}
    measures = {m["name"] for _, m in _measures(model)}
    rows = [_row(name, "metadata", name if name in tables else MODEL_TABLE, name in tables, model.get("metadataLink", ""))
            for name in model.get("metadataTables", [])]
    for term in model.get("glossary", []):
        for ref in term.get("related") or []:
            table, _, field = str(ref).partition(".")
            t = tables.get(table)
            ok = ref in measures or (t is not None and (not field or any(o["name"] == field for o in t["columns"] + t["measures"])))
            rows.append(_row(f"{term['term']}: {ref}", "glossary", MODEL_TABLE, ok, model.get("glossaryLink", "")))
    return rows


# ---- shared helpers for the BPA ports

def _rel_name(r):
    return f"{r['fromTable']}[{r['fromColumn']}] to {r['toTable']}[{r['toColumn']}]"


def _model_row(model, ok):
    name = model.get("name") or "Model"
    return _row(name, "model", MODEL_TABLE, ok, "")


def _objects(model):
    """Every named object: (type, table name, object). Partitions included."""
    for t in model["tables"]:
        yield "table", t["name"], t
        for c in t["columns"]:
            yield "column", t["name"], c
        for m in t["measures"]:
            yield "measure", t["name"], m
        for p in t.get("partitions", []):
            yield "partition", t["name"], p


def _names(model):
    measures = {m["name"].lower() for _, m in _measures(model)}
    columns = {(t["name"].lower(), c["name"].lower()) for t, c in _columns(model)}
    return measures, columns


def _dax_objects(model):
    """Objects that carry DAX: measures and calculated columns."""
    for t, m in _measures(model):
        yield "measure", t, m
    for t, c in _columns(model):
        if c.get("isCalculated"):
            yield "column", t, c


def _referenced_columns(model):
    """(table, column) pairs, lower case, referenced from any DAX expression."""
    used = set()
    for _, t, o in _dax_objects(model):
        for table, name in _refs(o["expression"]):
            used.add(((table or t["name"]).lower(), name.lower()))
    return used


# ---- Best Practice Analyzer: DAX expressions

def dax_columns_qualified(model):
    measures, _ = _names(model)
    return [_row(o["name"], typ, t["name"],
                 all(table or name.lower() in measures for table, name in _refs(o["expression"])), o["link"])
            for typ, t, o in _dax_objects(model)]


def dax_measures_unqualified(model):
    measures, columns = _names(model)

    def ok(expr):
        return not any(table and name.lower() in measures and (table.lower(), name.lower()) not in columns
                       for table, name in _refs(expr))
    return [_row(o["name"], typ, t["name"], ok(o["expression"]), o["link"]) for typ, t, o in _dax_objects(model)]


def duplicate_measures(model):
    norm = {}
    for _, m in _measures(model):
        key = re.sub(r"\s+", "", m["expression"] or "").lower()
        norm[key] = norm.get(key, 0) + 1
    return [_row(m["name"], "measure", t["name"],
                 not m["expression"] or norm[re.sub(r"\s+", "", m["expression"]).lower()] == 1, m["link"])
            for t, m in _measures(model)]


def use_divide(model):
    return [_row(o["name"], typ, t["name"], not re.search(r"[\])]\s*/", _dax(o["expression"])), o["link"])
            for typ, t, o in _dax_objects(model)]


def avoid_iferror(model):
    return [_row(o["name"], typ, t["name"], not re.search(r"\bIFERROR\s*\(", _dax(o["expression"]), re.I), o["link"])
            for typ, t, o in _dax_objects(model)]


def measure_direct_reference(model):
    measures, _ = _names(model)

    def ok(expr):
        m = re.fullmatch(r"\s*(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)?\[((?:[^\]]|\]\])+)\]\s*", _dax(expr))
        return not (m and m.group(1).replace("]]", "]").lower() in measures)
    return [_row(m["name"], "measure", t["name"], ok(m["expression"]), m["link"]) for t, m in _measures(model)]


def no_evaluateandlog(model):
    return [_row(m["name"], "measure", t["name"], not re.search(r"\bEVALUATEANDLOG\s*\(", _dax(m["expression"]), re.I),
                 m["link"]) for t, m in _measures(model)]


def use_treatas(model):
    return [_row(m["name"], "measure", t["name"], not re.search(r"\bINTERSECT\s*\(", _dax(m["expression"]), re.I),
                 m["link"]) for t, m in _measures(model)]


def inactive_relationship_used(model):
    activated = set()
    for _, _, o in _dax_objects(model):
        for args in re.findall(r"\bUSERELATIONSHIP\s*\(([^)]*)\)", _dax(o["expression"]), re.I):
            activated.add(frozenset((t or "").lower() + "|" + n.lower() for t, n in _refs(args)))
    return [_row(_rel_name(r), "relationship", r["fromTable"],
                 r["isActive"] or frozenset({f"{r['fromTable']}|{r['fromColumn']}".lower(),
                                             f"{r['toTable']}|{r['toColumn']}".lower()}) in activated, r["link"])
            for r in model["relationships"]]


# ---- Best Practice Analyzer: error prevention

def column_source_column(model):
    return [_row(c["name"], "column", t["name"], bool(c.get("sourceColumn")), c["link"])
            for t, c in _columns(model) if not c.get("isCalculated") and not t.get("isCalculated")]


def measure_expression(model):
    return [_row(m["name"], "measure", t["name"], bool((m["expression"] or "").strip()), m["link"]) for t, m in _measures(model)]


def relationship_same_type(model):
    return [_row(_rel_name(r), "relationship", r["fromTable"], r.get("fromDataType") == r.get("toDataType"), r["link"])
            for r in model["relationships"]]


_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def invalid_characters(model):
    return [_row(o["name"], typ, table, not _CONTROL.search(o["name"] + (o.get("description") or "")), o["link"])
            for typ, table, o in _objects(model)]


# ---- Best Practice Analyzer: maintenance

def table_has_relationship(model):
    related = {r["fromTable"] for r in model["relationships"]} | {r["toTable"] for r in model["relationships"]}
    return [_row(t["name"], "table", t["name"], t["name"] in related, t["link"]) for t in model["tables"]]


def unused_hidden_column(model):
    used = _referenced_columns(model)
    for r in model["relationships"]:
        used |= {(r["fromTable"].lower(), r["fromColumn"].lower()), (r["toTable"].lower(), r["toColumn"].lower())}
    for t, c in _columns(model):
        if c["sortByColumn"]:
            used.add((t["name"].lower(), c["sortByColumn"].lower()))
    return [_row(c["name"], "column", t["name"], (t["name"].lower(), c["name"].lower()) in used, c["link"])
            for t, c in _columns(model) if c["isHidden"]]


def unused_hidden_measure(model):
    refs = {name.lower() for _, _, o in _dax_objects(model) for _, name in _refs(o["expression"])}
    return [_row(m["name"], "measure", t["name"], m["name"].lower() in refs, m["link"])
            for t, m in _measures(model) if m.get("isHidden")]


# ---- Best Practice Analyzer: naming

def trim_names(model):
    return [_row(o["name"], typ, table, o["name"] == o["name"].strip(), o["link"]) for typ, table, o in _objects(model)]


def special_characters(model):
    return [_row(o["name"], typ, table, not re.search(r"[\t\r\n]", o["name"]), o["link"]) for typ, table, o in _objects(model)]


def first_letter_capital(model):
    return [_row(o["name"], typ, table, o["name"][:1] == o["name"][:1].upper(), o["link"])
            for typ, table, o in _objects(model)
            if typ in ("table", "measure") or (typ == "column" and o.get("isCalculated"))]


def partition_name(model):
    return [_row(t["partitions"][0]["name"], "partition", t["name"], t["partitions"][0]["name"] == t["name"],
                 t["partitions"][0]["link"]) for t in model["tables"] if len(t.get("partitions", [])) == 1]


# ---- Best Practice Analyzer: performance

def no_floating_point(model):
    return [_row(c["name"], "column", t["name"], c["dataType"] != "double", c["link"])
            for t, c in _columns(model) if c["dataType"] in NUMERIC]


def model_has_date_table(model):
    return [_model_row(model, any(t["dataCategory"] == "Time" and any(c["isKey"] and c["dataType"] == "dateTime"
                                                                      for c in t["columns"]) for t in model["tables"]))]


def no_auto_date_tables(model):
    return [_row(t["name"], "table", t["name"], not re.match(r"^(LocalDateTable_|DateTableTemplate_)", t["name"]), t["link"])
            for t in model["tables"]]


def no_snowflake(model):
    many = {r["fromTable"] for r in model["relationships"]}
    one = {r["toTable"] for r in model["relationships"]}
    return [_row(t["name"], "table", t["name"], not (t["name"] in many and t["name"] in one), t["link"])
            for t in model["tables"]]


def limit_bidirectional(model, max_share=0.3):
    rels = model["relationships"]
    risky = sum(1 for r in rels if r["crossFilter"] == "bothDirections"
                or (r.get("fromCardinality") == "many" and r.get("toCardinality") == "many"))
    return [_model_row(model, not rels or risky / len(rels) <= max_share)]


_HEAVY_M = re.compile(r"Table\.(Join|NestedJoin|Group|Sort|Pivot)\b|Value\.NativeQuery|Odbc\.Query|OleDb\.Query|\[\s*Query\s*=")


def minimize_power_query(model):
    return [_row(p["name"], "partition", t["name"], not _HEAVY_M.search(p["source"]), p["link"])
            for t in model["tables"] for p in t.get("partitions", []) if p["kind"] == "m"]


# ---- Best Practice Analyzer: formatting

def relationship_integer(model):
    rows, seen = [], set()
    by_name = {t["name"]: t for t in model["tables"]}
    for r in model["relationships"]:
        for side in ("from", "to"):
            key = (r[side + "Table"], r[side + "Column"])
            if key in seen:
                continue
            seen.add(key)
            col = next((c for c in by_name.get(key[0], {}).get("columns", []) if c["name"] == key[1]), None)
            rows.append(_row(key[1], "column", key[0], r.get(side + "DataType") == "int64", col["link"] if col else r["link"]))
    return rows


def mark_primary_keys(model):
    return [_row(c["name"], "column", t["name"], c["isKey"], c["link"])
            for t, c in _columns(model) if c["isPrimaryKey"] and t["dataCategory"] != "Time"]


_AGG = re.compile(r"\b(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|DISTINCTCOUNT|MEDIAN)\s*\(\s*"
                  r"('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)\[((?:[^\]]|\]\])+)\]", re.I)


def _aggregated_columns(model):
    """(table, column) pairs, lower case, that a measure aggregates directly, as in SUM(Table[Column])."""
    aggregated = set()
    for _, m in _measures(model):
        for _, table, name in _AGG.findall(_dax(m["expression"])):
            aggregated.add((table.strip("'").replace("''", "'").lower(), name.replace("]]", "]").lower()))
    return aggregated


def hide_fact_columns(model):
    aggregated = _aggregated_columns(model)
    return [_row(c["name"], "column", t["name"], (t["name"].lower(), c["name"].lower()) not in aggregated, c["link"])
            for t, c in _columns(model, True) if c["dataType"] in NUMERIC]


PERCENT_FORMAT = "#,0.0%;-#,0.0%;#,0.0%"


def percentage_format(model, format=PERCENT_FORMAT):
    return [_row(m["name"], "measure", t["name"], m["formatString"] == format, m["link"])
            for t, m in _measures(model) if "%" in m["formatString"]]


def integer_format(model, formats=("#,0", "#,0.0")):
    return [_row(m["name"], "measure", t["name"], m["formatString"] in formats, m["link"])
            for t, m in _measures(model)
            if m["formatString"] and "$" not in m["formatString"] and "%" not in m["formatString"]]


def data_category(model):
    rows = []
    for t, c in _columns(model, True):
        geo_text = c["dataType"] == "string" and re.search(r"country|continent|city", c["name"], re.I)
        geo_num = c["dataType"] in NUMERIC and re.search(r"latitude|longitude", c["name"], re.I)
        if geo_text or geo_num:
            rows.append(_row(c["name"], "column", t["name"], bool(c["dataCategory"]), c["link"]))
    return rows


def month_sorted(model):
    return [_row(c["name"], "column", t["name"], bool(c["sortByColumn"]), c["link"])
            for t, c in _columns(model)
            if c["dataType"] == "string" and re.search(r"month", c["name"], re.I) and not re.search(r"months", c["name"], re.I)]


CHECKS = {f.__name__: f for f in (
    table_description, column_description, measure_description, measure_format, date_table_marked, fk_hidden,
    table_naming, column_naming, measure_naming, column_table_prefix, no_bidirectional, implicit_measure,
    dax_columns_qualified, dax_measures_unqualified, duplicate_measures, use_divide, avoid_iferror,
    measure_direct_reference, no_evaluateandlog, use_treatas, inactive_relationship_used,
    column_source_column, measure_expression, relationship_same_type, invalid_characters,
    table_has_relationship, unused_hidden_column, unused_hidden_measure,
    trim_names, special_characters, first_letter_capital, partition_name,
    no_floating_point, model_has_date_table, no_auto_date_tables, no_snowflake, limit_bidirectional, minimize_power_query,
    relationship_integer, mark_primary_keys, hide_fact_columns, percentage_format, integer_format, data_category,
    month_sorted, table_metadata, description_quality, metadata_references)}


def documentation_score(model):
    objs = [t for t in model["tables"]] + [c for _, c in _columns(model, True)] + [m for _, m in _measures(model)]
    described = sum(1 for o in objs if o["description"])
    return {"described": described, "total": len(objs), "pct": round(100 * described / len(objs), 1) if objs else 0.0}


def run(model, rules):
    """Apply the enabled rules. Returns the failing rows, plus pass and fail counts for every rule and table."""
    rules = [r for r in rules if r.get("enabled", True)]
    results, counts = [], {}
    for rule in rules:
        for row in CHECKS[rule["check"]](model, **(rule.get("params") or {})):
            c = counts.setdefault((rule["id"], row["table"]), {"rule": rule["id"], "table": row["table"], "pass": 0, "fail": 0})
            c[row["status"]] += 1
            if row["status"] == "fail":
                results.append({**row, "rule": rule["id"], "severity": rule["severity"], "category": rule.get("category", "")})
    fails = {s: sum(1 for r in results if r["severity"] == s) for s in ("error", "warning", "info")}
    return {"generated": model.get("generated", ""), "repo": model.get("repo"), "score": documentation_score(model),
            "failures": fails, "rules": rules, "counts": list(counts.values()), "results": results}


def load_rules(root=ROOT):
    with open(os.path.join(root, "rules.json"), encoding="utf-8") as f:
        return json.load(f)


def main():
    with open(os.path.join(BUILD, "model.json"), encoding="utf-8") as f:
        model = json.load(f)
    out = run(model, load_rules())
    with open(os.path.join(BUILD, "results.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    s, fl = out["score"], out["failures"]
    print(f"results.json: {len(out['rules'])} rules, score {s['pct']}% ({s['described']}/{s['total']}), "
          f"failures: {fl['error']} error, {fl['warning']} warning, {fl['info']} info")


if __name__ == "__main__":
    main()
