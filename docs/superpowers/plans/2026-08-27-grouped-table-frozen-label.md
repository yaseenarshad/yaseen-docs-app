# Grouped Table Frozen Label Implementation Plan

> **Linear:** YAZ-742 → YAZ-1043 → YAZ-1044 / YAZ-1045 / YAZ-1046

**Goal:** Keep the complete group-header control cluster horizontally visible at the left edge of a grouped Table while its property columns scroll.

**Architecture:** Preserve the existing single `<td colSpan={keys.length}>` group row. Give that Table-owned cell a local class, then make its existing direct `.view-group` child horizontally sticky at the cell's 8px padding edge. This does not touch the shared `GroupHeader`, frozen-column persistence, keyboard cells, grouping state, or non-Table views.

**Stack:** React, TypeScript, CSS sticky positioning, Vitest/Testing Library, Playwright Electron E2E.

## Task 1: Lock the latest-main scope

**Files:**
- Inspect: `client/src/views/view/TableView.tsx:241-252`
- Inspect: `client/src/views/views.css:441-449,597-606`
- Inspect: `client/src/views/view/TableGroups.test.tsx:156-180`
- Inspect: `desktop/e2e/freezeColumns.spec.ts:1-163`
- Create: `docs/superpowers/plans/2026-08-27-grouped-table-frozen-label.md`

1. Confirm `main`, `origin/main`, and the worktree base all resolve to `1aefd07305a4efb26cc854394298dc86763738bf`.
2. Run `npm test`; require the clean baseline of 161 files / 2,243 tests.
3. Record in YAZ-1044 that the approved design still fits latest main and has no unresolved architecture choice.
4. Mark YAZ-1044 Done and start YAZ-1045.

## Task 2: Add the failing structural contract

**Files:**
- Modify: `client/src/views/view/TableGroups.test.tsx:176-180`

Add this assertion before the existing non-data/non-frozen assertions:

```ts
const groupCell = q<HTMLTableCellElement>(headers(el)[0], 'td')
expect(groupCell.colSpan).toBe(2)
expect(groupCell.classList.contains('view-table__group-cell')).toBe(true)
```

Run:

```bash
npm test -- client/src/views/view/TableGroups.test.tsx
```

Expected RED: the group `<td>` lacks `view-table__group-cell`.

## Task 3: Implement the smallest Table-scoped sticky marker

**Files:**
- Modify: `client/src/views/view/TableView.tsx:241`
- Modify: `client/src/views/views.css:597-606`

Change the group cell:

```tsx
<td className="view-table__group-cell" colSpan={keys.length}>
```

Add before the shared `.view-group` rule:

```css
.view-table__group-cell {
  overflow: visible;
}

.view-table__group-cell > .view-group {
  position: sticky;
  left: 8px;
  width: fit-content;
  max-width: 100%;
}
```

Run the focused test again and require GREEN. The group-cell override prevents the generic `td { overflow: hidden }` rule from becoming the sticky child's inert scroll container; the child still owns bounded overflow. The direct-child Table selector keeps Board, Cards, and List unchanged, and `left: 8px` matches the existing Table cell horizontal padding.

## Task 4: Extend the dedicated desktop scroll proof

**Files:**
- Modify: `desktop/e2e/freezeColumns.spec.ts:10-13,36-48,149-163`

1. Import `writeFile` and `setFrontmatterProperty`.
2. Add `groupBy?: { property: string; direction?: 'ASC' | 'DESC' }` to `OnDiskView`.
3. Add `updateTableSettings(update)` that reads `KPIs.md`, finds its Table view, applies the update, and writes the existing whole `folder_page_settings` value through `setFrontmatterProperty`.
4. Add serial step 4 after the persistence test:
   - restore the four-column order;
   - set `groupBy` to `note.kpi_category ASC`;
   - delete `frozenColumns`;
   - relaunch and open Table;
   - assert zero `.view-table__frozen` cells;
   - assert the first `.view-table__group-cell > .view-group` computes to `position: sticky; left: 8px`;
   - set `scrollLeft = 120`, prove the wrapper actually moved beyond 100px, then compare the cluster's bounding-box X and require less than 1px movement;
   - quit cleanly.
5. Run only E2E discovery, not foreground Playwright:

```bash
npx playwright test desktop/e2e/freezeColumns.spec.ts --list
```

Expected: four tests discovered.

## Task 5: Document the contract

**Files:**
- Modify: `README.md:76`
- Modify: `docs/CONTRACTS.md:472`

Extend the user-facing sentence to say grouped section controls stay visible at the Table's left edge while columns scroll. Extend the durable Table contract to distinguish sticky inner group content from real frozen property cells: the full-span row remains ordinary and independent of `frozenColumns`.

## Task 6: Verify YAZ-1045

Run:

```bash
npm test -- client/src/views/view/TableGroups.test.tsx client/src/views/view/TableView.test.tsx client/src/views/view/Toolbar.test.tsx client/src/views/view/frozenColumns.test.ts
npm run typecheck
npm run build
git diff --check
npx playwright test desktop/e2e/freezeColumns.spec.ts --list
```

Record exact results and implementation gotchas in YAZ-1045, then mark it Done and start YAZ-1046.

## Task 7: Polish and anti-slop

**Files:**
- Review: every changed file
- Modify: only files with a recorded must/should finding

1. Review without editing first: selector scope, overflow/clipping, padding alignment, responsive max-width, controls/summaries moving as one cluster, drop/hover layering, test intent, documentation accuracy, and absence of duplicated state.
2. Comment must/should/skip findings in YAZ-1046.
3. Apply only must/should corrections. Do not add a shadow/divider, z-index system, scroll listener, state owner, split table, reusable abstraction, shared `GroupHeader` change, or unrelated formatting churn.
4. Run fresh final gates:

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short
```

5. Inspect the final diff, comment evidence in YAZ-1046, and mark it Done only when no must/should item remains.

## Task 8: Integrate and close

1. Commit the bounded plan, source, tests, and docs with YAZ-742 in the message.
2. Push `codex/yaz-742-group-label-freeze`.
3. Refresh `main`, merge the feature branch with an explicit merge commit, rerun the final gates on the merge result, push `main`, and verify local/remote SHAs match.
4. Confirm the feature commit is an ancestor of remote main, then remove only this worktree and its local/remote feature refs.
5. Add final evidence/handoff comments to YAZ-1046, YAZ-1043, and YAZ-742; mark YAZ-1043 and YAZ-742 Done; verify all statuses from scratch.
