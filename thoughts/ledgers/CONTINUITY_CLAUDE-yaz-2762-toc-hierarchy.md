# YAZ-2762 — TOC Modification: lines / hierarchy

## Goal
- In the table of contents of a note, the reader sees at one look which rows are on the same level and which row they are below. The look stays quiet.
- Done = the four gates are green, the pull request is merged, the release is public with both installers, the release notes are on YAZ-2762, the handoff is on YAZ-2764.

## Constraints
- The behavior and the look are APPROVED and LOCKED (12 Oct 2026): Yaseen used the demo build `24eba9f0` and said "approved, lock it in". Do not change them. A real bug is reported first.
- No Playwright on this Mac, no `npm run dev`, no `npm run perf`, no app window: they take over the screen. The e2e step is written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- Linear: the comments on YAZ-2762 are for humans. Agent records go on the working log YAZ-2764 and on the subissues YAZ-2774 to YAZ-2781.
- Commits through the `/commit` skill (no Claude attribution).
- No new channel, no dependency, no new element, no new listener. One new settings field; an old state file loads with the default.
- A turn of the wheel and a scroll inside one section render nothing in React.
- No guided test on the final build. Yaseen: "No, demo was the test" (D10).

## Key Decisions (locked on YAZ-2764; the scenarios are comments on YAZ-2774, YAZ-2775, YAZ-2776)
- D1: a tone for each level. Level 1 `--fg` at weight 500, level 2 `color-mix(in srgb, var(--fg) 55%, var(--fg-muted))`, level 3 `--fg-muted`. Always on. The current name stays `--accent`, the name below the mouse `--fg`.
- D2: grey level lines, as backgrounds of each `.toc__name`: 1 px at 12 px for level 2 and level 3, one more at 24 px for level 3. Colour `--toc-rest` (`--border` while the lines show). They fade in 160 ms; with "Reduce Motion" they do not fade.
- D3: the path. `pathLines(rows, at)` gives each row `''`, `'1'`, `'2'`, `'1t'` or `'2t'`; `Names` writes it as `data-path`. Colour `--toc-path` (`--accent` while it shows). It follows the current row, never the mouse, and stops at the current row. It shows with the grey lines, not always.
- D4: the names column and the card both have it (one component, `Names`). The rail does not change.
- D5: ONE app-wide setting, `SettingsState.tocLines` = `hover` | `always` | `off`, default `hover`, with a guard in `SETTINGS_FIELD_OK`. Settings › Editor › Table of contents › "Level lines": "On hover", "Always show", "Never". `App.tsx` writes `data-toc-lines` on `.app`. The grey lines and the path follow it together; the tones do not.
- D6: the size ceilings of `tools/perf/budget.json` go up to the measured size of the final build. The coordinator does this, not the test agent.
- D7: the level piece. Each level 2 row draws a flat piece of 9 px by 1 px at 12 px, at mid-row (`--toc-piece`). On a `1t` row the first line stops at mid-row and the piece is the accent colour. Level 3 has none, so `'2t'` has no rule in toc.css. The row has five background layers, the first on top: the path at 12 px, the path at 24 px, the level piece, the grey line at 12 px, the grey line at 24 px. The piece is below the path, so the line of a path that passes a level 2 row is whole (4B, finding 1: the demo had six layers and a grey point of 1 px there).
- D8: with `hover`, the PATH also shows while the reader turns the wheel over the note. The wheel listener sets `data-reading` on the `nav`; one timer removes it `WHEEL_LINGER_MS` (1500 ms) after the last turn. A sideways turn and a pinch do not set it. The grey lines wait for the mouse. Since 4B: that timer is the ONE timer of the effect, and it also closes a card that the wheel opened (one stamp, `lastTurn`). A wheel over the table of contents that moves the NOTE (`onWheelOverToc`: "Unpin", the padding, the drag edge, a list that fits, a card that follows) sets the attribute too, through the ref `wheelTurn`; a wheel that scrolls the list itself does not.
- D9: the old hairline at the left edge of the list stays, with each choice. Section indent › "Grey lines" keeps the label "Only near the mouse".
- D10: the agent merges the pull request when it is green, then cuts an own release with the smallest free version. The release also holds YAZ-2752 (pull request #115). No guided look at the final build.
- Found by the tests: a table of contents starts one 140 ms timer of its own at its mount (the fade of a closed card, `EXIT_MS`). It is not from this work. The `data-reading` tests wait past it before they count timers.
- Found by the tests, corrected in 4B (finding 3): `reading(false)` in the cleanup of the wheel effect did nothing when the `nav` went away, because React clears `navRef` before a passive cleanup runs. The effect now keeps the element at its start (`const nav = navRef.current`), as it does for `scroller`, and a test holds the cleanup on the element that went away. The `clearTimeout` beside it is needed, and a test holds it too.

## State
- Done:
  - [x] Scope and decisions D1 to D10 locked on YAZ-2764; subissues YAZ-2774 to YAZ-2781 created
  - [x] 1 (YAZ-2774) the look: tones, grey level lines, the level piece, the path (`24eba9f0`, the approved demo)
  - [x] 2 (YAZ-2775) the setting "Level lines": the field, the load guard, the row in Settings, the gate on `.app` (`24eba9f0`)
  - [x] 3 (YAZ-2776) the path follows the wheel: `data-reading` and its 1500 ms (`24eba9f0`)
  - [x] `origin/main` (`1e99551d`, with YAZ-2752 / pull request #115) merged into the branch: `b3379d85`. The drag edge `.toc__resize` is intact
  - [x] Tests and documents (`0cb69d16`): the 5 red tests of the settings list are green; new unit tests for `pathLines`, `data-path`, `data-reading`, the rules of toc.css, the load guard of `tocLines`, the row "Level lines", the search, and the gate on `.app`; e2e step 5c written and typechecked; rule 35 and "App state" of `docs/CONTRACTS.md`, row E31 and hand step 15 of `docs/REGRESSION.md`, `README.md`; this ledger
  - [x] Two of the four gates on that state: `npm run typecheck` green (3 projects, 0 errors); `npm test` 325 files and 6718 tests passed, 2 skipped, 0 failed. Each of 23 changes made by hand to `pathLines`, the wheel listener and toc.css made a test fail (the code is back as it was)
  - [x] 4A (YAZ-2778) the audit: 16 findings, none "must fix"
  - [x] 4B (YAZ-2779) the 16 findings applied (`d0d45b4c`): one layer for the level piece (`--toc-piece`, five layers), one stamp and one timer in the wheel effect, the `nav` kept for the cleanup, the path on a wheel over the table of contents that moves the note, the comments, the order of three imports, the tests, rule 35, row E31, hand step 15 and the note on step 5c. `npm run typecheck` green (3 projects, 0 errors); `npm test` 325 files and 6719 tests passed, 2 skipped, 0 failed. Each of 13 changes made by hand to the wheel effect, `onWheelOverToc` and toc.css made a test fail (the code is back as it was)
  - [x] 5 (YAZ-2780) the four gates on the final commit `ef4259bb`: typecheck green; 325 files and 6,719 tests green, 2 skipped; build green; `perf:budget:ci` PASS with four ceilings raised to the measured values (D6: JS +776, CSS +1,406, total +2,182, main +134)
  - [x] The final build in the real app, out of sight (its own profile, a demo vault, the DevTools protocol): 97 of 97 cases pass
  - [x] Merged to `main` by the pull request #116 (`d94d03f8`). CI on the pull request was red one time on `client/src/views/engine.perf.test.ts` (67.4 ms against 50 ms), a timing test this work does not touch, then green
  - [x] Released in v1.0.6, "Table of Contents: Clearer Levels + Wider Names" (`eee343b5`), with YAZ-2752
  - [x] 6 (YAZ-2781) the release notes: one comment on YAZ-2762 with one GIF and three pictures; the same notes on the release page
- Now: CLOSED (2026-10-13). The handoff is the "Closeout handoff" comment on YAZ-2764.
- Next: nothing in this issue.
- Remaining (not required, each needs its own issue if Yaseen wants it):
  - [ ] The packaged gate `npm run perf:budget` fails on `asarBytes` (27,549,019 against 27,300,312), and it failed before this work: v1.0.5 measured 27,544,616. CI runs only `perf:budget:ci`
  - [ ] The timing tests that fail on CI from time to time: `searchCandidates.perf.test.ts` and `engine.perf.test.ts`, each with a limit of 50 ms
  - [ ] The lines at a pixel ratio of 1: a row is 25.398 px high, so some level pieces are soft and the accent line has lighter pixels at some row seams. The old hairline has the same seams
  - [ ] One run of step 5c of `desktop/e2e/tableOfContents.spec.ts` by a person who may run Playwright

## Open Questions
- UNCONFIRMED: step 5c of `desktop/e2e/tableOfContents.spec.ts` is typechecked, and nobody ran it. It is the first step of the suite that uses `mouse.wheel`.
- UNCONFIRMED: the look at a pixel ratio of 1 on a real monitor. The check emulated it on a Retina display.
- UNCONFIRMED: Windows, and a real trackpad with momentum.
- Yaseen declined a guided test on the final build ("No, demo was the test"). An agent saw the final build out of sight, and Yaseen used the demo build `24eba9f0`.

## Working Set
- The branch `feat/yaz-2762-toc-hierarchy` and its worktree are removed after the merge. The work is on `main` from `d94d03f8`.
- State: `shared/types.ts`, `desktop/src/main/store.ts`, `client/src/App.tsx`
- Settings: `client/src/settings/options.ts`, `client/src/settings/registry.tsx`
- Component: `client/src/editor/toc/TableOfContents.tsx`, `client/src/editor/toc/toc.css`
- Tests: `npx vitest run client/src/editor/toc/TableOfContents.test.tsx client/src/settings/SettingsDialog.test.tsx client/src/settings/searchSettings.test.ts client/src/App.test.tsx desktop/src/main/store.test.ts`
- E2E (do not run on this Mac): `desktop/e2e/tableOfContents.spec.ts`, step 5c
- Documents: `docs/CONTRACTS.md` (rule 35, "App state" › `settings`), `docs/REGRESSION.md` (row E31, hand step 15, the note on `tableOfContents`), `README.md`
