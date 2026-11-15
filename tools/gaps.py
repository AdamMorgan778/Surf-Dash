"""What the documentation is missing, for the dashboard on the Documentation page.

A gap is one of:
  - a table, visible column or measure with no description (the same objects as the documentation score);
  - a catalogue field that is not filled in for a table in metadata/tables.yaml, or a table with no entry at all;
  - an entry in metadata/tables.yaml or the glossary that names something the model does not have.

The catalogue fields every table should have come from `catalogue_fields` in settings.yml. Fact tables also need a
business process, because the bus matrix is built from it.
"""
from run_rules import documentation_score, metadata_references

DEFAULT_FIELDS = ["owner", "steward", "grain", "refresh", "sensitivity"]
FACT_FIELD = "business_process"


def label(field):
    return field.replace("_", " ").capitalize()


def gaps(model, fields=None):
    """{"fields": [...], "rows": [...], "catalogue": [...], "counts": {...}} for docs/data/gaps.json."""
    fields = list(fields or DEFAULT_FIELDS)
    entries = set(model.get("metadataTables", []))
    meta_link = model.get("metadataLink", "")
    rows, catalogue = [], []
    for t in model["tables"]:
        for kind, o in [("Table", t)] + [("Column", c) for c in t["columns"] if not c["isHidden"]] + [("Measure", m) for m in t["measures"]]:
            if not o["description"]:
                rows.append({"table": t["name"], "item": o["name"], "kind": kind, "missing": "Description", "link": o["link"]})
        needed = fields + ([FACT_FIELD] if t["kind"] == "fact" else [])
        filled = {f: bool(t["meta"].get(f)) for f in needed}
        catalogue.append({"table": t["name"], "fields": filled, "complete": all(filled.values())})
        if t["name"] not in entries:
            rows.append({"table": t["name"], "item": t["name"], "kind": "Catalogue", "missing": "No entry in metadata/tables.yaml",
                         "link": meta_link})
        else:
            rows += [{"table": t["name"], "item": t["name"], "kind": "Catalogue", "missing": label(f), "link": meta_link}
                     for f in needed if not filled[f]]
    broken = [r for r in metadata_references(model) if r["status"] == "fail"]
    rows += [{"table": "", "item": r["object"], "kind": "Glossary" if r["type"] == "glossary" else "Catalogue",
              "missing": "Names something that is not in the model", "link": r["link"]} for r in broken]
    return {"fields": [{"id": f, "label": label(f)} for f in fields + [FACT_FIELD]], "rows": rows, "catalogue": catalogue,
            "counts": {"score": documentation_score(model),
                       "descriptions": sum(1 for r in rows if r["missing"] == "Description"),
                       "tables": len(model["tables"]),
                       "incompleteTables": sum(1 for c in catalogue if not c["complete"]),
                       "glossaryTerms": len(model.get("glossary") or []),
                       "brokenReferences": len(broken)}}
