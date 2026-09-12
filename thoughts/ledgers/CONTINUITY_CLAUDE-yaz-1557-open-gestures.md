# CONTINUITY — YAZ-1557 open gestures + YAZ-1556 menu order

## Goal
- One open rule for folder-page Table and Board: plain = current tab, ⌘ = background tab, ⌥ = right panel, ⇧/⌃ = nothing. Board cards select on click, arrows walk them, title/Enter open. Context menu ends with "Open in right panel".
- Done = YAZ-1569..1572 + YAZ-1556 Done, PR open on `yaz-1557-open-gestures`, demo vault on Desktop, Yasin's hand pass, then merge (no release).

## Constraints
- Shift stays the selection gesture (YAZ-1336 🔒 D2). ⌘-click = background tab (I3). ⌥ is now the right-panel key on folder-page views only.
- No Playwright on Yasin's screen. Dev app with isolated `--user-data-dir` for the hand pass.
- Tests first. Small diff (helper ~25, table ~6, board ~40, menu move). Commit via /commit. No version bump.

## Key Decisions
- D1 ⌥ = right panel (not ⇧) — locked on YAZ-1557.
- D2 click selects a card; title/Enter = current tab; arrows ↑↓ in column, ←→ across, clamped — locked on YAZ-1557.
- Implementing directly (no subagent): ~80 lines of precision UI code where I already hold every line.

## State
- Done:
  - [x] 1- Scope (YAZ-1568) — tree created, D1/D2 locked
  - [x] 2- openGesture helper + Table (YAZ-1569) — 9 helper tests, 2 table tests
  - [x] 3- Board (YAZ-1570) — select / modifiers / Enter / arrows, 4 new tests
  - [x] YAZ-1556 menu order — right panel last
  - [x] 4- Polish (YAZ-1571) — if/else, dedent, JSDoc; 3845 tests green, typecheck clean
  - [x] 5- docs: HotkeysPanel + test, CONTRACTS (3 spots), README bullet
  - [x] 5- demo vault `~/Desktop/open-gestures-demo/` (vault "Board & Table Open Gestures YAZ-1557", 23 pages, 8 views, 20 scenarios)
  - [x] 5- hand pass: all 20 scenarios passed (Yasin) · PR #49 merged to main `9afadb0`, NO version bump (batched); worktree, branch (local+remote), demo folder removed
  - [x] Handoff posted on YAZ-1557 + YAZ-1556 and on every child (YAZ-1568…1572); all Done
- Now: COMPLETE — nothing pending
- Next: none (follow-ups deliberately not done are listed in the YAZ-1557 handoff: ⌥ on sidebar rows/links, skip collapsed columns, Home/End, multi-select)

## Open Questions
- none

## Working Set
- Worktree `.claude/worktrees/yaz-1557-open-gestures`, branch `yaz-1557-open-gestures` from main f626046
- Files: `client/src/lib/openGesture.ts` (new), `views/view/BoardView.tsx`, `views/view/TableView.tsx`, `views/view/PageContextMenu.tsx`, `sidebar/HotkeysPanel.tsx`, `docs/CONTRACTS.md`, `README.md`, `client/src/app.css`
- Test: `/opt/homebrew/bin/npx vitest run client/src/views/view client/src/lib/openGesture.test.ts client/src/sidebar/HotkeysPanel.test.ts`
- Linear helper: scratchpad `state.py` (state | comment | create)
