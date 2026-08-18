# Docs rollout and rollback

Docs uses one authoritative mode in each layer: `off`, `read-only`, or `on`. Production is committed as `off`; development is `on` against `honorable-possum-626` and `yaseen-excalidraw-assets-dev`.

## Safe production sequence

1. Confirm the merged commit passed typecheck, lint/format, Convex/Worker/app tests, the production build, and the Board persistence smoke suite.
2. Deploy Convex schema/functions with `YASEENDRAW_DOCS_MODE=off`.
3. Deploy the Worker with `DOCS_MODE=off` and the existing `yaseen-excalidraw-assets` binding. Do not create or move any bucket/object.
4. Deploy the frontend with `VITE_DOCS_MODE=off`.
5. Smoke existing Board open/edit/save/share, previews, assets, and verify zero Doc queries/mutations/R2 traffic.
6. In one coordinated release, change Convex, Worker, and frontend to `on`. Create one controlled Doc, save/reload it, upload/read one attachment, share its Board read-only, then inspect Convex/R2/error and traffic metrics.

Never copy development Docs into production. Production records are created directly in the existing production Convex deployment/private R2 bucket.

## Emergency rollback

1. Set Convex and Worker to `read-only` first. This blocks content, placement, asset, Trash, and cleanup writes while authorized reads continue.
2. If the UI itself must disappear, build/deploy the frontend as `off`, then set Worker and Convex to `off` after active reads have drained.
3. Do not roll back by deleting schema tables, R2 objects, or Doc fields. The optional Board manifest fields are backward compatible and remain inert.
4. Record the affected commit/deployment, errors, request counts, and any retryable Trash/cleanup records before restoring `on`.

The Vite production build rejects a non-production Convex URL or a Docs mode other than `off` until this checklist is deliberately updated during rollout.
