/**
 * PAGE TIMED-UNLOCK STORE (YAZ-6460 item 13): shares a Markdown page tab's active timed
 * "Allow edits" unlock (`useTimedUnlock`) with dependent surfaces for the same `path` —
 * specifically an inline drawing opened in its own tab (`InlineDrawingTab` via `useDocumentHost`)
 * — and lets dependents register a pre-lock flush (`registerPageUnlockFlush`) so edits in an open
 * inline drawing modal or sibling drawing tab are saved BEFORE the parent page relocks.
 *
 * Zero overhead:
 *  - Per-path listener sets: publishing an unlock for page A never notifies subscribers of page B.
 *  - Multi-tab safe: keyed by per-instance `symbol` token; a page is unlocked while ANY open tab
 *    of that path holds a non-null `until`, exposing `Math.max` (`Infinity` wins over finite ms).
 *  - In-memory, per renderer (same scope as `renameContinuity.ts` and `twinEditors.ts`).
 */
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'

type Listener = () => void
type FlushFn = () => Promise<unknown> | void

/** Active timed unlocks per page path: `path -> (token -> until)`. */
const unlocks = new Map<string, Map<symbol, number>>()
/** Cached effective max `until` per page path (absent = null), so reads are O(1). */
const effective = new Map<string, number>()
/** Per-path subscriber sets for `useSyncExternalStore`. */
const listeners = new Map<string, Set<Listener>>()
/** Pre-lock flush callbacks registered by dependent surfaces of `path`. */
const flushes = new Map<string, Set<FlushFn>>()

const NO_SUBSCRIBE = (): (() => void) => () => undefined
const NULL_SNAPSHOT = (): null => null

function maxUntil(entries: Map<symbol, number>): number {
  let best = -Infinity
  for (const u of entries.values()) {
    if (u > best) best = u
  }
  return best
}

function notify(path: string): void {
  const set = listeners.get(path)
  if (set === undefined) return
  for (const listener of [...set]) listener()
}

/** Reads the active timed-unlock deadline for `path` (max across open tabs), or `null` if locked. */
export function getPageUnlockUntil(path: string): number | null {
  return effective.get(path) ?? null
}

/**
 * Publishes (or clears when `until === null`) a tab's timed-unlock deadline for `path`.
 * Multiple tabs of the same `path` pass distinct `token` symbols; the page stays unlocked while
 * any tab holds a non-null `until`.
 */
export function publishPageUnlock(path: string, token: symbol, until: number | null): void {
  const prev = effective.get(path) ?? null
  let entries = unlocks.get(path)
  if (until === null) {
    if (entries !== undefined) {
      entries.delete(token)
      if (entries.size === 0) {
        unlocks.delete(path)
        effective.delete(path)
      } else {
        effective.set(path, maxUntil(entries))
      }
    }
  } else {
    if (entries === undefined) unlocks.set(path, (entries = new Map()))
    entries.set(token, until)
    effective.set(path, maxUntil(entries))
  }
  const next = effective.get(path) ?? null
  if (next !== prev) notify(path)
}

/** Subscribes to changes in `getPageUnlockUntil(path)`; returns the unsubscribe function. */
export function subscribePageUnlock(path: string, listener: Listener): () => void {
  let set = listeners.get(path)
  if (set === undefined) listeners.set(path, (set = new Set()))
  set.add(listener)
  return () => {
    const current = listeners.get(path)
    if (current === undefined) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(path)
  }
}

/**
 * React hook returning the active timed-unlock deadline for `path` (or `null`).
 * Pass `null` when inheritance is disabled so the hook does zero map lookups or subscriptions.
 */
export function usePageUnlockUntil(path: string | null): number | null {
  const subscribe = useCallback(
    (onStoreChange: Listener) => (path === null ? NO_SUBSCRIBE() : subscribePageUnlock(path, onStoreChange)),
    [path],
  )
  const getSnapshot = useCallback(() => (path === null ? NULL_SNAPSHOT() : getPageUnlockUntil(path)), [path])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Publishes a page editor's `until` to `pageUnlockStore` for its `path` and clears it on path
 * change or unmount without flickering `null` across `until` updates (e.g. extending 1m -> 10m).
 */
export function usePublishPageUnlock(path: string, until: number | null): void {
  const [token] = useState(() => Symbol('pageUnlock'))
  useLayoutEffect(() => {
    publishPageUnlock(path, token, until)
  }, [path, token, until])
  useLayoutEffect(() => () => publishPageUnlock(path, token, null), [path, token])
}

/** Registers a flush callback invoked before `path`'s timed unlock relocks; returns unregister. */
export function registerPageUnlockFlush(path: string, flush: FlushFn): () => void {
  let set = flushes.get(path)
  if (set === undefined) flushes.set(path, (set = new Set()))
  set.add(flush)
  return () => {
    const current = flushes.get(path)
    if (current === undefined) return
    current.delete(flush)
    if (current.size === 0) flushes.delete(path)
  }
}

/** Awaits every registered dependent flush for `path`, isolating errors so relock never hangs. */
export async function flushPageUnlockDependents(path: string): Promise<void> {
  const set = flushes.get(path)
  if (set === undefined || set.size === 0) return
  const tasks = [...set].map((fn) => {
    try {
      return Promise.resolve(fn())
    } catch {
      return Promise.resolve()
    }
  })
  await Promise.allSettled(tasks)
}

/** Test hook: clears all published unlocks, listeners, and flush callbacks. */
export function _resetPageUnlockStore(): void {
  unlocks.clear()
  effective.clear()
  listeners.clear()
  flushes.clear()
}
