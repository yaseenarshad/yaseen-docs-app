# Angle: engine fork & cross-app transfer (YAZ-2132)

Base: `main` @ `63aeeea` (v0.9.27). Fork: `/Users/yasinarshad/Documents/GitHub/yaseen-excalidraw` (read-only; the cherry-pick trial ran in a throwaway clone at `SCRATCH/et-fork`). Harness: `SCRATCH/et-perf/engine.spec.ts` (Playwright `_electron`, the repo's own `e2e/helpers.ts` launcher on the built `desktop/out`, isolated `--user-data-dir` under `SCRATCH/profiles/engine-transfer/`, throwaway vaults under `SCRATCH/vaults/engine-transfer/`). Raw runs: `SCRATCH/et-perf/results-N{0,10,1000,4000}.json`.

## 1. Baseline numbers

Load (1-min average) during the timing runs was 7.0–10.1, with other agents running. Timing uses the unpacked `desktop/out` build, which has the same renderer bundle as the packaged app. Each run used a fresh profile, so these are cold-cache numbers (the V8 code cache is off for `app://` anyway).

| Metric | Value | How |
|---|---|---|
| Vendored main tarball `yaseendraw-excalidraw-…-9e63bdf2.tgz` | 32.8 MB compressed; unpacked: `dist/dev` 17.4 MB JS + 13.6 MB fonts, `dist/prod` 5.2 MB JS + 13.6 MB fonts, types 1.2 MB | measured (`tar -tvzf`) |
| Dev build shipped in the app? | **No.** Vite resolves the `production` export condition, and the fonts plugin copies only `dist/prod/fonts` (`electron.vite.config.ts:20`) | measured (no dev-only symbols in `out/renderer`) |
| Engine fonts in the app (`out/renderer/excalidraw-assets/fonts`) | 243 woff2 files, 13.4 MB, of which 12.4 MB is Xiaolai (CJK). Shipped once | measured |
| Renderer JS reachable **only** through the engine chunk | **12.58 MB of the 19.15 MB** renderer JS (123 chunks). Largest: engine 2.2 MB, harfbuzz subset 1.8 MB, mermaid/cytoscape/katex (the engine's text-to-diagram) ~6 MB, 54 locale chunks | measured (import-graph walk of `out/renderer/assets`) |
| Entry chunk carries the engine? | No. `index-DM1KNA4f.js:22175` is a lazy `import("./percentages-….js")` | measured |
| app.asar | 33 MB, and the engine accounts for about 26 MB of it (12.6 JS + 13.4 fonts) | measured |
| Reload → first drawing preview SVG (1 text scene) | median **285 ms**, p95 291 (N=10 scene, 5 runs); 333 · 485 (2-element scene, 7 runs) | measured |
| Reload → editor mounted | median 33–45 ms | measured |
| Click preview → modal canvas present | median **82 ms** · p95 98 (10 el) · 112 · 184 (2 el) · 204 · 253 (1k) · 421 · 492 (4k) | measured |
| Modal open: duplicate Assistant UI font | `document.fonts` holds **8** Assistant faces on every run (4 CSS + 4 registry). The same weights are fetched from both `assets/Assistant-*.woff2` and `excalidraw-assets/fonts/Assistant/*` (6 requests in 8 of 17 runs, 3 in the rest) | measured |
| Modal open: `roundRect-*.js` polyfill chunk fetched | 1 request, 6.6 KB, on every run | measured |
| **Drag, select-all + 40 pointer steps**, per step (wall ÷ 40) | 10 el: **17 ms** (display floor); 1k: median **37.5 ms** (range 32.8–51.1); **4k: median 390 ms** (310–462). All 4,002 elements moved; verified by saving and diffing x | measured, 5 runs each |
| Drag 4k, rAF frame p95 · max | 417 · 450 ms (median of 5) | measured |
| Fork diff `9e63bdf2..origin/yaz-2073-perf` in `packages/` | 28 files, +1,005/−53. Of that, the Writing-mode commit is 15 files, +658/−17 | measured (`git diff --stat`) |
| Cherry-picking the 6 perf commits onto `9e63bdf2` | **all 6 apply cleanly** (textual only; not built or tested) | measured (scratch clone) |

## 2. Findings (most impactful first)

### F1. The docs app ships the same O(n²) multi-element drag the draw app fixed (#12183), and the fix is on a pushed fork branch
- **Evidence:** measured 4k select-all drag is ~390 ms per pointer step (p95 frame 417 ms), and 1k is ~37.5 ms against a 17 ms floor. This matches the draw app's pre-fix numbers (4k p50 460 ms). The cause is `packages/element/src/dragElements.ts`/`binding.ts` rebuilding the id set on every step. Fork `a25283c7` (#12183) plus `47672c34` (#12180, resize) fix it, with test fixup `90cade85`.
- **Impact:** smoothness in the drawing modal, only for large multi-selections. The draw app measured 4k 458 → 9–10 ms p50 and 1k 25 → 8.3 ms p50. Resize saw no clear change. Most docs drawings are small (tens to hundreds of elements), so the everyday gain is small. It is large for the rare big drawing.
- **Risk:** none visible. The draw app's pixel gate (90/90 identical, export plus live canvas, light and dark) ran on `e72242f8` → `759e7dfd`.
- **Draw equivalent:** 5A / YAZ-2095. Transfers **as-is** through a vendor bump.

### F2. What a bump to `origin/yaz-2073-perf` (759e7dfd) actually changes in the docs app
Commit by commit, for this app's two uses: `exportToSvg` previews (`client/src/drawings/renderScene.ts:61-70`) and one `<Excalidraw>` modal (`client/src/drawings/ExcalidrawSurface.tsx:133-135`). Both load lazily through `loadExcalidraw()` (`renderScene.ts:49-58`).

| Commit | What | Reaches the docs app? | Expected effect here |
|---|---|---|---|
| `56ce286c` Writing mode (#17) | Adds `writingMode` + `currentItemWritingStrokeWidth` to appState, a Writing stroke-width profile (0.1–100, presets 0.3/0.5/1), and a freedraw-specific clamp on group resize | **Mostly dormant.** The only toggle is in `excalidraw-app/components/AppSidebar.tsx` (not packaged). Nothing in `packages/` sets `writingMode: true` (`git grep` on the branch). Both fields are `export: false`, so `serializeAsJSON(…,'local')` never writes them: **sidecar bytes are unchanged.** **One reachable delta:** `packages/element/src/resizeElements.ts:421-425`. When a freedraw stroke is scaled inside a group resize, its width now clamps at **0.1** instead of **0.5** (and rounds to 0.1). Only visible when shrinking a group that contains pen strokes to under a quarter of its size | invisible except for that edge case; see decision ET-D1 |
| `e7b08538`, `e72242f8` R2 saves | `board-scenes/`, `convex/`, `worker/`, `excalidraw-app/cloud/`, plus root `package.json` gaining `aws4fetch` | **No.** Zero files under `packages/`, so they are not in any tarball | none |
| `47672c34` #12180 | WeakMap id-set cache in `binding.ts` for multi-resize | yes (modal) | resize: no clear change (draw measurement) |
| `a25283c7` #12183 + `90cade85` test | one moved-id array per drag step | yes (modal) | 4k drag ~390 ms → ~10 ms per step (draw measured ~46×); 1k ~37 → ~17 ms (display floor) |
| `2d1fbabf` lazy pako | pako leaves the engine chunk and loads only for embedded-scene PNG/SVG and encrypted data | yes: the engine chunk here carries pako today (10 hits in `percentages-*.js`) | about −110 KB unminified parse on the first preview. Docs previews never embed a scene, so pako is never fetched. Order of 1–2 ms (estimate) |
| `899acb89` drop roundRect polyfill | Electron 43 has native `roundRect` | yes: `roundRect-CjfubgrN.js` (6.6 KB) is fetched on every modal open (measured) | one request and 6.6 KB less per session (negligible) |
| `759e7dfd` Assistant font once | the registry skips a face `document.fonts` already has | yes: 8 faces / up to 6 requests measured on modal open | 3 fewer woff2 fetches (≈80 KB) and 4 fewer FontFaces on the first modal open (the draw app measured 8 → 4 faces and 6 → 3 requests) |

- **Net:** the only real gain is F1's drag fix. The rest is hygiene worth under ~5 ms.
- **Public API used by the docs app is unchanged:** `exportToSvg`, `restoreElements`, `getSceneVersion`, `serializeAsJSON` and `Excalidraw` all keep their signatures. `encode`/`decode` became async, but the docs app never calls them.

### F3. Two ways to bump, and they differ only by the Writing-mode code
- **(a) `yaz-2073-perf` @ 759e7dfd as-is.** This is the exact engine the draw app ships, and its gates (pixel 90/90, 5A benches, e2e 131/131) ran on it. It adds Writing mode's dormant code (F2).
- **(b) New fork branch `yaz-2131-docs-engine` = 9e63bdf2 + cherry-picks** `47672c34 a25283c7 90cade85 2d1fbabf 899acb89 759e7dfd`. Verified in a scratch clone that all 6 apply cleanly. `git diff docs-perf perf -- packages` is exactly the 15 Writing-mode files. This is the minimal diff, but it creates a third engine lineage that no gate has run on. The next docs sync would then have to re-cross Writing mode anyway, because fork `main` has it.
- Recommendation in ET-D1.

### F4. Draw 5B1 / 5B image decode does not reach the docs app today
- **5B (YAZ-2096) shipped only hygiene:** pako, roundRect and the Assistant font (F2). The full-res `ImageBitmap` decode was stopped by the D5 RSS guard (+783 %).
- **5B1 (YAZ-2126):** Yasin chose option 2 (bitmaps under a ~512 MB decoded-bytes budget, PNG/WebP/GIF/BMP/ICO only). The patch lives on branch `yaz-2073-parked-5b1-bitmap-decode` and in `thoughts/yaz-2073-scope/5B1-bitmap-decode.fork.patch` on the draw worktree. **Neither is on the fork's origin** (`git ls-remote origin` lists only `yaz-2073-perf`), so there is nothing the docs app could consume yet.
- **Relevance here is low anyway.** Docs drawings are single modal scenes, and images in notes render through the vault protocol as `<img>`, not through the engine. Previews are `exportToSvg`, which embeds images as data URLs in SVG `<image>` and so never runs the canvas `drawImage` path 5B1 changes. The only beneficiary would be an image-heavy drawing opened in the modal.
- **Transfer:** only through a *future* bump, once 5B1 lands on a pushed fork commit.

### F5. The main tarball is 32.8 MB, and 21.5 MB of it (unpacked) the app never uses
- **Evidence:** the dev build (17.4 MB) and a second copy of the fonts (13.6 MB) exist only because the exports map's `development` condition points at `dist/dev`. They are used only by `npm run dev` (Vite dev server). The packaged app uses `dist/prod` only (verified).
- **Impact:** repo and clone weight, and `npm ci` time. The repo's `.git` is 42 MB today, and each engine bump adds about 33 MB of history. **Zero effect on app size or speed.**
- **Option:** a prod-only tarball (drop `dist/dev`, point `development` at `dist/prod` in the packed `package.json`) would be about 15 MB compressed (estimate: fonts are already woff2; prod JS gzips to about 1.5 MB).
- **Cost:** `npm run dev` would then run the minified engine: no engine dev warnings and harder engine stack traces.
- **Draw equivalent:** Future **YAZ-2120**, locked there as Future (D16: "zero effect on app size or speed"). Transfers adapted: it should be decided once for both apps, because both vendor the same five tarballs. See ET-D2.

### F6. Bug: a Canvas-background-only edit in the drawing modal is silently discarded (draw 2E)
- **Evidence:** `DrawingModal.tsx:100` treats the drawing as dirty only when `version !== baseline`. The version is `getSceneVersion(elements)` (`ExcalidrawSurface.tsx:141`), which sums element versions only. `UI_OPTIONS` (`ExcalidrawSurface.tsx:84-88`) leaves `changeViewBackgroundColor` on, so the engine's menu shows "Canvas background". `viewBackgroundColor` *is* written by `serializeAsJSON(…,'local')`.
- **Result:** change only the background and Save stays disabled; ✕, Esc or click-away closes without the discard prompt, and the edit is lost. The same applies to a grid toggle (`gridModeEnabled`, `gridSize`, `gridStep` are also persisted fields).
- **Draw equivalent:** 2E / YAZ-2123 (autosave compared `getSceneVersion` only). Transfers **adapted**. The docs app has no canvas-prefs push into mounts, so the draw app's exclusion of `gridModeEnabled` does not apply. Here every field the serializer writes should count (ET-D3 covers the one visible consequence).
- **Diff:** §3 P3. Reliability angle: see handoffs.

### F7. Cheap engine-adjacent wins that belong to other angles (evidence only)
- **V8 code cache is off for `app://`.** `desktop/src/main/index.ts:75` registers the scheme without `codeCache: true`, so the 2.2 MB engine chunk, the 1.8 MB harfbuzz chunk and the 4.85 MB entry chunk are recompiled on every launch. Draw 4A / YAZ-2092: **as-is**.
- **Renderer not minified.** `electron.vite.config.ts:84` has no `minify`, so the engine chunks are re-emitted with whitespace (for example `subset-shared.chunk-*.js` starts `function GQ(F, L, I, y) {\n  let Y`). Draw 3D / YAZ-2089: **as-is**.
- **The preview pipeline serializes the engine load behind the scene read.** `drawingPreview.ts:134-135` runs `loadDrawingScene(...).then(renderSceneToSvg)`, so the engine import starts only after the `readAsset` IPC returns. Starting `loadExcalidraw()` alongside the read is the docs-shaped version of draw 4B / YAZ-2093. The expected gain is only as large as the read (a few ms, estimate), so it is low priority.
- **Text previews load the 1.8 MB harfbuzz font-subset chunk plus a subset worker.** Measured: `subset-shared.chunk`, `subset-worker.chunk` ×2 and a `data:font/woff2` inline, on the first text preview. `exportToSvg` inlines subsetted fonts. `skipInliningFonts` exists, but dropping inlining could change how text renders in a preview. **Keep** unless a pixel-identical path is proven.

## 3. Proposed changes

### P1. Bump the vendored engine to 759e7dfd (recommended variant of ET-D1)
Rebuild the five tarballs from `origin/yaz-2073-perf` @ `759e7dfd` with the recipe in `client/vendor/README.md` (or reuse the draw app's `tools/packEngine.mjs` output for the same commit), delete the five `-9e63bdf2.tgz`, and regenerate `package-lock.json` (integrity plus resolved paths).

`client/package.json`
```diff
@@ -6,7 +6,7 @@
   "dependencies": {
-    "@excalidraw/common": "file:vendor/yaseendraw-common-0.18.0-9e63bdf2.tgz",
-    "@excalidraw/element": "file:vendor/yaseendraw-element-0.18.0-9e63bdf2.tgz",
-    "@excalidraw/excalidraw": "file:vendor/yaseendraw-excalidraw-0.18.0-9e63bdf2.tgz",
-    "@excalidraw/fractional-indexing": "file:vendor/yaseendraw-fractional-indexing-3.3.0-9e63bdf2.tgz",
-    "@excalidraw/math": "file:vendor/yaseendraw-math-0.18.0-9e63bdf2.tgz",
+    "@excalidraw/common": "file:vendor/yaseendraw-common-0.18.0-759e7dfd.tgz",
+    "@excalidraw/element": "file:vendor/yaseendraw-element-0.18.0-759e7dfd.tgz",
+    "@excalidraw/excalidraw": "file:vendor/yaseendraw-excalidraw-0.18.0-759e7dfd.tgz",
+    "@excalidraw/fractional-indexing": "file:vendor/yaseendraw-fractional-indexing-3.3.0-759e7dfd.tgz",
+    "@excalidraw/math": "file:vendor/yaseendraw-math-0.18.0-759e7dfd.tgz",
     "@milkdown/crepe": "^7.22.1",
```
- **Gates:**
  - `desktop/e2e/drawing.spec.ts` and `yaseendraw.spec.ts` green. Their "untouched drawing opens clean" and "stock scene opens clean" steps pin the no-dirty-on-open rule across the engine's new appState keys.
  - Re-run `SCRATCH/et-perf/engine.spec.ts` with `NEL=4000` and `NEL=1000`. Expect per-step ≤ 20 ms at both.
  - Expect `assistantFaces` 8 → 4 and no `roundRect-*.js` in `modalReqs`.
  - `npm test`; `npm run typecheck`.
- **After this, the behavior is:** identical drawings and sidecar bytes, a large multi-selection drags at display rate instead of ~2.5 fps, and the modal fetches three fewer fonts and one fewer chunk.

`client/vendor/README.md` (stale repo path in the recipe; the repo is `yaseen-docs-app`)
```diff
@@ -17,7 +17,7 @@
 cd ~/Documents/GitHub/yaseen-excalidraw && git pull
 yarn install
 HASH=$(git rev-parse --short HEAD)
-V=~/Documents/GitHub/yaseen-milkdown/client/vendor
+V=~/Documents/GitHub/yaseen-docs-app/client/vendor
 for p in excalidraw common element math fractional-indexing; do
```

### P2. (Variant b of ET-D1, only if Yasin picks it) Perf-only fork branch
```bash
cd ~/Documents/GitHub/yaseen-excalidraw
git switch -c yaz-2131-docs-engine 9e63bdf2
git cherry-pick -x 47672c34 a25283c7 90cade85 2d1fbabf 899acb89 759e7dfd   # verified clean
yarn install && yarn test:app --run packages/element packages/excalidraw/fonts   # + build:packages
git push -u origin yaz-2131-docs-engine    # needs Yasin's go
```
Then apply P1 with that branch's HEAD hash in place of `759e7dfd`.

### P3. Count persisted appState edits as changes in the drawing modal (fixes F6; draw 2E adapted)
`client/src/drawings/ExcalidrawSurface.tsx`
```diff
@@ -126,6 +126,15 @@
   // The saved scene may sit far from the origin; open on what it holds.
   const initialData = useMemo(() => ({ ...engineScene(scene), scrollToContent: true }), [scene])
+  // Scene settings the serializer WRITES (Canvas background, grid) are edits too, but
+  // `getSceneVersion` sums element versions only. The engine's FIRST onChange is the reference
+  // (it reports once the scene is applied); every later change of that key adds one.
+  const appStateEdits = useRef<{ key: string | null; edits: number }>({ key: null, edits: 0 })
   const onChange = useCallback((elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]) => {
     const mod = engineRef.current
-    if (mod !== null) emitRef.current(snapshotOf(mod, elements, appState, files))
+    if (mod === null) return
+    const seen = appStateEdits.current
+    const key = persistedAppStateKey(mod, appState)
+    if (seen.key !== null && key !== seen.key) seen.edits += 1
+    seen.key = key
+    emitRef.current(snapshotOf(mod, elements, appState, files, seen.edits))
   }, [])
@@ -137,9 +146,14 @@
 
 /** One snapshot from the engine's own two utilities; the only place either is called. */
-function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]): DrawingSnapshot {
+function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2], appStateEdits = 0): DrawingSnapshot {
   return {
-    version: engine.getSceneVersion(elements),
+    version: engine.getSceneVersion(elements) + appStateEdits,
     // A text file in a git vault ends with a newline, exactly as `createDrawing` wrote it.
     serialize: () => `${engine.serializeAsJSON(elements, appState, files, 'local')}\n`,
   }
 }
+
+/** The appState fields the engine's own 'local' serializer persists, read off it so the two cannot drift. */
+function persistedAppStateKey(engine: ExcalidrawModule, appState: ChangeArgs[1]): string {
+  return JSON.stringify(JSON.parse(engine.serializeAsJSON([], appState, {}, 'local')).appState)
+}
```
- **Tests:**
  - Unit (DrawingModal/Surface): with the real vendored engine, a background change bumps the version; scroll, zoom, theme and selection do not.
  - e2e: change the Canvas background, then Save is enabled, save, reopen, and the background persists.
  - The existing "reopen is clean" steps stay green.
- **After this, the behavior is:** changing the Canvas background (or grid) enables Save and closing asks "Discard drawing changes?", exactly like drawing a shape. Panning, zooming and selecting still never do.

## 4. Decisions Yasin must make

### ET-D1. Which engine commit the docs app moves to
- **Problem:** the drag fix (F1) lives on `yaz-2073-perf`, whose history also carries Writing mode. Writing mode is dormant here except for one edge-case resize clamp (F2).
- **Options:**
  1. Bump to `yaz-2073-perf` @ 759e7dfd as-is.
  2. A perf-only fork branch (9e63bdf2 + 6 clean cherry-picks, P2).
  3. Stay on 9e63bdf2.
- **Recommendation: 1.**
  - Both apps then run one engine commit that has already passed the draw app's pixel gate and e2e.
  - Writing mode has no UI in the package and never touches the sidecar bytes.
  - The only reachable delta (pen strokes shrunk inside a group can now go thinner than 0.5, down to 0.1) matches what the draw app already does to the same `.excalidraw` files.
  - Option 2 buys that one clamp back at the cost of an ungated third lineage, which the next sync must re-cross.

### ET-D2. Engine vendoring model (draw Future YAZ-2120, shared by both apps)
- **Problem:** each bump adds a ~33 MB tarball to git history. About 21.5 MB unpacked (the dev build plus a second copy of the fonts) is used only by `npm run dev`.
- **Options:**
  1. Keep full tarballs.
  2. Prod-only tarballs, with `development` mapped to prod (about 15 MB per bump, estimate). Dev mode loses the engine's dev build.
  3. Git LFS or a private registry (history stops growing; needs infrastructure).
- **Recommendation: 1 for this project.** It has zero app size or speed effect, and it should be decided once for both apps under YAZ-2120. If Yasin wants it now, 2 is the cheap step, done in the shared pack script so both apps get it.

### ET-D3. Should a grid toggle mark a drawing dirty?
- **Problem:** P3 counts every field the serializer writes, which includes `gridModeEnabled`. Today a grid toggle is silently dropped on close; after P3 it enables Save.
- **Options:**
  1. Count every persisted field (background, grid size, grid step, grid on/off).
  2. Count all but `gridModeEnabled` (the draw app's choice, made because of its prefs push, which the docs app does not have).
- **Recommendation: 1.** Whatever Save would write is an edit. There are no prefs here that push grid state into mounts.

## 5. Keep as-is
- **Excalidraw fonts (13.4 MB, 12.4 MB of it Xiaolai CJK):** shipped once. They are fetched only for scenes containing text, and removing any would be feature loss (draw D15 kept them too).
- **The 54 engine locale chunks and the mermaid/katex/cytoscape text-to-diagram chunks (~6 MB):** lazy, never parsed unless used, and removal would be feature loss (draw D15).
- **Engine loading is already lazy and correctly split.** It stays out of the entry chunk, its CSS is imported only by the modal, and there is one promise per renderer. There is nothing to gain from "preload at boot" (draw 4B) as written: the docs app has no drawing windows, and preloading on every note would tax the notes without drawings.
- **#12050 (dark-mode JS colours) and #12063 (pixel snapping):** declined in the draw app (no speed gain in Electron, visible change). Same answer here.
- **Font inlining in previews (harfbuzz subset):** see F7. Keep unless a pixel-identical `skipInliningFonts` path is proven.
- **The `assets/Assistant-*.woff2` shipped duplicate (79 KB):** 759e7dfd fixes the runtime double fetch. The duplicate bytes on disk are not worth a build hack.

## 6. Transfer map: every draw subissue → docs app

Legend: **as-is** = same fix and same file shape; **adapted** = same idea, docs-shaped; **N/A** = no equivalent here; **done** = the docs app already does it.

| Draw issue | What it did | Docs-app equivalent (file:line) | Applies? | Expected gain here | Notes |
|---|---|---|---|---|---|
| **1A** YAZ-2076 size budget gate | `measureBudget.mjs` + `budget.json` in CI | none (`tools/` has no perf dir) | adapted | prevents regressions (no speed) | Port the gate. Metrics: asar, DMG, entry chunk (4.85 MB), engine-only JS 12.6 MB, `asarNodeModulesFiles` (17 today) |
| **1B** YAZ-2077 CDP perf harness | launch, open, drag, hover, storm | none; `SCRATCH/et-perf/engine.spec.ts` is a seed (preview, modal, drag) | adapted | baselines | Docs scenarios differ: note open, typing latency, tree storm, preview/modal |
| **1C** YAZ-2078 Playwright E2E + REGRESSION.md | the feature-inventory suite | `desktop/e2e/` already has **~50 specs** incl. `drawing.spec.ts`, `yaseendraw.spec.ts`; no `docs/REGRESSION.md` | mostly done | — | Add REGRESSION.md only if wanted |
| **1D** YAZ-2079 glue tests (scheme privileges, engine selector pin…) | pin untested glue | `vaultProtocol.test.ts`, `preload/bridge.test.ts` exist; **no engine-owned CSS selectors** in client (grep) | adapted / partly done | — | Add a scheme-privileges pin before touching `index.ts:75` (4A) |
| **2A** YAZ-2081 quit flush restored + `runQuitSequence` | restored a deleted flush | `desktop/src/main/index.ts:207-215` flushes renderers → `store.flush()` + `flushIndexCache()` + `gitSync.flushForQuit()` | **done** (flush intact) | — | Two gaps: it uses `Promise.all`, so one rejection triggers `app.exit` while the git push is in flight (draw used `allSettled`); and it is not an extracted, tested module |
| **2B** YAZ-2082 fsync every atomicWrite | fsync before rename | `desktop/src/main/fs/fsUtils.ts:137-148`: `writeFile` → `rename`, **no fsync** | **as-is** | durability (crash/power loss) | ~5 ms per save; sites: file.ts:51, assets.ts:189, store.ts:310, vaultConfig.ts:118, vaultIndex/cache.ts:190 |
| **2B1** YAZ-2122 assets via tmp + fsync + link | content-addressed asset landing | `fs/assets.ts:189` writes assets through `atomicWrite` (named, not content-addressed) | adapted (covered by 2B) | — | No `landAssets` equivalent |
| **2C** YAZ-2083 watch subscribe/unsubscribe race | cancel a subscribe still resolving | `desktop/src/main/ipc/watch.ts:29-48`: `await requireDir` then `subs.set(...)`; an unsubscribe during the await finds nothing (`:54-55`) → **leaked watcher subscription** until the window dies | **as-is** | reliability (fd/CPU leak on fast vault switches) | Same shape as draw |
| **2D** YAZ-2084 Windows-safe containment | one `isWithin` | ~14 hand-written `${root}/` checks: main `favorites.ts:28`, `windows.ts:169`, `fs/assets.ts:71,123` (uses `path.sep`, OK); client `App.tsx:459,478,519,587`, `imageSrc.ts:38`, `treeState.ts:26,56,65`, `renameLinks.ts:287`, `renameDetector.ts:88` | **adapted** | Windows correctness (the app ships a `win` nsis target) | Main-side `/` checks are the real bugs on Windows |
| **2E** YAZ-2123 Canvas Background never saved | dirty covers persisted appState | `ExcalidrawSurface.tsx:141` + `DrawingModal.tsx:100` | **adapted** (F6, P3) | reliability: a lost edit | ET-D3 |
| **2F** YAZ-2124 spurious "changed on disk" bar | turned out to be a test artefact | docs conflict handling in the markdown editor (external-edit specs `foldExternalEdit.spec.ts`) | N/A (root cause was draw-test-specific) | — | Only the lesson transfers: the chokidar `awaitWriteFinish` window (`fs/watchers.ts:32`) widens real-conflict races |
| **2G** YAZ-2125 quit teardown | measured; locked "keep Chromium teardown" | same `index.ts:214` `app.exit(0)` | N/A (keep) | — | Draw found nothing in Node to close |
| **3A** YAZ-2086 LZMA DMG | UDZO → ULMO post-step | `tools/packDesktop.mjs:23` (electron-builder default); DMG measured **UDZO, 140.9 MB** | **as-is** | about −19 % DMG (draw ratio) = ≈ −27 MB (estimate) | size angle |
| **3B** YAZ-2087 trim Chromium locale paks | afterPack trim, keep app `.lproj` | `desktop/build/adhocSign.cjs:12-15` | **as-is** (Yasin approved it for draw: English-only users) | about −48.7 MB installed / −11 MB DMG (draw) | Same `Intl` trade-off; reuse the draw approval only if Yasin says so |
| **3C** YAZ-2088 fonts once | share-viewer reused the app's fonts | engine fonts ship once (`out/renderer/excalidraw-assets`); no share viewer | **done** | — | Residual 79 KB `assets/Assistant-*`; KaTeX ships ttf+woff+woff2 (798 KB of ttf/woff Chromium never picks) → renderer angle |
| **3D** YAZ-2089 minify renderer + hidden maps | `minify` + `sourcemap: 'hidden'` | `desktop/electron.vite.config.ts:84` no minify; entry chunk **4.85 MB** | **as-is** | JS ≈ −30–36 % (draw ratio); faster parse per window | renderer/launch angle |
| **3E** YAZ-2090 really bundle chokidar | chokidar was still `require`d | `out/main/index.js:8` `require("chokidar")`; asar has **17** `node_modules/{chokidar,readdirp}` entries; the comment at `electron.vite.config.ts:59-60` says bundled. Cause: electron-vite **5.0.0** `build.externalizeDeps` defaults to `true` | **as-is** | −17 asar files (tiny); stale comment/CONTRACTS | `main.build.externalizeDeps: false` + move chokidar to devDependencies |
| **4A** YAZ-2092 V8 code cache for app:// | `codeCache: true` | `desktop/src/main/index.ts:75` | **as-is** | draw: −29 ms canvas, −113 ms draw.io; here: the 4.85 MB entry plus 4 MB of engine on first preview (estimate, likely larger than draw's) | launch angle |
| **4B** YAZ-2093 engine at boot | preload engine for drawing windows | `drawingPreview.ts:134-135` (engine starts after `readAsset`) | adapted (weak) | a few ms (estimate) | Start `loadExcalidraw()` alongside the read; no boot preload (Keep) |
| **5A** YAZ-2095 upstream perf fixes | #12180/#12183 | vendor bump P1 | **as-is** | 4k drag ~390 → ~10 ms/step; 1k 37 → 17 | F1 |
| **5B** YAZ-2096 decode off-thread + hygiene | shipped hygiene only | vendor bump P1 | as-is (hygiene) | 3 fonts + 1 chunk less per modal open | F2 |
| **5B1** YAZ-2126 bitmaps under budget | Yasin chose option 2; not on the fork's origin | `<Excalidraw>` modal only | later (future bump) | only image-heavy drawings in the modal | F4 |
| **5C** YAZ-2097 preview thumbnails in main | stop shipping base64 over IPC for hover previews | images render via the vault protocol (`desktop/src/main/vaultProtocol.ts`), not base64 IPC; drawing previews are SVG from one sidecar | N/A | — | |
| **5D** YAZ-2098 sidebar render isolation | hover store, memo(Tree), resize without app churn | `client/src/App.tsx:181-209`: `setSidebarWidth` **per mousemove** re-renders App; `sidebar/Sidebar.tsx` 1,608 lines | **adapted** | smoother sidebar drag/hover (measure first) | smoothness angle |
| **5E** YAZ-2099 coalesce tree refresh | single-flight + trailing walk + debounce | `client/src/sidebar/Sidebar.tsx:538-545`: **every non-`change` watch event → full `api.tree(root)` walk**, no debounce, no single-flight, no stale-answer guard (`:522-531`) (`useViewOnlyCatalog.ts:51-58` does debounce) | **as-is** | the draw storm was 33 s CPU / 3.2 GB → 0.3 s / 114 MB | main/smoothness angle |
| **5F** YAZ-2100 recursive fs.watch | replace chokidar (per-file fds, 260 ms latency) | `desktop/src/main/fs/watchers.ts:28-34` chokidar with `awaitWriteFinish` 200 ms / 50 ms poll | **adapted** | draw: fds 2,335 → 0, latency 259 → 14 ms | Docs event semantics differ (`alwaysStat` mtime, `ready`); needs its own conformance suite; also feeds `vaultIndex/live.ts` and git sync |
| **5F1** YAZ-2130 FSEvents reopen race | early events lost on reopen | only with 5F | adapted (if 5F) | — | |
| **5G** YAZ-2101 save path; identical state writes; parallel quit flush | 1 parse/stringify; skip identical; parallel windows | markdown saves are strings (N/A); `store.ts:299-311` writes whenever `dirty`, even for an identical snapshot; `windows.ts:434-441` flushes **windows sequentially** (5 s cap each) | adapted | faster ⌘Q with many windows | |
| **5H** YAZ-2102 lean idle sync poll | 9 spawns/60 s → 2 | `git/manager.ts:11-24` has **no idle poll** (event/focus/wake-driven, 10 s focus cooldown); one pass = 5 detect spawns (`git/detect.ts:64-89`) + fetch + rev-list | **done** (different design) | — | Could trim detect spawns on focus passes (minor) |
| **5I** YAZ-2103 2.9 s first-pan gap | image-board investigation | — | N/A | — | canvas-only |
| **5J** YAZ-2104 memory: heap audit, bound caches, idle-RSS budget | audit + gate | `vaultIndex/live.ts:20` (10-min idle eviction, bounded), preview scene cache per editor mount (`drawingPreview.ts:129-143`) | adapted | measure-first | memory angle |
| **6A** YAZ-2106 IPC contract as data | one table generates preload + renderer | `desktop/src/channels.ts` (88) + `preload/index.ts` (207) + `main/ipc/*.ts` (2,675 incl. tests) + `client/src/api.ts` (95) + `shared/types.ts` | adapted | fewer LOC; drift-proof | Smaller win than draw's 1,229-line bridge; refactor angle |
| **6B** YAZ-2107 `useBoardDocument` for two editors | one save/conflict machine | one markdown editor (`client/src/lib/autosave.ts`) + an explicit-save modal | N/A | — | No second editor to merge |
| **6C** YAZ-2108 split Sidebar | feature hooks | `client/src/sidebar/Sidebar.tsx` 1,608 lines | adapted | readability only | refactor angle |
| **6D** YAZ-2109 validation helpers + seed kit | shared `require*` helpers | `desktop/src/main/fs/fsUtils.ts` (`requireAbsPath`, `requireDir`, `fsCall`…) | **done** (helpers exist) | — | Seed kit: `tools/prototypes/*` (5 scripts) could share `tools/lib/vault.mjs` |
| **7A** YAZ-2111 before/after table | publish via gates | — | as-is (process) | — | |
| **7B** YAZ-2112 packaged-app pass | DMG install, locales, fonts offline, Windows | `drawing.spec.ts` pins "fonts offline"; `.lproj` + locale check if 3B | as-is (process) | — | |
| **7C** YAZ-2113 demo vault + isolated dev app | Desktop demo | `YASEEN_DOCS_USER_DATA_DIR` (`main/index.ts:26`) already supports isolation | as-is (process) | — | |
| **8A/8B** YAZ-2115/2116 audit + polish | anti-slop pass | — | as-is (process) | — | Include stale-doc fixes: `docs/CONTRACTS.md:15,497` still say "`@excalidraw/excalidraw` PINNED to 0.18.1" (it is the yaseendraw fork tarball); `client/vendor/README.md:20` path |
| **Future YAZ-2117** WebKit readiness spike | before Tauri | — | N/A now (stay on Electron, D1) | — | |
| **Future YAZ-2118** incremental TreeIndex | incremental tree in main | the docs app already has an incremental **content** index in main (`vaultIndex/live.ts`, cold-start reconcile, persisted cache); the **tree** is still a full walk per request | partly done | — | Do 5E first; trigger as in draw D10 |
| **Future YAZ-2119** V8 startup snapshot | if launch misses target after 4A | — | adapted (conditional) | — | Only after 4A + 3D are measured |
| **Future YAZ-2120** engine vendoring model | prod-only tgz / LFS / registry | `client/vendor/*.tgz`, README recipe | adapted, shared | repo weight only | ET-D2 |
| **Future YAZ-2121** React Compiler spike | auto-memo | client (React 19.2) | adapted (spike) | unknown | After 5D-style isolation, as in draw |

## 7. Handoffs to other angles
- **Reliability:** F6/P3 (the Canvas-background edit is lost); 2C watch race at `ipc/watch.ts:29-48`; 2B no fsync at `fsUtils.ts:137-148`; quit uses `Promise.all` at `index.ts:213` (one rejection exits before the git push lands); main-side Windows `/` containment at `favorites.ts:28` and `windows.ts:169`.
- **Size/packaging:** DMG is UDZO 140.9 MB (3A); `node_modules/chokidar` + `readdirp` in the asar (17 entries) because electron-vite 5 `externalizeDeps` defaults to true (3E); locale paks (3B); KaTeX ttf+woff 798 KB unused next to woff2.
- **Launch:** `codeCache` missing at `index.ts:75` (4A); renderer unminified with a 4.85 MB entry at `electron.vite.config.ts:84` (3D).
- **Main process / smoothness:** `Sidebar.tsx:538-545` does a full tree walk per add/unlink event with no coalescing or stale-answer guard (5E); `App.tsx:181-209` re-renders App per mousemove on sidebar resize (5D); `windows.ts:434-441` sequential quit flush (5G).
- **Docs:** `docs/CONTRACTS.md:15,497` stale "PINNED to 0.18.1"; `client/vendor/README.md:20` stale `yaseen-milkdown` path.
