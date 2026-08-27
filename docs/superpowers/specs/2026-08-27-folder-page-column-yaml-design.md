# Folder-page column YAML propagation design

**Issue:** YAZ-999
**Approved:** 2026-08-27
**Base:** `main@608395f26b15a1d3519bd6748c5308c2de8fa455`

## Outcome

A folder page's declared columns become real YAML keys on its direct member pages. Existing values remain page-owned: declarations and memberships may appear, disappear, or change without overwriting, migrating, or deleting those values.

## Architecture

Use one hybrid, idempotent reconciliation invariant:

1. `FolderPageContents` reconciles its declared columns whenever its declaration or direct-member snapshot changes.
2. A confirmed Topics move invokes the same reconciliation operation after writing `folder_pages`, because its target folder page may not be open.
3. New-page scaffolding and existing-page reconciliation share one empty-value rule.
4. Every existing-page write rechecks the latest file bytes. Index state is only a fast prefilter; it is never permission to overwrite.

This leaves `PropertiesMenu`, ordinary `setColumns`, and outline diffing structurally unaware of backfill. Their existing source-of-truth writes cause the invariant to run. It also leaves all removal paths untouched.

## Data and ownership rules

- Column identity is the exact frontmatter key. There are no column IDs or aliases.
- Scalar kinds initialize to `null`; `list` and `multi-link` initialize to `[]`.
- A key that is present in the latest file bytes always wins, including `null`, `false`, `0`, `''`, arrays, scalars, and values whose type disagrees with the local declaration.
- Direct members are reconciled. Descendants are not.
- Two folder pages declaring the same key share the page's one raw value, even when their local declared types differ.
- Retyping never migrates values.
- Removing a declaration or any/all memberships never deletes ordinary page properties.
- Rejoining immediately reuses the retained value.
- A physical file move has no property effect.

## Sequencing and failures

The existing settings or membership write remains the source of truth and completes first. Reconciliation follows. All eligible missing-key writes are attempted and failures are aggregated into the existing folder-page or sidebar error surface.

A partial failure does not roll back source-of-truth state and does not overwrite or delete data. Still-missing keys are retried on the next relevant snapshot or folder-page open. External/manual declaration edits follow the same rule when the folder page is next open.

Conflict handling is missing-aware: after a write conflict, reread the file and check presence again. If another writer added the key, return without writing.

## Component boundaries

- `client/src/views/scaffold.ts`: canonical empty value for a column declaration.
- `client/src/views/writeProperty.ts`: conflict-safe conditional one-key writer.
- `client/src/views/folderPageColumns.ts`: missing-key selection, writes, and failure aggregation.
- `client/src/views/FolderPageContents.tsx`: open-folder reconciliation and error reporting.
- `client/src/sidebar/topicsMove.ts`: closed-target reconciliation after membership move.
- `client/src/sidebar/TopicsTree.tsx`: supplies the target folder page's declarations.
- `desktop/e2e/folderPageColumns.spec.ts`: on-disk propagation proof around the shared cell-edit step; YAZ-1030 owns that step's selection/activation gesture.
- `docs/CONTRACTS.md`: durable lifecycle contract.

## Verification contract

Tests must prove missing-only writes, conflict preservation, correct empty values, direct-member filtering, all-attempted failure aggregation, open-folder reconciliation, closed-target moves, retype/removal retention, rejoin, multi-parent exact-key reuse, idempotency, and external-edit repair.

The shared E2E replaces the former assertion that declaration leaves every member byte-identical: add backfills missing keys, while retype remains byte-identical after that backfill. YAZ-999 must not lock the adjacent cell-activation gesture; YAZ-1030 owns its selection/double-click contract.
