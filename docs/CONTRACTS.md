# Contracts (locked in GRO-1961)

Source of truth for types: [`shared/types.ts`](../shared/types.ts). This file is the prose companion.

## Repo layout / scripts / ports

```
package.json          npm workspaces: client, server. Root scripts:
                        dev        concurrently: server (tsx watch, cwd server/) + client (vite)
                        build      vite build (client/dist); the server runs from source via tsx
                        typecheck  tsc -p client && tsc -p server && tsc -p shared
                        test       vitest run  (projects: client=jsdom, server=node)
client/               Vite 7 + React 19 + TS, @milkdown/crepe 7.22.x  (127.0.0.1:5173, strict port)
                        vite proxy: /api -> http://127.0.0.1:3737
  src/App.tsx                 root/file/picker state; Sidebar is keyed by root
  src/api.ts                  typed fetch wrappers + ApiRequestError
  src/editor/                 Editor (Crepe host + conflict bar), createCrepe (locked factory, see "Editor rules"), featureConfig (Crepe feature allowlist + guard test), listItemRoundTrip (empty-item round trip), frontmatter, SaveIndicator
  src/editor/marks/           underline (mark: Mod-u ↔ `<u>…</u>` inline HTML, $remark + $markSchema + $shortcut) (+ test)
  src/editor/outline/         outlineFolding ($prose plugin: collapsible parent bullets) + outlineFoldKeys + outlineFolding.css, listCommands (outliner keymap), hotkeys (Obsidian hotkeys), zoom + zoom.css (zoom into a bullet), guideLines + guideLines.css (click-to-fold guide lines), listNodes (shared helpers), bullets.css (depth glyphs) (+ tests)
  src/hooks/                  useFile (load), useAutosave (debounce/flush/conflict), useWatch (one EventSource per root, fan-out), usePickFolder (native dialog → modal fallback)
  src/lib/                    pure logic with unit tests: autosave state machine, storage (localStorage), treeState, paths
  src/sidebar/                Sidebar, Tree, FolderPicker
  src/test-setup.ts           jsdom stubs (observers, Range rects, localStorage on Node >= 25)
server/               Hono 4 + @hono/node-server, chokidar 4, run with tsx (port 3737, binds 127.0.0.1)
  src/app.ts                  Hono app + error mapping (tests import this); src/index.ts only listens
  src/fs-utils.ts             ApiFailure, path/dir guards, listDirs, buildTree, atomicWrite
  src/watchers.ts             one shared chokidar watcher per root
  src/routes/                 dirs, tree, file, pickFolder, watch (+ *.test.ts); src/test-fixture.ts builds a temp vault
shared/types.ts       shared TS types (alias @shared/* in both tsconfigs + vite)
docs/CONTRACTS.md     this file
```

Import from shared: `import type { TreeResponse } from '@shared/types'`.

## HTTP API (server, base `http://127.0.0.1:3737`)

All paths are absolute POSIX paths. No jail — any absolute path is allowed.
All errors: `{ error: { code, message, path? } }` with `ApiErrorCode` (see types) and HTTP status:
`BAD_REQUEST`/`NOT_ABSOLUTE`/`NOT_A_DIRECTORY`/`NOT_A_FILE`/`NOT_MARKDOWN` → 400,
`FORBIDDEN` → 403, `NOT_FOUND` → 404, `CONFLICT`/`ALREADY_EXISTS` → 409, `TOO_LARGE` → 413, `IO_ERROR`/`PICKER_FAILED` → 500, `NOT_SUPPORTED` → 501.

| Method | Path | Query / body | 200 response |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| GET | `/api/dirs` | `?path=<abs>` (omitted → `$HOME`) | `DirsResponse` — child dirs only, no dotdirs, sorted case-insensitive; `parent` null at `/` |
| GET | `/api/tree` | `?root=<abs>` | `TreeResponse` — recursive; only `.md`/`.markdown` files; every dir shows, markdown or not (GRO-2022); dot-entries and `node_modules` skipped; dirs before files, each sorted case-insensitive |
| GET | `/api/file` | `?path=<abs>` | `FileResponse` — raw UTF-8 content incl. frontmatter; 413 if > 10 MiB |
| PUT | `/api/file` | JSON `FileWriteRequest { path, content, expectedMtime? }` | `FileWriteResponse { path, mtime, size }` — atomic write (`<name>.tmp-<rand>` + `rename`); parent dir must exist; if `expectedMtime` given and the disk mtime differs → 409 `FileWriteConflict` and nothing written |
| POST | `/api/create-dir` | JSON `CreateDirRequest { path }` | `CreateDirResponse { path }` — parent must exist (else 404); target exists → 409 `ALREADY_EXISTS` |
| POST | `/api/create-file` | JSON `CreateFileRequest { path }` | `CreateFileResponse { path, mtime, size }` — empty `.md`/`.markdown` only (else 400 `NOT_MARKDOWN`); `wx` write, never overwrites: exists → 409 `ALREADY_EXISTS` |
| POST | `/api/pick-folder` | – | `PickFolderResponse` — macOS only: runs `osascript` (`choose folder`, System Events activated, 5 min timeout) and blocks until the Finder dialog closes. Picked → `{ path }` (no trailing `/`); dismissed → `{ cancelled: true }`; osascript failure → 500 `PICKER_FAILED`; non-macOS → 501 `NOT_SUPPORTED` |
| GET | `/api/watch` | `?root=<abs>` | SSE stream of `WatchEvent`: `event: <type>\ndata: <json>\n\n`; first event `ready`; `: ping` comment every 25 s; chokidar with `ignoreInitial: true`, `awaitWriteFinish: { stabilityThreshold: 200 }`, ignores dot-entries and `node_modules`, only `.md`/`.markdown` file events (+ dir add/unlink) |

Notes
- Folder picking (client): "change" / first launch call `POST /api/pick-folder` first; `{ path }` → set root + push to recents, `{ cancelled }` → nothing, any failure (501 or otherwise) → the in-app `FolderPicker` modal (the `/api/dirs` browser) as fallback. One native dialog in flight at a time; the trigger button is disabled meanwhile.
- Server writes trigger `change` events on the watcher; client must ignore events for a path whose mtime equals the mtime it just received from its own PUT (echo suppression).
- Auto-save: client debounces 500 ms after last `markdownUpdated`, also flushes on file switch / window `beforeunload`. Only content that differs from the last loaded/saved markdown is saved (Crepe's first serialisation is a normalised rewrite and is never written on its own).
- Server tests run chokidar with `CHOKIDAR_USEPOLLING=1` (see `server/vitest.config.ts`): on macOS libuv starts the FSEvents stream asynchronously, so a write right after `ready` can be missed; polling makes the tests deterministic.

## Editor rules (client)

1. **Frontmatter**: on load, `splitFrontmatter(content)` → `{ frontmatter, body }`; only `body` goes into Crepe. On save, write `frontmatter + getMarkdownForSave(crepe)`. Frontmatter is re-prepended byte-identically (Crepe would otherwise turn `---` YAML into `***` + paragraph + setext heading underline).
2. **Crepe construction**: always via `createCrepe()` — features come ONLY from `src/editor/featureConfig.ts` (`ENABLED_FEATURES` / `DISABLED_FEATURES`, every `CrepeFeature` classified; ImageBlock, TopBar, AI off; `featureConfig.test.ts` asserts the running editor loads exactly the allowlist), list_item content `block+` (extended from GFM task item schema), `markdownUpdated` listener wired.
3. **Save post-processing**: `postProcessMarkdown()` un-escapes `\[\[` → `[[` (wikilinks/embeds).
4. **Replacing content in a live instance** (external change / Reload): `setMarkdown(crepe, md)` → `replaceAll(md, true)` from `@milkdown/kit/utils`, keeping focus and caret. File switch remounts the Crepe host (`key={path}`); the previous file stays on screen until the next one has loaded.
5. **Outline folding** (GRO-2011): `createOutlineFolding()` (`src/editor/outline/`) is registered in `createCrepe()`. Parent `list_item`s (those owning a nested `bullet_list`/`ordered_list`) get a widget `<button class="outline-toggle" aria-expanded>` at the start of their content; collapsing adds `data-outline-folded="true"` to EVERY nested list of the item (CSS `display:none`) — mixed markers at one indent (`* a` then `- b`) parse as sibling lists inside one `list_item` and all of them fold (GRO-2031). Toggles are metadata-only transactions (`tr.docChanged === false`) — the listener never fires `markdownUpdated`, `getMarkdownForSave()` is unchanged, and the file's mtime is untouched. Fold keys = FNV-1a hash of the item's first-block text + occurrence index (`outlineFoldKeys.ts`), persisted via `storage.getFolds/setFolds`.
6. **Accepted lossy normalisation** (standard remark-stringify behaviour; content preserved, formatting normalised): `-`/`+` bullets → `*` (alternating `-` for adjacent sibling lists), tabs → 2-space indent, `1)` ↔ `1.` ordered markers swap/renumber, setext → ATX headings, two-space hard breaks → `\`, trailing whitespace stripped, `___` → `***`, indented code → fenced, tables re-padded, lazy blockquote continuation gets `> `, `_`/`*`/`[`/`=`/`&` escaped in text where ambiguous, bare URLs/emails → `<autolink>`, file always ends with a single `\n`. First save of an untouched file WILL rewrite the file in this normalised form.
7. **Outliner keymap** (GRO-2012, `src/editor/outline/listCommands.ts`, registered in `createCrepe()` with keymap priority 100): Tab = indent (no-op on a first sibling — never inserts spaces), Shift-Tab = outdent (level 1 → paragraph; following siblings nest under the lifted item), Enter at the end of a parent item = new FIRST child (after the subtree when the parent is folded), Enter on an empty item = outdent / leave the list, Backspace at the start of an item = join into the previous paragraph (empty parent: children take its place; non-empty parent: no-op). Multi-item selection + Tab/Shift-Tab moves all selected items.
8. **Empty list items** (`src/editor/listItemRoundTrip.ts`): an empty bullet/ordered item is written as a bare marker (`*` / `1.`), never `* <br />` — `<br />` opens a CommonMark HTML block that swallows the item's nested children on reload. Parsing gives an item whose nested list starts on a later line (`* ` + children, Obsidian's empty parent) an empty leading paragraph; `* 1) text` on one line stays a list-first item. Before parsing, `normalizeEmptyItems()` rewrites legacy `* <br />` lines to bare markers and an empty task `* [ ] ` / `* [x]` to `* [ ] <br />` (remark alone reads `[ ]` as text and would write `* \[ ]`); on save `stripEmptyTaskBreaks()` writes it back as `* [ ]` — `<br />` never reaches the disk.

9. **Depth bullet glyphs** (GRO-2013, `src/editor/outline/bullets.css`): CSS only — Crepe's bullet svg is hidden and `.label.bullet::after` draws ● / ○ / ■ by nesting depth of `.milkdown-list-item-block` (repeating every three levels; ordered levels count), `--list-indent: 2.15em`, marker colour 78% of the text colour, all from Crepe theme tokens. Heading-first items (`* # Part 1`) offset the label row by the heading's margin and size it to the heading's line box (`--list-label-offset/height`, shared with the fold chevron). Markdown untouched.
10. **Typography** (GRO-2009, `src/app.css`): Obsidian defaults — system font stack, 16px / 1.5 body, heading scale 1.802 / 1.602 / 1.424 / 1.266 / 1.125 / 1em at weight 600 (h1 700), line-height 1.3 — set through Crepe's `--crepe-font-*` / `--crepe-base-font-size` custom properties on `.editor-instance .milkdown`.

11. **Underline** (GRO-2028, `src/editor/marks/underline.ts`): ProseMirror mark `underline` (`<u>` in the DOM). On disk it is obsidian-underline's inline HTML `<u>text</u>`: a `$remark` plugin wraps each mdast `html("<u>")` … `html("</u>")` pair (nearest match, any depth, inside any inline parent such as `**…**`) into an `underline` mdast node after parsing, and registers the remark-stringify handler that writes it back as `<u>` + children + `</u>` — so `a <u>b</u> c` round-trips byte-identically. Unmatched tags and every other inline HTML keep going through Milkdown's `html` atom node unchanged. Not a Crepe feature (allowlist untouched, no toolbar button).

12. **Zoom into a bullet** (GRO-2029, `src/editor/outline/zoom.ts` + `zoom.css`): view state ONLY, like folding — the plugin holds the zoomed `list_item` position (mapped through every transaction; cleared if the item is deleted), and decorations hide every block off the path root → zoomed item (`outline-zoom-hidden`), strip the ancestors' glyph/chevron/first block (`outline-zoom-ancestor`, a folded ancestor renders expanded without touching fold state) and render a breadcrumb widget (`File name › Ancestor › … › Item`, labels = first-block text truncated at 40 chars; crumbs zoom to that ancestor, the file crumb zooms out fully). Triggers: click the bullet glyph (`.label-wrapper`; task checkboxes keep toggling), `Mod-.`, `Mod-Shift-.` (see Keyboard). Zooming dispatches a metadata-only transaction: never `markdownUpdated`, disk untouched, fold state unaffected. Not persisted — switching files remounts the editor and clears it, and an external file change (watcher → `replaceAll`) replaces the doc and clears it too. `createCrepe({ zoom: { fileName } })`; allowlist untouched.

13. **List guide lines** (GRO-2030, `src/editor/outline/guideLines.ts` + `.css`): every nested list (`li.list-item > .children > .content-dom > ul/ol`) gets a CSS `::before` strip — 10px wide, absolutely positioned (`-1 * (--list-indent / 2 + 10px)`) so its centred 1px line runs under the parent's glyph centre; zero layout shift, folded lists take their line with them, colours from `currentColor` (14%, hover 35%). Pseudo boxes hit-test as the list element, so a pointer left of the list's border box = the strip: the plugin's `handleDOMEvents` turns mousedown into `toggleOutlineFold(itemPos)` (the GRO-2011 meta transaction — markdown/mtime untouched, caret unmoved) and mousemove into the `outline-guide-hover` highlight (element `:hover` would light up while editing text inside).

## Keyboard (client)

All bindings are `$shortcut` keymaps registered in `createCrepe()` with priority 100 (Crepe's own keymaps are 50), so they run first and fall through (`return false`) when they do not apply. `Mod` = ⌘ on macOS, Ctrl elsewhere (ProseMirror decides by `navigator.platform`).

| Keys | Where | Does | Source |
|---|---|---|---|
| `Tab` | caret/selection in list items | indent (sink) the item(s); no-op on a first sibling — never inserts spaces | GRO-2012 `listCommands.ts` |
| `Shift-Tab` | list items | outdent (lift); level 1 → paragraph; following siblings nest under the lifted item | GRO-2012 (Crepe default, kept) |
| `Enter` | end of a parent item | new FIRST child (after the folded subtree when the parent is collapsed) | GRO-2012 |
| `Enter` | empty item (no children) | outdent; at level 1 leaves the list as a paragraph | GRO-2012 |
| `Backspace` | start of an item's first block | join into the previous paragraph / parent item; empty parent: children take its place; non-empty parent: no-op | GRO-2012 |
| `Mod-Enter` | list item(s) whose first block touches the selection | cycle bullet → `[ ]` → `[x]` → bullet, each item from its own state; outside lists falls through (table exit / CodeMirror exit keep theirs) | GRO-2027 `hotkeys.ts` |
| `Mod-Shift-u` | anywhere | fold every parent item (`foldAllOutline`, meta-only transaction, persisted via `mdapp.folds`) | GRO-2027 |
| `Mod-Shift-i` | anywhere | unfold all (`unfoldAllOutline`) | GRO-2027 |
| `Mod-Shift-x` | selection | toggle strikethrough (Obsidian binding; Crepe's `Mod-Alt-x` still works) | GRO-2027 |
| `Mod-u` | selection | toggle underline (`<u>…</u>` on disk) | GRO-2028 `marks/underline.ts` |
| `Mod-.` | caret in a list item | zoom into that item (view-only; breadcrumbs appear); outside lists falls through | GRO-2029 `outline/zoom.ts` |
| `Mod-Shift-.` | while zoomed | zoom out one level (parent item, or fully at top level); not zoomed falls through | GRO-2029 |
| `Shift-Tab` / `Mod-[` | while zoomed, on the zoomed item or a direct child | no-op (lifting would escape the zoomed subtree); everywhere else outdents as usual | GRO-2029 |

## localStorage (client)

| Key | Type | Shape |
|---|---|---|
| `mdapp.root` | string | `"/Users/yasin/notes"` |
| `mdapp.recentRoots` | `RecentRoots` | `[{ "path": "/Users/yasin/notes", "lastOpened": 1755600000000 }]` — most recent first, max 10, de-duped |
| `mdapp.expanded` | `ExpandedState` | `{ "/Users/yasin/notes": ["/Users/yasin/notes/sub", ...] }` |
| `mdapp.lastFile` | `LastFileState` | `{ "/Users/yasin/notes": "/Users/yasin/notes/a.md" }` |
| `mdapp.folds` | `FoldState` | `{ "/Users/yasin/notes": { "/Users/yasin/notes/a.md": ["1fpm2d0:0", ...] } }` — collapsed outline fold keys per root + file (max 500/file; empty lists removed). Never written to disk. |

All JSON values parsed defensively (invalid → treated as absent).
