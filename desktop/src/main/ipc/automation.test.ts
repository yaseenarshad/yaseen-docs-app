import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { registerAutomationIpc } from './automation'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn() }, ipcMain: { handle: vi.fn() } }))
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
it('keeps ready across subframe and in-place loading; a new main document must handshake again', async () => {
  vi.useFakeTimers()
  const page = Object.assign(new EventEmitter(), { id: 7, send: vi.fn() })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: page }] as never)
  const windows = { idFor: (sender: unknown) => sender === page ? 'w1' : undefined } as WindowManager
  const host = registerAutomationIpc({} as Store, windows)
  const handler = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
  const ready = () => handler(CONTRACT.automation.ready.channel)({ sender: page } as never, true)
  const finish = async () => {
    const message = page.send.mock.calls.at(-1)![1]
    await handler(CONTRACT.automation.reply.channel)({ sender: page } as never, { id: message.id, ok: true, value: 'applied' })
  }
  await ready()
  const first = host.apply('w1', {})
  await finish(); expect(await first).toBe('applied')
  page.emit('did-start-navigation', { isSameDocument: false, isMainFrame: false })
  page.emit('did-start-loading')
  page.emit('did-start-navigation', { isSameDocument: true, isMainFrame: true })
  const second = host.apply('w1', {})
  const sent = page.send.mock.calls.length
  // Drain the request even on the old broken implementation, so the failing test leaves no timer.
  await ready(); await finish(); await second
  expect(sent).toBe(2)
  page.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true })
  const third = host.apply('w1', {})
  expect(page.send).toHaveBeenCalledTimes(2)
  await ready(); expect(page.send).toHaveBeenCalledTimes(3)
  await finish(); expect(await third).toBe('applied')
})
