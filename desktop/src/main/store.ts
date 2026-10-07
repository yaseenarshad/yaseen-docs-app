import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import {
  COMMENTS_ORDERS,
  CONTENT_WIDTHS,
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_LENS,
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  MAX_RECENT_ROOTS,
  MAX_VAULT_SETS,
  NEW_NOTE_LOCATIONS,
  RIGHT_PANEL_DEFAULT_W,
  RIGHT_PANEL_MAX_W,
  RIGHT_PANEL_MIN_W,
  SIDEBAR_DEFAULT_W,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
  THEMES,
  THREAD_WIDTHS,
  addRecentRoot,
  cleanVaultKey,
  cleanVaultName,
  defaultAppState,
  defaultFolderState,
  defaultRightPanelIdentity,
  freeVaultKey,
  isSidebarLens,
  isValidNewNoteFolder,
  normalizeRoots,
  stripSlash,
  type AppState,
  type CommentsOrder,
  type ContentWidth,
  type FolderPatch,
  type FolderState,
  type NewNoteLocation,
  type RecentRoots,
  type RightPanelIdentity,
  type SettingsState,
  type SidebarLens,
  type Theme,
  type VaultSet,
  type WindowBounds,
  type WindowEntry,
} from '@shared/types'
import { isRecord, isStringArray } from '@shared/guards'
import { atomicWrite } from './fs/fsUtils'

/**
 * The app state store (D9, GRO-2159): one user-global JSON file owned by the main process.
 * Electron-free — the caller passes the file path — so tests run it against a temp dir.
 * Mutations update memory, notify `onChange` listeners synchronously and schedule one debounced
 * atomic write; `flush()` writes at once (quit). Snapshots are immutable: every mutation builds a
 * new state object, so a listener can keep the one it was handed.
 */
export interface Store {
  get(): AppState
  setSettings(settings: SettingsState): void
  setSidebarWidth(width: number): void
  pushRecent(path: string, now?: number): void
  removeRecent(path: string): void
  setFolder(root: string, patch: FolderPatch): void
  setFolds(root: string, file: string, keys: readonly string[]): void
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): void
  /** `roots` may be left out: the entry then keeps `root` alone. Either way the vault-list invariant is applied (`normalizeRoots`). */
  upsertWindow(entry: Omit<WindowEntry, 'rightPanel' | 'roots'> & Partial<Pick<WindowEntry, 'rightPanel' | 'roots'>>): void
  removeWindow(id: string): void
  /**
   * Repair every stored reference to a just-renamed file OR directory (Links E1 GRO-2194,
   * E1b GRO-2241): window `root`/`file`/`tabs` (through `normalizeTabs`) and its Focus Mode
   * lists `focusDirs`/`focusFavorites` (YAZ-1628, YAZ-1766), recents, each
   * folder-state key and its `expanded`/`lastFile`/fold keys/
   * baseGroups keys (`<basePath>::<view>`), and the vaults of each saved set (YAZ-2602 S71).
   * A dir remaps by prefix — everything at or under it follows,
   * including a window ROOTED at the renamed folder. One commit; a no-op when nothing
   * references it.
   */
  renamePath(oldPath: string, newPath: string): void
  /**
   * Drop every stored reference to a just-deleted file OR directory (GRO-2272) — the delete
   * twin of `renamePath`. A directory removes BY PREFIX: everything at or under it goes.
   *
   * Per field: a window's `file` becomes null (and `normalizeTabs` then empties its tabs),
   * deleted tabs are dropped as are its `focusDirs` / `focusFavorites` entries
   * (YAZ-1628, YAZ-1766), `recents` loses the entry, and folder-state keys plus their
   * `expanded` / `lastFile` / fold keys / `baseGroups` keys
   * (`<basePath>::<view>`) go too. A saved set loses the vault, and a set with fewer than two
   * vaults left is removed (YAZ-2602 S71).
   * A window's `root` is deliberately LEFT ALONE: the renderer's existing `onRootMissing`
   * probe owns that repair (it also drops the dead MRU entry), and nulling it here would
   * race it. One commit; a no-op when nothing references the path.
   */
  removePath(path: string): void
  /**
   * Save `roots` as a set of vaults under `name` (YAZ-2602 D8) and answer the saved set. A set with
   * the same cleaned name is REPLACED: it keeps its `id`, takes the new vaults and moves to the front
   * (S63, S69). Refused with null, and no commit: fewer than two vaults after cleaning, an empty
   * name, or a NEW name when MAX_VAULT_SETS sets exist (S68, R12).
   */
  saveVaultSet(name: string, roots: readonly string[], now?: number): VaultSet | null
  /** Rename a saved set (S67). False, and no commit: an unknown `id`, an empty name, or a name a DIFFERENT set has. */
  renameVaultSet(id: string, name: string): boolean
  /** Forget a saved set (S67); its folders are never touched. An unknown `id` is a no-op. */
  removeVaultSet(id: string): void
  /** The set was just used (S65): `lastUsed` is `now`, and it moves to the front. An unknown `id` is a no-op. */
  touchVaultSet(id: string, now?: number): void
  onChange(listener: (state: AppState) => void): () => void
  flush(): Promise<void>
}

export const WRITE_DEBOUNCE_MS = 150

// ---------- validation (field by field; anything off falls back to its default) ----------

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const clampSidebarWidth = (w: number): number => Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, w))
const clampRightPanelWidth = (w: number): number => Math.min(RIGHT_PANEL_MAX_W, Math.max(RIGHT_PANEL_MIN_W, w))

export const isRecentRoots = (v: unknown): v is RecentRoots =>
  Array.isArray(v) && v.every((x) => isRecord(x) && typeof x.path === 'string' && isFiniteNumber(x.lastOpened))

/** Per-field guards shared by the loader, `sanitizeSettings` and the IPC boundary (`isSettings`). */
const SETTINGS_FIELD_OK: { [K in keyof SettingsState]: (v: unknown) => v is SettingsState[K] } = {
  lineSpacing: isFiniteNumber,
  blockGap: isFiniteNumber,
  bulletThreading: (v): v is boolean => typeof v === 'boolean',
  threadWidth: (v): v is number => isFiniteNumber(v) && THREAD_WIDTHS.includes(v),
  threadColor: (v): v is string | null => v === null || isHexColour(v),
  theme: (v): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v),
  contentWidth: (v): v is ContentWidth => typeof v === 'string' && (CONTENT_WIDTHS as readonly string[]).includes(v),
  newNoteLocation: (v): v is NewNoteLocation => typeof v === 'string' && (NEW_NOTE_LOCATIONS as readonly string[]).includes(v),
  newNoteFolder: (v): v is string => typeof v === 'string' && isValidNewNoteFolder(v),
  confirmDelete: (v): v is boolean => typeof v === 'boolean',
  confirmRename: (v): v is boolean => typeof v === 'boolean',
  commentsOrder: (v): v is CommentsOrder => typeof v === 'string' && (COMMENTS_ORDERS as readonly string[]).includes(v),
}
const SETTINGS_KEYS = Object.keys(SETTINGS_FIELD_OK) as Array<keyof SettingsState>

/** Stored settings merged field-by-field over defaults, so partial/stale shapes stay usable. */
export function sanitizeSettings(raw: unknown): SettingsState {
  const src = isRecord(raw) ? raw : {}
  const out = { ...DEFAULT_SETTINGS }
  for (const k of SETTINGS_KEYS) {
    const v = src[k]
    if (SETTINGS_FIELD_OK[k](v)) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** Strict: every field present and valid (the IPC boundary rejects anything else). */
export const isSettings = (v: unknown): v is SettingsState => isRecord(v) && SETTINGS_KEYS.every((k) => SETTINGS_FIELD_OK[k](v[k]))

export const isWindowBounds = (v: unknown): v is WindowBounds =>
  isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.width) && isFiniteNumber(v.height)

/** Core v1 shape; additive window-identity fields are repaired separately. */
type StoredWindowEntry = Pick<WindowEntry, 'id' | 'root' | 'file' | 'bounds'> & { roots?: unknown; tabs?: unknown; rightPanel?: unknown; sidebarCollapsed?: unknown; sidebarLens?: unknown; focusDirs?: unknown; focusFavorites?: unknown }
const isStoredWindowEntry = (v: unknown): v is StoredWindowEntry =>
  isRecord(v) && typeof v.id === 'string' && isStringOrNull(v.root) && isStringOrNull(v.file) && isWindowBounds(v.bounds)

/**
 * The tabs invariant (GRO-2232), shared by the loader and the IPC boundary (`ipc/window.ts`):
 * de-duplicates preserving first occurrence, prepends a non-null `file` that is missing —
 * `file` IS the active tab, so a legacy entry without `tabs` becomes `[file]` — and clears
 * the list when `file` is null (`tabs: []` ⇔ `file: null`).
 */
export function normalizeTabs(tabs: readonly string[], file: string | null): string[] {
  if (file === null) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tabs) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  if (!seen.has(file)) out.unshift(file)
  return out
}

/** Repair the additive v1 right-panel shape and enforce one editable owner per window. */
export function normalizeRightPanel(raw: unknown, tabs: readonly string[]): RightPanelIdentity {
  if (!isRecord(raw)) return defaultRightPanelIdentity()
  const tabSet = new Set(tabs)
  const seen = new Set<string>()
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((value): value is string => {
    if (typeof value !== 'string' || !isAbsolute(value) || tabSet.has(value) || seen.has(value)) return false
    seen.add(value)
    return true
  })
  return {
    open: raw.open === true,
    width: isFiniteNumber(raw.width) ? clampRightPanelWidth(raw.width) : RIGHT_PANEL_DEFAULT_W,
    items,
    expanded: typeof raw.expanded === 'string' && items.includes(raw.expanded) ? raw.expanded : null,
  }
}

function sanitizeWindows(raw: unknown, legacySidebarCollapsed: boolean, legacySidebarLens: SidebarLens): WindowEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WindowEntry[] = []
  for (const w of raw) {
    if (!isStoredWindowEntry(w) || seen.has(w.id)) continue
    seen.add(w.id)
    // Junk `tabs` elements (non-strings, relative paths) drop; a missing/invalid list repairs from `file`.
    const rawTabs: unknown = (w as { tabs?: unknown }).tabs
    const tabs = normalizeTabs(Array.isArray(rawTabs) ? rawTabs.filter((t): t is string => typeof t === 'string' && isAbsolute(t)) : [], w.file)
    const rightPanel = normalizeRightPanel((w as { rightPanel?: unknown }).rightPanel, tabs)
    const sidebarCollapsed = typeof w.sidebarCollapsed === 'boolean' ? w.sidebarCollapsed : legacySidebarCollapsed
    const sidebarLens = isSidebarLens(w.sidebarLens) ? w.sidebarLens : legacySidebarLens
    // Focus Mode's lists (YAZ-1628) read with the `tabs` rule: relative paths drop, a missing or junk list is no focus.
    const focusDirs = isStringArray(w.focusDirs) ? w.focusDirs.filter(isAbsolute) : []
    const focusFavorites = isStringArray(w.focusFavorites) ? w.focusFavorites.filter(isAbsolute) : []
    // The vault list (YAZ-2602 S74) reads with the `tabs` rule: a junk ELEMENT drops and the rest stay, and a missing list repairs from `root`.
    const roots = normalizeRoots(Array.isArray(w.roots) ? w.roots.filter((r): r is string => typeof r === 'string' && isAbsolute(r)) : [], w.root)
    out.push({ id: w.id, root: w.root, roots, file: w.file, tabs, rightPanel, sidebarCollapsed, sidebarLens, focusDirs, focusFavorites, bounds: { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height } })
  }
  return out
}

/** Shared by `folds` and `baseGroups`: key → non-empty string list, junk dropped, each list capped. */
function sanitizeKeyLists(raw: unknown, cap: number): Record<string, string[]> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, keys] of Object.entries(raw)) {
    if (isStringArray(keys) && keys.length > 0) out[key] = keys.slice(0, cap)
  }
  return out
}

function sanitizeFolder(raw: unknown): FolderState | null {
  if (!isRecord(raw)) return null
  return {
    // Tree expansion is SESSION state (YAZ-1642): never restored, never written (`toDisk`).
    // A relaunch starts every tree collapsed; a pre-1642 file's leftover lists are ignored.
    expanded: [],
    lastFile: typeof raw.lastFile === 'string' ? raw.lastFile : null,
    folds: sanitizeKeyLists(raw.folds, MAX_FOLD_KEYS_PER_FILE),
    baseGroups: sanitizeKeyLists(raw.baseGroups, MAX_COLLAPSED_GROUP_KEYS),
    name: cleanVaultName(raw.name),
    key: cleanVaultKey(raw.key),
  }
}

function sanitizeFolders(raw: unknown): Record<string, FolderState> {
  if (!isRecord(raw)) return {}
  const out: Record<string, FolderState> = {}
  const taken = new Set<number>()
  for (const [root, folder] of Object.entries(raw)) {
    const clean = sanitizeFolder(folder)
    if (clean === null) continue
    // One vault per number (YAZ-2555 S21): in a damaged file the first vault keeps it.
    if (clean.key !== null) {
      if (taken.has(clean.key)) clean.key = null
      else taken.add(clean.key)
    }
    out[root] = clean
  }
  return out
}

/** A saved set's vaults as the store keeps them (YAZ-2602 D8): absolute paths, trailing slash off, each once, MAX_WINDOW_ROOTS at most. */
function cleanSetRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const roots = raw.filter((r): r is string => typeof r === 'string' && isAbsolute(r)).map(stripSlash)
  return normalizeRoots(roots, roots[0] ?? null)
}

/** The saved sets (YAZ-2602 D8) read with the windows' rule: a bad entry drops alone. A set needs a string id of its own, a name and two vaults. */
function sanitizeVaultSets(raw: unknown): VaultSet[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: VaultSet[] = []
  for (const s of raw) {
    if (!isRecord(s) || typeof s.id !== 'string' || seen.has(s.id)) continue
    const name = cleanVaultName(s.name)
    const roots = cleanSetRoots(s.roots)
    if (name === null || roots.length < 2) continue
    seen.add(s.id)
    out.push({ id: s.id, name, roots, lastUsed: isFiniteNumber(s.lastUsed) ? s.lastUsed : 0 })
  }
  return out.slice(0, MAX_VAULT_SETS)
}

/** The file's shape: each folder bucket minus its session field (YAZ-1642) — what a relaunch restores, nothing more. */
function toDisk(state: AppState): unknown {
  const folders = Object.fromEntries(Object.entries(state.folders).map(([root, { expanded: _e, ...kept }]) => [root, kept]))
  return { ...state, folders }
}

function sanitizeState(raw: unknown): AppState | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  // YAZ-1280 migration: a v1 file's retired global value seeds only windows that do not yet
  // have their own value. The returned state omits the old key, so the next write completes it.
  const legacySidebarCollapsed = raw.sidebarCollapsed === true
  // YAZ-1628 migration, the same shape: a v1 file's retired global lens (YAZ-847) seeds only
  // windows without a valid lens of their own; a pre-847 file has none at all, and missing or
  // junk both read as the default. The returned state omits the old key too.
  const legacySidebarLens: SidebarLens = isSidebarLens(raw.sidebarLens) ? raw.sidebarLens : DEFAULT_SIDEBAR_LENS
  return {
    version: 1,
    settings: sanitizeSettings(raw.settings),
    sidebarWidth: isFiniteNumber(raw.sidebarWidth) ? clampSidebarWidth(raw.sidebarWidth) : SIDEBAR_DEFAULT_W,
    recents: isRecentRoots(raw.recents) ? raw.recents.slice(0, MAX_RECENT_ROOTS) : [],
    windows: sanitizeWindows(raw.windows, legacySidebarCollapsed, legacySidebarLens),
    folders: sanitizeFolders(raw.folders),
    vaultSets: sanitizeVaultSets(raw.vaultSets),
  }
}

// ---------- loading ----------

/**
 * A state file's text as a state, or null when it is not one: bad JSON, or not a version-1 object.
 * `yaseendocs vaults` reads the file through it too (YAZ-2556 D2), so the command sees the state
 * the app would load, field for field — and, unlike `load`, it never moves a file aside.
 */
export function parseState(text: string): AppState | null {
  try {
    return sanitizeState(JSON.parse(text))
  } catch {
    return null
  }
}

/** Reads the file synchronously; a corrupt one is moved aside as `<file>.corrupt-<epoch>` and defaults are used. */
function load(filePath: string): AppState {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAppState()
    throw err
  }
  const state = parseState(raw)
  if (state !== null) return state
  const backup = `${filePath}.corrupt-${Date.now()}`
  try {
    renameSync(filePath, backup)
    console.error(`[store] ${filePath} is not a valid app state; moved to ${backup} and using defaults`)
  } catch (err) {
    console.error(`[store] ${filePath} is not a valid app state and could not be moved aside: ${String(err)}`)
  }
  return defaultAppState()
}

// ---------- the store ----------

export function createStore(filePath: string): Store {
  let state = load(filePath)
  const listeners = new Set<(state: AppState) => void>()
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Writes are chained so two atomic writes can never land out of order. */
  let chain: Promise<void> = Promise.resolve()
  /**
   * The text of the last successful write (YAZ-2198). Session-only state (`expanded`)
   * never reaches disk, so every folder expand / collapse used to rewrite
   * byte-identical JSON; identical text is skipped. The first write after a launch always writes.
   */
  let lastWritten: string | null = null

  const write = (): Promise<void> => {
    dirty = false
    const snapshot = state
    chain = chain
      .then(async () => {
        const text = `${JSON.stringify(toDisk(snapshot), null, 2)}\n`
        if (text === lastWritten) return
        mkdirSync(dirname(filePath), { recursive: true })
        await atomicWrite(filePath, text)
        lastWritten = text
      })
      .catch((err: unknown) => console.error(`[store] failed to write ${filePath}: ${String(err)}`))
    return chain
  }

  const commit = (next: AppState): void => {
    state = next
    dirty = true
    listeners.forEach((l) => l(next))
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void write()
    }, WRITE_DEBOUNCE_MS)
  }

  const folderOf = (root: string): FolderState => state.folders[root] ?? defaultFolderState()

  return {
    get: () => state,

    setSettings(settings) {
      commit({ ...state, settings: sanitizeSettings(settings) })
    },

    setSidebarWidth(width) {
      commit({ ...state, sidebarWidth: clampSidebarWidth(width) })
    },

    pushRecent(path, now = Date.now()) {
      commit({ ...state, recents: addRecentRoot(state.recents, path, now) })
    },

    removeRecent(path) {
      if (!state.recents.some((r) => r.path === path)) return
      commit({ ...state, recents: state.recents.filter((r) => r.path !== path) })
    },

    setFolder(root, patch) {
      const cur = folderOf(root)
      const key = patch.key === undefined ? undefined : cleanVaultKey(patch.key)
      const next: FolderState = {
        ...cur,
        ...(patch.expanded !== undefined ? { expanded: [...patch.expanded] } : {}),
        ...(patch.lastFile !== undefined ? { lastFile: patch.lastFile } : {}),
        ...(patch.name !== undefined ? { name: cleanVaultName(patch.name) } : {}),
        ...(key !== undefined ? { key } : {}),
      }
      // One vault per number (YAZ-2555 D2): the same commit takes it from the vault that had it.
      commit({ ...state, folders: { ...(key == null ? state.folders : freeVaultKey(state.folders, key)), [root]: next } })
    },

    setFolds(root, file, keys) {
      const cur = folderOf(root)
      const folds = { ...cur.folds }
      if (keys.length === 0) delete folds[file]
      else folds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, folds } } })
    },

    setBaseGroups(root, key, collapsed) {
      const cur = folderOf(root)
      const baseGroups = { ...cur.baseGroups }
      if (collapsed.length === 0) delete baseGroups[key]
      else baseGroups[key] = collapsed.slice(0, MAX_COLLAPSED_GROUP_KEYS)
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, baseGroups } } })
    },

    upsertWindow(entry) {
      const tabs = normalizeTabs(entry.tabs, entry.file)
      const normalized: WindowEntry = { ...entry, roots: normalizeRoots(entry.roots ?? [], entry.root), tabs, rightPanel: normalizeRightPanel(entry.rightPanel, tabs) }
      const windows = state.windows.some((w) => w.id === entry.id) ? state.windows.map((w) => (w.id === entry.id ? normalized : w)) : [...state.windows, normalized]
      commit({ ...state, windows })
    },

    removeWindow(id) {
      if (!state.windows.some((w) => w.id === id)) return
      commit({ ...state, windows: state.windows.filter((w) => w.id !== id) })
    },

    renamePath(oldPath, newPath) {
      // E1b (GRO-2241): `oldPath` may be a DIRECTORY — every stored path AT or UNDER it
      // follows: window roots (a subfolder opened as a vault!), files and tabs, recents,
      // each folder-state KEY plus its expanded dirs, lastFile, fold keys and baseGroups
      // keys. For a FILE rename the prefix branch is inert (nothing is ever stored under a
      // file path), so ONE mapping serves both kinds — and it is still one commit, one
      // notify, a no-op when nothing references the path.
      let changed = false
      const prefix = `${oldPath}/`
      const remap = (p: string): string => {
        if (p !== oldPath && !p.startsWith(prefix)) return p
        changed = true
        return newPath + p.slice(oldPath.length)
      }
      // A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test.
      const baseGroupPrefix = `${oldPath}::`
      const remapBaseGroupKey = (key: string): string => {
        if (!key.startsWith(baseGroupPrefix)) return remap(key)
        changed = true
        return newPath + key.slice(oldPath.length)
      }
      const remapKeys = (lists: Record<string, string[]>, remapKey: (key: string) => string): Record<string, string[]> =>
        Object.fromEntries(Object.entries(lists).map(([key, value]) => [remapKey(key), value]))
      const windows = state.windows.map((w) => {
        const root = w.root === null ? null : remap(w.root)
        const file = w.file === null ? null : remap(w.file)
        const tabs = normalizeTabs(w.tabs.map(remap), file)
        return {
          ...w,
          root,
          // Every vault of the window follows its folder, as `root` does (YAZ-2602 S48).
          roots: w.roots.map(remap),
          file,
          tabs,
          rightPanel: normalizeRightPanel({
            ...w.rightPanel,
            items: w.rightPanel.items.map(remap),
            expanded: w.rightPanel.expanded === null ? null : remap(w.rightPanel.expanded),
          }, tabs),
          // Focus Mode's lists (YAZ-1628, YAZ-1766): path lists like `tabs` — a renamed focus follows its folder.
          focusDirs: w.focusDirs.map(remap),
          focusFavorites: w.focusFavorites.map(remap),
        }
      })
      const recents = state.recents.map((r) => ({ ...r, path: remap(r.path) }))
      const folders = Object.fromEntries(
        Object.entries(state.folders).map(([root, folder]) => [
          remap(root),
          {
            ...folder,
            expanded: folder.expanded.map(remap),
            lastFile: folder.lastFile === null ? null : remap(folder.lastFile),
            folds: remapKeys(folder.folds, remap),
            baseGroups: remapKeys(folder.baseGroups, remapBaseGroupKey),
          },
        ]),
      )
      // A saved set follows its vault's folder (YAZ-2602 S71), and stays a set: each vault once, two at least.
      const vaultSets = state.vaultSets.map((s) => ({ ...s, roots: cleanSetRoots(s.roots.map(remap)) })).filter((s) => s.roots.length >= 2)
      if (!changed) return
      commit({ ...state, windows, recents, folders, vaultSets })
    },

    removePath(deleted) {
      // The delete twin of `renamePath` above; read that first — the traversal is identical,
      // only the mapping differs (drop instead of remap). A FILE's prefix branch is inert
      // (nothing is ever stored under a file path), so one pass serves both kinds.
      let changed = false
      const prefix = `${deleted}/`
      /** Is this stored path the deleted entry, or inside it? */
      const gone = (p: string): boolean => p === deleted || p.startsWith(prefix)
      const drop = (paths: readonly string[]): string[] => {
        const kept = paths.filter((p) => !gone(p))
        if (kept.length !== paths.length) changed = true
        return kept
      }
      /** A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test. */
      const baseGroupGone = (key: string): boolean => key.startsWith(`${deleted}::`) || gone(key)
      const dropKeys = <T>(map: Record<string, T>, isGone: (key: string) => boolean): Record<string, T> => {
        const kept = Object.entries(map).filter(([key]) => !isGone(key))
        if (kept.length !== Object.keys(map).length) changed = true
        return Object.fromEntries(kept)
      }
      const windows = state.windows.map((w) => {
        // `root` and `roots` are NOT touched here — see the interface doc: the renderer's missing-folder probe owns them (YAZ-2602 S49).
        const tabs = drop(w.tabs)
        let file = w.file
        if (file !== null && gone(file)) {
          changed = true
          // The active file itself went. Pick an HEIR with the same ladder useWorkspace uses —
          // right neighbour, else left — rather than nulling `file`: normalizeTabs returns []
          // for a null file, which would throw away the window's SURVIVING tabs. The renderer
          // picks the same heir a moment later and mirrors it down, but the store is also the
          // boot snapshot, so it has to be correct on its own if the app quits in between.
          const i = w.tabs.indexOf(file)
          file = w.tabs.slice(i + 1).find((t) => !gone(t)) ?? [...w.tabs.slice(0, i)].reverse().find((t) => !gone(t)) ?? null
        }
        const normalizedTabs = normalizeTabs(tabs, file)
        const rightItems = drop(w.rightPanel.items)
        let expanded = w.rightPanel.expanded
        if (expanded !== null && gone(expanded)) {
          changed = true
          const i = w.rightPanel.items.indexOf(expanded)
          expanded = w.rightPanel.items.slice(i + 1).find((item) => !gone(item))
            ?? [...w.rightPanel.items.slice(0, i)].reverse().find((item) => !gone(item))
            ?? null
        }
        return {
          ...w,
          file,
          tabs: normalizedTabs,
          rightPanel: normalizeRightPanel({ ...w.rightPanel, items: rightItems, expanded }, normalizedTabs),
          // Focus Mode's lists (YAZ-1628, YAZ-1766): a deleted focus target drops out, exactly as a deleted tab does above.
          focusDirs: drop(w.focusDirs),
          focusFavorites: drop(w.focusFavorites),
        }
      })
      const recents = state.recents.filter((r) => !gone(r.path))
      if (recents.length !== state.recents.length) changed = true
      const folders = Object.fromEntries(
        Object.entries(state.folders)
          .filter(([root]) => {
            if (!gone(root)) return true
            changed = true
            return false
          })
          .map(([root, folder]) => [
            root,
            {
              ...folder,
              expanded: drop(folder.expanded),
              lastFile: folder.lastFile !== null && gone(folder.lastFile) ? ((changed = true), null) : folder.lastFile,
              folds: dropKeys(folder.folds, gone),
              baseGroups: dropKeys(folder.baseGroups, baseGroupGone),
            },
          ]),
      )
      // A deleted folder leaves each saved set (YAZ-2602 S71); a set with fewer than two vaults left is no set.
      const vaultSets = state.vaultSets.map((s) => ({ ...s, roots: drop(s.roots) })).filter((s) => s.roots.length >= 2)
      if (!changed) return
      commit({ ...state, windows, recents, folders, vaultSets })
    },

    saveVaultSet(rawName, rawRoots, now = Date.now()) {
      const name = cleanVaultName(rawName)
      const roots = cleanSetRoots(rawRoots)
      if (name === null || roots.length < 2) return null
      const existing = state.vaultSets.find((s) => s.name === name)
      // R12 counts sets, so a save under a name that exists is never the one refused.
      if (existing === undefined && state.vaultSets.length >= MAX_VAULT_SETS) return null
      const saved: VaultSet = { id: existing?.id ?? randomUUID(), name, roots, lastUsed: now }
      commit({ ...state, vaultSets: [saved, ...state.vaultSets.filter((s) => s !== existing)] })
      return saved
    },

    renameVaultSet(id, rawName) {
      const name = cleanVaultName(rawName)
      const set = state.vaultSets.find((s) => s.id === id)
      if (name === null || set === undefined || state.vaultSets.some((s) => s !== set && s.name === name)) return false
      if (set.name !== name) commit({ ...state, vaultSets: state.vaultSets.map((s) => (s === set ? { ...s, name } : s)) })
      return true
    },

    removeVaultSet(id) {
      if (!state.vaultSets.some((s) => s.id === id)) return
      commit({ ...state, vaultSets: state.vaultSets.filter((s) => s.id !== id) })
    },

    touchVaultSet(id, now = Date.now()) {
      const set = state.vaultSets.find((s) => s.id === id)
      if (set === undefined || (state.vaultSets[0] === set && set.lastUsed === now)) return
      commit({ ...state, vaultSets: [{ ...set, lastUsed: now }, ...state.vaultSets.filter((s) => s !== set)] })
    },

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (dirty) return write()
      return chain
    },
  }
}
