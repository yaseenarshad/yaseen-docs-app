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
  - [x] Issues 1+2 (pop-up gone, the Settings box) `129d888`
  - [x] Issues 3+4 (shape, search, count files, the door) `ce05fa8`, merged `2795f72`
  - [x] Issues 5+6 (duplicates, outside files; one sweep pass at a time) `53e98e0`
  - [x] Issues 7+8 (change letters, backfill, S70) `8858555`
  - [x] Issue 9: audit A1–A24 posted and applied `ed4b467`
  - [x] Issue 10, the agent's part: docs, `desktop/e2e/ids.spec.ts` (typechecked, never run), case list, gates, ceilings `ccb4d8c`, pull request open
- CLOSED OUT 2026-10-09. Merged to `main` by pull request #106 after Yaseen's hand walk ("Yes, merge it"). No release: Yaseen adds more to this one first.
  The full handoff is the comment "Handoff — number IDs are on `main`" on Linear YAZ-2677; read that first.
  - [x] `main` (YAZ-2662 search keys, #104) merged into the branch `6832285`: search keeps both rules, four ceilings re-measured
  - [x] Hand walk on the demo vaults; the demo folder is in the Trash; the worktree and the branch are removed
- Not verified (none blocks anything):
  - `desktop/e2e/ids.spec.ts` is typechecked only; it was never run (no Playwright, by instruction).
  - The backfill never ran on a real vault; its time for 745 notes is not measured.
  - The packaged size ceilings (asar, app, dmg) are not measured.
  - The agent did not see the app; it does not know which of the eight hand-walk steps Yaseen did.
- Next (Yaseen): set the letters of `yaseen-docs-vault` with "Change letters" on one Mac and sync; then "Old IDs", "Give them numbers".
- Separate bug, on `main` before this work too: YAZ-2688 (a folder copied in Finder can lose `.folder.md` under load).

## Open Questions
- UNCONFIRMED (Yaseen): a vault that uses IDs and has no count file has no first Mac, so each Mac waits 10 minutes for an outside file (`sweepWaits`, one line). Recorded on YAZ-2683.
- UNCONFIRMED (Yaseen): a Mac that is gone stays the first Mac for all time (audit A5). No age limit is built.
- UNCONFIRMED (Yaseen): default letters come from the folder name on each Mac (A8). Set the letters on one Mac and sync before the other Mac makes a note. His main vault's default is `YAS`.
- UNCONFIRMED (Yaseen): choosing letters that a name link already uses (`GPT` with `[[GPT-4]]`) makes that link read as note 4. The box does not warn.
- UNCONFIRMED: a link by file name does not follow a file that the clash fix renamed (A7). Out of the record.
- NOT MEASURED: the packaged size ceilings (asar, app, dmg); the time of a backfill of 745 notes.
- Agent-set details Yaseen has not seen as decisions: R11 default letters, the "Finish" button (S83), the backfill as a Settings row by file creation time, the plan file `.yaseendocs/ids-backfill.json`.

## Working Set
- Worktree and branch: removed at closeout; start a new branch from `main`
- Gates at the start commit: typecheck green; 306 files / 5952 tests green; budget PASS (eager JS 2.01 MB, CSS 0.15 MB, total 13.15 MB, main 0.53 MB — each equal to its ceiling)
- Linear helper: scratchpad `lin.py` (get / comment / create / move), key in `~/Desktop/growprofit-ai.env`
- Gates at the end: typecheck green; 312 files / 6228 tests green; build green; budget PASS after four ceilings were raised to the measured numbers
- Gates at the merge: typecheck green; 314 files / 6333 tests green; build green; budget PASS (eager JS 2021610, CSS 151349, total 13164826, main 583224)
