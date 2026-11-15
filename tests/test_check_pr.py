"""The pull request check: new and fixed failures between two versions of the fixture project."""
import copy
import shutil

import pytest

import check_pr
import run_rules
from parse_model import parse_model


@pytest.fixture()
def changed(sample_root, tmp_path):
    """A copy of the fixture project where one measure lost its description and the bidirectional relationship was fixed."""
    root = tmp_path / "head"
    shutil.copytree(sample_root, root)
    orders = root / "Sample.SemanticModel" / "definition" / "tables" / "FactOrders.tmdl"
    orders.write_text(orders.read_text(encoding="utf-8").replace("\t/// Sum of order amounts.\n", ""), encoding="utf-8")
    rels = root / "Sample.SemanticModel" / "definition" / "relationships.tmdl"
    rels.write_text(rels.read_text(encoding="utf-8").replace("\tcrossFilteringBehavior: bothDirections\n", ""), encoding="utf-8")
    return str(root)


def test_new_and_fixed_failures(sample, changed):
    _, base, _ = sample
    rules = list(base["rules"])
    head = run_rules.run(parse_model(changed), rules)
    diff = check_pr.compare(base, head)
    assert [(r["object"], r["rule"], r["severity"]) for r in diff["new"]] == [("Total Amount", "measure-description", "error")]
    assert [r["rule"] for r in diff["fixed"]] == ["no-bidirectional"]
    text = check_pr.summary(diff, head)
    assert "**Blocked:** this change adds 1 failure(s) at error severity" in text
    assert "| Error | Measures have descriptions | [FactOrders[Total Amount]](" in text
    assert "### Fixed" in text and "Check bi-directional relationships" in text
    notes = check_pr.annotations(diff["new"], head, "o/r", "main")
    assert notes[0].startswith("::error file=Sample.SemanticModel/definition/tables/FactOrders.tmdl,line=4,title=Measures have descriptions::")


def test_no_change_and_existing_errors_do_not_block(sample):
    _, base, _ = sample
    diff = check_pr.compare(base, copy.deepcopy(base))
    assert diff == {"new": [], "fixed": []}
    assert base["failures"]["error"] == 1   # an error that is already on the base branch
    assert "adds no rule failures" in check_pr.summary(diff, base)


def test_exit_code(sample_root, changed, monkeypatch, capsys):
    monkeypatch.setattr(check_pr, "ROOT", changed)
    with pytest.raises(SystemExit) as e:
        check_pr.main(["--base", sample_root])
    assert e.value.code == 1
    monkeypatch.setattr(check_pr, "ROOT", sample_root)
    with pytest.raises(SystemExit) as e:
        check_pr.main(["--base", changed])       # the other way round only fixes an error
    assert e.value.code == 0
    assert "## Model rules" in capsys.readouterr().out
