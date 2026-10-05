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
- D18 the real vault is converted in one sitting with YAZ-2420's conversion; the new build is not installed over the app before that.
- D19 each folder has its own properties: a folder's values for a note are in the note under `in:`, in the block named by the folder's id. The top level is the note's own fields.
- D20 a folder's values leave the note when the note leaves the folder (in-app move, removed shortcut, or the user's next change of a note moved outside the app); a block for a folder the app cannot find is kept; never on read.
- D21 a move, a Cut then Paste or "Remove shortcut" that would clear a folder's values asks first; one that clears nothing stays silent (amends YAZ-888 and YAZ-2290 E5).
- D22, replaced by D23: the properties panel is the search bar, "Note fields" (the note's own), a line, then "Properties from <folder>" directly over that folder's fields.
- D12's keep-rule is gone (D19): deleting a column removes that folder's values only.
- The conversion table is approved (YAZ-2383): each page becomes the folder that holds its members; 2 shortcuts, 5 nestings, 2 relations dropped.

## State

Linear is the record: every sub-issue has a "Done" comment, and YAZ-2375 has "Status and how to resume".

- Done:
  - [x] Phase 1: scope, decisions, conversion table (YAZ-2381 to 2384)
  - [x] Phase 2: the fork applied, Docs names, `folder_settings` (`ee7512d`, `c13056f`, `db3c178`, `95ad199`)
  - [x] 3A to 3K: every note under a folder, upkeep opt-in, folder ids, "Properties from", column delete, picker, search, mentions, comments
  - [x] 3L, 3M: each folder has its own properties, D19 (`e404b6a`)
  - [x] Phase 4: instructions at draft 5 on YAZ-2396 (conversion, values, backfill), each part proven on a copy. The real run is under YAZ-2420 (D18).
  - [x] 5A, 5B: polish review and pass (`7666355`)
  - [x] 3N, 3O, 3P: links inside a folder's values, a copied folder's values, values leave with the note (`3e22ff0`, `e68c045`)
  - [x] A value write changes only its own line of `in` (`3779e1f`, found in the walk-through)
  - [x] 5C: the Playwright specs the merge made false are deleted (`458a717`); a new suite is YAZ-2459
  - [x] 6B: the hand walk-through on the converted copy, through the app's DevTools port (no Playwright)
  - [x] 3Q: the app asks before a move that clears a folder's values, D21 (`847d200`)
  - [x] 3R: the properties panel's layout, D22 then D23 (`959e35e`, `70fe5a3`): search bar, "Note fields", a line, "Properties from <folder>"
  - [x] 6A: every scenario row mapped to its proof on YAZ-2404; the gaps a test could close are closed (`5466ed9`, `0014be0`)
  - [x] 6C docs; 6D merged to `main` by pull request #87 (`552ac88`), Yaseen approved the demo on 2026-10-04
- Now: closed. YAZ-2375 and every sub-issue are Done in Linear. No release, no install over the app (D18).
- Next (other issues, not this ledger): YAZ-2420 builds from `main`; the real vault's sitting (convert or rebuild, Yaseen decides); YAZ-2459 a new end-to-end suite; YAZ-2410 the vault's top level as a page.

The full handoff (goal, decisions D1 to D23, files, Yaseen's words, gotchas, next steps) is the last handoff comment on YAZ-2375 and the Linear project update of 2026-10-04.

## Standing notes for whoever picks this up

- Hand checks run on a fresh demo vault, never on the real vault or a copy of it (Yaseen, 2026-10-04). No Playwright.
- The message owed to the YAZ-2420 session was sent at the merge. `carryFolderValues` (`desktop/src/main/vaultIndex/idSweep.ts`) is the function its copy-at-copy-time work must call.
- The fork repo `yaseen-notecards-app` is finished with; everything it built is on `main`.

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
