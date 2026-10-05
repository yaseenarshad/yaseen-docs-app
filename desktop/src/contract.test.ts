/**
 * THE CONTRACT IS COMPLETE (YAZ-2172, YAZ-2200; YAZ-2131 🔒 D9): every door in `CONTRACT` and `SPECIAL` has exactly
 * one main-side handler and exactly one preload exposure, of the right kind, and nothing outside
 * the table is wired. A refactor that drops a `register*` call or a preload line fails here instead
 * of as a renderer that waits forever. `preload/surface.test.ts` pins what each exposure does.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { ipcMain, ipcRenderer } from 'electron'
import { CONTRACT, leaves, SPECIAL } from '@shared/ipc'
import { registerIpc } from './main/ipc'
import { registerClipboardIpc } from './main/ipc/clipboard'
import { createStore } from './main/store'
import type { WindowManagerIpc } from './main/windows'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))

const doors = leaves(CONTRACT).map(([, door]) => door)
/** Renderer → main invokes: the table's, plus the two the preload's Copy as / Paste as fallback makes. */
const INVOKES = [...doors.filter((d) => d.kind === 'invoke').map((d) => d.channel), SPECIAL.menuCopyText.channel, SPECIAL.menuPasteTextFallback.channel].sort()
/** Main → renderer pushes: the table's, plus the watch events, the flush request and Copy as / Paste as. */
const PUSHES = [...doors.filter((d) => d.kind === 'push').map((d) => d.channel), SPECIAL.watchEvent, SPECIAL.appFlush, SPECIAL.menuCopyAs, SPECIAL.menuPasteAs].sort()
/** Renderer → main sends: watch (un)subscribe and the flush ack. */
const SENDS = [SPECIAL.watchSubscribe, SPECIAL.watchUnsubscribe, SPECIAL.appFlushed].sort()

const dir = await mkdtemp(path.join(tmpdir(), 'yd-contract-'))
afterAll(() => rm(dir, { recursive: true, force: true }))

it('main handles every invoke exactly once and listens on exactly the send channels', () => {
  // The two registrations `main/index.ts` makes on `ready`.
  registerClipboardIpc({ idFor: () => undefined }, { target: () => undefined, writeText: vi.fn(), rendererUrl: 'app://yaseen/index.html' })
  registerIpc(createStore(path.join(dir, 'yaseendocs.json')), {} as WindowManagerIpc)
  expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()).toEqual(INVOKES)
  expect(vi.mocked(ipcMain.on).mock.calls.map(([ch]) => ch).sort()).toEqual(SENDS)
})

it('the preload reaches every channel through exactly one exposure, of the right kind', async () => {
  const { bridge } = await import('./preload')
  /** channel → the kind of each preload use: `invoke`, `push` (subscribes) or `send`. */
  const uses = new Map<string, string[]>()
  const record = (kind: string, calls: unknown[][]) => {
    for (const [ch] of calls) uses.set(ch as string, [...(uses.get(ch as string) ?? []), kind])
  }
  const drain = () => {
    record('invoke', vi.mocked(ipcRenderer.invoke).mock.calls)
    record('push', vi.mocked(ipcRenderer.on).mock.calls)
    record('send', vi.mocked(ipcRenderer.send).mock.calls)
    vi.clearAllMocks()
  }
  /** The preload's own subscriptions (the flush handshake, paste, copy): made at load. */
  const pushHandler = (ch: string) => vi.mocked(ipcRenderer.on).mock.calls.find(([c]) => c === ch)![1] as (...args: unknown[]) => void
  const [onFlush, onPasteAs, onCopyAs] = [SPECIAL.appFlush, SPECIAL.menuPasteAs, SPECIAL.menuCopyAs].map(pushHandler)
  drain()

  // Every API method once: a listener for `on*`/`watch`, placeholder arguments for the rest.
  const walk = async (node: object): Promise<void> => {
    for (const [name, value] of Object.entries(node)) {
      if (typeof value !== 'function') {
        await walk(value as object)
        continue
      }
      const listener = () => undefined
      const out: unknown = /^on[A-Z]/.test(name) ? value(listener) : name === 'watch' ? value('/v', listener) : value([], [], [])
      if (typeof out === 'function') out()
      else await out
    }
  }
  await walk(bridge)
  drain()

  // The three channels the preload uses on its own: the paste fallback, copy, and the flush ack.
  onPasteAs(undefined, { mode: 'plain', text: 'x' })
  bridge.menu.onCopyAs(() => 'x')
  onCopyAs(undefined, 'plain')
  onFlush()
  await new Promise((r) => setTimeout(r, 0))
  drain()

  const expected = Object.fromEntries([...INVOKES.map((ch) => [ch, ['invoke']]), ...PUSHES.map((ch) => [ch, ['push']]), ...SENDS.map((ch) => [ch, ['send']])])
  expect(Object.fromEntries(uses)).toEqual(expected)
})
