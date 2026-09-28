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
- **Lanes:** each lane is its own worktree `../ydocs-2131-<lane>` on branch `yaz-2131-lane-<lane>`, off `776a528`. They merge into `yaz-2131-speed` after 1A.
- Done:
  - [x] 0- Deep scope (YAZ-2132): findings, decisions, tree
- **Built and reviewed, not yet merged:**
  - **glue lane:** 1E (2172) and 1E1 flake fix (2233).
  - **rel lane:** 2A–2F (2174–2179) and 5A (2191, with the 10 s liveness escape). It also has glue merged in.
  - **pack lane:** 3A, 3B, 3C, 3D, 3E. DMG 99.6 MB, installed 269.5 MB, entry JS 1.94 MB.
  - **edit lane:** 4B (2188) and 4C (2189).
  - **perf lane:** 1B committed, and the 1C harness committed. The baseline run waits for a quiet window.
- Now: [→]
  - 1A e2e acceptance runs (quiet window, main worktree)
  - rel lane on 5B, then 5H
  - edit lane on the chevron fix, then 5C
  - pack lane on 5E, 5G, 5F, then 5D
- **Quiet-window queue:**
  1. 1A e2e
  2. perf baseline
  3. merge all lanes
  4. full `npm test` plus e2e, including the new specs `quitFlush`, `frontmatterRace`, `quitDuringStorm` and big-note
  5. benches per lane
- Remaining:
  - [ ] 1D e2e gaps + REGRESSION.md (2171), after the 1A merge
  - [ ] 4A code cache (2187). Small; the lead does it on the integration branch (`appScheme.ts` + pin).
  - [ ] 6A–6C (2200–2202), after phases 1–5 are green
  - [ ] 7A–7C, then 8A–8B

## Open Questions
- (none yet)

## Working Set
- Worktree `/Users/yasinarshad/Documents/GitHub/yaseen-docs-app-yaz-2131`, branch `yaz-2131-speed`, off main `63aeeea`.
- Scope findings: `thoughts/yaz-2131-scope/*.md`.
- Commands: `npm test` · `npm run typecheck` · `npm run e2e` · (after 1B) `npm run perf:budget` · (after 1C) `npm run perf`.
- Linear helper (session scratch): `lin.py status|comment|get`.
