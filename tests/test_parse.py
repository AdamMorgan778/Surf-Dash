"""The parser against the real model in this repo."""
import os

import pytest

from tmdl import ROOT

from fetch_issues import form_fields, shape
from parse_model import parse_model


@pytest.fixture(scope="module")
def model():
    return parse_model()


def by_name(items, name):
    return next(i for i in items if i["name"] == name)


def test_counts(model):
    assert len(model["tables"]) == 7
    assert sum(len(t["measures"]) for t in model["tables"]) == 17
    assert len(model["relationships"]) == 8


def test_fact_and_dimension_classification(model):
    kinds = {t["name"]: t["kind"] for t in model["tables"]}
    assert {n for n, k in kinds.items() if k == "fact"} == {"FactSession", "FactSales"}
    assert {n for n, k in kinds.items() if k == "dimension"} == {"DimDate", "DimSpot", "DimSurfer", "DimBoard", "DimProduct"}


def test_table_properties(model):
    date = by_name(model["tables"], "DimDate")
    assert date["dataCategory"] == "Time"
    assert by_name(date["columns"], "Date")["isKey"]
    assert by_name(date["columns"], "MonthName")["sortByColumn"] == "MonthNum"
    sales = by_name(model["tables"], "FactSales")
    assert sales["source"] == "FactSales.csv"
    if os.path.exists(os.path.join(ROOT, "Data", "FactSales.csv")):  # the CSVs are optional for the docs
        assert sales["rowCount"] > 1000
    else:
        assert sales["rowCount"] is None
    assert sales["meta"]["owner"]


def test_descriptions_and_gaps(model):
    board = by_name(model["tables"], "DimBoard")
    assert board["description"].startswith("Surfboard models")
    assert by_name(board["columns"], "BoardKey")["description"]
    assert by_name(board["columns"], "LengthFt")["description"] == ""


def test_columns_and_measures(model):
    sales = by_name(model["tables"], "FactSales")
    key = by_name(sales["columns"], "DateKey")
    assert key["isHidden"] and key["isForeignKey"] and key["dataType"] == "int64"
    assert by_name(sales["columns"], "Revenue")["summarizeBy"] == "sum"
    ly = by_name(sales["measures"], "Revenue LY")
    assert "SAMEPERIODLASTYEAR" in ly["expression"]
    assert ly["displayFolder"] == "Time Intelligence" and ly["formatString"]
    assert by_name(by_name(model["tables"], "DimSpot")["columns"], "SpotKey")["isPrimaryKey"]


def test_fields_used_by_bpa_rules(model):
    sales = by_name(model["tables"], "FactSales")
    revenue = by_name(sales["columns"], "Revenue")
    assert revenue["sourceColumn"] == "Revenue" and not revenue["isCalculated"] and revenue["isAvailableInMdx"]
    assert len(sales["partitions"]) == 1
    part = sales["partitions"][0]
    assert part["name"] == "FactSales" and part["kind"] == "m" and part["mode"] == "import"
    assert "Csv.Document" in part["source"] and "Table.TransformColumnTypes" in part["source"]
    assert all(r["fromDataType"] == r["toDataType"] == "int64" for r in model["relationships"])
    assert all(r["toCardinality"] == "one" for r in model["relationships"])


def test_issue_form_fields():
    body = "### Table\n\nDimSpot\n\n### Request type\n\nData quality\n\n### Priority\n\n_No response_\n\n### Details\n\nLine one\nLine two"
    fields = form_fields(body)
    assert fields["table"] == "DimSpot"
    assert fields["request type"] == "Data quality"
    assert fields["priority"] == ""
    assert fields["details"] == "Line one\nLine two"


def _issue(body, labels=()):
    return {"number": 12, "title": "[Housekeeping] 3 fixes", "state": "open", "html_url": "https://github.com/o/r/issues/12",
            "created_at": "2026-11-13T10:00:00Z", "closed_at": None, "body": body, "labels": [{"name": l} for l in labels]}


def test_housekeeping_issue_items_are_read_back():
    body = ("### Items\n\n**Numeric columns aggregated by a measure are hidden.**\nFix: Hide the column.\n\n"
            "- [ ] FactSales · Revenue — Numeric columns aggregated by a measure are hidden. (rule: hide-fact-columns)\n"
            "- [x] FactSales · Quantity — Numeric columns aggregated by a measure are hidden. (rule: hide-fact-columns)\n"
            "- [ ] Whole model · SurfAnalytics — The model has a date table. (rule: model-has-date-table)\n"
            "- [ ] a line without a rule marker\n\n### Priority\n\nMedium\n\n### Notes\n\n_No response_")
    out = shape(_issue(body, ["housekeeping"]))
    assert out["requestType"] == "Housekeeping" and out["priority"] == "Medium"
    assert out["items"] == [
        {"table": "FactSales", "object": "Revenue", "rule": "hide-fact-columns", "done": False},
        {"table": "FactSales", "object": "Quantity", "rule": "hide-fact-columns", "done": True},
        {"table": "(model)", "object": "SurfAnalytics", "rule": "model-has-date-table", "done": False}]
    assert out["progress"] == {"done": 1, "total": 3}
    assert out["table"] == "Whole model"   # more than one table involved


def test_housekeeping_single_table_and_plain_issues():
    body = "### Items\n\n- [ ] DimBoard · LengthFt — Every visible column has a description. (rule: column-description)"
    assert shape(_issue(body))["table"] == "DimBoard"
    plain = shape(_issue("### Table\n\nDimSpot\n\n### Request type\n\nQuestion"))
    assert "items" not in plain and plain["table"] == "DimSpot" and plain["requestType"] == "Question"


def test_work_status_from_assignee_label_and_closed():
    body = "### Items\n\n- [ ] DimBoard · LengthFt — Every visible column has a description. (rule: column-description)"
    assert shape(_issue(body, ["housekeeping"]))["work"] == "raised"
    assigned = _issue(body, ["housekeeping"]); assigned["assignees"] = [{"login": "alice"}]
    out = shape(assigned)
    assert out["work"] == "in-progress" and out["assignees"] == ["alice"]
    assert shape(_issue(body, ["housekeeping", "in-progress"]))["work"] == "in-progress"
    closed = _issue(body, ["housekeeping"]); closed["state"] = "closed"
    assert shape(closed)["work"] == "closed"


def test_attach_branches_marks_in_progress():
    from fetch_issues import attach_branches
    body = "### Items\n\n- [ ] DimBoard · LengthFt — Every visible column has a description. (rule: column-description)"
    a, b = shape(_issue(body, ["housekeeping"])), shape(_issue(body, ["housekeeping"]))
    b["number"] = 13
    seen = {}

    def fake(query, variables):
        seen.update(query=query, variables=variables)
        return {"data": {"repository": {"i12": {"linkedBranches": {"nodes": [{"ref": {"name": "12-housekeeping-fixes"}}]}},
                                        "i13": {"linkedBranches": {"nodes": []}}}}}
    assert attach_branches("o/r", [a, b, shape(_issue("### Table\n\nDimSpot"))], query=fake) == ""
    assert "i12: issue(number: 12)" in seen["query"] and seen["variables"] == {"owner": "o", "name": "r"}
    assert a["branches"] == ["12-housekeeping-fixes"] and a["work"] == "in-progress"
    assert b["branches"] == [] and b["work"] == "raised"


def test_attach_branches_without_token(monkeypatch):
    from fetch_issues import attach_branches
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    body = "### Items\n\n- [ ] DimBoard · LengthFt — Every visible column has a description. (rule: column-description)"
    i = shape(_issue(body, ["housekeeping"]))
    assert "no GITHUB_TOKEN" in attach_branches("o/r", [i])
    assert i["work"] == "raised"
