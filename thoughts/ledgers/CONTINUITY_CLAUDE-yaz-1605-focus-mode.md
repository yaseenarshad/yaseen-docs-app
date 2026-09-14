# CONTINUITY — YAZ-1605 Focus Mode

## Goal
- Right-click a folder (Files) or folder page (Topics) → "Focus on …" → the tree shows only that subtree, an accent eye left of the chevrons marks focus, clicking it exits. Per-vault persisted. Linear: YAZ-1605 (parent), project Milkdown.
- Done = Yasin says "approved, lock it in" on the demo → D1–D5 posted as comments on YAZ-1605 → subissues per Yasin's next prompt → implement → verify → merge.

## Constraints
- Linear-Simpler method (`growprofitai/_code-wiki/Linear-Simpler`). Yasin approves the tree before Linear is mutated. No subissues until his subissue prompt.
- No Playwright on Yasin's screen. Demo = dev app on isolated profile. Never touch the real vault or installed app.
- Shipped on main `f138809` (PR #53). Branch and worktree removed.

## Key Decisions (🔒 locked 2026-09-14 — comments on YAZ-1611 hold the diffs)
- D1 persist per vault: `FolderState.focusDirs` + `focusTopics` (string[], empty = off — `expanded`'s exact shape), repaired by renamePath/removePath, validated in ipc/state.ts. Lists, not one path, because Yasin asked for shift-select multi-focus (2026-09-14).
- D2 Files: focused folders are the top rows in TREE order, outermost only (`focusRoots`), auto-opened; expand/collapse-all acts on `shownDirs` only.
- D3 Topics: `topicRoots(…, focus)` is the one door; expand-all + Uncategorized follow; Uncategorized hidden while focused.
- D4 self-clear when target gone (tree / index); reveal outside focus exits focus first.
- D5 eye only while focused, left of chevrons, accent color; menu item "Focus on folder" / "Focus on N folders" (dir rows; inside a 2+ selection = the selection's dirs, files ignored) / "Focus on topic" / "Focus on N topics" (folder-page rows, not Home). Multi replaces, never stacks.

## State
- Done:
  - [x] Scope + D1–D5 proposed in chat (2026-09-14)
  - [x] Worktree + prototype applied (8 src files + 6 test fixtures); typecheck clean; sidebar/lib/store/ipc suites green
  - [x] Demo vault `~/Desktop/Focus Mode` (51 files) + scenario list in `00 START HERE.md` + chat
  - [x] Dev app running: `YASEEN_DOCS_USER_DATA_DIR=<scratchpad>/focus-mode-profile npm run dev` from the worktree
  - [x] Yasin approved the demo ("lock it in"); D1–D5 posted on YAZ-1611; tree YAZ-1611…1616 created
  - [x] 2- Persist (YAZ-1612) — `635a900`, 98 tests
  - [x] 3- Files (YAZ-1613) — `2c4ce27`, 30 tests (opus agent wrote them; reviewed, lean)
  - [x] 4- Topics (YAZ-1614) — `3905600`, 12 tests; agent caught the orphans/fall-through divergence → one-line fix
  - [x] Merged origin/main (YAZ-1604 dated folder) — `778099e`, one conflict (ContextMenu destructuring). Full suite 3925 green, typecheck clean
  - [x] 6- Polish (YAZ-1616) — stale "ONE path" comment → list wording; CONTRACTS Focus Mode paragraph; nothing to trim in src
  - [x] 5- Verify (YAZ-1615) — 3925/3925 tests + Yasin's hand pass on the demo vault: "all passed" (2026-09-14)
  - [x] PR #53 merged to main as `f138809`. NO release cut (Yasin batches releases). Worktree, branch (local+remote), demo vault and profile removed.
  - [x] Handoff comment posted on YAZ-1605 and every child (1611–1616); all Done
- Now: COMPLETE — nothing pending
- Next: none. Deliberately not done (a later issue, not debt): a keyboard shortcut for focus/exit; a breadcrumb showing the focused path; focus applied inside search results; stacked (push/pop) focus.

## Open Questions
- (resolved) T14 and F16 kept as bounded defaults — recorded on YAZ-1611.
- UNCONFIRMED: `topicRecords.length === 0` guard for the pre-index snapshot — is there a proper "index landed" flag on `indexSource`?
- (resolved) worktree `node_modules` now a real `npm ci`; the 3 "Denied ID" suites should pass — confirm in 5-.

## Working Set
- Everything is on main at `f138809`; worktree and branch removed
- Files: `shared/types.ts`, `desktop/src/main/{store,ipc/state}.ts`, `client/src/lib/{storage,treeState}.ts`, `client/src/sidebar/{Sidebar,TopicsTree,ContextMenu}.tsx`, `client/src/app.css`
- Tests: `npx vitest run client/src/sidebar client/src/lib desktop/src/main` · `npm run typecheck`
- Demo: vault `~/Desktop/Focus Mode`; profile `<scratchpad>/focus-mode-profile` (seeded by `<scratchpad>/seed-profile.ts` via vite-node); dev log `<scratchpad>/dev.log`
