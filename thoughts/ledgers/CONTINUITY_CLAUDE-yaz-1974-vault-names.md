# CONTINUITY — YAZ-1974 vault display names + one-line switcher rows

## Goal
- The ⌘O switcher rows are ONE line (name + time); the full path hides behind a hover ⓘ that shows the WHOLE path.
- Any vault can get a display name (right-click → Set display name), used everywhere the app names the vault.
- Done = merged to main, S1–S30 pass by hand, `npm test` + `npm run typecheck` green, docs current, every Linear child Done. No release.

## Constraints
- LOCKED decisions D1–D6 + scope findings live as comments on YAZ-1974 and YAZ-2039 — not suggestions.
- No Playwright, ever (Yasin). Hand pass on an isolated `YASEEN_DOCS_USER_DATA_DIR`.
- New design/architecture questions go to Yasin in the problem → options → rec → diff → after format.

## Key Decisions
- D1 both ideas · D2 hover ⓘ, full wrapped path, portal tooltip · D3 `FolderState.name` in the app state file · D4 `storage.vaultName` everywhere except Open Recent + disk-error notices · D5 "Set display name" / "Reset to folder name" inline via `TextField` · D6 filter matches display + folder name.

## State
- Done:
  - [x] 1- Scope (YAZ-2039)
- Now: [→] 2- Build (YAZ-2040): 2A store · 2B surfaces + filter · 2C inline rename · 2D one-line rows + ⓘ
- Remaining:
  - [ ] 3- Hand pass S1–S30 (YAZ-2045)
  - [ ] 4A audit (YAZ-2047) · 4B apply, docs, ledger close (YAZ-2048)

## Open Questions
- (none)

## Working Set
- Worktree `../yaseen-docs-app-yaz-1974`, branch `yaz-1974-vault-names` off main `c1ca0a2`.
- `npm test`, `npm run typecheck` (PATH needs `/opt/homebrew/bin`).
