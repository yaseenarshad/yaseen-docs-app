# YAZ-2555: vault numbers, the open group, `⌘1` to `⌘9`

Linear: https://linear.app/growprofit/issue/YAZ-2555/multi-vault-switching
The record is two comments there: "Locked decisions and scope (D1 to D8)" and "The scenario record (S1 to S43) and amendments A1 to A6". Read them before anything here. This file is a copy of the state, not of the decisions.

## Goal

- The `⌘O` list shows open vaults first ("Open" / "Not open"), with a `⌘<n>` badge on each numbered vault.
- A vault can have a number, 1 to 9 (`folders[root].key`), set by right-click → "Set shortcut".
- `⌘1` to `⌘9` (Window menu rows) go to that vault through the one door, `openRecentBeside`.
- A vault is "last used" when its window takes focus. The window title is `<vault> — <page>`.
- Done means: 2A to 4D under YAZ-2555 are Done, the work is on `main`, and Yaseen has walked S1 to S42.

## Constraints

- No Playwright, by anyone, including subagents. No agent-started Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`, and Yaseen's hand walk on scratch vaults.
- Never open or test on a real vault or a copy of one.
- No release or version tag unless Yaseen asks.
- A size ceiling may rise to the measured value (D8); say so in the pull request.
- Commits go through the `/commit` skill.
- Delivery path: open the pull request, stop, merge after Yaseen's hand walk passes.
- A design or behavior question that the record does not answer goes to Yaseen in the decision format.

## Key Decisions

- D1 to D8 and A1 to A6 are on the Linear record. Short form:
  - D1 two groups, last-used order in each · D2 the user gives the number, one vault per number · D3 plain `⌘1`–`⌘9`, menu-owned, through the door · D4 the badge always shows · D5 focus bumps `recents` (not a window's first focus) · D6 title vault first · D7 Alfred deferred to YAZ-2556 · D8 size ceiling may rise.
  - A1 rows = recents + numbered + open · A2 Remove clears the number · A3 a gone folder keeps its number · A4 the panel closes on window blur · A5 the key always uses the main-process door · A6 the filter keeps the groups.

## State

- Done:
  - [x] 1- Scope (YAZ-2557): decisions and scenario record on the parent
  - [x] 2A- The vault number in the store, and "Set shortcut" (YAZ-2559). Beyond the plan: `ipc/state.ts` lets `key` through; `freeVaultKey` is shared by the store and the cache; `storage.keyedVaults()`.
- Now: [→] 2B, 2C (start from the 2A commit, own worktrees) and 2D (worktree `-2d`, from `749b5df`)
- Remaining:
  - [ ] 2B- The `⌘O` list: groups, labels, badges (YAZ-2560)
  - [ ] 2C- Window menu rows and `⌘1` to `⌘9` (YAZ-2561)
  - [ ] 2D- "Last used" on focus, vault-first title (YAZ-2562)
  - [ ] 3A- Audit the change set (YAZ-2564)
  - [ ] 3B- Apply the audit (YAZ-2565)
  - [ ] 4A- Scenario tests match the record, gates green (YAZ-2567)
  - [ ] 4C- Docs (YAZ-2569)
  - [ ] 4D- Pull request (YAZ-2570), then stop
  - [ ] 4B- Yaseen's hand walk (YAZ-2568), then merge

## Open Questions

- None.

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2555`, branch `yaz-2555-vault-numbers`, off `main` at `749b5df`.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`; issue writing follows `~/Documents/GitHub/growprofitai/_code-wiki/Linear-Simpler`.
