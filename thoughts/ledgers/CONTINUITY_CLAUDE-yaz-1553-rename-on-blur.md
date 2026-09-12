# CONTINUITY — YAZ-1553 rename commits on click-away

## Goal
Both rename fields (page title `PageTitle.tsx`, sidebar `RenameInline.tsx`) commit when you LEAVE them — click away, Enter, ArrowDown, Cmd-Tab — by opening the existing confirm sheet. Escape is the only discard. Done = Linear tree YAZ-1563..1567 all Done, merged to main, NO release bump.

## Constraints
- 🔒 D1 option 2: ONE door — `onBlur` is the only commit; Enter/ArrowDown call `e.currentTarget.blur()`; Escape sets `settled` before closing (Chromium fires a last blur on unmount — CONFIRMED in 1A).
- 🔒 D2 option 1: blur behaves exactly like Enter. Empty/unchanged → close silently. Invalid → title: close + passive notice; sidebar: stay open with inline error. Enter on empty sidebar box now closes it.
- Sheet (`ConfirmRename.tsx`), App's rename door (`App.tsx:503`), `Sidebar.submitRename`, `renamedPath` untouched. `CreateInline` out of scope.
- Yasin: no long Playwright runs (takes over his screen). Run ONLY `title.spec.ts` + `rename.spec.ts` once. Human testing via demo vault.
- No release/version bump. Merge to main only after Yasin tests the demo.
- Commits via /commit skill only. npm at `/opt/homebrew/bin/npm`.

## Key Decisions
- jsdom does NOT fire blur on removal → unit tests dispatch a trailing `focusout` by hand to cover the Escape-then-unmount path.
- Click-away onto a sidebar row: sheet survives, row does NOT open (click lands on body; rows open on `onClick`). Intended.

## State
- Done:
  - [x] Scope (chat) · decisions locked on YAZ-1553 · tree YAZ-1563..1567 created with descriptions + comments
  - [x] 1A- Scope probes (YAZ-1563) — all traps confirmed, findings comment posted
  - [x] 1B- Make both rename fields commit on leave (YAZ-1564) — TDD red 10 → green 22; typecheck clean; client suite 3073 green
- Now: [→] 1C- Prove it end-to-end (YAZ-1565) — steps in title.spec + rename.spec, run those two ONCE
- Next: 1D- Polish and anti-slop (YAZ-1566)
- Remaining:
  - [ ] 1E- Demo vault `~/Desktop/Rename on click-away (YAZ-1553)` + isolated profile + Yasin's test → merge (YAZ-1567)

## Open Questions
- none

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1553`, branch `yaz-1553-rename-on-blur` off main `ebf0772`
- Files: client/src/editor/PageTitle.tsx, client/src/editor/PageTitle.test.tsx, client/src/sidebar/RenameInline.tsx, client/src/sidebar/RenameInline.test.tsx (new), client/src/sidebar/TopicsTree.tsx (comment), desktop/e2e/title.spec.ts, desktop/e2e/rename.spec.ts
- Tests: `npx vitest run --project client client/src/editor/PageTitle.test.tsx client/src/sidebar/RenameInline.test.tsx`; gates `npm test`, `npm run typecheck`
- Demo launch (from YAZ-1514's recipe): `YASEEN_DOCS_USER_DATA_DIR=<profile> npm run dev` from the worktree root; seed the profile's `yaseendocs.json` with a `windows[]` entry for the vault.
