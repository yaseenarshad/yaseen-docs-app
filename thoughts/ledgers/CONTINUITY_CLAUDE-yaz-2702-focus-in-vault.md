# YAZ-2702 — Focus and favorites travel with the vault

## Goal
- Focus is one list for each vault, stored in the vault. It is the same in each window, on each Mac that syncs the vault, and after a shutdown.
- A change of focus or of a favorite starts a sync, with no note edit.
- Done = the four gates are green, the check in the real app passes, the pull request is merged. NO release in this run: Yaseen puts it into a release that a different agent cuts.

## Constraints
- No Playwright on this Mac: it takes over the screen. The e2e specs are written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- A check in the real app runs out of sight: `open -g` on Electron with its own profile and a demo vault, each window gets opacity 0 through main's inspector, and the DevTools protocol drives the real UI.
- Linear: the main issue's comments are for humans. Agent records go on the working log YAZ-2703 and on the subissues.
- Commits through the `/commit` skill (no Claude attribution).

## Key Decisions (locked on YAZ-2703, with rules R1–R13 and cases S1–S21)
- D1: the focus list is the vault's, in `<vault>/.yaseendocs/`. `WindowEntry.focusList` is gone. Overturns YAZ-1628 D1, YAZ-2619 D1/S25/S27/R13, YAZ-2602 A5.
- D2: one file for each Mac, `focus.<mac id>.json` = `{ version, at, focus }`, and the newest `at` is the list. Two Macs never change one file, so a sync cannot conflict (the rule of the count files, YAZ-2681 R15). Rejected: one shared `focus.json`.
- D3: the order across the vaults of one window is `AppState.focusOrder`, on each Mac, by the rule and the merge function of `favoritesOrder`.
- D4: no migration. The loader does not read the old `windows[].focusList`.
- D5: a change of a JSON file in `.yaseendocs/`, apart from `github.json`, marks the vault pending and starts the quiet wait (30 s), then one pass.
- Found in the run: with two or more vaults an add to focus also writes `focusOrder`, so a new item is the last row ("the order added", YAZ-2619 D1). Favorites writes no order on an add (YAZ-2631 R13).
- Known and accepted: two Macs that change focus while offline are not merged, the later change is the list. A write drops an entry whose file is not on that Mac (R7), and that write is then the newest list for each Mac.
- Favorites needed no build: the list is in the vault since YAZ-1766 D11. D5 was its only gap.

## State
- Done:
  - [x] Scope, decisions, rules and cases locked on YAZ-2703
  - [x] 1 (YAZ-2704) `desktop/src/main/focus.ts`, the `focus.*` bridge, the repair on rename and delete
  - [x] 3 (YAZ-2706) `markPending` in `desktop/src/main/git/manager.ts`
  - [x] 2 (YAZ-2705) `useVaultLists` in `client/src/sidebar/hooks/useVaultTree.ts`, `focusOrder`, the window list removed, the docs
  - [x] 4 (YAZ-2707) polish: the new item goes last with two or more vaults
  - [x] 5 (YAZ-2708) gates, and the checks in the real app: before (1.0.3) the list is lost, after it stays; two profiles on two clones of one git remote show one list
  - [x] Merged to `main` by pull request #109 (`2280329`). NO release was cut: Yaseen puts this work into a release that a different agent cuts
- Now: closed. The handoff is on YAZ-2703.
- Next: nothing in this issue. One guided check for Yaseen on his two real Macs after the release: add focus on one Mac, wait 30 seconds, look at the other Mac.

## Open Questions
- (resolved) `mainBundleBytes` grew by 4,845 bytes (584,905 → 589,750): the main bundle is not minified, and the ceiling was the exact size of 1.0.3. Yaseen approved the raise of the ceiling.
- UNCONFIRMED: the Playwright specs `focus.spec.ts`, `multiVault.spec.ts` and `search.spec.ts` changed and are typechecked, and nobody ran them.

## Working Set
- Branch `feat/yaz-2702-focus-in-vault` from `main` at `fa79bce`, merged by #109. The worktree is removed.
- Main: `desktop/src/main/focus.ts`, `desktop/src/main/ipc/focus.ts`, `desktop/src/main/ipc/fs.ts`, `desktop/src/main/favorites.ts` (`remap`, `renamedTo`, `deletedAt`, shared with focus), `desktop/src/main/git/manager.ts`, `desktop/src/main/store.ts`
- Shared: `shared/types.ts` (`FocusConfig`, `AppState.focusOrder`), `shared/ipc.ts` (`CONTRACT.focus`, `state.setFocusOrder`)
- Renderer: `client/src/sidebar/hooks/useVaultTree.ts`, `client/src/lib/storage.ts`
- Tests: `npx vitest run desktop/src/main/focus.test.ts client/src/sidebar/Sidebar.test.tsx desktop/src/main/git/manager.test.ts`
