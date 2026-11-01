import {
  DEFAULT_SIDEBAR_LENS,
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  addRecentRoot,
  applyTabCanvasPatch,
  sameTabCanvas,
  cleanVaultName,
  defaultAppState,
  defaultFolderState,
  defaultRightPanelIdentity,
  defaultTabCanvas,
  freeVaultKey,
  keyedVaults,
  listVaults,
  mergeFavoritesOrder,
  normalizeFilesZoom,
  normalizeRoots,
  rootOfPath,
  type AppState,
  type FolderState,
  type KeyedVault,
  type OpenStat,
  type RecentRoots,
  type RightPanelIdentity,
  type SettingsState,
  type SidebarLens,
  type StartView,
  type StoredTab,
  type TabCanvasPatch,
  type TabCanvasState,
  type TocSource,
  type VaultEntry,
  type Session,
  type VaultSet,
  type WindowEntry,
  type WindowIdentity,
} from '@shared/types'
import { api } from '../api'
import { basename } from './paths'

/**
 * The renderer's view of the app state (D9, GRO-2159): an in-memory cache of the main-owned
 * `yaseendocs.json` plus this window's identity. `init()` loads both over the bridge and
 * subscribes to `state.onChange`, so a change made in any window replaces the cache here and
 * wakes `subscribe` listeners. Reads are synchronous off the cache; writes update the cache at
 * once (optimistic) and send the targeted mutator over the bridge, fire-and-forget.
 */

let state: AppState = defaultAppState()
let identity: WindowIdentity = { id: '', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: DEFAULT_SIDEBAR_LENS }
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()
/** The other windows as `getOtherWindows` last answered them, and what they were read off. */
let others: { windows: readonly WindowEntry[]; id: string; list: readonly WindowEntry[] } = { windows: [], id: '', list: [] }
/** The canvas of a state without one (a main of before YAZ-3343, a test's bridge): ONE object, so a `useSyncExternalStore` snapshot holds still. */
const NO_TAB_CANVAS: TabCanvasState = defaultTabCanvas()

/**
 * The two orders across vaults, each with its mutator on the bridge: the Favorites order (YAZ-2631
 * D1) and the focus order (YAZ-2702 Decision 3). One rule and one merge (`mergeFavoritesOrder`) for the two.
 */
const ORDER_SETTERS = { favoritesOrder: 'setFavoritesOrder', focusOrder: 'setFocusOrder' } as const
type OrderKey = keyof typeof ORDER_SETTERS
const ORDER_KEYS = Object.keys(ORDER_SETTERS) as OrderKey[]

/**
 * What this window hands in for the vaults `roots`, into one of the two orders. The cache merges it
 * as main does (`mergeFavoritesOrder`, YAZ-2631 R5) and wakes `subscribe` at once, so the list never
 * shows the old order while main answers; main's broadcast of the same order then changes nothing.
 */
function setOrder(key: OrderKey, roots: readonly string[], paths: readonly string[]): void {
  const setter = ORDER_SETTERS[key]
  const next = mergeFavoritesOrder(state[key], roots, paths)
  const moved = next !== state[key]
  state = { ...state, [key]: next }
  send(`state.${setter}`, () => api.state[setter](roots, paths))
  if (moved) listeners.forEach((l) => l())
}

/**
 * Issues one bridge call at once without awaiting it; a rejection is logged, never thrown. The
 * try/catch is load-bearing: with no bridge (views mounted without one, as the view tests do)
 * building the call throws synchronously instead of rejecting.
 */
function send(what: string, call: () => Promise<void>): void {
  const log = (err: unknown) => console.error(`[storage] ${what} failed:`, err)
  try {
    call().catch(log)
  } catch (err) {
    log(err)
  }
}

function folderOf(root: string): FolderState {
  return state.folders[root] ?? defaultFolderState()
}

function patchFolder(root: string, patch: Partial<FolderState>): void {
  state = { ...state, folders: { ...state.folders, [root]: { ...folderOf(root), ...patch } } }
}

export const storage = {
  /** Load the state + identity and start following changes; call once before the first render. */
  async init(): Promise<void> {
    const [s, id] = await Promise.all([api.state.get(), api.window.identity()])
    state = s
    identity = id
    unsubscribe?.()
    unsubscribe = api.state.onChange((next) => {
      // Each broadcast is a new copy. The Favorites order and the focus order each keep their identity
      // while they hold the same paths (YAZ-2631 D1, YAZ-2702 Decision 3): each is a
      // `useSyncExternalStore` snapshot, so what reads it draws again only when the order changed.
      const held = state
      state = next
      for (const key of ORDER_KEYS) {
        if (held[key].length === next[key].length && held[key].every((path, at) => path === next[key][at])) state = { ...state, [key]: held[key] }
      }
      // The sessions too (YAZ-3147 D6): a tab click writes the window and broadcasts, and the open
      // Sessions tab must not draw again for it. 30 sessions of 40 tabs at most, so the compare stays small.
      if (JSON.stringify(held.sessions) === JSON.stringify(next.sessions)) state = { ...state, sessions: held.sessions }
      // And the tab board's canvas (YAZ-3343 D1): the board reads it as a snapshot, and most broadcasts are not about it.
      if (held.tabCanvas !== undefined && next.tabCanvas !== undefined && sameTabCanvas(held.tabCanvas, next.tabCanvas)) state = { ...state, tabCanvas: held.tabCanvas }
      listeners.forEach((l) => l())
    })
  },

  /** Called after a change made in ANY window landed in the cache — never for this window's own optimistic writes, but the two orders across vaults (`setFavoritesOrder`, `setFocusOrder`) and the tab board's canvas and window names (`setTabCanvas`, `setWindowName`). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getRoot: (): string | null => identity.root,
  /**
   * Changing the root clears this window's file AND tab list (Tabs rule 13, GRO-2234) and lands the
   * lens on Files (🔒 D2, YAZ-1846), in the same write; re-setting the same root keeps them. The
   * focus list is not here to clear (YAZ-2702 Decision 1): it is the vault's, in the vault, so it
   * is there again when the window comes back to the vault (S8).
   */
  setRoot(root: string | null): void {
    const patch = root === identity.root
      ? { root }
      : { root, file: null, tabs: [] as string[], rightPanel: defaultRightPanelIdentity(), sidebarLens: DEFAULT_SIDEBAR_LENS }
    // The window is on that ONE vault (YAZ-2602 S61). The patch names `root` alone: main makes the list from it (S76).
    identity = { ...identity, ...patch, ...(root === identity.root ? {} : { roots: normalizeRoots([], root) }) }
    send('window.setIdentity', () => api.window.setIdentity(patch))
  },

  /** Every vault this window shows, `root` first (YAZ-2602 D1). */
  getRoots: (): string[] => identity.roots,
  /**
   * Add or remove a vault (YAZ-2602 D2, D7). Unlike `setRoot`, this keeps the tabs and the lens:
   * the caller closes a removed vault's tabs first. `root` follows `roots[0]`. A vault that leaves
   * takes its rows off the Focus tab and keeps its focus list, which is in the vault (YAZ-2702 S9).
   */
  setRoots(roots: readonly string[]): void {
    const next = normalizeRoots(roots, roots[0] ?? null)
    identity = { ...identity, roots: next, root: next[0] ?? null }
    send('window.setIdentity', () => api.window.setIdentity({ roots: next }))
  },
  /** Main's store already moved a renamed vault folder (`store.renamePath`): mirror it in the cache, with no identity write. */
  mirrorRoots(roots: readonly string[]): void {
    identity = { ...identity, root: roots[0] ?? null, roots: [...roots] }
  },

  getRecentRoots: (): RecentRoots => state.recents,
  /** Every vault the app knows, as the ⌘O panel lists it (YAZ-2556 D2): the shared `listVaults` over the cache — what `yaseendocs vaults` prints from the state file. */
  listVaults: (): VaultEntry[] => listVaults(state),
  /**
   * The saved sets of vaults (YAZ-2602 D8; the user reads "workspaces"), last used first. Read-only
   * here: main saves, renames and removes one through its own doors (`api.window.saveSet` and its
   * neighbours), and the cache follows the broadcast.
   */
  getVaultSets: (): VaultSet[] => state.vaultSets,
  /**
   * The saved sessions (YAZ-3147 D2), last used first. Read-only here, like `getVaultSets`: main saves,
   * renames, changes and deletes one through its own doors (`api.window.saveSession` and its neighbours),
   * and the cache follows the broadcast. The same array until a change, so a `useSyncExternalStore` reader
   * renders again only when the sessions change.
   */
  getSessions: (): Session[] => state.sessions,
  /**
   * The app's other windows (YAZ-3091 D2), off the cache: a tab's "Move to ▸" lists the ones that show its
   * page's vault. Read only while a tab menu is open, never a render trigger; main checks the target again.
   */
  getOtherWindows: (): readonly WindowEntry[] => {
    // The same array while the windows are the same (YAZ-3343 D2): the tab board reads it as a snapshot. A Files window is
    // never one of them (YAZ-3357 D2): no "Move to ▸" row, no frame on a board, no Kill all.
    if (others.windows !== state.windows || others.id !== identity.id) others = { windows: state.windows, id: identity.id, list: state.windows.filter((w) => w.id !== identity.id && w.kind !== 'files') }
    return others.list
  },
  /** This window's id (`WindowEntry.id`), from the identity `init()` loaded: the tab board keys its stored places by it (YAZ-3343 D1). */
  getWindowId: (): string => identity.id,
  /** This window is a Files window (YAZ-3357 D1): only the sidebar, no tabs. Fixed for the window's life, so a render may read it. */
  isFilesWindow: (): boolean => identity.kind === 'files',
  /**
   * A Files window's own sidebar zoom in percent (YAZ-3389 D13), from its identity; a full window has none and reads
   * the shared `settings.sidebarZoom` instead. Only this window writes it (`setFilesZoom`), so the cache stays true.
   */
  getFilesZoom: (): number => normalizeFilesZoom(identity.zoom),
  /** Step this Files window's own sidebar zoom (D13): the cache at once, then main (`window:files-zoom`) stores it. */
  setFilesZoom(percent: number): void {
    identity = { ...identity, zoom: percent }
    send('window.filesZoom', () => api.window.filesZoom(percent))
  },
  /** This Files window's zoom menu opened or closed (YAZ-3444): main holds this window's resize for a new App size until the close. */
  setFilesZoomMenu(open: boolean): void {
    send('window.filesZoomMenu', () => api.window.filesZoomMenu(open))
  },

  /**
   * A window's name (YAZ-3343 D14), off the cache; this window's when `id` is left out. `undefined` = no name:
   * the window has its automatic label. Main keeps it (`WindowEntry.name`), so every window reads every name.
   */
  windowName: (id: string = identity.id): string | undefined => state.windows.find((w) => w.id === id)?.name,
  /**
   * Name an open window, this one or another (D14), or with null (or a blank name) give it back its automatic label.
   * The cache takes the name cleaned as main cleans it, at once; main checks that the window is open.
   */
  setWindowName(id: string, raw: string | null): void {
    const name = cleanVaultName(raw)
    const was = state.windows.find((w) => w.id === id)
    const changed = was !== undefined && (was.name ?? null) !== name
    if (changed) {
      state = {
        ...state,
        windows: state.windows.map((w) => {
          if (w.id !== id) return w
          const { name: _old, ...rest } = w
          return name === null ? rest : { ...rest, name }
        }),
      }
    }
    send('window.setName', () => api.window.setName(id, name))
    // The board shows a new name at once, as it shows its own moves (YAZ-3343 D14).
    if (changed) listeners.forEach((l) => l())
  },

  /**
   * The tab board's canvas (YAZ-3343 D1): the "Show all windows" switch and the cards the user moved, last moved
   * first. App-wide and per machine. The same object until a change: a `useSyncExternalStore` snapshot.
   */
  getTabCanvas: (): TabCanvasState => state.tabCanvas ?? NO_TAB_CANVAS,
  /**
   * One change to the canvas (D1): on a drop, a switch or "Tidy up", never on each pointer move. The cache applies
   * it by main's own rule (`applyTabCanvasPatch`) at once; a patch that changes nothing sends nothing.
   */
  setTabCanvas(patch: TabCanvasPatch): void {
    const current = state.tabCanvas ?? NO_TAB_CANVAS
    const next = applyTabCanvasPatch(current, patch, new Set(state.windows.map((w) => w.id)))
    if (next === current) return
    state = { ...state, tabCanvas: next }
    send('state.setTabCanvas', () => api.state.setTabCanvas(patch))
    // The board renders its own moves at once, as the two orders do (`setOrder`).
    listeners.forEach((l) => l())
  },
  pushRecentRoot(path: string, now = Date.now()): RecentRoots {
    const next = addRecentRoot(state.recents, path, now)
    state = { ...state, recents: next }
    send('state.pushRecent', () => api.state.pushRecent(path))
    return next
  },

  /** Drop a dead folder from the MRU (its directory vanished on disk, C2 — GRO-2164). */
  removeRecentRoot(path: string): void {
    state = { ...state, recents: state.recents.filter((r) => r.path !== path) }
    send('state.removeRecent', () => api.state.removeRecent(path))
  },

  /** What the app calls a vault (YAZ-1974 D4): its display name, else its folder name. */
  vaultName: (root: string): string => folderOf(root).name ?? basename(root),
  /** Set (or, with null / empty / the folder's own name, clear) a vault's display name (D3, D5). */
  setVaultName(root: string, raw: string | null): void {
    const clean = cleanVaultName(raw)
    const name = clean === basename(root) ? null : clean
    patchFolder(root, { name })
    send('state.setFolder', () => api.state.setFolder(root, { name }))
  },

  /** A vault's number, 1–9, or null (YAZ-2555 D2): ⌘<key> goes to it. */
  vaultKey: (root: string): number | null => folderOf(root).key,
  /** Every vault that has a number, in number order, by what the app calls it — who holds which key. */
  keyedVaults: (): KeyedVault[] => keyedVaults(state.folders),
  /**
   * Give a vault its number, or with null take it away (D2). One vault per number: the cache takes
   * it from the vault that had it at once, as the store does in its own commit.
   */
  setVaultKey(root: string, key: number | null): void {
    if (key !== null) state = { ...state, folders: freeVaultKey(state.folders, key) }
    patchFolder(root, { key })
    send('state.setFolder', () => api.state.setFolder(root, { key }))
  },

  getExpanded: (root: string): string[] => folderOf(root).expanded,
  setExpanded(root: string, dirs: string[]): void {
    patchFolder(root, { expanded: dirs })
    send('state.setFolder', () => api.state.setFolder(root, { expanded: dirs }))
  },

  /** The window identity records what is open now: THIS window's restored file, not the folder's shared lastFile (GRO-2160). */
  getFile: (): string | null => identity.file,

  /** Valid AT BOOT only (like `getFile`): the renderer owns tab state after boot (Tabs I2, GRO-2234). */
  getTabs: (): string[] => identity.tabs,
  /**
   * This window was opened EMPTY on purpose (YAZ-3343 D22, D35): the tab board's "New window", or ⌘⇧N. Main says so
   * in its first identity; it boots on the blank tab with the caret in the search (every window boots with no tab
   * of its own now, YAZ-3487 D7; this flag is what puts the caret there).
   */
  isEmptyByChoice: (): boolean => identity.file === null && identity.startEmpty === true,
  /** A NEW window (⌘⇧N, the board's "New window", a new Files window — YAZ-3487): its Files tree starts with every folder closed. */
  isCollapsedStart: (): boolean => identity.startCollapsed === true,
  /**
   * The tabs with their copies, display names and active copy (YAZ-3057): boot only, like `getTabs`.
   * A window that stores no strip gives its plain `tabs`, one entry per path.
   */
  getTabStrip: (): StoredTab[] => identity.tabStrip?.map((t) => ({ ...t })) ?? identity.tabs.map((path) => ({ path })),

  /** Durable right-panel identity at boot; clone the ordered list so callers cannot mutate the cache. */
  getRightPanel: (): RightPanelIdentity => ({ ...identity.rightPanel, items: [...identity.rightPanel.items] }),

  /** The folder's remembered file: still WRITTEN (`setWorkspace`), no longer read to open a vault (YAZ-3487 D7). The tests read the write through it. */
  getLastFile: (root: string): string | null => folderOf(root).lastFile,

  /** A vault's open history (YAZ-2663 D1): page → how much it is used, and when it was last on show. Read-only here: main alone adds a use, and the cache follows the broadcast. */
  getOpens: (root: string): Readonly<Record<string, OpenStat>> => folderOf(root).opens,

  /** A vault's closed notes (YAZ-3487 D9): file → when it closed. Read-only here: main alone adds one, and the cache follows the broadcast. */
  getClosed: (root: string): Readonly<Record<string, number>> => folderOf(root).closed,
  /** Tabs closed in this window (YAZ-3487 D10): main puts their notes in "Recently closed". */
  noteClosed(files: readonly string[]): void {
    send('window.noteClosed', () => api.window.noteClosed([...files]))
  },
  /** "Remove from Recently closed" / "Clear Recently closed" (YAZ-3487 D14): these notes, or with null all of this window's vaults. */
  forgetClosed(files: readonly string[] | null): void {
    send('window.forgetClosed', () => api.window.forgetClosed(files === null ? null : [...files]))
  },

  /** A vault's save log (YAZ-3235 D1): file → when the app last saved it. Read-only here: main alone adds a save, and the cache follows the broadcast. */
  getEdits: (root: string): Readonly<Record<string, number>> => folderOf(root).edits,

  /** One durable mirror for the complete main/right workspace identity. */
  setWorkspace(root: string | null, strip: readonly StoredTab[], file: string | null, rightPanel: RightPanelIdentity): void {
    // `tabs` is the strip's paths, each once (GRO-2232); the strip keeps the copies and names (YAZ-3057).
    const tabs = [...new Set(strip.map((t) => t.path))]
    const fileChanged = file !== identity.file
    const nextRight = { ...rightPanel, items: [...rightPanel.items] }
    identity = { ...identity, file, tabs, tabStrip: strip.map((t) => ({ ...t })), rightPanel: nextRight }
    // The file is the last one of the vault that HOLDS it (YAZ-2602): `root`, unless another vault of the window does.
    const home = file === null ? root : (rootOfPath(identity.roots, file) ?? root)
    if (home !== null && fileChanged) {
      patchFolder(home, { lastFile: file })
      send('state.setFolder', () => api.state.setFolder(home, { lastFile: file }))
    }
    send('window.setIdentity', () => api.window.setIdentity({
      tabs: [...tabs],
      tabStrip: strip.map((t) => ({ ...t })),
      file,
      rightPanel: { ...nextRight, items: [...nextRight.items] },
    }))
  },

  /** Already validated field-by-field by the main process on load (`desktop/src/main/store.ts`). */
  getSettings: (): SettingsState => state.settings,
  setSettings(settings: SettingsState): void {
    state = { ...state, settings }
    send('state.setSettings', () => api.state.setSettings(settings))
  },

  /** Sidebar visibility is window identity; global state broadcasts cannot change another window. */
  getSidebarCollapsed: (): boolean => identity.sidebarCollapsed,
  setSidebarCollapsed(collapsed: boolean): void {
    identity = { ...identity, sidebarCollapsed: collapsed }
    send('window.setIdentity', () => api.window.setIdentity({ sidebarCollapsed: collapsed }))
  },

  /** Already clamped to [SIDEBAR_MIN_W, SIDEBAR_MAX_W] by the main process on load and on write. */
  getSidebarWidth: (): number => state.sidebarWidth,
  setSidebarWidth(width: number): void {
    state = { ...state, sidebarWidth: width }
    send('state.setSidebarWidth', () => api.state.setSidebarWidth(width))
  },

  /**
   * The Favorites order across vaults (YAZ-2631 D1): app-wide, so every window follows it. The list
   * is the cache's own, the same one until the order changes: a `useSyncExternalStore` snapshot.
   */
  getFavoritesOrder: (): string[] => state.favoritesOrder,
  /**
   * What this window hands in for the vaults `roots`: after a drag, its favorites in the new order;
   * after a remove, the stored order without the removed paths (YAZ-2631 R23). Merged and shown at once (`setOrder`).
   */
  setFavoritesOrder: (roots: readonly string[], paths: readonly string[]): void => setOrder('favoritesOrder', roots, paths),

  /**
   * The focus order across vaults (YAZ-2702 Decision 3), by the rule of the Favorites order above:
   * app-wide and per machine, and the same list until the order changes. The focus LIST itself is
   * not in this cache: each vault keeps its own in the vault, read through `api.focus` (`useVaultTree`).
   */
  getFocusOrder: (): string[] => state.focusOrder,
  /** What this window hands in for the vaults `roots`: after a drag, its focus items in the new order; after a remove or a clear, the stored order without those paths (S3, S4). */
  setFocusOrder: (roots: readonly string[], paths: readonly string[]): void => setOrder('focusOrder', roots, paths),

  /**
   * The active sidebar lens (YAZ-847): chrome, not per-folder view state, so no root argument
   * and no `FolderState` entry. Window identity since YAZ-1628, like `sidebarCollapsed` above —
   * another window's switch never lands here through a state broadcast, and a root change
   * keeps it (`setRoot` leaves it alone).
   */
  getSidebarLens: (): SidebarLens => identity.sidebarLens,
  /**
   * The page view this window's boot tab starts with (YAZ-2951 D5), from main's first identity: only
   * a window that ⌘⇧N or "Move to new window" opened has one. Memory only: it is never sent back.
   */
  getStartView: (): StartView | undefined => identity.startView,
  /** After a memory reload (YAZ-3737 D4): each tab's page view from before it, by its place in the strip. Memory only. */
  getReloadViews: (): (StartView | null)[] | undefined => identity.reloadViews,
  /** After a memory reload (YAZ-3737 D12): the size it reloaded at, in MB, for the window's one notice. */
  getReloadedAtMb: (): number | undefined => identity.reloadedAtMb,
  setSidebarLens(lens: SidebarLens): void {
    identity = { ...identity, sidebarLens: lens }
    send('window.setIdentity', () => api.window.setIdentity({ sidebarLens: lens }))
  },

  getFolds: (root: string, file: string): string[] => folderOf(root).folds[file] ?? [],
  /** Replace the fold keys for one file; an empty list removes the entry (keys the plugin no longer reports are dropped). */
  setFolds(root: string, file: string, keys: readonly string[]): void {
    const folds = { ...folderOf(root).folds }
    if (keys.length === 0) delete folds[file]
    else folds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
    patchFolder(root, { folds })
    send('state.setFolds', () => api.state.setFolds(root, file, keys))
  },

  /** What this note's table of contents is built from (YAZ-2700 D14): `headings`, `bullets`, or `null` — Auto, the note's own structure decides, which is no entry at all. */
  getTocSource: (root: string, file: string): TocSource | null => folderOf(root).tocSources[file] ?? null,
  /** The reader's choice for one note; `null` (Auto) removes the entry. The same choice again writes nothing. */
  setTocSource(root: string, file: string, source: TocSource | null): void {
    if (source === (folderOf(root).tocSources[file] ?? null)) return
    const tocSources = { ...folderOf(root).tocSources }
    if (source === null) delete tocSources[file]
    else tocSources[file] = source
    patchFolder(root, { tocSources })
    send('state.setTocSource', () => api.state.setTocSource(root, file, source))
  },

  /** The folded rows of this note's table of contents (YAZ-3939 D1): `tocFoldKeys` keys. */
  getTocFolds: (root: string, file: string): string[] => folderOf(root).tocFolds[file] ?? [],
  /** Replace them for one note; an empty list removes the entry. */
  setTocFolds(root: string, file: string, keys: readonly string[]): void {
    const tocFolds = { ...folderOf(root).tocFolds }
    if (keys.length === 0) delete tocFolds[file]
    else tocFolds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
    patchFolder(root, { tocFolds })
    send('state.setTocFolds', () => api.state.setTocFolds(root, file, keys))
  },

  /** This note's "Section indent" switch (YAZ-2709 D2). A note with no entry is off. */
  getSectionIndent: (root: string, file: string): boolean => folderOf(root).sectionIndents[file] === true,
  /** The reader's switch for one note. On and off are both stored; the same value again writes nothing. */
  setSectionIndent(root: string, file: string, on: boolean): void {
    if (on === folderOf(root).sectionIndents[file]) return
    patchFolder(root, { sectionIndents: { ...folderOf(root).sectionIndents, [file]: on } })
    send('state.setSectionIndent', () => api.state.setSectionIndent(root, file, on))
  },

  /** This note's own "Table of contents" choice (YAZ-2950). No entry is `undefined`: Settings › "Table of contents default" decides (YAZ-3558 D1). */
  getTocSwitch: (root: string, file: string): boolean | undefined => folderOf(root).tocSwitches[file],
  /** The reader's switch for one note. On and off are both stored; the same value again writes nothing. */
  setTocSwitch(root: string, file: string, on: boolean): void {
    if (on === folderOf(root).tocSwitches[file]) return
    patchFolder(root, { tocSwitches: { ...folderOf(root).tocSwitches, [file]: on } })
    send('state.setTocSwitch', () => api.state.setTocSwitch(root, file, on))
  },

  /**
   * Collapsed group keys for one view; `key` is `<pagePath>::<viewName>` (4C, GRO-2137).
   *
   * HISTORICAL NAMES (🔒 D1 of YAZ-823, kept deliberately by YAZ-858's rename): the STORED field
   * is still `baseGroups` and the bridge method / IPC channel are still `state.setBaseGroups` /
   * `state:set-base-groups`. Renaming them would either orphan every user's persisted collapse
   * state or need a migration, and would break the preload/main contract — so `shared/types.ts`'s
   * `AppState` field, `store.ts`'s mutator and the channel all keep the old spelling on purpose.
   * Only these two client accessors were renamed; the wire below is untouched.
   */
  getViewGroups: (root: string, key: string): string[] => folderOf(root).baseGroups[key] ?? [],
  /** Replace the collapsed group keys for one view; an empty list removes the entry. Session chrome, never written to the page's own frontmatter. */
  setViewGroups(root: string, key: string, collapsed: readonly string[]): void {
    const baseGroups = { ...folderOf(root).baseGroups }
    if (collapsed.length === 0) delete baseGroups[key]
    else baseGroups[key] = collapsed.slice(0, MAX_COLLAPSED_GROUP_KEYS)
    patchFolder(root, { baseGroups })
    send('state.setBaseGroups', () => api.state.setBaseGroups(root, key, collapsed))
  },
}
