---
name: pbi-live-edit
description: Edit a Power BI project (PBIP) while Power BI Desktop has it open, then reload Desktop and check the result with before and after screenshots taken through the Desktop bridge. Use whenever you change anything under a *.Report or *.SemanticModel folder (pages, visuals, themes, measures, columns, relationships), and whenever the user asks to reload, screenshot, preview or check the report in Power BI Desktop.
---

# Editing a PBIP with Power BI Desktop open

The user keeps Power BI Desktop open while you edit the project's files. The bridge CLI (`powerbi-desktop`) tells you what Desktop has open, reloads it from disk, and takes screenshots of report pages. Use it so every change is reloaded and checked by eye, without the user closing Desktop.

Run the CLI through the wrapper, which finds Node.js even when it is not on the PATH:

```
powershell -NoProfile -File .claude/skills/pbi-live-edit/scripts/pbi.ps1 <command> [options]
```

| Command | Use |
| --- | --- |
| `status` | Desktop instances, the file each has open, `hasUnsavedChanges`, and the report's page ids |
| `screenshot <page-id> --output <png> --scale 1` | One page |
| `screenshot-all --output-dir <dir> --scale 1 --settle 2000` | Every page |
| `reload` | Reload the open PBIP from disk |
| `open <file.pbip>` | Open a project in Desktop (only when the user asks) |

Add `--pid <pid>` to every command when more than one Desktop is open. Page ids are the folder names under `pages/` (also listed by `status`), not the display names.

## The one rule

**`reload` replaces what Desktop has with what is on disk. Never reload while Desktop has unsaved changes**: it would throw away the user's work. Check `hasUnsavedChanges` every time, immediately before the edit.

## Steps

1. **Status.** Run `status`.
   - Desktop is not running, or has a different file open: edit the files as usual, and tell the user the change was not reloaded or checked visually. Offer to `open` the project.
   - More than one instance: use the one whose `currentFilePath` is this project's `.pbip`, and pass its `--pid` from now on.

2. **Unsaved changes.** If `hasUnsavedChanges` is true:
   - Stop. Tell the user Desktop has unsaved changes, that reloading would discard them, and ask them to save in Desktop (Ctrl+S). Don't edit anything yet.
   - If they say to discard the changes instead, that is their call; go on.
   - Otherwise wait for the save in the background: `wait-saved.ps1` (add `-ProcessId <pid>` if needed). It prints `SAVED`, or `TIMED OUT` after 15 minutes. Don't poll by hand.
   - After the save, run `git status`. Desktop often rewrites files when it saves (newer schema versions in `report.json` and `pages.json`, TMDL formatting). Those are the user's changes: leave them as they are, and don't fold them into your edit or revert them.
   - One exception. Desktop keeps showing what it last loaded, so after a branch switch or a pull it still holds the old content, and a save writes that old content over the newer files. Read the diff after a save: if it undoes work that is already committed (an old colour back, a page missing from `pages.json`, older schema versions), restore those files from git, and tell the user what the save overwrote and that you put it back.

3. **Before screenshots.** Capture the pages the change affects, at `--scale 1`, into the session's scratchpad (a folder such as `pbi_before`), never into the repository. Use `screenshot-all` for report-wide changes (theme, shared measures, page order).

4. **Edit.** Change the smallest set of files that does the job:
   - page canvas, wallpaper and size: `<Report>/definition/pages/<page>/page.json` (`objects.background`, `objects.outspace`);
   - one visual: `pages/<page>/visuals/<visual>/visual.json`;
   - styling across the report: the custom theme under `StaticResources/RegisteredResources/`;
   - measures, columns, tables: the TMDL files under `<Model>/definition/tables/`; relationships: `relationships.tmdl`.

   Edit the files that are there; never regenerate them. Every JSON file you touch must still parse. Check it with `python -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" <file>` or PowerShell's `ConvertFrom-Json`. Keep a file's existing line endings and indentation (TMDL uses tabs).

5. **Reload.** Run `reload`. If it returns an error, show it to the user and stop; don't retry in a loop. A bad edit usually shows up here, so check the file you changed.

6. **After screenshots.** Capture the same pages with `--settle 2000` into a second scratchpad folder (such as `pbi_after`).

7. **Verify.** Open the before and after images with the Read tool and compare them against what was asked.
   - **Colours:** don't trust your eye. Sample the same points in both images:
     `powershell -NoProfile -File .claude/skills/pbi-live-edit/scripts/sample-colors.ps1 -Image <png> -Points "0.30,0.03 0.48,0.29"`
     Points are fractions of the width and height; pick spots on the changed area away from text and borders. The after value should match the requested hex exactly.
   - **Layout or visuals:** check the change is where it should be and that nothing nearby moved, overlapped or lost its data.
   - **Model changes** (a measure, a column) only show if a visual uses them. If none does, say that the screenshot can't confirm it. If a visual shows stale or blank data, Desktop may need **Refresh**; tell the user rather than refreshing for them.
   - If the change did not take, say so plainly, with what you saw.

8. **Report back:**
   - the files you changed;
   - what you checked and how (which pages, the sampled colours before and after);
   - the full path of the screenshot folder;
   - that nothing is committed.
   
   After a reload, Desktop usually marks the report as unsaved again. Say this is expected and that saving in Desktop writes the same content back.

## Never

- Reload while `hasUnsavedChanges` is true, unless the user said to discard those changes.
- Close Desktop, or `open` a file, without being asked.
- Put screenshots in the repository, or commit, unless asked.
- Revert or reformat files Desktop wrote when the user saved.

## Setup, if the wrapper reports something missing

- **Node.js:** install the LTS version from https://nodejs.org.
- **Bridge CLI:** `npm install -g @microsoft/powerbi-desktop-bridge-cli`.
- **Bridge connection:** Power BI Desktop must be running with the project open. `status` shows `"bridgeStatus": "connected"` when it can be reached.
