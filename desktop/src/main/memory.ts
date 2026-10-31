/**
 * THE MEMORY METER (YAZ-3737 D1). Every `MEMORY_SAMPLE_MS` (30 s) main reads `app.getAppMetrics()` once and keeps, for each window,
 * a ring of its last `HISTORY` sizes (2 h): memory only, never stored, dropped when the window closes. Settings ›
 * Memory asks for a `report` (D9), and the window reload (6) reads the history.
 *
 * - A window = its renderer plus every frame process in its page (`framesInSubtree`: the draw.io and PDF frames).
 *   A process two windows share counts for the first one only, so the rows add up to the app.
 * - A Files window's preview popup is no row: it runs in its owner's process.
 * - App core = the main process, the GPU and utility processes, and any process no window owns (`other`).
 * - Code helpers = the language helpers' PIDs, read with `ps` only for a report: they are `spawn` children, not
 *   in `getAppMetrics`. None runs: no row.
 * - JS heap: each window's preload, only for a report (`ipc/memory.ts`). Nothing polls it.
 * - A window's tabs (YAZ-3934): its strip, each tab awake or asleep. The page tells main which sleep (`asleep` in a
 *   `window:set-identity` patch, kept by `WindowManager`). No size for each tab: all the tabs of a window share its heap.
 * - The memory reload (D4, D6): after each sample, `createReloadWatch` reloads a window that has stayed too big
 *   while nobody used it (`mayReload`), with each tab's page view kept for its next page.
 *
 * Electron-free: `main/index.ts` injects the host, so this runs under vitest with fakes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileKind } from '@shared/fileKind'
import type { FileKind, MemoryReport, MemoryWindowRow, StartView, StoredTab, WindowEntry } from '@shared/types'

/** 240 samples per window: 2 h at `MEMORY_SAMPLE_MS` (D1). */
export const HISTORY = 240
const MB = 1024 * 1024
/** "Growing" (D9, YAZ-3933): more than 150 MB, or more than 20 %, over the sample about 1 h ago. */
export const GREW_BYTES = 150 * MB
export const GREW_SHARE = 0.2
export const GREW_SPAN_MS = 60 * 60_000

/** The slice of `app.getAppMetrics()` the meter reads; `workingSetSize` is in KB. */
export interface MeterProcess {
  pid: number
  type: string
  memory: { workingSetSize: number }
}

/** The slice of a `BrowserWindow` the meter reads. */
export interface MeterWindow {
  isDestroyed(): boolean
  getTitle(): string
  webContents: { getOSProcessId(): number; mainFrame: { framesInSubtree: readonly { osProcessId: number }[] } }
}

/** What the meter reads of a window's entry, and the strip places of its tabs asleep now (`WindowManager.asleep`, YAZ-3934). */
export type MeterEntry = Pick<WindowEntry, 'id' | 'tabs' | 'tabStrip' | 'name'> & { asleep?: readonly number[] }

export interface MemoryHost<W extends MeterWindow> {
  metrics(): readonly MeterProcess[]
  /** Every `BrowserWindow`, preview popups too. */
  windows(): readonly W[]
  /** A Files window's preview popup (`previewPopups`). */
  isPreview(win: W): boolean
  /** The window's stored entry, with its sleeping tabs; undefined = no window of the app's own. */
  entryOf(win: W): MeterEntry | undefined
  /** The page's JS heap in use, in bytes; null = no answer. */
  jsHeap(win: W): Promise<number | null>
  /** The PIDs of the language helpers that run now (`LspPool.running()`). */
  helperPids(): readonly number[]
  /** The resident bytes of `pids` together (`helperRss`). */
  rss(pids: readonly number[]): Promise<number>
}

export interface MemorySample {
  t: number
  bytes: number
}

export interface MemoryMeter {
  /** One sample of every window into its ring (the 30 s timer of `main/index.ts`). Answers the ids it sampled. */
  sample(): string[]
  report(): Promise<MemoryReport>
  /** The window `id` closed: its history goes. */
  forget(id: string): void
  /** The window's ring, oldest first. */
  history(id: string): readonly MemorySample[]
}

/** The PIDs of a window's page: its renderer and every frame process. A page that crashed or is going has none. */
function pidsOf(win: MeterWindow): number[] {
  try {
    const wc = win.webContents
    return [wc.getOSProcessId(), ...wc.mainFrame.framesInSubtree.map((f) => f.osProcessId)]
  } catch {
    return []
  }
}

/** "Growing": `bytes` at the time `at` against the newest sample at least `GREW_SPAN_MS` older. A ring that is not 1 h old yet never grew (a new window grows while it loads). */
export function grewSince(ring: readonly MemorySample[], bytes: number, at: number): boolean {
  let ref: MemorySample | undefined
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].t <= at - GREW_SPAN_MS) {
      ref = ring[i]
      break
    }
  }
  return ref !== undefined && (bytes - ref.bytes > GREW_BYTES || bytes - ref.bytes > ref.bytes * GREW_SHARE)
}

const WORDS: readonly (readonly [FileKind | null, string, string])[] = [
  ['markdown', 'note', 'notes'],
  ['drawing', 'drawing', 'drawings'],
  ['diagram', 'diagram', 'diagrams'],
  ['pdf', 'PDF', 'PDFs'],
  ['image', 'image', 'images'],
  // A `text` tab is a code file: the app's word for it, as Settings › Code says (YAZ-3871).
  ['text', 'code file', 'code files'],
  [null, 'other file', 'other files'],
]

/** What a window has open, as "2 notes, 2 drawings"; '' with no tab. */
export function openText(tabs: readonly string[]): string {
  const kinds = tabs.map((path) => fileKind(path))
  return WORDS.flatMap(([kind, one, many]) => {
    const n = kinds.filter((k) => k === kind).length
    return n === 0 ? [] : [`${n} ${n === 1 ? one : many}`]
  }).join(', ')
}

/** A window's tabs for its row (YAZ-3934): the strip (else `tabs`), each marked asleep when its place is in `asleep`. */
function tabsOf(entry: MeterEntry): MemoryWindowRow['tabs'] {
  const asleep = new Set(entry.asleep)
  return (entry.tabStrip ?? entry.tabs.map((path): StoredTab => ({ path }))).map((t, i) => ({ path: t.path, ...(t.name === undefined ? {} : { name: t.name }), asleep: asleep.has(i) }))
}

const execFileP = promisify(execFile)

/** `ps -o rss= -p <pids>`: their resident bytes together. A helper that ended meanwhile counts 0 (ps exits 1 when none is left). */
export async function helperRss(pids: readonly number[]): Promise<number> {
  let out: string
  try {
    out = (await execFileP('ps', ['-o', 'rss=', '-p', pids.join(',')])).stdout
  } catch (err) {
    out = String((err as { stdout?: unknown }).stdout ?? '')
  }
  return out.split('\n').reduce((sum, line) => sum + (Number.parseInt(line, 10) || 0), 0) * 1024
}

export function createMemoryMeter<W extends MeterWindow>(host: MemoryHost<W>, now: () => number = Date.now): MemoryMeter {
  const rings = new Map<string, MemorySample[]>()

  /** Every window of the app's own with its size, and App core: what is left of `metrics`. */
  const measure = () => {
    const kb = new Map(host.metrics().map((p) => [p.pid, p] as const))
    const claimed = new Set<number>()
    const wins = host.windows().flatMap((win) => {
      if (win.isDestroyed() || host.isPreview(win)) return []
      const entry = host.entryOf(win)
      if (entry === undefined) return []
      let bytes = 0
      for (const pid of pidsOf(win)) {
        if (claimed.has(pid)) continue
        claimed.add(pid)
        bytes += (kb.get(pid)?.memory.workingSetSize ?? 0) * 1024
      }
      return [{ win, entry, bytes }]
    })
    const core = { bytes: 0, main: 0, gpu: 0, utility: 0, other: 0 }
    for (const p of kb.values()) {
      if (claimed.has(p.pid)) continue
      const bytes = p.memory.workingSetSize * 1024
      const part = p.type === 'Browser' ? 'main' : p.type === 'GPU' ? 'gpu' : p.type === 'Utility' ? 'utility' : 'other'
      core[part] += bytes
      core.bytes += bytes
    }
    return { wins, core }
  }

  const helpers = async (): Promise<MemoryReport['helpers']> => {
    const pids = host.helperPids().filter((pid) => pid > 0)
    if (pids.length === 0) return null
    return { bytes: await host.rss(pids).catch(() => 0), count: pids.length }
  }

  return {
    sample() {
      const t = now()
      return measure().wins.map(({ entry, bytes }) => {
        const ring = rings.get(entry.id) ?? []
        ring.push({ t, bytes })
        if (ring.length > HISTORY) ring.shift()
        rings.set(entry.id, ring)
        return entry.id
      })
    },
    async report() {
      const t = now()
      const { wins, core } = measure()
      const [heaps, helperRow] = await Promise.all([Promise.all(wins.map(({ win }) => host.jsHeap(win).catch(() => null))), helpers()])
      const rows = wins.map(({ win, entry, bytes }, i): MemoryWindowRow => ({
        id: entry.id,
        title: entry.name ?? win.getTitle(),
        open: openText(entry.tabs),
        bytes,
        jsHeapBytes: heaps[i],
        grew: grewSince(rings.get(entry.id) ?? [], bytes, t),
        tabs: tabsOf(entry),
      }))
      return { windows: rows, core, helpers: helperRow }
    },
    forget(id) {
      rings.delete(id)
    },
    history: (id) => rings.get(id) ?? [],
  }
}

// ---------- the memory reload (D4, D6) ----------

/**
 * A window reloads when each of its last `RELOAD_SAMPLES` samples (90 s) is over this many MB (D6). A constant: only
 * the switch is a setting. The demo and the perf harness may set it lower with `YASEEN_DOCS_RELOAD_MB`, read only under
 * `YASEEN_DOCS_E2E=1`, as `YASEEN_DOCS_TAB_SLEEP_SECONDS` is.
 */
export const RELOAD_MB = reloadMbFromEnv(process.env) ?? 1536

export function reloadMbFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const mb = Number(env.YASEEN_DOCS_RELOAD_MB)
  return env.YASEEN_DOCS_E2E === '1' && mb > 0 ? mb : undefined
}
export const RELOAD_SAMPLES = 3
/** A window reloads only when it lost the focus this long ago (D6). */
export const RELOAD_QUIET_MS = 60_000
/** At most one memory reload of a window in this time (D6). */
export const RELOAD_COOLDOWN_MS = 30 * 60_000

/** What `mayReload` looks at for one window. */
export interface ReloadFacts {
  /** `settings.memoryReload`. */
  on: boolean
  /** When it lost the focus (`WindowManager.blurredAt`); `null` = it has the focus. */
  blurredAt: number | null
  /** It is the window focused last (`focusOrder[0]`): the one the user comes back to. */
  lastFocused: boolean
  /** A tab move, pop-out, tear-off or held link push is in flight (S22, `WindowManager.busy`). */
  busy: boolean
  ring: readonly MemorySample[]
  /** Its last memory reload; `undefined` = none. */
  reloadedAt: number | undefined
}

/**
 * D6: the switch is on; the window does not have the focus, is not the one focused last, and lost the focus
 * `RELOAD_QUIET_MS` ago or more; nothing is in flight; no memory reload in `RELOAD_COOLDOWN_MS`; and its last
 * `RELOAD_SAMPLES` samples are all over `RELOAD_MB`. A hidden or minimized window can reload.
 */
export function mayReload(f: ReloadFacts, now: number): boolean {
  if (!f.on || f.blurredAt === null || f.lastFocused || f.busy || now - f.blurredAt < RELOAD_QUIET_MS) return false
  if (f.reloadedAt !== undefined && now - f.reloadedAt < RELOAD_COOLDOWN_MS) return false
  const last = f.ring.slice(-RELOAD_SAMPLES)
  return last.length === RELOAD_SAMPLES && last.every((s) => s.bytes > RELOAD_MB * MB)
}

export interface ReloadHost {
  /** `settings.memoryReload` now. */
  on(): boolean
  history(id: string): readonly MemorySample[]
  blurredAt(id: string): number | null
  lastFocused(): string | undefined
  busy(id: string): boolean
  /** Each tab's page view, in strip order (`askViews`); `null` = the page did not answer. */
  views(id: string): Promise<(StartView | null)[] | null>
  /** `WindowManager.memoryReload`: `true` = it reloaded. */
  reload(id: string, views: (StartView | null)[], mb: number): Promise<boolean>
}

export interface ReloadWatch {
  /** After a sample: reload each window of `ids` that `mayReload` allows. */
  check(ids: readonly string[]): void
  /** The window `id` closed: its last reload time goes, and a reload that runs keeps none. */
  forget(id: string): void
}

/**
 * The memory reload's watch (D4, D6): run after each sample. A window that may reload gives its tabs' page views first,
 * then reloads (flush; reload only when clean). A page that does not answer, or a flush that is not clean, leaves it as
 * it is, and the next sample tries again. Only a reload that ran starts the cooldown.
 */
export function createReloadWatch(host: ReloadHost, now: () => number = Date.now): ReloadWatch {
  /** The last memory reload of each window, until it closes. */
  const reloadedAt = new Map<string, number>()
  /** The windows whose reload runs now: a sample in the meantime does not start a second one. */
  const running = new Set<string>()
  return {
    check(ids) {
      const t = now()
      const last = host.lastFocused()
      for (const id of ids) {
        if (running.has(id)) continue
        const ring = host.history(id)
        if (!mayReload({ on: host.on(), blurredAt: host.blurredAt(id), lastFocused: id === last, busy: host.busy(id), ring, reloadedAt: reloadedAt.get(id) }, t)) continue
        running.add(id)
        const mb = Math.round(ring[ring.length - 1].bytes / MB)
        void host
          .views(id)
          .then((views) => (views === null ? false : host.reload(id, views, mb)))
          .then((reloaded) => {
            // A window that closed meanwhile (`forget`) keeps nothing.
            if (reloaded && running.has(id)) reloadedAt.set(id, now())
          })
          .catch(() => undefined)
          .finally(() => running.delete(id))
      }
    },
    forget(id) {
      reloadedAt.delete(id)
      running.delete(id)
    },
  }
}
