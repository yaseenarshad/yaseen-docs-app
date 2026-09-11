# CONTINUITY — yaz-1471-views

## Goal
Ship YAZ-1471 "Views changes" to main: view tabs are editable again (drag to reorder, right-click Rename · Duplicate · Delete with a confirm sheet, "+" with a type picker), `defaultView` rides in the in-memory def (one door), the YAZ-935 Board backfill is retired, and both tab strips scroll without a scrollbar. Done = every 🔒 D0–D6 pinned by a test that would fail without it, `npm test` + `npm run typecheck` green, contracts true, polish pass closed with evidence, released as a patch version and merged.

## Constraints
- Branch `yaz-1471-views`, worktree `.claude/worktrees/yaz-1471-views`; main stays clean. Isolated demo app: `/tmp/yaz-1471-demo` (profile + vault), deleted at 4B.
- Tests-first per child; one commit per child via the `/commit` skill (no attribution lines); full `npm test` before every commit.
- No Playwright by default (🔒 D6 YAZ-1334); at most one targeted spec (`board.spec.ts`) in 3-, announced first.
- Anything touching a 🔒 ruling → back to Yasin as D<n>. New work → `2B1`-style child in Linear.
- Move parent + child to In Progress when starting a child; Done + evidence comment when finished.

## Key Decisions
- D0 editable tabs (re-rules 🔒 rule 4) · D1 drag (TabBar idiom) · D2 menu + confirm · D3 backfill retired · D4 defaultView in the def · D5 "+" type picker · D6 no-scrollbar strips (both). All 🔒 as comments on YAZ-1471 (2026-09-11).
- Step 0: the approved prototype is committed as ONE commit; children are tests-first re-pin + polish per slice.
- Agents: one opus build agent per 2x child with a self-contained brief file in the scratchpad; Fable reviews every diff, runs the full suite, commits. Independent read-only reviewer in 4-.

## State
- Done:
  - [x] 1- Scope (YAZ-1481): findings, D0–D6, prototype approved
  - [x] 2- Step 0: prototype committed (a938651)
  - [x] 2A- Drag (YAZ-1483) — 5 tests, comments, no code change
  - [x] 2B- Menu / defaultView / backfill (YAZ-1484) — 20 re-pins, 15 new, onDelete selection bug fixed
- Now: [→] 2C- "+" picker (YAZ-1485)
- Next: 2D- No-scrollbar strips (YAZ-1486)
- Remaining:
  - [ ] 3- Prove it (YAZ-1487)
  - [ ] 4- Polish (YAZ-1488) → 4A Contracts (YAZ-1489) → 4B Release (YAZ-1490)

## Open Questions
- UNCONFIRMED: 09 broken entries dropped on first write — Yasin to confirm in 3-.

## Working Set
- Files: `client/src/views/view/ViewTabs.tsx`, `ConfirmDeleteView.tsx`, `ViewsPane.tsx`, `FolderPageContents.tsx`, `view/PropertiesMenu.tsx`, `folderPageSettings.ts`, `viewSchema.ts`, `views.css`, `tabs/tabs.css`, `app.css`, tests: `view/Toolbar.test.tsx`, `FolderPageContents.test.tsx`, `folderPageSettings.test.ts`, `testFolderPage.ts`, fixtures `desktop/e2e/fixtures/bible-vault/{KPIs,Home}.md`.
- Tests: `npm test` · `npm run typecheck` · demo app: `YASEEN_DOCS_USER_DATA_DIR=/tmp/yaz-1471-demo/profile npm run dev -w desktop` (from the worktree).
