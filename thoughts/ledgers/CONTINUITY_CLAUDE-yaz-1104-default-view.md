# Continuity — YAZ-1104: default view on folder pages

## Goal
- A folder page opens on its saved default view (`folder_page_settings.defaultView`, by view name), settable from a `Page → Default view` dropdown at the bottom of the properties popover. Merged to main, tests green, Linear fully documented.

## Constraints
- 🔒 Decision A: stored in the page's frontmatter (never per-machine app state), keyed by view NAME; stale name → first view, silently.
- 🔒 Decision B: control lives at the bottom of PropertiesMenu; Outline keeps NO sliders button.
- 🔒 YAZ-819 rule holds: switching tabs writes NOTHING; only the explicit gesture writes. `FolderPageContents.test.tsx` "switching view writes NOTHING" must pass untouched.
- Playwright: ONE pointed spec run max, never the full e2e suite (steals Yasin's machine).
- Opus 5 implements from tight briefs; Fable owns tests first, byte-scans every diff (NUL check), verifies independently.
- Commit via /commit skill (no Claude attribution). Merge to main when done (approved).

## Key Decisions
- All locked as comments on YAZ-1104 (A: comment-2a717eb8, B: comment-25a6b659) + scope on YAZ-1106.

## State
- Done:
  - [x] YAZ-1106 Scope (findings comment posted)
  - [x] YAZ-1107 Save and read the default view (13 unit tests RED→GREEN)
  - [x] YAZ-1108 Default view control in properties menu (5 unit tests)
  - [x] YAZ-1109 Verify end-to-end (CONTRACTS.md amended; defaultView.spec.ts passed on run 1 of 3)
  - [x] YAZ-1110 Polish and anti-slop (dead trailing comment removed from Toolbar.test.tsx, initialView tombstone annotated, typecheck + 2246/2247 unit tests, NUL scans clean)
- Now: [→] /commit, push, merge to main; Linear all Done

## Learnings
- The 3 remaining unit failures are PRE-EXISTING (stash-verified): App/crepeTheme collection errors are a worktree-path Vite fs-allow quirk; TabBar is an unrelated assertion.
- Worktree desktop builds need `node_modules/@excalidraw` symlinked from the parent repo (electron.vite.config only probes the worktree's own node_modules).

## Working Set
- Worktree: `.claude/worktrees/yaz-1104-default-view`, branch `worktree-yaz-1104-default-view` (from origin/main 70ef1ae)
- Files: `client/src/views/folderPageSettings.ts`, `viewSchema.ts`, `FolderPageContents.tsx`, `ViewsPane.tsx`, `view/PropertiesMenu.tsx`, `docs/CONTRACTS.md`, `desktop/e2e/`
- Tests: client vitest (`npm test` in client/); e2e template `desktop/e2e/folderPages.spec.ts:368`
- Linear IDs in scratchpad `linear_util.py`
