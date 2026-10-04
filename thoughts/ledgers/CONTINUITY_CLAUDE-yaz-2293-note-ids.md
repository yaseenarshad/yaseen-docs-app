# YAZ-2293 — MD files get IDs

## Goal
Every note carries a permanent frontmatter `id`; links are `[[<id>]]` on disk and read as the
target's current title in the app; "Copy ID" and two CLI verbs expose the ID. Done = every Linear
sub-issue YAZ-2323..YAZ-2343 is Done, the scenario record on YAZ-2293 holds, `npm run typecheck`,
`npm test` and `npm run build` pass, and the branch is merged to `main`.

## Constraints
- Decisions D1–D8 and the scenario record are LOCKED in the YAZ-2293 comments. Execute, do not reopen.
- No Playwright, ever (not by subagents either). No release.
- TDD: failing test first, watched failing.
- Commits through the `/commit` skill (no Claude attribution).
- Subagents, when used, run Opus; I write the contract tests and review every diff.
- Another session builds YAZ-2290 (folders as pages) in `.claude/worktrees/yaz-2290-folders` and
  merges to `main` unit by unit. Pull `main` before each phase. Phase 2 here merges to `main` FIRST.

## Key Decisions
- `IndexRecord.id` is OPTIONAL (`id?: string`), not `string | null` as the D1 text says: same
  meaning, follows `frontmatterError?`, and avoids editing 39 test files of record literals.
- `createFile` refuses a caller-supplied `id` that is not a note id (`BAD_REQUEST`).
- A new note's `id` is appended after the seed's own keys (what `setFrontmatterProperty` does).
- The SWEEP derives its id (sha256 of vault-relative path + bytes), it does not draw a random
  one: the built-in sync stops on any conflict, and two devices stamping different ids into the
  same note is one. Creation still mints random ids. TO CONFIRM WITH YASEEN.
- The sweep writes only in an ADOPTED vault (`.yaseendocs/` exists), the app's standing rule in
  `ensureHome.ts`. TO CONFIRM WITH YASEEN (YAZ-2290 removes Home; what adopts a fresh vault?).
- `desktop/src/main/fs/viewsFixture.ts` is now an un-adopted folder so the sweep stays out of the
  existing index tests.

## State
- CLOSED OUT 2026-10-04. Everything is on `main`; the feature branches and the worktree are deleted.
  The full handoff is the comment "Handoff" on Linear YAZ-2293; read that first.
- Done:
  - [x] 1 scope; 2A/2B/2C ids on files; 3A/3B/3C/3D link by id; 4A/4B/4C Copy ID, reserved key, CLI
  - [x] 5A/5B polish; 6A scenario audit; 6B walk-through in the dev app; 6C docs
  - [x] D9 ceiling raised; D10 creating a note adopts the folder; D11 swept ids are derived
  - [x] YAZ-2378 the sweep never writes an id another note holds
  - [x] YAZ-2380 a note created in the app and deleted outside is seen to go (`createDurable`)
  - [x] follow-ups: `id` is never a default column; `desktop/e2e/links.spec.ts`; CACHE_VERSION in docs
- Not verified (none blocks anything):
  - Walk-through step 12 (a link cell in a table view) was never walked in the app; unit tests cover it.
  - The dimmed look of a dead id link and the " > " in `Title > Heading` were never looked at by eye.
  - Walk-through step 8 (delete the target) was not re-run in the app after the YAZ-2380 fix.
  - `desktop/e2e/*.spec.ts` are typechecked only; none was run (no Playwright, by instruction).
- Deferred: YAZ-2344, a clickable `yaseendocs://id/<id>` link.

## Open Questions
- None open. D1–D11 are locked on YAZ-2293 (comments "Locked decisions, part 1–4" and "D11").

## Working Set
- Worktree and branches: removed at closeout; start a new branch from `main`
- Tests: `npx vitest run --project desktop <file>`, `npx vitest run --project client <file>`,
  full: `npm run typecheck && npm test && npm run build`
- Linear helper: scratchpad `lin.py` (move / comment / create), key in `~/Desktop/growprofit-ai.env`
