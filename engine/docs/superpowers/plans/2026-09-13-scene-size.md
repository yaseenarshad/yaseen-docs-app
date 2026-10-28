# YAZ-1593 scene-size implementation

> Execution: subagent-driven-development with independent spec and quality review.

**Goal:** Support 10 MB R2 scenes and recoverable, visible size failures without changing Convex document budgets or billing.

**Architecture:** Keep compressed full-scene R2 objects and existing manifest/version protocol. One shared size policy measures UTF-8 persistence JSON; browser/server preflight and authoritative Worker checks use it. Existing pending-save and IndexedDB recovery remain the source of unsaved work. No new retry or journal system.

**Tech stack:** React/TypeScript, Convex, Cloudflare Worker/R2, Vitest, existing .excalidraw export.

Baseline: main `56ce286c041b9967a187f19be820deed2a8f7629`. Approved decision record: YAZ-1593 comment b135120d.

## A. Scope and baseline — YAZ-1594

- [x] Read approval, inspect save/read/grant/decompression/programmatic paths and current status visibility.
- [x] Pull latest main and create isolated `codex/yaz-1593-scene-size` worktree.
- [x] Run existing hook, transport, Worker and Convex scene suites before changes.
- [x] Record scope findings and ordered plan in Linear.

## B. Shared and server contract — YAZ-1595

- [x] Add failing tests for raw bytes 8,000,000 / 10,000,000 / 10,000,001, Unicode and compressed overhead.
- [x] Set `board-scenes/types.ts` raw cap 10,000,000, compressed cap 10,100,000, warning 8,000,000. Add a small pure policy module with typed size errors recognized across local and Convex boundaries.
- [x] Preflight server `convex/boardSceneTransport.ts` before deflate; return structured Convex size failures from `boardSceneModel.ts`. Keep invalid metadata errors distinct.
- [x] Remove only the R2-transform legacy size assertions in `programmaticBoardEdits.ts` and `programmaticEdits.ts`; retain actual legacy persistence guards.
- [x] Test Worker bounded body/decompression, hashes, accepted 10 MB scenes and >900 KB programmatic/history paths. Do not weaken authorization, object integrity or expected versions.
- [x] Verify readers, cloning/import/migration never route a large scene into a legacy document.

## C. Browser persistence and recovery — YAZ-1596

- [x] Write failing hook/transport tests: over-limit events produce no upload, lifecycle flush stays blocked, pending/journal survive, shrink resumes saves, transient retries still work.
- [x] Preflight `boardScenePersistence.ts` before compression. Bound read decompression where needed.
- [x] Integrate shared policy into `useCloudBoard.ts`: measure sanitized JSON, retain and journal pending edits before blocking, cancel timers, guard central flush and structured server failure for unchanged content. Clear blocked state only for changed valid content or deliberate discard/route change.
- [x] Keep journal degradation visible and risky-close protection active. Never claim Saved while pending oversized edits exist.
- [x] Add compact `CloudSceneSizeNotice.tsx` and styles; render outside desktop-only status guard in `App.tsx`. Show size/limit, near-limit warning or unsaved failure, and current-editor export. Reuse `saveAsJSON`; cancellation isn't success, export doesn't clear pending work, hosted-content portability isn't overstated.
- [x] Test initial/import/clone paths and make failed migration visible/recoverable rather than submitting a large legacy save.

## D. Polish — YAZ-1597

- [x] Record a concrete punch list after reading the full diff.
- [x] Finish short accessible copy, compact mobile layout, minimal state, no duplicate policy/retry/journal and no misleading constants/comments.
- [x] Independently review spec, then quality; fix all in-scope findings.

## E. Proof and delivery — YAZ-1598

- [x] Run focused suites, full relevant app/Convex/Worker suites, typecheck, changed-file lint/format and production build. Record pre-existing failures separately.
- [ ] Profile representative 10 MB scene with overlapping Worker uploads and browser hashing/render behavior. Escalate if memory/CPU budget cannot support the approved capacity.
- [ ] Exercise desktop/mobile warning, oversized recovery/export, save/reload/share/history/clone/import/programmatic edits and two-tab handoff using disposable boards.
- [ ] Commit/push reviewed changes, merge current main safely. Deploy compatible Worker/backend readers before enabling larger browser saves; no release or billing changes.
- [ ] Verify deployed IDs and production save/read-back. Record rollback boundary (never roll back to 900 KB readers after saving larger objects). Mark child/parent Done only with evidence.

## Commands

`yarn test:app --run excalidraw-app/cloud/useCloudBoard.test.tsx excalidraw-app/cloud/boardScenePersistence.test.ts worker/boardScenes.test.ts`

`yarn test:convex --run convex/boardScenes.test.ts`

`yarn test:typecheck`

`yarn build:app`

Additional focused test files are run as added. No production mutations until compatibility/resource checks pass.
