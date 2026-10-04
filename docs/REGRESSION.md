# Regression list

The one list of everything Yaseen Docs does that a change must not lose (YAZ-2171, seeded from the YAZ-2131 scope inventory). Every row has a stable ID. A PR cites the IDs it touches, and each one is proved by the automated test named here, or by walking its hand steps.

- **A** = a Playwright-Electron spec in `desktop/e2e/` (60 specs; run with `npm run e2e`).
- **U** = a unit or jsdom suite (run with `npm test`).
- **M** = hand steps, listed under [Hand scenarios](#hand-scenarios). Only what automation cannot drive lives there.

The folder specs were rewritten for YAZ-2290 (folders are the pages) without being run, so an **A** proof on a [Folders](#folders) row is not evidence until that spec has been run once.

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
| E21 | Page title = rename | A `title` |
| E22 | Properties panel (typed rows + raw) | A `properties`, `propertiesReorder` |
| E23 | Content width, spacing (the first block hugs the title), bullet threading settings | A `contentWidth`, `settings`, `firstBlock` · U `editor/outline/bulletThreading.test.ts` |
| E24 | Spelling squiggle + context menu | M [E24](#e24-spelling) (native menu) |
| E25 | Conflict bar / dirty buffer vs external change | U `lib/autosave.test.ts` · A `foldExternalEdit` (in part), `frontmatterRace` (the app's own frontmatter write never raises the bar, YAZ-2175) |
| E26 | View-only viewers: text, PDF, image files | A `viewers` · U `viewers/TextViewer.test.tsx`, `viewers/PdfViewer.test.tsx`, `viewers/ImageViewer.test.tsx` |
| E27 | Big notes open correctly: caret at the start, every chevron, threading on the caret path, every wikilink decorated and resolved (5k mixed + 5k heading-dense) | A `bigNote` |

## Comments and agents

| ID | Feature | Proof |
|---|---|---|
| C1 | Comment stream: add, reply, number, fold, delete | A `comments` · U `comments/CommentsSection.test.tsx` |
| C2 | `yaseendocs` CLI + Copy for Agent | U `desktop/src/cli/cli.test.ts`, `desktop/src/main/ipc/agent.test.ts`, `lib/copyForAgent.test.ts` · packaged bin: M [P4](#p2p4-packaging) |

## Sidebar

| ID | Feature | Proof |
|---|---|---|
| S1 | Lens tabs Files / ♥; default Files (YAZ-1846). The Topics tab was removed by YAZ-2290; a saved `topics` lens falls back to Files | A `lenses` · U `desktop/src/main/store.test.ts`, `sidebar/Sidebar.test.tsx` |
| S2 | REMOVED by YAZ-2290: the Topics tree, Uncategorized and drag to re-parent. Folders are the pages now, see [Folders](#folders) | — |
| S3 | Create note / dated note / folder / dated folder ("New folder page" was removed by YAZ-2290) | U `sidebar/Sidebar.test.tsx`, `sidebar/createEntry.test.ts`, `sidebar/CreateInline.test.tsx` · M [N1–N5](#n1n5-ids-on-files) (step 1) |
| S4 | Rename + vault-wide link rewrite | A `rename` |
| S5 | External rename detection + repair | A `externalRename` |
| S6 | Delete to Trash; tabs close | A `delete` |
| S7 | File Cut / Copy / Paste; one app-wide clipboard across windows | A `fileClipboard` · U `desktop/src/main/fileClip.test.ts`, `lib/fileClipboardHotkey.test.ts` |
| S8 | ⌘K search, ⌘⏎ background tab | A `search` |
| S9 | Folders start closed each launch | A `collapsedLaunch` |
| S10 | Sidebar collapse / resize (180–520) | A `easyWave`, `settings` (in part) |
| S11 | Copy path, multi-select, ⌘⇧C | A `multiselect`, `tabs` |
| S12 | Focus on folder (per lens, persists). "Focus on topic" was removed with the Topics tab by YAZ-2290 | A `focus` · U `sidebar/Sidebar.test.tsx` (focus mode) |
| S13 | Favorites (♥ tab, reorder, `.yaseendocs/favorites.json`) | A `favorites` · U `desktop/src/main/favorites.test.ts`, `desktop/src/main/ipc/favorites.test.ts` |
| S14 | Vault switcher ⌘O, display names, ⓘ path, right-click menu | A `vaultSwitcher` · U `sidebar/VaultSwitcher.test.tsx`, `sidebar/vaultMenuSections.test.ts` |

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
| F1 | A folder opens as a tab: double-click its row, "Open" in its menu, or Enter on the focused row; a single click only selects and folds; the tab, the right panel and the window title show the folder's whole name (YAZ-2290 D3). It replaced the contents block under a flagged note | A `folderTabs`, `folderView` · U `sidebar/Sidebar.test.tsx`, `sidebar/menuSections.test.ts`, `editor/Editor.test.tsx`, `tabs/TabBar.test.tsx`, `right-panel/RightPanel.test.tsx`, `lib/pageLabel.test.ts`, `workspace/useWorkspace.test.tsx`, `App.test.tsx` |
| F2 | The outline is a plain free-text document stored in the folder's settings; a link in it is just a link (YAZ-2290 D5) | A `folderOutline` · U `views/view/OutlineView.test.tsx`, `views/view/OutlineEditor.test.tsx`, `views/outlineDoc.test.ts`, `views/FolderView.test.tsx` |
| F3 | Folder view, Table: a folder's rows are the notecards directly in it; columns (add, rename, hide, reorder, delete), frozen columns, nested groups | A `columns`, `folderColumns`, `freezeColumns`, `nestedGroups` · U `views/FolderView.test.tsx`, `views/view/TableView.test.tsx`, `views/view/TableHeaderMenu.test.tsx`, `views/view/TableHeaderDrag.test.tsx`, `views/view/frozenColumns.test.ts`, `views/view/TableNestedGroups.test.tsx`, `views/deleteColumn.test.ts` |
| F4 | Folder view, Board: group drag, card styles, column width | A `board`, `boardCardStyles` · U `views/view/BoardView.test.tsx`, `views/view/GroupDrag.test.tsx`, `views/view/NestedGroupActions.test.tsx`, `views/view/Toolbar.test.tsx`, `views/boardOptionGroups.test.ts` |
| F5 | Folder view: filter and sort | A `filter` · U `views/view/filterRows.test.ts`, `views/view/SortMenu.test.tsx`, `views/engine.test.ts` |
| F6 | Default views are Table then Board (Cards, List and Outline are in the "+" menu); a saved default view; switching views writes nothing | A `defaultView` · U `views/folderSettings.test.ts`, `views/FolderView.test.tsx`, `views/view/Toolbar.test.tsx` |
| F7 | REMOVED by YAZ-2290: Sync from folder. A folder's rows are what lives in it, so there is nothing to sync | — |
| F8 | Backlinks ("Linked mentions") on a note, and on a folder page for the notecards that link to the folder | A `backlinks` · U `links/backlinks.test.ts`, `links/BacklinksSection.test.tsx`, `views/FolderView.page.test.tsx` |
| F9 | "bible" convergence: the index, the link graph and the folder views agree over one committed vault | A `bible` |
| F10 | Folder settings live in a hidden `<folder>/.folder.md` under `folder_page_settings`: no file means the defaults, opening a folder writes nothing, the first change creates the file, and from then on it states the columns exactly; the index and the watcher see it, as `IndexResponse.folders` and never as a record (YAZ-2290 D1, D8, E2) | A `folderTabs`, `folderView` · U `views/FolderView.test.tsx`, `views/folderSettings.test.ts`, `views/writeFolderColumn.test.ts`, `views/writeProperty.test.ts`, `desktop/src/main/vaultIndex/folderSettings.test.ts`, `desktop/src/main/fs/watchers.test.ts`, `editor/wikilink/WikilinkIndexBridge.test.tsx` |
| F11 | A folder page's own title (a commit renames the folder), properties and comments, stored in `.folder.md`; "Copy for Agent" on a folder hands out `<folder>/.folder.md`, and the CLI's first `comment` on it creates the file (YAZ-2290 D9) | U `views/FolderView.page.test.tsx`, `editor/FrontmatterPanel.test.tsx`, `lib/copyForAgent.test.ts`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `desktop/src/main/ipc/agent.test.ts`, `desktop/src/cli/cli.test.ts` |
| F12 | Links to folders: `[[Folder]]` resolves to a folder when no notecard, path or alias holds the name; a click opens the folder tab; `[[` completion offers folders; renaming a folder rewrites name links to it; a link column's `target: "[[Folder]]"` narrows its picker to that folder's notecards (YAZ-2290 D10) | U `links/folderLinks.test.ts`, `links/renameLinks.test.ts`, `links/backlinks.test.ts`, `editor/wikilink/wikilinkClick.test.ts`, `editor/wikilink/WikilinkIndexBridge.test.tsx`, `App.test.tsx` |
| F13 | Notecard shortcuts: `also_in` on the notecard holds folder ids; "Add notecard shortcut" on a folder row opens the picker; shortcut rows wear a mark in the tree and in the folder's views; "Remove shortcut" stands where Delete would; deleting a column leaves a shortcut notecard's value alone (YAZ-2290 D2, E4, E5) | U `links/shortcuts.test.ts`, `sidebar/ShortcutPicker.test.tsx`, `sidebar/menuSections.test.ts`, `sidebar/Sidebar.test.tsx`, `sidebar/folderCounts.test.ts`, `views/FolderView.test.tsx`, `editor/FrontmatterPanel.test.tsx`, `views/deleteColumn.test.ts`, `desktop/src/cli/cli.test.ts` |
| F14 | Every folder row shows its notecard count, shortcuts included (YAZ-2290 E6) | U `sidebar/folderCounts.test.ts`, `sidebar/Sidebar.test.tsx` |
| F15 | A folder's note template is a hidden `<folder>/.template.md`, used by "New" in the folder view and "New note" in the tree; empty column keys are never written into a notecard, and a notecard's properties panel lists its folder's unfilled columns as empty rows (YAZ-2290 E1, E3) | U `views/scaffold.test.ts`, `views/FolderView.test.tsx`, `views/FolderView.page.test.tsx`, `sidebar/Sidebar.test.tsx`, `editor/FrontmatterPanel.test.tsx` |
| F16 | No converter for old vaults: a note still carrying `folder_page`, `folder_pages` or `folder_page_settings` is an ordinary note, and opening a vault creates no `Home.md` (YAZ-2290 D6, D11) | U `editor/Editor.test.tsx`, `links/folderLinks.test.ts`, `App.test.tsx` |

## Note ids

| ID | Feature | Proof |
|---|---|---|
| N1 | A note created in the app is born with a frontmatter `id` (12 lowercase base32 characters, at least one digit); it is never zero bytes, and `id` is a Reserved property (YAZ-2293) | U `desktop/src/main/fs/create.test.ts`, `desktop/src/main/noteId.test.ts`, `editor/FrontmatterPanel.test.tsx` · M [N1–N5](#n1n5-ids-on-files) |
| N2 | A note dropped into an adopted vault from outside the app is given an id, and the index carries it | U `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/scan.test.ts`, `desktop/src/main/vaultIndex/cache.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N3 | A folder the app has not adopted (no `.yaseendocs/`) is never written by the id sweep | U `desktop/src/main/vaultIndex/idSweep.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N4 | A copy of a note gets its own id; the original keeps its | U `desktop/src/main/vaultIndex/idSweep.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N5 | A hand-written `id` of another shape is left alone | U `desktop/src/main/vaultIndex/idSweep.test.ts`, `desktop/src/main/vaultIndex/scan.test.ts` · M [N1–N5](#n1n5-ids-on-files) |
| N6 | The `[[` picker inserts `[[<id>]]` (name row, alias row, Create row) and the editor shows the note's current title | U `links/completion.test.ts`, `editor/wikilink/wikilinkPicker.test.ts`, `editor/wikilink/wikilinkPlugin.test.ts`, `editor/wikilink/wikilinkClick.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N7 | An id link follows a rename done outside the app: it reads as the new title and no file is rewritten; an in-app rename never counts or rewrites one | U `views/engine.test.ts`, `links/renameLinks.test.ts`, `links/backlinks.test.ts`, `editor/wikilink/wikilinkPlugin.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N8 | `[[<id>\|label]]` shows the hand-typed label | U `editor/wikilink/wikilinkPlugin.test.ts`, `views/expr/values.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N9 | A view's link cell shows the title and stores the id; sort, group labels and search read the title, write-backs and the collapse key keep the id | U `views/expr/values.test.ts`, `views/engine.test.ts`, `views/view/EditableCell.test.tsx`, `views/view/TableView.test.tsx`, `views/view/BoardView.test.tsx`, `views/view/GroupDrag.test.tsx` · M [N6–N10](#n6n10-links-by-id) |
| N10 | An id no note has: the raw id, dimmed; a click says `That notecard no longer exists` and creates nothing | U `editor/wikilink/wikilinkPlugin.test.ts`, `editor/wikilink/wikilinkClick.test.ts` · M [N6–N10](#n6n10-links-by-id) |
| N11 | Copy ID: sidebar row menu, tab menu, a view's page menu, right-click on an id link; absent for a note with no id, a PDF, a folder and a 2+ selection | U `sidebar/menuSections.test.ts`, `sidebar/Sidebar.test.tsx`, `tabs/TabBar.test.tsx`, `views/view/PageContextMenu.test.tsx`, `editor/wikilink/wikilinkMenu.test.ts` · M [N11](#n11-copy-id) |
| N12 | `yaseendocs id` / `links [--json]` | U `desktop/src/cli/cli.test.ts` · M [N12](#n12-the-id-and-links-commands) |

## Sync, tools, platform

| ID | Feature | Proof |
|---|---|---|
| G1 | GitHub sync (chip, sync now, quit-time push) | A `sync`, `settings` · U `desktop/src/main/git/*.test.ts`, `desktop/src/main/ipc/github.test.ts` |
| T1 | REMOVED by YAZ-2290: the `migrateFolderPages` / `seedDefaultColumns` CLIs. There is no converter for old vaults (D6), see F16 | — |
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

The dev app (`npm run dev`) will do. Set up in Terminal: `V=~/scratch-ids; mkdir -p "$V/.yaseendocs"` — the `.yaseendocs` folder is what makes `$V` an adopted vault — then open `$V` in the app.

1. Right-click blank space in the sidebar › New note, name it `Born`. `cat "$V/Born.md"` prints a properties block holding one line, `id:` followed by 12 lowercase letters and digits with at least one digit: the new note is not an empty file. In the note's properties panel `id` carries the **Reserved** chip and has no editor.
2. `printf '# Dropped\n' > "$V/Dropped.md"`. Within a few seconds `cat "$V/Dropped.md"` shows an `id:` block above the unchanged `# Dropped` line.
3. `U=~/scratch-plain; mkdir -p "$U"; printf '# Plain\n' > "$U/Plain.md"`, open `$U` in the app, open `Plain`, then `printf '# Later\n' > "$U/Later.md"`. After a minute both files are byte for byte what was written, with no `id`. (`ls -a "$U"` must show no `.yaseendocs`; if one is there the folder is adopted and this step proves nothing.)
4. Open `$V` in the app again, then `cp "$V/Dropped.md" "$V/Dropped copy.md"`. Within a few seconds the copy's `id:` differs from the original's, and the original's `id:` line is the one it had in step 2.
5. `printf -- '---\nid: 42\n---\n# Foreign\n' > "$V/Foreign.md"`. After a minute `cat "$V/Foreign.md"` still shows `id: 42` and nothing else changed.

### N6–N10 Links by id

In `$V` from the scenario above, with the app open on it. Create two notes in the app, `Source` and `Target`.

1. In `Source` type `[[Tar`, press Enter on the `Target` suggestion, then click elsewhere in the note (a link stays raw while the caret touches it). The line reads `Target` as a link. Once the note has saved, `cat "$V/Source.md"` shows `[[` + the 12 characters of `Target.md`'s `id:` line + `]]`, not the name.
2. Note `stat -f %m "$V/Source.md"`, then `mv "$V/Target.md" "$V/Moved.md"`. The link in `Source` now reads `Moved` and a click on it opens `Moved`; no "update links?" banner appears. `cat "$V/Source.md"` still shows the same `[[<id>]]`, its `stat -f %m` is unchanged, and no other file in `$V` was modified.
3. `ID=$(sed -n 's/^id: //p' "$V/Moved.md"); printf '\n[[%s|the plan]]\n' "$ID" >> "$V/Source.md"`. The open note picks up the new line, and it reads `the plan`; a click on it opens `Moved`.
4. Open a folder as a tab (double-click its row in the sidebar) whose table has at least one notecard and a column of type **Link** (`+ Add column` declares one), double-click that notecard's cell in the column, type `[[Mov`, press Enter to take `Moved`, and Enter again to commit. The cell shows `Moved`. `cat` of that page's file shows the property holding `[[<id>]]` with `Moved.md`'s id, not `[[Moved]]`.
5. Right-click `Moved` in the sidebar › Delete, and confirm. The first link in `Source` turns into the raw 12-character id, dimmed. Click it: the notice says `That notecard no longer exists`, no tab opens, and no new note appears in the sidebar.

### N11 Copy ID

In `$V` from the first scenario, with `Born` and `Foreign` in it.

1. Right-click `Born` in the sidebar: `Copy ID` sits directly under `Copy path` and above `Copy for Agent`. Choose it. The notice says `Copied ID`, and `pbpaste` prints exactly the 12 characters of `Born.md`'s `id:` line.
2. Open `Born` and right-click its tab: `Copy ID` sits under `Copy path`. It copies the same 12 characters.
3. In any other note type `[[Bor` and press Enter on `Born`, click elsewhere in the note so the link reads `Born`, then right-click the link. The menu shows `Born` and its id as two greyed rows, then `Copy ID`, which copies `Born`'s id — the linked note's, not the open one's.
4. In a folder's table (double-click the folder's row to open it), right-click a row whose notecard was created in the app: `Copy ID` sits under `Copy path` and copies that page's id.
5. `Copy ID` is NOT offered on: `Foreign` (its `id: 42` is not a note id), a folder, blank space in the sidebar, a PDF or image dropped into `$V`, and a right-click on one of two ⇧-selected notes. A right-click on a link written by name (`[[Foreign]]`) opens the system menu, with no `Copy ID`.

### N12 The id and links commands

Right-click any note › Copy for Agent, and `pbpaste`: the third line is the command followed by `--help`. `CMD` below stands for that command without `--help` (in the dev app it is `node "<repo>/desktop/out/main/cli.js"`). `$V` is the vault of the first scenario.

1. `CMD --help` lists the `id` and `links` verbs beside the four for comments.
2. `CMD id "$V/Born.md"` prints the 12 characters of the file's `id:` line; `echo $?` prints `0`, and the file's `stat -f %m` is what it was before.
3. Quit the app, so its own sweep cannot get there first. `printf '# Loose\n' > "$V/Loose.md"; CMD id "$V/Loose.md"` prints a new id, and `cat "$V/Loose.md"` shows it in an `id:` block above the unchanged `# Loose`. Running the command again prints the same id.
4. In a folder with no `.yaseendocs` in it or above it — `mkdir -p ~/scratch-novault; printf '# x\n' > ~/scratch-novault/x.md` — `CMD id ~/scratch-novault/x.md` prints nothing on stdout, says `… has no id and is in no vault (no .yaseendocs folder above it)` and exits 1; the file is unchanged. `CMD id "$V/Foreign.md"` says `the id property is not a page id (foreign)`, exits 1, and the file still holds `id: 42`.
5. `printf 'See [[%s]], [[zzzzzzzzzzz9]] and [[Foreign]].\n' "$(CMD id "$V/Born.md")" > "$V/Lists.md"; CMD links "$V/Lists.md"` prints two lines: `Born`'s id followed by `Born.md`, then `zzzzzzzzzzz9  (missing)`. The link written by name is not listed. With `--json` the same two rows print as JSON, `"kind": "note"` with `"path": "Born.md"` and `"kind": "missing"`.
