# CONTINUITY — YAZ-2242 new dated note

## Goal
- Right-click anywhere in the sidebar → "New dated note" → box opens as `MM_DD- `, caret after the dash → type title → Enter creates `MM_DD- Title.md` and opens it. Linear: YAZ-2242 → 2243 (scope), 2244 (menu item), 2245 (verify), 2246 (polish: 2247 audit, 2248 apply).

## Constraints
- 🔒 D1 shows wherever "New note" shows (never null); Topics folder-page row → topic member. 🔒 D2 right after "New note". 🔒 D3 same `MM_DD- `, helper renamed `datedFolderSeed` → `datedSeed`.
- No Playwright (e2e label list edited, not run). Commit via /commit. Push + merge to main allowed. Release at the end (Yasin asked this run): smallest bump, replace /Applications app, fill missing release notes.

## Key Decisions
- Done myself, no subagent: 4 lines of code + tests; agent overhead not worth it.

## State
- Done:
  - [x] YAZ-2243 scope + D1–D3 on YAZ-2242
- Now: [→] YAZ-2244 menu item + tests + docs
- Remaining:
  - [ ] YAZ-2245 verify (full vitest + typecheck + hand check)
  - [ ] YAZ-2247 audit → YAZ-2248 apply
  - [ ] PR → merge → release → release notes

## Open Questions
- none

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2242`, branch `yaz-2242-dated-note` off main `caa48d0`.
- Tests: `npx vitest run client/src/sidebar`; `npm run typecheck`; full `npx vitest run`.
