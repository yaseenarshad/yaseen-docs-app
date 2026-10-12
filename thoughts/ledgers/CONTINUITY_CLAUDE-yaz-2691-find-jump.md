# YAZ-2691 — CMD+F jumps to the match in a very tall paragraph

## Goal
- CMD+F puts the active match in the middle of the window in a note of any size.
- A phrase that wraps over a soft line end is found.
- A zoom brings an off-screen caret to the middle, also in a very tall paragraph.
- Done = the four gates are green, the check in the real app passes, the pull request is merged, release 1.0.3 is out with notes.

## Constraints
- No Playwright on this Mac: it takes over the screen. The e2e spec is written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- A check in the real app runs out of sight: the app starts with `open -g`, its own profile and a demo vault, the window gets opacity 0, and the DevTools protocol drives it.
- Linear: the main issue's comments are for humans. Agent records go on the working log YAZ-2692 and on the subissues.
- Commits through the `/commit` skill (no Claude attribution).

## Key Decisions
- D1: `scrollToActive` centres the element with `find-match--active`, not the block. Fallback: the block, when no highlight is in the DOM. Restores the contract of YAZ-967.
- D2: in `textRuns`, a `hardbreak` with `isInline` (a soft line break) reads as one space and continues the run. A real hard break stays a gap. One block at a time stays (YAZ-967).
- Found in the run (YAZ-2697): the zoom's off-screen branch in `Editor.tsx` centred the caret's block. It now uses the same scroll math as the on-screen branch, with the middle as the target.
- Rejected: own scroll math for find (YAZ-1169 rejected it for the bar), a match across paragraphs.
- Not fixed: a one-letter query paints thousands of highlights (56–81 ms for ~5,500 on a 1,500-line paragraph). Tracked in the Backlog.

## State
- Done:
  - [x] Scope, decisions and scenarios J1–J10, M1–M12 locked on YAZ-2692
  - [x] 1 (YAZ-2693) the fix and two unit tests
  - [x] 2 (YAZ-2694) gates, e2e step, check in the real app (before: 3,600 px off; after: 0 px off)
  - [x] 2A (YAZ-2697) the zoom caret (before: 5,160 px off; after: 0 px off)
  - [x] 3 (YAZ-2695) polish: `docs/CONTRACTS.md` zoom line, one simpler condition
  - [x] 4 (YAZ-2696) merged to `main` by pull request #108 (`665eac4`); release 1.0.3 is the commit after this one
- Now: closed. The handoff is on YAZ-2692.
- Next: nothing. YAZ-2698 (a one-letter query on a very large note) is in the Backlog.

## Open Questions
- UNCONFIRMED: a match inside a CodeMirror code block paints no highlight. The fallback to the block covers both cases.

## Working Set
- Branch `fix/yaz-2691-find-jump` from `main` at `301eec4`, merged by #108. The worktree is removed.
- `client/src/editor/find/findInPage.ts` (`textRuns`, `scrollToActive`), `client/src/editor/find/findInPage.test.ts`
- `client/src/editor/Editor.tsx` (the zoom layout effect), `client/src/editor/Editor.test.tsx`
- `desktop/e2e/findInPage.spec.ts` (the tall-paragraph step, not run), `docs/CONTRACTS.md`
- Gates at the end: typecheck green; 316 files / 6424 tests green; build green; budget PASS with no ceiling change.
- A local `node_modules` that is older than the lockfile fails 4 tests (`listItemCaretRestore`, `tooltipThrottle`): the vendored Milkdown patches are missing. `npm ci` fixes it.
