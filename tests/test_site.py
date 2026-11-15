"""The generated pages and the facts the site's scripts read, against the fixture project."""
import build
import generate_docs


def test_dictionary_lists_tables_and_fields(sample):
    page = generate_docs.dictionary_index(sample[0])
    assert "## Tables" in page and "## All fields" in page
    assert "| [DimCustomer](DimCustomer.md) | Dimension | 3 | 0 | 67% |" in page     # table, name and country: one undescribed
    assert 'data-filter="#dict-tables"' in page and 'data-filter="#dict-fields"' in page
    assert "| [FactOrders](FactOrders.md) | `Total Amount` | Measure |" in page


def test_table_page_has_a_way_back_and_a_switcher(sample):
    model, results, _ = sample
    t = next(t for t in model["tables"] if t["name"] == "FactOrders")
    page = generate_docs.table_page(t, model, results, {"issues": []})
    assert '<a href="../">Data dictionary</a>' in page
    assert '<option value="../FactOrders/" selected>FactOrders</option>' in page and '<option value="../DimDate/">DimDate</option>' in page


def test_summary_has_the_best_practice_pass_rate(sample):
    model, results, _ = sample
    out = generate_docs.summary(model, results)
    passed = sum(c["pass"] for c in results["counts"])
    total = passed + sum(c["fail"] for c in results["counts"])
    assert out["bestPractice"] == {"pass": passed, "total": total, "pct": round(100 * passed / total, 1)}
    # rules in the Documentation category are left out of it
    doc = {**results, "rules": [{**r, "category": "Documentation"} if r["id"] == "measure-description" else r for r in results["rules"]]}
    assert generate_docs.best_practice(doc)["total"] == total - sum(c["pass"] + c["fail"] for c in results["counts"] if c["rule"] == "measure-description")


def test_footer_line_names_the_actions_run():
    from datetime import datetime, timezone
    now = datetime(2026, 11, 15, 14, 35, tzinfo=timezone.utc)
    line = build.built_line(now, {"GITHUB_RUN_ID": "99", "GITHUB_RUN_NUMBER": "57", "GITHUB_REPOSITORY": "o/r"})
    assert '<time class="site-built" datetime="2026-11-15T14:35:00Z">2026-11-15 14:35 UTC</time>' in line
    assert '<a href="https://github.com/o/r/actions/runs/99">GitHub Actions run 57</a>' in line
    assert build.built_line(now, {}).startswith("Built locally <time")
