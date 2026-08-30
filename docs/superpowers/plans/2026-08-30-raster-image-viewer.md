# Raster Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add static, read-only PNG/JPG/JPEG/GIF/WebP/AVIF/BMP viewing to YAZ-1289 without widening Markdown semantics or write capabilities.

**Architecture:** Extend the shared file classifier with an `image` kind and one MIME-backed allowlist. Deliver exact bytes over a dedicated bounded IPC method, paint the default/first decoded frame once to canvas with `createImageBitmap()`, and reuse the lightweight non-Markdown navigation catalog.

**Tech Stack:** TypeScript, Electron 43, React 19, Vitest, Node filesystem APIs, HTML Canvas/ImageBitmap.

---

## File map

- `shared/types.ts` — image kind, MIME allowlist, byte ceiling, response, and bridge contract.
- `shared/fileKind.ts` — classification, view-only capability, and conversion-safe rename predicate.
- `desktop/src/main/fs/image.ts` — exact bounded binary image read.
- `desktop/src/channels.ts`, `desktop/src/main/ipc/fs.ts`, `desktop/src/preload/index.ts`, `client/src/api.ts` — typed bridge plumbing.
- `client/src/viewers/ImageViewer.tsx` — static decode/paint lifecycle.
- `client/src/viewers/viewers.css` — contained viewer presentation.
- `client/src/editor/Editor.tsx` — dispatch before Markdown ownership.
- `client/src/links/viewOnlyCatalog.ts` — navigation-only image candidates.
- `desktop/src/main/fs/rename.ts` — encoding-preserving image rename validation.
- Existing focused test files plus new `image.test.ts` and `ImageViewer.test.tsx` — contract proof.
- `docs/CONTRACTS.md` — durable architecture truth.

### Task 1: Extend classification and protect image encoding

**Linear:** YAZ-1321

**Files:**
- Modify: `shared/types.ts:25-91`
- Modify: `shared/fileKind.ts:1-30`
- Modify: `desktop/src/main/fs/rename.ts:3-113`
- Test: `desktop/src/main/fs/fileKind.test.ts`
- Test: `desktop/src/main/fs/rename.test.ts`

- [ ] **Step 1: Add failing classifier and capability tests**

Add matrix assertions equivalent to:

```ts
for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']) {
  it(`classifies .${ext} case-insensitively as image`, () => {
    expect(fileKind(`/v/Photo.${ext.toUpperCase()}`)).toBe('image')
    expect(isViewOnly(`/v/Photo.${ext}`)).toBe(true)
  })
}

it('keeps SVG and compound image-like names unsupported', () => {
  expect(fileKind('/v/vector.svg')).toBeNull()
  expect(fileKind('/v/photo.png.gz')).toBeNull()
  expect(fileKind('/v/.png')).toBeNull()
})

it('allows image renames only when bytes keep their encoding', () => {
  expect(canRenameWithoutConversion('/v/a.JPG', '/v/b.jpeg')).toBe(true)
  expect(canRenameWithoutConversion('/v/a.png', '/v/b.PNG')).toBe(true)
  expect(canRenameWithoutConversion('/v/a.png', '/v/b.jpg')).toBe(false)
  expect(canRenameWithoutConversion('/v/a.gif', '/v/b.webp')).toBe(false)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run desktop/src/main/fs/fileKind.test.ts desktop/src/main/fs/rename.test.ts
```

Expected: failures because `image` and `canRenameWithoutConversion` do not exist and image paths are unsupported.

- [ ] **Step 3: Implement the shared image contract**

Add a single MIME-backed allowlist and derive the extension list from it:

```ts
export const IMAGE_VIEW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
} as const
export const IMAGE_VIEW_EXTENSIONS = Object.freeze(Object.keys(IMAGE_VIEW_MIME)) as readonly (keyof typeof IMAGE_VIEW_MIME)[]
export type FileKind = 'markdown' | 'text' | 'pdf' | 'image'
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
```

Extend `fileKind`, generalize `isViewOnly`, and add the rename predicate:

```ts
if ((IMAGE_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'image'

export function isViewOnly(name: string): boolean {
  const kind = fileKind(name)
  return kind !== null && kind !== 'markdown'
}

export function canRenameWithoutConversion(oldName: string, newName: string): boolean {
  const oldKind = fileKind(oldName)
  const newKind = fileKind(newName)
  if (oldKind === null || oldKind !== newKind) return false
  if (oldKind !== 'image') return true
  const ext = (name: string): string => name.slice(name.lastIndexOf('.')).toLowerCase()
  const oldExt = ext(oldName)
  const newExt = ext(newName)
  return oldExt === newExt ||
    (['.jpg', '.jpeg'].includes(oldExt) && ['.jpg', '.jpeg'].includes(newExt))
}
```

Use the predicate in both real and repair rename paths while preserving the existing unsupported-source attribution.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass, including new cross-encoding refusals and existing Markdown/text/PDF renames.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts shared/fileKind.ts desktop/src/main/fs/fileKind.test.ts desktop/src/main/fs/rename.ts desktop/src/main/fs/rename.test.ts
git commit -m "feat: classify read-only raster images"
```

### Task 2: Add the exact bounded image bridge

**Linear:** YAZ-1321

**Files:**
- Create: `desktop/src/main/fs/image.ts`
- Create: `desktop/src/main/fs/image.test.ts`
- Modify: `shared/types.ts:202-220,970-975`
- Modify: `desktop/src/channels.ts:4-15`
- Modify: `desktop/src/main/ipc/fs.ts:1-36`
- Modify: `desktop/src/main/ipc/fs.test.ts`
- Modify: `desktop/src/preload/index.ts:1-43`
- Modify: `desktop/src/preload/bridge.test.ts`
- Modify: `client/src/api.ts:1-57`
- Modify: `client/src/api.test.ts`

- [ ] **Step 1: Write failing filesystem tests**

Cover byte fidelity, uppercase MIME, exact missing paths, directories, unsupported SVG, size limit, and read drift. The success assertion is:

```ts
const response = await readImage(imagePath)
expect(response).toMatchObject({ path: imagePath, mime: 'image/png', size: bytes.length })
expect([...response.data]).toEqual([...bytes])
```

The failure assertions use the established `BridgeFailure` codes:

```ts
await expect(readImage('/v/vector.svg')).rejects.toMatchObject({ code: 'UNSUPPORTED_EXTENSION' })
await expect(readImage(directoryPath)).rejects.toMatchObject({ code: 'NOT_A_FILE' })
await expect(readImage(missingImagePath)).rejects.toMatchObject({ code: 'NOT_FOUND' })
```

- [ ] **Step 2: Run the filesystem test and verify RED**

```bash
npx vitest run desktop/src/main/fs/image.test.ts
```

Expected: module/function missing.

- [ ] **Step 3: Implement `ImageResponse` and `readImage()`**

```ts
export interface ImageResponse {
  path: string
  data: Uint8Array
  mime: (typeof IMAGE_VIEW_MIME)[keyof typeof IMAGE_VIEW_MIME]
  mtime: number
  size: number
}
```

```ts
import path from 'node:path'
import { fileKind } from '@shared/fileKind'
import { IMAGE_VIEW_MIME, MAX_IMAGE_BYTES, type ImageResponse } from '@shared/types'
import { readBoundedRegularFile } from './boundedRead'
import { BridgeFailure, requireAbsPath } from './fsUtils'

export async function readImage(filePath: string): Promise<ImageResponse> {
  const file = requireAbsPath(filePath, 'path')
  if (fileKind(file) !== 'image') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only supported raster images can be read as images', { path: file })
  }
  const mime = IMAGE_VIEW_MIME[path.extname(file).toLowerCase() as keyof typeof IMAGE_VIEW_MIME]
  const snapshot = await readBoundedRegularFile(file, MAX_IMAGE_BYTES, `image exceeds ${MAX_IMAGE_BYTES} bytes`)
  return { path: file, data: snapshot.data, mime, mtime: snapshot.mtime, size: snapshot.size }
}
```

- [ ] **Step 4: Add failing bridge-completeness tests**

Assert `CH.fsReadImage`, `registerFsIpc` registration, preload `readImage`, and client wrapping of structured bridge errors/bytes.

- [ ] **Step 5: Run bridge tests and verify RED**

```bash
npx vitest run desktop/src/main/ipc/fs.test.ts desktop/src/preload/bridge.test.ts client/src/api.test.ts
```

Expected: missing channel/method assertions fail.

- [ ] **Step 6: Wire the bridge**

Add `fsReadImage: 'fs:read-image'`, `handle(CH.fsReadImage, readImage)`, preload `readImage: (path) => call(CH.fsReadImage, path)`, client `readImage`, and `YaseenDocsApi.readImage(path)`.

- [ ] **Step 7: Run Task 2 tests and typecheck**

```bash
npx vitest run desktop/src/main/fs/image.test.ts desktop/src/main/ipc/fs.test.ts desktop/src/preload/bridge.test.ts client/src/api.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts desktop/src/main/fs/image.ts desktop/src/main/fs/image.test.ts desktop/src/channels.ts desktop/src/main/ipc/fs.ts desktop/src/main/ipc/fs.test.ts desktop/src/preload/index.ts desktop/src/preload/bridge.test.ts client/src/api.ts client/src/api.test.ts
git commit -m "feat: add bounded raster image transport"
```

### Task 3: Include images in discovery while preserving semantic isolation

**Linear:** YAZ-1321

**Files:**
- Modify: `desktop/src/main/fs/tree.test.ts`
- Modify: `desktop/src/main/fs/watchers.test.ts`
- Modify: `desktop/src/main/vaultIndex/live.test.ts`
- Modify: `desktop/src/main/fs/viewsFixture.test.ts`

- [ ] **Step 1: Add failing discovery/isolation tests**

Add PNG and uppercase WebP fixtures and assert:

```ts
expect(flattenFiles(response.tree)).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: 'photo.png', kind: 'image' }),
  expect.objectContaining({ name: 'cover.WEBP', kind: 'image' }),
]))
expect(index.records.every((record) => !/\.(png|webp)$/i.test(record.path))).toBe(true)
```

Watcher tests must observe add/change/unlink for a supported image while SVG never emits a supported-file event.

- [ ] **Step 2: Run discovery/isolation characterization tests**

```bash
npx vitest run desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/vaultIndex/live.test.ts desktop/src/main/fs/viewsFixture.test.ts
```

Expected: all new assertions pass because the existing tree, watcher, and index boundaries consume the Task 1 classifier correctly. A failure identifies the exact boundary that still contains a Markdown/text/PDF-only check.

- [ ] **Step 3: Confirm no extra production changes are needed**

The established `buildTree`, watcher, and `isSupportedFile` paths consume `fileKind()`. Do not add per-format checks. The vault index must continue to use its Markdown-only predicate.

- [ ] **Step 4: Run tests and commit proof**

```bash
git add desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/vaultIndex/live.test.ts desktop/src/main/fs/viewsFixture.test.ts
git commit -m "test: protect raster image discovery isolation"
```

### Task 4: Build the static canvas viewer

**Linear:** YAZ-1322

**Files:**
- Create: `client/src/viewers/ImageViewer.tsx`
- Create: `client/src/viewers/ImageViewer.test.tsx`
- Modify: `client/src/viewers/viewers.css:1-end`
- Modify: `client/src/editor/Editor.tsx:1-115`
- Modify: `client/src/editor/Editor.test.tsx`

- [ ] **Step 1: Write failing viewer lifecycle tests**

Mock `api.readImage`, `createImageBitmap`, canvas `getContext`, and a watch source. Prove:

```ts
expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob))
expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
expect(bitmap.close).toHaveBeenCalledTimes(1)
expect(screen.getByText('Read only')).toBeTruthy()
```

Also prove external change reloads, stale completion does not paint, cancelled bitmaps close, malformed decode shows a passive error, and path replacement cannot leave old pixels labeled as the new file.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run client/src/viewers/ImageViewer.test.tsx client/src/editor/Editor.test.tsx
```

Expected: viewer module and `image` dispatch missing.

- [ ] **Step 3: Implement `ImageViewer`**

Implement the approved read/decode/paint/close lifecycle. Keep the canvas mounted while loading, key the viewer by path in `Editor`, and preserve the previous same-path canvas during an external refresh until new bytes paint successfully. Every branch after bitmap creation must call `bitmap.close()` exactly once.

- [ ] **Step 4: Add contained viewer CSS**

```css
.image-viewer {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.image-viewer__stage {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 24px;
}

.image-viewer__canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
}
```

- [ ] **Step 5: Run viewer tests and typecheck**

Run Step 2 plus `npm run typecheck`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add client/src/viewers/ImageViewer.tsx client/src/viewers/ImageViewer.test.tsx client/src/viewers/viewers.css client/src/editor/Editor.tsx client/src/editor/Editor.test.tsx
git commit -m "feat: add static raster image viewer"
```

### Task 5: Generalize navigation-only image links

**Linear:** YAZ-1322

**Files:**
- Modify: `client/src/links/viewOnlyCatalog.ts:1-54`
- Modify: `client/src/links/viewOnlyCatalog.test.ts`
- Modify: `client/src/hooks/useViewOnlyCatalog.test.tsx`
- Modify: `client/src/editor/wikilink/WikilinkIndexBridge.test.tsx`
- Modify: `client/src/editor/wikilink/wikilinkClick.test.ts`
- Modify: `client/src/editor/wikilink/wikilinkPicker.test.ts`
- Modify: `client/src/App.test.tsx`

- [ ] **Step 1: Add failing image catalog/navigation tests**

Assert that image entries become explicit-extension candidates and resolve by unique basename/shortest path, while no `IndexRecord` is created. Prove `[[photo.png]]` current/background clicks, missing no-create behavior, Copy link, rename rewrite, and root-switch cancellation.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run client/src/links/viewOnlyCatalog.test.ts client/src/hooks/useViewOnlyCatalog.test.tsx client/src/editor/wikilink/WikilinkIndexBridge.test.tsx client/src/editor/wikilink/wikilinkClick.test.ts client/src/editor/wikilink/wikilinkPicker.test.ts client/src/App.test.tsx
```

Expected: catalog excludes `image` until generalized.

- [ ] **Step 3: Generalize only the catalog boundary**

```ts
export interface ViewOnlyEntry {
  path: string
  name: string
  kind: Exclude<FileKind, 'markdown'>
}

// flatten
else if (node.kind !== 'markdown') {
  out.push({ path: node.path, name: node.name, kind: node.kind })
}
```

No semantic resolver, `IndexRecord`, backlinks, search, or creation code changes are allowed.

- [ ] **Step 4: Run tests and commit**

Run Step 2; expected green.

```bash
git add client/src/links/viewOnlyCatalog.ts client/src/links/viewOnlyCatalog.test.ts client/src/hooks/useViewOnlyCatalog.test.tsx client/src/editor/wikilink/WikilinkIndexBridge.test.tsx client/src/editor/wikilink/wikilinkClick.test.ts client/src/editor/wikilink/wikilinkPicker.test.ts client/src/App.test.tsx
git commit -m "feat: link Markdown to raster images"
```

### Task 6: Update contracts and run the automated gate

**Linear:** YAZ-1323

**Files:**
- Modify: `docs/CONTRACTS.md`
- Test: no new file is planned; Tasks 1–5 own the complete behavior matrix.

- [ ] **Step 1: Update durable contracts**

Document approved raster formats, exact `readImage` transport, static canvas/default-frame behavior, navigation-only catalog inclusion, encoding-safe rename, 50 MiB ceiling, semantic/write isolation, and SVG deferral.

- [ ] **Step 2: Run focused feature suites**

```bash
npx vitest run desktop/src/main/fs/fileKind.test.ts desktop/src/main/fs/image.test.ts desktop/src/main/fs/tree.test.ts desktop/src/main/fs/watchers.test.ts desktop/src/main/vaultIndex/live.test.ts desktop/src/main/fs/rename.test.ts desktop/src/main/ipc/fs.test.ts desktop/src/preload/bridge.test.ts client/src/api.test.ts client/src/viewers/ImageViewer.test.tsx client/src/editor/Editor.test.tsx client/src/links/viewOnlyCatalog.test.ts client/src/hooks/useViewOnlyCatalog.test.tsx client/src/editor/wikilink/WikilinkIndexBridge.test.tsx client/src/editor/wikilink/wikilinkClick.test.ts client/src/editor/wikilink/wikilinkPicker.test.ts client/src/App.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Run the full automated gate**

```bash
npm test
npm run typecheck
npm run build
git diff --check 5ccd0d18...HEAD
git status --short
```

Expected: every command passes; status contains only intentionally uncommitted demo/polish work or is clean.

- [ ] **Step 4: Commit contracts/evidence changes**

```bash
git add docs/CONTRACTS.md
git commit -m "docs: record raster image viewer contracts"
```

### Task 7: Polish, build the isolated demo, and stop at the user gate

**Linear:** YAZ-1324, then YAZ-1323

**Files:**
- Add demo fixtures under `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo/Images/`.
- Reuse isolated profile `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo-profile`.
- Production files from Tasks 1–5 may change only after Step 1 records a concrete finding and Step 2 adds a focused failing regression.

- [ ] **Step 1: Record a bounded anti-slop audit in Linear**

Inspect the full raster diff for duplicate allowlists/MIME maps, fuzzy `readAsset` leakage, semantic/write leakage, stale requests, unclosed bitmaps, listener cleanup, rough loading/errors, filename inconsistency, accessibility/theme issues, weak timing tests, dead code, temporary diagnostics, and stale docs. Classify findings as must-fix, worthwhile simplification, or out of scope.

- [ ] **Step 2: Fix each approved finding with a failing test first**

For every behavior fix: add the narrow regression, run it red, implement the smallest correction, run it green, and commit a focused change. Do not add unapproved product features.

- [ ] **Step 3: Create the image demo fixtures**

Create valid PNG, JPG, JPEG, GIF, WebP, AVIF, and BMP files; animated GIF/WebP; transparent, portrait, landscape, tiny, large-dimension, spaces/Unicode, duplicate-name, and mixed-case cases; malformed/oversized files; an excluded SVG; explicit links; and safe rename copies. Update `START HERE.md` with exact actions/results.

- [ ] **Step 4: Verify fixtures outside the app**

Use file signatures and an image decoder/inspection tool to confirm formats, dimensions, animation frame counts, and exact oversized byte boundaries. Keep generated artifacts out of git.

- [ ] **Step 5: Run the final clean gate**

```bash
npm test
npm run typecheck
npm run build
git diff --check 5ccd0d18...HEAD
git status --short
git log --oneline 5ccd0d18..HEAD
```

Expected: full green, clean worktree, cohesive commit series.

- [ ] **Step 6: Launch the exact verified commit**

```bash
YASEEN_DOCS_USER_DATA_DIR=/Users/yasin/Desktop/YAZ-1289-file-viewers-demo-profile npm run dev
```

Open only `/Users/yasin/Desktop/YAZ-1289-file-viewers-demo`, select Files, expand Images, and leave `START HERE.md` open. Use pointed computer-use only; no Playwright.

- [ ] **Step 7: Stop for Yasin's explicit demo pass**

Do not push or merge yet. Record the exact commit and demo paths in YAZ-1323. After Yasin reports pass, mark YAZ-1323/YAZ-1302 Done and proceed to the already-approved finish workflow: update/push the feature branch, fast-forward latest main where possible, verify merged main, push main, close all remaining Linear issues/parents, and mark the goal complete.
