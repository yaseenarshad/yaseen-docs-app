import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { registerAutomationIpc } from './automation'

vi.mock('electron', () => ({
  app: { focus: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn() },
  ipcMain: { handle: vi.fn() },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      label: 'Primary',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 25, width: 1920, height: 1055 },
    })),
    getAllDisplays: vi.fn(() => [
      { id: 2, label: 'Left', bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 25, width: 1920, height: 1055 } },
      { id: 1, label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 25, width: 1920, height: 1055 } },
    ]),
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 200 })),
    getDisplayMatching: vi.fn((b: { x: number }) => ({ id: b.x < 0 ? 2 : 1 })),
  },
}))
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

it('wires displays, windowInfo, fullscreen-exiting moveWindow, focusWindow, minimizeWindow, closeWindow, and command (YAZ-6539)', async () => {
  const page = Object.assign(new EventEmitter(), { id: 12, send: vi.fn() })
  let bounds = { x: 100, y: 100, width: 1000, height: 700 }
  let minimized = true
  let fullscreen = true
  let focused = false
  const win = Object.assign(new EventEmitter(), {
    webContents: page,
    isDestroyed: () => false,
    isFocused: () => focused,
    isMinimized: () => minimized,
    isFullScreen: () => fullscreen,
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((next: typeof bounds) => { bounds = { ...next } }),
    setFullScreen: vi.fn((on: boolean) => {
      fullscreen = on
      if (!on) setTimeout(() => win.emit('leave-full-screen'), 5)
    }),
    restore: vi.fn(() => { minimized = false }),
    show: vi.fn(),
    focus: vi.fn(() => { focused = true }),
    minimize: vi.fn(() => { minimized = true }),
  })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never)
  const closeAutomationWindow = vi.fn(async () => 'closed' as const)
  const windows = {
    idFor: (sender: unknown) => sender === page ? 'w1' : undefined,
    closeAutomationWindow,
  } as unknown as WindowManager
  const host = registerAutomationIpc({} as Store, windows)

  // Displays: primary ordered first
  expect(host.displays!().map(d => d.id)).toEqual([1, 2])
  expect(host.displays!()[0].primary).toBe(true)
  expect(host.cursorPoint!()).toEqual({ x: 100, y: 200 })

  // windowInfo reflects ready state
  expect(host.windowInfo!('w1')).toEqual({ ready: false, focused: false, minimized: true, fullscreen: true, displayId: 1, bounds })
  await handler(CONTRACT.automation.ready.channel)({ sender: page } as never, true)
  expect(host.windowInfo!('w1')?.ready).toBe(true)

  // moveWindow exits fullscreen, restores minimized, sets bounds, and focuses when asked
  const moved = await host.moveWindow!('w1', { x: -960, y: 25, width: 960, height: 1055 }, true)
  expect(win.setFullScreen).toHaveBeenCalledWith(false)
  expect(win.restore).toHaveBeenCalledOnce()
  expect(win.setBounds).toHaveBeenCalledWith({ x: -960, y: 25, width: 960, height: 1055 }, false)
  expect(moved).toEqual({ displayId: 2, bounds: { x: -960, y: 25, width: 960, height: 1055 }, focused: true, exitedFullScreen: true })

  // minimizeWindow & focusWindow
  expect(host.minimizeWindow!('w1')).toBe(true)
  expect(win.minimize).toHaveBeenCalledOnce()
  expect(host.focusWindow!('w1')).toEqual({ focused: true, restored: true })
  if (process.platform === 'darwin') expect(app.focus).toHaveBeenCalledWith({ steal: true })

  // closeWindow forwards to closeAutomationWindow
  expect(await host.closeWindow!('w1', true)).toBe('closed')
  expect(closeAutomationWindow).toHaveBeenCalledWith('w1', true)

  // generalized command sends and resolves reply
  const cmd = host.command!('w1', { action: 'inspect' }, 2000)
  const sent = page.send.mock.calls.at(-1)![1]
  expect(sent.action).toBe('inspect')
  await handler(CONTRACT.automation.reply.channel)({ sender: page } as never, { id: sent.id, ok: true, value: { tabs: [] } })
  expect(await cmd).toEqual({ tabs: [] })
  expect(screen.getPrimaryDisplay).toHaveBeenCalled()
})

it('reports exitedFullScreen: false and detaches listeners when fullscreen exit times out (YAZ-6539)', async () => {
  vi.useFakeTimers()
  const page = Object.assign(new EventEmitter(), { id: 13, send: vi.fn() })
  let bounds = { x: 0, y: 0, width: 1200, height: 800 }
  const win = Object.assign(new EventEmitter(), {
    webContents: page,
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
    isFullScreen: () => true,
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((next: typeof bounds) => { bounds = { ...next } }),
    setFullScreen: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
  })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never)
  const host = registerAutomationIpc({} as Store, { idFor: (s: unknown) => s === page ? 'w1' : undefined } as unknown as WindowManager)

  const pending = host.moveWindow!('w1', { x: 0, y: 25, width: 960, height: 1055 }, false)
  await vi.advanceTimersByTimeAsync(3500)
  const res = await pending
  expect(res.exitedFullScreen).toBe(false)
  expect(win.listenerCount('leave-full-screen')).toBe(0)
  expect(win.listenerCount('closed')).toBe(0)
})

it('skips app.focus({ steal: true }) for App Shim windows on macOS while keeping it for host windows (YAZ-6625 #4)', async () => {
  const hostPage = Object.assign(new EventEmitter(), { id: 21, send: vi.fn() })
  const shimPage = Object.assign(new EventEmitter(), { id: 22, send: vi.fn() })
  const makeWin = (page: typeof hostPage) =>
    Object.assign(new EventEmitter(), {
      webContents: page,
      isDestroyed: () => false,
      isFocused: () => false,
      isMinimized: () => false,
      isFullScreen: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      minimize: vi.fn(),
    })
  const hostWin = makeWin(hostPage)
  const shimWin = makeWin(shimPage)
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([hostWin, shimWin] as never)

  const host = registerAutomationIpc(
    {} as Store,
    { idFor: (s: unknown) => (s === hostPage ? 'host-1' : s === shimPage ? 'shim-1' : undefined) } as unknown as WindowManager,
    (id) => id === 'shim-1',
  )

  host.focusWindow!('shim-1')
  expect(app.focus).not.toHaveBeenCalled()
  expect(shimWin.show).toHaveBeenCalledOnce()
  expect(shimWin.focus).toHaveBeenCalledOnce()

  await host.moveWindow!('shim-1', { x: 10, y: 25, width: 900, height: 700 }, true)
  expect(app.focus).not.toHaveBeenCalled()

  host.focusWindow!('host-1')
  if (process.platform === 'darwin') expect(app.focus).toHaveBeenCalledExactlyOnceWith({ steal: true })
  expect(hostWin.show).toHaveBeenCalledOnce()
  expect(hostWin.focus).toHaveBeenCalledOnce()
})
