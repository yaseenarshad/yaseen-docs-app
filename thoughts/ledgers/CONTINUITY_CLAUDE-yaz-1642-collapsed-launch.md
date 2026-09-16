# CONTINUITY — YAZ-1642 sidebar trees start collapsed on launch (Files and Topics)

## Goal
- Both sidebar trees open fully collapsed on every launch, last tab restored; in-session memory and cross-window sharing unchanged. Linear: YAZ-1642 (parent) → 1644 scope · 1645 store · 1646 sidebar · 1647 e2e · 1648 verify · 1649 polish.
- Done = 1645–1649 Done with comments, PR merged to main, handoff on every issue, NO release cut.

## Constraints
- Linear-Simpler; parent + child In Progress / Done as work moves. **NO Playwright on this machine** (Yasin, 2026-09-16): it takes over the screen. Migrate specs by reading + typecheck only; verify via unit suite and the dev app on the isolated profile. No new e2e spec (descoped). No release unless Yasin says so.

## Key Decisions (🔒 2026-09-16, diffs on YAZ-1644)
- D1 `store.ts`: `sanitizeFolder` returns `expanded: []` / `topicsExpanded: []`; `toDisk` strips both before `atomicWrite`. Session lists ride the in-memory store for cross-window sync.
- D2 `Sidebar.tsx`: `restoredFile = useRef(activeFile)`; the `expandTo` effect skips while `activeFile === restoredFile.current`, clears the ref on the first change. Idempotent under double-effects.
- D3 no settings toggle. D4 Uncategorized's inner folds untouched.

## State
- Done:
  - [x] 1- Scope (YAZ-1644): findings, D1–D4, demo result as comments
  - [x] 2- Store (YAZ-1645) `1dfece1`: diff + 4 tests rewritten + 1 round-trip test; types docstring; README line
  - [x] 3- Sidebar (YAZ-1646) `10f8782`: TDD — 2 of 3 new tests red on main, 191/191 green after; StrictMode-safe ref guard
  - [x] 4- e2e (YAZ-1647) `db44d99`: `expandDirs` helper, 8 seeds migrated, topics step 4 flipped, `collapsedLaunch.spec.ts` (ran once by an agent before the no-Playwright rule: all 4 screenshots; bible step 5 quit-timeout flake flagged)
  - [x] 5- Verify (YAZ-1648): typecheck clean, vitest 3967/3967, dev-app profile check; e2e NOT run (rule)
  - [x] 6- Polish (YAZ-1649): agent comments trimmed, CONTRACTS `folders[root]` + expand-all rows amended, spec header shortened, no unused symbols, no eslint in repo
- Now: COMPLETE — PR merged to main, worktree/branch/demo removed
- Next: none. Learning: an implementation agent will run headed Playwright unless told not to — say it in the prompt. `expect.poll` with the click inside it is the safe idiom for a toggling row (checks before every click).

## Open Questions
- none

## Working Set
- Everything on main; worktree, branch and demo vault removed
- Tests: `npm run typecheck` · `npx vitest run <files>` · `npm run e2e` (headed)
