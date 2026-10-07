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
  - [x] 2A- A folder from outside opens as a vault (YAZ-2574, `3406f0b`)
  - [x] 2B- `listVaults` and `yaseendocs vaults` (YAZ-2575, `d072465`)
  - [x] 3A, 3B, 3C- the Alfred workflow "Yaseen Docs Vaults" (YAZ-2577 to YAZ-2579): `yaseen-os/Sync/Alfred/Alfred.alfredpreferences/workflows/user.workflow.2185D761-7405-41D0-A3F2-07E0B963B978/`. That repo commits and pushes by itself. Alfred has NOT loaded the workflow yet (it loads workflows when it starts).
  - [x] 3D- Gallery research (YAZ-2580), a list for Yaseen to pick from
  - [x] 4A- Audit (YAZ-2582): 3 must fix, 11 should fix, 11 optional
  - [x] 4B- Apply the audit (YAZ-2583): A1 to A9 in the app, W1 to W5 in the workflow (15 workflow tests pass)
  - [x] 5B- Docs (YAZ-2586): `docs/CONTRACTS.md`, `docs/REGRESSION.md`, `README.md`, the `alfred` skill
- Now: [→] 5C- the pull request is open (YAZ-2587). The size gate fails on `mainBundleBytes` (516,780, ceiling 514,690), so CI fails until Yaseen says yes to the new ceiling. Then: set the ceiling, merge.
- Remaining:
  - [ ] 5A- the case table and the gate numbers as a comment (YAZ-2585)
  - [ ] 5D- Yaseen cuts and installs one release, then the hand walk: the 35 steps of YAZ-2568, then the Alfred steps (YAZ-2588). One Alfred restart is needed first, to load the workflow.

## Open Questions

- WAITING ON YASEEN: raise `mainBundleBytes` to the measured value (over by 2,090)?
- WAITING ON YASEEN: case S8, a folder dropped on the Dock icon. The package declares only Markdown, so it is probably not true today. Drop it, or add a folder type to the package? Until he answers it is not claimed anywhere.
- UNCONFIRMED: macOS hands a folder to the app for `open -a "Yaseen Docs" <folder>`, and the right window comes to the front when a different app is in front. A 5-second check by Yaseen on the installed 0.9.34 (expect the "unsupported file type" notice), then the hand walk.
- UNCONFIRMED in Alfred: the hotkey nodes fire (`modsmode` 0), `acceptsmulti` 1, the last space of `docs `, the notification for a folder that is gone, and whether `docs` `⏎` still picks the app (S15).

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2556`, branch `yaz-2556-alfred-doors`, off `main` at `9420586`.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`; issue writing follows `~/Documents/GitHub/growprofitai/_code-wiki/Linear-Simpler`.
