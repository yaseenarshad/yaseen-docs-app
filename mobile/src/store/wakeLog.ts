/**
 * YAZ-5596 (15): a small wake log, so Yaseen can send proof of a freeze from the phone with no Mac. Each start of the
 * app and each return to it is one entry: when, how long the first sync pass took, how long the first storage call
 * took (and the slowest in the first 10 s), and any storage time limits. The last `WAKE_LOG_MAX` entries stay in local
 * storage (each read and write in try/catch: a private window or full storage only loses the log). Settings › Vault
 * health shows it, with Copy. No vault data and no token is in it.
 */
export interface WakeEntry {
  /** `start`: the app started (a cold start, also after iOS removed it while asleep). `return`: shown again. */
  kind: 'start' | 'return'
  /** When (ms since 1970). */
  at: number
  /** From the start or return to the end of the first sync pass (any end: synced, off, slowed, attention). */
  syncMs: number | null
  /** How the first sync pass ended. */
  syncEnd: string | null
  /** The first storage call after it, and the slowest in its first 10 s (ms). */
  storageMs: number | null
  slowestMs: number | null
  /** Storage calls that hit the time limit (YAZ-5596 item 1). */
  timeouts: number
}

export const WAKE_LOG_KEY = 'notecards-wake-log'
export const WAKE_LOG_MAX = 20
const WINDOW_MS = 10_000

let current: { entry: WakeEntry; from: number; syncing: boolean } | null = null
const now = () => performance.now()

export function readWakeLog(): WakeEntry[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(WAKE_LOG_KEY) ?? '[]')
    return Array.isArray(list) ? (list as WakeEntry[]) : []
  } catch {
    return []
  }
}

function save() {
  if (current === null) return
  try {
    const list = readWakeLog().filter((e) => e.at !== current!.entry.at)
    localStorage.setItem(WAKE_LOG_KEY, JSON.stringify([...list, current.entry].slice(-WAKE_LOG_MAX)))
  } catch {
    // No local storage (a private window, full): the log is lost, nothing else.
  }
}

function begin(kind: WakeEntry['kind']) {
  // `at` names the entry: never the same as the one before (two in the same ms).
  const at = Math.max(Date.now(), (readWakeLog().at(-1)?.at ?? 0) + 1)
  current = { entry: { kind, at, syncMs: null, syncEnd: null, storageMs: null, slowestMs: null, timeouts: 0 }, from: now(), syncing: false }
  save()
}

/** One storage call ended after `ms` (`timedOut`: at the time limit). The store calls it (`idbBackend`'s `onCall`). */
export function noteStorageCall(ms: number, timedOut: boolean): void {
  if (current === null) return
  const e = current.entry
  const inWindow = now() - ms - current.from < WINDOW_MS
  let changed = false
  if (timedOut) {
    e.timeouts++
    changed = true
  }
  if (inWindow) {
    const rounded = Math.round(ms)
    if (e.storageMs === null) {
      e.storageMs = rounded
      changed = true
    }
    // Written only when the slowest grows: the many quick calls after a return write nothing.
    if (e.slowestMs === null || rounded > e.slowestMs) {
      e.slowestMs = rounded
      changed = true
    }
  }
  if (changed) save()
}

/** The sync status changed: the end of the first pass after the start or return is kept. */
export function noteSyncStatus(status: string): void {
  if (current === null || current.entry.syncMs !== null) return
  if (status === 'syncing') current.syncing = true
  else if (current.syncing && status !== 'idle') {
    current.entry.syncMs = Math.round(now() - current.from)
    current.entry.syncEnd = status
    save()
  }
}

/** Starts the log: this start is an entry, and each return of the page (`visibilitychange` to visible) another. */
export function startWakeLog(doc: Pick<Document, 'visibilityState' | 'addEventListener'> = document): void {
  begin('start')
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') begin('return')
  })
}
