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
  - [x] 7B1 and 7B5: the answer, the one gate, the command line (`f88e3f1`)
  - [x] 7B3: plain create, rename and copy (`4a12b71`)
  - [x] 7B4: ID-only features are not offered in a plain vault (`5cb8d82`)
  - [x] 7B2: the box and the Settings switch (`2ea0bcd`)
  - [x] 7C: plain tables (`858bcbb`)
  - [x] 7D1, 7D2: an independent review, and its list applied (`4d86ec3`)
  - [x] The two size ceilings set to the measured values, on Yaseen's OK (`2d31c61`)
  - [x] 7E1: every row of the record mapped to a test (294 files, 5,364 tests)
  - [x] 7E2: walk-through on the running app, driven over its debugging port; scratch vaults at `~/Desktop/yaz-2523-demo/`
  - [x] 7E3: docs (`docs/CONTRACTS.md` "Two kinds of vault", `docs/REGRESSION.md` K1 to K7, `README.md`)
  - [x] 7E4: merged as pull request #92 (`a3e3bfa`), CI green. No release cut.
- Now: closed.
- Remaining:
  - [ ] Yaseen's own look at the box's wording (the demo is ready; a wording change is a small follow-up)
  - [ ] Playwright was not run (not allowed). Its fixture vault needs `.yaseendocs/ids.json` saying yes, as the unit fixture got, the next time it is.

## Open Questions

- One ruling narrows V11 and is flagged for Yaseen on 7D2: the quiet yes needs a vault a yes would write nothing into, folders included.

## Working Set

- The branch and its worktree are removed; the work is on `main`.
- The walk-through's scratch vaults and `open.sh` are in `~/Desktop/yaz-2523-demo/` (the dev build runs from the main checkout's `desktop/out`).
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; issue writing follows `growprofitai/_code-wiki/Linear-Simpler`.
