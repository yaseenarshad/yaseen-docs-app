# CONTINUITY — YAZ-1356 folder pages don't hot-reload

## Goal
External (AI) edits to a folder page's `folder_page_settings.views[i].outline` and to its properties show on screen while the page is open. Done = 2A/2B/3A/3B/4A/4B Done, closing evidence comment on YAZ-1356, v0.9.3 installed.

## Constraints
- Locks (executionary, do not re-decide): 🔒 D1 diff-apply via `applyExternalMarkdown`, typing wins, echo rule; 🔒 D2 `disk` state in CrepeHost feeds the panel. Both as comments on YAZ-1356; approved diffs live in YAZ-1369 / YAZ-1370 descriptions.
- Tests FIRST per child (contract in each description). No Playwright, no e2e runs on Yasin's machine — dev app + computer use or a "go do this" script (YAZ-1371).
- Anything touching a 🔒 → back to Yasin (problem / options / recommendation / line-numbered diff / behaviour after). Trivial bugs → decide, log in comments.
- Commit via /commit skill only when Yasin says so. Elegance ruling: simpler, combined, minimal — never at the expense of what is right.

## Key Decisions
- D1 option 2 (diff, delete the YAZ-954 remount). D2 revised from "separate issue" to "fold in" at Yasin's push — the panel already has the follow-new-bytes branch.
- Not touched: watcher, index, `useFile` (a new `file` remounts Crepe — `Editor.tsx:320`), the frontmatter-only absorb, membership/adoption rules.

## State
- **WAVE COMPLETE (2026-09-01).** YAZ-1356 Done; closing evidence comment posted.
  - [x] 1- YAZ-1365 Scope
  - [x] 2- YAZ-1366 Build: 2A YAZ-1369 `fce461f` + `7f1e0b7` · 2B YAZ-1370 `855f2c0`
  - [x] 3- YAZ-1367 Prove it: 3A 6/6 over CDP (dev build AND packaged 0.9.3) · 3B 205 files / 3173 tests
  - [x] 4- YAZ-1368 Polish: 4A `b4dae15` · 4B release — PR #25 merged `0434906`, bump `d85ee2b`, tag `v0.9.3`, DMG `desktop/dist-app/Yaseen Docs-0.9.3-arm64.dmg`
- 0.9.3 installed to /Applications on 2026-09-01. Nothing pending.

## Open Questions
- None.

## Working Set
- Worktree `.claude/worktrees/yaz-1356`, branch `yaz-1356-folder-hot-reload` (pushed). GOTCHA: a Bash call without `cd` runs in the MAIN repo — always `cd $W &&`.
- Files: `client/src/views/view/OutlineEditor.tsx`, `client/src/views/view/OutlineView.tsx`, `client/src/editor/Editor.tsx`, tests beside them, `docs/CONTRACTS.md:225` (4A).
- Real page: `/Users/yasin/Documents/GitHub/business-wiki-MASTER/🧠 DUMP.md` (39 lines, all frontmatter).
- Tests: `npx vitest run` · `npm run typecheck`.
- Linear creds: `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; helper in scratchpad `lin/create.mjs`.
