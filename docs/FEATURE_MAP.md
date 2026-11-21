# Yaseen Docs Feature Map

Compact architectural index mapping each major subsystem to its entry files, hot paths, guardrails, and verification commands. Keep this file under 15 KB and update it when moving subsystem boundaries.

## 1. Monorepo Layout & Layer Boundaries

- `shared/` — Pure TypeScript domain logic shared by desktop, client, and mobile (wikilinks, IDs, frontmatter, index records, reviews, tables, keys). **Zero React, Electron, or Node imports** (enforced by `tools/archRules.test.mjs`).
- `desktop/src/main/` — Electron main process, filesystem, vault watcher, vault index, git sync, IPC bridge, updater, share publisher. **Zero React/client/mobile imports.**
- `desktop/src/preload/` — Context-isolated `window.mdapp` IPC bridge (`desktop/src/contract.test.ts` + `surface.test.ts`).
- `client/src/` — Desktop renderer (React 19 + Milkdown Crepe / ProseMirror + CodeMirror / Monaco + Excalidraw + draw.io). **Zero Electron/Node imports.**
- `mobile/src/` — Standalone Phone PWA (Cloudflare Workers + IndexedDB + GitHub sync + offline Service Worker). **Zero desktop/editor imports** (`mobile/src/bundleWalls.test.ts`).
- `engine/` — Vendored Excalidraw drawing engine packages (`npm run engine:build`).
- `tools/` — Packaging, draw.io/share-viewer builders, perf budgets & benchmarks, and enforceable architecture tests.

## 2. Core Subsystems

### Editor, Outliner & Long-Doc Typing (`YAZ-4093`, `YAZ-6028`)
- **Entry:** `client/src/editor/Editor.tsx`, `client/src/editor/createCrepe.ts`
- **Autosave & serialization:** `client/src/lib/autosave.ts`, `client/src/hooks/useAutosave.ts`.
  - Invariant: Opening a page runs **0** full-doc Markdown serializations (`listener` plugin removed; lazy `getBaseline` captures immutable `ProseNode`; `docMarkdownCache` caches per-editor `ProseNode -> string`).
- **Per-keystroke hot paths (must stay O(1) or O(depth) on `typingOnly`):**
  - `client/src/editor/table/tableCalendar.ts` — `CalendarClock.update()` exits early when `tables.length === 0`.
  - `client/src/editor/table/tableStyle.ts` — exports `typingOnly(tr)` shared across editor plugins.
  - `client/src/editor/table/tableFill.ts` — maps fill handle on inline typing in the same cell.
  - `client/src/editor/outline/outlineFolding.ts` — per-`list_item` `WeakMap` cache + single-chevron rename carry.
  - `client/src/editor/outline/headingFolding.ts` — maps entries on `typingOutsideHeading(tr)` + single-chevron carry.
  - `client/src/editor/outline/bulletThreading.ts` — plugin-state cached `DecorationSet`, mapped on inline typing.
  - `client/src/editor/outline/zoom.ts` — `crumbsKey`-cached zoomed `DecorationSet`.
  - `client/src/editor/outline/sectionIndent.ts` — `SectionSet` fast constructor; hover avoids `posAtDOM`.
  - `client/src/editor/lineSelection.ts` — `liftHeadlessItems` skips `typingOnly(tr)` and textblocks.
  - `client/src/editor/pathPaste.ts` — checks inserted slice for link marks before scanning parent.
  - `client/src/editor/toc/tocChannel.ts`, `client/src/editor/toc/tocPlugin.ts` — pauses scans via `setEnabled(false)` when TOC is Off.
  - `client/src/editor/blockHandleGate.ts` — latest pointer rAF + skips hidden tabs (`.tabstack__layer--hidden, [hidden]`).

### Vault Filesystem, Watcher & Indexing (`YAZ-6027`)
- **Filesystem & tree:** `desktop/src/main/fs/fsUtils.ts` (`TREE_CONCURRENCY = 32`), `desktop/src/main/fs/treeWatcher.ts` (`children` map for O(subtree) `syncChildren`/`forget`, 32-way bounded-parallel walks, probe cleanup on exit), `desktop/src/main/fs/boardDocument.ts` (`mutateBoardFile`).
- **Vault index:** `desktop/src/main/vaultIndex/live.ts` (version-keyed `snapshot` cache, `formerByCurrent` reverse index), `desktop/src/main/vaultIndex/reconcile.ts` (**keep `statSync` intact per GRO-2229 benchmark**), `desktop/src/main/vaultIndex/cache.ts`, `desktop/src/main/vaultIndex/idSweep.ts` (marker stat short-circuit), `desktop/src/main/vaultIndex/diary.ts` (pre-merged binary-search intervals), `shared/indexRecord.ts` (single-pass `maskCode` + `WIKILINK_RE`).
- **Renderer feeds:** `client/src/lib/treeFeed.ts`, `client/src/lib/indexFeed.ts`, `client/src/views/useIndex.ts`, `client/src/search/useSearchResults.ts`.
- **Vault config:** `desktop/src/main/vaultConfig.ts` (serialized per-file write chains).

### Desktop Shell, Lazy Chunks & Folder Views (`YAZ-6026`, `YAZ-6028`)
- **App shell:** `client/src/App.tsx`, `client/src/sidebar/Sidebar.tsx`, `client/src/sidebar/IconPicker.tsx` (`memo(IconPickerGrid)`).
- **Lazy-only chunks (enforced by `tools/clientFirstLoad.test.mjs`):** `SettingsDialog`, `KeySheet`, `RecentList`, `FolderView`, `FrontmatterPanel`, `CommentsSection`, `DrawingModal`, `ImageModal`, `CodeEditor`, `CardFileView`, `CardCourse`, `ImageStudio`.
- **Folder views:** `client/src/views/view/TableView.tsx` (windowed), `ListView.tsx` & `CardsView.tsx` (progressive 150-row batches via `useProgressiveCount.ts`), `BoardView.tsx`, `CalendarView.tsx`.

### Drawings, Boards & Share Viewer (`YAZ-6026`)
- **Excalidraw & fonts:** `desktop/electron.vite.config.ts` (drops unused Xiaolai font; minifies main/cli with hidden sourcemaps to `desktop/.maps/<ver>/main`).
- **draw.io:** `tools/packDrawio.mjs`, `tools/lib/drawioPack.mjs` (prunes Fortinet stencils + CHTML MathJax; cached in CI).
- **Share viewer:** `tools/buildShareViewer.mjs` (prunes unused engine leaves via esbuild alias).

### Mobile PWA & Sync (`YAZ-6026`, `YAZ-6027`, `YAZ-6028`)
- **Entry & state:** `mobile/src/main.tsx`, `mobile/src/app/AppState.tsx` (memoized context value).
- **Storage & sync:** `mobile/src/store/vaultStore.ts` (`writeBatch`/`removeBatch`, parallel `read`, targeted `statesWith`), `mobile/src/sync/engine.ts`, `mobile/src/sync/pass.ts`, `mobile/src/sync/phoneIndex.ts` (`INDEX_RULES = 6`).
- **Review & reader:** `mobile/src/review/source.ts` (skips `makeResolver` on review-only card changes), `mobile/src/review/ReviewView.tsx` (O(1) path lookup), `mobile/src/page/PageView.tsx` + `stickyHeadings.ts` (pauses observers during progressive slicing).
- **SW & bundle walls:** `mobile/vite.config.ts` & `mobile/src/sw/swCore.ts` (drawing chunks cached on demand, not in SW install precache), `mobile/src/bundleWalls.test.ts`.

## 3. Verification & Guardrail Commands

- `npm run verify` — Fast gate (<15s): `oxlint` + `typecheck` + `archRules` + `clientFirstLoad`.
- `npm run verify -- --build` — Adds desktop build + mobile build + `perf:budget:ci`.
- `npm run verify -- --full` — Full CI/release check: `lint` + `typecheck` + `test` + `desktop:build` + `mobile:build` + `perf:budget`.
- `npm run lint` — Fast Rust linter (`oxlint -c .oxlintrc.json`, ~1s).
- `npm run perf:budget:ci` / `npm run perf:budget` — Size & integrity gate against `tools/perf/budget.json`.
- `npm run perf -- launch open-big typing storm watcher tab-switch --runs 5 --app <after> --vs <before>` — Interleaved A/B timing benchmark on isolated scratch profiles.
