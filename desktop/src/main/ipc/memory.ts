import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { isRecord } from '@shared/guards'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import type { StartView } from '@shared/types'
import type { MemoryMeter } from '../memory'
import { handle } from './envelope'
import { optionalPageView } from './window'

/** A window that does not answer the heap ask in this time shows no JS heap (YAZ-3737 D1). */
export const HEAP_WAIT_MS = 1000
/** A window that does not answer the views ask in this time is hung: the memory reload waits for the next sample (YAZ-3737 D4). */
export const VIEWS_WAIT_MS = 1000

type Page = { id: number; send(channel: string, ...args: unknown[]): void }

/** The asks in flight, by token: the window asked and how to answer. Each leaves on its answer or at its wait. */
const asked = new Map<string, { wcId: number; done: (value: unknown) => void }>()

/** Main sends `channel` with a token to the page `wc` and resolves its preload's answer, or `null` after `wait`. */
function ask(wc: Page, channel: string, wait: number): Promise<unknown> {
  const token = randomUUID()
  return new Promise((resolve) => {
    const done = (value: unknown) => {
      clearTimeout(timer)
      asked.delete(token)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), wait)
    asked.set(token, { wcId: wc.id, done })
    try {
      wc.send(channel, token)
    } catch {
      done(null)
    }
  })
}

/** An answer counts only from the window it was asked of. */
function answer(e: { sender: { id: number } }, token: unknown, value: unknown): void {
  const pending = typeof token === 'string' ? asked.get(token) : undefined
  if (pending !== undefined && pending.wcId === e.sender.id) pending.done(value)
}

/**
 * The page's JS heap in use of the window `wc` (YAZ-3737 D1): main sends `memory:heap`, its preload answers with
 * `process.getHeapStatistics()`. Asked only for a report, never polled. `null` = no answer in `HEAP_WAIT_MS`.
 */
export async function askHeap(wc: Page): Promise<number | null> {
  const bytes = await ask(wc, SPECIAL.memoryHeap, HEAP_WAIT_MS)
  return typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null
}

/**
 * Each tab's page view of the window `wc`, in strip order (YAZ-3737 D4): main sends `window:views`, App answers through
 * the preload (`window.onViews`). A bad entry is `null` (that tab starts at its first view). `null` = no answer, or not a list.
 */
export async function askViews(wc: Page): Promise<(StartView | null)[] | null> {
  const views = await ask(wc, SPECIAL.windowViews, VIEWS_WAIT_MS)
  if (!Array.isArray(views)) return null
  return views.map((v) => {
    const view = isRecord(v) && typeof v.path === 'string' ? optionalPageView(v.view) : undefined
    return view === undefined ? null : { path: (v as { path: string }).path, view }
  })
}

/** `memory.report` and the preloads' answers (YAZ-3737 D1, D4). */
export function registerMemoryIpc(meter: Pick<MemoryMeter, 'report'>): void {
  handle(CONTRACT.memory.report, () => meter.report())
  ipcMain.on(SPECIAL.memoryHeapReply, (e, msg: unknown) => answer(e, (msg as { token?: unknown } | undefined)?.token, (msg as { bytes?: unknown } | undefined)?.bytes))
  ipcMain.on(SPECIAL.windowViewsReply, (e, msg: unknown) => answer(e, (msg as { token?: unknown } | undefined)?.token, (msg as { views?: unknown } | undefined)?.views))
}
