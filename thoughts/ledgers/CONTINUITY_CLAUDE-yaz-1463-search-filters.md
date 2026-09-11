# CONTINUITY — YAZ-1463 search filters

## Goal
Ship YAZ-1463 to main as release 0.9.10: Filter menu Property is the searchable `ColumnPicker`; new operators is any of / is none of / has any of / has none of / has all of with a searchable value checklist; all six 🔒 decisions implemented exactly; unit tests + typecheck + build green; demo vault on the Desktop for Yasin to stress-test in an isolated app profile; Linear tree fully updated with statuses, rationale, learnings, evidence.

## Constraints
- Decisions are LOCKED as 🔒 D1–D6 comments on YAZ-1463; child descriptions 2A (YAZ-1466) and 2B (YAZ-1467) carry the approved line-numbered diffs. Anything touching a 🔒 ruling goes back to Yasin first (problem / options / recommendation / diff / after).
- No engine or YAML schema change. No new dependencies. Elegant/minimal: smaller wins, no shortcuts.
- Tests first. Verification = unit tests + typecheck + pointed checks. NO Playwright suites.
- Worktree: `/Users/yasin/.claude/worktrees/yaseen-milkdown/yaz-1463-search-filters`, branch `yaz-1463-search-filters`. Pin `cd $W &&` in every command; run suites from the worktree ROOT.
- Commits via the /commit skill; merge to main via PR (`gh pr create` + `gh pr merge`).
- Linear: move parent + child to In Progress when starting, Done when finished; new tasks become `2C-`, `3A-` etc.; comments carry decisions, learnings, gotchas, evidence.

## Key Decisions
- D1 Property → ColumnPicker only · D2 shared `propertyOptions` in properties.ts · D3 `view-popover--filter` + `filter-menu`, Toolbar `view-popover--${menu}` · D4 `Rule.value: string | string[]`, ValueKind `options` · D5 five operators + grammar (`[list].contains(a)` for single-value, `a.containsAny/All(...)` for lists) · D6 ColumnPicker `multiple` + `noun`.

## State
- Done:
  - [x] 1- Scope (YAZ-1464) — tree created, D1–D6 locked
  - [x] 2A- Property picker + Filter layout (YAZ-1466) — commit 9502535, 3462 tests green
  - [x] 2B- any-of / none-of operators + checklist (YAZ-1467) — commit 4484ede, 3491 tests green
  - [x] 4- Polish (YAZ-1469) — cap decision, 🔒 audit, reviewer triage, D7 engine resolve fix, copy Value/options, widths final at 420px
- Now: [→] 4A- Release 0.9.10, PR, merge, closeout (YAZ-1470)
- Next: memory notes, done
- Remaining:
  - [ ] 3- Prove it: demo vault on Desktop, isolated profile, "go do this" script (YAZ-1468)
  - [ ] 4A- Release 0.9.10, PR, merge, closeout comment (YAZ-1470)

## Open Questions
- DECIDED: D3 widths final at 420px / flex 140px (Yasin: no further demo needed, 2026-09-11).
- DECIDED (4-): datalist keeps 50, checklist unlimited via `suggestionsFor(property, Infinity)`.
- DECIDED: copy is label `Value` + noun `options` (D6 amended); D7 list methods take `resolve` (engine, 3 lines + test).

## Working Set
- Files: client/src/views/view/{FilterMenu,filterRows,ColumnPicker,ColumnSearch,SortMenu,properties,Toolbar}.tsx|ts, client/src/views/views.css, docs/CONTRACTS.md
- Tests: `npx vitest run client/src/views/view/Toolbar.test.tsx client/src/views/view/SortMenu.test.tsx client/src/views/view/ColumnPicker.test.tsx client/src/views/view/filterRows.test.ts`; gates `npm test`, `npm run typecheck`, `npm run build`
- Linear helper: scratchpad `lin.mjs` (`node lin.mjs plan <json>` / `get YAZ-1463`); ids in scratchpad `ids.json`
