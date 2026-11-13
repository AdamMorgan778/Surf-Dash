"""Pull open and recently closed GitHub issues and write build/issues.json.

The table, request type and priority come from the issue form headings in the body
(### Table, ### Request type, ### Priority). A `table:<Name>` label also sets the table.
Works without a token on public repos; writes an empty list when there is no remote or no network.
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from tmdl import BUILD, repo_slug

CLOSED_DAYS = 30


def _get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "model-docs-build"})
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def _pages(slug, query):
    page = 1
    while True:
        batch = _get(f"https://api.github.com/repos/{slug}/issues?{query}&per_page=100&page={page}")
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def form_fields(body):
    """Issue form bodies look like '### Table\\n\\nDimSpot\\n\\n### Priority\\n\\nHigh'."""
    fields = {}
    for m in re.finditer(r"^###\s+(.+?)\s*\n+(.*?)(?=^###\s|\Z)", body or "", re.S | re.M):
        value = m.group(2).strip()
        fields[m.group(1).strip().lower()] = "" if value == "_No response_" else value
    return fields


# A housekeeping item line, as written by the rules report:
#   - [ ] FactSales · Revenue — Numeric columns aggregated ... (rule: hide-fact-columns)
_ITEM = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s+·\s+(.+?)\s+—.*\(rule:\s*([\w-]+)\)\s*$")


def housekeeping_items(text):
    """[{table, object, rule, done}] for every item line in a housekeeping issue's Items field."""
    items = []
    for line in (text or "").splitlines():
        m = _ITEM.match(line)
        if m:
            table = m.group(2).strip()
            items.append({"table": "(model)" if table == "Whole model" else table, "object": m.group(3).strip(),
                          "rule": m.group(4), "done": m.group(1).lower() == "x"})
    return items


def shape(issue):
    fields = form_fields(issue.get("body"))
    labels = [l["name"] for l in issue.get("labels", [])]
    table = fields.get("table", "").split("\n")[0].strip()
    for l in labels:
        if l.lower().startswith("table:"):
            table = l.split(":", 1)[1].strip()
    out = {"number": issue["number"], "title": issue["title"], "state": issue["state"], "url": issue["html_url"],
           "table": table or "Unassigned", "requestType": fields.get("request type", ""),
           "priority": fields.get("priority", ""), "labels": labels,
           "created": issue["created_at"][:10], "closed": (issue.get("closed_at") or "")[:10]}
    items = housekeeping_items(fields.get("items", ""))
    if items or "housekeeping" in (l.lower() for l in labels):
        tables = sorted({i["table"] for i in items})
        out.update(items=items, requestType="Housekeeping",
                   progress={"done": sum(1 for i in items if i["done"]), "total": len(items)})
        if not table:
            out["table"] = "Whole model" if len(tables) != 1 or tables[0] == "(model)" else tables[0]
    return out


def fetch(slug):
    cutoff = datetime.now(timezone.utc) - timedelta(days=CLOSED_DAYS)
    issues = [i for i in _pages(slug, "state=open") if "pull_request" not in i]
    since = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    issues += [i for i in _pages(slug, f"state=closed&since={since}")
               if "pull_request" not in i and (i.get("closed_at") or "") >= since]
    return [shape(i) for i in issues]


def main():
    slug = repo_slug()
    issues, note = [], ""
    if not slug:
        note = "No GitHub remote configured; issues were not fetched."
    else:
        try:
            issues = fetch(slug)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            note = f"Could not fetch issues: {e}"
    if note:
        print("WARNING:", note)
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "issues.json"), "w", encoding="utf-8") as f:
        json.dump({"repo": slug, "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                   "note": note, "closedDays": CLOSED_DAYS, "issues": issues}, f, indent=2)
    print(f"issues.json: {sum(1 for i in issues if i['state'] == 'open')} open, "
          f"{sum(1 for i in issues if i['state'] == 'closed')} recently closed")


if __name__ == "__main__":
    main()
