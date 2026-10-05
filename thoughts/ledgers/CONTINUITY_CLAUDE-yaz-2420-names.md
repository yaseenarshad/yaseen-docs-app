# YAZ-2420: titles, IDs and file names

Linear: https://linear.app/growprofit/issue/YAZ-2420/copy-path-and-id-architecture
The record is the comment "Decision and scenario record, final" (D1 to D30). Read it before anything here.

## Goal

- A note's title, ID and file name are three things with one job each: `title:` and `id:` in the note, and a file name the app builds as `<kebab-title>-<id>.md`.
- Done means: phases 1 to 6 under YAZ-2420 are Done, the work is on `main`, and Yaseen's real vault has been converted in one sitting.

## Constraints

- The build waits for YAZ-2375 to be on `main` (D10). Do not start a sub-issue early: every one changes files that session is still editing.
- No Playwright, by anyone, including subagents. Proof is `npm run typecheck`, `npm test`, `npm run build`, the size-budget gate, and a hand walk-through in the dev app on a scratch vault.
- No release or version tag unless Yaseen asks. No build installed over his app before the vault is converted.
- A design, architecture or behavior question goes to Yaseen in the decision format. Bugs and edge cases are the lead's call.
- Built for a vault that starts empty. The old vault is phase 4 only, run once by an agent; no converter in the repo.
- Never edit the YAZ-2375 worktree (`.claude/worktrees/yaz-2375-merge`); read only.

## Key Decisions

- The ID is in the file name on disk; the frontmatter `id` stays the truth (D1, D4).
- The title is `title:` in frontmatter, not the file name (D2). Replaces the rule in `client/src/editor/PageTitle.tsx:4`.
- The app builds a name only at creation, on an in-app title edit, and on an in-app copy. It never renames a file it did not name (D5).
- Folders: kebab-case name, no ID in it, `title:` in `.folder.md` (D6).
- One retitle operation for the page title, the sidebar and a table's Name cell (D16, D19, D26).
- Every note has an ID this app made; another tool's `id` is replaced (D30).

## State

- Done:
  - [x] Scope, decisions D1 to D30, and the sub-issue tree (YAZ-2423 to YAZ-2450, YAZ-2457)
  - [x] 3A: `shared/noteName.ts` (`kebabTitle`, `noteFileName`) with 9 tests, commit `ee09431`
- Now: [→] Waiting for YAZ-2375 to reach `main`. Its session ("1-Notecard Updates into Docs") sends one message when it merges.
- Next: 1A (YAZ-2424): rebase this branch onto `main`, re-pin every line reference in the sub-issues.
- Remaining:
  - [ ] Phase 1: 1A re-pin, 1B the vault's rename table for Yaseen
  - [ ] Phase 2: 2A index record, 2B every screen, 2C name links, 2D tables, 2E command line
  - [ ] Phase 3: 3B new notes, 3C retitle, 3D folders, 3E copies, 3F remove "Copy for Agent", 3G another tool's `id`
  - [ ] Phase 4: 4A instructions, 4B a copy, 4C and 4D (YAZ-2398, YAZ-2399), 4E the renames
  - [ ] Phase 5: 5A scope the polish, 5B apply it
  - [ ] Phase 6: 6A scenario tests, 6B hand walk-through, 6C docs, 6D merge and close out

## Open Questions

- UNCONFIRMED: the name and file of the function that moves a copied folder's `in:` blocks (YAZ-2455). 3E must call it. Comes with the merge message.
- UNCONFIRMED: which `in:` blocks a note keeps when it is copied into a different folder (YAZ-2375 D20). Ask at the merge.
- UNCONFIRMED: every line reference in the sub-issues. They were read at `fb78c31`; that branch has moved to `7666355` and keeps moving.

## Working Set

- Branch `yaz-2420-names` (pushed), worktree `.claude/worktrees/yaz-2420-names`, branched from the YAZ-2375 branch at `fb78c31`.
- `node_modules` in this worktree is a symlink to the main checkout's; it is listed in `.git/info/exclude`.
- One test file: `npx vitest run --project desktop desktop/src/main/noteName.test.ts`
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; issue writing follows `growprofitai/_code-wiki/Linear-Simpler`.
