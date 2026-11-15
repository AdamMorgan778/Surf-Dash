"""The housekeeping item line (written and read in one module) and the join of failing checks to open issues."""
import copy

from housekeeping import annotate, item_line, parse_items


def test_item_line_round_trip():
    rows = [{"table": "FactOrders", "object": "Amount", "rule": "hide-fact-columns"},
            {"table": "(model)", "object": "Sample", "rule": "model-has-date-table"},
            {"table": "FactOrders", "object": "FactOrders[DateKey] to DimDate[DateKey]", "rule": "no-bidirectional"},
            {"table": "(model)", "object": "Amount: FactOrders.Missing", "rule": "metadata-references"}]
    lines = [item_line(r, "A rule name (with brackets)") for r in rows] + [item_line(rows[0], "Name", done=True)]
    assert lines[0] == "- [ ] FactOrders · Amount — A rule name (with brackets) (rule: hide-fact-columns)"
    assert lines[1].startswith("- [ ] Whole model · Sample — ")
    back = parse_items("intro\n" + "\n".join(lines) + "\n- [ ] not an item")
    assert [{k: b[k] for k in ("table", "object", "rule")} for b in back[:4]] == rows
    assert [b["done"] for b in back] == [False, False, False, False, True]


def _issue(number, items, work="raised", state="open", **kw):
    return {"number": number, "url": f"u/{number}", "state": state, "work": work, "items": items,
            "assignees": kw.get("assignees", []), "branches": kw.get("branches", [])}


def test_annotate_gives_every_failing_check_its_line_and_status(sample):
    results = copy.deepcopy(sample[1])
    key = lambda r: (r["table"], r["object"], r["rule"])
    amount = next(r for r in results["results"] if r["object"] == "Amount")
    count = next(r for r in results["results"] if r["object"] == "Order Count")
    rel = next(r for r in results["results"] if r["rule"] == "no-bidirectional")
    item = lambda r, done=False: {"table": r["table"], "object": r["object"], "rule": r["rule"], "done": done}
    issues = [
        _issue(1, [item(amount), item(count, done=True)]),
        _issue(2, [item(amount)], work="in-progress", assignees=["alice"], branches=["2-fix"]),   # wins over issue 1
        _issue(3, [item(rel)], state="closed", work="closed"),                                    # closed: ignored
        {"number": 4, "url": "u/4", "state": "open", "work": "raised"},                           # not a housekeeping issue
    ]
    annotate(results, issues)
    assert amount["item"] == "- [ ] FactOrders · Amount — Hide fact table columns (rule: hide-fact-columns)"
    assert amount["work"] == {"status": "in-progress", "number": 2, "url": "u/2", "assignees": ["alice"], "branches": ["2-fix"]}
    assert count["work"]["status"] == "done" and count["work"]["number"] == 1
    assert rel["work"] == {"status": "none"}
    assert all("item" in r and "work" in r for r in results["results"]) and len({key(r) for r in results["results"]}) == 3
