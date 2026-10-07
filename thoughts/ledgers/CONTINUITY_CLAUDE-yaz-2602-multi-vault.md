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
- Size ceilings: Yaseen gave the OK in chat on 2026-10-07 to raise them for this work. Set each row that is over to the measured value once, in 4A, and name it in the pull request.
- Delivery path: the agent opens the pull request and stops; Yaseen does the hand walk (4B); the agent merges after he says it passed. No release.
- Commits carry no Claude attribution.

## Yaseen's standing instructions (2026-10-07, in chat)

- Merge order: the search (PR #96, YAZ-2620) first — DONE, merged as `7c77c93` by this agent. Then this work.
- "its going to be up to you to get allll the prs merged to main": this agent merges. PR #45 (`windows-fixes`) stays as it is ("no PR 45 you can leave for now").
- The hand walk comes BEFORE the merge of this work: "you can launch a demo vault and then i'll approve and then we can merge to main".
- A vault row has no focus item ("1 is fine, keep going"). Amendments A1 to A9 on YAZ-2602 are locked.
- Size ceilings can rise for this work ("no ok needed to raise the size gate, u have permission").
- CLOSEOUT is authorized for after the merge. Follow `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/1-yaseen-engineering-workflow/references/4-closeout.md`. Also: close out the OTHER issues if they are still open, attach each PR to its Linear issue (#95 YAZ-2589, #96 YAZ-2620, #97 YAZ-2619, this work's PR to YAZ-2602), and delete ALL the worktrees after the PRs are merged and everything is verified (`…-yaz-2602`, `-m`, `-r`, `…-yaz-2620`, `…-yaz-2589`), "cause u are the last one working".

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
  - [x] 2A the window's vault list in main (YAZ-2606): merged at `723826a`
  - [x] 2B one scope per vault in the renderer (YAZ-2607): merged at `2bf3b33`; the tree is green (5484 tests)
  - [x] 2C the sidebar: vault rows, add, remove (YAZ-2608): merged at `8e51d79`
  - [→] 2D focus, favorites, search, Inbox across vaults (YAZ-2609): built at `6b479e7` (5588 tests green on the old base). An agent on `yaz-2602-r` now merges `origin/main` (YAZ-2589, YAZ-2619) and then `origin/yaz-2620-search-tree` (YAZ-2620), by Amendments A1 to A9
  - [→] 2E workspaces in `⌘O` (YAZ-2610): both halves built and merged at `6b479e7`; Done after the merges with `main` are green
- Next: 3- Polish and anti-slop (YAZ-2611): 3A audit (YAZ-2612), 3B apply (YAZ-2613)
- Remaining:
  - [ ] 4A scenario table, the e2e spec, the perf scenario, gates (YAZ-2615)
  - [ ] 4B guided hand walk — Yaseen (YAZ-2616)
  - [ ] 4C docs (YAZ-2617)
  - [ ] 4D pull request, merge, close out (YAZ-2618)

## Open Questions

- `main` moved three times under this work: YAZ-2589 (#95), YAZ-2619 (#97), YAZ-2620 (#96). After the agent's two merges, merge `origin/main` once more (it is then only the merge commit `7c77c93`).

## Working Set

- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2602`, branch `yaz-2602-multi-vault`, from `main` at `4e0d302`.
- Agent worktrees: `…-yaz-2602-m` (branch `yaz-2602-m`), `…-yaz-2602-r` (branch `yaz-2602-r`), both from `ed7fb64`. Merge them into the main worktree and run the checks again there.
- Baseline: `npm test` 5421 passed, 2 skipped; a known flake is an unhandled `ENOTEMPTY … mdapp-…` temp-folder cleanup error.
- Checks: `npm run typecheck` · `npm test` · `npm run build` · `npm run perf:budget:ci`.
