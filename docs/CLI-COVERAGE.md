# CLI capability ledger

This is the implementation ledger for YAZ-4502. It is not a delivery claim.
The command registry is authoritative for available commands and their inputs.
Run `yaseendocs capabilities --json` to inspect the current build.

## Implemented adapters

| App capability | Public command families | Shared behavior and limits |
| --- | --- | --- |
| Connection, readiness, receipts | `app status`, `request status`, `capabilities` | Same-user local connection; bounded queue and receipts; timeout does not cancel. |
| Saved workspaces | `workspace list/create/update/rename/remove` | Existing workspace IDs, exact roots, durable store. |
| Open a workspace, vault, page, collection, group, or folder view | `navigation open` | Exact window or most-recent exact-root reuse; explicit partial opening; renderer acknowledgement. |
| Reusable navigation link | `navigation link` | Navigation only; machine-local roots; no live window or tab IDs. |
| Windows | `window list/inspect/show/rename/close` | Current live IDs; close acknowledges before the normal flush path. |
| Tabs | `tab open/blank/close/duplicate/keep/sleep/wake/rename/reorder` | Existing workspace actions; dirty-source guards; copies and display names persist. |
| Sidebar state | `navigation open`, `sidebar setCollapsed` | Existing lenses, collection scopes, reveal and expansion; unspecified state stays. |
| Sessions | `session list/save/capture/restore/rename/remove` | Saved strips retain copies and names; restore keeps unrelated windows and tabs. |
| Metadata search | `search query` | Shared title, alias, filename, and ID matcher; workspace/vault/folder/collection/group scopes; bounded pages. |
| Saved text and live buffers | `file read`, `document live` | Saved revision by default; live reads require a window and ready tab. |
| Notes, daily notes, templates | `note create`, `daily find/create`, `template read/write` | Existing naming, templates, ID allocation, calendar rules, and exclusive creation. |
| Text replacement and append | `file write/append` | Required saved revision; atomic shared writer; durable save log; existing outside-edit handling. |
| Properties | `property set/remove` | Nested key paths; preserve unrelated YAML and comments; protect human comment ownership. |
| Comments | `comment list/add/update/remove` | Existing comment format, reply rules, author field, and human ownership checks. |
| Review and upkeep | `review queue/list/keep/remove/reset/setEnabled` | Existing schedule and review-log format; required revision for edits. |
| Link resolution and note references | `link resolve/outgoing/incoming` | Existing metadata index and resolvers; no full-text index or ID minting on reads. |
| Create folders | `folder create` | Existing ID-aware folder service; never overwrite. |
| Rename, move, retitle | `file rename/retitle` | Complete renderer action: flush, link repair, folder values, state repair, and Undo. A new parent in `newPath` is a move. |
| Copy and import | `file copy/importCopy` | Explicit sources and destination; no clipboard changes; existing copy services and free-name rules; report partial results. |
| Trash and restore | `file trash/history/restore` | System Trash; existing organization history; restore only the latest delete; no permanent delete command. |
| Favorites and Focus | `collection list/add/remove/reorder` | Explicit vault/workspace list scope; patch latest state under the shared lock. |
| Collection groups | `group list/create/rename/remove/position/addItems/removeItems/reorderItems` | Existing group IDs, per-Mac files, clocks and tombstones; report partial writes. |
| Global settings | `settings get/patch` | Existing settings validator; patch latest state and flush. |
| Shared settings folder | `settingsFolder get/set` | Existing other-Mac precedence; explicit existing folder or null; bounded initial synchronization. |
| Vault labels and number keys | `vault list/patch` | Existing display-name cleanup and unique number-key rules. |
| Vault declarations and icons | `declaration list/patch/remove`, `icon list/set/remove` | Shared stores; preserve unrelated stored fields and reject malformed files. |
| New note shortcuts | `newPlace list/set` | Patch one of three slots against latest state; require a folder inside the vault. |
| Review and formatting settings | `vaultConfig read/patch` | Named public files only; validate patches; preserve unrelated fields. |
| Drawing and diagram files | `drawing create/read/save/export`, `diagram create/read/save/export` | Existing formats, revision guards, stamps, image storage and size limits; large bodies use explicit files. A read over the connection limit is refused before loading. Saves refuse while an open editor holds unsaved edits (`UNSAVED_LIVE_EDITS` names the window and tabs). `export` copies the saved file as a standalone board; it is not the GUI's standard-font copy and not an image. |
| Live board image and PDF export | `drawing exportImage` (PNG, SVG, PDF), `diagram exportImage` (PNG, SVG) | Exact live tab; the GUI export box's renderer and PDF printer, unsaved canvas edits included; explicit new output file, never overwritten; extension must match. The GUI has no diagram PDF, so none is offered. |
| Board options | `drawing setReadOnly/setPictures/setHoverLinks/setHoverOutline/setFoldArrows`, `diagram setReadOnly` | Shared writers and revision guards; Read only remains the human UI switch. Refused while an open editor holds unsaved edits. |
| Text editor actions | `editor select/replace/format/undo/redo/save` | Exact live tab and live revision; advertised actions only; use editor transactions and local history. |
| Drawing editor actions | `editor selectElements/selectAll/deleteSelection/duplicate/group/ungroup`, layer order, align, distribute, flip, `toggleLock`, zoom, `undo/redo/save` | The engine's own actions and Undo history on an exact live drawing tab and live revision; a refused predicate fails. Read only drawings offer only the zoom actions. Excluded: drawing tools and other pointer gestures, clipboard, copy/paste styles, text-box formatting, pop-up editors, canvas preferences (inventory on YAZ-4515). |
| Diagram editor actions | `editor save` | draw.io's own actions get no reply over the embed protocol, so none is offered; content changes use `diagram save`. |
| Image and PDF bytes | `image read/export`, `pdf read/export` | Existing viewer limits; base64 reads; exclusive output files for large results. |
| Embedded drawing/image assets | `asset read/write/export` | Existing 10 MiB asset limit; required revision or exclusive creation; exact paths. |
| Components | `component list/read/save/rename/remove/export` | Existing component store, validation and Trash behavior. |
| Media search and import | `media search/preview/import/drawingIndex/drawing` | Existing providers, filters, cache and library; no keys in results. |
| Media library and favorite copies | `media library/favorite/unfavorite/recordUse/addWord/removeWord/favoriteCopies/favoriteElements/saveFavoriteElements/favoritesForPanel` | Existing library and durable copies; saved elements retain the first-copy rule. |
| Icon packs | `media packList/packStatus/downloadPacks/stopPacks/checkPacks/removePacks` | Existing pack service; explicit download/check actions; stop can run during a download. |
| Picture-folder permissions | `pictureFolder list/allow/remove` | Existing real-path and system-folder checks; removing permission never deletes files. |
| Storage | `storage stats/shrink` | Existing background workers; paged large-file rows; report moved and skipped counts. |
| Provider credential | `provider status/set/clear` | Presence only; protected input; no secret export. |
| Git sync and board history | `sync status/now/setEnabled`, `history list/read/export/restore` | Existing services; explicit vault; guarded restore. |
| Sharing | `share status/accounts/setup/list/check/get/publish/setPermission/stop/setDomain/disconnect` | Explicit effects; protected credentials; saved share paths remain usable after source deletion; validate publish content. |
| Diagnostics, updates, restart | `app diagnostics/restart`, `update state/notes/check/restart` | Existing services; plain restart skips staged installation; acknowledgement before shutdown. |
| Code language helpers | `languageHelper state/install/cancel` | Existing pinned installer; no supplied code, URLs, or package versions; cancellation can run during a download. |

## Work still required before coverage closes

These are remaining implementation or verification tasks, not approved exclusions.

1. Explicit live board exports to PNG, SVG, and PDF. Reuse the current renderer and PDF service without a dialog.
2. Inventory supported drawing/diagram actions and expose safe actions through the ready editor surface.
3. Cover right-panel navigation, cross-window tab moves, and organization Undo/Redo through complete actions.
4. Cover folder-page settings, views, shortcuts, and folder-level properties through the current format and action services.
5. Cover ID settings and maintenance. Reads must not initiate ID assignment.
6. Verify live Markdown and Monaco actions, Read only behavior, dirty board conflicts, and outside-edit Undo separation.
7. Reconcile YAZ-4279 if its merge behavior becomes available. Do not build a second collaboration engine.
8. Complete composed hidden runtime flows, size/latency/memory measurements, fresh checker rounds, and the isolated HMR demo.

## Deliberate boundaries

The approved exclusions are full-text indexing, new global IDs, persisted-data migrations,
cross-Mac root mapping, personal Alfred aliases, a new collaboration engine, arbitrary code/IPC,
secret export, and a general remote automation service. Automatic ID-link conversion stays with YAZ-3997.

UI gestures such as clicking, dragging, opening a picker, or recording a hotkey are not public automation primitives.
Their product actions use explicit inputs where available. No capability is complete merely because an internal IPC method exists.

Legacy offline commands retain their prior syntax and output. `edit` and `delete` still operate on comments.
