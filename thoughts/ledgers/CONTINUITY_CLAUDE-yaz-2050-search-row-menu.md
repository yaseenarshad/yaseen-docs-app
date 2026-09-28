# Continuity — YAZ-2050 search-row right-click menu

## Goal
- Right-click a sidebar search result → the SAME menu its Files tree row gets (was: Electron's Cut/Copy/Paste text menu).
- Done = merged to main, every Linear child Done, CONTRACTS true, worktree removed. No release cut.

## Constraints
- NO Playwright. Unit tests + typecheck.
- Renderer only; no main/IPC change. Reuse `openMenu` / `MenuTargets` / `buildMenuSections` and the YAZ-1491 `onRevealInFiles` door.
- Commits through the `/commit` skill.
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2050`, branch `yaz-2050-search-row-menu`, off main `c1ca0a2`.

## Key Decisions
- LOCKED on YAZ-2050 comments: 🔒 D1 (Files rules, `MenuTargets.lens` pinned), 🔒 D2 (tree-drawing items reveal-first via `leaveSearchTo` + `viaTree`), bug-level calls (right-click highlights; blank space default-prevented).

## State
- Done:
  - [x] A- YAZ-2051 Scope + decisions
  - [x] B- YAZ-2052 Wire the menu + 9 tests (TDD red → green)
  - [x] C1- YAZ-2054 Audit (10 items)
  - [x] C2- YAZ-2055 Applied the audit, docs, ledger; merged to main
- CLOSED 2026-09-27.

## Open Questions
- None.

## Working Set
- `client/src/search/SearchResults.tsx` + test, `client/src/sidebar/Sidebar.tsx` + test, `client/src/sidebar/menuSections.test.ts`, `docs/CONTRACTS.md`.
- Commands: `npx vitest run` · `npm run typecheck`.
- Gotcha: a symlinked `node_modules` in a worktree fails `App.test.tsx` / `crepeTheme.test.ts` (Vite `Denied ID …?inline`); run `npm ci` in the worktree.
