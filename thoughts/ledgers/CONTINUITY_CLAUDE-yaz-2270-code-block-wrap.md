# YAZ-2270: code blocks wrap and follow Appearance

## Goal
- Every code block wraps long lines (no sideways scroll) and is readable in light and dark.
- Done = merged to main, Linear tree closed, Yasin approved the Desktop demo, release cut with notes.

## Constraints
- No Playwright runs (Yasin). Proof = vitest + hands-on demo in an isolated profile.
- No release until Yasin's demo sign-off; smallest version bump.
- Size budget ratchet: lowering is automatic, raising needs Yasin's OK.

## Key Decisions (locked as comments on YAZ-2270)
- D1: CodeMirror `EditorView.lineWrapping` via `featureConfigs[CodeMirror].extensions` in `createCrepe.ts`.
- D2: per-language "normal text" look DROPPED (YAGNI).
- D3: `overflow-x: auto` rule in `app.css` stays.
- D4: app-owned code theme (`codeTheme.ts`) on `app.css` variables replaces One Dark.
- Active-line tint only in the focused block (found in the demo: every block at rest showed a band on line 1).
- Polish: One Dark default removed from `crepe.ts` (dead once D4 landed); app tokens reused where they fit.

## State
- Done:
  - [x] 1 Scope (YAZ-2271)
  - [x] 2 Wrap (YAZ-2272)
  - [x] 3 Colours (YAZ-2273)
  - [x] 4 Polish and anti-slop (YAZ-2274, 4A YAZ-2275, 4B YAZ-2276)
  - [x] 5 Verify in the real app (YAZ-2277): Yasin approved the Desktop demo on 2026-09-30
- Now: closed. Merged to main; release and notes follow as their own step.

## Open Questions
- None. Yasin OK'd raising `rendererEagerCssBytes` 137,574 → 137,913 (+339 B) on 2026-09-30.

## Working Set
- Worktree: `../yaseen-docs-app-yaz-2270`, branch `yaz-2270-code-block-wrap`
- Files: `client/src/editor/{codeTheme.ts,codeBlock.test.ts,createCrepe.ts,crepe.ts,crepe.test.ts}`, `client/src/app.css`, `client/package.json`, `tools/perf/budget.json`, `docs/CONTRACTS.md`
- Checks: `npm run typecheck && npm test && npm run build && npm run perf:budget:ci`
