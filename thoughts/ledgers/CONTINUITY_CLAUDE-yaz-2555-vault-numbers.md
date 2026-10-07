# YAZ-2555: vault numbers, the open group, `⌘1` to `⌘9`

Linear: https://linear.app/growprofit/issue/YAZ-2555/multi-vault-switching
The record is two comments there: "Locked decisions and scope (D1 to D8)" and "The scenario record (S1 to S43) and amendments A1 to A6". Read them before anything here. This file is a copy of the state, not of the decisions.

## Goal

- The `⌘O` list shows open vaults first ("Open" / "Not open"), with a `⌘<n>` badge on each numbered vault.
- A vault can have a number, 1 to 9 (`folders[root].key`), set by right-click → "Set shortcut".
- `⌘1` to `⌘9` (Window menu rows) go to that vault through the one door, `openRecentBeside`.
- A vault is "last used" when its window takes focus. The window title is `<vault> — <page>`.
- Done means: 2A to 4D under YAZ-2555 are Done, the work is on `main`, and Yaseen has done the hand walk (35 steps, the cases of S1 to S43 that need the real app).

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
  - [x] 2A- The vault number in the store, and "Set shortcut" (YAZ-2559, `4b47a90`). Beyond the plan: `ipc/state.ts` lets `key` through; `freeVaultKey` is shared by the store and the cache; `storage.keyedVaults()`.
  - [x] 2B- The `⌘O` list: groups, labels, badges (YAZ-2560, `674c91d`)
  - [x] 2C- Window menu rows and `⌘1` to `⌘9` (YAZ-2561, `509383c`)
  - [x] 2D- "Last used" on focus, vault-first title (YAZ-2562, `19c5b80`)
  - [x] 3A- Audit (YAZ-2564): 1 must fix, 13 should fix, 12 optional, as a comment there
  - [x] 3B- Apply the audit (YAZ-2565, `7b99a1b`): 15 items done, 5 declined with reasons on the issue. The must fix: no focus bump during a quit.
  - [x] D8: three size ceilings set to the measured values (`e9e2b9f`)
  - [x] 4C- Docs (YAZ-2569): `docs/CONTRACTS.md`, `docs/REGRESSION.md` S14, `README.md`. With it: the door bumps through `noteUsed`, so the vault that is already on top is not written again (S25).
  - [x] 4A- Scenario table and gates (YAZ-2567). Playwright not run (standing rule): step 6 and the changed step 2 of `desktop/e2e/vaultSwitcher.spec.ts` are written and typechecked only.
  - [x] 4D- Pull request #93 merged on 2026-10-07 (merge commit `9420586`). Yaseen chose to merge before his hand walk and to cut no release now.
- Now: merged, NOT released, NOT walked by hand.
- Remaining:
  - [ ] 4B- Yaseen's hand walk (YAZ-2568): 35 steps, setup in `~/Desktop/yaz-2555-demo/`. It is done one time before the next release, with the Alfred steps of YAZ-2556 (YAZ-2588).

## Open Questions

- UNCONFIRMED: D5's "a window's first focus does not count". If macOS does not focus each restored window at launch, one switch per window after a relaunch is not recorded. Step 33 of the hand walk shows which it is. If it fails, it goes to Yaseen as a decision.
- UNCONFIRMED: a `&` in a vault name in the Window menu (written as `&&`), and whether the menu misbehaves when it is built again inside its own click. Steps 13 and 14 of the hand walk.

## Working Set

- The work is on `main` (`9420586`). The worktree became the YAZ-2556 worktree; the branch is deleted.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`; issue writing follows `~/Documents/GitHub/growprofitai/_code-wiki/Linear-Simpler`.
