# YAZ-2556: Alfred goes to a vault (the two doors, the workflow)

Linear: https://linear.app/growprofit/issue/YAZ-2556/alfred-vaults-switching
The record is on the parent: "Scoping findings: the Alfred audit and the code facts", "Locked decisions, cases and plan (D1 to D5, S1 to S23)" and "Amendment 1". Read them before anything here.

## Goal

- From any app: `⌘Space`, `docs` + a few letters, `⏎` → that vault is in front (raised, restored, opened, or the app started).
- From any app: `⌃⌥1` to `⌃⌥9` go to the vault that has that number (YAZ-2555).
- Done means: the app part is on `main`, the workflow is in `yaseen-os`, Yaseen has cut and installed one release, and he has done the hand walk (YAZ-2588).

## Constraints

- No Playwright, by anyone. No agent-started Electron. Never open or test on a real vault.
- No release by an agent. Alfred calls the INSTALLED app (0.9.34 has neither door), so the Alfred part works only after Yaseen's release.
- Delivery path of the app part: the agent merges after the gates and CI are green (Yaseen: "merge it yourself").
- Commits go through the `/commit` skill.
- Alfred settings live in `/Users/yasin/Documents/GitHub/yaseen-os/Sync/Alfred/Alfred.alfredpreferences`. Read `~/.claude/skills/alfred/SKILL.md` before any edit there: Alfred writes its settings back on quit and caches script bodies.

## Key Decisions

- D1 a folder from outside is "Open Folder…" on it (`routeToFile` → `openRecentBeside`) · D2 `yaseendocs vaults [--json]` through the shared `listVaults` · D3 the Alfred keyword is `docs` · D4 `⌃⌥1`–`⌃⌥9` as Alfred hotkey triggers · D5 the folder action, `yaz` / `pr` searches, `⌃⌥D` / `⌃⌥V` / `⌃⌥L`, Gallery research as a comment.

## State

- Done:
  - [x] 1- Scope (YAZ-2572)
- Now: [→] 2A, 2B- the app's two doors (YAZ-2574, YAZ-2575)
- Remaining:
  - [ ] 3A, 3B, 3C- the Alfred workflow, keys and small wins (YAZ-2577 to YAZ-2579)
  - [ ] 3D- Gallery research (YAZ-2580)
  - [ ] 4A, 4B- audit and apply (YAZ-2582, YAZ-2583)
  - [ ] 5A cases and gates · 5B docs · 5C pull request and merge (YAZ-2585 to YAZ-2587)
  - [ ] 5D- Yaseen's release, then the hand walk (YAZ-2588)

## Open Questions

- UNCONFIRMED: `open -a "Yaseen Docs" <folder>` brings the right window to the front when a different app is in front. Hand walk.
- UNCONFIRMED: the plist format of an Alfred hotkey trigger node. Yaseen presses one key to confirm it.

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2556`, branch `yaz-2556-alfred-doors`, off `main` at `9420586`.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`; issue writing follows `~/Documents/GitHub/growprofitai/_code-wiki/Linear-Simpler`.
