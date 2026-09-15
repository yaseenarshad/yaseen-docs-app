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
  - [x] 1- Scope (YAZ-1618): asar loads under ELECTRON_RUN_AS_NODE → no asarUnpack
  - [x] 2A- CLI (YAZ-1620) `1d5cdfe` · 2B- Pack (YAZ-1621) `0e616ce` · 2A1- name by number (YAZ-1627) `418c1f2`
  - [x] 3- Copy for Agent (YAZ-1622) `28f053d` · 4- Docs (YAZ-1623) `de213d8`, `dd237f1`
  - [x] 5- Prove it (YAZ-1624): two real-agent proofs (first caught the `--reply-to 1` orphan → 2A1; second passed end to end); packed shim smoke-tested after every change
  - [x] 6- Polish (YAZ-1625): reviewer's 11 findings dispositioned (10 fixed, 1 declined with reason); suite 3956 green; typecheck clean
- Now: [→] 6A- Release (YAZ-1626): PR open; Yasin's hand pass on `~/Desktop/Help Agents Understand Comments` (dev app on isolated profile) → merge. NO version bump.
- Next: after merge — delete demo folder + profile + worktree + branch; handoff comments; all Done.

## Open Questions
- (resolved) Electron under `ELECTRON_RUN_AS_NODE=1` loads from `app.asar` — verified with the repo's Electron 43.4.1; no `asarUnpack`.

## Working Set
- `shared/comments.ts`, `shared/agentInstructions.ts` (new), `desktop/src/cli/index.ts` (new), `desktop/build/bin/yaseendocs` (new), `desktop/electron.vite.config.ts`, `desktop/package.json`, `desktop/src/channels.ts`, `desktop/src/main/ipc/*`, `desktop/src/preload/index.ts`, `client/src/sidebar/ContextMenu.tsx`, `client/src/tabs/TabBar.tsx`, `README.md`, `docs/CONTRACTS.md`.
- Tests: `npm run typecheck`, `npm test`, `npm run build`, `npm run desktop:build`.
- Linear helper: scratchpad `lin.py` (status / comment / create).
