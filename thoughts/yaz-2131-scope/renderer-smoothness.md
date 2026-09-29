# Renderer smoothness — YAZ-2132 deep scope (angle: renderer-smoothness)

Base `main` @ `63aeeea` (v0.9.27). Everything is measured on the packaged renderer bundle (`desktop/out` = the app.asar contents), Apple M3 / 8 cores / 24 GB. Isolated profiles only (`SCRATCH/profiles/renderer-smoothness-*`, `--user-data-dir` plus `YASEEN_DOCS_USER_DATA_DIR`), throwaway vault `SCRATCH/vaults/renderer-smoothness/src`, which `renderer-smoothness/gen.py` generates:
- mixed notes of 1k, 5k and 20k lines (headings, paragraphs with `[[wikilinks]]`, 3-level bullets, tasks, code blocks)
- `headings-5k` (a heading every ~5 lines)
- `tables` (60 tables × 20 rows)
- `comments-60` (60 comments plus 20 replies in frontmatter, with a 1k-line body)
- `images-40` (40 JPEGs of 3000×2000)
- `Big/` (100 folders × 20 notes, 2,114 tree rows when expanded)
- 200 link targets

**How I measured**
- **Harness:** `SCRATCH/renderer-smoothness/*.mjs`, Playwright `_electron`, each run in a fresh isolated profile.
- **React commits:** a DevTools-style commit hook installed before React boots.
- **Profiling:** CDP CPU profiles (200 µs sampling) and Chrome traces.
- **"Base" vs "patched" builds:** both are SCRATCH copies of the packaged app with `app.asar` extracted.
  - `patched` applies proposals **P1, P2 and P3** below to the bundle (`renderer-smoothness/patch.py`).
  - The drawing-preview plugin is deliberately NOT patched (scope change).
- **"measured"** = a number from these runs. **"estimated"** = labelled as such.
- **Machine load (`uptime`):**
  - 2–4 for the final tables (13:46–14:20).
  - The 20k base open ran at load 5–58, because other agents were active.
  - The first exploratory runs (load 13–58) are not used in the tables.

## 1. Baseline numbers (measured)

Open = click the tree row until the sentinel last line is in the editor (tReady), then until the first frame after it (tFrame). "Freeze" = the longest long task. Warm opens: n=5, reported as p50 / p95. The first open is excluded.

| Scenario | Base p50 / p95 | Patched (P1–P3) p50 / p95 | Notes |
|---|---|---|---|
| Open 1k-line note, to first frame | 741 / 764 ms (freeze 492 ms) | **249 / 260 ms** (freeze 204 ms) | n=5 |
| Open 5k-line note | **22,616 / 22,655 ms** (freeze 21.5 s) | **1,269 / 1,286 ms** (freeze 0.94 s) | base n=2 warm + first (23.1 s) |
| Open headings-5k | 24,910 / 25,073 ms (freeze 23.9 s) | 1,117 / 1,147 ms | base n=2 + first (24.7 s) |
| Open 20k-line note | **1,432,569 ms = 23.9 min** (one 1,424.6 s task) | **5,241–5,375 ms** | n=1 each; base at load 5–58 |
| Open comments-60 | 767 / 808 ms (freeze 491 ms) | 269 / 287 ms | n=5 |
| Open tables (60×20) | 928 / 969 ms | 930 / 976 ms (unchanged) | gfm-table parse: F11 |
| Open images-40 | 50 / 52 ms, no long task | same | decode is not on the main thread |
| Keystroke → frame, 1k note | 9.9 / 12.6 ms, 0/40 over 16.7 ms | 9.2 / 12.3 ms | 40 keys, 90 ms apart |
| Keystroke → frame, 5k note | 26.8 / 29.3 ms, 40/40 over 16.7 | **22.0 / 24.6 ms** | Blink part is ~13.5 ms/key (F10) |
| Keystroke → frame, 20k note | not measurable (open never finishes in practice) | 89 / 130 ms, max 372 | F3 rest + Blink |
| Long task after a typing pause (serialize + save) | 5k: 61 ms · 20k: — | 5k: 69 ms · 20k: 228 + 134 ms | F8, F9 |
| Sidebar resize, style recalc per width change (3 tabs open) | **89.5 / 102.6 ms** | P4: **0.0 / 0.2 ms**; with P5 alone: 22.6 ms | in-page microbench, n=20 |
| Sidebar resize, trace (3 tabs, 20 moves) | 123 ms `recalcStyle` per move (wall 2.8 s for 20 moves); 1 tab: 30 ms | — | load ~20 |
| Tab switch, click → next frame (3 tabs) | 115–117 ms (3 runs) | P5: 70–88 ms | n=10 per run |
| Tab switch React work at 2,114 tree rows | ~13 ms render + commit per switch (plus the forced recalc above) | P10 est. <2 ms | CPU profile |
| Tree folder toggle | 314 rows: 5.3 / 6.4 ms · 2,114 rows: 25.9 / 27.1 ms | — | n=10 |
| Hover sweep over 20 tree rows | **0 React commits** | — | no hover state exists |
| Save cycle (2 keys + 3 s) on comments-60 | 5 commits; CommentItem ×240, ~59 ms React per cycle (3 commits of ~20 ms) | P6 est. ~0 | 5 cycles |
| Fast scroll through 40 × 6 MP images (60 steps) | 19–23 of 60 frames > 33 ms, max 35–181 ms | P7: **2–5** of 60, max 33–50 ms | 3 runs each |
| Memory per mounted tab | 1k: +8 MB heap, +12k DOM nodes, +56 MB RSS · 5k: +33–41 MB heap, +48–58k DOM, +90–250 MB RSS | — | D1 |
| Existing perf suite (`client/vitest.perf.config.ts`) | 5 files green: engine 10.1 ms, evaluate 19.1 ms, search 7.3 ms, completion 60.3 ms | — | **no editor perf test exists** |

## 2. Findings (most impactful first)

### F1: Opening any note with bullets runs one full plugin pass per list item (quadratic freeze)
**What**
- Crepe's list-item node view (`@milkdown/components` `src/list-item-block/view.ts:57-72`, `lib/list-item-block/index.js:215-233`) schedules its own `requestAnimationFrame` on mount, and it `view.dispatch`es a `setSelection` to the selection captured at mount.
- A note with N items therefore produces N selection transactions in the first frame.
- Each one runs every plugin's `apply` and `decorations` over the whole document:
  - the wikilink rebuild (F2)
  - the fold decorations (F3)
  - Milkdown's `syncListOrderPlugin` walk (F11)
  - the drawing walk (out of scope)
- The total is O(items × doc), which is quadratic.

**Evidence**
- On the 5k note the freeze is ~22.6 s, of which dispatches from `index-DM1KNA4f.js:109277` (this rAF) are 34.3 s in a loaded profile run. Breakdown:
  - wikilink `build` + `DecorationSet.create`: 18.3 s
  - outline-fold `decorations`: 7.8 s
  - drawing walk: 4.0 s
  - `syncOrderLabel`: 1.06 s
- The 20k note freezes for 23.7 min.
- **P1** (one restore per view per frame) plus P2/P3: 5k drops to 1.27 s and 20k to 5.3 s. After P1 alone the remaining open cost is:
  - parse: 204 ms on 5k
  - one Vue app per list item: 309 ms
  - `focusEditor` forced layout: 276 ms
  - three full serializations: ~150 ms (F9)

**Impact:** by far the biggest smoothness problem in the app. Even a 1k-line outline freezes for ~0.5 s on every open. Large notes are unusable.

**Risk:** low.
- The restore still happens one frame after mount with the latest captured selection, which is the same end state as the last of the N dispatches.
- Pin it with a test that opens a 2k-item note and counts dispatches, plus the existing Enter-in-list caret tests.

**Draw app:** no identical bug. The pattern is draw **5A** (YAZ-2095, upstream perf fix carried in a vendored package), adapted. The docs app already vendors a patched `@milkdown/components` (`client/vendor/milkdown-components-7.22.1-yaz1410.*`), so this is one more hunk in that patch. File it upstream too.

### F2: Wikilink decorations are rebuilt over the whole document on every keystroke and every caret move
**What:** `wikilinkPlugin.ts:239-240` calls `build(state)` on any `docChanged || selectionSet`. That is a full `descendants` walk, a regex per textblock, and `DecorationSet.create` of every link in the note. Only the blocks touched by the edit or by the old/new caret can change (the reveal rule, `touches` at :208).

**Evidence:**
- 5k typing profile: `build$1` is 165 ms per 40 keys (4.1 ms/key). With P2 it is 13.9 ms per 40 keys (0.35 ms/key).
- It is also 18 s of F1's freeze.

**Impact:** typing and arrow-key latency grow linearly with note size. It also multiplies F1.

**Risk:** low–medium. It is pure decoration bookkeeping, but the incremental path must equal `build`. Guard it with a property test: random edits and caret moves, then `rebuildTouched(...)` must `eq` `build(...)`. `build` stays the path for resolver updates.

**Draw app:** none (no ProseMirror).

### F3: The fold plugins rebuild all their decorations on every transaction, caret moves included
**What:**
- `outlineFolding.ts` and `headingFolding.ts` return a fresh state object from `apply` on every transaction (:313, :279).
- They compute `decorations` from scratch in `props.decorations` (:416-471, :349-398): one widget per foldable item plus `DecorationSet.create`. `props.decorations` is called on every view update.
- `getOutlineEntries` walks the whole document on every doc change.

**Evidence:**
- 7.8 s of F1's 5k freeze.
- 20k typing after P1–P3: `viewDecorations` → outline memo is 939 ms per 40 keys (23 ms/key), and `getOutlineEntries` is 4.6 ms/key. This is now the largest JS cost per keystroke on big notes.
- **P3** (identity-stable `apply` plus a memoised `DecorationSet`) removes the selection-only share. The doc-change share needs P3b (map the set when the entries are unchanged). P3b is not measured; estimated −20 ms/key at 20k.

**Impact:** caret moves (arrows, clicks) and typing on large notes.

**Risk:** low for P3 (all fields are provably unchanged when there is no doc change and no fold/view meta). Medium for P3b.

**Draw app:** none.

### F4: Sidebar resize restyles the whole window on every mouse move
**What:**
- `App.tsx:260` stamps `--side-w` on `.app`.
- Custom properties inherit, so every change invalidates the computed style of every element in the window. That includes every mounted tab (hidden layers are `visibility:hidden`, which still get styled).
- The only consumer is `.sidebar { width: var(--side-w) }` (`app.css:959-961`).

**Evidence:**
- Chrome trace: 123 ms of `Document::recalcStyle` per mousemove with 3 tabs (30 ms with 1 tab). 20 moves took 2.8 s of wall time, so the drag runs at ~7 fps.
- In-page microbenchmark (n=20): setting `--side-w` on `.app` costs 89.5 / 102.6 ms. Setting `width` on `.sidebar` costs **0.0 / 0.2 ms**.
- React work is only ~1 ms/move at 314 rows (the App, Sidebar and Tree re-render per move: 42 App, 504 Tree renders per 40-move drag). At 2,114 rows the per-drag Tree renders are 4,488.

**Impact:** the drag is visibly janky. It gets worse with every open tab.

**Risk:** very low (P4 moves one declaration). React state still updates per move, so the right-panel overlay decision (`App.tsx:158-159`) still flips live.

**Draw app:** **5D** (YAZ-2098) "resize without app churn" is **adapted**, not transferred as-is. Draw's fix wrote `--side-w` onto `document.documentElement` during the drag, which here would keep the full-window restyle. The cause in the docs app is CSS inheritance, not React.
- The same mechanism applies to `--right-panel-width` on `.right-panel` (`RightPanel.tsx:148`, consumed only by the element itself, `right-panel.css:3-18`). **P4b** (`@property … inherits: false`) is estimated, not measured.

### F5: Hidden tabs are fully styled; every tab switch restyles both layers synchronously
**What:**
- Inactive layers use `visibility:hidden` (`tabs.css:166-168`, `right-panel.css:164`), so global style changes still restyle them (F4).
- A switch flips an inherited property on two big subtrees.
- `TabBar`'s `useEffect(() => activeRef.current?.scrollIntoView(...), [active])` then forces that recalc synchronously (1,144 ms of 1,302 ms React-commit time over 10 switches was that `scrollIntoView`).

**Evidence:**
- Tab switch is 115–117 ms p50, of which recalcStyle is 84 ms.
- **P5** (add `content-visibility: hidden` to the hidden layer, keeping `visibility: hidden`) measured:
  - 70–88 ms per switch
  - resize recalc with 3 tabs: 22.6 ms instead of 89.5
  - scroll positions preserved (doc 4321→4289.5 and tables 2345→2345; the 1k drift is identical without P5)
- A variant that drops `visibility` (`visible` + `pointer-events:none` + content-visibility) gave the same 83–86 ms, so there is no reason to take its extra risk.

**Impact:** tab switching and every global style change (theme, settings vars, resize) scale with the number of mounted tabs.

**Risk:** low–medium, and it is invisible.
- `content-visibility:hidden` also hides contents from a11y, focus and find, which is what `visibility:hidden` already does.
- It must be verified on the tabs, find, zoom and scroll-restore paths (unit plus the 1C-style E2E, run by the lead).

**Draw app:** related to **D8** (keep all tabs mounted). This makes D8 cheaper instead of revisiting it.

### F6: Every save re-renders the whole note chrome three times
**What:**
- `useAutosave` status goes unsaved → saving → saved. Each transition re-renders `CrepeHost` (`Editor.tsx:442-446`).
- `FrontmatterPanel` and `CommentsSection` get a new `{ ...file, content: disk }` object every render (:483, :491).
- On each render they re-parse the YAML frontmatter:
  - `FrontmatterPanel.tsx:190`
  - `commentsShape` and `readComments` (`CommentsSection.tsx:131-134`)
- They also re-run `marked` + `DOMPurify` for every comment (`comments/markdown.ts:17-23`).
- `FolderPageContents` and `BacklinksSection` re-render too.

**Evidence:** comments-60, 5 save cycles:
- CommentItem ×240 per cycle
- `parseFrontmatter` 107 ms, `DOMPurify.sanitize` 79 ms, `commentHtml` 68 ms
- `performWorkOnRoot` 293 ms in total, about 59 ms per cycle, as three ~20 ms commits (each drops a frame at 60 Hz)

**Impact:** a hitch after every autosave on commented notes. It grows with the number of comments.

**Risk:** very low (P6 is memo plus stable props; the sections already derive everything from their props and own subscriptions).

**Draw app:** **5D** "save chips via store" (YAZ-2098), adapted. Memoising the heavy siblings is the smaller change here. A chips store is the alternative.

### F7: Scrolling image-heavy notes drops frames (synchronous image decode at paint)
**What:** the image node view (`imageView.ts:118-126`) creates `<img>` without `decoding="async"`. Chromium then holds the frame for the decode of large images entering the viewport.

**Evidence:** 60-step fast scroll through 40 × 6 MP JPEGs:
- base: 19 / 23 / 23 frames over 33 ms, max 35–181 ms
- `decoding = 'async'` (P7): 2 / 5 / 3, max 33–50 ms
- Opening the note is already cheap (50 ms, no long task). Renderer RSS is 574 MB after open.

**Impact:** scroll smoothness on photo notes.

**Risk:** negligible. An image can appear one frame after its box while it decodes; nothing moves (the box is sized as today).

**Draw app:** **5B** (YAZ-2096, `ImageBitmap` off the UI thread). This is the `<img>` equivalent: a one-line adaptation.

### F8: Every save re-decorates every open editor twice, and re-renders the whole sidebar tree
**What:**
- An own save → watch `change` → `useIndex` refetch (300 ms debounce, `views/useIndex.ts:20`) → a new `records` array.
- `WikilinkIndexBridge` then calls `source.update` (full wikilink `build` in every mounted editor).
- `ViewOnlyCatalogBridge`'s effect (`WikilinkIndexBridge.tsx:82-86`) re-runs because `semanticRecords` is in its deps. It calls `viewOnly.update(state.catalog)` with an unchanged catalog, which is a second full `build` in every editor.
- `Sidebar` subscribes to `indexSource.records` unconditionally (`Sidebar.tsx:512`), so the whole `Tree` re-renders (12 Tree renders per save at 314 rows, 102 at 2,114).

**Evidence (20k note, profile):** 95 ms (`source.update` path) + 86 ms (`viewOnly.update` path) per save, as separate tasks.

**Impact:** one or two extra long tasks per autosave on big notes. The cost scales with the number of open tabs.

**Risk:** low for P8 (split the effect: the catalog wake-up follows only the catalog). Medium for P8b (skip the resolver notify when the resolution-relevant fields `path`/`basename`/`aliases` are unchanged). P8b needs a check that `makeResolver` reads nothing else.

**Draw app:** related to **5E** (YAZ-2099, coalesced tree refresh), adapted.

### F9: Whole-document markdown serialization on every typing pause (and three times per open)
**What:**
- Milkdown's listener (`@milkdown/plugin-listener`, 200 ms debounce) serializes the entire document on every pause.
- `createCrepe.ts:370-371` then post-processes both `next` and `prev`.
- At open there are three full serializations: the listener `init`, `attach(() => getMarkdownForSave(crepe))` (`Editor.tsx:366`), and a debounced one after Crepe's start-up trailing-paragraph change.

**Evidence:**
- Long task after a pause: 5k 61–69 ms; 20k 228 ms (plus 134 ms).
- At a 5k open: ~52 ms per serialization, ~150 ms in total.

**Impact:** a hitch whenever typing pauses on large notes. Invisible at 1k.

**Risk:** real. Incremental or per-block serialization risks the byte-identical round trip that the app's contracts lock. See **D2**.

**Draw app:** **5G** "one parse, one stringify" (YAZ-2101), adapted in spirit only.

### F10: Remaining per-keystroke cost on big notes is mostly upstream or native
From the 5k trace after P1–P3:
- **Blink's own `GetSelectionOffsets` + `Editor::SyncSelection`: 13.5 ms/key.** This is native, linear in editable text, part of text-input state; there is no app lever.
- Milkdown `syncHeadingIdPlugin` walk: 0.5 ms/key at 5k, 2.1 at 20k.
- `syncListOrderPlugin` walks on every transaction, including caret moves: 0.2 / 1.0 ms/key.
- `liftHeadlessItems` walk (`lineSelection.ts:254-262`): 0.2 / 0.8 ms/key.

Keep them, or file them upstream. See also F11.

### F11: Upstream parse and DOM costs
- **Tables:** `micromark-extension-gfm-table@2.1.1` `EditMap.add` is a linear scan (`lib/edit-map.js:139-155`), which makes `resolveTable` quadratic in total cells. It is 543 ms of the 930 ms open of `tables.md`.
  - An upstream fix (a Map keyed by `at`) is estimated to bring it to ~0.35 s. Upstream first; a local patch is only worth it if Yasin has table-heavy notes.
- **Crepe list items:** each is one Vue app, giving ~12 DOM nodes per line (58k per 5k lines). That is 309 ms of the patched 5k open, and it makes each 5k tab +48–58k DOM nodes. Upstream; keep.

### F12: The zoom-slack measurement runs at 100% zoom, where its answer is always 0
**What:** `Editor.tsx:231-246`. On every body resize (Enter, a line wrap), it runs `querySelectorAll('.list-item > .children')` plus one `getBoundingClientRect` per item, and the result is `Math.round(deepest - deepest/1) = 0`.

**Evidence:** 1.3 ms (1k, 742 items) and 5.7 / 13.4 ms (5k, 3,708 items) per call.

**Risk:** none (P9 writes the same `0px`).

**Draw app:** none.

### F13: `Tree` is not memoised, and its props are rebuilt every Sidebar render
**What:**
- `expanded={new Set(expanded)}` and inline `onToggle` (`Sidebar.tsx:1521-1523`, `:1547-1549`).
- `Tree` itself is a plain function (`Tree.tsx:109`).
- The whole tree therefore re-renders on every Sidebar render: each tab switch (active row), each save (F8), each resize move (F4).

**Evidence:** at 2,114 rows, a folder toggle takes 25.9 ms; a tab switch spends ~13 ms in React; 306 Tree renders per 3 commits.

**Impact:** only noticeable at thousands of expanded rows.

**Draw app:** **5D** `memo(Tree)` plus stable props (YAZ-2098). It transfers adapted: pass each level only the active path it contains, or every level re-renders on a tab switch. Lower priority than F1–F8. Draw's hover-store part does **not** transfer: the docs sidebar has no hover state (0 commits per 20-row sweep).

### Out of scope (drawing component, per Yasin's scope change; no proposal)
- The drawing-preview plugin (`drawing/drawingPreview.ts:145-181`) walks the whole document on every transaction.
- It cost ~4.0 s of the 34 s 5k freeze (loaded run), and 0.7 ms/key at 5k and 2.4 ms/key at 20k after P1–P3.
- It disappears with the component. Until then P1 keeps it from multiplying.

## 3. Proposed changes

### P1 (F1): one list-item selection restore per view per frame
The file to change is `node_modules/@milkdown/components/src/list-item-block/view.ts` (plus the same hunk in `lib/list-item-block/index.js:215-233, 279`), carried in `client/vendor/milkdown-components-7.22.1-yaz1410.patch`. Rebuild with `node tools/buildMilkdownComponentsPatch.mjs`, and extend its README list.
```diff
@@ -10,6 +10,16 @@ import { withMeta } from '../__internal__/meta'
 import { ListItem } from './component'
 import { listItemBlockConfig } from './config'
 
+/**
+ * ONE pending caret restore per editor view (YAZ-2132). Each list item used to schedule its own
+ * rAF + setSelection dispatch on mount, so opening a note with N items ran N full plugin passes in
+ * one frame (quadratic: 22.6 s for 5k lines, 23.9 min for 20k). All of them restore the selection
+ * captured at mount; the last one captured wins, exactly as the last of the N dispatches did.
+ */
+interface PendingRestore { anchor: number; head: number; items: number }
+const pendingRestore = new WeakMap<object, PendingRestore>()
+
 export const listItemBlockView = $view(
   listItemSchema.node,
   (ctx): NodeViewConstructor => {
@@ -44,7 +54,7 @@ export const listItemBlockView = $view(
           dom.classList.remove('selected')
         }
       })
-      let raf = 0
+      let restore: PendingRestore | null = null
       let mountedDiv: HTMLElement | null = null
       const onMount = (div: HTMLElement) => {
         // Vue invokes function refs on every patch, not only on mount.
@@ -57,19 +67,29 @@ export const listItemBlockView = $view(
         const { anchor, head } = view.state.selection
         div.appendChild(contentDOM)
         // put the cursor to the new created list item
-        raf = requestAnimationFrame(() => {
-          raf = 0
-          if (view.isDestroyed) return
-          const { state } = view
-          const docSize = state.doc.content.size
-          if (anchor > docSize || head > docSize) return
-          const anchorPos = state.doc.resolve(anchor)
-          const headPos = state.doc.resolve(head)
-          // Use `between` so we fall back to the nearest valid selection when
-          // the resolved positions no longer sit inside a textblock.
-          const selection = TextSelection.between(anchorPos, headPos)
-          view.dispatch(state.tr.setSelection(selection))
-        })
+        let pending = pendingRestore.get(view)
+        if (pending === undefined) {
+          const entry: PendingRestore = { anchor, head, items: 0 }
+          pending = entry
+          pendingRestore.set(view, entry)
+          requestAnimationFrame(() => {
+            pendingRestore.delete(view)
+            if (entry.items === 0 || view.isDestroyed) return
+            const { state } = view
+            const docSize = state.doc.content.size
+            if (entry.anchor > docSize || entry.head > docSize) return
+            const anchorPos = state.doc.resolve(entry.anchor)
+            const headPos = state.doc.resolve(entry.head)
+            // Use `between` so we fall back to the nearest valid selection when
+            // the resolved positions no longer sit inside a textblock.
+            const selection = TextSelection.between(anchorPos, headPos)
+            view.dispatch(state.tr.setSelection(selection))
+          })
+        }
+        pending.anchor = anchor
+        pending.head = head
+        pending.items++
+        restore = pending
       }
 
       const app = createApp(ListItem, {
@@ -127,7 +147,8 @@ export const listItemBlockView = $view(
           selected.value = false
         },
         destroy: () => {
-          cancelAnimationFrame(raf)
+          if (restore !== null && pendingRestore.get(view) === restore) restore.items--
+          restore = null
           disposeSelectedWatcher()
           app.unmount()
           dom.remove()
```
**After this:** opening a note dispatches one caret restore per frame instead of one per bullet. The caret lands exactly where it does today. Measured: 5k open 22.6 s → 1.27 s, 20k 23.9 min → 5.3 s (together with P2/P3; P1 alone removes all the per-item transactions).

### P2 (F2): incremental wikilink decorations (`client/src/editor/wikilink/wikilinkPlugin.ts`)
```diff
@@ -35,1 +35,1 @@
-import { Plugin, PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state'
+import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from '@milkdown/kit/prose/state'
@@ -212,19 +212,63 @@ function touches(sel: Selection, from: number, to: number): boolean {
-function build(state: EditorState, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): DecorationSet {
-  const decorations: Decoration[] = []
-  const sel = state.selection
-  state.doc.descendants((node, pos) => {
-    if (node.type.name === 'code_block') return false
-    if (!node.isTextblock) return true
-    eachPlainRun(node, pos + 1, (text, runPos) => {
-      for (const m of text.matchAll(WIKILINK_RE)) {
-        if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
-        const from = runPos + m.index
-        const to = from + m[0].length
-        if (touches(sel, from, to)) continue // caret inside/adjacent → raw, editable syntax
-        decorate(decorations, from, m[2], source, viewOnly)
-      }
-    })
-    return false
-  })
-  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
-}
+/** One textblock's link decorations — the unit both the full build and the incremental path use. */
+function decorateBlock(out: Decoration[], node: ProseNode, pos: number, sel: Selection, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): void {
+  eachPlainRun(node, pos + 1, (text, runPos) => {
+    for (const m of text.matchAll(WIKILINK_RE)) {
+      if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
+      const from = runPos + m.index
+      const to = from + m[0].length
+      if (touches(sel, from, to)) continue // caret inside/adjacent → raw, editable syntax
+      decorate(out, from, m[2], source, viewOnly)
+    }
+  })
+}
+
+function build(state: EditorState, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): DecorationSet {
+  const decorations: Decoration[] = []
+  state.doc.descendants((node, pos) => {
+    if (node.type.name === 'code_block') return false
+    if (!node.isTextblock) return true
+    decorateBlock(decorations, node, pos, state.selection, source, viewOnly)
+    return false
+  })
+  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
+}
+
+/**
+ * YAZ-2132: an edit or a caret move can only change the links of the textblocks it touched — the
+ * edited ranges plus the blocks under the old and new selection (the reveal rule). Map the set,
+ * drop those blocks' decorations and re-decorate just them. A resolver update still runs `build`.
+ * Pinned by a test that compares against `build` after random edits and caret moves.
+ */
+export function rebuildTouched(set: DecorationSet, tr: Transaction, oldState: EditorState, state: EditorState, decorateOne: (out: Decoration[], node: ProseNode, pos: number) => void): DecorationSet {
+  const { doc } = state
+  const ranges: [number, number][] = []
+  if (tr.docChanged) {
+    set = set.map(tr.mapping, doc)
+    tr.mapping.maps.forEach((map, i) => {
+      const rest = tr.mapping.slice(i + 1)
+      map.forEach((_oldFrom, _oldTo, from, to) => ranges.push([rest.map(from, -1), rest.map(to, 1)]))
+    })
+  }
+  ranges.push([tr.mapping.map(oldState.selection.from, -1), tr.mapping.map(oldState.selection.to, 1)])
+  ranges.push([state.selection.from, state.selection.to])
+  const blocks = new Map<number, ProseNode>()
+  for (const [a, b] of ranges) {
+    const from = Math.max(0, Math.min(a, b) - 1)
+    const to = Math.min(doc.content.size, Math.max(a, b) + 1)
+    doc.nodesBetween(from, to, (node, pos) => {
+      if (!node.isTextblock) return true
+      blocks.set(pos, node)
+      return false
+    })
+  }
+  for (const [pos, node] of blocks) {
+    set = set.remove(set.find(pos, pos + node.nodeSize))
+    if (node.type.name === 'code_block') continue
+    const out: Decoration[] = []
+    decorateOne(out, node, pos)
+    if (out.length > 0) set = set.add(doc, out)
+  }
+  return set
+}
@@ -238,3 +282,7 @@ export function createWikilink(source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource) {
           init: (_, state) => build(state, source, viewOnly),
-          apply: (tr, set, _old, state) =>
-            tr.docChanged || tr.selectionSet || tr.getMeta(wikilinkKey) !== undefined ? build(state, source, viewOnly) : set,
+          apply: (tr, set, oldState, state) =>
+            tr.getMeta(wikilinkKey) !== undefined
+              ? build(state, source, viewOnly)
+              : tr.docChanged || tr.selectionSet
+                ? rebuildTouched(set, tr, oldState, state, (out, node, pos) => decorateBlock(out, node, pos, state.selection, source, viewOnly))
+                : set,
```
**After this:** a keystroke or caret move re-decorates only the one or two blocks it touched, and links render exactly as before. Measured on 5k: 4.1 → 0.35 ms/key.

### P3 (F3): fold plugins keep their state when nothing changed, and memoise decorations (`client/src/editor/outline/outlineFolding.ts`; the same three hunks in `headingFolding.ts` at :279, :349-351 and :398)
```diff
@@ -293,3 +293,6 @@ const getCollapsedKeys = ({ entries, collapsedItemPositions }: OutlineFoldingState): string[] =>
     .sort()
 
+/** One DecorationSet per plugin state object (YAZ-2132): `apply` keeps the object when nothing changed. */
+const decorationCache = new WeakMap<OutlineFoldingState, DecorationSet>()
+
 export const createOutlineFolding = ({ seedCollapsedKeys = () => new Set(), onCollapsedKeysChange }: OutlineFoldingOptions = {}) =>
@@ -313,2 +316,6 @@ export const createOutlineFolding = ({ seedCollapsedKeys = () => new Set(), onColl
           apply: (transaction, previousState, _oldState, newState) => {
+            // A caret move / selection restore changes no doc, fold or view action: every field below
+            // would come out equal, so keep the SAME object (the memo below and `notify` see nothing new).
+            if (!transaction.docChanged && transaction.getMeta(pluginKey) === undefined && transaction.getMeta(VIEW_ACTION_META) === undefined) return previousState
             const entries = transaction.docChanged ? getOutlineEntries(newState.doc) : previousState.entries
@@ -416,4 +423,6 @@ export const createOutlineFolding = ({ seedCollapsedKeys = () => new Set(), onColl
           decorations: (state) => {
             const foldingState = pluginKey.getState(state)
             if (!foldingState) return DecorationSet.empty
+            const cached = decorationCache.get(foldingState)
+            if (cached !== undefined) return cached
 
@@ -471,1 +480,3 @@ export const createOutlineFolding = ({ seedCollapsedKeys = () => new Set(), onColl
-            return DecorationSet.create(state.doc, decorations)
+            const set = DecorationSet.create(state.doc, decorations)
+            decorationCache.set(foldingState, set)
+            return set
```
**After this:** caret moves and selection restores cost the fold plugins nothing. Folds, chevrons and ⌘Z-of-fold behave identically.
- Follow-up **P3b** (not measured): in `apply`, when the recomputed entries' `(foldKey, itemPos)` sequence equals the previous one mapped through `tr.mapping`, keep a mapped `DecorationSet` in the state instead of `create` (estimated −20 ms/key at 20k).

### P4 (F4): stop restyling the window on sidebar resize
`client/src/App.tsx`:
```diff
@@ -257,5 +257,4 @@ export function App() {
     '--thread-width': `${settings.threadWidth}px`,
     // Absent → bulletThreading.css falls back to the app accent.
     ...(settings.threadColor !== null ? { '--thread-color': settings.threadColor } : {}),
-    '--side-w': `${sidebarWidth}px`,
   } as CSSProperties
@@ -798,2 +797,4 @@ export function App() {
           unadopted={unadopted}
           onCreateHome={createHome}
+          // YAZ-2132: the width sits on the sidebar itself; stamped on .app it restyled every tab per mouse move.
+          width={sidebarWidth}
         />
```
`client/src/sidebar/Sidebar.tsx`:
```diff
@@ -38,3 +38,5 @@ import { flashTreeRows, revealMissingMessage, type SidebarRevealRequest } from './revealRow'
 interface SidebarProps {
   root: string
+  /** Current width in px (YAZ-738), applied to this aside only. */
+  width: number
   activeFile: string | null
@@ -392,5 +394,6 @@ export function Sidebar({
   unadopted,
   onCreateHome,
   selectionRef,
   clipboardRef,
+  width,
 }: SidebarProps) {
@@ -1313 +1316 @@ export function Sidebar({
-    <aside className="sidebar">
+    <aside className="sidebar" style={{ width }}>
```
`client/src/app.css`:
```diff
@@ -959,4 +959,4 @@
-/* --side-w is stamped on .app from AppState.sidebarWidth (YAZ-738). */
+/* width is stamped on .sidebar itself from AppState.sidebarWidth (YAZ-738, YAZ-2132). */
 .sidebar {
-  width: var(--side-w);
   flex: none;
```
`client/src/App.test.tsx`:
```diff
@@ -730 +730 @@
-  const sideW = (el: HTMLElement) => el.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--side-w')
+  const sideW = (el: HTMLElement) => el.querySelector<HTMLElement>('.sidebar')?.style.width
```
**After this:** dragging the sidebar edge looks and behaves exactly the same (live width, collapse-by-drag, persisted width, live right-panel overlay flip), but each move restyles one element instead of the whole window. Measured style cost with 3 tabs: 89.5 ms → 0.0 ms per move.
- **P4b** (estimated), `client/src/right-panel/right-panel.css`, top of file: `@property --right-panel-width { syntax: '<length>'; inherits: false; initial-value: 420px; }`. The var is read only by the element that sets it (lines 3-18). Take `initial-value` from `RIGHT_PANEL_DEFAULT_W`.

### P5 (F5): skip style and layout work for hidden tab layers
`client/src/tabs/tabs.css`:
```diff
@@ -166,3 +166,6 @@
 .tabstack__layer--hidden {
   visibility: hidden;
+  /* YAZ-2132: and skip its style/layout/paint while hidden. Unlike display:none this keeps every
+     scroller's offset (measured), so rule 6 still holds; switch 115 → 70-88 ms with 3 tabs. */
+  content-visibility: hidden;
 }
```
`client/src/right-panel/right-panel.css`:
```diff
@@ -164 +164 @@
-.right-panel__editor-layer--hidden { visibility: hidden; }
+.right-panel__editor-layer--hidden { visibility: hidden; content-visibility: hidden; }
```
**After this:** tabs look and behave the same (scroll, caret, undo, unsaved buffer kept), but hidden tabs no longer cost anything on a tab switch, a resize or a theme change. Measured: tab switch 115 → 70–88 ms; resize restyle with 3 tabs 89.5 → 22.6 ms (before P4).

### P6 (F6): saves stop re-rendering the note's heavy sections (`client/src/editor/Editor.tsx`)
```diff
@@ -1 +1 @@
-import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
+import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
@@ -45,2 +45,9 @@ import { ImageViewer } from '../viewers/ImageViewer'
 
+// YAZ-2132: the save chip's three status flips (unsaved → saving → saved) re-render CrepeHost; these
+// sections depend on none of it, and CommentsSection re-ran marked + DOMPurify per comment each time.
+const MemoFrontmatterPanel = memo(FrontmatterPanel)
+const MemoFolderPageContents = memo(FolderPageContents)
+const MemoCommentsSection = memo(CommentsSection)
+const MemoBacklinksSection = memo(BacklinksSection)
+
 interface EditorProps {
@@ -273,1 +280,3 @@ function CrepeHost({
   const [disk, setDisk] = useState(file.content)
+  /** The disk-truth file both panels read — one identity per `disk`, so a memo'd panel skips renders that change nothing. */
+  const diskFile = useMemo(() => ({ ...file, content: disk }), [file, disk])
@@ -483 +492 @@ function CrepeHost({
-          <FrontmatterPanel file={{ ...file, content: disk }} root={root} properties={properties} wikilinks={wikilinks} />
+          <MemoFrontmatterPanel file={diskFile} root={root} properties={properties} wikilinks={wikilinks} />
@@ -487 +496 @@ function CrepeHost({
-          <FolderPageContents path={file.path} root={root} source={wikilinks} properties={properties} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} wikilinkCandidates={wikilinkCandidates} newNoteFolderFor={newNoteFolderFor} onNotice={onNotice} fileContent={file.content} />
+          <MemoFolderPageContents path={file.path} root={root} source={wikilinks} properties={properties} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} wikilinkCandidates={wikilinkCandidates} newNoteFolderFor={newNoteFolderFor} onNotice={onNotice} fileContent={file.content} />
@@ -491 +500 @@ function CrepeHost({
-        <CommentsSection file={{ ...file, content: disk }} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} />
+        <MemoCommentsSection file={diskFile} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} />
@@ -493 +502 @@ function CrepeHost({
-          <BacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
+          <MemoBacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
```
**After this:** a save repaints only the chips. The properties, folder contents, comments and backlinks re-render only when their inputs change (new disk bytes, index updates through their own subscriptions). Estimated: ~59 ms → ~0 ms React per save cycle on comments-60.

### P7 (F7): off-frame image decode (`client/src/editor/image/imageView.ts`)
```diff
@@ -118,2 +118,4 @@ class ImageView {
     const img = document.createElement('img')
     img.draggable = false
+    // YAZ-2132: decode off the frame — a 6 MP photo scrolling in no longer holds the frame for its decode.
+    img.decoding = 'async'
     img.addEventListener('load', () => this.setStatus('ready'))
```
**After this:** images look, size, fold and open the same. Fast scrolling through photo notes stops dropping frames (measured: 19–23 → 2–5 of 60 frames over 33 ms).

### P8 (F8): the catalog wake-up only follows the catalog (`client/src/editor/wikilink/WikilinkIndexBridge.tsx`)
```diff
@@ -82,5 +82,11 @@ function ViewOnlyCatalogBridge({ root, watch, semanticRecords, candidates, viewOnly }: {
   useEffect(() => {
     if (state.status !== 'ready' || state.catalog.root !== root) return
     viewOnly.update(state.catalog)
-    candidates?.update(mergeLinkCandidates(linkCandidates(semanticRecords), state.catalog.candidates))
-  }, [state.status, state.catalog, root, semanticRecords, candidates, viewOnly])
+  }, [state.status, state.catalog, root, viewOnly])
+  // Candidates follow BOTH feeds; the catalog wake-up above follows only the catalog (YAZ-2132: re-running
+  // it on every records change re-decorated every open editor a second time per save — 86 ms on 20k lines).
+  useEffect(() => {
+    if (state.status !== 'ready' || state.catalog.root !== root) return
+    candidates?.update(mergeLinkCandidates(linkCandidates(semanticRecords), state.catalog.candidates))
+  }, [state.status, state.catalog, root, semanticRecords, candidates])
   return null
```
**After this:** a save wakes each open editor once instead of twice. Links and the `[[` picker stay identical.
- **P8b** (not diffed; needs a check that `makeResolver` reads only `path`/`basename`/`folder`/`aliases`): give `createWikilinkResolveSource` a resolution signature and a `resolutionVersion`. The editor plugin (`wikilinkPlugin.ts:246-248`) then dispatches only when that version moves, so a plain body save re-decorates nothing. Backlinks and folder pages keep their record updates.

### P9 (F12): skip the zoom-slack walk at 100% (`client/src/editor/Editor.tsx`)
```diff
@@ -235,3 +235,8 @@ function CrepeHost({
     const sync = () => {
       const zoom = documentZoomRef.current / 100
+      // YAZ-2132: at 100% the slack is 0 by definition (deepest − deepest/1) — skip the per-bullet rect walk.
+      if (zoom === 1) {
+        scroller.style.setProperty('--zoom-slack', '0px')
+        return
+      }
       const left = body.getBoundingClientRect().left
```
**After this:** same `0px`, without 5.7 ms of rect reads per Enter on a 5k-line note.

### P10 (F13, lower priority): memo the tree (draw 5D, adapted)
In `client/src/sidebar/Sidebar.tsx`:
- Replace `expanded={new Set(expanded)}` (:1521, :1547) with a `useMemo(() => new Set(expanded), [expanded])` value.
- Replace the inline `onToggle={(dir) => dispatch({ type: 'toggle', dir })}` (:1523, :1549) with a `useCallback`.
- Stabilise `fileMove`, `selection`, `pending` and `favoriteReorder`, as draw 5D did.

Then `export const Tree = memo(TreeImpl)` in `Tree.tsx:109`, and pass each level only the `activeFile` it contains, so a tab switch re-renders two levels.

**After this:** the tree renders only the rows that change.
- Worth doing only after P1–P8. Estimated at 2,114 rows: tab switch −13 ms, toggle ~26 → <5 ms.
- A diff is not written here: the prop-stabilisation list must be re-derived from the current Sidebar (1,608 lines).

**Also add (safety net):** `client/src/editor/editor.perf.test.ts` in the existing perf project.
- Create Crepe on a generated 5k-line note and assert that open dispatches ≤ 3 transactions (P1).
- Dispatch 50 one-character inserts and caret moves, and budget the plugin `apply` + `decorations` time (P2/P3).
- There is no editor perf test today, which is how F1 shipped.

## 4. Decisions Yasin must make

**D1: memory of kept-mounted tabs** (draw **D8** kept every visited tab mounted, no LRU)
- **Problem:** every visited tab stays mounted (rule 6). A 5k-line tab costs +33–41 MB JS heap, +48–58k DOM nodes and +90–250 MB renderer RSS (measured). A 1k tab costs +8 MB / +12k / +56 MB.
- **Options:**
  1. Keep all tabs mounted (today) and add P5, so hidden tabs cost memory but no smoothness.
  2. An LRU that unmounts the least recent tab beyond N. That tab loses its undo history and caret on return, and its unsaved buffer must flush first. This is a behaviour change.
  3. Unmount only tabs over a size threshold.
- **Recommendation: 1.** P5 removes the smoothness cost (the part users feel). The memory is only large for very large notes, and option 2 changes a locked behaviour for no visible gain at normal note sizes. Same answer as draw D8.

**D2: whole-document serialization on every typing pause (F9)**
- **Problem:** after every pause, the whole note is serialized to markdown: a 61–69 ms task at 5k and ~228 ms at 20k (measured).
- **Options:**
  1. Keep it (it is only visible on very large notes).
  2. Incremental serialization: cache markdown per unchanged top-level block and join. This is a big win at 20k, but remark's join rules between siblings (list tightness, separators) make byte-identical round trips a real risk against the save-path contracts.
  3. Lengthen the listener debounce for notes over N lines. The file saves later, and a crash loses more.
- **Recommendation: 1 for now.** Revisit option 2 only if Yasin actually keeps 10k+-line notes. The small safe trim (skip the second post-process at `createCrepe.ts:371` by remembering the last value) is not worth a change on its own.

## 5. Keep as-is (measured, not worth it)
- **Sidebar hover:** 0 React commits per 20-row sweep. Draw's hover store does not transfer.
- **Opening image-heavy notes:** 50 ms, no long task. `loading="lazy"` would also defer the image boxes' real size, causing layout shift on scroll: a visible change for no measured open cost.
- **Existing perf-tested paths:**
  - search: 7.3 ms at 2k records
  - views engine: 10 ms per 1,000 records
  - completion: 60 ms at 5k records
  - backlinks: cached by records identity (`links/backlinks.ts:38-44`)
  - `TableView`: already windowed
- **Blink `GetSelectionOffsets`/`SyncSelection`:** 13.5 ms/key at 5k. This is native, with no app lever short of splitting the contenteditable.
- **Crepe's one Vue app per list item:** 309 ms of a 5k open; upstream.
- **Upstream Milkdown per-transaction walks (`syncHeadingIdPlugin`, `syncListOrderPlugin`):** ≤2 ms/key at 20k after P1. File upstream, and do not patch locally.
- **Drawer/panel animations:** not measured this run. No finding and no reason to touch them (draw D4).
- **React Compiler / tree virtualization:** not needed at the measured sizes (draw also deferred them).

## 6. Handoffs to other angles
- **Main-process / watcher:**
  - Every own save triggers a watch `change` → a full `api.index(root)` refetch 300 ms later (`views/useIndex.ts:20-86`).
  - A main-side "records unchanged except the saved note" delta, or an unchanged short-circuit, would cut F8 at the source.
- **Safety net:** there is no editor perf test (see "Also add" under P10). E2E for P5 must cover tab scroll restoration, find and zoom.
- **Runtime-shell (IMPORTANT, safety):** LaunchServices lists `desktop/dist-app/mac-arm64/Yaseen Docs.app` at **0.9.27**, above `/Applications/Yaseen Docs.app` at **0.9.26**. Every launch calls `app.setAsDefaultProtocolClient('yaseendocs')` (`desktop/src/main/index.ts:45`), so `yaseendocs://` links may now open the dev build with Yasin's real profile. SCRATCH copies from the size and startup angles are also registered at 0.9.27 (`scratchpad/size/sim/stage-*`, `scratchpad/startup/apps/Instr.app`).
- **Size / bundle:** the renderer bundle is unminified (component names intact, `index-*.js` 4.85 MB).
- **Upstream (Milkdown / micromark):**
  - the F1 list-item fix
  - `syncListOrderPlugin` running on caret moves
  - the `micromark-extension-gfm-table` `EditMap` linear scan (F11)

## Machine-safety log (for the coordinator)
- **Launches:** every launch used `--user-data-dir=SCRATCH/profiles/renderer-smoothness-*` plus `YASEEN_DOCS_USER_DATA_DIR`. There was no bare launch, no `open -a`, no E2E suite run, and no access to the real profile, `/Applications` or real vaults.
- **What I launched:**
  - the packaged `desktop/dist-app/.../Yaseen Docs.app` (registered at 0.9.27 in LaunchServices before my runs)
  - two SCRATCH copies (`scratchpad/apps/{base,patched}.app`)
- **LaunchServices side effect:** LaunchServices registered my two copies at 0.9.27 on launch. Once I noticed, I lowered their `CFBundleVersion`/`ShortVersion` to 0.0.1 and re-registered them (`lsregister -f`). After the last run I **unregistered** both (`lsregister -u`). None is registered now.
- **One mistake:** I launched a stray 20k-open run on the packaged build by accident, then killed it and its app with SIGTERM/SIGKILL. All of these were my own processes, in an isolated profile on a scratch vault.
- **Clean-up:** `pgrep` shows no leftover processes from this angle.

Harness: `SCRATCH/renderer-smoothness/` (`lib.mjs`, `open.mjs`, `typing.mjs`, `renders.mjs`, `trace.mjs`, `resizetrace.mjs`, `tabtrace.mjs`, `cvexp.mjs`, `sidew.mjs`, `images.mjs`, `savecycle.mjs`, `tabmem.mjs`, `treeprof.mjs`, `slack.mjs`, `patch.py`, `gen.py`, profiles `prof-*.cpuprofile`, traces `trace-*.json`).
