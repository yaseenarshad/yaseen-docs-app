import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import {
  DEFAULT_SETTINGS,
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  MAX_RECENT_ROOTS,
  THEMES,
  THREAD_WIDTHS,
  addRecentRoot,
  defaultAppState,
  defaultFolderState,
  type AppState,
  type FolderState,
  type RecentRoots,
  type SettingsState,
  type Theme,
  type WindowBounds,
  type WindowEntry,
} from '@shared/types'
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
  setSidebarCollapsed(collapsed: boolean): void
  pushRecent(path: string, now?: number): void
  removeRecent(path: string): void
  setFolder(root: string, patch: Partial<Pick<FolderState, 'expanded' | 'lastFile'>>): void
  setFolds(root: string, file: string, keys: readonly string[]): void
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): void
  upsertWindow(entry: WindowEntry): void
  removeWindow(id: string): void
  onChange(listener: (state: AppState) => void): () => void
  flush(): Promise<void>
}

export const WRITE_DEBOUNCE_MS = 150

// ---------- validation (field by field; anything off falls back to its default) ----------

/** Shared with the IPC boundary (`ipc/state.ts` / `ipc/window.ts`) — one guard, three call sites. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

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

/** Core v1 shape; `tabs` (GRO-2232) is additive-within-v1 and repaired separately, so legacy entries still pass. */
export const isWindowEntry = (v: unknown): v is WindowEntry =>
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

function sanitizeWindows(raw: unknown): WindowEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WindowEntry[] = []
  for (const w of raw) {
    if (!isWindowEntry(w) || seen.has(w.id)) continue
    seen.add(w.id)
    // Junk `tabs` elements (non-strings, relative paths) drop; a missing/invalid list repairs from `file`.
    const rawTabs: unknown = (w as { tabs?: unknown }).tabs
    const tabs = normalizeTabs(Array.isArray(rawTabs) ? rawTabs.filter((t): t is string => typeof t === 'string' && isAbsolute(t)) : [], w.file)
    out.push({ id: w.id, root: w.root, file: w.file, tabs, bounds: { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height } })
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
    expanded: isStringArray(raw.expanded) ? raw.expanded : [],
    lastFile: typeof raw.lastFile === 'string' ? raw.lastFile : null,
    folds: sanitizeKeyLists(raw.folds, MAX_FOLD_KEYS_PER_FILE),
    baseGroups: sanitizeKeyLists(raw.baseGroups, MAX_COLLAPSED_GROUP_KEYS),
  }
}

function sanitizeFolders(raw: unknown): Record<string, FolderState> {
  if (!isRecord(raw)) return {}
  const out: Record<string, FolderState> = {}
  for (const [root, folder] of Object.entries(raw)) {
    const clean = sanitizeFolder(folder)
    if (clean !== null) out[root] = clean
  }
  return out
}

/** Null when the document is not a version-1 state object at all (→ treated as corrupt). */
function sanitizeState(raw: unknown): AppState | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  return {
    version: 1,
    settings: sanitizeSettings(raw.settings),
    sidebarCollapsed: raw.sidebarCollapsed === true,
    recents: isRecentRoots(raw.recents) ? raw.recents.slice(0, MAX_RECENT_ROOTS) : [],
    windows: sanitizeWindows(raw.windows),
    folders: sanitizeFolders(raw.folders),
  }
}

// ---------- loading ----------

/** Reads the file synchronously; a corrupt one is moved aside as `<file>.corrupt-<epoch>` and defaults are used. */
function load(filePath: string): AppState {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAppState()
    throw err
  }
  let parsed: unknown
  let state: AppState | null = null
  try {
    parsed = JSON.parse(raw)
    state = sanitizeState(parsed)
  } catch {
    state = null
  }
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

  const write = (): Promise<void> => {
    dirty = false
    const snapshot = state
    chain = chain
      .then(async () => {
        mkdirSync(dirname(filePath), { recursive: true })
        await atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`)
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

    setSidebarCollapsed(collapsed) {
      commit({ ...state, sidebarCollapsed: collapsed })
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
      const next: FolderState = {
        ...cur,
        ...(patch.expanded !== undefined ? { expanded: [...patch.expanded] } : {}),
        ...(patch.lastFile !== undefined ? { lastFile: patch.lastFile } : {}),
      }
      commit({ ...state, folders: { ...state.folders, [root]: next } })
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
      const windows = state.windows.some((w) => w.id === entry.id) ? state.windows.map((w) => (w.id === entry.id ? entry : w)) : [...state.windows, entry]
      commit({ ...state, windows })
    },

    removeWindow(id) {
      if (!state.windows.some((w) => w.id === id)) return
      commit({ ...state, windows: state.windows.filter((w) => w.id !== id) })
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
