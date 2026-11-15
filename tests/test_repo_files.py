"""The GitHub configuration that ships with the template. GitHub ignores a broken file without saying so:
an issue form that is not valid YAML silently becomes a blank issue."""
import glob
import os

import pytest
import yaml

from tmdl import ROOT

FILES = sorted(glob.glob(os.path.join(ROOT, ".github", "**", "*.yml"), recursive=True))


@pytest.mark.parametrize("path", FILES, ids=[os.path.relpath(p, ROOT).replace("\\", "/") for p in FILES])
def test_github_file_is_valid_yaml(path):
    with open(path, encoding="utf-8") as f:
        assert isinstance(yaml.safe_load(f), dict)


def test_housekeeping_form_has_the_fields_the_report_fills_in():
    with open(os.path.join(ROOT, ".github", "ISSUE_TEMPLATE", "housekeeping.yml"), encoding="utf-8") as f:
        form = yaml.safe_load(f)
    ids = {b.get("id") for b in form["body"]}
    assert {"items", "notes"} <= ids     # the report's link pre-fills these by id
    assert "housekeeping" in form["labels"]
