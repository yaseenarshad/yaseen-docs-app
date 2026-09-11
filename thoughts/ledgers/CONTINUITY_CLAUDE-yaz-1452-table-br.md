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
- Now: [→] 2A- failing tests (YAZ-1455)
- Next: 2B- implement (YAZ-1456)
- Remaining:
  - [ ] 3A- real doc proof (YAZ-1458)
  - [ ] 3B- Desktop demo vault + isolated dev app (YAZ-1459)
  - [ ] 4- Polish + CONTRACTS rule (YAZ-1460)
  - [ ] 4A- Release 0.9.9 + merge (YAZ-1461)

## Open Questions
- UNCONFIRMED: no desktop computer-use tool in this session — real-app screenshot may need one short Playwright-Electron script (announced first), not a suite.

## Working Set
- Worktree: `.claude/worktrees/yaz-1452-table-br`, branch `worktree-yaz-1452-table-br`
- Files: `client/src/editor/inlineBreaks.ts` (new), `client/src/editor/inlineBreaks.test.ts` (new), `client/src/editor/createCrepe.ts`, `client/package.json`, `docs/CONTRACTS.md`
- Tests: `npx vitest run client/src/editor/inlineBreaks.test.ts` · `npm test` · `npm run typecheck` (from worktree root)
