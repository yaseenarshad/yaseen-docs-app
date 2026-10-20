import { existsSync, type Stats } from 'node:fs'
import path from 'node:path'
import { watchTree, type TreeWatcher } from './fs/treeWatcher'

/**
 * ONE FOLDER, WATCHED (YAZ-3038, ported from Draw) — the shape the canvas panel's stores in main use
 * (`library/mediaStore.ts`, `library/componentStore.ts`), written once so the four rules below cannot
 * drift apart between them:
 *
 *  - THE ENGINE. Docs' `fs/treeWatcher.ts`: nothing announced for what is already there
 *    (the caller reads on demand), an mtime with every add/change (the echo test needs it), and a
 *    file announced once it has settled rather than half-written. A folder that does not exist
 *    yet is waited for.
 *  - RE-ANCHORING. Only the engine's polling fallback can lose a folder — one that appears while it
 *    starts — so the FIRST write that creates the folder re-adds it (`noteOwnWrite` does this).
 *  - ECHO SUPPRESSION. A write this process made is announced to subscribers synchronously by the
 *    store itself; its watcher echo is dropped by mtime (`null` = an unlink this process caused).
 *  - DEBOUNCE. 50 ms, because one save touches two or three files and the subscriber only wants
 *    to know that something changed.
 */

const NOTIFY_DEBOUNCE_MS = 50

export interface WatchedFolder {
  /** Note a write this process just made, so its echo is dropped; `null` mtime = a delete. */
  noteOwnWrite(file: string, mtime: number | null): void
  /** Point at another folder; the old one goes quiet and every own-write note is dropped. */
  setFolder(next: string): void
  close(): Promise<void>
}

interface WatchedFolderOptions {
  dir: string
  /** 0 = the folder's own files; 1 = one level of subfolders too; omitted = every level. */
  depth?: number
  /** Log prefix, e.g. `media` — the only thing that differs between the stores' warnings. */
  tag: string
  /** Which paths are worth announcing; everything else (tmp files above all) is silence. */
  relevant(path: string, dir: string): boolean
  /** Called, debounced, after a change this process did not make. */
  onChange(paths: readonly string[]): void
  /** Paths to (re-)add once the watcher is ready — a subfolder the polling fallback lost during its start. */
  alsoWatch?(dir: string): readonly string[]
}

export function createWatchedFolder(opts: WatchedFolderOptions): WatchedFolder {
  let dir = opts.dir
  let watcher: TreeWatcher
  let ownWrites = new Map<string, number | null>()
  let anchored = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = new Set<string>()

  function start(): TreeWatcher {
    anchored = existsSync(dir)
    ownWrites = new Map()
    const watched = dir
    // Docs' engine has no depth option; a path deeper than `depth` is simply never looked at, on the
    // native engine and on the polling fallback alike.
    const depth = opts.depth
    const w = watchTree(watched, depth === undefined ? {} : { ignored: (p) => path.relative(watched, p).split(path.sep).length - 1 > depth })
    const schedule = (p: string, stats?: Stats) => {
      if (!opts.relevant(p, watched)) return
      const own = ownWrites.get(p)
      if (own !== undefined && (stats === undefined ? own === null : own === stats.mtimeMs)) {
        ownWrites.delete(p)
        return // the echo of this process's own write or delete
      }
      pending.add(p)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = [...pending]
        pending = new Set()
        opts.onChange(paths)
      }, NOTIFY_DEBOUNCE_MS)
    }
    w.on('add', schedule)
      .on('change', schedule)
      .on('unlink', (p) => schedule(p))
      .on('error', (err) => console.warn(`[${opts.tag}] watcher error under ${watched}: ${String(err)}`))
    const also = opts.alsoWatch?.(watched)
    if (also !== undefined && also.length > 0) w.on('ready', () => also.forEach((p) => w.add(p)))
    return w
  }

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = new Set()
  }

  watcher = start()

  return {
    noteOwnWrite(file, mtime) {
      // An entry is consumed by the echo it predicts; an echo that never arrives (a watcher that
      // missed it) would otherwise keep its note for the session. Clearing the lot at a generous
      // ceiling costs at most one spurious "something changed", which is a re-list.
      if (ownWrites.size > 256) ownWrites.clear()
      ownWrites.set(file, mtime)
      if (!anchored) {
        watcher.add(dir)
        anchored = true
      }
    },
    setFolder(next) {
      if (next === dir) return
      void watcher.close()
      stopTimer()
      dir = next
      watcher = start()
    },
    close() {
      stopTimer()
      return watcher.close()
    },
  }
}
