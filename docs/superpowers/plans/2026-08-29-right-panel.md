# Right Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved per-window, full-editor right panel with exclusive page ownership, right-local history, Board/Table entry points, cross-pane drag, non-disruptive proof, anti-slop review, and an isolated pre-merge demo.

**Architecture:** Replace the renderer's standalone tab owner with one workspace reducer that composes the existing tab semantics with a normalized per-window right-panel identity. App renders a presentational right shell and reuses the existing `Editor`; same-path transfers generalize the existing rename-continuity buffer handoff so one page never has two editable owners and no unsaved text is lost.

**Tech Stack:** TypeScript 5.9, React 19, Vitest/jsdom, Electron IPC/preload, CSS, existing Milkdown Editor/autosave/watch/index contracts.

**Authoritative design:** [`docs/superpowers/specs/2026-08-29-right-panel-design.md`](../specs/2026-08-29-right-panel-design.md)

**Linear sequence:** YAZ-1270 → YAZ-1271 → YAZ-1272 → YAZ-1273 → YAZ-1274 → YAZ-1275 → YAZ-1268 → YAZ-1276 (start) → YAZ-1277 → YAZ-1278 → YAZ-1279 → YAZ-1276 (done).

---

## Execution rules

- Before the first code edit for a leaf, move that leaf and its phase parent to **In Progress**; keep YAZ-966 In Progress.
- When a leaf is proven and committed, attach tests/commit/findings to its comments and mark it Done. Mark a phase Done only after all its children and its own completion condition are proven.
- Write each specified failing test first, run it, and see the expected feature-specific failure before implementation.
- Never run headed Playwright. Use focused Vitest, typecheck, build, and the isolated Electron demo gate.
- If implementation exposes a material decision outside the design, stop and use Yasin's problem/options/recommendation/line-numbered-diff/after format.
- Preserve unrelated work. Do not upgrade dependencies or create a generic split-pane framework.

## File structure

### New focused units

- `client/src/workspace/useWorkspace.ts` — one reducer/hook for main tabs, right items, both histories, lifecycle repair, and one durable mirror.
- `client/src/workspace/useWorkspace.test.tsx` — pure reducer and hook-level identity-write proofs.
- `client/src/workspace/pageDrag.ts` — validated private workspace-page native-drag payload.
- `client/src/workspace/pageDrag.test.ts` — payload validation proof.
- `client/src/right-panel/RightPanel.tsx` — presentational toolbar, headers, resize separator, focus, insertion slots, and empty state.
- `client/src/right-panel/RightPanel.test.tsx` — shell/accessibility/focus/drag tests.
- `client/src/right-panel/right-panel.css` — panel geometry, header list, retained layers, split/overlay, resize/focus/reduced motion.
- `desktop/src/main/userData.ts` — opt-in isolated Electron profile seam used by the manual demo only.
- `desktop/src/main/userData.test.ts` — proof that normal launches remain untouched and override launches target only `userData`.

### Existing owners extended

- `shared/types.ts` — durable identity and geometry constants.
- `desktop/src/main/store.ts`, `desktop/src/main/ipc/window.ts`, `desktop/src/main/windows.ts` — normalization, strict bridge boundary, new/duplicate window state, path repair.
- `client/src/lib/storage.ts` — boot read, root clear, and one workspace identity mirror.
- `client/src/lib/renameContinuity.ts` — same-path pane transfer using the existing buffer map.
- `client/src/App.tsx` — workspace composition, right Editor host, responsive mode, and lifecycle wiring.
- `client/src/tabs/TabBar.tsx` — cross-pane drag/drop and Move-to-right command while preserving tab reorder.
- `client/src/views/view/PageContextMenu.tsx`, `TableView.tsx`, `BoardView.tsx`, `ViewsPane.tsx`, `FolderPageContents.tsx` — exact page-path intent threading.
- `docs/CONTRACTS.md` — durable behavioral contract.

---

### Task 1: Persist and normalize the right-panel identity (YAZ-1270, part 1)

**Files:**
- Modify: `shared/types.ts:315-356,438-452,496,713-758`
- Modify: `desktop/src/main/store.ts:82-163,240-700`
- Test: `desktop/src/main/store.test.ts`

- [ ] **Step 1: Move YAZ-1265 and YAZ-1270 to In Progress and comment the exact baseline**

Record branch `codex/yaz-966-right-panel`, current commit, baseline tests, and that Task 1 owns shared/store persistence only.

- [ ] **Step 2: Write failing shared/store tests**

Add cases that construct legacy and malformed raw state, then assert this exact contract:

```ts
const RIGHT_DEFAULT = {
  open: false,
  width: RIGHT_PANEL_DEFAULT_W,
  items: [],
  expanded: null,
}

it('legacy windows gain an empty right panel without changing state version 1', async () => {
  await seed(valid({ windows: [legacy('w1', '/v/a.md')] }))
  expect(createStore(file).get().windows[0].rightPanel).toEqual(RIGHT_DEFAULT)
})

it('normalizes width, absolute unique items, expanded membership, and cross-pane ownership', async () => {
  await seed(valid({
    windows: [win('w1', {
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: {
        open: true,
        width: 9_999,
        items: ['/v/a.md', '/v/b.md', 'relative.md', '/v/b.md'],
        expanded: '/v/a.md',
      },
    })],
  }))
  expect(createStore(file).get().windows[0].rightPanel).toEqual({
    open: true,
    width: RIGHT_PANEL_MAX_W,
    items: ['/v/b.md'],
    expanded: null,
  })
})
```

Add path-repair assertions:

```ts
expect(store.get().windows[0].rightPanel).toEqual({
  open: true,
  width: 440,
  items: ['/v/New/a.md', '/v/x.md'],
  expanded: '/v/New/a.md',
})
```

Cover file rename, directory rename, file delete, directory delete, expanded next/previous fallback, and root remaining intentionally untouched on directory delete.

- [ ] **Step 3: Run the focused store tests and verify red**

Run:

```bash
npx vitest run desktop/src/main/store.test.ts
```

Expected: FAIL because `WindowEntry.rightPanel`, geometry constants, and store normalization/repair do not exist.

- [ ] **Step 4: Add the shared identity and constants**

Add to `shared/types.ts`:

```ts
export const RIGHT_PANEL_MIN_W = 320
export const RIGHT_PANEL_MAX_W = 720
export const RIGHT_PANEL_DEFAULT_W = 440
export const MAIN_WORKSPACE_MIN_W = 360

export interface RightPanelIdentity {
  open: boolean
  width: number
  items: string[]
  expanded: string | null
}

export const defaultRightPanelIdentity = (): RightPanelIdentity => ({
  open: false,
  width: RIGHT_PANEL_DEFAULT_W,
  items: [],
  expanded: null,
})
```

Add `rightPanel: RightPanelIdentity` to `WindowEntry` and `WindowIdentity`, and include it in the `WindowApi.setIdentity` patch pick. Every literal `WindowEntry` in source/tests must use `defaultRightPanelIdentity()` or an explicit fixture.

- [ ] **Step 5: Implement store normalization as one workspace invariant**

Add pure helpers to `desktop/src/main/store.ts`:

```ts
const clampRightPanelWidth = (width: number): number =>
  Math.min(RIGHT_PANEL_MAX_W, Math.max(RIGHT_PANEL_MIN_W, width))

export function normalizeRightPanel(
  raw: unknown,
  tabs: readonly string[],
): RightPanelIdentity {
  if (!isRecord(raw)) return defaultRightPanelIdentity()
  const tabSet = new Set(tabs)
  const seen = new Set<string>()
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((path): path is string => {
    if (typeof path !== 'string' || !isAbsolute(path) || tabSet.has(path) || seen.has(path)) return false
    seen.add(path)
    return true
  })
  const expanded = typeof raw.expanded === 'string' && items.includes(raw.expanded) ? raw.expanded : null
  return {
    open: raw.open === true,
    width: isFiniteNumber(raw.width) ? clampRightPanelWidth(raw.width) : RIGHT_PANEL_DEFAULT_W,
    items,
    expanded,
  }
}
```

Use it in `sanitizeWindows` after `normalizeTabs`. Extend `renamePath` and `removePath` with pure item/history-free durable repair. Delete fallback is next at the removed index, otherwise previous, otherwise null.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npx vitest run desktop/src/main/store.test.ts
npm run typecheck
```

Expected: store tests PASS; typecheck identifies every remaining `WindowEntry` literal that Task 2 must update. Fix only mechanical fixture/default additions required by the new shared type.

- [ ] **Step 7: Commit Task 1**

```bash
git add shared/types.ts desktop/src/main/store.ts desktop/src/main/store.test.ts desktop/src client/src
git commit -m "feat: persist right panel identity"
```

Attach commit/tests/normalization gotchas to YAZ-1270; keep it In Progress for bridge/storage proof.

---

### Task 2: Carry identity through IPC, windows, and renderer storage (YAZ-1270, part 2)

**Files:**
- Modify: `desktop/src/main/ipc/window.ts`
- Test: `desktop/src/main/ipc/window.test.ts`
- Modify: `desktop/src/main/windows.ts`
- Test: `desktop/src/main/windows.test.ts`
- Modify: `client/src/lib/storage.ts`
- Test: `client/src/lib/storage.test.ts`

- [ ] **Step 1: Write failing IPC/window/storage tests**

Add strict-boundary tests:

```ts
const rightPanel = { open: true, width: 500, items: ['/v/b.md'], expanded: '/v/b.md' }

expect(await registered(CH.windowSetIdentity)({ sender }, {
  file: '/v/a.md',
  tabs: ['/v/a.md'],
  rightPanel,
})).toEqual(ok(undefined))
expect(store.get().windows[0]).toMatchObject({ file: '/v/a.md', tabs: ['/v/a.md'], rightPanel })

expect(await registered(CH.windowSetIdentity)({ sender }, {
  rightPanel: { ...rightPanel, items: ['relative.md'] },
})).toEqual(bad('NOT_ABSOLUTE'))
```

Add duplicate/new-window tests:

```ts
expect(created[0].entry.rightPanel).toEqual(defaultRightPanelIdentity())
expect(duplicated.entry.rightPanel).toEqual(from.rightPanel)
expect(duplicated.entry.rightPanel).not.toBe(from.rightPanel)
```

Add renderer storage tests:

```ts
storage.setWorkspace('/v', ['/v/a.md'], '/v/a.md', rightPanel)
expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
  tabs: ['/v/a.md'],
  file: '/v/a.md',
  rightPanel,
})

storage.setRoot('/other')
expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
  root: '/other',
  file: null,
  tabs: [],
  rightPanel: defaultRightPanelIdentity(),
})
```

- [ ] **Step 2: Run the focused tests and verify red**

```bash
npx vitest run desktop/src/main/ipc/window.test.ts desktop/src/main/windows.test.ts client/src/lib/storage.test.ts
```

Expected: FAIL because the bridge returns/accepts only root/file/tabs and storage has no workspace mirror.

- [ ] **Step 3: Implement strict nested IPC validation**

Add `optionalRightPanel` in `desktop/src/main/ipc/window.ts`. It must require an object, boolean `open`, finite number `width`, an array of absolute paths, and `expanded` null or absolute. Normalize the complete next entry once:

```ts
const nextFile = file !== undefined ? file : entry.file
const nextTabs = normalizeTabs(tabs ?? entry.tabs, nextFile)
const nextRight = normalizeRightPanel(rightPanel ?? entry.rightPanel, nextTabs)
store.upsertWindow({
  ...entry,
  ...(root !== undefined ? { root } : {}),
  file: nextFile,
  tabs: nextTabs,
  rightPanel: nextRight,
})
```

Return `rightPanel` from `windowIdentity`.

- [ ] **Step 4: Implement new/duplicate window behavior**

Use `defaultRightPanelIdentity()` in first-launch, `openWindow`, and every empty literal. Duplicate with a deep copy:

```ts
rightPanel: {
  ...from.rightPanel,
  items: [...from.rightPanel.items],
}
```

- [ ] **Step 5: Replace `setTabs` with one workspace mirror**

Keep boot getters and add:

```ts
getRightPanel: (): RightPanelIdentity => ({ ...identity.rightPanel, items: [...identity.rightPanel.items] }),

setWorkspace(root, tabs, file, rightPanel): void {
  const fileChanged = file !== identity.file
  identity = { ...identity, file, tabs: [...tabs], rightPanel: { ...rightPanel, items: [...rightPanel.items] } }
  if (root !== null && fileChanged) {
    patchFolder(root, { lastFile: file })
    send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { lastFile: file }))
  }
  send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({
    tabs: [...tabs],
    file,
    rightPanel: { ...rightPanel, items: [...rightPanel.items] },
  }))
},
```

Update `setRoot` to clear the right panel in the same patch. Keep no compatibility `setTabs` call sites after Task 3.

- [ ] **Step 6: Run focused and adjacent bridge tests**

```bash
npx vitest run desktop/src/main/ipc/window.test.ts desktop/src/main/windows.test.ts desktop/src/preload/bridge.test.ts client/src/lib/storage.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit and complete YAZ-1270**

```bash
git add shared/types.ts desktop/src/main/ipc/window.ts desktop/src/main/ipc/window.test.ts desktop/src/main/windows.ts desktop/src/main/windows.test.ts client/src/lib/storage.ts client/src/lib/storage.test.ts
git commit -m "feat: bridge right panel window state"
```

Comment evidence and mark YAZ-1270 Done. YAZ-1265 stays In Progress for YAZ-1271.

---

### Task 3: Create the unified workspace reducer and hook (YAZ-1271)

**Files:**
- Rename: `client/src/tabs/useTabs.ts` → `client/src/workspace/useWorkspace.ts`
- Rename/update: `client/src/tabs/useTabs.test.tsx` → `client/src/workspace/useWorkspace.test.tsx`
- Modify/move: `client/src/tabs/useTabs.history.test.tsx`
- Modify: `client/src/App.tsx` imports/callback names only

- [ ] **Step 1: Move YAZ-1271 to In Progress and record the reducer boundary**

Comment that the existing tab cases remain authoritative and the new reducer must preserve them byte-for-behavior while adding right ownership.

- [ ] **Step 2: Move the existing files without changing behavior**

```bash
mkdir -p client/src/workspace
git mv client/src/tabs/useTabs.ts client/src/workspace/useWorkspace.ts
git mv client/src/tabs/useTabs.test.tsx client/src/workspace/useWorkspace.test.tsx
git mv client/src/tabs/useTabs.history.test.tsx client/src/workspace/useWorkspace.history.test.tsx
```

Update relative imports and rename exported `UseTabs`/`useTabs` to `UseWorkspace`/`useWorkspace`. Run the moved tests and prove they still pass before adding behavior.

- [ ] **Step 3: Write failing pure reducer cases for right ownership**

Add exact cases for foreground/background, close fallback, mounted retention, and mirror count:

```ts
const state = workspaceState({
  tabs: ['/v/a.md', '/v/b.md'],
  active: '/v/a.md',
  mounted: ['/v/a.md'],
  rightPanel: { open: false, width: 440, items: [], expanded: null },
})

expect(workspaceReducer(state, { type: 'open-right', path: '/v/a.md' })).toMatchObject({
  tabs: ['/v/b.md'],
  active: '/v/b.md',
  rightPanel: { open: true, width: 440, items: ['/v/a.md'], expanded: '/v/a.md' },
  rightMounted: ['/v/a.md'],
})

expect(workspaceReducer(state, { type: 'open-right-background', path: '/v/a.md' })).toMatchObject({
  tabs: ['/v/b.md'],
  active: '/v/b.md',
  rightPanel: { items: ['/v/a.md'], expanded: null },
  rightMounted: [],
})
```

Add table-driven invariant checks after every action:

```ts
const current = new Set(next.tabs)
expect(next.rightPanel.items.every((path) => !current.has(path))).toBe(true)
expect(next.rightPanel.expanded === null || next.rightPanel.items.includes(next.rightPanel.expanded)).toBe(true)
expect(next.rightMounted.every((path) => next.rightPanel.items.includes(path))).toBe(true)
```

- [ ] **Step 4: Write failing right-history and lifecycle cases**

```ts
const navigated = workspaceReducer(open, { type: 'navigate-right', from: '/v/a.md', to: '/v/b.md' })
expect(navigated.rightPanel.items).toEqual(['/v/b.md'])
expect(navigated.rightHistory['/v/b.md']).toEqual({ entries: ['/v/a.md', '/v/b.md'], index: 1 })
expect(workspaceReducer(navigated, { type: 'right-back' }).rightPanel.expanded).toBe('/v/a.md')
```

Cover target owned by another right slot, target owned by main, rename, directory rename, delete, directory delete, root reset, same action twice, invalid close/reorder, and exact next-else-previous fallback.

- [ ] **Step 5: Run moved/new tests and verify red**

```bash
npx vitest run client/src/workspace/useWorkspace.test.tsx client/src/workspace/useWorkspace.history.test.tsx
```

Expected: legacy main cases PASS after the move; new right cases FAIL because workspace state/actions do not exist.

- [ ] **Step 6: Implement the workspace model by composing the existing tab reducer**

Keep the existing `TabsState`, `TabHistory`, `tabsReducer`, and history helpers. Add:

```ts
export interface WorkspaceState extends TabsState {
  rightPanel: RightPanelIdentity
  rightMounted: string[]
  rightHistory: Record<string, TabHistory>
}

export type WorkspaceAction =
  | TabsAction
  | { type: 'open-right' | 'open-right-background'; path: string; at?: number }
  | { type: 'navigate-right'; from: string; to: string }
  | { type: 'toggle-right'; path: string }
  | { type: 'close-right'; path: string }
  | { type: 'move-right'; from: number; to: number }
  | { type: 'transfer-main-to-right'; path: string; at: number }
  | { type: 'transfer-right-to-main'; path: string; at: number }
  | { type: 'right-back' | 'right-forward' }
  | { type: 'set-right-open'; open: boolean }
  | { type: 'set-right-width'; width: number }
```

Use named pure helpers `removeMainOwner`, `removeRightOwner`, `insertAt`, `rightNavigate`, and `repairWorkspacePaths`. Do not put transfer logic in React callbacks.

- [ ] **Step 7: Implement one mirror per durable action**

The hook keeps `stateRef`, as today, and calls:

```ts
storage.setWorkspace(rootRef.current, next.tabs, next.active, next.rightPanel)
```

exactly once when any durable field changes. Pure focus/session-only mount changes that do not alter identity must not write. Root reset takes an explicit next root and mirrors only when the preceding `storage.setRoot` did not already own the complete write.

- [ ] **Step 8: Run workspace, storage, and App tests**

```bash
npx vitest run client/src/workspace/useWorkspace.test.tsx client/src/workspace/useWorkspace.history.test.tsx client/src/lib/storage.test.ts client/src/App.test.tsx
npm run typecheck
```

Expected: PASS. Update existing App assertions from `{ tabs, file }` to `{ tabs, file, rightPanel }` without weakening call-count assertions.

- [ ] **Step 9: Commit and complete the state foundation**

```bash
git add client/src/workspace client/src/tabs client/src/App.tsx client/src/App.test.tsx client/src/lib/storage.ts client/src/lib/storage.test.ts
git commit -m "feat: unify workspace page ownership"
```

Attach invariant/mirror/history proof; mark YAZ-1271 and YAZ-1265 Done.

---

### Task 4: Preserve live buffers across pane transfer (YAZ-1271 continuity follow-through)

**Files:**
- Modify: `client/src/lib/renameContinuity.ts`
- Test: `client/src/lib/renameContinuity.test.ts`
- Modify: `client/src/workspace/useWorkspace.ts` callback layer
- Test: `client/src/workspace/useWorkspace.test.tsx`

- [ ] **Step 1: Write the failing same-path handoff test**

```ts
it('pane transfer captures, retires, and exposes the dirty buffer at the same path', () => {
  const handle = fakeHandle({ frontmatter: '---\n---\n', body: 'newest keystrokes' })
  registerRenameContinuity('/v/a.md', handle)
  carryEditorAcrossPane('/v/a.md')
  expect(handle.capture).toHaveBeenCalledTimes(1)
  expect(handle.retire).toHaveBeenCalledTimes(1)
  expect(takeRenameBuffer('/v/a.md')).toEqual({ frontmatter: '---\n---\n', body: 'newest keystrokes' })
})
```

Add a hook/callback ordering assertion that logs `carry` before the one `storage.setWorkspace` call.

- [ ] **Step 2: Run the focused tests and verify red**

```bash
npx vitest run client/src/lib/renameContinuity.test.ts client/src/workspace/useWorkspace.test.tsx
```

Expected: FAIL because `carryEditorAcrossPane` is undefined and transfer callbacks do not invoke it.

- [ ] **Step 3: Generalize the existing helper**

```ts
function carryEditorBuffer(oldPath: string, newPath: string): void {
  const handle = handles.get(oldPath)
  if (handle === undefined) return
  const buffer = handle.capture()
  handle.retire()
  if (buffer !== null) buffers.set(newPath, buffer)
}

export function carryEditorAcrossRename(oldPath: string, newPath: string): void {
  carryEditorBuffer(oldPath, newPath)
}

export function carryEditorAcrossPane(path: string): void {
  carryEditorBuffer(path, path)
}
```

Keep `Editor.tsx`'s existing `takeRenameBuffer(file.path)` adoption path. In workspace transfer callbacks, first prove the source path is currently owned and the action will change ownership; only then call `carryEditorAcrossPane(path)` and dispatch.

- [ ] **Step 4: Run focused tests**

```bash
npx vitest run client/src/lib/renameContinuity.test.ts client/src/workspace/useWorkspace.test.tsx client/src/editor/Editor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the continuity proof**

```bash
git add client/src/lib/renameContinuity.ts client/src/lib/renameContinuity.test.ts client/src/workspace/useWorkspace.ts client/src/workspace/useWorkspace.test.tsx
git commit -m "fix: preserve edits across pane transfers"
```

Comment the capture/retire/mirror/adopt ordering on YAZ-1271.

---

### Task 5: Build the right-panel shell (YAZ-1272)

**Files:**
- Create: `client/src/right-panel/RightPanel.tsx`
- Create: `client/src/right-panel/RightPanel.test.tsx`
- Create: `client/src/right-panel/right-panel.css`
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`

- [ ] **Step 1: Move YAZ-1266 and YAZ-1272 to In Progress**

Comment the approved header-stack/stable-viewer/resize/overlay/focus contract.

- [ ] **Step 2: Write failing shell semantics and focus tests**

Mount a controlled shell and assert:

```ts
expect(screen.getByRole('complementary', { name: 'Right panel' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-expanded', 'true')
expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-expanded', 'false')
expect(screen.getByRole('button', { name: 'Back in right panel' })).toBeDisabled()
expect(screen.getByRole('separator', { name: 'Resize right panel' })).toHaveAttribute('aria-valuenow', '440')
```

Test collapse focus:

```ts
expandedHeader.focus()
fireEvent.click(expandedHeader)
rerender(<Harness expanded={null} />)
expect(document.activeElement).toBe(expandedHeader)
```

Test close next/previous/empty focus, Hide callback, keyboard resize in 16px steps, min/max clamps, and overlay Escape only when `overlay=true`.

- [ ] **Step 3: Run the shell test and verify red**

```bash
npx vitest run client/src/right-panel/RightPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the presentational component**

Use this public contract:

```ts
export interface RightPanelProps {
  items: readonly string[]
  expanded: string | null
  width: number
  overlay: boolean
  canBack: boolean
  canForward: boolean
  onBack(): void
  onForward(): void
  onToggle(path: string): void
  onClose(path: string): void
  onHide(): void
  onResizeCommit(width: number): void
  children?: ReactNode
}
```

Render `<aside aria-label="Right panel">`, toolbar, semantic `<ul>`, labelled buttons, a separator, one stable viewer container, and empty copy. Keep pointer resize preview local; call `onResizeCommit` once on mouseup. On a drag below 192px, call `onHide` and do not overwrite width.

- [ ] **Step 5: Implement exact CSS geometry**

Include:

```css
.right-panel {
  position: relative;
  flex: 0 0 var(--right-panel-width);
  min-width: 0;
  max-width: min(var(--right-panel-width), calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg);
}

.right-panel--overlay {
  position: absolute;
  z-index: 20;
  inset: 0 0 0 auto;
  width: min(var(--right-panel-width), calc(100vw - 48px));
  box-shadow: -12px 0 28px rgb(0 0 0 / 14%);
}

.right-panel__editor-layer--hidden { visibility: hidden; }

@media (prefers-reduced-motion: reduce) {
  .right-panel { transition: none; }
}
```

Use existing theme tokens and no hard-coded light-only colors.

- [ ] **Step 6: Add App show/host geometry without Editors yet**

Render the shell after `.workspace`. Derive overlay from window width, visible sidebar width, right width, and `MAIN_WORKSPACE_MIN_W`. Add the right-edge Show button when closed. Use a resize listener with cleanup; do not persist overlay.

- [ ] **Step 7: Run shell/App tests and typecheck**

```bash
npx vitest run client/src/right-panel/RightPanel.test.tsx client/src/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit and complete YAZ-1272**

```bash
git add client/src/right-panel client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: add resizable right panel shell"
```

Attach screenshot-free component evidence, focus tests, and geometry behavior; mark YAZ-1272 Done. Keep YAZ-1266 In Progress for Editor hosting.

---

### Task 6: Host the full Editor and right-local history (YAZ-1273)

**Files:**
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`
- Modify: `client/src/editor/Editor.tsx` only to expose shared prop typing if duplication demands it
- Test: `client/src/editor/Editor.test.tsx`
- Modify: `client/src/right-panel/RightPanel.tsx`

- [ ] **Step 1: Move YAZ-1273 to In Progress and comment the no-fork boundary**

Record that App will render the existing `Editor` with the existing one-per-window feeds; no right-specific Editor or watcher is allowed.

- [ ] **Step 2: Write failing App integration tests**

Mock `Editor` as a path-labelled surface and prove exactly one current owner:

```ts
openRight('/v/a.md')
expect(screen.getAllByTestId('editor-/v/a.md')).toHaveLength(1)
expect(screen.queryByRole('tab', { name: 'a' })).not.toBeInTheDocument()
expect(screen.getByLabelText('Right panel')).toHaveTextContent('a')
```

Prove retained mounts and visibility:

```ts
openRight('/v/a.md')
openRight('/v/b.md')
expect(screen.getByTestId('right-layer-/v/a.md')).toHaveClass('right-panel__editor-layer--hidden')
expect(screen.getByTestId('right-layer-/v/b.md')).not.toHaveClass('right-panel__editor-layer--hidden')
```

Capture callbacks passed to each right Editor and assert:

```ts
rightA.onOpenFile('/v/c.md')
expect(rightPanel()).toMatchObject({ items: ['/v/c.md'], expanded: '/v/c.md' })
rightC.onOpenFileBackground?.('/v/d.md')
expect(rightPanel()).toMatchObject({ items: ['/v/c.md', '/v/d.md'], expanded: '/v/c.md' })
```

Test Back/Forward per item, foreground focus, background no-focus, collapse/show retention, same-path main transfer, and root switch clearing all right layers.

- [ ] **Step 3: Run App/Editor tests and verify red**

```bash
npx vitest run client/src/App.test.tsx client/src/editor/Editor.test.tsx
```

Expected: FAIL because RightPanel has no Editor layers and App supplies only main navigation callbacks.

- [ ] **Step 4: Extract one shared Editor-props builder in App**

Keep values, not behavior, shared:

```ts
const editorCommon = {
  root,
  watch,
  onNotice: setNotice,
  createBase,
  wikilinks,
  wikilinkCandidates,
  properties: propertyDecls,
  onRenameFile: requestRename,
  sync: githubSync.status,
  onSyncNow: githubSync.syncNow,
}
```

Main layers use `onOpenFile={workspace.openCurrent}` and `onOpenFileBackground={workspace.openBackground}`. Right layers use `onOpenFile={(to) => workspace.navigateRight(path, to)}` and `onOpenFileBackground={workspace.openRightBackground}`.

- [ ] **Step 5: Render retained right Editor layers**

```tsx
<div className="right-panel__editor-stack">
  {workspace.rightMounted.map((path) => (
    <div
      key={path}
      data-testid={`right-layer-${path}`}
      className={path === workspace.rightPanel.expanded
        ? 'right-panel__editor-layer'
        : 'right-panel__editor-layer right-panel__editor-layer--hidden'}
    >
      <Editor
        {...editorCommon}
        path={path}
        onOpenFile={(to) => workspace.navigateRight(path, to)}
        onOpenFileBackground={workspace.openRightBackground}
      />
    </div>
  ))}
</div>
```

Use the toolbar's Back/Forward callbacks and disabled values from the workspace hook.

- [ ] **Step 6: Extend App lifecycle listeners to the workspace owner**

Rename and delete broadcasts call workspace-wide repair methods after existing carry/retire ordering. Root reset clears both identities through `storage.setRoot` plus renderer reset. Update comments so they no longer claim “tabs only.”

- [ ] **Step 7: Run focused Editor/App/workspace suites**

```bash
npx vitest run client/src/App.test.tsx client/src/editor/Editor.test.tsx client/src/workspace/useWorkspace.test.tsx client/src/lib/renameContinuity.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit and complete the viewer phase**

```bash
git add client/src/App.tsx client/src/App.test.tsx client/src/editor/Editor.tsx client/src/editor/Editor.test.tsx client/src/right-panel client/src/workspace
git commit -m "feat: host full editors in right panel"
```

Attach mount/navigation/lifecycle evidence; mark YAZ-1273 and YAZ-1266 Done.

---

### Task 7: Add the shared Open-in-right command (YAZ-1274)

**Files:**
- Modify: `client/src/views/view/PageContextMenu.tsx`
- Test: `client/src/views/view/PageContextMenu.test.tsx`
- Modify: `client/src/views/view/TableView.tsx`
- Test: `client/src/views/view/TableView.test.tsx`
- Modify: `client/src/views/view/BoardView.tsx`
- Test: `client/src/views/view/BoardView.test.tsx`
- Modify: `client/src/views/ViewsPane.tsx`, `client/src/views/FolderPageContents.tsx`, `client/src/editor/Editor.tsx`, `client/src/App.tsx`

- [ ] **Step 1: Move YAZ-1267 and YAZ-1274 to In Progress**

Comment that YAZ-1243's merged `PageContextMenu` stays the only action roster.

- [ ] **Step 2: Write failing shared-menu order/payload tests**

```ts
render(<PageContextMenu path="/v/a.md" onOpenRight={openRight} onOpenBackground={openBg} {...rest} />)
expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
  'Open in right panel',
  'Open in new tab',
  'Copy path',
  'Reveal in Finder',
])
fireEvent.click(screen.getByRole('menuitem', { name: 'Open in right panel' }))
expect(openRight).toHaveBeenCalledWith('/v/a.md')
expect(close).toHaveBeenCalledTimes(1)
```

Rerender without `onOpenRight` and assert the action is absent. Add Table and Board tests that right-click direct/nested/repeated/hidden-title records and assert the exact path reaches `onOpenFileRight`.

- [ ] **Step 3: Run menu/Table/Board tests and verify red**

```bash
npx vitest run client/src/views/view/PageContextMenu.test.tsx client/src/views/view/TableView.test.tsx client/src/views/view/BoardView.test.tsx
```

Expected: FAIL because the callback/action/prop chain does not exist.

- [ ] **Step 4: Add the optional shared action**

Extend props:

```ts
onOpenRight?: (path: string) => void
```

Render first only when provided:

```tsx
{onOpenRight !== undefined && (
  <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => {
    onOpenRight(path)
    onClose()
  }}>
    Open in right panel
  </button>
)}
```

Do not change existing action implementations.

- [ ] **Step 5: Thread one stable intent callback**

Add `onOpenFileRight` beside current/background openers through `Editor` → `FolderPageContents` → `ViewsPane` → `TableView`/`BoardView`. App passes `workspace.openRight`. Avoid a context provider or second menu abstraction.

- [ ] **Step 6: Prove Table interactions did not change**

Run the entire Table suite, including selection, double-click, Enter, arrow navigation, cell editing, drag, and context targeting:

```bash
npx vitest run client/src/views/view/PageContextMenu.test.tsx client/src/views/view/TableView.test.tsx client/src/views/view/BoardView.test.tsx client/src/views/FolderPageContents.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit and complete YAZ-1274**

```bash
git add client/src/views client/src/editor/Editor.tsx client/src/App.tsx
git commit -m "feat: open view pages in right panel"
```

Attach action-order and exact-path evidence; mark YAZ-1274 Done. Keep YAZ-1267 In Progress.

---

### Task 8: Make Board primary click open right safely (YAZ-1275)

**Files:**
- Modify: `client/src/views/view/BoardView.tsx`
- Test: `client/src/views/view/BoardView.test.tsx`
- Test: `client/src/views/view/TableView.test.tsx`

- [ ] **Step 1: Move YAZ-1275 to In Progress**

Comment the four gesture owners: primary open-right, secondary menu, drag group move, hover preview.

- [ ] **Step 2: Write failing whole-card and guard tests**

Add a helper that clicks the `<li class="view-board__card">`. Assert direct, nested, repeated/fanned, and `order: []` cards call the exact path. Assert the visible title calls the same callback and not `onOpenFile`.

Add suppression tests:

```ts
const card = cardIn(el)
fireEvent.contextMenu(card, { clientX: 120, clientY: 42 })
fireEvent.click(card)
expect(onOpenFileRight).not.toHaveBeenCalled()

fireEvent.dragStart(card)
fireEvent.dragEnd(card)
fireEvent.click(card)
expect(onOpenFileRight).not.toHaveBeenCalled()
```

Prove preview opens/closes as before, inline New does not bubble page-open, and no-group hints/placeholders do nothing. Keep a Table assertion that ordinary cell click never calls right-open.

- [ ] **Step 3: Run Board/Table tests and verify red**

```bash
npx vitest run client/src/views/view/BoardView.test.tsx client/src/views/view/TableView.test.tsx
```

Expected: FAIL because card click still routes only the title to main and has no suppression gate.

- [ ] **Step 4: Implement one card activation path**

Replace title main navigation with right intent. Give the card keyboard semantics through its existing title button when present and a labelled fallback button/surface when the title is hidden. Track only transient suppression:

```ts
const suppressClick = useRef(false)
const suppressOnce = () => {
  suppressClick.current = true
  queueMicrotask(() => { suppressClick.current = false })
}

const openCard = (row: Row) => {
  if (suppressClick.current) return
  onOpenFileRight(row.record.path)
}
```

Set suppression on secondary pointer/context and completed drag without replacing `useGroupDrag` handlers. Use `stopPropagation` on inline New controls, not broad card-level capture that would break drag/preview.

- [ ] **Step 5: Run complete Board/Table suites**

```bash
npx vitest run client/src/views/view/BoardView.test.tsx client/src/views/view/TableView.test.tsx client/src/views/view/NestedGroupActions.test.tsx client/src/views/view/GroupDrag.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit and complete the opening phase**

```bash
git add client/src/views/view/BoardView.tsx client/src/views/view/BoardView.test.tsx client/src/views/view/TableView.test.tsx
git commit -m "feat: open board cards in right panel"
```

Attach gesture/path proof; mark YAZ-1275 and YAZ-1267 Done.

---

### Task 9: Move and reorder pages with private drag data (YAZ-1268)

**Files:**
- Create: `client/src/workspace/pageDrag.ts`
- Create: `client/src/workspace/pageDrag.test.ts`
- Modify: `client/src/tabs/TabBar.tsx`
- Test: `client/src/tabs/TabBar.test.tsx`
- Modify: `client/src/right-panel/RightPanel.tsx`
- Test: `client/src/right-panel/RightPanel.test.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`

- [ ] **Step 1: Move YAZ-1268 to In Progress**

Comment the private MIME, insertion, one-owner, buffer handoff, and keyboard-equivalent contract.

- [ ] **Step 2: Write failing payload validation tests**

```ts
expect(readPageDrag(dataWith('text/plain', '/v/a.md'))).toBeNull()
expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, '{bad json'))).toBeNull()
expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: 'relative.md', owner: 'main' })))).toBeNull()
expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main' })))).toEqual({ path: '/v/a.md', owner: 'main' })
```

- [ ] **Step 3: Write failing TabBar/RightPanel drag tests**

Prove before/after slots, end-slot indicators, same-pane reorder, cross-pane transfer, invalid/wrong MIME no-op, stale source no-op, Escape/end/outside no-op, and exactly one transfer callback.

Add context action proof:

```ts
fireEvent.click(screen.getByRole('menuitem', { name: 'Move to right panel' }))
expect(onMoveToRight).toHaveBeenCalledWith('/v/a.md')
```

Extend `RightPanelProps` here with `dropAt`, `onDropPage`, and `onMoveToMain`; extend `TabBarProps` with the matching external-drop and move-to-right callbacks. Right header **Move to main tabs** must append/activate through `onMoveToMain(path)`.

- [ ] **Step 4: Run focused drag tests and verify red**

```bash
npx vitest run client/src/workspace/pageDrag.test.ts client/src/tabs/TabBar.test.tsx client/src/right-panel/RightPanel.test.tsx client/src/App.test.tsx
```

Expected: FAIL because the private payload and external drop callbacks do not exist.

- [ ] **Step 5: Implement the validated transport**

```ts
export const WORKSPACE_PAGE_MIME = 'application/x-yaseen-workspace-page'
export type PageDrag = { path: string; owner: 'main' | 'right' }

export function writePageDrag(data: DataTransfer, value: PageDrag): void {
  data.setData(WORKSPACE_PAGE_MIME, JSON.stringify(value))
  data.effectAllowed = 'move'
}

export function readPageDrag(data: DataTransfer): PageDrag | null {
  if (![...data.types].includes(WORKSPACE_PAGE_MIME)) return null
  try {
    const value: unknown = JSON.parse(data.getData(WORKSPACE_PAGE_MIME))
    if (!isRecord(value) || !isAbsolutePath(value.path) || (value.owner !== 'main' && value.owner !== 'right')) return null
    return { path: value.path, owner: value.owner }
  } catch {
    return null
  }
}
```

Keep absolute-path validation renderer-safe (leading `/` on this macOS app); do not import Node `path` into the client bundle.

- [ ] **Step 6: Extend both insertion surfaces**

TabBar keeps its current local `drag` reorder state and adds external payload handling when local drag is null. RightPanel uses the same midpoint insertion calculation over headers and a tail slot. Both surfaces dispatch only validated intent.

App maps:

```ts
onDropMain={(payload, at) => payload.owner === 'right' && workspace.transferRightToMain(payload.path, at)}
onDropRight={(payload, at) => payload.owner === 'main'
  ? workspace.transferMainToRight(payload.path, at)
  : workspace.moveRight(payload.path, at)}
```

The workspace callbacks own `carryEditorAcrossPane` ordering.

- [ ] **Step 7: Run drag, tab, Board, and workspace suites**

```bash
npx vitest run client/src/workspace/pageDrag.test.ts client/src/workspace/useWorkspace.test.tsx client/src/tabs/TabBar.test.tsx client/src/right-panel/RightPanel.test.tsx client/src/views/view/GroupDrag.test.tsx client/src/views/view/BoardView.test.tsx client/src/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit and complete YAZ-1268**

```bash
git add client/src/workspace client/src/tabs/TabBar.tsx client/src/tabs/TabBar.test.tsx client/src/right-panel client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: move pages between workspace panes"
```

Attach transfer/cancel/MIME/continuity proof; mark YAZ-1268 Done.

---

### Task 10: Complete lifecycle, contract, and integration coverage

**Files:**
- Modify: `client/src/App.test.tsx`
- Modify: `desktop/src/main/store.test.ts`
- Modify: `desktop/src/main/ipc/fs.test.ts`
- Modify: `docs/CONTRACTS.md`
- Modify: comments in touched source files where ownership claims changed

- [ ] **Step 1: Write any missing end-to-end integration assertions before implementation cleanup**

Add App/store tests that prove:

```ts
expect(order).toEqual(['retire', 'workspace']) // delete event
expect(order).toEqual(['carry', 'workspace']) // rename/transfer event
```

Prove directory rename/delete remap both panes and both histories, duplicate-window independence, right overlay derivation after sidebar resize/collapse, and no old `useTabs` hook/import remains.

- [ ] **Step 2: Run the focused integration set and verify any new red cases**

```bash
npx vitest run client/src/App.test.tsx desktop/src/main/store.test.ts desktop/src/main/ipc/fs.test.ts client/src/workspace/useWorkspace.test.tsx
```

Expected: any missing lifecycle branch fails with a specific stale right path, wrong order, or duplicate identity.

- [ ] **Step 3: Implement only the missing lifecycle wiring**

Use the existing App event doors and store repair functions. Do not add a second event subscription, watcher, or IPC channel. Ensure comments describe “workspace” rather than “tabs” where the contract now covers both panes.

- [ ] **Step 4: Update the durable contract**

Add a concise `Right panel (YAZ-966)` section to `docs/CONTRACTS.md` covering durable identity, one-owner invariant, right history, retained mounts, transfer buffer ordering, menu/Board gestures, drag MIME, responsive overlay, and demo/verification constraints. Link source owners and tests.

- [ ] **Step 5: Run integration and contract checks**

```bash
npx vitest run client/src/App.test.tsx desktop/src/main/store.test.ts desktop/src/main/ipc/window.test.ts desktop/src/main/ipc/fs.test.ts client/src/workspace/useWorkspace.test.tsx client/src/lib/renameContinuity.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit integration hardening**

```bash
git add client/src desktop/src docs/CONTRACTS.md
git commit -m "test: harden right panel lifecycle"
```

Comment cross-cutting evidence on YAZ-966 and the affected completed leaves.

---

### Task 11: Run complete automated and non-disruptive UI proof (YAZ-1276)

**Files:**
- Modify tests only if a requirement lacks direct proof
- No production behavior changes unless a proven bug is fixed under its owning issue

- [ ] **Step 1: Move YAZ-1269 and YAZ-1276 to In Progress**

Comment the exact commit under test and reaffirm that no headed Playwright will run.

- [ ] **Step 2: Audit requirement-to-test coverage**

Create a comment checklist mapping every design requirement to a named test or manual step:

- durable legacy/per-window identity;
- global-in-window unique owner;
- one identity write;
- one expanded/right-retained mount;
- full Editor/save/conflict behavior;
- right plain/background/history;
- shared menu and Board click guards;
- both drag directions/reorder/cancel/private MIME;
- resize/hide/overlay/focus/accessibility;
- rename/delete/root/duplicate/reload safety.

If any requirement lacks proof, write its failing test first, run red, implement the smallest correction, and commit it under the owning leaf before continuing.

- [ ] **Step 3: Run every focused suite from a clean command invocation**

```bash
npx vitest run \
  desktop/src/main/store.test.ts \
  desktop/src/main/ipc/window.test.ts \
  desktop/src/main/windows.test.ts \
  desktop/src/main/ipc/fs.test.ts \
  client/src/lib/storage.test.ts \
  client/src/lib/renameContinuity.test.ts \
  client/src/workspace/useWorkspace.test.tsx \
  client/src/workspace/useWorkspace.history.test.tsx \
  client/src/workspace/pageDrag.test.ts \
  client/src/right-panel/RightPanel.test.tsx \
  client/src/tabs/TabBar.test.tsx \
  client/src/views/view/PageContextMenu.test.tsx \
  client/src/views/view/TableView.test.tsx \
  client/src/views/view/BoardView.test.tsx \
  client/src/views/view/GroupDrag.test.tsx \
  client/src/editor/Editor.test.tsx \
  client/src/App.test.tsx
```

Expected: all focused files and tests PASS.

- [ ] **Step 4: Run fresh global verification**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run build
git diff --check
git status --short
```

Expected: typecheck exit 0; all test files/tests pass; production build exits 0; no whitespace errors; only intended tracked changes remain.

- [ ] **Step 5: Inspect the built UI non-disruptively before the user demo**

Launch an isolated dev instance only if it can use a dedicated user-data profile and does not take over Yasin's normal app. Use pointed Computer Use for a minimal smoke or leave the full interaction for Task 14. Do not use Playwright.

- [ ] **Step 6: Attach evidence and keep YAZ-1276 In Progress for YAZ-1279**

Post commands, exit codes, test counts, build result, commit, and any fixed bug. Automated proof can be complete, but YAZ-1276 remains In Progress until the required user demo result is recorded.

---

### Task 12: Perform the read-only anti-slop audit (YAZ-1277)

**Files:**
- Read-only inspection of every touched source/test/contract file
- No edits in this task

- [ ] **Step 1: Move YAZ-1277 to In Progress**

YAZ-1269 is already In Progress. Comment that this pass changes no code.

- [ ] **Step 2: Inspect architecture and correctness**

Check:

- exactly one workspace owner and no leftover active `useTabs` hook;
- no duplicate right/file/watch/index/sync/autosave implementation;
- one identity mirror per logical action and no per-pixel writes;
- buffer handoff only on real ownership changes;
- StrictMode-safe effects and listener cleanup;
- rename/delete/root paths repair current, mounted, expanded, and histories;
- no hidden Editor can retain focus or pointer input;
- wrong MIME/Board drag cannot enter workspace transfers.

- [ ] **Step 3: Inspect code quality and UX finish**

Check for duplicated branches, unnecessary helpers/components, unstable callbacks, excessive comments, misleading names, dead props, CSS leakage, hard-coded light colors, narrow slivers, unclear icons/labels, overflow, resize cursor cleanup, deterministic focus, and empty/loading/error states.

- [ ] **Step 4: Inspect tests and documentation**

Require invariant assertions rather than CSS snapshots alone. Confirm every behavior in the design and YAZ-1279 demo has a direct automated or manual proof. Check `docs/CONTRACTS.md` against current code.

- [ ] **Step 5: Post the classified audit comment**

For each finding, include:

```text
Severity: high | medium | low
Classification: apply | defer | no change
Evidence: exact reproduction/test
Location: exact file and line
Why it matters: concrete correctness/clarity/UX effect
Smallest correction: bounded change
```

Explicitly state when a lens has no finding. Do not invent work. Mark YAZ-1277 Done after the comment is verified.

---

### Task 13: Apply justified audit findings and re-prove (YAZ-1278)

**Files:**
- Modify only files named by YAZ-1277 `apply` findings
- Test the exact affected behavior first

- [ ] **Step 1: Move YAZ-1278 to In Progress**

Copy only `apply` findings into its comment checklist. Record rationale for every `defer`, `no change`, or rejected finding.

- [ ] **Step 2: For each correctness finding, write or strengthen the failing test first**

Run the smallest named test and see the issue fail. Do not batch unrelated findings behind one broad test.

- [ ] **Step 3: Apply the smallest correction**

Prefer deletion, consolidation, direct reuse, stable ownership, and clearer names. Do not add a framework, new product mode, dependency, or unrelated refactor.

- [ ] **Step 4: Run each affected suite immediately**

Use the exact test file/test name from the finding. Expected: PASS.

- [ ] **Step 5: Re-run complete verification after all findings**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit polish and reconcile every finding**

```bash
git add -u
git commit -m "polish: finalize right panel"
```

Post an applied/deferred/rejected/no-change table plus verification evidence. Mark YAZ-1278 Done only after every audit item is reconciled.

---

### Task 14: Build the isolated Desktop demo and wait for Yasin (YAZ-1279)

**Files/artifacts:**
- Create: `desktop/src/main/userData.ts`
- Test: `desktop/src/main/userData.test.ts`
- Modify: `desktop/src/main/index.ts`
- Create: `/Users/yasin/Desktop/YAZ-966-right-panel-demo/`
- Create: focused markdown fixtures and `README.md` inside that demo folder
- Create/use: dedicated Electron user-data profile outside the normal Yaseen Docs profile
- Do not commit the Desktop fixture folder to the repository

- [ ] **Step 1: Move YAZ-1279 to In Progress**

Comment the exact final feature commit that the demo will run.

- [ ] **Step 2: Create the focused demo vault with recoverable file edits**

Use `apply_patch` to add:

```text
YAZ-966-right-panel-demo/
├── README.md
├── Home.md
├── Alpha.md
├── Beta.md
├── Very Long Page Name That Exercises Header Truncation.md
├── Folder A/
│   ├── Same Name.md
│   └── Deep Link Target.md
├── Folder B/
│   └── Same Name.md
├── Board.md
├── Board Members/
│   ├── Direct.md
│   ├── Nested.md
│   ├── Repeated.md
│   └── Hidden Title.md
├── Table.md
├── Rename Me.md
└── Delete Me.md
```

`README.md` gives the exact numbered walkthrough. `Home.md`, Alpha/Beta, and deep targets contain cross-links sufficient for right plain, Command-click, Back, and Forward. Board/Table folder pages use the repository's current `folder_page_settings` schema and real member frontmatter, including direct/nested/repeated/hidden-title cases.

- [ ] **Step 3: Verify fixture bytes and structure**

```bash
find /Users/yasin/Desktop/YAZ-966-right-panel-demo -type f -maxdepth 4 | sort
rg -n "folder_page|folder_pages|\[\[" /Users/yasin/Desktop/YAZ-966-right-panel-demo
```

Expected: only focused demo files; every intended link/member declaration is present.

- [ ] **Step 4: Write the failing isolated-profile guard test**

Keep the seam pure and test both sides:

```ts
it('does nothing when the override is absent or blank', () => {
  const app = { setPath: vi.fn() }
  applyUserDataOverride(app, undefined)
  applyUserDataOverride(app, '   ')
  expect(app.setPath).not.toHaveBeenCalled()
})

it('sets only the userData path when an override is present', () => {
  const app = { setPath: vi.fn() }
  applyUserDataOverride(app, '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile')
  expect(app.setPath).toHaveBeenCalledWith('userData', '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile')
})
```

Run:

```bash
npx vitest run desktop/src/main/userData.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 5: Implement the opt-in profile seam before storage initialization**

Create:

```ts
export interface UserDataPathOwner {
  setPath(name: 'userData', path: string): void
}

export function applyUserDataOverride(app: UserDataPathOwner, value: string | undefined): void {
  const path = value?.trim()
  if (path !== undefined && path !== '') app.setPath('userData', path)
}
```

In `desktop/src/main/index.ts`, immediately after `app.setName('Yaseen Docs')` and before the single-instance lock/store construction, add:

```ts
applyUserDataOverride(app, process.env.YASEEN_DOCS_USER_DATA_DIR)
```

No environment variable means production behavior is byte-for-byte unchanged. Verify:

```bash
npx vitest run desktop/src/main/userData.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit and launch the exact isolated demo**

```bash
git add desktop/src/main/index.ts desktop/src/main/userData.ts desktop/src/main/userData.test.ts
git commit -m "chore: support isolated desktop demo profiles"
git push
YASEEN_DOCS_USER_DATA_DIR=/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile npm run dev
```

Open this vault in the launched app:

```text
/Users/yasin/Desktop/YAZ-966-right-panel-demo
```

Leave that branch dev app running. Do not use Playwright or the normal profile.

- [ ] **Step 7: Give Yasin the exact manual checklist and wait**

Checklist:

1. Show/hide the empty panel; reopen it.
2. Open Alpha, Beta, the long title, and both Same Name pages; confirm compact headers and one expanded Editor.
3. Drag the divider, cross the hide threshold, reopen, narrow the app to overlay, then widen back to split.
4. Edit Alpha, switch to Beta and back, use undo, and confirm the save survives.
5. Use plain links, Command-click, Back, and Forward inside right.
6. Use Table right-click and Board right-click/primary click; confirm Table editing and Board group drag/preview remain normal.
7. Drag a main tab into exact right positions, reorder right headers, drag one back to an exact main slot, then cancel an outside/Escape drag.
8. Reload/duplicate the isolated window and confirm independent restored right state.
9. Rename Rename Me and delete Delete Me; confirm no stale item or recreated old file.

Wait for Yasin's response. Do not merge `main` before he reports the result.

- [ ] **Step 8: Fix and relaunch any failed case**

For every failure: reproduce with a focused test, run red, implement the bounded fix, run focused/full verification, commit/push, rebuild/relaunch the isolated app at the new commit, and ask Yasin to retest that step.

- [ ] **Step 9: Attach demo evidence and complete verification issues**

Comment exact demo path, isolated profile/launch command, branch commit, checklist, Yasin's result, and any follow-up commits. Mark YAZ-1279 and YAZ-1276 Done after approval. Mark YAZ-1269 Done when YAZ-1277 and YAZ-1278 are also Done.

---

### Task 15: Final branch verification, push, merge, and Linear closeout

**Files:**
- No new behavior
- Git/Linear state only

- [ ] **Step 1: Re-read the completion contract against current evidence**

Confirm every explicit requirement in the design, all 16 descendants, the anti-slop reconciliation, and Yasin's demo result. Missing or indirect evidence means continue working.

- [ ] **Step 2: Run final fresh verification after the demo-approved commit**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run build
git diff --check
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: all commands green; worktree clean; only intended feature commits ahead of current `origin/main`.

- [ ] **Step 3: Rebase/merge latest main safely if it advanced**

Fetch and inspect before integrating:

```bash
git fetch origin main
git log --oneline --left-right HEAD...origin/main
```

If main advanced, merge `origin/main` into the feature branch, resolve only feature-overlapping conflicts, then repeat Step 2. Do not discard unrelated user changes.

- [ ] **Step 4: Push the final feature branch**

```bash
git push origin codex/yaz-966-right-panel
```

- [ ] **Step 5: Merge to main and push main**

From the clean main checkout after confirming it has no user changes:

```bash
git pull --ff-only origin main
git merge --no-ff codex/yaz-966-right-panel -m "Merge YAZ-966 right panel"
git push origin main
```

If the main checkout is dirty or non-fast-forward, stop and resolve safely rather than resetting.

- [ ] **Step 6: Verify remote main contains the feature**

```bash
git fetch origin main
git merge-base --is-ancestor codex/yaz-966-right-panel origin/main
git log -1 --oneline origin/main
```

Expected: ancestor check exits 0; remote main shows the merge/result commit.

- [ ] **Step 7: Close Linear accurately**

Attach final main commit, test counts, build, demo result, and audit reconciliation to YAZ-966. Mark any remaining completed leaves/parents Done bottom-up. Re-query the entire tree and prove every record's state, parentage, and completion comment.

- [ ] **Step 8: Complete the active Codex goal**

Only after remote main, Linear, verification, audit, and demo evidence all prove the objective, mark the goal complete and report the final outcome.
