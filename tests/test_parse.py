"""The TMDL parser and the issue reader, against the fixture project in tests/fixtures/sample."""
import pytest

from fetch_issues import form_fields, match_tables, shape
from parse_model import find_model_dir


@pytest.fixture(scope="module")
def model(sample):
    return sample[0]


def by_name(items, name):
    return next(i for i in items if i["name"] == name)


def test_counts_and_names(model):
    assert model["name"] == "Sample" and model["siteName"] == "Sample model docs"
    assert [t["name"] for t in model["tables"]] == ["DimCustomer", "DimDate", "FactOrders"]
    assert sum(len(t["measures"]) for t in model["tables"]) == 4
    assert len(model["relationships"]) == 2


def test_fact_and_dimension_classification(model):
    assert {t["name"]: t["kind"] for t in model["tables"]} == {"DimCustomer": "dimension", "DimDate": "dimension", "FactOrders": "fact"}


def test_table_properties(model):
    date = by_name(model["tables"], "DimDate")
    assert date["dataCategory"] == "Time" and date["description"] == "Calendar with one row per day."
    assert by_name(date["columns"], "Date")["isKey"]
    assert by_name(date["columns"], "MonthName")["sortByColumn"] == "MonthNum"
    orders = by_name(model["tables"], "FactOrders")
    assert orders["source"] == "FactOrders.csv" and orders["rowCount"] == 3
    assert date["rowCount"] is None                     # no CSV for it: row counts are optional
    assert orders["meta"] == {"business_process": "Orders", "grain": "One row per order", "owner": "Sales"}
    assert orders["link"] == "https://github.com/o/r/blob/main/Sample.SemanticModel/definition/tables/FactOrders.tmdl#L2"


def test_descriptions_and_gaps(model):
    customer = by_name(model["tables"], "DimCustomer")
    assert by_name(customer["columns"], "Name")["description"] == "Full name of the customer."
    assert by_name(customer["columns"], "Country")["description"] == ""
    assert by_name(by_name(model["tables"], "FactOrders")["measures"], "Order Count")["description"] == ""


def test_columns_measures_and_partitions(model):
    orders = by_name(model["tables"], "FactOrders")
    key = by_name(orders["columns"], "DateKey")
    assert key["isHidden"] and key["isForeignKey"] and key["dataType"] == "int64"
    amount = by_name(orders["columns"], "Amount")
    assert amount["summarizeBy"] == "sum" and amount["sourceColumn"] == "Amount" and not amount["isCalculated"]
    ly = by_name(orders["measures"], "Amount LY")
    assert "SAMEPERIODLASTYEAR" in ly["expression"] and ly["displayFolder"] == "Time Intelligence" and ly["formatString"]
    assert by_name(orders["measures"], "Avg Amount")["expression"].startswith("DIVIDE(")   # multi-line DAX
    assert by_name(by_name(model["tables"], "DimCustomer")["columns"], "CustomerKey")["isPrimaryKey"]
    part = orders["partitions"][0]
    assert part["name"] == "FactOrders" and part["kind"] == "m" and part["mode"] == "import" and "Csv.Document" in part["source"]


def test_relationships(model):
    r1, r2 = model["relationships"]
    assert (r1["fromTable"], r1["toTable"], r1["crossFilter"]) == ("FactOrders", "DimDate", "oneDirection")
    assert r2["crossFilter"] == "bothDirections"
    assert all(r["fromDataType"] == r["toDataType"] == "int64" and r["toCardinality"] == "one" for r in model["relationships"])


def test_measure_dependencies(model):
    measures = by_name(model["tables"], "FactOrders")["measures"]
    avg, total = by_name(measures, "Avg Amount"), by_name(measures, "Total Amount")
    assert avg["dependsOn"] == {"measures": ["Total Amount", "Order Count"], "columns": []}
    assert total["dependsOn"] == {"measures": [], "columns": ["FactOrders[Amount]"]}
    assert total["usedBy"] == ["Amount LY", "Avg Amount"]
    assert by_name(measures, "Amount LY")["dependsOn"]["columns"] == ["DimDate[Date]"]


def test_metadata_is_carried_for_the_rules(model):
    assert model["metadataTables"] == ["DimCustomer", "DimDate", "DimOld", "FactOrders"]
    assert model["glossary"][0]["term"] == "Amount"


def test_model_folder_must_be_unambiguous(tmp_path):
    with pytest.raises(SystemExit):
        find_model_dir(str(tmp_path))
    (tmp_path / "A.SemanticModel" / "definition").mkdir(parents=True)
    assert find_model_dir(str(tmp_path)).endswith("definition")
    (tmp_path / "B.SemanticModel" / "definition").mkdir(parents=True)
    with pytest.raises(SystemExit):
        find_model_dir(str(tmp_path))
    (tmp_path / "settings.yml").write_text("model: B.SemanticModel\n", encoding="utf-8")
    assert "B.SemanticModel" in find_model_dir(str(tmp_path))


def test_issue_form_fields():
    body = "### Table\n\nDimCustomer\n\n### Request type\n\nData quality\n\n### Priority\n\n_No response_\n\n### Details\n\nLine one\nLine two"
    fields = form_fields(body)
    assert fields["table"] == "DimCustomer"
    assert fields["request type"] == "Data quality"
    assert fields["priority"] == ""
    assert fields["details"] == "Line one\nLine two"


def _issue(body, labels=()):
    return {"number": 12, "title": "[Housekeeping] 3 fixes", "state": "open", "html_url": "https://github.com/o/r/issues/12",
            "created_at": "2026-11-13T10:00:00Z", "closed_at": None, "body": body, "labels": [{"name": l} for l in labels]}


ITEM = "### Items\n\n- [ ] DimCustomer · Country — Visible columns have descriptions (rule: column-description)"


def test_free_text_table_is_matched_to_the_model():
    issues = [shape(_issue(f"### Table\n\n{t}")) for t in ("dimcustomer", " Whole Model ", "Nonsense", "")]
    match_tables(issues, ["DimCustomer", "FactOrders"])
    assert [i["table"] for i in issues] == ["DimCustomer", "Whole model", "Unassigned", "Unassigned"]


def test_housekeeping_issue_items_are_read_back():
    body = ("### Items\n\nSome text someone typed.\n\n"
            "- [ ] FactOrders · Amount — Hide fact table columns (rule: hide-fact-columns)\n"
            "- [x] FactOrders · Quantity — an older, longer wording of the rule. (rule: hide-fact-columns)\n"
            "- [ ] Whole model · Sample — Model should have a date table (rule: model-has-date-table)\n"
            "- [ ] a line without a rule marker\n\n### Priority\n\nMedium\n\n### Notes\n\n_No response_")
    out = shape(_issue(body, ["housekeeping"]))
    assert out["requestType"] == "Housekeeping" and out["priority"] == "Medium"
    assert out["items"] == [
        {"table": "FactOrders", "object": "Amount", "rule": "hide-fact-columns", "done": False},
        {"table": "FactOrders", "object": "Quantity", "rule": "hide-fact-columns", "done": True},
        {"table": "(model)", "object": "Sample", "rule": "model-has-date-table", "done": False}]
    assert out["progress"] == {"done": 1, "total": 3}
    assert out["table"] == "Whole model"   # more than one table involved


def test_housekeeping_single_table_and_plain_issues():
    assert shape(_issue(ITEM))["table"] == "DimCustomer"
    plain = shape(_issue("### Table\n\nDimDate\n\n### Request type\n\nQuestion"))
    assert "items" not in plain and plain["table"] == "DimDate" and plain["requestType"] == "Question"


def test_work_status_from_assignee_label_and_closed():
    assert shape(_issue(ITEM, ["housekeeping"]))["work"] == "raised"
    assigned = _issue(ITEM, ["housekeeping"])
    assigned["assignees"] = [{"login": "alice"}]
    out = shape(assigned)
    assert out["work"] == "in-progress" and out["assignees"] == ["alice"]
    assert shape(_issue(ITEM, ["housekeeping", "in-progress"]))["work"] == "in-progress"
    closed = _issue(ITEM, ["housekeeping"])
    closed["state"] = "closed"
    assert shape(closed)["work"] == "closed"


def test_attach_branches_marks_in_progress():
    from fetch_issues import attach_branches
    a, b = shape(_issue(ITEM, ["housekeeping"])), shape(_issue(ITEM, ["housekeeping"]))
    b["number"] = 13
    seen = {}

    def fake(query, variables):
        seen.update(query=query, variables=variables)
        return {"data": {"repository": {"i12": {"linkedBranches": {"nodes": [{"ref": {"name": "12-housekeeping-fixes"}}]}},
                                        "i13": {"linkedBranches": {"nodes": []}}}}}
    assert attach_branches("o/r", [a, b, shape(_issue("### Table\n\nDimDate"))], query=fake) == ""
    assert "i12: issue(number: 12)" in seen["query"] and seen["variables"] == {"owner": "o", "name": "r"}
    assert a["branches"] == ["12-housekeeping-fixes"] and a["work"] == "in-progress"
    assert b["branches"] == [] and b["work"] == "raised"


def test_attach_branches_without_token(monkeypatch):
    from fetch_issues import attach_branches
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    i = shape(_issue(ITEM, ["housekeeping"]))
    assert "no GITHUB_TOKEN" in attach_branches("o/r", [i])
    assert i["work"] == "raised"
