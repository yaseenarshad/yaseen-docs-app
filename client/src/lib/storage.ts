import {
  DEFAULT_SIDEBAR_LENS,
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  addRecentRoot,
  cleanVaultName,
  defaultAppState,
  defaultFolderState,
  defaultRightPanelIdentity,
  freeVaultKey,
  keyedVaults,
  listVaults,
  mergeFavoritesOrder,
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
  type VaultEntry,
  type VaultSet,
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
let identity: WindowIdentity = { id: '', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: DEFAULT_SIDEBAR_LENS, focusList: [] }
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

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
      // Each broadcast is a new copy. The Favorites order keeps its identity while it holds the same
      // paths (YAZ-2631 D1), so what reads it draws again only when the order changed.
      const held = state.favoritesOrder
      state = held.length === next.favoritesOrder.length && held.every((path, at) => path === next.favoritesOrder[at]) ? { ...next, favoritesOrder: held } : next
      listeners.forEach((l) => l())
    })
  },

  /** Called after a change made in ANY window landed in the cache — never for this window's own optimistic writes, but the one of the Favorites order (`setFavoritesOrder`). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getRoot: (): string | null => identity.root,
  /**
   * Changing the root clears this window's file AND tab list (Tabs rule 13, GRO-2234) and its
   * focus list (YAZ-1628, YAZ-2619), and lands the lens on Files (🔒 D2, YAZ-1846),
   * in the same write; re-setting the same root keeps them.
   */
  setRoot(root: string | null): void {
    const patch = root === identity.root
      ? { root }
      : { root, file: null, tabs: [] as string[], rightPanel: defaultRightPanelIdentity(), sidebarLens: DEFAULT_SIDEBAR_LENS, focusList: [] as string[] }
    // The window is on that ONE vault (YAZ-2602 S61). The patch names `root` alone: main makes the list from it (S76).
    identity = { ...identity, ...patch, ...(root === identity.root ? {} : { roots: normalizeRoots([], root) }) }
    send('window.setIdentity', () => api.window.setIdentity(patch))
  },

  /** Every vault this window shows, `root` first (YAZ-2602 D1). */
  getRoots: (): string[] => identity.roots,
  /**
   * Add or remove a vault (YAZ-2602 D2, D7). Unlike `setRoot`, this keeps the tabs, the lens and
   * the focus list: the caller closes a removed vault's tabs first. `root` follows `roots[0]`.
   * A vault that leaves takes its focus items with it, in the same write (A5).
   */
  setRoots(roots: readonly string[]): void {
    const next = normalizeRoots(roots, roots[0] ?? null)
    const focusList = identity.focusList.filter((path) => rootOfPath(next, path) !== null)
    const patch = focusList.length === identity.focusList.length ? { roots: next } : { roots: next, focusList }
    identity = { ...identity, ...patch, root: next[0] ?? null }
    send('window.setIdentity', () => api.window.setIdentity(patch))
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

  /**
   * The focus list (YAZ-2619): files and folders in the order added, or the order a drag gave
   * them (YAZ-2631 D3); empty when there is none.
   * Window identity since YAZ-1628, like `sidebarCollapsed` below — no root argument, and a global
   * state broadcast never follows another window's list into this one; a root change clears it (`setRoot`),
   * and a vault that leaves the window takes its items (`setRoots`).
   */
  getFocusList: (): string[] => identity.focusList,
  setFocusList(paths: readonly string[]): void {
    const focusList = [...paths]
    identity = { ...identity, focusList }
    send('window.setIdentity', () => api.window.setIdentity({ focusList }))
  },

  /** The window identity records what is open now: THIS window's restored file, not the folder's shared lastFile (GRO-2160). */
  getFile: (): string | null => identity.file,

  /** Valid AT BOOT only (like `getFile`): the renderer owns tab state after boot (Tabs I2, GRO-2234). */
  getTabs: (): string[] => identity.tabs,

  /** Durable right-panel identity at boot; clone the ordered list so callers cannot mutate the cache. */
  getRightPanel: (): RightPanelIdentity => ({ ...identity.rightPanel, items: [...identity.rightPanel.items] }),

  getLastFile: (root: string): string | null => folderOf(root).lastFile,

  /** A vault's open history (YAZ-2663 D1): page → how much it is used, and when it was last on show. Read-only here: main alone adds a use, and the cache follows the broadcast. */
  getOpens: (root: string): Readonly<Record<string, OpenStat>> => folderOf(root).opens,

  /** One durable mirror for the complete main/right workspace identity. */
  setWorkspace(root: string | null, tabs: readonly string[], file: string | null, rightPanel: RightPanelIdentity): void {
    const fileChanged = file !== identity.file
    const nextRight = { ...rightPanel, items: [...rightPanel.items] }
    identity = { ...identity, file, tabs: [...tabs], rightPanel: nextRight }
    // The file is the last one of the vault that HOLDS it (YAZ-2602): `root`, unless another vault of the window does.
    const home = file === null ? root : (rootOfPath(identity.roots, file) ?? root)
    if (home !== null && fileChanged) {
      patchFolder(home, { lastFile: file })
      send('state.setFolder', () => api.state.setFolder(home, { lastFile: file }))
    }
    send('window.setIdentity', () => api.window.setIdentity({
      tabs: [...tabs],
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
   * after a remove, the stored order without the removed paths (YAZ-2631 R23). The cache
   * merges it as main does (`mergeFavoritesOrder`, R5) and wakes `subscribe` at once, so the list
   * never shows the old order while main answers; main's broadcast of the same order then changes nothing.
   */
  setFavoritesOrder(roots: readonly string[], paths: readonly string[]): void {
    const favoritesOrder = mergeFavoritesOrder(state.favoritesOrder, roots, paths)
    const moved = favoritesOrder !== state.favoritesOrder
    state = { ...state, favoritesOrder }
    send('state.setFavoritesOrder', () => api.state.setFavoritesOrder(roots, paths))
    if (moved) listeners.forEach((l) => l())
  },

  /**
   * The active sidebar lens (YAZ-847): chrome, not per-folder view state, so no root argument
   * and no `FolderState` entry. Window identity since YAZ-1628, like `sidebarCollapsed` above —
   * another window's switch never lands here through a state broadcast, and a root change
   * keeps it (`setRoot` leaves it alone).
   */
  getSidebarLens: (): SidebarLens => identity.sidebarLens,
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
