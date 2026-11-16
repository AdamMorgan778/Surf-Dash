# Using this site

This site is generated from the Power BI semantic model in the repository. It is rebuilt every time the model changes on the main branch, and when an issue changes on GitHub, so it always describes the current model.

## What each page is for

| Page | Use it to |
| --- | --- |
| [Overview](index.md) | See how the project is going at a glance: requirements complete, documentation and best practice scores, the next deadlines and what was finished recently. |
| [Planning](planning.md) | See every requirement, who has it and when it is due; add one, break one down, and follow progress on a dashboard and a calendar. |
| [Work in progress](work.md) | See which tables, columns, measures and report pages someone is already changing, before you start on them. |
| [Documentation](documentation/index.md) | See what the documentation is missing: descriptions, catalogue fields and broken glossary references. |
| [Data dictionary](documentation/dictionary/index.md) | Look up a column or measure: its type, format, description and DAX. Each table has its own page, which also shows what every measure depends on. |
| [Data catalogue](documentation/catalogue.md) | See what each table holds, its grain, who owns it and how often it refreshes. |
| [Bus matrix](documentation/bus-matrix.md) | See which dimensions describe which business process. |
| [Glossary](documentation/glossary.md) | Check what a business term means and where it appears in the model. |
| [Best practice](rules/index.md) | See which modelling conventions and best-practice rules the model breaks, filter them, and raise clean-up work. |
| [Rule library](rules/reference.md) | Read what each rule checks and how to fix a failure. |
| [Surf forecast](surf/index.md) | See live surf conditions around Pembrokeshire on a map, scored for four ability levels, up to a week ahead. |
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

## Surf forecast

The [Surf forecast](surf/index.md) page shows the surf around Pembrokeshire. It is sample content for the surf model, like [Play](play/index.md), and reads nothing from the model except its four skill levels.

The forecast is fetched from [Open-Meteo](https://open-meteo.com/) when you open the page, so it is always current. It covers the last three days and the next week, hour by hour.

| To | Do this |
| --- | --- |
| Score the surf for your ability | Pick Beginner, Intermediate, Advanced or Pro in the banner. |
| See one spot in detail | Click its marker on the map, or its name in the lists. |
| Look ahead, or back | Pick a day, drag the slider, or press Play to step through the hours. Now returns to the present. |
| Find the best day this week | Use Week ahead: each number is that day's best score in daylight. Click one to jump to it. |
| Be told when and where to go | Use Find a session: pick what matters to you and click one of the three suggestions. |
| See the weather on the map | Switch on Wind, Swell, Rain or Temperature above the map, in any combination. |
| Zoom the map | Use the + and − buttons, double-click, or hold Ctrl and scroll. Drag to move around when zoomed in. |

### How the surf score works

Each spot gets a score from 0 to 10 for each level and hour:

1. **Surf height at the beach** is estimated from the swell 3 km out to sea. It is smaller when the swell is not heading towards the beach, and bigger for long-period swell.
2. **Size for the level.** Each level has an ideal range: about 1.5 to 2.5 ft for Beginner, 2 to 4 ft for Intermediate, 3 to 7 ft for Advanced and 5 to 12 ft for Pro. The score falls away outside the range. Well above it the score is 0 and the spot is marked Too big.
3. **Swell period.** Longer-period swell scores higher. It matters least for beginners.
4. **Wind.** Light wind, or wind blowing off the land (offshore), scores well. Strong wind off the sea (onshore) scores badly. Beginners are marked down more for strong wind.

| Band | Score |
| --- | --- |
| Flat | No surf, or too small or too big for the level |
| Poor | Under 3 |
| Fair | 3 to 5 |
| Good | 5 to 7.5 |
| Epic | 7.5 and over |

### Find a session

Find a session suggests the three best sessions in the week ahead for your level. A session is a beach, a day and a run of daylight hours.

Pick any of the priorities to say what matters to you. Each one marks a session down when it is not met. None of them rules a session out, so you always get suggestions, and each suggestion shows a tick or a cross against every priority you picked.

| Priority | Prefers |
| --- | --- |
| Light wind | Under about 8 mph; fades out towards 25 mph |
| Clean waves | Wind blowing off the land, or hardly any |
| Dry | No rain |
| Warmer | The milder hours of the week |
| Smaller waves | The gentle end of your level's size range |
| Bigger waves | The punchy end of your level's size range |

Sooner sessions rank higher, because a forecast for tomorrow is more likely to hold than one for next week:

| How far ahead | Certainty | Effect |
| --- | --- | --- |
| Up to 2 days | High | None |
| 3 to 4 days | Medium | Marked down by 15% |
| 5 to 7 days | Low | Marked down by 30% |

This is a rule of thumb, not a probability. No more than two suggestions come from the same day, unless you choose one day with When. The map, the Best spots list and the Week ahead grid always show the plain score for your level; priorities only change the suggestions.

### Map layers

| Layer | What you see |
| --- | --- |
| Wind | Streaks flowing the way the wind blows, faster and brighter where it is stronger |
| Swell | Wave crests rolling the way the swell travels, over the sea, longer where it is bigger |
| Rain | Slanted dashes where it is raining, denser where it is heavier |
| Temperature | A colour wash over the land, from pale (cold) to orange (mild), for the air temperature |

Point at the map to read the values there. The layers follow the time bar, so Play shows the weather crossing the county. They are drawn from forecast points about 10 km apart, so they show the pattern across the county and not the wind on one beach; the numbers for each beach come from that beach's own forecast. If your device is set to reduce motion, wind and swell show as still arrows.

Tide, sea temperature and gusts are shown but not scored. The scores are a guide worked out from forecast models, not a safety service: check the sea when you get there and follow the lifeguards' advice.

The spots, and the direction each beach faces, are in `docs/assets/surf-spots.json`; edit that file to correct, add or remove one. A project that does not want the page can delete its sidebar entry in `mkdocs.yml`.

## Pull requests

Every pull request is checked against the rules. The check's summary lists the failures your change adds and the ones it fixes, and warns you when your change touches something another person also has in hand. A pull request that adds a failure at error severity is marked as failed; failures that were already there do not count against you.
