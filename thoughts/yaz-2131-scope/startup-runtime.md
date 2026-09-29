# Startup & runtime shell: YAZ-2131 deep scope (angle: startup-runtime)

Base: `main` @ `63aeeea` (v0.9.27), packaged `desktop/dist-app/mac-arm64/Yaseen Docs.app` (Electron 43.4.1, arm64).

**Method.**
- I copied the packaged app to `SCRATCH/startup/apps/Instr.app` and patched **only the asar copy**:
  - main: `YDMARK` stdout marks, plus env toggles for `codeCache`, an fs-based `app://` handler and `v8CacheOptions`;
  - preload: a MutationObserver/PerformanceObserver probe and IPC-invoke timing;
  - a SIGUSR2 hook that calls `app.quit()`, so every run quits gracefully.
- I deleted that copy after measuring. The patch scripts, extracted asar and harness stay in `SCRATCH/startup/`.
- Isolated profiles live under `SCRATCH/profiles/startup/*`, with `--user-data-dir` and `YASEEN_DOCS_USER_DATA_DIR` both set.
- The seeded vault is `SCRATCH/vaults/startup/Vault`. It has 201 md files (then 203) in 10 folders, 12 PNGs, `Big 5k.md` (5,000 lines, 416 fenced code blocks, 832 list items), `Big 5k prose.md` (5,000 lines, no code, about 1,700 list items including nested and tasks) and `Big 1k.md`.
- Timestamps: spawn is `Date.now()` in the harness; the renderer uses `performance.timeOrigin + performance.now()` (both are epoch ms).
- Instrumentation bias: I A/B'd the unmodified packaged app against the instrumented copy, 6 runs each, interleaved. Spawn→doc was 790 vs 742 ms (orig vs instr) and nav→FCP 426 vs 404 ms, which is within noise (the instrumented copy is not slower).
- Machine load: other agents pushed the load average to 30–70 for the first hour. **All headline numbers below are the re-runs at load 2–4** (14:08–14:25). The heavy-load runs are kept in `SCRATCH/startup/results/` and only confirm the direction.

## 1. Baseline numbers (measured)

Warm means the profile had been launched at least twice before. Cold means a fresh `userData` each run (the OS file cache is still warm; a true OS-cold boot needs `purge`/sudo and was not measured). Values are median / p95 in ms.

| Scenario (runs) | spawn→main JS | spawn→`ready` | spawn→window | spawn→nav | nav→preload | nav→DCL | nav→sidebar tree | nav→FCP | nav→doc painted | **spawn→doc painted** |
|---|---|---|---|---|---|---|---|---|---|---|
| Warm, 2 tabs, shipped (no code cache) (10) | 93 | 128 / 172 | 175 | 176 / 223 | 109 / 125 | 172 / 190 | 196 / 212 | 240 / 260 | 248 / 262 | **424 / 474** |
| Same + `codeCache: true` (10, interleaved) | 92 | 128 / 137 | 177 | 178 / 188 | 103 / 113 | **135 / 147** | 164 / 176 | 208 / 212 | **214 / 225** | **397 / 402** |
| Cold profile, 2 tabs (6) | – | – | – | 181 / 199 | – | – | 204 / 223 | 248 / 264 | 262 / 286 | **448 / 465** |
| Welcome screen, cold (5) | – | – | – | 174 / 182 | – | – | – | 228 / 232 | – | FCP 401 / 406 |
| Restore 10 tabs, warm (6) | – | – | – | 188 / 245 | – | – | 214 / 226 | 258 / 280 | 263 / 286 | **452 / 501** |
| Restore 3 windows, warm (5) | – | – | 180 / 190 / 201 (each window) | 181 | – | – | 236 / 262 | 264 / 316 | 286 / 325 | **last window 483 / 516** |
| **Active doc = `Big 5k.md` at launch**, warm (3) | – | – | – | 173 / 182 | – | – | 205 / 209 | 236 / 260 | **1,726 / 1,728** | **1,899 / 1,900** (long tasks 1.5 s) |

Other numbers:

| Item | Result (measured unless noted) |
|---|---|
| Main process marks, warm median (spawn-relative) | main JS starts 93 → requires done 99 → store and index-cache init 102 → module end 102 → `ready` 128 → menu, IPC and git-sync registered 140 → `BrowserWindow` created 175 → `restoreAll` done 177.5. Main CPU used by window creation: 104 ms. |
| Renderer IPC at boot, per window, first 400 ms | `state:get` + `window:identity` 1 ms (storage.init) · **`fs:tree` ×4** (12 ms each at 200 files) · `fs:index` 15 ms (174 ms on a cold profile with no index cache) · `fs:read` 8–16 ms · `properties:get`, `github:status`, `fs:cold-diff`, `fs:clip-state`, `favorites:get` 1–11 ms · `state:set-folds` ×2 |
| Startup trace, entry chunk (no cache) | `BackgroundCompileTask` **117 ms** for the 4.85 MB module, plus lazy `V8.CompileCode` 66 ms and `V8.PreParse` 57 ms. With the cache: `V8.CompileDeserialize` **7.5 ms**; lazy compile is still 63 ms. |
| `userData/Code Cache/js` | Shipped: **2 files, 0 KB** (index only, so nothing is cached). With `codeCache: true`: **4 files, 1.73 MB** (1.83 MB after the big doc). |
| Tab switch, first visit (mounts a new editor), 80 samples | **46–52 ms** median to the new doc's h1 plus a frame. Big 5k first visit: **1,527 / 1,561 ms**. |
| Tab switch, revisit (editor retained, `visibility:hidden` layers) | **22–32 ms** median, p95 71–73. Big 5k revisit: 48 ms. |
| New window (`window.duplicate()` from the renderer) | invoke→nav 12 ms, →FCP 180, **→doc painted 200 / 207** (8 runs) |
| Opening big docs by tab (CPU profiled) | `Big 5k.md` **1.56 s** (1,669 blocks, 14.6k DOM nodes) · `Big 5k prose.md` **6.13 s** (1,819 blocks, 28.6k nodes) |
| Idle 60 s after launch, vault open (5 s settle) | main **0.3 %** CPU, 157 MB RSS · renderer **0.5 %**, 164 MB, JS heap 14.5 MB · GPU 0.9 %, 77 MB · network 0 %, 34 MB |
| Quit (SIGUSR2 → `app.quit`, graceful) | 55 / 77 ms typical. Under load 40–50 with 10 tabs, two quits took **3.0 s and 9.0 s** (both graceful). |
| First exec of a freshly signed bundle | spawn→main JS **2,182 ms** (1 sample; macOS signature assessment). This is OS work, not app work. |

## 2. Findings (most impactful first)

### F1. Opening a large document is 1.5–6 s. Most of it is decoration sets rebuilt from scratch on every view update, multiplied by a dispatch storm from Crepe's list items
- **What.**
  - Three outline plugins build a whole-document `DecorationSet.create(...)` inside `props.decorations`, so it is recomputed on every `EditorView.updateState`. That means every caret move and every selection-only transaction:
    - `headingFolding.ts:349-398`
    - `outlineFolding.ts:416-471`
    - `bulletThreading.ts:63-65`
  - On open, Milkdown Crepe's list-item node view (`@milkdown/crepe` `listItemBlockView`, bundle `index-*.js:109276`) mounts a Vue app per list item. Each one schedules a `requestAnimationFrame` that dispatches a `setSelection` transaction. That is one full plugin pass and one decorations rebuild **per list item** (832 in `Big 5k.md`, about 1,700 in the prose doc).
- **Evidence (CPU profile of a tab switch).**
  - `Big 5k.md`: 1.56 s total.
    - 1.14 s inside those rAF dispatches. Of that, 0.70 s is `takeSpansForNode`/`buildTree` under `headingFolding` `decorations`.
    - Wikilink decoration rebuild on `selectionSet`: 0.18 s. Drawing-preview rebuild: 0.16 s (out of scope, see below). Markdown parse: 0.10 s. `EditorView` construction: 0.10 s.
  - `Big 5k prose.md`: 6.13 s total.
    - 5.3 s in the list-item dispatches. `outlineFolding` decorations: 1.76 s. `headingFolding` decorations: 1.74 s.
  - At launch with the big doc active: nav→doc 1.73 s versus 0.25 s for a normal note.
- **Impact.**
  - Speed and smoothness: seconds of frozen UI on open.
  - The same per-update rebuild runs on **every caret move and keystroke** in a big doc (0.1–1 ms × headings), so it is also a typing-latency issue for the renderer-smoothness angle.
  - Estimated gain from memoising the three builders: `Big 5k.md` about 1.56 → 0.85 s, prose doc about 6.1 → 2.6 s. **Estimate**: removes the decorations share only; the dispatch count stays the same.
- **Risk.** None if the memo is keyed correctly:
  - `entries` keeps array identity when `!docChanged` (`headingFolding.ts:280`), and the folded set is compared by value.
  - Widget keys are unchanged, so ProseMirror would reuse the same DOM anyway.
- **Draw app.** The draw equivalent is the 5A/5x smoothness work (upstream engine fixes plus render isolation). It transfers **adapted**: the pattern is "don't rebuild derived view state per update", and the code is different.

### F2. The V8 code cache is off for `app://`, so every launch recompiles the 4.85 MB entry chunk
- **What.** `desktop/src/main/index.ts:75` registers `app` without `codeCache: true`. The shipped profile's `Code Cache/js` holds 0 KB.
- **Evidence.**
  - Interleaved A/B, 10 runs each, load about 3.6:
    - nav→DCL 172 → **135 ms**
    - nav→doc painted 248 → **214 ms** (paired median **−35 ms**, 10/10 runs faster; p95 262 → 225)
    - spawn→doc painted 424 → 397 ms (p95 474 → 402)
  - At load 50 the paired gain was −68 ms.
  - Trace: background top-level compile 117 ms → deserialize 7.5 ms.
  - Cache size: 1.7 MB after 2 launches (the heat check skips run 1 and produces the cache on run 2).
- **Impact.** Launch speed; smaller variance (p95 −72 ms).
- **Risk to features.** None visible.
  - Chromium keys the cache by URL and source hash, and Vite hashes the filenames, so a stale hit is impossible.
  - The `app://vault/` image host shares the scheme; the cache only applies to JS.
- **Draw app.** Draw 4A / YAZ-2092 made the same one-line change (−29 ms canvas, −113 ms draw.io). **Transfers as-is.** The docs app has no 20 MB draw.io payload, so the disk cost is 1.7 MB, not 21 MB.

### F3. What the launch is actually made of: main is lean, the renderer path dominates
Warm, low load:
- spawn → Electron/Node boot 93 ms (not app code)
- app module 9 ms: `createStore` sync read plus `initIndexCache` (async gc)
- 26 ms waiting for `ready`
- 12 ms of `whenReady` work: theme, protocol, menu, clipboard/agent/IPC registration, git sync `setOpenRoots` (async)
- **35 ms `new BrowserWindow`** (the trace shows `ComputeWebPreferences` 22 ms)
- renderer process launch plus commit, nav→preload **109 ms** (trace: the renderer main thread starts about 88 ms after `RenderProcessHostImpl::Init`)
- entry chunk load, compile and eval, **63 ms** (32 ms with the cache)
- storage.init 1 ms (both IPCs), then React first render
- `fs:tree` answers → sidebar at +196
- `fs:read` → Crepe `create()` about 45 ms → doc painted +248

**What main does synchronously before the window:** `store` load (`readFileSync` of `yaseendocs.json`, about 1 ms), `app.setAsDefaultProtocolClient`, and menu template build. No fs scans, no index build, no git and no watcher: the watcher, index and git work all start lazily when the renderer's IPC arrives. Nothing meaningful can move after first paint. The draw app also ruled out deferring IPC registration (startup-order risk). **Keep as-is.**

**Excluded as a cause, with an experiment:**
- The trace showed about 160 ms between the navigation request and `OnResponseStarted`, so I suspected the `net.fetch(file://)` protocol handler was waiting on the network service.
- I replaced it with `fs.readFile → new Response` in the patched copy: nav→doc paired **+4 ms**, i.e. no effect. The wait is the renderer process launch.
- **Keep `net.fetch`.**

### F4. `fs:tree` runs 4× (plus `fs:index` and `fs:cold-diff`) in the first 400 ms of every window
- **Evidence (IPC log).** Three calls fire in the same tick after first render:
  - `Sidebar.refresh` (`client/src/sidebar/Sidebar.tsx:523`)
  - `useViewOnlyCatalog` (`client/src/hooks/useViewOnlyCatalog.ts:37`)
  - the active-file probe (`Sidebar.tsx:734`, which fires because `treeRef` is still null at first activation)
  - A fourth follows on the watcher/index refresh (about +600 ms together with a second `fs:index`).
- **Impact.** At 200 files each walk costs 12 ms of main-process time and they run in parallel with `fs:read` for the doc. On a cold profile `fs:index` took 174 ms and `fs:read` rose from 10 to 52 ms, which directly delays the doc (main contention). This scales linearly with vault size.
- **Risk.** Low if the probe and the catalog reuse the sidebar's first response.
- **Ownership.** Belongs to the main-process/sidebar angle (handoff). Draw 5E (tree-refresh coalescing) is the analogue and transfers **adapted**.

### F5. The renderer entry is one unminified 4.85 MB chunk (131k lines)
- Even with the code cache it costs fetch (about 120 ms streamed through `app://` under load), `V8.PreParse` 57 ms and lazy compile 63 ms.
- CodeMirror language modes, KaTeX and all drawing/mermaid chunks are already lazy.
- Crepe's disabled features (Latex, ImageBlock, TopBar, AI) are still statically in the entry, because `@milkdown/crepe`'s index imports every feature.
- Minification plus code cache is the draw 3D + 4A combination. **Handoff to renderer-bundle**, which owns the numbers.

### F6. Tabs, windows and restore scale well
- Tabs are lazily mounted on restore (`useWorkspace.ts:138`): 10 restored tabs cost the same as 2 (452 vs 424 ms spawn→doc).
- 3 windows restore serially about 11 ms apart; the last doc is painted at 483 ms.
- `window.duplicate()` → doc painted in 200 ms.
- Tab switch: 46–52 ms for a first visit, 22–32 ms for a revisit (retained editors).
- Trade-off already chosen by design: every visited tab keeps its editor mounted, so memory grows with visited tabs (big-doc editor: 28.6k DOM nodes).
- **Keep as-is** (rule 6 in `App.tsx:831`).

### F7. Unexplained frame stalls on a first tab visit
- 3 of 80 first-visit switches (0 of 80 revisits) showed the new doc in the DOM at 223 ms or 996 ms, but the **next frame came 5.8–7.9 s later**.
- The renderer was not busy: long tasks were ≤102 ms and `visibilityState` was `visible`.
- The first batch saw similar outliers under heavy machine load.
- Possibly GPU/compositor contention from the dozens of Electron instances other agents were running. Not attributed.
- **Handoff to smoothness** to re-check with a trace on a quiet machine.

### F8. Idle is clean
- 0.3 / 0.5 / 0.9 % CPU for main / renderer / GPU over 60 s.
- The only renderer interval is `CommentsSection.tsx:328` (60 s clock).
- Main timers are unref'd git-sync timers (`git/manager.ts:91`).
- chokidar runs with `usePolling` off.
- **Keep.**

### Out of scope (drawing component, per the scope change)
- Drawing chunks (`percentages` 2.28 MB, `subset-shared` 1.84 MB, the mermaid/cytoscape set about 6 MB) are lazy, so startup cost is 0 for docs without a drawing.
- The drawing-preview ProseMirror plugin rebuilds over the whole doc on every transaction: 160–171 ms of the 1.56 s `Big 5k.md` open (bundle `build2`, `index-*.js:116521`).
- Not counted as a lever.

## 3. Proposed changes

**A. V8 code cache for `app://` (F2).** File: `desktop/src/main/index.ts`

```diff
@@ -73,3 +73,5 @@
 // Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
 // like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
-protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
+// `codeCache`: Chromium persists V8 code only for http(s) unless a standard scheme opts in (Electron ≥ 28);
+// measured −35 ms nav→document painted, ~1.7 MB in userData/Code Cache/js (YAZ-2131).
+protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }])
```

- After this: the third and later launches reuse the compiled entry chunk. Nothing visible changes.
- Add a unit test pinning all four privileges; draw extracted `appScheme.ts` for exactly this.
- Acceptance: after two launches in an isolated profile, `find "<userData>/Code Cache/js" -type f | wc -l` > 2.

**B. Memoise heading-folding decorations for selection-only updates (F1).** File: `client/src/editor/outline/headingFolding.ts`

```diff
@@ -70,2 +70,6 @@
 /** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
 const pluginKey = new PluginKey<HeadingFoldingState>('mdapp-heading-folding')
+
+/** ProseMirror asks for `decorations` on EVERY view update (each caret move; once per Crepe list item on open).
+ *  `entries` keeps its identity until the doc changes, so a set keyed on it + the folded positions is reusable. */
+const decorationCache = new WeakMap<readonly HeadingEntry[], { collapsedKey: string; set: DecorationSet }>()
@@ -349,4 +353,8 @@
           decorations: (state) => {
             const foldingState = pluginKey.getState(state)
             if (!foldingState) return DecorationSet.empty
+            const collapsedKey = [...foldingState.collapsedHeadingPositions].sort((a, b) => a - b).join(',')
+            const cached = decorationCache.get(foldingState.entries)
+            // Same headings, same folds → the exact set a rebuild would produce (same widget keys).
+            if (cached !== undefined && cached.collapsedKey === collapsedKey) return cached.set
 
@@ -397,3 +405,5 @@
             })
-            return DecorationSet.create(state.doc, decorations)
+            const set = DecorationSet.create(state.doc, decorations)
+            decorationCache.set(foldingState.entries, { collapsedKey, set })
+            return set
           },
```

- After this: the heading chevrons and folds look and behave the same. Selection-only transactions (caret moves, and Crepe's per-list-item mount dispatches) reuse the previous set instead of rebuilding it.
- Apply the same pattern to:
  - `outlineFolding.ts:416-471` (key on its `entries` plus `collapsedItemPositions`)
  - `bulletThreading.ts:63-65` (key on `state.doc` plus the selection fields `buildDecorations` reads)
- Tests:
  - existing fold/unfold/undo-fold suites stay green
  - a new test asserts `decorations(state)` returns the identical set object after a `setSelection` transaction and a new one after a fold toggle or a doc edit
- Owner overlap: renderer-smoothness (typing latency). Measured gains need a re-profile of `Big 5k*.md` open with `SCRATCH/startup/profile.mjs`.

**C. (Handoff, no diff here)** Coalesce the 4 boot `fs:tree` calls (F4). The file is owned by the sidebar/main angle.

## 4. Decisions Yasin must make

**D-S1. Crepe's per-list-item selection dispatch on mount (upstream Milkdown behaviour).**
- **Problem.** Even after B, a doc with N list items triggers N extra full-plugin transactions on open. Big 5k: 832; prose: about 1,700. After B they are cheap but not free (wikilink `selectionSet` rebuild is an O(doc) walk each time). Fixing it at the source means changing an upstream dependency.
- **Options.**
  1. App-side memoisation only (B plus the same pattern for wikilink's `selectionSet` path). Leave Crepe untouched.
  2. Also patch Crepe's `listItemBlockView` locally (a `patch-package` patch or a vendored tgz like the Excalidraw fork) so the rAF dispatch is skipped when the selection it restores equals the current one. Behaviour is identical.
  3. Upstream PR to Milkdown, then take the release.
- **Recommendation.** Do 1 now and 3 in parallel. Use 2 only if a re-profile after 1 still shows large-doc open above about 1 s.
- **Why.** 1 needs no new vendoring surface. The draw app showed that a vendored fork carries maintenance risk (its fork branch drags unrelated commits).

No other decisions. Code cache (A) has a trivial 1.7 MB disk cost, versus draw's D13 at 21 MB, so it is a plain recommendation.

## 5. Keep as-is (measured, not worth it)
- **fs-based `app://` handler instead of `net.fetch`:** paired −13 ms DCL and +4 ms doc, i.e. noise.
- **`v8CacheOptions: 'bypassHeatCheckAndEagerCompile'`:** paired −3 ms and the same 1.73 MB cache. Draw also found no extra gain.
- **V8 startup snapshot (draw Future YAZ-2119):** does not transfer.
  - Electron's snapshot fuse covers the browser/main process only.
  - Main app JS is 9 ms.
  - After the code cache, renderer compile is about 7 ms deserialize plus lazy compile.
- **Deferring main work (menu/IPC/git) until after the window:** there are about 12 ms of it, with startup-order risk.
- **Draw 4B analogue (prefetch the active doc's `fs:read` before React render):**
  - Milkdown is already in the entry chunk, so no lazy engine exists to warm.
  - Reading the file earlier saves an estimated 10–17 ms (`fs:read` is 8–16 ms and starts at +179).
  - It adds a second read path next to `useFile`. Not worth it.
- **Idle behaviour:** below 1 % CPU on every process.
- **Tab retention design (F6):** no change needed.
- **Multi-window restore (F6):** no change needed.

## 6. Handoffs to other angles
- **renderer-smoothness:**
  - F1's per-update `DecorationSet.create` in headingFolding, outlineFolding and bulletThreading also taxes every keystroke and caret move in big docs.
  - Wikilink rebuilds over the whole doc on each `selectionSet` (`wikilinkPlugin`, bundle `build$1`).
  - F7's 5–8 s frame stalls on a first tab visit (3/80, unattributed).
- **renderer-bundle:** F5. The 4.85 MB unminified entry chunk costs PreParse 57 ms plus lazy compile 63 ms even with the cache. Crepe's disabled features are still bundled and evaluated.
- **main-process / sidebar:** F4. 4× `fs:tree`, plus `fs:index`/`cold-diff`, within 400 ms of every window open. On a cold index `fs:index` blocks main for about 174 ms at 200 files and slows the doc's `fs:read` 5×.
- **reliability:** a graceful quit with 10 tabs took 3.0 s and 9.0 s under load (55 ms normally). Worth checking against the 5 s-per-renderer flush cap in `index.ts:202-215`.
- **packaging:** a fresh ad-hoc-signed bundle's first exec paid 2.2 s before main JS (macOS assessment). That is expected, but worth knowing for "first launch after install" numbers.

## Machine-safety note (per the coordinator's rules)
- Every launch used `--user-data-dir` and `YASEEN_DOCS_USER_DATA_DIR` under `SCRATCH/profiles/startup/`. I never used `open -a`, never ran the e2e suite, and never touched the real profile, `/Applications/Yaseen Docs.app` or a real vault.
- **One side effect to know about:** every launch runs `app.setAsDefaultProtocolClient('yaseendocs')` (`index.ts:45`), including launches of my SCRATCH copy of the bundle, which has the same bundle id. I checked read-only afterwards: `yaseendocs://` still resolves to `/Applications/Yaseen Docs.app`. I deleted the SCRATCH copy (`Instr.app`).
- No processes of mine remain (`pgrep -f profiles/startup/` → 0).

Artifacts: `SCRATCH/startup/{cdp,run,ab,interact,profile,idle,trace}.mjs`, `patch.py`, `patch_preload.py`, `results/*.json` (raw runs, traces, `.cpuprofile`).
