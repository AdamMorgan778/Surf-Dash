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

from housekeeping import MODEL_LABEL, MODEL_TABLE, parse_items
from tmdl import BUILD, repo_slug, settings

CLOSED_DAYS = int(settings().get("closed_issue_days", 30))


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


# A claim line in a "Working on" issue, as written by the Work in progress page:
#   - Table · FactSales          - Report page · Shop & Lessons
_CLAIM = re.compile(r"^\s*[-*]\s+(?:\[[ xX]\]\s+)?(Table|Report page)\s+·\s+(.+?)\s*$", re.I)


def parse_claims(text):
    """[{kind: table | page, name}] for every claim line in a Working on issue's Items field."""
    out = []
    for line in (text or "").splitlines():
        m = _CLAIM.match(line)
        if m:
            out.append({"kind": "table" if m.group(1).lower() == "table" else "page", "name": m.group(2)})
    return out


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
    items = parse_items(fields.get("items", ""))
    if items or "housekeeping" in (l.lower() for l in labels):
        tables = sorted({i["table"] for i in items})
        out.update(items=items, requestType="Housekeeping",
                   progress={"done": sum(1 for i in items if i["done"]), "total": len(items)})
        if not table:
            out["table"] = MODEL_LABEL if len(tables) != 1 or tables[0] == MODEL_TABLE else tables[0]
    claims = parse_claims(fields.get("items", ""))
    if claims:
        out.update(claims=claims, requestType="Working on")
        if not table:
            out["table"] = claims[0]["name"] if len(claims) == 1 and claims[0]["kind"] == "table" else MODEL_LABEL
    out["author"] = (issue.get("user") or {}).get("login", "")
    out["assignees"] = [a["login"] for a in issue.get("assignees") or [] if a.get("login")]
    out["branches"] = []
    set_work(out)
    return out


def match_tables(issues, names):
    """The issue form's Table field is free text: map it to a model table whatever its case, or to Unassigned."""
    known = {n.lower(): n for n in names}
    known[MODEL_LABEL.lower()] = MODEL_LABEL
    for i in issues:
        i["table"] = known.get(str(i.get("table") or "").strip().lower(), "Unassigned")
    return issues


IN_PROGRESS_LABEL = "in-progress"


def set_work(issue):
    """Is anyone working on it? An assignee, a branch made with Create a branch, or the in-progress label."""
    if issue["state"] != "open":
        issue["work"] = "closed"
    elif issue["assignees"] or issue["branches"] or IN_PROGRESS_LABEL in (l.lower() for l in issue["labels"]):
        issue["work"] = "in-progress"
    else:
        issue["work"] = "raised"


def _graphql(query, variables):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise PermissionError("no token")
    req = urllib.request.Request("https://api.github.com/graphql", data=json.dumps({"query": query, "variables": variables}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "User-Agent": "model-docs-build",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def attach_branches(slug, issues, query=_graphql):
    """Add the branches linked to each open housekeeping issue (made with Create a branch) in one GraphQL call.

    GraphQL always needs a token. Without one the check is skipped and assignees and labels still decide `work`.
    Returns a note when it could not run.
    """
    wanted = [i for i in issues if i.get("items") is not None and i["state"] == "open"]
    if not wanted:
        return ""
    owner, name = slug.split("/", 1)
    fields = " ".join(f'i{i["number"]}: issue(number: {int(i["number"])}) {{ linkedBranches(first: 5) {{ nodes {{ ref {{ name }} }} }} }}'
                      for i in wanted)
    try:
        data = query(f"query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ {fields} }} }}",
                     {"owner": owner, "name": name})
    except PermissionError:
        return "Linked branches were not checked (no GITHUB_TOKEN)."
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return f"Linked branches were not checked: {e}"
    repo = ((data or {}).get("data") or {}).get("repository") or {}
    for i in wanted:
        nodes = ((repo.get(f"i{i['number']}") or {}).get("linkedBranches") or {}).get("nodes") or []
        i["branches"] = [n["ref"]["name"] for n in nodes if n and n.get("ref")]
        set_work(i)
    return ""


def fetch(slug):
    cutoff = datetime.now(timezone.utc) - timedelta(days=CLOSED_DAYS)
    issues = [i for i in _pages(slug, "state=open") if "pull_request" not in i]
    since = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    issues += [i for i in _pages(slug, f"state=closed&since={since}")
               if "pull_request" not in i and (i.get("closed_at") or "") >= since]
    shaped = [shape(i) for i in issues]
    note = attach_branches(slug, shaped)
    if note:
        print("NOTE:", note)
    return shaped


def fetch_pulls(slug):
    """Open pull requests, to name the person and link the review for each unmerged branch."""
    return [{"number": p["number"], "url": p["html_url"], "branch": p["head"]["ref"], "author": (p.get("user") or {}).get("login", ""),
             "draft": bool(p.get("draft")), "title": p["title"]}
            for p in _get(f"https://api.github.com/repos/{slug}/pulls?state=open&per_page=100")]


def main():
    slug = repo_slug()
    issues, pulls, note = [], [], ""
    if not slug:
        note = "No GitHub remote configured; issues were not fetched."
    else:
        try:
            issues = fetch(slug)
            pulls = fetch_pulls(slug)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            note = f"Could not fetch issues: {e}"
    if note:
        print("WARNING:", note)
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "issues.json"), "w", encoding="utf-8") as f:
        json.dump({"repo": slug, "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                   "note": note, "closedDays": CLOSED_DAYS, "issues": issues, "pulls": pulls}, f, indent=2)
    print(f"issues.json: {sum(1 for i in issues if i['state'] == 'open')} open, "
          f"{sum(1 for i in issues if i['state'] == 'closed')} recently closed")


if __name__ == "__main__":
    main()
