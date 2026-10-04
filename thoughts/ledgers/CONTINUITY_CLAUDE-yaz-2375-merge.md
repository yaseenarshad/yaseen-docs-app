# YAZ-2375 — Merge the fork into Yaseen Docs

## Goal

- The three features built in the fork `yaseen-notecards-app` (folders as pages, note IDs, upkeep review) are on docs-app `main` under the Yaseen Docs name, and `yaseen-docs-vault` works with them with nothing lost.
- Done means: every issue under YAZ-2375 (YAZ-2381 to YAZ-2407) is Done, `main` passes the gates, the installed app opens the converted real vault, and Yaseen has seen the final demo.

## Constraints

- The decision record is YAZ-2375's comments ("Locked decisions" parts 1 and 2, with the scenario record). Issues execute it; a new design question goes to Yaseen in the decision format.
- No Playwright, by anyone, including subagents. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`, and a hand walk-through in the dev app.
- No release or version tag unless Yaseen asks.
- Nothing one-time is committed (no converter, no backfill tool): instructions in Linear, run by an agent.
- Commits go through the `/commit` skill. Yaseen gave permission to commit, push and merge to `main` when the work is done.
- Linear: move the parent and the child to In Progress on start, Done on finish; record decisions, learnings and gotchas as comments; new work becomes a numbered child and is finished in this run if leaving it would be debt.
- Subagents, if used, are Opus 5.5; I own their code quality.

## Key Decisions

- D1 the fork comes over once, after its sessions finish, as one three-way patch pinned by hash (`git diff --binary d37be37 <final> | git apply --3way --index`), Docs icon kept.
- D2 Yaseen Docs everywhere; "note", never "notecard".
- D3 the vault is converted once by an agent from a sub-issue's instructions and a per-page table Yaseen approves.
- D4 a folder shows every note under it at any depth plus its shortcuts; subfolders are never rows.
- D5 IDs are written on first open and are derived (confirms YAZ-2293 D11).
- D6 name links are backfilled to ID links once, by an agent, after the merge.
- D7 upkeep is off until a vault turns it on (`enabled` in `.yaseendocs/review.json`, default false).
- D8 size ceilings are set to what the finished branch measures.
- D9 the fork finishes its own build issues; the hand walk-throughs happen once, in docs-app.
- D10 legacy "folder page" names are renamed; the on-disk key is `folder_settings`; old-model Playwright specs are deleted.

## State

- Done:
  - [x] Scope pass, decisions locked on YAZ-2375, 27 sub-issues created (YAZ-2381 to YAZ-2407)
  - [x] 1B: conversion table approved by Yaseen (YAZ-2383); a dry run confirmed it (352 rows for `AI-Dev-Hire/`, 73 for the QuickBooks folder, no membership lost)
  - [x] 4A draft 1: conversion and backfill instructions posted on YAZ-2396 (three items marked "verify" against the ported app)
- Now: [→] Phase 1: Scope and lock the merge (1A and 1C wait on the fork's final commit; a background check runs every 10 minutes: `scratchpad/fork_check.py`)
- Next: Phase 2: Bring the code over (starts when the fork is finished)
- Remaining:
  - [ ] Phase 3: Docs-app changes to the fork's behavior (D4, D7)
  - [ ] Phase 4: Convert the existing vault (4A, 4B before the walk-through; 4C, 4D last, after merge and install)
  - [ ] Phase 5: Polish and anti-slop
  - [ ] Phase 6: Verify, merge, install, close out

## Open Questions

- UNCONFIRMED: the fork's final commit. Shortcuts (YAZ-2306 to 2308) and links to folders (YAZ-2304) were not built when the scope was taken; the conversion depends on both.

## Working Set

- Worktree: `.claude/worktrees/yaz-2375-merge`, branch `worktree-yaz-2375-merge`, based on `main` at `1f2f12b`.
- Fork: `~/Documents/GitHub/yaseen-notecards-app` (first commit `d37be37`). Vault: `~/Documents/GitHub/yaseen-docs-vault`.
- Linear: workspace `growprofit`, team YAZ, key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`.
- Gates: `npm run typecheck && npm test && npm run build && npm run perf:budget:ci`.
- Gotcha: `listItemCaretRestore` and `tooltipThrottle` tests fail on untouched `main` when the machine is loaded; re-run them alone before reading them as failures.
- Gotcha: use a real `npm install` in the worktree; a symlinked `node_modules` makes `App.test.tsx` and `crepeTheme.test.ts` fail to load.
