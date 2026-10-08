# Continuity — YAZ-2620 the sidebar search draws a tree

## Goal
- While a query is typed, the sidebar body shows the Files tree cut down to the matches and their parent folders (was: a flat ranked list). The search finds every row the tree shows.
- Done = merged to main, every Linear child Done, CONTRACTS true, worktree removed. No release cut.

## Constraints
- NO Playwright, no Electron start. Proof: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault.
- Renderer only; no main/IPC change. No new dependency. `Tree` draws the results; `SearchResults` stays for the shortcut picker.
- Commits through the `/commit` skill.
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2620`, branch `yaz-2620-search-tree`, off main `129ee9e`; main `66bda8f` merged in.

## Key Decisions
- LOCKED on YAZ-2620, comment "Locked decisions and scope (D1 to D7)": D1 the results are a tree (overturns the flat-list ruling on YAZ-739 for the sidebar), D2 a matched folder with no match inside keeps all it holds, D3 files that are no notes are search rows, D4 tree order + the highlight starts on the best match, D5 dim parents + bold typed text (`Tree`'s optional `marks`), D6 the limit stays 50 and a line says so, D7 no "Show in Files" item.
- Cases S1 to S40 and rules R1 to R9 are in the comment "The scenario record". A case is stronger than a diff.
- Audit (YAZ-2628): the highlight is held by its PATH, not its position; a row whose menu is open wears the selected style; `useResultKeys` keeps its first signature and shares `resultKeys`.

## State
- Now: CLOSED 2026-10-07. Merged by pull request #96 as `7c77c93`. Released in 0.9.36. The Linear record on YAZ-2620 is the source of truth; its last comment says who merged it.
- Done:
  - [x] 1- YAZ-2625 the cut tree, the folds, the keys, the limit line
  - [x] 2- YAZ-2626 files that are no notes are found
  - [x] 3- YAZ-2627 dim parents, bold matches; after Yasin's walk the typed text wears the highlight wash (`--mark-bg`)
  - [x] 3A- YAZ-2630 the `esc` keycap in the search bar (D8, from Yasin's walk)
  - [x] 4- YAZ-2628 audit (9 items) and its corrections, docs
  - [x] 5- YAZ-2629 checks, e2e spec, PR #96; main `66bda8f` (the Focus tab, YAZ-2619) merged into the branch
- PR #96 waited for the merge order against the multi-vault work (YAZ-2602). Yasin chose the search first; the agent of YAZ-2602 merged it.
- Remaining:
  - [x] Yasin: OK for the bundle ceilings (2026-10-07, two times)
  - [x] Yasin: walked the dev app on a scratch vault ("ok this is fine"); asked for the yellow wash and the `esc` keycap, both done
  - [ ] The merge of PR #96, after YAZ-2602; then the issues go to Done and the worktree is removed
  - [ ] If YAZ-2602 merges first: merge main into this branch again and reconcile `Sidebar.tsx`, `useSidebarSearch.ts`, the search candidates (YAZ-2609)

## Open Questions
- Settled 2026-10-07: Yasin gave his OK in chat, two times. `tools/perf/budget.json`: `rendererEagerJsBytes` 1,956,581 → 1,960,027 (the ratchet took it down from 1,960,186 after the merge of main), `rendererTotalBytes` 13,012,712 → 13,027,772, `rendererEagerCssBytes` 137,688 → 138,038 (the keycap). `npm run perf:budget:ci` passes on the merged tree; CSS and total sit inside the 0.1% tolerance.
- UNCONFIRMED: `desktop/e2e/search.spec.ts` and `names.spec.ts` (step 9) are rewritten for the tree and were never run.
- YAZ-2622 (the Focus tab) is merged into this branch: the search tree spreads main's `treeProps`, and three of its tests read search TREE rows. YAZ-2609 (several vaults) still changes `Sidebar.tsx`, `useSidebarSearch.ts` and the search candidates; the branch that merges second reconciles.

## Working Set
- `client/src/search/searchTree.ts` + test, `searchCandidates.ts`, `useSearchResults.ts`, `client/src/sidebar/hooks/useSidebarSearch.ts`, `useVaultTree.ts`, `client/src/sidebar/Sidebar.tsx` + test, `Tree.tsx`, `client/src/lib/treeState.ts`, `client/src/app.css`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`, `desktop/e2e/search.spec.ts`, `desktop/e2e/names.spec.ts`.
- Commands: `npx vitest run client/src/sidebar client/src/search` · `npx vitest run --project perf client/src/search/searchCandidates.perf.test.ts` · `npm run typecheck`.
- Gotcha: `desktop/src/main/ipc/fs.test.ts` failed to load once in a full `npm test` while other sessions ran tests; it passes alone (36 tests) and in the next full run.
