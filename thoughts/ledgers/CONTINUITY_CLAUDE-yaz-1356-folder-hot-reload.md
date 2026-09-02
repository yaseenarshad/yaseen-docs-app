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
- Done:
  - [x] 1- YAZ-1365 Scope (findings = 🔍 comment on YAZ-1356)
  - [x] 2- YAZ-1366 Build: 2A YAZ-1369 `fce461f` + fix `7f1e0b7` (save-space serialisation) · 2B YAZ-1370 `855f2c0`
  - [x] 3- YAZ-1367 Prove it: 3A YAZ-1371 6/6 real-app scenarios over CDP (driver: scratchpad `verify/run.mjs`, demo vault `~/Desktop/YAZ-1356-demo`) · 3B YAZ-1372 205 files / 3173 tests, typecheck ×3
- Now: [→] 4A YAZ-1373 polish (CONTRACTS.md amended, YAZ-954 superseded, remnants grep clean) → merge to main
- Next: 4B YAZ-1374 release 0.9.3 (bump on main → desktop:build → install → real-vault smoke → tag)

## Open Questions
- None.

## Working Set
- Worktree `.claude/worktrees/yaz-1356`, branch `yaz-1356-folder-hot-reload` (pushed). GOTCHA: a Bash call without `cd` runs in the MAIN repo — always `cd $W &&`.
- Files: `client/src/views/view/OutlineEditor.tsx`, `client/src/views/view/OutlineView.tsx`, `client/src/editor/Editor.tsx`, tests beside them, `docs/CONTRACTS.md:225` (4A).
- Real page: `/Users/yasin/Documents/GitHub/business-wiki-MASTER/🧠 DUMP.md` (39 lines, all frontmatter).
- Tests: `npx vitest run` · `npm run typecheck`.
- Linear creds: `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; helper in scratchpad `lin/create.mjs`.
