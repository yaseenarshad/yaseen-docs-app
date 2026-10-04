# YAZ-2322 — Upkeep review

## Goal
Every note is checked for upkeep on a schedule: untouched and unchecked long enough, it comes
up in an Inbox; "Still relevant" pushes the next check out, an edit starts the wait over. Done =
every Linear sub-issue YAZ-2345..YAZ-2369 is Done, the scenario record on YAZ-2322 holds,
`npm run typecheck`, `npm test` and `npm run build` pass, and the branch is merged to `main`.

## Constraints
- Decisions D1–D9, C and the upkeep rule are LOCKED in the YAZ-2322 comments (parts 1, 3, 4; part
  3 replaces part 1's D3, D4 and D7 defaults). Execute, do not reopen.
- No Playwright, ever (not by subagents either). No release.
- TDD: failing test first, watched failing. Commits through the `/commit` skill (no attribution).
- Subagents run Opus; I write the contract tests and review every diff.
- Two other sessions build in this repo: YAZ-2290 (folders, merges to `main` unit by unit) and
  YAZ-2293 (IDs, branch `yaz-2293-note-ids`). Second to merge rebases and takes the next
  `CACHE_VERSION` (YAZ-2293 landed first with 4; this branch has 5).
- `tools/perf/budget.json` ceilings are at zero headroom; raising one needs Yaseen's OK.

## Key Decisions
- `IndexRecord.reviews?` and `IndexRecord.text?` are OPTIONAL: absent = never reviewed / file not
  read. An absent `text` keeps an unread file out of review; ~45 fixtures stay untouched.
- The index carries only `at`, `rating`, `text` per review; other keys stay in the file.
- `ReviewSettings` lives in `shared/reviews.ts`; settings go through the existing generic
  `vaultConfig` door (no new IPC, nothing added to the main bundle).
- A session checks a card against the live index only when its turn comes, never while it shows.
- For a never-reviewed (or edited-since) note the clock is the file's modified time, so ANY
  write to it restarts the base wait. Recorded on YAZ-2322 as a correction to scenario table B.

## State
- Done:
  - [x] 1: decisions and scenario record locked; seam notes on every issue
  - [x] 2A: `shared/reviews.ts` (log, fingerprint, settings sanitiser)
  - [x] 2B: scanner, `CACHE_VERSION` 5 (YAZ-2293 landed first with 4), reserved keys
  - [x] 2C: `useReviewSettings`, wired through App
  - [x] 3A/3B: `shared/schedule.ts` (`dueAt`, `dueAfter`, `isDue`, `isInReview`, `reviewQueue`)
  - [x] 4A–4D: Inbox row, review surface (`ReviewBar`), "Review this folder", the on/off toggle
  - [x] 4E–4F: Reviews section, Settings › Review
  - [x] 4G: `yaseendocs due`
  - [x] 5A/5B: polish scoped and applied
  - [x] 6A: scenario rows mapped to tests; 6B: walk-through in the built app; 6C: docs
  - [x] Size ceiling: `mainBundleBytes` raised to the measured 495,868 with Yaseen's OK
- Now: [→] merged to `main`
- Remaining: nothing in this project. Future issues: YAZ-2370 (memory review, FSRS),
  YAZ-2371 (sides and clozes), YAZ-2372 (smarter upkeep signals).

## Open Questions
- None blocking. Recorded on YAZ-2322 for Yaseen: the ID sweep resets every never-reviewed
  note's clock once per vault, and undoing a note's only review leaves it not due.

## Working Set
- Branch `yaz-2322-review`, worktree `.claude/worktrees/yaz-2322-review`
- Tests: `npx vitest run --project client client/src/review`, `npx vitest run --project desktop desktop/src/main/vaultIndex`
- Gates: `npm run typecheck && npm test && npm run build && npm run perf:budget:ci`
