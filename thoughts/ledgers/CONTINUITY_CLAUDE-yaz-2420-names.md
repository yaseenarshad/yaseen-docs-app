# YAZ-2420: titles, IDs and file names

Linear: https://linear.app/growprofit/issue/YAZ-2420/copy-path-and-id-architecture
The record is the comment "Decision and scenario record, final" (D1 to D30). Read it before anything here.

## Goal

- A note's title, ID and file name are three things with one job each: `title:` and `id:` in the note, and a file name the app builds as `<kebab-title>-<id>.md`.
- Done means: phases 1 to 6 under YAZ-2420 are Done, the work is on `main`, and Yaseen's real vault has been converted in one sitting. (All true since 2026-10-05.)

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
  - [x] Scope, decisions D1 to D33, and the sub-issue tree
  - [x] Phase 1: 1A re-pin to `main` (1B parked with phase 4, D33)
  - [x] Phase 2: 2A index record, 2B every screen, 2C name links, 2D tables, 2E command line, 2F search by ID
  - [x] Phase 3: 3A builder, 3B new notes, 3B1 typed path links, 3C retitle, 3D folders, 3E copies, 3F one copy item, 3G another tool's `id`
  - [x] Phase 5: 5A an independent review (33 items), 5B applied (30 of them)
  - [x] Phase 6: 6A unit tests and the whole Playwright suite (229), 6B walk-through on the real app (`desktop/e2e/names.spec.ts`), 6C docs
  - [x] 3E1 a copy into another folder leaves behind values it does not show, after asking; 3C1 the "Ask before renaming" setting
  - [x] 6D: merged as pull request #89 (`0472906`), with the two size ceilings set to the measured values on Yaseen's OK; released as v0.9.33
  - [x] Phase 4 and 1B: both vaults converted and pushed on 2026-10-05 (`yaseen-docs-vault` at `85a00a8`, `business-wiki-MASTER` at `848d492`); a built name keeps a leading underscore (pull request #90, on `main`, not released). Records: YAZ-2439 and YAZ-2524. Scripts and logs are outside the repo, in `~/Desktop/yaz-2420-trial/` and in those issues' comments.
- Now: closed. v0.9.33 is installed on Yaseen's Mac.
- Remaining:
  - [ ] YAZ-2523 (a vault can say no to IDs): another session has it
  - [ ] `desktop/e2e/links.spec.ts` step 7 has a timing race (it picks a note before the app has given it its ID); harden it the next time Playwright is allowed

## Open Questions

- None. Q1 (yes), Q2 (D34) and Q3 (D35) were answered on 2026-10-05; see "Yaseen's answers to Q1, Q2 and Q3" on YAZ-2420.

## Working Set

- Branch `yaz-2420-names` (pushed), worktree `.claude/worktrees/yaz-2420-names`, rebased onto `main`; pull request #89.
- `npm ci` was run inside this worktree. Do not borrow the main checkout's `node_modules` through a link: two test files then fail to load.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. The walk-through: `npm run build -w desktop && npx playwright test --config desktop/e2e/playwright.config.ts names.spec.ts` (Playwright only when Yaseen allows it for that run).
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; issue writing follows `growprofitai/_code-wiki/Linear-Simpler`.
