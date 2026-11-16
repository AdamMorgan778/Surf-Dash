# Using this site

This site is generated from the Power BI semantic model in the repository. It is rebuilt every time the model changes on the main branch, and when an issue changes on GitHub, so it always describes the current model.

## What each page is for

| Page | Use it to |
| --- | --- |
| [Overview](index.md) | See how the project is going: requirements complete, upcoming deadlines, what is in progress and what was finished recently. |
| [Planning](planning.md) | See every requirement, who has it and when it is due; add one, break one down, and follow progress on a dashboard and a calendar. |
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

The report has three tabs that share one set of filters:

- **Summary** shows the headline numbers and charts: the most-failed rules, failures by table, housekeeping status and pass rate by category.
- **By rule** lists every rule the model breaks, most serious first, with what it checks, how to fix it and the objects failing it.
- **All failures** lists every failing check in one table that you can sort, search and download.

Click a tile or a bar to filter every tab; click it again to clear. **Show data** on a chart opens the rows behind it. The filters are part of the page address, so you can bookmark or share a view.

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

## Planning

A requirement is something the model or report needs to do, with a person and a completion date. Each one is an issue on GitHub; the [Planning](planning.md) page shows them and its buttons open the right place on GitHub.

| To | Do this |
| --- | --- |
| Add a requirement | Press **Add requirement**, fill in the short form (the due date has a date picker) and press **Continue on GitHub**, then **Submit** there. |
| Assign it | Type a GitHub username under **Assign to** when adding it, or set the assignee on the issue later. |
| Take it out | Open the requirement on GitHub and choose **Development, Create a branch**. Within a minute or two the site shows who took it out, when, and on which branch. You are assigned automatically if nobody was. |
| Complete it | Merge the branch's pull request. The requirement is closed as completed and shows as **Complete**. |
| Say it wasn't satisfied | Open the completed requirement on GitHub and press **Reopen issue**. It shows as **Reopened** and no longer counts as complete. |
| Break it down | Expand the requirement and press **Add sub-requirement**. Each part has its own person, date and branch. The parent completes when its last part does, and reopens if a part is reopened. |
| Drop it | Close the issue as **not planned**. It is left out of the percentage. |

The page has three tabs:

- **Dashboard** shows the percentage complete, what is overdue or due in the next 14 days, completion by person, and what is still to do by month.
- **Requirements** lists them with who has each, the due date, the status and how many parts are done. Expand one for its acceptance criteria and sub-requirements.
- **Calendar** shows the due dates month by month; click one to open the requirement.

Percentage complete counts the smallest pieces of work: a requirement that has been broken down is counted through its sub-requirements. Write due dates as `2026-12-01`; a date the site can't read is flagged rather than ignored.

## Pull requests

Every pull request is checked against the rules. The check's summary lists the failures your change adds and the ones it fixes, and warns you when your change touches something another person also has in hand. A pull request that adds a failure at error severity is marked as failed; failures that were already there do not count against you.
