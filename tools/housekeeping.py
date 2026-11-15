"""The housekeeping item line, in one place.

The rules report puts one checklist line per failing check into a housekeeping issue:

    - [ ] FactSales · Revenue — Hide fact table columns (rule: hide-fact-columns)

`item_line` writes that line, `parse_items` reads it back from an issue body, and `annotate` joins the two: it
marks every failing check with its line and with where it stands in an open issue (raised, in progress, done).
"""
import re

MODEL_TABLE = "(model)"      # table value for checks about the model as a whole
MODEL_LABEL = "Whole model"  # how that is shown to people

ITEM = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s+·\s+(.+?)\s+—.*\(rule:\s*([\w-]+)\)\s*$")


def table_label(table):
    return MODEL_LABEL if table == MODEL_TABLE else table


def item_line(row, rule_name, done=False):
    """The checklist line for one failing check. `row` needs table, object and rule."""
    return f"- [{'x' if done else ' '}] {table_label(row['table'])} · {row['object']} — {rule_name} (rule: {row['rule']})"


def parse_item(line):
    m = ITEM.match(line)
    if not m:
        return None
    table = m.group(2).strip()
    return {"table": MODEL_TABLE if table == MODEL_LABEL else table, "object": m.group(3).strip(), "rule": m.group(4),
            "done": m.group(1).lower() == "x"}


def parse_items(text):
    """[{table, object, rule, done}] for every item line in a block of text."""
    return [i for i in (parse_item(line) for line in (text or "").splitlines()) if i]


def annotate(results, issues):
    """Give every failing check its `item` line and its `work` status from the open housekeeping issues.

    work.status is none (not in an issue), raised, in-progress or done (ticked on the issue). When a check is in
    more than one open issue, one where someone is working on it wins.
    """
    names = {r["id"]: r.get("name") or r["id"] for r in results["rules"]}
    raised = {}
    for i in issues:
        if i.get("state") != "open":
            continue
        for it in i.get("items") or []:
            raised.setdefault((it["table"], it["object"], it["rule"]), []).append(
                {"number": i["number"], "url": i["url"], "done": it["done"], "inProgress": i.get("work") == "in-progress",
                 "assignees": i.get("assignees") or [], "branches": i.get("branches") or []})
    for row in results["results"]:
        row["item"] = item_line(row, names.get(row["rule"], row["rule"]))
        hits = raised.get((row["table"], row["object"], row["rule"]))
        if not hits:
            row["work"] = {"status": "none"}
            continue
        hit = next((h for h in hits if h["inProgress"] and not h["done"]), hits[0])
        status = "done" if hit["done"] else "in-progress" if hit["inProgress"] else "raised"
        row["work"] = {"status": status, "number": hit["number"], "url": hit["url"],
                       "assignees": hit["assignees"], "branches": hit["branches"]}
    return results
