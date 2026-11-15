"""One command for the whole pipeline: parse, rules, issues, docs, then MkDocs.

    python tools/build.py            build the site into site/
    python tools/build.py --serve    build, then preview at http://127.0.0.1:8000
"""
import os
import subprocess
import sys
from datetime import datetime, timezone

import fetch_issues
import generate_docs
import parse_model
import run_rules
from tmdl import ROOT, repo_slug


def built_line(now=None, env=None):
    """The footer line: when the site was built and, on GitHub, by which Actions run. ui.js shows the time locally."""
    env = os.environ if env is None else env
    now = now or datetime.now(timezone.utc)
    stamp = f'<time class="site-built" datetime="{now.strftime("%Y-%m-%dT%H:%M:%SZ")}">{now.strftime("%Y-%m-%d %H:%M UTC")}</time>'
    run, repo = env.get("GITHUB_RUN_ID"), env.get("GITHUB_REPOSITORY")
    if run and repo:
        link = f'{env.get("GITHUB_SERVER_URL", "https://github.com")}/{repo}/actions/runs/{run}'
        return f'Site updated {stamp} by <a href="{link}">GitHub Actions run {env.get("GITHUB_RUN_NUMBER", run)}</a>'
    return f"Built locally {stamp}"


def main():
    model = parse_model.main()
    run_rules.main()
    fetch_issues.main()
    generate_docs.main()
    env = dict(os.environ, SITE_NAME=model["siteName"], SITE_BUILT=built_line())
    slug = repo_slug()
    if slug:
        env["REPO_URL"] = f"https://github.com/{slug}"
    cmd = ["serve"] if "--serve" in sys.argv else ["build", "--strict"]
    sys.exit(subprocess.run([sys.executable, "-m", "mkdocs", *cmd], cwd=ROOT, env=env).returncode)


if __name__ == "__main__":
    main()
