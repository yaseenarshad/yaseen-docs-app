# CONTINUITY — yaz-1710-zoom-stepper

## Goal
- Stream 1 (shipped, PR #64): − / + preset stepping on the document zoom chip as one segmented pill `− | 100% | +`, arrow removed.
- Stream 2 (YAZ-1729, shipped PR #66): ⌘+ / ⌘− / ⌘0 and View › Zoom In / Out / Actual Size step the focused note along the pill ladder, else zoom the whole app as the stock roles did.
- Stream 3 (YAZ-1737): ceiling 400%; zoom on the CONTENT not the scroller so Crepe's floating chrome stays 100%; caret anchored through zoom; measured sideways slack; keys step 25 above 200. Merged to main, Linear closed out, all demo scaffolding gone. No release.

## Constraints
- Decisions D1–D6 LOCKED (comment on YAZ-1710). D6 amends the ticket text: the arrow is gone, the percentage alone opens the menu.
- Decisions D7–D10 LOCKED (second comment on YAZ-1710): menu owns the accelerators and forwards a step over IPC; the renderer routes by a bubbling `yaseendocs:zoom` event claimed by the note whose `section.editor` contains the focus; unclaimed → `window.zoom` invoke, main sets zoom level ± 0.5 / 0; ⌘0 follows the same rule.
- D11 v1 (stream 2): `scrollIntoView({ block: 'nearest' })` after a zoom. REVISED in stream 3 (D11 revised): `changeZoom` snapshots the visible caret's offset before the zoom, a layout effect restores it (the line does not budge); off-screen caret → `block: 'center'`.
- Stream 3, D12–D16 LOCKED (third comment on YAZ-1710, with the scenario list): presets to 400; indent proportional + gutters constant (pan and √-damping rejected live); zoom on the content blocks and the `.ProseMirror` node, never a shell (counter-zoom / counter-transform of the chrome rejected: off screen at 400%); `--zoom-slack` measured = deepest indent − deepest/zoom; `stepZoomByKey` = ladder to 200 then ±25.
- Gotcha: `DocumentZoom.tsx` mixes a component with plain exports → Vite Fast Refresh cannot hot-swap it; relaunch the dev app after editing it.
- No Playwright, ever, in this stream. Unit tests + the dev app on an isolated profile (`YASEEN_DOCS_USER_DATA_DIR`) that Yasin checks by eye (he approved the demo vault `Zoom Plus Minus Stepper YAZ-1710`).
- Commit with `/commit` (no Claude attribution). Push + merge to main approved. No release unless Yasin says so.
- Linear: parent + child In Progress when starting, Done when complete; learnings → comments; new work → `1B1-`-style children.

## Key Decisions
- `stepZoom(value, ±1)` is a pure exported function beside `parseZoom`; `null` at the wall is what disables the button. A step is `commit(next, false)` — no new state or effects.
- No `overflow: hidden` on the pill (it clips the absolutely positioned menu); the end buttons round their own outer corners.
- ES2022 lib: no `Array.prototype.findLast`, so the downward step is `[...PRESETS].reverse().find(...)`.
- Demo generator not shipped (14 hand-written notes for a one-component change).
- Stream 2: a hidden Electron MenuItem still needs a `label` (the ⌘= twin crashed the menu build without one). Every test stub of `window.yaseenDocs.menu` must carry `onZoom` (App.test.tsx).

## State
- Done:
  - [x] 1 YAZ-1712: scope + findings + mockup (six looks; Yasin picked C, segmented pill)
  - [x] 2 YAZ-1713: component + CSS + 7 unit tests; typecheck green
  - [x] 3 YAZ-1714: CONTRACTS.md paragraph, this ledger, full vitest (4094) + typecheck green; Yasin's live demo walk is the manual proof
  - [x] 4A YAZ-1716: audit posted (wrap a comment, `:last-of-type`, note the ES2022 `findLast` gap; aria labels declined)
  - [x] 4B YAZ-1717: audit applied; PR #64 merged to main (0332dee); Linear parent + children Done; demo folder, dev app, worktree and branch removed
  - [x] Stream 2: 5A–5D1 Done, PR #66 merged (bb8b217); 5D2/5D/5 wait only on the teardown of `yaz-1710-keys-demo`, folded into stream 3's closeout
  - [x] 6A YAZ-1738: prototype approved in demo vault `Zoom To 400 And Pan Sideways YAZ-1710`; D11 (revised)–D16 locked
  - [x] 6B YAZ-1739: presets/range, zoom-on-content CSS, block-handle probe, caret anchor, measured slack, `stepZoomByKey`; tests beside each
  - [x] 5A YAZ-1730: findings + prototype approved in demo vault `Zoom Shortcuts Note vs App YAZ-1710`; D7–D10 locked
  - [x] 5B YAZ-1731: menu, channels, bridge, `requestZoom`, note listener, hotkeys row; tests beside each; full vitest 4221 + typecheck green
- Now: [→] 6C YAZ-1740: CONTRACTS.md (magnification: ladder, D11, D14, D15; menu row; geometry note), hotkeys label, this ledger; demo relaunched on the final build
- Next: 6D1 YAZ-1742 audit → 6D2 YAZ-1743 apply, commit, PR, merge; remove both demo folders, the worktree and both branches; close 5D2/5D/5 and 6D2/6D/6 and YAZ-1710. No release.

## Open Questions
- none

## Working Set
- Stream 1: worktree and demo removed at closeout (branch `yaz-1710-zoom-stepper`, base main 48e9402, merged as 0332dee)
- Stream 2: branch `yaz-1710-zoom-keys` (merged bb8b217); demo `/Users/yasin/Desktop/yaz-1710-keys-demo/` — removed at stream 3's closeout
- Stream 3: worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1710-zoom-keys` on branch `yaz-1710-zoom-400` (base main bb8b217, main a4341ee merged in); demo `/Users/yasin/Desktop/yaz-1710-400-demo/` (vault `Zoom To 400 And Pan Sideways YAZ-1710`, `app-profile/`, `run-demo.sh`); removed at closeout
- Files (stream 1): `client/src/editor/DocumentZoom.tsx` (+ test), `client/src/app.css` ("document magnification" block), `docs/CONTRACTS.md`
- Files (stream 3): `client/src/editor/DocumentZoom.tsx` (+ test), `client/src/editor/Editor.tsx` (+ test), `client/src/editor/blockHandleTarget.ts` (+ test), `client/src/app.css`, `client/src/contentWidthCss.test.ts`, `client/src/settings/hotkeys.ts`, `docs/CONTRACTS.md`
- Files (stream 2): `desktop/src/main/menu.ts`, `desktop/src/main/ipc/window.ts`, `desktop/src/channels.ts`, `desktop/src/preload/index.ts`, `shared/types.ts`, `client/src/hooks/useMenuEvents.ts`, `client/src/editor/zoomRequest.ts`, `client/src/App.tsx`, `client/src/editor/Editor.tsx`, `client/src/settings/hotkeys.ts`, `docs/CONTRACTS.md` (+ tests beside each)
- Tests: `npx vitest run client/src/editor/DocumentZoom.test.tsx client/src/editor/Editor.test.tsx` · `npx vitest run` · `/opt/homebrew/bin/npm run typecheck`
