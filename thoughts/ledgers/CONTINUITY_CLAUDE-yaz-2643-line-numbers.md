# YAZ-2643: per page settings, and line numbers

## Goal

- Each Markdown note has a cog left of the zoom pill. Its menu turns line numbers on and off and shows the word count and the character count.
- With the numbers on, each block shows the line of the file ON DISK where it starts. An AI's "line 43" is the 43 on the page.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`.

## Constraints

- No Playwright, and do not start Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault. Use fixtures and temp folders.
- Write the test first, see it fail, then write the code.
- A size ceiling that trips is set to the measured number in its own commit, and the pull request names it for Yasin's OK. `mainBundleBytes` must not grow: the main process does not change.
- Delivery: open the pull request and stop. Yasin does the hand walk. Merge after he says it passed. No release unless he asks.
- Commits go through the `/commit` skill.
- Nothing is stored: the switch is React state of the mounted editor.

## Key Decisions

- The record is on Linear, on [YAZ-2643](https://linear.app/growprofit/issue/YAZ-2643), in three comments: the decisions (D1 to D6), the cases (S1 to S63), the approved diffs. A fourth comment, "Cases changed during the build", holds S64, S65 and the new S18 and S53. A fifth, "D7, D8 and D9 — added during the hand walk", holds S66 to S82 and the new S51 and S56; a correction under it sets the lane to 60px.
- D1: a web worker reads the block structure of the file text (`micromark` events, no tree). A plugin pairs the lines with the page's blocks in order and stops at the first pair that disagrees.
- D2: a number is a line of the file on disk, frontmatter included. The numbers are built on turn-on, when a save settles, and when an outside change lands. Never on a keystroke.
- D3: the cog is left of the zoom pill; its menu has one switch, "Line numbers". Not stored.
- D4: the numbers are in the left margin that exists, pure CSS from `data-line`. The page does not move.
- D5: the menu shows "N words" and "N characters" of the body, counted once when it opens.
- D6: no other per-page setting now. "Go to line" is deferred.
- D7 (hand walk): a block of two or more lines of the file shows its range, `8–10`.
- D8 (hand walk): while the numbers show, a code block's own gutter counts in lines of the file.
- D9 (hand walk): the numbers have a lane of their own. The scroller takes 64px of left padding while the switch is on, so the page slides right. This replaces D4's "the page does not move".
- A recorded case is stronger than a diff.

## State

- Done:
  - [x] Scoping, locked into Linear
  - [x] Subissues: YAZ-2644, YAZ-2645, YAZ-2646, YAZ-2647
  - [x] YAZ-2644: 1- Line numbers beside the blocks of a note (`0dd06fe`)
  - [x] YAZ-2645: 2- The page settings cog, its menu and the counts (`0dd06fe`)
  - [x] YAZ-2646: 3- Polish and anti-slop: A1 to A22 and C1, each applied or declined with a reason (`1ca25ba`)
  - [x] YAZ-2647: the e2e spec and the two docs (`fcd510c`), written and typechecked, not run; the three ceilings (`ecc9251`)
  - [x] The hand walk on the dev app found three changes: D7, D8, D9 (`f7ea250`). Yasin then said that everything looks good.
  - [x] Yasin approved the ceilings two times: the first numbers, then the final numbers after D7 to D9.
- Now: [→] The merge of the pull request #101, when CI is green.
- Next: closeout, when Yasin asks for it.

## Decisions made during the build

- The approved diffs had four faults. Each fix is a comment on YAZ-2644: the worker needs a stand-in `document` (`workerDocument.ts`); `blockLines` handles `* - nested` and an empty quote; the host uses `readyCrepe` and `diskLandings`; a code block, a rule and a table need their own CSS to show a number.
- S64 (audit A1): when each pair agrees but the page and the file count their blocks differently, the page shows no numbers.
- S65 (audit A4): a worker that fails rejects each request, the editor shows "Line numbers could not load.", and the next request starts a new worker.
- S53 changed (C1): a number is 11px on the screen at each zoom and stays in the margin. It does not scale with the text.
- S18 changed (audit A7): the empty paragraph at the end of the page counts as no character.
- S25 has an accepted limit: a block split by Enter or joined by Backspace has no number until the save settles.
- The menu is `role="group"` with an `aria-pressed` button, as the zoom menu is (audit A8).

## Open Questions

- UNCONFIRMED: the worker loads in the PACKAGED app (`app://` scheme). The hand walk used the dev app, where it loaded. The last step of the hand scenario checks a packaged build, and S65 shows a notice if it fails.
- UNCONFIRMED: the end-to-end spec `desktop/e2e/lineNumbers.spec.ts` has never run.
- The three ceilings, approved by Yasin: `rendererEagerJsBytes` 1,982,923 (from 1,976,633), `rendererEagerCssBytes` 140,553 (from 138,211), `rendererTotalBytes` 13,115,343 (from 13,044,664). `mainBundleBytes` is 526,429, not changed.
- The size gate does not check that the worker chunk ships: its chunk scan reads names that start with `./`. Not changed in this work.
- Two faults on `main`, found by the audit, are not part of this work: `inlineBreaks.ts` splits a paragraph on save for `text<br>` plus a line break, and `listItemRoundTrip.ts` changes text inside a fenced code block on load.

## Working Set

- Worktree `.claude/worktrees/yaz-2643-line-numbers`, branch `yaz-2643-line-numbers`, from `main` at `248a25c` (0.9.38).
- New files: `client/src/editor/lineNumbers/{blockLines,fileLines,lineNumbers,workerDocument}.ts`, `lineNumbers.worker.ts`, `codeLines.ts`, `client/src/editor/PageSettings.tsx`, their tests, `tools/lineNumbersWorker.test.mjs`, `desktop/e2e/lineNumbers.spec.ts`.
- Changed files: `client/src/editor/Editor.tsx`, `client/src/editor/createCrepe.ts`, `client/src/hooks/useAutosave.ts`, `client/src/settings/SettingsButton.tsx`, `client/src/app.css`, `client/package.json`, `docs/CONTRACTS.md`, `docs/REGRESSION.md`, `tools/perf/budget.json`.
- Tests at `f7ea250`: 303 files, 5,851 passed, 2 skipped. Baseline at `248a25c`: 5,694 passed, 2 skipped.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
