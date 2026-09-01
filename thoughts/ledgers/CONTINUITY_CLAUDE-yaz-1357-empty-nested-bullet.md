# CONTINUITY — YAZ-1357 empty nested bullet + outline reconcile

## Goal
- People.md (folder page) opens editable with an empty nested bullet under `[[Alex Hormozi]]`; a page created by clicking a dangling outline link becomes a member; the `[[` picker's no-match row says the truth. Unit tests green, PR open, demo vault + isolated dev app for Yasin's stress test. Merge to main only after Yasin signs off on the demo.

## Constraints
- Three locked decisions on YAZ-1357 (🔒 D1/D2/D3 comments). Heal on LOAD only (no serializer change, no blocking the shape). Reconcile = tag only. Keep create-on-click.
- No Playwright. Verify via vitest + a "go do this" script in the isolated dev app.
- Commit with the /commit skill (no Claude attribution). Linear statuses: parent + subissue In Progress when started, Done when done. Learnings → Linear comments.

## Key Decisions
- D1 `separateEmptyNestedItems` runs AFTER `unifySiblingMarkers` (blank line resets marker memory), skips fences.
- D2 reconcile effect keyed `[resolve, lookup, lossy]`, in-flight `tagging` set mirrors `untagging`.
- D3 label: `New page "X" — click the link to create it`.

## State
- Done:
  - [x] YAZ-1358 scope record
  - [x] YAZ-1359 load-side heal — 6d87247
  - [x] YAZ-1360 reconcile + one shared `tag()` hold — ffe1b98
  - [x] YAZ-1361 picker label — bd268fa
  - [x] full suite 204 files / 3137 tests green; typecheck clean; branch pushed
- Now: [→] YAZ-1362 verify — demo at ~/Desktop/yaz-1357-demo (vault/, vault-pristine/, profile/, README.md script); dev app launched with YASEEN_DOCS_USER_DATA_DIR=profile
- Next: YAZ-1363 polish pass + evidence comment; open PR
- Remaining:
  - [ ] Yasin's stress-test sign-off on the demo
  - [ ] merge to main (only after sign-off)

## Learnings
- `- a` + `    -` is a SETEXT HEADING to CommonMark (the outline seed's `-` respelling made the bug worse than the note editor's `\*`).
- The blank-line pass must run AFTER `unifySiblingMarkers` (blank line resets marker memory).
- A tag written by an EDIT also needs the until-echo hold, or the next snapshot re-writes it; one `tag()` door for both paths.

## Open Questions
- none. Isolated profile = env `YASEEN_DOCS_USER_DATA_DIR` (dev) or `--user-data-dir` (built app).

## Working Set
- Worktree: /Users/yasin/Documents/GitHub/yaseen-milkdown-yaz1357, branch worktree-yaz-1357-empty-nested-bullet
- Files: client/src/editor/listItemRoundTrip.ts, client/src/views/view/OutlineView.tsx, client/src/editor/wikilink/wikilinkPicker.ts, docs/CONTRACTS.md + tests
- Tests: `cd client && npx vitest run <file>`; full: `npm test` at root
