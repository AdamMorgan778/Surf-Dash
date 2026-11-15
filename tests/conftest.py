"""Tests check the tools, never this project's own model, metadata or rule wording.

Anything that needs a model reads the small one in tests/fixtures/sample, so fixing the real model can't break a test.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
os.environ["GITHUB_REPOSITORY"] = "o/r"   # fixed, so links in test output do not depend on the git remote
os.environ["DOCS_BRANCH"] = "main"

SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "sample")


@pytest.fixture(scope="session")
def sample_root():
    return SAMPLE


@pytest.fixture(scope="session")
def sample():
    """(model, results, rules by id) for the fixture project."""
    import run_rules
    from parse_model import parse_model
    rules = run_rules.load_rules(SAMPLE)
    model = parse_model(SAMPLE)
    return model, run_rules.run(model, rules), {r["id"]: r for r in rules if r.get("enabled", True)}
