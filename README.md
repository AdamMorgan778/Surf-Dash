# Model docs for a Power BI project

**[Open the live site](https://adammorgan778.github.io/Surf-Dash/)**

A Power BI project (PBIP) with a documentation site generated from its semantic model: a data dictionary, a data catalogue, a bus matrix, a glossary, and a report of the modelling rules the model breaks. Clean-up work is raised from the site as GitHub issues, and every pull request is checked against the rules.

The model in this repository, Surf Analytics, is sample content. The tooling around it is a template: swap in your own model and it documents and checks that instead.

## Start a new project from this template

1. Create a repository from this one (**Use this template** on GitHub, or copy the files).
2. Replace `SurfAnalytics.pbip`, `SurfAnalytics.SemanticModel/`, `SurfAnalytics.Report/` and `Data/` with your own PBIP project. The model must be saved in TMDL format.
3. Edit the project files listed below.
4. On GitHub, set **Settings, Pages, Source** to **GitHub Actions**.
5. Push to `main`. The site builds and publishes itself.

Check who can see the site before you publish a real model. A GitHub Pages site is public, even from a private repository, unless your organisation has private Pages (GitHub Enterprise Cloud).

## Which files are yours

| Yours: edit per project | What it holds |
| --- | --- |
| `*.SemanticModel/` | The model. Descriptions are the `///` lines above each table, column and measure. |
| `settings.yml` | Site name, which model folder to read, which catalogue fields every table needs, how long closed issues stay listed. Every key is optional. |
| `rules.json` | Which rules are on, their severity, wording and settings. |
| `metadata/tables.yaml` | Owner, steward, grain, refresh and sensitivity for each table. |
| `metadata/glossary.yaml` | Business terms and the fields they relate to. |

| The template's: replace as a set to upgrade | What it holds |
| --- | --- |
| `tools/` | The Python that reads the model, runs the rules and writes the pages. |
| `docs/assets/`, `docs/index.md`, `docs/guide.md`, `docs/documentation/index.md`, `docs/rules/index.md`, `mkdocs.yml` | The site's scripts, styles and hand-written pages. |
| `tests/` | Tests for the tools. They read `tests/fixtures/sample`, never your model. |
| `.github/` | The workflows and issue forms. |

Everything else under `docs/` is generated and not committed.

## Build it locally

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt     (Linux/macOS: .venv/bin/python)
.venv\Scripts\python tools/build.py --serve
```

`tools/build.py` reads the model, applies `rules.json`, fetches issues from the GitHub remote, writes the pages and builds the site into `site/`. With `--serve` it previews at http://127.0.0.1:8000. Run the tests with `python -m pytest tests`.

To open the sample report in Power BI Desktop, set the `DataFolder` parameter to the full path of the `Data` folder on your machine.

## Editing with Power BI Desktop open

When Claude Code edits the report or model, the `pbi-live-edit` skill (`.claude/skills/pbi-live-edit/`) lets you keep Power BI Desktop open. It checks what Desktop has open, takes screenshots of the affected pages, makes the edit, reloads Desktop, and screenshots again to check the change took, sampling exact colours where it matters. It never reloads while Desktop has unsaved changes; it asks you to save first.

It needs Node.js and the Power BI Desktop bridge CLI (`npm install -g @microsoft/powerbi-desktop-bridge-cli`). `scripts/pbi.ps1` runs the CLI even when Node.js is not on your PATH.

## How it works

```
*.SemanticModel (TMDL) ──► parse_model.py ──► build/model.json ──► run_rules.py ──► build/results.json ─┐
metadata/*.yaml ─────────┘                                                                              ├─► generate_docs.py ──► docs/ ──► MkDocs ──► site/
GitHub issues ───────────► fetch_issues.py ──► build/issues.json ───────────────────────────────────────┘
```

Python works everything out; the scripts in `docs/assets/` only draw it. The site reads five small data files: `summary.json`, `results.json` (the failing checks, plus pass and fail counts per rule and table), `issues.json`, `gaps.json` (what the documentation is missing, from `tools/gaps.py`) and `work.json` (who is changing what, from `tools/work.py`).

The sidebar is built from the folders under `docs/`. The generated bus matrix, catalogue, glossary and dictionary are written to `docs/documentation/`, so they appear as one **Documentation** section whose first page is the what-is-missing dashboard.

| Workflow | Runs when | Does |
| --- | --- | --- |
| `publish.yml` | Push to `main`, an issue changes, daily | Tests, builds and deploys the site. |
| `check.yml` | A pull request | Tests, builds without deploying, and compares rule results with the base branch. |
| `housekeeping-details.yml` | An issue is opened | Adds a description under every housekeeping item and the `housekeeping` label. |
| `branch-activity.yml` | A branch is created, pushed to or deleted; a pull request is opened or closed | Rebuilds the site, so the Work in progress page and the In progress tags stay current. |

## Rules

A rule in `rules.json` looks like this:

```json
{"id": "table-naming", "name": "Tables use Dim/Fact PascalCase names", "check": "table_naming",
 "category": "Naming Conventions", "severity": "warning", "params": {"pattern": "^(Dim|Fact)[A-Z][A-Za-z0-9]*$"},
 "description": "Table names are PascalCase with a Dim or Fact prefix.", "fix": "Rename the table ..."}
```

| To | Do this in `rules.json` |
| --- | --- |
| Switch a rule off | Add `"enabled": false`. |
| Make it block pull requests, or stop blocking | Set `severity` to `error`, or to `warning` or `info`. |
| Change what it accepts | Edit `params`, where the rule has them, and keep `description` and `fix` in step. |
| Reword it | Edit `name`, `description` or `fix`. |

Rules with a `bpaId` are Python ports of rules in Microsoft's [Best Practice Analyzer rule set](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules). They read only what the TMDL files hold, so BPA rules that need a live model are not included.

To add a check:

1. Write a function in `tools/run_rules.py` that takes the model and returns one pass or fail row per object, and add it to `CHECKS`.
2. Add a case to `BREAK` in `tests/test_rules.py` that makes it fail. The tests fail until every check has one.
3. Add an entry to `rules.json`.

Two principles keep the results honest. One problem is one failure: if two rules would flag the same object for the same reason, narrow one of them. And tests check the tools while rules check the project: a test must never depend on your model, or fixing the model would break the build.

## Pull request check

`check.yml` runs `tools/check_pr.py`, which applies the pull request's rules to both versions of the model. Its summary lists the failures the change adds and fixes, and it annotates the changed lines. It fails only when the change **adds** a failure at error severity, so clean-up can be merged a piece at a time.

A failed check does not stop a merge by itself. To enforce it, add a branch rule on `main` that requires the **Model checks / check** status (Settings, Rules, Rulesets).

## Work in progress

`tools/work.py` builds the **Work in progress** page (`docs/work.md`) from three sources: branches not yet merged, housekeeping issues in progress, and open **Working on** issues (claims). For each unmerged branch it compares the PBIP files with the point where the branch left the default branch, and reports the columns, measures, relationships, report pages and visuals that differ. Anything in more than one person's hands is listed as an overlap, on the page and in the pull request check's summary.

- The publish workflow fetches every branch (`fetch-depth: 0`) so the comparison can run.
- Work that has not been pushed is invisible; claims cover that gap. A claim is a line such as `- Table · FactSales` in a Working on issue, read by `tools/fetch_issues.py`.
- `stale_branch_days` in `settings.yml` sets when an untouched branch is marked stale.

## Housekeeping

How people use the housekeeping list and what the Raised, In progress and Done tags mean is on the site's **Using this site** page (`docs/guide.md`). For maintainers:

- The item line (`- [ ] Table · Object — Rule name (rule: id)`) is written and read by `tools/housekeeping.py`, and nowhere else.
- The report sends only those short lines in the "new issue" link. `tools/expand_housekeeping.py` adds the descriptions after the issue is opened, in the issue itself or, for very long lists, in comments.
- Linked branches are read through GitHub's GraphQL API, which needs a token, so a local build without `GITHUB_TOKEN` skips that check.
- The `in-progress` label is optional. Create it the first time someone wants to use it.
