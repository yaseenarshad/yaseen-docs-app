# Continuity — aug25 wave (YAZ-870, 862, 749, 748, 852)

## Goal

Ship all five scoped parents to main with the full suite green and Linear fully current:

1. YAZ-870 — click a folder page opens AND expands it
2. YAZ-862 — sidebar expand/collapse all (both lenses)
3. YAZ-749 — editable page title + rename confirm (+ nested-settings rename gap)
4. YAZ-748 — frontmatter panel (raw YAML + typed rows)
5. YAZ-852 — Excalidraw embed (sidecar + slash item + preview + modal)

"Done" = every subissue Done in Linear with evidence comments, `npm run typecheck && npm test && npm run e2e` green, contracts amended, merged to main, pushed.

## Constraints

- Every decision is already locked in Linear comments on the parents/subissues — implement, don't re-decide. New design/architecture questions go to Yasin in the problem/options/rec/diff format.
- TDD: tests are authored/owned by the overseer (Fable); implementation is delegated to Opus 5 agents; overseer reviews every diff for slop/excess before accepting. Overseer is accountable for code quality.
- Statuses: parent AND subissue → In Progress when started; → Done when complete. Learnings/gotchas → Linear comments as they happen.
- Commit style: match repo (`feat(scope): sentence (YAZ-###)`), no AI attribution (use /commit skill flow). Merge to main per completed parent, push.
- Ordering: 870 before 862-C (same expansion state). 749-B before 748-B (same mount spot, title first). 852 last (biggest).

## Key Decisions

- All recorded in Linear (locked comments on YAZ-862/852/748/749/870 + subissues). This ledger does not duplicate them.

## State

- Done:
  - [x] Scoping pass, all decisions locked, 24 subissues created
  - [x] Worktree `aug25-wave` (branch `worktree-aug25-wave`), deps installed
  - [x] Phase 1: YAZ-870 complete (commits `02b2df5` + `f392020`); YAZ-889 closed as duplicate of YAZ-864 (landed on main before the wave — scope-lock caught it)
  - [x] Phase 2: YAZ-862 complete (`fcd343d`, `7e416a8`, `e47c9cc`) — NUL-byte defect in agent diff caught in review; agent diffs get byte-scans now
  - [x] Phase 3: YAZ-749 complete (`003a1b8`, `2e0c1d7`) — one rename door in App, confirm sheet (overlay-scoped keys — the Enter-timing lesson), Home guard, keyboard polish. Full e2e 108/108
  - [x] Phase 4: YAZ-748 complete (`a471cd0`, `bbfb592`) — Properties panel: raw verbatim (883) + typed rows default (884). Follow-ups filed: YAZ-906 (live file feed, accepted-v1 gap), YAZ-907 (pre-existing numberedBullets e2e flake, ruled out with evidence)
  - [x] Phase 5: YAZ-852 complete (`c02f376` pipe + readAsset traversal seal, `3177131` slash item, `739b5ee` preview + offline fonts, `1ffcabf` modal + two-Reacts dedupe, `12e5f6d` relaunch/reuse e2e). Second NUL-byte catch; YAZ-868 seam source-pinned
- Now: [→] Final: merge wave branch to main, push, all Linear Done
- Wave verdict: 5 parents, 23 subissues Done (1 duplicate-closed, 2 follow-ups filed: YAZ-906 live file feed, YAZ-907 e2e flake). Suite at close: unit 1899/1899, typecheck clean, full e2e 118/118 zero flakes.
- Remaining:
  - [ ] Phase 3: YAZ-749 (title + confirm → nested rewrite gap → e2e → polish)
  - [ ] Phase 4: YAZ-748 (raw panel → typed rows → e2e → polish)
  - [ ] Phase 5: YAZ-852 (asset pipe → slash item → preview → modal → e2e → polish)
  - [ ] Final: all merged to main, pushed, Linear all Done

## Open Questions

- None blocking. New ones go to Yasin in the agreed format before implementing around them.

## Working Set

- Worktree: `.claude/worktrees/aug25-wave` (branch `worktree-aug25-wave`, based on main @ 4c62593)
- Tests: `npm test` · `npm run typecheck` · `npm run e2e`
- Linear helper: scratchpad `linear-cli.mjs` (state/comment/create)
