"""Keeps requirement issues in step with what happens to their branches. Run by the branch-activity workflow.

    issue opened          a requirement gets the `requirement` label (created if the repository lacks it)
    branch created        its issue gets the creator as assignee (if nobody is assigned) and a take-out stamp:
                          who, when and which branch. Works for any issue, housekeeping included.
    pull request merged   the branch's requirement is closed as completed, if GitHub has not already
    requirement closed    its parent is closed too once every sub-requirement is complete, and so on up
    requirement reopened  its parent is reopened if it was closed

The decisions (`stamp`, `issue_for_branch`, `rollup`) are plain functions with tests; `main` reads the GitHub event
and makes the API calls. It prints `changed=true` to GITHUB_OUTPUT when it altered an issue, so the workflow knows
to rebuild the site (changes made with the workflow token do not start other workflows).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import fetch_issues
import planning
from tmdl import repo_slug

LABEL = "requirement"


def stamp(body, by, on, branch):
    """`body` with a take-out stamp for `branch` at the top, after any earlier stamps (so they read oldest first).
    Unchanged if that branch is already stamped."""
    body = body or ""
    if any(s["branch"] == branch for s in fetch_issues.taken_out(body)):
        return body
    new, last = f"<!-- taken-out: {by} | {on} | {branch} -->", None
    for last in fetch_issues.STAMP.finditer(body):
        pass
    return body[:last.end()] + "\n" + new + body[last.end():] if last else new + "\n" + body


def issue_for_branch(branch, issues):
    """The issue a branch belongs to: one stamped with or linked to it, else the number its name starts with."""
    for i in issues:
        if branch in (i.get("branches") or []) or any(s["branch"] == branch for s in i.get("takenOut") or []):
            return i
    m = re.match(r"(\d+)(?:[-_/]|$)", branch)
    return next((i for i in issues if m and i["number"] == int(m.group(1))), None)


def rollup(by, number, event):
    """[("close" | "reopen", number)] for the parents of requirement `number` after it was closed or reopened.

    `by` maps number to a planning record (status, parent, children). It is updated as the actions are decided.
    """
    actions, p = [], by[number]["parent"]
    while p:
        parent = by[p]
        if event == "closed":
            kids = [by[c] for c in parent["children"] if by[c]["status"] != "dropped"]
            if parent["status"] in ("complete", "dropped") or not kids or any(k["status"] != "complete" for k in kids):
                break
            actions.append(("close", p))
            parent["status"] = "complete"
        else:
            if parent["status"] != "complete":
                break
            actions.append(("reopen", p))
            parent["status"] = "reopened"
        p = parent["parent"]
    return actions


# ---- GitHub

def _api(method, url, payload=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None, method=method, headers={
        "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json",
        "User-Agent": "model-docs-flow", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def _try(what, fn):
    try:
        fn()
        return True
    except urllib.error.HTTPError as e:   # for example a pull request from a fork, whose token cannot write
        print(f"Could not {what}: HTTP {e.code}")
        return False


def _apply(base, actions, by):
    changed = False
    for action, n in actions:
        if action == "close":
            ok = _try(f"close #{n}", lambda: _api("PATCH", f"{base}/{n}", {"state": "closed", "state_reason": "completed"}))
            note = "Completed: every sub-requirement is complete."
        else:
            ok = _try(f"reopen #{n}", lambda: _api("PATCH", f"{base}/{n}", {"state": "open", "state_reason": "reopened"}))
            note = "Reopened: a sub-requirement was reopened."
        if ok:
            _try(f"comment on #{n}", lambda: _api("POST", f"{base}/{n}/comments", {"body": note}))
            print(f"{action} #{n}")
            changed = True
    return changed


def _requirements(slug):
    records = [planning.record(i) for i in fetch_issues.fetch(slug) if i.get("requirement")]
    return planning.link(records)


def main():
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
        event = json.load(f)
    slug = os.environ.get("GITHUB_REPOSITORY") or repo_slug()
    base = f"https://api.github.com/repos/{slug}/issues"
    changed = False

    if event_name == "issues":
        issue, action = event["issue"], event.get("action")
        shaped = fetch_issues.shape(issue)
        if action == "opened" and shaped.get("requirement") and LABEL not in (l.lower() for l in shaped["labels"]):
            _try("add the label", lambda: _api("POST", f"{base}/{issue['number']}/labels", {"labels": [LABEL]}))
            print(f"labelled #{issue['number']}")
        elif action in ("closed", "reopened") and shaped.get("requirement"):
            by = _requirements(slug)
            if issue["number"] in by:
                by[issue["number"]]["status"] = planning.status(shaped)
                changed = _apply(base, rollup(by, issue["number"], action), by)

    elif event_name == "create" and event.get("ref_type") == "branch":
        branch, actor = event["ref"], (event.get("sender") or {}).get("login", "")
        issue = issue_for_branch(branch, [i for i in fetch_issues.fetch(slug) if i["state"] == "open"])
        if issue and actor:
            n = issue["number"]
            if not issue["assignees"]:
                _try(f"assign #{n}", lambda: _api("POST", f"{base}/{n}/assignees", {"assignees": [actor]}))
            body = _api("GET", f"{base}/{n}").get("body") or ""
            new = stamp(body, actor, datetime.now(timezone.utc).strftime("%Y-%m-%d"), branch)
            if new != body:
                changed = _try(f"stamp #{n}", lambda: _api("PATCH", f"{base}/{n}", {"body": new}))
                print(f"#{n} taken out by {actor} on branch {branch}")

    elif event_name == "pull_request" and event.get("action") == "closed" and event["pull_request"].get("merged"):
        pr = event["pull_request"]
        issues = fetch_issues.fetch(slug)
        issue = issue_for_branch(pr["head"]["ref"], [i for i in issues if i.get("requirement")])
        if issue:
            n = issue["number"]
            if issue["state"] == "open":
                if _try(f"close #{n}", lambda: _api("PATCH", f"{base}/{n}", {"state": "closed", "state_reason": "completed"})):
                    _try(f"comment on #{n}", lambda: _api("POST", f"{base}/{n}/comments",
                                                         {"body": f"Completed: pull request #{pr['number']} was merged."}))
                    print(f"#{n} completed by pull request #{pr['number']}")
                    changed = True
            by = planning.link([planning.record(i) for i in issues if i.get("requirement")])
            by[n]["status"] = "complete"
            changed = _apply(base, rollup(by, n, "closed"), by) or changed

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    if not os.environ.get("GITHUB_TOKEN") or not os.environ.get("GITHUB_EVENT_PATH"):
        sys.exit("flow.py runs inside GitHub Actions: it needs GITHUB_TOKEN and GITHUB_EVENT_PATH.")
    main()
