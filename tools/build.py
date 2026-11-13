"""One command for the whole pipeline: parse, rules, issues, docs, then MkDocs.

    python tools/build.py            build the site into site/
    python tools/build.py --serve    build, then preview at http://127.0.0.1:8000
"""
import os
import subprocess
import sys

import fetch_issues
import generate_docs
import parse_model
import run_rules
from tmdl import ROOT, repo_slug


def main():
    parse_model.main()
    run_rules.main()
    fetch_issues.main()
    generate_docs.main()
    env = dict(os.environ)
    slug = repo_slug()
    if slug:
        env["REPO_URL"] = f"https://github.com/{slug}"
    cmd = ["serve"] if "--serve" in sys.argv else ["build", "--strict"]
    sys.exit(subprocess.run([sys.executable, "-m", "mkdocs", *cmd], cwd=ROOT, env=env).returncode)


if __name__ == "__main__":
    main()
