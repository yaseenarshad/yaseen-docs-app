# CONTINUITY — YAZ-1628 Focus Mode per window

## Goal
- Focus Mode (the eye, YAZ-1605) and the sidebar lens (Files/Topics) live on each WINDOW, not the vault: two windows on one vault keep their own focus and lens, ⌘⇧N inherits both, a relaunch restores both. Linear: YAZ-1628 (parent) → 1629 scope · 1630 focus lists · 1631 lens · 1632 verify · 1633 polish.
- Done = 1630–1633 Done with comments, PR merged to main, handoff comment on every issue, NO release cut (Yasin batches releases).

## Constraints
- Linear-Simpler method. Statuses: parent + child In Progress when starting a child; Done when complete.
- No Playwright on Yasin's screen. Hand passes happen on the dev app (isolated profile `YASEEN_DOCS_USER_DATA_DIR`) — "hey go do this" — or via computer use behind the scenes. The e2e specs were edited for the new shape but not run (needs Yasin's go-ahead).
- Never touch the real vault or installed app. No release unless Yasin says so.

## Key Decisions (🔒 2026-09-15, diffs on YAZ-1629)
- D1 focus lists → `WindowEntry` / `WindowIdentity` beside `sidebarCollapsed` (YAZ-1280 template); removed from `FolderState`; root change clears them (in `storage.setRoot`'s patch); IPC validator = `tabs`' rule (absolute only); store repair in the windows map.
- D2 ⌘⇧N copies both lists by value; fresh windows start `[]`.
- D3 no migration for focus: legacy `folders[root].focusDirs/focusTopics` ignored on load, gone on the next write; every old read/write site deleted.
- D4 (found in the demo) `sidebarLens` → `WindowEntry` too, WITH a 1280-style migration (own valid → legacy → 'topics'); root change keeps it; `state:set-sidebar-lens` channel deleted.
- Not changed: `expanded` / `topicsExpanded` stay per vault.

## State
- Done:
  - [x] 1- Scope + demo (YAZ-1629): 17 scenarios on `~/Desktop/Focus Mode Per Window (YAZ-1628)`, Yasin "approved, lock it in"; D4 found and fixed live
  - [x] 2- + 3- (YAZ-1630 / 1631): prototype reviewed by me (main + renderer diffs clean, mirror 1280), ONE commit `9128f39` (the hunks interleave in the same files); typecheck clean, 3959/3959
  - [x] 5- polish (YAZ-1633): diff re-read against the checklist; only three comment lines needed rewrapping; tests lean, one decision each
  - [x] 4- verify (YAZ-1632): hand re-check + relaunch proof; Playwright 193 passed / 8 failed — the same 8 fail on untouched main (re-run there), filed as YAZ-1634; `lenses.spec.ts` green
  - [x] PR #55 merged to main as `3a28c11`. NO release cut. Handoff comments on YAZ-1628 and every child; worktree, branch, demo vaults and profile removed
- Now: COMPLETE — nothing pending
- Next: none. Not this tree's debt: YAZ-1634 (8 stale Playwright specs, pre-existing on main)

## Open Questions
- (resolved) the edited Playwright specs ran with Yasin's go-ahead: `lenses.spec.ts` 4/4, Topics seeds fine; the 8 failures are pre-existing (YAZ-1634).

## Working Set
- Everything is on main at `3a28c11`; worktree and branch removed
- Files: `shared/types.ts`, `desktop/src/{channels,preload/index}.ts`, `desktop/src/main/{store,windows,ipc/window,ipc/state}.ts`, `client/src/lib/storage.ts`, `client/src/{App,sidebar/Sidebar}.tsx`, `docs/CONTRACTS.md`
- Tests: `npx vitest run` · `npm run typecheck`
- Demo (removed): vault `~/Desktop/Focus Mode Per Window (YAZ-1628)` (+ `… — Other Vault`); profile `<scratchpad>/focus-window-profile`
