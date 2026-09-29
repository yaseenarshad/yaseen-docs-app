/**
 * THE BRIDGE IS COMPLETE (YAZ-2131 1E, YAZ-2172): every channel in `channels.ts` has exactly one
 * main-side handler and exactly one preload exposure, of the right kind. `bridge.test.ts` pins the
 * preload's method names; this pins the wiring under them, so a refactor that drops a `register*`
 * call or a preload line fails here instead of as a renderer that waits forever. After the IPC
 * contract table lands (YAZ-2131 🔒 D9) this becomes its completeness test.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { ipcMain, ipcRenderer } from 'electron'
import { CH } from './channels'
import { registerIpc } from './main/ipc'
import { registerAgentIpc } from './main/ipc/agent'
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

/**
 * Which way each channel runs: renderer `invoke` → main `handle`, main → renderer `push`
 * (preload `on`), or renderer `send` → main `on`. Typed on the keys, so a new channel that is not
 * listed here fails typecheck.
 */
const KIND: Record<keyof typeof CH, 'invoke' | 'push' | 'send'> = {
  fsTree: 'invoke', fsRead: 'invoke', fsReadPdf: 'invoke', fsReadImage: 'invoke', fsWrite: 'invoke',
  fsCreateDir: 'invoke', fsCreateFile: 'invoke', fsIndex: 'invoke', fsColdDiff: 'invoke', fsReadAsset: 'invoke',
  fsWriteAsset: 'invoke', fsRename: 'invoke', fsDelete: 'invoke', fsClip: 'invoke', fsPaste: 'invoke',
  fsClipState: 'invoke', fileRepairRename: 'invoke', fileRenamed: 'push', fileDeleted: 'push', clipChanged: 'push',
  shellReveal: 'invoke', shellOpenVsCode: 'invoke', shellOpenDefault: 'invoke', shellOpenLink: 'invoke', shellAgentPrompt: 'invoke',
  dialogPickFolder: 'invoke',
  watchSubscribe: 'send', watchUnsubscribe: 'send', watchEvent: 'push',
  stateGet: 'invoke', stateSetSettings: 'invoke', stateSetSidebarWidth: 'invoke', statePushRecent: 'invoke', stateRemoveRecent: 'invoke',
  stateSetFolder: 'invoke', stateSetFolds: 'invoke', stateSetBaseGroups: 'invoke', stateChanged: 'push',
  windowIdentity: 'invoke', windowSetIdentity: 'invoke', windowOpen: 'invoke', windowDuplicate: 'invoke', windowOpenRecent: 'invoke',
  windowCloseSelf: 'invoke', windowZoom: 'invoke',
  menuPasteAs: 'push', menuCopyAs: 'push', menuCopyText: 'invoke', menuPasteTextFallback: 'invoke', menuOpenFolder: 'push',
  menuOpenRoot: 'push', menuSearch: 'push', menuSwitchVault: 'push', menuSettings: 'push', menuToggleSidebar: 'push',
  menuZoom: 'push', menuCloseTab: 'push', menuNextTab: 'push', menuPrevTab: 'push',
  linkOpenFile: 'push', linkNotice: 'push',
  vaultConfigRead: 'invoke', vaultConfigWrite: 'invoke', vaultConfigChanged: 'push',
  propertiesGet: 'invoke', propertiesSetProperty: 'invoke', propertiesRemoveProperty: 'invoke', propertiesChanged: 'push',
  favoritesGet: 'invoke', favoritesSet: 'invoke', favoritesChanged: 'push',
  githubStatus: 'invoke', githubSyncNow: 'invoke', githubSetEnabled: 'invoke', githubStatusChanged: 'push',
  appFlush: 'push', appFlushed: 'send',
}
const channelsOf = (kind: 'invoke' | 'push' | 'send') => (Object.keys(KIND) as (keyof typeof CH)[]).filter((k) => KIND[k] === kind).map((k) => CH[k]).sort()

const dir = await mkdtemp(path.join(tmpdir(), 'yd-channels-'))
afterAll(() => rm(dir, { recursive: true, force: true }))

it('main handles every invoke channel exactly once and listens on exactly the send channels', () => {
  // The three registrations `main/index.ts` makes on `ready`.
  registerClipboardIpc({ idFor: () => undefined }, { target: () => undefined, writeText: vi.fn(), rendererUrl: 'app://yaseen/index.html' })
  registerAgentIpc({ packaged: false, resourcesPath: dir, mainDir: dir })
  registerIpc(createStore(path.join(dir, 'yaseendocs.json')), {} as WindowManagerIpc)
  expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()).toEqual(channelsOf('invoke'))
  expect(vi.mocked(ipcMain.on).mock.calls.map(([ch]) => ch).sort()).toEqual(channelsOf('send'))
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
  const [onFlush, onPasteAs, onCopyAs] = [CH.appFlush, CH.menuPasteAs, CH.menuCopyAs].map(pushHandler)
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

  const expected = Object.fromEntries((Object.keys(KIND) as (keyof typeof CH)[]).map((k) => [CH[k], [KIND[k]]]))
  expect(Object.fromEntries(uses)).toEqual(expected)
})
