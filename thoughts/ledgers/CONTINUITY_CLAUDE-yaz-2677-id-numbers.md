# YAZ-2677 — ID system modification (number IDs)

## Goal
A vault opens with no question about IDs; a note's ID is `LETTERS-NUMBER` (`YAZ-2648`); numbers count up
with no server on one Mac or two; a clash of two Macs fixes itself. Done = sub-issues YAZ-2678..YAZ-2687
are Done, the scenario record S1–S92 on YAZ-2677 holds, `npm run typecheck`, `npm test`, `npm run build`
and `npm run perf:budget:ci` pass, the hand walk passed, and the branch is merged to `main`.

## Constraints
- Decisions D1–D9, rules R1–R34 and cases S1–S92 are LOCKED in the YAZ-2677 comments. Execute, do not reopen.
- No Playwright, never start Electron, never open a real vault. TDD.
- Commits through the `/commit` skill (no Claude attribution). No release.
- Delivery: open the pull request and STOP. Yaseen does the hand walk; merge only after he says it passed.
- Yaseen gave his OK (2026-10-08) to raise a size ceiling for this work: only to the measured number.
- Two other sessions: `yaseen-docs-app-yaz-2662` (search keys) and `-yaz-2663` (new tab page). Do not touch them.

## Key Decisions
- Rejected in scoping: hidden random ID + label, time-based IDs, seats per Mac, blocks claimed on GitHub.
- Agent-set details (not shown to Yaseen as decisions; tell him): R11 default letters, the "Finish" button of a
  stopped letters change (S83), the backfill as a Settings row ordered by file creation time (S88–S89).

## State
- Done:
  - [x] Scoping; decisions, rules, scenarios and the before state locked on YAZ-2677
  - [x] Sub-issues YAZ-2678..YAZ-2687 created
- Now: [→] Phase A (issues 1+2, this worktree) and Phase B (issues 3+4, worktree `-yaz-2677-b`) in parallel
- Next: merge B into this worktree
- Remaining:
  - [ ] Phase C: issues 5+6 (duplicates, outside files)
  - [ ] Phase D: issues 7+8 (change letters, backfill)
  - [ ] Issue 9: polish and anti-slop
  - [ ] Issue 10: gates, case list, e2e spec (typecheck only), docs, pull request, hand-walk setup

## Open Questions
- UNCONFIRMED: the picker's "Create" row must wait for the number (S35, S36) — what the editor does on typing in the wait.
- UNCONFIRMED: whether the link rewrite of `client/src/links/renameLinks.ts` can be shared with the main process.

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2677`, branch `yaz-2677-id-numbers`, from `main` at `dd8d89b`
- Second worktree for Phase B: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2677-b`, branch `yaz-2677-b`
- Gates at the start commit: typecheck green; 306 files / 5952 tests green; budget PASS (eager JS 2.01 MB, CSS 0.15 MB, total 13.15 MB, main 0.53 MB — each equal to its ceiling)
- Linear helper: scratchpad `lin.py` (get / comment / create / move), key in `~/Desktop/growprofit-ai.env`
