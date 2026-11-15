/**
 * The files the explore stack opened, newest first (YAZ-2571; kept after a restart since YAZ-4945): the notes and
 * boards it opened as layers, and App's active tab. The empty search's **Opened** section reads them, with the vault's
 * own open history (`storage.getOpens`, the tabs of every window); see `recentSections.ts`. Kept in this app's
 * localStorage (`explore:opened`), every vault in one list of at most `MAX_EXPLORE_RECENTS`, each window reading its
 * own vaults' files from it. Written at an open, a rename or a delete only: never per keystroke. Tiny and eager: App
 * feeds it while the stack's own chunk stays lazy.
 */
export const MAX_EXPLORE_RECENTS = 100

/** One open: the file and when (ms). */
export interface ExploreOpen {
  path: string
  at: number
}

const KEY = 'explore:opened'

/** The list in memory; null until first read (then read from localStorage once). */
let recents: ExploreOpen[] | null = null

function load(): ExploreOpen[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((e): e is ExploreOpen => typeof e?.path === 'string' && typeof e?.at === 'number' && Number.isFinite(e.at)).slice(0, MAX_EXPLORE_RECENTS)
  } catch {
    return []
  }
}

function save(list: ExploreOpen[]): void {
  recents = list
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // No storage (a full quota): the list lasts the window.
  }
}

const list = (): ExploreOpen[] => (recents ??= load())

export function rememberExploreRecent(path: string, at = Date.now()): void {
  const now = list()
  if (now[0]?.path === path && now[0].at === at) return
  save([{ path, at }, ...now.filter((e) => e.path !== path)].slice(0, MAX_EXPLORE_RECENTS))
}

/** Newest first. The same list while nothing was remembered: a render that reads it twice reads one object. */
export const exploreRecents = (): readonly ExploreOpen[] => list()

/** The open stack hears each move too (check 21 of YAZ-2571): a layer on the note follows a rename, and says so after a delete. */
const movers = new Set<(from: string, to: string | null) => void>()
export function onExploreMove(listener: (from: string, to: string | null) => void): () => void {
  movers.add(listener)
  return () => void movers.delete(listener)
}

/** `paths` after a move of `from` (a note or a folder) to `to`, or without it when it is gone; the same list when it holds none. */
export function movedPaths(paths: readonly string[], from: string, to: string | null): string[] {
  const at = (path: string) => path === from || path.startsWith(`${from}/`)
  if (!paths.some(at)) return paths as string[]
  return to === null ? paths.filter((p) => !at(p)) : paths.map((p) => (at(p) ? to + p.slice(from.length) : p))
}

/** `opens` after the same move: each entry keeps its time. The same list when it holds none. */
export function movedOpens(opens: readonly ExploreOpen[], from: string, to: string | null): ExploreOpen[] {
  const paths = opens.map((e) => e.path)
  const next = movedPaths(paths, from, to)
  if (next === paths) return opens as ExploreOpen[]
  if (to !== null) return opens.map((e, i) => ({ ...e, path: next[i] }))
  const kept = new Set(next)
  return opens.filter((e) => kept.has(e.path))
}

/** A note that is gone (App's `file:deleted`) or moved (`file:renamed`, `to` its new path): the list follows, and the stack. */
export function moveExploreRecent(from: string, to: string | null): void {
  const now = list()
  const next = movedOpens(now, from, to)
  if (next !== now) save(next)
  for (const tell of [...movers]) tell(from, to)
}

/** For tests: an empty list, nothing stored. */
export const resetExploreRecents = (): void => {
  recents = []
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
}

/** For tests: the memory gone, as after a restart; the next read is from localStorage. */
export const reloadExploreRecents = (): void => {
  recents = null
}
