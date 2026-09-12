# CONTINUITY — YAZ-1491 Search bar should also search folders — COMPLETE (merged via PR #42, 2026-09-11)

## Goal
- The sidebar search bar lists FOLDERS from the Files tree as rows; choosing one reveals it in the Files lens. Scoped, prototyped, approved by Yasin, then decisions locked as 🔒 comments on YAZ-1491, then subissues from Yasin's next prompt.

## Constraints
- Base: main 369460d (0.9.14). Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-yaz-1491`, branch `yaz-1491-search-folders`. No commits until Yasin says.
- Linear-Simpler method (`_code-wiki/Linear-Simpler`): 1- Scope (decisions as comments on parent) → 2- Build (2A, 2B) → 3- Prove it (demo vault, no Playwright) → 4- Polish → 4A- Release.
- Standing rule (YAZ-1481): live prototype in worktree + demo vault + isolated profile BEFORE locking decisions.
- Keep 🔒 flat-list ruling (YAZ-739). Amend 🔒 D3 (YAZ-739): a note never matches on its folder; the folder itself is one row.

## Key Decisions (🔒 LOCKED 2026-09-11, comments on YAZ-1491)
- D1 folder rows come from the Sidebar's own `dirs` (tree), not the index — includes empty folders, no new IPC.
- D2 one flat list, same matcher; folders first within a rank bucket; cap 50 shared.
- D3 choosing a folder row → App `revealInFiles(path)`: lens → files, same reveal request as the tab menu; folder expands itself; Enter/click/⌘ identical.
- D4 folder rows get a glyph + `search-results__row--dir` + `, folder` aria suffix; sub-label = parent path.

## State
- Done:
  - [x] Scope findings (explorer) and D1–D4 diffs shown in chat
  - [x] Worktree + npm ci + Electron binary (`node node_modules/electron/install.js` — allowScripts blocks postinstall)
  - [x] Demo vault `~/Desktop/yaz-1491-search-folders-demo/` (vault dir "Search bar should also search folders", profile/, launch.sh, README scenario list)
  - [x] D1–D4 prototype applied in worktree, tests first — 224 files / 3712 tests, typecheck clean, 14 files changed (uncommitted)
  - [x] Dev app launched: `launch.sh` (HMR on :5174, isolated profile)
  - [x] Yasin approved live ("approved lets lock it in"); 🔒 D1–D4 + findings + build order posted on YAZ-1491
  - [x] Tree: 1- YAZ-1522 · 2- YAZ-1523 (2A YAZ-1524, 2B YAZ-1525) · 3- YAZ-1526 · 4- YAZ-1527 (4A YAZ-1528)
  - [x] 2A committed `85bd7d1` (verified alone), 2B committed `88e939b`; 224 files / 3712 tests, typecheck, whitespace clean
  - [x] 3- closed: live approval + pointed checks pinned as unit tests
  - [x] 4- Polish: independent review, 8/8 findings applied, `b27ddc8`; 224 files / 3711 tests, typecheck, build, whitespace clean
  - [x] 4A: branch pushed, PR #42 opened, merged to main; worktree + branch + demo folder removed; HANDOFF on the parent
- Now: nothing — COMPLETE. No release cut (Yasin batches releases).

## Open Questions
- Resolved on screen: the folder opens itself; the glyph is the tell (no "Folder" word).

## Working Set
- `client/src/search/searchCandidates.ts`, `useSearchResults.ts`, `SearchResults.tsx`; `client/src/sidebar/Sidebar.tsx`, `Tree.tsx`; `client/src/App.tsx`; `client/src/app.css`; `docs/CONTRACTS.md:30`
- Tests: `client/src/search/*.test.*`, `client/src/sidebar/Sidebar.test.tsx`
- Run: `/opt/homebrew/bin/npm test`, `npm run typecheck`; demo `~/Desktop/yaz-1491-search-folders-demo/launch.sh`

## Gotchas (for the next worktree)
- A fresh worktree has no Electron binary: root `allowScripts` blocks the postinstall — run `node node_modules/electron/install.js` after `npm ci`.
- Per-root expansion persists across tests in `Sidebar.test.tsx`; a test that asserts "stays collapsed" must use its own root.
- The dev app on an isolated profile is `YASEEN_DOCS_USER_DATA_DIR=<dir> npm run dev -w desktop`; all of this feature is renderer-side, so HMR covers it.
