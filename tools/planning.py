"""Requirements for the Planning page and the Overview: status, people, dates, sub-requirements and progress.

A requirement is a GitHub issue raised with the Requirement form (see fetch_issues.shape). `build` turns the shaped
issues into what docs/data/planning.json holds. Nothing here depends on today's date: overdue and "due soon" are
worked out in the browser, so they stay right between builds.
"""
import glob
import json
import os
import re

from tmdl import ROOT

STATUSES = ["not-started", "taken-out", "complete", "reopened", "dropped"]


def status(issue):
    """not-started, taken-out, complete, reopened or dropped."""
    if issue["state"] != "open":
        return "dropped" if issue.get("stateReason") == "not_planned" else "complete"
    if issue.get("stateReason") == "reopened":
        return "reopened"
    return "taken-out" if issue.get("assignees") or issue.get("branches") or issue.get("takenOut") else "not-started"


def record(issue):
    r = issue["requirement"]
    stamps, branches = issue.get("takenOut") or [], issue.get("branches") or []
    taken = stamps[-1] if stamps else ({"by": (issue.get("assignees") or [""])[0], "on": "", "branch": branches[0]} if branches else None)
    title = re.sub(r"^\[requirement\]\s*", "", issue["title"], flags=re.I) or issue["title"]   # the form's title prefix
    return {"number": issue["number"], "title": title, "url": issue["url"], "status": status(issue),
            "assignees": issue.get("assignees") or [], "author": issue.get("author", ""), "priority": issue.get("priority", ""),
            "area": r["area"], "details": r["details"], "acceptance": r["acceptance"], "due": r["due"], "dueText": r["dueText"],
            "created": issue.get("created", ""), "closed": issue.get("closed", ""), "takenOut": taken,
            "branches": sorted(set(branches) | {s["branch"] for s in stamps}), "parent": r["parent"], "children": []}


def link(records):
    """Set parent and children by number. A parent that isn't a requirement, or that would make a loop, is dropped."""
    by = {r["number"]: r for r in records}
    for r in records:
        seen, p = {r["number"]}, r["parent"]
        while p in by and p not in seen:
            seen.add(p)
            p = by[p]["parent"]
        if r["parent"] not in by or p in seen:
            r["parent"] = None
    for r in records:
        if r["parent"]:
            by[r["parent"]]["children"].append(r["number"])
    for r in records:
        r["children"].sort()
    return by


def leaves(r, by):
    """The smallest pieces under a requirement: itself if it has not been broken down."""
    if not r["children"]:
        return [r]
    return [x for c in r["children"] for x in leaves(by[c], by)]


def progress(r, by):
    """{done, total} over a requirement's pieces, leaving out dropped ones."""
    counted = [x for x in leaves(r, by) if x["status"] != "dropped"]
    return {"done": sum(1 for x in counted if x["status"] == "complete"), "total": len(counted)}


def report_pages(root=ROOT):
    names = []
    for path in sorted(glob.glob(os.path.join(root, "*.Report", "definition", "pages", "*", "page.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                names.append(json.load(f).get("displayName") or os.path.basename(os.path.dirname(path)))
        except (OSError, ValueError):
            pass
    return names


def build(issues, model=None, root=ROOT):
    """Everything docs/data/planning.json holds."""
    records = [record(i) for i in issues if i.get("requirement")]
    by = link(records)
    for r in records:
        r["leaf"] = not r["children"]
        r["progress"] = progress(r, by)
    pieces = [r for r in records if r["leaf"] and r["status"] != "dropped"]
    done = sum(1 for r in pieces if r["status"] == "complete")
    people = {}
    for r in pieces:
        for who in r["assignees"] or ["Unassigned"]:
            p = people.setdefault(who, {"who": who, "total": 0, "complete": 0})
            p["total"] += 1
            p["complete"] += r["status"] == "complete"
    names = sorted({a for r in records for a in r["assignees"]} | {r["author"] for r in records if r["author"]}, key=str.lower)
    model = model or {}
    return {"repo": model.get("repo"), "generated": model.get("generated", ""),
            "requirements": sorted(records, key=lambda r: r["number"]),
            "totals": {"total": len(pieces), "complete": done, "pct": round(100 * done / len(pieces), 1) if pieces else 0.0,
                       "byStatus": {s: sum(1 for r in records if r["leaf"] and r["status"] == s) for s in STATUSES},
                       "needsDate": sum(1 for r in pieces if not r["due"] and r["status"] != "complete")},
            "people": sorted(people.values(), key=lambda p: (p["who"] == "Unassigned", p["who"].lower())),
            "logins": names,
            "areas": {"tables": [t["name"] for t in model.get("tables", [])], "pages": report_pages(root)}}
