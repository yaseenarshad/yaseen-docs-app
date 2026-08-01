# Presentation animation asset boundary

Presentation animation bundles are trusted application assets, not general HTML
hosting. They intentionally use separate database tables, grants, HTTP routes,
and R2 object-key prefixes from normal `image/*` scene assets.

The owner-authorized upload contract derives identity from Convex auth and
verifies board ownership server-side. A grant binds one immutable asset/version
to its diagram, source iframe element, slide, exact `text/html` byte length, and
lowercase SHA-256. Grants are short-lived and registration is idempotent. A
normal scene-image grant cannot register an animation, and an animation grant
cannot pass through the normal image registration function.

Threats this boundary is designed to contain:

- cross-board or guessed asset registration;
- MIME confusion through the public image route;
- oversized scene JSON and oversized hosted bundles;
- replacement races that change an already-open immutable version;
- path traversal or direct R2 object-key serving;
- expired/replayed grant registration;
- iframe access beyond the versioned animation `postMessage` protocol.

The worker must verify the uploaded body size and SHA-256 before writing R2.
Serving must resolve a short-lived read capability to a registered version,
apply the restricted CSP and managed-iframe sandbox, and never accept an
arbitrary object key or URL from scene JSON.
