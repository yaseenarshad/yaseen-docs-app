# YAZ-2589: a launch opens only what was asked for; a setting for a plain launch

Linear: https://linear.app/growprofit/issue/YAZ-2589/opening-all-windows-feature-relegation
The record is the comment there: "Locked decisions, the audit, and the cases (D1 to D3, A1 to A3, S1 to S27)". Read it before anything here.

## Goal

- A launch that asks for a vault (Alfred, a link, `open -a`) opens only that vault.
- A plain launch follows `settings.startupWindows`: `all`, `last` (the default), `none`. Settings › Files & Links › "When the app starts" › Reopen.
- A saved window that does not come back is forgotten, as a closed window is.
- Done means: 2A to 4C under YAZ-2589 are Done, the pull request is merged when Yaseen says so, and he has done the hand walk (YAZ-2601).

## Constraints

- No Playwright, by anyone. No agent-started Electron. Never open or test on a real vault.
- No release unless Yaseen asks. A size ceiling may rise to the measured value (his OK, 2026-10-07, Amendment 4); say the numbers in the pull request.
- Delivery path: open the pull request and merge it when CI is green (Yaseen, 2026-10-07, Amendment 5). Then the closeout.
- Commits go through the `/commit` skill.

## Key Decisions

- D1 a launch that asked for something brings back only the saved windows of those vaults (`links.pending()`, `manager.rootFor`, `manager.restore(which)` in place of `restoreAll()`).
- D2 the setting `startupWindows`, default `last`.
- D3 a window that does not come back is removed from `AppState.windows`.
- A1 the quit records the vault of the window that had focus last · A2 the app never runs with no window (the Welcome window shows the notice) · A3 the row is in Files & Links.
- This overturns "Restore", D3 of GRO-2160.

## State

- Done:
  - [x] 1- Scope (YAZ-2590)
  - [x] 2A the setting (YAZ-2592) and 2B the launch rule (YAZ-2593), one commit `fe3bb28`. Beyond the record's diffs: the bridge door `link.ready` and the held link pushes (a page that is still loading hears no push); `store.removeWindow(...ids)`.
  - [x] 3A audit (YAZ-2595): 0 must fix, 3 should fix, 8 optional
  - [x] 3B apply (YAZ-2596), with the new ruling A6: a request that cannot open is not a request (case S8 now reads as a plain launch with the notice)
  - [x] 4B docs (YAZ-2599): `docs/CONTRACTS.md` (Restore overturns D3 of GRO-2160), `docs/REGRESSION.md`, `README.md`, `LAUNCH.md`
  - [x] The `mainBundleBytes` ceiling set to the measured 518,434 (Yaseen's OK, Amendment 4)
  - [x] 4A cases and gates (YAZ-2598)
  - [x] 4C pull request #95 merged on 2026-10-07 (merge commit `4cb6a54`), after CI was green (YAZ-2600).
  - [x] 4D the guided hand walk (YAZ-2601): CLOSED WITHOUT A WALK by Yaseen ("i'll test it later, i dont need to do it manually", Amendment 7). Canceled, not Done; the steps are kept there and in `docs/REGRESSION.md`.
- Now: CLOSED 2026-10-07. Merged, NOT released (the installed app is 0.9.35, without this change). The Linear record on YAZ-2589 is the source of truth.
- Remaining: nothing for an agent. Yaseen cuts the next release when he wants it.

## Open Questions

- UNCONFIRMED: macOS hands the request to the app before the app decides what to bring back (S9). Hand walk.
- UNCONFIRMED: `link.ready` in a real window. Nobody has run the app with it. Hand walk (S4, S7, S8 at a cold start).
- KNOWN: the first launch after the update can bring back the wrong vault one time, because the old app's quit did not record the vault in front.
- KNOWN: `rendererTotalBytes` is 13,024,710 against a ceiling of 13,012,712; about 1 KB of the tolerance is left. The next renderer change will need a new ceiling.

## Working Set

- The work is on `main` (`4cb6a54`). The worktree and the branch are removed.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skill at `~/.claude/skills/linear`; issue writing follows `~/Documents/GitHub/growprofitai/_code-wiki/Linear-Simpler`.
