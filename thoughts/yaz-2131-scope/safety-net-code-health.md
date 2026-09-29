# Safety net & code health — YAZ-2132 deep scope (docs app @ 63aeeea, v0.9.27)

Angle: (A) what stops the refactor from losing a feature; (B) code that can shrink or get simpler with no change a user can see.
Scratch artifacts: `SCRATCH/sh/` (vitest.log, e2e.log, e2e-rerun.log, jscpd/, jscpd-tests/, knip.json, knip.txt, untested.txt, asar.txt).

**Scope note (Yasin, mid-scope): the drawing component (yaseendraw / Excalidraw) is out of scope.** It must keep working, so its existing E2E coverage (`drawing.spec.ts`, `yaseendraw.spec.ts`, row E19) and one integrity check that its assets ship stay in the net. Nothing below proposes optimizing it, and its bytes and time are not counted as levers. Its cost, all in one line:
- **Drawing cost (out of scope):** `out/renderer/excalidraw-assets` = 17.2 MB, 243 files (fonts). Lazy JS chunks that mention `excalidraw` total about 5.05 MB (by filename/string match; biggest are `percentages-*.js` 2.28 MB and `index-DH-*.js` 1.22 MB, plus about 56 locale chunks). Estimated, not attributed exactly.

---

## 1. Baseline numbers

Each suite duration below comes from **one run**, not five. Treat them as wall-clock facts for planning, not as benchmarks. Other agents were running at the same time; load average was 10–39.

| What | Value | How | Load (1-min avg) |
|---|---|---|---|
| Vitest: files / tests | **257 / 4,487, all green** (client 193 / 3,562 · desktop 57 / 876 · tools 2 / 43 · perf 5 / 6) | measured, `npx vitest run` | 17.8 |
| Vitest wall time | **58.7 s** (59.3 s total, 547 % CPU) | measured, 1 run | 17.8 |
| Vitest flakes | none seen (1 run) | measured | |
| Playwright specs / tests | **50 specs / 240 tests** (LAUNCH.md:51 still says "17 specs, ~1.5 min"; CONTRACTS.md:57 says "SEVENTEEN") | measured | |
| Playwright full suite on `desktop/out` | **214 passed · 8 failed · 18 did not run** (serial `describe`s skip the steps after a failure). Wall **4 min 40 s** | measured, 1 run, `playwright test` without a rebuild | 37 → 19 |
| Re-run of the 8 failing specs | **the same 8 fail again** (13 passed, 18 did not run, 2.0 min). The failures are deterministic, not flakes | measured | 13.6 → 10.8 |
| `smoke.spec.ts` | 5 / 5 green, 5.4 s | measured | 39 |
| Perf tests (`client/vitest.perf.config.ts`) | 5 files / 6 tests. All are in-jsdom algorithm budgets (views engine, expressions, search candidates, completion, folder pages). There is **no app-level perf harness** | measured | |
| CI | **none for PRs**. The only workflow is `.github/workflows/release.yml`, which runs on a `v*` tag | read | |
| Production TS/TSX LOC (client + desktop + shared) | 41,091 (plus 7,150 CSS) | measured, `wc -l` | |
| Unit-test LOC / e2e LOC | 61,244 / 11,980 | measured | |
| jscpd, production code | 379 files, 26 clones, 669 dup lines (1.4 %). **333 of those lines are a parser artefact**: `.tsx` files read as JS (`Editor.tsx` matching itself; `CardsView`/`ListView`). Real duplication is about **336 lines (0.7 %)** | measured | |
| jscpd, tests | 360 files, 87 clones, 1,514 dup lines (2.36 %). The e2e specs redefine the same locator helpers (see B7) | measured | |
| knip | **0 truly unused production files**. `cli/index.ts` is a vite entry; the `shared/*` hits are false positives from the config alias. 2 unused prototype scripts in `tools/prototypes/`. 32 unused exports, 67 unused exported types, 3 dependency-hygiene items (B9) | measured, `SCRATCH/sh/knip.json` | |
| IPC bridge | **77 channels, spelled in 5 places**: `channels.ts` (88 lines), the 11 `*Api` interfaces in `shared/types.ts` (272 lines), `preload/index.ts` (207 lines, 67 `CH.` refs), `client/src/api.ts` (95 lines, 31 wrappers), main handlers (81 `CH.` refs). Plus `preload/bridge.test.ts` (422 lines), which exists to catch drift between them, and `api.test.ts` (183). About **1,267 lines** of bridge in total | measured | |
| Direct `window.yaseenDocs` sites outside `api.ts` | 36 in 14 files (`lib/storage.ts` has 18) | measured | |
| Package: `.app` / Frameworks / `app.asar` / DMG | 324,670,162 / 288,532,029 / 35,059,247 / 140,906,095 B | measured (budget-gate seed) | |
| App `.lproj` / Chromium `locale.pak` | 55 / 220 files = 48,655,444 B | measured | |
| Renderer: eager entry JS / eager CSS / total / files / JS chunks / `.map` files | **4,850,821 B** / 277,906 B / 34,343,287 B / 550 / 241 / 0 | measured | |
| Main (`out/main`, incl. `cli.js`) / preload | 411,774 / 11,015 B | measured | |
| asar: entries / `node_modules` entries / font files | 593 / 17 (chokidar) / 306 | measured, `@electron/asar list` | |
| Info.plist | `yaseendocs` URL scheme ✓. `.md`/`.markdown` as Editor with rank Alternate ✓. `Signature=adhoc` ✓ | measured | |

### The 8 red E2E tests on `main` (deterministic)

| Spec:line | Symptom | Class |
|---|---|---|
| `topics.spec.ts:338` step 5 | The context menu now has "Add to favorites" (YAZ-1766, 98741a5, 2026-09-21). The spec was last touched 2026-09-20 | **stale test (confirmed)** |
| `lenses.spec.ts:82` step 1 | Expects the Topics default. The default has been `files` since YAZ-1846 (9c1e43e; `shared/types.ts:490`) | **stale test (confirmed)**. README.md:79 is also stale ("Topics (the default)") |
| `multiselect.spec.ts:40` | 3 rows selected, the spec expects 2 | not triaged (spec untouched since 09-16) |
| `imageRender.spec.ts:129` step 1 | No `.cm-content` for the fenced image line | not triaged |
| `crossCutting.spec.ts:336` step 3 | The outline order after a drag has a stray `"]]"` line; `[[Sales-Conversion]]` is missing | not triaged. **Could be a real editor bug**: the outline text is corrupted |
| `folderPageOutline.spec.ts:296` step 5 | Caret never settles at the end of the line | not triaged |
| `outlineRealFile.spec.ts:101` step 2 | Line 124 `[[Garden Topic 132]]` is written back as `""` | not triaged. **Could be a real data-loss bug**: an original line is lost on disk |
| `search.spec.ts:164` step 3 | Test timeout; page closed (it follows the lenses/topics default change) | probably stale (default lens) |

What this means for the refactor: the E2E suite has not been a gate. Features merged after about 09-16 were never run against it. It cannot serve as a "0 features lost" check until it is green 3× in a row on the untouched base. The draw app set the same condition (YAZ-2078 acceptance).

---

## 2. Findings (most impactful first)

### F1. The safety net is red and ungated. There is no CI, and the E2E suite fails 8 tests on `main`
- **Evidence:** the table above. `.github/workflows/` holds only `release.yml`. `npm run e2e` always rebuilds (`package.json:17`), and there is no run-only script.
- **Impact:** reliability. A refactor cannot prove "no feature lost" against a baseline that is already red. Two of the untriaged failures (crossCutting step 3, outlineRealFile step 2) show text on disk differing from what was there. If they are product bugs rather than stale specs, they are data-integrity bugs.
- **Risk to features:** none (tests and CI only).
- **Draw equivalent:** draw 1C / YAZ-2078 required "green 3 runs in a row on the untouched code" before anything else, and draw 1A / YAZ-2076 added the CI step. **Transfers, adapted.** The docs app also needs a `ci.yml`, which the draw app already had.

### F2. Running the e2e harness takes over the machine's `yaseendocs://` handler
- **Evidence:** `desktop/src/main/index.ts:45` calls `app.setAsDefaultProtocolClient('yaseendocs')` on every launch, and `desktop/e2e/helpers.ts:34` launches the dev Electron binary. On this Mac LaunchServices now says `{'LSHandlerURLScheme': 'yaseendocs', 'LSHandlerRoleAll': 'com.github.electron'}`; the packaged app is `com.yasinarshad.yaseendocs`. So a `yaseendocs://` link clicked in Slack opens bare Electron, not Yaseen Docs, until the packaged app is launched again (it re-claims the scheme at start). **My own e2e run today also re-asserted this handler.**
- A second side effect: `delete.spec.ts:10-13` sends fixture files to the user's real Trash (the spec header says so).
- **Impact:** the deep-link feature is unreliable on the developer's own machine after any test or dev run.
- **Risk:** none if the change is scoped to the harness (proposal P5).
- **Draw equivalent:** draw 1C's `mainHook.cjs` skipped the scheme registration and redirected Trash to a sandbox folder. **Transfers, adapted.** Here a single env check is enough, and Trash can stay as is (it is documented and asserted only as "gone from vault").

### F3. Nothing pins the app's glue: startup order, scheme privileges, the IPC handler set, the quit order
- **Evidence:** no test imports `desktop/src/main/index.ts` (218 lines) or `ipc/index.ts` (`registerIpc`). That leaves these unpinned:
  - `app://` privileges `standard + secure + supportFetchAPI` (`index.ts:75`)
  - `open-url` / `open-file` wired before `ready` (`:59`, `:68`)
  - `links.flush()` after `restoreAll()` (`:198-199`)
  - the before-quit order "renderers flush → store + index cache + git flushForQuit → exit" (`:207-215`, which the comment calls load-bearing for YAZ-1081 D2)
  - no test checks that every invoke channel has exactly one `ipcMain.handle`. `bridge.test.ts` checks only the preload side.
- `hooks/useAutosave.ts` (157 lines) and `editor/SaveIndicator.tsx` have no direct test. `lib/autosave.ts` is tested.
- **Impact:** reliability. These are exactly the lines a size or launch refactor moves (V8 code cache on `app://`, bundling chokidar, IPC-as-data).
- **Draw equivalent:** draw 1D / YAZ-2079 added `index.test.ts` (Electron stubbed, real `index.ts`), `ipc/index.test.ts` (in 6A) and the watcher/ConflictBar/SaveIndicator tests. **Transfers as-is.**

### F4. No size/integrity gate and no frozen baseline
- **Evidence:** there is no `tools/perf/` and no budget. Packaging-level facts are verified only by hand: the Info.plist scheme and `.md` association, the ad-hoc seal, `Resources/bin/yaseendocs` (the CLI that "Copy for Agent" advertises), `out/main/cli.js`, KaTeX and excalidraw fonts (306 font files), and lazy-chunk closure over 241 JS chunks.
- **Impact:**
  - Size regressions go unseen.
  - A silently dropped chunk or font only shows as a runtime failure in a lazy path (Mermaid diagram, CodeMirror language, drawing fonts offline).
  - The eager entry chunk is 4.85 MB, and nothing will stop it growing.
- **Draw equivalent:** draw 1A / YAZ-2076. **Transfers, adapted.** Different integrity list: no draw.io, but the CLI bin, `cli.js`, the `.md` Alternate association and the PDF plugin (`webPreferences.plugins: true`).

### F5. No app-level perf harness. The existing perf tests are jsdom algorithm budgets only
- **Evidence:** the 5 `*.perf.test.ts` files test the engine, expressions, search, completion and folderPages inside vitest. `desktop/e2e/fixtures/benchIndex.ts` is a Node-only index bench. `genVault.mjs` is a deterministic vault generator (`--notes N --seed S`) and can be reused.
- **Impact:** phases that promise "faster launch, smoother typing, lighter idle" have no before/after number.
- **Draw equivalent:** draw 1B / YAZ-2077 (a `tools/perf/` CDP harness, local only). **Transfers, adapted**, with docs-specific scenarios (P3).

### F6. E2E coverage gaps against the feature inventory
Features the unit suites cover but no E2E spec touches (§3 inventory):
- the Comments stream
- the Vault switcher (⌘O, display names, right-click menu)
- Favorites
- Focus mode
- cross-window file Cut/Copy/Paste
- the view-only viewers (PDF / text / image files)
- the right panel (⌥-open, resize, hide)
- bullet zoom plus zoom history / ⌘Z
- document magnification (YAZ-1410)
- task cycling (⌘Enter)
- the spelling context menu
- `app://` secure-context facts

Nothing checks the packaged `.app` end to end, and the harness cannot run against `dist-app`.
- **Draw equivalent:** draw 1C's must-have list plus `E2E_PACKAGED=1`. **Transfers, adapted.**

### F7. The IPC bridge is written out 5× (≈1,267 lines)
- **Evidence:** the table in §1. Two access styles: `api.ts` wraps rejections into `BridgeRequestError`, while 36 direct `window.yaseenDocs` sites in 14 files get raw `BridgeError` objects.
- **Impact:** code size, and drift risk on every new channel. Today a new channel means editing `channels.ts`, types, preload, `api.ts`, main, `bridge.test.ts` and CONTRACTS.
- **Risk:** low once a surface snapshot pins `window.yaseenDocs` (the draw app's approach).
- **Draw equivalent:** draw 6A / YAZ-2106 went from 1,229 to −885 LOC with a byte-identical surface snapshot. **Transfers as-is.**
- **Estimate for this repo:** −550 to −750 LOC (estimated from the line counts above; 77 channels vs the draw app's 90).
- **Side effect:** it closes the F3 "every channel has one handler" gap for free.

### F8. `Sidebar.tsx` is a god-component (1,608 lines; 21 `useState`, 25 effects, 10 refs, 28 `useCallback`; 524 comment lines)
- Almost the same shape as the draw app's before 6C (1,499; 22/28/15/27). `Sidebar.test.tsx` is 3,652 lines and pins the behaviour.
- `App.tsx` (897 lines; 18 `useState`, 14 effects, 29 `useCallback`) is next in line but less tangled.
- **Impact:** readability and change safety, not size. Draw 6C ended **+49 net production LOC** after consolidation.
- **Draw equivalent:** draw 6C / YAZ-2108. **Transfers, adapted.** The hooks differ: Topics/Files/♥ lenses, focus lists, favorites, file clipboard, inline create/rename, tree drag, search, missing-file checks.

### F9. The main process has no request-validation helper set
- **Evidence:**
  - 122 `new BridgeFailure(` calls, 79 of them BAD_REQUEST.
  - **11 identical copies** of `if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')`: `fileClip.ts:51`, `ipc/agent.ts:30`, `fs/openDefault.ts:17`, `fs/reveal.ts:26`, `fs/assets.ts:142`, `fs/file.ts:37`, `fs/openInVsCode.ts:29`, `fs/copy.ts:107`, `fs/remove.ts:35`, `fs/rename.ts:43`, `fs/rename.ts:89`.
  - `isRecord` is defined 6× (`main/store.ts:96`, `main/properties/index.ts:28`, `main/git/manager.ts:87`, `client/src/views/folderPageSettings.ts:109`, `views/migrateFolderBody.ts:32`, `views/viewSchema.ts:94`).
  - `isStringArray` is defined 2× (`store.ts:97`, `vaultIndex/cache.ts:92`).
- **Impact:** −40 to −60 LOC (estimated). Messages stay byte-identical.
- **Draw equivalent:** draw 6D / YAZ-2109. **Transfers as-is.** The docs app has no seed-kit part; `genVault.mjs` is already one generator.

### F10. Smaller structural duplication (from jscpd)
- **8 confirm sheets share one shell** (642 lines total): `sidebar/Confirm{Delete,Move,Rename,TurnBack}.tsx`, `comments/ConfirmDeleteComment.tsx`, `views/view/Confirm{DeleteColumn,DeleteView,RemoveMember}.tsx`. Each repeats about 30 lines: focus Cancel on mount, the Esc/Enter window keydown, the overlay mousedown, `role=dialog`. `ConfirmMove.tsx:40-45` records that mirroring instead of sharing was deliberate. Estimate −150 to −180 LOC with an identical DOM.
- **Fold plugins:** `editor/outline/headingFolding.ts` and `outlineFolding.ts` share the toggle-button widget and the notify-on-changed-keys plugin view (4 clones, 83 lines). Estimate −50 to −70, with medium risk because this is the editor.
- **Per-root subscription sync ×3:** `ipc/vaultConfig.ts:14-26`, `ipc/favorites.ts:15-27`, `ipc/properties.ts:19-31`. `ipc/properties.ts:12-17` hand-rolls `broadcastAll`. `chained()` appears ×2 (`main/favorites.ts:45-58`, `main/properties/index.ts:120-133`). Estimate −40 LOC.
- **Retry-once-on-CONFLICT:** `views/writeProperty.ts:17-32` is the canonical `transformFile`; `links/renameLinks.ts:339-351` re-implements it. `FrontmatterPanel.tsx:420-431` and `drawings/saveDrawing.ts:32-40` differ on purpose (a different re-read rule). About −8 LOC. Low value.
- **Draw equivalent:** none one-to-one (draw 6B was two editors sharing a state machine). **The docs app has no 6B twin**: `useAutosave` has one consumer (`editor/Editor.tsx:265`). Do not port 6B.

### F11. E2E helpers are redefined per spec
- **Evidence:** `layer` is defined in 26 specs, `editorOf` 20, `contents` 19, `activeTab` 19, `fileRow` 17, `viewTabs` 11, `tabsOf` 9, `sheet` 9.
- **Impact:** a DOM or selector change (for example a Sidebar split that renames a class) needs up to 26 edits. That makes the safety net itself fragile. Estimate −300 to −400 test LOC.
- **Draw equivalent:** draw 1C built a shared `support/` layer from the start. **Transfers, adapted.**

### F12. Dependency hygiene (knip)
- `@vitejs/plugin-react` and `vite` are declared in `client/package.json` but imported by `desktop/electron.vite.config.ts`.
- `mdast` types are used by `editor/inlineBreaks.ts` and `marks/{highlight,htmlPairs,underline}.ts` without being listed.
- `@codemirror/view` is used by `editor/clipboardCopyOut.ts` but reached only transitively.
- Keep `@excalidraw/{common,element,math,fractional-indexing}`: they pin the vendored fork's own deps.
- **Draw equivalent:** draw 6D's "build-graph honesty". **Transfers as-is.** Impact is reliability of `npm ci` layout, not size.

---

## 3. Feature inventory → coverage (seed for `docs/REGRESSION.md`)

A = Playwright spec · U = unit/jsdom only · M = manual · **gap** = neither automated in E2E nor meaningfully in unit. ❌ = spec currently red.

| ID | Feature | Coverage |
|---|---|---|
| E1 | Open/type/autosave round trip, normalised write, "typing without change never writes" | A smoke, pasteRoundTrip, outlineRealFile ❌; U roundtrip |
| E2 | Bullet fold persisted in app state, restored on relaunch | A smoke 4–5 |
| E3 | Heading fold H1–H3 | A headingFold |
| E4 | Image-bullet fold / thumbnail | A imageFold |
| E5 | Folds survive external edits; external edits apply as diffs | A foldExternalEdit, foldDiffApply |
| E6 | Outliner keys (Tab / ⇧Tab / Enter / Backspace) | U (Crepe suites); A partial via folderPageOutline |
| E7 | Task cycle ⌘Enter | **gap** (no direct test found) |
| E8 | Marks ⌘U / ⌘⇧X / highlight | U underline, highlight |
| E9 | Lightbox gallery | A imageGallery |
| E10 | Line selection ⇧↓/⇧↑, hidden lines never deleted | U lineSelection(+scenarios) |
| E11 | Bullet zoom, breadcrumbs, zoom history, ⌘Z reverts view action | U zoom; **E2E gap** |
| E12 | Guide lines click | U guideLines |
| E13 | Drag handle, multi-block | A easyWave / numberedBullets (part) |
| E14 | Numbered bullets | A numberedBullets |
| E15 | Find in page ⌘F | A findInPage |
| E16 | Wikilinks: click, ⌘-click, `[[` completion, aliases | A links |
| E17 | Clipboard in/out modes, paste round trip | A pasteRoundTrip; U clipboard* |
| E18 | Image paste / render / `app://vault` / Copy Image | A imagePaste, imageRender ❌ |
| E19 | Drawings (Excalidraw sidecar, yaseendraw fork) | A drawing, yaseendraw |
| E20 | Document magnification (YAZ-1410) | U DocumentZoom, zoomRequest; **E2E gap** |
| E21 | Page title = rename | A title |
| E22 | Properties panel (typed rows + raw) | A properties, propertiesReorder |
| E23 | Content width / spacing / bullet threading settings | A contentWidth, settings; U bulletThreading |
| E24 | Spelling squiggle + context menu | **M** (native menu) |
| E25 | Conflict bar / dirty buffer vs external change | U autosave; A partial |
| E26 | View-only viewers: text, PDF, image files | U Text/Pdf/ImageViewer; **E2E gap** |
| C1 | Comment stream (add, reply, number, fold, delete) | U CommentsSection; **E2E gap** |
| C2 | `yaseendocs` CLI + Copy for Agent | U cli, agent, copyForAgent; **packaged bin: gap** |
| S1 | Lens tabs Topics / Files / ♥, default Files | A lenses ❌ (stale) |
| S2 | Topics tree, Uncategorized, drag to re-parent | A topics ❌ (stale), topicsDrag, createUnderFolder |
| S3 | Create note / folder page / folder / dated folder | A topics, createUnderFolder |
| S4 | Rename + vault-wide link rewrite | A rename |
| S5 | External rename detection + repair | A externalRename |
| S6 | Delete to Trash, tabs close | A delete |
| S7 | File Cut/Copy/Paste, one app-wide clipboard | U fileClip, Sidebar; **E2E gap** |
| S8 | ⌘K search, ⌘⏎ background tab | A search ❌ |
| S9 | Folders start closed each launch | A collapsedLaunch |
| S10 | Sidebar collapse / resize (180–520) | A part (easyWave, settings) |
| S11 | Copy path, multi-select, ⌘⇧C | A multiselect ❌, tabs |
| S12 | Focus on folder/topic (per lens, persists) | U; **E2E gap** |
| S13 | Favorites (♥ tab, reorder, `.yaseendocs/favorites.json`) | U favorites (main + ipc), Sidebar; **E2E gap** |
| S14 | Vault switcher ⌘O, display names, ⓘ path, right-click menu | U VaultSwitcher, vaultMenuSections; **E2E gap** |
| W1 | Tabs, ⌃Tab, ⌘W, background tabs, restore | A tabs |
| W2 | Multi-window, ⌘⇧N, `yaseendocs://`, Open With | A scenarios |
| W3 | Right panel (⌥-open, resize, hide) | U RightPanel; **E2E gap** |
| W4 | Welcome + recents | A smoke 1; U Welcome |
| W5 | ⌘Q flush + relaunch restore | A smoke 5; U windows |
| W6 | Theme live in every window | A theme |
| W7 | Settings dialog, hotkeys list | A settings |
| F1–F9 | Folder pages: contents block, outline view, table columns/freeze/nested groups, board + card styles, filter/sort, default view, sync from folder, backlinks, "bible" convergence | A folderPages, crossCutting ❌, folderPageOutline ❌, columns, freezeColumns, nestedGroups, folderPageColumns, board, boardCardStyles, filter, defaultView, folderSync, backlinks, bible |
| G1 | GitHub sync (chip, sync now, quit-time push) | A sync, settings; U git/* |
| T1 | `migrateFolderPages` / `seedDefaultColumns` CLIs | U tools project |
| P1 | `app://` is a secure, standard, fetch-capable origin | **gap** |
| P2 | Info.plist `yaseendocs` scheme + `.md` Alternate Editor | **gap** (→ budget gate) |
| P3 | Ad-hoc signature valid | **gap** (→ budget gate) |
| P4 | `Resources/bin/yaseendocs` + `out/main/cli.js` shipped | **gap** (→ budget gate) |
| P5 | Windows installer builds | only on `v*` tag (release.yml) |
| P6 | Finder double-click, LaunchServices, DMG install | **M** |

**Untested glue** (no direct test): `main/index.ts`, `ipc/index.ts`, `ipc/broadcast.ts`, `hooks/useAutosave.ts`, `editor/SaveIndicator.tsx`, `lib/dragSlot.ts`, packaging (`build/adhocSign.cjs`, `tools/packDesktop.mjs`). Full list: `SCRATCH/sh/untested.txt` (61 files). Most other entries are views covered through their parents' tests.

---

## 4. Proposed changes

### Phase 1 — safety net (do before any optimisation)

#### P1. Make `main` green (1C prerequisite)
Fix the 2 confirmed-stale specs. Triage the other 6 into "stale test" or "product bug". A product bug is fixed or `test.fail()`-marked with a Linear issue; it is never silently rewritten. Target: `playwright test` green 3× in a row on untouched 63aeeea.

`desktop/e2e/topics.spec.ts`
```diff
@@ -375,4 +375,5 @@
     'New dated folder',
     'Rename',
+    'Add to favorites',
     'Open in', // its own group after the this-row group (D7 amended)
     'Delete',
```
After this, the behaviour is: the spec pins the real YAZ-1766 menu.

`desktop/e2e/lenses.spec.ts` (step 1 pins the pre-YAZ-1846 default. The Topics-only asserts move to the step that clicks Topics. Check that the later steps don't assume a Topics start.)
```diff
@@ -82,12 +82,10 @@
-test('step 1 — a state file with no lens boots on TOPICS: the folder-page tree, never the file tree', async () => {
+test('step 1 — a state file with no lens boots on FILES (DEFAULT_SIDEBAR_LENS since YAZ-1846)', async () => {
   app = await launchApp({ userData, seedState: preLensState(vault, path.join(vault, SEED_FILE)) })
   win = await appWindow(app, 'w1')
   await expect(lensTab(win, 'Topics')).toBeVisible()
   await expect(lensTab(win, 'Files')).toBeVisible()
-  await expectLens(win, 'Topics')
-  // No folder page in this fixture: no roots, and every page waiting under Uncategorized.
-  await expect(uncategorized(win)).toContainText('Uncategorized')
-  await expect(fileRows(win)).toHaveCount(0)
+  await expectLens(win, 'Files')
+  await expect(fileRows(win)).not.toHaveCount(0)
   await expect(bodyMsg(win)).toHaveCount(0)
   await expect(searchBar(win)).toBeVisible() // ALWAYS visible — on this lens too (the locked YAZ-739 rule)
   await shoot(win, 'lens-01-topics-default')
```
After this, the behaviour is: the spec pins the shipped default. Also fix README.md:79 ("Topics (the default)"), LAUNCH.md:51 and CONTRACTS.md:57 (spec count and duration: 50 specs, about 5 min).

#### P2. Scripts and CI
`package.json`
```diff
@@ -16,4 +16,8 @@
     "test": "vitest run",
     "e2e": "npm run build -w desktop && playwright test --config desktop/e2e/playwright.config.ts",
+    "e2e:only": "playwright test --config desktop/e2e/playwright.config.ts",
+    "perf": "node tools/perf/run.mjs",
+    "perf:budget": "node tools/perf/measureBudget.mjs",
+    "perf:budget:ci": "node tools/perf/measureBudget.mjs --out-only",
     "test:watch": "vitest"
   },
```
`.github/workflows/ci.yml` (new)
```diff
@@ -0,0 +1,17 @@
+name: ci
+on:
+  pull_request:
+  push:
+    branches: [main]
+jobs:
+  check:
+    runs-on: macos-latest
+    steps:
+      - uses: actions/checkout@v4
+      - uses: actions/setup-node@v4
+        with: { node-version: 22, cache: npm }
+      - run: npm ci
+      - run: npm run typecheck
+      - run: npm test
+      - run: npm run build
+      - run: npm run perf:budget:ci
```
After this, the behaviour is: every PR runs typecheck, the 4,487 unit tests (about 1 min locally), the build and the size gate. E2E stays local (see Decision 1), as in the draw app, because it drives real focused windows.

#### P3. Size and integrity gate + frozen v0.9.27 baseline (draw 1A equivalent)
Files: `tools/perf/measureBudget.mjs` (CLI), `tools/perf/lib/bundle.mjs` (pure, tested), `tools/perf/budget.json`, `tools/perf/bundle.test.mjs`. Zero dependencies, read-only.

Two modes:
- `--out-only` on `desktop/out` for CI (under 1 s)
- full, on `dist-app/…/Yaseen Docs.app` plus the DMG

**Rows** (ceilings = the measured baseline, with 0.1 % tolerance for DMG jitter; the ratchet only goes down):
```diff
@@ -0,0 +1,22 @@
+{
+  "_rule": "Ceilings only go down. Raising one needs Yasin's written OK in the PR body.",
+  "baseline": "v0.9.27 @ 63aeeea",
+  "sizeTolerance": 0.001,
+  "ceilings": {
+    "appBytes": 324670162,
+    "frameworksBytes": 288532029,
+    "asarBytes": 35059247,
+    "dmgBytes": 140906095,
+    "appLproj": 55,
+    "localePakBytes": 48655444,
+    "localePakCount": 220,
+    "entryJsBytes": 4850821,
+    "entryCssBytes": 277906,
+    "rendererBytes": 34343287,
+    "rendererJsChunks": 241,
+    "mainBytes": 411774,
+    "preloadBytes": 11015,
+    "asarNodeModulesEntries": 17,
+    "shippedMapBytes": 0
+  }
+}
```
**Integrity checks** (each exits 1 with a message):
- Info.plist has the `yaseendocs` URL scheme, and `md`/`markdown` as Editor with rank Alternate.
- `Signature=adhoc`, and `codesign --verify --deep --strict` passes.
- The asar holds `out/main/index.js`, `out/main/cli.js`, `out/preload/index.js` and `out/renderer/index.html`.
- `Contents/Resources/bin/yaseendocs` exists and is executable (Copy for Agent's promise).
- The KaTeX font families are present. `excalidraw-assets/fonts` is non-empty: this is a keep-working check only. Drawing bytes are reported in a separate `outOfScope` block of `budget.json` and are **not ceilings anyone is asked to lower**.
- Chunk closure: every `./x.js` imported by any shipped chunk is shipped (241 chunks, including the Mermaid diagram and CodeMirror language chunks).
- Duplicate guard: no sha1-identical file appears twice in the asar.

Tests: negative fixtures for a missing chunk, a lost scheme, a lost `.md` type, a missing CLI bin, and a duplicate file, plus one passing fixture.

After this, the behaviour is: the app is unchanged. A PR that grows a row or drops a shipped file fails CI.

#### P4. Local CDP perf harness with A/B interleaving (draw 1B equivalent)
`tools/perf/{run.mjs,scenarios.mjs,lib/app.mjs,lib/stats.mjs,lib/fixtures.mjs}`:
- It launches the built or packaged app with `--user-data-dir=<tmp>` and `--remote-debugging-port=<free>`, then seeds `yaseendocs.json` the way `helpers.ts:seededState` does.
- Fixtures come from `desktop/e2e/fixtures/genVault.mjs` (already deterministic) plus a generated 5,000-line outline note.
- **A/B mode:** `npm run perf -- <scenario> --a <baseline.app> --b <candidate.app> --runs 5` runs A,B,A,B… with 1 warm-up each dropped. It reports the median, p95, cv and `uptime` load for each side.

**Scenarios** (all local, none in CI):
1. **launch**: spawn → `.ProseMirror` has the seeded note's text; also spawn → navigation and navigation → first paint.
2. **open-large**: click the 5k-line note in the tree → content painted, plus the long tasks in between.
3. **typing**: keydown → next rAF, p50/p95 over 200 keys at the end of the 5k-line note and in a 1k-member folder-page outline.
4. **fold**: fold-all / unfold-all on the 5k-line note (frame time plus the long-animation-frame count).
5. **scroll**: rAF frame deltas while scrolling the large note and a 1k-row table.
6. **folder-page**: open a folder page with 1k members (table, board, cards); sort, filter, group.
7. **search**: ⌘K query → results painted, on a 5k and a 20k note vault.
8. **tree-storm**: rewrite 230 notes on a 2k-note vault while open; record main CPU, peak footprint, `state:get` probe latency (avg/max) and settle time.
9. **tab-switch**: 10 retained tabs, ⌃Tab cycle frame time.
10. **vault-switch**: ⌘O → another vault in front.
11. **idle**: 120 s CPU plus the phys_footprint of main, renderer and GPU.
12. **index**: cold vs warm (wrap the existing `benchIndex.ts`).
13. **quit-flush**: type, then ⌘Q 150 ms later; assert the bytes are on disk. On a synced vault, also assert the commit reached a local bare remote.

Unit tests for the pure parts: stats, fixture determinism, and the rule that the work dir is never outside tmp.

After this, the behaviour is: the app is unchanged, and every later child pastes a before/after table.

#### P5. E2E hygiene: stop the harness taking over `yaseendocs://`
`desktop/src/main/index.ts`
```diff
@@ -44,2 +44,4 @@
 // Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
-app.setAsDefaultProtocolClient('yaseendocs')
+// Test launches must not re-point the OS handler at the dev Electron binary (it did: LaunchServices
+// held com.github.electron for yaseendocs:// after e2e runs). scenarios.spec emits open-url directly.
+if (process.env.YASEEN_DOCS_E2E !== '1') app.setAsDefaultProtocolClient('yaseendocs')
```
`desktop/e2e/helpers.ts`
```diff
@@ -34,1 +34,1 @@
-  return _electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userData}`] })
+  return _electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userData}`], env: { ...process.env, YASEEN_DOCS_E2E: '1' } })
```
Also apply the env to any spec that calls `_electron.launch` directly. While in `helpers.ts`, add `E2E_PACKAGED=1`, which swaps `args[0]` for `executablePath: dist-app/mac-arm64/Yaseen Docs.app/Contents/MacOS/Yaseen Docs` so the same suite runs on the package.

After this, the behaviour is: the packaged app and `npm run dev` are unchanged, and test runs leave the machine's link handler alone.

Remedy on Yasin's Mac: launch the installed Yaseen Docs once. It calls `setAsDefaultProtocolClient` at start and takes the scheme back.

#### P6. New E2E specs for the gaps plus `docs/REGRESSION.md`
- **New specs**, one pointed spec each, same harness:
  - `comments` (C1: add, reply, number, fold, delete; frontmatter on disk)
  - `vaultSwitcher` (S14: ⌘O by menu id, filter, ⏎ vs ⇧⏎, display name, right-click menu)
  - `favorites` (S13: add, reorder, JSON on disk, a second window sees it)
  - `focus` (S12)
  - `fileClipboard` (S7: copy in window A, paste in window B's vault, the "copy 2" naming)
  - `viewers` (E26: a `.pdf`, a `.txt` and a `.png` open read-only and the file bytes are untouched)
  - `rightPanel` (W3)
  - `zoom` (E11 + E20)
  - `tasks` (E7)
  - `secureContext` (P1: `isSecureContext === true` on `app://yaseen`, `crypto.subtle.digest` round trip, `fetch('app://yaseen/index.html')` ok, an `app://vault/` image loads, and **zero** requests outside `app:`, `data:` and `blob:`)
- **`docs/REGRESSION.md`:** the §3 table with stable IDs, each row tagged `A: <spec>`, `U: <test>` or `M`, plus a PR checklist:
  - `npm test` ✓
  - typecheck ✓
  - `perf:budget` ✓ (numbers pasted)
  - `e2e:only` ✓ ×1, and ×3 for the release candidate
  - touched REGRESSION rows ✓
- **Move the per-spec helpers into `helpers.ts`** (F11): `layer`, `editorOf`, `contents`, `activeTab`, `fileRow`, `viewTabs`, `tabsOf`, `sheet`. This is the only safe order: dedupe the helpers **before** the Sidebar split changes selectors.

After this, the behaviour is: the app is unchanged, and "0 features lost" is machine-checked for everything except P6-M rows.

#### P7. Glue tests (draw 1D equivalent)
- **`desktop/src/main/index.test.ts`:** load the real `index.ts` with `electron` and the heavy modules stubbed. It asserts:
  - `registerSchemesAsPrivileged` got `app` with `{ standard: true, secure: true, supportFetchAPI: true }` before `ready`
  - `open-url` and `open-file` are attached before `ready`, and a queued link routes only after `restoreAll()`
  - `second-instance` routes argv links, and otherwise focuses
  - `before-quit` calls `flushAllForQuit` before `store.flush` / `flushIndexCache` / `gitSync.flushForQuit`, and only then `app.exit(0)`
  - the userData override happens before `requestSingleInstanceLock`
- **Spot check:** swap `:198` and `:199`, or set `secure: false`, and a test must go red.
- **`desktop/src/main/ipc/index.test.ts`:** run `registerIpc` + `registerClipboardIpc` + `registerAgentIpc` against a mocked `ipcMain` and assert:
  - the set of `ipcMain.handle` channels equals the set of invoke channels (every `CH` value minus the push-only ones and the 3 `ipcMain.on` channels `watch:subscribe`, `watch:unsubscribe`, `app:flushed`)
  - no channel is handled twice

  If R1 lands, this test is written against the contract table instead.
- **Direct tests** for `hooks/useAutosave.ts` (frontmatter-only external change absorbed silently, per GRO-2186; conflict mtime; flush on unmount) and `editor/SaveIndicator.tsx`.

After this, the behaviour is: the app is unchanged, and the launch/size phases that touch `index.ts` have a guard.

### Phase 6 — refactor for less code (after phase 1 is green; each move-only, tests unchanged in the same commit)

#### R1. IPC contract as data (draw 6A; about −550 to −750 LOC, estimated)
New `shared/ipc.ts` (sketch; 77 entries in total):
```diff
@@ -0,0 +1,30 @@
+import type * as T from './types'
+export type Invoke<A extends unknown[], R> = { kind: 'invoke'; channel: string; _?: [A, R] }
+export type Push<P> = { kind: 'push'; channel: string; _?: P }
+const invoke = <A extends unknown[], R>(channel: string): Invoke<A, R> => ({ kind: 'invoke', channel })
+const push = <P>(channel: string): Push<P> => ({ kind: 'push', channel })
+
+/** THE bridge: preload, renderer `api` and main `handle()` are all derived from this table. */
+export const CONTRACT = {
+  tree: invoke<[root: string], T.TreeResponse>('fs:tree'),
+  readFile: invoke<[path: string], T.FileResponse>('fs:read'),
+  // … 11 more top-level fs doors …
+  state: {
+    get: invoke<[], T.AppState>('state:get'),
+    setSettings: invoke<[settings: Partial<T.Settings>], void>('state:set-settings'),
+    // …
+    onChange: push<T.AppState>('state:changed'),
+  },
+  file: {
+    rename: invoke<[req: T.RenameFileRequest], T.RenameFileResponse>('fs:rename'),
+    onRenamed: push<T.FileRenamedEvent>('file:renamed'),
+    // …
+  },
+  // window, menu, link, shell, vaultConfig, properties, favorites, github
+} as const
+
+/** Hand-written specials stay hand-written: watch (multiplexed), window.onFlush, menu.onCopyAs / onPasteAs. */
+export const SPECIAL = ['watch:subscribe', 'watch:unsubscribe', 'watch:event', 'app:flush', 'app:flushed', 'menu:copy-as', 'menu:paste-as', 'menu:copy-text', 'menu:paste-text-fallback'] as const
+
+export type YaseenDocsApi = Bridge<typeof CONTRACT> & Specials
+export type Envelope<T> = { ok: true; value: T } | { ok: false; error: T.BridgeError }
```
Other files:
- The preload becomes `buildBridge(CONTRACT)` plus the specials: from 207 to about 90 lines.
- `client/src/api.ts` becomes `wrapErrors(CONTRACT)`, which looks up `window.yaseenDocs` at call time.
- Route the 36 direct sites through `api`. Where a caller reads `err.code`, check it still sees the same code.
- `handle(CONTRACT.x.y, fn)` is typed from the table.
- Delete `desktop/src/channels.ts` and the 11 `*Api` interfaces.
- Replace `bridge.test.ts` with a byte-identical surface snapshot of `window.yaseenDocs` taken on `main` first, plus the P7 completeness test.

**Keep:** `contextIsolation`, the fixed allowlist, and every channel name and payload.

After this, the behaviour is: `window.yaseenDocs` is byte-identical (proved by the snapshot), and a new channel is one table line.

#### R2. Validation helpers + shared guards (draw 6D; about −40 to −60 LOC)
`desktop/src/main/fs/fsUtils.ts`
```diff
@@ -40,2 +40,8 @@
   return path.resolve(p)
 }
+
+/** BAD_REQUEST unless `raw` is a non-null object — the ONE spelling of 'request must be an object'. */
+export function requireObject(raw: unknown): Record<string, unknown> {
+  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
+  return raw as Record<string, unknown>
+}
```
`desktop/src/main/fs/reveal.ts` (the same edit applies at the other 10 sites; `openLink.ts:21` also rejects arrays, so leave it alone)
```diff
@@ -4,1 +4,1 @@
-import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'
+import { BridgeFailure, fsCall, requireAbsPath, requireObject } from './fsUtils'
@@ -26,2 +26,1 @@
-  if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
-  const p = requireAbsPath((req as Record<string, unknown>).path, 'path')
+  const p = requireAbsPath(requireObject(req).path, 'path')
```
Drop `BridgeFailure` from the import if nothing else in `reveal.ts` uses it.

`shared/guards.ts` (new) plus `desktop/src/main/store.ts`
```diff
@@ -0,0 +1,2 @@
+export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
+export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
```
```diff
@@ -96,2 +96,1 @@
-export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
-export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
+export { isRecord, isStringArray } from '@shared/guards'
```
Then import them in `properties/index.ts:28`, `git/manager.ts:87`, `vaultIndex/cache.ts:92`, `views/folderPageSettings.ts:109`, `views/migrateFolderBody.ts:32` and `views/viewSchema.ts:94`, and delete the local copies.

Test: `requireObject` returns the exact message.

After this, the behaviour is: every refusal message is byte-identical.

#### R3. Per-root subscription helper + one broadcast (about −40 LOC)
`desktop/src/main/ipc/broadcast.ts`
```diff
@@ -1,1 +1,3 @@
 import { BrowserWindow } from 'electron'
+import type { AppState } from '@shared/types'
+import type { Store } from '../store'
@@ -13,0 +16,17 @@
+
+/** One `subscribe(root)` per open-vault root in `AppState.windows`; dropped when the last window on it goes. */
+export function syncPerRoot(store: Store, subscribe: (root: string) => () => void): void {
+  const subs = new Map<string, () => void>()
+  const sync = (state: AppState): void => {
+    const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
+    for (const [root, off] of subs) {
+      if (!roots.has(root)) {
+        off()
+        subs.delete(root)
+      }
+    }
+    for (const root of roots) if (!subs.has(root)) subs.set(root, subscribe(root))
+  }
+  store.onChange(sync)
+  sync(store.get())
+}
```
`desktop/src/main/ipc/vaultConfig.ts` (`favorites.ts` and `properties.ts` get the same edit)
```diff
@@ -1,34 +1,16 @@
-import type { AppState, VaultConfigChange } from '@shared/types'
+import type { VaultConfigChange } from '@shared/types'
 import { CH } from '../../channels'
 import type { Store } from '../store'
 import { readConfig, subscribeConfig, writeConfig } from '../vaultConfig'
-import { broadcastAll } from './broadcast'
+import { broadcastAll, syncPerRoot } from './broadcast'
 import { handle } from './envelope'
 
-/** Main's own subscription per open-vault root; dropped when the last window on that root goes. */
-const subs = new Map<string, () => void>()
-
 /** Every live window gets the change; renderers filter by their own root (same posture as `state:changed`). */
 const broadcast = (change: VaultConfigChange): void => broadcastAll(CH.vaultConfigChanged, change)
 
-/** The open-vault roots are `AppState.windows` (null = Welcome); one `subscribeConfig` each, no more. */
-function syncSubscriptions(state: AppState): void {
-  const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
-  for (const [root, off] of subs) {
-    if (!roots.has(root)) {
-      off()
-      subs.delete(root)
-    }
-  }
-  for (const root of roots) {
-    if (!subs.has(root)) subs.set(root, subscribeConfig(root, broadcast))
-  }
-}
-
 /** The `vaultConfig.*` half of `window.yaseenDocs` (Desktop J, GRO-2188). */
 export function registerVaultConfigIpc(store: Store): void {
   handle(CH.vaultConfigRead, readConfig)
   handle(CH.vaultConfigWrite, writeConfig)
-  store.onChange(syncSubscriptions)
-  syncSubscriptions(store.get())
+  syncPerRoot(store, (root) => subscribeConfig(root, broadcast))
 }
```
`desktop/src/main/ipc/properties.ts`: use the shared broadcast.
```diff
@@ -1,6 +1,6 @@
-import { BrowserWindow } from 'electron'
 import type { AppState, PropertiesResponse } from '@shared/types'
 import { CH } from '../../channels'
 import { getProperties, removeProperty, setProperty, subscribeProperties } from '../properties'
 import type { Store } from '../store'
+import { broadcastAll } from './broadcast'
 import { handle } from './envelope'
@@ -11,7 +11,2 @@
 /** Every live window gets the fresh declarations; renderers filter by their own root (the `state:changed` posture). */
-function broadcast(properties: PropertiesResponse): void {
-  for (const win of BrowserWindow.getAllWindows()) {
-    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
-    win.webContents.send(CH.propertiesChanged, { root: properties.root, properties })
-  }
-}
+const broadcast = (properties: PropertiesResponse): void => broadcastAll(CH.propertiesChanged, { root: properties.root, properties })
```
Also: move `chained()` (`main/favorites.ts:45-58` ≡ `main/properties/index.ts:120-133`) into one `createRootChain()` in `fs/fsUtils.ts`.

After this, the behaviour is identical: same subscribe/unsubscribe order, same payloads. The existing `ipc/{vaultConfig,favorites,properties}.test.ts` stay green without edits.

#### R4. One `ConfirmSheet` shell for the 8 confirm dialogs (about −150 to −180 LOC)
`client/src/components/ConfirmSheet.tsx` (new, about 35 lines):

```tsx
ConfirmSheet({ labelId, text, confirmLabel, danger?, onConfirm, onCancel, children? })
```

It holds today's exact mechanics:
- focus on Cancel at mount
- window keydown: Esc → cancel, Enter → confirm
- overlay mousedown → cancel, and the inner surface stops propagation
- `role="dialog"`, `aria-modal`, `aria-labelledby`

Example, `client/src/sidebar/ConfirmMove.tsx`:
```diff
@@ -1,1 +1,1 @@
-import { useEffect, useRef } from 'react'
+import { ConfirmSheet } from '../components/ConfirmSheet'
@@ -51,37 +51,12 @@
 export function ConfirmMove({ page, from, to, others, onConfirm, onCancel }: ConfirmMoveProps) {
-  const cancelRef = useRef<HTMLButtonElement>(null)
-
-  useEffect(() => cancelRef.current?.focus(), [])
-
-  useEffect(() => {
-    const onKey = (e: KeyboardEvent) => {
-      if (e.key === 'Escape') {
-        e.preventDefault()
-        onCancel()
-      } else if (e.key === 'Enter') {
-        e.preventDefault()
-        onConfirm()
-      }
-    }
-    window.addEventListener('keydown', onKey)
-    return () => window.removeEventListener('keydown', onKey)
-  }, [onConfirm, onCancel])
-
-  return (
-    <div className="confirm-overlay" onMouseDown={onCancel}>
-      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-move-text" onMouseDown={(e) => e.stopPropagation()}>
-        <p className="confirm__text" id="confirm-move-text">
-          {moveConfirmMessage(page, from, to, others)}
-        </p>
-        <div className="confirm__actions">
-          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
-            Cancel
-          </button>
-          <button type="button" className="confirm__btn" onClick={onConfirm}>
-            Move
-          </button>
-        </div>
-      </div>
-    </div>
-  )
+  return (
+    <ConfirmSheet labelId="confirm-move-text" confirmLabel="Move" onConfirm={onConfirm} onCancel={onCancel}>
+      {moveConfirmMessage(page, from, to, others)}
+    </ConfirmSheet>
+  )
 }
```
Precondition: diff all 8 sheets first (danger class, extra controls such as ConfirmDelete's child count or ConfirmRename's list). Only sheets whose mechanics match exactly move over. Every `Confirm*.test.tsx` stays unmodified. Update the "mirrors … rather than sharing a shell" comment at `ConfirmMove.tsx:40-45`.

After this, the behaviour is: DOM, focus and keys are identical, pinned by the 8 existing test files.

#### R5. Split `Sidebar.tsx` into feature hooks (draw 6C; net LOC about 0, readability)
- Target: `sidebar/hooks/` with about 3 modules, following draw 6C's consolidation lesson, where 18 files became 3 and +318 LOC became +49:
  - `useVaultTree`: tree data, watcher refresh, expansion, Files order, missing-file checks, focus lists, favorites lens
  - `rowGestures`: selection, file clipboard, inline create/rename, tree drag
  - `useSidebarSearch`
- `Sidebar.test.tsx` (3,652 lines) must stay green **unmodified**.
- Do it **after** P6's helper dedupe, and after any smoothness child that touches Sidebar render isolation.
- No diff is given here. It is a move-only series of 4–5 commits; the diff is the move itself.

#### R6. Smaller items
- `links/renameLinks.ts:339-351`: use `transformFile` from `views/writeProperty.ts:17` (the no-op test becomes `next === null → content`). About −8 LOC. The summary counters must stay the same, so confirm `transformFile`'s return tells written from no-op apart (compare content before/after).
- Fold plugins: share the toggle widget and the `notifyCollapsedKeys` plugin view between `headingFolding.ts` and `outlineFolding.ts`. About −50 to −70 LOC, medium risk; do it last, behind the fold E2E specs (smoke 4–5, headingFold, imageFold, foldExternalEdit, foldDiffApply).
- Dependencies (build-graph honesty):
  - move `@vitejs/plugin-react` and `vite` from `client` devDependencies to `desktop` devDependencies (or to the root)
  - add `@types/mdast` and `@codemirror/view` (at the version already resolved) where they are imported
  - no version changes

---

## 5. Decisions Yasin must make

**Decision 1: what "green" means before a phase-2+ child merges.**
- Options:
  1. Local gate per PR: `npm test` + typecheck + `perf:budget` in CI, and `e2e:only` run locally with the result pasted in the PR (this is what the draw app did).
  2. Also run E2E in a macOS CI job.
  3. E2E advisory only.
- **Recommendation: 1.** The suite drives focused real windows, and each launch takes keyboard focus. The draw app found shared macOS runners bad at this. It runs locally in about 5 min. Revisit 2 after a week of green local runs.

**Decision 2: adopt the IPC contract table (R1)?**
- It is an architectural change in how the bridge is declared. No user-visible change, with a snapshot proof.
- Options:
  1. Yes, one data table with zero dependencies (draw D16 / AD1 option 2).
  2. electron-trpc or a similar library.
  3. Keep the 5-place bridge and only add the P7 completeness test.
- **Recommendation: 1.** Draw proved it at −885 LOC with a byte-identical surface. It adds no dependency and makes typecheck the drift guard. Option 3 is the minimum if refactor time is short.

**Decision 3: split `Sidebar.tsx` (R5) given it saves no LOC?**
- Options:
  1. Split into about 3 feature hooks (draw 6C).
  2. Leave it.
- **Recommendation: 1, but last in phase 6.** Its value is change-safety for future Sidebar work, not size. It must not run concurrently with any smoothness work on Sidebar render isolation.

Not decisions, just recommended:
- P1 (fix stale specs; triage the 6 others, where any product bug is a phase-2 bug child)
- P2–P7
- R2
- R3
- R4 (subject to the exact-mechanics precondition)
- R6

---

## 6. Keep as-is

- **Overall duplication:** production code is 0.7 % real duplication and CSS has 0 clones. There is no broad dedupe pass to do beyond F10.
- **No 6B port:** `useAutosave` has one consumer, and `saveDrawing` / `FrontmatterPanel` deliberately differ from `transformFile` in their CONFLICT rules.
- **knip's 67 unused exported types and most of the 32 unused exports:** they are component `Props` types and constants named in docs and tests. Dropping `export` saves about 0 LOC and churns imports.
- **`@excalidraw/{common,element,math,fractional-indexing}` in `client/package.json`:** knip flags them as unused, but they pin the vendored fork's own dependencies to the fork tgz.
- **The vitest `perf` project design** (groupOrder 1, no file parallelism): correct, and not flaky in this run.
- **Trash use in `delete.spec.ts`:** documented, assertion-safe, and only fixture debris. Redirecting it would need a production hook, which is not worth it.
- **`tools/prototypes/*.mjs`:** knip calls them unused, but they are intentional one-off demo-vault scripts, not shipped.

---

## 7. Handoffs to other angles

- **Bundle / launch:**
  - eager entry `index-*.js` is **4,850,821 B**, with 277,906 B of CSS
  - 241 JS chunks, including every Mermaid diagram and CodeMirror language mode (the drawing chunks are out of scope, see the scope note)
  - 306 font files in the asar; about 243 of those are probably the out-of-scope `excalidraw-assets` (243 files there; I did not match them one by one)
  - the `app://` scheme has no `codeCache` privilege (`index.ts:75`)
- **Size:** 55 app `.lproj`, 220 `locale.pak` (48.66 MB), DMG 140.9 MB, chokidar shipped unbundled (17 asar `node_modules` entries).
- **Reliability:** two untriaged red specs may be real data bugs:
  - `outlineRealFile.spec.ts:101`: an original line is written back as `""`
  - `crossCutting.spec.ts:336`: an outline drag leaves a stray `"]]"` and loses a link line
- **Reliability (machine):** the `yaseendocs://` handler on Yasin's Mac currently points at `com.github.electron` (F2). Launching the installed app once fixes it.
- **Docs:** README.md:79 says Topics is the default lens (it is Files since YAZ-1846). LAUNCH.md:51 and CONTRACTS.md:57 give a stale spec count.
- **Main process:** 3 per-root dotfolder subscribers (vaultConfig, favorites, properties). `vaultConfig.ts` shares one chokidar watcher per root, which is fine, but the watcher angle should confirm favorites and properties ride on it rather than on their own watchers.
