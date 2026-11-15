# Using this site

This site is generated from the Power BI semantic model in the repository. It is rebuilt every time the model changes on the main branch, and when an issue changes on GitHub, so it always describes the current model.

## What each page is for

| Page | Use it to |
| --- | --- |
| [Overview](index.md) | See how well the model is documented, how many rules it breaks and which issues are open. |
| [Data dictionary](dictionary/index.md) | Look up a column or measure: its type, format, description and DAX. Each table has its own page, which also shows what every measure depends on. |
| [Data catalogue](catalogue.md) | See what each table holds, its grain, who owns it and how often it refreshes. |
| [Bus matrix](bus-matrix.md) | See which dimensions describe which business process. |
| [Glossary](glossary.md) | Check what a business term means and where it appears in the model. |
| [Rules report](rules/index.md) | See which rules the model breaks, filter them, and raise clean-up work. |
| [Rule reference](rules/reference.md) | Read what each rule checks and how to fix a failure. |

A field marked *Missing* has no description in the model yet.

## The Rules report

The report has three tabs that share one set of filters:

- **Overview** shows the headline numbers, a matrix of failures by table and category, and the failing objects for whatever is selected.
- **Rules** lists every rule with its failing and passing counts. Open a rule to see how to fix it and which objects fail it.
- **Results** lists every failing check in one table that you can sort, search and download.

Click a tile, a bar or a matrix cell to filter every tab; click it again to clear. **Show data** on a chart opens the rows behind it. The filters are part of the page address, so you can bookmark or share a view.

Rules have three severities. **Error** means something is wrong and should be fixed before the change is merged. **Warning** means bad practice. **Info** is a suggestion.

## Raise clean-up work

1. On the Rules report, click **+** next to a failing object, or **Add all** on a rule. A **Housekeeping list** button appears at the bottom right.
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

## Ask for a change

For anything that is not clean-up (a new measure, a definition change, a data problem, a question), open a **Model request** issue on GitHub. Name the table so the request shows against it on the Overview page.

## Pull requests

Every pull request is checked against the rules. The check's summary lists the failures your change adds and the ones it fixes. A pull request that adds a failure at error severity is marked as failed; failures that were already there do not count against you.
