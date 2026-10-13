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
  - [x] 4B (YAZ-2779) the 16 findings applied, NOT committed (the working tree holds them): one layer for the level piece (`--toc-piece`, five layers), one stamp and one timer in the wheel effect, the `nav` kept for the cleanup, the path on a wheel over the table of contents that moves the note, the comments, the order of three imports, the tests, rule 35, row E31, hand step 15 and the note on step 5c. `npm run typecheck` green (3 projects, 0 errors); `npm test` 325 files and 6719 tests passed, 2 skipped, 0 failed. Each of 13 changes made by hand to the wheel effect, `onWheelOverToc` and toc.css made a test fail (the code is back as it was)
- Now: [→] 5 (YAZ-2780) verify and deliver: commit the corrections of 4B, `npm run build`, `npm run perf:budget:ci`, the size ceilings (D6), pull request, merge, release
- Remaining:
  - [ ] 6 (YAZ-2781) release notes on YAZ-2762, with one GIF and the pictures; the same notes on the GitHub release page, with the notes of YAZ-2752

## Open Questions
- UNCONFIRMED: no agent has looked at the app's screen. Only Yaseen used the demo build `24eba9f0`. Each fact about the look comes from the code and from jsdom tests: the tones in both themes, the place of the lines (12 px, 24 px), the join of the first line and the level piece on a `1t` row (`calc(50% + 0.5px)`), the 160 ms fade of the registered colours, and the path in the card.
- UNCONFIRMED: step 5c of `desktop/e2e/tableOfContents.spec.ts` is typechecked, and nobody ran it. Its selectors were read from the source. It is the first step of the suite that uses `mouse.wheel`. It counts five gradients on a row since 4B.
- UNCONFIRMED: nobody saw the two changes of 4B in the app. Finding 1 changes 1 px of the approved demo: the accent line that passes a level 2 row has no grey point at mid-row. Finding 16 adds a case that no table had: the wheel on "Unpin", on the padding of the column or on the drag edge moves the note, and now shows the path.
- UNCONFIRMED: the merge commit `b3379d85` was not seen in the running app. The demo that Yaseen approved was `24eba9f0`, from before the merge of YAZ-2752.
- UNCONFIRMED: `npm run build` and `npm run perf:budget:ci` were not run on this state. The estimate of the scoping is CSS +0.7 KB and JS +0.35 KB; the CSS ceiling has about 165 bytes of room, so it must go up (D6).
- UNCONFIRMED: the smallest free version for the release. `package.json` says 1.0.5.

## Working Set
- Branch `feat/yaz-2762-toc-hierarchy` (the lock on YAZ-2764 names it `demo/yaz-2762-toc-hierarchy`), from `origin/main` at `995d739`, with `origin/main` at `1e99551d` merged in (`b3379d85`). Worktree `.claude/worktrees/yaz-2762-toc-hierarchy`.
- State: `shared/types.ts`, `desktop/src/main/store.ts`, `client/src/App.tsx`
- Settings: `client/src/settings/options.ts`, `client/src/settings/registry.tsx`
- Component: `client/src/editor/toc/TableOfContents.tsx`, `client/src/editor/toc/toc.css`
- Tests: `npx vitest run client/src/editor/toc/TableOfContents.test.tsx client/src/settings/SettingsDialog.test.tsx client/src/settings/searchSettings.test.ts client/src/App.test.tsx desktop/src/main/store.test.ts`
- E2E (do not run on this Mac): `desktop/e2e/tableOfContents.spec.ts`, step 5c
- Documents: `docs/CONTRACTS.md` (rule 35, "App state" › `settings`), `docs/REGRESSION.md` (row E31, hand step 15, the note on `tableOfContents`), `README.md`
