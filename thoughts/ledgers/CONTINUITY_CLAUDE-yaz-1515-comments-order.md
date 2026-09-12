# CONTINUITY — YAZ-1515 Comments order (+ YAZ-1516 title cutoff)

## Goal
Ship, on main, a persisted **Oldest first / Newest first** order for the comment block (one toggle left of Collapse all, a mirror row in the settings cog) and a header row that WRAPS instead of clipping (YAZ-1516). Done = 2A/2B/2C committed green (typecheck + all four vitest projects), the polish pass has its evidence comment, Yasin's final round on the demo vault passes, the PR is merged to main WITHOUT a version bump, the Linear tree reads Done, demo folder + worktree removed.

## Constraints
- Every 🔒 ruling lives in the comments on YAZ-1515 (🔍 Scope findings, 🔒 Decisions A–D, 🔁 Live-loop log). Implement, don't re-decide; anything that would move a ruling goes to Yasin as D<n> (problem / options / rec / diff / after).
- Tests first, no Playwright (Yasin tests the dev app by hand on a "go do this" list). No new dependencies. No `npm version` unless Yasin says.
- Commit via the `/commit` skill (no Claude attribution), one commit per child; Linear comment + status per child (parent AND child to In Progress when a child starts).
- Worktree: `.claude/worktrees/yaz-1515-comments-order` (branch `yaz-1515-comments-order`, off main @ 369460d). Pin every shell command with `cd` there; cwd drifts.
- Elegance ruling: simpler, combined, minimal — never at the expense of what is right.

## Key Decisions
- A `commentsOrder` in `SettingsState` (default `oldest`), props App → block, cog row · B threads by ROOT `at` reversed, replies always oldest-first, composer ALWAYS at the bottom (Yasin reversed the composer-to-top prototype) · C one state-driven toggle left of fold-all, hidden below 2 threads, label = current order · D header wraps, every seat on the first 20px line (amends D16).

## State
- Done:
  - [x] 1- Scope (YAZ-1529): findings + A–D + live loop posted; prototype on the worktree; demo vault `~/Desktop/yaz-1515-demo/Comments Order`
- Now: [→] 2A- Add the commentsOrder setting (YAZ-1531)
- Next: 2B- Order the stream and add the header toggle (YAZ-1532)
- Remaining:
  - [ ] 2C- Let a long comment header wrap (YAZ-1516)
  - [ ] 4- Polish and anti-slop (YAZ-1534): reviewer → simplify → naming → verify A–D → gate → evidence
  - [ ] 3- Prove it (YAZ-1533): final "go do this" round with Yasin on the polished branch
  - [ ] 4A- Release (YAZ-1535): push, PR, merge; NO bump; clean up demo + worktree

## Open Questions
- UNCONFIRMED: cog row under "Files & Links" is fine (flagged, unanswered → stands).
- UNCONFIRMED: `overflow-wrap: anywhere` on titles with long URLs (flagged, unanswered → stands).

## Working Set
- Files: `shared/types.ts`, `desktop/src/main/store.ts` (+test), `client/src/sidebar/SettingsPanel.tsx`, `client/src/App.tsx`, `client/src/editor/Editor.tsx`, `client/src/comments/{CommentsSection.tsx,CommentsSection.test.tsx,comments.css}`, `docs/CONTRACTS.md`.
- Tests: `cd <worktree> && npm run typecheck && npm test`. Focused: `npx vitest run --project client client/src/comments`.
- Demo: `YASEEN_DOCS_USER_DATA_DIR=~/Desktop/yaz-1515-demo/profile npm run dev -w desktop -- --watch` from the worktree; reset vault from `vault-pristine`.
- Linear helper: scratchpad `lin.mjs` (`comment`, `create`, `state`, `parent`, `title`, `desc`, `tree`); bodies in `lin-1515/`.
- Tree: 1515 → 1529 (1-), 1530 (2-: 1531 2A, 1532 2B, 1516 2C), 1533 (3-), 1534 (4-: 1535 4A).
