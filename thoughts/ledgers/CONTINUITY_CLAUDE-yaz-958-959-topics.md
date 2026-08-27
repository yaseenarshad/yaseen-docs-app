# Continuity — YAZ-958 (create race) + YAZ-959 (Topics drag-and-drop)

## Goal

- YAZ-958: a page created under a folder page appears in the Topics tree immediately, every time — proven by a deterministic unit repro and an e2e over all three create doorways.
- YAZ-959: drag any page/folder row in Topics onto a folder-page row, see the target highlight, confirm in an in-app sheet, and the move lands as ONE `folder_pages` write. Nothing moves without the confirm.
- Done = both parents Done in Linear, all subissue evidence attached, branch merged to main, suites green on main.

## Constraints

- Simpler/combined/minimal wins (Yasin's standing ruling). No new dependencies, native HTML5 DnD (house idiom).
- Membership is child-declared frontmatter; order belongs to the folder page outline — drag never writes the outline document (YAZ-964 seed guard).
- Descent only via `guardedChildren` (the law). One mutation door: `writeProperty` under the click rule.
- Tests are overseer-owned and written first; implementation follows them. Opus 5 implements from pinned briefs; every diff byte-reviewed.

## Key Decisions

- D1 (YAZ-958): `getIndex` drains in-flight watcher scans — fix at the root, extends the file's own cold-start principle. Landed `1303eb3`.
- D2 (YAZ-959): drop = move, confirm-gated. AMENDED in scope: the move is ONE atomic `folder_pages` write (filter old parent, append new), because two `applyBelonging` calls compute from one stale snapshot and clobber each other.
- D3: native HTML5 drag; `tree__row--drop` highlight class reused from `Tree.tsx`.
- D4: targets = folder-page rows only; reject self / current parent / own descendants. No reorder (outline owns order), no root-drop, no multi-select, no alt-drag in v1.
- Scope locks (YAZ-989): no optimistic overlay in v1 (the 958 fix makes the echo reliable); no auto-expand on drag-hover; no edge-scroll; e2e drags via Playwright `dragTo` (board.spec.ts:61 proves it).
- The "from" of a move comes from the dragged ROW's parent in the tree (a page renders under every parent), never from `folderPagesOf`.

## State

- Done:
  - [x] YAZ-985 A- scope: race pinned by `liveDrain.test.ts` (fails pre-fix)
  - [x] YAZ-986 B- fix: `live.ts` inFlight drain — `1303eb3`, 73/73 vaultIndex green
  - [x] YAZ-989 A- scope: five questions locked, D2 amended (one-write move)
- Now: [→] YAZ-987 C- e2e (Opus drafting) · [→] YAZ-990 B- engine (Opus implementing against `topicsMove.test.ts`)
- Next: YAZ-991 C- gesture (contract tests `ConfirmMove.test.tsx` already written)
- Remaining:
  - [ ] YAZ-992 D- e2e drag proofs
  - [ ] YAZ-988 D- polish (958)
  - [ ] YAZ-993 E- polish (959)
  - [ ] Merge to main, suites green on main checkout

## Open Questions

- UNCONFIRMED: which cause fired in Yasin's real vault (race vs basename collision). The race is real and fixed; if the symptom ever recurs with the page under Uncategorized, that's the collision (`engine.ts:105-116`).

## Working Set

- Branch: `worktree-yaz-958-959-topics` (worktree at `.claude/worktrees/yaz-958-959-topics`)
- Files: `desktop/src/main/vaultIndex/live.ts`, `liveDrain.test.ts`, `client/src/sidebar/topicsMove.{ts,test.ts}`, `ConfirmMove.{tsx,test.tsx}`, `TopicsTree.tsx`, `desktop/e2e/createUnderFolder.spec.ts`, (D-) drag e2e spec
- Tests: `npx vitest run <file>` per file; `npm test`; `npm run e2e` (build first). Known in-worktree artifacts: vite denies hoisted CSS in 3 client test files — they pass on the main checkout.
