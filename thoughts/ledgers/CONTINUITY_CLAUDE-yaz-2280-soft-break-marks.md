# YAZ-2280: marks keep soft line breaks soft

## Goal
- Adding any mark (highlight, bold, italic, strike, underline, link) across soft-wrapped lines keeps the text flowing, and the mark survives a reload.
- Done = merged to main, Linear tree closed, Yasin approved the Desktop demo, release cut with notes.

## Constraints
- No Playwright runs (Yasin). Proof = vitest + hands-on demo in an isolated profile.
- Nothing merges to main before Yasin's demo sign-off; smallest version bump on release.
- Size budget ratchet: raising a ceiling needs Yasin's OK (not needed here).

## Key Decisions (locked as comments on YAZ-2280)
- D1: remove Milkdown's `hardbreakClearMarkPlugin` in `createCrepe.ts`, register our `breakMarks` in its place.
- D2: a soft break keeps a mark only while the text on both sides carries it; a hard break never carries one. Saved shape `==two⏎three==`.
- D3: one-off repair of the damaged transcript in `business-wiki-MASTER` (lines 962-997).

## State
- Done:
  - [x] 1 Scope (YAZ-2281)
  - [x] 2 Marks keep soft line breaks soft (YAZ-2282)
  - [x] 3 Repair the damaged transcript (YAZ-2283): 37 lines, verified byte-identical through the fixed editor
  - [x] 4 Polish and anti-slop (YAZ-2284, 4A YAZ-2286, 4B YAZ-2287)
- Now: [→] 5 Verify in the real app (YAZ-2285): Desktop demo, waiting on Yasin's sign-off
- Remaining:
  - [ ] Merge to main, release (smallest bump), install, release notes

## Open Questions
- None.

## Working Set
- Worktree: `../yaseen-docs-app-yaz-2280`, branch `yaz-2280-soft-break-marks`
- Files: `client/src/editor/{breakMarks.ts,breakMarks.test.ts,createCrepe.ts}`, `docs/{CONTRACTS.md,REGRESSION.md}`
- Checks: `npm run typecheck && npm test && npm run build && npm run perf:budget:ci`
