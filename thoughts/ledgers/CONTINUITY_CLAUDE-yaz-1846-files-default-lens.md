# CONTINUITY — YAZ-1846 open a vault on the Files tab

## Goal
Opening a vault lands the sidebar on **Files**, not Topics — ⌘O onto a vault with no window, a link/"Open in new window", first launch, and an in-place switch to a different vault. Done = Linear tree YAZ-1921..1926 all Done, merged to main, NO release bump.

## Constraints
- 🔒 D1: one constant `DEFAULT_SIDEBAR_LENS = 'files'` (`shared/types.ts`) replaces every `'topics'`-as-default literal (`windows.ts` openWindow + first launch, `store.ts` legacy fallback, `storage.ts` placeholder). Existing windows keep their persisted lens — no migration.
- 🔒 D2: `storage.setRoot`'s root-CHANGE patch carries `sidebarLens: DEFAULT_SIDEBAR_LENS` (same single identity write); `App.openRoot` mirrors it. Same-root re-set keeps the lens. Reverses the old YAZ-847/1628 "a root change keeps the lens".
- 🔒 D3: tab order stays Topics | Files | Favorites.
- ⌘⇧N (`duplicateWindow`) still copies the source lens. ⌘O onto an already-open vault raises it, lens untouched.
- Yasin: never Playwright. Commits via /commit. npm at `/opt/homebrew/bin/npm`.

## Key Decisions
- Tests assert the literal `'files'`, not the constant, so a change to the constant still trips them.
- Test fixtures defaulting to `'topics'` model an existing window, not the product default — left alone.
- `onRootMissing` resets the stored lens without mirroring App state — harmless (Welcome has no sidebar; `openRoot` mirrors on the way out).
- Worktree: symlinked `node_modules` breaks Vite (`Denied ID … ?inline`); run a real `npm ci`.

## State
- Done:
  - [x] Scope + decisions D1–D3 + scenarios A–L locked on YAZ-1846
  - [x] 1- Scope (YAZ-1921) — site list, tests, docs
  - [x] 2- Build (YAZ-1922) — TDD 7 red → green; 4435 tests, typecheck clean
  - [x] 3- Verify A–L (YAZ-1923) — each scenario mapped to a unit assertion
  - [x] 4A/4B- Polish (YAZ-1925/1926)
- Now: merge to main, no release
- Next: nothing
