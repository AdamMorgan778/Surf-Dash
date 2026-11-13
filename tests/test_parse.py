"""The parser against the real model in this repo."""
import os

import pytest

from tmdl import ROOT

from fetch_issues import form_fields
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
