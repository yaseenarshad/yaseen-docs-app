# Regression list

The one list of everything Yaseen Docs does that a change must not lose (YAZ-2171, seeded from the YAZ-2131 scope inventory). Every row has a stable ID. A PR cites the IDs it touches, and each one is proved by the automated test named here, or by walking its hand steps.

- **A** = a Playwright-Electron spec in `desktop/e2e/` (64 specs; run with `npm run e2e`).
- **U** = a unit or jsdom suite (run with `npm test`).
- **M** = hand steps, listed under [Hand scenarios](#hand-scenarios). Only what automation cannot drive lives there.

Add a row when a feature ships. Never delete one unless the feature is removed on purpose, and cite the ticket that removed it.

## PR checklist

- [ ] `npm test` green
- [ ] `npm run typecheck` green
- [ ] the size/integrity budget gate green, with its numbers pasted
- [ ] `npm run e2e` green once; three runs in a row for a release candidate
- [ ] every REGRESSION row this change touches is re-proved (its spec ran, or its hand steps were walked) and listed in the PR body

## Editor

| ID | Feature | Proof |
|---|---|---|
| E1 | Open, type, autosave round trip; normalised write; typing that changes nothing never writes | A `smoke`, `pasteRoundTrip`, `outlineRealFile` · U `editor/roundtrip.test.ts`, `lib/autosave.test.ts` |
| E2 | Bullet fold persisted in app state, restored on relaunch | A `smoke` (steps 4–5), `bigNote` (step 3) |
| E3 | Heading fold H1–H3 | A `headingFold`, `bigNote` (step 4) |
| E4 | Image-bullet fold / thumbnail chip | A `imageFold` |
| E5 | Folds survive external edits; external edits apply as diffs | A `foldExternalEdit`, `foldDiffApply` · U `desktop/src/main/fs/watchConformance.test.ts`, `watchConformance.polling.test.ts` (the watcher engine, 🔒 YAZ-2131 D3) |
| E6 | Outliner keys: Tab / ⇧Tab / Enter / Backspace | U the Crepe outline suites (`editor/outline/*.test.ts`) · A `folderPageOutline` (in part) |
| E7 | Task cycle ⌘Enter | A `tasks` |
| E8 | Marks: ⌘U underline, ⌘⇧X strike, highlight, marks across line breaks | U `editor/marks/underline.test.ts`, `editor/marks/highlight.test.ts`, `editor/breakMarks.test.ts` |
| E9 | Lightbox gallery | A `imageGallery` |
| E10 | Line selection ⇧↓ / ⇧↑; hidden lines never deleted | U `editor/lineSelection.test.ts`, `editor/lineSelection.scenarios.test.ts` |
| E11 | Bullet zoom, breadcrumbs, zoom history; ⌘Z reverts a view action | A `zoom` · U `editor/outline/zoom.test.ts` |
| E12 | Guide lines click | U `editor/outline/guideLines.test.ts` |
| E13 | Drag handle, multi-block drag | A `easyWave`, `numberedBullets` (in part) |
| E14 | Numbered bullets | A `numberedBullets` |
| E15 | Find in page ⌘F | A `findInPage` |
| E16 | Wikilinks: click, ⌘-click, `[[` completion, aliases | A `links` |
| E17 | Clipboard in/out modes, paste round trip | A `pasteRoundTrip` · U `editor/clipboard*.test.ts` |
| E18 | Image paste / render / `app://vault` / Copy Image | A `imagePaste`, `imageRender` |
| E19 | Drawings (Excalidraw sidecar, yaseendraw fork). Out of scope for optimisation, must keep working | A `drawing`, `yaseendraw` |
| E20 | Document magnification (YAZ-1410) | A `zoom` · U `editor/DocumentZoom.test.tsx`, `editor/zoomRequest.test.ts` |
| E21 | Page title = rename | A `title` |
| E22 | Properties panel (typed rows + raw) | A `properties`, `propertiesReorder` |
| E23 | Content width, spacing (the first block hugs the title), bullet threading settings | A `contentWidth`, `settings`, `firstBlock` · U `editor/outline/bulletThreading.test.ts` |
| E24 | Spelling squiggle + context menu | M [E24](#e24-spelling) (native menu) |
| E25 | Conflict bar / dirty buffer vs external change | U `lib/autosave.test.ts` · A `foldExternalEdit` (in part), `frontmatterRace` (the app's own frontmatter write never raises the bar, YAZ-2175) |
| E26 | View-only viewers: text, PDF, image files | A `viewers` · U `viewers/TextViewer.test.tsx`, `viewers/PdfViewer.test.tsx`, `viewers/ImageViewer.test.tsx` |
| E27 | Big notes open correctly: caret at the start, every chevron, threading on the caret path, every wikilink decorated and resolved (5k mixed + 5k heading-dense) | A `bigNote` |

## Comments and agents

| ID | Feature | Proof |
|---|---|---|
| C1 | Comment stream: add, reply, number, fold, delete | A `comments` · U `comments/CommentsSection.test.tsx` |
| C2 | `yaseendocs` CLI + Copy for Agent | U `desktop/src/cli/cli.test.ts`, `desktop/src/main/ipc/agent.test.ts`, `lib/copyForAgent.test.ts` · packaged bin: M [P4](#p2p4-packaging) |

## Sidebar

| ID | Feature | Proof |
|---|---|---|
| S1 | Lens tabs Topics / Files / ♥; default Files (YAZ-1846) | A `lenses` |
| S2 | Topics tree, Uncategorized, drag to re-parent | A `topics`, `topicsDrag`, `createUnderFolder` |
| S3 | Create note / dated note / folder page / folder / dated folder | A `topics`, `createUnderFolder` |
| S4 | Rename + vault-wide link rewrite | A `rename` |
| S5 | External rename detection + repair | A `externalRename` |
| S6 | Delete to Trash; tabs close | A `delete` |
| S7 | File Cut / Copy / Paste; one app-wide clipboard across windows | A `fileClipboard` · U `desktop/src/main/fileClip.test.ts`, `lib/fileClipboardHotkey.test.ts` |
| S8 | ⌘K search, ⌘⏎ background tab | A `search` |
| S9 | Folders start closed each launch | A `collapsedLaunch` |
| S10 | Sidebar collapse / resize (180–520) | A `easyWave`, `settings` (in part) |
| S11 | Copy path, multi-select, ⌘⇧C | A `multiselect`, `tabs` |
| S12 | Focus on folder / topic (per lens, persists) | A `focus` · U `sidebar/Sidebar.test.tsx` (focus mode) |
| S13 | Favorites (♥ tab, reorder, `.yaseendocs/favorites.json`) | A `favorites` · U `desktop/src/main/favorites.test.ts`, `desktop/src/main/ipc/favorites.test.ts` |
| S14 | Vault switcher ⌘O, display names, ⓘ path, right-click menu | A `vaultSwitcher` · U `sidebar/VaultSwitcher.test.tsx`, `sidebar/vaultMenuSections.test.ts` |

## Windows

| ID | Feature | Proof |
|---|---|---|
| W1 | Tabs, ⌃Tab, ⌘W, background tabs, restore | A `tabs` |
| W2 | Multi-window, ⌘⇧N, `yaseendocs://`, Open With | A `scenarios` · M [P6](#p6-finder-launchservices-dmg) for the OS side |
| W3 | Right panel (⌥-open, resize, hide) | A `rightPanel` · U `right-panel/RightPanel.test.tsx` |
| W4 | Welcome + recents | A `smoke` (step 1) · U `Welcome.test.tsx` |
| W5 | ⌘Q flush + relaunch restore | A `smoke` (step 5), `quitFlush` · U `desktop/src/main/windows.test.ts` |
| W6 | Theme live in every window | A `theme` |
| W7 | Settings dialog, hotkeys list | A `settings` |
| W8 | Per-tab state kept across tab switches: scroll, caret, undo history, unsaved buffer, find-in-page, zoom (🔒 YAZ-2132 D5) | A `tabLayers` |

## Folder pages

| ID | Feature | Proof |
|---|---|---|
| F1–F9 | Contents block, outline view, table columns / freeze / nested groups, board + card styles, filter/sort, default view, sync from folder, backlinks, "bible" convergence | A `folderPages`, `crossCutting`, `folderPageOutline`, `columns`, `freezeColumns`, `nestedGroups`, `folderPageColumns`, `board`, `boardCardStyles`, `filter`, `defaultView`, `folderSync`, `backlinks`, `bible` |

## Sync, tools, platform

| ID | Feature | Proof |
|---|---|---|
| G1 | GitHub sync (chip, sync now, quit-time push) | A `sync`, `settings` · U `desktop/src/main/git/*.test.ts`, `desktop/src/main/ipc/github.test.ts` |
| T1 | `migrateFolderPages` / `seedDefaultColumns` CLIs | U the `tools` vitest project · A `crossCutting` (step 6 runs the real migration) |
| P1 | `app://` is a secure, standard, fetch-capable origin; no request leaves `app:` / `data:` / `blob:` | A `secureContext` |
| P2 | Info.plist `yaseendocs` scheme + `.md` as Alternate Editor | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P3 | Ad-hoc signature valid | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P4 | `Resources/bin/yaseendocs` + `out/main/cli.js` shipped | gate `npm run perf:budget` (packaged half) · M [P2–P4](#p2p4-packaging) when the gate isn't run |
| P5 | Windows installer builds | the `v*` tag release workflow (`.github/workflows/release.yml`) |
| P6 | Finder double-click, LaunchServices, DMG install | M [P6](#p6-finder-launchservices-dmg) |
| P7 | An e2e run never claims the machine's `yaseendocs://` handler | U `desktop/src/main/deepLinkScheme.test.ts` · M: after `npm run e2e`, the check under [P6](#p6-finder-launchservices-dmg) still names `/Applications/Yaseen Docs.app` |
| P8 | Open/Save panels keep the OS language; Chromium's paks trimmed to `en*` (🔒 YAZ-2131 D1) | U `tools/afterPack.test.mjs` · gate `npm run perf:budget` rows `chromiumLocaleCount`, `chromiumLocaleBytes`, `lprojCount` |

## Hand scenarios

Walk these on a packaged build (`dist-app/`), with a scratch vault and a throwaway profile, never the real ones.

### E24 Spelling

1. Type a misspelt word (`recieve`) in a note. It gets the red squiggle.
2. Right-click it. The native menu leads with suggestions; pick `receive`. The word is replaced and the note autosaves.
3. Right-click a correct word. There are no suggestions, and Cut / Copy / Paste still work.

### P2–P4 Packaging

1. `plutil -p "Yaseen Docs.app/Contents/Info.plist"`: `CFBundleURLSchemes` holds `yaseendocs`, and `CFBundleDocumentTypes` lists `md` / `markdown` with role Editor and rank Alternate.
2. `codesign -dv "Yaseen Docs.app"` reports `Signature=adhoc`, and `codesign --verify --deep --strict "Yaseen Docs.app"` passes.
3. `Contents/Resources/bin/yaseendocs` exists and is executable, and the asar lists `out/main/cli.js`.

### P6 Finder, LaunchServices, DMG

1. Open the DMG, drag the app to Applications, launch it once. It starts, and the Welcome screen lists recents.
2. In Finder, right-click a `.md` file → Open With: Yaseen Docs is offered, and choosing it opens the file in a window on its vault.
3. From another app (Slack, Notes), click a `yaseendocs://` link to a scratch-vault note (`yaseendocs://` + the note's absolute path, percent-encoded, as `shared/links.ts` `fileLink` builds it). The packaged app opens that note.
4. Check which app owns the scheme (read-only):
   `osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("yaseendocs://x")).path.js'` prints `/Applications/Yaseen Docs.app`.
