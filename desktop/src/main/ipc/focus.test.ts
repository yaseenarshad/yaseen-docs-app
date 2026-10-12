import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { focusFile } from '../focus'
import { createStore, type Store } from '../store'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { _resetMint, initMint, macId } from '../vaultIndex/mint'
import { registerFocusIpc } from './focus'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
}

const bounds = { x: 0, y: 0, width: 800, height: 600 }
const sender = { id: 1 }
const win = (id: string, root: string | null) => ({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds })

let dir: string
let vault: string
let store: Store
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-focus-ipc-'))
  vault = path.join(dir, 'vault')
  await mkdir(vault) // the root exists (an open vault always does); its dotfolder does not
  await writeFile(path.join(vault, 'a.md'), '# a\n')
  await writeFile(path.join(vault, 'b.md'), '# b\n')
  initMint(path.join(dir, 'app-data')) // this Mac, for the test: never the real app data folder
  store = createStore(path.join(dir, 'yaseendocs.json'))
  registerFocusIpc(store)
})
afterEach(async () => {
  for (const w of store.get().windows) store.removeWindow(w.id)
  await until(() => activeConfigWatcherRoots().length === 0)
  await store.flush()
  _resetMint()
  await rm(dir, { recursive: true, force: true })
})

describe('registerFocusIpc (YAZ-2702)', () => {
  it('registers exactly the focus channels the preload invokes', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CONTRACT.focus.get.channel, CONTRACT.focus.set.channel].sort())
  })

  it('get and set round-trip absolute paths through the envelope, into this Mac\'s file; bad arguments answer error envelopes', async () => {
    const a = path.join(vault, 'a.md')
    expect(await registered(CONTRACT.focus.get.channel)({ sender }, vault)).toEqual(ok([]))
    expect(await registered(CONTRACT.focus.set.channel)({ sender }, vault, [a])).toEqual(ok(undefined))
    expect(await registered(CONTRACT.focus.get.channel)({ sender }, vault)).toEqual(ok([a]))
    expect(await readdir(path.join(vault, VAULT_CONFIG_DIR))).toEqual([focusFile(await macId())])
    expect(await registered(CONTRACT.focus.get.channel)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.focus.set.channel)({ sender }, vault, 'a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.focus.set.channel)({ sender }, vault, [1])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.focus.set.channel)({ sender }, vault, ['/elsewhere/x.md'])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.focus.get.channel)({ sender }, vault)).toEqual(ok([a])) // none of the refusals wrote
  })

  it('broadcasts focus:changed { root } to every live window on an own write and on another Mac\'s file from a sync — and not on a write that changed nothing (R8, R12)', async () => {
    const a = fakeWindow()
    const b = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a, b] as unknown as BrowserWindow[])
    store.upsertWindow(win('w1', vault))
    expect(activeConfigWatcherRoots()).toEqual([vault]) // one watch for the open vault, dropped with its last window (afterEach)
    a.webContents.send.mockClear()
    b.webContents.send.mockClear()
    const pushes = (w: ReturnType<typeof fakeWindow>) => w.webContents.send.mock.calls.filter(([ch]) => ch === CONTRACT.focus.onChanged.channel)

    const list = [path.join(vault, 'a.md'), path.join(vault, 'b.md')]
    await registered(CONTRACT.focus.set.channel)({ sender }, vault, list)
    expect(pushes(a)).toEqual([[CONTRACT.focus.onChanged.channel, { root: vault }]])
    expect(pushes(b)).toEqual([[CONTRACT.focus.onChanged.channel, { root: vault }]])
    await registered(CONTRACT.focus.set.channel)({ sender }, vault, list)
    expect(pushes(a)).toHaveLength(1)

    await new Promise((r) => setTimeout(r, 300)) // let the watcher settle on the just-created dotfolder
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, focusFile('othermac0000')), JSON.stringify({ version: 1, at: '2099-01-01T00:00:00.000Z', focus: ['b.md'] }))
    await until(() => pushes(a).length > 1)
    expect(pushes(a).at(-1)).toEqual([CONTRACT.focus.onChanged.channel, { root: vault }])
    expect(await registered(CONTRACT.focus.get.channel)({ sender }, vault)).toEqual(ok([path.join(vault, 'b.md')]))
  })
})
