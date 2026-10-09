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
  - [x] YAZ-2671: 1- The app stores an open history (`26b67cd`)
  - [x] YAZ-2672: 2- The new tab page shows three columns (`c79184e`)
  - [x] YAZ-2673: 3- The rows of the page have the row menu of the sidebar (`eb27ece`)
  - [x] YAZ-2674: 4- The arrow keys walk the rows of the page (`eb27ece`; Space and the preview panel in the merge `7b99430`)
  - [x] YAZ-2675: 5- Polish and anti-slop (`c31242b`): the audit (19 items) and its result are comments on the issue
  - [x] The branch of YAZ-2662 is merged in, to its pull request #104 (`cc39f97`). The panel draws `pagePreviewPath ?? previewShown`; `closePreview` clears both paths.
  - [x] The four size ceilings (`e5672b3`), with Yasin's OK
- Now: [→] YAZ-2676: 6- Verify and deliver. The gates are green on the merged branch: 310 test files, 6,110 passed, 2 skipped; the size gate passes. The pull request is open, stacked on `yaz-2662-search-keys`. The issues are In Review.
- Next: Yasin's hand walk (W13 of `docs/REGRESSION.md`; the steps and the commands are a comment on YAZ-2676). Then the merge, after the pull request #104 of YAZ-2662.
- Remaining:
  - [ ] Yasin: the hand walk, and his word on the decisions that he has not seen (the pull request lists them)
  - [ ] The merge, then the issues go to Done, the worktree and the hand-walk folder are removed

## Key Decisions of YAZ-2673 and YAZ-2674

- The row menu: App holds `sidebarMenuRequest { id, path, x, y }`. The Sidebar has ONE builder, `openMenuAt(node, x, y, outside)`. A page row uses the fields of a search row (`leaveSearchTo`, `showPath`, `lens: 'files'`). No new field in `MenuTargets`.
- The request waits for the tree and the favorites of the vault of the path. A path that the tree does not hold opens nothing.
- The way in from the empty search bar is in `Sidebar.tsx` (the `onKeyDown` of the bar, prop `onLeaveToPage`). `useSidebarSearch.ts` has no change: the code of YAZ-2668 adds two arguments to the same call and changes `searchKeyDown`.
- The focus door is a box, `focusRef: { current: (() => boolean) | null }`, as `clipboardRef`. The page fills it. App asks it on a key.
- `onShowFolder` is now `onShowInFiles`: one door for a folder row and for Shift+Enter.
- ⌘ on a folder row, with a click or with Enter, opens the page of the folder in a background tab, as on a search row (YAZ-2662 S3). The first build showed the folder in Files; the coordinator changed it in `eb27ece`.
- S41 is built: a typed letter calls `onBackToSearch` and the key is not taken. The hand walk must prove that the letter is in the bar.
- The page goes while a row has the keyboard focus: the caret goes into the page on show in the tab stack (`focusOpenDocument(stack)`), never into the right panel (YAZ-2675).
- The preview of S39: App holds `pagePreviewPath` for the page and draws `pagePreviewPath ?? previewPath`. The ✕ clears both.

## Key Decisions of YAZ-2675

- The panel draws the file of the last one that asked: an effect in App clears `pagePreviewPath` when the search names a file.
- A held Enter or Space on a row acts one time (the rule of YAZ-2669).
- The columns are cut in one `useMemo`. The records are read with `useSyncExternalStore` and keep their identity until a use or a vault name changes.
- The hotkey reference has no entry for the keys of the page: it lists no key of the Search tab or of the tab board.
- The page has no key hints. No screen says that `→` or `↓` in the empty search bar goes to the page. A decision for Yasin after the hand walk.

## The next merge of `yaz-2662-search-keys`

- `6d61727` changes the same lines of `App.tsx`: it adds `previewShown` and `closePreview`, and the panel draws `previewShown`.
- Keep the rule of both: the panel draws `pagePreviewPath ?? previewShown`. The ✕ and Esc in the panel clear both paths.
- The effect of YAZ-2675 (`if (previewPath !== null) setPagePreviewPath(null)`) must stay.
- The panel of the page must give way to the board and to a review too. The page goes in both cases, so its clean-up closes it. Check it in the App tests after the merge.

## Open Questions

- UNCONFIRMED: S41 in the app. jsdom cannot show that the browser types the letter in the bar. Hand walk.
- UNCONFIRMED: Enter and Space on a row in the app make no second click of the button (`preventDefault` on keydown). Hand walk.

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2663`, branch `yaz-2663-new-tab-page`, from `yaz-2662-search-keys` at `8425e13` (`main` is `dd8d89b`, 1.0.0).
- The other worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2662`. Do not edit it.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
- A cron job in the coordinating session checks the branch of YAZ-2662 each hour at :23.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. Local Node is v26.5.0; CI uses Node 22.
