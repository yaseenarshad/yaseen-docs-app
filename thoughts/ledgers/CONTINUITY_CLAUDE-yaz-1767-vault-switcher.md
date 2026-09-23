# CONTINUITY — vault switcher: recent vaults dropdown in the sidebar header (YAZ-1767)

## Goal
- The sidebar header's top-left "vault name + change" button becomes a keyboard-first vault switcher modelled on GitHub Desktop's repository panel: click or ⌘O drops a panel flush under the header — filter input first (autofocused), every recent vault as a Welcome-style row (name + relative time / full path), the current vault included and tinted, "Open folder…" last — and ⏎ / click opens the highlighted vault in a NEW window on its remembered last file.
- Done = walked and approved by Yasin on the demo rig, merged to main with CONTRACTS.md / LAUNCH.md / README true and this ledger closed. NO release (Yasin batches releases).

## Constraints
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-vault-switcher`, branch `yaz-1767-vault-switcher`, off main `ac9706c`. `/Users/yasin/Documents/GitHub/yaseen-docs-app` untouched. Commits go through the `/commit` skill.
- NO Playwright / e2e runs; NO agent-launched Electron. Verification = `npx vitest run` (all four projects) + `npm run typecheck` + Yasin's hand walkthrough in the dev app on the isolated profile (`YASEEN_DOCS_USER_DATA_DIR`, HMR, no `--watch`).
- House style: comments cite issue ids; tests pin contracts (menu ids/accelerators, bridge method lists, hotkey list).
- `ContextMenuSurface` changes are ADDITIVE (`width?`, `className?`); every existing menu renders exactly as before.

## Key Decisions (LOCKED by Yasin before the prototype; implemented exactly)
- **D1 One back-end door.** `window.openRecent(path): Promise<boolean>` → `WindowManager.openRecentBeside(path)` (`desktop/src/main/windows.ts`): `!host.dirExists` → `store.removeRecent`, `false`, no window; else `store.pushRecent`, `openWindow({ root, file: folders[root].lastFile ?? null })`, `true`. `dirExists` moved from `MenuHost` onto `WindowHost` (`index.ts` implements with `statSync().isDirectory()`); the menu's ⌥-click branch now just calls `windows.openRecentBeside(path)`. Channel `window:open-recent`; IPC validates with `requireAbsPath`.
- **D2** The new window restores `folders[root].lastFile` (inside D1).
- **D3** The current vault IS a row (recents[0]); `aria-current="true"` + accent-soft tint, no glyph; activating it opens a second window (one rule for every row).
- **D4** "Open folder…" is the LAST row under a hairline; runs the existing `onPickFolder` in place; disabled while `pickDisabled`. ⚠️ AMENDED by YAZ-1914: a picked folder now opens BESIDE (App's `openVault` → `openRecentBeside`) in any vault window; only Welcome switches in place. The menu's ⌥-click branch is gone (D2).
- **D5 Panel, not popup.** `ContextMenuSurface` + `width` + `className="ctx-menu--panel"` (padding 0, no top border, radius 0 0 8 8, max-height calc(100vh − 160px), scroll). Anchor = `.sidebar__header` rect (x=left, y=bottom, width). Rows = Welcome idiom. Dead folder → row disabled, "Folder not found" in `--danger`, panel STAYS open; success closes it. Rows read fresh from `storage.getRecentRoots()` on every open. Trigger `onMouseDown` stopPropagation so a second click toggles closed; `aria-haspopup="menu"`, `aria-expanded`. Header keeps the drag-to-root drop target and `title={root}`.
- **D6** Trigger is one line: bold name + `▾`/`▴` chevron in `.sidebar__root-hint` (`aria-hidden`); the word "change" is gone; header height unchanged.
- **D7 Filter + keyboard.** Filter input first, placeholder "Switch vault…", `aria-label="Switch vault"`, autofocused, query reset on every open. Ranking = `matchLinkCandidates` over basenames, uncapped; empty query = MRU order. Default highlight: empty query → first row that is NOT the current root (⌘O ⏎ = last-used other vault); all current → first row; typed → top match; no match → Open folder…. ↑/↓ clamp (never wrap); hover moves it; ⏎ activates; Esc closes on the first press. Typing never leaves the input (rows swallow mousedown). "Open folder…" always visible; "No matching vaults" above it when nothing matches. `.vault-switcher__row--active` is the highlight, `aria-current` is separate.
- **D9 Vault already open → raise its windows, no new window.** `ManagedWindow.on` gains `'focus'`; the manager keeps `focusOrder` (ids, most recently focused FIRST; `focus` moves to the front, `closed` removes). `openRecentBeside`, after the dead-dir probe and the MRU bump, finds every `windows[]` entry whose root matches (`stripSlash` both sides, as `resolveLinkTarget`) with a live non-destroyed window: if any, `focusWindow` each LEAST recently focused first (never-focused ranks last) so the most recent ends on top, return true, open nothing; else open as before. `index.ts` needs nothing (BrowserWindow already emits `focus`). Pinned by four `windows.test.ts` cases; `menu.test.ts` unchanged.
- **D8 ⌘O.** File › "Switch Vault…" `CmdOrCtrl+O`, id `menu.file.switch-vault`, directly above "Open Folder…"; channel `menu:switch-vault` → preload `menu.onSwitchVault` → `useMenuEvents.onSwitchVault` → App: root null → no-op; collapsed → `toggleSidebar()` first; then bump `switcherOpenRequest` → Sidebar → VaultSwitcher (effect keyed on the counter). `WINDOW_HOTKEYS` gains `⌘O`; the '⌥ Open Recent' tip stays (still true).

### Decided by the implementing agent (NOT in the brief — confirm or amend)
- **A1** App pins a ⌘O request to the root it was made on (`{ seq, root }`; Sidebar receives `seq` only while `root` matches, else 0) so the `key={root}` remount after an in-place "Open folder…" never replays a stale request and pops the panel on the new vault. Pinned by `App.test.tsx` "a request is pinned to the root it was made on".
- **A2** Activating "Open folder…" closes the panel BEFORE running the picker (the native dialog fires no window mousedown, so nothing else would close it).
- **A3** The filter input is `position: sticky` at the top of the scrolling panel (GitHub Desktop keeps its filter pinned).
- **A4** A rejected `openRecent` (bridge error) is logged and treated like `false` — the row goes "Folder not found" rather than the panel hanging.
- **A5** Current + highlighted on the same row: accent-soft background plus a 2px inset accent bar, so neither cue hides the other.
- **A6** `menu.test.ts` no longer owns the dead-folder probe/prune assertions; they moved to `windows.test.ts` with the door. The menu test pins only that ⌥-click calls `openRecentBeside` and ignores its verdict.

## State
- Done:
  - [x] 1- Scope (YAZ-1768): findings comment posted. Done.
  - [x] Prototype in the worktree; demo rig on an isolated profile; Yasin walked S1–S19 (D6 chevron → Octicon, D8 ⌘O toggle, 120 ms settle-in and D9 raise-instead-of-duplicate came out of the walk, each re-walked). "approved, lock it in" 2026-09-21.
  - [x] Linear tree created (YAZ-1768…1774); LOCKED D1–D9 + A1–A9 and the canonical scenario list S1–S19 on the parent; per-child learnings comments.
  - [x] 2- Door (YAZ-1769): commit `2aab542`. Done.
  - [x] 3- Panel (YAZ-1770): commit `11cdee3`. Done.
  - [x] 4- Verify (YAZ-1771): 254 files / 4380 tests green, typecheck clean, Yasin's walkthrough. Done.
  - [x] 5A audit (YAZ-1773): eleven items posted by file. Done.
  - [x] 5B apply (YAZ-1774): highlight seeded by one effect (no second ranking); `alreadyOpen` rename; CONTRACTS.md (file map ×2, `window.*` row, `menu.*` row, Folder picking, Menus ×2, Open beside, hotkey reference), LAUNCH.md ×2, README ×1; this ledger closed.
- SHIPPED: PR merged to main (see the HANDOFF comment on YAZ-1767). No release cut (Yasin batches releases). Demo rig, worktree and branch removed after the merge.
- Now: nothing; this ledger is closed.
- Next: nothing.

## Open Questions
- None. The four UNCONFIRMED items were confirmed by the walkthrough and locked as A7 (dead row stays until the next open), A8 (missing lastFile is the renderer's job), D9 reading (the current vault's row raises this window), A9 (z-index 40 clears everything at every sidebar width).

## Working Set
- Desktop: `desktop/src/channels.ts`, `desktop/src/main/windows.ts`, `desktop/src/main/index.ts`, `desktop/src/main/menu.ts`, `desktop/src/main/ipc/window.ts`, `desktop/src/preload/index.ts`, `shared/types.ts`.
- Client: `client/src/sidebar/VaultSwitcher.tsx` (new), `client/src/sidebar/Sidebar.tsx`, `client/src/components/ContextMenuSurface.tsx`, `client/src/App.tsx`, `client/src/hooks/useMenuEvents.ts`, `client/src/settings/hotkeys.ts`, `client/src/app.css`.
- Tests: `client/src/sidebar/VaultSwitcher.test.tsx` (new), `client/src/App.test.tsx`, `client/src/sidebar/Sidebar.test.tsx`, `client/src/hooks/useMenuEvents.test.tsx`, `client/src/settings/hotkeys.test.ts`, `desktop/src/main/windows.test.ts`, `desktop/src/main/menu.test.ts`, `desktop/src/main/ipc/window.test.ts`, `desktop/src/preload/bridge.test.ts`.
- Commands: `npx vitest run` (or `--project client` / `--project desktop`) · `npm run typecheck` · demo: `<scratchpad>/yaz-1767/setup-demo.sh` then `<scratchpad>/yaz-1767/run-demo.sh` (scratchpad = `/private/tmp/claude-501/-Users-yasin-Documents-GitHub-yaseen-docs-app/5608c98e-cba0-4532-9f89-666f48fa00ab/scratchpad`).
