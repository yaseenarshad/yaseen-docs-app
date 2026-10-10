# YAZ-2662: the Search tab — pinned items first, Enter on a folder, Space, more keys

## Goal

- The Search tab draws the matches of the favorites and the focus list first. Enter on a folder shows it in Files. Space previews a file in a panel and opens a folder in the search tree. Shift+Enter, → and ←, Esc into the page, key hints.
- Done: the gates are green, the pull request is open, Yasin's hand walk passed, the work is on `main`. All four are true since 2026-10-09.

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

- The branch `yaz-2663-new-tab-page` was stacked on this branch from `8425e13`. It holds the last commit of this branch (`cc39f97`). Since the merge it must merge `origin/main`.
- YAZ-2663 does not change the Search tab. It replaces the empty page of a new tab with a `StartPage`, still under the preview panel in `.tabstack`.
- Three doors that YAZ-2663 calls. Keep each stable: `onRevealInFiles(path, true)`; the App state or callback of the preview panel that takes a path or `null`; and `useSidebarSearch` must leave → and ↓ unhandled when the text is empty.

## State

- Done:
  - [x] Scoping, locked into Linear
  - [x] Subissues: YAZ-2664 to YAZ-2670
  - [x] YAZ-2664: 1- Enter and Shift+Enter show a row in Files (`8425e13`)
  - [x] YAZ-2665: 2- Esc puts the caret in the page, and the empty Search tab shows the keys (`8425e13`)
  - [x] YAZ-2666: 3- The matches of the pinned items show first (`a7dc253`)
  - [x] YAZ-2667: 4- Space, → and ← on a folder (`b0d8717`)
  - [x] YAZ-2668: 5- Space on a file shows the preview panel (`2d6a9b1`)
  - [x] YAZ-2669: 6- Polish and anti-slop: 11 findings applied, 3 declined (`6d61727`)
  - [x] YAZ-2670: 7- Verify and deliver: the size ceilings (`95593a5`), the docs and the specs (`b7f287f`), the gates, the pull request
  - [x] Yasin's hand walk passed (chat, 2026-10-09); merged by pull request #104 as `e3b6d31`; CI on the pull request was green
  - [x] Closeout: the handoff is on YAZ-2662 and on each subissue; the eight issues are Done; the worktree, the branch and the hand-walk vault are removed
- Now: closed. No release yet: Yasin puts several merges into one release.
- Next: the release notes, when Yasin asks. The before state is in the two pictures of his first two comments on YAZ-2662.

## Decisions made during the build (Yasin was asleep; his hand walk passed with them in place)

- D11: the arrows walk the rows of a sidebar tree (`rowArrows` in `Tree.tsx`). If Yasin declines it: remove `rowArrows`, its tests, two rows of the keyboard table and the ↓ assert in step 9 of `search.spec.ts`.
- S19 changed, with S19A: "Everything else" leaves out only the pinned items that the top group draws.
- S41: the "it is no longer there" line is for a note. Each other kind shows the error line of its viewer.
- S65 to S67 and the held keys, from the polish audit: a click on a row closes the preview; Esc with the focus inside the panel closes it; the panel gives way to the board and to a review; a held Enter or Space acts one time.
- The read-only renderer of a note is one hook, `client/src/editor/useReadOnlyNote.ts`, for the hover card and the panel. The note in the panel wears `editor-instance`; `focusOpenDocument` skips `.quicklook` (R4).
- App's `previewPath` is the one truth of "a panel is on show". The door is the Sidebar prop `onPreview(path | null)`.

## Open Questions

- UNCONFIRMED: the end-to-end specs are written and typechecked, never run. Step 9 of `search.spec.ts` reads its selectors from the source.
- UNCONFIRMED: S67 with the highlight on a folder (the board opens while the preview is on and no panel is drawn) has no test and no hand-walk step.
- Known limit: Esc after a click inside a PDF in the panel does not reach the panel (an `iframe`). The ✕ works.
- Settings › Hotkeys lists only ⌘K for the search. The other keys are on the empty Search tab.

## Working Set

- The worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-2662` and the branch `yaz-2662-search-keys` (from `main` at `dd8d89b`, 1.0.0) are removed. The work is on `main` from `e3b6d31`.
- Baseline at `dd8d89b`: 306 test files, 5,952 passed, 2 skipped. The size gate passed.
- At `b7f287f`: 308 test files, 6,056 passed, 2 skipped. The size gate passes with three raised ceilings: `rendererEagerJsBytes` 2,007,099 → 2,013,049, `rendererEagerCssBytes` 149,568 → 150,980, `rendererTotalBytes` 13,148,534 → 13,155,896. `mainBundleBytes` is 529,077, not changed.
- The hand-walk vault `/private/tmp/yaz-2662-handwalk/` and its builder script are removed. The steps of the hand walk are a comment on YAZ-2670, and `docs/REGRESSION.md` has the hand scenario S24.
- Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run perf:budget:ci`. `PATH` needs `/opt/homebrew/bin`. Local Node is v26.5.0; CI uses Node 22.
- Targeted: `npx vitest run client/src/sidebar client/src/search` · `npx vitest run --project perf client/src/search/searchCandidates.perf.test.ts`.
- Linear: key `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; skills at `~/Documents/GitHub/skills-growprofit-eng/yaseen-skills-and-prompts/2-yaseen-linear-master-skill`.
