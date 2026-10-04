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
- D11 the properties panel says "Properties from <folder>"; several folders is a choice, nearest with saved settings first; "Edit property" saves to the chosen folder.
- D12 deleting a column strips every note in that table, except a note another of its folders still has that column for (replaces YAZ-2290 E4).
- D13 every folder has a `.folder.md` with an `id` from the moment it exists (derived from its path when the app did not create it).
- D14 the `[[` picker offers a folder as "<name> (folder)" and inserts its ID.
- D15 a folder in sidebar search opens its page. D16 `comments` on a new folder says "no comments". D17 linked mentions include folder pages.
- The conversion table is approved (YAZ-2383): each page becomes the folder that holds its members; 2 shortcuts, 5 nestings, 2 relations dropped.

## State

- Done:
  - [x] Scope pass, decisions locked on YAZ-2375, 27 sub-issues created (YAZ-2381 to YAZ-2407)
  - [x] 1B: conversion table approved by Yaseen (YAZ-2383); a dry run confirmed it (352 rows for `AI-Dev-Hire/`, 73 for the QuickBooks folder, no membership lost)
  - [x] 4A draft 1: conversion and backfill instructions posted on YAZ-2396 (three items marked "verify" against the ported app)
  - [x] Phase 2: the fork (`c5bf2d5`) is applied (`ee7512d`), Docs names (`c13056f`), `folder_settings` key (`db3c178`), gates and ceilings (`95ad199`)
  - [x] 3A, 3B: a folder shows every note under it; the count matches (`7c7fb83`)
  - [x] 3C, 3D: upkeep is off until a vault turns it on
- Now: [→] Phase 3, the part decided on 2026-10-04 ("Locked decisions, part 3", D11 to D17), in this order: 3G every folder has an ID, 3E "Properties from <folder>", 3F deleting a column, 3H folder links by ID, 3J mentions from folder pages, 3I search opens a folder, 3K comments on a new folder
- Next: 1A and 1C close-out comments, then 4A (update the draft for D10 to D13) and 4B (the conversion on a copy)
- Remaining:
  - [ ] Phase 4: Convert the existing vault (4A, 4B before the walk-through; 4C, 4D last, after merge and install)
  - [ ] Phase 5: Polish and anti-slop
  - [ ] Phase 6: Verify, merge, install, close out

## Open Questions

- None blocking. Shortcuts and links to folders are both in the ported code.
- The fork's final commit is read from GitHub (`git ls-remote`); its local `main` ref is stale.

## Working Set

- Worktree: `.claude/worktrees/yaz-2375-merge`, branch `worktree-yaz-2375-merge`, based on `main` at `1f2f12b`.
- Fork: `~/Documents/GitHub/yaseen-notecards-app` (first commit `d37be37`). Vault: `~/Documents/GitHub/yaseen-docs-vault`.
- Linear: workspace `growprofit`, team YAZ, key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`.
- Gates: `npm run typecheck && npm test && npm run build && npm run perf:budget:ci`.
- Gotcha: `listItemCaretRestore` and `tooltipThrottle` tests fail on untouched `main` when the machine is loaded; re-run them alone before reading them as failures.
- Gotcha: use a real `npm install` in the worktree; a symlinked `node_modules` makes `App.test.tsx` and `crepeTheme.test.ts` fail to load.
