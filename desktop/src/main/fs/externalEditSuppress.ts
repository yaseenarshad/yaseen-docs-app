import path from 'node:path'

/**
 * In-memory suppression registry for watcher-driven external edit logging (YAZ-6501).
 *
 * Kept leaf-level (depends only on `node:path`) so `vaultIndex/*`, `fs/*`, `git/*`, and `ipc/*`
 * can suppress quiet/system writes without circular imports.
 */

export const DEFAULT_SUPPRESS_TTL_MS = 2_000
const MAX_SUPPRESSED_PATHS = 512

interface SuppressEntry {
  depth: number
  until: number
}

const suppressedPaths = new Map<string, SuppressEntry>()
const suppressedRoots = new Map<string, SuppressEntry>()

function prunePaths(now: number): void {
  if (suppressedPaths.size <= MAX_SUPPRESSED_PATHS) return
  for (const [key, entry] of suppressedPaths) {
    if (entry.depth === 0 && entry.until < now) suppressedPaths.delete(key)
  }
}

/** Suppresses watcher-driven edit logging for `filePath` for `ttlMs` (refreshes existing deadline if longer). */
export function suppressExternalEdit(filePath: string, ttlMs = DEFAULT_SUPPRESS_TTL_MS): void {
  const norm = path.resolve(filePath)
  const now = Date.now()
  prunePaths(now)
  const until = now + ttlMs
  const cur = suppressedPaths.get(norm)
  if (cur === undefined) suppressedPaths.set(norm, { depth: 0, until })
  else cur.until = Math.max(cur.until, until)
}

/** Suppresses watcher-driven edit logging for `filePath` (refcounted) while `fn()` runs plus a `tailMs` FSEvents settle tail. */
export async function withSuppressedEdit<T>(filePath: string, fn: () => Promise<T>, tailMs = DEFAULT_SUPPRESS_TTL_MS): Promise<T> {
  const norm = path.resolve(filePath)
  const now = Date.now()
  prunePaths(now)
  const cur = suppressedPaths.get(norm) ?? { depth: 0, until: 0 }
  cur.depth += 1
  suppressedPaths.set(norm, cur)
  try {
    return await fn()
  } finally {
    const held = suppressedPaths.get(norm)
    if (held !== undefined) {
      held.depth = Math.max(0, held.depth - 1)
      held.until = Math.max(held.until, Date.now() + tailMs)
      if (held.depth === 0 && held.until <= Date.now()) suppressedPaths.delete(norm)
    }
  }
}

/** Suppresses watcher-driven edit logging for every file at or under `root` for `ttlMs`. */
export function suppressExternalRoot(root: string, ttlMs = DEFAULT_SUPPRESS_TTL_MS): void {
  const norm = path.resolve(root)
  const until = Date.now() + ttlMs
  const cur = suppressedRoots.get(norm)
  if (cur === undefined) suppressedRoots.set(norm, { depth: 0, until })
  else cur.until = Math.max(cur.until, until)
}

/** Suppresses watcher-driven edit logging for `root` (refcounted) while `fn()` runs plus a `tailMs` settle tail. */
export async function withSuppressedRoot<T>(root: string, fn: () => Promise<T>, tailMs = DEFAULT_SUPPRESS_TTL_MS): Promise<T> {
  const norm = path.resolve(root)
  const cur = suppressedRoots.get(norm) ?? { depth: 0, until: 0 }
  cur.depth += 1
  suppressedRoots.set(norm, cur)
  try {
    return await fn()
  } finally {
    const held = suppressedRoots.get(norm)
    if (held !== undefined) {
      held.depth = Math.max(0, held.depth - 1)
      held.until = Math.max(held.until, Date.now() + tailMs)
      if (held.depth === 0 && held.until <= Date.now()) suppressedRoots.delete(norm)
    }
  }
}

/** Whether `filePath` (or its `root` or any suppressed ancestor dir) is currently suppressed. */
export function isSuppressedExternalEdit(root: string, filePath: string, now = Date.now()): boolean {
  const normFile = path.resolve(filePath)
  const pathEntry = suppressedPaths.get(normFile)
  if (pathEntry !== undefined) {
    if (pathEntry.depth > 0 || pathEntry.until >= now) return true
    suppressedPaths.delete(normFile)
  }
  const normRoot = path.resolve(root)
  for (const [supRoot, entry] of suppressedRoots) {
    if (entry.depth === 0 && entry.until < now) {
      suppressedRoots.delete(supRoot)
      continue
    }
    if (supRoot === normRoot || normFile === supRoot || normFile.startsWith(supRoot + path.sep)) {
      if (entry.depth > 0 || entry.until >= now) return true
    }
  }
  return false
}

/** Test hook: clears all active path and root suppressions. */
export function _clearExternalEditSuppressions(): void {
  suppressedPaths.clear()
  suppressedRoots.clear()
}
