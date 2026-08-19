import { watch, type FSWatcher } from 'chokidar'
import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { WatchEvent } from '@shared/types'
import { isMarkdown, isSkipped } from './fs-utils'

type Listener = (ev: WatchEvent) => void

interface Entry {
  watcher: FSWatcher
  listeners: Set<Listener>
  ready: boolean
}

/** One chokidar watcher per root, shared by every SSE client; closed when the last client leaves. */
const registry = new Map<string, Entry>()

export function activeWatcherRoots(): string[] {
  return [...registry.keys()]
}

function ignored(root: string, p: string, stats?: Stats): boolean {
  const rel = path.relative(root, p)
  if (rel === '') return false
  if (rel.split(path.sep).some(isSkipped)) return true
  return stats?.isFile() === true && !isMarkdown(p)
}

function createEntry(root: string): Entry {
  const watcher = watch(root, {
    ignoreInitial: true,
    alwaysStat: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (p: string, stats?: Stats) => ignored(root, p, stats),
  })
  const entry: Entry = { watcher, listeners: new Set(), ready: false }
  const emit = (ev: WatchEvent) => entry.listeners.forEach((l) => l(ev))
  const fileEvent = async (type: 'add' | 'change', p: string, stats?: Stats) => {
    if (!isMarkdown(p)) return
    const mtime = stats?.mtimeMs ?? (await stat(p).catch(() => undefined))?.mtimeMs
    if (mtime !== undefined) emit({ type, path: p, mtime })
  }
  watcher
    .on('ready', () => {
      entry.ready = true
      emit({ type: 'ready', root })
    })
    .on('add', (p, stats) => void fileEvent('add', p, stats))
    .on('change', (p, stats) => void fileEvent('change', p, stats))
    .on('unlink', (p) => isMarkdown(p) && emit({ type: 'unlink', path: p }))
    .on('addDir', (p) => p !== root && emit({ type: 'addDir', path: p }))
    .on('unlinkDir', (p) => p !== root && emit({ type: 'unlinkDir', path: p }))
    .on('error', (err) => emit({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
  return entry
}

/** Subscribes to events under `root`; returns an unsubscribe fn. Late joiners get `ready` immediately. */
export function subscribe(root: string, listener: Listener): () => void {
  let entry = registry.get(root)
  if (entry === undefined) {
    entry = createEntry(root)
    registry.set(root, entry)
  }
  entry.listeners.add(listener)
  if (entry.ready) listener({ type: 'ready', root })
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && registry.get(root) === entry) {
      registry.delete(root)
      void entry.watcher.close()
    }
  }
}
