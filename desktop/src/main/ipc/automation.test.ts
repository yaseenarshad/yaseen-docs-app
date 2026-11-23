import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { registerAutomationIpc } from './automation'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn() }, ipcMain: { handle: vi.fn() } }))
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
const handler = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]

it('keeps ready across subframe and in-place loading; a new main document must handshake again (YAZ-4552)', async () => {
  const page = Object.assign(new EventEmitter(), { id: 7, send: vi.fn() })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: page }] as never)
  const windows = { idFor: (sender: unknown) => sender === page ? 'w1' : undefined } as WindowManager
  const host = registerAutomationIpc({} as Store, windows)
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
  await ready(); await finish(); await second
  expect(sent).toBe(2)
  page.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true })
  const third = host.apply('w1', {})
  expect(page.send).toHaveBeenCalledTimes(2)
  await ready(); expect(page.send).toHaveBeenCalledTimes(3)
  await finish(); expect(await third).toBe('applied')
})

it('refuses a window that is not live, and waits until a start window is gone before it answers (YAZ-4565)', async () => {
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { id: 3 } })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never)
  const closeWindow = vi.fn((_id: string) => { setTimeout(() => win.emit('closed'), 20) })
  const windows = { idFor: (sender: unknown) => sender === win.webContents ? 'start' : undefined, closeWindow } as unknown as WindowManager
  const host = registerAutomationIpc({} as Store, windows)
  await expect(host.apply('gone', {})).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  let closed = false
  const closing = host.closeStartWindow!('start').then(value => { closed = true; return value })
  expect(closeWindow).toHaveBeenCalledWith('start')
  await new Promise(done => setTimeout(done, 5))
  expect(closed).toBe(false)
  expect(await closing).toBe(true)
  expect(await host.closeStartWindow!('gone')).toBe(false)
})

it('ignores a ready signal from a page that is no app window, and a malformed reply', async () => {
  const page = Object.assign(new EventEmitter(), { id: 9, send: vi.fn() })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: page }] as never)
  let id: string | undefined
  const host = registerAutomationIpc({} as Store, { idFor: () => id } as unknown as WindowManager)
  await handler(CONTRACT.automation.ready.channel)({ sender: page } as never, true)
  id = 'w1'
  const pending = host.apply('w1', {})
  expect(page.send).not.toHaveBeenCalled()
  await handler(CONTRACT.automation.ready.channel)({ sender: page } as never, true)
  const message = page.send.mock.calls[0][1]
  await handler(CONTRACT.automation.reply.channel)({ sender: page } as never, { id: message.id, ok: false })
  await handler(CONTRACT.automation.reply.channel)({ sender: page } as never, { id: message.id, ok: true, value: 'done' })
  expect(await pending).toBe('done')
})
