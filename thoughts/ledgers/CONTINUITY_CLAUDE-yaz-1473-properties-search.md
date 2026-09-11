# CONTINUITY — YAZ-1473 search bar at top of properties after expand

## Goal
Ship YAZ-1473 to main as release 0.9.11: the note's Properties panel gets a `ColumnSearch` line above its rows that filters by key; 🔒 D1–D3 implemented exactly; tests-first evidence; typecheck + build green; edge-case demo vault on the Desktop in an isolated profile for Yasin to stress-test BEFORE merge; Linear tree fully updated.

## Constraints
- 🔒 D1–D3 + mockup approval are comments on YAZ-1473; 2- (YAZ-1475) carries the approved diff. Anything touching a ruling → Yasin first (problem / options / recommendation / diff / after).
- No write path touched; typing never writes. No change to `ColumnSearch` or the views Properties menu.
- Verification = unit tests + typecheck + build + Yasin's "go do this" pass. NO Playwright.
- Worktree `/Users/yasin/.claude/worktrees/yaseen-milkdown/yaz-1473-properties-search`, branch `yaz-1473-properties-search`, base main `ff1d1e8`. Pin `cd $W &&` in every command; suites from the worktree ROOT.
- Commits via /commit skill; merge via PR. Yasin tests the demo before push/merge this time.

## Key Decisions
- D1 reuse `ColumnSearch` · D2 shown whenever typed rows exist · D3 key-only `includes`, rows filter only, reset on collapse + Add, "No properties found."

## State
- Done:
  - [x] 1- Scope (YAZ-1474) — tree created, D1–D3 locked, live mockup approved
- Now: [→] 2- Build (YAZ-1475) — diff applied (uncommitted), tests to write with stash-fail-pop evidence, CONTRACTS sentence
- Next: 4- Polish (YAZ-1477): reviewer, gates, audit → 3- demo with edge cases for Yasin → 4A release/PR/merge
- Remaining:
  - [ ] 3- Prove it (YAZ-1476)
  - [ ] 4- Polish and anti-slop (YAZ-1477)
  - [ ] 4A- Release 0.9.11 (YAZ-1478)

## Open Questions
- none

## Working Set
- Files: client/src/editor/FrontmatterPanel.tsx, client/src/editor/FrontmatterPanel.test.tsx, client/src/app.css, docs/CONTRACTS.md
- Tests: `npx vitest run client/src/editor/FrontmatterPanel.test.tsx`; gates `npm test`, `npm run typecheck`, `npm run build`
- Demo: ~/Desktop/yaz-1473-properties-search-demo (generator: scratchpad gen-demo-1473.mts)
- Linear helper: scratchpad lin.mjs; ids.json keys parent2/t1/t2/t3/t4/t4a
