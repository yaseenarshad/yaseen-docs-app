# YAZ-2602 — several vaults in one window

## Goal

- One window shows two or more vaults: one folder row per vault in the sidebar, added from the empty-space menu, removed from the vault row.
- Focus Mode, Favorites, tabs, the right panel and `⌘K` work across the window's vaults.
- A set of vaults is saved by hand as a workspace and listed first in `⌘O`.
- A window with one vault looks, works and measures exactly as before.
- Done = each case S1 to S80 has a test or a passed hand-walk step, and the work is on `main`.

## Constraints

- The record is the source of truth: two comments on [YAZ-2602](https://linear.app/growprofit/issue/YAZ-2602/multi-vault-opening-in-single-window) — "Locked decisions and scope (D1 to D8)" and "The scenario record (S1 to S80) and the small rules (R1 to R12)". A case is stronger than a diff.
- No Playwright, no Electron, no dev app from an agent. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never a real vault. Fixtures and temp folders only.
- A size row over its ceiling in `tools/perf/budget.json` needs Yaseen's OK.
- Delivery path: the agent opens the pull request and stops; Yaseen does the hand walk (4B); the agent merges after he says it passed. No release.
- Commits carry no Claude attribution.

## Key Decisions

- D1: `WindowEntry.roots` (every vault, `root` first); the renderer keeps one scope per vault, all loaded.
- The renderer's scopes are SLOTS: `useVaultScope(root | null)` is called `MAX_WINDOW_ROOTS` (8) times per render, so a scope exists in the first render and a vault keeps its slot (the map is a comment on YAZ-2604).
- D6: a window is on each vault that it shows (the open door, link routing, "Open" in `⌘O`).
- D8: workspaces are `AppState.vaultSets`; the user reads "Workspace".
- R11: a drag of a file to a different vault is refused; cut and paste does it.

## State

- Done:
  - [x] 1- Scope (YAZ-2603), 1A the map of `App.tsx` (YAZ-2604)
- Now: [→] 2- Build (YAZ-2605)
  - [→] 2A the window's vault list in main (YAZ-2606): code in `ed7fb64`; tests by an agent on `yaz-2602-m`
  - [→] 2B one scope per vault in the renderer (YAZ-2607): an agent on `yaz-2602-r`
  - [ ] 2C the sidebar: vault rows, add, remove (YAZ-2608) — the demo
  - [ ] 2D focus, favorites, search, Inbox across vaults (YAZ-2609)
  - [ ] 2E workspaces in `⌘O` (YAZ-2610)
- Next: 3- Polish and anti-slop (YAZ-2611): 3A audit (YAZ-2612), 3B apply (YAZ-2613)
- Remaining:
  - [ ] 4A scenario table, the e2e spec, the perf scenario, gates (YAZ-2615)
  - [ ] 4B guided hand walk — Yaseen (YAZ-2616)
  - [ ] 4C docs (YAZ-2617)
  - [ ] 4D pull request, merge, close out (YAZ-2618)

## Open Questions

- UNCONFIRMED: whether the bundle crosses a ceiling in `tools/perf/budget.json` (measured in 2B and 4A).
- A different session works on `yaz-2589-startup-windows`, which can touch `desktop/src/main/windows.ts`: reconcile in 4D if it merged.

## Working Set

- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2602`, branch `yaz-2602-multi-vault`, from `main` at `4e0d302`.
- Agent worktrees: `…-yaz-2602-m` (branch `yaz-2602-m`), `…-yaz-2602-r` (branch `yaz-2602-r`), both from `ed7fb64`. Merge them into the main worktree and run the checks again there.
- Baseline: `npm test` 5421 passed, 2 skipped; a known flake is an unhandled `ENOTEMPTY … mdapp-…` temp-folder cleanup error.
- Checks: `npm run typecheck` · `npm test` · `npm run build` · `npm run perf:budget:ci`.
