import {
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  addRecentRoot,
  defaultAppState,
  defaultFolderState,
  type AppState,
  type FolderState,
  type RecentRoots,
  type SettingsState,
  type WindowIdentity,
} from '@shared/types'

/**
 * The renderer's view of the app state (D9, GRO-2159): an in-memory cache of the main-owned
 * `yaseendocs.json` plus this window's identity. `init()` loads both over the bridge and
 * subscribes to `state.onChange`, so a change made in any window replaces the cache here and
 * wakes `subscribe` listeners. Reads are synchronous off the cache; writes update the cache at
 * once (optimistic) and send the targeted mutator over the bridge, fire-and-forget.
 */

let state: AppState = defaultAppState()
let identity: WindowIdentity = { id: '', root: null, file: null, tabs: [] }
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

/** Issues one bridge call at once without awaiting it; a rejection (or a missing bridge) is logged, never thrown. */
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
    const bridge = window.yaseenDocs
    const [s, id] = await Promise.all([bridge.state.get(), bridge.window.identity()])
    state = s
    identity = id
    unsubscribe?.()
    unsubscribe = bridge.state.onChange((next) => {
      state = next
      listeners.forEach((l) => l())
    })
  },

  /** Called after a change made in ANY window landed in the cache (never for this window's own optimistic writes). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getRoot: (): string | null => identity.root,
  /** Changing the root clears this window's file AND tab list in the same write (Tabs rule 13, GRO-2234); re-setting the same root keeps them. */
  setRoot(root: string | null): void {
    const patch = root === identity.root ? { root } : { root, file: null, tabs: [] as string[] }
    identity = { ...identity, ...patch }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity(patch))
  },

  getRecentRoots: (): RecentRoots => state.recents,
  pushRecentRoot(path: string, now = Date.now()): RecentRoots {
    const next = addRecentRoot(state.recents, path, now)
    state = { ...state, recents: next }
    send('state.pushRecent', () => window.yaseenDocs.state.pushRecent(path))
    return next
  },

  /** Drop a dead folder from the MRU (its directory vanished on disk, C2 — GRO-2164). */
  removeRecentRoot(path: string): void {
    state = { ...state, recents: state.recents.filter((r) => r.path !== path) }
    send('state.removeRecent', () => window.yaseenDocs.state.removeRecent(path))
  },

  getExpanded: (root: string): string[] => folderOf(root).expanded,
  setExpanded(root: string, dirs: string[]): void {
    patchFolder(root, { expanded: dirs })
    send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { expanded: dirs }))
  },

  /** The window identity records what is open now: THIS window's restored file, not the folder's shared lastFile (GRO-2160). */
  getFile: (): string | null => identity.file,

  /** Valid AT BOOT only (like `getFile`): the renderer owns tab state after boot (Tabs I2, GRO-2234). */
  getTabs: (): string[] => identity.tabs,

  getLastFile: (root: string): string | null => folderOf(root).lastFile,

  /**
   * Tabs (I2, GRO-2234): every tab-state change lands as ONE explicit identity write carrying
   * BOTH `tabs` and the active `file` — never a `{ file }`-only patch, whose main-side
   * normalization would prepend the file into `tabs` on its own (the legacy pre-tabs path).
   * The active file is also the folder's remembered lastFile for the next window on it; a
   * null `root` (nothing to remember into) skips the folder half — and so does an UNCHANGED
   * active file (FN14, GRO-2197): a background-tab open, drag-reorder or non-active close moves
   * only `tabs`, and re-sending the same lastFile would make the main process commit, schedule
   * a disk write and broadcast the whole AppState to every window for nothing.
   */
  setTabs(root: string | null, tabs: readonly string[], file: string | null): void {
    const fileChanged = file !== identity.file
    identity = { ...identity, file, tabs: [...tabs] }
    if (root !== null && fileChanged) {
      patchFolder(root, { lastFile: file })
      send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { lastFile: file }))
    }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ tabs: [...tabs], file }))
  },

  /** Already validated field-by-field by the main process on load (`desktop/src/main/store.ts`). */
  getSettings: (): SettingsState => state.settings,
  setSettings(settings: SettingsState): void {
    state = { ...state, settings }
    send('state.setSettings', () => window.yaseenDocs.state.setSettings(settings))
  },

  getSidebarCollapsed: (): boolean => state.sidebarCollapsed,
  setSidebarCollapsed(collapsed: boolean): void {
    state = { ...state, sidebarCollapsed: collapsed }
    send('state.setSidebarCollapsed', () => window.yaseenDocs.state.setSidebarCollapsed(collapsed))
  },

  /** Already clamped to [SIDEBAR_MIN_W, SIDEBAR_MAX_W] by the main process on load and on write. */
  getSidebarWidth: (): number => state.sidebarWidth,
  setSidebarWidth(width: number): void {
    state = { ...state, sidebarWidth: width }
    send('state.setSidebarWidth', () => window.yaseenDocs.state.setSidebarWidth(width))
  },

  getFolds: (root: string, file: string): string[] => folderOf(root).folds[file] ?? [],
  /** Replace the fold keys for one file; an empty list removes the entry (keys the plugin no longer reports are dropped). */
  setFolds(root: string, file: string, keys: readonly string[]): void {
    const folds = { ...folderOf(root).folds }
    if (keys.length === 0) delete folds[file]
    else folds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
    patchFolder(root, { folds })
    send('state.setFolds', () => window.yaseenDocs.state.setFolds(root, file, keys))
  },

  /** Collapsed group keys for one base view; `key` is `<basePath>::<viewName>` (Bases 4C, GRO-2137). */
  getBaseGroups: (root: string, key: string): string[] => folderOf(root).baseGroups[key] ?? [],
  /** Replace the collapsed group keys for one base view; an empty list removes the entry. Session chrome, never written to the page's own frontmatter. */
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): void {
    const baseGroups = { ...folderOf(root).baseGroups }
    if (collapsed.length === 0) delete baseGroups[key]
    else baseGroups[key] = collapsed.slice(0, MAX_COLLAPSED_GROUP_KEYS)
    patchFolder(root, { baseGroups })
    send('state.setBaseGroups', () => window.yaseenDocs.state.setBaseGroups(root, key, collapsed))
  },
}
