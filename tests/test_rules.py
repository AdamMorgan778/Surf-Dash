"""Each rule against a small hand-built model that passes everything, then with one thing broken."""
import copy
import json
import os

import pytest

import run_rules
from tmdl import ROOT


def col(name, **kw):
    base = {"name": name, "description": "d", "link": "", "formatString": "", "dataType": "string", "isHidden": False,
            "isKey": False, "sortByColumn": "", "summarizeBy": "none", "dataCategory": "", "isForeignKey": False,
            "isPrimaryKey": False, "sourceColumn": name, "expression": "", "isCalculated": False, "isAvailableInMdx": True}
    return {**base, **kw}


def measure(name, expr, fmt):
    return {"name": name, "description": "d", "link": "", "formatString": fmt, "expression": expr, "isHidden": False,
            "displayFolder": ""}


def table(name, kind, columns, measures=(), **kw):
    part = {"name": name, "kind": "m", "mode": "import", "line": 1, "link": "",
            "source": f'let Source = Csv.Document(File.Contents("{name}.csv")) in Source'}
    return {"name": name, "kind": kind, "description": "d", "link": "", "dataCategory": "", "isCalculated": False,
            "columns": list(columns), "measures": list(measures), "partitions": [part], **kw}


def rel(ft, fc, tt, tc):
    return {"fromTable": ft, "fromColumn": fc, "toTable": tt, "toColumn": tc, "crossFilter": "oneDirection",
            "isActive": True, "fromCardinality": "many", "toCardinality": "one",
            "fromDataType": "int64", "toDataType": "int64", "link": ""}


def good_model():
    return {
        "name": "Test",
        "tables": [
            table("DimDate", "dimension", [
                col("DateKey", dataType="int64", isHidden=True, isPrimaryKey=True),
                col("Date", dataType="dateTime", isKey=True),
                col("MonthName", sortByColumn="MonthNum"),
                col("MonthNum", dataType="int64", isHidden=True)], dataCategory="Time"),
            table("DimSpot", "dimension", [
                col("SpotKey", dataType="int64", isHidden=True, isKey=True, isPrimaryKey=True),
                col("Country", dataCategory="Country")]),
            table("FactSales", "fact", [
                col("DateKey", dataType="int64", isHidden=True, isForeignKey=True),
                col("SpotKey", dataType="int64", isHidden=True, isForeignKey=True),
                col("Revenue", dataType="decimal", isHidden=True),
                col("Quantity", dataType="int64"),
                col("Channel")], [
                measure("Total Revenue", "SUM(FactSales[Revenue])", "\\$#,0"),
                measure("Revenue Share %", "DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALL(DimSpot)))",
                        "#,0.0%;-#,0.0%;#,0.0%"),
                measure("Sales Lines", "COUNTROWS(FactSales)", "#,0")]),
        ],
        "relationships": [rel("FactSales", "DateKey", "DimDate", "DateKey"), rel("FactSales", "SpotKey", "DimSpot", "SpotKey")],
    }


def t(m, name):
    return next(x for x in m["tables"] if x["name"] == name)


def c(m, table_name, name):
    return next(x for x in t(m, table_name)["columns"] if x["name"] == name)


def ms(m, name):
    return next(x for x in t(m, "FactSales")["measures"] if x["name"] == name)


# One function per check: break the good model so that check must fail.
BREAK = {
    "table_description": lambda m: t(m, "FactSales").update(description=""),
    "column_description": lambda m: c(m, "FactSales", "Channel").update(description=""),
    "measure_description": lambda m: ms(m, "Total Revenue").update(description=""),
    "measure_format": lambda m: ms(m, "Total Revenue").update(formatString=""),
    "date_table_marked": lambda m: t(m, "DimDate").update(dataCategory=""),
    "fk_hidden": lambda m: c(m, "FactSales", "DateKey").update(isHidden=False),
    "table_naming": lambda m: t(m, "FactSales").update(name="sales_lines"),
    "column_naming": lambda m: c(m, "FactSales", "Channel").update(name="sales channel"),
    "measure_naming": lambda m: ms(m, "Total Revenue").update(name="total revenue"),
    "column_table_prefix": lambda m: c(m, "FactSales", "Channel").update(name="FactSalesChannel"),
    "no_bidirectional": lambda m: m["relationships"][0].update(crossFilter="bothDirections"),
    "implicit_measure": lambda m: c(m, "FactSales", "Quantity").update(summarizeBy="sum"),
    "dax_columns_qualified": lambda m: ms(m, "Total Revenue").update(expression="SUM([Revenue])"),
    "dax_measures_unqualified": lambda m: ms(m, "Revenue Share %").update(
        expression="DIVIDE(FactSales[Total Revenue], CALCULATE([Total Revenue], ALL(DimSpot)))"),
    "duplicate_measures": lambda m: ms(m, "Sales Lines").update(expression="SUM( FactSales[Revenue] )"),
    "use_divide": lambda m: ms(m, "Revenue Share %").update(
        expression="[Total Revenue] / CALCULATE([Total Revenue], ALL(DimSpot))"),
    "avoid_iferror": lambda m: ms(m, "Total Revenue").update(expression="IFERROR(SUM(FactSales[Revenue]), 0)"),
    "measure_direct_reference": lambda m: ms(m, "Sales Lines").update(expression="[Total Revenue]"),
    "no_evaluateandlog": lambda m: ms(m, "Total Revenue").update(expression="EVALUATEANDLOG(SUM(FactSales[Revenue]))"),
    "use_treatas": lambda m: ms(m, "Total Revenue").update(
        expression='CALCULATE(SUM(FactSales[Revenue]), INTERSECT(VALUES(DimSpot[Country]), {"Spain"}))'),
    "inactive_relationship_used": lambda m: m["relationships"][0].update(isActive=False),
    "column_source_column": lambda m: c(m, "FactSales", "Channel").update(sourceColumn=""),
    "measure_expression": lambda m: ms(m, "Sales Lines").update(expression=""),
    "relationship_same_type": lambda m: m["relationships"][0].update(fromDataType="string"),
    "invalid_characters": lambda m: c(m, "FactSales", "Channel").update(description="bad\x07text"),
    "table_has_relationship": lambda m: m["relationships"].pop(1),
    "unused_hidden_column": lambda m: c(m, "FactSales", "Channel").update(isHidden=True),
    "unused_hidden_measure": lambda m: ms(m, "Sales Lines").update(isHidden=True),
    "trim_names": lambda m: c(m, "FactSales", "Channel").update(name=" Channel"),
    "special_characters": lambda m: c(m, "FactSales", "Channel").update(name="Chan\tnel"),
    "first_letter_capital": lambda m: ms(m, "Sales Lines").update(name="sales Lines"),
    "partition_name": lambda m: t(m, "FactSales")["partitions"][0].update(name="Partition1"),
    "no_floating_point": lambda m: c(m, "FactSales", "Quantity").update(dataType="double"),
    "model_has_date_table": lambda m: t(m, "DimDate").update(dataCategory=""),
    "no_auto_date_tables": lambda m: t(m, "DimSpot").update(name="LocalDateTable_1a2b"),
    "no_snowflake": lambda m: m["relationships"].append(rel("DimSpot", "SpotKey", "DimDate", "DateKey")),
    "limit_bidirectional": lambda m: m["relationships"][0].update(crossFilter="bothDirections"),
    "minimize_power_query": lambda m: t(m, "FactSales")["partitions"][0].update(
        source='let S = Csv.Document(File.Contents("f.csv")), G = Table.Group(S, {"A"}, {}) in G'),
    "relationship_integer": lambda m: m["relationships"][0].update(fromDataType="string", toDataType="string"),
    "mark_primary_keys": lambda m: c(m, "DimSpot", "SpotKey").update(isKey=False),
    "hide_fact_columns": lambda m: c(m, "FactSales", "Revenue").update(isHidden=False),
    "percentage_format": lambda m: ms(m, "Revenue Share %").update(formatString="0.0%"),
    "integer_format": lambda m: ms(m, "Sales Lines").update(formatString="0"),
    "data_category": lambda m: c(m, "DimSpot", "Country").update(dataCategory=""),
    "month_sorted": lambda m: c(m, "DimDate", "MonthName").update(sortByColumn=""),
}


def test_every_check_has_a_breaker():
    assert set(BREAK) == set(run_rules.CHECKS)


@pytest.mark.parametrize("check", sorted(run_rules.CHECKS))
def test_rule_passes_then_fails(check):
    model = good_model()
    rows = run_rules.CHECKS[check](model)
    assert all(r["status"] == "pass" for r in rows), [r for r in rows if r["status"] == "fail"]
    broken = copy.deepcopy(model)
    BREAK[check](broken)
    assert any(r["status"] == "fail" for r in run_rules.CHECKS[check](broken))


def test_hidden_columns_do_not_need_descriptions():
    model = good_model()
    c(model, "FactSales", "Revenue")["description"] = ""
    assert all(r["status"] == "pass" for r in run_rules.column_description(model))
    # 3 tables + 5 visible columns + 3 measures
    assert run_rules.documentation_score(model) == {"described": 11, "total": 11, "pct": 100.0}


@pytest.mark.parametrize("name,ok", [("Total Revenue", True), ("Avg Wave Height (ft)", True), ("Revenue YoY %", True),
                                     ("Hours in Water", True), ("total revenue", False), ("TotalRevenue", True),
                                     ("Total  Revenue", False), ("Total_Revenue", False)])
def test_measure_title_case(name, ok):
    assert run_rules._title_case(name) is ok


def test_dax_references_ignore_strings_and_comments():
    expr = 'CALCULATE([Total Revenue], \'Dim Spot\'[Country] = "a [b] / c") // [Not A Ref] / 2\n'
    assert run_rules._refs(expr) == [(None, "Total Revenue"), ("Dim Spot", "Country")]
    assert "/" not in run_rules._dax(expr)


def test_userelationship_activates_inactive_relationship():
    model = good_model()
    model["relationships"][0]["isActive"] = False
    ms(model, "Sales Lines")["expression"] = \
        "CALCULATE(COUNTROWS(FactSales), USERELATIONSHIP(FactSales[DateKey], DimDate[DateKey]))"
    assert all(r["status"] == "pass" for r in run_rules.inactive_relationship_used(model))


def test_every_rule_in_rules_json_has_a_check():
    with open(os.path.join(ROOT, "rules.json"), encoding="utf-8") as f:
        rules = json.load(f)
    assert {r["check"] for r in rules} == set(run_rules.CHECKS)
    assert len({r["id"] for r in rules}) == len(rules)
    assert all(r["category"] and r["severity"] in ("error", "warning", "info") for r in rules)
    out = run_rules.run(good_model(), rules)
    assert out["failures"] == {"error": 0, "warning": 0, "info": 0}
    assert set(out["results"][0]) == {"object", "type", "table", "rule", "severity", "status", "link", "category"}


def test_every_rule_has_a_fix_note():
    with open(os.path.join(ROOT, "rules.json"), encoding="utf-8") as f:
        rules = json.load(f)
    assert all(r.get("fix", "").strip().endswith(".") for r in rules), [r["id"] for r in rules if not r.get("fix")]
