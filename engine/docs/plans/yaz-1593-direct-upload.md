# YAZ-1593: verified direct scene uploads

Approved decision record: https://linear.app/growprofit/issue/YAZ-1593/scene-size-limit-fix#comment-dcd0118c

## Contract

Browser → checksum-bound private R2 staging PUT → Convex Node validation of actual bytes → conditional R2 copy → internal atomic manifest commit.

- Keep raw/compressed/warning limits at 10,000,000 / 10,100,000 / 8,000,000 bytes; legacy document limit stays 900,000.
- No scene bodies in Convex documents, function arguments/returns or logs. Node reads R2 directly. No CPU-heavy uploads through Workers Free.
- Staging prefix expires after one day asynchronously. Final keys are server-owned and immutable to clients. Copy preserves application metadata, not the provider checksum header.
- Public caller-ETag commit is retired. Old clients get upgrade-required and retain unsaved journal/export recovery.
- No plan upgrade, billing change or release. Production remains unchanged until dev proof passes.

## Execution units

1. **YAZ-1600 backend:** `convex/boardSceneR2.ts` owns signing, bounded validation, conditional copy and exact-key deletion. `boardSceneFinalization.ts` owns authenticated grant reservation and atomic commit; the Node action only coordinates these boundaries. Extend existing grant rows with staging and finalization/cleanup state, keeping old rows readable. A claimed grant cannot be reused or abandoned into deletion while its finalizer may still copy. Durable expired-grant cleanup runs after the maximum action lifetime and survives provider failures. Server producers use the same direct upload and finalization path. Retire the old Worker upload route and preserve old/new metadata reads.
2. **YAZ-1601 browser:** wire small prepare/finalize actions, PUT directly to the exact signed URL, preserve version conflicts, no-op detection, warnings and recovery. Never infer Saved from PUT alone. All readers use strict scene decoding.
3. **YAZ-1599/1598 proof:** provider integration, real Node/runtime memory/latency and request cost, exact size boundaries, entropy/geometry, malformed payloads, concurrent tabs, failure/replay/delete races, CORS and prefix lifecycle. No provider mocks counted as deployment evidence.
4. **YAZ-1602 polish:** scope a concrete punch list; remove redundant flows and dead legacy upload code; review spec then quality, resolve findings and rerun acceptance tests.
5. **YAZ-1598 rollout:** deploy and verify Worker staging-prefix protection and compatible readers first; enable the backend second, then the frontend. Retain large readers on rollback. Verify merged commit and actual deployments, disposable production save/reopen only. Production credentials/configuration remain a gate.

## Test-first checkpoints

- An authorized caller cannot commit with a made-up ETag.
- New grants contain separate staging/final keys; legacy upload resolution refuses them.
- Only one finalizer claims a grant; retries cannot mutate its final key, committed retries return the original receipt.
- Abandon, board deletion, version conflict and expiration cannot promote a manifest or lose final-object cleanup work.
- Invalid UTF-8/JSON, hash/size mismatch, bomb, missing object and failed conditional copy never commit.
- Signed URL/body/header replay remains constrained; copied-object reads work with lowercase S3 metadata and existing camelCase metadata.
- UI preserves pending work across failed finalization and upgrade-required; successful PUT without commit never clears recovery.

Run focused Vitest tests first, then all Convex/Worker/cloud suites, TypeScript, lint and production build. Record actual outcomes and outstanding gates in Linear, not just code completion.

## Deployment prerequisites

- Pin Cloudflare Personal account `06ed69083fae875c626d37f9c05405a3`. Never reuse credentials from the separate GrowProfit account.
- Use separate bucket-scoped Object Read & Write credentials per environment. Set the four `BOARD_SCENE_R2_*` Convex environment variables and the matching `BOARD_SCENE_WORKER_ORIGIN`. Keep credentials out of source, logs and browser bundles. The temporary dev credential is not a production credential.
- Preserve existing lifecycle rules; add asynchronous one-day expiration only for `board-scene-uploads/`, never `board-scenes/`.
- CORS permits only each environment's exact application origins and `PUT`; allow `content-type`, `if-none-match`, `x-amz-checksum-sha256` and the signed `x-amz-meta-` fields: `diagramid`, `version`, `rawsize`, `rawsha256`, `compressedsha256`, `encoding`, `semanticsha256`. No public bucket access or exposed ETag is required.
- Independently verify CORS preflight: allowed origin succeeds, unrelated origin is denied. Verify generic asset GET/HEAD cannot access staging, and the retired upload POST returns 426.
- Do not deploy protocol 4 before these prerequisites. Old tabs must preserve recovery and request refresh, not silently report Saved.
