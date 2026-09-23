# Continuity — YAZ-1798 vault right-click menu

## Goal
- Right-click the sidebar header's vault name or any row of the ⌘O vault switcher → a GitHub-Desktop-style vault menu.
  - Other vault: Open in this window | Copy vault name · Copy path | Reveal in Finder · Open in VS Code | Remove from recent vaults.
  - Current vault: Copy vault name · Copy path | Reveal in Finder · Open in VS Code.
- Done = merged to main, every Linear child Done, docs true, Yasin walked S1–S20, rig + worktree removed. No release cut.

## Constraints
- NO Playwright, by anyone, ever. Unit tests + typecheck + Yasin's hand walkthrough on an isolated profile.
- Renderer only; no main/IPC change. Reuse `ContextMenu`, `menuSections` types, Sidebar's `reveal`/`openVsCode`, App's `openRoot`.
- Commits through the `/commit` skill. No release.
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1798`, branch `yaz-1798-vault-menu`, off main `66c9806`.

## Key Decisions
- LOCKED on YAZ-1798 comments: D1–D6 (round 1), D7–D10 + A1–A6 (round 2), D11 (keep "Open in this window" despite YAZ-1914), scenarios S1–S20.

## State
- Done:
  - [x] Scoping in chat; decisions locked; subissues created (YAZ-1935..1940)
  - [x] 1- YAZ-1935 Scope (comment posted, G1–G6)
- Now: [→] 2- YAZ-1936 Build the menu
- Remaining:
  - [ ] 3- YAZ-1937 Verify by hand (S1–S20) + unit + typecheck
  - [ ] 4A- YAZ-1939 Audit (comment only)
  - [ ] 4B- YAZ-1940 Apply, docs, ledger, cleanup, merge

## Open Questions
- UNCONFIRMED: does Chromium dispatch `contextmenu` to a disabled button (S4 / G1)?

## Working Set
- `client/src/sidebar/vaultMenuSections.ts` (new) + test, `client/src/sidebar/VaultSwitcher.tsx` + test, `client/src/sidebar/Sidebar.tsx`, `client/src/App.tsx`, `client/src/settings/hotkeys.ts`, `docs/CONTRACTS.md`, `README.md`.
- Parallel: YAZ-1846 (worktree `yaseen-docs-app-yaz-1846`), YAZ-1914 (worktree `yaseen-docs-app-yaz-1914`).
- Commands: `npx vitest run` · `npm run typecheck`.
