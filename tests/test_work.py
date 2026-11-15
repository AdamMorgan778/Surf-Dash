"""Who is changing what: a small Git repository built from the fixture project, with branches that overlap."""
import json
import os
import shutil
import subprocess
from datetime import date

import pytest

import work
from fetch_issues import shape

MODEL = "Sample.SemanticModel/definition/"
PAGE = "Sample.Report/definition/pages/p1/"


def _git(root, *args, who="Setup"):
    env = dict(os.environ, GIT_AUTHOR_NAME=who, GIT_AUTHOR_EMAIL="a@example.com", GIT_COMMITTER_NAME=who, GIT_COMMITTER_EMAIL="a@example.com")
    subprocess.run(["git", "-C", str(root), "-c", "core.autocrlf=false", *args], check=True, capture_output=True, env=env)


def _edit(root, path, old, new):
    p = root / path
    text = p.read_text(encoding="utf-8")
    assert old in text
    p.write_text(text.replace(old, new), encoding="utf-8", newline="\n")


def _visual(title):
    return json.dumps({"name": "v1", "visual": {"visualType": "lineChart", "visualContainerObjects": {
        "title": [{"properties": {"text": {"expr": {"Literal": {"Value": f"'{title}'"}}}}}]}}})


@pytest.fixture(scope="module")
def repo(tmp_path_factory, sample_root):
    root = tmp_path_factory.mktemp("repo") / "project"
    shutil.copytree(sample_root, root)
    for path, text in [(PAGE + "page.json", json.dumps({"name": "p1", "displayName": "Sales page"})),
                       (PAGE + "visuals/v1/visual.json", _visual("Revenue by Month")),
                       (PAGE + "visuals/v2/visual.json", json.dumps({"name": "v2", "visual": {"visualType": "card", "query": {"queryState": {
                           "Values": {"projections": [{"nativeQueryRef": "Total Amount"}]}}}}})),
                       ("Sample.Report/definition/report.json", "{}"), ("notes.md", "not part of the PBIP")]:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text, encoding="utf-8")
    _git(root, "init", "-q", "-b", "main")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "base")

    _git(root, "checkout", "-q", "-b", "alice-work")
    _edit(root, MODEL + "tables/FactOrders.tmdl", "SUM(FactOrders[Amount])", "SUMX(FactOrders, FactOrders[Amount])")
    _edit(root, MODEL + "tables/DimCustomer.tmdl", "\tpartition", "\tcolumn Segment\n\t\tdataType: string\n\t\tsourceColumn: Segment\n\n\tpartition")
    (root / PAGE / "visuals/v1/visual.json").write_text(_visual("Revenue by Month").replace("lineChart", "areaChart"), encoding="utf-8")
    (root / PAGE / "visuals/v2/visual.json").unlink()
    (root / "Sample.Report/definition/report.json").write_text('{"a": 1}', encoding="utf-8")
    (root / "notes.md").write_text("changed, but not part of the PBIP", encoding="utf-8")
    _git(root, "commit", "-q", "-am", "alice", who="Alice")

    _git(root, "checkout", "-q", "main")
    _git(root, "checkout", "-q", "-b", "bob-work")
    _edit(root, MODEL + "tables/FactOrders.tmdl", "/// Sum of order amounts.", "/// Total of all order amounts.")
    _edit(root, MODEL + "relationships.tmdl", "\tcrossFilteringBehavior: bothDirections\n", "")
    (root / "Sample.Report/definition/report.json").write_text('{"b": 2}', encoding="utf-8")
    _git(root, "commit", "-q", "-am", "bob", who="Bob")

    _git(root, "checkout", "-q", "main")
    _git(root, "branch", "already-merged")
    return root


def _collect(repo, model, issues=(), pulls=(), today=date(2020, 1, 1)):
    return work.collect(model, {"issues": list(issues), "pulls": list(pulls)}, root=str(repo), base="main", today=today, prefix="refs/heads/")


def test_what_each_branch_changes(repo, sample):
    out = _collect(repo, sample[0])
    assert out["note"] == "" and out["branches"] == ["alice-work", "bob-work"]      # the merged branch is left out
    got = {(i["ref"], i["kind"], i["area"], i["object"], i["change"]) for i in out["items"]}
    assert got == {
        ("alice-work", "measure", "FactOrders", "Total Amount", "changed"),
        ("alice-work", "column", "DimCustomer", "Segment", "added"),
        ("alice-work", "visual", "Sales page", "Revenue by Month", "changed"),
        ("alice-work", "visual", "Sales page", "card: Total Amount", "removed"),
        ("alice-work", "file", "Shared files", "report.json", "changed"),
        ("bob-work", "measure", "FactOrders", "Total Amount", "changed"),
        ("bob-work", "relationship", "FactOrders", "FactOrders[CustomerKey] to DimCustomer[CustomerKey]", "changed"),
        ("bob-work", "file", "Shared files", "report.json", "changed")}
    assert {i["who"] for i in out["items"]} == {"Alice", "Bob"} and not any(i["stale"] for i in out["items"])
    areas = {(a["kind"], a["name"]): a for a in out["areas"]}
    assert areas[("table", "DimDate")]["workers"] == [] and areas[("page", "Sales page")]["items"] == 2
    assert [w["ref"] for w in areas[("table", "FactOrders")]["workers"]] == ["alice-work", "bob-work"]
    assert ("shared", "Shared files") in areas


def test_overlaps_between_branches(repo, sample):
    found = {(o["area"], o["object"]): o for o in _collect(repo, sample[0])["overlaps"]}
    assert set(found) == {("FactOrders", "Total Amount"), ("Shared files", "report.json")}
    assert [p["ref"] for p in found[("FactOrders", "Total Amount")]["parties"]] == ["alice-work", "bob-work"]
    assert found[("Shared files", "report.json")]["reason"].startswith("Shared file")


def test_pull_request_names_the_person_and_old_branches_are_stale(repo, sample):
    pulls = [{"number": 9, "url": "https://github.com/o/r/pull/9", "branch": "alice-work", "author": "alice-gh", "draft": False, "title": "t"}]
    out = _collect(repo, sample[0], pulls=pulls, today=date(2999, 1, 1))
    alice = [i for i in out["items"] if i["ref"] == "alice-work"]
    assert all(i["who"] == "alice-gh" and i["pr"] == 9 and i["url"].endswith("/pull/9") for i in alice)
    assert all(i["stale"] for i in out["items"])
    bob = next(i for i in out["items"] if i["ref"] == "bob-work")
    assert bob["url"] == "https://github.com/o/r/tree/bob-work" and bob["pr"] is None


def _issue(number, body, user="carol", assignees=(), labels=()):
    return shape({"number": number, "title": "t", "state": "open", "html_url": f"https://github.com/o/r/issues/{number}",
                  "created_at": "2019-12-30T00:00:00Z", "closed_at": None, "body": body, "user": {"login": user},
                  "labels": [{"name": l} for l in labels], "assignees": [{"login": a} for a in assignees]})


def test_claims_and_housekeeping_are_read_and_overlap_with_branches(repo, sample):
    claim = _issue(5, "### Items\n\n- Table · DimCustomer\n- Report page · Sales page\n- not a claim\n\n### Notes\n\n_No response_", labels=["working-on"])
    assert claim["claims"] == [{"kind": "table", "name": "DimCustomer"}, {"kind": "page", "name": "Sales page"}]
    assert claim["requestType"] == "Working on" and claim["author"] == "carol"
    hk_body = ("### Items\n\n- [ ] FactOrders · Total Amount — Some rule (rule: x)\n- [x] FactOrders · Order Count — Some rule (rule: x)\n"
               "- [ ] FactOrders · Quantity — Some rule (rule: x)")
    mine = _issue(6, hk_body, assignees=["dave"])
    mine["branches"] = ["bob-work"]                      # bob's branch was created from this issue
    raised = _issue(7, hk_body)                          # nobody on it: not work in progress
    out = _collect(repo, sample[0], issues=[claim, mine, raised])
    by_source = {s: [i for i in out["items"] if i["source"] == s] for s in ("claim", "housekeeping")}
    assert [(i["kind"], i["area"], i["who"], i["ref"]) for i in by_source["claim"]] == [("table", "DimCustomer", "carol", "#5"), ("page", "Sales page", "carol", "#5")]
    assert [(i["kind"], i["object"], i["who"]) for i in by_source["housekeeping"]] == [("measure", "Total Amount", "dave"), ("column", "Quantity", "dave")]
    found = {(o["area"], o["object"]): o for o in out["overlaps"]}
    # carol's claims catch alice's work inside them
    assert found[("DimCustomer", "Segment")]["reason"] == "DimCustomer is claimed by carol"
    assert ("Sales page", "Revenue by Month") in found
    # dave's housekeeping item overlaps alice's branch, but not bob's, which belongs to the same issue
    refs = [p["ref"] for p in found[("FactOrders", "Total Amount")]["parties"]]
    assert "#6" in refs and "alice-work" in refs
    assert out["people"] == ["Alice", "Bob", "carol", "dave"]


def test_without_git_history_the_page_still_builds(tmp_path, sample):
    out = work.collect(sample[0], {"issues": []}, root=str(tmp_path), base="origin/main")
    assert out["items"] == [] and "not compared" in out["note"]


def test_visual_label_falls_back_to_type():
    assert work.visual_label(json.dumps({"visual": {"visualType": "slicer"}}), "v9") == "slicer (v9)"
    assert work.visual_label("not json", "v9") == "visual (v9)"


def test_pull_request_overlap_summary(repo, sample):
    import check_pr
    out = _collect(repo, sample[0])
    text = check_pr.overlap_summary(out, "bob-work")
    assert "### Overlaps with other work" in text
    assert "| FactOrders | Measure Total Amount | Alice ([alice-work](https://github.com/o/r/tree/alice-work)) |" in text
    assert "| Shared files | File report.json |" in text
    assert check_pr.overlap_summary(out, "some-other-branch") == ""
