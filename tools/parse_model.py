"""Read the TMDL semantic model and write build/model.json."""
import csv
import glob
import json
import os
import re
from datetime import datetime, timezone

import yaml

from tmdl import BUILD, ROOT, blob_link, parse_file, repo_slug, unquote

NUMERIC = {"int64", "double", "decimal"}


def find_model_dir(root=ROOT):
    hits = [p for p in glob.glob(os.path.join(root, "**", "*.SemanticModel", "definition"), recursive=True)
            if os.sep + ".venv" + os.sep not in p]
    if not hits:
        raise SystemExit("No *.SemanticModel/definition folder found")
    return sorted(hits)[0]


def rel(path, root=ROOT):
    return os.path.relpath(path, root).replace("\\", "/")


def split_ref(ref):
    """'Table'.'Column' or Table.Column -> (table, column)"""
    m = re.match(r"^('(?:[^']|'')+'|[^.]+)\.(.+)$", ref)
    return unquote(m.group(1)), unquote(m.group(2))


def load_meta(root=ROOT):
    path = os.path.join(root, "metadata", "tables.yaml")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def row_count(root, source):
    if not source:
        return None
    path = os.path.join(root, "Data", source)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", newline="") as f:
        return max(sum(1 for _ in csv.reader(f)) - 1, 0)


def parse_model(root=ROOT):
    mdir = find_model_dir(root)
    slug = repo_slug()
    meta = load_meta(root)
    tables = []
    for path in sorted(glob.glob(os.path.join(mdir, "tables", "*.tmdl"))):
        file = rel(path, root)
        for t in parse_file(path):
            if t["type"] != "table":
                continue
            source = None
            columns, measures = [], []
            for c in t["children"]:
                p = c["props"]
                common = {"name": c["name"], "description": c["description"], "line": c["line"],
                          "link": blob_link(file, c["line"], slug), "formatString": p.get("formatString") or ""}
                if c["type"] == "column":
                    columns.append({**common, "dataType": p.get("dataType", ""), "isHidden": p.get("isHidden") is True,
                                    "isKey": p.get("isKey") is True, "sortByColumn": p.get("sortByColumn") or "",
                                    "summarizeBy": p.get("summarizeBy", ""), "dataCategory": p.get("dataCategory") or "",
                                    "isForeignKey": False, "isPrimaryKey": False})
                elif c["type"] == "measure":
                    measures.append({**common, "expression": c["expression"],
                                     "displayFolder": p.get("displayFolder") or "", "isHidden": p.get("isHidden") is True})
                elif c["type"] == "partition":
                    m = re.search(r'"([^"]+\.csv)"', str(p.get("source", "")))
                    source = m.group(1) if m else source
            tables.append({"name": t["name"], "description": t["description"], "file": file, "line": t["line"],
                           "link": blob_link(file, t["line"], slug), "dataCategory": t["props"].get("dataCategory") or "",
                           "isHidden": t["props"].get("isHidden") is True, "source": source,
                           "rowCount": row_count(root, source), "columns": columns, "measures": measures,
                           "meta": meta.get(t["name"]) or {}})

    relationships = []
    rpath = os.path.join(mdir, "relationships.tmdl")
    if os.path.exists(rpath):
        for r in parse_file(rpath):
            if r["type"] != "relationship":
                continue
            ft, fc = split_ref(r["props"]["fromColumn"])
            tt, tc = split_ref(r["props"]["toColumn"])
            relationships.append({"fromTable": ft, "fromColumn": fc, "toTable": tt, "toColumn": tc,
                                  "crossFilter": r["props"].get("crossFilteringBehavior", "oneDirection"),
                                  "isActive": r["props"].get("isActive", "true") != "false",
                                  "line": r["line"], "link": blob_link(rel(rpath, root), r["line"], slug)})

    by_name = {t["name"]: t for t in tables}
    many, one = {r["fromTable"] for r in relationships}, {r["toTable"] for r in relationships}
    for r in relationships:
        for tn, cn, flag in ((r["fromTable"], r["fromColumn"], "isForeignKey"), (r["toTable"], r["toColumn"], "isPrimaryKey")):
            for c in by_name.get(tn, {}).get("columns", []):
                if c["name"] == cn:
                    c[flag] = True
    for t in tables:
        kind = "dimension" if t["name"] in one else "fact" if t["name"] in many else "other"
        t["kind"] = t["meta"].get("kind", kind)

    return {"name": os.path.basename(os.path.dirname(mdir)).replace(".SemanticModel", ""),
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "repo": slug, "tables": tables, "relationships": relationships}


def main():
    model = parse_model()
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "model.json"), "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)
    print(f"model.json: {len(model['tables'])} tables, "
          f"{sum(len(t['columns']) for t in model['tables'])} columns, "
          f"{sum(len(t['measures']) for t in model['tables'])} measures, "
          f"{len(model['relationships'])} relationships")


if __name__ == "__main__":
    main()
