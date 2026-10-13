# Continuity: YAZ-2740 Text spacing on the new tab page

## Goal
On the new tab page, a narrow row shows the name of the file first. The time in "Recent" is a few letters ("34m"). Done = merged to main, the guided user test passed, and the release notes are one comment on YAZ-2740.

## Constraints
- The agreed scope, the cases S1 to S15 and the reasons are in the working log, YAZ-2742. The main issue gets no comment but the release notes.
- Front end only. `relativeTime` does not change: the Welcome screen and the comment stream keep the words.
- `.tree__vault` in `app.css` does not change: the sidebar keeps its tag rule (YAZ-2631 D4).
- No test that shows a window. The e2e suite launches the real app, so the new e2e test is written and not run.
- Use the /commit skill. Stop at the open PR until Yasin says to merge.
- Release: joins a later release. Cut no release. The notes have the title "Text Spacing on New Tab Page".

## Key Decisions
- D1: `shortRelativeTime` in `client/src/lib/relativeTime.ts`, on the `UNITS` of `relativeTime`.
- D2: `.start__row .tree__vault { flex: 0 1000000 auto; min-width: 0 }`. At 1000 the name still lost a part of a pixel and got its "…".
- The time slot is `min-width: calc(4ch + 6px)`: `box-sizing: border-box` is global, so `4ch` alone counted the padding.
- D3: Yasin gave the OK in advance to set a ceiling of `tools/perf/budget.json` to the measured number.

## State
- Done:
  - [x] Scoping, decisions locked in YAZ-2742
  - [x] YAZ-2743 1- The name of a row is cut last, and the time is short
- Now: [→] YAZ-2744 2- Polish and anti-slop
- Remaining:
  - [ ] YAZ-2745 3- Verify and deliver (PR, guided user test, merge on Yasin's word)
  - [ ] YAZ-2746 4- Release notes

## Open Questions
- UNCONFIRMED: `desktop/e2e/startPage.spec.ts` "a narrow window with two vaults" passes in the real app. Its sizes come from a copy of the row in headless Chromium.

## Working Set
- Worktree: `.claude/worktrees/yaz-2740-new-tab-row-spacing`, branch `feat/yaz-2740-new-tab-row-spacing`, from `bdd497b`.
- Files: `client/src/lib/relativeTime.ts` (+ test), `client/src/workspace/StartPage.tsx`, `startPage.css`, `StartPage.test.tsx`, `desktop/e2e/startPage.spec.ts`, `docs/CONTRACTS.md`, `docs/REGRESSION.md` (W13).
- Checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
