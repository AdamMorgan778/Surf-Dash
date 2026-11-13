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

`rules.json` lists 45 rules. 37 of them match a rule in Microsoft's [Best Practice Analyzer rule set](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) and carry its ID in `bpaId`: 33 are Python ports of BPA rules, and 4 of the project's original rules were already equivalent. The other 8 are the project's own documentation and naming rules. The built site has a **Rules report** (`docs/rules/index.md`, drawn by `docs/assets/rules.js` and styled by `docs/assets/report.css`): a Power BI-style report with Overview, Matrix, Rules and Tables pages that share one set of filters. Clicking a bar, card or matrix cell cross-filters every page, each visual has a **Show data** button that opens its rows as a scrollable table with a CSV download, and the Tables page holds the full breakdown. A generated **rule reference** lists every rule with its current pass and fail counts.

Each rule names a `check`, which is a function in `tools/run_rules.py` that takes the parsed model and returns one pass or fail row per object. To add a rule:

1. Write the function and add it to `CHECKS`.
2. Add an entry to `rules.json` with an `id`, `check`, `category`, `severity` (error, warning or info), `description`, a one-sentence `fix` and, if it comes from BPA, `bpaId`.
3. Add a breaking case for it to `BREAK` in `tests/test_rules.py`. The tests fail until every check has one.

To silence a rule, lower its severity or remove its entry from `rules.json`.

## Housekeeping list

On the Rules report, click **+** next to any failing object (or **Add all** on a rule) to collect clean-up work. The list is kept in your browser until you raise it. **Create issue on GitHub** opens a pre-filled issue from the **Housekeeping** form (`.github/ISSUE_TEMPLATE/housekeeping.yml`); press **Submit**, then use **Development → Create a branch** on the issue to start the work.

Each item is a checklist line ending in `(rule: <id>)`. `tools/fetch_issues.py` reads those lines back, so items in an open housekeeping issue show an **#n** badge in the report, and the Overview's issue list shows progress from the ticked boxes.

One-time setup: create a label called `housekeeping` in the repository (Issues, Labels). GitHub only applies a form's label if it already exists.

Pages must be set to deploy from GitHub Actions in the repository settings (Settings, Pages, Source).
