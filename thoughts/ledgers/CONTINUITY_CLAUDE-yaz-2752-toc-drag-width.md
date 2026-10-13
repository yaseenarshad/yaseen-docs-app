# YAZ-2752 — Drag the edge of the table of contents

## Goal
- The reader drags the left edge of the names column of the table of contents. The column gets wider or narrower, and the app keeps the width.
- Done = the four gates are green, the pull request is merged, the release notes are on YAZ-2752. NO release in this run: Yaseen puts it into a release with other work.

## Constraints
- No Playwright on this Mac: it takes over the screen. The e2e step is written and typechecked, not run.
- Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`.
- Linear: the main issue's comments are for humans. Agent records go on the working log YAZ-2754 and on the subissues YAZ-2756 to YAZ-2760.
- Commits through the `/commit` skill (no Claude attribution).
- No new channel, no dependency. One new settings field; an old state file loads with the default.
- A drag renders nothing in React for each move (the pattern of YAZ-2239).

## Key Decisions (locked on YAZ-2754, each with its scenarios)
- D1: the width is one app-wide number, `SettingsState.tableOfContentsWidth`. A stored value that is not valid loads as 200; the app does not clamp it.
- D2: the edge shows each time the names show. `pinned`: the text keeps 500 px. `auto`: the column takes the empty margin and no more. `namesShow` does not change.
- D3: 160 to 480 px, default 200 (`TOC_MIN_W`, `TOC_MAX_W`, `TOC_DEFAULT_W`).
- D4: a hidden 6 px strip on the hairline of the list, `--accent-soft` on hover and during a drag. Each move writes `--toc-width` on `section.editor`; the release writes the setting one time.
- D5: mouse only. No double-click, no keys, no drag that pins or unpins.
- Found in the real app: the note's own scrollbar (11 px, always there since YAZ-2700 D11) is not margin. With `auto` the column took it and the text was 11 px narrower. `namesRoom` now takes `gutter`: `max(TOC_WIDTH, noteWidth - gutter - columnMax)`. `namesShow` is NOT changed, so from 1240 to 1250 px of note the text is still up to 11 px short, as before this work.
- Found in the audit: a right press on the edge started a drag. `startResize` takes the left button only.
- The size: eager JS +1893, eager CSS +168, main +198 bytes. The scoping estimate was 1.3 KB; the work measures 2.3 KB. `rendererTotalBytes` also takes the 9161 bytes of YAZ-2709 that passed inside the tolerance.
- A check out of sight: `NODE_OPTIONS=--require hide.cjs` swaps `BrowserWindow` for a class that is born `show: false, focusable: false, opacity: 0`, with `setIgnoreMouseEvents(true)` and `showInactive()`; `app.dock.hide()`. No window ever shows and no click or key reaches it.
- Demo: none. Release: joins a later release. Delivery path: the agent merges when the pull request is green (Yaseen: "merge when the PR is green").

## State
- Done:
  - [x] Scope and decisions locked on YAZ-2754; subissues YAZ-2756 to YAZ-2760 created
  - [x] 1 (YAZ-2756) the saved width: the setting, the limits, the load guard
  - [x] 2 (YAZ-2757) the drag: `namesRoom`, the shown width, `--toc-width` on the section, `startResize`, `.toc__resize`
  - [x] 3 (YAZ-2758) polish and anti-slop: the audit and its fixes
  - [x] The check in the real app, out of sight (its own profile, a demo vault, the DevTools protocol): 23 of 23 cases pass
- Now: [→] 4 (YAZ-2759) verify and deliver: the gates are green, the ceilings are raised; the pull request and the merge remain
- Next: 5 (YAZ-2760) release notes on YAZ-2752
- Remaining:
  - [ ] Merge when the pull request is green

## Open Questions
- (resolved) the delivery path: Yaseen said "merge when the PR is green".
- UNCONFIRMED: the new e2e step is typechecked only.

## Working Set
- Branch `feat/yaz-2752-toc-drag-width` from `main` at `0378399`. Worktree `.claude/worktrees/yaz-2752-toc-drag-width`.
- State: `shared/types.ts`, `desktop/src/main/store.ts`, `client/src/App.tsx`, `client/src/editor/Editor.tsx`
- Component: `client/src/editor/toc/TableOfContents.tsx`, `client/src/editor/toc/toc.css`
- Tests: `npx vitest run client/src/editor/toc/TableOfContents.test.tsx desktop/src/main/store.test.ts`
