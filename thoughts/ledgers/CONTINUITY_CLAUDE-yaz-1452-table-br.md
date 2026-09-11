# CONTINUITY — YAZ-1452 table line breaks (`<br>` ↔ hardbreak)

## Goal
- A `<br>` inside a markdown table cell renders as a line break and survives load → edit → autosave byte-for-byte. Shift-Enter in a cell saves as `<br>`. Blank lines, underline, empty bullets unchanged. Shipped as 0.9.9 on main with tests, a CONTRACTS rule, and evidence comments on every Linear child.

## Constraints
- 🔒 Decision: https://linear.app/growprofit/issue/YAZ-1452#comment-b18368af (option 1; plugin runs BEFORE Milkdown's `remarkPreserveEmptyLinePlugin`, which is re-registered after ours, never dropped).
- Tests first (2A before 2B). No Playwright suites — headless unit tests + one pointed real-app pass.
- Simpler wins, never at the cost of what is right. Diff is locked; any change to it goes to Yasin first.
- Worktree gotchas: pin every command with `cd $W &&`; guard refuses commands with "git" twice; merge via `gh pr`.

## Key Decisions
- Whole change done by the main session (≈40 lines + one test file); a subagent adds risk, not speed.

## State
- Done:
  - [x] 1- Scope (YAZ-1453)
  - [x] 2A- failing tests (YAZ-1455) · 2B- implement (YAZ-1456) — two commits on the branch
  - [x] 3A- real doc proof (YAZ-1458): 180 `<br>` before/after a real edit + autosave
- Now: [→] 4- Polish + CONTRACTS rule 30 (YAZ-1460)
- Next: 3B- demo vault is on the Desktop; launch the isolated app for Yasin, then 4A- release 0.9.9 + PR (YAZ-1461). Merge waits for Yasin's stress test.
- Remaining:
  - [ ] 3B- launch + "go do this" script (YAZ-1459)
  - [ ] 4A- Release 0.9.9 + PR + merge (YAZ-1461)

## Learnings
- Milkdown's Shift-Enter turns a second press after a break into a paragraph (splits a table); its paragraph serializer drops the last hardbreak (trailing cell `<br>` decayed per save). Both owned in `inlineBreaks.ts` (decision 2 comment on YAZ-1456).
- Synthetic mouse clicks on a Crepe table cell can hit the row/column handle and select the whole cell; the 3A script places the caret via the DOM selection instead.

## Open Questions
- (resolved) Enter in a cell = new line, 🔒 YAZ-1462 option 1; shipped in PR #36. Merge waits for Yasin's demo pass.

## Working Set
- Worktree: `.claude/worktrees/yaz-1452-table-br`, branch `worktree-yaz-1452-table-br`
- Files: `client/src/editor/inlineBreaks.ts` (new), `client/src/editor/inlineBreaks.test.ts` (new), `client/src/editor/createCrepe.ts`, `client/package.json`, `docs/CONTRACTS.md`
- Tests: `npx vitest run client/src/editor/inlineBreaks.test.ts` · `npm test` · `npm run typecheck` (from worktree root)
