import { ipcMain } from 'electron'
import type { BridgeError } from '@shared/types'
import type { Envelope } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'

/** The plain data the renderer rejects with: a `BridgeFailure`'s fields, anything else as IO_ERROR. */
export function toBridgeError(err: unknown): BridgeError {
  if (err instanceof BridgeFailure) {
    const out: BridgeError = { code: err.code, message: err.message }
    if (err.path !== undefined) out.path = err.path
    if (err.mtime !== undefined) out.mtime = err.mtime
    return out
  }
  return { code: 'IO_ERROR', message: err instanceof Error ? err.message : String(err) }
}

/**
 * `ipcMain.handle` with the envelope the preload unwraps: Electron strips custom props from a
 * thrown Error, so a structured `BridgeError` has to travel as a resolved value.
 */
export function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T>): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<Envelope<T>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: toBridgeError(err) }
    }
  })
}
