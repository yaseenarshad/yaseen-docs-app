# CONTINUITY — YAZ-2131 Docs App: Speed & Optimization

## Goal
- Yaseen Docs smaller, faster, smoother and more reliable as a pure refactor. Targets are in the YAZ-2132 comment "Deep scope 1 of 3" (DMG ≤ 100 MB, .app ≤ 270 MB, launch ≤ 390 ms, 5k bullet note ≤ 1.5 s, typing ≤ 20 ms, storm ≤ 0.5 s CPU, watcher ≤ 120 ms with 0 fds, no lost edit on ⌘Q, no false conflict bar).
- Done = every Linear child Done, `npm test` + typecheck + `npm run e2e` + `perf:budget` green, 7A table posted, 7C demo handed over. Then Yasin tests the worktree. **No merge to main, no release, until Yasin confirms.**

## Constraints
- **Improvement only:** no feature or behaviour lost, degraded or changed. When a win conflicts with a feature, the feature wins and the conflict goes to Yasin.
- The locked decisions D1–D10 are in the YAZ-2132 comment "Deep scope 2 of 3". The scope focus and machine-safety rules are YAZ-2131 comments.
- The drawing component is out of scope: it keeps working and is never optimized.
- Playwright is ON for this project (Yasin: "we can run playwright"), but only after 1A's `YASEEN_DOCS_E2E` protocol guard lands. Before that, e2e runs hijack `yaseendocs://`.
- Every app launch uses an isolated `--user-data-dir` plus `YASEEN_DOCS_USER_DATA_DIR`, with scratch vaults only.
- Commits carry no Claude attribution (the user's `/commit` rule), in the repo style `feat(area): YAZ-#### …`.
- Pushing the branch as a backup is fine. **Never push to main.**
- New design or architecture questions go to Yasin in the problem → options → rec → diff → after format.

## Key Decisions
- D1 locale trim · D2 vendored Milkdown hunk + app-side memo + upstream PR (opening the PR needs Yasin's go) · D3 recursive fs.watch + conformance + chokidar polling fallback, 100 ms settle · D4 keep full snapshots · D5 tabs stay mounted + content-visibility · D6 keep serialization · D7 Windows as-is (Future) · D8 CI gates unit/typecheck/build/budget, e2e local · D9 IPC CONTRACT table · D10 Sidebar split last.

## State
- CLOSED 2026-09-29:
  - Merged to main via PR #81 (`935df93`), after Yasin tested the demo ("ok that's good it worked").
  - Released as **v0.9.28** (the notes carry the before/after table) and installed on Yasin's Mac.
- Done: phases 0–8 and every child. Added along the way: 1E1, 1D1, 5C1, 5A1, 5D1, 7B1.
- Final gates: `npm test` 4,676 green, typecheck clean, e2e 295/295 ×3, `perf:budget` green, PR CI green.
- Cleaned up: all lane worktrees and `yaz-2131-*` branches (local and remote) removed, and the demo rig trashed.
- The upstream Milkdown PRs are open, pending review:
  - `Milkdown/milkdown#2484`: the list-item caret restore (D2)
  - `Milkdown/milkdown#2485`: the tooltip throttle (YAZ-2238)
  - When released, drop our vendored hunks (Future YAZ-2213).

## Open Questions
- Resolved 2026-09-29: N1 open the upstream PRs (done: #2484, #2485), N2 keep the tooltip patch, N3 keep the 100 ms settle.
- Future YAZ-2237: undo grouping across a tab switch predates this project. Out of scope.

## Working Set
- Worktree `/Users/yasinarshad/Documents/GitHub/yaseen-docs-app-yaz-2131`, branch `yaz-2131-speed`, off main `63aeeea`.
- Scope findings: `thoughts/yaz-2131-scope/*.md`.
- Commands: `npm test` · `npm run typecheck` · `npm run e2e` · (after 1B) `npm run perf:budget` · (after 1C) `npm run perf`.
- Linear helper (session scratch): `lin.py status|comment|get`.
