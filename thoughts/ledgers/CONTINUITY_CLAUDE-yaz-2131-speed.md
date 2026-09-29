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
- Done:
  - [x] 0- Scope · 1- Safety net (1A–1E, 1E1, 1D1) · 2- Reliability · 3- Smaller · 4- Launch/open · 5- Smoother (incl. 5C1, 5A1, 5D1) · 6- Refactor (6A–6C)
  - [x] 7A first pass: the table is posted. Yasin approved the `mainBundleBytes` raise (482,730).
  - [x] 8A audit (19 must / 52 should / 57 nit), then 8B across 4 code lanes plus the docs pass.
  - Gates at `72e468c`: `npm test` 4,674 green, typecheck clean, e2e 295/295 ×3 (at `1ec0b02`).
- Now: [→]
  - 7B: packaged-app pass on the final package
  - 7A re-measure: the 5D1/5A1 rows, needing a quiet machine
- Next:
  - 7C: rebuild `desktop/out` at the final HEAD, then launch the demo
  - the closing comments on YAZ-2131, 7A, 8B
  - leave the worktrees in place for Yasin's testing
  - **no merge to main**

## Open Questions
- 🔔 Needs Yasin (posted on YAZ-2131): N1 open the upstream Milkdown PRs? N2 keep the YAZ-2238 tooltip patch?
- Future YAZ-2237: undo grouping across a tab switch predates this project. Out of scope.

## Working Set
- Worktree `/Users/yasinarshad/Documents/GitHub/yaseen-docs-app-yaz-2131`, branch `yaz-2131-speed`, off main `63aeeea`.
- Scope findings: `thoughts/yaz-2131-scope/*.md`.
- Commands: `npm test` · `npm run typecheck` · `npm run e2e` · (after 1B) `npm run perf:budget` · (after 1C) `npm run perf`.
- Linear helper (session scratch): `lin.py status|comment|get`.
