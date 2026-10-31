import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import type { MemoryMeter } from '../memory'
import { handle } from './envelope'

/** A window that does not answer the heap ask in this time shows no JS heap (YAZ-3737 D1). */
export const HEAP_WAIT_MS = 1000

/** The heap asks in flight, by token: the window asked and how to answer. Each leaves on its answer or at `HEAP_WAIT_MS`. */
const asked = new Map<string, { wcId: number; done: (bytes: number | null) => void }>()

/**
 * The page's JS heap in use of the window `wc` (YAZ-3737 D1): main sends `memory:heap`, its preload answers with
 * `process.getHeapStatistics()`. Asked only for a report, never polled. `null` = no answer in `HEAP_WAIT_MS`.
 */
export function askHeap(wc: { id: number; send(channel: string, ...args: unknown[]): void }): Promise<number | null> {
  const token = randomUUID()
  return new Promise((resolve) => {
    const done = (bytes: number | null) => {
      clearTimeout(timer)
      asked.delete(token)
      resolve(bytes)
    }
    const timer = setTimeout(() => done(null), HEAP_WAIT_MS)
    asked.set(token, { wcId: wc.id, done })
    try {
      wc.send(SPECIAL.memoryHeap, token)
    } catch {
      done(null)
    }
  })
}

/** `memory.report` and the preloads' heap answers (YAZ-3737 D1). An answer counts only from the window it was asked of. */
export function registerMemoryIpc(meter: Pick<MemoryMeter, 'report'>): void {
  handle(CONTRACT.memory.report, () => meter.report())
  ipcMain.on(SPECIAL.memoryHeapReply, (e, msg: unknown) => {
    const { token, bytes } = (msg ?? {}) as { token?: unknown; bytes?: unknown }
    const ask = typeof token === 'string' ? asked.get(token) : undefined
    if (ask !== undefined && ask.wcId === e.sender.id) ask.done(typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null)
  })
}
