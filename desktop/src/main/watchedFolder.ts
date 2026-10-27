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
 *    starts — so the FIRST write that creates the folder re-adds it (`ownWrite` does this).
 *  - ECHO SUPPRESSION. A write this process made is announced to subscribers synchronously by the
 *    store itself; its watcher echo is dropped by mtime (`null` = an unlink this process caused).
 *    The engine can hear the write before it answers — its start-up walk, a slow `stat`, a trash
 *    that asks Finder — so an echo of a file under an own write waits for that write (YAZ-3431).
 *  - DEBOUNCE. 50 ms, because one save touches two or three files and the subscriber only wants
 *    to know that something changed.
 */

const NOTIFY_DEBOUNCE_MS = 50

export interface WatchedFolder {
  /**
   * Runs `write`, this process's own write of `file`, so its echo is dropped. `write` answers the
   * file's new mtime, `null` for a delete. One own write per file at a time (each store's chain).
   */
  ownWrite(file: string, write: () => Promise<number | null>): Promise<void>
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
  /** The echoes heard for a file while its own write runs, by file; looked at once it answers. */
  let writing = new Map<string, Array<Stats | undefined>>()
  let anchored = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = new Set<string>()
  let schedule: (p: string, stats?: Stats) => void

  function start(): TreeWatcher {
    anchored = existsSync(dir)
    ownWrites = new Map()
    writing = new Map()
    const watched = dir
    // Docs' engine has no depth option; a path deeper than `depth` is simply never looked at, on the
    // native engine and on the polling fallback alike.
    const depth = opts.depth
    const w = watchTree(watched, depth === undefined ? {} : { ignored: (p) => path.relative(watched, p).split(path.sep).length - 1 > depth })
    schedule = (p: string, stats?: Stats) => {
      if (!opts.relevant(p, watched)) return
      const held = writing.get(p)
      if (held !== undefined) return void held.push(stats)
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

  function noteOwnWrite(file: string, mtime: number | null): void {
    // An entry is consumed by the echo it predicts; an echo that never arrives (a watcher that
    // missed it) would otherwise keep its note for the session. Clearing the lot at a generous
    // ceiling costs at most one spurious "something changed", which is a re-list.
    if (ownWrites.size > 256) ownWrites.clear()
    ownWrites.set(file, mtime)
    if (!anchored) {
      watcher.add(dir)
      anchored = true
    }
  }

  return {
    async ownWrite(file, write) {
      const held: Array<Stats | undefined> = []
      const during = writing
      during.set(file, held)
      try {
        noteOwnWrite(file, await write())
      } finally {
        if (during.get(file) === held) during.delete(file)
        // Now the note says what this write left: its echo is dropped, anything else goes out. A
        // write that failed noted nothing, so all it held goes out. After `setFolder` the old folder is quiet.
        if (during === writing) held.forEach((stats) => schedule(file, stats))
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
