# CONTINUITY — yaz-1709-image-collapse

## Goal
- Ship "image collapse" (YAZ-1709) to main: a bullet holding an image folds like a parent (⌘↑ / chevron / corner button) to a fixed one-line thumbnail chip that is exactly a text row tall; thumbnail click / ⌘↓ / chevron expand; fold state view-only; lightbox pages through every image on the page (← → + `n / m` pill). Merged PR, Linear tree YAZ-1718…1728 Done, demo scaffolding gone. No release.

## Constraints
- Decisions D1–D5 + demo learnings DL1–DL8 are LOCKED (comments on YAZ-1709).
- NEVER run Playwright / `npm run e2e` while Yasin is at the computer. `imageFold.spec.ts` and `imageGallery.spec.ts` are written, NOT run — only on his explicit go-ahead.
- House rules: header comments say WHY; decorations-first; the image node view never touches the serializer; `roundtrip.test.ts` byte-identical; fold never writes markdown.
- No release unless Yasin says so.

## Key Decisions
- See YAZ-1709 comments. Summary: foldable = owns nested list OR holds an image; chip = thumbnail only, fixed 1.75em box, height = line box − 4px, top-aligned (row height measured identical: 84/84 retina px at 1.5, 63/64 at 1.2); thumbnail-only click expands; corner fold button top-left, primary button only; alt text = the ONE text stand-in (fold key, breadcrumb, plain-text copy); `--image-width` custom property (none when unsized); gallery built by walking the doc at double-click, no wrap, no pill for one image; broken image while folded stays its inert chip.

## State
- Done:
  - [x] 1 YAZ-1718 scope · [x] 2A YAZ-1720 · [x] 2B YAZ-1721 · [x] 3 YAZ-1722 · [x] 4A YAZ-1724 · [x] 4B YAZ-1725 · [x] 5A YAZ-1727 · [x] 5B YAZ-1728
  - [x] Merged as PR #67 (8622c74) on 2026-09-20; branch, worktree and `~/Desktop/yaz-1709-demo` removed; generator kept at `tools/prototypes/make_image_collapse_demo_vault.py`
- Now: CLOSED OUT. Nothing open.
- Next (only if Yasin asks): one local run of `npm run e2e -- imageFold imageGallery` (also still pending from YAZ-1656: `imagePaste imageRender`). No release yet.

## Gotchas
- A worktree with SYMLINKED `node_modules` breaks Vite's `fs.allow` (renderer CSS `?inline` imports through the symlink are denied; two tests fail at collect). Real `npm ci` in the worktree; npm's script gate then blocks electron's binary download — run `node node_modules/electron/install.js`.
- `vertical-align: middle` on an inline-block chip grows the row; size the chip from `--edit-line-height` and top-align it.
- Dev app for pointed tests: `YASEEN_DOCS_USER_DATA_DIR=<profile> npx electron-vite dev` from `desktop/`, profile seeded with `defaultAppState()` + one `windows[]` entry; renderer HMR is on, never `--watch`.

## Working Set
- On main: `client/src/editor/outline/{listNodes,outlineFolding,outlineFoldKeys}.ts`, `client/src/editor/image/{imageView,imageOptions,ImageModal}.ts(x)`, `imageView.css`, `imageModal.css`, `client/src/editor/clipboardPlainText.ts`, `client/src/editor/Editor.tsx`, `docs/CONTRACTS.md` rules 5/30, `desktop/e2e/{imageFold,imageGallery}.spec.ts`.
