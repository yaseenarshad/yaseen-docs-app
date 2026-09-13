# CONTINUITY — YAZ-1578 folder multi-select

## Goal
- Shift+click selects FOLDERS as well as files in the sidebar (both lenses); mixed selections copy every path via "Copy N paths" and ⌘⇧C; "Open N in new tabs" opens only the files. Linear: YAZ-1578 (parent) → YAZ-1579, 1580, 1581, 1582.

## Constraints
- Selection stays one `Set<string>` of paths (🔒 D1). A folder is itself, never its contents (🔒 D2). Shift never folds (YAZ-1340). Plain click on a folder folds and keeps the selection (🔒 D4). Tabs open files only (🔒 D3).
- No Playwright runs that take over the machine (Yasin). Verify with unit tests + a hand walkthrough in the dev app.
- No new release unless Yasin says so.

## Key Decisions
- D1–D4 recorded as comments on YAZ-1578 (2026-09-13).
- Topics Uncategorized disk-folder rows gain `data-path` (absolute) for `orderedSelection`; the YAZ-1080 test pin that asserted its absence was a "not a page row" pin, not a functional need (keyboard walk reads `data-uncategorized-folder` first).
- No App.tsx change and no new App test: ⌘⇧C reads the same set.

## State
- Done:
  - [x] Scope + decisions locked on YAZ-1578
  - [x] YAZ-1579 folder rows join the selection — `2746b17`
  - [x] YAZ-1580 menu acts on a mixed selection — `ee99aa5`
- Now: [→] YAZ-1581 verify end-to-end (full suite + hand walkthrough)
- Next: YAZ-1582 polish and anti-slop pass, then merge to main (no release)

## Open Questions
- UNCONFIRMED: `Open 1 in new tabs` label reads fine in the running app (one file in a mixed selection).

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1578`, branch `yaz-1578-folder-multiselect`
- Files: `client/src/sidebar/{Tree,TopicsTree,Sidebar,ContextMenu,HotkeysPanel}.tsx`, `client/src/lib/{treeState,selection}.ts`, `README.md`
- Tests: `npx vitest run client/src/sidebar client/src/lib`; `npm run typecheck`
