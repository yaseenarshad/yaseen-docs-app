# YAZ-1289 Raster Image Viewer Design

## Outcome

Yaseen Docs will discover and open approved raster images as static, read-only visual references. Images participate in Files, tabs, exact-extension deep links, and the existing navigation-only wikilink catalog, but never become Markdown notes or semantic records.

## Approved formats

- Supported case-insensitively: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`.
- Animated inputs render only the format-defined default image or first frame.
- SVG is excluded. It is structured XML with scripting and external-resource capabilities, so it requires a separate sanitization and no-network decision.
- Unknown, compound, hidden-dot, and unsupported formats remain excluded under the existing discovery rules.

## Architecture

### Shared classification

- Add `image` to `FileKind` and one `IMAGE_VIEW_EXTENSIONS` allowlist in `shared/types.ts`.
- `fileKind()` remains the single case-insensitive classifier.
- `isViewOnly()` means any supported non-Markdown kind so text, PDF, and images share capability checks without scattered extension logic.
- Add a conversion-safe rename predicate. Existing Markdown and text same-kind behavior remains; raster images may keep the same encoding, with `.jpg` and `.jpeg` treated as synonyms. Renaming `.png` to `.jpg` is rejected because rename does not transcode bytes.

### Exact binary transport

- Add `readImage(path)` as a dedicated exact-absolute-path binary bridge.
- Reuse `readBoundedRegularFile()` for regular-file validation, bounded allocation, pre/post-read drift detection, and normalized bridge failures.
- The encoded-byte ceiling is 50 MiB.
- MIME comes only from the approved extension map.
- Return `{ path, data: Uint8Array, mime, mtime, size }` through a dedicated IPC channel and preload method.
- Do not reuse `readAsset(root, ref)`. That API intentionally performs shortest-name/fuzzy asset resolution and returns base64 for Markdown embeds and drawing sidecars; those semantics are wrong for an open file tab.
- Do not add a file-serving protocol or expose arbitrary local paths to Chromium.

### Static viewer

- `Editor` dispatches `image` before any Markdown owner mounts.
- `ImageViewer` reads bytes through `readImage`, builds a typed `Blob`, calls `createImageBitmap()`, paints the returned bitmap once to a canvas, and closes the bitmap immediately.
- The HTML image-bitmap contract uses the animation's default image or first frame, so GIF/WebP/AVIF never animate in the viewer.
- The canvas fits within the available tab while retaining aspect ratio. No editing, save, toolbar, metadata, conversion, zoom/pan controls, or thumbnail system is added.
- The viewer subscribes to the existing watch source. A matching external `change` triggers a fresh read/decode. Cancellation prevents a stale request from painting after path/revision replacement or unmount.
- Loading and read/decode errors remain passive and contained inside the tab. A failed refresh may not mutate the source file.

### Discovery, navigation, and operations

- The shared tree and watcher include `image` automatically through the central classifier.
- The lightweight view-only catalog generalizes from text/PDF to every non-Markdown `FileKind`, so image candidates use explicit extensions and shortest-unambiguous root-relative paths.
- Plain click opens the current tab; Command-click opens a background tab. Copy link, deep links, tab continuity, and rename-link rewriting reuse the existing view-only navigation contracts.
- A missing recognized image target stays unresolved, shows a passive notice, and never creates a Markdown note.
- Full image filenames and extensions remain visible in Files, tabs, window titles, links, and rename fields.
- Reveal, Open in VS Code, Copy path, Copy link, rename/move, and Trash use the existing approved view-only operation surface.

## Semantic and write isolation

Images must never enter or acquire:

- `IndexRecord[]` or the Markdown vault index;
- Topics, search results, backlinks, properties, aliases, headings, blocks, folder pages, or frontmatter;
- Milkdown, autosave, save/conflict handling, `writeFile`, or non-Markdown creation;
- embed semantics or content extraction.

The existing Markdown-only index and write gates remain authoritative. Image support broadens visibility and exact read/navigation capabilities only.

## Failure behavior

- Missing path: `NOT_FOUND`.
- Directory/non-regular target: `NOT_A_FILE`.
- Unsupported extension, including SVG: `UNSUPPORTED_EXTENSION` or absence from discovery as appropriate.
- Encoded file above 50 MiB: `TOO_LARGE` before full allocation.
- File changes during the bounded read: fail closed using the existing drift contract.
- Browser decode failure: passive “failed to decode image” viewer state.
- Stale async completion: ignored; any created bitmap is closed.
- Cross-encoding rename: refused without touching disk or links.

## Verification

### Automated

- Exact classifier matrix for every approved extension, mixed case, multi-dot names, hidden-dot names, SVG, and unsupported formats.
- Tree/watch inclusion and Markdown index/search/backlink/property exclusion.
- Exact binary read success plus relative, missing, directory, unsupported, oversized, and read-drift failures.
- IPC/preload/client bridge completeness and byte fidelity.
- Viewer paint-once behavior, default/first-frame decode call, bitmap cleanup, external refresh, stale completion, path switching, and passive errors.
- Explicit-extension completion/navigation, duplicate paths, missing no-create behavior, Copy link, rename rewrite, and encoding-preserving rename rules.
- Existing Markdown, text, and PDF regression coverage.

### Isolated real-app demo

Extend the YAZ-1289 Desktop demo with:

- valid PNG, JPG/JPEG, GIF, WebP, AVIF, and BMP fixtures;
- animated GIF/WebP fixtures that visibly remain static;
- transparent, portrait, landscape, tiny, large-dimension, spaces/Unicode, duplicate-name, and mixed-case cases;
- malformed, oversized, SVG, and unsupported exclusions;
- explicit-extension wikilinks and safe rename cases.

Launch the exact verified commit using the existing isolated profile. Use no Playwright takeover. Yasin's explicit demo pass remains the gate before push and merge.

## Anti-slop gate

After implementation, inspect the complete raster diff for duplicate classifier/MIME logic, accidental `readAsset` reuse, semantic or write leakage, stale-request races, unclosed bitmaps/listeners, rough states, unnecessary abstractions, weak timing tests, temporary diagnostics, and stale documentation. Resolve must-fix findings, then rerun focused tests, the full suite, typecheck, production build, and diff/status checks.

## Explicitly out of scope

- SVG.
- Image editing, annotation, cropping, rotation, conversion, metadata/EXIF views, thumbnails, galleries, or slideshows.
- Animation playback or controls.
- Search/OCR/content extraction.
- Arbitrary file protocols or unknown-image sniffing.

## Linear execution map

- YAZ-1320 — lock this contract and handoff.
- YAZ-1321 — shared/desktop classification, transport, discovery, and operation safety.
- YAZ-1322 — viewer and navigation-only linking.
- YAZ-1323 — automated and isolated real-app verification.
- YAZ-1324 — final raster-specific polish and anti-slop pass.
