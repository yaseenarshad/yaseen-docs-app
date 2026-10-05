# YAZ-2541: Group a table by folder

Issue: https://linear.app/growprofit/issue/YAZ-2541/group-a-table-by-folder-folder-is-missing-from-group-by

## Goal

- "Folder" is a choice in Group by on a folder's table, board, list and cards.
- A page such as `Metrics` shows its notes under `1- Marketing`, `2- Sales`, and so on, named as the sidebar names them.
- Done when Yaseen says "approved, lock it in" on the demo, the decisions are posted to YAZ-2541, and the sub-issues are built and merged.

## Constraints

- Prototype in this worktree only (`yaz-2541-group-by-folder`, cut from main `d73a532`). No commit or push until Yaseen confirms.
- No Playwright. Verify with vitest, typecheck, and the hand-tested demo vault.
- Nothing goes to Linear until "approved, lock it in". Sub-issues wait for his sub-issue prompt.
- Raising a `tools/perf/budget.json` ceiling needs his explicit OK.

## Key Decisions

LOCKED 2026-10-05 after the demo. The Linear record on YAZ-2541 is the source of truth; this is a copy.

- **D1, what Folder groups by: option 3.** A Folder level groups by the folders one step below the page; deeper notes roll up into that folder. "Then group by: Folder" gives the next folder down as inner groups. Folders three or more steps down roll up into their second-step folder. Cost: Folder then Folder uses both grouping levels.
  - Rejected: 1, flat (one group per folder holding notes, path names). 2, one level only.
- **D2, what a group is called: option 2.** The folder's title; a folder with no settings file uses its directory name. The engine names the group (`Group.label`) and `GroupHeader` shows what it is given. The key stays the root-relative path.
  - Rejected: 1, the path as stored.
- **D3, notes directly in the page's folder: option 1.** A group named after the page's folder, listed first. No special case.
  - Rejected: 2, fixed words such as "This folder". 3, the "No value" group.
- **D4, order of the groups: option 1.** The engine's existing order: by directory name, numbers natural, flipped by the ASC/DESC chip. Differs from the sidebar only in `2-` before `10-`.
  - Rejected: 2, the sidebar's exact comparator.
- **D5, where Folder is offered: option 1.** The Sort menu only (Sort property, Group by, Then group by). Not a column; the Filter menu is unchanged.
  - Rejected: 2, also a column showing the stored path. 3, also a column showing titles.
- **D6, start grouped by folder: option 1.** No. `DEFAULT_VIEWS` is unchanged.

Design, as proposed in chat:

- `engine.ts`: `RunOptions.page = { folder, folders }`; `folderAt(folder, page, depth)`; `bucket` and `groupOf` take the level's depth (1 for the first Folder level, 2 for a second, 0 otherwise); a Folder group's label is its folder's title.
- `ViewsPane.tsx`: passes `page`; the outer group is seeded before the clicked one, so an inner "+" under Folder then Folder is born in the inner folder.
- `GroupHeader.tsx`: new `label` prop, passed at the five call sites.
- `SortMenu.tsx`: `file.folder` joins this menu's list; Folder may be picked at both levels.

## State

Decisions LOCKED by Yaseen 2026-10-05 ("approved, lock it in"). Record: comment `57da44d2` on YAZ-2541, plus "Amendment 1" (B4: shortcut homes after the page's own folders; B1 built). He gave leave to commit, push and merge to main. No release unless he asks. No Playwright.

- Done:
  - [x] YAZ-2542 1- Scope (findings posted)
  - [x] YAZ-2543 2- Engine: YAZ-2544 2A, YAZ-2545 2B, YAZ-2546 2C (commit `bad7c8a`, pushed)
  - [x] YAZ-2547 3- Menus and headers: YAZ-2548 3A, YAZ-2549 3B, YAZ-2550 3C (same commit)
  - [x] YAZ-2552 4A- Polish list posted (six items)
- Now: [→] YAZ-2553 4B- Apply the polish pass: all six items are edited on disk, UNCOMMITTED; typecheck + `npx vitest run` must pass, then commit and push, comment, Done (and YAZ-2551 Done)
- Next: YAZ-2554 5- Verify: gates (`npm run build`, `npm run perf:budget:ci`), scenarios A to Q read off the dev app with `scratchpad/drive.mjs` (debug port 9341; a folder page opens on a DOUBLE click)
- Remaining:
  - [ ] PR to main, merge (fetch main first; YAZ-2523's worktree also edits `FolderView.test.tsx`, not yet on main)
  - [ ] Closeout: `📦 Handoff` comment on the parent and every sub-issue, project update on "Yaseen Docs App", YAZ-2541 Done
  - [ ] Stop the dev app, delete the demo vault and profile, remove this worktree and branch
  - [ ] Update memory: flow notes from this run

## Open Questions

- None open. Settled: the picker says "Folder" (he saw it and asked for no change); a root-home shortcut gets the vault's group (2C); collapse state stays keyed by path (B3).

## Working Set

- Branch: `yaz-2541-group-by-folder`; worktree `.claude/worktrees/yaz-2541-group-by-folder`
- Files: `client/src/views/engine.ts`, `client/src/views/ViewsPane.tsx`, `client/src/views/view/GroupHeader.tsx`, `client/src/views/view/SortMenu.tsx`, the five header call sites, and their tests
- Tests: `npx vitest run --project client`, `npm run typecheck`
- Demo: vault "Group a table by folder" and profile `profile-yaz-2541`, both in the session scratchpad; built by `make_demo_vault.py` there
- Launch: from `desktop/` in the worktree, `YASEEN_DOCS_USER_DATA_DIR=<profile> YASEEN_DOCS_E2E=1 npx electron-vite dev`
