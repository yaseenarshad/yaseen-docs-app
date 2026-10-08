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
  - [x] YAZ-2639: 1- The Search tab (`33060e1`)
  - [x] YAZ-2640: 2- "Show in sidebar" on a row of Search, Focus and Favorites (`33060e1`)
  - [x] YAZ-2641: 3- Polish and anti-slop: 11 findings, each applied (`bc31efa`)
  - [x] YAZ-2642: the e2e specs and the two docs (`37a7bcc`), written and typechecked, not run
- Now: [→] YAZ-2642: the pull request is open; Yasin's hand walk is next (`docs/REGRESSION.md`, "S23 The Search tab")
- Next: merge after Yasin says the walk passed. No release.

## Decisions made during the build

- The caret has one path (audit M1): `changeLens('search')` raises the focus flag. A plain show of the sidebar on the Search tab takes no caret.
- The search does no work while a different tab shows (audit M2).
- Esc in a page while the Search tab shows puts the caret in the search bar, empty or not (audit O2).
- After Esc in the bar the focus is given up, as the old second Esc did. Yasin can ask for the caret in the document: one call to `focusOpenDocument()` in `leaveSearch`.

## Open Questions

- The size gate passes inside the 0.1% tolerance: `rendererEagerJsBytes` 1,978,420 against a pass limit of 1,978,609 (189 bytes left). `main` at `d12fa17` was 1,978,070. `mainBundleBytes` is 526,429, not changed.
- UNCONFIRMED: the size gate on CI (Node 22). A ceiling that trips goes to Yasin.
- UNCONFIRMED: the end-to-end specs have never run.

## Working Set

- Worktree `.claude/worktrees/yaz-2638-search-tab`, branch `yaz-2638-search-tab`, from `main` at `d12fa17` (0.9.37).
- Files: `shared/types.ts`, `client/src/App.tsx`, `client/src/sidebar/Sidebar.tsx`, `client/src/sidebar/menuSections.ts`, `client/src/sidebar/hooks/useSidebarSearch.ts`, `client/src/sidebar/hooks/rowGestures.ts`, `client/src/app.css`, their tests, `desktop/e2e/*.spec.ts`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`.
- Tests at `37a7bcc`: 296 files, 5,694 passed, 2 skipped. Baseline at `d12fa17`: 5,662 passed, 2 skipped.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
