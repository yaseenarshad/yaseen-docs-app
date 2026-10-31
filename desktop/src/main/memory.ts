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
 *
 * Electron-free: `main/index.ts` injects the host, so this runs under vitest with fakes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileKind } from '@shared/fileKind'
import type { FileKind, MemoryReport, MemoryWindowRow, WindowEntry } from '@shared/types'

/** 240 samples per window: 2 h at `MEMORY_SAMPLE_MS` (D1). */
export const HISTORY = 240
const MB = 1024 * 1024
/** ▲ (D9): more than 150 MB, or more than 20 %, over the sample about 1 h ago. */
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

export interface MemoryHost<W extends MeterWindow> {
  metrics(): readonly MeterProcess[]
  /** Every `BrowserWindow`, preview popups too. */
  windows(): readonly W[]
  /** A Files window's preview popup (`previewPopups`). */
  isPreview(win: W): boolean
  /** The window's stored entry; undefined = no window of the app's own. */
  entryOf(win: W): Pick<WindowEntry, 'id' | 'tabs' | 'name'> | undefined
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
  /** One sample of every window into its ring (the 30 s timer of `main/index.ts`). */
  sample(): void
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

/** ▲: `bytes` at the time `at` against the newest sample at least `GREW_SPAN_MS` older. A ring that is not 1 h old yet never grew (a new window grows while it loads). */
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
  ['text', 'text file', 'text files'],
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
      for (const { entry, bytes } of measure().wins) {
        const ring = rings.get(entry.id) ?? []
        ring.push({ t, bytes })
        if (ring.length > HISTORY) ring.shift()
        rings.set(entry.id, ring)
      }
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
      }))
      return { windows: rows.sort((a, b) => b.bytes - a.bytes), core, helpers: helperRow }
    },
    forget(id) {
      rings.delete(id)
    },
    history: (id) => rings.get(id) ?? [],
  }
}
