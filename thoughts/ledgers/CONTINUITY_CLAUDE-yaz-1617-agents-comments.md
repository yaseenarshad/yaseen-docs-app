# CONTINUITY — YAZ-1617 Help agents understand comments

## Goal
- An agent handed a page via right-click › **Copy for Agent** leaves a correct comment through the app's own `yaseendocs` command (add / read / edit / delete), proven on a packed build, with Yasin's demo vault stress-tested before merge. Linear: YAZ-1617 (parent), tree YAZ-1618…1626, project Yaseen Docs App.
- Done = every subissue Done with evidence, PR merged to main, NO release cut (Yasin batches releases), demo folder removed.

## Constraints
- Linear-Simpler method. Statuses: parent AND child → In Progress when a child starts; Done when it lands. Decisions to Yasin in problem / options / rec / diff / after form — never on the fly.
- No Playwright. Verification = packed build + dev app on an isolated profile, "go do this" list for Yasin, or pointed computer use.
- Commit via `/commit` (no attribution). New tasks → new subissues (1B1-style) and DONE in this run unless truly out of scope.
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1617`, branch `yaz-1617-agents-comments`, off main `f82f101`.

## Key Decisions (🔒 on YAZ-1617)
- D1 CLI inside the bundle (`ELECTRON_RUN_AS_NODE`, VS Code `code` pattern); `--help` IS the contract.
- D2 right-click › Copy for Agent: general handshake, names NO verb (orthogonal to the CLI).
- D3 no PATH install; full path in the handshake.
- D4 full CRUD; `edit`/`delete` only on comments carrying `by`.
- D5 `by` defaults to `agent`; UI writes none.
- D6 README + CONTRACTS one story. D7 parked deep link closed on YAZ-1472.

## State
- Done:
  - [x] Scope + D1–D7 locked; tree created (2026-09-14)
  - [x] Worktree + branch
- Now: [→] 1- Scope: the UNCONFIRMED asar-under-RUN_AS_NODE check (YAZ-1618)
- Next: 2A- CLI (YAZ-1620)
- Remaining:
  - [ ] 2B- Pack it (YAZ-1621)
  - [ ] 3- Copy for Agent (YAZ-1622)
  - [ ] 4- Docs (YAZ-1623)
  - [ ] 5- Prove it: demo vault "Help Agents Understand Comments" on Desktop + dev app (YAZ-1624)
  - [ ] 6- Polish (YAZ-1625) · 6A- Release: PR, merge, no version bump unless Yasin says (YAZ-1626)

## Open Questions
- UNCONFIRMED: Electron under `ELECTRON_RUN_AS_NODE=1` loads modules from `app.asar`? Decides `asarUnpack` in 2B.

## Working Set
- `shared/comments.ts`, `shared/agentInstructions.ts` (new), `desktop/src/cli/index.ts` (new), `desktop/build/bin/yaseendocs` (new), `desktop/electron.vite.config.ts`, `desktop/package.json`, `desktop/src/channels.ts`, `desktop/src/main/ipc/*`, `desktop/src/preload/index.ts`, `client/src/sidebar/ContextMenu.tsx`, `client/src/tabs/TabBar.tsx`, `README.md`, `docs/CONTRACTS.md`.
- Tests: `npm run typecheck`, `npm test`, `npm run build`, `npm run desktop:build`.
- Linear helper: scratchpad `lin.py` (status / comment / create).
