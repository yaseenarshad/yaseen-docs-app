# YAZ-1289 Read-Only File Viewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved text/code/config files and PDFs visible in Files, open them in read-only tabs, and let Markdown link to them through explicit-extension wikilinks without granting them Markdown editing or semantic behavior.

**Architecture:** Extend the one shared file classifier with `markdown | text | pdf`, then split every filesystem boundary by capability in the same first change: Markdown alone is writable and semantically indexed; text is strict UTF-8 read-only; PDF uses a dedicated binary bridge. A lightweight catalog derived from the visible tree feeds a separate view-only navigation source and completion; the existing semantic `WikilinkResolveSource` and `IndexRecord[]` remain Markdown-only for Home, folder pages, Topics, backlinks, properties, and views. The existing workspace/tab, watcher, rename, and link-rewrite machinery is reused through narrow kind-aware seams.

**Tech Stack:** TypeScript 5.9, React 19, Electron 43, Vitest/jsdom, Electron IPC/contextBridge, Milkdown wikilink plugins, existing chokidar/tree/index contracts.

**Authoritative scope:** [YAZ-1289](https://linear.app/growprofit/issue/YAZ-1289/support-other-file-formats), [YAZ-1310](https://linear.app/growprofit/issue/YAZ-1310/3d-link-markdown-notes-to-supported-view-only-files), and the approved delivery contract in [YAZ-1292](https://linear.app/growprofit/issue/YAZ-1292/1b-lock-the-text-format-and-pdf-delivery-contracts#comment-996611d4).

---

## Locked decisions

- Supported view-only text extensions are the approved curated, case-insensitive allowlist: `.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.jsonc`, `.jsonl`, `.ndjson`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.xml`, `.env`, `.properties`, `.lock`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.kts`, `.c`, `.h`, `.cc`, `.cpp`, `.hpp`, `.cs`, `.swift`, `.php`, `.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.sql`, `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte`, `.graphql`, `.gql`, `.mdx`, `.rst`, and `.tex`. Unknown extensions stay hidden.
- `.md` and `.markdown` remain the only editable, creatable, autosaved, frontmatter-aware, indexed file kinds.
- Text reads retain the 10 MiB limit and reject malformed UTF-8 or NUL/binary content with a passive viewer error.
- `.pdf` uses a dedicated `readPdf` IPC returning `Uint8Array`, a 50 MiB limit, a revoked Blob URL, and Chromium's native PDF viewer with plugins enabled. No PDF.js and no base64 asset-pipe reuse.
- View-only wikilinks always include the extension. The lightweight tree catalog powers resolution and `[[` autocomplete; it never enters `IndexRecord[]`.
- Missing recognized view-only targets never call Markdown create-on-click. They remain unresolved and show a passive notice.
- View-only files have no backlinks, properties, aliases, headings/blocks, embeds, search/Topics/folder-page membership, content indexing, editor, save, or autosave.
- Rename is allowed only when old and new paths remain the same `FileKind`. Markdown references to a renamed view-only target update through the existing confirm/rewrite flow.
- Existing hidden-dot-entry and `node_modules` policies remain unchanged.

## Execution rules

- Keep YAZ-1289 In Progress throughout implementation. Before the first code edit for a leaf, move both the leaf and its phase parent to In Progress.
- When a leaf is proven and committed, comment its exact tests, commit, rationale, and gotchas, then mark it Done. Mark the phase Done only when all children and the phase acceptance condition are proven.
- For every behavior, write the specified failing test first and run it to observe a feature-specific failure before changing production code.
- Never run headed Playwright. Use focused Vitest, the full suite, typecheck, build, and the isolated Electron demo.
- If a new material design/functionality decision appears, stop and use Yasin's problem/options/recommendation/line-numbered-diff/after format before choosing.
- Do not upgrade dependencies, alter hidden-file policy, add a generic binary viewer, or broaden the Markdown index.
- Preserve unrelated user changes and use small commits at the task boundaries below.

## Planned file structure

### New focused units

- `desktop/src/main/fs/pdf.ts` — PDF-only validation, size cap, and binary read.
- `desktop/src/main/fs/pdf.test.ts` — PDF happy path and refusal matrix.
- `client/src/viewers/TextViewer.tsx` / `.test.tsx` — selectable, copyable, read-only text surface and watch reload.
- `client/src/viewers/PdfViewer.tsx` / `.test.tsx` — Blob URL lifecycle and native PDF frame.
- `client/src/viewers/viewers.css` — restrained viewer layout, overflow, error, and dark-theme behavior.
- `client/src/links/viewOnlyCatalog.ts` / `.test.ts` — flatten tree, shortest unambiguous names, exact-extension resolution, and completion candidates.
- `client/src/hooks/useViewOnlyCatalog.ts` / `.test.tsx` — initial tree snapshot plus structural watch refresh.
- `client/src/editor/wikilink/viewOnlyLinkSource.ts` / `.test.ts` — navigation-only resolver/readiness/catalog feed that semantic consumers never receive.

### Existing owners extended

- `shared/types.ts`, `shared/fileKind.ts` — approved kinds, extension lists, response types, and API contract.
- `desktop/src/main/fs/fsUtils.ts`, `file.ts`, `create.ts`, `rename.ts`, `tree.ts`, `watchers.ts` — capability guards and supported-file behavior.
- `desktop/src/channels.ts`, `desktop/src/main/ipc/fs.ts`, `desktop/src/preload/index.ts`, `client/src/api.ts` — PDF bridge wiring.
- `desktop/src/main/index.ts`, `desktop/src/main/windows.ts` — native PDF plugin and supported deep-link routing.
- `client/src/editor/Editor.tsx` — kind dispatch before Milkdown mounts.
- `client/src/editor/wikilink/WikilinkIndexBridge.tsx`, `wikilinkPlugin.ts`, `wikilinkClick.ts`, `wikilinkPicker.ts` — composed resolver/catalog and safe missing-target behavior.
- `client/src/links/completion.ts`, `client/src/links/renameLinks.ts`, `client/src/App.tsx` — view-only candidates and target-aware rename updates.
- `client/src/sidebar/Sidebar.tsx` — explicit-extension Copy link and correct file-vs-directory rename classification.
- `docs/CONTRACTS.md` — durable viewability/writability/indexing/linking contract.

---

## Task 1: Classify, capability-gate, and discover approved files atomically (YAZ-1295 + YAZ-1297 part 1)

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/fileKind.ts`
- Modify: `desktop/src/main/fs/fsUtils.ts`
- Modify: `desktop/src/main/fs/file.ts`
- Modify: `desktop/src/main/fs/create.ts`
- Modify: `desktop/src/main/fs/rename.ts`
- Test: `desktop/src/main/fs/fileKind.test.ts`
- Test: `desktop/src/main/fs/file.test.ts`
- Test: `desktop/src/main/fs/create.test.ts`
- Test: `desktop/src/main/fs/rename.test.ts`
- Test: `desktop/src/main/fs/tree.test.ts`
- Test: `desktop/src/main/fs/watchers.test.ts`
- Test: `desktop/src/main/fs/viewsFixture.test.ts`

- [ ] **Step 1: Move YAZ-1294, YAZ-1295, and YAZ-1297 to In Progress; comment branch and baseline**

Record branch `codex/yaz-1289-file-viewers`, baseline commit `5ccd0d18d39af006f793340a9cc04329b368185e`, and the 2,771-test green baseline.

- [ ] **Step 2: Write failing classifier and discovery tests**

Cover `.md/.markdown → markdown`, every approved text extension → `text`, `.pdf → pdf`, mixed case, leading-dot-only names, extensionless files, compound unknown suffixes, and arbitrary binaries → `null`.

Assert that JSON/Python/PDF nodes appear with their exact kind and ordinary binaries remain absent. Assert add/change/unlink watcher events for text/PDF, while dot entries and unknown formats remain ignored. Update the existing fixture expectation without broadening its Markdown index.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run desktop/src/main/fs/fileKind.test.ts desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/fs/viewsFixture.test.ts
```

Expected: failures because `FileKind` and the classifier are still Markdown-only.

- [ ] **Step 4: Expand the classifier, then immediately observe the mutation-gate reds**

Add `TEXT_VIEW_EXTENSIONS`, `PDF_EXTENSIONS`, `FileKind = 'markdown' | 'text' | 'pdf'`, and pure shared helpers such as `isMarkdown`, `isReadableText`, `isViewOnly`, and `isSupportedFile`. Before changing guards, run the mutation suites and observe the expected safety failures caused by their old `fileKind() !== null` assumption:

```bash
npx vitest run desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.test.ts desktop/src/main/fs/rename.test.ts
```

Expected: view-only paths incorrectly pass at least one old generic gate. Do not commit or leave this transient local state unattended.

- [ ] **Step 5: Split capabilities and complete discovery**

Replace generic `requireVaultFile`/non-null mutation checks with truthful boundaries: supported discovery, Markdown-or-text read, Markdown-only write/create, and same-kind rename/repair. At this task boundary, `readFile` still serves Markdown only until Task 2 explicitly adds strict text decoding; tree/watch may discover every supported kind. Preserve hidden-entry, ordering, metadata, and Markdown-index behavior.

- [ ] **Step 6: Prove no capability leak**

Add/extend assertions that `writeFile` and `createFile` reject JSON/Python/PDF, and rename never crosses `FileKind`. Existing bytes must remain unchanged after every refusal.

- [ ] **Step 7: Run focused tests, typecheck, and commit**

```bash
npx vitest run desktop/src/main/fs/fileKind.test.ts desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.test.ts desktop/src/main/fs/rename.test.ts desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/fs/viewsFixture.test.ts
npm run typecheck
git add shared/types.ts shared/fileKind.ts desktop/src/main/fs/fsUtils.ts desktop/src/main/fs/file.ts desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.ts desktop/src/main/fs/create.test.ts desktop/src/main/fs/rename.ts desktop/src/main/fs/rename.test.ts desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/fs/viewsFixture.test.ts
git commit -m "feat: discover supported read-only files"
```

Comment the atomic capability-separation rationale and evidence on YAZ-1295/YAZ-1297. Mark YAZ-1295 Done; keep YAZ-1297 and YAZ-1294 In Progress.

---

## Task 2: Split text reads from Markdown writes (YAZ-1296, part 1)

**Files:**
- Modify: `desktop/src/main/fs/fsUtils.ts`
- Modify: `desktop/src/main/fs/file.ts`
- Test: `desktop/src/main/fs/file.test.ts`
- Test: `desktop/src/main/fs/create.test.ts`

- [ ] **Step 1: Confirm YAZ-1294 is In Progress, move YAZ-1296 to In Progress, and comment the transport baseline**

- [ ] **Step 2: Write failing read/write capability tests**

Assert that valid JSON/Python/text reads return byte-accurate UTF-8 text, including Unicode, CRLF, and a UTF-8 BOM preserved with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`. Assert malformed UTF-8 and content containing NUL fail without returning replacement characters. Assert text above 10 MiB fails `TOO_LARGE`.

Assert `writeFile` and `createFile` still reject every `text` and `pdf` path, including when the target already exists. The original file bytes must remain unchanged.

Add a Markdown regression whose malformed bytes retain the existing Node `fsReadFile(path, 'utf8')` replacement-character behavior. Strict decoding is a view-only-text rule, not an unapproved Markdown behavior change.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.test.ts
```

- [ ] **Step 4: Implement separate read/write guards**

`readFile` admits only `markdown | text`. Markdown keeps its existing `fsReadFile(path, 'utf8')` behavior. Text reads bytes, enforces 10 MiB, decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, and rejects NUL content. `writeFile` and `createFile` remain Markdown-only. Use a truthful bridge error/message without inventing a content editor path.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npx vitest run desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.test.ts
npm run typecheck
```

Do not commit until Task 3 completes the same transport issue.

---

## Task 3: Add the PDF-only binary bridge (YAZ-1296, part 2)

**Files:**
- Modify: `shared/types.ts`
- Add: `desktop/src/main/fs/pdf.ts`
- Add: `desktop/src/main/fs/pdf.test.ts`
- Modify: `desktop/src/channels.ts`
- Modify: `desktop/src/main/ipc/fs.ts`
- Modify: `desktop/src/preload/index.ts`
- Test: `desktop/src/preload/bridge.test.ts`
- Modify: `client/src/api.ts`
- Modify tests: `client/src/api.test.ts`, relevant IPC/preload contract tests
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Write failing PDF boundary tests**

Cover a valid PDF byte round trip, mixed-case `.PDF`, wrong extension, directory path, missing/relative path, exact 50 MiB acceptance, over-limit refusal, and no base64 conversion.

- [ ] **Step 2: Write failing bridge-surface tests**

Pin `fs:read-pdf`, `YaseenDocsApi.readPdf`, preload forwarding, client error wrapping, and `Uint8Array` preservation. Assert `readFile(.pdf)` is refused so binary never enters the text path.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run desktop/src/main/fs/pdf.test.ts desktop/src/main/ipc/fs.test.ts desktop/src/preload/bridge.test.ts client/src/api.test.ts
```

- [ ] **Step 4: Implement the narrow bridge**

Add `MAX_PDF_BYTES`, `PdfResponse`, `readPdf`, channel, handler, preload method, and client wrapper. Enable `plugins: true` while retaining `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

- [ ] **Step 5: Prove semantic isolation**

Run the index/scan tests with a fixture containing JSON/PDF and assert `IndexRecord[]` remains Markdown-only.

- [ ] **Step 6: Run tests, typecheck, and commit**

```bash
npx vitest run desktop/src/main/fs/file.test.ts desktop/src/main/fs/create.test.ts desktop/src/main/fs/pdf.test.ts desktop/src/main/ipc/fs.test.ts desktop/src/preload/bridge.test.ts client/src/api.test.ts desktop/src/main/vaultIndex
npm run typecheck
git add shared/types.ts desktop/src/channels.ts desktop/src/main/fs/pdf.ts desktop/src/main/fs/pdf.test.ts desktop/src/main/ipc/fs.ts desktop/src/main/ipc/fs.test.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/preload/bridge.test.ts client/src/api.ts client/src/api.test.ts
git commit -m "feat: add safe read-only file transport"
```

Comment strict-decode, binary-separation, size-limit, and plugin-security rationale on YAZ-1296; mark it Done.

---

## Task 4: Make file operations and deep links kind-aware (YAZ-1297)

**Files:**
- Modify: `desktop/src/main/fs/rename.ts`
- Test: `desktop/src/main/fs/rename.test.ts`
- Modify: `desktop/src/main/windows.ts`
- Test: `desktop/src/main/windows.test.ts`
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`
- Verify: `desktop/src/main/fs/remove.test.ts`, `reveal.test.ts`, `openInVsCode.test.ts`

- [ ] **Step 1: Confirm YAZ-1294 and YAZ-1297 remain In Progress; comment Task 1's partial evidence**

- [ ] **Step 2: Complete rename/repair behavior tests**

Allow same-kind text→text and PDF→PDF rename/move, including case-only names. Reject markdown↔text, text↔pdf, or recognized→unknown extension transitions before disk mutation. Mirror the same-kind rule in external-rename repair.

- [ ] **Step 3: Write failing deep-link tests**

`routeToFile` must open any supported kind and continue refusing unknown, missing, and directory targets with passive notices. Update notice wording from “not a markdown file” to “unsupported file type.”

- [ ] **Step 4: Write failing client file-vs-directory test**

Pin that a view-only file absent from `IndexRecord[]` is still classified as a file for rename confirmation/reference counting; do not infer kind from the semantic index.

- [ ] **Step 5: Run focused tests and observe red**

```bash
npx vitest run desktop/src/main/fs/rename.test.ts desktop/src/main/windows.test.ts client/src/App.test.tsx
```

- [ ] **Step 6: Implement remaining kind-aware operations**

Use `fileKind(oldPath)` and `fileKind(newPath)` exactly once at each rename boundary. Keep delete/reveal/VS Code behavior unchanged. Repair App's file/directory inference without adding view-only records to the index.

- [ ] **Step 7: Run tests, typecheck, and commit**

```bash
npx vitest run desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/fs/viewsFixture.test.ts desktop/src/main/fs/rename.test.ts desktop/src/main/windows.test.ts desktop/src/main/fs/remove.test.ts desktop/src/main/fs/reveal.test.ts desktop/src/main/fs/openInVsCode.test.ts client/src/App.test.tsx
npm run typecheck
git add desktop/src/main/fs/rename.ts desktop/src/main/fs/rename.test.ts desktop/src/main/windows.ts desktop/src/main/windows.test.ts client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: support view-only file operations"
```

Comment and mark YAZ-1297 Done. Run the phase-focused suite, comment the phase receipt, and mark YAZ-1294 Done.

---

## Task 5: Build the read-only text viewer (YAZ-1299)

**Files:**
- Refactor: `client/src/editor/Editor.tsx`
- Add: `client/src/viewers/TextViewer.tsx`
- Add: `client/src/viewers/TextViewer.test.tsx`
- Add: `client/src/viewers/viewers.css`
- Modify: `client/src/hooks/useFile.ts`
- Add: `client/src/hooks/useFile.test.tsx`
- Modify: `client/src/editor/Editor.test.tsx`

- [ ] **Step 1: Move YAZ-1298 and YAZ-1299 to In Progress**

- [ ] **Step 2: Write failing viewer/dispatch tests**

Pin selectable monospaced text, exact whitespace/CRLF rendering, horizontal and vertical overflow, a concise read-only label, loading/error states, mixed-case extensions, and watch-driven reload. Assert no Crepe, autosave, frontmatter, backlinks, folder-page migration, title rename editor, or write call mounts for a text path.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run client/src/viewers/TextViewer.test.tsx client/src/hooks/useFile.test.tsx client/src/editor/Editor.test.tsx
```

- [ ] **Step 4: Split kind dispatch before Milkdown ownership**

Keep the current Markdown editor behavior in a Markdown-only component. The top-level `Editor` classifies `path`: `text` mounts `TextViewer`, `markdown` mounts the existing Markdown owner, and `pdf` mounts a passive “PDF viewer loading support…” branch that calls neither text nor Markdown hooks. Task 6 replaces only that safe PDF skeleton with the completed `PdfViewer`; there is never an intermediate commit where PDF bytes reach `useFile` or `CrepeHost`.

- [ ] **Step 5: Implement text viewer reload and copy semantics**

Use the existing text bridge, refresh only on matching `change` events, preserve the previous content during reload, and show passive errors. Native text selection/keyboard copy must work; if a Copy-all control is included, it uses `navigator.clipboard` and concise feedback without a modal.

- [ ] **Step 6: Run tests, typecheck, and commit**

```bash
npx vitest run client/src/viewers/TextViewer.test.tsx client/src/hooks/useFile.test.tsx client/src/editor/Editor.test.tsx
npm run typecheck
git add client/src/editor/Editor.tsx client/src/editor/Editor.test.tsx client/src/hooks client/src/viewers
git commit -m "feat: add read-only text viewer"
```

Comment evidence and mark YAZ-1299 Done.

---

## Task 6: Build the in-app PDF viewer (YAZ-1300)

**Files:**
- Add: `client/src/viewers/PdfViewer.tsx`
- Add: `client/src/viewers/PdfViewer.test.tsx`
- Modify: `client/src/viewers/viewers.css`
- Modify: `client/src/editor/Editor.tsx`
- Modify: `client/src/editor/Editor.test.tsx`

- [ ] **Step 1: Move YAZ-1300 to In Progress**

- [ ] **Step 2: Write failing Blob lifecycle tests**

Mock `api.readPdf`, `URL.createObjectURL`, and `URL.revokeObjectURL`. Assert `application/pdf` Blob creation, native frame title, loading/error states, watch-driven refresh, stale-load cancellation, exactly-once revocation on replacement/unmount, and no text/Markdown bridge call.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run client/src/viewers/PdfViewer.test.tsx client/src/editor/Editor.test.tsx
```

- [ ] **Step 4: Implement the native viewer shell**

Render the Blob URL in a full-height `iframe`/`embed` owned by the PDF component. Keep controls native, revoke every URL, and do not add editing, annotation, custom pagination, or PDF.js.

- [ ] **Step 5: Run tests, typecheck, build, and commit**

```bash
npx vitest run client/src/viewers/PdfViewer.test.tsx client/src/editor/Editor.test.tsx
npm run typecheck
npm run build
git add client/src/viewers client/src/editor/Editor.tsx client/src/editor/Editor.test.tsx
git commit -m "feat: add in-app PDF viewer"
```

Comment evidence and mark YAZ-1300 Done.

---

## Task 7: Finish tabs, sidebar menus, and read-only routing (YAZ-1301)

**Files:**
- Modify: `client/src/sidebar/Sidebar.tsx`
- Test: `client/src/sidebar/Sidebar.test.tsx`
- Modify: `client/src/sidebar/ContextMenu.tsx` only if presentation gating requires it
- Test: `client/src/sidebar/ContextMenu.test.tsx`
- Modify/test: `client/src/tabs/TabBar.tsx`, `client/src/App.tsx`, `client/src/lib/paths.ts` as required by existing labels

- [ ] **Step 1: Move YAZ-1301 to In Progress**

- [ ] **Step 2: Write failing integration tests**

Pin current-tab, background-tab, tab restore, duplicate prevention, title/extension display, tree selection, reveal, delete, same-kind rename, and open-in-new-window behavior for text/PDF. Assert Markdown-only folder-page/menu actions never appear for view-only rows.

- [ ] **Step 3: Run focused tests and observe red**

```bash
npx vitest run client/src/sidebar/Sidebar.test.tsx client/src/sidebar/ContextMenu.test.tsx client/src/tabs client/src/App.test.tsx
```

- [ ] **Step 4: Implement only the missing capability gates**

Reuse the existing workspace and menu operations. Do not add a second tab model or a view-only context-menu framework. Hide view-only Copy link until Task 8 supplies the approved catalog spelling; never emit a Markdown-derived or malformed link as an intermediate behavior.

- [ ] **Step 5: Run tests, typecheck, and commit**

```bash
npx vitest run client/src/sidebar/Sidebar.test.tsx client/src/sidebar/ContextMenu.test.tsx client/src/tabs client/src/App.test.tsx
npm run typecheck
git add client/src/sidebar client/src/tabs client/src/App.tsx client/src/App.test.tsx client/src/lib
git commit -m "feat: route read-only files through tabs and menus"
```

Comment routing/gating evidence but keep YAZ-1301 In Progress until Task 8 proves and enables its approved Copy link behavior.

---

## Task 8: Add lightweight catalog, autocomplete, and navigation-only links (YAZ-1310)

**Files:**
- Add: `client/src/links/viewOnlyCatalog.ts`
- Add: `client/src/links/viewOnlyCatalog.test.ts`
- Add: `client/src/hooks/useViewOnlyCatalog.ts`
- Add: `client/src/hooks/useViewOnlyCatalog.test.tsx`
- Add: `client/src/editor/wikilink/viewOnlyLinkSource.ts`
- Add: `client/src/editor/wikilink/viewOnlyLinkSource.test.ts`
- Modify: `client/src/editor/wikilink/WikilinkIndexBridge.tsx`
- Test: `client/src/editor/wikilink/WikilinkIndexBridge.test.tsx`
- Modify: `client/src/editor/Editor.tsx`
- Test: `client/src/editor/Editor.test.tsx`
- Modify: `client/src/editor/createCrepe.ts`
- Add: `client/src/editor/createCrepe.test.ts`
- Modify: `client/src/editor/wikilink/wikilinkClick.ts`
- Test: `client/src/editor/wikilink/wikilinkClick.test.ts`
- Modify/test: `client/src/links/completion.ts`, `client/src/editor/wikilink/wikilinkPicker.test.ts`
- Modify/test: `client/src/links/renameLinks.ts`, `client/src/links/renameLinks.test.ts`
- Modify/test: `client/src/App.tsx`, `client/src/App.test.tsx`
- Modify/test: `client/src/sidebar/Sidebar.tsx`, `client/src/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Move YAZ-1310 to In Progress**

- [ ] **Step 2: Write failing catalog tests**

Flatten only `text | pdf` tree nodes into `{ path, name, kind }`. Resolve exact root-relative paths and case-insensitive basenames; duplicates use the shallowest deterministic winner while completion inserts the shortest unambiguous root-relative spelling. Markdown-name collisions lose to an explicit recognized non-Markdown extension.

- [ ] **Step 3: Write failing separate-source and autocomplete tests**

Create a dedicated navigation-only source carrying catalog readiness, resolver, targets, and subscriptions. Feed candidates as explicit-extension rows beside existing Markdown candidates. Assert the existing semantic `WikilinkResolveSource.resolve` and `.records` remain byte-for-byte/identity equivalent to the Markdown index feed: Home, folder pages, Topics, backlinks, properties, and views must receive no view-only resolver or target.

The Milkdown decoration and click plugins may consult the new source only when the raw target has a recognized view-only extension. Markdown targets continue through the semantic source. A view-only target containing a heading/block suffix remains unresolved; a `|display text` suffix may change display text but grants no alias semantics. If a Markdown completion collides with an explicit view-only filename such as `data.json`, suppress the unusable Markdown candidate because the locked resolver rule gives that exact spelling to the view-only file.

Pin sidebar Copy link at the same catalog boundary: explicit extension, shortest unambiguous root-relative spelling, and unchanged Markdown spelling.

- [ ] **Step 4: Write failing click tests**

Pin plain and ⌘ navigation for JSON/Python/PDF, `Outbound Lead Qualifier.json`, aliases in display text, mixed case, duplicate paths, target removal, and the pre-catalog-loading notice. A missing recognized view-only target must call neither `createFromLink`, `createFile`, nor `createDir`; it shows a passive not-found notice.

- [ ] **Step 5: Write failing rename-reference tests**

Use Markdown source records plus a separate pre-rename view-only catalog. Count and rewrite explicit-extension body/frontmatter links to a renamed/moved supported file, preserve aliases/suffixes/code masks, and keep the target outside `IndexRecord[]`. Fix App's confirm count without treating the target as a directory.

- [ ] **Step 6: Run focused tests and observe red**

```bash
npx vitest run client/src/links/viewOnlyCatalog.test.ts client/src/hooks/useViewOnlyCatalog.test.tsx client/src/editor/wikilink/viewOnlyLinkSource.test.ts client/src/editor/wikilink/WikilinkIndexBridge.test.tsx client/src/editor/Editor.test.tsx client/src/editor/createCrepe.test.ts client/src/editor/wikilink/wikilinkPlugin.test.ts client/src/editor/wikilink/wikilinkClick.test.ts client/src/editor/wikilink/wikilinkPicker.test.ts client/src/links/renameLinks.test.ts client/src/App.test.tsx client/src/sidebar/ensureHome.test.ts client/src/views/FolderPageContents.test.tsx client/src/sidebar/TopicsTree.test.tsx client/src/links/BacklinksSection.test.tsx
```

- [ ] **Step 7: Implement catalog and composition**

The catalog hook reads `api.tree(root)` initially and refreshes only for structural supported-file watch events. The bridge updates the semantic source from the Markdown index exactly as before, updates the separate view-only source from the tree catalog, and merges only the two completion lists. Reuse existing candidate matching/ranking; do not fork the picker UI.

- [ ] **Step 8: Implement safe click and rename integration**

Recognized non-Markdown extensions form a no-create branch. Thread the lightweight snapshot into reference counting/rewriting; source notes are still only Markdown records and writes still go only through Markdown `writeFile`.

- [ ] **Step 9: Run tests, typecheck, and commit**

```bash
npx vitest run client/src/links/viewOnlyCatalog.test.ts client/src/hooks/useViewOnlyCatalog.test.tsx client/src/editor/wikilink/viewOnlyLinkSource.test.ts client/src/editor/wikilink/WikilinkIndexBridge.test.tsx client/src/editor/Editor.test.tsx client/src/editor/createCrepe.test.ts client/src/editor/wikilink/wikilinkPlugin.test.ts client/src/editor/wikilink/wikilinkClick.test.ts client/src/editor/wikilink/wikilinkPicker.test.ts client/src/links/renameLinks.test.ts client/src/App.test.tsx client/src/sidebar/ensureHome.test.ts client/src/views/FolderPageContents.test.tsx client/src/sidebar/TopicsTree.test.tsx client/src/links/BacklinksSection.test.tsx client/src/links/backlinks.test.ts client/src/links/completion.test.ts
npm run typecheck
git add client/src/links client/src/hooks/useViewOnlyCatalog* client/src/editor/wikilink client/src/editor/Editor.tsx client/src/editor/Editor.test.tsx client/src/editor/createCrepe.ts client/src/editor/createCrepe.test.ts client/src/sidebar/Sidebar.tsx client/src/sidebar/Sidebar.test.tsx client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: link Markdown to view-only files"
```

Comment exact autocomplete/navigation/Copy-link/semantic-isolation evidence and mark YAZ-1310 and YAZ-1301 Done. Run the phase-focused suite, comment the phase receipt, and mark YAZ-1298 Done.

---

## Task 9: Automated regression and contract evidence (YAZ-1303)

**Files:**
- Modify: `docs/CONTRACTS.md`
- Add or extend focused integration tests only where Tasks 1–8 reveal an uncovered cross-boundary invariant

- [ ] **Step 1: Move YAZ-1302 and YAZ-1303 to In Progress**

- [ ] **Step 2: Audit the acceptance matrix against tests**

Map each explicit requirement to a named test: visibility, viewer dispatch, read-only refusal, PDF byte path/cleanup, watcher behavior, tabs, autocomplete, clicks, missing target, rename rewrite, semantic isolation, unknown/hidden files, oversize/invalid content, and Markdown regressions.

- [ ] **Step 3: Add only missing end-to-end unit/integration coverage**

Avoid duplicating assertions already proven by focused suites. Add an integration fixture containing Markdown, JSON, Python, PDF, duplicate names, mixed case, hidden, binary, invalid UTF-8, and oversized cases if the matrix lacks one cohesive proof.

- [ ] **Step 4: Document the durable contract**

Update `docs/CONTRACTS.md` with the supported-kind table, view/read/write/index/link capabilities, size limits, failure behavior, and explicit-extension semantics.

- [ ] **Step 5: Run full automated gates and commit**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
git add docs/CONTRACTS.md client desktop shared
git commit -m "test: verify read-only file support"
```

Comment full counts/timings and contract mapping on YAZ-1303; mark it Done.

---

## Task 10: Prepare the isolated final-demo fixtures (YAZ-1304, part 1)

**Artifacts:**
- Create: `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo/`
- Create isolated profile: `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo-profile/`
- Add: focused demo Markdown, JSON/JSONC, Python, shell, TypeScript, YAML/TOML, text/CSV, PDF, duplicate-name, mixed-case, Unicode/space, missing-target, unknown/binary, malformed-text, and size-limit cases

- [ ] **Step 1: Move YAZ-1304 to In Progress**

- [ ] **Step 2: Build the feature-only demo vault**

Create a concise `START HERE.md` checklist whose links exercise every supported path and edge case. Generate valid small/multipage PDFs using the PDF skill. Include expected-invisible and expected-error fixtures without mixing in unrelated product features.

- [ ] **Step 3: Validate the fixture manifest without launching the user gate**

Confirm every expected-visible, expected-hidden, expected-error, link, duplicate, and PDF fixture named by `START HERE.md` exists. Comment the prepared demo/profile paths on YAZ-1304 and keep it In Progress. Do not launch the user gate yet: Tasks 11–12 must polish and review the code first so Yasin tests the exact final candidate.

---

## Task 11: Polish and anti-slop lifecycle (YAZ-1306, YAZ-1307, YAZ-1308)

- [ ] **Step 1: Move YAZ-1305 and YAZ-1306 to In Progress**

Audit the complete diff for duplicate classifiers, generic abstractions, stale Markdown-only comments, verbose UI, dead branches, unnecessary state/effects, Blob leaks, excess tree reads, accessibility, theme/overflow problems, and insufficient tests. Comment a concrete keep/change/remove checklist on YAZ-1306 and mark it Done.

- [ ] **Step 2: Move YAZ-1307 to In Progress and apply the checklist**

Refactor only proven rough edges. Preserve behavior with focused tests before/after. Run formatter/lint equivalents already present in the repository; do not introduce tooling.

- [ ] **Step 3: Run the anti-slop gates and commit**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
git diff --stat main...HEAD
```

Commit as needed with a focused message such as `refactor: polish read-only file viewers`. Comment changes and mark YAZ-1307 Done.

- [ ] **Step 4: Move YAZ-1308 to In Progress and perform cohesive regression**

Re-run every acceptance test on the final code candidate. Confirm no non-Markdown target appears in the semantic index/backlinks/search/properties/Topics and no text/PDF write path exists. Comment a requirement-by-requirement receipt, mark YAZ-1308 Done, then mark YAZ-1305 Done.

- [ ] **Step 5: Perform independent spec-compliance and code-quality reviews**

Compare the final diff/evidence against YAZ-1289, every child description/comment, the locked decisions, and this plan. Separately review correctness, capability leaks, security, race/cancellation behavior, cleanup, maintainability, and test quality. Fix findings with TDD and rerun affected gates before the demo.

Commit every review fix with a focused message. Before proceeding, `git status --short` must be empty and `HEAD` must identify the exact candidate the demo will run; no uncommitted code may enter the human gate.

- [ ] **Step 6: Run fresh final automated verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
git log --oneline main..HEAD
```

Capture outputs only from this run; older green output is not final-candidate evidence.

- [ ] **Step 7: Launch the polished and reviewed final candidate in the isolated profile**

```bash
YASEEN_DOCS_USER_DATA_DIR=/Users/yasin/Desktop/YAZ-1289-file-viewers-demo-profile npm run dev
```

Open only `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo/`. Do not run Playwright or take over the user's normal app/profile.

- [ ] **Step 8: Give Yasin the pointed final-commit checklist**

Ask him to verify tree visibility, text selection/copy, PDF controls, rapid current/background tab switching, autocomplete insertion, missing-target no-create, rename-link update, Markdown editing regression, and expected hidden/error cases. Name the exact HEAD SHA. Keep YAZ-1304 In Progress until he reports the gate result.

- [ ] **Step 9: Record the human result and enforce retest-on-change**

Comment demo/profile paths, exact tested commit, checklist, observed result, and any fixes on YAZ-1304. Mark it Done only after the result is known, then mark YAZ-1302 Done. If the human gate causes any code change, reopen the affected implementation/polish leaf, rerun Tasks 11 Step 4 onward, relaunch, and obtain a result on the new SHA.

---

## Task 12: Push, merge, and close Linear

- [ ] **Step 1: Push the user-approved feature branch**

```bash
git push -u origin codex/yaz-1289-file-viewers
```

- [ ] **Step 2: Merge into the latest main checkout and push main**

In `/Users/yasin/Documents/GitHub/yaseen-milkdown`, verify the user-owned main checkout is clean, run `git pull --ff-only origin main`, merge `codex/yaz-1289-file-viewers` without force or destructive reset, rerun the required smoke gate on merged main, and `git push origin main`. Stop rather than overwrite if the main checkout gained unrelated changes.

- [ ] **Step 3: Finalize Linear and the goal**

Attach final commit/main SHA, branch/merge evidence, full tests/build, demo result, decisions, learnings, and gotchas to the appropriate issues. Mark remaining children and phase parents Done, then mark YAZ-1289 Done only when all are complete and main contains the verified implementation. Complete the active Codex goal only after the same evidence audit passes.
