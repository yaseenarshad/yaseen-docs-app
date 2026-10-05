# Regression list

The one list of everything Yaseen Docs does that a change must not lose (YAZ-2171, seeded from the YAZ-2131 scope inventory). Every row has a stable ID. A PR cites the IDs it touches, and each one is proved by the automated test named here, or by walking its hand steps.

- **A** = a Playwright-Electron spec in `desktop/e2e/` (53 specs; run with `npm run e2e`).
- **U** = a unit or jsdom suite (run with `npm test`).
- **M** = hand steps, listed under [Hand scenarios](#hand-scenarios). Only what automation cannot drive lives there.

The folder specs were rewritten for YAZ-2290 (folders are the pages) without being run, so an **A** proof on a [Folders](#folders) row is not evidence until that spec has been run once.

The end-to-end proof of E22, F1, F3, F4, F5, F10 and G1 is to be rebuilt under YAZ-2459. Where one of those cells says there is no **A** proof, or names what its **A** proof leaves out, only the **U** suites it lists stand behind that part.

Add a row when a feature ships. Never delete one unless the feature is removed on purpose, and cite the ticket that removed it.

## PR checklist

- [ ] `npm test` green
- [ ] `npm run typecheck` green
- [ ] the size/integrity budget gate green, with its numbers pasted
- [ ] `npm run e2e` green once; three runs in a row for a release candidate
- [ ] every REGRESSION row this change touches is re-proved (its spec ran, or its hand steps were walked) and listed in the PR body

## Editor

| ID | Feature | Proof |
|---|---|---|
| E1 | Open, type, autosave round trip; normalised write; typing that changes nothing never writes | A `smoke`, `pasteRoundTrip`, `outlineRealFile` · U `editor/roundtrip.test.ts`, `lib/autosave.test.ts` |
| E2 | Bullet fold persisted in app state, restored on relaunch | A `smoke` (steps 4–5), `bigNote` (step 3) |
| E3 | Heading fold H1–H3 | A `headingFold`, `bigNote` (step 4) |
| E4 | Image-bullet fold / thumbnail chip | A `imageFold` |
| E5 | Folds survive external edits; external edits apply as diffs | A `foldExternalEdit`, `foldDiffApply` · U `desktop/src/main/fs/watchConformance.test.ts`, `watchConformance.polling.test.ts` (the watcher engine, 🔒 YAZ-2131 D3) |
| E6 | Outliner keys: Tab / ⇧Tab / Enter / Backspace | U the Crepe outline suites (`editor/outline/*.test.ts`) · A `folderOutline` (in part) |
| E7 | Task cycle ⌘Enter | A `tasks` |
| E8 | Marks: ⌘U underline, ⌘⇧X strike, highlight, marks across line breaks | U `editor/marks/underline.test.ts`, `editor/marks/highlight.test.ts`, `editor/breakMarks.test.ts` |
| E9 | Lightbox gallery | A `imageGallery` |
| E10 | Line selection ⇧↓ / ⇧↑; hidden lines never deleted | U `editor/lineSelection.test.ts`, `editor/lineSelection.scenarios.test.ts` |
| E11 | Bullet zoom, breadcrumbs, zoom history; ⌘Z reverts a view action | A `zoom` · U `editor/outline/zoom.test.ts` |
| E12 | Guide lines click | U `editor/outline/guideLines.test.ts` |
| E13 | Drag handle, multi-block drag | A `easyWave`, `numberedBullets` (in part) |
| E14 | Numbered bullets | A `numberedBullets` |
| E15 | Find in page ⌘F | A `findInPage` |
| E16 | Wikilinks: click, ⌘-click, `[[` completion, aliases | A `links` |
| E17 | Clipboard in/out modes, paste round trip | A `pasteRoundTrip` · U `editor/clipboard*.test.ts` |
| E18 | Image paste / render / `app://vault` / Copy Image | A `imagePaste`, `imageRender` |
| E19 | Drawings (Excalidraw sidecar, yaseendraw fork). Out of scope for optimisation, must keep working | A `drawing`, `yaseendraw` |
| E20 | Document magnification (YAZ-1410) | A `zoom` · U `editor/DocumentZoom.test.tsx`, `editor/zoomRequest.test.ts` |
| E21 | The page title is the page's `title:`, not its file name; editing it is the one title edit — `title:` is written, then the file is renamed to the name built from it, the id part unchanged; a title that builds the same name changes the `title:` line only (YAZ-2420 D2, D16) | A `title`, `names` (steps 2, 4) · U `editor/PageTitle.test.tsx`, `desktop/src/main/fs/retitle.test.ts`, `desktop/src/main/noteName.test.ts`, `App.test.tsx` |
| E22 | Properties panel (typed rows + raw) | A `propertiesReorder` (a folder view's Properties menu only; the note's own panel has no A proof) · U `editor/FrontmatterPanel.test.tsx` |
| E23 | Content width, spacing (the first block hugs the title), bullet threading settings | A `contentWidth`, `settings`, `firstBlock` · U `editor/outline/bulletThreading.test.ts` |
| E24 | Spelling squiggle + context menu | M [E24](#e24-spelling) (native menu) |
| E25 | Conflict bar / dirty buffer vs external change | U `lib/autosave.test.ts` · A `foldExternalEdit` (in part), `frontmatterRace` (the app's own frontmatter write never raises the bar, YAZ-2175) |
| E26 | View-only viewers: text, PDF, image files | A `viewers` · U `viewers/TextViewer.test.tsx`, `viewers/PdfViewer.test.tsx`, `viewers/ImageViewer.test.tsx` |
| E27 | Big notes open correctly: caret at the start, every chevron, threading on the caret path, every wikilink decorated and resolved (5k mixed + 5k heading-dense) | A `bigNote` |

## Comments and agents

| ID | Feature | Proof |
|---|---|---|
| C1 | Comment stream: add, reply, number, fold, delete | A `comments` · U `comments/CommentsSection.test.tsx` |
| C2 | `yaseendocs` CLI. The right-click item that handed an agent the command was removed on purpose by YAZ-2420 D22, and nothing replaced it | U `desktop/src/cli/cli.test.ts` · packaged bin: M [P4](#p2p4-packaging) |

## Sidebar

| ID | Feature | Proof |
|---|---|---|
| S1 | Lens tabs Files / ♥; default Files (YAZ-1846); a saved lens that is neither falls back to Files | A `lenses` · U `desktop/src/main/store.test.ts`, `sidebar/Sidebar.test.tsx` |
| S3 | Create note / dated note / folder / dated folder: what is typed is the title, free text; a note is born as `<kebab-title>-<id>.md`, a folder as its title in kebab-case with `id` and `title` in its `.folder.md`; a folder title with no letter or digit is refused (YAZ-2420 D3, D6, D20, D25) | A `names` (steps 1, 7) · U `sidebar/Sidebar.test.tsx`, `sidebar/createEntry.test.ts`, `sidebar/CreateInline.test.tsx`, `views/scaffold.test.ts`, `desktop/src/main/fs/create.test.ts` · M [N1–N5](#n1n5-ids-on-files) (step 1) |
| S4 | Rename + vault-wide link rewrite. On a note or a folder, Rename edits the title — the one title edit of E21 — and a hand-typed `[[Old title]]` follows it; on any other file it renames the file (YAZ-2420 D16, D17) | A `rename`, `names` (step 3) · U `sidebar/RenameInline.test.tsx`, `sidebar/Sidebar.test.tsx`, `links/renameLinks.test.ts` |
| S5 | External rename detection + repair. A file renamed outside the app keeps the name it was given, and a link that spells its `title:` still reaches it, so it is not counted (YAZ-2420 D5, D17) | A `externalRename` · U `links/renameDetector.test.ts`, `links/renameLinks.test.ts` |
| S6 | Delete to Trash; tabs close | A `delete` |
| S7 | File Cut / Copy / Paste; one app-wide clipboard across windows; a pasted copy of a note or a folder is its own page ([N13](#note-ids)), any other file lands under Finder's next free name | A `fileClipboard` · U `desktop/src/main/fileClip.test.ts`, `desktop/src/main/fs/copy.test.ts`, `lib/fileClipboardHotkey.test.ts` |
| S8 | ⌘K search, ⌘⏎ background tab | A `search` |
| S9 | Folders start closed each launch | A `collapsedLaunch` |
| S10 | Sidebar collapse / resize (180–520) | A `easyWave`, `settings` (in part) |
| S11 | Copy path — the plain path, and the one copy item of a sidebar row, a tab and a view row (YAZ-2420 D7, D31) — multi-select, ⌘⇧C | A `multiselect`, `tabs`, `names` (step 10) · U `sidebar/menuSections.test.ts`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `views/view/PageContextMenu.test.tsx` |
| S12 | Focus on folder (per lens, persists) | A `focus` · U `sidebar/Sidebar.test.tsx` (focus mode) |
| S13 | Favorites (♥ tab, reorder, `.yaseendocs/favorites.json`) | A `favorites` · U `desktop/src/main/favorites.test.ts`, `desktop/src/main/ipc/favorites.test.ts` |
| S14 | Vault switcher ⌘O, display names, ⓘ path, right-click menu | A `vaultSwitcher` · U `sidebar/VaultSwitcher.test.tsx`, `sidebar/vaultMenuSections.test.ts` |
| S15 | ⌘K by id: text that holds a note's or a folder's id — a pasted id, a `[[<id>]]` link, a file name, an old path — shows only that page, by its title; part of an id matches nothing by id (YAZ-2420 D32) | A `names` (step 9) · U `search/searchCandidates.test.ts`, `search/useSearchResults.test.tsx` |
| S16 | Every screen names a page by its title — sidebar rows, tabs, the right panel, the window title, search results, sheets and notices; a page with no `title:` shows its file name; rows stay ordered by file name. A file made outside the app keeps its name until its title is edited in the app, and a `title:` edited by hand shows at once and renames nothing (YAZ-2420 D5, D14, D15, D23) | A `names` (steps 5, 6) · U `lib/pageLabel.test.ts`, `lib/windowTitle.test.ts`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `right-panel/RightPanel.test.tsx`, `search/searchCandidates.test.ts`, `desktop/src/main/vaultIndex/scan.test.ts` |

## Windows

| ID | Feature | Proof |
|---|---|---|
| W1 | Tabs, ⌃Tab, ⌘W, background tabs, restore | A `tabs` |
| W2 | Multi-window, ⌘⇧N, `yaseendocs://`, Open With | A `scenarios` · M [P6](#p6-finder-launchservices-dmg) for the OS side |
| W3 | Right panel (⌥-open, resize, hide) | A `rightPanel` · U `right-panel/RightPanel.test.tsx` |
| W4 | Welcome + recents | A `smoke` (step 1) · U `Welcome.test.tsx` |
| W5 | ⌘Q flush + relaunch restore | A `smoke` (step 5), `quitFlush` · U `desktop/src/main/windows.test.ts` |
| W6 | Theme live in every window | A `theme` |
| W7 | Settings dialog, hotkeys list | A `settings` |
| W8 | Per-tab state kept across tab switches: scroll, caret, undo history, unsaved buffer, find-in-page, zoom (🔒 YAZ-2132 D5) | A `tabLayers` |

## Folders

Folders are the pages (YAZ-2290). This section was "Folder pages", one row `F1–F9` for the note flagged `folder_page: true`; that model was removed on purpose by YAZ-2290, and the rows below are what replaced it, F1–F9 keeping their order. `crossCutting` and `folderSync`, two specs that row cited, were deleted with it.

| ID | Feature | Proof |
|---|---|---|
| F1 | A folder opens as a tab: double-click its row, "Open" in its menu, or Enter on the focused row; a single click only selects and folds; the tab, the right panel and the window title show the folder's title — the `title:` in its `.folder.md`, else its directory's name (YAZ-2290 D3, YAZ-2420 D14). It replaced the contents block under a flagged note | no A proof · U `sidebar/Sidebar.test.tsx`, `sidebar/menuSections.test.ts`, `editor/Editor.test.tsx`, `tabs/TabBar.test.tsx`, `right-panel/RightPanel.test.tsx`, `lib/pageLabel.test.ts`, `workspace/useWorkspace.test.tsx`, `App.test.tsx` |
| F2 | The outline is a plain free-text document stored in the folder's settings; a link in it is just a link (YAZ-2290 D5) | A `folderOutline` · U `views/view/OutlineView.test.tsx`, `views/view/OutlineEditor.test.tsx`, `views/outlineDoc.test.ts`, `views/FolderView.test.tsx` |
| F3 | Folder view, Table: a folder's rows are the notes under it at any depth, plus its shortcuts; columns (add, rename, hide, reorder, delete), frozen columns, nested groups | A `folderColumns`, `freezeColumns` (adding and retyping a column, frozen columns; rename, header-drag reorder, delete and nested groups have no A proof) · U `views/FolderView.test.tsx`, `views/view/TableView.test.tsx`, `views/view/TableHeaderMenu.test.tsx`, `views/view/TableHeaderDrag.test.tsx`, `views/view/frozenColumns.test.ts`, `views/view/TableNestedGroups.test.tsx`, `views/deleteColumn.test.ts` |
| F4 | Folder view, Board: group drag, card styles, column width | A `board` (only that the Board tab is offered; group drag, card styles and column width have no A proof) · U `views/view/BoardView.test.tsx`, `views/view/GroupDrag.test.tsx`, `views/FolderView.test.tsx`, `views/view/NestedGroupActions.test.tsx`, `views/view/Toolbar.test.tsx`, `views/boardOptionGroups.test.ts` |
| F5 | Folder view: filter and sort | no A proof · U `views/FolderView.test.tsx`, `views/view/filterRows.test.ts`, `views/view/SortMenu.test.tsx`, `views/engine.test.ts` |
| F6 | Default views are Table then Board (Cards, List and Outline are in the "+" menu); a saved default view; switching views writes nothing | A `defaultView` · U `views/folderSettings.test.ts`, `views/FolderView.test.tsx`, `views/view/Toolbar.test.tsx` |
| F8 | Backlinks ("Linked mentions") on a note, and on a folder's page for the notes that link to the folder | A `backlinks` · U `links/backlinks.test.ts`, `links/BacklinksSection.test.tsx`, `views/FolderView.page.test.tsx` |
| F9 | "bible" convergence: the index, the link graph and the folder views agree over one committed vault | A `bible` |
| F10 | Every folder has a hidden `<folder>/.folder.md` holding its id from the moment it exists; its settings are added under `folder_settings` when first changed — the defaults until then, and from then on it states the columns exactly; the index and the watcher see it, as `IndexResponse.folders` and never as a record (YAZ-2290 D1, D8, E2) | no A proof · U `views/FolderView.test.tsx`, `views/folderSettings.test.ts`, `views/writeFolderColumn.test.ts`, `views/writeProperty.test.ts`, `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/folderSettings.test.ts`, `desktop/src/main/fs/watchers.test.ts`, `editor/wikilink/WikilinkIndexBridge.test.tsx` |
| F11 | A folder's own title, properties and comments, stored in `.folder.md`: the title is its `title:` line, and a commit writes it and renames the directory to that title in kebab-case, with no id; nothing inside is renamed; a title with no letter or digit, or one whose name a folder beside it holds, is refused (YAZ-2290 D9; YAZ-2420 D6, D16, D25). The CLI's first `comment` on a folder creates the file | A `names` (step 7) · U `views/FolderView.page.test.tsx`, `editor/FrontmatterPanel.test.tsx`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `desktop/src/main/fs/retitle.test.ts`, `desktop/src/cli/cli.test.ts` |
| F12 | Links to folders: `[[Folder]]` resolves to a folder — by its id, path, title, then directory name (YAZ-2420 D17) — when no note, path or alias holds the name; a click opens the folder tab; `[[` completion offers folders by title; renaming a folder rewrites name links to it, and a title edit the links that spelled its old title; a link column's `target: "[[Folder]]"` narrows its picker to that folder's notes (YAZ-2290 D10) | U `links/folderLinks.test.ts`, `links/renameLinks.test.ts`, `links/backlinks.test.ts`, `editor/wikilink/wikilinkClick.test.ts`, `editor/wikilink/WikilinkIndexBridge.test.tsx`, `App.test.tsx` |
| F13 | Note shortcuts: `also_in` on the note holds folder ids; "Add note shortcut" on a folder row opens the picker; shortcut rows wear a mark in the tree and in the folder's views; "Remove shortcut" stands where Delete would; deleting a column removes this folder's value from every note that has one, a shortcut included; removing a shortcut removes the values of the folders that no longer show the note; a drag-move, a pasted Cut or a "Remove shortcut" that would clear values asks first (YAZ-2290 D2, E5; D19, D20, D21) | U `links/shortcuts.test.ts`, `sidebar/ConfirmMove.test.tsx`, `App.test.tsx`, `sidebar/ShortcutPicker.test.tsx`, `sidebar/menuSections.test.ts`, `sidebar/Sidebar.test.tsx`, `sidebar/folderCounts.test.ts`, `views/FolderView.test.tsx`, `editor/FrontmatterPanel.test.tsx`, `views/deleteColumn.test.ts`, `desktop/src/cli/cli.test.ts` |
| F14 | Every folder row shows its note count, shortcuts included (YAZ-2290 E6) | U `sidebar/folderCounts.test.ts`, `sidebar/Sidebar.test.tsx` |
| F15 | A folder's note template is a hidden `<folder>/.template.md`, used by "New" in the folder view and "New note" in the tree; the new note's title replaces any `title` in the template, and "New" is titled `Untitled` every time, the ids keeping the files apart (YAZ-2420 D20); empty column keys are never written into a note, and a note's properties panel says which folder its fields come from ("Properties from") and lists that folder's unfilled columns as empty rows (YAZ-2290 E1, E3) | U `views/scaffold.test.ts`, `views/FolderView.test.tsx`, `views/FolderView.page.test.tsx`, `sidebar/Sidebar.test.tsx`, `editor/FrontmatterPanel.test.tsx` |
| F16 | Opening a vault creates no `Home.md` (YAZ-2290 D11) | U `App.test.tsx` |
| F17 | A table's Name cell is plain text showing the note's title: a click selects the cell, as on any other, and does not open the note; Enter on it opens (YAZ-2420 D18, D26). `file.basename` is its own column, "File name", not shown by default | A `names` (step 11) · U `views/view/TableView.test.tsx`, `views/engine.test.ts` |
| F18 | ⌘-click on a table's Name cell opens the note in a background tab, ⌥-click in the right panel, ⇧-click opens nothing; the row's right-click menu leads with "Open" (YAZ-2420 D26) | U `views/view/TableView.test.tsx`, `views/view/PageContextMenu.test.tsx` |
| F19 | A double-click on a table's Name cell edits the title in place; committing runs the one title edit of E21; Escape discards, and an empty or unchanged title commits nothing (YAZ-2420 D19) | A `names` (step 11) · U `views/view/TableView.test.tsx`, `views/FolderView.test.tsx`, `App.test.tsx` |

## Note ids

| ID | Feature | Proof |
|---|---|---|
| N1 | A note created in the app is born with a frontmatter `id` (12 lowercase base32 characters, at least one digit) and its `title`, in a file named `<kebab-title>-<id>.md`; it is never zero bytes; `id` is a Reserved property, and `title` is reserved too and is no row in the properties panel (YAZ-2293; YAZ-2420 D3, D20, D27) | A `names` (step 1) · U `desktop/src/main/fs/create.test.ts`, `desktop/src/main/noteId.test.ts`, `desktop/src/main/noteName.test.ts`, `views/scaffold.test.ts`, `links/reservedKeys.test.ts`, `editor/FrontmatterPanel.test.tsx` · M [N1–N5](#n1n5-ids-on-files) |
| N2 | A note dropped from outside the app into a vault that uses IDs is given an id, and the index carries it | U `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/scan.test.ts`, `desktop/src/main/vaultIndex/cache.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N3 | A vault that has not said yes to IDs is never written by the id sweep: one whose `.yaseendocs/ids.json` says no, one whose `.yaseendocs/` holds no answer, and a folder with no `.yaseendocs/` (YAZ-2523 V10, replacing "a folder with no `.yaseendocs/`"; the whole rule is [K1](#two-kinds-of-vault)) | U `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/liveIds.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N4 | A copy of a note made outside the app gets its own id from the sweep; the original keeps its, and the copy keeps the name it was given (YAZ-2420 D5). A copy made in the app is N13 | U `desktop/src/main/vaultIndex/idSweep.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N5 | An `id` that is not the app's — a hand-written `id: 42`, another tool's — is replaced with the app's own, and the old value is not kept (YAZ-2420 D30, replacing "left alone") | U `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/scan.test.ts`, `editor/FrontmatterPanel.test.tsx`, `desktop/src/cli/cli.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N6 | The `[[` picker lists notes by title and inserts `[[<id>]]` (title row, alias row, Create row — whose typed text is the new note's title) and the editor shows the note's current title, its `title:` (YAZ-2420 D14, D17, D20) | U `links/completion.test.ts`, `editor/wikilink/wikilinkPicker.test.ts`, `editor/wikilink/wikilinkPlugin.test.ts`, `editor/wikilink/wikilinkClick.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N7 | An id link follows a title edit, and a rename by anything: it reads as the note's current title and no file is rewritten; an in-app rename or title edit never counts or rewrites one (YAZ-2420 D14) | U `views/engine.test.ts`, `links/renameLinks.test.ts`, `links/backlinks.test.ts`, `editor/wikilink/wikilinkPlugin.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N8 | `[[<id>\|label]]` shows the hand-typed label | U `editor/wikilink/wikilinkPlugin.test.ts`, `views/expr/values.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N9 | A view's link cell shows the note's title — its `title:` — and stores the id; its editor completes over titles; sort, group labels and search read the title, write-backs and the collapse key keep the id (YAZ-2420 D14, D17) | U `views/expr/values.test.ts`, `views/engine.test.ts`, `views/view/EditableCell.test.tsx`, `views/view/TableView.test.tsx`, `views/view/BoardView.test.tsx`, `views/view/GroupDrag.test.tsx` · M [N6–N10](#n6n10-links-by-id) |
| N10 | An id no note has: the raw id, dimmed; a click says `That note no longer exists` and creates nothing | U `editor/wikilink/wikilinkPlugin.test.ts`, `editor/wikilink/wikilinkClick.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N11 | Copy ID: on the right-click of an id link inside a note, and nowhere else; it copies the linked note's id. It was removed on purpose from every file menu by YAZ-2420 D31, where "Copy path" is the one copy item (S11) | U `editor/wikilink/wikilinkMenu.test.ts`, `sidebar/menuSections.test.ts`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `views/view/PageContextMenu.test.tsx` · M [N11](#n11-copy-id) |
| N12 | `yaseendocs id` / `links [--json]`, in a vault that uses IDs ([K7](#two-kinds-of-vault) is the refusal anywhere else): `links`, and `due` on a folder, print each page's title beside its path; `id` gives a page that holds another tool's `id` the app's own; `--help` says how a file name is built (YAZ-2420 D14, D30) | U `desktop/src/cli/cli.test.ts` · M [N12](#n12-the-id-and-links-commands) |
| N13 | A copy made in the app is its own page at once: a note's holds a fresh id and `title: <title> copy` under the name built from both; a copied folder is titled `<title> copy`, every note and `.folder.md` in it takes a fresh id, and its notes carry their per-folder values to the copy's id (YAZ-2420 D21) | A `names` (step 8), `fileClipboard` · U `desktop/src/main/fs/copy.test.ts`, `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/ipc/fs.test.ts` |
| N14 | A hand-typed `[[Name]]` resolves in this order: id, path, title, file name, alias, folder; a path of names resolves by titles. A title edit rewrites `[[Old title]]` to the new title, and to the page's id when a link cannot spell the new title or another page answers to it; any other rename leaves a link that spells a title alone (YAZ-2420 D17, YAZ-2478) | U `views/engine.test.ts`, `links/renameLinks.test.ts`, `links/folderLinks.test.ts`, `links/completion.test.ts` |
| N15 | A typed `[[Folder/Name]]` link makes its note once — in the folder that title names when it is already there, making only the levels that name none — and then points at it; a second click while the note is being made makes nothing (YAZ-2478) | U `editor/wikilink/createFromLink.test.ts`, `editor/wikilink/wikilinkClick.test.ts`, `views/scaffold.test.ts`, `views/engine.test.ts` |

## Two kinds of vault

A vault uses IDs only when its own `.yaseendocs/ids.json` says `{"enabled":true}` (YAZ-2523). Every row above that speaks of ids, `title:` lines, built file names, a folder's `.folder.md` at birth, the default Board and `status` column, shortcuts or a folder's own values — E21, S3, S4, S15, S16, F6, F10, F11, F13, F15, F19 and N1–N15 among them — is such a vault. These rows are the other kind, a vault that said no or has not answered, and the choice between the two.

| ID | Feature | Proof |
|---|---|---|
| K1 | Nothing is written unasked in a vault that has not said yes: no `id`, no `title:`, no `.folder.md`, and a deleted `.folder.md` is not put back. That `.yaseendocs/` exists — a favorite, a review setting, sync — is no answer, and neither is a note or a folder made in the app. A no that arrives while the ID pass is running stops it, and removes nothing (YAZ-2523 V1, V4, V10) | U `desktop/src/main/vaultIndex/liveIds.test.ts`, `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/ipc/fs.test.ts` · M [K1–K3](#k1k3-the-box-that-asks) |
| K2 | The box: a vault with no answer is asked, once per window, before any note is given an ID — an empty folder too. It counts what a yes would write (notes, folders, notes holding another tool's `id`); "Give IDs" and "Not for this vault" each save the answer in `.yaseendocs/ids.json`; Esc or a click outside saves nothing and the vault stays plain; Enter chooses neither. A vault where some note holds an ID and a yes would write nothing, to a note or a folder, is saved as yes with no box (YAZ-2523 V2, V11) | U `App.test.tsx`, `components/ConfirmIds.test.tsx`, `components/ConfirmSheet.test.tsx`, `views/useIndex.test.tsx`, `editor/wikilink/WikilinkIndexBridge.test.tsx`, `desktop/src/main/vaultIndex/liveIds.test.ts` · M [K1–K3](#k1k3-the-box-that-asks) |
| K3 | The switch, Settings › Files & Links › "Give this vault's notes IDs": it shows the vault's answer, and a vault that has not answered reads Off; On saves yes and the ID pass runs over the notes and folders already there; Off saves no and stops future writes, asking first where a note holds an ID; with no vault open the row is absent (YAZ-2523 V4, V13) | U `settings/SettingsDialog.test.tsx`, `App.test.tsx`, `desktop/src/main/vaultIndex/liveIds.test.ts` |
| K4 | Plain create, rename and copy: a new note is `<name typed>.md` holding its folder's template and nothing else, a new folder is the directory alone, and a note made from a link or the `[[` picker's Create row is plain too; a rename — the sidebar's, the page title, a table's Name cell — renames the file to the name typed, updates links by name and writes no `title:`; a copy is the same bytes under Finder's next free name. A request shaped for a vault that uses IDs, and any title edit, is refused by main (YAZ-2523 V3) | U `desktop/src/main/fs/create.test.ts`, `desktop/src/main/fs/copy.test.ts`, `desktop/src/main/ipc/fs.test.ts`, `sidebar/createEntry.test.ts`, `sidebar/Sidebar.test.tsx`, `views/scaffold.test.ts`, `App.test.tsx`, `links/renameLinks.test.ts`, `links/renameDetector.test.ts`, `links/useExternalRenames.test.tsx`, `editor/wikilink/createFromLink.test.ts`, `editor/wikilink/wikilinkClick.test.ts`, `editor/wikilink/wikilinkPicker.test.ts` |
| K5 | What needs IDs is not offered in a plain vault: no "Add note shortcut" and no shortcut rows; no menu and no Copy ID on a link shaped like an id, and a click on one says why it cannot open; nothing is found by id in ⌘K; no "Properties from" in the properties panel; the `[[` picker and link cells insert names. Every screen shows a note under its file name, and `id`, `title`, `also_in` and `in` are ordinary properties; `comments` and `reviews` stay Reserved (YAZ-2523 V5, V12, V13) | U `sidebar/Sidebar.test.tsx`, `links/shortcuts.test.ts`, `editor/wikilink/wikilinkMenu.test.ts`, `editor/wikilink/wikilinkClick.test.ts`, `search/searchCandidates.test.ts`, `links/completion.test.ts`, `links/reservedKeys.test.ts`, `editor/FrontmatterPanel.test.tsx`, `desktop/src/main/vaultIndex/liveIds.test.ts` |
| K6 | A plain vault's folder page: a Table alone by default, with no Board and no `status` column; its columns are the notes' own properties, `id`, `title`, `also_in` and `in` among them; a cell edit or a board drop writes that one line at the top of the note; opening writes nothing, and the first view or column change makes `.folder.md` holding `folder_settings` only; "Delete column…" is not offered, and a column is hidden; "New" is `Untitled.md`, then `Untitled 2.md` (YAZ-2523 V6, V11) | U `views/FolderView.test.tsx`, `views/folderSettings.test.ts`, `views/writeFolderColumn.test.ts`, `views/engine.test.ts` |
| K7 | `yaseendocs id` and `links` are refused, exit 1 and nothing written, unless the nearest folder above the page that has answered said yes: a vault that said no, one that has not answered, a folder that only holds `.yaseendocs/`, and no vault at all; `id` is refused even for a page that holds one. `--help` says so (YAZ-2523 V10) | U `desktop/src/cli/cli.test.ts` · M [N12](#n12-the-id-and-links-commands) (step 4) |

## Sync, tools, platform

| ID | Feature | Proof |
|---|---|---|
| G1 | GitHub sync (chip, sync now, quit-time push) | A `settings` (only that the Sync row is in the dialog) · U `desktop/src/main/git/*.test.ts` (`manager.test.ts` among them), `desktop/src/main/ipc/github.test.ts` · no automated proof of the wired path: the chip, a click on it, and a push that reaches a real remote |
| P1 | `app://` is a secure, standard, fetch-capable origin; no request leaves `app:` / `data:` / `blob:` | A `secureContext` |
| P2 | Info.plist `yaseendocs` scheme + `.md` as Alternate Editor | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P3 | Ad-hoc signature valid | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P4 | `Resources/bin/yaseendocs` + `out/main/cli.js` shipped | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P5 | Windows installer builds | the `v*` tag release workflow (`.github/workflows/release.yml`) |
| P6 | Finder double-click, LaunchServices, DMG install | M [P6](#p6-finder-launchservices-dmg) |
| P7 | An e2e run never claims the machine's `yaseendocs://` handler | U `desktop/src/main/deepLinkScheme.test.ts` · M: after `npm run e2e`, the check under [P6](#p6-finder-launchservices-dmg) still names `/Applications/Yaseen Docs.app` |
| P8 | Open/Save panels keep the OS language; Chromium's paks trimmed to `en*` (🔒 YAZ-2131 D1) | U `tools/afterPack.test.mjs` · gate `npm run perf:budget` rows `chromiumLocaleCount`, `chromiumLocaleBytes`, `lprojCount` |

## Hand scenarios

Walk these on a packaged build (`dist-app/`), with a scratch vault and a throwaway profile, never the real ones.

### E24 Spelling

1. Type a misspelt word (`recieve`) in a note. It gets the red squiggle.
2. Right-click it. The native menu leads with suggestions; pick `receive`. The word is replaced and the note autosaves.
3. Right-click a correct word. There are no suggestions, and Cut / Copy / Paste still work.

### P2–P4 Packaging

1. `plutil -p "Yaseen Docs.app/Contents/Info.plist"`: `CFBundleURLSchemes` holds `yaseendocs`, and `CFBundleDocumentTypes` lists `md` / `markdown` with role Editor and rank Alternate.
2. `codesign -dv "Yaseen Docs.app"` reports `Signature=adhoc`, and `codesign --verify --deep --strict "Yaseen Docs.app"` passes.
3. `Contents/Resources/bin/yaseendocs` exists and is executable, and the asar lists `out/main/cli.js`.

### P6 Finder, LaunchServices, DMG

1. Open the DMG, drag the app to Applications, launch it once. It starts, and the Welcome screen lists recents.
2. In Finder, right-click a `.md` file → Open With: Yaseen Docs is offered, and choosing it opens the file in a window on its vault.
3. From another app (Slack, Notes), click a `yaseendocs://` link to a scratch-vault note (`yaseendocs://` + the note's absolute path, percent-encoded, as `shared/links.ts` `fileLink` builds it). The packaged app opens that note.
4. Check which app owns the scheme (read-only):
   `osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("yaseendocs://x")).path.js'` prints `/Applications/Yaseen Docs.app`.

### N1–N5 Ids on files

The dev app (`npm run dev`) will do. Set up in Terminal: `V=~/scratch-ids; mkdir -p "$V/.yaseendocs"; printf '{"enabled":true}\n' > "$V/.yaseendocs/ids.json"` — that file saying yes is what makes `$V` a vault that uses IDs; the `.yaseendocs` folder alone does not — then open `$V` in the app. No box asks.

1. Right-click blank space in the sidebar › New note, title it `Born`. `ls "$V"` shows one file: `born-`, then 12 lowercase letters and digits with at least one digit, then `.md`. `B=$(ls "$V"/born-*.md); cat "$B"` prints a properties block holding two lines, `title: Born` and `id:` followed by the same 12 characters: the new note is not an empty file. In the note's properties panel `id` carries the **Reserved** chip and has no editor, and there is no `title` row.
2. `printf '# Dropped\n' > "$V/Dropped.md"`. Within a few seconds `cat "$V/Dropped.md"` shows an `id:` block above the unchanged `# Dropped` line. The file keeps its name, and its sidebar row reads `Dropped`.
3. `U=~/scratch-plain; mkdir -p "$U/.yaseendocs"; printf '# Plain\n' > "$U/Plain.md"`, open `$U` in the app — a box asks whether to give this vault's notes IDs; press Esc — open `Plain`, then `printf '# Later\n' > "$U/Later.md"`. After a minute both files are byte for byte what was written, with no `id`, though `$U` holds a `.yaseendocs` folder. (`cat "$U/.yaseendocs/ids.json"` must find no file; if one is there saying `{"enabled":true}` the vault uses IDs and this step proves nothing.)
4. Open `$V` in the app again, then `cp "$V/Dropped.md" "$V/Twin.md"`. Within a few seconds the copy's `id:` differs from the original's, the original's `id:` line is the one it had in step 2, and the copy is still named `Twin.md`.
5. `printf -- '---\nid: 42\n---\n# Foreign\n' > "$V/Foreign.md"`. Within a few seconds `cat "$V/Foreign.md"` shows `id:` followed by 12 characters of the app's own where `42` was, and nothing else changed.

### N6–N10 Links by id

In `$V` from the scenario above, with the app open on it. Create two notes in the app, titled `Source` and `Target`, then `S=$(ls "$V"/source-*.md); T=$(ls "$V"/target-*.md)`.

1. In `Source` type `[[Tar`, press Enter on the `Target` suggestion, then click elsewhere in the note (a link stays raw while the caret touches it). The line reads `Target` as a link. Once the note has saved, `cat "$S"` shows `[[` + the 12 characters of `$T`'s `id:` line, the ones its file name ends in, + `]]`, not the title.
2. Note `stat -f %m "$S"`, then `mv "$T" "$V/Moved.md"`. The link in `Source` still reads `Target` — the title is in the file, not its name — and a click on it opens the note; no "update links?" banner appears. Then `sed -i '' 's/^title: Target$/title: Moved/' "$V/Moved.md"`: within a few seconds the link reads `Moved`, and the file is still `Moved.md`. `cat "$S"` still shows the same `[[<id>]]`, its `stat -f %m` is unchanged, and no file in `$V` but `Moved.md` was modified.
3. `ID=$(sed -n 's/^id: //p' "$V/Moved.md"); printf '\n[[%s|the plan]]\n' "$ID" >> "$S"`. The open note picks up the new line, and it reads `the plan`; a click on it opens `Moved`.
4. Open a folder as a tab (double-click its row in the sidebar) whose table has at least one note and a column of type **Link** (`+ Add column` declares one), double-click that note's cell in the column, type `[[Mov`, press Enter to take `Moved`, and Enter again to commit. The cell shows `Moved`. `cat` of that page's file shows the property holding `[[<id>]]` with `Moved.md`'s id, not `[[Moved]]`.
5. Right-click `Moved` in the sidebar › Delete, and confirm. The first link in `Source` turns into the raw 12-character id, dimmed. Click it: the notice says `That note no longer exists`, no tab opens, and no new note appears in the sidebar.

### N11 Copy ID

In `$V` from the first scenario, with `Born` and `Foreign` in it.

1. In any other note type `[[Bor` and press Enter on `Born`, click elsewhere in the note so the link reads `Born`, then right-click the link. The menu shows `Born` and its id as two greyed rows, then `Copy ID`. Choose it. The notice says `Copied ID`, and `pbpaste` prints exactly the 12 characters of `Born`'s `id:` line — the linked note's, not the open one's.
2. A right-click on a link written by name (`[[Foreign]]`) opens the system menu.
3. Right-click `Born` in the sidebar, then its tab, then its row in a folder's table (double-click the folder's row to open it): in each menu the one item that copies text is `Copy path`. Choose it: `pbpaste` prints the plain path of the file and nothing else, ending in `born-`, the note's id and `.md`.

### N12 The id and links commands

`CMD` below stands for the app's command: in a packaged build `"<Yaseen Docs.app>/Contents/Resources/bin/yaseendocs"`, in the dev app `node "<repo>/desktop/out/main/cli.js"`. `$V` is the vault of the first scenario and `$B` its `born-<id>.md`.

1. `CMD --help` lists the `id` and `links` verbs beside the four for comments, says that both are refused in a vault that does not give its notes IDs, and says the app builds a page's file name from its title and id (`<kebab-title>-<id>.md`).
2. `CMD id "$B"` prints the 12 characters of the file's `id:` line; `echo $?` prints `0`, and the file's `stat -f %m` is what it was before.
3. Quit the app, so its own sweep cannot get there first. `printf '# Loose\n' > "$V/Loose.md"; CMD id "$V/Loose.md"` prints a new id, and `cat "$V/Loose.md"` shows it in an `id:` block above the unchanged `# Loose`. Running the command again prints the same id.
4. In a folder where nothing at or above it has answered — `N=~/scratch-novault; mkdir -p "$N/.yaseendocs"; printf '# x\n' > "$N/x.md"`, the `.yaseendocs` folder alone being no answer — `CMD id "$N/x.md"` prints nothing on stdout, says `…'s vault does not give its notes IDs (turn on "Give this vault's notes IDs" in the app's Settings)` and exits 1; the file is unchanged. `CMD links "$N/x.md"` says `…'s vault does not use IDs, so there are no ID links to list` and exits 1. Then `printf '{"enabled":false}\n' > "$N/.yaseendocs/ids.json"; cp "$B" "$N/held.md"; CMD id "$N/held.md"` is refused in the same words, though that page holds an `id`. With the app still quit, `printf -- '---\nid: 42\n---\n# Other\n' > "$V/Other.md"; CMD id "$V/Other.md"` prints an id of the app's own and exits 0, and `cat "$V/Other.md"` shows it where `42` was.
5. `printf 'See [[%s]], [[zzzzzzzzzzz9]] and [[Foreign]].\n' "$(CMD id "$B")" > "$V/Lists.md"; CMD links "$V/Lists.md"` prints two lines: `Born`'s id followed by its title, `Born`, and its file name, `born-<id>.md`; then `zzzzzzzzzzz9  (missing)`. The link written by name is not listed. With `--json` the same two rows print as JSON, `"kind": "note"` with `"title": "Born"` and `"path": "born-<id>.md"`, and `"kind": "missing"`.

### K1–K3 The box that asks

The dev app (`npm run dev`) will do. Set up in Terminal a scratch git repo of Markdown that holds app settings and no answer: `G=~/scratch-repo; mkdir -p "$G/notes" "$G/.yaseendocs"; printf '# One\n' > "$G/One.md"; printf '# Two\n' > "$G/notes/Two.md"; printf '{"version":1,"favorites":["One.md"]}\n' > "$G/.yaseendocs/favorites.json"; git -C "$G" init -q; git -C "$G" add -A; git -C "$G" commit -qm start`.

1. Open `$G` in the app. A box asks `Give this vault's notes IDs?` and says the app would write an ID into 2 notes and add a hidden settings file to 1 folder. Its buttons are "Not for this vault" and "Give IDs". Press Enter: nothing happens.
2. Press Esc. The box closes. Open `One`, wait a minute, then `git -C "$G" status --porcelain` prints nothing: no file was changed and none was added. `One` is still in the ♥ tab.
3. Quit the app and start it again. The box is back. Choose "Not for this vault". `git -C "$G" status --porcelain` prints one line, `?? .yaseendocs/ids.json`, and `cat "$G/.yaseendocs/ids.json"` shows `"enabled": false`.
4. Quit and start the app once more: no box. Settings › Files & Links › "Give this vault's notes IDs" reads Off. After a minute `git -C "$G" status --porcelain` still prints that one line.
