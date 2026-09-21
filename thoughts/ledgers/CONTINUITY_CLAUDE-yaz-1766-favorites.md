# CONTINUITY — Favorites (YAZ-1766)

## Goal
- A third sidebar tab "Favorites" (right of Files). Right-click any file/folder row in any tab → "Add to favorites" / "Remove from favorites". Favorited folders expand in place; redundancy allowed (a file and its favorited parent both show). Every favorites row keeps the full context menu. Toast on add/remove. Drag-to-reorder. Focus inside Favorites with its own per-window list.
- Done = Yasin says "approved, lock it in" after the demo → decisions posted to YAZ-1766 as comments → subissues created from Yasin's subissue prompt → implemented, verified, polished, merged. NO release unless asked.

## Constraints
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-favorites`, branch `yaz-1766-favorites`, off main `ac9706c` (0.9.23). `node_modules` and `client/node_modules` are symlinks to main's. Commits via the `/commit` skill only when Yasin asks.
- NO Playwright runs (D3 of YAZ-1760 stands: it bothers Yasin). Verification = `npm run typecheck` + `npx vitest run --project client` + `npx vitest run --project desktop` + hand walkthrough in the dev app on the isolated profile (`YASEEN_DOCS_USER_DATA_DIR`, HMR via `electron-vite dev`).
- Linear-Simpler method: few parents, concrete children, decisions locked as comments BEFORE subissues exist.

## Key Decisions (LOCKED on YAZ-1766, Yasin "approved, lock it in" 2026-09-21 after the demo — the comment there is authoritative)
- **D1** third lens `favorites`, drawn as a Lucide `HeartIcon` (word in `title` + `aria-label`, accent fill when active). Rejected: a Favorites block inside the Files body; the word as the tab; the first hand-drawn heart ("ugly").
- **D2** `FolderState.favorites: string[]` — per vault, PERSISTED (unlike `expanded`), shared by all windows, capped `MAX_FAVORITES = 500`, repaired by `store.renamePath` / `removePath`. Rejected: `.yaseendocs/favorites.json` (no repair), per-window (wrong scope).
- **D3** menu item `toggle-favorite` LEADS `OPEN_IN_GROUP` (`[toggleFavorite, openIn]`; moved from the end of the this-row group during the demo). Own target fields `favoritePaths` / `favoriteIsOn`. Labels "Add to favorites" / "Remove from favorites", plural counted; mixed selection reads as Add. Rejected: beside Focus in the Open group.
- **D4** (amended by Yasin) insertion order AND drag-to-reorder of root rows on the Favorites tab from v1. Nested rows on the Favorites tab are not draggable (no disk moves from Favorites). `favoriteRoots` keeps duplicates/nesting (not `focusRoots`).
- **D5** (amended by Yasin) Favorites has its OWN per-window focus list `WindowEntry.focusFavorites`, mirroring `focusDirs`. Rejected: hop to Files on focus.
- **D6** `NoticeKind` gains `'favorite'` with the same heart glyph (was a star); texts "Added to favorites" / "Removed from favorites" (counted when plural).
- **D7** Favorites tree shares the Files tree's `expanded` set. No new expansion field.
- **D8** tree chevron 10→14px box, 5→7px arrow (demo request; app-wide).
- **D9** verification by hand + vitest, never Playwright.
- **D10** the subset rule: reveal (and, per 3B1, inline create whose target dir is not on the tab) hops the lens to Files.
- **D11** (YAZ-1794, 6A — supersedes D2's storage half) THE LIST moves into the vault: `<root>/.yaseendocs/favorites.json` = `{ version: 1, favorites: string[] }` of VAULT-RELATIVE POSIX paths, so GitHub sync carries it. Main module `desktop/src/main/favorites.ts` (absolute over the bridge `favorites.get/set/onChanged`, relative on disk), IPC `ipc/favorites.ts` mirroring `ipc/properties.ts`.
- **D12** corrupt policy = properties' R2.5: malformed / wrong shape reads `[]`, every `set` rejects `INVALID_CONFIG`, the file is never overwritten.
- **D13** repair in `ipc/fs.ts` beside `store.renamePath/removePath`: `favorites.renamePath/removePath` on the LONGEST open root owning the path; write only on change; a repair failure warns and never fails the file op.
- **D14** no renderer prune: a favorite the tree lacks draws no row (not synced yet); main drops dead entries on the user's next write.
- **D15** clean break: `FolderState.favorites`, its `setFolder` patch, `storage.getFavorites/setFavorites` and the old tests are REMOVED; `WindowEntry.focusFavorites` stays; `MAX_FAVORITES` re-documented for the vault file.

## State
- Done:
  - [x] Scope: explorer report (file:line map) + seven decisions presented in chat; Yasin approved D1–D3, D6, D7; amended D4 (reorder) and D5 (own focus list).
  - [x] Worktree + branch created; demo vault "Favorites" (60 files / 22 dirs) + seeded isolated profile + `run-demo.sh` in the session scratchpad.
  - [x] Prototype (agent) + demo walked by Yasin; D1/D3/D6 amended live via HMR, D8 added. "approved, lock it in" 2026-09-21.
  - [x] LOCKED decisions D1–D10, scope map and scenario list posted as comments on YAZ-1766.
  - [x] Linear tree: 1- YAZ-1777 (Done) · 2- YAZ-1778 → 2A YAZ-1779, 2B YAZ-1780 (Done) · 3- YAZ-1781 → 3A YAZ-1782, 3B YAZ-1783 (+ 3B1 YAZ-1793), 3C YAZ-1784, 3D YAZ-1785, 3E YAZ-1786 · 4- YAZ-1787 → 4A YAZ-1788, 4B YAZ-1789 · 5- YAZ-1790 → 5A YAZ-1791 (Done), 5B YAZ-1792.
  - [x] Code reviewed issue by issue (storage mirror-of-siblings; UI minimal); 5A audit posted (A1–A10).
  - [x] 5B code: A1 one `fileDrag` target in Tree.tsx; A2 `sameList` in all five write-backs; A3 = 3B1 create-hop + test; A5 stale comment. Docs A7/A8 (CONTRACTS.md Favorites paragraph + rows; README bullets). Ledger A9.
  - [x] Rebased onto main `a842844` (YAZ-1767 vault switcher, PR #73): two text conflicts + seven `windows.test.ts` fixtures missing `focusFavorites`. Suites green after.
  - [x] 4A/4B hand pass by Yasin on `98741a5` ("it all works"); evidence comments posted; 4 Done.
- SHIPPED and CLOSED OUT (2026-09-21): PR #74 → main `54a4252`. Release 0.9.24 cut from that main (the first release since 0.9.23; it also carries YAZ-1767). Linear: YAZ-1766 and every child Done; HANDOFF comments on the parent and each child. Demo vault, profile, script, worktree and branch removed. Playwright never run.
- Reopened (YAZ-1794, worktree `yaseen-docs-app-favorites-vault`, branch `yaz-1766-favorites-vault` off `1ddf90d` / 0.9.24):
  - [→] 6- Favorites in the vault: 6A main module + IPC + repair, 6B clean break (D15), 6C Sidebar on `api.favorites` + docs. Code + tests + docs written; typecheck / client / desktop green. NOT committed.
- Next: Yasin's hand pass in the dev app (two windows, a synced vault), then `/commit` when asked.

## Open Questions
- None. (Reorder inert while focused: confirmed in the demo. Inline create from a ♥ row: 3B1 hops to Files when the tab lacks the target dir.)

## Gotchas
- Worktree `node_modules` must be a real copy (`cp -c -R`, APFS clone), not a symlink: Vite's `fs.allow` denies `@milkdown/crepe` CSS through a symlink, failing `App.test.tsx` / `crepeTheme.test.ts` at collection and breaking the dev renderer.
- Two dev apps at once (another worktree on 5173) → this one takes 5174; both windows look alike — the sidebar header names the vault.
- ⌘O vault-switcher feedback during the demo belonged to YAZ-1767's worktree, not this one.

## Working Set
- Source: `shared/types.ts`, `desktop/src/main/store.ts`, `desktop/src/main/ipc/state.ts`, `desktop/src/main/ipc/window.ts`, `client/src/lib/storage.ts`, `client/src/lib/treeState.ts`, `client/src/lib/notice.ts`, `client/src/components/NoticeIcon.tsx`, `client/src/sidebar/menuSections.ts`, `client/src/sidebar/Sidebar.tsx`, `client/src/sidebar/Tree.tsx`, `client/src/App.tsx`, `client/src/app.css`.
- Tests: `treeState.test.ts`, `menuSections.test.ts`, `Sidebar.test.tsx`, `desktop/src/main/store.test.ts`; e2e edited, never run: `desktop/e2e/lenses.spec.ts`, `desktop/e2e/helpers.ts`.
- Demo: `<scratchpad>/run-demo.sh` · vault `<scratchpad>/Favorites` · profile `<scratchpad>/profile-favorites`.
- Commands: `npm run typecheck` · `npx vitest run --project client` · `npx vitest run --project desktop`.
