# Folder-page column YAML propagation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make folder-page declarations populate missing YAML keys on direct members while permanently preserving page-owned values across retype, removal, move, and rejoin.

**Architecture:** One `backfillFolderPageColumns` operation writes only absent exact keys using a latest-bytes conditional writer. `FolderPageContents` owns the normal reconciliation invariant; Topics moves call the same operation for a target that may be closed. New-page and existing-page initialization share one empty-value function.

**Tech Stack:** TypeScript, React, Vitest/jsdom, Electron/Playwright, YAML frontmatter bridge.

---

### Task 1: Add a latest-bytes missing-only property writer

**Files:**
- Modify: `client/src/views/writeProperty.test.ts`
- Modify: `client/src/views/writeProperty.ts`

- [ ] **Step 1: Write failing tests for an absent key, every present/falsy value, and a conflict that adds the key**

```ts
it('writes an absent key', async () => {
  readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
  writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 1 })
  await writePropertyIfMissing(PATH, 'score', null)
  expect(writeFile.mock.calls[0]?.[0].content).toContain('score: null')
})

it.each([null, false, 0, '', [], 'wrong type'])('preserves a present value: %j', async (value) => {
  readFile.mockResolvedValue(file(buildFrontmatter({ score: value }) + 'Body\n', 100))
  await writePropertyIfMissing(PATH, 'score', 42)
  expect(writeFile).not.toHaveBeenCalled()
})

it('a concurrent writer adding the key wins after conflict', async () => {
  readFile
    .mockResolvedValueOnce(file('---\nstatus: draft\n---\n', 100))
    .mockResolvedValueOnce(file('---\nstatus: draft\nscore: 9\n---\n', 150))
  writeFile.mockRejectedValueOnce(conflict(150))
  await writePropertyIfMissing(PATH, 'score', null)
  expect(writeFile).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- client/src/views/writeProperty.test.ts`
Expected: FAIL because `writePropertyIfMissing` is not exported.

- [ ] **Step 3: Refactor the existing retry loop behind one transform helper and add `writePropertyIfMissing`**

```ts
type Transform = (content: string) => string

async function writeTransformed(path: string, transform: Transform): Promise<{ mtime: number }> {
  const file = await api.readFile(path)
  const content = transform(file.content)
  if (content === file.content) return { mtime: file.mtime }
  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime }
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = transform(fresh.content)
    if (merged === fresh.content) return { mtime: fresh.mtime }
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}
```

Presence is `Object.prototype.hasOwnProperty.call(parseFrontmatter(splitFrontmatter(content).frontmatter).properties, key)`. If parsing failed, call `setFrontmatterProperty` so its existing `FrontmatterWriteError` remains the write-path authority.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- client/src/views/writeProperty.test.ts`
Expected: all tests pass.

### Task 2: Create the canonical reconciliation service

**Files:**
- Modify: `client/src/views/scaffold.test.ts`
- Modify: `client/src/views/scaffold.ts`
- Create: `client/src/views/folderPageColumns.test.ts`
- Create: `client/src/views/folderPageColumns.ts`

- [ ] **Step 1: Write failing tests for the shared empty-value function**

```ts
expect(emptyColumnValue({ kind: 'list' })).toEqual([])
expect(emptyColumnValue({ kind: 'multi-link' })).toEqual([])
expect(emptyColumnValue({ kind: 'text' })).toBeNull()
expect(emptyColumnValue({ kind: 'number' })).toBeNull()
```

- [ ] **Step 2: Run the scaffold test and verify RED**

Run: `npm test -- client/src/views/scaffold.test.ts`
Expected: FAIL because `emptyColumnValue` is not exported.

- [ ] **Step 3: Export the helper and make scaffolding use it**

```ts
export function emptyColumnValue(column: ColumnDecl): unknown {
  return column.kind === 'list' || column.kind === 'multi-link' ? [] : null
}
```

- [ ] **Step 4: Write failing reconciliation tests**

Mock `writePropertyIfMissing`, then prove:

```ts
await backfillFolderPageColumns(
  [rec('/v/A.md', { kept: 0 }), rec('/v/B.md', {})],
  { kept: { kind: 'number' }, tags: { kind: 'list' } },
)
expect(write).toHaveBeenCalledWith('/v/A.md', 'tags', [])
expect(write).toHaveBeenCalledWith('/v/B.md', 'kept', null)
expect(write).toHaveBeenCalledWith('/v/B.md', 'tags', [])
expect(write).not.toHaveBeenCalledWith('/v/A.md', 'kept', expect.anything())
```

Also reject after all writes settle, with an error listing the failure count and affected `basename.key` pairs.

- [ ] **Step 5: Run the reconciliation test and verify RED**

Run: `npm test -- client/src/views/folderPageColumns.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement the minimal service and verify GREEN**

Use index presence only to skip obvious work. Each remaining call must use `writePropertyIfMissing` to protect against stale snapshots and races. Use `Promise.allSettled` so one bad page does not prevent the others.

Run: `npm test -- client/src/views/scaffold.test.ts client/src/views/folderPageColumns.test.ts client/src/views/writeProperty.test.ts`
Expected: all pass.

### Task 3: Reconcile every open folder page

**Files:**
- Modify: `client/src/views/FolderPageContents.test.tsx`
- Modify: `client/src/views/FolderPageContents.tsx`

- [ ] **Step 1: Mock the reconciliation service and write failing lifecycle tests**

Prove that the mounted folder page passes exactly `pagesIn(path)` and its current columns; a settings/member feed update calls it again; an ordinary page does not call it; and a rejection reaches the existing alert without taking down the view.

```ts
expect(backfill).toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ path: LEAD }), expect.objectContaining({ path: SALES })]),
  SETTINGS.columns,
)
expect(backfill.mock.calls[0]?.[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: OUTSIDER })]))
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- client/src/views/FolderPageContents.test.tsx`
Expected: FAIL because no reconciliation occurs.

- [ ] **Step 3: Add one effect with cancellation-safe error reporting**

The effect depends on `members` and `settings`. It does not clear unrelated errors and never writes teardown state.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- client/src/views/FolderPageContents.test.tsx`
Expected: all pass.

### Task 4: Reconcile a confirmed move into a closed target

**Files:**
- Modify: `client/src/sidebar/topicsMove.test.ts`
- Modify: `client/src/sidebar/topicsMove.ts`
- Modify: `client/src/sidebar/TopicsTree.test.tsx`
- Modify: `client/src/sidebar/TopicsTree.tsx`

- [ ] **Step 1: Write failing engine tests**

Pass target columns in the move target. Prove membership writes first, then the same child is reconciled; existing legacy values are left to the reconciliation service; a reconciliation error rejects so the sidebar notice can report it; and no property deletion is issued.

- [ ] **Step 2: Run the engine test and verify RED**

Run: `npm test -- client/src/sidebar/topicsMove.test.ts`
Expected: FAIL because `performMove` does not reconcile.

- [ ] **Step 3: Implement the closed-target call**

```ts
if (!unchanged(next, entries)) await writeProperty(child.path, FOLDER_PAGES_KEY, next)
await backfillFolderPageColumns([child], to.columns)
```

- [ ] **Step 4: Update the TopicsTree call/test with `folderPageSettings(move.target).columns`**

Run: `npm test -- client/src/sidebar/topicsMove.test.ts client/src/sidebar/TopicsTree.test.tsx`
Expected: all pass.

### Task 5: Integrate the executable and written contracts

**Files:**
- Modify: `desktop/e2e/folderPageColumns.spec.ts`
- Modify: `docs/CONTRACTS.md`

- [ ] **Step 1: Replace the old E2E “add touched nothing” snapshot**

After step 1, parse every member and assert `unit_notes` is present and null while all unrelated keys/body remain. Save this post-backfill byte snapshot. In step 2, assert retyping leaves that snapshot byte-identical. Do not change or add expectations to step 3's cell-activation gesture: YAZ-1030 owns the selection/double-click contract; YAZ-999 owns only the surrounding YAML assertions.

- [ ] **Step 2: Add one pre-existing value before launch and prove it survives reconciliation**

Seed a legacy value under an already-declared key in the copied fixture, then assert the initial reconciliation and the later new-column backfill preserve it. Do not seed the new key itself: existing note keys are already offered by the Properties menu, so the duplicate-name guard correctly refuses "+ Add column" for them.

- [ ] **Step 3: Update the folder-page contract text**

Document the hybrid triggers, latest-bytes missing check, direct-member boundary, source-of-truth-first sequencing, aggregated failures, retry-on-open, retention/rejoin, multi-parent sharing, and retype/removal non-migration.

- [ ] **Step 4: Run focused non-Playwright verification**

Run: `npm test -- client/src/views/writeProperty.test.ts client/src/views/scaffold.test.ts client/src/views/folderPageColumns.test.ts client/src/views/FolderPageContents.test.tsx client/src/sidebar/topicsMove.test.ts client/src/sidebar/TopicsTree.test.tsx`
Expected: all pass.

### Task 6: Verify, polish, and integrate

**Files:**
- Review every changed file from Tasks 1-5

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the single desktop E2E when it will not disrupt Yasin**

Run: `npx playwright test --config desktop/e2e/playwright.config.ts desktop/e2e/folderPageColumns.spec.ts`
Expected: the serial lifecycle passes. If automation would interfere, open the dev app and request the exact manual flow instead; record this limitation in Linear.

- [ ] **Step 3: Perform the YAZ-1012 audit before cleanup**

Inspect duplication, helper placement, effect churn, failure copy, stale comments, test brittleness, unused code, and scope creep. Record must-fix/should-simplify/consciously-keep findings in Linear before editing cleanup.

- [ ] **Step 4: Execute the approved YAZ-1013 cleanup and rerun verification**

Apply only the bounded audit list, then rerun the relevant focused tests, full suite, typecheck, build, and single E2E/manual verification.

- [ ] **Step 5: Commit, push, merge, and verify main**

Use specific-file staging and focused commits. Push `codex/yaz-999-folder-column-yaml`, fast-forward/merge into latest `main`, push `main`, and rerun the required verification on the merged commit before closing YAZ-999 and its children.
