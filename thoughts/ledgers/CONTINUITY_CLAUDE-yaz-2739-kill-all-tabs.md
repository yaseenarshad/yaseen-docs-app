# YAZ-2739 — "Kill all tabs"

## Goal
- One action, "Kill all tabs", closes every open tab of the window. It is in two places: a red button at the top right of the tab board, and a right-click menu on the grid button of the tab strip.
- The app asks first, in its own confirm sheet, with the count of tabs.
- Done = the four gates are green, Yaseen's hand walk passes, the pull request is merged. NO release in this run: Yaseen puts it into a release with other work (D6).

## Constraints
- No Playwright on this Mac: it takes over the screen. The e2e step is written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- A check in the real app runs out of sight, or Yaseen does a guided hand walk in the dev app with its own profile and a scratch vault.
- LESSON for a check out of sight: `setOpacity(0)` is NOT enough. An invisible window still takes the user's real clicks at its place on the screen, and then the user's keys. In this run Yaseen's clicks and a few typed letters went into the hidden test app (a temp copy of the demo vault, no real data). Each hidden window also needs `setIgnoreMouseEvents(true)` and `setFocusable(false)`. The DevTools protocol still drives it.
- Linear: the main issue's comments are for humans. Agent records go on the working log YAZ-2741 and on the subissues YAZ-2747 to YAZ-2750.
- Commits through the `/commit` skill (no Claude attribution).
- Front end only. No IPC, no stored data, no dependency.

## Key Decisions (locked on YAZ-2741, with rules R1–R11 and cases S1–S27)
- D1: the button is at the top right of the board, in the danger colour.
- D2: a right-click on the grid button opens a menu with ONE item, "Kill all tabs". A plain click still toggles the board.
- D3: the app asks each time, through `ConfirmSheet`, with the count. Reason: no tab comes back. The text of each note is saved; the history, scroll, caret and undo of each tab are lost.
- D4: text in the board's filter does not change the action. It closes every tab of the window.
- D5: no separate demo. D6: joins a later release.
- Found in the run: the button is NOT `position: absolute`, as the scoping diff had it. In a board narrower than about 600 px it covered the filter box. The filter box and the button are now one grid row, `.taboverview__top`.
- Found in the run: the size gate failed by 371 bytes of CSS. The button now wears the confirm sheet's `confirm__btn confirm__btn--danger`, and its own rule only places it. The gate passes inside its 0.1% tolerance (JS +1,198 bytes, CSS +148 bytes). No ceiling was raised.
- Found in the real app: after Cancel from the grid button's menu the focus was on `body`, and the board's keys were dead. Fix: the right press on the grid button and the press on the item do not take the focus. Then Esc on that menu also reached the board and closed it. Fix: the board's `onKeyDown` stands down while any `.ctx-menu` is on screen.
- The ask lives in `App` (`killAsk`, `askKillAll`, `killAllTabs`), so one sheet answers for both doors. The confirm goes through `closeUnderOverview`, so R18 of YAZ-2648 closes the board.

## State
- Done:
  - [x] Scope, decisions, rules and cases locked on YAZ-2741
  - [x] 1 (YAZ-2747) the board's button, the grid button's menu, the ask and the sheet, with unit tests written first
  - [x] 2 (YAZ-2748) polish and anti-slop: the audit and its fixes
  - [x] The check in the real app, out of sight (its own profile, a demo vault, the DevTools protocol): 24 of 24 cases pass
- Now: [→] 3 (YAZ-2749) gates, docs, pull request, then Yaseen's hand walk
- Next: 4 (YAZ-2750) release notes on YAZ-2739
- Remaining:
  - [ ] Merge, after Yaseen says so

## Open Questions
- UNCONFIRMED: step 4c of `desktop/e2e/tabs.spec.ts` is typechecked, and nobody ran it.
- UNCONFIRMED: the delivery path. The agent stops at the pull request until Yaseen says to merge.

## Working Set
- Branch `feat/yaz-2739-kill-all-tabs` from `main` at `bdd497b`. Worktree `.claude/worktrees/yaz-2739-kill-all-tabs`.
- Renderer: `client/src/App.tsx`, `client/src/tabs/TabOverview.tsx`, `client/src/tabs/TabBar.tsx`, `client/src/tabs/tabs.css`
- Docs: `docs/CONTRACTS.md` ("The tab board"), `docs/REGRESSION.md` (W12, steps 11 and 12)
- Tests: `npx vitest run --project client client/src/tabs/TabOverview.test.tsx client/src/tabs/TabBar.test.tsx client/src/App.test.tsx -t "Kill all tabs"`
