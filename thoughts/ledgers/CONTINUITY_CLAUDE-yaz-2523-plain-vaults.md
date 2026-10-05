# YAZ-2523: a vault can say no to IDs

Linear: https://linear.app/growprofit/issue/YAZ-2523
The record is two comments there: "Locked decisions and the scenario record" (V1 to V9) and "V10 to V13 locked". Read them before anything here.

## Goal

- A vault is plain or an ID vault by its own answer in `.yaseendocs/ids.json`. A plain vault is never written to unasked; an ID vault is v0.9.33 unchanged.
- Done means: 7A to 7E under YAZ-2523 are Done, the work is on `main`, and Yaseen has walked the demo.

## Constraints

- No Playwright, by anyone, including subagents. Proof is `npm run typecheck`, `npm test`, `npm run build`, the size gate, and a hand walk-through in the dev app on scratch vaults.
- No release or version tag unless Yaseen asks.
- The size gate is at its ceiling on two rows. Raising a ceiling needs Yaseen's OK.
- A design or behavior question goes to Yaseen in the decision format. Bugs and edge cases are the lead's call.
- Never open or test on a real vault (`skills-global-yaseen`, `yaseen-docs-vault`, `business-wiki-MASTER`) or a copy of one.

## Key Decisions

- One gate in the main process: `givesIds(root)` reads `ids.json`. `.yaseendocs/` existing means nothing (V10).
- The index reads every file the same way; a plain vault's records lose `id` and take the file name as `title` where the index is handed out (`live.ts` `getIndex`). No rescan or cache change when the answer changes (V12, the lead's refinement, recorded on 7A).
- The window's one source of the vault's kind is the index snapshot (`IndexResponse.ids`, `ask`).
- Every vault with no answer is asked, an empty one too; a vault whose notes all have IDs carries over quietly (V11).
- Off means plain with no exceptions; nothing is removed (V13).

## State

- Done:
  - [x] 7A: scope, decisions V1 to V13, the sub-issue tree, baseline (291 files, 5,218 tests)
- Now: [→] 7B1 and 7B5: the answer, the gate, the command line
- Remaining:
  - [ ] 7B3: plain create, rename and copy
  - [ ] 7B4: ID-only features are not offered in a plain vault
  - [ ] 7B2: the box and the Settings switch
  - [ ] 7C: plain tables
  - [ ] 7D1, 7D2: polish
  - [ ] 7E1 to 7E4: tests against the record, walk-through, docs, merge

## Open Questions

- None.

## Working Set

- Branch `yaz-2523-plain-vaults`, worktree `.claude/worktrees/yaz-2523-plain-vaults`, from `main` at `d73a532`. `npm ci` was run inside it.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; issue writing follows `growprofitai/_code-wiki/Linear-Simpler`.
