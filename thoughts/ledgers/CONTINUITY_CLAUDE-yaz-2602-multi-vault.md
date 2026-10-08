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
- The hand walk comes BEFORE the merge of this work: "you can launch a demo vault and then i'll approve and then we can merge to main". The agent STARTS the dev app itself on scratch vaults with an isolated user-data dir ("no start command needed, you just launch the test vault automatically and then i'll go through it hand walk"). The agent does not drive the app; Yaseen does each step.
- A vault row has no focus item ("1 is fine, keep going"). Amendments A1 to A10 on YAZ-2602 are locked.
- The hand walk passed: "all steps pass, go ahead and merge".
- A release follows the closeout, by `5-release-notes.md` of the engineering workflow: "i want it to be sections for each of the major parts we've done here". "no need to show me title and notes in chat before publish, i give you ok".
- Size ceilings can rise for this work ("no ok needed to raise the size gate, u have permission").
- CLOSEOUT is authorized for after the merge. Follow `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/1-yaseen-engineering-workflow/references/4-closeout.md`. Also: close out the OTHER issues if they are still open, attach each PR to its Linear issue (#95 YAZ-2589, #96 YAZ-2620, #97 YAZ-2619, this work's PR to YAZ-2602), and delete ALL the worktrees after the PRs are merged and everything is verified (`…-yaz-2602`, `-m`, `-r`, `…-yaz-2620`, `…-yaz-2589`), "cause u are the last one working".

## Key Decisions

- D1: `WindowEntry.roots` (every vault, `root` first); the renderer keeps one scope per vault, all loaded.
- The renderer's scopes are SLOTS: `useVaultScope(root | null)` is called `MAX_WINDOW_ROOTS` (8) times per render, so a scope exists in the first render and a vault keeps its slot (the map is a comment on YAZ-2604).
- D6: a window is on each vault that it shows (the open door, link routing, "Open" in `⌘O`).
- D8: workspaces are `AppState.vaultSets`; the user reads "Workspace".
- R11: a drag of a file to a different vault is refused; cut and paste does it.

## State

- Now: CLOSED 2026-10-07. Merged by pull request #98 as `0a2326d`, after Yaseen's hand walk ("all steps pass, go ahead and merge"). Released in 0.9.36. The Linear record on YAZ-2602 is the source of truth; its last comment is the handoff.
- Done:
  - [x] 1- Scope (YAZ-2603), 1A the map of `App.tsx` (YAZ-2604)
  - [x] 2- Build (YAZ-2605): 2A (YAZ-2606), 2B (YAZ-2607), 2C (YAZ-2608), 2D (YAZ-2609), 2E (YAZ-2610). The branch took `main` three times (YAZ-2589, YAZ-2619, YAZ-2620) by Amendments A1 to A10.
  - [x] 3- Polish and anti-slop (YAZ-2611): 3A the audit, 24 findings (YAZ-2612); 3B applied (YAZ-2613)
  - [x] 4- Verify and deliver (YAZ-2614): 4A the case table and the gates (YAZ-2615), 4B the hand walk (YAZ-2616), 4C the docs (YAZ-2617), 4D the pull request and the merge (YAZ-2618)
- Checks at the pull request's head `829fdd9`: `npm test` 5646 pass, 0 fail; both size gates PASS (five ceilings raised, with Yaseen's OK).
- Written and not run: `desktop/e2e/multiVault.spec.ts`, `tools/perf/scenarios/multi-vault.mjs`.

## Open Questions

- `main` moved three times under this work: YAZ-2589 (#95), YAZ-2619 (#97), YAZ-2620 (#96). After the agent's two merges, merge `origin/main` once more (it is then only the merge commit `7c77c93`).

## Working Set

- Closed. The worktrees `…-yaz-2602`, `-m` and `-r` and their branches are removed.
