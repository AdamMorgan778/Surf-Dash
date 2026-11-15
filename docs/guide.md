# Using this site

This site is generated from the Power BI semantic model in the repository. It is rebuilt every time the model changes on the main branch, and when an issue changes on GitHub, so it always describes the current model.

## What each page is for

| Page | Use it to |
| --- | --- |
| [Overview](index.md) | See the headline numbers and which issues are open. |
| [Work in progress](work.md) | See which tables, columns, measures and report pages someone is already changing, before you start on them. |
| [Documentation](documentation/index.md) | See what the documentation is missing: descriptions, catalogue fields and broken glossary references. |
| [Data dictionary](documentation/dictionary/index.md) | Look up a column or measure: its type, format, description and DAX. Each table has its own page, which also shows what every measure depends on. |
| [Data catalogue](documentation/catalogue.md) | See what each table holds, its grain, who owns it and how often it refreshes. |
| [Bus matrix](documentation/bus-matrix.md) | See which dimensions describe which business process. |
| [Glossary](documentation/glossary.md) | Check what a business term means and where it appears in the model. |
| [Best practice](rules/index.md) | See which modelling conventions and best-practice rules the model breaks, filter them, and raise clean-up work. |
| [Rule library](rules/reference.md) | Read what each rule checks and how to fix a failure. |
| [Play](play/index.md) | Race a jetski over sine-wave waves. Your score is multiplied by the documentation coverage. |

A field marked *Missing* has no description in the model yet. The footer of every page says when the site was last updated, and links to the GitHub Actions run that built it.

## The Best practice report

The report has four tabs that share one set of filters:

- **Summary** shows the headline numbers and charts: the most-failed rules, failures by table, housekeeping status and pass rate by category.
- **By table** shows a matrix of failures by table and category, and the failing objects for whatever is selected.
- **By rule** lists every rule the model breaks, most serious first, with what it checks, how to fix it and the objects failing it.
- **All failures** lists every failing check in one table that you can sort, search and download.

Click a tile, a bar or a matrix cell to filter every tab; click it again to clear. **Show data** on a chart opens the rows behind it. The filters are part of the page address, so you can bookmark or share a view.

Rules have three severities. **Error** means something is wrong and should be fixed before the change is merged. **Warning** means bad practice. **Info** is a suggestion.

## Raise clean-up work

1. On the Best practice report, click **+** next to a failing object, or **Add all** on a rule. A **Housekeeping list** button appears at the bottom right.
2. Open the list, check the title, add a note if it helps, and press **Create issue on GitHub**.
3. GitHub opens with the issue filled in. Press **Submit**. Within about a minute a description is added under every item: the rule, what is breaking it and how to fix it.
4. To start the work, open **Development** on the issue and choose **Create a branch**.
5. Tick each item on the issue as you finish it.

The list is kept in your browser until you raise it. One issue can hold any number of items.

## What the tags mean

Once an item is in an open housekeeping issue, the report shows a tag beside it in place of the **+** button, so two people don't pick up the same fix.

| Tag | Meaning |
| --- | --- |
| **Raised** | In an issue, and nobody has picked it up yet. |
| **In progress** | Someone is on it: the issue has an assignee, a branch made with **Create a branch**, or the `in-progress` label. |
| **Done** | Ticked on the issue. It leaves the report once the fix reaches the main branch and the rule passes. |

To show you are working on something, assign yourself to the issue or create a branch from it.

## Work in progress

Two people editing the same part of a Power BI project at once usually ends in a merge conflict. Before you start, open [Work in progress](work.md) and check that what you plan to change is **Free**.

The page shows three things:

- **Unmerged branches.** Everything a branch changes compared with the main branch: columns, measures, relationships, report pages and visuals. It appears about a minute after the branch is pushed.
- **Housekeeping fixes in progress.** Items in a housekeeping issue that someone has picked up.
- **Claims.** Tables or report pages someone has said they are about to change.

Work that is only on your own computer can't be seen. So when you start something:

1. Tick the tables and report pages you are about to change and press **Claim selected**.
2. GitHub opens a **Working on** issue with them filled in. Press **Submit**.
3. Push your branch early, even unfinished, so the exact objects show.
4. Close the issue when your work is merged. That releases the claim.

**Overlaps** at the top of the page lists anything in more than one person's hands. A few shared files (the report's settings, page order and theme, and the model's settings) are changed by many kinds of edit, so two branches touching one of them is flagged even when the edits look unrelated.

## Ask for a change

For anything that is not clean-up (a new measure, a definition change, a data problem, a question), open a **Model request** issue on GitHub. Name the table so the request shows against it on the Overview page.

## Pull requests

Every pull request is checked against the rules. The check's summary lists the failures your change adds and the ones it fixes, and warns you when your change touches something another person also has in hand. A pull request that adds a failure at error severity is marked as failed; failures that were already there do not count against you.
