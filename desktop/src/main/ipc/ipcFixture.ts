/** The handler lookup the canvas panel's IPC tests share (YAZ-3038, ported from Draw). */
import { vi } from 'vitest'
import { ipcMain } from 'electron'
import type { Envelope } from '@shared/ipc'

/** A registered door as a test calls it: the invoke event first, then the renderer's arguments. */
export type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

/** The handler `door` registered on the mocked `ipcMain.handle` — every IPC test mocks `electron`. */
export function registered(door: { channel: string }): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}
