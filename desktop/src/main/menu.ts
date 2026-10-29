/**
 * The application menu (B3, GRO-2161). `buildMenuTemplate` is a pure function of its inputs
 * (recents, keyedVaults, isDev, activeKind, handlers) so structure, accelerators and roles unit-test without Electron;
 * `createMenuHandlers` needs only the injected `MenuHost` for the Electron bits (focused
 * window, external links). The `Menu.buildFromTemplate`/`setApplicationMenu` apply layer
 * lives in `main/index.ts`.
 */
import type { MenuItemConstructorOptions } from 'electron'
import { keyedVaults, type AppState, type ClipboardPasteRequest, type FileKind, type KeyedVault, type RecentRoots, type ZoomStep } from '@shared/types'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { appKeyId, keyFor, type HotkeyId, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { keyRow, stepsAside, type HotkeyAside, type KeyScope } from '@shared/keys'
import type { Store } from './store'
import type { WindowManager } from './windows'

/** Help › Yaseen Docs on GitHub: the repo README (origin URL of this repo). */
export const HELP_URL = 'https://github.com/yaseenarshad/yaseen-docs-app#readme'

export interface MenuHandlers {
  copyAs(mode: 'plain' | 'markdown'): void
  pasteAs(mode: ClipboardPasteRequest['mode']): void
  /** File › New… (⌘N, YAZ-3556 D1): the focused window's renderer opens its New… box. */
  newItem(): void
  /** File › Go to Your Place (⌘D, YAZ-3556 D1): the focused window's renderer shows the place of `settings.goTo`. */
  goTo(): void
  /** File › Open Today's Daily Note (YAZ-3607 D11): the focused window's renderer opens today's daily note, made first when today has none. */
  dailyNote(): void
  /** File › New Tab (⌘T, YAZ-2655 D10): the focused window's renderer shows its blank tab and puts the caret in its search bar. */
  newTab(): void
  /** File › New Window (⌘⇧N, D6): the focused window calls `window:duplicate` — a window on its vaults with no tab (YAZ-3343 D35). */
  newWindow(): void
  /** File › New Files Window (⌘⇧W, YAZ-3357 D5, D15): main opens a Files window on the focused window's vaults, flush left of it. */
  newFilesWindow(): void
  /** File › Close Window (no key since YAZ-3357 D15): the focused window's REAL close, so its flush handshake runs. */
  closeWindow(): void
  /** File › Switch Vault… (⌘O, YAZ-1767 D8): the focused window's renderer opens its sidebar vault switcher. */
  switchVault(): void
  /** File › Open Folder… (⌘⇧O): the focused window's renderer runs its pick-folder flow. */
  openFolder(): void
  /** File › Open Recent › item: the focused window's renderer applies the one vault-open rule (YAZ-1914). */
  openRecent(path: string): void
  /** Window › <vault> (⌘1–⌘9, YAZ-2555 D3): raise that vault, or open it, through the one open-recent door. */
  goToVault(path: string, name: string): void
  /** File › Search Vault (⌘K, YAZ-804): the focused window's renderer focuses its sidebar search bar. */
  search(): void
  /** Yaseen Docs › Settings… (⌘,, YAZ-1679): the focused window's renderer opens its settings dialog. */
  settings(): void
  /** File › Close Tab (⌘W, GRO-2232): the focused window's renderer closes its active tab. */
  closeTab(): void
  /** Window › Next Tab (⌃Tab / ⌘⇧], GRO-2232): the focused window's renderer activates the tab to the right. */
  nextTab(): void
  /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[, GRO-2232): the focused window's renderer activates the tab to the left. */
  prevTab(): void
  /** Window › Tab Overview (⌘⇧M, YAZ-2648 D5): the focused window's renderer shows every open tab at once, or goes back to the page. */
  tabOverview(): void
  /** View › Toggle Sidebar: ask only the focused renderer to toggle its window identity. */
  toggleSidebar(): void
  /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0): the renderer routes it to the focused note (YAZ-1710), else the sidebar zoom (YAZ-3389). */
  zoom(step: ZoomStep): void
  openHelp(): void
  /** Yaseen Docs › Check for Updates… (YAZ-2976 D7): one check now; main answers in the window in front with a notice or the "What's new" sheet (S4–S6). */
  checkForUpdates(): void
  /** Help › What's New… (YAZ-2976 D8): the focused window's renderer opens its "What's new" sheet. */
  whatsNew(): void
  /** Help › Keys of This Tab… (YAZ-3564 K11): the focused window's renderer shows the keys of its tab in front. */
  keySheet(): void
  /**
   * File › Export Image… (⌘⇧E, YAZ-3037; Draw's 🔒 YAZ-1775 D10): the focused renderer's visible board exports a
   * picture — a drawing through the engine's export dialog, a diagram through its own renderer.
   */
  exportImage(): void
  /** File › Export Excalidraw Drawing… (⌘⇧S, YAZ-3037; Draw's 🔒 YAZ-1775 D3): the visible drawing writes a standalone `.excalidraw`. */
  exportDrawing(): void
  /** File › Share Link (⌘⇧L, YAZ-3037): the focused renderer opens the Share dialog for its visible board (YAZ-3040). */
  shareLink(): void
  /** View › Canvas Background › a pick (YAZ-3037; Draw's 🔒 YAZ-1775 D10): the focused renderer's visible drawing takes `color`. */
  canvasBackground(color: string): void
}

export interface MenuInputs {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** The vaults that have a number, in number order (YAZ-2555 D3): `menuKeyedVaults`. */
  keyedVaults: readonly KeyedVault[]
  /** Dev builds get View › Toggle Developer Tools. */
  isDev: boolean
  /**
   * The kind of the focused window's ACTIVE TAB, null when it has none (YAZ-3037, YAZ-3028 D10; Draw's
   * 🔒 YAZ-1775 D10). The board items are enabled only on a kind they work for — Export Image… and
   * Share Link on any board, the Excalidraw-only ones on a drawing — because a menu row that silently
   * does nothing is worse than a greyed-out one. `main/index.ts` reads it on every rebuild;
   * `subscribeMenuRebuildOnActiveFile` and the focus hook are what make a rebuild happen.
   */
  activeKind: FileKind | null
  /** What is in front when it is not the tab's file: a drawing open over a note (YAZ-3564 K9). The keys follow it. */
  frontKind?: FileKind | null
  /**
   * The user's key changes (YAZ-3397 D2), straight from `settings.hotkeys`: every changeable item takes its
   * key from `keyFor`, and one with no key now has none. `subscribeMenuRebuild` rebuilds when they change.
   */
  hotkeys: HotkeyOverrides
  /** The App keys' "Let drawings, diagrams and code keep this key" switches (YAZ-3564 K9). Absent = every default. */
  hotkeysAside?: HotkeyAside
  /**
   * A key recorder is listening in some window (YAZ-3397 D6): the menu is built with NO key at all, the
   * roles' own included, so the keys pressed reach the page. On macOS a menu key fires before the page
   * hears it; recording ⌘W must not close the tab, nor ⌘Q quit. Absent = false.
   */
  suspendKeys?: boolean
  /** Settings › Files & Links › Daily notes (YAZ-3607): File › Open Today's Daily Note shows, with its key, only while it is on. Absent = off. */
  dailyNotes?: boolean
}

/**
 * The engine's own canvas-background picks (`DEFAULT_CANVAS_BACKGROUND_PICKS`,
 * `packages/common/src/colors.ts`): white, then radix slate2 / blue2 / yellow2 / bronze2. No
 * "Custom…" row: a colour dialog is not a menu item's job (Draw's 🔒 YAZ-1775 D10).
 */
export const CANVAS_BACKGROUND_PICKS: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'White', color: '#ffffff' },
  { label: 'Slate', color: '#f8f9fa' },
  { label: 'Blue', color: '#f5faff' },
  { label: 'Yellow', color: '#fffce8' },
  { label: 'Bronze', color: '#fdf8f6' },
]

/** File › Export Excalidraw Drawing…'s key. In a review the same key is Skip (YAZ-2322), so the item owns it only while it is enabled. */
export const EXPORT_DRAWING_ACCELERATOR = 'CmdOrCtrl+Shift+S'

/** A label that shows `text` as it is (YAZ-2555): Electron reads a single `&` as a mnemonic mark and drops it — "R&D" would read "RD". */
const menuLabel = (text: string): string => text.replace(/&/g, '&&')

/**
 * The whole menu bar as a template. Item `id`s are stable so a live check (Playwright) can
 * drive items through `Menu.getApplicationMenu().getMenuItemById(...)`.
 */
export function buildMenuTemplate({ recents, keyedVaults, isDev, activeKind, frontKind = activeKind, hotkeys, hotkeysAside, suspendKeys = false, dailyNotes = false }: MenuInputs, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: 'No Recent Folders', enabled: false }]
      : recents.map((r, i) => ({
          id: `menu.file.open-recent.${i}`,
          label: menuLabel(r.path),
          click: () => handlers.openRecent(r.path),
        }))
  const onBoard = activeKind === 'drawing' || activeKind === 'diagram'
  const onDrawing = activeKind === 'drawing'
  /** The place of the tab in front, for the App keys that let it keep its own key (YAZ-3564 K9). */
  const place: KeyScope | null = frontKind === 'drawing' || frontKind === 'diagram' ? frontKind : frontKind === 'text' ? 'code' : null
  /**
   * A changeable item's key (YAZ-3397 D2): the user's, else the default; none at all for "No key", and none while a tab
   * of a place it steps aside in is in front (YAZ-3564 K9), so that place keeps its own key.
   */
  const key = (id: HotkeyId): { accelerator?: string } => {
    const accelerator = keyFor(id, hotkeys)
    const row = keyRow(appKeyId(id))
    if (accelerator === null || (place !== null && row !== undefined && stepsAside(row, place, hotkeysAside))) return {}
    return { accelerator }
  }
  const template: MenuItemConstructorOptions[] = [
    // macOS titles the first menu with the running app's name; the label only matters off-mac.
    {
      label: 'Yaseen Docs',
      submenu: [
        { role: 'about' },
        { id: 'menu.app.check-updates', label: 'Check for Updates…', click: () => handlers.checkForUpdates() },
        { type: 'separator' },
        // ⌘, is the platform's settings key (YAZ-1679); the renderer owns the dialog, so the
        // gesture goes to the focused window's renderer like Search Vault does.
        { id: 'menu.app.settings', label: 'Settings…', ...key('settings'), click: () => handlers.settings() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        // ⌘T is New Tab (YAZ-2655 D10): the renderer owns the tabs, so the gesture goes to the focused window's renderer.
        { id: 'menu.file.new-tab', label: 'New Tab', ...key('newTab'), click: () => handlers.newTab() },
        // ⌘N, right under New Tab, opens the New… box (YAZ-3556 D1): a menu key, so it works with the caret in a note too.
        { id: 'menu.file.new-item', label: 'New…', ...key('newItem'), click: () => handlers.newItem() },
        { id: 'menu.file.new-window', label: 'New Window', ...key('newWindow'), click: () => handlers.newWindow() },
        // ⌘⇧W (YAZ-3357 D15, Yaseen: "can we change the hotkey for this to CMD SHIFT W? and remove whatever the hotkey for that is right now?"): Close Window gave it up.
        { id: 'menu.file.new-files-window', label: 'New Files Window', ...key('newFilesWindow'), click: () => handlers.newFilesWindow() },
        { type: 'separator' },
        // ⌘O opens the sidebar header's vault switcher (YAZ-1767 D8): the renderer owns the panel,
        // so the gesture goes to the focused window's renderer like Search Vault does.
        { id: 'menu.file.switch-vault', label: 'Switch Vault…', ...key('switchVault'), click: () => handlers.switchVault() },
        { id: 'menu.file.open-folder', label: 'Open Folder…', ...key('openFolder'), click: () => handlers.openFolder() },
        { id: 'menu.file.open-recent', label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        // ⌘K focuses the sidebar's search bar (D4, YAZ-739 amended): the renderer owns the bar,
        // so the gesture goes to the focused window's renderer — un-collapsing the sidebar first.
        { id: 'menu.file.search', label: 'Search Vault', ...key('search'), click: () => handlers.search() },
        // ⌘D (YAZ-3556 D1, D9): the place of Settings › Sidebar › Go to. It steps aside on a drawing, a diagram and code (YAZ-3564 K9).
        { id: 'menu.file.go-to', label: 'Go to Your Place', ...key('goTo'), click: () => handlers.goTo() },
        // YAZ-3607 D11: a hidden item keeps no key, so with Daily notes off its key is free for the page.
        { id: 'menu.file.daily-note', label: "Open Today's Daily Note", visible: dailyNotes, ...(dailyNotes ? key('dailyNote') : {}), click: () => handlers.dailyNote() },
        { type: 'separator' },
        // The board items (YAZ-3037, YAZ-3028 D10; Draw's 🔒 YAZ-1775 D3 / D10, YAZ-1799): greyed out unless
        // the active tab is a board they work for. Export Image… and Share Link work on any board, Export
        // Excalidraw Drawing… only on a drawing. ⌘⇧E and ⌘⇧L clash with no in-page key of Docs.
        // A greyed-out item holds no key (YAZ-3564 K13): on macOS a disabled item still takes its key from the page.
        { id: 'menu.file.export-image', label: 'Export Image…', ...(onBoard ? { accelerator: 'CmdOrCtrl+Shift+E' } : {}), enabled: onBoard, click: () => handlers.exportImage() },
        // ⌘⇧S is also the review's Skip (YAZ-2322), and the note keeps its key (D10): a registered
        // accelerator never reaches the page on macOS, so the item carries the key ONLY while it is
        // enabled. On a note tab nothing in the menu owns ⌘⇧S; a review over a drawing tab is App's to route.
        { id: 'menu.file.export-drawing', label: 'Export Excalidraw Drawing…', ...(onDrawing ? { accelerator: EXPORT_DRAWING_ACCELERATOR } : {}), enabled: onDrawing, click: () => handlers.exportDrawing() },
        { id: 'menu.file.share-link', label: 'Share Link', ...(onBoard ? { accelerator: 'CmdOrCtrl+Shift+L' } : {}), enabled: onBoard, click: () => handlers.shareLink() },
        { type: 'separator' },
        // ⌘W is Close Tab (GRO-2232, locked): the renderer owns tab state, so the gesture goes to
        // the focused window's renderer. Close Window has NO key since YAZ-3357 D15 (⌘⇧W opens a Files window), so it
        // is no `role: 'close'` (that role brings ⌘W along): its click is the real close, which windows.ts intercepts for the flush handshake.
        { id: 'menu.file.close-tab', label: 'Close Tab', ...key('closeTab'), click: () => handlers.closeTab() },
        { id: 'menu.file.close-window', label: 'Close Window', ...key('closeWindow'), click: () => handlers.closeWindow() },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, copyAsMenu(handlers.copyAs), { role: 'paste' }, pasteAsMenu(handlers.pasteAs, true), { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        // ⌘⇧B, a menu key since YAZ-3564 D10: it fires in a note too, where ⌘B is Bold. A note's Quote gave the key up.
        { id: 'menu.view.toggle-sidebar', label: 'Toggle Sidebar', ...key('toggleSidebar'), click: () => handlers.toggleSidebar() },
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
        { type: 'separator' },
        // Not the stock zoom roles (YAZ-1710): a registered accelerator never reaches the page on
        // macOS, so main forwards the step and the renderer decides — the focused note or the app.
        { id: 'menu.view.zoom-reset', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => handlers.zoom(0) },
        { id: 'menu.view.zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => handlers.zoom(1) },
        // Electron's own zoomIn role also answers ⌘= (no shift); keep that hidden twin.
        { id: 'menu.view.zoom-in-eq', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => handlers.zoom(1) },
        { id: 'menu.view.zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => handlers.zoom(-1) },
        { type: 'separator' },
        // The engine's canvas-background picks (YAZ-3037; Draw's 🔒 YAZ-1775 D10), greyed out off a drawing
        // tab. The value is per BOARD — the engine writes `viewBackgroundColor` into the file — so it is
        // here and not in Settings › Canvas with the user-level prefs.
        {
          id: 'menu.view.canvas-background',
          label: 'Canvas Background',
          enabled: onDrawing,
          submenu: CANVAS_BACKGROUND_PICKS.map(({ label, color }, i) => ({ id: `menu.view.canvas-background.${i}`, label, click: () => handlers.canvasBackground(color) })),
        },
      ],
    },
    // Top-level role `window` marks this submenu as macOS's Windows menu, so the OS appends the window list.
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        // Tab switching (GRO-2232): the visible pair carries the macOS-conventional ⌃Tab / ⌃⇧Tab;
        // hidden duplicates carry the ⌘⇧] / ⌘⇧[ equivalents (`acceleratorWorksWhenHidden`, macOS).
        { id: 'menu.window.next-tab', label: 'Next Tab', ...key('nextTab'), click: () => handlers.nextTab() },
        { id: 'menu.window.prev-tab', label: 'Previous Tab', ...key('prevTab'), click: () => handlers.prevTab() },
        { id: 'menu.window.next-tab-alt', label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', visible: false, acceleratorWorksWhenHidden: true, click: () => handlers.nextTab() },
        { id: 'menu.window.prev-tab-alt', label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', visible: false, acceleratorWorksWhenHidden: true, click: () => handlers.prevTab() },
        // The tab overview (YAZ-2648 D5): the same key opens it and closes it.
        { id: 'menu.window.tab-overview', label: 'Tab Overview', ...key('tabOverview'), click: () => handlers.tabOverview() },
        { type: 'separator' },
        // The numbered vaults (YAZ-2555 D3): one row each, ⌘<its number>. The MENU owns the key, so
        // it answers from any window, with the caret anywhere, and with every window minimized.
        ...keyedVaults.map((v): MenuItemConstructorOptions => ({
          id: `menu.window.vault.${v.key}`,
          label: menuLabel(v.name),
          accelerator: `CmdOrCtrl+${v.key}`,
          click: () => handlers.goToVault(v.path, v.name),
        })),
        ...(keyedVaults.length === 0 ? [] : [{ type: 'separator' } satisfies MenuItemConstructorOptions]),
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { id: 'menu.help.key-sheet', label: 'Keys of This Tab…', ...key('keySheet'), click: () => handlers.keySheet() },
        { id: 'menu.help.whats-new', label: "What's New…", click: () => handlers.whatsNew() },
        { id: 'menu.help.github', label: 'Yaseen Docs on GitHub', click: () => handlers.openHelp() },
      ],
    },
  ]
  return suspendKeys ? withoutKeys(template) : template
}

/**
 * The menu with no key (YAZ-3397 D6), for while a recorder listens. An item's own key goes; a ROLE's goes
 * too — Electron gives a role its default key (⌘Q, ⌘C…) whenever `accelerator` is absent, so it gets an
 * empty one, which Electron reads as none. Everything else — labels, clicks, enabled — is as it was.
 */
export function withoutKeys(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.map((item) => {
    const { accelerator: _key, submenu, ...rest } = item
    const out: MenuItemConstructorOptions = { ...rest, ...(item.role !== undefined && item.type !== 'separator' ? { accelerator: '' } : {}) }
    if (Array.isArray(submenu)) out.submenu = withoutKeys(submenu)
    else if (submenu !== undefined) out.submenu = submenu
    return out
  })
}

function copyAsMenu(copyAs: MenuHandlers['copyAs']): MenuItemConstructorOptions {
  return {
    label: 'Copy as',
    submenu: [
      { id: 'menu.edit.copy-plain', label: 'Plain text', click: () => copyAs('plain') },
      { id: 'menu.edit.copy-markdown', label: 'Markdown', click: () => copyAs('markdown') },
    ],
  }
}

function pasteAsMenu(pasteAs: MenuHandlers['pasteAs'], accelerator = false): MenuItemConstructorOptions {
  return {
    label: 'Paste as',
    submenu: [
      { id: 'menu.edit.paste-plain', label: 'Plain text', ...(accelerator ? { accelerator: 'CmdOrCtrl+Shift+V' } : {}), click: () => pasteAs('plain') },
      { id: 'menu.edit.paste-markdown', label: 'Markdown', click: () => pasteAs('markdown') },
    ],
  }
}

export interface ContextMenuActions {
  copyAs(mode: 'plain' | 'markdown'): void
  pasteAs(mode: ClipboardPasteRequest['mode']): void
  /** Swap the misspelled word under the cursor for the suggestion the user picked. */
  replace(word: string): void
  /** Teach the spellchecker a word it flagged, for good. */
  addToDictionary(word: string): void
  /** Copy the right-clicked image's pixels to the clipboard (YAZ-1666). */
  copyImage(): void
  /** Reveal the right-clicked image's file in Finder (YAZ-1666); `srcURL` is the `<img src>` as loaded. */
  revealImage(srcURL: string): void
}

/**
 * The right-click menu (YAZ-672). Electron ships no default one, so the spellchecker's squiggles
 * had nothing to act on. Pure like `buildMenuTemplate`; the `context-menu` event and the
 * `Menu.buildFromTemplate(...).popup()` apply layer live in `main/index.ts`.
 *
 * An IMAGE under the cursor (YAZ-1666, images-as-first-class-citizens YAZ-1656 D7) gets its
 * own two-row menu INSTEAD of the text one: cut/copy/paste act on a selection an image does
 * not have, and the spellchecker has nothing to say about pixels. Exactly two rows — a "Copy
 * Image Address" would hand out an `app://vault` URL that means nothing outside the app, and
 * "Copy Markdown" is the editor's job. Chromium reports `mediaType: 'image'` only for an
 * element laid out as an image (`<img>`, `<input type=image>`, SVG `<image>`), never for an
 * inline `<svg>` or a CSS background — so the sidebar's icons keep the text menu, and the rows
 * appear on the editor's images, the lightbox and card covers alike. Reveal receives the
 * `<img src>` verbatim; `vaultProtocol.ts` decides whether it names a vault file.
 */
export function buildContextMenuTemplate(
  params: Pick<Electron.ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions' | 'editFlags' | 'mediaType' | 'srcURL'>,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  if (params.mediaType === 'image') {
    return [
      { label: 'Copy Image', click: () => actions.copyImage() },
      { label: 'Reveal in Finder', click: () => actions.revealImage(params.srcURL) },
    ]
  }
  const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((s) => ({ label: s, click: () => actions.replace(s) }))
  const dictionary: MenuItemConstructorOptions[] =
    params.misspelledWord === ''
      ? []
      : [
          ...(suggestions.length === 0 ? [] : [{ type: 'separator' } satisfies MenuItemConstructorOptions]),
          { label: 'Add to Dictionary', click: () => actions.addToDictionary(params.misspelledWord) },
          { type: 'separator' },
        ]
  return [
    ...suggestions,
    ...dictionary,
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { ...copyAsMenu(actions.copyAs), enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { ...pasteAsMenu(actions.pasteAs), enabled: params.editFlags.canPaste },
  ]
}

/**
 * The window a menu action targets (GRO-2197): the OS-focused one when there is one, else the
 * most recently focused LIVE window, else any live window, else undefined. WHY a fallback at
 * all: macOS reports NO focused window while the app is not frontmost — `getFocusedWindow()`
 * returns null even with a sole visible, unminimized window, and `win.focus()` cannot change
 * that (macOS refuses to activate a background app) — and a menu item that silently does
 * nothing is the worst possible answer. Electron-free and structural on purpose so
 * `menu.test.ts` fakes windows in a few lines; generic so `index.ts` gets `BrowserWindow`
 * back out. `lastFocusedId` is a `webContents.id` (tracked via `browser-window-focus`).
 */
export function pickMenuTargetWindow<W extends { webContents: { id: number }; isDestroyed(): boolean }>(
  focused: W | null,
  all: readonly W[],
  lastFocusedId: number | undefined,
): W | undefined {
  if (focused !== null && !focused.isDestroyed()) return focused
  const live = all.filter((w) => !w.isDestroyed())
  return live.find((w) => w.webContents.id === lastFocusedId) ?? live[0]
}

/** The Electron-only half, injected by `main/index.ts` (like windows.ts's `WindowHost`). */
export interface MenuHost {
  /**
   * The webContents a menu action targets. The fallback IS the contract (GRO-2197): the
   * OS-focused window's when there is one, else the most recently focused live window's, else
   * any live window's — undefined ONLY when no window exists at all. `index.ts` implements
   * this through `pickMenuTargetWindow` (see its comment for why macOS forces the fallback).
   */
  focusedWebContents(): { id: number; send(channel: string, ...args: unknown[]): void } | undefined
  readClipboardText(): string
  openExternal(url: string): void
  /** Check for Updates… (YAZ-2976): `index.ts` runs the check and answers for each state (S4–S6). */
  checkForUpdates(): void
}

type MenuWindows = Pick<WindowManager, 'openRecentBeside' | 'linkNotice' | 'idFor' | 'openFilesWindow' | 'closeWindow'>

export function createMenuHandlers(windows: MenuWindows, host: MenuHost): MenuHandlers {
  return {
    copyAs(mode) {
      host.focusedWebContents()?.send(SPECIAL.menuCopyAs, mode)
    },
    pasteAs(mode) {
      const target = host.focusedWebContents()
      if (target !== undefined) target.send(SPECIAL.menuPasteAs, { mode, text: host.readClipboardText() } satisfies ClipboardPasteRequest)
    },
    newItem() {
      host.focusedWebContents()?.send(CONTRACT.menu.onNewItem.channel)
    },
    goTo() {
      host.focusedWebContents()?.send(CONTRACT.menu.onGoTo.channel)
    },
    dailyNote() {
      host.focusedWebContents()?.send(CONTRACT.menu.onDailyNote.channel)
    },
    newWindow() {
      // Through the focused window, which calls `window:duplicate` (YAZ-3343 D35): main names the caller from the
      // sender. A window whose page does not answer opens nothing (YAZ-2951 S14).
      host.focusedWebContents()?.send(CONTRACT.menu.onNewWindow.channel)
    },
    newFilesWindow() {
      // Straight to main (YAZ-3357 D5): the focused window is only the source of the vaults and the place. With
      // none, or the Welcome window, there is no vault to show, and the window in front says so.
      const target = host.focusedWebContents()
      if (!windows.openFilesWindow(target === undefined ? undefined : windows.idFor(target), null)) windows.linkNotice('Open a vault first: a Files window shows the vaults of a window')
    },
    closeWindow() {
      const target = host.focusedWebContents()
      const id = target === undefined ? undefined : windows.idFor(target)
      if (id !== undefined) windows.closeWindow(id)
    },
    switchVault() {
      host.focusedWebContents()?.send(CONTRACT.menu.onSwitchVault.channel)
    },
    openFolder() {
      host.focusedWebContents()?.send(CONTRACT.menu.onOpenFolder.channel)
    },
    openRecent(path) {
      // The renderer owns the vault-open rule (YAZ-1914): Welcome switches in place, a vault window asks main's door (an empty one takes the vault, YAZ-3487 D1).
      host.focusedWebContents()?.send(CONTRACT.menu.onOpenRoot.channel, path)
    },
    goToVault(path, name) {
      // Straight to the door in main, never through the focused renderer (YAZ-2555 A5): with every window minimized no
      // renderer is in front. An EMPTY window in front — a Welcome window too — takes the vault itself (YAZ-3487 D1, D2).
      // A folder that is gone says so in a window; a key that does nothing is the worst answer.
      // The door pruned it from the recents; its number stays (A3).
      const focused = host.focusedWebContents()
      if (!windows.openRecentBeside(path, focused === undefined ? undefined : windows.idFor(focused))) windows.linkNotice(`Can't open ${name}: folder not found`)
    },
    search() {
      host.focusedWebContents()?.send(CONTRACT.menu.onSearch.channel)
    },
    settings() {
      host.focusedWebContents()?.send(CONTRACT.menu.onSettings.channel)
    },
    closeTab() {
      host.focusedWebContents()?.send(CONTRACT.menu.onCloseTab.channel)
    },
    nextTab() {
      host.focusedWebContents()?.send(CONTRACT.menu.onNextTab.channel)
    },
    prevTab() {
      host.focusedWebContents()?.send(CONTRACT.menu.onPrevTab.channel)
    },
    tabOverview() {
      host.focusedWebContents()?.send(CONTRACT.menu.onTabOverview.channel)
    },
    newTab() {
      host.focusedWebContents()?.send(CONTRACT.menu.onNewTab.channel)
    },
    toggleSidebar() {
      host.focusedWebContents()?.send(CONTRACT.menu.onToggleSidebar.channel)
    },
    zoom(step) {
      host.focusedWebContents()?.send(CONTRACT.menu.onZoom.channel, step)
    },
    openHelp() {
      host.openExternal(HELP_URL)
    },
    checkForUpdates() {
      host.checkForUpdates()
    },
    whatsNew() {
      host.focusedWebContents()?.send(CONTRACT.menu.onWhatsNew.channel)
    },
    keySheet() {
      host.focusedWebContents()?.send(CONTRACT.menu.onKeySheet.channel)
    },
    exportImage() {
      host.focusedWebContents()?.send(CONTRACT.menu.onExportImage.channel)
    },
    exportDrawing() {
      host.focusedWebContents()?.send(CONTRACT.menu.onExportDrawing.channel)
    },
    shareLink() {
      host.focusedWebContents()?.send(CONTRACT.menu.onShareLink.channel)
    },
    canvasBackground(color) {
      host.focusedWebContents()?.send(CONTRACT.menu.onCanvasBackground.channel, color)
    },
  }
}

/** The Window menu's vault rows (YAZ-2555 D3): every vault with a number, in number order, by display name else folder name — the shared `keyedVaults` (YAZ-2556). */
export function menuKeyedVaults(state: AppState): KeyedVault[] {
  return keyedVaults(state.folders)
}

/**
 * Rebuild only when `recents` or the vault rows actually changed: store snapshots reuse untouched
 * sub-objects, so reference identity of `state.recents` and `state.folders` skips every
 * settings/window write for free. `state.folders` is a new object on every folder write (a fold, a
 * last file), so the rows (YAZ-2555 D3) compare by value: one pass over the folders per FOLDER write.
 * The user's keys (YAZ-3397 D2) too: `settings.hotkeys` by reference, then by value. And the Daily notes switch (YAZ-3607).
 */
export function subscribeMenuRebuild(store: Store, rebuild: () => void): () => void {
  let last = store.get().recents
  let lastFolders = store.get().folders
  let lastVaults = JSON.stringify(menuKeyedVaults(store.get()))
  let lastHotkeys = store.get().settings.hotkeys
  let lastAside = store.get().settings.hotkeysAside
  let lastKeys = JSON.stringify([lastHotkeys, lastAside])
  let lastDaily = store.get().settings.dailyNotes
  return store.onChange((state) => {
    const vaults = state.folders === lastFolders ? lastVaults : JSON.stringify(menuKeyedVaults(state))
    lastFolders = state.folders
    // The key changes (YAZ-3397 D2): by reference first, then by value — a settings write from a renderer
    // arrives as a new object even when no key moved, and a theme change must not rebuild the menu.
    // The step-aside switches (YAZ-3564 K9) change an item's key too.
    const keys = state.settings.hotkeys === lastHotkeys && state.settings.hotkeysAside === lastAside ? lastKeys : JSON.stringify([state.settings.hotkeys, state.settings.hotkeysAside])
    lastHotkeys = state.settings.hotkeys
    lastAside = state.settings.hotkeysAside
    // The Daily notes switch (YAZ-3607) shows or hides File › Open Today's Daily Note.
    if (state.recents === last && vaults === lastVaults && keys === lastKeys && state.settings.dailyNotes === lastDaily) return
    last = state.recents
    lastVaults = vaults
    lastKeys = keys
    lastDaily = state.settings.dailyNotes
    rebuild()
  })
}

/**
 * The menu's apply step, twice (YAZ-3044 A32): `apply` always rebuilds (a recents change, the first
 * build); `applyIfMoved` rebuilds only when the board items' answer moves — the file in front of the
 * asked window going between a drawing, a diagram, code and anything else. A focus change or a tab switch
 * from note to note then costs one `fileKind`, not a whole new menu.
 */
export function gateOnBoardKind(kindNow: () => FileKind | null, apply: () => void, frontNow: () => FileKind | null = kindNow): { apply: () => void; applyIfMoved: () => void } {
  // A code tab is a bucket of its own (YAZ-3556): the App keys that step aside in code (YAZ-3564 K9) change with it.
  const of = (kind: FileKind | null): 'drawing' | 'diagram' | 'code' | 'other' => (kind === 'drawing' || kind === 'diagram' ? kind : kind === 'text' ? 'code' : 'other')
  // The tab's kind gates the board items; what is in front (a drawing over a note, YAZ-3564 K9) gates the keys.
  const bucket = (): string => `${of(kindNow())}|${of(frontNow())}`
  let last: ReturnType<typeof bucket> | null = null
  const always = (): void => {
    last = bucket()
    apply()
  }
  return { apply: always, applyIfMoved: () => (bucket() === last ? undefined : always()) }
}

/** The one fact the board items are gated on: which file each window has in front. */
const activeFilesKey = (state: Pick<AppState, 'windows'>): string => state.windows.map((w) => `${w.id}=${w.file ?? ''}`).join('\n')

/**
 * Rebuild when any window's ACTIVE FILE changes (YAZ-3037; Draw's 🔒 YAZ-1775 D10): the board items are
 * enabled only while the focused window's active tab is a board of their kind, so a tab switch has to
 * re-evaluate them. A second subscription rather than a widening of `subscribeMenuRebuild`, so the
 * recents rule and its test stay as they were. Focus changes are the host's to report
 * (`browser-window-focus` in `main/index.ts`): they move which window is asked, not what the store says.
 */
export function subscribeMenuRebuildOnActiveFile(store: Store, rebuild: () => void): () => void {
  let last = activeFilesKey(store.get())
  return store.onChange((state) => {
    const next = activeFilesKey(state)
    if (next === last) return
    last = next
    rebuild()
  })
}
