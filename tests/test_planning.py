"""Requirements: reading them from issues, their status, the parent and sub-requirement tree, and progress."""
import flow
import planning
from fetch_issues import parse_due, shape, taken_out


def issue(number, due="2026-12-01", parent="", state="open", reason=None, assignees=(), labels=("requirement",), stamp="",
          milestone=None, closed=None):
    body = (f"{stamp}### Details\n\nNeeded for the board.\n\n### Acceptance criteria\n\nTotals match finance.\n\n### Area\n\nFactSales\n\n"
            f"### Priority\n\nHigh\n\n### Due date\n\n{due or '_No response_'}\n\n### Parent requirement\n\n{parent or '_No response_'}")
    return {"number": number, "title": f"Requirement {number}", "state": state, "state_reason": reason,
            "html_url": f"https://github.com/o/r/issues/{number}", "created_at": "2026-11-01T09:00:00Z",
            "closed_at": closed or ("2026-11-10T09:00:00Z" if state == "closed" else None), "body": body,
            "labels": [{"name": l} for l in labels], "assignees": [{"login": a} for a in assignees], "user": {"login": "raiser"},
            "milestone": {"due_on": milestone} if milestone else None}


def build(*issues):
    return planning.build([shape(i) for i in issues])


def by_number(plan):
    return {r["number"]: r for r in plan["requirements"]}


def test_requirement_fields_are_read():
    out = shape(issue(5, assignees=["alice"]))
    assert out["requestType"] == "Requirement" and out["table"] == "FactSales" and out["priority"] == "High"
    assert out["requirement"] == {"details": "Needed for the board.", "acceptance": "Totals match finance.", "area": "FactSales",
                                  "due": "2026-12-01", "dueText": "", "parent": None}
    # the form's headings are enough when the label is missing (GitHub only applies a label that already exists)
    assert shape(issue(6, labels=()))["requirement"]["due"] == "2026-12-01"
    assert "requirement" not in shape({**issue(7, labels=()), "body": "### Table\n\nFactSales"})


def test_due_dates():
    assert [parse_due(t) for t in ("2026-12-01", "1 Dec 2026", "December 1, 2026", "3rd March 2027")] == \
        ["2026-12-01", "2026-12-01", "2026-12-01", "2027-03-03"]
    assert [parse_due(t) for t in ("01/12/2026", "2026-02-30", "soon", "")] == ["", "", "", ""]   # ambiguous or impossible
    from_milestone = shape(issue(8, due="", milestone="2027-01-15T00:00:00Z"))["requirement"]
    assert from_milestone["due"] == "2027-01-15" and from_milestone["dueText"] == ""
    unreadable = shape(issue(9, due="next sprint"))["requirement"]
    assert unreadable["due"] == "" and unreadable["dueText"] == "next sprint"
    plan = build(issue(9, due="next sprint"), issue(10))
    assert plan["totals"]["needsDate"] == 1


def test_every_status():
    stamp = "<!-- taken-out: alice | 2026-11-16 | 3-totals -->\n"
    plan = by_number(build(issue(1), issue(2, assignees=["bob"]), issue(3, stamp=stamp), issue(4, state="closed", reason="completed"),
                           issue(5, reason="reopened", assignees=["bob"]), issue(6, state="closed", reason="not_planned")))
    assert [plan[n]["status"] for n in range(1, 7)] == ["not-started", "taken-out", "taken-out", "complete", "reopened", "dropped"]
    assert plan[3]["takenOut"] == {"by": "alice", "on": "2026-11-16", "branch": "3-totals"} and plan[3]["branches"] == ["3-totals"]
    assert plan[2]["takenOut"] is None        # assigned, but no branch yet
    assert taken_out(stamp + stamp.replace("3-totals", "3-again"))[-1]["branch"] == "3-again"


def test_tree_and_progress_count_the_smallest_pieces():
    plan = build(issue(1), issue(2, parent="#1", state="closed", reason="completed"), issue(3, parent="1"),
                 issue(4, parent="1", state="closed", reason="not_planned"), issue(5, parent="3", state="closed", reason="completed"),
                 issue(6, parent="3"), issue(7, state="closed", reason="completed", assignees=["alice"]), issue(8, assignees=["alice"]))
    reqs = by_number(plan)
    assert reqs[1]["children"] == [2, 3, 4] and reqs[3]["children"] == [5, 6] and reqs[2]["parent"] == 1
    assert not reqs[1]["leaf"] and reqs[2]["leaf"]
    assert reqs[1]["progress"] == {"done": 2, "total": 3}      # pieces 2, 5 and 6; the dropped 4 is left out
    assert reqs[3]["progress"] == {"done": 1, "total": 2}
    # pieces: 2, 5, 6, 7, 8 (1 and 3 are counted through their parts, 4 is dropped)
    assert plan["totals"]["total"] == 5 and plan["totals"]["complete"] == 3 and plan["totals"]["pct"] == 60.0
    assert {p["who"]: (p["complete"], p["total"]) for p in plan["people"]} == {"alice": (1, 2), "Unassigned": (2, 3)}
    assert plan["people"][-1]["who"] == "Unassigned" and plan["logins"] == ["alice", "raiser"]


def test_bad_parents_are_ignored():
    reqs = by_number(build(issue(1, parent="2"), issue(2, parent="1"), issue(3, parent="99"), issue(4, parent="4")))
    assert reqs[3]["parent"] is None and reqs[4]["parent"] is None            # not a requirement; itself
    assert sorted(n for n in (1, 2) if reqs[n]["parent"]) != [1, 2]           # the loop is broken somewhere
    assert build()["totals"] == {"total": 0, "complete": 0, "pct": 0.0, "byStatus": dict.fromkeys(planning.STATUSES, 0), "needsDate": 0}


# ---- tools/flow.py: the decisions

def test_stamp_is_added_once_per_branch():
    body = "### Details\n\nx"
    once = flow.stamp(body, "alice", "2026-11-16", "3-totals")
    assert once == "<!-- taken-out: alice | 2026-11-16 | 3-totals -->\n### Details\n\nx"
    assert flow.stamp(once, "alice", "2026-11-17", "3-totals") == once                     # same branch: no second stamp
    twice = flow.stamp(once, "bob", "2026-11-18", "3-second-go")
    assert [s["by"] for s in taken_out(twice)] == ["alice", "bob"]                         # oldest first; the last is current
    assert planning.record(shape({**issue(3), "body": twice}))["takenOut"]["by"] == "bob"
    assert shape({**issue(3), "body": twice + "\n\n### Due date\n\n2026-12-01\n\n### Acceptance criteria\n\ny"})["requirement"]["details"] == "x"


def test_issue_for_branch():
    issues = [shape(issue(3, stamp="<!-- taken-out: a | 2026-11-16 | totals-rework -->\n")), shape(issue(12)), shape(issue(120))]
    issues[1]["branches"] = ["linked-by-github"]
    find = lambda b: (flow.issue_for_branch(b, issues) or {}).get("number")
    assert find("totals-rework") == 3 and find("linked-by-github") == 12
    assert find("12-add-tide") == 12 and find("120-other") == 120 and find("12") == 12
    assert find("feature/thing") is None and find("121-nothing") is None and find("v12-x") is None


def tree(*issues):
    return planning.link([planning.record(shape(i)) for i in issues])


def test_parent_completes_with_its_last_sub_requirement():
    done = dict(state="closed", reason="completed")
    by = tree(issue(1), issue(2, parent="1", **done), issue(3, parent="1", **done), issue(4, parent="1", state="closed", reason="not_planned"))
    assert flow.rollup(by, 3, "closed") == [("close", 1)]
    by = tree(issue(1), issue(2, parent="1", **done), issue(3, parent="1"))
    assert flow.rollup(by, 2, "closed") == []                                # one part still open
    by = tree(issue(1), issue(2, parent="1"), issue(3, parent="2", **done), issue(4, parent="2", **done))
    assert flow.rollup(by, 4, "closed") == [("close", 2), ("close", 1)]      # and so on up
    assert flow.rollup(tree(issue(1, **done)), 1, "closed") == []            # no parent


def test_reopening_a_sub_requirement_reopens_its_parents():
    done = dict(state="closed", reason="completed")
    by = tree(issue(1, **done), issue(2, parent="1", **done), issue(3, parent="2", reason="reopened"))
    assert flow.rollup(by, 3, "reopened") == [("reopen", 2), ("reopen", 1)]
    by = tree(issue(1), issue(2, parent="1", reason="reopened"))
    assert flow.rollup(by, 2, "reopened") == []                              # the parent was never closed


# ---- tools/flow.py end to end, with GitHub replaced by a recorder

class FakeGitHub:
    def __init__(self, raw):
        self.raw = {i["number"]: i for i in raw}
        self.calls = []

    def api(self, method, url, payload=None):
        n = int(url.split("/issues/")[1].split("/")[0])
        self.calls.append((method, url.split("/issues/")[1], payload))
        if method == "GET":
            return self.raw[n]
        if method == "PATCH":
            self.raw[n].update({k: v for k, v in payload.items() if k in ("body", "state", "state_reason")})
        return {}


def run_flow(monkeypatch, tmp_path, raw, name, event):
    import json
    gh = FakeGitHub(raw)
    (tmp_path / "event.json").write_text(json.dumps(event), encoding="utf-8")
    monkeypatch.setenv("GITHUB_EVENT_NAME", name)
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(tmp_path / "event.json"))
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "out.txt"))
    monkeypatch.setattr(flow, "_api", gh.api)
    monkeypatch.setattr(flow.fetch_issues, "fetch", lambda slug: [shape(i) for i in gh.raw.values()])
    flow.main()
    return gh, (tmp_path / "out.txt").read_text(encoding="utf-8").strip().splitlines()[-1]   # the file is appended to


def test_creating_a_branch_assigns_and_stamps(monkeypatch, tmp_path):
    gh, out = run_flow(monkeypatch, tmp_path, [issue(12), issue(13, assignees=["bob"])], "create",
                       {"ref": "12-add-tide", "ref_type": "branch", "sender": {"login": "alice"}})
    assert out == "changed=true"
    assert ("POST", "12/assignees", {"assignees": ["alice"]}) in gh.calls
    stamps = taken_out(gh.raw[12]["body"])
    assert len(stamps) == 1 and stamps[0]["by"] == "alice" and stamps[0]["branch"] == "12-add-tide"
    assert shape(gh.raw[12])["requirement"]["due"] == "2026-12-01"            # the form still reads back
    # someone is already assigned: stamped, but not reassigned; a branch with no issue changes nothing
    gh, out = run_flow(monkeypatch, tmp_path, [issue(13, assignees=["bob"])], "create",
                       {"ref": "13-x", "ref_type": "branch", "sender": {"login": "alice"}})
    assert not any(c[1] == "13/assignees" for c in gh.calls) and taken_out(gh.raw[13]["body"])[0]["by"] == "alice"
    gh, out = run_flow(monkeypatch, tmp_path, [issue(13)], "create", {"ref": "feature/x", "ref_type": "branch", "sender": {"login": "alice"}})
    assert out == "changed=false" and gh.calls == []


def test_merging_completes_the_requirement_and_its_parent(monkeypatch, tmp_path):
    raw = [issue(1), issue(2, parent="1", state="closed", reason="completed"), issue(3, parent="1")]
    gh, out = run_flow(monkeypatch, tmp_path, raw, "pull_request",
                       {"action": "closed", "pull_request": {"number": 40, "merged": True, "head": {"ref": "3-last-part"}}})
    assert out == "changed=true"
    assert gh.raw[3]["state"] == "closed" and gh.raw[3]["state_reason"] == "completed"
    assert gh.raw[1]["state"] == "closed", "the parent completes with its last part"
    # closed without merging: nothing happens
    gh, out = run_flow(monkeypatch, tmp_path, [issue(3)], "pull_request",
                       {"action": "closed", "pull_request": {"number": 41, "merged": False, "head": {"ref": "3-x"}}})
    assert out == "changed=false" and gh.calls == []


def test_reopening_reopens_the_parent_and_new_requirements_get_the_label(monkeypatch, tmp_path):
    raw = [issue(1, state="closed", reason="completed"), issue(2, parent="1", reason="reopened")]
    gh, out = run_flow(monkeypatch, tmp_path, raw, "issues", {"action": "reopened", "issue": raw[1]})
    assert out == "changed=true" and gh.raw[1]["state"] == "open" and gh.raw[1]["state_reason"] == "reopened"
    new = issue(9, labels=())
    gh, out = run_flow(monkeypatch, tmp_path, [new], "issues", {"action": "opened", "issue": new})
    assert gh.calls == [("POST", "9/labels", {"labels": ["requirement"]})]
