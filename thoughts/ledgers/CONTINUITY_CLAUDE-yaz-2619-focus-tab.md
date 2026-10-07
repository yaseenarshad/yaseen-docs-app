# YAZ-2619: Focus Mode is its own tab

Linear: https://linear.app/growprofit/issue/YAZ-2619/make-focus-mode-its-own-tab
The record is three comments there: "Locked decisions and scope (D1 to D4)", "The scenario record (S1 to S40) and the small rules (R1 to R14)", and "Decision D5: this work goes first, on `main`". Read them before anything here.

## Goal

- The sidebar has three tabs: Files, Focus (an eye), Favorites (a heart). Files is never narrowed.
- "Add to focus" / "Remove from focus" on a file or folder row builds one list per window. An add shows the Focus tab. "Clear" empties the list.
- Done means: YAZ-2621 to YAZ-2624 are Done, the pull request is merged when Yaseen says so, and he has done the hand walk.

## Constraints

- No Playwright, by anyone. No agent-started Electron. Never open or test on a real vault.
- No release unless Yaseen asks.
- Delivery path: open the pull request and stop. Yaseen does the hand walk. Merge only after he says it passed, and after CI is green (his choice, 2026-10-07).
- Commits go through the `/commit` skill.
- One vault per window only. Several vaults in one window is YAZ-2602; its 2D (YAZ-2609) builds on this work.

## Key Decisions

- D1 one list per window, `focusList`, in the window identity; 500 at most (`MAX_FOCUS`); `focusDirs` and `focusFavorites` are removed and not migrated.
- D2 the Focus tab draws the list with `favoriteRoots`: order added, files and folders, nesting kept; `focusRoots` is removed.
- D3 one menu item adds or removes; an add shows the Focus tab; a search keeps its text.
- D4 the tab is the eye glyph; a line above the list shows "N in focus" and "Clear".
- D5 this work goes first, on `main`; the branch that merges second (this one or `yaz-2602-multi-vault`) fixes the conflicts.

## State

- Done:
  - [x] Scope: D1 to D5, S1 to S40, R1 to R14 (in the parent's comments); Amendment 1 (S33 error code) and Amendment 2 (R15 to R20)
  - [x] The issue tree: YAZ-2621 to YAZ-2624
  - [x] 1- State (YAZ-2621), commit `21d6615`
  - [x] 2- Sidebar (YAZ-2622), commit `6da0e48`
  - [x] 3- Polish and anti-slop (YAZ-2623): audit A1 to A8 on the issue; A1 to A3 applied, A7 and A8 declined
  - [x] 4- the gates, the end-to-end spec, the docs, the `mainBundleBytes` ceiling down to 517,985 (the ratchet)
  - [x] 4- Verify and deliver (YAZ-2624): pull request #97 merged on 2026-10-07 (merge commit `fe411d4`), after CI was green and after Yaseen said the hand walk passed ("approved it all works").
- Now: CLOSED 2026-10-07. Merged, NOT released. The Linear record on YAZ-2619 is the source of truth; its last comment is the handoff.
- Remaining: nothing for an agent in this issue. YAZ-2602 takes this change when its branch merges (the note is on YAZ-2609).

## Open Questions

- CONFIRMED by Yaseen's hand walk: the tab row at the 180 px minimum sidebar (S22) and the accent of the active eye (S18).
- UNCONFIRMED: `desktop/e2e/focus.spec.ts` is written again for the new flow and typechecks, but nobody has run it.
- KNOWN: the renderer sizes pass only inside the 0.1% tolerance: `rendererEagerJsBytes` 1,956,962 (ceiling 1,956,581), `rendererEagerCssBytes` 137,729 (137,688), `rendererTotalBytes` 13,024,511 (13,012,712). The next renderer change can need a new ceiling.
- KNOWN: `yaz-2602-multi-vault` changes the same lines. It merges second, so it fixes the conflicts. YAZ-2609 has the list of its cases that this work changes; Yaseen must approve them before 2D starts.
- KNOWN: YAZ-2620 (search results as tree rows) will need new selectors in the S11 tests.

## Working Set

- The work is on `main` (`fe411d4`). The worktree and the branch are removed.
- Baseline at `129ee9e`: typecheck green; 294 test files, 5447 tests passed, 2 skipped. At the branch tip: 294 files, 5434 passed, 2 skipped.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`.
- A hand walk against a scratch vault: seed `<dir>/yaseendocs.json` in the shape of `seededState` (`desktop/e2e/helpers.ts`), with `"version": 1`; without it the app moves the file aside and starts on defaults. Then, from `desktop/`: `YASEEN_DOCS_USER_DATA_DIR=<dir> npx electron-vite dev`.
