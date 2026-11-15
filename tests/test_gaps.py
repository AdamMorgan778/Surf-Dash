"""What the documentation is missing, against the fixture project in tests/fixtures/sample."""
from gaps import gaps


def test_gaps_in_the_fixture_project(sample):
    out = gaps(sample[0])
    rows = {(r["table"], r["item"], r["kind"], r["missing"]) for r in out["rows"]}
    # descriptions: a visible column and a measure; the hidden MonthNum column does not count
    assert ("DimCustomer", "Country", "Column", "Description") in rows
    assert ("FactOrders", "Order Count", "Measure", "Description") in rows
    assert not any(r["item"] == "MonthNum" for r in out["rows"])
    # catalogue fields from metadata/tables.yaml
    assert ("DimCustomer", "DimCustomer", "Catalogue", "Grain") in rows
    assert ("FactOrders", "FactOrders", "Catalogue", "Steward") in rows
    assert ("FactOrders", "FactOrders", "Catalogue", "Business process") not in rows      # it has one
    assert not any(r["table"] == "DimDate" and r["missing"] == "Business process" for r in out["rows"])   # only facts need it
    # entries that name something the model does not have
    stale = {(r["item"], r["kind"]) for r in out["rows"] if r["missing"].startswith("Names something")}
    assert stale == {("DimOld", "Catalogue"), ("Amount: FactOrders.Missing", "Glossary")}
    assert out["counts"]["descriptions"] == 2 and out["counts"]["brokenReferences"] == 2
    assert out["counts"]["tables"] == 3 and out["counts"]["incompleteTables"] == 3 and out["counts"]["glossaryTerms"] == 1
    assert out["counts"]["score"]["described"] + out["counts"]["descriptions"] == out["counts"]["score"]["total"]


def test_catalogue_grid_and_custom_fields(sample):
    out = gaps(sample[0], ["owner", "grain"])
    assert [f["id"] for f in out["fields"]] == ["owner", "grain", "business_process"]
    by = {c["table"]: c for c in out["catalogue"]}
    assert by["FactOrders"] == {"table": "FactOrders", "fields": {"owner": True, "grain": True, "business_process": True}, "complete": True}
    assert by["DimCustomer"]["fields"] == {"owner": True, "grain": False} and not by["DimCustomer"]["complete"]
    assert out["counts"]["incompleteTables"] == 1


def test_table_with_no_entry_is_one_gap(sample):
    import copy
    model = copy.deepcopy(sample[0])
    model["metadataTables"].remove("DimDate")
    next(t for t in model["tables"] if t["name"] == "DimDate")["meta"] = {}
    rows = [r for r in gaps(model)["rows"] if r["table"] == "DimDate" and r["kind"] == "Catalogue"]
    assert [r["missing"] for r in rows] == ["No entry in metadata/tables.yaml"]
