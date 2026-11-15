"""expand_housekeeping against the fixture project in tests/fixtures/sample."""
from expand_housekeeping import BODY_LIMIT, COMMENT_LIMIT, MARKER, expand
from fetch_issues import shape
from housekeeping import item_line


def body_with(lines):
    return ("### Items\n\n" + "\n".join(lines) + "\n\n### Priority\n\nMedium\n\n### Notes\n\nPlease do these before the release.")


ITEMS = [
    "- [ ] FactOrders · Amount — Hide fact table columns (rule: hide-fact-columns)",                       # failing
    "- [x] FactOrders · Order Count — Measures have descriptions (rule: measure-description)",            # failing
    "- [ ] DimCustomer · DimCustomer — Ensure tables have relationships (rule: table-has-relationship)",  # passes
    "- [ ] FactOrders · FactOrders[CustomerKey] to DimCustomer[CustomerKey] — Check bi-directional relationships (rule: no-bidirectional)",
    "- [ ] Whole model · Sample — Model should have a date table (rule: model-has-date-table)",           # passes
]


def test_expands_each_item_with_rule_object_and_description(sample):
    out = expand(body_with(ITEMS[:2]), *sample)
    body = out["body"]
    assert out["comments"] == [] and body.startswith(MARKER)
    assert "  - **Rule:** Hide fact table columns · Formatting · warning · BPA HIDE_FACT_TABLE_COLUMNS" in body
    assert "  - **Breaking it:** column [Amount](https://github.com/o/r/blob/main/" in body
    assert "in table FactOrders (decimal, visible)" in body
    assert "  - **What the rule is:** Numeric columns aggregated by a measure are hidden, so people use the measure." in body
    assert "  - **How to fix:** Hide the column" in body
    assert "  - **Breaking it:** measure [Order Count](" in body
    # ticks and the other fields are untouched
    assert "- [x] FactOrders · Order Count" in body
    assert "### Notes\n\nPlease do these before the release." in body


def test_still_reads_back_as_the_same_items(sample):
    before = shape(_issue(body_with(ITEMS)))["items"]
    after = shape(_issue(expand(body_with(ITEMS), *sample)["body"]))["items"]
    assert after == before and len(after) == 5 and after[1]["done"] is True


def test_object_wording_by_type_and_items_that_now_pass(sample):
    body = expand(body_with(ITEMS), *sample)["body"]
    assert "**Breaking it:** relationship [FactOrders[CustomerKey] to DimCustomer[CustomerKey]](" in body
    assert "**Breaking it:** the whole model" in body
    assert "**Breaking it:** `DimCustomer` in table DimCustomer" in body
    assert body.count("No longer failing in the current model") == 2


def test_unknown_and_switched_off_rules_are_said_to_be_gone(sample):
    body = expand(body_with(["- [ ] DimDate · DimDate — Old rule (rule: switched-off)"]), *sample)["body"]
    assert "**Rule:** `switched-off` (not in rules.json any more)" in body


def test_runs_once(sample):
    once = expand(body_with(ITEMS[:1]), *sample)["body"]
    assert expand(once, *sample) is None
    assert expand("### Items\n\nNothing to see here", *sample) is None


def test_huge_lists_go_to_comments(sample):
    _, results, rules = sample
    lines = [item_line(r, rules[r["rule"]]["name"]) for r in results["results"]] * 150
    out = expand(body_with(lines), *sample)
    assert len(out["body"]) <= BODY_LIMIT + 200 and "comments below" in out["body"]
    assert out["comments"] and all(len(c) <= COMMENT_LIMIT + 100 for c in out["comments"])
    assert sum(c.count("**What the rule is:**") for c in out["comments"]) == len(lines)
    assert out["comments"][0].startswith("**Item descriptions (1 of ")
    # the compact body still carries every checkbox
    assert len(shape(_issue(out["body"]))["items"]) == len(lines)


def _issue(body):
    return {"number": 7, "title": "t", "state": "open", "html_url": "u", "created_at": "2026-11-14T00:00:00Z",
            "closed_at": None, "body": body, "labels": [{"name": "housekeeping"}], "assignees": []}
