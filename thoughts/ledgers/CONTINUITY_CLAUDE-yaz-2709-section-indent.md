# YAZ-2709 — Section indent: headings act like bullets

## Goal
- A note that uses headings reads like a bullet note. The text stands below its heading, one step in for each level of nesting. Thin lines show what is below what. The lines on the way to the caret are purple.
- It is a view only: the file on disk does not change.
- The Settings dialog shows one section on each page.
- Done = the four gates are green, the guided test on the final build passes, YAZ-2731 (the real store of the switch) is in, Yaseen merges the pull request, and the feature has its own release with notes.

## Constraints
- No Playwright on this Mac: it takes over the screen. No `npm run e2e`, no `electron-vite dev`, no app launch, no `npm run perf` by an agent. A spec or a perf scenario is written and typechecked, not run, and each document says so.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- The typing budget is 20 ms for each key on a 5k note (YAZ-2236). With the feature on, a key must cost within 1 ms of a key with it off.
- No write to a note. No default for all notes.
- Linear: the comments on YAZ-2709 are for humans. Agent records go on the working log YAZ-2711 and on the subissues (YAZ-2723 to YAZ-2738).
- Commits through the `/commit` skill (no Claude attribution).
- The agent stops at the pull request. Yaseen merges (D15).

## Key Decisions (locked on YAZ-2711, 2026-10-12)
- D1: one node decoration for each top-level block, built in one pass and handed to ProseMirror's own `DecorationSet` constructor, rebuilt on each document change, never mapped. `SectionSet.forChild` returns the empty set. Measured: the public API costs 23.6 ms for each key at 2,500 blocks; in the app a key costs 7.2 ms with the feature on and 6.6 ms off (23.4 ms before the `forChild` override).
- D2: one switch for each note, "Section indent" in the page cog, off by default, stored for that note in the folder state, as YAZ-2700 stores `tocSources`. Built by YAZ-2731: `FolderState.sectionIndents: Record<string, boolean>`, keyed by the path of the note. On AND off are stored (off is `false`, never the removal of the entry), so that a default for all notes can come later with no data repair. This is the one place the store does not copy `tocSources`, where Auto removes the entry.
- D3: steps count by nesting, not by heading number. The top headings of a note stand at the edge.
- D4: the width of one step is an app-wide setting, 24 / 30 / 36 px, default 30 (`sectionStep`).
- D5: the grey lines are an app-wide setting, "Always show" (default) or "Only near the mouse" (`sectionLines`).
- D6: the purple path stops at the block of the caret, the rule of bullet threading.
- D7: the purple path uses the Bullet threading settings (show, width, colour). No new setting.
- D8: each kind of block moves in with its section. A table and a code block become narrower. No setting.
- D9: `H1` to `H6` make sections, six levels. Folds and the table of contents stay at `H1` to `H3`.
- D10: the drag handle stays at the left edge. The indent is a border, so this needs no code.
- D11: in a note column of 480 px or less one step is 18 px. Automatic, no setting.
- D12: a click on a line folds the direct child sections of the heading that owns the line (those that can fold). If one is open they all fold, if not they all open. The caret does not move.
- D13: the Settings dialog shows one section on each page (amends YAZ-1679). "Comments" moves to the end of Appearance. The group keeps the name "Bullet threading".
- D14: Yaseen approved a raise of the size ceilings to the measured values of the final build.
- D15: the agent stops at the pull request, Yaseen merges. Own release, title proposed: "Headers act like Bullets (Hierarchy)". The version is the smallest free version at the time of the cut.
- Found in the polish (YAZ-2735, YAZ-2736): the drag handle mutes over the band of a section line, because the handle of a bullet lies on the innermost line of its list. The empty last paragraph shows no grey line.
- Declined in the polish, still open for eyes: the fold arrow covers part of the click band of the nearest line (3 of 10 px at a step of 30 px, F15); the 4 px outsets overlap below a code block, a table or a quote that holds the caret (F13); soft 1 px lines at a pixel ratio of 1 (F16).
- Docs: the new rule is "18a" in `docs/CONTRACTS.md`, so that the rules 19 to 35 keep their numbers (rule 35, the table of contents, came with the merge of `main`).
- The merge of `main` (YAZ-2700), decided on YAZ-2711: Settings › Editor has "Bullet threading", "Table of contents", "Section indent", in that order. The page cog has "Line numbers", "Section indent", then the three rows of YAZ-2700. In `docs/REGRESSION.md` `main` keeps E31 to E33, and section indent is E34.

## State
- Done:
  - [x] Scope, the demo and decisions D1–D15 locked on YAZ-2711; the demo approved by Yaseen
  - [x] The feature: `abf8225` (section indent, thread lines, the two settings, click to fold, a settings page for each section)
  - [x] 6A/6B (YAZ-2735, YAZ-2736) polish: `ecf2193`
  - [x] 1A (YAZ-2724) the typing check has `prose5k` and `prose5kIndent` (written, not run)
  - [x] 7 (YAZ-2737), the part before the pull request: `desktop/e2e/sectionIndent.spec.ts` (written, not run), `lineNumbers.spec.ts` corrected for the second switch, `docs/CONTRACTS.md` rule 18a and the Settings text, `docs/REGRESSION.md` rows E31, W7 and E28 with the hand scenario E31, the two size ceilings raised, this ledger
  - [x] `main` merged in: `2cc49c6` (YAZ-2700, the table of contents, 14 files with conflicts) and `56269b3` (release 1.0.4)
  - [x] YAZ-2731, the real store of the switch: `FolderState.sectionIndents`, `state.setSectionIndent`, `storage.getSectionIndent` / `setSectionIndent`, `useSectionIndent` on them; the fixture and its browser storage are deleted; step 7 of `sectionIndent.spec.ts` (the restart; written, not run); rule 18a, "App state" and row E34 say what is true
- Now: [→] The size ceilings (D14), then the coordinator shows Yaseen the diff of the stored data (`FolderState.sectionIndents`) before the pull request leaves the draft state
- Next: the guided test on the final build
- Remaining:
  - [ ] Yaseen reviews the stored-data change of YAZ-2731 (the field, its guard, its default)
  - [ ] The typing numbers of YAZ-2724, in a quiet window that Yaseen gives: `npm run desktop:build && npm run perf -- typing --runs 5`, on `main` and on the branch
  - [ ] One run of `sectionIndent`, `settings`, `ids`, `lineNumbers` and `tableOfContents` by a person who may run Playwright
  - [ ] The guided test on the final build (hand scenario E34 in `docs/REGRESSION.md`, 16 steps; step 16 is the saved switch)
  - [ ] The pull request leaves the draft state; Yaseen merges
  - [ ] YAZ-2738: the release notes, and the feature's own release after the merge

## Open Questions
- UNCONFIRMED: the typing numbers in the harness. Only one measurement exists, by hand in the app (7.2 ms on, 6.6 ms off, 2,557 blocks). The `:has()` rule for the empty last paragraph (YAZ-2736 F14) was not in the build of that measurement.
- UNCONFIRMED: no spec of this branch was run. Each selector of `sectionIndent.spec.ts` was read from the source.
- UNCONFIRMED: the caret stays in a block that a click on a line hides. The unit test proves it in jsdom. Chromium can treat a selection in a `display: none` block differently; step 5 of the spec asserts it.
- UNCONFIRMED: nothing of the polish (`ecf2193`) was seen in the app: the empty last paragraph, the Settings pane and its close button, the handle over a line beside a bullet.
- UNCONFIRMED: the saved switch was not seen in the app. Its proof is unit tests and a spec step that was not run.
- For Yaseen: an editor reads the switch when it mounts and does not follow a later change, the same as "TOC made from:". A tab and the right panel that show one note at the same time can differ until the note is opened again there. A live follow is possible with `storage.subscribe`. Wanted?
- For Yaseen: Settings › Editor has "Table of contents" between "Bullet threading" and "Section indent" (the order of `main`, then this branch). The other order puts the two groups that share the purple path side by side.
- On Node 25 and later, `localStorage` is `undefined` in each client test (Node's own global hides the one of jsdom). No test of this branch needs it now. `FrontmatterPanel.test.tsx` spreads it (`{ ...localStorage }`), which does not throw.
- For Yaseen: `rendererTotalBytes` (13,188,128) and `mainBundleBytes` (590,019) are above their ceilings by 9,737 and 269 bytes, inside the 0.1% tolerance. They were not raised. Raise them in this pull request too, or leave them?
- For Yaseen: `README.md` has no entry for the section indent in "Editing". Add one with the release notes (YAZ-2738)?
- For Yaseen: 30 px as the default step, with 3 px of the nearest line's click band below the fold arrow (F15); and the soft grey lines at a pixel ratio of 1 (F16).

## Working Set
- Worktree `.claude/worktrees/yaz-2709-section-indent`, branch `feat/yaz-2709-section-indent`, from `origin/main` at `df5cf39`, level with `origin/main` at `bdd497b` (1.0.4) since the merges `2cc49c6` and `56269b3`. Nothing is pushed.
- The feature: `client/src/editor/outline/sectionIndent.ts`, `sectionIndent.css`, `sectionIndent.test.ts`, `useSectionIndent.ts`, `client/src/editor/PageSettings.tsx`, `Editor.tsx`, `blockHandleGate.ts`, `createCrepe.ts`
- The store of the switch (YAZ-2731): `shared/types.ts` (`FolderState.sectionIndents`), `shared/ipc.ts` (`state.setSectionIndent`), `desktop/src/main/store.ts` (`sanitizeSectionIndents`, `setSectionIndent`, `renamePath`, `removePath`), `desktop/src/main/ipc/state.ts`, `client/src/lib/storage.ts`, `client/src/editor/outline/useSectionIndent.ts`; tests in `store.test.ts`, `ipc/state.test.ts`, `lib/storage.test.ts`, `editor/Editor.test.tsx`, `preload/surface.test.ts`
- The settings: `client/src/settings/SettingsDialog.tsx`, `registry.tsx`, `options.ts`, `settings.css`, `shared/types.ts` (`sectionStep`, `sectionLines`), `desktop/src/main/store.ts`, `client/src/App.tsx` (`--section-step-setting`, `data-section-lines`)
- The checks: `desktop/e2e/sectionIndent.spec.ts` (7 steps), `settings.spec.ts`, `ids.spec.ts`, `lineNumbers.spec.ts` (none run); `tools/perf/scenarios/typing.mjs`, `tools/perf/harness.test.mjs`, `tools/perf/README.md`
- The documents: `docs/CONTRACTS.md` (rule 18a; "App state" › `settings`; rules 15, 16, 34), `docs/REGRESSION.md` (E34, W7, E28), `tools/prototypes/make_settings_demo_vault.py`
- `tools/perf/budget.json`: `rendererEagerJsBytes` 2,033,771 → 2,038,475, `rendererEagerCssBytes` 152,753 → 157,786
- Commands: `/opt/homebrew/bin/npm run typecheck`, `/opt/homebrew/bin/npm test`, `/opt/homebrew/bin/npm run build`, `/opt/homebrew/bin/npm run perf:budget:ci`
- Gates on 2026-10-12, after the merge of `main` (`2cc49c6`): typecheck green; 324 files / 6,674 tests green, 2 skipped.
- Gates on 2026-10-12, with YAZ-2731: typecheck green; 324 files / 6,679 tests green, 2 skipped.
- Known flake: `desktop/src/main/fs/tree.test.ts` "liveness" can time out one time. Run it alone before you call it a failure.
