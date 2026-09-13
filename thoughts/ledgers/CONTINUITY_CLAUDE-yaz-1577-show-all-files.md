# CONTINUITY — YAZ-1577 show all file types in the Files tab

## Goal
- The Files tab lists every real file in the vault. Files with no in-app viewer (`kind: null`) open in the OS default app on click and from the right-click menu. Markdown/text/PDF/image unchanged.
- Done = YAZ-1584 (2A/2B/2C), YAZ-1585 (3), YAZ-1586 (4A/4B), YAZ-1587 (5) all Done; PR open on `yaz-1577-show-all-files`; demo vault on Desktop in an isolated profile; Yasin's hand pass; then merge (no release).

## Constraints
- D1 `fileKind()` stays the preview classifier — do NOT add an `'other'` kind, do NOT touch `fileKind.test.ts` in 2A.
- D2 click on a `null` row → OS default app, no tab. Shift-select guard stays first (YAZ-1336 🔒). ⌘ also goes to OS.
- D3 `null` rows excluded from the view-only wikilink catalog. D4 `.excalidraw`/`.base` become visible, no exclusion list. D5 rename/move `null` rows only when the extension is exactly unchanged.
- No Playwright on Yasin's screen. Dev app with isolated `--user-data-dir` for the hand pass.
- Tests first. Commit via /commit per child. No version bump. Merge only after Yasin's demo pass.

## Key Decisions
- D1–D5 locked on YAZ-1583 (comments hold the diffs).
- Implementing directly (no subagent): every diff is pinned to the line; ~150 lines total. Agent = slop risk, not speed.

## State
- Done:
  - [x] 1- Scope (YAZ-1583) — tree created, D1–D5 locked
  - [x] 2A- Tree and watcher list every regular file (YAZ-1588) — commit 30eaec8
  - [x] 2C- shell:openDefault verb (YAZ-1590) — commit 2f30183
  - [x] 2B- Rename/move rules (YAZ-1589) — commit 8180fd1; `extensionOf` helper shared by fileKind + rename rule
  - [x] 3- Renderer click + context menu (YAZ-1585) — commit d386455
  - [x] 5- Polish (YAZ-1587) — redundant image guard dropped, api doc, README sentence
  - [x] Demo vault `~/Desktop/show-all-files-demo/` (vault "Show All File Types YAZ-1577", 20 scenarios, launch.sh / reset.sh / README)
- Now: [→] 4A/4B verify (YAZ-1591/1592) — dev app launched in isolated profile, waiting on Yasin's hand pass
- Next: PR open on `yaz-1577-show-all-files`; merge to main after the pass (no release); cleanup worktree/branch/demo; handoff comments
- Remaining:
  - [ ] Yasin's 20-scenario pass; any failure → new sub-issue, fixed in this wave
  - [ ] merge, cleanup, handoff

## Open Questions
- Polish considered-and-rejected: collapsing the three twin OS-verb callbacks in Sidebar.tsx (reveal / openVsCode / openDefault) into one helper — would reword existing Reveal/VS Code notice strings and their tests; out of scope here.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1577`, branch `yaz-1577-show-all-files` from main 91c6bc3
- Files: `shared/types.ts`, `shared/fileKind.ts`, `desktop/src/main/fs/{fsUtils,watchers,rename,openDefault}.ts`, `desktop/src/channels.ts`, `desktop/src/main/ipc/fs.ts`, `desktop/src/preload/index.ts`, `client/src/api.ts`, `client/src/links/viewOnlyCatalog.ts`, `client/src/sidebar/{Tree,Sidebar,ContextMenu}.tsx`, `client/src/app.css`, `docs/CONTRACTS.md`
- Test: `/opt/homebrew/bin/npx vitest run desktop/src/main/fs client/src/sidebar client/src/links`
- Linear helper: scratchpad `state.py` (state | comment | create | show)
