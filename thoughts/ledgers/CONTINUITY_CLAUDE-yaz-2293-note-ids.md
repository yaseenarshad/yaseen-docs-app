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
- Done (all on branch `yaz-2293-note-ids`, pushed; `main` at d333746 is merged in, commit 41aedd3):
  - [x] 1 scope; 2A/2B/2C ids on files; 3A/3B/3C/3D link by id; 4A/4B/4C Copy ID, reserved key, CLI
  - [x] 5A/5B polish (one `copyNoteId`; sweep renamed `sweepIds` in `vaultIndex/idSweep.ts`)
  - [x] 6A scenario audit: found and fixed "notes moved outside the app into a new folder lose
        their ids" (the sweep now counts only holders that are another file on disk)
  - [x] 6C docs (CONTRACTS "Note ids" section, REGRESSION N1–N12)
- [x] Creating a note in a folder adopts it (`adoptVault` in `idSweep.ts`, the `fs:create-file`
  handler, `sweepIndexed` in `live.ts`) — Yaseen's choice, locked as D10
- [x] `mainBundleBytes` ceiling raised to 490,469 with Yaseen's OK (D9)
- [x] MERGED TO `main` at 9a251e6 (fast-forward), 2026-10-04
- Now: [→] nothing in flight
- Remaining:
  - [ ] 6B hand walk-through in the dev app (14 steps on YAZ-2342) — Yaseen walks it, or computer
        use; NOT done. YAZ-2340 and YAZ-2293 stay In Progress until it is.

## Open Questions
- UNCONFIRMED by Yaseen: the sweep derives its id from the note's path and bytes instead of
  drawing a random one (D11 on YAZ-2293). He asked how it works; explained in chat.

## Working Set
- Worktree: `.claude/worktrees/yaz-2293-ids`, branch `yaz-2293-note-ids`
- Tests: `npx vitest run --project desktop <file>`, `npx vitest run --project client <file>`,
  full: `npm run typecheck && npm test && npm run build`
- Linear helper: scratchpad `lin.py` (move / comment / create), key in `~/Desktop/growprofit-ai.env`
