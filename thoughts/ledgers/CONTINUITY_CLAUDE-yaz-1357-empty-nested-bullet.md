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
- Now: [→] YAZ-1359 load-side heal (tests first)
- Next: YAZ-1360 reconcile
- Remaining:
  - [ ] YAZ-1361 picker label
  - [ ] YAZ-1362 verify (demo vault on Desktop, isolated profile dev app, script for Yasin)
  - [ ] YAZ-1363 polish + evidence comment
  - [ ] PR open, wait for Yasin's stress-test sign-off, then merge

## Open Questions
- UNCONFIRMED: how the dev app takes an isolated profile (see desktop/src/main/userData.ts, LAUNCH.md).

## Working Set
- Worktree: /Users/yasin/Documents/GitHub/yaseen-milkdown-yaz1357, branch worktree-yaz-1357-empty-nested-bullet
- Files: client/src/editor/listItemRoundTrip.ts, client/src/views/view/OutlineView.tsx, client/src/editor/wikilink/wikilinkPicker.ts, docs/CONTRACTS.md + tests
- Tests: `cd client && npx vitest run <file>`; full: `npm test` at root
