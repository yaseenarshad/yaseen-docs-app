# YAZ-2700 — A table of contents on a note

## Goal
- A note shows its structure at its right edge, and one click goes to a part of it. The table of contents takes no space from the text.
- In the same work, approved in the demo: the heading level tag, the app's own scrollbars, and H1/H2/H3/T at the front of the selection toolbar.
- Done = the four gates are green, the pull request is merged, and Yaseen did the guided test. NO release in this run: Yaseen puts it into one release with YAZ-2702, titled "Table of Contents (New Feature) + Focus & Favs Survive Quit".

## Constraints
- No test that opens a window on this Mac. The e2e spec is written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- Typing stays at 20 ms or less on a 5,000-line note (YAZ-2236): no work on the full document for a keystroke or a caret move.
- The table of contents is view state. Nothing is written into a note.
- Linear: the main issue's comments are for humans. Agent records go on the working log YAZ-2701 and on the subissues.
- Commits through the `/commit` skill (no Claude attribution).

## Key Decisions (locked on YAZ-2701 as D1–D15, each with its scenarios)
- D1: the rows come from an editor plugin and a channel (`client/src/editor/toc/tocPlugin.ts`, `tocChannel.ts`). One scan at the start, then 150 ms after the last change.
- D2: one app-wide setting, `SettingsState.tableOfContents` = `auto | pinned | off`, default `auto`.
- D3, D4: names beside the text when `noteWidth - 200 >= columnMax` (1040 Narrow, 1440 Medium, none at Full), else small lines with a hover card. `pinned` shows names from 700 px. One scrollbar: the note's.
- D5: a marker on the current row; the lines show reading progress; a long list moves with the note like a scrollbar thumb.
- D6: fewer than two rows shows nothing. 200 rows at most (drops level 3, then level 2). Hidden during a bullet zoom.
- D7: a click glides (420 ms, 3 windows at most), opens each fold on the way and the row itself, lands the row 24 px below the top, moves the caret, flashes for 1.3 s.
- D8: `⌘J` puts the keyboard in the list.
- D9: the sticky heading and a bar at the top are NOT in this issue. No issue exists for them.
- D10: the names are "Table of contents", "Pin", "Unpin".
- D11: `color-scheme` for each theme, thin scrollbars, thumb black 40% (light) and white 20% (dark).
- D12: a level tag (`H2`) after the heading in hand, as an `::after`; the cog's "Heading levels" shows it on each heading; not stored; no tag while "Line numbers" is on (same `::after`).
- D13: the Heading group leads the selection toolbar (`buildToolbar` moves it to the front of the builder's own list).
- D14: "TOC made from:" in the cog = Auto | Headings | Bullets, saved for each note in `FolderState.tocSources` like folds (rename remap, delete drop). Auto is no entry.
- D15: the cog's "Table of contents" switch turns it off for one page; not stored.
- Found in the run: typing IN a heading builds the tag's one decoration again (Milkdown's id step replaces the node): 0.05–0.09 ms a key, accepted.

## State
- Done:
  - [x] Scope, two mockups, the demo in a worktree, and the 15 decisions locked on YAZ-2701
  - [x] 1 (YAZ-2712) the scans, the channel, the jump
  - [x] 2 (YAZ-2713) the app-wide setting and `tocSources`
  - [x] 3 (YAZ-2714) the names, the lines, the card
  - [x] 4 (YAZ-2715) the page cog
  - [x] 5 (YAZ-2716) the heading level tag
  - [x] 6 (YAZ-2717) the scrollbars
  - [x] 7 (YAZ-2718) the toolbar order
  - [x] 8 (YAZ-2719, 8A YAZ-2720, 8B YAZ-2721) polish: 25 findings, 22 fixed, 3 declined
  - [x] 9 (YAZ-2722) gates green, the size ceilings raised, the e2e spec, the documents
- Now: [→] the pull request against `main`, then the merge
- Next: Yaseen's guided test (25 steps, on YAZ-2722), then the release with YAZ-2702

## Open Questions
- (resolved) Four size ceilings went up by the size of this work: eager JS +19,674, eager CSS +6,618, renderer total +26,292, main bundle +1,805 bytes. Scoping estimated 5 KB of JS and 2 KB of CSS; the scope then grew in the demo (bullets, the tag, the scrollbars, the cog, "TOC made from").
- UNCONFIRMED: the typing number in the real app (20 ms ceiling) is not measured; the perf harness opens windows. A probe in jsdom shows the branch is not slower than main.
- UNCONFIRMED: `desktop/e2e/tableOfContents.spec.ts` is typechecked and nobody ran it. `lineNumbers.spec.ts` was corrected for the cog's new switches the same way.
- UNCONFIRMED: `color-scheme` changes how the system draws the controls that the app does not style (9 checkboxes, a rename field, select lists). Step 25 of the guided test looks at them.

## Working Set
- Branch `feat/yaz-2700-table-of-contents`, worktree `.claude/worktrees/yaz-2700-table-of-contents`, from `main` at `fa79bce`, with `main` (`df5cf39`, YAZ-2702) merged in.
- Renderer: `client/src/editor/toc/` (`tocPlugin.ts`, `tocChannel.ts`, `TableOfContents.tsx`, `toc.css`), `client/src/editor/outline/headingLevelTag.ts` + `.css`, `client/src/editor/PageSettings.tsx`, `client/src/editor/Editor.tsx`, `client/src/editor/createCrepe.ts`, `client/src/app.css`, `client/src/settings/registry.tsx`, `client/src/lib/storage.ts`
- Shared and main: `shared/types.ts` (`TableOfContents`, `TocSource`, `FolderState.tocSources`), `shared/ipc.ts` (`state.setTocSource`), `desktop/src/main/store.ts`, `desktop/src/main/ipc/state.ts`
- Tests: `npx vitest run client/src/editor/toc client/src/editor/outline/headingLevelTag.test.ts client/src/editor/PageSettings.test.tsx desktop/src/main/store.test.ts`
- Demo: `~/Desktop/yaz-2700-demo` (the vault, its own profile, `launch.sh`). Delete it when the issue closes.
