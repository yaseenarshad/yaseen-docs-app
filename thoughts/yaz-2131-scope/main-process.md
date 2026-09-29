# Main-process angle — YAZ-2132 deep scope (docs app @ 63aeeea, v0.9.27)

Scope: `desktop/src/main/**`, `desktop/src/preload`, `desktop/src/cli`, `shared/`. CPU, memory, IPC and I/O cost.

## Method
- Benchmarks import the **real main modules**, bundled with esbuild, and run under the packaged app's own runtime (`ELECTRON_RUN_AS_NODE=1 "Yaseen Docs.app/Contents/MacOS/Yaseen Docs"`: Node 24.18.1, V8 15.0). No tracked file was edited.
  - `SCRATCH/bench/main-process/{watch,storm,stale,index,idle}-bench.ts`, `gen.mjs`, `run-storm.sh`, raw results `storm2.jsonl`, `index-results.jsonl`.
- Throwaway vaults (`SCRATCH/vaults/main-process`):
  - `v2k`: 2,000 notes plus 80 PNGs, 49 dirs, 9.4 MB.
  - `v10k`: 10,000 notes, about 250 dirs, 39 MB.
  - Notes have frontmatter, 8 wikilinks and tags.
- Storm model:
  - Per window, the renderer's listeners are replayed exactly as the code has them: Sidebar `refresh` (undebounced), `useIndex` (300 ms), and search (undebounced, only once activated).
  - IPC reply cost is approximated with `v8.serialize`, the structured-clone encoder Electron IPC uses.
  - Each storm rep runs in a fresh process, 5 reps per cell.
- Machine: M1 Max, 8 cores, 24 GB. **Heavily shared.** Load average ran from 4 to 40 while the benches ran (noted per table). Other agents were running builds and DMG jobs at the same time.
- **Incident, please read:**
  - While checking the Electron version I ran `"Yaseen Docs" --version` from `desktop/dist-app`. That launched the packaged app against the **real profile** (`~/Library/Application Support/Yaseen Docs`) for about 2 minutes.
  - I quit it gracefully via Apple Event (`tell application id "com.yasinarshad.yaseendocs" to quit`), so the normal before-quit flush ran and the windows were kept. Nothing else ran against it.
  - Worth a glance at the real state file / window restore on next launch.

## 1. Baseline numbers (all measured)

| What | v2k (2,000 notes) | v10k (10,000 notes) | Load |
|---|---|---|---|
| Watcher fds (chokidar 4, `fs/watchers.ts`) | **2,080** (1 per file) | **10,000** | 25–27 |
| Watcher RSS added / heapUsed added | +43 MB / +3 MB | +113 MB / +13 MB | 4 |
| Watcher ready | 279 ms | 487 ms | 25 |
| External change → `change` event, med / p95 (n=20/10) | **258 / 264 ms** | 259 / 415 ms | 25 |
| External add → `add` event, med / p95 | 222 / 272 ms | 221 / 296 ms | 25 |
| Same with recursive `fs.watch` (raw, no settle layer) | 12.4 / 12.7 ms, **0 fds**, +0.4 MB | – | 25 |
| Idle main CPU over 30 s (watcher + live index) | 0 ms | 0 ms | 4 |
| Live index heap | +2.5 MB | +7.5 MB | 4 |
| Cold index build (no cache) | 287 ms | 1,484 ms | 5 |
| `fs:index` payload / main serialize / renderer deserialize (med, n=7) | **1.26 MB / 2.3 ms / 1.9 ms** | **6.35 MB / 14.3 ms / 17.2 ms** | 5 |
| `fs:tree` walk / payload / serialize (med) | 7.2 ms / 0.54 MB / 0.7 ms | 42 ms (p95 78) / 2.62 MB / 3.8 ms | 5 |
| Index cache persist (full rewrite, 5 s after any change) | 2.1 ms, 1.35 MB file | 13.4 ms, 6.84 MB file | 5 |
| Save path `writeFile` (stat + tmp + rename + stat), med / p95 (n=28) | 0.2 / 0.6 ms | 0.2 / 0.6 ms | 5 |
| Watcher-side `scanFile` of the saved note | 0.1 ms | 0.1 ms | 5 |
| Asset basename resolve (`app://vault` img, `readAsset`), miss or deep | 2.1 ms | 12 ms | 5 |

**Storm, v2k, 230 files, 5 fresh-process reps each (medians; p95 in brackets).** Load was 5–27 across the matrix.

| Scenario | Variant | Events | Main CPU s | Peak RSS MB | `fs:tree` walks | IPC bytes | Work settles | Slowest tree reply |
|---|---|---|---|---|---|---|---|---|
| add 230 (git pull, Finder copy) | **today** | 231 | **9.5 (10.5)** | **1,254 (1,347)** | 231 | 140 MB | 2.5 s (4.4) | 3.6 s |
| | main single-flight | 231 | 0.54 (0.60) | 279 (301) | 2 real walks, 231 replies | 140 MB | 0.27 s | 0.24 s |
| | + renderer 100 ms debounce | 231 | **0.25 (0.26)** | **122 (123)** | 2 | 1 MB | 0.29 s | 21 ms |
| remove 230 | today | 231 | 8.1 (8.8) | 1,294 (1,301) | 231 | 126 MB | 2.6 s | 4.0 s |
| | + debounce | 231 | 0.08 | 123 | 1 | 1 MB | 0.12 s | 10 ms |
| rename 230 (bulk rename, checkout) | today | 460 | **17.7 (18.3)** | **1,849 (1,983)** | 460 | 253 MB | 7.0 s (7.4) | 6.8 s |
| | single-flight | 460 | 0.92 | 331 | – | 252 MB | 0.35 s | 0.39 s |
| | + debounce | 460 | 0.27 | 123 | 2 | 1 MB | 0.29 s | 15 ms |
| modify 230 (pull touching existing notes) | today | 230 | 0.11 | 121 | 0 | 1.3 MB | 0.28 s | – |

- With the search bar activated (`useSearchResults`, undebounced `fs:index` per structural event), add-230 still costs **2.3 s CPU, 420–670 MB peak, 232 × 1.26 MB = 441 MB serialized**, even with tree single-flight. Load was 40 during that run, so treat it as an upper bound.
- The storms above are **per window**. Two windows on the same vault double the renderer-driven part.

## 2. Findings (most impactful first)

### F1. Tree refresh storm: one full vault walk per watcher event, uncoalesced (HIGH: smoothness, memory, quit safety)
- **Evidence:**
  - `client/src/sidebar/Sidebar.tsx:538-545`: every non-`change` event calls `refresh()`, which calls `api.tree(root)`.
  - `desktop/src/main/fs/tree.ts:5-9` → `fsUtils.ts:112-130`: every call is an independent full `readdir` + `stat`-every-file walk, all running at once.
  - Measured: add-230 costs **9.5 s CPU and 1.25 GB peak**; rename-230 costs **17.7 s and 1.85 GB**. The slowest tree reply is 3.6–6.8 s, so the sidebar is stale that long.
  - Main is the process that serves `fs:write`, so a save queued during a storm waits behind hundreds of walks. That is the same data-loss path draw found: the quit flush cap is `FLUSH_TIMEOUT_MS = 5000` (`windows.ts:44`), then `app.exit(0)`.
- **Fix:**
  - Main single-flight (one running walk plus one shared trailing walk per root) cuts it to 0.54 s / 279 MB.
  - Adding a 100 ms renderer debounce cuts it to **0.25 s / 122 MB, which is 38×–65× less CPU and 10–15× less peak memory**.
- **Risk:**
  - None visible. Every answer still post-dates its request, because a caller that arrives mid-walk joins the trailing walk.
  - The renderer debounce adds ≤ 100 ms before the sidebar reflects an external add. `ready` stays immediate. Check `pendingReveal` (Sidebar ~l.497) for the inline-create reveal.
- **Draw equivalent:** draw 5E / YAZ-2099 (31.5 s / 3.3 GB → 0.3 s / 114 MB). **Transfers as-is** for main. The renderer half is the same shape, but here there are **three** renderer consumers:
  - Sidebar tree: undebounced.
  - `useSearchResults.ts:44-46`: index, undebounced.
  - `useViewOnlyCatalog`: tree, already 300 ms.

  All three should be debounced (handoff to renderer).

### F2. Watcher engine: chokidar 4 = one fd per file, ~258 ms latency, +43–113 MB RSS (HIGH: memory, latency, scalability)
- **Evidence:**
  - `fs/watchers.ts:29-34`: chokidar 4.0.3 has no fsevents, so it uses `fs.watch` per file. `awaitWriteFinish {200, 50}` stat-polls every changing file for ≥ 200 ms.
  - Measured:
    - 2,080 fds for 2,080 files, and 10,000 for 10k notes.
    - +43 / +113 MB RSS; heap is only +3 / +13 MB, so the rest is native watch state.
    - Median event latency 258 ms, where raw recursive `fs.watch` gives 12 ms with 0 fds.
  - A second chokidar per root watches `.yaseendocs` (`vaultConfig.ts:135-139`), with the same options.
  - Scaling (estimated): `kern.maxfilesperproc` is 92,160 and `kern.maxfiles` is 184,320 system-wide. A 50k–90k-file vault (a `node_modules`-free code repo opened as a vault) would take a large share of the whole machine's fds or hit EMFILE.
- **Impact:** every external change (sync tool, git, agent writing via the `yaseendocs` CLI) and every own-save echo reaches the index, tree and git manager 250 ms later. That is the floor under the external-edit hot-reload and the "file changed on disk" paths.
- **Fix:** recursive `fs.watch(root, {recursive:true})` (FSEvents / ReadDirectoryChangesW) plus a thin `lstat` classify layer and a per-path settle. It must emit the docs app's exact contract:
  - `add` / `change` carry `mtime` (`alwaysStat`); `unlink` / `addDir` / `unlinkDir`.
  - The same `isSkipped` rules.
  - `atomicWrite` `.tmp-*` names stay silent.
  - `ready` after the initial walk.
  - Lazily-loaded, bundled chokidar polling as the fallback for non-local volumes or when `fs.watch` throws.
- The `.yaseendocs` config watcher can ride the same recursive stream by prefix routing, instead of being its own watcher.
- **Must carry both draw follow-ups:**
  - **5F1 / YAZ-2130:** the FSEvents ready-before-live race. `fs.watch` returns before libuv's FSEvents stream is live, and draw lost 16/40 early events under load. The probe-watch fix transfers as-is.
  - **2C / YAZ-2083:** the subscribe race (F3).
- **Risk:** medium, because this is an engine swap. It is gated by a conformance suite that is written first and passes on chokidar before the swap. Suite items from draw 5F, plus docs-specific ones:
  - the index `inFlight` drain (YAZ-986);
  - `useExternalRenames` (GRO-2197): its "a save that momentarily vanished behind awaitWriteFinish" carry logic must still hold;
  - gitSync pending on any event;
  - the vaultConfig own-write mtime echo suppression;
  - trash as a move (`remove.ts:31`).
- **Draw equivalent:** draw 5F / YAZ-2100 (2,335 fds → 0, 259 → 14 ms raw; 112 ms with a 100 ms settle). **Transfers adapted**: the docs event contract carries mtime, and there are two watchers per root instead of four.
- **Latency note:** with a settle, latency ≈ settle + 10 ms. Draw shipped `SETTLE_MS = 100`; 50 ms would give ~60 ms.

### F3. Watch subscribe/unsubscribe race leaks a whole-vault watcher (MEDIUM: reliability, memory)
- **Evidence:** `ipc/watch.ts:21-49` awaits `requireDir` (l.32) before registering (l.48). An unsubscribe arriving in that gap finds nothing (l.53-55) and returns.
- The late registration then lives until the window is destroyed. It keeps the old root's chokidar alive (2k–10k fds, +43–113 MB) and sends every event over IPC, where the preload drops it (`preload/index.ts:84-86`).
- **Triggers:** switching vault in the same window (`useWatch` effect cleanup, `client/src/hooks/useWatch.ts:28-31`) when the switch lands within one `stat`, or a slow volume.
- Found by code reading and deterministic by construction. No timing bench was needed.
- **Draw equivalent:** draw 2C / YAZ-2083. **Transfers as-is.**

### F4. Every note save refetches the whole index in every window (MEDIUM at 10k notes: smoothness while typing)
- **Evidence:**
  - Autosave runs every 500 ms (`client/src/lib/autosave.ts:149`). The own-save echo `change` is emitted about 258 ms later.
  - `useIndex.ts:28-31,72-79`, 300 ms after that, calls `fs:index`. `vaultIndex/live.ts:143-144` sorts and returns **all** records with all properties.
  - Measured: 1.26 MB / 2.3 ms main serialize + 1.9 ms renderer deserialize (2k); **6.35 MB / 14.3 ms + 17.2 ms (10k)**. That is per save, per window, plus the renderer rebuilding the wikilink/views state from a new array (renderer angle).
  - At 10k notes and continuous typing, that is roughly one 30 ms+ hitch per second of typing.
- **Fix:** an incremental index feed (`index:delta {upserts, removes, generation}`) with a full snapshot only on `ready` or a gap. This is an IPC contract change, so it is **Decision M1** below.
- The cheap part that needs no decision is F6's search debounce.
- **Draw equivalent:** none; draw has no per-save index feed.

### F5. State file rewritten on session-only changes; full AppState broadcast on every commit (LOW–MEDIUM: I/O, IPC)
- **Evidence:**
  - `store.ts:304-313` writes on every commit.
  - `toDisk` (l.240-243) **drops** `expanded` / `topicsExpanded`, so every folder expand/collapse (`client/src/lib/storage.ts:115,128`) rewrites byte-identical JSON 150 ms later.
  - Every commit also broadcasts the whole `AppState` to every window (`ipc/state.ts:67`). That includes `window.setIdentity`, which always commits (`ipc/window.ts:86-110`, no no-op check) on every tab switch or active-file change, and bounds moves every 250 ms of a drag.
  - AppState size was not measured: I did not read the real profile. It holds all vaults' folds / baseGroups, capped per file.
- **Fix:** remember the last written text and skip identical writes (draw 5G). Skipping the no-op *broadcast* is left out on purpose: the renderer's echo semantics would need auditing (renderer handoff).
- **Draw equivalent:** draw 5G / YAZ-2101. **Transfers as-is.**

### F6. Search bar, once used, turns every structural event into a full index fetch (MEDIUM in storms)
- **Evidence:** `client/src/search/useSearchResults.ts:44-46` is undebounced. Measured: +232 fetches, 441 MB serialized, 2.3 s CPU per 230-file add (load 40).
- The fix is renderer-side (a debounce like `useIndex`'s 300 ms), so it goes to the renderer angle. Listed here because the cost lands in main.

### F7. Quit flushes windows one at a time (LOW: quit latency, data safety with hung renderers)
- **Evidence:** `windows.ts:434-442` awaits each window's flush in turn, capped at 5 s each. N hung or slow renderers take N × 5 s.
- `index.ts:207-215` then flushes store, index cache and git.
- **Draw equivalent:** draw 5G / YAZ-2101 (parallel quit flush). **Transfers as-is.** The YAZ-1081 order ("renderers flush FIRST") is kept: all renderers still finish before `store.flush` / `gitSync.flushForQuit`.

### F8. Image and asset resolution walks the vault per `<img>` load (LOW–MEDIUM for image-heavy notes in big vaults)
- **Evidence:**
  - `fs/assets.ts:46-63` `findByBasename` is a BFS `readdir` + sort of every directory until a match.
  - It is used by `app://vault` (`vaultProtocol.ts:91-98`) whenever the ref is not note- or root-relative, which is the usual Obsidian `![[pic.png]]`. It is also used by `readAsset`.
  - A miss or a deep hit is a full walk: 2.1 ms (2k) / **12 ms (10k)** each.
  - `Cache-Control: no-cache` (l.113) means Chromium re-requests on each load. A note with 30 images in a 10k vault is about 30 walks (~360 ms of fs threadpool) on every open.
- **Fix (recommended, lower priority):** a per-root `basename → path` map built by one walk.
  - Invalidate it on any `add` / `unlink` / `addDir` / `unlinkDir` from the shared watcher for that root. Only open vaults serve images, so their watcher is live.
  - Validate each hit with one `stat`.
  - Resolution order (note-relative → root-relative → shortest path) stays identical because the map stores the BFS winner.
  - Not diffed here: it needs the watcher engine hook (F2) to be clean.
- **Draw equivalent:** none directly. Draw's image work (5B/5C off-thread decode, thumbnails) is renderer-side.

### F9. `readAsset` returns base64 for card images (LOW)
- `fs/assets.ts:113` base64-encodes the bytes of card-cover images (up to 10 MB, `MAX_FILE_BYTES`). That is +33% bytes plus an encode in main and a decode in the renderer.
- `readImage` / `readPdf` already send a `Buffer` (`fs/image.ts:16`, `fs/pdf.ts:14`), so the pattern exists.
- Contract change in `shared/types.ts` `AssetResponse.data` plus its renderer consumers. Low value: recommend folding it into an IPC contract-as-data refactor (draw 6A equivalent), not a standalone change.

### Out of scope (per Yasin, 2026-09-28): the drawing / Excalidraw component
- Main-side drawing cost is not counted as a lever and no change is proposed for it. It must keep working, so P1–P6 do not touch its paths.
- What it costs: `.excalidraw` scene JSON is read through the same base64 `readAsset` pipe (`fs/assets.ts:113`, up to 10 MB) and written through `writeAsset` (`fs/assets.ts:140-190`).

### F10. Git sync: no idle polling; one redundant pass per pull that changed files (LOW, informational)
- **Evidence:**
  - Enabled roots only (`git/manager.ts`). Nothing runs on a timer except the offline retry (2 min, one timer) and focus/wake (10 s cooldown).
  - Idle cost is zero (measured: 0 ms CPU over 30 s with watcher + index; git is off in the bench, and by code there is no interval when enabled).
  - A pull whose rebase changes files produces watcher events (`onVaultEvent`, l.277-290). Those broadcast `pending` and arm a second pass 30 s later (fetch + rev-list, nothing to commit), so the status briefly shows "not saved to GitHub yet" after a pull.
- **Draw equivalent:** draw 5H / YAZ-2102 (lean idle poll). **Does not transfer**: docs has no poll to lean out. The echo pass is cheap and idempotent; see Keep list.

### F11. Memory: no unbounded main-process maps found (informational)
- Audited, all bounded:
  - `vaultIndex/live.ts` entries: open roots, evicted 10 min after the last `getIndex`.
  - `pending`: cleared in `finally`.
  - `watchers.ts` / `vaultConfig.ts` entries: refcounted.
  - `ipc/watch.ts` `bySender`: cleared on `destroyed`, except the F3 leak.
  - `cache.ts` `chains`: one settled promise per root ever opened this session (tiny).
  - `git/manager.ts` maps: open roots.
  - `fileClip`: one clip.
- The main-process memory story is F2 (watcher native state, +43/+113 MB) and F1 (storm transients, up to 1.9 GB).
- **Draw equivalent:** draw 5J / YAZ-2104. Its audit and idle-RSS budget transfer as a method; there is no Image-Studio cache equivalent in docs main.

## 3. Proposed changes (diffs against 63aeeea)

### P1 (F1). `desktop/src/main/fs/tree.ts`: single-flight + one shared trailing walk per root
```diff
--- a/desktop/src/main/fs/tree.ts
+++ b/desktop/src/main/fs/tree.ts
@@ -1,9 +1,46 @@
 import type { TreeResponse } from '@shared/types'
 import { buildTree, fsCall, requireAbsPath, requireDir } from './fsUtils'
 
-/** `window.yaseenDocs.tree(root)`: recursive vault tree of `root` (see `buildTree`). */
-export async function tree(root: string): Promise<TreeResponse> {
-  const dir = requireAbsPath(root, 'root')
+interface Flight {
+  running: Promise<TreeResponse> | null
+  next: { promise: Promise<TreeResponse>; resolve: (r: TreeResponse) => void; reject: (e: unknown) => void } | null
+}
+const flights = new Map<string, Flight>()
+
+/**
+ * `window.yaseenDocs.tree(root)`: recursive vault tree of `root` (see `buildTree`). ONE walk per
+ * root at a time: a caller arriving mid-walk joins the single trailing walk that starts when the
+ * current one ends — never the running one, whose snapshot may predate the change that caused the
+ * call — so every answer still post-dates its request, and a burst of N watcher events costs at
+ * most 2 walks instead of N concurrent ones (storm: 9.5 s → 0.5 s CPU, 1.25 GB → 0.28 GB).
+ */
+export function tree(root: string): Promise<TreeResponse> {
+  let dir: string
+  try {
+    dir = requireAbsPath(root, 'root')
+  } catch (err) {
+    return Promise.reject(err)
+  }
+  let f = flights.get(dir)
+  if (f === undefined) flights.set(dir, (f = { running: null, next: null }))
+  const flight = f
+  const run = (): Promise<TreeResponse> =>
+    (flight.running = walk(dir).finally(() => {
+      flight.running = null
+      const queued = flight.next
+      flight.next = null
+      if (queued !== null) run().then(queued.resolve, queued.reject)
+      else if (flights.get(dir) === flight) flights.delete(dir)
+    }))
+  if (flight.running === null) return run()
+  if (flight.next === null) {
+    let resolve!: (r: TreeResponse) => void
+    let reject!: (e: unknown) => void
+    const promise = new Promise<TreeResponse>((a, b) => ((resolve = a), (reject = b)))
+    flight.next = { promise, resolve, reject }
+  }
+  return flight.next.promise
+}
+
+async function walk(dir: string): Promise<TreeResponse> {
   await requireDir(dir)
   return { root: dir, tree: await fsCall(dir, () => buildTree(dir)), generatedAt: Date.now() }
 }
```
After this, the behavior is: identical tree answers, each post-dating its request, and a 230-file burst costs 2 walks instead of 231.

### P2 (F1, F6; renderer, handed off). Debounce the two undebounced structural refetches
```diff
--- a/client/src/sidebar/Sidebar.tsx
+++ b/client/src/sidebar/Sidebar.tsx
@@ -537,9 +537,17 @@
   // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
-  useEffect(
-    () =>
-      watch.subscribe((ev) => {
-        if (ev.type === 'error') setError(ev.message)
-        else if (ev.type !== 'change') refresh()
-      }),
-    [watch, refresh],
-  )
+  // Coalesced (YAZ-2131): a burst (git pull, Finder copy, bulk rename) is ONE walk, 100 ms after the last event.
+  useEffect(() => {
+    let timer: ReturnType<typeof setTimeout> | null = null
+    const off = watch.subscribe((ev) => {
+      if (ev.type === 'error') return setError(ev.message)
+      if (ev.type === 'change') return
+      if (timer !== null) clearTimeout(timer)
+      if (ev.type === 'ready') { timer = null; return refresh() }
+      timer = setTimeout(() => { timer = null; refresh() }, 100)
+    })
+    return () => { off(); if (timer !== null) clearTimeout(timer) }
+  }, [watch, refresh])
```
```diff
--- a/client/src/search/useSearchResults.ts
+++ b/client/src/search/useSearchResults.ts
@@ -43,8 +43,13 @@
     // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
+    let timer: ReturnType<typeof setTimeout> | null = null
     const off = watch.subscribe((ev) => {
-      if (ev.type !== 'change' && ev.type !== 'error') load()
+      if (ev.type === 'change' || ev.type === 'error') return
+      if (timer !== null) clearTimeout(timer)
+      if (ev.type === 'ready') { timer = null; return load() }
+      timer = setTimeout(() => { timer = null; load() }, 300)
     })
     return () => {
       cancelled = true
+      if (timer !== null) clearTimeout(timer)
       off()
     }
```
After this, the behavior is: the sidebar and search reflect an external add or remove ≤ 100/300 ms later than today, and a storm makes 1–2 fetches instead of 231–460.

### P3 (F3). `desktop/src/main/ipc/watch.ts`: an unsubscribe during the pending subscribe cancels it
```diff
--- a/desktop/src/main/ipc/watch.ts
+++ b/desktop/src/main/ipc/watch.ts
@@ -7,6 +7,10 @@
 /** Live subscriptions per renderer (`webContents.id`) → subscription id → unsubscribe. */
 const bySender = new Map<number, Map<string, () => void>>()
+/** `<sender>:<id>` of subscribes still awaiting `requireDir`; an unsubscribe in that gap moves it to `cancelled`. */
+const pendingSubs = new Set<string>()
+const cancelled = new Set<string>()
 
@@ -21,17 +25,23 @@
 async function onSubscribe(e: IpcMainEvent, msg: unknown): Promise<void> {
   if (typeof msg !== 'object' || msg === null) return
   const { id, root } = msg as Record<string, unknown>
   if (typeof id !== 'string') return
   const { sender } = e
+  const key = `${sender.id}:${id}`
   // A watcher event can land between the window closing and its `destroyed` hook running.
   const send = (ev: WatchEvent) => {
     if (!sender.isDestroyed()) sender.send(CH.watchEvent, { id, ev })
   }
   let dir: string
+  pendingSubs.add(key)
   try {
     dir = requireAbsPath(root, 'root')
     await requireDir(dir)
   } catch (err) {
+    pendingSubs.delete(key)
+    if (cancelled.delete(key)) return
     // A bad root is the whole answer: one error event, no subscription.
     send({ type: 'error', message: toBridgeFailure(err, String(root)).message })
     return
   }
+  pendingSubs.delete(key)
+  if (cancelled.delete(key)) return // unsubscribed while requireDir was pending (quick vault switch)
   if (sender.isDestroyed()) return
@@ -51,8 +61,12 @@
 function onUnsubscribe(e: IpcMainEvent, id: unknown): void {
   if (typeof id !== 'string') return
+  const key = `${e.sender.id}:${id}`
+  if (pendingSubs.has(key)) {
+    cancelled.add(key)
+    return
+  }
   const subs = bySender.get(e.sender.id)
   const off = subs?.get(id)
   if (subs === undefined || off === undefined) return
```
After this, the behavior is: a vault switch never leaves the old vault's watcher running. Both sets stay empty at rest, because every pending key is removed when its subscribe settles.

### P4 (F2). Watcher engine swap (design; too large for one diff)
- New `desktop/src/main/fs/treeWatcher.ts`:
  - one `fs.watch(root, { recursive: true })`;
  - raw paths are filtered by `isSkipped` segments (and `.yaseendocs/` routed to the config listener set) **before** any syscall;
  - a per-path settle (50–100 ms) then `lstat` against a known map `{path → {dir, mtime, size, ino}}` gives `add` / `change` (with mtime) / `unlink` / `addDir` / `unlinkDir`;
  - a vanished dir emits `unlinkDir` for itself (consumers already prefix-drop: `vaultIndex/live.ts:62-66`);
  - `.tmp-<12 hex>` basenames (`fsUtils.ts:138`) are never announced.
- `ready` is emitted after (a) the 5F1 probe hears and (b) the initial `lstat` walk.
- Fallback: lazily `import('chokidar')` (bundled) with `usePolling` on non-local volumes (memoized `mount` table) or when `fs.watch` throws.
- `fs/watchers.ts:29-53` `createEntry` swaps to `createTreeWatcher(root, isSkippedPath, emit)`; the `subscribe` / refcount API (l.56-71) is unchanged. `vaultConfig.ts:133-161` swaps the same way.
- Order: conformance suite first, green on chokidar, then the swap.
- After this, the behavior is: same events with the same payloads, ~60–110 ms instead of ~258 ms, 0 extra fds, about −40 to −110 MB main RSS.

### P5 (F5). `desktop/src/main/store.ts`: skip byte-identical state writes
```diff
--- a/desktop/src/main/store.ts
+++ b/desktop/src/main/store.ts
@@ -300,14 +300,19 @@
   let timer: ReturnType<typeof setTimeout> | null = null
   /** Writes are chained so two atomic writes can never land out of order. */
   let chain: Promise<void> = Promise.resolve()
+  /** The text of the last successful write: a session-only change (`expanded`, `topicsExpanded`) must not rewrite identical bytes. */
+  let lastWritten: string | null = null
 
   const write = (): Promise<void> => {
     dirty = false
     const snapshot = state
     chain = chain
       .then(async () => {
+        const text = `${JSON.stringify(toDisk(snapshot), null, 2)}\n`
+        if (text === lastWritten) return
         mkdirSync(dirname(filePath), { recursive: true })
-        await atomicWrite(filePath, `${JSON.stringify(toDisk(snapshot), null, 2)}\n`)
+        await atomicWrite(filePath, text)
+        lastWritten = text
       })
       .catch((err: unknown) => console.error(`[store] failed to write ${filePath}: ${String(err)}`))
     return chain
```
After this, the behavior is: the same file contents on disk, rewritten only when they differ. `flush()` still writes anything pending.

### P6 (F7). `desktop/src/main/windows.ts`: flush all renderers in parallel on quit
```diff
--- a/desktop/src/main/windows.ts
+++ b/desktop/src/main/windows.ts
@@ -434,9 +434,14 @@
     async flushAllForQuit() {
       quitting = true
-      for (const [id, win] of [...live]) {
-        if (win.isDestroyed()) continue
-        commitBounds(id, win)
-        await flushRenderer(win)
-        if (!win.isDestroyed()) win.destroy()
-      }
+      const wins = [...live].filter(([, win]) => !win.isDestroyed())
+      for (const [id, win] of wins) commitBounds(id, win)
+      await Promise.all(
+        wins.map(async ([, win]) => {
+          await flushRenderer(win)
+          if (!win.isDestroyed()) win.destroy()
+        }),
+      )
     },
```
After this, the behavior is: quit waits at most one 5 s cap in total instead of 5 s × windows, and every renderer still flushes before the store and git flush (`index.ts:211-214`).
`windows.test.ts` cases that assert sequential order must change to assert parallel order (draw did the same).

## 4. Decisions Yasin must make

**M1. How the vault index reaches each window (F4).**
- **Problem:** every save, in every window, clones the whole index across IPC: 1.3 MB at 2k notes, 6.4 MB at 10k, which is ~30 ms+ of main plus renderer work per save at 10k.
- **Options:**
  1. Keep full snapshots (today). Simple and proven, and the cost grows linearly with vault size.
  2. **Delta feed:** main pushes `{generation, upserts, removes}` after each watcher-driven index mutation, and the renderer keeps a mirror. A full snapshot is still used on first load, on `ready` and on a generation gap. No visible change; per-save cost becomes one record (~1 KB).
  3. Snapshot plus version gate: `fs:index(root, sinceGeneration)` returns `null` when nothing changed. This only helps non-save triggers, so it does not fix typing.
- **Recommendation:** **2**, scheduled after the watcher swap (P4), and only if the renderer angle confirms a visible hitch at 10k notes.
  - It touches the IPC contract and `useExternalRenames`, which diffs consecutive snapshots (`links/useExternalRenames.ts:147-167`), so it needs its own conformance tests.
  - At a typical 1–3k-note vault today's cost (~4 ms total per save) is not worth the risk. Option 1 stays acceptable until then.

**M2. Watcher settle window (F2), only if P4 is approved.**
- **Problem:** the settle time trades event latency against duplicate events.
- **Options:**
  1. 100 ms (draw's choice, ~110 ms latency).
  2. 50 ms (~60 ms latency, slightly more chance of two events for a slow multi-chunk write, where the conformance "slow chunked write → 1 add" case must still pass).
- **Recommendation:** 1, for parity with draw and proven by its suite. Either way it is 2.3–4× faster than today's 258 ms. It is a decision only because it sets how fast external edits appear.

## 5. Keep as-is (measured, not worth changing)
- **Index cache persist** (`vaultIndex/cache.ts`): a full rewrite 5 s after any change costs 2.1 ms (2k) / 13.4 ms (10k), trailing-debounced, so continuous typing writes only on pauses.
- **`getIndex` re-sort per call** (`live.ts:143`): 0.5 / 2.8 ms, dominated by serialization. Memoizing only matters if M1 stays option 1 at 10k+.
- **Save path** (`fs/file.ts:35-53`): 0.2 ms med / 0.6 ms p95 (stat + tmp + rename + stat); the watcher-side scan is 0.1 ms. There is no parse or stringify in main for notes, and identical-content skipping belongs to the renderer autosave.
- **Cold-start reconcile `statSync` loop** (`reconcile.ts:75-83`): documented ~27 ms at 10k, one-time. Once P4 lands, the chokidar-threadpool reason for it is gone, but it is harmless.
- **Git sync idle cost:** zero timers when synced and online. The redundant post-pull pass (F10) is one fetch, idempotent, and not worth the complexity of attributing events to our own rebase.
- **`readImage` / `readPdf`:** already zero-copy `Buffer` over structured clone, bounded snapshot read.
- **IPC style:** no `sendSync` anywhere. All `ipcMain.handle` handlers are async. `ipcMain.on` is used only for watch subscribe/unsubscribe and `app:flushed`. Sync fs in main is limited to startup store load, link-routing `statSync`, and the reconcile loop.
- **CLI** (`desktop/src/cli`): one-shot comment reads and writes through `fs/file.ts`; not a hot path.

## 6. Handoffs to other angles
- **Renderer:**
  - P2 debounces (Sidebar tree, search index).
  - Two tree feeds per window (`Sidebar` + `useViewOnlyCatalog`, each 0.54 / 2.6 MB per fetch): share one.
  - Rebuild cost of `useIndex` records per save at 10k notes (feeds M1).
  - `setIdentity` / `setFolds` call frequency and whether the renderer can skip no-op writes, e.g. do `onCollapsedKeysChange` keys change on plain edits?
- **Reliability / quit:** F1's storm starves `fs:write` behind walks during the 5 s quit flush cap (draw 5E data-loss path). P1 + P6 close it; it is worth an E2E "quit during storm" test.
- **Launch:** `protocol.handle('app')` does `net.fetch(file://)` per renderer asset (`index.ts:162-169`), which is the draw 4A V8-code-cache territory. The watcher `ready` walk plus the index cache load (1.35 / 6.8 MB JSON parse) happen at vault open.
- **Size:** chokidar stays bundled as the polling fallback under P4, so there is no size win. Draw 3E notes that it must be *actually* bundled for the lazy import.
- **Safety net / perf harness:** the benches in `SCRATCH/bench/main-process` (storm with fresh process per rep, watcher fd/latency, index payload) are ready to become the docs 1B perf-budget scenarios.
