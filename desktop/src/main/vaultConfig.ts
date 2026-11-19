import { existsSync, unwatchFile, watch as fsWatch, watchFile as watchStat, type FSWatcher, type Stats } from 'node:fs'
import { lstat, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { keepUnknownKeys } from '@shared/configMerge'
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
 * A WATCH ON EACH FILE TOO (YAZ-5912): on macOS the folder watch is FSEvents, and with the Mac
 * busy FSEvents is seconds late or says nothing at all (measured: 0.5–6.5 s, and 3 of 6 writes
 * never heard). So every `*.json` file directly in the dotfolder also has its own `fs.watch` —
 * kqueue on macOS, 0–3 ms, one fd per file, a dozen files a vault. A write by rename (an agent's
 * tmp + rename, `atomicWrite`) gives the name a new inode, so the file's watch is opened again on
 * the name. A NEW file has no watch yet: the folder's mtime moves when a name comes or goes, so a
 * stat of the folder every `FOLDER_POLL_MS` finds it (also a folder that is not there yet) and
 * opens its watch. The folder watch stays as well; it is usually first.
 *
 * Echo policy: `writeConfig` notifies this process's subscribers synchronously (so every window
 * of the vault hears about a write from any of them), and the watchers' later echo of that same
 * write is dropped by mtime — the app's standard echo-suppression pattern (CONTRACTS.md,
 * multi-window). A genuinely external edit has a different mtime and notifies as usual,
 * debounced/deduped to one `{ root, name }` per file. The same mtime check makes the two
 * watches one: whichever hears a write first notifies, and the other's event for it is dropped.
 */

/**
 * Re-exported, not re-declared (YAZ-861): the name lives in `@shared/types`, one spelling for main
 * and the command line. This module owns the dotfolder, so it keeps naming it.
 */
export { VAULT_CONFIG_DIR }

const NOTIFY_DEBOUNCE_MS = 50
/** How long a file's own watch waits for quiet before it looks: a file written in pieces is read when whole. */
const FILE_SETTLE_MS = 50
/** How often the dotfolder itself is stat'ed for a new file (YAZ-5912): one stat, nothing read. */
const FOLDER_POLL_MS = 500

type Listener = (change: VaultConfigChange) => void

interface Entry {
  root: string
  /** `<root>/.yaseendocs`. */
  dir: string
  watcher: TreeWatcher
  listeners: Set<Listener>
  /**
   * name → the mtime the subscribers last heard of (an own write or an outside one), null once they heard it go. An
   * event that brings nothing new — the echo of an own write, the second watch's event for one write — is dropped.
   */
  heard: Map<string, number | null>
  /** name → the watch on that file itself (YAZ-5912), and its settle timer. */
  files: Map<string, FSWatcher>
  fileTimers: Map<string, ReturnType<typeof setTimeout>>
  /** The `*.json` names of the folder's last listing: only a name not in it is new. Null until the first listing. */
  listed: Set<string> | null
  closed: boolean
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

/**
 * `mkdir -p` the dotfolder lazily, then an atomic pretty-printed write; own subscribers notified synchronously.
 *
 * `known` (YAZ-5483): the top-level keys this writer owns. With it, every OTHER top-level key of the file on disk is
 * kept (`keepUnknownKeys`), so a Mac on an older build never erases a key a newer build added. A known key the value
 * leaves out is dropped as before ("the default is never stored"). Without it the value is written as is.
 */
export async function writeConfig(root: string, name: string, value: unknown, known?: readonly string[] | null): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requireConfigName(name)
  // The bridge sends an omitted argument as null (or undefined): both mean "no `known`".
  if (known != null && !(Array.isArray(known) && known.every((k) => typeof k === 'string'))) throw new BridgeFailure('BAD_REQUEST', "'known' must be a list of key names")
  let kept = value
  if (known != null) {
    const onDisk = await readConfigDetailed(r, n)
    if (onDisk.state === 'ok') kept = keepUnknownKeys(onDisk.value, value, known)
  }
  const content = configText(kept)
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
    entry.heard.set(n, mtime)
    watchFile(entry, n)
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
  const entry: Entry = { root, dir, watcher, listeners: new Set(), heard: new Map(), files: new Map(), fileTimers: new Map(), listed: null, closed: false, pending: new Set(), timer: null, anchored: existsSync(dir) }
  const onEvent = (p: string, stats?: Stats) => {
    // Only config files directly in the dotfolder count — atomicWrite tmp files and subdirs don't.
    if (path.dirname(p) !== dir || !p.endsWith('.json')) return
    const name = path.basename(p)
    if (stats !== undefined) watchFile(entry, name)
    schedule(entry, name, stats)
  }
  watcher
    .on('add', (p, stats) => onEvent(p, stats))
    .on('change', (p, stats) => onEvent(p, stats))
    .on('unlink', (p) => onEvent(p))
    .on('error', (err) => console.warn(`[vaultConfig] watcher error under ${dir}: ${String(err)}`))
  listFolder(entry)
  watchStat(dir, { persistent: false, interval: FOLDER_POLL_MS }, () => listFolder(entry))
  return entry
}

/** `name` changed (`stats`) or went (none): queued for the subscribers, unless they already heard of exactly this. */
function schedule(entry: Entry, name: string, stats?: Stats): void {
  const now = stats === undefined ? null : stats.mtimeMs
  if (entry.heard.get(name) === now) return // an own write's echo, or the other watch already told
  entry.heard.set(name, now)
  entry.pending.add(name)
  if (entry.timer !== null) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    const names = [...entry.pending]
    entry.pending.clear()
    for (const n of names) entry.listeners.forEach((l) => l({ root: entry.root, name: n }))
  }, NOTIFY_DEBOUNCE_MS)
}

/** Opens the watch on `<dotfolder>/name` itself (YAZ-5912), once. A file that is not there, or cannot be watched, is left to the folder watch. */
function watchFile(entry: Entry, name: string): void {
  if (entry.closed || entry.files.has(name)) return
  const file = path.join(entry.dir, name)
  let w: FSWatcher
  try {
    w = fsWatch(file, { persistent: false }, (type) => {
      if (type === 'rename') {
        // The name has a new inode now (a rename write) or none (a delete): this watch hears the old inode only.
        closeFile(entry, name, w)
        watchFile(entry, name)
      }
      settleFile(entry, name)
    })
  } catch {
    return
  }
  w.on('error', () => closeFile(entry, name, w))
  entry.files.set(name, w)
}

/**
 * Lists the folder: every `*.json` file gets its watch. One not in the last listing is new (or came back), and the
 * subscribers hear of it — but not on the first listing, which is what was there at the subscribe.
 */
function listFolder(entry: Entry): void {
  void readdir(entry.dir).then(
    (all) => all.filter((n) => n.endsWith('.json')),
    () => [] as string[],
  ).then((names) => {
    if (entry.closed) return
    const before = entry.listed
    entry.listed = new Set(names)
    for (const n of names) {
      watchFile(entry, n)
      if (before !== null && !before.has(n)) settleFile(entry, n)
    }
  })
}

function closeFile(entry: Entry, name: string, w: FSWatcher): void {
  w.close()
  if (entry.files.get(name) === w) entry.files.delete(name)
}

/** The file went quiet: what is on disk now is a change, or the file went. */
function settleFile(entry: Entry, name: string): void {
  clearTimeout(entry.fileTimers.get(name))
  entry.fileTimers.set(
    name,
    setTimeout(() => {
      entry.fileTimers.delete(name)
      void lstat(path.join(entry.dir, name)).then(
        (st) => {
          if (entry.closed || !st.isFile()) return
          watchFile(entry, name)
          schedule(entry, name, st)
        },
        () => {
          if (!entry.closed) schedule(entry, name)
        },
      )
    }, FILE_SETTLE_MS),
  )
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
      entry.closed = true
      if (entry.timer !== null) clearTimeout(entry.timer)
      entry.fileTimers.forEach(clearTimeout)
      entry.files.forEach((w) => w.close())
      entry.files.clear()
      unwatchFile(entry.dir)
      void entry.watcher.close()
    }
  }
}
