# Scene-size validation — YAZ-1593

## Approved contract

10,000,000 raw UTF-8 bytes inclusive; 10,100,000 compressed bytes; warning at 8,000,000 raw bytes. Real legacy Convex document writes remain limited to 900,000 bytes. No delta storage, new journal, schema redesign, billing-limit change or release.

## Local resource audit (2026-09-13)

The production Board scene handler was bundled into actual workerd 1.20260911.1 using Miniflare 5.20260911.0-alpha, Wrangler 4.131.1, and the production compatibility date 2026-07-28. Only grant lookup and R2 storage were stubbed. Bounded input, native decompression, hashes, grant parsing and JSON validation ran as implemented. Each case used exactly 10,000,000 raw bytes and ran single and two overlapping requests; 30 uploads across 20 timing/memory scenarios returned HTTP 200.

| Scene workload | Compressed bytes | Two-request peak live heap + backing storage |
| --- | --: | --: |
| 8,712 text/shape elements, repetitive prose | 190,103 | 75.35 MB |
| 3,575 elements with higher-entropy text | 3,158,951 | 81.05 MB |
| 3,584 elements with stored-block compression | 10,001,531 | 86.54 MB |
| Same content with valid exact-cap zlib framing | 10,100,000 | 86.99 MB |
| 1,045 freedraw strokes with 1,000 coordinate pairs each | 95,140 | 80.72 MB |

Memory checkpoints included the live parsed document inside the JSON validator. Largest measured live heap + backing + separately reported embedder heap was approximately 87.76 MB. Geometry caused allocated V8 heap capacity plus backing to reach 142.44 MB, but allocated unused capacity is not live memory. Local process RSS includes other Miniflare isolates/runtime and is not the production isolate quota.

Local process CPU deltas were 70–180 ms for one upload and 110–330 ms for two. They include local runtime overhead and are **not billed request CPU**. Local tests do not prove viability under a free-plan 10 ms CPU allowance. Verify the actual production plan and request outcomes before claiming deployed capacity.

These checkpoints do not bound every transient native allocation, every possible JSON shape, or more than two overlapping ceiling-sized uploads. This is workload evidence, not an unlimited-capacity guarantee. The [Cloudflare limits documentation](https://developers.cloudflare.com/workers/platform/limits/) describes 128 MB per isolate, shared across concurrent requests.

Audit artifacts for this run: `/tmp/yaz-1593-capacity.YqabH3/README.md`, `profile.mjs`, and `results-{final,exact-cap,geometry}.jsonl`. The report records source hashes and reproduction commands. Linear comments retain the durable outcome and rollout record; temporary harnesses are not application dependencies.

## Regression coverage

Shared policy/compression tests cover exact boundaries, Unicode, invalid metadata and bounded decompression. Worker tests cover grant/body/hash/metadata checks at the ceiling. Convex tests exercise migrated programmatic edits/history above 900 KB and retain legacy rejection. Browser tests cover no futile oversized requests, lifecycle flush/navigation blocking, journal retention/recovery/degradation, reduction resuming saves, typed server rejection, metadata/in-flight races and notice/export behavior.

Final local checks passed: 316 app/cloud/shared/Worker tests, 178 Convex tests, TypeScript, changed-file zero-warning ESLint, formatting and production build. Existing test act warnings and build font/chunk/Browserslist warnings remain; these are not deployment proof.

Desktop and narrow-viewport QA used the actual Excalidraw layout and notice component. Light/dark contrast and in-bounds mobile placement passed; canceling export retained the unsaved warning. The local 10 MB / 6,018-text-element compression-and-hash benchmark took approximately 170 ms and delayed the next timer by 171 ms. This was not a full rendering or real-download-content benchmark.

Independent spec and quality reviews approved after regressions fixed in-flight journal-close protection, metadata save-status races, structured Convex action errors and truncated zlib streams. The resource table predates the final exact-view hashing optimization, which removes a redundant full-buffer copy; its measurements are retained without claiming a newer measured reduction.

Production rollout and disposable-board read-back evidence must be recorded in YAZ-1598 before the parent is marked Done.
