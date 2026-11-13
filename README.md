# Surf Analytics

**[Open the live dashboard](https://adammorgan778.github.io/Surf-Dash/)**

A Power BI project (`SurfAnalytics.pbip`) about surfing, with a documentation site generated from its semantic model: a data dictionary, a data catalogue, a bus matrix and an overview dashboard with rule results and GitHub issues.

## Build the docs

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt     (Linux/macOS: .venv/bin/python)
.venv\Scripts\python tools/build.py --serve
```

`tools/build.py` reads the TMDL, applies `rules.json`, fetches issues from the GitHub remote, writes the pages under `docs/` and builds the site into `site/`. With `--serve` it previews at http://127.0.0.1:8000. Run the tests with `python -m pytest tests`.

## Where things live

| Path | What it is |
| --- | --- |
| `SurfAnalytics.SemanticModel/` | The model. Descriptions are the `///` lines above each table, column and measure. |
| `metadata/tables.yaml` | Owner, steward, grain, refresh and sensitivity per table. |
| `metadata/glossary.yaml` | Glossary terms. |
| `rules.json` | The rules and their severities. The checks are in `tools/run_rules.py`. |
| `.github/ISSUE_TEMPLATE/data-request.yml` | Issue form. Its Table dropdown is how an issue is matched to a table; update the list when tables change. |
| `.github/workflows/publish.yml` | Builds and deploys the site to GitHub Pages on push to `main`, on issue changes and daily. |

## Rules

`rules.json` lists 45 rules. 37 of them match a rule in Microsoft's [Best Practice Analyzer rule set](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) and carry its ID in `bpaId`: 33 are Python ports of BPA rules, and 4 of the project's original rules were already equivalent. The other 8 are the project's own documentation and naming rules. The built site has a Rules section with three pages: a dashboard with charts and filters (`docs/rules/index.md`, drawn by `docs/assets/rules.js`), a breakdown with sortable tables and a CSV download, and a generated reference listing every rule with its current pass and fail counts.

Each rule names a `check`, which is a function in `tools/run_rules.py` that takes the parsed model and returns one pass or fail row per object. To add a rule:

1. Write the function and add it to `CHECKS`.
2. Add an entry to `rules.json` with an `id`, `check`, `category`, `severity` (error, warning or info), `description` and, if it comes from BPA, `bpaId`.
3. Add a breaking case for it to `BREAK` in `tests/test_rules.py`. The tests fail until every check has one.

To silence a rule, lower its severity or remove its entry from `rules.json`.

Pages must be set to deploy from GitHub Actions in the repository settings (Settings, Pages, Source).
