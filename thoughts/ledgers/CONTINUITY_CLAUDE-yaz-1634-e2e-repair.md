# CONTINUITY — YAZ-1634 e2e repair (8 stale Playwright specs)

## Goal
- `npm run e2e` fully green again. Found while verifying YAZ-1628: 8 specs failed on main. 6 were spec drift, 2 were real product problems the stale specs had been hiding. Linear: YAZ-1634 (parent) → 1635 scope · 1636 specs · 1637 panel clamp · 1638 diff pairing · 1639 verify · 1640 polish.
- Done = 1636–1640 Done with comments, PR merged to main, handoff on every issue, NO release cut.

## Constraints
- Linear-Simpler; parent + child In Progress / Done as work moves. Playwright runs are headed on Yasin's screen — announce before each run. No release unless Yasin says so.

## Key Decisions (🔒 2026-09-15, diffs on YAZ-1635)
- D1 `.settings__panel` clamp: `max-height: calc(100vh - 48px); overflow-y: auto` (the `.document-zoom__menu` rule). Not a taller test window.
- D2 `diffDocs.diffNode`: one walk — trim `.eq()` ends, pair the middle index-wise (recurse through same markup), one insert/delete for the leftover. Not full LCS, not a narrowed contract.
- The six spec repairs: Group by ×4 → ColumnPicker click + `[role="option"][data-value="note.kpi_category"]`; pasteRoundTrip → readable plain text + `menu.edit.copy-markdown` block; topics → `'Open in default app'` in the list.

## State
- Done:
  - [x] 1- Scope (YAZ-1635): all 8 classified from artifacts; D1/D2 approved
  - [x] 2- specs `feefafa` · 3- panel clamp `349ce6e` · 4- diff pairing `c526372` (TDD: 3 of 4 new tests failed before, all pass after; 3963 total). Diffs reviewed by me — clean, minimal, mirror the surrounding code
  - [x] 2A- hidden drift (YAZ-1641) `7958c59`: basename titles (YAZ-1549), two-level Properties (YAZ-1513), contentWidth client-width yardstick (classic scrollbar = 15 px); numberedBullets step 5 = hover flake
  - [x] 5- verify (YAZ-1639): run 2 on `7958c59` **213 passed / 0 failed**; typecheck clean; vitest 3963
  - [x] 6- polish (YAZ-1640): nothing to trim; CONTRACTS needs no edit
  - [x] PR merged to main; handoff on every issue; worktree, branch removed
- Now: COMPLETE — nothing pending
- Next: none. Learning: a rotted spec fails at its FIRST stale line and hides the rest — budget a second pass. The e2e suite (~4 min, headed) is a per-merge check, not a per-edit one; the unit suite is the everyday check.

## Open Questions
- (resolved) `calc(100vh - 48px)` verified by `theme.spec.ts` at 750 px.

## Working Set
- Everything on main; worktree and branch removed
- Files: `desktop/e2e/{board,boardCardStyles,contentWidth,createUnderFolder,pasteRoundTrip,topics}.spec.ts`, `client/src/app.css`, `client/src/editor/external/{diffDocs.ts,applyExternal.test.ts}`
- Tests: `npx vitest run client/src/editor/external` · `npm run typecheck` · `npm run e2e` (headed)
- Artifacts of the failing run: main checkout `desktop/e2e/artifacts/runner/`
