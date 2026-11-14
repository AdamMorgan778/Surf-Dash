"""expand_housekeeping against the real model in this repo."""
import pytest

from expand_housekeeping import BODY_LIMIT, COMMENT_LIMIT, MARKER, expand, load_rules
from fetch_issues import shape
from parse_model import parse_model
from run_rules import run


@pytest.fixture(scope="module")
def ctx():
    rules = load_rules()
    model = parse_model()
    return model, run(model, list(rules.values())), rules


def body_with(lines):
    return ("### Items\n\n" + "\n".join(lines) + "\n\n### Priority\n\nMedium\n\n### Notes\n\nPlease do these before the release.")


ITEMS = [
    "- [ ] FactSales · Revenue — Hide fact table columns (rule: hide-fact-columns)",
    "- [x] FactSales · Total Discounts — Measures have descriptions (rule: measure-description)",
    "- [ ] DimSpot · DimSpot — Ensure tables have relationships (rule: table-has-relationship)",
    "- [ ] FactSales · FactSales[DateKey] to DimDate[DateKey] — Check bi-directional relationships (rule: no-bidirectional)",
    "- [ ] Whole model · SurfAnalytics — Model should have a date table (rule: model-has-date-table)",
]


def test_expands_each_item_with_rule_object_and_description(ctx):
    out = expand(body_with(ITEMS[:2]), *ctx)
    body = out["body"]
    assert out["comments"] == [] and body.startswith(MARKER)
    assert "  - **Rule:** Hide fact table columns · Formatting · warning · BPA HIDE_FACT_TABLE_COLUMNS" in body
    assert "  - **Breaking it:** column [Revenue](" in body and "in table FactSales (decimal, visible)" in body
    assert "  - **What the rule is:** Numeric columns aggregated by a measure are hidden, so people use the measure." in body
    assert "  - **How to fix:** Hide the column" in body
    assert "  - **Breaking it:** measure [Total Discounts](" in body
    # ticks and the other fields are untouched
    assert "- [x] FactSales · Total Discounts" in body
    assert "### Notes\n\nPlease do these before the release." in body


def test_still_reads_back_as_the_same_items(ctx):
    before = shape(_issue(body_with(ITEMS)))["items"]
    after = shape(_issue(expand(body_with(ITEMS), *ctx)["body"]))["items"]
    assert after == before and len(after) == 5 and after[1]["done"] is True


def test_object_wording_by_type_and_items_that_now_pass(ctx):
    body = expand(body_with(ITEMS), *ctx)["body"]
    assert "**Breaking it:** relationship [FactSales[DateKey] to DimDate[DateKey]](" in body
    assert "**Breaking it:** the whole model" in body
    assert "**Breaking it:** table [DimSpot](" in body
    # these three pass in the current model, so they are flagged rather than described as failing
    assert body.count("No longer failing in the current model") == 3


def test_runs_once(ctx):
    once = expand(body_with(ITEMS[:1]), *ctx)["body"]
    assert expand(once, *ctx) is None
    assert expand("### Items\n\nNothing to see here", *ctx) is None


def test_huge_lists_go_to_comments(ctx):
    model, results, rules = ctx
    fails = [r for r in results["results"] if r["status"] == "fail"]
    lines = [f"- [ ] {'Whole model' if r['table'] == '(model)' else r['table']} · {r['object']} — {rules[r['rule']]['name']} (rule: {r['rule']})"
             for r in fails] * 10   # 430 items
    out = expand(body_with(lines), *ctx)
    assert len(out["body"]) <= BODY_LIMIT + 200 and "comments below" in out["body"]
    assert out["comments"] and all(len(c) <= COMMENT_LIMIT + 100 for c in out["comments"])
    assert sum(c.count("**What the rule is:**") for c in out["comments"]) == len(lines)
    assert out["comments"][0].startswith("**Item descriptions (1 of ")
    # the compact body still carries every checkbox
    assert len(shape(_issue(out["body"]))["items"]) == len(lines)


def _issue(body):
    return {"number": 7, "title": "t", "state": "open", "html_url": "u", "created_at": "2026-11-14T00:00:00Z",
            "closed_at": None, "body": body, "labels": [{"name": "housekeeping"}], "assignees": []}
