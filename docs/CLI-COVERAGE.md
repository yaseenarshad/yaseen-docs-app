# CLI capability ledger

This is the implementation ledger for YAZ-4502. It is not a delivery claim.
The command registry is authoritative for available commands and their inputs.
Run `yaseendocs capabilities --json` to inspect the current build.

## Implemented adapters

| App capability | Public command families | Shared behavior and limits |
| --- | --- | --- |
| Connection, readiness, receipts | `app status`, `request status`, `capabilities` | Same-user local connection; bounded queue and receipts; timeout does not cancel. |
| Command discovery and result schemas | `capabilities --json`, `<resource> <action> --help` | Every command declares its input and output fields, enums and nulls. An open object appears only for content with open keys (frontmatter, stored view options, settings groups), and says so. Tests check each result against its declared output. |
| Saved workspaces | `workspace list/create/update/rename/remove` | Existing workspace IDs, exact roots, durable store. |
| Open a workspace, vault, page, collection, group, or folder view | `navigation open` | Exact window or most-recent exact-root reuse; explicit partial opening; renderer acknowledgement. |
| Reusable navigation link | `navigation link` | Navigation only; machine-local roots; no live window or tab IDs. |
| Windows | `window list/inspect/show/rename/close` | Current live IDs; close acknowledges before the normal flush path. |
| Tabs | `tab open/blank/close/duplicate/keep/sleep/wake/rename/reorder` | Existing workspace actions; dirty-source guards; copies and display names persist. |
| Cross-window tab moves | `tab move` | The GUI's send-tab path: save first, refuse unresolved dirty state, `window:move-to` or `window:pop-out`, emptied windows close. Replies after the source and target renderers acknowledge; closed windows return `SOURCE_CLOSED`, `TARGET_UNAVAILABLE`, or `TARGET_UNACKNOWLEDGED`. |
| Sidebar state | `navigation open`, `sidebar setCollapsed` | Existing lenses, collection scopes, reveal and expansion; unspecified state stays. |
| Right panel | `navigation open --panel right`, `rightPanel setOpen`, `window inspect` | The GUI's Open to the right and show/hide actions; one owner per page; acknowledged when the page shows expanded; inspection returns its pages. |
| Sessions | `session list/save/capture/restore/rename/remove` | Saved strips retain copies and names; restore keeps unrelated windows and tabs; remove needs `confirm: true`, as the session list asks. |
| Metadata search | `search query` | Shared title, alias, filename, and ID matcher; workspace/vault/folder/collection/group scopes; bounded pages. |
| Saved text and live buffers | `file read`, `document live` | Saved revision by default; live reads require a window and ready tab. |
| Notes, daily notes, templates | `note create`, `daily find/create`, `template read/write` | Existing naming, templates, ID allocation, calendar rules, and exclusive creation. |
| Text replacement and append | `file write/append` | Required saved revision; atomic shared writer; durable save log; existing outside-edit handling. |
| Properties | `property set/remove` | Nested key paths; preserve unrelated YAML and comments; protect human comment ownership; the app's own keys are refused per the vault's ID answer, naming their command. |
| Comments | `comment list/add/update/remove` | Existing comment format, reply rules, author field, and human ownership checks; remove needs `confirm: true`, as the delete sheet asks. |
| Review and upkeep | `review queue/list/keep/remove/reset/setEnabled` | Existing schedule and review-log format; required revision for edits; reset needs `confirm: true`, as its sheet asks. |
| Link resolution and note references | `link resolve/outgoing/incoming` | Existing metadata index and resolvers; no full-text index or ID minting on reads. Incoming uses the UI's Linked mentions rule (`shared/backlinks.ts`): folder outlines, view order and link-column targets count. |
| Create folders | `folder create` | Existing ID-aware folder service; never overwrite. |
| Rename and retitle | `file rename/retitle` | Complete renderer action: flush, link repair, state repair, and Undo. `file rename` takes a new name in the same folder, as the sidebar's Rename. |
| Move | `file move` | The GUI's move door (`planMoves` → `runMoves`), as a drag: each item keeps its name; one move step on the Undo list, with the cleared folder values that Undo restores. The D21 sheet is `dropValues: true` (`CONFIRMATION_REQUIRED` without it). Items in two vaults fail `BETWEEN_VAULTS`. |
| Copy and import | `file copy/importCopy` | Explicit sources and destination; no clipboard changes; existing copy services and free-name rules; report partial results. As the sidebar's Paste of a Copy, a copied note keeps no values for folders that do not show it (`dropFolderValuesAfterCopy`); `file copy` needs `dropValues: true` when that drops values. |
| Trash and restore | `file trash/history/restore` | System Trash; existing organization history; restore only the latest delete; no permanent delete command; trash needs `confirm: true`, as the delete sheet asks. |
| Organization Undo and Redo | `file undo/redo` | The ⌘Z/⌘⇧Z step function and the window's 20-step session history, shared with the GUI; partial and empty steps are reported. |
| Favorites and Focus | `collection list/add/remove/reorder` | Explicit vault/workspace list scope; patch latest state under the shared lock. |
| Collection groups | `group list/create/rename/remove/position/addItems/removeItems/reorderItems` | Existing group IDs, per-Mac files, clocks and tombstones; report partial writes. Remove is the sidebar's Delete (shared `folderDeletion`): tombstones in both scopes, and `keepItems` answers its sheet. |
| Global settings | `settings get/patch` | Existing settings validator; patch latest state and flush. |
| Shared settings folder | `settingsFolder get/set` | Existing other-Mac precedence; explicit existing folder or null; bounded initial synchronization. |
| Vault labels and number keys | `vault list/patch` | Existing display-name cleanup and unique number-key rules; a key taken from another vault names that vault in `keyFrom`. |
| Vault declarations and icons | `declaration list/patch/remove`, `icon list/names/set/remove` | Shared stores; preserve unrelated stored fields and reject malformed files. Icon names are the shipped Material set (`icon names` lists the picker's names); `icon set` and icon rules in `settings patch` refuse others. |
| New note shortcuts | `newPlace list/set` | Patch one of three slots against latest state; require a folder inside the vault. |
| Review and formatting settings | `vaultConfig read/patch` | Named public files only; validate patches; preserve unrelated fields. |
| Folder pages | `folder read/setProperty/removeProperty` | Shared folder-settings parse; a read creates nothing; required revision, or null to create `.folder.md`; the app's reserved keys are refused. |
| Folder views | `folderView add/rename/duplicate/remove/move/setOptions/setDefault` | Shared view-tab rules: free names, one outline, the last view stays, the starting view and collapsed groups follow; options limited to what each view type reads; remove needs `confirm: true`, as the delete sheet asks. The live current view is `navigation open --view`, which checks the saved view first and waits for the page to index it. |
| Folder columns and formulas | `folderColumn set/setLabel/remove`, `folderFormula set` | Shared Properties-menu rules: kind rule, labels, built-in keys refused; delete prunes views and labels, then clears this folder's value in each note, with `confirm: true`, a cleared count, and partial failure; a removed formula drops its view references. |
| Folder shortcuts | `shortcut list/add/remove` | Shared `also_in` rules; a folder ID is minted only on add; `dropValues` confirms clearing other folders' values. |
| Vault IDs | `ids state/enable/disable/reletter/backfill/check` | State reads a read-only index entry and never adopts, sweeps, or mints; Settings' actions with typed letters as explicit input; changed, renamed, and left counts; partial failure reported. Legacy `id <page>` is unchanged. |
| Drawing and diagram files | `drawing create/read/save/export`, `diagram create/read/save/export` | Existing formats, revision guards, stamps, image storage and size limits; large bodies use explicit files. A read over the connection limit is refused before loading. Saves refuse while an open editor holds unsaved edits (`UNSAVED_LIVE_EDITS` names the window and tabs). `export` copies the saved file as a standalone board; it is not the GUI's standard-font copy and not an image. |
| Live board image and PDF export | `drawing exportImage` (PNG, SVG, PDF), `diagram exportImage` (PNG, SVG) | Exact live tab; the GUI export box's renderer and PDF printer, unsaved canvas edits included; explicit new output file, never overwritten; extension must match. The GUI has no diagram PDF, so none is offered. |
| Board options | `drawing setReadOnly/setPictures/setHoverLinks/setHoverOutline/setFoldArrows`, `diagram setReadOnly` | Shared writers and revision guards; Read only remains the human UI switch. Refused while an open editor holds unsaved edits. |
| Text editor actions | `editor select/replace/format/undo/redo/save` | Exact live tab and live revision (the document and the selection; a fold, a glow or an autosave does not move it); advertised actions only; use editor transactions and local history. A Read only note or locked code tab offers only `select` and `save`; agents write it with `file write`. `conflict: true` while the conflict bar shows; `editor save` then stays `SAVE_INCOMPLETE` until a person chooses. A `file write` under unsaved typing uses the existing merge (Markdown) or conflict bar (Markdown, code). Outside edits stay out of a note's Undo; a code tab's outside reload is one undoable edit (YAZ-3451). |
| Drawing editor actions | `editor selectElements/selectAll/deleteSelection/duplicate/group/ungroup`, layer order, align, distribute, flip, `toggleLock`, zoom, `undo/redo/save` | The engine's own actions and Undo history on an exact live drawing tab and live revision; a refused predicate fails. Read only drawings offer only the zoom actions. Excluded: drawing tools and other pointer gestures, clipboard, copy/paste styles, text-box formatting, pop-up editors, canvas preferences (inventory on YAZ-4515). |
| Diagram editor actions | `editor save` | draw.io's own actions get no reply over the embed protocol, so none is offered; content changes use `diagram save`. |
| Image and PDF bytes | `image read/export`, `pdf read/export` | Existing viewer limits; base64 reads; exclusive output files for large results. |
| Embedded drawing/image assets | `asset read/write/export` | Existing 10 MiB asset limit; required revision or exclusive creation; exact paths. Writes refuse while an open editor holds unsaved edits (`UNSAVED_LIVE_EDITS`). |
| Components | `component list/read/save/rename/remove/export` | Existing component store, validation and Trash behavior; remove needs `confirm: true`, as the delete row asks. |
| Media search and import | `media search/preview/import/drawingIndex/drawing` | Existing providers, filters, cache and library; no keys in results. |
| Media library and favorite copies | `media library/favorite/unfavorite/recordUse/addWord/removeWord/favoriteCopies/favoriteElements/saveFavoriteElements/favoritesForPanel` | Existing library and durable copies; saved elements retain the first-copy rule. |
| Icon packs | `media packList/packStatus/downloadPacks/stopPacks/checkPacks/removePacks` | Existing pack service; explicit download/check actions; stop can run during a download. `removePacks` needs `confirm: true` in place of the app's “Remove the icon packs?” sheet. |
| Picture-folder permissions | `pictureFolder list/allow/remove` | Existing real-path and system-folder checks; removing permission never deletes files. |
| Storage | `storage stats/shrink` | Existing background workers; paged large-file rows; report moved and skipped counts. Shrink skips boards with unsaved live edits, as Settings does, and lists them in `unsavedSkipped`. |
| Provider credential | `provider status/set/clear` | Presence only; protected input; no secret export. |
| Git sync and board history | `sync status/now/setEnabled`, `history list/read/export/restore` | Existing services; explicit vault; guarded restore. Restore refuses while an open editor holds unsaved edits of the board. |
| Sharing | `share status/accounts/setup/list/check/get/publish/setPermission/stop/setDomain/disconnect` | Explicit effects; protected credentials; saved share paths remain usable after source deletion; validate publish content. |
| Diagnostics, updates, restart | `app diagnostics/restart`, `update state/notes/check/restart` | Existing services; plain restart skips staged installation; acknowledgement before shutdown. |
| Code language helpers | `languageHelper state/install/cancel` | Existing pinned installer; no supplied code, URLs, or package versions; cancellation can run during a download. |

## Work still required before coverage closes

These are remaining verification tasks, not approved exclusions. Items 1–5 of the earlier list are built: live board exports, drawing actions, right panel, tab moves, organization Undo/Redo, folder pages, columns, formulas, shortcuts, and ID maintenance.

1. Prove live Markdown and code-editor actions end to end, human Read only, and outside-edit Undo separation.
2. Declare a precise output schema for every command, with a contract check that the real result matches it.
3. YAZ-4279 (board merge) is not on `main`. Until it lands, CLI board writes refuse stale revisions and unsaved live edits; they do not merge.
4. Fresh checker rounds, size, latency and memory on the final head, and the isolated HMR demo.

Known limits that stay by design:
- Diagram live actions other than Save: draw.io's embed protocol runs an action with no reply and no enabled check, so the app cannot report a result.
- Diagram PDF export: the app's diagram export offers PNG and SVG only.
- Board image exports need an open tab; rendering needs the live engine.

## Deliberate boundaries

The approved exclusions are full-text indexing, new global IDs, persisted-data migrations,
cross-Mac root mapping, personal Alfred aliases, a new collaboration engine, arbitrary code/IPC,
secret export, and a general remote automation service. Automatic ID-link conversion stays with YAZ-3997.

UI gestures such as clicking, dragging, opening a picker, or recording a hotkey are not public automation primitives.
Their product actions use explicit inputs where available. No capability is complete merely because an internal IPC method exists.

Legacy offline commands retain their prior syntax and output. `edit` and `delete` still operate on comments.
