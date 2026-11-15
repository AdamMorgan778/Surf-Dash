"""Small helpers for reading DAX expressions: strip strings and comments, list the bracketed references."""
import re

_REF = re.compile(r"('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)?\[((?:[^\]]|\]\])+)\]")


def clean(expr):
    """DAX with string literals and comments removed, so text inside them is not mistaken for code."""
    expr = re.sub(r'"(?:[^"]|"")*"', '""', expr or "")
    expr = re.sub(r"/\*.*?\*/", " ", expr, flags=re.S)
    return re.sub(r"(//|--)[^\n]*", " ", expr)


def refs(expr):
    """[(table or None, name)] for every bracketed reference in a DAX expression."""
    out = []
    for m in _REF.finditer(clean(expr)):
        table = m.group(1)
        if table and table.startswith("'"):
            table = table[1:-1].replace("''", "'")
        out.append((table, m.group(2).replace("]]", "]")))
    return out


def dependencies(tables):
    """Add dependsOn {measures, columns} and usedBy [measure names] to every measure in `tables`."""
    measures = {m["name"].lower(): m for t in tables for m in t["measures"]}
    columns = {(t["name"].lower(), c["name"].lower()): f"{t['name']}[{c['name']}]" for t in tables for c in t["columns"]}
    for m in measures.values():
        m["dependsOn"], m["usedBy"] = {"measures": [], "columns": []}, []
    for t in tables:
        for m in t["measures"]:
            for table, name in refs(m["expression"]):
                col = columns.get(((table or t["name"]).lower(), name.lower())) if table else None
                other = measures.get(name.lower())
                if col:
                    if col not in m["dependsOn"]["columns"]:
                        m["dependsOn"]["columns"].append(col)
                elif other and other is not m:
                    if other["name"] not in m["dependsOn"]["measures"]:
                        m["dependsOn"]["measures"].append(other["name"])
                    if m["name"] not in other["usedBy"]:
                        other["usedBy"].append(m["name"])
