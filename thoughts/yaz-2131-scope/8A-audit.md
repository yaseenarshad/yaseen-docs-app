# YAZ-2208 (8A) audit of `63aeeea..yaz-2131-speed` (HEAD `f2f1109`)

Read-only. Nothing was built, run or changed. Every line number is from HEAD. All six code groups and the docs were audited per file, and every usage claim was checked with grep.

**Counts: must 19 · should 52 · nit 57 · not worth fixing 22.** Each count is of graded items; an item that lists several places counts once.

**Yasin decisions needed before or during 8B:**
1. `mainBundleBytes` ceiling: CI is red until he decides (group 5).
2. Opening the D2 upstream Milkdown PR (Docs, vendor md).
3. Keeping the YAZ-2238 tooltip patch, which is outside D1–D10, and its follow-up issue (group 3).

**The musts:**
- CI red on `mainBundleBytes`.
- The polling fallback leaks root `addDir`/`unlinkDir` events, a guardrail regression on that path (group 1).
- The e2e `launchApp` doesn't pin `YASEEN_DOCS_USER_DATA_DIR` (machine safety, group 6).
- About 22 orphaned e2e doc comments left by 6B.
- Stale "chokidar" and "200 ms" comments: `shared/ipc.ts:222`, `useWatch.ts:13`, `frontmatterRace.spec.ts:4–5` (whose delays may no longer reach the retry path, UNCONFIRMED).
- The stale bigNote freeze comment.
- A misplaced doc block in `App.test.tsx`.
- A false "screenshot e2e" claim in `confirmSheets.test.tsx`.
- Wrong rows in CONTRACTS, LAUNCH and REGRESSION: spec count 61 → 65, deleted `*Api`/`channels.ts` names, the pre-YAZ-2240 refresh rule, W8, P2–P4.

**How to work this:** top to bottom. The order is Docs → Known items → D1–D10 table → groups 1 to 6. Every item names the file:line and the action. "Keep because" and rejected items are at the end.

Diff: 282 files (without `thoughts/` and `tools/perf/runs/`), +11,701 / −3,018. Net by kind: product src **+1,006**, unit tests +3,457, e2e +1,994, tools/perf +1,635 (457 of it `baseline.json`), docs and patches +466, other tools +87, config +34.

---

## Docs

### docs/CONTRACTS.md
- **[must] L110** says "the sidebar and search wait out 100 ms of watcher quiet before re-reading". YAZ-2240 (`9ae89b4`, `client/src/lib/leadingTrailing.ts`) changed this to a leading-edge read. **Fix:** "the sidebar and search read at once on the first structural event after a quiet spell, then coalesce a burst into one trailing read 100 ms after its last event (`lib/leadingTrailing.ts`, YAZ-2240); `ready` reads at once".
- **[must] L63** says "61 specs". There are 65 on disk (`ls desktop/e2e/*.spec.ts`). **Fix:** change it to 65.
- **[must] L536** still cites channels `(desktop/src/channels.ts)`, which was deleted in YAZ-2200, and "the `StateApi` anti-clobber shape". **Fix:** cite `CONTRACT.properties` in `shared/ipc.ts`, and say "the state door's anti-clobber shape" instead of `StateApi`.
- **[must] L544 (×2), L40** name `PropertiesApi`, which no longer exists (grep finds 0 hits in `client/src`, `desktop/src` and `shared`). **Fix:** L40 and L544 should say "the same `YaseenDocsApi['properties']` shape". Drop `PropertiesApi` from the `shared/types.ts` list at L544.
- **[must] L384** lists `FavoritesApi` in `shared/types.ts`, but it was deleted. **Fix:** remove it from the list.
- **[should] L236, L382, L406** say `Sidebar.tsx` holds the menu targets, `focusable()`, `setFolderPageFlag` / `toggleFolderPage` and `openTopicsMenu`. Grep shows these are still in `Sidebar.tsx`, so these rows are correct. However, the file map has no row for the D10 split. **Fix:** add a row: `client/src/sidebar/hooks/` holds `useVaultTree` (tree, expansions, focus lists, favorites, missing-file checks), `rowGestures` (multi-select, row drags, file clipboard, inline create/rename) and `useSidebarSearch` (YAZ-2131 🔒 D10, YAZ-2202, move-only).
- **[should] file map** has no rows for `client/src/lib/leadingTrailing.ts`, `client/src/lib/windowFlush.ts`, `desktop/src/main/ipc/broadcast.ts`, `shared/guards.ts` or `desktop/src/main/fs/validate.ts`. Test files missing from the map: `tools/afterPack.test.mjs`, `tools/dmg.test.mjs`, `desktop/electron.vite.config.test.ts`. **Fix:** add one short clause per file to the rows that already exist for its directory.

### LAUNCH.md
- **[must] L51** says "61 specs; the 50 before YAZ-2171's additions ran in ~3.2 min". **Fix:** change it to "65 specs". Keep the timing sentence, or replace it with a fresh full-run time from 7B.
- **[should] L50** describes `tools (node — the migration CLI)`. The tools project (`tools/vitest.config.ts` `include: ['*.test.mjs', 'perf/*.test.mjs']`) now also runs the afterPack, DMG, main-bundle, budget and harness tests. **Fix:** "tools (node — the migration CLI, the packaging checks, the budget gate and harness)". (The `tools/vitest.config.ts` header is the same staleness; it is listed under group 5.)

### docs/REGRESSION.md
- **[must] L88 (W8):** the text "(written on the YAZ-2131 tab-layers lane; it joins this list when that lane merges)" is stale, because `tabLayers.spec.ts` is merged. **Fix:** delete the parenthetical so the proof reads just A `tabLayers`.
- **[must] L103–105 (P2–P4)** say "(moves to the budget gate, YAZ-2131 1B)". The gate now checks Info.plist, the ad-hoc seal (`codesign --verify --deep --strict`) and `Resources/bin/yaseendocs` (CONTRACTS L423). **Fix:** set the proof to "gate `npm run perf:budget` (packaged half)" and keep the M steps as the fallback when the gate isn't run.
- **[must] L5** says "61 specs". **Fix:** change it to 65.
- **[should] L15** says "(once YAZ-2131 1B lands)". 1B has landed. **Fix:** delete the parenthetical.
- **[should] Three specs are cited by no row:** `frontmatterRace`, `quitFlush` and `quitDuringStorm`. **Fix:** add A `quitFlush`, `quitDuringStorm` to W5, and A `frontmatterRace` to E25 (R2 is the no-false-conflict-bar rule after the app's own frontmatter write).
- **[should] No row for the watcher engine (D3)** or the locale trim (D1). **Fix:** add U `desktop/src/main/fs/watchConformance.test.ts` + `watchConformance.polling.test.ts` to E5 (or a new row "external add/change/rename reaches the app"). Add P8: "Open/Save panels keep the OS language; Chromium paks trimmed to en*", proved by U `tools/afterPack.test.mjs` plus the gate row `lprojCount`.

### client/vendor/milkdown-components-7.22.1-yaz1410.md
- **[should] L8–12:** D2 locked "an upstream PR". YAZ-2188 says the PR is "prepared, not opened", because opening it needs Yasin's go. Nothing in the repo records this. **Fix:** add one line: "Upstream PR: prepared, awaiting Yasin's go; drop this hunk under YAZ-2213 once released." The opening itself is a **Yasin decision**.

### client/vendor/milkdown-plugin-tooltip-7.22.1-yaz2238.md
- (The follow-up issue and scope question are under group 3.)

### client/vendor/README.md (unchanged in the diff)
- **[should]** The README is titled "Vendored drawing engine" and doesn't mention the two Milkdown archives now in the same folder. **Fix:** add a two-line "Also here" section that points to the two `milkdown-*.md` provenance files.

### tools/perf/README.md
- **[should] L22 + L26:** "Load" and "Machine load" say the same thing. **Merge:** delete L26 and append its one useful clause, "ask for a quiet window before a timing run", to L22.

### README.md
- Clean: the one-line change (Files is the default lens, YAZ-1846) matches REGRESSION S1.

---

## Known items (judged and verified)

- **Must, counted under group 5: `tools/perf/budget.json:19` `mainBundleBytes` (411,774) makes CI red.** Details and the three options are under group 5. **Yasin decision.** After he decides, 8B edits the ceiling, `ratchetedTo` and measureBudget.test.mjs:52–54.
- **`STALE_FLIGHT_MS` at `shared/types.ts:132`: keep (not worth fixing).** Verified: main's `desktop/src/main/fs/tree.ts:1/24` and the renderer's `client/src/lib/treeFeed.ts:1/77` import the same constant. `types.ts` already holds the other cross-process limits (`MAX_FILE_BYTES`, `MAX_FAVORITES`, `SIDEBAR_*`), and this one sits directly above `TreeResponse`, the type both flights carry. `shared/ipc.ts` is the channel table, and a timing constant would mix concerns there.
- **[should] `tools/dmg.test.mjs` runs real hdiutil in `npm test`, and on CI.** It is skipped only off macOS (L46), took 14–15 s normally and 185.9 s once under load, and already needs `retry: 1` and a 180 s timeout. **Gate it** behind `YASEEN_DOCS_DMG_TEST=1` (details under group 5). Every `desktop:build` still exercises the real path.
- **The `arity` field in `CONTRACT`: keep (not worth fixing).** Verified that it is used at runtime:
  - `desktop/src/preload/index.ts:13–15` `invoker()` forwards exactly `arity` arguments (padding with `undefined`, dropping extras, as the hand-written bridge did) and reports it as `fn.length`.
  - The D9 surface snapshot pins it per method (`coldDiff/1`, `favorites.set/2`).
  - Types are erased, so it can't be derived, and `invoke(channel, arity: A['length'])` makes a wrong count a compile error.
  - Dropping it would change which arguments reach main (a Yasin decision).
- **Perf harness size: keep.** Harness code is 921 lines (1,115 with the gate, plus 168 of tests). There are no duplicated launch, wait or vault helpers, no debug output, and every option is used. About 40% of `lib/app.mjs` is required safety code. `baseline.json` holds summaries only, with no raw samples. The trims under group 5 save about 10–15 lines.
- **`client/src/sidebar/hooks/rowGestures.ts` (433 lines): keep as is.** It is a module of four exported hooks (`useSelection`, `useTreeDrag`, `useFileClipboard`, `useInlineEdits`), so a non-`use` module name fits. D10 named it, and all 18 returned fields are used. A split is churn and would have to be move-only. Only comment nits apply (group 4).
- **D10 proof: verified, holds.** The md5 of `Sidebar.test.tsx` is `f3c49e61…` before and after each of `65fd4fd`, `459c29e`, `fde2731`, `47c0738` and `8201de2`. Its +123/−1 comes from 5A (`8fbfe96`), 5D (`acd9d52`) and YAZ-2240 (`9ae89b4`, after the split).
- **LOC growth versus benefit: keep, and state it in the closing comment.**
  - Product source is net +1,006. The watcher engine (422) and the Crepe module (88) buy storm CPU 36× lower, flat watcher fds (62 at 10k notes) and entry JS −60%.
  - D10 is roughly neutral (Sidebar −611 against the hooks +795, which carry their own headers).
  - D9 plus 6B is about −420, short of the −550 to −750 estimate (explained under group 2).
  - Tests and the harness add about 7k lines: the safety net Yasin asked for.

## D1–D10 test coverage

| Decision | Proof (file:line) | Gap → item |
|---|---|---|
| 🔒 D1 locale trim | `tools/afterPack.test.mjs:17–34` (Mac: keeps `en*`, `.lproj` untouched, second run changes nothing), `:36–43` (Windows); gate rows `chromiumLocaleCount`, `chromiumLocaleBytes`, `lprojCount` (local `perf:budget`) | No REGRESSION row → Docs (should) |
| 🔒 D2 patch hunk | `client/src/editor/listItemCaretRestore.test.ts:68–124` | Upstream PR prepared, not opened → Docs/vendor md (should, Yasin) |
| 🔒 D2 app-side memo | `headingFolding.test.ts:370`, `outlineFolding.test.ts:413`, `bulletThreading.test.ts:99`, `foldDecorations.test.ts:104–195`, `wikilinkPlugin.test.ts:270–382`, `outlineEntries.test.ts:112–170` | — |
| 🔒 D2 parity | `desktop/e2e/bigNote.spec.ts`: caret :126, chevrons :120–121/:164–170/:180–182, threading :127/:157–162, links :123–124/:183 | Caret after a new list item mounts in a big note → e2e (should) |
| 🔒 D3 watcher | `desktop/src/main/fs/watchConformance.ts`: atomic save :70, tmp :78/:86, slow write :119, `mkdir -p` :130, rename :138/:146, trash :165, 200 burst :176; FSEvents ready race `treeWatcher.test.ts:118/127/139`; polling fallback `watchConformance.polling.test.ts`; chokidar bundled `tools/mainBundle.test.mjs:49–60` | Polling path leaks root `addDir`/`unlinkDir` → group 1 (must) |
| 🔒 D4 full snapshots | `WikilinkIndexBridge.test.tsx` (no view-only wake per save), `Editor.test.tsx:815–831` (memoised sections), `useViewOnlyCatalog.test.tsx:124–147`; external renames still `externalRename.spec.ts` | `MemoFolderPageContents` not counted → group 3 (nit) |
| 🔒 D5 tabs stay mounted | `desktop/e2e/tabLayers.spec.ts`: `content-visibility` :82–86, scroll :73–75/:110, caret :114–116, undo :126–129, find :91–98/:136–139, zoom :62–64/:109 | Unsaved buffer weak (:108) → e2e (should); `right-panel.css:164–168` has no test → not worth fixing (same rule as tabs, visual only) |
| 🔒 D6 serialization unchanged | No code change; existing round-trip suites (REGRESSION E1) | — |
| 🔒 D7 Windows unchanged | No code change; REGRESSION P5 (release workflow) | — |
| 🔒 D8 CI + e2e guard | `.github/workflows/ci.yml:7–27`; `desktop/src/main/deepLinkScheme.test.ts:11`; `desktop/e2e/helpers.ts:37` sets the flag | CI red on `mainBundleBytes` (must, Yasin); `index.ts` wiring untested → group 1 (should); e2e doesn't pin `YASEEN_DOCS_USER_DATA_DIR` → e2e (must) |
| 🔒 D9 contract as data | `desktop/src/preload/surface.test.ts:58` + snapshot (taken on the pre-table preload, unchanged since); `desktop/src/contract.test.ts:39/48` | The preload cast hides a missing special → group 2 (should) |
| 🔒 D10 Sidebar split | md5 of `Sidebar.test.tsx` unchanged across the five YAZ-2202 commits; the per-commit move-only comparison | — |

---

## Group 1: main process

### desktop/src/main/fs/treeWatcher.ts (422 lines, new)
- **[should] L44–49, L225, L304, and treeWatcher.test.ts L68–77:** the `depth` option is dead in production. The only callers, `fs/watchers.ts:31` and `vaultConfig.ts:138`, never pass it; only one test does. **Remove** `depth` from `TreeWatchOptions`, from `skip()` (L304 becomes `return this.opts.ignored?.(p) === true` after the tmp check), and from the polling options (L225). Delete the test "depth 0 announces…" (treeWatcher.test.ts:68). Also delete the now-pointless comment at `vaultConfig.ts:136–137` ("No `depth`: …"). Behaviour does not change.
- **[should] L10, L30, L91, L94 (and treeWatcher.test.ts L13, L118, L127; CONTRACTS L137 "draw 5F1"):** the draw app's lane IDs ("draw 5F / 5F1") don't resolve in this repo. D3 said to adapt the draw engine, and the lane codes are the draw repo's. **Rename:** keep a single provenance line at L10, "adapted from the draw app's `treeWatcher.ts` (draw `df99b35`)". Drop "draw 5F1" in the other places; the explanation beside each already stands on its own. At L30, drop the aside "draw's engine walked only after the probe and took such a note as initial" (it's history, not a contract).
- **[must] L234 (polling fallback):** the fallback forwards chokidar's `addDir`/`unlinkDir` unfiltered. v0.9.27's `watchers.ts` dropped events on the watched root itself (`63aeeea:desktop/src/main/fs/watchers.ts` `.on('addDir', (p) => p !== root && …)`, and the same for `unlinkDir`). This change removed that guard, relying on the native engine never announcing the root (`forget`, L409–412). On the polling path (network volumes, EACCES), a vault folder that vanishes or reappears therefore sends consumers an `unlinkDir`/`addDir` for the root that v0.9.27 never sent. That is a behaviour change on the fallback path, so it breaks the guardrail. **Fix (restores the old behaviour):** in the forwarding loop, skip `(event === 'addDir' || event === 'unlinkDir') && args[0] === this.dir`. Add a polling-only case to treeWatcher.test.ts: remove and recreate the watched folder, and expect no root event.
- **[nit] L237:** `w as unknown as TreeWatcher` is a double cast. **Simplify:** type `polling` as chokidar's `FSWatcher` through `import type { FSWatcher as PollingWatcher } from 'chokidar'` (type-only, so it has no bundle effect), and drop the cast.
- **[nit] L10:** cites "🔒 YAZ-2132 D3", while every other file says "YAZ-2131 🔒 D#". **Rename** it to "YAZ-2131 🔒 D3" to match.
- **[nit] L9–37:** the 29-line header is long compared with the rest of `main/fs`, but it is the engine's contract, and 8B must not trim its meaning. **Keep because** it is the only place the settle, probe and fallback rules are written down.
- Everything else checks out: `isNetworkMount` is exported only for its test, which is fine, and `add()` is used by `vaultConfig.ts:127`.

### desktop/src/main/fs/tree.ts
- **[should] L5:** "(YAZ-2191, draw 5E)". **Rename:** drop "draw 5E".
- `STALE_FLIGHT_MS` is imported and used at L1/L24, so main and the renderer share one constant. Verified.

### desktop/src/main/quitSequence.ts
- **[should] L14:** "(YAZ-2174, draw D11)" is a draw decision ID. **Remove** "draw D11".
- **[nit] L5–10:** `flushIndex` is the only dep without a doc line. Add "The vault-index cache's pending persist." or leave it.

### desktop/src/main/properties/index.ts
- **[nit] L28–29:** removing the local `isRecord` left two blank lines. **Remove** one. Also move the `@shared/guards` import (L6) up into the `@shared/*` group at L1–3.

### desktop/src/main/git/manager.ts
- **[nit] ~L89–90:** the same double blank line where `isRecord` was removed. **Remove** one.

### desktop/src/main/git/manager.test.ts
- **[nit] L28:** a local copy of `isRecord`. **Replace** it with `import { isRecord } from '@shared/guards'`, the point of 6B.

### desktop/src/main/fs/watchers.test.ts
- **[should] L122:** the comment says "past `awaitWriteFinish`", but the shipped engine settles in `SETTLE_MS` (100 ms). **Fix:** `// past the engine's settle (SETTLE_MS): a reported tmp would arrive first`.

### desktop/src/main/index.startup.test.ts
- **[should] D8 wiring is untested.** `h.app.setAsDefaultProtocolClient` (L25) is mocked but never asserted, so reverting `index.ts:47` to a bare `app.setAsDefaultProtocolClient('yaseendocs')` keeps every test green. `deepLinkScheme.test.ts` tests only the helper. **Finish:**
  - In `beforeEach`, add `vi.stubEnv('YASEEN_DOCS_E2E', '')`.
  - In "main startup order", add `expect(h.app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('yaseendocs')`.
  - Add one case that stubs `YASEEN_DOCS_E2E=1`, runs `vi.resetModules()`, re-imports `./index`, and expects `not.toHaveBeenCalled()`.
- **[nit] L118–128:** the test pins the incidental order `registerClipboardIpc → registerAgentIpc → registerIpc`. Only "every register before `restoreAll`, route after" is load-bearing. **Simplify** to `indexOf` relations.

### desktop/src/main/fs/fsUtils.ts, fsUtils.test.ts
- **[nit] fsUtils.ts:188–190:** the doc says the fallback is for "a volume without hard links (exFAT/FAT)", but L202–203 falls back on *any* non-EEXIST `link` error. **Reword:** "Any other `link` failure (exFAT/FAT have no hard links) gets a fsynced `wx` write…". Code unchanged.
- **[nit] fsUtils.test.ts:144:** the one top-level `it` among `describe`s. **Wrap** it in `describe('tmp names (YAZ-2179)')`.

### desktop/src/main/fs/validate.ts
- **[nit] L17:** `strArray` breaks the `require*` naming of its sibling `requireRequest` and of `requireAbsPath`/`requireDir`. **Rename** it to `requireStringArray` (validate.ts, validate.test.ts, ipc/state.ts, ipc/favorites.ts).

### desktop/src/main/favorites.ts, properties/index.ts (the comments)
- **[nit] favorites.ts:44 "(properties' idiom)", properties/index.ts:119 ", the store's idiom":** both are stale now that both files call the shared `createRootChain`. **Remove** the parentheticals.

### desktop/src/main/fs/remove.ts
- **[nit] L32–34:** the edited comment wasn't reflowed (L33 ends early). **Reflow** it to about 100 columns.

### desktop/src/main/deepLinkScheme.ts
- **[nit] L1:** `ProtocolClientOwner` is exported but used only in this file. **Drop** `export`.
- **[nit] L6–8:** this is the D8 guard, but it cites only YAZ-2168. **Add** "YAZ-2131 🔒 D8".

### desktop/src/main/store.ts, vaultIndex/cache.ts, favorites.ts
- **[nit] store.ts:43, cache.ts:6, favorites.ts:5:** `@shared/guards` is imported after the relative imports. **Move** it into the `@shared/*` import group.
- store.ts's `lastWritten` skip (YAZ-2198) is correct and tested (store.test.ts:900).

### Clean files, each with a reason
- `appScheme.ts`: one constant plus its reason, pinned by index.startup.test.ts:113.
- `deepLinkScheme.ts` (+test): the D8 e2e guard, 13 lines, tested both ways.
- `fs/fsUtils.ts` (+test): `writeDurable`, `tmpSibling`, `createDurable` and `createRootChain` are each used 2+ times; the ENOTSUP fallback is a real exFAT case and is tested (fsUtils.test.ts:109).
- `fs/validate.ts` (+test): `requireRequest` has 27 call sites; `strArray` is used by `ipc/state.ts` and `ipc/favorites.ts`.
- `shared/guards.ts`, `shared/fileKind.ts` (`isAtomicTmp`, `ATOMIC_TMP_HEX_LEN`, used by fsUtils, git/sync, watchers and the tree).
- `fs/watchers.ts` (+test): the comments were updated for the new engine.
- `fs/{assets,copy,create,file,remove,rename,reveal,openDefault,openInVsCode}.ts`: mechanical switches to `requireRequest` / `createDurable`; remove.ts's comment was updated.
- `fs/fileKind.test.ts`, `fs/tree.test.ts`: new cases for YAZ-2179/2191 only.
- `fs/testFixture.ts`: `sleep` and `settled` are used by `watchConformance.ts` and `treeWatcher.test.ts`.
- `fs/watchConformance.ts` + `.test.ts` + `.polling.test.ts`: every D3 case is present (see the coverage table).
- `git/sync.ts` (+test): the tmp is excluded from staging and from the commit message.
- `index.ts`: the D8 guard, `APP_SCHEME` and `runQuitSequence` are wired in.
- `index.startup.test.ts`: it asserts order through the real module with Electron stubbed. It is not restating code.
- `menu.ts` (+test), `windows.ts` (+test): renames from `CH.*` to `CONTRACT`/`SPECIAL`, plus the YAZ-2198 parallel flush with its comment.
- `vaultConfig.ts`, `favorites.ts`, `fileClip.ts`, `vaultIndex/{cache,live,reconcile}.ts`: guard, chain and comment moves only.

---

## Group 2: IPC contract, preload and api

### shared/ipc.ts (246 lines, new)
- **[must] L222:** the `watch` doc still says "One chokidar watcher per root in main". **Fix:** "One watcher per root in main (`fs/treeWatcher.ts`), shared by every window; late joiners get `ready` at once."
- **[nit] L242–246:** `leaves` is production-shared code with one caller, `desktop/src/contract.test.ts:28`. **Keep because** moving it into the test would duplicate the `isLeaf` walk it builds on. Otherwise move it into contract.test.ts. Low value either way.
- **The `arity` field (L14–21, L32): keep.** It is used at runtime: `preload/index.ts:13–15` `invoker()` forwards exactly `arity` arguments and sets `fn.length`, which is what the hand-written bridge did. It is also pinned per method in the surface snapshot (`coldDiff/1`, `favorites.set/2`, …). Types don't exist at runtime, so it can't be derived. It also costs nothing extra to write, because `invoke<A,R>(channel, arity: A['length'])` makes the compiler check it.
- **[should] L7–8, L196:** the header says the only hand-written parts are `SPECIAL`. But `preload/index.ts:103–123` also overrides three table doors: `state.setFolds` / `setBaseGroups` send a copy, and `properties.onChange` unwraps `{ root, properties }`. **Append** to the header: "; the preload also overrides three table doors to keep their wire behaviour: `state.setFolds` / `state.setBaseGroups` (send a copy) and `properties.onChange` (unwraps `{ root, properties }`)."
- **[nit] L11:** a single 600-character type import line. **Keep** unless the repo's formatter wraps imports (other files use one-line imports too).

### client/src/hooks/useWatch.ts
- **[must] L13:** the comment says main runs a "chokidar watcher". **Fix:** "the watcher (`fs/treeWatcher.ts`)".


### desktop/src/preload/index.ts
- `buildBridge` plus the four hand-written specials are what D9 asked for; the `[...keys]` copies at L107–108 are pinned by the surface test (keep, see Not worth fixing).
- **[should] L86:** `buildBridge(CONTRACT) as Omit<YaseenDocsApi, 'watch'>` tells the compiler that `onFlush`, `onCopyAs` and `onPasteAs` already exist on `generated`. Deleting their overrides (L109, L112–113) would still compile and only fail at runtime. **Fix:** cast `as Bridge<typeof CONTRACT>`, as `client/src/api.ts:49` does, so the literal must supply the specials. Adjust the L87–88 comment. Behaviour does not change.
- **[should] L26:** `export function buildBridge` has no importer. **Drop** `export`.
- **[nit] L12:** **add** why `length` is redefined: "…and reports it as `length`, as the hand-written functions did (surface.test.ts pins `/N`)".

### desktop/src/main/ipc/broadcast.ts, github.ts, fs.ts
- **[should] broadcast.ts:25:** "the open roots of `AppState.windows`" is computed three times: here, `rootsOf` in github.ts:26–28 (exported and tested), and `openRoots` in fs.ts:26. **Simplify:**
  - Move `rootsOf` into broadcast.ts and export it.
  - Use it in `syncPerRoot`.
  - Import it in github.ts, fixing the test import.
  - Make fs.ts:26 `rootsOf(store.get())`.
- **[should] github.ts:20–22:** still points at "the per-open-root idiom `ipc/vaultConfig.ts` and `ipc/properties.ts` already use", which is now `syncPerRoot`. **Fix** the pointer.
- **[nit] broadcast.ts:19–20:** history narration. **Rename** it to "(YAZ-2201 6B; vaultConfig, favorites and properties)".
- **[nit] agent.ts:7, state.ts:4, window.ts:5:** import order (`../fs/validate`, `@shared/guards`). **Move** each into its group.

### desktop/src/main/ipc/watch.test.ts
- **[should] L61 "one chokidar instance", L99 "one chokidar":** stale test names. **Rename** them to "one watcher".

### desktop/src/contract.test.ts
- **[nit] L2:** add "YAZ-2131 🔒 D9", the decision this file proves.

### client/src/api.ts
- **[should] L51:** the doc says "every call to `window.yaseenDocs` goes through here". The editors' Copy as / Paste as (`clipboardCopyOut.ts:51`, `clipboardPaste.ts:104`) deliberately call `window.yaseenDocs?.menu…` directly, which leaves api.ts:58–59 with zero callers. **Fix the doc:** "…except the editors' Copy as / Paste as subscriptions, which reach `window.yaseenDocs` with `?.`; `menu.onCopyAs/onPasteAs` stay here because `YaseenDocsApi` requires them." Routing those two through `api` would lose their tolerance of a missing bridge: that is a Yasin decision, not polish.

### client/src/lib/storage.ts
- **[should] L36–43:** the synchronous `try/catch` in `send` is dead. Every caller passes an `api` invoke, which runs inside `call(async () => …)`, so a missing bridge rejects rather than throws. **Simplify:** `call().catch((err: unknown) => console.error(`[storage] ${what} failed:`, err))`, and drop "(or a missing bridge)" from the doc. Logged output is identical.

### client/src/views/folderPageSettings.ts, migrateFolderBody.ts, viewSchema.ts
- **[nit] folderPageSettings.ts:109–110, migrateFolderBody.ts:32–33, viewSchema.ts:94–95:** a double blank line where `isRecord` was removed. **Delete** one in each. Also move the `@shared/guards` import into the `@shared/*` group (folderPageSettings.ts:22, migrateFolderBody.ts:24).

### Clean files, each with a reason
- `shared/types.ts`: −337 lines; the `*Api` interfaces are gone; `STALE_FLIGHT_MS` (see Not worth fixing).
- `desktop/src/channels.ts`: deleted. The only references left are CONTRACTS L536 (listed under Docs).
- `desktop/src/contract.test.ts`: the D9 completeness proof.
- `preload/surface.test.ts` + snapshot: the D9 byte-identical proof.
- `preload/bridge.test.ts`: the specials only; no overlap with the surface test.
- `preload/copy.test.ts`: renames.
- `main/ipc/broadcast.ts`: `broadcastAll` and `syncPerRoot` each have 3+ callers (6B).
- `main/ipc/envelope.ts`: `handle` is typed from the door.
- `main/ipc/watch.ts`: the YAZ-2178 pending set, tested (watch.test.ts).
- `main/ipc/{agent,clipboard,dialog,favorites,fs,github,properties,state,vaultConfig,window}.ts`: moved from `CH` to the table, 6B helpers adopted.
- `client/src/api.ts` (+test): 61 lines, looked up at call time.
- `client/src/bridge.d.ts`.
- API consumers, all mechanical moves to `api.*` / `api.shell.*` / `api.file.*`: `useLinkEvents`, `useMenuEvents`, `storage.ts`, `copyForAgent`, `useExternalRenames`, `TabBar`, `folderPageSettings`, `migrateFolderBody`, `propertiesStub`, `useProperties`, `viewSchema`, `PageContextMenu`, `PreviewCard`, `pageDrag`, `CommentsSection`, `VaultSwitcher`, plus their tests. The only direct `window.yaseenDocs` calls left are Copy as / Paste as (`clipboardCopyOut.ts:51`, `clipboardPaste.ts:104`), as D9 allows.

**Net LOC for D9 + 6B IPC:** src +493/−795 (**−302**), tests +587/−708 (**−121**), so about **−420** against D9's −550 to −750 estimate. The reasons for the gap:
- `shared/ipc.ts` carries about 104 lines of per-door JSDoc moved over from the `*Api` interfaces.
- The main-side handlers were renamed one for one.
- The preload saved only about 78 lines.

The fixes above recover about 15 lines. Getting near the estimate would mean dropping the per-door JSDoc that repeats CONTRACTS.md (about −90): that is a documentation choice for Yasin, not 8B polish. Record the shortfall in the closing comment; don't chase it.

---

## Group 3: editor, vendored Milkdown patches, build script

### client/src/main.tsx
- **[should] L5–7:** the comment says the theme is imported "minus the CSS of the features featureConfig.ts disables". ImageBlock is disabled (`featureConfig.ts:24`), yet `image-block.css` is still imported (L11), and `crepe.test.ts:124` filters only `latex`, `top-bar`, `diff` and `ai`. **Fix the comment:** "minus latex (KaTeX's stylesheet and its 59 fonts), top-bar, ai and diff; image-block.css stays, as it did through style.css". Dropping `image-block.css` would be a separate, measured change (see Not worth fixing).

### client/src/editor/featureConfig.ts
- **[should] L1–9:** the header still says "The ONE place that says which Crepe features this editor loads". Since YAZ-2184, enabling a feature also needs a loader in `crepe.ts` `LOADERS` (L47–56) and its CSS in `main.tsx`. Otherwise `new Crepe` throws (`crepe.ts:81`). **Finish:** add one sentence: "Enabling one also means adding its loader to `crepe.ts` `LOADERS` and its theme CSS to `main.tsx` (YAZ-2184); `crepe.test.ts` pins both."

### client/src/editor/outline/headingFolding.ts, outlineFolding.ts
- **[should] headingFolding.ts:52, outlineFolding.ts:57–59:** the field doc "(recomputed per transaction)" is now false. `entries` keeps its identity until the doc changes, and `decorationCache` is keyed on that identity. **Fix:** "(recomputed only when the doc changes; its identity keys `decorationCache`)". In outlineFolding, add "from the per-block cache".

### client/src/editor/outline/outlineFoldKeys.ts + outlineFolding.ts:324
- **[should]** The persisted fold-key format `` `${stem}:${occurrence}` `` is now written twice: `outlineFoldKeys.ts:35` and `outlineFolding.ts:324`. If one drifts, saved folds silently stop matching. **Simplify:**
  - Export `outlineFoldKeyFromStem(stem, occurrence)` from outlineFoldKeys.ts.
  - Make `getOutlineFoldKey` return `outlineFoldKeyFromStem(outlineFoldKeyStem(label), occurrence)`.
  - Use it at outlineFolding.ts:324.

### client/src/editor/crepe.test.ts
- **[nit] L127:** the test name is garbled ("keeps the KaTeX stylesheet latex.css carried, on the drawing surface…"). **Rename:** "the KaTeX stylesheet latex.css used to carry now loads with the drawing surface (Excalidraw's Mermaid dialog)".

### client/src/editor/listItemCaretRestore.test.ts
- **[nit] L93–94:** "as today" goes stale on merge. **Rename:** "as the last per-item dispatch did upstream".

### client/src/editor/wikilink/wikilinkPlugin.ts
- **[nit] L242:** the module-level `function update(` shares its name with `source.update(…)`. **Rename** it to `updateDecorations` (the call site is at L292).

### Tests: one copied PRNG
- **[nit] foldDecorations.test.ts:92–100, outlineEntries.test.ts:94–102, wikilinkPlugin.test.ts:309–317:** the same mulberry32 `random()` is copied three times. **Optional:** move it to one test-only module (`client/src/editor/testRandom.ts`) and import it in all three.

### client/src/editor/Editor.tsx / Editor.test.tsx
- **[nit] Editor.tsx:52:** `MemoFolderPageContents` is memoised, but the save-render test (Editor.test.tsx:815–831) counts only frontmatter, comments and backlinks. **Finish (optional):** add a `folderContents` counter to the `renders` mock and assert it is 0.

### client/vendor/milkdown-components-7.22.1-yaz1410.md
- (See Docs.) The D2 upstream PR is unreferenced. **[nit] L52–53:** rewrap the over-long line.

### client/vendor/milkdown-plugin-tooltip-7.22.1-yaz2238.{md,patch}
- **[should] Yasin decision:** the YAZ-2238 tooltip patch is outside the locked D1–D10 scope. It is a real bug fix (a stale floating toolbar after ⌘Z, found through the `numberedBullets` flake) with a visible effect: the toolbar now hides. **Confirm with Yasin that it stays.** If it does, add a Backlog issue "Drop the plugin-tooltip patch after the upstream release" (or fold it into YAZ-2213), and cite it at md L13.
- **[nit] md L6:** the md names only Crepe's toolbar as a `TooltipProvider` consumer. **Add:** "The link tooltip also uses TooltipProvider but calls `update(view)` without `prevState`, which both versions always evaluate: unchanged."

### Clean files, each with a reason
- `crepe.ts`: its header names what is copied from Crepe and the test that holds it to the package.
- `crepe.test.ts`: a sound guard; its regex catches value, re-export, side-effect and dynamic root imports.
- `createCrepe.ts`: import only.
- `zoomRequest.ts`: now `api.window.zoom`.
- `image/imageView.ts` (+test): decode off the frame, with its reason.
- `outline/bulletThreading.ts` (+test), `bulletsOnly.ts`.
- `foldCarry.ts`: used by both fold plugins only.
- `foldDecorations.test.ts`, `outlineEntries.test.ts`: oracles, not duplicates.
- `headingFolding.test.ts`, `outlineFolding.test.ts`, `wikilinkPlugin.test.ts`.
- `WikilinkIndexBridge.tsx` (+test).
- `FrontmatterPanel.tsx` (+test), `SaveIndicator.test.tsx`, `tooltipThrottle.test.ts`.
- `views/view/OutlineEditor.tsx` (+test), `outlineSeedGuard.test.tsx` (R1).
- `drawings/ExcalidrawSurface.tsx`: KaTeX CSS moves to the drawing surface with its reason.
- `test-setup.ts`, `test-timers.ts` (+test): scoped to `@milkdown/ctx` timeouts; the test goes red when upstream fixes the bug.
- The components patch: the list-item hunk matches D2.
- `tools/buildMilkdownPatch.mjs`: no code or doc still names `buildMilkdownComponentsPatch`. The only mention is in the frozen `thoughts/` scope record, which is excluded.
- `client/package.json`: `@codemirror/*` are direct deps because `crepe.ts:24–25` imports them, at Crepe's own ranges. `katex` is a direct dep only for the lazy CSS import in ExcalidrawSurface, which is consistent with 3D because no KaTeX JS is in the editor.
- Root `package.json`: the tooltip devDependency and override follow the components pattern.

---

## Group 4: sidebar and app shell

**D10 proof holds (verified by md5).** `client/src/sidebar/Sidebar.test.tsx` is byte-identical (md5 `f3c49e61…`) before and after each of the five YAZ-2202 commits: `65fd4fd`, `459c29e`, `fde2731`, `47c0738`, `8201de2`. Its +123/−1 since `63aeeea` comes from three other commits:
- `8fbfe96` (5A)
- `acd9d52` (5D)
- `9ae89b4` (YAZ-2240, after the split), which changed expectations because the burst behaviour changed on purpose.

Comparing added and removed lines per commit shows the split is move-only. The only exceptions are hook signatures, return lines, imports and headers.

### client/src/App.test.tsx
- **[must] L320–331:** the new `describe('App close/quit handshake (YAZ-2174)')` was inserted between the ⌘⇧C doc comment (L320–325) and its describe (L333), so the ⌘⇧C doc now heads the flush test. **Move** L326–331 (plus a blank line) above L320.

### client/src/components/confirmSheets.test.tsx
- **[must] L3:** "(the screenshot e2e checks the pixels)" is false. Nothing in `desktop/e2e` calls `toHaveScreenshot`; the specs only save step screenshots. **Remove** the parenthetical.
- **[nit] L2:** "pinned (YAZ-2201) before they share one shell" reads as history. **Rename:** "pinned (YAZ-2201): the shared shell must leave every sheet's DOM byte-identical".

### client/src/sidebar/Sidebar.tsx
- **[should] Runs of 2–4 blank lines left where 6C cut blocks out,** before L426, 454, 457, 538, 562, 701, 704 and 714 (verified). There were none at `63aeeea`. **Collapse** each to one blank line. It is whitespace only, so the change stays move-only.
- **[nit] L15:** `FOLDER_PAGE_KEY` is imported and unused. `47c0738` edited this line and left it. **Remove** it.

### client/src/sidebar/Sidebar.test.tsx
- **[should] L39:** the `afterQuiet` doc says "before its one tree read (YAZ-2191)". Since YAZ-2240 a burst gets an immediate read plus one trailing read. **Fix:** "…before its trailing tree read (YAZ-2191, YAZ-2240)". This is a comment-only edit in a test file, and D10's "unmodified" held for the split commits.

### client/src/sidebar/hooks/useVaultTree.ts + client/src/search/useSearchResults.ts
- **[should] useVaultTree.ts:20, useSearchResults.ts:21:** `STRUCTURAL_REFRESH_MS = 100` is defined twice, linked only by a comment. **Simplify:** export one `WATCH_BURST_QUIET_MS = 100` from `lib/leadingTrailing.ts` and import it in both. Behaviour is unchanged.
- **[should] useVaultTree.ts:186–187:** "exactly as the selection does above" points at nothing; the selection prune moved to `rowGestures.ts:44–47`. **Fix:** "…as `useSelection` (rowGestures.ts) does for the selection".
- **[nit] useVaultTree.ts:117:** "idempotent like the two above it" (only one is above). **Fix:** "like `expanded`'s above and the Topics one below".
- **[nit] useVaultTree.ts:19:** "main-process.md F1" is a bare file name. **Use** `thoughts/yaz-2131-scope/main-process.md`.
- All 26 returned fields are used by Sidebar. No excess.

### client/src/sidebar/hooks/useSidebarSearch.ts
- **[should] L23–25:** "every bit of tree state … lives here". "Here" meant Sidebar.tsx before the split. **Fix:** "…lives in the Sidebar's other hooks (useVaultTree, rowGestures) and is waiting untouched when it clears".

### client/src/sidebar/hooks/rowGestures.ts (433 lines, known item)
- **Keep as is (correcting the earlier "rename" note).** The file is a module of four exported hooks plus one private helper, not one hook:
  - `useSelection` (L24–75)
  - `useTreeDrag` (L77–156)
  - `useFileClipboard` (L158–278)
  - `useInlineEdits` (L312–433), with the private `createInTopic`
  
  D10 named the module `rowGestures`, and its header lists what is inside. All 18 returned fields are used. A four-file split is churn, and any split would also have to be move-only.
- **[nit] L27–29:** "this component is mounted `key={root}`". **Change** "this component" to "the Sidebar (which calls this hook)".
- **[nit] L90, 122, 169, 388:** `// ---- … ----` section banners repeat the hook names now. **Delete** them.

### client/src/sidebar/ConfirmTurnBack.tsx
- **[should] L35–38:** change-history prose ("their copies are gone; the DOM is pinned unchanged") that restates `ConfirmSheet.tsx:4–8`. **Replace** it with "The mechanics are `ConfirmSheet`'s (YAZ-2201)." Keep the "Two deliberate omissions" block.

### client/src/tabs/tabs.css, right-panel/right-panel.css
- **[should] tabs.css:146–149:** "visibility keeps layout alive — scroll offset, selection and undo history all survive". With `content-visibility: hidden` (L171), layout is now skipped for hidden layers. **Fix:** "visibility (plus content-visibility, below) keeps each layer's rendering state: scroll offset, selection and undo history all survive…".
- **[nit] right-panel.css:166:** cites YAZ-2195 but not D5. **Rename** it to "YAZ-2195 (🔒 D5)".

### client/src/lib/treeFeed.ts
- **[nit] L4–16:** the module doc sits after the imports, directly above `type Outcome`, so tooling attaches it to `Outcome`. **Move** it above L1, as the hooks' headers are. Keep its length: each bullet is an invariant tested in treeFeed.test.ts:33–100.

### client/src/comments/ConfirmDeleteComment.tsx
- **[nit] L25–26:** a sentence broken short after the edit. **Rejoin** it.

### Clean files, each with a reason
- `Tree.tsx`: memo `TreeLevel` / `sameLevel`; the doc is accurate.
- `ConfirmDelete`, `ConfirmMove`, `ConfirmRename`, `ConfirmDeleteColumn`, `ConfirmDeleteView`, `ConfirmRemoveMember`: each old handler maps to one `ConfirmSheet` mode.
- `components/ConfirmSheet.tsx`: every prop is used, and all 8 sheets use the shell.
- The confirmSheets snapshot: 8 `innerHTML` strings, a reasonable pin.
- `lib/leadingTrailing.ts` (+test): `call`, `flush` and `cancel` are all used.
- `lib/windowFlush.ts` (+test): its `console.warn` is deliberate error reporting.
- `lib/treeFeed.test.ts`.
- `App.tsx`: the resize listeners are removed in `up`, and the mouseup commit is correct.
- `main.tsx`: import order (see the group 3 comment item).
- `app.css`.
- `hooks/useAutosave.ts` (+test): the retry-once loop cites YAZ-2175.
- `hooks/useViewOnlyCatalog.ts` (+test): its own 300 ms trailing timer is deliberately different from `leadingTrailing`.
- `search/useSearchResults.ts` (+test): the generation counter is needed now that reads can overlap.
- `views/writeProperty.ts` (+test).

---

## Group 5: packaging, build and tools/perf

### tools/perf/budget.json + .github/workflows/ci.yml
- **[must] budget.json:19 `mainBundleBytes` 411,774 means CI is red.** `ci.yml:27`'s `perf:budget:ci` exits 1 at HEAD (482,730 B, +70,956 B, +17.2%). The growth breaks down as:
  - 48,756 B: chokidar + readdirp bundled as a lazy main chunk. This is 3E; the code moved out of the asar, where `asarNodeModulesFiles` went from 12 to 0.
  - About 22 KB: new main code (the watcher engine, the quit sequence, R1–R7).
  
  **Yasin decision.** The options:
  - (a) Raise the ceiling to 482,730. Recommended: the bytes are relocated, not new weight, and the installed app is 55 MB smaller.
  - (b) Keep the ceiling, which leaves D8's CI red.
  - (c) Minify main. This reverses YAZ-2183's decision to keep main stacks readable.
  
  Once he decides, 8B updates `max`, `ratchetedTo`, and measureBudget.test.mjs:52–54 (below).
- **[nit] budget.json:14 and `$comment`:** `"target": 0` equals `max` and nothing reads `target`. **Remove** it, and the sentence in `$comment` about `target`.
- **[nit] ci.yml:12:** there is no `permissions:` block. **Add** `permissions: { contents: read }`.

### tools/perf/measureBudget.test.mjs
- **[should] L52–54:** the ceiling `411774` is hard-coded in both the comment and the regex, so the test breaks the moment the ceiling moves. **Simplify:** read `budget.json` and build the expected text from `size.mainBundleBytes.max`.
- **[nit] L78:** the title says "the math fonts". **Rename** it to "the KaTeX fonts" (goes with the next item).

### tools/perf/measureBudget.mjs
- **[should] L100 + L160:** a metric that is `null` is skipped silently. That is right for the packaged rows under `--out-only`. But in packaged mode, a missing DMG (`dmgBytes = null`) or a budget row with a mistyped name is never enforced, and the gate prints PASS. **Finish:**
  - After the CLI's measure step, fail with "no dmg at … (run npm run desktop:build)" when a DMG path was expected and `dmgBytes == null`.
  - Add a test asserting that every `budget.size` key is a key `measure()` can produce.
- **[should] L130:** the failure text "(math renders in a fallback font)" is stale. Since YAZ-2184 no editor math ships; the KaTeX fonts serve only the drawing surface's Mermaid `$$` labels. **Fix:** "KaTeX fonts missing (the drawing Mermaid dialog's $$ labels lose their font)".
- **[nit] L20, L30, L57, L91, L125, L137:** `bytes`, `asarFiles`, `rendererGraph`, `measure`, `checkOut` and `checkApp` are exported with no importer; only `outOfBudget` is imported. **Drop** the `export`s, or keep `measure`'s if the test above imports it.

### tools/dmg.test.mjs
- **[should] L46:** `lzmaDmg` runs real `hdiutil` and `codesign` in `npm test`, locally and on CI (macos-latest). It is skipped only off macOS. Scratchpad logs show 14–15 s normally and 185.9 s once under load, and it already carries `retry: 1`, a 180 s timeout, and a busy-retry on `hdiutil create`. The real path is also exercised on every `desktop:build`, because `lzmaDmg` verifies the new image's seal before replacing the old one (`lib/dmg.mjs:47–54`), and the packaged `perf:budget` re-checks it. **Gate it:** `describe.runIf(process.platform === 'darwin' && process.env.YASEEN_DOCS_DMG_TEST === '1')`. Keep the `dmgPath`/`detach` unit cases (L8–39) unconditional. Add a line to CONTRACTS' Packaging paragraph: "`YASEEN_DOCS_DMG_TEST=1 npx vitest run tools/dmg.test.mjs` exercises the real hdiutil path; run it when touching `tools/lib/dmg.mjs`."

### tools/lib/dmg.mjs
- **[nit] L58:** `rmdirSync(mount)` in `finally` can throw EBUSY and hide the real detach error. **Wrap** it in `try {} catch {}`.

### tools/mainBundle.test.mjs
- **Keep.** It is the CI-side 3E guard; `asarNodeModulesFiles` is packaged-only and can't see an externalized `require`. **[nit] L59:** `not.toContain('chokidar')` repeats L58. **Remove** it.

### tools/perf/lib/work.mjs
- **[should] L41:** the option `{ sidebarWidth = 280 }` is never passed; the callers are `session.mjs:21`, `quit.mjs:14` and `harness.test.mjs:69`. **Remove** the option and write `sidebarWidth: 280`.
- **[should] L39, L51, L61:** `w.file` is never supplied by a caller. **Simplify** to `w.tabs[0] ?? null`, and fix the docblock to "`wins`: `[{ id, root, tabs }]`; the active file is the first tab".

### tools/perf/lib/app.mjs, lib/stats.mjs, run.mjs, scenarios/quit.mjs
- **[nit] app.mjs:79–89 and :198–204:** the same "SIGKILL each pid, ignore gone" loop appears twice. **Extract** `killAll(pids)` (about −6 lines).
- **[nit] app.mjs:13 / quit.mjs:24:** export `now`, and use it in quit.mjs instead of re-inlining it.
- **[nit] stats.mjs:11:** `summarize` is exported but only used inside the file. **Drop** `export`.
- **[nit] run.mjs:85–86:** two `if (i > 0)` in a row. **Merge** them.
- `app.mjs:210–212`: the `/Applications/Yaseen Docs.app` and `lsregister` paths are deliberate (the handler check). `work.mjs:11`'s `/tmp` is a safety root. **Keep.**

### tools/perf/README.md
- (See Docs.) Also **[nit] L5–10:** add a `runs/` row: "raw A/B and budget JSON quoted by PRs (7A)".

### desktop/electron.vite.config.ts
- **[nit] L78:** "Kept per shipped version" overstates it, because each build replaces `.maps/<version>`. **Reword:** "The last local build's maps, per version (rebuilding a release tag reproduces them), gitignored."

### tools/vitest.config.ts
- **[should] L3–7, L13:** the docblock describes only the migration suite (stale, see LAUNCH in Docs). **Fix:** "The `tools/` project: plain-ESM suites for the repo's node tools (migrations, packaging steps, the perf gate and harness), on real files and processes: no alias, no jsdom." The timeout comment should become "Migration cases build and `git init` a vault; packaging cases run real tools."

### Perf harness size (known item): keep
Harness code is 921 lines (1,115 with `measureBudget.mjs`; tests add 168; the JSON is the rest). There are no duplicated launch, wait or vault helpers, since the shared ones live in `lib/`. There is no debug output, every CLI option is used, and about 40% of `app.mjs` is safety code the machine-safety rules require (PID-only kills, work-directory claiming, LaunchServices restore). The trims above save about 10–15 lines. `baseline.json` (457 lines) holds only medians, p95s and cv per metric (no raw per-run samples beyond the 5-value `load.runs`), is frozen by rule, and is pretty-printed. **Keep.**

### Clean files, each with a reason
- `.gitignore` (`desktop/.maps/`), `package.json` (every new script used and documented).
- `desktop/package.json`: chokidar moved to devDependencies, guarded by mainBundle.test and `asarNodeModulesFiles`.
- `client/package.json`, `package-lock.json`.
- `electron.vite.config.test.ts`: runs the real plugin hook.
- `desktop/build/adhocSign.cjs`: D1 with the Windows branch D1 names, before codesign.
- `desktop/tsconfig.json`, `desktop/vitest.config.ts`: drops the orphaned `CHOKIDAR_USEPOLLING`.
- `tools/afterPack.test.mjs`: every D1 requirement, Mac and Windows, including the second-run no-op.
- `tools/packDesktop.mjs`, `tools/perf/{genVault,harness.test,lib/session}.mjs`.
- `scenarios/{idle,launch,open-big,sidebar-resize,storm,tab-switch,typing,watcher}.mjs`.

---

## Group 6: e2e (desktop/e2e) — unit tests are audited beside their source files in groups 1–5

### desktop/e2e/helpers.ts
- **[must] L35–38 (machine safety):** `env: { ...process.env, YASEEN_DOCS_E2E: '1' }` passes through any `YASEEN_DOCS_USER_DATA_DIR` set in the calling shell. `main/index.ts:29` `applyUserDataOverride` then points `userData` there, overriding `--user-data-dir`. A spec would seed and read the temp dir while the app writes a different profile, which could be the real one. The machine-safety rules require the pair. **Fix:** `env: { ...process.env, YASEEN_DOCS_E2E: '1', YASEEN_DOCS_USER_DATA_DIR: userData }`.
- **[should] L71–83, 6B dedupe unfinished:** locators identical across specs are still copied. **Finish:** export these from helpers and import them:
  - `lensTab`: bible:146, collapsedLaunch:41, crossCutting:115, focus:46, folderPages:129, lenses:41, topics:99, vaultSwitcher:70.
  - `dirRow`: collapsedLaunch:38, delete:37, fileClipboard:42, rename:60, search:49, favorites:38, focus:37.
  - `topLabels`: favorites:40, focus:39.
  - The exact-label overlay `menuItem`: favorites:42, focus:43.
  - `confirmSheet = '.confirm[role="dialog"]'`: folderSync:44, rename:76, title:42.
  - `centre` / `beforeEdge`: favorites:66–70 = topicsDrag:124.
  - `nextFrame`: helpers:410 = tabLayers:90.
- **[should]** These places redefine or inline an existing helper. **Replace** them with the helper:
  - `contents`: board:25, boardCardStyles:23, propertiesReorder:24.
  - `editorOf`: firstBlock:24, pasteRoundTrip:24, comments:58, frontmatterRace:39, quitDuringStorm:33/37, quitFlush:61/65, secureContext:47, viewers:107.
  - `tabsOf`: scenarios:142/143/158, tabs:143/147/150.
  - `fileRow`: collapsedLaunch:129, lenses:84, zoom:104, favorites:37, focus:36.
  - `viewTabs(contents(w))`: freezeColumns:115/240/261, topics:112–113 (a local `viewTabs(w: Page)` that shadows the helper's name with a different signature).
  - `layer(w)`: numberedBullets:53, quitFlush:78.
- **[nit] L52:** the error text says "within 15s of app.quit()", but the code calls `app.close()`. **Fix** the text.

### 6B debris in the old specs (commit a2504a6)
- **[must] About 22 orphaned doc comments:** 6B deleted the `const` lines but left their doc comments, which now sit above unrelated code. **Remove** them:
  - "The VISIBLE tab layer…" at bible:127, createUnderFolder:84, crossCutting:127, defaultView:35, easyWave:59, folderPageColumns:63, folderPageOutline:140, folderPages:118, topics:108, viewers:68.
  - "The VISIBLE editor…" at imageGallery:58, imagePaste:80, imageFold:67, links:51, imageRender:87, rename:59, tabs:46.
  - Also crossCutting:123 ("The FILE tree's rows…"), easyWave:65, properties:62.
  - **[nit] bible:137:** reword to "The rows/cells of whichever view the contents block is showing".
- **[should] 10 unused `layer` imports** (verified by grep): bigNote, columns, filter, folderSync, imageFold, imageGallery, nestedGroups, outlineRealFile, search, yaseendraw. **Remove** them. Typecheck can't catch these because no tsconfig sets `noUnusedLocals`.

### desktop/e2e/bigNote.spec.ts
- **[must] L18–19:** "Today a 5k open freezes the renderer for ~20 s (F1)" is stale after D2 (1.27 s). **Fix:** "Before YAZ-2131 D2 a 5k open froze the renderer for ~20 s; the long timeouts stay as headroom."
- **[should] D2 coverage gap:** D2's hard requirement is "the caret lands exactly where it does today", and the patched restore runs on every list-item mount. Only the open (L126) and a click (L156) are asserted. **Finish:** in step 2, put the caret at the end of `Child 1b`, press Enter, type `X`, and expect a new item `X` directly after `Child 1b` with no other line changed.
- **[nit] L174:** the title says "the rest renders exactly as before", but step 3 rechecks only chevrons and links. **Rename** it to match.

### desktop/e2e/frontmatterRace.spec.ts
- **[must] L4–5:** "beats its own watcher echo (chokidar's 200 ms settle)" is stale: D3 settles in 100 ms. The 450/550/650 ms delays were derived from the 200 ms echo. **Fix the comment.** Then **verify (UNCONFIRMED)** that the delays still reach the CONFLICT → retry path: count one retry per run. If they don't, re-derive the delays (autosave ~700 ms minus the echo), or the spec passes without testing R2.
- **[should] L40, with quitFlush:62 and quitDuringStorm:34:** `press('End')` is an animated scroll on macOS, not a caret move (commit 3ccc0cc). **Fix:** use `Meta+ArrowRight`. Lift the click-and-type into a shared helper, `typeMarkerAtLastBullet(win, prefix)`, used by all three.
- **Keep** the `waitForTimeout` calls here: the delay is the variable under test, and the 1 s wait proves an absence.

### desktop/e2e/quitDuringStorm.spec.ts + quitFlush.spec.ts
- **[should]** quitDuringStorm:26–37 repeats quitFlush:54–65 with the same afterEach boilerplate. **Merge** it into quitFlush.spec.ts as a third test (about −20 lines, one file fewer). REGRESSION W5 then names one spec.
- **[nit] quitFlush:54–57:** use the local `tempDir` helper consistently.

### desktop/e2e/tabLayers.spec.ts (D5)
- **[should] L8 + L108, weak unsaved-buffer proof:** autosave (500 ms after the 200 ms debounce) has almost certainly landed during step 2. L108 therefore can't tell a kept buffer from a remount that reloaded from disk; only the undo check (L126–129) catches a remount. **Finish:** tag the editor node in step 1 (`el.__d5 = 1`) and assert the tag survives in step 3. Then reword L8.
- **[should] L29–32:** the local `activeLayer` is the same as the helpers' `layer`. The local `editorOf(layer: Locator)` shadows the helpers' `editorOf` with a different signature. **Import** `layer`/`tabsOf`, and rename the local helper to `editorIn`.

### desktop/e2e/vaultSwitcher.spec.ts (277 lines): trim, keep the rest
- **[should]** Remove the checks that only repeat unit tests (about −22 lines):
  - L127: the aria-current count, implied by L125–126.
  - L134–144: the filter ranking and no-match block, plus screenshot 02 (VaultSwitcher.test.tsx:296/321/329).
  - L160: the query reset (VaultSwitcher.test.tsx:286).
  - L247–255: the filter matching both names (VaultSwitcher.test.tsx:500/660).
- **Keep:**
  - the open-beside and raise checks (window count, state entry);
  - ⇧⏎ in place;
  - the display name through quit and relaunch;
  - the one-line menu lists at L229/L270, which prove the real header wiring;
  - the Esc at L147–149, which step 2's ⌘O toggle needs.

### desktop/e2e/delete.spec.ts
- **[nit] L118:** "watcher awaitWriteFinish window (200ms)" is stale. **Fix:** "the watcher's settle (100 ms)".

### desktop/e2e/lenses.spec.ts
- **[nit] L4:** the header line was reflowed to over 130 characters. **Rewrap** it.

### Clean files, each with a reason
- backlinks, contentWidth, drawing (the `isAtomicTmp` filter and no-tmp-outlives poll), externalRename, multiselect.
- rightPanel, tasks (retries through assertions, no sleeps), secureContext (apart from the `editorOf` swap), zoom (complements tabLayers).
- The new-spec bodies of comments, favorites, fileClipboard and focus, apart from the dedupe items.
- The remaining small 6B hunks in the old specs, spot-checked across all 43.
- Grep found no hard-coded `/Users/` paths, no bare `/tmp` (every temp dir comes from `mkdtemp(tmpdir())`), no `console.log`, no `.only`/`.skip`/`fixme`, and no `waitForTimeout` outside frontmatterRace.
- Every spec launches through `launchApp`; the only `_electron.launch` is at helpers:35.

---

## Not worth fixing (considered and rejected)

- **`STALE_FLIGHT_MS` location, `arity`, perf harness size, `rowGestures.ts` split or rename.** See Known items.
- **Per-module "registers exactly these channels" tests** (`main/ipc/*.test.ts`) that overlap `contract.test.ts`. They pin which module owns which channel, a finer failure than the global check, and they predate this work.
- **The three preload overrides** (`setFolds` / `setBaseGroups` copies, `properties.onChange` unwrap). Removing them changes the wire payload and re-takes D9 snapshot lines: Yasin decision.
- **Routing the editors' Copy as / Paste as through `api`.** It would lose their `?.` tolerance of a missing bridge. Fix the api.ts doc instead (group 2).
- **`image-block.css` still imported with ImageBlock disabled.** No app selector uses its classes, so dropping it is probably safe, but that would be a new size change, not polish. Fix the comment only (group 3).
- **Near-identical `carryDecorations` / `decorationCache` blocks in headingFolding and outlineFolding.** The two plugins were parallel copies before this change, and the shared part is already in `foldCarry.ts`.
- **`crepe.ts` `DEFAULT_FEATURES` booleans.** They set Crepe's load order and make an enabled-but-unbundled feature throw.
- **`test-timers.ts` (the Milkdown readiness-timeout workaround).** Scoped to `@milkdown/ctx` timeouts; its own test goes red when upstream fixes the bug, which is the signal to delete it.
- **The long headers on `treeWatcher.ts` and `treeFeed.ts`.** Each bullet is a tested invariant or the engine's only written contract.
- **`writeDurable` using `'w'` in `atomicWrite` but `'wx'` in `createDurable`.** Unifying them changes behaviour on a tmp-name collision.
- **`store.ts` skipping identical writes, so an externally deleted state file isn't rewritten until the next real change.** Changing that is Yasin's decision.
- **`useViewOnlyCatalog`'s own 300 ms trailing timer instead of `leadingTrailing`.** Moving it would add tree reads, which is a behaviour change.
- **`externalizeDeps: false`, redundant while `desktop/package.json` has no `dependencies`.** Free belt-and-braces, backed by `mainBundle.test.mjs`.
- **Packaged budget rows not enforced in CI.** By design under D8 (CI doesn't package); the local `perf:budget` in the merge proof enforces them.
- **`baseline.json` reflow.** The file is frozen by rule.
- **`right-panel.css` `content-visibility` with no test of its own.** The same one-line rule as tabs.css, which is covered by `tabLayers.spec.ts:82–86`. It is purely visual, and a test would need the right-panel e2e to probe computed style for little gain.
- **The long single-line rows in CONTRACTS.md** (425 KB in 755 lines). They predate this change, and reflowing would bury the real edits.
- **Quit +12 ms median, idle GPU +5.7 MB (7A).** Below perception, and the cost of R4 fsync and the 5H parallel flush.
- **Typing and first-tab-visit misses.** 7A found no app-side lever left without Yasin.
- **YAZ-2238/2239/2240 sitting outside the planned tree.** They are 7A follow-ups and are cited correctly. (Keeping the tooltip patch is still flagged for Yasin under group 3.)
- **The `frontmatterRace` sleeps.** The delay is the variable under test.
- **The long e2e module headers.** They explain why each spec exists and cite decisions.
