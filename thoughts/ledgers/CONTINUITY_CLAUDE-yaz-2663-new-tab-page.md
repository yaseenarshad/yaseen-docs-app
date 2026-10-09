# YAZ-2663: the new tab page (Recent, Favorites, used a lot)

## Goal

- A new tab (⌘T), and a window with no tabs, show three columns: "Recent", "Favorites", "Used a lot, not a favorite yet".
- The app keeps an open history for each vault (`folders[root].opens` in the app state file).
- Each row of the page has the row menu of the sidebar. The arrow keys walk the rows from the empty search bar.
- Done: the gates are green, the pull request is open (stacked on YAZ-2662), Yasin's hand walk passed, the work is on `main`.

## Constraints

- No Playwright, and do not start Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- Never open or test on a real vault. Use fixtures and temp folders.
- Write the test first, see it fail, then write the code.
- This issue does not change the Search tab. YAZ-2662 owns it (D5).
- No new dependency. No new IPC door.
- Commits go through the `/commit` skill (no Claude attribution).
- Delivery: open the pull request and stop. Yasin does the hand walk. No release.
- Yasin approved a raise of the size ceilings ("i approve any size gate increases"). Record old and new numbers in the pull request and on YAZ-2676.

## Key Decisions

- The record is on Linear, on [YAZ-2663](https://linear.app/growprofit/issue/YAZ-2663): the comments D1 to D7, "Scope, cases, exclusions and checks" (S1 to S41, R1 to R5, the design), and "A1" (size OK, the stacked build).
- A recorded case is stronger than a diff.
- The branch is stacked on `yaz-2662-search-keys` (the other agent, session "Cmd+K search modification"). Merge that branch into this one each hour. Do not rebase.
- Three parts wait for the code of YAZ-2662: the way in from the empty search bar (`useSidebarSearch`), Space to its preview panel (YAZ-2668), and Enter on a folder / Shift+Enter with the reveal that takes the focus (YAZ-2664, already on the branch at `8425e13`).

## State

- Done:
  - [x] Scoping, locked into Linear (D1 to D7, S1 to S41)
  - [x] Subissues: YAZ-2671 to YAZ-2676
  - [x] Worktree and `npm install`
- Now: [→] YAZ-2671: 1- The app stores an open history
- Next: YAZ-2672: 2- The new tab page shows three columns
- Remaining:
  - [ ] YAZ-2673: 3- The rows of the page have the row menu of the sidebar
  - [ ] YAZ-2674: 4- The arrow keys walk the rows of the page (the three parts that wait for YAZ-2662)
  - [ ] YAZ-2675: 5- Polish and anti-slop
  - [ ] YAZ-2676: 6- Verify and deliver (the pull request, the hand walk vault and steps)

## Open Questions

- UNCONFIRMED: S41, a typed letter on a row of the page lands in the search bar. Try it in YAZ-2674; if it is not clean, do not build it and record why.
- UNCONFIRMED: the door of the preview panel of YAZ-2668 (not on the branch yet at `8425e13`).

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2663`, branch `yaz-2663-new-tab-page`, from `yaz-2662-search-keys` at `8425e13` (`main` is `dd8d89b`, 1.0.0).
- The other worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2662`. Do not edit it.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
- A cron job in the coordinating session checks the branch of YAZ-2662 each hour at :23.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. Local Node is v26.5.0; CI uses Node 22.
