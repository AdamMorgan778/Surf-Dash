"""Compare the rule results of this checkout with those of a base checkout, for pull requests.

    python tools/check_pr.py --base <folder holding the base branch>

Both versions of the model are checked with this checkout's rules.json, so a change to the rules is judged the
same way on both sides. The script prints a Markdown summary (to the GitHub job summary when there is one), adds
annotations on the changed lines, and exits 1 when the change adds a failure at error severity. Failures that the
base branch already has never block, so clean-up work can be merged a piece at a time.
"""
import argparse
import os
import sys

from housekeeping import table_label
from parse_model import parse_model
from run_rules import load_rules, run
from tmdl import ROOT, repo_slug

ORDER = {"error": 0, "warning": 1, "info": 2}
MAX_ANNOTATIONS = 30   # GitHub shows only the first few dozen per job


def key(row):
    return (row["table"], row["object"], row["rule"])


def compare(base_results, head_results):
    """{"new": failing here but not on the base, "fixed": failing on the base but not here}, worst first."""
    base = {key(r): r for r in base_results["results"]}
    head = {key(r): r for r in head_results["results"]}
    order = lambda r: (ORDER[r["severity"]], r["rule"], r["table"], r["object"])
    return {"new": sorted((r for k, r in head.items() if k not in base), key=order),
            "fixed": sorted((r for k, r in base.items() if k not in head), key=order)}


def _where(row):
    name = row["object"] if row["type"] in ("table", "relationship") or row["table"] == "(model)" else f"{row['table']}[{row['object']}]"
    return f"[{name}]({row['link']})" if row.get("link") else f"`{name}`"


def summary(diff, head_results):
    rules = {r["id"]: r for r in head_results["rules"]}
    new, fixed, f = diff["new"], diff["fixed"], head_results["failures"]
    blocking = [r for r in new if r["severity"] == "error"]
    out = ["## Model rules", ""]
    if blocking:
        out.append(f"**Blocked:** this change adds {len(blocking)} failure(s) at error severity. Fix them, or change the rule's severity in `rules.json`.")
    elif new:
        out.append(f"This change adds {len(new)} failure(s), none at error severity, so it is not blocked.")
    else:
        out.append("This change adds no rule failures.")
    out += ["", f"| | Count |", "| --- | ---: |", f"| New failures | {len(new)} |", f"| Fixed failures | {len(fixed)} |",
            f"| Failing after this change | {f['error']} error, {f['warning']} warning, {f['info']} info |", ""]
    if new:
        out += ["### New failures", "", "| Severity | Rule | Object | How to fix |", "| --- | --- | --- | --- |"]
        out += [f"| {r['severity'].capitalize()} | {rules[r['rule']].get('name', r['rule'])} | {_where(r)} | {rules[r['rule']].get('fix', '')} |"
                for r in new]
        out.append("")
    if fixed:
        out += ["### Fixed", ""] + [f"- {_where(r)}: {rules.get(r['rule'], {}).get('name', r['rule'])}" for r in fixed] + [""]
    return "\n".join(out)


def annotations(new, head_results, slug, branch):
    """GitHub workflow commands that pin each new failure to its line in the changed files."""
    rules = {r["id"]: r for r in head_results["rules"]}
    level = {"error": "error", "warning": "warning", "info": "notice"}
    prefix = f"https://github.com/{slug}/blob/{branch}/"
    out = []
    for r in new[:MAX_ANNOTATIONS]:
        rule, link = rules[r["rule"]], r.get("link") or ""
        where = ""
        if slug and link.startswith(prefix):
            path, _, line = link[len(prefix):].partition("#L")
            where = f" file={path}" + (f",line={line}" if line else "")
        text = f"{table_label(r['table'])} · {r['object']}: {rule.get('description', '')} {rule.get('fix', '')}".replace("\n", " ")
        out.append(f"::{level[r['severity']]}{where},title={rule.get('name', r['rule'])}::{text}" if where
                   else f"::{level[r['severity']]} title={rule.get('name', r['rule'])}::{text}")
    return out


def results_for(root, rules):
    try:
        return run(parse_model(root), rules)
    except SystemExit:   # no model on the base branch yet: everything in this change is new
        return {"results": [], "rules": rules, "failures": {"error": 0, "warning": 0, "info": 0}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", required=True, help="folder holding a checkout of the base branch")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    rules = load_rules(ROOT)
    head = run(parse_model(ROOT), rules)
    diff = compare(results_for(args.base, rules), head)
    text = summary(diff, head)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text + "\n")
    if os.environ.get("GITHUB_ACTIONS"):
        print("\n".join(annotations(diff["new"], head, repo_slug(), os.environ.get("DOCS_BRANCH", "main"))))
    sys.exit(1 if any(r["severity"] == "error" for r in diff["new"]) else 0)


if __name__ == "__main__":
    main()
