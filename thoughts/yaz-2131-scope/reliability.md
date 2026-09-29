# Reliability & durability: YAZ-2132 deep scope, docs app @ 63aeeea

The reproductions use only SCRATCH files, in `SCRATCH/rel/`:
- Playwright specs drive the built `desktop/out` app through the repo's own `desktop/e2e/helpers.ts`. Each run gets an isolated `--user-data-dir` under `SCRATCH/profiles/reliability/` and a throwaway vault under `SCRATCH/vaults/reliability/`.
- vitest files in `rel/vt/` import the repo's main-process modules.
- A node fsync bench: `rel/fsyncbench.mjs`.

I edited no tracked file. I did not open Yasin's real profile or vaults.

Re-run commands:
- `cd SCRATCH/rel && ./node_modules/.bin/playwright test --config playwright.config.ts <spec>`
- `./node_modules/.bin/vitest run --config vt/vitest.config.ts <name>`

## 1. Baseline numbers (all measured)

| What | Result | Runs | Load (uptime 1-min) |
|---|---|---|---|
| ⌘Q path (`app.quit()`) right after typing in a **note** → edit on disk | **5/5 kept** (0 ms wait), 1/1 kept (1.5 s wait) | 6 | 28–34 |
| ⌘Q path right after typing in a **folder-page outline** → edit on disk | **0/5 kept** (0 ms wait). **1/1 kept** after a 1.5 s wait | 6 | 28–34 |
| `app.quit()` → main process gone (note edit pending, sync off) | median **~250 ms** (51, 67, 222, 279, 304, 461), max 461 | 6 | 7.7–12 |
| SIGTERM → process gone, edit on disk | median **~72 ms** (53, 56, 61, 82, 138, 153); edit on disk 6/6 | 6 | 7.7–12 |
| App's own frontmatter write (writeProperty's exact bridge calls) landing N ms after the last body keystroke → false "File changed on disk" bar | 0/12 at N = 0, 150, 1500 ms. At N = 350 / 450 / 550 / 650 ms the bar showed **0/3, 1/3, 3/3, 3/3**, and in those runs the body edit was **not on disk** | 24 | 8–13 |
| `atomicWrite` today vs + `fh.sync()` (F_FULLFSYNC), median / p95 of 25 | 2 KB 1.07/2.33 → **4.45/9.28 ms**. 200 KB 0.97/1.79 → **4.10/4.64 ms**. 3 MB 1.91/3.87 → **6.32/8.12 ms** | 25 each | 8.5 |
| Own saves: do atomicWrite `.tmp-` files ever surface as watcher events? | 0 tmp events in 20 saves (chokidar `awaitWriteFinish` hides them); 20/20 `change a.md` | 20 | 8.5 |

## 2. Findings, most impactful first

### R1: BUG confirmed (data loss). ⌘Q or window close drops outline edits made in the last ~0.7 s
- **What:** a folder page's outline view is its own Milkdown instance (`OutlineEditor`). It keeps its own `pending` value and a 500 ms timer (`client/src/views/view/OutlineEditor.tsx:120-139`), on top of Crepe's ~200 ms listener debounce.
  - It flushes only on React unmount (`:157-160`).
  - The quit/close handshake only awaits `onFlush` listeners (`desktop/src/preload/index.ts:27-28`). The only registrant is `useAutosave` (`client/src/hooks/useAutosave.ts:87`).
  - `flushAllForQuit` then calls `win.destroy()` (`desktop/src/main/windows.ts:436-441`). Destroy runs no unmount, so the timer and `pending` die with the renderer.
- **Evidence:** `rel/quitflush.spec.ts`. The outline marker was lost 5/5 on an immediate quit and kept after a 1.5 s wait. The note editor control kept 5/5.
- **Same path:** ⌘W window close uses the same `flushRenderer` → `destroy` (`windows.ts:279-289`), so it has the same loss.
- **Also exposed, small window:** fire-and-forget frontmatter writes, i.e. `transformFile` (`client/src/views/writeProperty.ts:17-32`), used by properties, comments, folder-page settings, column widths, sorts and board drags. They are two IPC round trips (read, then write). A window destroyed between the two never issues the write.
- **Draw equivalent:** 2A / YAZ-2081 (restore the quit flush), adapted. Here main's sequence is intact; the gap is a renderer surface that never joined the handshake.
- **Risk of the fix:** none visible. It only adds awaited work inside the existing 5 s cap.

### R2: BUG confirmed (false conflict bar, and possible data loss on "Reload"). The app's own property/comment write races the body autosave
- **Path:**
  - `FrontmatterPanel` → `writeProperty` (`client/src/editor/FrontmatterPanel.tsx:185`).
  - `CommentsSection` → `transformFile` (`client/src/comments/CommentsSection.tsx:155`).
  - Both read, then `writeFile(expectedMtime)` the same note whose body has a pending 500 ms autosave.
- **What goes wrong:** if the watcher echo (chokidar `awaitWriteFinish` 200 ms + poll, so ~250–300 ms) has not reached the editor before the debounced save fires, the save's `expectedMtime` is stale.
  - Main answers `CONFLICT` (`desktop/src/main/fs/file.ts:45-49`).
  - `Autosave` blocks and shows the bar (`client/src/lib/autosave.ts:107-110`).
  - The later watcher event is absorbed by `absorbFrontmatterOnly` (`Editor.tsx:405-409`), but nothing clears `conflictMtime` or `blocked`.
- **Evidence:** `rel/spuriousconflict.spec.ts`. The bar showed 7/12 when the write landed 450–650 ms after the last keystroke; in every one of those runs the body was not on disk.
  - "Keep mine" saves correctly.
  - "**Reload** discards the user's typing" (`Editor.tsx:385-391`), yet disk changed only in frontmatter, and the app made that change itself.
- **Realistic trigger:** type in the body, then tick or edit a property or post a comment within about half a second.
- **Draw equivalent:** 2F / YAZ-2124. There it turned out to be a test artefact; here it is a real product race. The fix is adapted: treat a frontmatter-only CONFLICT like `transformFile` does, re-read once and retry.
- **Risk:** none. A real body conflict still raises the bar.

### R3: BUG confirmed (quit can hang up to ~1–2 min). The quit flush loses its `flush` flag when a sync pass is already running
- **What:** `flushForQuit` calls `requestPass(root, true)` (`desktop/src/main/git/manager.ts:392`).
  - If a pass is busy, it joins `entry.follow` (`:138-145`), but the follow-up runs `runPass(root, entry)` with **flush = false** (`:192`).
  - Quit then waits for the running pass, then a full normal pass: `fetch` (30 s cap), `rebase`, and an uncapped push (30 s, `git/exec.ts:75`), instead of YAZ-1111's commit + 5 s-capped push (`git/sync.ts:34,181`).
- **When it bites:** `browser-window-focus` triggers a pull (`index.ts:146-152`, 10 s cooldown). ⌘Q needs the app focused, so "switch to the app and quit" often lands while a focus pull is in flight. That costs ~1–2 s on a good network, and up to ~30 s + 30 s + 30 s on a half-dead one (captive portal, hotel wifi). It also runs a rebase during quit.
- **Evidence:** `rel/vt/gitflush.test.ts` against the real `createGitSync`. With a pass in flight at quit, the passes were `[{flush:false},{flush:false}]` (expected: second `flush:true`). The test fails today.
- **Data:** safe. Renderers flush first, and the follow-up still commits.
- **Draw equivalent:** 2A/2G neighbourhood. The draw app did not report this; the docs app's sync manager is its own.

### R4: BUG confirmed (durability). `atomicWrite` has no fsync; creates and pasted images write straight to their final name
- **atomicWrite:** `desktop/src/main/fs/fsUtils.ts:137-148` does `writeFile(tmp)` → `rename`, with no `fsync`.
  - Every note save, `yaseendocs.json` (`store.ts:310`), `.yaseendocs/*.json` (`vaultConfig.ts:118`), the index cache (`vaultIndex/cache.ts:190`) and drawing saves (`fs/assets.ts:189`) go through it.
  - After a kernel panic, power loss or forced reboot, APFS can surface the renamed file with unwritten data blocks: an empty or garbage note.
  - For the state file, `load()` then moves it aside as `.corrupt-*` and starts from defaults (`store.ts:284-291`). Windows, recents and settings are gone.
- **Create paths:** `createFile` (`fs/create.ts:28`) and `writeAsset({create:true})` (`fs/assets.ts:184-187`, used by pasted images `editor/image/insertImage.ts:91` and new drawings) write `wx` straight to the final name.
  - Nothing is fsynced.
  - A torn write leaves a truncated image under a valid name.
  - A power loss after the note's autosave landed can leave the note referencing an image whose bytes never reached disk.
- **Cost:** measured at +3.4 to +4.4 ms per save (table above), on a 500 ms-debounced save.
- **Draw equivalent:** 2B / YAZ-2082 plus 2B1 / YAZ-2122. It transfers **as-is** (same `atomicWrite` shape). Keep 2B1's exFAT lesson: `link()` gives ENOTSUP on exFAT/FAT, so fall back to `rename`. Unlike draw's content-addressed names, `wx` here must keep EEXIST → `ALREADY_EXISTS` so `writeImage` picks the next suffix. That means `link` (EEXIST-preserving) is the right primitive; a rename fallback on exFAT must check existence first.
- **Secrets:** none are stored. Git uses the system credential helper; there is no token/secret file in main (only `git/sync.ts` mentions tokens, in auth patterns). So draw 2B's 0600 part is **not applicable**.

### R5: BUG confirmed (reliability, low frequency). The watch subscribe/unsubscribe race leaks a watcher
- **What:** `desktop/src/main/ipc/watch.ts:20-58` is byte-for-byte draw's pre-fix code. `onSubscribe` awaits `requireDir` (`:32`); an unsubscribe in that gap finds nothing (`:55`), and the late `subscribe` (`:48`) lives until the window is destroyed.
- **Impact:** chokidar v4 keeps one `fs.watch` per directory of the old root, CPU on every change there, and events sent to a dead subscription id.
- **Trigger:** a root switch followed quickly by another (vault switcher), or a StrictMode double mount in dev.
- **Evidence:** `rel/vt/watchrace.test.ts`. After unsubscribe, `activeWatcherRoots()` still held the root and 1 event had been sent. The test fails today.
- **Draw equivalent:** 2C / YAZ-2083. Transfers **as-is** (use the shipped "pending set" variant).

### R6: BUG confirmed by code (a setting that never persists). A drawing's canvas-background-only change can't be saved
- **What:** `DrawingModal`'s dirty check is `version !== baseline` (`client/src/drawings/DrawingModal.tsx:98`). Version is `engine.getSceneVersion(elements)` (`client/src/drawings/ExcalidrawSurface.tsx:141`), a sum of element versions.
  - The engine's main-menu Canvas Background picker is not hidden (`UI_OPTIONS`, `:84-88`).
  - A background-only change leaves **Save disabled**, and close does not even ask. The change is silently lost, even though `serializeAsJSON` would persist `viewBackgroundColor`.
- **Draw equivalent:** 2E / YAZ-2123. Transfers **adapted**:
  - Draw 2E's `boardAppStateKeys(engine)`, derived from the engine's own serializer, plus a monotone appState-edit counter.
  - Exclude canvas prefs and view state (scroll, zoom, theme, selection), so panning never marks a drawing dirty.
  - The docs app vendors the same engine fork, so the key list is identical.
- **Not run:** a UI repro. It is deterministic from the code.

### R7: Crash-left tmp files are visible in the vault and get committed by sync (confirmed by test and code)
- **What:** a crash between `writeFile(tmp)` and `rename` leaves `Note.md.tmp-<hex>` beside the note.
  - `buildTree` shows it (`fsUtils.ts:112-130`; `rel/vt/tmpfiles.test.ts` returned `a.md.tmp-0123456789ab`, `kind: null`), so it appears in the sidebar as a non-viewable file.
  - GitHub sync's `git add -A` (`git/sync.ts:156`) commits and pushes it.
  - The same `add -A` can also stage a live tmp if a pass overlaps a save; the window is ~1 ms today and ~5 ms with fsync.
  - Nothing sweeps these files. The index-cache dir has a GC (`vaultIndex/cache.ts:62-86`); the vault does not.
- **Draw equivalent:** 2B1 "not done" note. The draw app ignores the `isAtomicTmp` shape in its watcher only.
- **Fix:** exclude the tmp shape from `git add` and from `buildTree`. Do not auto-delete: a leftover may be the only copy of a torn save.

### R8: Windows is broken in draw-2D ways, and the docs app contradicts itself on whether Windows ships (confirmed at logic level; UNCONFIRMED on hardware)
- **Links:** `fileLink('C:\\Users\\me\\Vault\\Note.md')` gives `yaseendocs://C:%5C…`, and `parseFileLink` returns **null** (`shared/links.ts:38-60` requires a leading `/`). Measured in `rel/vt/winpaths.test.ts`.
- **Favorites:** `under()` (`desktop/src/main/favorites.ts:28`) is false for `C:\v\x.md` under `C:\v`, so Add favorite throws "a favorite must be inside the vault" (`:71`).
- **Other hard-coded `/` checks:**
  - `windows.ts:167-170` `rootContains` (link routing)
  - `client/src/editor/image/imageSrc.ts:37-38` (whose comment reads "the app ships mac-only"; images in subfolder notes would resolve wrong)
  - `App.tsx:459,478,519,587`
  - `Sidebar.tsx:314,683,713,731`
  - `lib/treeState.ts:26,56,65`
  - `links/renameLinks.ts:287`, `renameDetector.ts:88`, `useExternalRenames.ts:87`
  - `createFromLink.ts:43`, `views/expr/methods.ts:176,191`
  - `lib/paths.ts basename`
- **"Open with" on Windows:** it does nothing.
  - `fileAssociations` is declared (`desktop/package.json:49-51`).
  - Cold start never reads `process.argv`.
  - `second-instance` keeps only `yaseendocs://` args (`index.ts:33`).
  - `open-file` is macOS-only.
- **Ship status:** `release.yml:27-29` builds and attaches a Windows installer, and README:35 / LAUNCH:31-32 advertise it. README:114 says "no Windows/Linux — all Future issues". → **Decision Q1.**

### R9: Quit sequence is correct but inline and untested; quit teardown is fine
- **Order is right:** `before-quit` (`desktop/src/main/index.ts:207-215`) runs renderers, then `store.flush`, `flushIndexCache` and `gitSync.flushForQuit`, then `app.exit`. This is what draw 2A had to restore.
- **Guards today:**
  - There is no `index.test.ts` wiring test.
  - `Promise.all` would short-circuit (and exit before sync finishes) if any step ever rejected. Today none can: `store.ts:311` and `cache.ts:191` swallow errors, and `runPass` never rejects.
  - The only regression guard is e2e smoke step 5 (note + fold).
- **SIGTERM:** it takes the same flush path. Measured: edit on disk 6/6, gone in a median of ~72 ms.
- **Teardown:** quit → gone in a median of ~250 ms (max 461) at load 8–12. No 5–20 s teardown was seen (draw 2G / YAZ-2125, where the lead locked "leave Chromium's teardown").
- **Recommendation:** extract a `runQuitSequence` with `allSettled` and a wiring test (draw D11), plus an e2e for R1. This is cheap insurance against the exact regression draw hit (a refactor deleting the flush line).

### R10: Not present or not worth it (see §5)
- Draw 2B secrets 0600: not applicable (no secrets).
- Unbounded logs: the app writes no log files (console only). `.corrupt-<epoch>` state backups appear only on corruption. The index cache has a GC.
- Early-event loss after reopen (draw 5F1): the sidebar (`Sidebar.tsx:542`), `useIndex` (`views/useIndex.ts:25`) and search refetch on `ready`.
  - Only the open note editor ignores `ready` (`Editor.tsx:396`). An outside change made during the watcher's initial scan shows only when the user next edits, as a genuine conflict bar. Low; left alone.
- Own-save echo: the note editor's echo suppression holds. 0 false bars when no frontmatter race is involved (12 runs at N = 0/150/1500).

## 3. Proposed changes (diffs are against 63aeeea; not applied, not compiled)

### C1 (R1): outline joins the flush handshake; in-flight `transformFile` writes are awaited

`client/src/views/writeProperty.ts`: track in-flight transforms.
```diff
@@ -11,7 +11,24 @@
+/** Whole-file transforms still in flight (read → write). The close/quit handshake awaits them. */
+const inflight = new Set<Promise<unknown>>()
+
+/** Resolves once no transform is in flight, including ones started while waiting. */
+export async function settleFileWrites(): Promise<void> {
+  while (inflight.size > 0) await Promise.allSettled([...inflight])
+}
+
 /**
  * Apply one pure whole-file transformation with the shared no-op and optimistic-concurrency
  * contract: write against the bytes just read, then re-read and recompute once on conflict.
  * Resolves with the bytes that are on disk afterwards — the transformed content, or the fresh
  * read when the transform was a no-op — so a caller can adopt exactly what landed (YAZ-1472).
  */
-export async function transformFile(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
+export function transformFile(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
+  const run = runTransform(path, transform)
+  inflight.add(run)
+  void run.finally(() => inflight.delete(run)).catch(() => undefined)
+  return run
+}
+
+async function runTransform(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
   let file = await api.readFile(path)
```

`client/src/views/view/OutlineEditor.tsx`: pull the live document and flush on the handshake.
```diff
@@ -33,5 +33,6 @@
 import { useEffect, useMemo, useRef } from 'react'
 import type { Crepe } from '@milkdown/crepe'
 import { applyExternalMarkdown } from '../../editor/external/applyExternalMarkdown'
+import { settleFileWrites } from '../writeProperty'
@@ -150,13 +151,25 @@
 
     const ready = crepe.create().then(() => {
       crepeRef.current = crepe
       knownRef.current = getMarkdownForSave(crepe)
       guard(crepe, seeded.length)
     })
 
+    // The close/quit handshake (GRO-2160): `win.destroy()` runs no unmount, so the timer below
+    // would die with the renderer. Pull the LIVE document (Crepe's listener debounces ~200 ms),
+    // report it, and hold the window until the settings write has landed.
+    const offFlush = window.yaseenDocs.window.onFlush(async () => {
+      if (timer !== null) clearTimeout(timer)
+      const live = crepeRef.current === null ? null : getMarkdownForSave(crepeRef.current)
+      if (live !== null && live !== knownRef.current) pending = live
+      flush()
+      await settleFileWrites()
+    })
+
     return () => {
+      offFlush()
       crepeRef.current = null
       if (timer !== null) clearTimeout(timer)
       flush()
```
Careful: a read-only (seed-loss) editor must not write. `guard` sets it read-only, so the implementer must also skip the flush when `crepe` is read-only. Check `crepe.editor` / the `onSeedLoss` state in the implementation.

`client/src/App.tsx`: one window-wide listener for every other in-flight transform (properties, comments, settings, widths).
```diff
@@ -105,2 +105,4 @@
   const watch = useWatch(root)
+  // Fire-and-forget frontmatter writes (transformFile) must land before the window goes away.
+  useEffect(() => window.yaseenDocs.window.onFlush(settleFileWrites), [])
```
(plus `import { settleFileWrites } from './views/writeProperty'`)

After this, the behavior is: ⌘Q or ⌘W right after typing in an outline, or right after any property/comment/settings gesture, lands the change on disk before the window closes. Nothing visible changes.

**Tests:**
- Unit: `OutlineEditor.test.tsx` registers `onFlush`; the flush reports the live doc once, and not at all for a read-only seed-loss editor.
- Unit: `writeProperty.test.ts`, `settleFileWrites` waits for a transform started mid-wait.
- e2e: port `SCRATCH/rel/quitflush.spec.ts` (outline + note, quit at 0 ms) into `desktop/e2e/` next to smoke step 5. It fails today, 5/5.

### C2 (R2): a frontmatter-only CONFLICT is absorbed and retried once, not surfaced
`client/src/hooks/useAutosave.ts`
```diff
@@ -56,10 +56,21 @@
         save: async (content, expectedMtime) => {
-          try {
-            const res = await api.writeFile({ path, content: frontmatterRef.current + content, expectedMtime })
-            diskBodyRef.current = content
-            return res
-          } catch (err) {
-            if (err instanceof BridgeRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
-            throw err
-          }
+          let expected = expectedMtime
+          for (let retried = false; ; retried = true) {
+            try {
+              const res = await api.writeFile({ path, content: frontmatterRef.current + content, expectedMtime: expected })
+              diskBodyRef.current = content
+              return res
+            } catch (err) {
+              if (!(err instanceof BridgeRequestError) || err.mtime === undefined) throw err
+              // The app's own property/comment write (GRO-2141) rewrote only the frontmatter while
+              // this save was pending: adopt the new block and retry once, as transformFile does.
+              const fresh = retried ? null : await api.readFile(path).catch(() => null)
+              const split = fresh === null ? null : splitFrontmatter(fresh.content)
+              if (fresh === null || split === null || split.body !== diskBodyRef.current) throw new SaveConflict(err.mtime)
+              frontmatterRef.current = split.frontmatter
+              expected = fresh.mtime
+            }
+          }
         },
```
After this, the behavior is: typing in the body and then editing a property or posting a comment within half a second never shows "File changed on disk", and the body lands. A genuine outside body change still raises the bar.

**Tests:**
- `useAutosave.test`: CONFLICT with a frontmatter-only disk change → retries with the fresh mtime and the new frontmatter; CONFLICT with a body change → `SaveConflict`; a second CONFLICT → `SaveConflict`.
- e2e: port `SCRATCH/rel/spuriousconflict.spec.ts` at 450/550/650 ms. It fails today, 7/12.

### C3 (R3): the quit flag survives a busy pass
`desktop/src/main/git/manager.ts`
```diff
@@ -67,4 +67,6 @@
 interface Follow {
   promise: Promise<GithubSyncStatus>
   resolve: (status: GithubSyncStatus) => void
+  /** Any joiner asked for the quit variant (YAZ-1111): the follow-up runs as a flush. */
+  flush: boolean
 }
@@ -138,8 +140,9 @@
     if (entry.follow === null) {
       let resolve: (status: GithubSyncStatus) => void = () => {}
       const promise = new Promise<GithubSyncStatus>((r) => {
         resolve = r
       })
-      entry.follow = { promise, resolve }
+      entry.follow = { promise, resolve, flush: false }
     }
+    if (flush) entry.follow.flush = true
     return entry.follow.promise
@@ -191,2 +194,2 @@
     if (entry.dropped) follow.resolve(status)
-    else void runPass(root, entry).then(follow.resolve, () => follow.resolve(status))
+    else void runPass(root, entry, follow.flush).then(follow.resolve, () => follow.resolve(status))
```
After this, the behavior is: a quit that lands during a focus/adoption pull waits only for that pull to finish, then commits and pushes with the 5 s cap. It never runs a second fetch/rebase.

**Tests:**
- `guarantees.test.ts` "guarantee 5": `rel/vt/gitflush.test.ts` as a case (pass in flight at quit → the second pass has `flush: true`).
- Optional hardening, a Yasin-free choice: also cap the in-flight pass at quit. Not proposed, since it would need killing a running git.

### C4 (R4, R7): durable writes; tmp files never reach the tree or git
`desktop/src/main/fs/fsUtils.ts`
```diff
@@ -1,2 +1,2 @@
 import { randomBytes } from 'node:crypto'
-import { readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
+import { open, readdir, rename, stat, unlink } from 'node:fs/promises'
@@ -56,4 +56,10 @@
 /** Dot-entries and node_modules are invisible to every call. */
 export function isSkipped(name: string): boolean {
-  return name.startsWith('.') || name === 'node_modules'
+  return name.startsWith('.') || name === 'node_modules' || isAtomicTmp(name)
 }
+
+/** `atomicWrite`'s own tmp shape (`<name>.tmp-<12 hex>`): never a user file, never shown or synced. */
+export const isAtomicTmp = (name: string): boolean => /\.tmp-[0-9a-f]{12}$/.test(name)
@@ -132,17 +138,33 @@
+/** open → write → fsync (F_FULLFSYNC on macOS) → close: the bytes are on disk before anyone can name them. */
+export async function writeDurable(file: string, content: string | Uint8Array, flag: 'w' | 'wx' = 'w'): Promise<void> {
+  const fh = await open(file, flag)
+  try {
+    await fh.writeFile(content, 'utf8')
+    await fh.sync()
+  } finally {
+    await fh.close()
+  }
+}
+
+export const tmpSibling = (file: string): string => `${file}.tmp-${randomBytes(6).toString('hex')}`
+
 export async function atomicWrite(file: string, content: string | Uint8Array): Promise<{ mtime: number; size: number }> {
-  const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`
+  const tmp = tmpSibling(file)
   try {
-    await writeFile(tmp, content, 'utf8')
+    await writeDurable(tmp, content)
     await rename(tmp, file)
```
- **Durable create:** `fs/assets.ts:184-187` (create) and `fs/create.ts:28` get a new `createDurable(file, body)`: `writeDurable(tmp, 'wx')` → `link(tmp, file)` → EEXIST rethrown (so `writeImage` still picks `-2`) → `unlink(tmp)` in `finally`. On `ENOTSUP`/`EPERM` from `link` (exFAT, per draw 2B1), use `stat(file)` → ENOENT → `rename`.
- **Sync:** `git/sync.ts:156`: `['add', '-A', '--', '.', ':(exclude,glob)**/*.tmp-*']`.
- **Watcher:** `ignored` already goes through `isSkipped`, so tmp files stop reaching watchers and the index for free.

After this, the behavior is: a crash or power loss can no longer leave an empty or torn note, state file or pasted image under its real name. Leftover tmp files stay on disk (never auto-deleted, since one may be the only copy) but never show in the sidebar and are never committed. Each save costs +3–4 ms (measured).

**Tests:**
- `fsUtils.test.ts`: sync before rename; handle closed and tmp removed on write failure; `isAtomicTmp` table.
- `assets.test.ts`: a torn create leaves no file under the name; EEXIST → ALREADY_EXISTS; a `link` ENOTSUP fallback.
- `tree.test.ts`: a `.tmp-<hex>` sibling is not listed.
- `sync.test.ts`: the tmp shape is not staged (real git fixture).

### C5 (R5): watch race, the draw 2C "pending set" variant
`desktop/src/main/ipc/watch.ts`
```diff
@@ -7,2 +7,4 @@
 /** Live subscriptions per renderer (`webContents.id`) → subscription id → unsubscribe. */
 const bySender = new Map<number, Map<string, () => void>>()
+/** Subscribe ids still checking their root, per sender: an unsubscribe in that gap cancels them. */
+const pending = new Map<number, Set<string>>()
@@ -29,9 +31,15 @@
   let dir: string
+  let waiting = pending.get(sender.id)
+  if (waiting === undefined) pending.set(sender.id, (waiting = new Set()))
+  waiting.add(id)
   try {
     dir = requireAbsPath(root, 'root')
     await requireDir(dir)
   } catch (err) {
+    waiting.delete(id)
     // A bad root is the whole answer: one error event, no subscription.
     send({ type: 'error', message: toBridgeFailure(err, String(root)).message })
     return
   }
+  if (!waiting.delete(id)) return // unsubscribed while requireDir was pending
+  if (waiting.size === 0) pending.delete(sender.id)
   if (sender.isDestroyed()) return
@@ -51,5 +59,6 @@
 function onUnsubscribe(e: IpcMainEvent, id: unknown): void {
   if (typeof id !== 'string') return
+  pending.get(e.sender.id)?.delete(id)
   const subs = bySender.get(e.sender.id)
```
After this, the behavior is: switching vaults quickly never leaves a watcher running on the old vault.

**Test:** `ipc/watch.test.ts` gets `rel/vt/watchrace.test.ts` (fails today), plus "unknown id unsubscribed, then subscribed → `ready`".

### C6 (R6): a drawing's background change makes it dirty
- Port draw 2E: new `client/src/drawings/drawingAppState.ts` (`boardAppStateKeys(engine)` from `serializeAsJSON([], restoreAppState(null,null), {}, 'local').appState`, minus canvas-pref keys).
- `ExcalidrawSurface.tsx:139-145`: `version: engine.getSceneVersion(elements) + edits`, where `edits` counts onChange calls whose persisted-key values differ from the previous call.
- After this, the behavior is: changing Canvas Background enables Save and asks before discard, like any stroke. Pan, zoom and theme never do.
- **Tests:** unit test against the real vendored engine (background counted; scroll, zoom, selection not); an e2e in `drawing.spec.ts` that changes the background → Save → reopen → the background persists.

### C7 (R9): extract `runQuitSequence` (D11 shape)
- Add `desktop/src/main/quitSequence.ts` with `runQuitSequence({ manager, store, flushIndex, gitSync, exit })`: renderers, then `Promise.allSettled([store.flush(), flushIndex(), gitSync?.flushForQuit()])`, then `exit()` in `finally`.
- `index.ts:211-214` calls it.
- **Tests:** a unit test for order, exactly-once calls, and exit on rejection; a mocked-Electron wiring test that `before-quit` passes the live deps.
- After this, the behavior is identical, but no refactor can silently drop a step (the bug the draw app actually shipped).

## 4. Decisions Yasin must make

**Q1: Is Windows a supported platform?**
- **Problem:** the release workflow builds and attaches a Windows installer, and README/LAUNCH advertise it. README:114 and `imageSrc.ts` say mac-only. On Windows, links, Add favorite, "Open with", image paths in subfolders and ~20 renderer containment checks are wrong (R8; logic-level, no hardware).
- **Options:**
  1. Declare mac-only: drop the `windows-latest` release job and the README/LAUNCH lines.
  2. Support it: port draw 2D's `shared/paths.ts isWithin`/`sepOf` to every site, add drive-path link encoding, and read `process.argv` / `second-instance` argv for plain paths (the `fileAssociations` wiring). A Windows CI unit run is the minimum; hardware remains UNCONFIRMED.
  3. Keep shipping as "experimental" and fix only the crashers (favorites, links).
- **Recommendation: 1 now, 2 as its own later project.** Shipping an installer whose basic flows are broken is worse than not shipping it. The draw app's 2D diff is the template when Windows is wanted.

**Q2: What should ⌘Q do with an open, unsaved drawing?**
- **Problem:** the drawing modal is explicit-Save and asks before discarding on Esc/✕ (`DrawingModal.tsx:100-104`). ⌘Q or ⌘W discards it silently: the modal registers no `onFlush`.
- **Options:**
  1. Keep: quit means discard.
  2. Save on quit/close, through the same `saveDrawing` (with its CONFLICT handling), inside the 5 s cap.
  3. Cancel the quit and show the discard strip.
- **Recommendation: 2.** The modal already treats unsaved strokes as something to protect. Saving matches the app-wide "quit never loses an edit" rule (YAZ-1111), and it is invisible when nothing is dirty. Option 3 changes quit's behaviour for every window.

(Every other item here is a bug fix, not a decision.)

## 5. Keep as-is

| Item | Why |
|---|---|
| Quit teardown / force-kill helpers (draw 2G) | Quit → gone median ~250 ms, max 461 ms; SIGTERM median ~72 ms (6 runs each, load 8–12). The lead's draw decision (leave Chromium teardown) applies. |
| Sequential per-window flush, 5 s cap each (`windows.ts:436-441`) | Correct. Parallelising (draw 5G) is a speed item → handoff. |
| Directory fsync after rename | Draw left it out too; the cost/benefit is marginal on APFS. |
| Note-editor echo suppression (`Editor.tsx:395-418`) | 0 false bars across 12 runs without the frontmatter race; `absorbFrontmatterOnly` also covers stale echoes. |
| Log growth | No log files are written; `.corrupt-*` only on corruption; the index cache has a GC. |
| State file permissions | No secrets are stored (Chromium's own files are already 0600). |
| Editor ignoring watcher `ready` | An outside change during the initial scan surfaces as a real conflict on the next edit, not a loss. |

## 6. Handoffs to other angles
- **Perf:** `flushAllForQuit` flushes windows sequentially (N × up to 5 s). Draw 5G parallelised it.
- **Perf / main:** the watcher is chokidar v4 with `awaitWriteFinish` 200 ms, which is also the echo latency behind R2's window. Draw 5F swapped to recursive `fs.watch` with a 100 ms settle. If adopted, keep `isAtomicTmp` in its ignore list and re-run `spuriousconflict.spec.ts`.
- **Size:** none.
- **Test infra:** `SCRATCH/rel/*.spec.ts` and `rel/vt/*.test.ts` are ready to lift into `desktop/e2e/` and the unit suites as the R1/R2/R3/R5 regression tests.
- **Smaller durability gaps:** `atomicWrite` replaces a symlinked note with a regular file and resets its mode to 0644. It is low exposure, since `buildTree` skips symlinks.
