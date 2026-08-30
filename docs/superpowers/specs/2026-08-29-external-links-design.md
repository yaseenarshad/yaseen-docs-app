# External Markdown Links Design

## Outcome

Standard Markdown links open immediately through the operating system. Web links use the default browser, relative local-file links use the OS-default application, and no link can create an Electron child browser. Right-clicking a standard link exposes Edit link, Copy link, and Remove link.

## Interaction contract

- An unmodified primary-button press on a rendered `[label](href)` opens it immediately and does not move the caret.
- Right-click opens a focused editor context menu with Edit link, Copy link, and Remove link.
- Edit link delegates to Crepe's existing link-edit API and preserves the label.
- Copy link copies the stored raw `href`.
- Remove link removes the mark and preserves the label text.
- Plain text, code, images, selections, and `[[wikilinks]]` retain their current behavior.
- Opening failure leaves Markdown byte-identical and uses the existing passive notice.

## Architecture

`client/src/editor/markdownLink.ts` owns only ProseMirror hit-testing and gestures. It receives an opener callback; it does not know Electron or filesystem rules. `Editor.tsx` binds that callback to the current note path.

The existing typed `ShellApi` bridge gains `openLink({ href, sourcePath })`. `desktop/src/main/fs/openLink.ts` validates and resolves the target, then calls `shell.openExternal` for the approved external protocols or `shell.openPath` for local files. Every window also denies `setWindowOpenHandler` requests, routing safe absolute external URLs through the same opener as defense in depth.

## Link policy

- `http:`, `https:`, `mailto:`, `tel:`, and `ftp:` use the OS protocol handler.
- A relative or absolute path without a scheme resolves against the source note and uses `shell.openPath`.
- An explicit `file:` URL uses `shell.openPath`.
- A fragment-only `#target` is not sent to the OS; heading navigation is outside this feature.
- Empty, malformed, unsafe, or unsupported schemes fail with `BAD_REQUEST` and perform no shell action.

## Failure and security

- Renderer input is untrusted and validated in main.
- `javascript:`, `data:`, `app:`, `yaseendocs:`, and unknown protocols never reach the OS.
- A non-empty `shell.openPath` result and any shell rejection become structured `IO_ERROR` failures.
- The popup handler always returns `{ action: 'deny' }`, even when OS routing fails.
- No webview, BrowserView, child BrowserWindow, Node integration, package fork, or new persistence is introduced.

## Verification

Focused tests prove classification/resolution, shell calls and failures, bridge completeness, popup denial, direct clicks, exact menu actions, retained-editor isolation, failure notices, and markdown preservation. The full Vitest suite, typecheck, and build run before integration. Manual acceptance uses a dedicated Desktop vault and isolated user-data profile; Playwright is not used for the user gate.
