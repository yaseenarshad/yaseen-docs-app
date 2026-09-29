# Size forensics: Yaseen Docs v0.9.27 (main @63aeeea)

Angle: SIZE-FORENSICS. Read-only on the repo. All work files are in `SCRATCH/size/`: the extracted asar, the minify scripts, the sim apps and the DMGs.
Load during measurement: `uptime` load average was 37 / 20 / 10 because other agents were running. Size numbers don't depend on load. MB = 10^6 bytes unless it says MiB.

## 1. Baseline numbers (all measured)

### Installed .app (`desktop/dist-app/mac-arm64/Yaseen Docs.app`)
| Part | Bytes | Notes |
|---|---|---|
| **Whole .app (apparent, sum of file sizes)** | **324.67 MB** (309.6 MiB) | `du -sk` gives 317,984 KiB |
| Electron Framework.framework | 287.6 MB (280,900 KiB) | |
| ├ `Electron Framework` binary | 192.54 MB | arm64 only (not fat). Not shrinkable |
| ├ Resources/ (67.0 MB) | | |
| │ ├ **220 `*.lproj/locale.pak`** | **48.66 MB** | 55 languages × plain/FEMININE/MASCULINE/NEUTER. 55 real paks and 165 stubs of 18 B. `en*` = 1.12 MB |
| │ ├ icudtl.dat | 10.88 MB | ICU. Required |
| │ ├ resources.pak | 7.23 MB | required |
| │ ├ v8_context_snapshot.arm64.bin | 0.74 MB | required |
| │ └ chrome_100/200_percent.pak | 0.32 MB | required |
| ├ Libraries/ (24.6 MB) | | |
| │ ├ libvk_swiftshader.dylib | 16.57 MB | software-GL fallback |
| │ ├ libGLESv2.dylib | 6.25 MB | ANGLE. Required |
| │ ├ libffmpeg.dylib | 2.23 MB | media |
| │ └ libEGL.dylib | 0.09 MB | |
| └ Helpers/chrome_crashpad_handler | 1.23 MB | |
| 4 Helper apps + Squirrel/Mantle/ReactiveObjC | 1.8 MB | Squirrel is dead weight (no auto-updater) but only 0.3 MB and electron-builder always ships it |
| **Resources/app.asar** | **35.06 MB** | breakdown below |
| Resources/icon.icns | 1.02 MB | |
| Resources/bin (extraResources `build/bin`) | 403 B | `yaseendocs` CLI shim |
| Resources/*.lproj (55 app-level markers) | 0 B | empty dirs. They make Open/Save panels follow the OS language. **Keep** |

### app.asar (extracted to `SCRATCH/size/asar`, 567 files)
| Part | Bytes | Notes |
|---|---|---|
| out/renderer/assets JS (241 chunks) | **19.15 MB** | **unminified**. electron-vite 5 hard-codes renderer `minify: false` (`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:536`) |
| ├ entry `index-DM1KNA4f.js` | **4.85 MB**, 131,118 lines | parsed on every window open |
| ├ percentages (2.28), subset-shared (1.84, has an embedded base64 wasm), cynefin (1.30), index-DH (1.22), cytoscape (0.96), katex (0.48), mermaid diagrams… | | all lazy |
| out/renderer/assets CSS (2 files) | 0.49 MB | unminified. Carries 3 tiny inline CSS sourcemaps (~0.9 KB, from Milkdown) |
| out/renderer/assets KaTeX fonts | 1.15 MB | 20 woff2 (0.33 MB) + **20 woff (0.30 MB) + 20 ttf (0.51 MB)** |
| out/renderer/assets Assistant woff2 ×4 | 0.08 MB | byte-identical to `excalidraw-assets/fonts/Assistant/*` (sha1) |
| out/renderer/excalidraw-assets/fonts (243 woff2) | **13.7 MB** | 12.78 MB is Xiaolai (CJK). Copied by `desktop/electron.vite.config.ts:51-53`. **One copy only** (the docs app has no share-viewer) |
| out/main (index.js 133 KB + chunks/file 271 KB) + cli.js 8 KB | 0.41 MB | unminified; the shared chunk is reused by cli.js |
| out/preload | 0.01 MB | |
| **node_modules/chokidar + readdirp** | **0.17 MB** | **load-bearing**: `out/main/index.js:8` `require("chokidar")` |
| sourcemaps (`*.map`) | 0 | none shipped |
| Duplicate files (sha1) | 8 groups, ≈0.1 MB | Assistant ×4, 3 identical locale or diagram chunk pairs, 2 `esm/package.json`. Negligible |

### DMG (`Yaseen Docs-0.9.27-arm64.dmg`)
| Format | Bytes | Measured how |
|---|---|---|
| **UDZO zlib (as shipped)** | **140.91 MB** | `hdiutil imageinfo`: "UDIF read-only compressed (zlib)", HFS+ |
| ULFO (lzfse) | 140.19 MB | `hdiutil convert` |
| UDBZ (bzip2, `compression: "maximum"`) | 129.49 MB | `hdiutil convert` |
| **ULMO (lzma)** | **108.73 MB (−32.2, −22.8 %)** | `hdiutil convert`, 11.4 s wall under load |

## 2. Findings (most impactful first)

### F1: DMG is zlib. LZMA (ULMO) saves 32.2 MB of download
- Evidence: `imageinfo` shows zlib. `node_modules/dmg-builder/out/dmg.js:122-131` picks UDZO unless `compression: "maximum"`, which gives UDBZ and only −11.4 MB. `desktop/package.json:47` sets no format, and electron-builder's schema has no ULMO, so this has to be a post-step.
- Impact: download 140.91 → **108.73 MB measured**. Installed size is unchanged. Build time goes up about 11–15 s.
- Risk: none. ULMO needs macOS 10.15+, and Electron 43 already needs 12+. Nothing reads the `.blockmap`: there is no electron-updater or autoUpdater in `desktop/src` (grep is empty). `release.yml:26` uploads `desktop/dist-app/*.dmg` only.
- Draw: **3A / YAZ-2086**. Transfers **as-is**, but take the landed version (convert → attach → `codesign --verify --deep --strict` on the mounted app → replace → drop blockmap), not the issue's first `hdiutil verify` sketch. Draw's gotcha applies: never convert an image that `hdiutil create` just made and left attached.

### F2: Chromium locale paks: 48.66 MB installed, ≈8.8 MB DMG
- Evidence: 220 `Electron Framework.framework/Versions/A/Resources/*.lproj/locale.pak` add up to 48,655,444 B. Only 8 `en*` dirs (1.12 MB) are needed for an English UI. `desktop/build/adhocSign.cjs:12-16` does nothing to them.
- Measured sim (`SCRATCH/size/sim/stage-loc`, trim then ad-hoc re-sign, `codesign --verify --deep --strict` OK):
  - installed apparent 324.67 → **277.06 MB (−47.6)**
  - DMG under ULMO 109.35 → **100.51 MB (−8.8)**; under zlib-9 139.85 → 127.92 (−11.9). These are harness numbers, so read them as deltas.
- **Docs-specific side-effect (the same one draw found, and it touches more surface here).** On a non-English macOS, `navigator.language` and the default `Intl` locale become en-US. In the docs app that changes:
  - sort order in folder views, outlines and property options (`new Intl.Collator(undefined, …)` at `client/src/views/folderSync.ts:26`, `views/engine.ts:249`, `views/folderPageSettings.ts:365`, `views/outlineDoc.ts:107`, `views/view/OutlineView.tsx:95`, `shared/propertyOptions.ts:19`)
  - the sidebar Topics sort (`client/src/sidebar/TopicsTree.tsx:215` `localeCompare`)
  - the view `sort()` expression (`views/expr/methods.ts:116`)
  - comment timestamp format (`comments/CommentsSection.tsx:395,399` `toLocaleString()`)
  - Chromium-drawn strings such as validation bubbles
  - Open/Save panels still follow the OS language, because the 55 app-level `Contents/Resources/*.lproj` markers are kept.
  - On an English Mac nothing changes. Measured: `navigator.language` is `en-US` on both the base and the trimmed sim.
- Draw: **3B / YAZ-2087**. First parked for exactly this reason, then landed after Yasin approved it ("the app is English only"). Transfers **adapted**: same afterPack trim, but the list of affected surfaces above is docs-specific. That is why this is still listed as decision D1 below. It is not a silent carry-over.
- Windows: the hook returns early on non-darwin (`adhocSign.cjs:13`), so `win-unpacked/locales/*.pak` (55 files) ship in full. Draw trimmed them to `en-US.pak` + `en-GB.pak` for −8.4 MB of installer. Estimated similar here (not built).

### F3: Renderer ships unminified: −7.4 MB installed, −1 to −2 MB DMG, entry chunk 4.85 → 2.29 MB
- Evidence: `desktop/electron.vite.config.ts:84` sets no `minify`, and electron-vite forces `false` (`lib-q6ns0vZr.js:536`). The entry chunk has 131k lines.
- Measured by esbuild 0.28.2 per-chunk minify (`SCRATCH/size/minify.mjs`: `minify:true, format:'esm', target:'chrome140', charset:'utf8', legalComments:'none'`):
  - JS 19.15 → **11.81 MB (−7.34)**
  - CSS 0.485 → 0.391 (−0.09)
  - entry 4.85 → **2.29 MB (−53 %)**
- Proven safe on the sim app:
  - the minified app boots to Welcome
  - **all 240 renderer chunks `import()` with 0 failures**, same as base (`SCRATCH/size/sim/probe.mjs`, isolated `YASEEN_DOCS_USER_DATA_DIR`, CDP)
- DMG gain is small because whitespace compresses well: minify plus the KaTeX fonts in F4 together are −1.1 MB under ULMO and −1.5 MB under zlib-9.
- The real win is parse and compile per window. The entry is parsed on every window open. Hand to the launch angle to time it.
- Risk: `Function.name` or `constructor.name` reliance. Draw's grep found none. Re-grep `client/src` and `shared` before landing. Stacks become unreadable without maps, so keep hidden maps outside the app.
- Draw: **3D / YAZ-2089** (D14). Transfers **as-is**: `minify: 'esbuild', sourcemap: 'hidden'` plus a `writeBundle` plugin that moves `out/renderer/**/*.map` into gitignored `desktop/.maps/<version>/`. Without that plugin, `files: ["out/**"]` (`desktop/package.json:25`) would ship the maps. Main and preload stay unminified (0.42 MB, readable crash stacks).

### F4: KaTeX ships 3 font formats, and Chromium only ever loads woff2: −0.82 MB installed
- Evidence: `@milkdown/crepe/theme/common/latex.css` does `@import 'katex/dist/katex.min.css'`, which is pulled in by `client/src/main.tsx:5`. Each `@font-face` lists `woff2`, then `woff`, then `ttf`, so Vite emits all 60 files. The 20 woff + 20 ttf = **816,780 B** are never requested, because Chromium picks the first supported format and woff2 is always supported.
- Impact: −0.82 MB installed and ≈−0.3 MB DMG (estimated; it's inside the F3 sim's −1.1). Math rendering does not change.
- Risk: very low. It needs a ~10-line Vite `transform` that removes the `,url(...woff) format("woff"),url(...ttf) format("truetype")` tails from `katex.min.css`, so Vite never emits those files. Check it with the e2e math render (fonts still load, 0 failed requests).
- Draw: no equivalent (draw has no KaTeX CSS). **New for docs.** Marginal, so optional.

### F5: chokidar is not bundled. The config comment is false and `node_modules` ships in the asar
- Evidence:
  - `desktop/electron.vite.config.ts:59-60` says "No externalizeDepsPlugin: chokidar 4 is pure JS and gets bundled".
  - electron-vite 5 externalizes deps by default (`lib-q6ns0vZr.js:1636` `config.build?.externalizeDeps ?? true`).
  - So `out/main/index.js:8` is `require("chokidar")`, and `node_modules/chokidar` + `readdirp` (0.17 MB) sit in the asar.
- Impact:
  - size is about −0.1 MB net once the code is inlined into main
  - main is the correctness/trap issue: moving chokidar to devDependencies without the config change would break file watching in the packaged app
- Draw: **3E / YAZ-2090**. Transfers **as-is**: `build.externalizeDeps: false` for main and preload, chokidar moved to devDependencies, and a gate that the asar has no `node_modules`. Note that main here has **two entries** (`index`, `cli`). `cli.js` does not need chokidar and is unaffected (it requires only `./chunks/file-*.js` plus Node builtins).

### F6: Excalidraw fonts 13.7 MB already ship once. Nothing to dedupe
- Evidence: the only copy is `out/renderer/excalidraw-assets/fonts` (243 woff2). There is no share-viewer or extraResources duplicate (`desktop/package.json:26` is only `build/bin`). The one byte-level overlap is Assistant ×4 (80 KB), where the engine CSS emits its own hashed copy.
- Draw **3C / YAZ-2088** does **not transfer**: it removed the share-viewer duplicate, and the docs app has none.
- The fonts must stay. They enforce the offline rule (CONTRACTS.md:497 on drawing previews, and the YAZ-879 modal). Removing Xiaolai would make CJK text fall back to esm.sh. See Keep-as-is.

### F7: Windows (NSIS) levers (not built; estimates only)
- `desktop/package.json:37-46`: nsis x64, with no `compression` and no `differentialPackage` set. `NsisTarget.js:67` makes the 7z **differential-aware** (blockmap-friendly, non-solid chunks) by default.
- Nothing uses differential updates (no updater), so `"differentialPackage": false` allows a solid 7z. Estimated a few MB smaller, **not measured**. It needs a `desktop:build:win` run on a Windows runner to quantify.
- The locale trim (F2) on `win-unpacked/locales` is the bigger Windows lever. Draw measured 140.4 → 132.0 MB installer.
- `compression: "maximum"` would also flip the Mac DMG to UDBZ (`dmg.js:130`), which is worse than ULMO. **Don't set it globally.** If you want it, set it under `win` only.

### F8: Repo side (does not affect app size; noted only)
- `client/vendor` is 33 MB on disk. `yaseendraw-excalidraw-0.18.0-9e63bdf2.tgz` alone is **32.8 MB**.
- Git history holds 10 vendor blobs, 34.3 MB raw, and the whole pack is 41.29 MiB. The tarballs are already gzip, so git can't delta or compress them. **Every engine re-vendor adds ~33 MB to clone size permanently.**
- An option for later, outside this project: Git LFS or a GitHub Release asset for the vendored tgz. It's a repo-hygiene decision, not an app-size one.

## 3. Proposed changes (diffs against the current files)

### 3A: LZMA DMG post-step (`tools/packDesktop.mjs`)
```diff
@@ -10,18 +10,40 @@
 import { execFileSync } from 'node:child_process'
-import { readFileSync } from 'node:fs'
+import { readFileSync, renameSync, rmSync } from 'node:fs'
 import { dirname, join } from 'node:path'
 import { fileURLToPath } from 'node:url'
 
 const root = join(dirname(fileURLToPath(import.meta.url)), '..')
 const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
 const args = process.argv.slice(2)
 if (args.length === 0) {
   console.error('usage: node tools/packDesktop.mjs --mac | --win')
   process.exit(2)
 }
 const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
 execFileSync(npm, ['exec', '-w', 'desktop', '--', 'electron-builder', ...args, `-c.extraMetadata.version=${version}`], {
   cwd: root,
   stdio: 'inherit',
   shell: process.platform === 'win32',
 })
+
+/**
+ * Recompress the Mac image zlib → lzma (ULMO; macOS 10.15+, Electron 43 needs 12+): 140.9 → 108.7 MB,
+ * same volume, layout and signed .app. electron-builder's schema has no ULMO, so it is a post-step.
+ * The image is attached (checksum-checked) and its app seal verified BEFORE it replaces the original;
+ * the .blockmap described the zlib image and nothing reads it (no auto-updater), so it goes.
+ */
+if (args.includes('--mac')) {
+  const dmg = join(root, 'desktop', 'dist-app', `Yaseen Docs-${version}-arm64.dmg`)
+  const tmp = `${dmg}.ulmo.dmg`
+  const mnt = `${dmg}.mnt`
+  rmSync(tmp, { force: true })
+  execFileSync('hdiutil', ['convert', dmg, '-format', 'ULMO', '-o', tmp], { stdio: 'inherit' })
+  execFileSync('hdiutil', ['attach', tmp, '-nobrowse', '-readonly', '-mountpoint', mnt], { stdio: 'inherit' })
+  try {
+    execFileSync('codesign', ['--verify', '--deep', '--strict', join(mnt, 'Yaseen Docs.app')], { stdio: 'inherit' })
+  } finally {
+    execFileSync('hdiutil', ['detach', mnt], { stdio: 'inherit' })
+  }
+  renameSync(tmp, dmg)
+  rmSync(`${dmg}.blockmap`, { force: true })
+}
```
After this, the behavior is: the downloaded DMG is 32 MB smaller, and it mounts and installs the same, byte-identical signed app. (Better still, put the step in `tools/lib/dmg.mjs` with an injectable `exec` and a unit test, as draw did. The DMG name should come from `desktop/package.json:47` `artifactName`.)

### 3B: Chromium locale trim, before codesign (`desktop/build/adhocSign.cjs`). Needs D1
```diff
@@ -9,8 +9,34 @@
 const { execFileSync } = require('node:child_process')
+const fs = require('node:fs')
 const path = require('node:path')
 
+/**
+ * Keep only Chromium's en* locale paks (YAZ-2131 D1): the UI is English-only. The framework's
+ * `<lang>.lproj/locale.pak` go; the app-level `Contents/Resources/*.lproj` markers STAY so macOS
+ * Open/Save panels keep the OS language. Idempotent; runs before codesign seals the bundle.
+ */
+function trimChromiumLocales(appOutDir, app) {
+  const dirs = app
+    ? [path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources')]
+    : [path.join(appOutDir, 'locales')]
+  for (const dir of dirs) {
+    if (!fs.existsSync(dir)) continue
+    for (const name of fs.readdirSync(dir)) {
+      const keep = app ? !name.endsWith('.lproj') || name.startsWith('en') : !name.endsWith('.pak') || /^en-(US|GB)\.pak$/.test(name)
+      if (!keep) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
+    }
+  }
+}
+
 module.exports = async function adhocSign(context) {
-  if (context.electronPlatformName !== 'darwin') return
+  if (context.electronPlatformName !== 'darwin') return trimChromiumLocales(context.appOutDir, null)
   const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
+  trimChromiumLocales(context.appOutDir, app)
   execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
 }
```
After this, the behavior is: identical on an English OS, and 47.6 MB smaller installed (−8.8 MB DMG after LZMA). On non-English systems, sort order, `toLocaleString` and Chromium widget strings follow en-US (D1). (Rename the file or its header comment to reflect "afterPack", and add a unit test on a fake `.app` tree: keeps `en*`, leaves app `.lproj` alone, second run is a no-op.)

### 3C: Minify the renderer, keep hidden maps outside the app (`desktop/electron.vite.config.ts`)
```diff
@@ -3,5 +3,5 @@
 import type { Plugin } from 'vite'
-import { createReadStream, existsSync } from 'node:fs'
-import { cp } from 'node:fs/promises'
+import { createReadStream, existsSync, readFileSync } from 'node:fs'
+import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
 import { fileURLToPath } from 'node:url'
-import { resolve } from 'node:path'
+import { dirname, relative, resolve } from 'node:path'
@@ -55,2 +55,24 @@
 }
+
+/** Hidden sourcemaps go to desktop/.maps/<version>/ (gitignored), never into out/** → the asar. */
+function sourcemapsAside(): Plugin {
+  const version = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version
+  const mapsDir = resolve(here, '.maps', version)
+  return {
+    name: 'yaseen-sourcemaps-aside',
+    apply: 'build',
+    async writeBundle() {
+      await rm(mapsDir, { recursive: true, force: true })
+      for (const f of await readdir(rendererOut, { recursive: true })) {
+        if (!f.endsWith('.map')) continue
+        const to = resolve(mapsDir, f)
+        await mkdir(dirname(to), { recursive: true })
+        await rename(resolve(rendererOut, f), to)
+      }
+    },
+  }
+}
@@ -69,3 +91,3 @@
   renderer: {
     root: client,
-    plugins: [react(), excalidrawAssets()],
+    plugins: [react(), excalidrawAssets(), sourcemapsAside()],
@@ -84,1 +106,4 @@
-    build: { outDir: rendererOut, rollupOptions: { input: resolve(client, 'index.html') } },
+    // electron-vite 5 forces renderer minify:false; esbuild-minify (−7.4 MB, entry 4.85 → 2.29 MB) with
+    // hidden maps kept outside the app (YAZ-2131, as draw 3D / D14).
+    build: { outDir: rendererOut, minify: 'esbuild', sourcemap: 'hidden', rollupOptions: { input: resolve(client, 'index.html') } },
```
Also add `desktop/.maps/` to `.gitignore`. (`relative` is unused. Drop it from the import.) After this, the behavior is: identical at runtime (all 240 chunks proven to import in the minified sim), 7.4 MB smaller asar, and a 53 % smaller entry chunk to parse per window.

### 3D: KaTeX woff2 only (`desktop/electron.vite.config.ts`). Optional
```diff
@@ -55,2 +55,17 @@
 }
+
+/** KaTeX lists woff2, woff, ttf; Chromium always takes woff2, so the other 40 files (0.82 MB) never load. */
+function katexWoff2Only(): Plugin {
+  return {
+    name: 'yaseen-katex-woff2-only',
+    enforce: 'pre',
+    transform(code, id) {
+      if (!/katex(\.min)?\.css($|\?)/.test(id)) return null
+      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\(["']truetype["']\)/g, '')
+    },
+  }
+}
@@ -71 +86 @@
-    plugins: [react(), excalidrawAssets()],
+    plugins: [react(), excalidrawAssets(), katexWoff2Only()],
```
After this, the behavior is: the same math rendering (woff2 is what Chromium loads today), and 40 fewer font files and 0.82 MB less in the asar. Verify with an e2e math render that has no failed requests.

### 3E: Really bundle chokidar (`desktop/electron.vite.config.ts` + `desktop/package.json`)
```diff
@@ -58,11 +58,11 @@
   main: {
-    // No externalizeDepsPlugin: chokidar 4 is pure JS and gets bundled, so the packaged app
-    // needs no node_modules at all (spike decision, see GRO-2151 findings).
+    // chokidar 4 is pure JS: bundle it (electron-vite 5 externalizes deps BY DEFAULT), so the
+    // packaged app needs no node_modules at all (spike decision, see GRO-2151 findings).
     resolve: { alias: { '@shared': shared } },
     // Two entries (YAZ-1617): the app, and the `yaseendocs` command the packaged shim runs as plain Node.
-    build: { rollupOptions: { input: { index: resolve(here, 'src/main/index.ts'), cli: resolve(here, 'src/cli/index.ts') } } },
+    build: { externalizeDeps: false, rollupOptions: { input: { index: resolve(here, 'src/main/index.ts'), cli: resolve(here, 'src/cli/index.ts') } } },
   },
   preload: {
     resolve: { alias: { '@shared': shared } },
-    build: { rollupOptions: { input: resolve(here, 'src/preload/index.ts') } },
+    build: { externalizeDeps: false, rollupOptions: { input: resolve(here, 'src/preload/index.ts') } },
   },
```
```diff
@@ desktop/package.json @@ -12,8 +12,6 @@
-  "dependencies": {
-    "chokidar": "^4.0.3"
-  },
   "devDependencies": {
     "@playwright/test": "^1.62.1",
+    "chokidar": "^4.0.3",
     "electron": "43.4.1",
```
After this, the behavior is: file watching is identical, the asar has no `node_modules`, and the config comment is true. The order matters: the config change must land together with the dependency move. Add a gate that `npx @electron/asar list app.asar | grep node_modules` is empty.

### 3F (Windows, optional, needs a win run to measure) (`desktop/package.json:41-46`)
```diff
     "nsis": {
       "oneClick": false,
       "perMachine": false,
       "allowToChangeInstallationDirectory": true,
+      "differentialPackage": false,
       "artifactName": "${productName}-${version}-win-x64-setup.${ext}"
     },
```
After this, the behavior is: the same installer UI. The 7z is solid, so it should be smaller (not measured). Nothing uses blockmaps.

## 4. Before → realistic-after

Measured on the sim apps. The "after all" sim = locale trim + renderer JS/CSS minify + KaTeX woff/ttf removed, re-signed, `codesign --verify --deep --strict` OK. It boots to Welcome and 240/240 chunks import. chokidar was left in the sim (≈0.1 MB). DMG numbers use a validated harness: HFS+ `hdiutil create` gives 139.85 MB at zlib-9 against the real 140.91, and 109.35 MB at ULMO against the real 108.73. The "shipped" column applies each measured delta to the real DMG.

| Step (cumulative) | Installed (apparent) | DMG as shipped |
|---|---|---|
| Baseline v0.9.27 | **324.7 MB** (309.6 MiB) | **140.9 MB** (zlib) |
| + 3A LZMA DMG | 324.7 | **108.7** (−32.2, measured by convert) |
| + 3B locale trim (needs D1) | **277.1** (−47.6) | ≈ **99.9** (−8.8 ULMO delta) |
| + 3C minify + 3D KaTeX woff2-only | **268.8** (−8.3) | ≈ **98.8** (−1.1 ULMO delta; measured all-in 99.40 against 109.35 harness) |
| + 3E chokidar bundled | ≈ 268.7 (−0.1, est.) | ≈ 98.8 |
| **Total** | **324.7 → ≈268.7 MB (−17 %)** | **140.9 → ≈99 MB (−30 %)** |
| Without 3B (if D1 = no) | 324.7 → ≈316.4 MB | 140.9 → ≈107.6 MB |

Renderer entry chunk: 4.85 → 2.29 MB (3C). asar: 35.06 → 26.80 MB.

## 5. Decisions Yasin must make

**D1: Carry the draw locale-trim approval over to Docs?**
- Problem: dropping 212 Chromium locale paks saves 47.6 MB installed and 8.8 MB of download. On a non-English macOS it also switches the app's default locale to en-US. That changes:
  - sort order in views, outlines, property options and the Topics sidebar
  - comment timestamp formatting
  - Chromium's own form strings

  English Macs see no change. Open/Save panels keep the OS language.
- Options:
  1. Land it as in draw (you approved it there: English-only users).
  2. Drop it. Keep all paks (+47.6 MB installed, +8.8 MB DMG).
  3. Land it, and pin the app's collators and `toLocaleString` to `app.getPreferredSystemLanguages()[0]` passed from main. That restores sort and format for non-English users, but it's more code across ~8 call sites and Chromium strings are still English.
- Recommendation: **1**. It's the same user base and the same reasoning you approved for draw, and the only affected users are hypothetical non-English-OS users. If Docs may ever be shared with non-English-OS users, pick 2 (not 3: its extra code isn't worth it).

(3A, 3C, 3D, 3E and 3F are pure packaging with no visible effect. They are recommended, not decisions.)

## 6. Keep as-is (measured, not worth it)
- **Excalidraw fonts, 13.7 MB (12.78 MB Xiaolai CJK)**: already ship once. They are the offline guarantee for drawing previews and the modal. Removing them means a CDN fallback or a wrong font on CJK text.
- **libvk_swiftshader 16.6 MB**: the software-GL fallback when GPU init fails or is blocklisted. Deleting it risks blank windows on odd hardware and VMs. Draw D15 kept it too.
- **libffmpeg 2.2 MB**: needed for any `<video>`/`<audio>` and some image decode paths. Not worth it.
- **icudtl.dat, resources.pak, v8 snapshot, chrome_*_percent.pak**: required by Chromium.
- **`electronLanguages: ["en"]`**: it also deletes the 55 app-level `.lproj` markers, so Open/Save panels turn English. Do the afterPack trim in 3B instead.
- **Excalidraw's 54 engine locale chunks and the mermaid/codemirror chunks**: lazy. They cost installed bytes but no runtime, and D15 in draw said don't strip them.
- **Duplicate Assistant fonts (80 KB) and the 3 identical chunk pairs (~0.1 MB)**: noise.
- **Minifying main/preload/cli (0.42 MB)**: tiny, and readable crash stacks are worth more.
- **DMG `compression: "maximum"` (UDBZ, −11.4 MB)**: strictly worse than ULMO (−32.2).
- **Squirrel/Mantle/ReactiveObjC (0.8 MB)**: electron-builder always includes them. Not worth a custom strip.
- **Universal build**: not relevant (arm64-only is correct).

## 7. Handoffs to other angles
- **Launch/renderer-bundle:** the entry chunk is 4.85 MB unminified (2.29 MB minified) and carries Milkdown/ProseMirror, CodeMirror (107 hits), KaTeX (52 hits) and highlight (178 hits). Worth checking whether CodeMirror and KaTeX can be lazy, and timing parse before and after 3C (V8 code cache, draw 4A).
- **Main-process:** `out/main/index.js:8` has an eager top-level `require("chokidar")`. Draw 5F moved to recursive `fs.watch` with chokidar as a lazy fallback. See the watcher angle.
- **Safety-net/CI:** add budget-gate rows as in draw 1A/D17: DMG ≤ ~100 MB, .app ≤ ~270 MB, no `.map` or `node_modules` in the asar, framework `.lproj` all `en*`, app `.lproj` count = 55.
- **Repo hygiene:** each re-vendor of the 32.8 MB engine tgz adds ~33 MB to git history (`client/vendor`). Consider LFS or release assets.
