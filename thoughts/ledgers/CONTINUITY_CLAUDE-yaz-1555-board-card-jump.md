# CONTINUITY — YAZ-1555 board view card jump on right-click

## Goal
- Scrolling the board (sideways) or the note (vertically) then right-clicking a card moves NOTHING. Cards still slide on real column/order changes. Vitest green, PR merged to main, demo vault + isolated dev app stress-tested by Yasin.

## Constraints
- 🔒 D1 (YAZ-1555 comment): measure FLIP rects in the root's CONTENT space (subtract root rect, add root scrollLeft/scrollTop). Rejected: dependency array on the effect.
- No Playwright this wave (Yasin). Verify via vitest + "go do this" script in an isolated dev app (`YASEEN_DOCS_USER_DATA_DIR`).
- Commit with the /commit skill. Linear: parent + subissue In Progress when started, Done when done. Learnings → Linear comments. No release tag.
- Linear tree: YAZ-1573 (1- scope) → YAZ-1574 (2- fix) → YAZ-1575 (3- verify demo) → YAZ-1576 (4- polish).

## Key Decisions
- D1 as above. Pure helper `flipRect` does the arithmetic so jsdom can pin "scroll is not motion".

## State
- Done:
  - [x] Scope comment + 4 subissues created (2026-09-12)
  - [x] YAZ-1573 1- red tests (3) in flip.test.ts; findings comment
  - [x] YAZ-1574 2- `flipRect` + content-space measurement in useFlip; 3834 tests + typecheck green
- Now: [→] YAZ-1575 3- demo at ~/Desktop/board-card-jump-demo (vault "Board Card Jump YAZ-1555", vault-pristine, profile, launch.sh, reset.sh, README); dev app for Yasin
- Remaining:
  - [ ] YAZ-1576 4- polish, PR, merge

## Open Questions
- UNCONFIRMED: reduced-motion check (needs a running app; do it on the demo app in 3-).

## Working Set
- Worktree: .claude/worktrees/yaz-1555-board-card-jump, branch yaz-1555-board-card-jump
- Files: client/src/views/view/flip.ts, flip.test.ts, docs/CONTRACTS.md
- Tests: `cd client && npx vitest run src/views/view/flip.test.ts`; full: `npm test` at root
