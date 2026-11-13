"""Each rule against a small hand-built model: one passing case and one failing case."""
import copy

import pytest

import run_rules


def col(name, **kw):
    base = {"name": name, "description": "d", "link": "", "formatString": "", "dataType": "string", "isHidden": False,
            "isKey": False, "sortByColumn": "", "summarizeBy": "none", "dataCategory": "", "isForeignKey": False,
            "isPrimaryKey": False}
    return {**base, **kw}


def good_model():
    return {
        "tables": [
            {"name": "DimDate", "kind": "dimension", "description": "d", "link": "", "dataCategory": "Time",
             "columns": [col("DateKey", dataType="int64", isHidden=True, isPrimaryKey=True),
                         col("Date", dataType="dateTime", isKey=True)], "measures": []},
            {"name": "FactSales", "kind": "fact", "description": "d", "link": "", "dataCategory": "",
             "columns": [col("DateKey", dataType="int64", isHidden=True, isForeignKey=True),
                         col("Revenue", dataType="double")],
             "measures": [{"name": "Total Revenue", "description": "d", "link": "", "formatString": "0", "expression": "1"}]},
        ],
        "relationships": [{"fromTable": "FactSales", "fromColumn": "DateKey", "toTable": "DimDate", "toColumn": "DateKey",
                           "crossFilter": "oneDirection", "isActive": True, "link": ""}],
    }


def t(model, name):
    return next(x for x in model["tables"] if x["name"] == name)


def break_table_description(m): t(m, "FactSales")["description"] = ""
def break_column_description(m): t(m, "FactSales")["columns"][1]["description"] = ""
def break_measure_description(m): t(m, "FactSales")["measures"][0]["description"] = ""
def break_measure_format(m): t(m, "FactSales")["measures"][0]["formatString"] = ""
def break_date_table_marked(m): t(m, "DimDate")["dataCategory"] = ""
def break_fk_hidden(m): t(m, "FactSales")["columns"][0]["isHidden"] = False
def break_table_naming(m): t(m, "FactSales")["name"] = "sales_lines"
def break_column_naming(m): t(m, "FactSales")["columns"][1]["name"] = "revenue amount"
def break_measure_naming(m): t(m, "FactSales")["measures"][0]["name"] = "total revenue"
def break_column_table_prefix(m): t(m, "FactSales")["columns"][1]["name"] = "FactSalesRevenue"
def break_no_bidirectional(m): m["relationships"][0]["crossFilter"] = "bothDirections"
def break_implicit_measure(m): t(m, "FactSales")["columns"][1]["summarizeBy"] = "sum"


@pytest.mark.parametrize("check", sorted(run_rules.CHECKS))
def test_rule_passes_then_fails(check):
    model = good_model()
    rows = run_rules.CHECKS[check](model)
    assert rows and all(r["status"] == "pass" for r in rows)
    broken = copy.deepcopy(model)
    globals()["break_" + check](broken)
    assert any(r["status"] == "fail" for r in run_rules.CHECKS[check](broken))


def test_hidden_columns_do_not_need_descriptions():
    model = good_model()
    t(model, "FactSales")["columns"][0]["description"] = ""
    assert all(r["status"] == "pass" for r in run_rules.column_description(model))
    assert run_rules.documentation_score(model) == {"described": 5, "total": 5, "pct": 100.0}


@pytest.mark.parametrize("name,ok", [("Total Revenue", True), ("Avg Wave Height (ft)", True), ("Revenue YoY %", True),
                                     ("Hours in Water", True), ("total revenue", False), ("TotalRevenue", True),
                                     ("Total  Revenue", False), ("Total_Revenue", False)])
def test_measure_title_case(name, ok):
    assert run_rules._title_case(name) is ok


def test_every_rule_in_rules_json_has_a_check():
    import json, os
    from tmdl import ROOT
    with open(os.path.join(ROOT, "rules.json"), encoding="utf-8") as f:
        rules = json.load(f)
    assert {r["check"] for r in rules} == set(run_rules.CHECKS)
    out = run_rules.run(good_model(), rules)
    assert out["failures"] == {"error": 0, "warning": 0, "info": 0}
    assert set(out["results"][0]) == {"object", "type", "table", "rule", "severity", "status", "link"}
