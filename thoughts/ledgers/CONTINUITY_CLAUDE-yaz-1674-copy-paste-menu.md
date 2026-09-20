# CONTINUITY — YAZ-1674 Copy & Paste files + organize the right-click menu

## Goal
- Right-click (or ⌘X / ⌘C / ⌘V) in the sidebar: Cut, Copy, Paste files and folders — a single row or the whole multi-select — within a vault and ACROSS vaults (two windows on two roots). The sidebar menu is regrouped into five sections with separators and shortcut hints. Linear: YAZ-1674 (parent). Phase now: PROTOTYPE in this worktree for Yasin's hand walkthrough; decisions get locked on Linear only after "approved, lock it in".

## Constraints
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1674`, branch `yaz-1674-copy-paste-menu` off main `8a68ee5`. NO commits until Yasin approves; nothing on main.
- No Playwright runs (they take over Yasin's machine). Unit tests + typecheck + Yasin's hand walkthrough in the isolated dev app (HMR, `YASEEN_DOCS_USER_DATA_DIR=<profile>`).
- Follow the codebase's idioms exactly: `BridgeFailure` codes, `fsCall`, `requireAbsPath`, `isSkipped`, envelope handlers, `broadcastAll`, passive notices via `onNotice`, never-overwrite, comments that cite the ticket (YAZ-1674) and the decision (D-n).
- Docs (`docs/CONTRACTS.md`, `README.md`, HotkeysPanel) are updated in the prototype only where the code would otherwise lie; the full doc pass is the polish issue.

## Key Decisions (recommended 2026-09-19, Yasin: "go with your recommendations"; LOCK on Linear only after demo approval)
- **D1 Clipboard lives in main.** One module `desktop/src/main/fileClip.ts`: `{ paths: string[], op: 'copy' | 'cut' } | null`, session-only, never persisted. Channels `fs:clip` (set), `fs:paste`, push `clip:changed` (`FileClipState = { count, op } | null`) to EVERY window on every change. Rejected: OS file clipboard (Electron write is macOS-only `public.file-url`, flaky for many files → Future "Finder interop"); renderer state (cannot cross windows).
- **D2 Cut included.** Same clipboard, `op: 'cut'`. Paste of a cut = the EXISTING `renameFile` per entry + `store.renamePath` + `broadcastAll(fileRenamed)` (exactly what `ipc/fs.ts`'s rename handler does). A cut pastes ONCE (clipboard clears on success); a copy pastes again and again. `EXDEV` from rename → that entry fails `IO_ERROR` "cannot move across disks; copy it instead". Cut into its OWN folder → that entry is skipped silently (drag-drop's "nothing to do").
- **D3 Name clash.** COPY → Finder's rule: `Note.md` → `Note copy.md` → `Note copy 2.md` (folders: whole name, no ext split). CUT → that entry fails `ALREADY_EXISTS`, never overwrites. Per-entry: `PasteResponse { pasted: {from,to,kind}[], failed: {from,code,message}[] }` — one bad entry never stops the rest. Copy into its own folder = Duplicate for free.
- **D4 Copy fidelity.** `fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })` — bytes copied faithfully, hidden dirs inside a folder included (Finder). Guards from rename/remove: source `isSkipped` basename → BAD_REQUEST; folder into itself/descendant → BAD_REQUEST; target dir must exist → NOT_FOUND (never mkdir); missing source → NOT_FOUND. No store repair, no broadcast after a copy (nothing moved; the watcher's add echo fills the tree; client also calls `refresh()` — idempotent). NOT in v1: carrying assets/images/drawings across vaults, link rewriting on copy.
- **D5 Paste target + gate.** Target = `menu.targetDir` (the "New note" rule: dir row → itself, file row → its parent, blank → root). Offered exactly where "New folder" is (`canNewFolder`): Topics PAGE rows do not get Paste (a disk verb on a meaning row). Cut/Copy: any row (file or dir), both lenses; hidden on blank space. On a row inside a selection of ≥2 the target is the ORDERED selection (`orderedSelectedPaths()`), labels "Cut 3 items" / "Copy 3 items"; else the one row, labels "Cut" / "Copy". Paste label: "Paste" DISABLED when the clipboard is empty (discoverability; `.ctx-menu__item:disabled` exists), "Paste N items" ("Paste 1 item") when not.
- **D6 Keys.** `onKeyDown` on `.sidebar__body` beside the Escape handler: ⌘/Ctrl + C / X with a selection ≥1 and no open menu → clip the ordered selection; ⌘/Ctrl + V with a non-empty clipboard and no open menu → paste beside the FIRST ordered selected row (dir → into it, file → its parent), or into the vault root with no selection. `preventDefault` + `stopPropagation` so the Edit-menu role never also fires. UNCONFIRMED until the demo: on macOS the renderer's preventDefault must beat the menu role — verify by hand; if it does not, keys become a Future issue.
- **D7 Menu look.** Five groups, separators between NON-EMPTY groups only: (1) Open/View: Open N in new tabs · Open in new window · Open in VS Code · Open in default app · Reveal in Finder · Focus on folder; (2) Clipboard: Cut · Copy · Paste · Copy path · Copy for Agent; (3) Create: New note · New folder page · New folder · New dated folder; (4) This row: Turn into/back folder page · Rename; (5) Delete. Shortcut hints right-aligned via `data-hint` + CSS `::after { content: attr(data-hint) }` so `textContent` and the accessible name stay the bare label (tests pin labels). Hints: ⌘X ⌘C ⌘V ⌘⇧C. NOTE: this moves "Copy N paths" below the Open group — loosens 🔒 D5 of YAZ-1337 ("the plural pair leads"); "Open N in new tabs" still leads. No submenus, no search.
- **D8 Menu mechanism.** `client/src/sidebar/menuSections.ts`: `MenuItem { id, label, onSelect, hint?, danger?, disabled? }`, `MenuSection = MenuItem[]`, pure `buildMenuSections(targets, handlers): MenuSection[]` (null entries dropped). `ContextMenu` keeps `x, y, onClose` and its overlay/clamp/Escape mechanics, takes `sections`, renders `<div class="ctx-menu__group" role="group">` per non-empty section; every item `onSelect(); onClose()` (a double `setMenu(null)` is harmless). `MenuTargets` stays the data model in Sidebar (add `clipPaths: string[] | null`). Gating tests move to `menuSections.test.ts` (pure); `ContextMenu.test.tsx` shrinks to render mechanics.

- **D7 amended 2026-09-20 (Yasin picked mockup C):** groups + separators + hints as above, PLUS the OS verbs collapse into one "Open in ▸" submenu (New window · VS Code · Default app · ── · Reveal in Finder). Top level of group 1: "Open N in new tabs" · "Open in ▸" · "Focus on folder". `MenuItem` gains optional `children: MenuItem[]`; the flyout opens on hover/click, stays open while the pointer is inside, clamps to the viewport.
- **D7 amended again (Yasin, live demo 2026-09-20):** "Open in ▸" moves to the this-row group AFTER Rename (Turn into folder page · Rename · Open in). Group 1 is now just "Open N in new tabs" · "Focus on folder" (skipped when empty). Chevron = masked SVG via CSS `::after` (bigger, themed, never in `textContent`).
- **D9 Click selects (Yasin, live demo 2026-09-20; reverses part of YAZ-1336's shift-only rule):** a plain click on any row (file or dir, both lenses) sets the selection to exactly that row — a file still opens, a dir still toggles; shift-click toggles; ⌘-click selects too; right-click outside the selection selects that row (Finder). Every keyboard verb (⌘C/⌘X/⌘V and the older ⌘⇧C) reads the selection, so "clicked" and "selected" are one idea. Visual: active+selected keeps the active fill and gains the selection's 2px leading edge. Known consequence: folding a folder by clicking its row replaces a multi-selection with that folder (Files tree has no separate chevron target) — UNCONFIRMED whether Yasin wants a chevron-only fold there.
- **D6 amended (live demo 2026-09-20):** the three chords live at the APP/window level beside ⌘⇧C (`lib/fileClipboardHotkey.ts` + `ownsWindowChord`), not on `.sidebar__body` — root cause: a click on the already-open file hands focus to the editor (`focusOpenDocument`, YAZ-961) and blank space is not focusable, so the body never heard the keys. Editor/inputs/contenteditable own the keys; elsewhere the Sidebar's `clipboardRef` handle (`cutOrCopy(op)`, `paste()` → boolean) acts. A left mousedown on blank space clears the selection so ⌘V lands in the root. ⌘ only (Ctrl belongs to the platform Edit menu). 
- **D10 Notice restyle (Yasin, live demo):** the passive notice moves from top-centre amber to the BOTTOM-LEFT corner, drawn like the menu surface (`--bg/--fg/--border`, radius 8, shadow, 120ms fade). Amber stays only for the conflict bar and the rename banner.
- **D7 final groups (Yasin, live demo):** SIX groups — [Open N in new tabs · Focus on folder] · [Cut · Copy · Paste · Copy N paths · Copy path · Copy for Agent] · [New note · New folder page · New folder · New dated folder] · [Turn into/back folder page · Rename] · [Open in ▸] · [Delete]. Empty groups are skipped.
- **D10 amended:** notice sits above the sidebar footer (`--sidebar-footer-h: 39px`, one variable shared by the footer and the toast) and carries an icon: `onNotice(text, icon?)`, `NoticeIcon = copy|cut|paste|success|error|info` (default info), 16px stroke SVGs in `components/NoticeIcon.tsx`, `data-icon` on the toast.
- **Backend micro-decisions (agent, 2026-09-20; lock with D1–D5):** `fs:paste` is a plain `handle` (no sender root guard needed — Cut/Copy are rows-only). `freeName` counts on from an existing ` copy N` and splits at the LAST extension (`a.tar.gz` → `a.tar copy.gz`, Finder's behaviour). A cut clears the clipboard only when ≥1 entry landed. The clipboard is NOT remapped on rename/delete — a stale entry fails `NOT_FOUND` at paste time. EXDEV is caught raw and as the `fsCall`-mapped `IO_ERROR` message.

## Contracts (shared/types.ts additions — the two agents code against these EXACT names)
```ts
// ---------- file clipboard (YAZ-1674) ----------
export interface FileClipRequest { paths: string[]; op: 'copy' | 'cut' }
export type FileClipState = { count: number; op: 'copy' | 'cut' } | null
export interface PasteRequest { targetDir: string }
export interface PasteResponse {
  pasted: { from: string; to: string; kind: 'file' | 'dir' }[]
  failed: { from: string; code: BridgeErrorCode; message: string }[]
}
// FileApi (window.yaseenDocs.file):
clip(req: FileClipRequest): Promise<void>
paste(req: PasteRequest): Promise<PasteResponse>
onClipChanged(listener: (state: FileClipState) => void): () => void
// client/src/api.ts:
api.clip(req) · api.paste(req) · api.onClipChanged(listener)
// preload: file.clip / file.paste / file.onClipChanged (push channel CH.clipChanged carries FileClipState)
```

## State
- Done:
  - [x] Scope pass in chat (2026-09-19): code read, D1–D8 recommended, tree proposed, Yasin approved recommendations → demo first
  - [x] Worktree + Electron binary
  - [x] Prototype built by two agents (backend ∥ client), plus follow-ups: "Open in ▸" flyout (mockup C) and `file.clipState()` catch-up read. Full suite 246 files green, typecheck clean. Uncommitted.
  - [x] Demo: `<scratchpad>/make-demo.mjs` (vault A "YAZ-1674 Copy Paste Files + Right Click Menu", vault B "YAZ-1674 Other Vault (paste across vaults)", profile `profile-YAZ-1674`, two windows) + `run-demo.sh` (HMR dev app). Menu mockups artifact: https://claude.ai/artifact/Y86SiHhTK1ATBEXJwdsyCL
  - [x] Demo approved: "approved, lock it in" (2026-09-20). Decisions D1–D10 + demo walkthrough posted on YAZ-1674; scope findings on YAZ-1694.
  - [x] Subissue tree created (Linear-Simpler): YAZ-1694 (1- scope, Done) · YAZ-1695 (2- backend) → 1696 (2A) · 1697 (2B) · YAZ-1698 (3- menu) · YAZ-1699 (4- GUI) → 1700 (4A) · 1701 (4B) · 1702 (4C) · YAZ-1703 (5- verify) · YAZ-1704 (6- polish) → 1705 (6A) · 1706 (6B) · Futures YAZ-1707 (Finder interop) · YAZ-1708 (carry assets).
  - [x] Execution started 2026-09-20: rebased on main `35204ea`. 2A/2B reviewed + docs → `9e95ba4` (Done). 3/4A/4B/4C reviewed + docs + cleanups (one `build<T>`, shared `countItems`, dropped `'success'` icon, dead notice-stacking CSS, new `fileClipboardHotkey.test.ts`) → `45ef08d` (Done). Full suite 247 files / 4183 tests, typecheck clean.
  - [x] Spot check on the final build found D11 (the open note would not copy) → YAZ-1711 (4B1), approved, `622772c`. Main moved again (YAZ-1679 settings dialog) → rebased; `HotkeysPanel.tsx` is gone, the hotkey rows live in `client/src/settings/hotkeys.ts` now. Commits on main `48e9402`: `cdfedbe` · `710618e` · `622772c`.
  - [x] 6A audit posted on YAZ-1705 (agent pass, my verdicts marked apply/keep).
- Now: [→] 6B apply (agent) → my review of its diff → ledger closeout → commit → push → PR → merge to main. No release.
- Next: delete scratchpad demo + profile + worktree after merge; close YAZ-1703/1704/1706/1674.

## Open Questions
- CONFIRMED (demo, 2026-09-20): the renderer's window listener wins over the macOS Edit-menu roles for ⌘C/⌘X/⌘V — Yasin used the chords throughout the walkthrough.
- CONFIRMED (demo): the tree filled after a folder copy; the client's explicit `refresh()` stays as the contract, the watcher echo is a courtesy.
- UNCONFIRMED: `fs.rename` across two volumes → EXDEV — only simulated in `copy.test.ts`; no second volume on this machine (scenario 39). The message path exists either way.
- D11 consequence accepted: keyboard "take me in" is Enter only; a mouse click on the open note selects.

## Gotchas
- Worktree needs `node_modules/electron/dist` (present after `npm install` this time).
- Four places pin menu labels: `ContextMenu.test.tsx`, `Sidebar.test.tsx` ×2, `desktop/e2e/topics.spec.ts` (e2e is NOT run — text-only update).
- Demo profile/vaults live in the session scratchpad; delete when moving to subissues.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1674`, branch `yaz-1674-copy-paste-menu`.
- Files: `shared/types.ts`, `desktop/src/channels.ts`, `desktop/src/main/{fileClip,fs/copy}.ts`, `desktop/src/main/ipc/fs.ts`, `desktop/src/preload/index.ts`, `client/src/api.ts`, `client/src/sidebar/{menuSections,ContextMenu,Sidebar,HotkeysPanel}.ts(x)`, `client/src/app.css`, their tests.
- Tests: `npx vitest run client/src/sidebar desktop/src/main`; `npm run typecheck`; full: `npx vitest run`.
