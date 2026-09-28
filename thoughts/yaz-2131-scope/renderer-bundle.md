# Renderer bundle — YAZ-2132 deep scope (angle: renderer-bundle)

Base `main` @ `63aeeea` (v0.9.27). Built output analysed: `desktop/out/renderer` (the lead's build).
Method: a renderer-only Vite build in SCRATCH that mirrors electron-vite 5's renderer preset
(`SCRATCH/rb/build.mjs`; base `./`, target `chrome142`, `minify: false`, modulePreload polyfill off)
plus a module-stats plugin. It reproduces the shipped renderer **byte-identically** (same 241 chunk
names and hashes), so every variant below differs from production only by the lever tested.
Variants: `out-baseline`, `out-min` (esbuild minify), `out-minmap` (+hidden maps), `out-lite` /
`out-minlite` (Crepe without the disabled features), `out-prop` (the exact proposed
`editor/crepe.ts` + minify + hidden maps), `out-nocm` (CodeMirror removed, to size a lazy-load),
`out-minlitevue` (Vue feature flags). Nothing tracked was edited.

Timing harness (`SCRATCH/rb/harness/main.js`): the repo's dev Electron 43 binary (NOT the Yaseen Docs
app), isolated `--user-data-dir=SCRATCH/profiles/renderer-bundle`, a fresh renderer process per run
with HTTP + V8 code caches cleared (matches today's `app://`, which has no code cache —
`desktop/src/main/index.ts:75`), static local server per variant, variants interleaved. Metric:
`domContentLoadedEventEnd` = fetch + compile + top-level evaluation of the entry module graph (the page
has no preload bridge, so this isolates script cost; it is not launch→usable). All processes quit;
`pgrep` confirms none left.

**Scope note (Yasin, mid-scope):** the drawing component is out of scope. Its bytes are reported on one
line and never counted as a lever.

## 1. Baseline numbers

| Metric (measured) | Today (v0.9.27) | Minify only | Minify + Crepe-lite (proposed) |
|---|---|---|---|
| Renderer minified? sourcemaps? | **No** (electron-vite 5 hard-codes `minify: false`, `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:536`); no maps | yes; hidden maps 34.7 MB moved out | yes; hidden maps 33.4 MB moved out |
| `build.target` | `chrome142` (electron-vite's newest map entry; Electron 43 falls back to it) — no down-levelling, no polyfills in our code | same | same |
| Entry chunk `index-*.js` (parsed every window open) | **4,850,821 B** (gzip 1,074,479) | 2,283,752 B (−52.9 %) | **1,936,154 B (−60.1 %)** (gzip 612,641) |
| Entry CSS `index-*.css` (render-blocking) | **277,906 B** | 183,329 B | **137,542 B (−50.5 %)** |
| KaTeX font files emitted (dead: Latex is disabled) | **59 files, 1,072,948 B** (+1 inlined as base64 in the entry CSS) | same | **0** |
| In-scope renderer bytes (entry + CodeMirror language chunks + entry CSS + KaTeX fonts) | **7,920,497 B** | 4,770,727 B | **≈3,304,000 B (−58 %)** |
| Whole `out/renderer` JS+CSS+`assets/` fonts (incl. drawing) | 20,786,409 B | 13,356,214 B | 11,900,336 B (−8.89 MB; ≈ app.asar 35.06 → ≈26.2 MB, estimated) |
| JS chunks | 241 (1 entry + 240 lazy) | 241 | 241 |
| Entry script cost, DCL median · p95, 21 runs, pass 1 (load avg 8–16) | 214 · 253 ms | 187 · 259 ms | 154 · 209 ms (lite, same bytes ±0.4 KB) |
| same, pass 2 (load avg 16–33) | 162 · 271 ms | 126 · 250 ms | 121 · 230 ms |
| same, pass 2 first 11 runs (quietest stretch) | 124 ms median | 107 ms | 101 ms |
| JS heap used after entry eval (no bridge) | 11.4 MB | 8.3 MB | 6.9 MB |
| `client` vitest suite with the proposed module | 3,562 pass (193 files) | — | **3,562 pass**; the 7–16 "removeEventListener is not defined" unhandled errors appear on untouched `main` too (see Handoffs) |

What is in the entry chunk today (unminified bytes by package, `stats-baseline.json`): `client/src` 858,700
(views 322 K, editor 212 K, sidebar 112 K) · **katex 601,182** · react-dom 561,467 · @codemirror/view 485,954 ·
prosemirror-view 247,597 · yaml 244,836 · @milkdown/crepe 176,883 · @milkdown/components 145,672 ·
@codemirror/state 145,460 · dompurify 129,063 · prosemirror-model 124,881 · @vue/runtime-core 122,816 ·
micromark-core-commonmark 109,701 · … (full list: `SCRATCH/rb/analyze.mjs stats-baseline.json`).

Minified attribution of the proposed entry (manualChunks probe, `out-attrib`): CodeMirror 431 K · prosemirror 260 K ·
milkdown 249 K · react+react-dom 193 K · client `views/` 171 K · markdown AST (micromark/mdast/unified) 120 K ·
client rest 119 K · client `editor/` 108 K · yaml 97 K · marked+dompurify 68 K · vue 63 K · client `sidebar/` 54 K ·
floating-ui/lodash 53 K.

Lazy (not loaded at startup) and in scope: 117 CodeMirror language chunks, 1,718,285 B → 1,230,161 B minified
(fetched only when a code block of that language renders). Nothing else in scope is lazy.

**Drawing component (out of scope, removable in the future gut):** 124 lazy JS chunks = 12,572,862 B unminified
(Excalidraw engine 4.29 MB, Mermaid/text-to-diagram + deps 6.72 MB incl. a second KaTeX copy
`mermaid/node_modules/katex`, 56 locale chunks 1.56 MB) + 207,235 B CSS + 13,556,480 B fonts
(`excalidraw-assets/`, 243 files) + 81,144 B Assistant woff2 duplicated into `assets/`. Zero startup cost (all
behind `loadExcalidraw()`, `client/src/drawings/renderScene.ts:51-58`). Minify (R1) incidentally shrinks its JS to
8.29 MB; not counted as a lever.

## 2. Findings (most impactful first)

### R1. The renderer ships unminified (−3.06 MB in-scope JS, entry 4.85 → 2.28 MB, ≈ −17 to −36 ms script cost)
- Evidence: `desktop/electron.vite.config.ts:84` sets no `minify`; electron-vite 5 defaults the renderer to
  `minify: false` (`lib-q6ns0vZr.js:536`). `out/renderer/assets/index-DM1KNA4f.js` is 131,118 lines of readable code.
  React is already the production build; Excalidraw resolves to its prebuilt `dist/prod` (already minified).
- Impact: size (−7.3 MB JS whole renderer, −3.06 MB in scope; CSS −95 KB), startup (entry compile/eval, measured
  above: medians −17 to −36 ms depending on load), memory (JS heap −3.1 MB after eval).
- Risk: none visible. `client/src` + `shared` have no `constructor.name` / `Function#toString` reliance (grep
  clean; `err.name` checks are on native errors). Stack traces become minified → hidden maps kept outside the app.
  CSS minify (esbuild, `cssTarget` = chrome142) merges/shortens only.
- Draw app: identical (draw 3D / YAZ-2089, D14: 14.68 → 9.40 MB, entry 973 → 413 KB). **Transfers as-is**, including
  the map-mover (`desktop/.maps/<version>/`), because electron-builder packs `out/**` (`desktop/package.json:25`).

### R2. Crepe's disabled Latex feature still puts KaTeX (+ remark-math, AI/top-bar code) in the entry chunk (−348 KB minified entry, −676 KB unminified)
- Evidence: `client/src/editor/featureConfig.ts:28` disables `CrepeFeature.Latex` (and ImageBlock, TopBar, AI), but
  `@milkdown/crepe`'s root module (`node_modules/@milkdown/crepe/lib/esm/index.js:1-50`) statically imports every
  feature (`import katex from 'katex'` line 31, `remark-math`, `@milkdown/kit/plugin/streaming|diff`) and picks them
  in a runtime `switch` (`loadFeature`, index.js:4315), so no bundler can drop them. Entry chunk carries
  `katex/dist/katex.mjs` 601,182 B + mdast-util-math/micromark-extension-math/remark-math ≈ 22 KB.
- Crepe ships the parts to avoid this: `@milkdown/crepe/builder` (`CrepeBuilder`, which `Crepe` extends) and one
  entry per feature (`@milkdown/crepe/feature/<name>`). `Crepe`'s constructor only (a) merges `defaultFeatures`,
  (b) applies `defaultConfig`, which is CodeMirror-only (`theme: oneDark`, `languages`, icons the feature entry
  already defaults, index.js:911-922), (c) loads enabled features in `defaultFeatures` key order (index.js:63-76).
  The proposed `client/src/editor/crepe.ts` reproduces exactly that for the 8 features the app enables.
- 🔒 Trap found while measuring: importing even one VALUE from the root (`CrepeFeature`) keeps katex in the bundle —
  the root module is side-effectful to Rollup (variant `out-real`: entry 2,209,263 B, katex present). Four
  production files do that today (`editor/createCrepe.ts:103`, `editor/featureConfig.ts:10`,
  `editor/outline/bulletsOnly.ts:27`, `views/view/PreviewCard.tsx:20`); the proposal re-points them and adds a guard
  test (fails on today's `main` with exactly those 4, verified). Type-only imports (40+ test files,
  `OutlineEditor.tsx:34`, `applyExternalMarkdown.ts:21`) stay as they are; `tsc` confirms the new instance is
  assignable to the package's `Crepe` type.
- Verified: whole `client` vitest suite (3,562 tests) green with production modules redirected to the proposed
  module (tests kept importing the real package); `tsc --strict` clean on the module.
- Impact: entry −348 KB minified (−15 % of the minified entry), JS heap after eval −1.4 MB, script cost −5 to −33 ms
  median (noisy; smaller share than R1).
- Risk to features: none intended — same features, same order, same configs, same CSS for them. Behavioural
  surface to smoke in the real app: code-block language picker + One Dark theme, slash menu (BlockEdit incl. the
  drawing row), selection toolbar (Heading group, Highlight), table handles, link tooltip, placeholder, hover
  preview card (`PreviewCard` passes BlockEdit/Toolbar off), bullets-only outline.
- Draw app: no equivalent (draw has no Crepe). New to this app.

### R3. `@milkdown/crepe/theme/common/style.css` ships KaTeX's stylesheet + 59 font files for the disabled Latex feature (−1.07 MB fonts, −46 KB entry CSS)
- Evidence: `client/src/main.tsx:5` imports the aggregate `style.css`, which `@import`s `latex.css`
  (`node_modules/@milkdown/crepe/lib/theme/common/latex.css:1` → `katex/dist/katex.min.css`), so Vite emits all 59
  KaTeX woff2/woff/ttf (1,072,948 B) and inlines one more as base64 into the render-blocking CSS. It also pulls
  `top-bar.css`, `ai.css`, `diff.css` (AI diff review) for features the app disables.
- Every selector in those four files is scoped to that feature's own classes (`.milkdown-latex-*`,
  `span[data-type='math_inline']`, `.milkdown-top-bar`, `.ai-instruction-*`, `.milkdown-diff-*`, plus the
  `--crepe-color-diff-*` vars); `client/src` references none of them (grep clean). Mermaid (drawing, out of scope)
  renders KaTeX as MathML in Chromium (`mermaid.core chunk-DU6HZSFF.mjs:5236`), so it never needed this CSS either.
- `image-block.css` stays (BlockEdit's code imports the image-block component; the cost is 11 KB and keeping it
  removes any doubt).
- Impact: −1.07 MB on disk / in the asar, −46 KB render-blocking CSS (minified), 59 fewer files.
- Risk: none visible (unused selectors only). Draw app: no equivalent.

### R4. Hidden sourcemaps must not ship (enabler for R1)
- `sourcemap: 'hidden'` writes 241 `.map` files (33.4 MB for the proposed build). electron-builder's
  `files: ["out/**"]` (`desktop/package.json:25`) would pack them all. Move them to `desktop/.maps/<version>/`
  in `writeBundle` exactly like draw 3D. `.gitignore` gains `desktop/.maps/`.

### R5. Checked and clean
- One React: `dedupe` (`electron.vite.config.ts:82`) works — only `client/node_modules/react{,-dom}` in the bundle,
  production builds. One prosemirror-*, one @codemirror/*, one lodash-es, one vue, one dompurify/marked/yaml.
- The only duplicate library copies (`katex` ×2, `roughjs` ×2, `clsx` ×2) are inside the drawing component (out of scope).
- No legacy target, no polyfills in our code (`roundRect` polyfill chunk is the drawing engine's).
- No locale chunks in scope (all 56 are Excalidraw's).

## 3. Proposed changes

### P1 (R1 + R4) Minify the renderer; hidden maps moved out of the app — `desktop/electron.vite.config.ts`
```diff
@@ -4,4 +4,4 @@
-import { createReadStream, existsSync } from 'node:fs'
-import { cp } from 'node:fs/promises'
+import { createReadStream, existsSync, readFileSync } from 'node:fs'
+import { cp, mkdir, rename, rm } from 'node:fs/promises'
 import { fileURLToPath } from 'node:url'
-import { resolve } from 'node:path'
+import { dirname, resolve } from 'node:path'
@@ -55,3 +55,25 @@
 }
 
+/**
+ * Hidden renderer sourcemaps, kept OUTSIDE the app (YAZ-2131; the draw app's D14 / YAZ-2089).
+ * `sourcemap: 'hidden'` writes one `.map` per chunk with no `sourceMappingURL` comment; this moves
+ * every one to gitignored `desktop/.maps/<version>/` (that folder replaced whole per build), so
+ * electron-builder's `files: ["out/**"]` never packs them. Stacks symbolicate locally from there.
+ */
+function sourcemapsAside(): Plugin {
+  return {
+    name: 'yaseen-sourcemaps-aside',
+    apply: 'build',
+    async writeBundle(_options, bundle) {
+      const { version } = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string }
+      const dest = resolve(here, '.maps', version)
+      await rm(dest, { recursive: true, force: true })
+      for (const file of Object.keys(bundle).filter((f) => f.endsWith('.map'))) {
+        await mkdir(dirname(resolve(dest, file)), { recursive: true })
+        await rename(resolve(rendererOut, file), resolve(dest, file))
+      }
+    },
+  }
+}
+
 export default defineConfig({
@@ -71,1 +93,1 @@
-    plugins: [react(), excalidrawAssets()],
+    plugins: [react(), excalidrawAssets(), sourcemapsAside()],
@@ -84,1 +106,3 @@
-    build: { outDir: rendererOut, rollupOptions: { input: resolve(client, 'index.html') } },
+    // Minified, hidden maps moved out by `sourcemapsAside()` (YAZ-2131). electron-vite 5 hard-codes
+    // `minify: false` for the renderer; main + preload stay readable (≈0.4 MB).
+    build: { outDir: rendererOut, minify: 'esbuild', sourcemap: 'hidden', rollupOptions: { input: resolve(client, 'index.html') } },
```
`.gitignore`
```diff
@@ -3,2 +3,3 @@
 desktop/out/
 desktop/dist-app/
+desktop/.maps/
```
After this, the behavior is identical; the renderer is 7.3 MB smaller (3.06 MB of it in scope), the entry chunk is
2.28 MB instead of 4.85 MB, and no `.map` or `sourceMappingURL` reaches the asar. Tests to add (as draw 3D): a
unit test for the mover (moves every map with its path, leaves none under `out/`, idempotent on rebuild), and a
packaged-app check that no `.map` is in `app.asar`. Smoke every lazy door: a note with a code block (language
chunk loads), hover preview card, drawing open (must keep working even though out of scope).

### P2 (R2) Crepe from its own parts, only the features the app loads — new `client/src/editor/crepe.ts`
```diff
--- /dev/null
+++ b/client/src/editor/crepe.ts
@@ -0,0 +1,85 @@
+/**
+ * Crepe, with ONLY the features this app loads (YAZ-2131 renderer-bundle R2).
+ *
+ * `@milkdown/crepe`'s root module imports every feature statically — `loadFeature()` is a switch,
+ * so no bundler can drop the disabled ones — and `katex` (+ `remark-math`, the AI/top-bar code)
+ * rode into the main chunk although `featureConfig.ts` turns Latex off. Here the same class is
+ * rebuilt from Crepe's own public parts: `CrepeBuilder` plus the per-feature entry points, loaded
+ * in Crepe's own order with Crepe's own CodeMirror defaults.
+ *
+ * 🔒 Nothing in the renderer may import a VALUE from '@milkdown/crepe' (types are fine): the root
+ * module has side effects in the bundler's eyes, so one value import brings katex back.
+ */
+import { CrepeBuilder } from '@milkdown/crepe/builder'
+import { blockEdit } from '@milkdown/crepe/feature/block-edit'
+import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
+import { cursor } from '@milkdown/crepe/feature/cursor'
+import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
+import { listItem } from '@milkdown/crepe/feature/list-item'
+import { placeholder } from '@milkdown/crepe/feature/placeholder'
+import { table } from '@milkdown/crepe/feature/table'
+import { toolbar } from '@milkdown/crepe/feature/toolbar'
+import type { CrepeConfig, CrepeFeature as CrepeFeatureEnum } from '@milkdown/crepe'
+import { languages } from '@codemirror/language-data'
+import { oneDark } from '@codemirror/theme-one-dark'
+
+/** The enum's values, without importing the module that declares it (`crepe.test.ts` pins equality). */
+export const CrepeFeature = {
+  CodeMirror: 'code-mirror',
+  ListItem: 'list-item',
+  LinkTooltip: 'link-tooltip',
+  Cursor: 'cursor',
+  ImageBlock: 'image-block',
+  BlockEdit: 'block-edit',
+  Toolbar: 'toolbar',
+  Placeholder: 'placeholder',
+  Table: 'table',
+  Latex: 'latex',
+  TopBar: 'top-bar',
+  AI: 'ai',
+} as unknown as typeof CrepeFeatureEnum
+export type CrepeFeature = CrepeFeatureEnum
+
+type Loader = (editor: CrepeBuilder['editor'], config?: never) => void
+/** Bundled features. A feature missing here throws at construction instead of silently vanishing. */
+const LOADERS: Partial<Record<CrepeFeature, Loader>> = {
+  [CrepeFeature.Cursor]: cursor as Loader,
+  [CrepeFeature.ListItem]: listItem as Loader,
+  [CrepeFeature.LinkTooltip]: linkTooltip as Loader,
+  [CrepeFeature.BlockEdit]: blockEdit as Loader,
+  [CrepeFeature.Placeholder]: placeholder as Loader,
+  [CrepeFeature.Toolbar]: toolbar as Loader,
+  [CrepeFeature.CodeMirror]: codeMirror as Loader,
+  [CrepeFeature.Table]: table as Loader,
+}
+/** Crepe's `defaultFeatures`, in its key order (= its load order). */
+const DEFAULT_FEATURES: Record<CrepeFeature, boolean> = {
+  [CrepeFeature.Cursor]: true,
+  [CrepeFeature.ListItem]: true,
+  [CrepeFeature.LinkTooltip]: true,
+  [CrepeFeature.ImageBlock]: true,
+  [CrepeFeature.BlockEdit]: true,
+  [CrepeFeature.Placeholder]: true,
+  [CrepeFeature.Toolbar]: true,
+  [CrepeFeature.CodeMirror]: true,
+  [CrepeFeature.Table]: true,
+  [CrepeFeature.Latex]: true,
+  [CrepeFeature.TopBar]: false,
+  [CrepeFeature.AI]: false,
+}
+
+export class Crepe extends CrepeBuilder {
+  static Feature = CrepeFeature
+  constructor({ features = {}, featureConfigs = {}, ...builderConfig }: CrepeConfig = {}) {
+    super(builderConfig)
+    const enabled = { ...DEFAULT_FEATURES, ...features }
+    for (const feature of Object.keys(enabled) as CrepeFeature[]) {
+      if (!enabled[feature]) continue
+      const load = LOADERS[feature]
+      if (load === undefined) throw new Error(`Crepe feature "${feature}" is not bundled (editor/crepe.ts)`)
+      // Crepe's own `defaultConfig` is CodeMirror-only: the One Dark theme + the language list.
+      const config = feature === CrepeFeature.CodeMirror ? { theme: oneDark, languages, ...featureConfigs[feature] } : featureConfigs[feature]
+      load(this.editor, config as never)
+    }
+  }
+}
```
Re-point the four production value imports (types elsewhere stay on the package):

`client/src/editor/createCrepe.ts`
```diff
@@ -103,1 +103,1 @@
-import { Crepe, CrepeFeature } from '@milkdown/crepe'
+import { Crepe, CrepeFeature } from './crepe'
```
`client/src/editor/featureConfig.ts`
```diff
@@ -10,1 +10,1 @@
-import { CrepeFeature } from '@milkdown/crepe'
+import { CrepeFeature } from './crepe'
```
`client/src/editor/outline/bulletsOnly.ts`
```diff
@@ -27,1 +27,1 @@
-import { CrepeFeature, type Crepe } from '@milkdown/crepe'
+import { CrepeFeature, type Crepe } from '../crepe'
```
`client/src/views/view/PreviewCard.tsx`
```diff
@@ -20,1 +20,1 @@
-import { CrepeFeature } from '@milkdown/crepe'
+import { CrepeFeature } from '../../editor/crepe'
```
Guard test, new `client/src/editor/crepe.test.ts` (verified: the second test fails on today's `main` listing
exactly the four files above; the first passes):
```diff
--- /dev/null
+++ b/client/src/editor/crepe.test.ts
@@ -0,0 +1,28 @@
+import { readdirSync, readFileSync } from 'node:fs'
+import { join, relative } from 'node:path'
+import { fileURLToPath } from 'node:url'
+import { describe, expect, it } from 'vitest'
+import { CrepeFeature as CrepeFeatureEnum } from '@milkdown/crepe'
+import { CrepeFeature } from './crepe'
+
+/** `client/src` — every production module of the renderer. */
+const SRC = fileURLToPath(new URL('..', import.meta.url))
+
+function sourceFiles(dir: string): string[] {
+  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
+    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
+  )
+}
+
+describe('editor/crepe (YAZ-2131 R2)', () => {
+  it('mirrors every CrepeFeature value of the installed Crepe', () => {
+    expect({ ...CrepeFeature }).toEqual({ ...CrepeFeatureEnum })
+  })
+
+  it('no production module imports a VALUE from the @milkdown/crepe root — one would bring katex back into the main chunk', () => {
+    const offenders = sourceFiles(SRC)
+      .filter((f) => /^import\s+(?!type\s)[^\n]*from '@milkdown\/crepe'/m.test(readFileSync(f, 'utf8')))
+      .map((f) => relative(SRC, f))
+    expect(offenders).toEqual([])
+  })
+})
```
After this, the behavior is identical (same 8 features, same load order, same configs; full `client` suite green
with it), and KaTeX / remark-math / the AI + top-bar feature code leave the main chunk: entry −348 KB minified.
`featureConfig.test.ts` keeps pinning the running feature set; a Crepe upgrade that adds a feature still fails
`typecheck` (the `Record<CrepeFeature, boolean>` in `featureConfig.ts`) and now also fails `crepe.test.ts` until
`crepe.ts` mirrors it.

### P3 (R3) Import Crepe's theme per feature, without Latex / TopBar / AI / diff — `client/src/main.tsx`
```diff
@@ -5,1 +5,13 @@
-import '@milkdown/crepe/theme/common/style.css'
+// Crepe's common theme minus the features featureConfig.ts disables (YAZ-2131): latex.css alone pulls
+// KaTeX's stylesheet and its 59 font files. Same order as Crepe's own theme/common/style.css.
+import '@milkdown/crepe/theme/common/prosemirror.css'
+import '@milkdown/crepe/theme/common/reset.css'
+import '@milkdown/crepe/theme/common/block-edit.css'
+import '@milkdown/crepe/theme/common/code-mirror.css'
+import '@milkdown/crepe/theme/common/cursor.css'
+import '@milkdown/crepe/theme/common/image-block.css'
+import '@milkdown/crepe/theme/common/link-tooltip.css'
+import '@milkdown/crepe/theme/common/list-item.css'
+import '@milkdown/crepe/theme/common/placeholder.css'
+import '@milkdown/crepe/theme/common/toolbar.css'
+import '@milkdown/crepe/theme/common/table.css'
```
After this, the editor looks the same (only selectors for disabled features are gone) and the renderer no longer
ships 59 KaTeX fonts (−1.07 MB) or the KaTeX CSS (render-blocking CSS −46 KB minified). Visual check: the
`theme.spec` / `contentWidth.spec` style screenshots, run by the implementer under the lead's e2e safety rules.

Suggested budget rows for the safety net (1A-style gate): entry JS ≤ 2.0 MB, entry CSS ≤ 145 KB, no `katex` module
in the entry chunk, no `KaTeX_*` asset, no `.map` / `sourceMappingURL` in `app.asar`.

## 4. Decisions Yasin must make

None from this angle. R1–R3 change no visible behavior. (Minified renderer + maps kept aside is already a locked
draw decision, D14; the docs app inherits it.)

## 5. Keep as-is (measured, not worth it)

- **Lazy-loading CodeMirror** (code blocks): measured upper bound −232 KB entry (1,935,802 → 1,704,006 B,
  `out-nocm`) and −7.5 ms DCL median (99 → 92 ms, 15 runs, load 9–21). A real split needs a placeholder node view
  swapped for CodeMirror on first code block → visible flash + Crepe patching. Not worth it (same verdict class as
  draw D15).
- **Code-splitting client views** (folder-page table/board, properties UI, `views/` 171 KB minified + yaml 97 KB):
  `views/` is imported by core paths (`hooks/useFile.ts:5` → `migrateFolderBody` → yaml, `sidebar/Sidebar.tsx:7-12`,
  `editor/FrontmatterPanel.tsx:18-23`, `links/renameLinks.ts:52`), so only the leaf view components could split;
  estimated ≤ 5 ms (smaller than the measured CodeMirror bound) for Suspense flicker on first folder page. Draw D15
  reached the same verdict for its dialogs (≤ 3 ms).
- **marked + dompurify** (comments rendering, 68 KB minified): small, used on the note surface.
- **Vue feature flags** (`__VUE_OPTIONS_API__` etc. via `define`): −6.9 KB only (`out-minlitevue`); not worth a
  config line.
- **CodeMirror language chunks** (117 lazy, 1.23 MB minified): already on demand, zero startup cost; removing
  languages would be feature loss.
- **`build.target`**: already `chrome142`, nothing to trim.
- Everything in the drawing component (Excalidraw locales/fonts/Mermaid/second KaTeX): out of scope by Yasin's note.

## 6. Handoffs to other angles

- **Packaging/main:** chokidar is NOT bundled — `desktop/out/main/index.js:8` `require("chokidar")` and
  `app.asar` ships `node_modules/chokidar` + `readdirp`, contradicting `electron.vite.config.ts:59-60` (same bug as
  draw 3E).
- **Launch:** `app://` has no V8 code cache (`desktop/src/main/index.ts:75` lacks `codeCache: true`; draw D13) — the
  1.9 MB entry is recompiled every launch; code cache + R1 compound.
- **Test reliability:** `client` vitest runs print 7–16 unhandled "ReferenceError: removeEventListener is not
  defined" from `@milkdown/ctx` `Timer` after jsdom teardown, in random editor test files, on untouched `main`
  under load (e.g. `imageView.test.ts`, `inlineBreaks.test.ts`, `zoom.test.ts`); editors created in tests are not
  destroyed/awaited before teardown.
- **Safety net:** no renderer bundle budget exists in this repo; add the rows listed under P3.
- **Main process:** `out/main/chunks/file-*.js` 270 KB unminified (a bundled dependency); main/preload stay
  unminified by draw's precedent — fine.

## Artifacts
`SCRATCH/rb/`: `build.mjs` (variant builder), `analyze.mjs`, `sizes.sh`, `stats-*.json` (per-chunk module sizes),
`out-*` (built variants), `harness/main.js` + `timing21.txt`, `timing21b.txt` (DCL runs), `tc/crepe.ts` +
`tc/crepe.test.ts` (typechecked proposal), `vt-*.log` (vitest runs), `vitest.prop.config.mjs`.
