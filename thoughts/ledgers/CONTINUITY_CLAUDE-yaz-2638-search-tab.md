# YAZ-2638: the Search tab, and "Show in sidebar" on a row

## Goal

- The sidebar has four tabs: Files, Search, Focus, Favorites. ⌘K shows Search. The search stays in its tab.
- A right-click on a row of Search, Focus or Favorites shows "Show in sidebar" first. A click shows the row in Files and flashes it.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`.

## Constraints

- No Playwright, and do not start Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault. Use fixtures and temp folders.
- Write the test first, see it fail, then write the code.
- A size ceiling that trips goes to Yasin. `mainBundleBytes` must not grow: the main process does not change.
- Delivery: open the pull request and stop. Yasin does the hand walk. Merge after he says it passed. No release.
- Commits go through the `/commit` skill.

## Key Decisions

- The record is on Linear, on [YAZ-2638](https://linear.app/growprofit/issue/YAZ-2638), in four comments: the decisions (D1 to D3), the cases (S1 to S33), the approved diffs, and "D3 changed" (S34 to S38).
- D1: "Show in sidebar" is the first item of the menu of a search row.
- D2: Search is a tab of its own, never stored. Esc goes back and keeps the text.
- D3 (changed by Yasin): the item is also on the rows of Focus and of Favorites. Never on a row of Files, never inside a selection of two or more.
- A recorded case is stronger than a diff.

## State

- Done:
  - [x] Scoping, locked into Linear
  - [x] Subissues: YAZ-2639, YAZ-2640, YAZ-2641, YAZ-2642
- Now: [→] YAZ-2639: 1- The Search tab
- Next: YAZ-2640: 2- "Show in sidebar" on a row of Search, Focus and Favorites
- Remaining:
  - [ ] YAZ-2641: 3- Polish and anti-slop
  - [ ] YAZ-2642: 4- Verify and deliver (the e2e specs, the docs, the gates, the pull request, the hand walk)

## Open Questions

- UNCONFIRMED: the renderer's size after the change, against the `rendererEagerJsBytes` ceiling of 1,976,633.

## Working Set

- Worktree `.claude/worktrees/yaz-2638-search-tab`, branch `yaz-2638-search-tab`, from `main` at `d12fa17` (0.9.37).
- Files: `shared/types.ts`, `client/src/App.tsx`, `client/src/sidebar/Sidebar.tsx`, `client/src/sidebar/menuSections.ts`, `client/src/sidebar/hooks/useSidebarSearch.ts`, `client/src/sidebar/hooks/rowGestures.ts`, `client/src/app.css`, their tests, `desktop/e2e/*.spec.ts`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
