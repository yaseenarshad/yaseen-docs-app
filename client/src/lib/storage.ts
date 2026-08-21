import {
  DEFAULT_SETTINGS,
  LS_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  type ExpandedState,
  type FoldState,
  type LastFileState,
  type RecentRoots,
  type SettingsState,
} from '@shared/types'

const MAX_RECENT = 10

function readJson<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isRecentRoots = (v: unknown): v is RecentRoots =>
  Array.isArray(v) && v.every((x) => isRecord(x) && typeof x.path === 'string' && typeof x.lastOpened === 'number')
const isExpandedState = (v: unknown): v is ExpandedState => isRecord(v) && Object.values(v).every(isStringArray)
const isLastFileState = (v: unknown): v is LastFileState =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string')
const isFoldState = (v: unknown): v is FoldState => isRecord(v) && Object.values(v).every(isExpandedState)

/** Pure: prepend `path` to the MRU list, de-duplicated, capped. */
export function addRecentRoot(list: RecentRoots, path: string, now: number): RecentRoots {
  return [{ path, lastOpened: now }, ...list.filter((r) => r.path !== path)].slice(0, MAX_RECENT)
}

export const storage = {
  getRoot: (): string | null => localStorage.getItem(LS_KEYS.root),
  setRoot(root: string | null): void {
    if (root === null) localStorage.removeItem(LS_KEYS.root)
    else localStorage.setItem(LS_KEYS.root, root)
  },

  getRecentRoots: (): RecentRoots => readJson(LS_KEYS.recentRoots, isRecentRoots) ?? [],
  pushRecentRoot(path: string, now = Date.now()): RecentRoots {
    const next = addRecentRoot(storage.getRecentRoots(), path, now)
    writeJson(LS_KEYS.recentRoots, next)
    return next
  },

  getExpanded: (root: string): string[] => (readJson(LS_KEYS.expanded, isExpandedState) ?? {})[root] ?? [],
  setExpanded(root: string, dirs: string[]): void {
    writeJson(LS_KEYS.expanded, { ...(readJson(LS_KEYS.expanded, isExpandedState) ?? {}), [root]: dirs })
  },

  getLastFile: (root: string): string | null => (readJson(LS_KEYS.lastFile, isLastFileState) ?? {})[root] ?? null,
  setLastFile(root: string, file: string | null): void {
    const state = readJson(LS_KEYS.lastFile, isLastFileState) ?? {}
    if (file === null) delete state[root]
    else state[root] = file
    writeJson(LS_KEYS.lastFile, state)
  },

  /** Stored settings merged field-by-field over defaults, so partial/stale shapes stay usable. */
  getSettings(): SettingsState {
    const raw = readJson(LS_KEYS.settings, isRecord) ?? {}
    return {
      lineSpacing: typeof raw.lineSpacing === 'number' ? raw.lineSpacing : DEFAULT_SETTINGS.lineSpacing,
      blockGap: typeof raw.blockGap === 'number' ? raw.blockGap : DEFAULT_SETTINGS.blockGap,
      bulletThreading: typeof raw.bulletThreading === 'boolean' ? raw.bulletThreading : DEFAULT_SETTINGS.bulletThreading,
    }
  },
  setSettings(settings: SettingsState): void {
    writeJson(LS_KEYS.settings, settings)
  },

  getSidebarCollapsed: (): boolean => localStorage.getItem(LS_KEYS.sidebarCollapsed) === 'true',
  setSidebarCollapsed(collapsed: boolean): void {
    if (collapsed) localStorage.setItem(LS_KEYS.sidebarCollapsed, 'true')
    else localStorage.removeItem(LS_KEYS.sidebarCollapsed)
  },

  getFolds: (root: string, file: string): string[] => (readJson(LS_KEYS.folds, isFoldState) ?? {})[root]?.[file] ?? [],
  /** Replace the fold keys for one file; an empty list removes the entry (keys the plugin no longer reports are dropped). */
  setFolds(root: string, file: string, keys: readonly string[]): void {
    const state = readJson(LS_KEYS.folds, isFoldState) ?? {}
    const files = { ...state[root] }
    if (keys.length === 0) delete files[file]
    else files[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
    if (Object.keys(files).length === 0) delete state[root]
    else state[root] = files
    writeJson(LS_KEYS.folds, state)
  },
}
