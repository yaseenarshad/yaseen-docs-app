# YaseenDraw animation lifecycle protocol v1

Presentation Mode owns frame order and camera movement. Managed animation iframes only consume lifecycle commands after the host publishes the active frame.

## Envelope

Every command and response carries:

- `version: 1`
- `presentationId`, `sessionId`, `frameId`, and `elementId`
- a unique `requestId` used for idempotency and stale-response rejection

Host commands use `type: "yaseendraw.animation.command"`; iframe responses use `type: "yaseendraw.animation.response"`.

## Commands

- `load`: initialize the runtime in a paused state at time `0`.
- `seek`: pause and move to a finite non-negative `time` in seconds.
- `play`: play from the current deterministic state.
- `pause`: pause immediately.
- `preview`: pause at the supplied time, or time `0` by default.
- `unload`: pause, reset to time `0`, acknowledge, then let the host release the iframe document.

Re-entering a slide restarts in v1: `load` → `seek(0)` → `play` after the frame camera transition reports `active`. Resume-on-return is deliberately deferred.

## Responses

The iframe reports `ready`, `state`, `complete`, `error`, or `unsupported-version`, plus its current `state`/`time` where relevant. Repeated request IDs return the cached response without applying the command twice.

## Trust boundary

The iframe bridge accepts commands only from `window.parent`. The host accepts a response only when all of the following match the registered runtime: iframe `contentWindow`, exact response origin, element ID, and current request ID. Every managed animation iframe—embedded or hosted—uses `sandbox="allow-scripts"` without `allow-same-origin`, so its exact expected response origin is the opaque value `"null"`.

The opaque child requires `"*"` as the outbound target. This is not used as a response-origin wildcard: returning messages still require the exact `null` origin, exact iframe window, element ID, and request ID. A hosted iframe URL is accepted only when it is same-origin and exactly matches `/api/presentation-animations/<capability-token>`; the worker resolves that short-lived token to a registered R2 version and serves it with a no-network CSP.

## Compatibility

The bridge is injected idempotently into generated embedded animation HTML and drives the existing HyperFrames-shaped `window.__timelines` timeline. It pauses the legacy evergreen loop on installation, preserving the animated-slide skill's fixed-stage/GSAP authoring model while moving playback authority to Presentation Mode. Unknown protocol versions fail closed with the supported version list; unknown commands produce an element-scoped error response.
