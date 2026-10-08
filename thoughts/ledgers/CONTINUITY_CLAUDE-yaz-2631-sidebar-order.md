# YAZ-2631: flat favorites, no folder counts, drag to reorder, quiet vault name

Linear: https://linear.app/growprofit/issue/YAZ-2631
The record is two comments there: "Locked decisions and scope (D1 to D6)" and "The scenario record (S1 to S62) and the small rules (R1 to R12)". Read them before anything here.

## Goal

- The Favorites tab is one flat list across the vaults of the window, and a drag reorders it across vaults.
- No folder row shows a number. The Focus tab reorders by drag. The vault name on a top row is small and light.
- The vault rows of the Files tab reorder by drag. "Collapse all" also closes the vault rows.
- Done means: YAZ-2632 to YAZ-2637 are Done, the pull request is merged when Yaseen says so, and he has done the hand walk.

## Constraints

- No Playwright, by anyone. No agent-started Electron. Never open or test on a real vault.
- No release unless Yaseen asks.
- Delivery path: open the pull request and stop. Yaseen does the hand walk. Merge only after he says it passed, and after CI is green (the path of YAZ-2619 and YAZ-2602).
- Commits go through the `/commit` skill.
- The size ceilings in `tools/perf/budget.json`: Yaseen gave his OK in chat (2026-10-08) to raise one that this work trips. The lead raises it to the measured value in issue 6, and says so in the pull request. A build agent does not edit the file.

## Key Decisions

- D1 each vault keeps its `favorites.json`; `AppState.favoritesOrder` (per machine, 4,000 at most) says which vault has each place of the flat list; inside a vault its file's order wins.
- D2 the folder counts leave the tree; the Inbox due number and "N in focus" stay.
- D3 one drag rule on the three tabs: a top row reorders, a file inside a folder moves on disk; one reorder state.
- D4 the vault name on a top row: 10px, muted at 60%, 40% of the row at most.
- D5 the vault rows reorder; the sidebar has a stable key; a saved workspace of the same vaults takes the order.
- D6 on Files with two or more vaults, "Collapse all" / "Expand all" also close and open the vault rows.

## State

- Done:
  - [x] Scope: D1 to D6, S1 to S62, R1 to R12 (in the parent's comments)
  - [x] The issue tree: YAZ-2632 to YAZ-2637
  - [x] 1- No folder counts, small vault name (YAZ-2632), commit `008c69a`
  - [x] 2- One drag rule, the Focus tab reorders (YAZ-2633), commit `6084c31`
  - [x] 3- Flat Favorites with an order across vaults (YAZ-2634), commit `d5dd697`; Amendment 1 (R13 to R18) on the parent
  - [x] 4- Vault rows reorder, "Collapse all" closes them (YAZ-2635), commit `0694578`; Amendment 2 (R19 to R22) on the parent
- Now: [→] 5- Polish and anti-slop (YAZ-2636): the audit (an agent, read-only) and the docs (a second agent, `docs/` and `desktop/e2e/` only)
- Next: apply the audit; then 6- Verify and deliver (YAZ-2637)
- Remaining:
  - [ ] 6- the size ceiling `mainBundleBytes` (D8), the case list, the pull request, the guided hand walk

## Open Questions

- CONFIRMED by Yaseen in chat (2026-10-08, "yes that delivery path is good"): the delivery path above.

- KNOWN: at `0694578` the size gate fails on `mainBundleBytes` alone: 526,412 against 524,920 (+1,492). `rendererEagerJsBytes` is 1,977,702 and passes inside the 0.1% tolerance with 907 bytes left.
- KNOWN: the Playwright specs in `desktop/e2e` are edited and typechecked. Nobody has run them.

## Working Set

- Tests at `0694578`: 296 files, 5659 passed, 2 skipped. Baseline at `4990442`: 296 files, 5646 passed, 2 skipped.

- Worktree: `.claude/worktrees/yaz-2631-sidebar-order`, branch `yaz-2631-sidebar-order`, from `main` at `4990442` (0.9.36).
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
- A hand walk against a scratch vault: seed `<dir>/yaseendocs.json` in the shape of `seededState` (`desktop/e2e/helpers.ts`), with `"version": 1`. Then, from `desktop/`: `YASEEN_DOCS_USER_DATA_DIR=<dir> npx electron-vite dev`.
