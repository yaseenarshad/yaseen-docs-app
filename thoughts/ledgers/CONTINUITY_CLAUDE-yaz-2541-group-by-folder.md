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

TENTATIVE. Yaseen, 2026-10-05: "all approved" and "im down with what u have said but before we lock it in lets do this", meaning the demo first. Not locked, not in Linear.

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

- Done:
  - [x] Scoped off main `d73a532`; six decisions brought to chat with diffs
  - [x] Yaseen approved all six, tentatively
  - [x] Prototype built in this worktree, uncommitted: typecheck clean, `npx vitest run` 5232 passed, 2 skipped
  - [x] Demo vault and isolated profile built; dev app launched on them (HMR, debugging port 9341)
- Now: [→] Yaseen stress tests the demo and gives feedback
- Next: he says "approved, lock it in" or changes things
- Remaining:
  - [ ] Post the findings and the locked decisions as one comment on YAZ-2541
  - [ ] Create the sub-issues from his sub-issue prompt (proposed: scope, engine, menus and headers, verify, polish and anti-slop)
  - [ ] Delete the demo vault and its profile

## Open Questions

- UNCONFIRMED: his question "you'll put like 'group by Folder (Metrics)' or something right?" The picker says "Folder"; the page's own group is headed by the page's title. He may want the picker or a header worded differently once he sees it.
- UNCONFIRMED: a shortcut whose home is the vault root lands in "No value". Bug-level, to settle in the scoping sub-issue.
- UNCONFIRMED: retitling a folder renames its directory, so that group's collapsed state resets.

## Working Set

- Branch: `yaz-2541-group-by-folder`; worktree `.claude/worktrees/yaz-2541-group-by-folder`
- Files: `client/src/views/engine.ts`, `client/src/views/ViewsPane.tsx`, `client/src/views/view/GroupHeader.tsx`, `client/src/views/view/SortMenu.tsx`, the five header call sites, and their tests
- Tests: `npx vitest run --project client`, `npm run typecheck`
- Demo: vault "Group a table by folder" and profile `profile-yaz-2541`, both in the session scratchpad; built by `make_demo_vault.py` there
- Launch: from `desktop/` in the worktree, `YASEEN_DOCS_USER_DATA_DIR=<profile> YASEEN_DOCS_E2E=1 npx electron-vite dev`
