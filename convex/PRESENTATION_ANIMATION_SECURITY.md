# Presentation animation asset boundary

Presentation animation bundles are trusted application assets, not general HTML hosting. They intentionally use separate database tables, grants, HTTP routes, and R2 object-key prefixes from normal `image/*` scene assets.

The owner-authorized upload contract derives identity from Convex auth and verifies board ownership server-side. A grant binds one immutable asset/version to its diagram, source iframe element, slide, exact `text/html` byte length, and lowercase SHA-256. Grants are short-lived and registration is idempotent. A normal scene-image grant cannot register an animation, and an animation grant cannot pass through the normal image registration function.

Threats this boundary is designed to contain:

- cross-board or guessed asset registration;
- MIME confusion through the public image route;
- oversized scene JSON and oversized hosted bundles;
- replacement races that change an already-open immutable version;
- path traversal or direct R2 object-key serving;
- expired/replayed grant registration;
- iframe access beyond the versioned animation `postMessage` protocol.

The worker must verify the uploaded body size and SHA-256 before writing R2. Serving must resolve a short-lived read capability to a registered version, apply the restricted CSP and managed-iframe sandbox, and never accept an arbitrary object key or URL from scene JSON.

Read capabilities last five minutes and bind a random token to one registered diagram/asset/version record. Owner capabilities require board ownership; viewer capabilities require the board's current share token and are invalid as soon as sharing is disabled. Validation re-reads both the board and immutable asset record, so deletion or replacement cannot retarget an issued token.

The worker exposes only `/api/presentation-animations/<token>`. It resolves the R2 key through Convex, verifies the stored size, ETag, and SHA-256 metadata, and serves the bundle with a no-network CSP. The generic `/api/assets/<key>` route rejects animation prefixes. The editor accepts only a same-origin capability URL with the exact route shape and mounts managed animations with `sandbox="allow-scripts"`. Omitting `allow-same-origin` intentionally gives the child an opaque `null` origin; protocol responses must match that origin, the exact iframe `contentWindow`, and the outstanding request ID.
