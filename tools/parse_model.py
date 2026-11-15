"""Read the TMDL semantic model and write build/model.json."""
import csv
import glob
import json
import os
import re
from datetime import datetime, timezone

import yaml

from dax import dependencies
from tmdl import BUILD, ROOT, blob_link, parse_file, repo_slug, settings, unquote

NUMERIC = {"int64", "double", "decimal"}


def find_model_dir(root=ROOT):
    """The model's definition folder: settings.yml `model` if set, otherwise the one *.SemanticModel at the top level."""
    named = settings(root).get("model")
    hits = [os.path.join(root, named, "definition")] if named else sorted(glob.glob(os.path.join(root, "*.SemanticModel", "definition")))
    hits = [h for h in hits if os.path.isdir(h)]
    if not hits:
        raise SystemExit("No *.SemanticModel/definition folder found. Set `model` in settings.yml if it is in a subfolder.")
    if len(hits) > 1:
        raise SystemExit("More than one *.SemanticModel folder found. Set `model` in settings.yml to pick one.")
    return hits[0]


def rel(path, root=ROOT):
    return os.path.relpath(path, root).replace("\\", "/")


def split_ref(ref):
    """'Table'.'Column' or Table.Column -> (table, column)"""
    m = re.match(r"^('(?:[^']|'')+'|[^.]+)\.(.+)$", ref)
    return unquote(m.group(1)), unquote(m.group(2))


def load_yaml(root, name, default):
    path = os.path.join(root, "metadata", name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or default


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
    meta = load_yaml(root, "tables.yaml", {})
    tables = []
    for path in sorted(glob.glob(os.path.join(mdir, "tables", "*.tmdl"))):
        file = rel(path, root)
        for t in parse_file(path):
            if t["type"] != "table":
                continue
            source = None
            columns, measures, partitions = [], [], []
            for c in t["children"]:
                p = c["props"]
                common = {"name": c["name"], "description": c["description"], "line": c["line"],
                          "link": blob_link(file, c["line"], slug), "formatString": p.get("formatString") or ""}
                if c["type"] == "column":
                    # `column X = <DAX>` is a calculated column; plain data columns carry sourceColumn instead
                    columns.append({**common, "dataType": p.get("dataType", ""), "isHidden": p.get("isHidden") is True,
                                    "isKey": p.get("isKey") is True, "sortByColumn": p.get("sortByColumn") or "",
                                    "summarizeBy": p.get("summarizeBy", ""), "dataCategory": p.get("dataCategory") or "",
                                    "sourceColumn": p.get("sourceColumn") or "", "expression": c["expression"],
                                    "isCalculated": bool(c["expression"]),
                                    "isAvailableInMdx": p.get("isAvailableInMdx", True) not in ("false", False),
                                    "isForeignKey": False, "isPrimaryKey": False})
                elif c["type"] == "measure":
                    measures.append({**common, "expression": c["expression"],
                                     "displayFolder": p.get("displayFolder") or "", "isHidden": p.get("isHidden") is True})
                elif c["type"] == "partition":
                    src = str(p.get("source", ""))
                    partitions.append({"name": c["name"], "kind": c["expression"], "mode": p.get("mode") or "",
                                       "source": src, "line": c["line"], "link": blob_link(file, c["line"], slug)})
                    m = re.search(r'"([^"]+\.csv)"', src)
                    source = m.group(1) if m else source
            tables.append({"name": t["name"], "description": t["description"], "file": file, "line": t["line"],
                           "link": blob_link(file, t["line"], slug), "dataCategory": t["props"].get("dataCategory") or "",
                           "isHidden": t["props"].get("isHidden") is True, "source": source,
                           "rowCount": row_count(root, source), "columns": columns, "measures": measures,
                           "partitions": partitions,
                           "isCalculated": any(pt["kind"] == "calculated" for pt in partitions),
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
                                  "fromCardinality": r["props"].get("fromCardinality", "many"),
                                  "toCardinality": r["props"].get("toCardinality", "one"),
                                  "line": r["line"], "link": blob_link(rel(rpath, root), r["line"], slug)})

    by_name = {t["name"]: t for t in tables}
    for r in relationships:
        for side in ("from", "to"):
            col = next((c for c in by_name.get(r[side + "Table"], {}).get("columns", [])
                        if c["name"] == r[side + "Column"]), None)
            r[side + "DataType"] = col["dataType"] if col else ""
    many, one = {r["fromTable"] for r in relationships}, {r["toTable"] for r in relationships}
    for r in relationships:
        for tn, cn, flag in ((r["fromTable"], r["fromColumn"], "isForeignKey"), (r["toTable"], r["toColumn"], "isPrimaryKey")):
            for c in by_name.get(tn, {}).get("columns", []):
                if c["name"] == cn:
                    c[flag] = True
    for t in tables:
        kind = "dimension" if t["name"] in one else "fact" if t["name"] in many else "other"
        t["kind"] = t["meta"].get("kind", kind)

    dependencies(tables)
    name = os.path.basename(os.path.dirname(mdir)).replace(".SemanticModel", "")
    return {"name": name, "siteName": settings(root).get("site_name") or f"{name} model docs",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "repo": slug, "tables": tables, "relationships": relationships,
            # business metadata kept beside the model, so the rules can check it against the model
            "metadataTables": sorted(meta), "metadataLink": blob_link("metadata/tables.yaml", slug=slug),
            "glossary": load_yaml(root, "glossary.yaml", []), "glossaryLink": blob_link("metadata/glossary.yaml", slug=slug)}


def main():
    model = parse_model()
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "model.json"), "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)
    print(f"model.json: {len(model['tables'])} tables, "
          f"{sum(len(t['columns']) for t in model['tables'])} columns, "
          f"{sum(len(t['measures']) for t in model['tables'])} measures, "
          f"{len(model['relationships'])} relationships")
    return model


if __name__ == "__main__":
    main()
