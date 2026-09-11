# CONTINUITY — YAZ-1472 Comments per page

## Goal
Ship Linear-style comments on every Markdown note: stored under one reserved frontmatter key `comments`, a collapsible block under the note (cards, one-level threads, folds, optional titles, sanitised Markdown bodies, declared `by` for agents), never touching the index, the views or the Properties panel's editable rows. Done = every 2x child committed green (typecheck + all four vitest projects), Yasin's stress test on the Desktop demo vault passes, the polish pass has its evidence comment, and the branch is merged to main.

## Constraints
- Every 🔒 ruling lives in the Linear comments on YAZ-1472 (Decisions D1–D14, Scope findings, Live-loop log). Implement, don't re-decide; anything that would move a ruling goes to Yasin as D<n> (problem / options / rec / diff / after).
- Tests first. No Playwright. No new dependencies beyond `marked` + `dompurify` (already in the tree, now declared).
- Reserved key spelled from `COMMENTS_KEY`. Elegance ruling: simpler, combined, minimal — never at the expense of what is right.
- Commit via the `/commit` skill (no Claude attribution), one commit per child; Linear comment + status per child (parent AND child to In Progress when a child starts).
- Worktree: `.claude/worktrees/yaz-1472-comments` (branch `yaz-1472-comments`, off main @ fb58fef). Pin every shell command with `cd` there; cwd drifts.
- Merge to main only AFTER Yasin's stress test (3-). Ask before `npm version` (he batches releases).

## Key Decisions
- D1 frontmatter key · D2 flat threads + `reply_to` · D3 declared `by` · D4 sixth block before Linked mentions, fed by CrepeHost `disk` · D5 scanner strips + CACHE_VERSION 3 · D6 reserved chip · D7 add/reply/edit/delete + optional `title` · D8 `transformFile` on fresh bytes, returns content · D9 GFM via marked + DOMPurify · D10 foreign/invalid refuse · D11 schema · D12 UI shape · D13 no Playwright · D14 names.

## State
- Done:
  - [x] 1- Scope (YAZ-1494): findings, decisions, live-loop log posted; tree created 2026-09-11.
  - [x] 2A- Comment model (YAZ-1496): commit 1f10808, 29 model tests.
  - [x] 2B- Index/views/panel (YAZ-1497): commit 43f0089.
  - [x] 2E- Contracts and README (YAZ-1500): commit 79b6d9c.
  - [x] 2D- Markdown bodies (YAZ-1499): commit 5503d15, 23 tests; task-list checkbox kept (disabled, inert).
  - [x] 2C- The Comments block (YAZ-1498): commit d948056, 21 tests. 2- Build Done.
  - [x] 4- Polish (YAZ-1502): review disposition + evidence posted, commit 3dcc20f, branch pushed; 4B (YAZ-1511) parked.
  - [x] 3- Prove it (YAZ-1501): Yasin's pass on the Desktop demo → three new rulings, no defects. D15 numbers (`#3`/`#3.1`, gaps), D16 header text never moves (one-liners), D17 delete confirm — locked 2026-09-11.
- Now: [→] 2F (YAZ-1512): code is in the worktree uncommitted; a test agent updates pins + adds the D15–D17 tests; docs (CONTRACTS D1-D17, README) and the demo generator done. Then full gate → commit → push → 4A.
- Next: 4A- Release (YAZ-1503): merge to main (no version bump unless Yasin says; his precedent is to batch), close the tree, delete `~/Desktop/yaz-1472-comments-demo` and the worktree.
- Remaining:
  - [ ] 3- Prove it (YAZ-1501): `~/Desktop/yaz-1472-comments-demo` via scratchpad `make-demo-desktop.mjs`, dev app on the isolated profile, scenario list to Yasin.
  - [ ] 4A- Release (YAZ-1503): ask about the version bump, push, merge after his pass, clean up.

## Open Questions
- UNCONFIRMED: persist per-comment folds per file (like bullet folds)? v1 session-only.
- UNCONFIRMED: confirm before deleting a parent with replies? v1 no confirm.
- UNCONFIRMED: version bump now or batched? Ask at 4A.

## Working Set
- Files: `shared/comments.ts`, `client/src/comments/{CommentsSection.tsx,comments.css,markdown.ts,comments.test.ts}`, `client/src/lib/relativeTime.ts`, `client/src/views/writeProperty.ts`, `client/src/editor/{Editor.tsx,FrontmatterPanel.tsx}`, `desktop/src/main/vaultIndex/{scan.ts,cache.ts}`, `client/src/app.css`, `docs/CONTRACTS.md`, `README.md`.
- Tests: `cd <worktree> && npm run typecheck && npm test` (four projects). Focused: `npx vitest run --project client client/src/comments`.
- Demo: scratchpad `demo-vault` + `demo-profile` (prototype); final = `~/Desktop/yaz-1472-comments-demo/{vault,profile}`; launch `YASEEN_DOCS_USER_DATA_DIR=<profile> npm run dev` from the worktree.
- Linear helper: scratchpad `lin.mjs` (`plan`, `tree`, `comment`); ids in `lin-1472/ids.json`.
