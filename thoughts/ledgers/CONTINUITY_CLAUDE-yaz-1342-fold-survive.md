# Continuity — YAZ-1342: folds survive external/AI edits

## Goal

- Collapsed bullets and headings survive an external/AI edit to the open file; `yaseendocs.json` fold state is never erased by a reload. Done = unit + one pointed e2e green, merged to main, Linear tree closed with evidence.

## Constraints

- Approved decision (locked, YAZ-1344 comment): Option 1 — live seed getter `seedCollapsedKeys?: () => ReadonlySet<string>` replacing frozen `initialCollapsedKeys`. Do not re-decide.
- Contract tests are Fable-owned and must pass unchanged: `client/src/editor/outline/foldSurvivesReload.test.ts`, `desktop/e2e/foldExternalEdit.spec.ts`.
- Accepted v1 boundary: a fold whose own line is reworded expands (content-hash identity).
- Elegant-minimal: no drive-by refactors; match codebase voice.

## Key decisions

- Seed getter over setMarkdown capture/restore (race still writes `[]`) and over non-flush replaceAll (breaks autosave-baseline/conflict contracts). Rationale in YAZ-1343/YAZ-1344 comments.

## State

- Done:
  - [x] Scope (YAZ-1343, findings in comments, issue Done)
  - [x] Contract tests written first, unit RED confirmed on pre-fix code (2 failed / boundary passed)
  - [x] YAZ-1344 implementation (Opus 5; Fable line-read the diff, double NUL scan clean, full suite 3126/3126 + typecheck verified independently)
- Now: [→] YAZ-1345 e2e proof (single `foldExternalEdit` spec against the built app)
- Next: YAZ-1346 polish pass evidence, PR → merge
- Remaining:
  - [ ] Merge to main via PR, Linear closeout + handoff comments
  - [ ] Release bump 0.9.0 → 0.9.1, install locally

## Notes

- `package-lock.json` 0.8.0→0.9.0 sync rides along: pre-existing gap (the 0.9.0 release bumped package.json only); this makes the lockfile true.

## Working set

- Worktree: `/Users/yasin/Documents/GitHub/yaseen-milkdown-yaz1342`, branch `worktree-yaz-1342-fold-survive`
- Files: `client/src/editor/Editor.tsx` (216/223), `client/src/editor/outline/outlineFolding.ts` (49/254/265), `client/src/editor/outline/headingFolding.ts` (58/258/269), callers in 4 test files, `docs/CONTRACTS.md` (~179)
- Commands: `npx vitest run "client/src/editor/outline/foldSurvivesReload.test.ts"`, `npm run typecheck`, e2e single spec: `npx playwright test --config desktop/e2e/playwright.config.ts "foldExternalEdit"` (build first)
