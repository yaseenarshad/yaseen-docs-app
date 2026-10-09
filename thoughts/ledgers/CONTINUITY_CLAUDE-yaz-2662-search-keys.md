# YAZ-2662: the Search tab — pinned items first, Enter on a folder, Space, more keys

## Goal

- The Search tab draws the matches of the favorites and the focus list first. Enter on a folder shows it in Files. Space previews a file in a panel and opens a folder in the search tree. Shift+Enter, → and ←, Esc into the page, key hints.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`.

## Constraints

- No Playwright, and do not start Electron. Proof is `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`.
- Never open or test on a real vault. Use fixtures and temp folders.
- Write the test first, see it fail, then write the code.
- Renderer only. No main/IPC change, no new dependency. `mainBundleBytes` must not grow.
- Yasin approved a raise of the size ceilings for this work (chat, 2026-10-08). Record old and new numbers in the pull request.
- Delivery: open the pull request and stop. Yasin does the hand walk. Merge after he says it passed. No release.
- Commits go through the `/commit` skill.

## Key Decisions

- The record is on Linear, on [YAZ-2662](https://linear.app/growprofit/issue/YAZ-2662), in three comments: "Scoping decisions — LOCKED" (D1 to D11), "Cases, exclusions and checks — LOCKED" (S1 to S64, R1 to R7), "Design for the build".
- A recorded case is stronger than a diff.
- D11 (the arrows on a sidebar tree) was decided by the agent while Yasin slept. He can decline it in the hand walk.
- No demo: Yasin dropped it and approved the build directly.

## Coordination with YAZ-2663 (the new tab page)

- The branch `yaz-2663-new-tab-page` is stacked on this branch from `8425e13` and merges it each hour. Do NOT rebase or force-push this branch. Plain commits only.
- YAZ-2663 does not change the Search tab. It replaces the empty page of a new tab with a `StartPage`, still under the preview panel in `.tabstack`.
- Three doors that YAZ-2663 calls. Keep each stable: `onRevealInFiles(path, true)`; the App state or callback of the preview panel that takes a path or `null`; and `useSidebarSearch` must leave → and ↓ unhandled when the text is empty.

## State

- Done:
  - [x] Scoping, locked into Linear
  - [x] Subissues: YAZ-2664 to YAZ-2670
- Now: [→] YAZ-2664: 1- Enter and Shift+Enter show a row in Files
- Remaining:
  - [ ] YAZ-2665: 2- Esc puts the caret in the page, and the empty Search tab shows the keys
  - [ ] YAZ-2666: 3- The matches of the pinned items show first
  - [ ] YAZ-2667: 4- Space, → and ← on a folder
  - [ ] YAZ-2668: 5- Space on a file shows the preview panel
  - [ ] YAZ-2669: 6- Polish and anti-slop
  - [ ] YAZ-2670: 7- Verify and deliver
  - [ ] Yasin's hand walk, then the merge

## Open Questions

- UNCONFIRMED: the end-to-end specs are written and typechecked, never run.

## Working Set

- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2662`, branch `yaz-2662-search-keys`, from `main` at `dd8d89b` (1.0.0).
- Baseline at `dd8d89b`: 306 test files, 5,952 passed, 2 skipped. The size gate passed.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Targeted: `npx vitest run client/src/sidebar client/src/search` · `npx vitest run --project perf client/src/search/searchCandidates.perf.test.ts`.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
