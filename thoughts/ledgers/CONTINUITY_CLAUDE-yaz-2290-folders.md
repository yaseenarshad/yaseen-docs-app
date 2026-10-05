# YAZ-2290: folders are the pages

Paused on 2026-10-04 with everything built merged to `main`. The decision record, the scenario tables and the per-issue history are in Linear on YAZ-2290 (project "Yaseen Docs"); this file is the repo-side copy of what the code's `D1`…`D11` and `E1`…`E6` citations mean.

## Goal

- Folders are the pages: double-clicking a folder opens it as a tab with Table, Board, Cards, List and Outline views over the notes that live in it.
- The folder-page note model, the Topics tab and Home are gone. A note is in a folder because it lives there.
- The one exception is a shortcut: a note can also appear in another folder, as the same file.
- Done means: all six phases closed in Linear, the seven open polish decisions answered and applied, and the scenario tables walked once in the real app.

## Constraints

- **No Playwright.** Yaseen forbade it outright: it takes over his screen. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. The e2e specs are kept compiling and have never been run since the redesign.
- **No release or version tag** unless Yaseen asks.
- **Decisions are Yaseen's.** Architecture and product behavior are brought to him as: the problem, numbered options, a recommendation, the file, a line-numbered diff, the behavior after. Bugs and small implementation choices are the implementer's.
- **The size gate is at its measured values** (`tools/perf/budget.json`, ratcheted at `e4ae199`). Any growth fails it; raising a ceiling needs Yaseen's OK, and the row is set to the measured value with no headroom.
- Two other projects share files with this one and are also on `main`: note ids (YAZ-2293) and review scheduling (YAZ-2322).

## Key Decisions

All by Yaseen, 2026-10-04.

| # | Ruling | Why |
|---|---|---|
| D1 | A folder's settings live in a hidden `<folder>/.folder.md`, written by its first change. No file means defaults. | Travels with the folder, so no rename upkeep; already hidden everywhere; one file per folder for git sync. Rejected: a central `.yaseendocs/folders.json`, a visible note named after the folder. |
| D2 | A shortcut is `also_in: [<folder id>]` on the note; the id is the `id` in the folder's `.folder.md` (amended by YAZ-2293 D7, was folder paths). | Travels with the note; nothing to rewrite on any rename or move. Rejected: a list in the folder's settings, a stub file, a real symlink. |
| D3 | The folder itself is the tab (directory path). Single click folds, double click opens. | Works for every folder with nothing written. Overturns "a folder cannot be a tab" (YAZ-1578 D3). |
| D4 | A folder's rows are the notes directly in it, plus its shortcuts. Not subfolders, not recursive. | A folder's views are about its own contents. |
| D5 | Outline stays as a plain document; a link in it is just a link. | The membership machinery was the problem, not the editor. |
| D5a | Default views are Table, Board. | Opening a folder should show its notes. |
| D6 | No converter for old vaults; legacy keys are ordinary frontmatter. | This app gets new vaults. |
| D7 | Calendar is out. | It never existed in the code. |
| D8 | The index and the watcher see `.folder.md`; it rides `IndexResponse.folders`, never `records`. | Live settings in every window; link rewrite inside Outline text. |
| D9 | A folder page keeps its title, its own properties and its own comments, stored in `.folder.md`. | Folder-page features are preserved, not dropped. |
| D10 | `[[Folder]]` resolves to a folder when no note, path or alias holds the name. | Links and backlinks to a folder page survive. |
| D11 | Home is removed; the vault root has no page. | Not needed any more. |
| E1 | Empty column keys are never written into notes. | Opening a folder must not write into its notes. |
| E2 | Every folder has a Status column by default. | Board works at once; nothing is written until a value is set. |
| E3 | A folder's note template is a hidden `<folder>/.template.md`. | Travels with the folder and is unique to it. |
| E4 | Deleting a column strips the key only from notes that live in the folder. | A shortcut's values belong to its own folder. |
| E5 | On a shortcut row, "Remove shortcut" stands where "Delete" would be. | A shortcut is the same file as the original. |
| E6 | Every folder row shows its note count, shortcuts included. | Topics rows showed it. |

## State

- Done:
  - [x] Phase 1: scope and lock the design
  - [x] Phase 2: folders open as pages (tabs, folder view, `.folder.md`, births, title, properties, comments, links to folders)
  - [x] Phase 3: note shortcuts (`also_in`, the picker, the mark, remove)
  - [x] Phase 4: remove the legacy (Topics, the folder-page note model, Home, the old CLIs) and bring the docs in line
  - [x] Phase 5, applied part: the polish review and everything in it that does not change what the user sees
  - [x] Phase 6A: unit tests and fixtures match the new model; e2e specs rewritten, typecheck only
- Now: [→] paused; waiting on Yaseen
- Remaining:
  - [ ] Phase 5B1: seven polish decisions (P1 to P7 below), then apply them
  - [ ] Phase 6B: walk the scenario tables once in the real app on a scratch vault

## Open Questions

Each was put to Yaseen with a recommendation and is unanswered. Do not apply any of them without his answer.

- UNCONFIRMED P1: a folder hit in sidebar search opens the folder (recommended), or keeps revealing it. `client/src/sidebar/Sidebar.tsx` `activate`.
- UNCONFIRMED P2: notes loose in the vault root get no folder columns (recommended), or keep the default Status row and a hidden `<vault>/.folder.md`. `client/src/editor/FrontmatterPanel.tsx`.
- UNCONFIRMED P3: "Edit property" on a column only a shortcut folder declares saves to that folder (recommended), or is hidden.
- UNCONFIRMED P4: `yaseendocs comments` on a folder with no settings file prints "no comments" (recommended), or keeps failing. `desktop/src/cli/cli.ts`; grows the main bundle.
- UNCONFIRMED P5: a top-level folder that shares its name with a note stays unlinkable by name (recommended), or the picker offers its id.
- UNCONFIRMED P6: backlinks stay notes only (recommended), or list folders too.
- UNCONFIRMED P7: the on-disk key stays `folder_page_settings` (recommended), or is renamed.
- UNCONFIRMED: nothing in this project has been run in the real app. The picker, the shortcut mark and the tree rows have not been seen on screen.

## Working Set

- Branch: `main` (everything is merged; no feature branch remains).
- Checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. Under heavy machine load the wall-clock tests in the `perf` vitest project can fail; run `npx vitest run --project perf` alone to tell.
- Where the model lives:
  - `client/src/views/FolderView.tsx`: the folder page (title, own properties, views, own comments, backlinks).
  - `client/src/views/folderSettings.ts`: the settings schema, defaults, reader and writers. The on-disk key is `folder_page_settings`.
  - `client/src/views/writeProperty.ts` `readForWrite`: a missing `.folder.md` reads as empty and the write creates it.
  - `client/src/views/scaffold.ts` `createNote`: the one note birth (template, seed, no empty keys).
  - `client/src/links/shortcuts.ts`, `shared/alsoIn.ts`: what a folder holds; adding and removing a shortcut.
  - `client/src/links/folderLinks.ts`: links to folders, completion rows, the link-column picker.
  - `client/src/sidebar/Tree.tsx`, `menuSections.ts`, `folderCounts.ts`, `ShortcutPicker.tsx`: folder rows, counts, shortcut rows, the menu.
  - `client/src/editor/Editor.tsx` (`useTreeKind` dispatch), `client/src/lib/pageLabel.ts`, `client/src/tabs/TabBar.tsx`: folder tabs.
  - `desktop/src/main/vaultIndex/live.ts`, `desktop/src/main/fs/watchers.ts`: the `.folder.md` carve-out.
  - `docs/CONTRACTS.md` sections "Folders are the pages", "Folder settings: `.folder.md`", "Note shortcuts"; `docs/REGRESSION.md` rows F1 to F16.
