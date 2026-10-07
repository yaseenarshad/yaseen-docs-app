# Continuity — YAZ-2620 the sidebar search draws a tree

## Goal
- While a query is typed, the sidebar body shows the Files tree cut down to the matches and their parent folders (was: a flat ranked list). The search finds every row the tree shows.
- Done = merged to main, every Linear child Done, CONTRACTS true, worktree removed. No release cut.

## Constraints
- NO Playwright, no Electron start. Proof: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault.
- Renderer only; no main/IPC change. No new dependency. `Tree` draws the results; `SearchResults` stays for the shortcut picker.
- Commits through the `/commit` skill.
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2620`, branch `yaz-2620-search-tree`, off main `129ee9e`.

## Key Decisions
- LOCKED on YAZ-2620, comment "Locked decisions and scope (D1 to D7)": D1 the results are a tree (overturns the flat-list ruling on YAZ-739 for the sidebar), D2 a matched folder with no match inside keeps all it holds, D3 files that are no notes are search rows, D4 tree order + the highlight starts on the best match, D5 dim parents + bold typed text (`Tree`'s optional `marks`), D6 the limit stays 50 and a line says so, D7 no "Show in Files" item.
- Cases S1 to S40 and rules R1 to R9 are in the comment "The scenario record". A case is stronger than a diff.
- Audit (YAZ-2628): the highlight is held by its PATH, not its position; a row whose menu is open wears the selected style; `useResultKeys` keeps its first signature and shares `resultKeys`.

## State
- Done:
  - [x] 1- YAZ-2625 the cut tree, the folds, the keys, the limit line
  - [x] 2- YAZ-2626 files that are no notes are found
  - [x] 3- YAZ-2627 dim parents, bold matches
  - [x] 4- YAZ-2628 audit (9 items) and its corrections, docs
- Now: [→] 5- YAZ-2629 verify and deliver: PR open, waits for Yasin
- Remaining:
  - [ ] Yasin: OK for the bundle ceilings (below), the hand walk, the merge

## Open Questions
- UNCONFIRMED: `npm run perf:budget:ci` fails. `rendererEagerJsBytes` 1,960,186 > ceiling 1,956,581; `rendererTotalBytes` 13,027,772 > ceiling 13,012,712. Main at `129ee9e` already measures 1,957,202 and 13,024,710 (inside the 0.1% tolerance). A higher ceiling needs Yasin's OK in the PR description (`tools/perf/budget.json`).
- UNCONFIRMED: `desktop/e2e/search.spec.ts` and `names.spec.ts` (step 9) are rewritten for the tree and were never run.
- YAZ-2609 (several vaults) and YAZ-2622 (the Focus tab) change `Sidebar.tsx` and `useSidebarSearch.ts` too. The branch that merges second reconciles.

## Working Set
- `client/src/search/searchTree.ts` + test, `searchCandidates.ts`, `useSearchResults.ts`, `client/src/sidebar/hooks/useSidebarSearch.ts`, `useVaultTree.ts`, `client/src/sidebar/Sidebar.tsx` + test, `Tree.tsx`, `client/src/lib/treeState.ts`, `client/src/app.css`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`, `desktop/e2e/search.spec.ts`, `desktop/e2e/names.spec.ts`.
- Commands: `npx vitest run client/src/sidebar client/src/search` · `npx vitest run --project perf client/src/search/searchCandidates.perf.test.ts` · `npm run typecheck`.
- Gotcha: `desktop/src/main/ipc/fs.test.ts` failed to load once in a full `npm test` while other sessions ran tests; it passes alone (36 tests) and in the next full run.
