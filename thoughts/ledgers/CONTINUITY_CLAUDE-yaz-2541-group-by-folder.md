# YAZ-2541: Group a table by folder

Issue: https://linear.app/growprofit/issue/YAZ-2541/group-a-table-by-folder-folder-is-missing-from-group-by

## Goal

- "Folder" is a choice in Group by on a folder's table, board, list and cards.
- A page such as `Metrics` shows its notes under `1- Marketing`, `2- Sales`, and so on, named as the sidebar names them.
- Done when Yaseen says "approved, lock it in" on the demo, the decisions are posted to YAZ-2541, and the sub-issues are built and merged.

## Constraints

- Built in the worktree `yaz-2541-group-by-folder`, cut from main `d73a532`.
- No Playwright. Verify with vitest, typecheck, and the hand-tested demo vault.
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

CLOSED 2026-10-05. Merged to main by PR #91 (`3836937`). Not released: Yaseen cuts releases himself. The Linear record on YAZ-2541 (comment `57da44d2`, with Amendment 1) is the source of truth.

- Done:
  - [x] YAZ-2542 1- Scope
  - [x] YAZ-2543 2- Engine: YAZ-2544 2A, YAZ-2545 2B, YAZ-2546 2C (`bad7c8a`)
  - [x] YAZ-2547 3- Menus and headers: YAZ-2548 3A, YAZ-2549 3B, YAZ-2550 3C (`bad7c8a`)
  - [x] YAZ-2551 4- Polish and anti-slop: YAZ-2552 4A, YAZ-2553 4B (`a880846`)
  - [x] YAZ-2554 5- Verify (gates, and every scenario read off the dev app; no Playwright)
  - [x] `docs/CONTRACTS.md` states the rule (`73afffd`)
  - [x] Handoff comment on the parent and every sub-issue; project update posted
  - [x] Demo vault, its profile, the worktree and the branch removed
- Now: nothing
- Next: nothing

## Open Questions

- None open. Settled: the picker says "Folder" (he saw it and asked for no change); a root-home shortcut gets the vault's group (2C); collapse state stays keyed by path (B3).

## Working Set

- Files: `client/src/views/engine.ts`, `client/src/views/ViewsPane.tsx`, `client/src/views/FolderView.tsx`, `client/src/views/view/GroupHeader.tsx`, `client/src/views/view/SortMenu.tsx`, the five header call sites, and their tests
- Tests: `npx vitest run --project client`, `npm run typecheck`
- Gotchas left for the next change: YAZ-2523's worktree also edits `client/src/views/FolderView.test.tsx`; the size gate's eager JS row has 891 bytes of room left
