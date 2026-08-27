# Hide Table Filename Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a folder-page Table view hide and restore `file.name` through the existing Properties menu and `view.order`, while preserving every non-table view.

**Architecture:** Keep `view.order` as the sole visibility and ordering contract. Change only the Table-specific disabled state in `PropertiesMenu`, prove the behavior through the existing `ViewsPane` integration harness, and reconcile the component/documentation contract without introducing state, helpers, migrations, or a second write path.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 3, jsdom, YAML-backed folder-page settings.

---

### Task 1: Reconfirm the approved execution boundary

**Files:**
- Read: `client/src/views/view/PropertiesMenu.tsx:36-112`
- Read: `client/src/views/engine.ts:288-294`
- Read: `client/src/views/view/TableView.tsx`
- Read: `client/src/views/view/Toolbar.test.tsx:231-260`
- Read: `docs/CONTRACTS.md:468`

- [ ] **Step 1: Confirm the isolated baseline**

Run:

```bash
git status --short --branch
git log -1 --oneline --decorate
npm test -- --run client/src/views/view/Toolbar.test.tsx client/src/views/view/TableView.test.tsx client/src/views/engine.test.ts
```

Expected: branch `codex/yaz-1007-hide-file-name`, no unintended changes, starting commit `391d9a6`, and 90 focused tests passing.

- [ ] **Step 2: Confirm no architecture drift**

Verify directly in the source:

```typescript
// engine.ts: an explicit order remains authoritative.
if (view.order) return [...view.order]

// TableView.tsx: no filename column is already represented safely.
const nameCol = keys.findIndex((k) => canonicalKey(k) === 'file.name')
```

Expected: no engine, renderer, schema, or migration change is needed. YAZ-1006 remains layout/CSS-only overlap.

- [ ] **Step 3: Record the scope result in Linear**

Add the current-main commit, focused baseline, overlap boundary, and “no material decisions remain” conclusion to YAZ-1017; then move YAZ-1017 to Done and YAZ-1019 to In Progress while keeping parent YAZ-1007 In Progress.

### Task 2: Write the failing Table visibility regression

**Files:**
- Modify: `client/src/views/view/Toolbar.test.tsx:231-260`
- Test: `client/src/views/view/Toolbar.test.tsx`

- [ ] **Step 1: Replace the old always-visible assertion with the approved behavior**

Use the existing `mount`, `openMenu`, `byLabel`, `click`, and `q` helpers:

```typescript
it('a table can hide and re-show file.name through view.order', () => {
  const { el, onChange, def } = mount()
  const pop = openMenu(el, 'Properties')
  const name = byLabel<HTMLInputElement>(pop, 'Show file.name')
  expect(name.checked).toBe(true)
  expect(name.disabled).toBe(false)

  click(byLabel(pop, 'Show status'))
  expect(def().views[0].order).toEqual(['file.name', 'note.status'])
  expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')

  click(byLabel(pop, 'Show file.name'))
  expect(def().views[0].order).toEqual(['note.status'])
  expect([...el.querySelectorAll('.view-table thead th')].map((th) => th.textContent)).toEqual(['status'])
  expect(q(el, '[data-cell="0:0"]').textContent).toBe('idea')
  expect(el.querySelector('.view-table__link')).toBeNull()

  click(byLabel(pop, 'Show file.name'))
  expect(def().views[0].order).toEqual(['note.status', 'file.name'])
  expect([...el.querySelectorAll('.view-table thead th')].map((th) => th.textContent)).toEqual(['status', 'file.name'])
  expect(el.querySelector('.view-table__link')).not.toBeNull()
  expect(onChange).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 2: Add the non-table regression**

```typescript
it.each(['cards', 'list', 'board'])('keeps file.name disabled in %s views', (type) => {
  const { el } = mount(`views:\n  - type: ${type}\n    name: V\n`)
  expect(byLabel<HTMLInputElement>(openMenu(el, 'Properties'), 'Show file.name').disabled).toBe(true)
})
```

- [ ] **Step 3: Add the last-visible-column regression**

```typescript
it('allows an empty table order and keeps Properties available to restore file.name', () => {
  const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
  const pop = openMenu(el, 'Properties')
  click(byLabel(pop, 'Show file.name'))
  expect(def().views[0].order).toEqual([])
  expect(el.querySelector('.view-table thead th')).toBeNull()
  expect(byLabel<HTMLInputElement>(pop, 'Show file.name').checked).toBe(false)
  click(byLabel(pop, 'Show file.name'))
  expect(def().views[0].order).toEqual(['file.name'])
})
```

- [ ] **Step 4: Run the tests and verify RED**

Run:

```bash
npm test -- --run client/src/views/view/Toolbar.test.tsx
```

Expected: the new Table tests fail because `Show file.name` is still disabled; the non-table cases pass.

### Task 3: Implement the minimal Table-only behavior

**Files:**
- Modify: `client/src/views/view/PropertiesMenu.tsx:36-38`
- Modify: `client/src/views/view/PropertiesMenu.tsx:106-112`
- Test: `client/src/views/view/Toolbar.test.tsx`

- [ ] **Step 1: Make only the approved production change**

```tsx
<input
  type="checkbox"
  aria-label={`Show ${label}`}
  checked={on}
  disabled={canonicalKey(key) === 'file.name' && view.type !== 'table'}
  onChange={() => toggle(key)}
/>
```

- [ ] **Step 2: Correct the component contract**

Replace the stale opening sentence with:

```typescript
/**
 * Properties menu (GRO-2135): shown ⇄ hidden checklist (writes `view.order`; tables may hide
 * `file.name`, while other view types keep their existing checkbox behavior), up/down to reorder,
 * pencil to set `def.properties[key].displayName`.
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --run client/src/views/view/Toolbar.test.tsx
```

Expected: all Toolbar tests pass with no new warning or unhandled error.

- [ ] **Step 4: Run the adjacent regression set**

Run:

```bash
npm test -- --run client/src/views/view/Toolbar.test.tsx client/src/views/view/TableView.test.tsx client/src/views/engine.test.ts
```

Expected: all focused tests pass.

### Task 4: Reconcile durable documentation and polish the diff

**Files:**
- Modify: `docs/CONTRACTS.md:468`
- Review: `client/src/views/view/PropertiesMenu.tsx`
- Review: `client/src/views/view/Toolbar.test.tsx`

- [ ] **Step 1: Replace the stale contract clause**

Replace:

```markdown
`file.name` cannot be hidden — it is the row link
```

with:

```markdown
Table views may hide `file.name`; Cards, Board, and List keep their existing filename/title behavior
```

- [ ] **Step 2: Run the anti-slop review**

Verify the complete diff contains:

- one production condition change;
- behavior-level tests for hide, exact order/render, restore, last-column behavior, and non-table protection;
- only the two necessary contract-text updates;
- no helper, state, schema, migration, CSS, debug output, unrelated refactor, or package-lock drift.

Run:

```bash
git diff --check
git diff -- client/src/views/view/PropertiesMenu.tsx client/src/views/view/Toolbar.test.tsx docs/CONTRACTS.md
```

Expected: `git diff --check` exits 0 and the diff matches the approved boundary.

- [ ] **Step 3: Record implementation rationale and gotchas in Linear**

Comment on YAZ-1019 with the red/green evidence, changed files, YAZ-1006 merge boundary, and any gotchas. Then move YAZ-1019 to Done and YAZ-1020 to In Progress while keeping YAZ-1007 In Progress.

### Task 5: Verify, commit, push, merge, and close Linear

**Files:**
- Verify: all intended changed files
- Commit: `docs/superpowers/plans/2026-08-27-hide-table-file-name.md`
- Commit: `client/src/views/view/PropertiesMenu.tsx`
- Commit: `client/src/views/view/Toolbar.test.tsx`
- Commit: `docs/CONTRACTS.md`

- [ ] **Step 1: Run final automated verification**

Run:

```bash
npm test -- --run client/src/views/view/Toolbar.test.tsx client/src/views/view/TableView.test.tsx client/src/views/engine.test.ts
npm run typecheck
npm test
git diff --check
git status --short --branch
```

Expected: focused tests and typecheck pass. All assertions in the full suite pass; compare any pre-existing Milkdown timer teardown errors and React warnings against the recorded clean baseline rather than claiming the runner is pristine.

- [ ] **Step 2: Perform the final anti-slop evidence pass**

Re-read the YAZ-1007 parent proposal, decision record, and all three child descriptions. Confirm every acceptance criterion is implemented or explicitly evidenced, and add exact commands/results plus changed-file list to YAZ-1020.

- [ ] **Step 3: Commit and push the feature branch**

```bash
git add docs/superpowers/plans/2026-08-27-hide-table-file-name.md
git commit -m "docs: plan table filename visibility"
git add client/src/views/view/PropertiesMenu.tsx client/src/views/view/Toolbar.test.tsx docs/CONTRACTS.md
git commit -m "feat: allow hiding table filename columns"
git push -u origin codex/yaz-1007-hide-file-name
```

Expected: two focused commits on the feature branch, pushed without attribution.

- [ ] **Step 4: Merge into current main and push**

From the primary checkout:

```bash
git pull --ff-only origin main
git merge --no-ff codex/yaz-1007-hide-file-name
npm test -- --run client/src/views/view/Toolbar.test.tsx client/src/views/view/TableView.test.tsx client/src/views/engine.test.ts
npm run typecheck
git push origin main
```

Expected: merge succeeds without losing YAZ-1006 if it landed first; focused tests and typecheck pass on merged `main`; `origin/main` advances.

- [ ] **Step 5: Close Linear with evidence**

Move YAZ-1020 to Done after its evidence comment. Then add a final parent comment containing commits, verification, accepted baseline warnings, merge result, and no remaining decisions; move YAZ-1007 to Done only after pushed `main` is verified.
