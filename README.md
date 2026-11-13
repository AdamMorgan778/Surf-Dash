# Surf Analytics

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

Pages must be set to deploy from GitHub Actions in the repository settings (Settings, Pages, Source).
