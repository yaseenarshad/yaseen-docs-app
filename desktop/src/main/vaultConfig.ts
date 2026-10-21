import { existsSync, type Stats } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { VAULT_CONFIG_DIR, type VaultConfigChange } from '@shared/types'
import { atomicWrite, BridgeFailure, createDurable, fsCall, requireAbsPath, toBridgeFailure } from './fs/fsUtils'
import { watchTree, type TreeWatcher } from './fs/treeWatcher'

/**
 * Vault-local config store (Desktop J, GRO-2188): JSON files in `<root>/.yaseendocs/`, the
 * `.obsidian/`-style dotfolder that travels with the vault. Electron-free, like `store.ts`.
 *
 * Lazy: reading never creates anything; the dotfolder appears on the first `writeConfig`
 * (`mkdir -p` + the `atomicWrite` tmp+rename idiom, pretty-printed JSON).
 *
 * Watching: the shared vault watcher (`fs/watchers.ts`) ignores every dot-entry by design, so
 * this module runs its own watch per root on the dotfolder (`fs/treeWatcher.ts`, YAZ-2192). The
 * engine waits for a not-yet-existing folder from its nearest ancestor, so the watcher is attached
 * at first subscribe whether or not the folder exists — it creates nothing, and an external
 * `mkdir .yaseendocs` + write by a sync tool is still picked up live. One caveat, for the engine's
 * chokidar polling fallback (network volumes): polling loses the path for good when the folder
 * appears DURING its initialisation, so the first `writeConfig` that creates the folder
 * re-`add()`s it once — the debounce absorbs any duplicate events after a re-add. Same lifecycle
 * idioms as `fs/watchers.ts`: one watcher per root, shared listener set, closed on the last
 * unsubscribe.
 *
 * Echo policy: `writeConfig` notifies this process's subscribers synchronously (so every window
 * of the vault hears about a write from any of them), and the watcher's later echo of that same
 * write is dropped by mtime — the app's standard echo-suppression pattern (CONTRACTS.md,
 * multi-window). A genuinely external edit has a different mtime and notifies as usual,
 * debounced/deduped to one `{ root, name }` per file.
 */

/**
 * Re-exported, not re-declared (YAZ-861): the name lives in `@shared/types`, one spelling for main
 * and the command line. This module owns the dotfolder, so it keeps naming it.
 */
export { VAULT_CONFIG_DIR }

const NOTIFY_DEBOUNCE_MS = 50

type Listener = (change: VaultConfigChange) => void

interface Entry {
  watcher: TreeWatcher
  listeners: Set<Listener>
  /** name → mtime of this process's last write, so the watcher echo of an own write is dropped. */
  ownMtimes: Map<string, number>
  /** Names with a watcher event waiting for the debounce flush. */
  pending: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  /** True once the dotfolder existed when the watcher (re-)anchored to it; see the init-race caveat above. */
  anchored: boolean
}

/** One watch per root's dotfolder, shared by every subscriber; closed when the last one leaves. */
const entries = new Map<string, Entry>()

export function activeConfigWatcherRoots(): string[] {
  return [...entries.keys()]
}

/** A config name is a plain `<stem>.json` basename: no separators, no `..`, nothing else. */
function requireConfigName(name: unknown): string {
  if (name === undefined || name === '') throw new BridgeFailure('BAD_REQUEST', "missing 'name'")
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new BridgeFailure('BAD_REQUEST', "'name' must be a plain file name", { path: String(name) })
  }
  if (!name.endsWith('.json') || name === '.json') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .json files live in .yaseendocs', { path: name })
  }
  return name
}

export type ConfigRead = { state: 'absent' } | { state: 'ok'; value: unknown } | { state: 'malformed'; error: string; file: string }

/**
 * Like `readConfig`, but distinguishes a missing file from malformed JSON and leaves the
 * reporting to the caller — the corrupt-file semantics layered on top need the difference
 * (absent → an empty result, malformed → error surfaced, mutations refused).
 * NEVER creates the folder.
 */
export async function readConfigDetailed(root: string, name: string): Promise<ConfigRead> {
  const dir = requireAbsPath(root, 'root')
  const file = path.join(dir, VAULT_CONFIG_DIR, requireConfigName(name))
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' }
    throw toBridgeFailure(err, file)
  }
  try {
    return { state: 'ok', value: JSON.parse(raw) as unknown }
  } catch (err) {
    return { state: 'malformed', error: String(err), file }
  }
}

/** Parsed `<root>/.yaseendocs/<name>`, or null when missing or malformed. NEVER creates the folder. */
export async function readConfig(root: string, name: string): Promise<unknown> {
  const res = await readConfigDetailed(root, name)
  if (res.state === 'ok') return res.value
  // Malformed config (half-synced file, hand edit) must not throw across IPC: warn once, act as absent.
  if (res.state === 'malformed') console.warn(`[vaultConfig] ${res.file} is not valid JSON: ${res.error}`)
  return null
}

/** The pretty-printed text a config file holds; a value JSON cannot hold is refused. */
function configText(value: unknown): string {
  const content: string | undefined = JSON.stringify(value, null, 2)
  if (content === undefined) throw new BridgeFailure('BAD_REQUEST', "'value' must be JSON-serialisable")
  return `${content}\n`
}

/** `mkdir -p` the dotfolder lazily, then an atomic pretty-printed write; own subscribers notified synchronously. */
export async function writeConfig(root: string, name: string, value: unknown): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requireConfigName(name)
  const content = configText(value)
  const dir = path.join(r, VAULT_CONFIG_DIR)
  const file = path.join(dir, n)
  const { mtime } = await fsCall(file, async () => {
    await mkdir(dir, { recursive: true })
    return atomicWrite(file, content)
  })
  announce(r, n, mtime)
}

/**
 * `writeConfig`, but only when the file does not exist (the Draw import, YAZ-3028 D6): it never
 * writes over a value, also one that appears while it runs (`createDurable` claims the name).
 * True when it made the file; false when one was there. Own subscribers hear it like a write.
 */
export async function createConfig(root: string, name: string, value: unknown): Promise<boolean> {
  const r = requireAbsPath(root, 'root')
  const n = requireConfigName(name)
  const content = configText(value)
  const dir = path.join(r, VAULT_CONFIG_DIR)
  const file = path.join(dir, n)
  const made = await fsCall(file, async () => {
    await mkdir(dir, { recursive: true })
    return createDurable(file, content).then(
      () => true,
      (err: NodeJS.ErrnoException) => (err.code === 'EEXIST' ? false : Promise.reject(err)),
    )
  })
  if (made) announce(r, n, (await stat(file)).mtimeMs)
  return made
}

/** Tells this process's subscribers of `root` about an own write of `name`, and keeps its watcher echo out. */
function announce(r: string, n: string, mtime: number): void {
  const dir = path.join(r, VAULT_CONFIG_DIR)
  const entry = entries.get(r)
  if (entry !== undefined) {
    entry.ownMtimes.set(n, mtime)
    if (!entry.anchored) {
      // The watcher attached while the folder was still missing; this write created it, possibly
      // during the watcher's initialisation (where polling loses the path for good). Re-anchor once.
      entry.watcher.add(dir)
      entry.anchored = true
    }
    entry.listeners.forEach((l) => l({ root: r, name: n }))
  }
}

function createEntry(root: string): Entry {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  const watcher = watchTree(dir)
  const entry: Entry = { watcher, listeners: new Set(), ownMtimes: new Map(), pending: new Set(), timer: null, anchored: existsSync(dir) }
  const schedule = (p: string, stats?: Stats) => {
    // Only config files directly in the dotfolder count — atomicWrite tmp files and subdirs don't.
    if (path.dirname(p) !== dir || !p.endsWith('.json')) return
    const name = path.basename(p)
    if (stats !== undefined && stats.mtimeMs === entry.ownMtimes.get(name)) return // echo of an own write
    entry.pending.add(name)
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const names = [...entry.pending]
      entry.pending.clear()
      for (const n of names) entry.listeners.forEach((l) => l({ root, name: n }))
    }, NOTIFY_DEBOUNCE_MS)
  }
  watcher
    .on('add', (p, stats) => schedule(p, stats))
    .on('change', (p, stats) => schedule(p, stats))
    .on('unlink', (p) => schedule(p))
    .on('error', (err) => console.warn(`[vaultConfig] watcher error under ${dir}: ${String(err)}`))
  return entry
}

/** Subscribes to config changes under `root`; returns an unsubscribe fn. Attaching creates nothing on disk. */
export function subscribeConfig(root: string, listener: Listener): () => void {
  const r = requireAbsPath(root, 'root')
  let entry = entries.get(r)
  if (entry === undefined) {
    entry = createEntry(r)
    entries.set(r, entry)
  }
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && entries.get(r) === entry) {
      entries.delete(r)
      if (entry.timer !== null) clearTimeout(entry.timer)
      void entry.watcher.close()
    }
  }
}
