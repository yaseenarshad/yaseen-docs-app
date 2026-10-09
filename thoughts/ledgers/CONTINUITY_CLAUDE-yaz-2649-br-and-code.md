# YAZ-2649: two faults that change the user's file — a `<br>` at a line end, and code that the text rules rewrite

## Goal

- A `<br>` at the end of a line, or on a line of its own, is one line break. The paragraph does not split after a save, and no backslash shows in the text.
- The editor never changes the text of code when it loads or saves a note.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`.

## Constraints

- No Playwright, and do not start Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault. Use fixtures and temp folders.
- A size ceiling that trips goes to Yasin.
- Delivery: open the pull request and stop. Yasin does the hand walk. Merge after he says it passed. No release: Yasin makes one together with other work.
- Commits go through the `/commit` skill.

## Key Decisions

- The record is on Linear, on [YAZ-2649](https://linear.app/growprofit/issue/YAZ-2649), in two comments: "Scoping findings: where the two bugs come from" and "Scoping decisions — LOCKED" (D1 to D4, the approved diffs). The cases B1 to B12 are in the description of YAZ-2659. The cases C1 to C13 are in the description of YAZ-2660.
- D1: a `<br>` and the line ending beside it are ONE hard break. The save writes `\` + line ending, the spelling of YAZ-1452.
- D2: each text rule, on load and on save, goes through the one walk `mapOutsideFences`. `FENCE_LINE` is gone. Indented code is not included.
- D3: the wiki-link save rule skips a code span on its line.
- D4: no repair of files that the faults already changed. Yasin has a read-only search command.
- A recorded case is stronger than a diff.

## Where the faults came from

- The `<br>` fault: YAZ-1452 (`f9b9580`, 2026-09-10) kept an inline `<br>` as a hard break for table cells. No test had a `<br>` at the end of a line with text below it.
- The code fault: five rules from five issues (GRO-1961, GRO-2012, GRO-2018, GRO-2112, YAZ-1359), with three ways to find code. Only YAZ-1329's `mapOutsideFences` was correct, and only its own rule used it.

## State

- Done:
  - [x] Scoping, with each fault reproduced in a real editor; locked into Linear
  - [x] Subissues: YAZ-2659, YAZ-2660
  - [x] YAZ-2659: 1- A `<br>` beside a line ending is one line break (B1 to B12)
  - [x] YAZ-2660: 2- The editor's text rules never change code (C1 to C13, one strong round-trip test)
  - [x] The audit, inside each issue
- Now: [→] The pull request is open. Yasin's hand walk is next (`docs/REGRESSION.md`, "E29–E30").
- Next: the merge, after Yasin says the hand walk passed.

## Decisions made during the build

- The approved D2 diff had a fault: without the `m` flag, the two load patterns did not match a line of a CRLF file. An empty task became the text `\[ ]`. The patterns now end before an optional `\r` (`LINE_END`).
- The approved D3 diff had a fault: two typed backticks on one line (remark writes each as `` \` ``) were read as a code span, and a wikilink between them stayed escaped on disk. A span's opening run now needs an even count of backslashes before it.
- The save rules are one function for one line, `restoreLine` in `createCrepe.ts`. A line with no backslash and no `<br />` at its end has no work.
- Speed on a note with many links, 5,000 lines, on a computer under heavy load: the save rules take about 1.1 ms before and about 1.2 ms after. The number in the locked D2 text (1.18 ms and 1.17 ms) came from a note with few links.

## Open Questions

- UNCONFIRMED (read from the code, not run): `maskCode` in `client/src/links/renameLinks.ts` and `stripCode` in `desktop/src/main/vaultIndex/scan.ts` accept a fence with 0 to 3 spaces of indent only. A fence under a nested bullet is then text for the link index and for a rename. This is not part of this work.
- `outlinePaste.ts` changes glyph lines inside a pasted fence. Paste path only. Not part of this work.
- `rendererEagerJsBytes` and `rendererTotalBytes` are 106 bytes over their ceilings and pass inside the 0.1% tolerance.

## Working Set

- Worktree `.claude/worktrees/yaz-2649-br-and-code`, branch `yaz-2649-br-and-code`, from `main` at `8a97b4a`.
- Files: `client/src/editor/inlineBreaks.ts`, `client/src/editor/listItemRoundTrip.ts`, `client/src/editor/createCrepe.ts`, their tests, `client/src/editor/lineNumbers/lineNumbers.test.ts`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`.
- Baseline at `8a97b4a`: 303 test files, 5,851 passed, 2 skipped. With this work: 303 files, 5,891 passed, 2 skipped.
- Speed, measured in scoping on a 5,000-line note: the save rules 1.18 ms before and 1.17 ms after; the load rules 2.40 ms before and 2.59 ms after.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
