"""Write a full description under every item of a housekeeping issue.

The rules report opens housekeeping issues with one short checklist line per item, so that even long lists fit in
the "new issue" link:

    - [ ] FactSales · Revenue — Hide fact table columns (rule: hide-fact-columns)

When the issue is opened, the housekeeping-details workflow runs this script. It looks every item up in the current
model and rule results and adds, under each line:

    - **Rule:** name · category · severity · BPA id
    - **Breaking it:** which column, measure, table, relationship or partition, linked to its TMDL line
    - **What the rule is:** the rule's description
    - **How to fix:** the rule's fix note

The checklist lines themselves are left as they are, so ticks and fetch_issues.py keep working. The script runs once
per issue (it leaves a hidden marker). If the expanded issue would pass GitHub's size limit, the body stays compact and
the descriptions go into comments instead.

    python tools/expand_housekeeping.py                 # in the workflow: reads GITHUB_EVENT_PATH, updates the issue
    python tools/expand_housekeeping.py --dry-run --event event.json   # print the result, change nothing
"""
import argparse
import json
import os
import sys
import urllib.request

from fetch_issues import _ITEM
from parse_model import parse_model
from run_rules import run
from tmdl import ROOT, repo_slug

MARKER = "<!-- housekeeping-details -->"
BODY_LIMIT = 65000        # GitHub's limit is 65,536 characters for an issue body or comment
COMMENT_LIMIT = 60000
COMMENT_NOTE = "_Descriptions for each item are in the comments below, because they are too long for the issue itself._"


def load_rules():
    with open(os.path.join(ROOT, "rules.json"), encoding="utf-8") as f:
        return {r["id"]: r for r in json.load(f)}


def lookup_tables(model, results):
    rows = {(r["table"], r["object"], r["rule"]): r for r in results["results"]}
    tables = {t["name"]: t for t in model["tables"]}
    return rows, tables


def _named(name, link):
    return f"[{name}]({link})" if link else f"`{name}`"


def breaking_text(row, tables):
    """Plain-English description of the object breaking the rule."""
    obj, table, link = row["object"], row["table"], row.get("link", "")
    t = tables.get(table, {})
    if row["type"] == "column":
        col = next((c for c in t.get("columns", []) if c["name"] == obj), {})
        extra = ", ".join(x for x in (col.get("dataType"), "hidden" if col.get("isHidden") else "visible") if x)
        return f"column {_named(obj, link)} in table {table}" + (f" ({extra})" if col else "")
    if row["type"] == "measure":
        m = next((m for m in t.get("measures", []) if m["name"] == obj), {})
        fmt = m.get("formatString")
        return f"measure {_named(obj, link)} in table {table}" + (f" (format `{fmt}`)" if fmt else " (no format string)" if m else "")
    if row["type"] == "table":
        return f"table {_named(obj, link)}"
    if row["type"] == "relationship":
        return f"relationship {_named(obj, link)}"
    if row["type"] == "partition":
        return f"partition {_named(obj, link)} of table {table}"
    return "the whole model"


def detail_lines(item, rows, tables, rules, indent="  "):
    """The description lines for one parsed item: {table, object, rule, done}."""
    rule = rules.get(item["rule"])
    row = rows.get((item["table"], item["object"], item["rule"]))
    out = []
    if rule:
        bits = [rule.get("name") or rule["id"], rule.get("category", ""), rule.get("severity", "")]
        if rule.get("bpaId"):
            bits.append("BPA " + rule["bpaId"])
        out.append(f"- **Rule:** {' · '.join(b for b in bits if b)}")
    else:
        out.append(f"- **Rule:** `{item['rule']}` (not in rules.json any more)")
    if row:
        out.append(f"- **Breaking it:** {breaking_text(row, tables)}")
    else:
        where = "the whole model" if item["table"] == "(model)" else f"`{item['object']}` in table {item['table']}"
        out.append(f"- **Breaking it:** {where}")
    if rule:
        out.append(f"- **What the rule is:** {rule['description']}")
        if rule.get("fix"):
            out.append(f"- **How to fix:** {rule['fix']}")
    if not row or row["status"] != "fail":
        out.append("- **Status:** No longer failing in the current model. Check it and tick it off.")
    return [indent + line for line in out]


def parse_item(line):
    m = _ITEM.match(line)
    if not m:
        return None
    table = m.group(2).strip()
    return {"table": "(model)" if table == "Whole model" else table, "object": m.group(3).strip(), "rule": m.group(4),
            "done": m.group(1).lower() == "x"}


def expand(body, model, results, rules):
    """Return {"body": new body, "comments": [...]} or None when there is nothing to do (no items, or already done)."""
    body = (body or "").replace("\r\n", "\n")
    if MARKER in body:
        return None
    rows, tables = lookup_tables(model, results)
    lines, out, items = body.split("\n"), [], []
    for line in lines:
        out.append(line)
        item = parse_item(line)
        if item:
            # keep the item's own indentation, so nested lists stay nested
            indent = line[: len(line) - len(line.lstrip())] + "  "
            details = detail_lines(item, rows, tables, rules, indent)
            out.extend(details)
            items.append((item, line.strip(), details))
    if not items:
        return None
    expanded = MARKER + "\n" + "\n".join(out)
    if len(expanded) <= BODY_LIMIT:
        return {"body": expanded, "comments": []}
    # Too big for one body: keep the compact checklist, put the descriptions in comments grouped by table.
    compact = MARKER + "\n" + COMMENT_NOTE + "\n\n" + body
    sections = {}
    for item, line, details in items:
        # In comments the item is a plain bullet (the checkbox stays in the issue body), with its details nested under it.
        bullet = "- " + line.split("]", 1)[1].strip()
        sections.setdefault(item["table"], []).append("\n".join([bullet] + ["  " + d.lstrip() for d in details]))
    comments, current = [], ""
    for table in sorted(sections, key=lambda t: (t == "(model)", t)):
        block = f"#### {'Whole model' if table == '(model)' else table}\n\n" + "\n".join(sections[table]) + "\n\n"
        while block:
            room = COMMENT_LIMIT - len(current)
            if len(block) <= room:
                current += block
                block = ""
            elif current:
                comments.append(current.rstrip())
                current = ""
            else:   # a single table's descriptions larger than a comment: split on item boundaries
                cut = block.rfind("\n- ", 0, COMMENT_LIMIT)
                cut = cut if cut > 0 else COMMENT_LIMIT
                comments.append(block[:cut].rstrip())
                block = block[cut + 1:]
    if current.strip():
        comments.append(current.rstrip())
    total = len(comments)
    comments = [f"**Item descriptions ({i} of {total})**\n\n{c}" for i, c in enumerate(comments, 1)]
    return {"body": compact, "comments": comments}


def _api(method, url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method=method, headers={
        "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json",
        "User-Agent": "model-docs-housekeeping", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--event", default=os.environ.get("GITHUB_EVENT_PATH"), help="GitHub event JSON (default: GITHUB_EVENT_PATH)")
    ap.add_argument("--dry-run", action="store_true", help="print the result instead of updating the issue")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")   # the item lines use · and —
    if not args.event:
        sys.exit("No event file: pass --event or set GITHUB_EVENT_PATH")
    with open(args.event, encoding="utf-8") as f:
        issue = json.load(f)["issue"]
    rules = load_rules()
    model = parse_model()
    results = run(model, list(rules.values()))
    result = expand(issue.get("body") or "", model, results, rules)
    if not result:
        print(f"Issue #{issue['number']}: nothing to expand (no item lines, or descriptions already added).")
        return
    if args.dry_run:
        print(result["body"])
        for c in result["comments"]:
            print("\n----- comment -----\n" + c)
        return
    slug = os.environ.get("GITHUB_REPOSITORY") or repo_slug()
    base = f"https://api.github.com/repos/{slug}/issues/{issue['number']}"
    _api("PATCH", base, {"body": result["body"]})
    for c in result["comments"]:
        _api("POST", base + "/comments", {"body": c})
    print(f"Issue #{issue['number']}: descriptions added" + (f" in {len(result['comments'])} comment(s)." if result["comments"] else "."))


if __name__ == "__main__":
    main()
