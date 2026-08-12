# Private R2 Board Scene Persistence

## Status

Approved in chat and recorded in Linear on August 11, 2026.

- Parent: [GRO-1420](https://linear.app/growprofit/issue/GRO-1420/move-board-scene-persistence-from-convex-to-private-r2-storage)
- Deep scope: [GRO-1421](https://linear.app/growprofit/issue/GRO-1421/1420a-deeply-scope-and-lock-the-private-r2-scene-architecture#comment-40a31f9c)
- Incident history: [GRO-1296](https://linear.app/growprofit/issue/GRO-1296/runaway-issue)

## Problem

The idle save runaway is fixed, but normal Board editing still moves full scene documents through Convex. A representative changed save used about 2.36–2.39 MB of Convex database bandwidth for an approximately 600 KB scene. A snapshot-writing save used about 2.94 MB.

The cost is amplified because the current path:

1. returns full `sceneJson` from a reactive open-Board query;
2. reads the current full `diagramContents` row during save;
3. reads the newest full `diagramSnapshots` row to decide whether a snapshot is due;
4. replaces the full scene document; and
5. invalidates open-Board subscriptions after the write.

Legitimate heavy editing can therefore reach a usage shutdown even without an idle loop.

## Goals

- Store complete compressed Board scenes and new snapshot payloads in the existing R2 bucket.
- Keep Convex scene reads and writes limited to small coordination metadata.
- Reduce a normal migrated save to at most 50 KB of Convex database I/O and at least 95% below the observed baseline.
- Preserve owner and shared opens, save/reload, history and restore, Board deletion, previews, programmatic edits, same-Board multi-tab handling, and binding-echo suppression.
- Migrate existing Boards without an eager full-content backfill or an outage.
- Keep stale clients from touching large legacy documents after cutover.

## Non-goals

- Delta chains, operation logs, or element-per-row persistence.
- CRDTs or simultaneous multi-user editing.
- A new storage provider or bucket.
- Public scene URLs.
- A permanent Convex limit increase.
- Changes to image, preview, or presentation-animation storage contracts.

## Chosen design

Each committed Board version is one complete, zlib/deflate-compressed, immutable R2 object. Convex stores a small manifest pointing to the current object and small grants authorizing upload, read, and cleanup operations.

This keeps the persistence model simple: opening a version requires one object fetch, and recovery never needs to replay a delta chain.

## Data model

### `diagramSceneManifests`

One row per migrated Board:

- `diagramId`
- `version`
- `objectKey`
- `encoding` (`deflate-v1`)
- `rawSize`
- `compressedSize`
- `rawSha256`
- `compressedSha256`
- `semanticSha256`
- `etag`
- optional `lastSnapshotAt`
- `createdAt`
- `updatedAt`

The row is deliberately small and contains no scene bytes.

### Scene grants

Use separate bounded upload and read grant tables. Each grant records only the minimum authorization and integrity contract required by the Worker:

- unguessable token;
- Board, owner, expected version, and purpose;
- immutable object key chosen by trusted backend code;
- encoding, sizes, hashes, and optional ETag;
- owner or shared access context;
- creation, expiry, and registration state.

Expired grants are cleaned in bounded batches.

### `diagramSnapshots`

Widen the existing table so a row contains either:

- legacy `sceneJson`; or
- new R2 object metadata matching the manifest integrity fields.

New snapshots are metadata-only. Snapshot timing moves to the current manifest so normal saves do not read the latest snapshot row.

### Legacy tables

`diagramContents` remains readable only when no manifest exists. Once a manifest exists, normal open/save paths must not query it. Legacy current rows remain temporarily during the observation window, then are removed in verified batches. Legacy snapshots migrate on restore or retention instead of through an eager content backfill.

## Private Worker data plane

### Upload

The browser sends a bearer upload token and compressed bytes to a dedicated scene endpoint. The Worker:

1. resolves the token through a Convex HTTP route;
2. validates content type, encoding, compressed length, and compressed hash;
3. safely decompresses the payload;
4. enforces the 900 KB raw scene ceiling;
5. validates the raw hash and basic scene JSON shape;
6. writes the object to the trusted key from the grant; and
7. returns the R2 ETag.

Any partial or mismatched upload is deleted before an error is returned.

### Read

The client first creates an owner or shared read grant through Convex, then fetches the capability path from the Worker. The Worker revalidates the grant, Board access, registered object metadata, size, ETag, and checksum before returning the compressed object.

Responses use private caching, `nosniff`, and `no-referrer`. The object key is never returned to an untrusted caller. The generic public image route rejects the Board-scene namespace.

### Delete

Cleanup consumes a bounded capability for exact scene keys or a trusted Board-scene prefix. Deletion is idempotent. Failed cleanup is retryable and does not roll back an already durable scene commit.

## Save protocol

The client performs one exclusive pipeline under the existing same-Board tab coordinator:

1. sanitize the scene;
2. calculate exact and binding-insensitive semantic SHA-256 values;
3. compress once;
4. create an upload grant with the current expected version;
5. upload and receive the ETag;
6. atomically register the object in Convex; and
7. delete an orphan or superseded object when instructed.

The commit succeeds only when owner, grant, ETag, hashes, and expected version still agree. A matching semantic hash is an idempotent no-op before upload.

A real edit increments the version and updates the manifest and Board summary. If a snapshot is due, the previous immutable object becomes the snapshot. If not, it becomes cleanup work.

The save protocol version is bumped. Previous clients receive `upgrade-required` before authentication or database reads and do not retry the call as a normal failure.

## Save timing

- trailing debounce: 10 seconds after the latest local change;
- maximum pending interval: 60 seconds after the first unsaved local change;
- immediate flush: Board switch, navigation, `pagehide`, hidden-tab transition, and existing explicit lifecycle flushes.

Only a committed version updates Saved status, the accepted scene baseline, the cross-tab completion announcement, and preview scheduling.

## Open and reactive update protocol

The reactive Convex query returns Board summary, access, and small manifest metadata. It may return a legacy scene only when no manifest exists.

For a manifest version, the client:

1. creates an authorized read grant;
2. fetches the exact compressed R2 object;
3. verifies and decompresses it;
4. ignores completion if the route generation or requested version changed;
5. applies the scene; and
6. reuses the existing server-echo and merge classification.

The prior canvas remains safe until a complete scene is available. Network, R2, decompression, or parsing errors display a retryable error without advancing the accepted version.

## Existing Board migration

An authenticated owner opening a legacy Board receives its Convex scene once. The client immediately uploads and registers it as an R2 manifest at the same version. Migration does not increment the version or alter the user-visible modified time.

A shared viewer may read a legacy Board but cannot migrate it. The next owner open performs migration.

After a manifest exists, all later opens and saves use the R2 path. The legacy row is retained during the observation window and removed only after verified R2 read-back.

## History and restore

History lists legacy and R2 snapshot summaries in the existing order.

Restoring an R2 snapshot privately downloads it and commits it as a new current R2 version. The displaced current version is force-preserved as a snapshot. A legacy snapshot follows the same flow after one legacy read.

The existing 30-day retention window and minimum 100-snapshot floor remain. Retention deletes snapshot metadata and its R2 object through idempotent cleanup.

## Programmatic edits

`updateTextElement` and `patchElements` remain supported through authenticated Convex actions:

1. authorize and read the small current manifest;
2. privately fetch and decompress the current R2 scene;
3. apply the existing validated scene transformation;
4. force-preserve the current version as a snapshot;
5. upload and atomically commit the replacement; and
6. perform cleanup.

Input and result shapes remain unchanged. Callers move from mutation transport to action transport because a Convex mutation cannot fetch R2. The repository has no current UI callsite, but API regression coverage is required.

## Sharing, previews, and deletion

- Shared capabilities are valid only while the exact share token remains enabled. Worker validation checks revocation.
- Board list summaries never contain object keys or scene contents.
- Preview generation remains tied to a committed version and continues using the existing image route.
- Board deletion removes manifests, grants, snapshot metadata, and schedules deletion of all Board-owned scene objects. Repeated deletion is safe.

## Rollout and rollback

1. Deploy the widened schema, Convex grants/functions, private Worker routes, and dual-read support before the client uses them.
2. Deploy the new client and protocol together.
3. Migrate one representative large Board and verify upload, commit, read-back, reload, and usage.
4. Enable normal owner migration.
5. Remove legacy current rows only after the observation window and explicit verification.

After the first manifest commit, production must retain an R2-capable read path. A rollback may disable new uploads, but must not deploy an old build that cannot open migrated Boards.

Stop rollout if versions diverge, an object fails read-back, shared revocation can be bypassed, legacy Boards cannot open, old clients read/write large content, or per-save Convex I/O misses the cost target without explanation.

## Test and production proof

Test-first coverage must include:

- Worker upload/read/delete integrity and private-route isolation;
- Convex grants, authorization, semantic no-ops, conflicts, commits, snapshots, cleanup, and legacy fallback;
- client compression, hashes, debounce, maximum interval, flushes, route races, conflicts, retry, stale clients, binding echoes, and migration;
- owner/shared open, share revocation, history restore, programmatic edits, previews, Board deletion, and mixed legacy/R2 states; and
- complete typecheck, zero-warning lint, production build, and relevant app, Convex, and Worker suites.

Production proof records the commit and deployment versions and covers:

- one normal changed save with before/after function usage;
- 10-second trailing and 60-second maximum saves;
- 30 minutes idle after the final intentional save;
- same-Board two-tab handoff;
- owner and shared read/revocation;
- new and legacy history restore;
- programmatic text and patch edits;
- deletion cleanup and object inaccessibility; and
- daily/monthly Convex usage and unchanged 1 GB warning / 2 GB daily shutdown.
