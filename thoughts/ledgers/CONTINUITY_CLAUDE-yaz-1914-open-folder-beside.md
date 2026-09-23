# CONTINUITY — YAZ-1914 Open folder opens beside, never overwrites

## Goal
- In a window that already has a vault, Open Folder… (⌘⇧O, switcher row) and File › Open Recent never replace that vault: they open the folder in a NEW window, or raise the window already on it. Only the Welcome window switches in place.
- Done = S1–S14 (Linear YAZ-1914 🔒 comment) pinned by vitest, typecheck + build green, docs/contracts match, merged to main. No release.

## Constraints
- No Playwright (not run, not by subagents). Proof = vitest + typecheck + build; optional hand check by Yasin.
- Reuse main's one open-recent door (`WindowManager.openRecentBeside`, YAZ-1767 D1). No new IPC.

## Key Decisions (🔒 on YAZ-1914)
- D1: one renderer rule `openVault(path)` in App.tsx — root null → `openRoot` in place; else `window.openRecent(path)`. Wired to the picker and `menu:open-root`.
- D2: File › Open Recent drops the ⌥-click branch; hotkey tip removed.
- Amends YAZ-1767 D4 (Open folder… was in place).

## State
- Done:
  - [x] YAZ-1927 1- Deep scope
  - [x] YAZ-1929 2A- openVault + App tests
  - [x] YAZ-1930 2B- menu ⌥ branch + hotkey tip
  - [x] YAZ-1931 3- Verify S1–S14 (vitest map on the issue)
  - [x] YAZ-1933 4A- Polish audit (P1–P9)
  - [x] YAZ-1934 4B- Apply polish, docs, contracts
- Next: merge to main (no release — Yasin cuts releases himself)

## Gotchas
- The git sync/guarantee tests (`desktop/src/main/git/{sync,guarantees}.test.ts`) flake on 5 s timeouts under full-suite load; they pass in isolation.
- App tests that need an in-place root change in a VAULT window must use the moved-root lever (`emitFileRenamed(root, newRoot, 'dir')`); `emitOpenRoot` from a vault window now calls `window.openRecent`.

## Open Questions
- none

## Working Set
- Branch `yaz-1914-open-folder-beside`, worktree `../yaseen-docs-app-yaz-1914`
- Files: client/src/App.tsx, client/src/App.test.tsx, desktop/src/main/menu.ts, desktop/src/main/menu.test.ts, client/src/settings/hotkeys.ts(+test), desktop/src/main/windows.test.ts, docs/CONTRACTS.md, client/src/sidebar/VaultSwitcher.tsx(+test)
- Tests: `npx vitest run <file>`; `npm run typecheck`; `npm test`
