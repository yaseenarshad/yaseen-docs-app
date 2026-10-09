# YAZ-2648: tab management

## Goal

- A click on a file never replaces a tab that the user wants to keep. It opens the file in the one preview tab.
- The grid button, or ⌘⇧A, zooms out to the tab board: each open tab is a small page in the island of its folder.
- ⌘T opens one blank tab for the next page.
- The tab strip looks like the tabs of a browser.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`. All four are true since `12aaa39`.

## Constraints

- No Playwright, and do not start Electron for a check. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault. Use fixtures and temp folders.
- Write the test first, see it fail, then write the code.
- A size ceiling that trips is set to the measured number in its own commit, and the pull request names it for Yasin's OK.
- Delivery: open the pull request and stop. Yasin does the hand walk. Merge after he says it passed. No release unless he asks.
- Commits go through the `/commit` skill.
- Nothing new is stored: the preview mark, the blank tab, the board and the pick are memory of the renderer.

## Key Decisions

- The record is on Linear, on [YAZ-2648](https://linear.app/growprofit/issue/YAZ-2648), in comments: the decisions D1 to D15, "The small rules (R1 to R22)", "The small rules, part 2 (R23 to R37)", "The scenario record (S1 to S96)", and "Locked (2026-10-08)".
- D1: `open-current` opens the page in the preview tab; a kept tab is never replaced. D3: a link in a page uses `navigate`, the old rule. D4: `preview` is not saved.
- D2: a double-click, the first typed character, or a drag keeps the tab. The edit signal is the autosave status `unsaved` (R4), never `onMarkdownUpdated`.
- D5, D7, D8, D9: the tab board. Islands by folder, the full folder path on the label, a zoom, a stack only when the pages do not fit, the grid button after Forward.
- D6: one bridge door, `readHeads`, reads the top of each open tab in one call.
- D13, D14, D15: peek with Space, a drag to the right edge, a pick with Shift-click.
- D10, D11: one blank tab in memory; ⌘T also puts the cursor in the search bar.
- D12, as Yasin changed it in the demo: a tall row (44px), each tab a rounded pill in three fills, a "+" button, a slide, tabs that move apart during a drag. In the light theme the active tab wears the accent.
- The board opens with ⌘⇧M (it was ⌘⇧A). An island becomes a stack only when the board does not fit AND the island has four or more pages.
- A recorded case is stronger than a diff.

## State

- Done:
  - [x] Scoping, with mockups in chat; D1 to D8 locked into Linear
  - [x] Demo in the worktree, on a demo vault with its own app profile; D9 to D15 came from it
  - [x] Locked into Linear: D9 to D15, R1 to R37, S1 to S96, the new description of the parent
  - [x] Subissues: YAZ-2650 to YAZ-2658
  - [x] YAZ-2650: 1- Preview tab: the rules (`399a8f4`)
  - [x] YAZ-2651: 2- Preview tab: the gestures and the italic name (`399a8f4`)
  - [x] YAZ-2652: 3- Tab board: islands, zoom, stacks and menus (`399a8f4`)
  - [x] YAZ-2653: 4- Tab board: the first lines of each page (`399a8f4`)
  - [x] YAZ-2654: 5- Tab board: peek, drag to the side, pick many (`399a8f4`)
  - [x] `main` merged into the branch (`3ba6864`): the line numbers of YAZ-2643
  - [x] YAZ-2655: 6- Blank tab and ⌘T
  - [x] YAZ-2656: 7- The look of the tab strip, changed by Yasin in the demo to pills as in Linear
  - [x] Changes from the demo: pages of 200 by 266 px, ⌘⇧M for the board, the accent on the active tab in the light theme, a stack only for an island of four or more pages, the strip lights the tab of the page that the board highlights
  - [x] YAZ-2657: 8- Polish and anti-slop: an independent audit, A1 to A21; 18 applied, 3 declined with a reason (`cfc27bc`)
  - [x] YAZ-2658: 9- the e2e spec and the two docs (`9ac8a9d`), written and typechecked, not run; the case list is on the issue
  - [x] `main` merged in again (`73b54ad`): YAZ-2649
  - [x] Four ceilings set to the measured numbers (`15b2a44`, `6716f59`)
  - [x] The pull request is open: #103. The ten issues are In Review.
  - [x] Yasin's hand walk on the development app: "walk passed". He approved the four ceilings: "OK on all four size limits".
  - [x] Merged by #103 as `12aaa39`; CI on the pull request was green, the size gate too
  - [x] Closeout: the handoff is on YAZ-2648 and on each subissue; the ten issues are Done; the pull request is attached to YAZ-2648
- Now: closed. Yasin asked for a release with this work and the work of YAZ-2643 and YAZ-2649; that is a separate task.
- Next: on the first run of the end-to-end specs, `desktop/e2e/tabs.spec.ts`, `search.spec.ts` and `links.spec.ts` prove the preview rule for the first time.

## Open Questions

- The hand walk covered the board, the zoom, the stacks, the peek, the drag, the strip in the two themes, an edit from outside the app (S23), ⌘T, and a restart. Yasin said that it passed.
- UNCONFIRMED: the end-to-end specs have never run.
- Four ceilings are new: `rendererEagerJsBytes` 2,007,099 (from 1,982,923), `rendererEagerCssBytes` 149,568 (from 140,553), `rendererTotalBytes` 13,148,534 (from 13,115,343), `mainBundleBytes` 529,077 (from 526,429). Yasin approved all four in chat.
- With pills of 200px, 4 tabs fit at full width in a window of 1280px with the sidebar open, 5 at the floor of 140px. Yasin accepted fewer tabs; the hand walk asks if this is too few.
- The demo app breaks when a change of `shared/ipc.ts` or of the main process hot-reloads the renderer against an old preload. Restart the app after such a change.
- The rule for Space with text in the filter (R36) has a simpler form. Yasin selects in the hand walk.
- The peek shows about 600 characters. A larger read needs a change of `readHeads`. Yasin decides in the hand walk.
- `desktop/src/main/ipc/fs.test.ts` fails in its cleanup step in about 1 run of 4 (`ENOTEMPTY` on `rmdir` of its temp folder). Its tests pass. Not from this work.
- Before the demo, one scripted check opened a window on Yasin's screen. The execution rules do not permit that. Do not do it again.

## Working Set

- The work was on the branch `yaz-2648-tab-management`, from `main` at `248a25c` (0.9.38), with `main` merged in two times (`3ba6864`, `73b54ad`).
- New files: `client/src/tabs/{TabOverview,TabMenu}.tsx`, `client/src/tabs/{board,boardHighlight,useTabHeads}.ts`, `desktop/src/main/fs/heads.ts`, and their tests.
- Changed files: `client/src/workspace/useWorkspace.ts`, `client/src/App.tsx`, `client/src/tabs/{TabBar.tsx,tabs.css}`, `client/src/sidebar/{Tree,Sidebar}.tsx`, `client/src/sidebar/menuSections.ts`, `client/src/editor/Editor.tsx`, `client/src/views/view/icons.tsx`, `client/src/hooks/useMenuEvents.ts`, `shared/{ipc,types}.ts`, `desktop/src/main/{menu.ts,ipc/fs.ts}`, the preload surface snapshot.
- Tests at `6716f59`: 306 files, 5,952 passed, 2 skipped. Baseline at `248a25c`: 5,694 passed, 2 skipped.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- The demo used a script, not in git, that made the vault "Tab Management", a second vault and an app profile, and ran the app on it with `YASEEN_DOCS_USER_DATA_DIR=<demo-dir>/profile npm run dev`. The demo, its vaults, the worktree and the branch are removed.
- For the release notes: the state before this work is `main` at `248a25c`.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
