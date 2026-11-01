import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { DEFAULT_SETTINGS, MAX_CANVAS_CARDS, SIDEBAR_MAX_W, defaultRightPanelIdentity } from '@shared/types'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { registerStateIpc } from './state'

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

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow(opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}) {
  return {
    isDestroyed: () => opts.destroyed === true,
    webContents: { isDestroyed: () => opts.wcDestroyed === true, send: vi.fn() },
  }
}

let dir: string
let store: Store
const sender = { id: 1 }
/** The settings folder's two answers that the doors use (YAZ-3276): a test sets them. */
const folder = { missing: false, others: new Set<string>(), settled: async (): Promise<void> => undefined }
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-state-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  folder.missing = false
  folder.others = new Set()
  folder.settled = async () => undefined
  registerStateIpc(store, { missing: () => folder.missing, hasOtherMacs: async (dir) => folder.others.has(dir), settled: () => folder.settled() })
})
afterEach(async () => {
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('registerStateIpc', () => {
  it('registers every state channel the preload invokes (and nothing else)', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual(
      [CONTRACT.state.get.channel, CONTRACT.state.setSettings.channel, CONTRACT.state.setSidebarWidth.channel, CONTRACT.state.setFavoritesOrder.channel, CONTRACT.state.setFocusOrder.channel, CONTRACT.state.pushRecent.channel, CONTRACT.state.removeRecent.channel, CONTRACT.state.setFolder.channel, CONTRACT.state.setFolds.channel, CONTRACT.state.setTocFolds.channel, CONTRACT.state.setTocSource.channel, CONTRACT.state.setSectionIndent.channel, CONTRACT.state.setTocSwitch.channel, CONTRACT.state.setBaseGroups.channel, CONTRACT.state.settingsFolder.channel, CONTRACT.state.setSettingsFolder.channel, CONTRACT.state.setTabCanvas.channel, CONTRACT.state.systemHotkeys.channel, CONTRACT.hotkeys.recording.channel, CONTRACT.hotkeys.drawingInFront.channel].sort(),
    )
  })

  it('YAZ-3397 D6: a recorder starts and stops the menu\'s keys for its window; anything but a boolean is refused', async () => {
    const { hotkeyRecording } = await import('../hotkeyRecording')
    const recording = registered(CONTRACT.hotkeys.recording.channel)
    const wc = { id: 41, on: vi.fn(), once: vi.fn() }
    expect(await recording({ sender: wc }, true)).toEqual(ok(undefined))
    expect(hotkeyRecording.active()).toBe(true)
    expect(await recording({ sender: wc }, 'yes')).toEqual(bad('BAD_REQUEST'))
    expect(await recording({ sender: wc }, false)).toEqual(ok(undefined))
    expect(hotkeyRecording.active()).toBe(false)
  })

  it('YAZ-3276 D6: a folder with another Mac\'s file wins (0); an empty one takes this Mac\'s settings (now); null keeps the settings', async () => {
    const set = registered(CONTRACT.state.setSettingsFolder.channel)
    const ask = registered(CONTRACT.state.settingsFolder.channel)
    expect(await ask({ sender })).toEqual(ok({ folder: null, missing: false }))
    store.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }, 5)

    // An empty folder: this Mac's settings get a time newer than any file can have.
    const before = Date.now()
    expect(await set({ sender }, '/Sync/empty')).toEqual(ok(undefined))
    expect(store.get().settingsFolder).toBe('/Sync/empty')
    expect(store.get().settingsSavedAt).toBeGreaterThanOrEqual(before)

    // The same folder again is no change.
    const savedAt = store.get().settingsSavedAt
    expect(await set({ sender }, '/Sync/empty')).toEqual(ok(undefined))
    expect(store.get().settingsSavedAt).toBe(savedAt)

    // A folder that holds another Mac's file: 0, so that file is newer and wins.
    folder.others.add('/Sync/shared')
    expect(await set({ sender }, '/Sync/shared')).toEqual(ok(undefined))
    expect(store.get().settingsSavedAt).toBe(0)
    folder.missing = true
    expect(await ask({ sender })).toEqual(ok({ folder: '/Sync/shared', missing: true }))

    // Reset to default: the pointer goes, the settings stay.
    expect(await set({ sender }, null)).toEqual(ok(undefined))
    expect(store.get().settingsFolder).toBeNull()
    expect(store.get().settings.theme).toBe('dark')

    // YAZ-3297: the door answers only after the new folder's first read, so the row then asks for ITS `missing`.
    let done = (): void => undefined
    folder.settled = () => new Promise<void>((resolve) => (done = resolve))
    let answered = false
    const choosing = set({ sender }, '/Sync/next').then(() => (answered = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(answered).toBe(false)
    done()
    await choosing
    expect(answered).toBe(true)

    expect(await set({ sender }, 'relative/folder')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await set({ sender }, 42)).toEqual(bad('NOT_ABSOLUTE'))
  })

  it('state:get answers the current state', async () => {
    expect(await registered(CONTRACT.state.get.channel)({ sender })).toEqual(ok(store.get()))
  })

  it('state:set-settings takes a complete valid SettingsState and rejects anything else as BAD_REQUEST', async () => {
    const next = { ...DEFAULT_SETTINGS, lineSpacing: 2, threadColor: '#00aaff', contentWidth: 'full', startupWindows: 'none' }
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, next)).toEqual(ok(undefined))
    expect(store.get().settings).toEqual(next)
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, { ...DEFAULT_SETTINGS, lineSpacing: 'big' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, { ...DEFAULT_SETTINGS, contentWidth: 'wide' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, { ...DEFAULT_SETTINGS, confirmRename: 'no' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, { ...DEFAULT_SETTINGS, startupWindows: 'some' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, { lineSpacing: 1 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSettings.channel)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(store.get().settings).toEqual(next)
  })

  it('state:set-sidebar-width only takes a finite number, clamped', async () => {
    expect(await registered(CONTRACT.state.setSidebarWidth.channel)({ sender }, 9999)).toEqual(ok(undefined))
    expect(store.get().sidebarWidth).toBe(SIDEBAR_MAX_W)
    expect(await registered(CONTRACT.state.setSidebarWidth.channel)({ sender }, Number.NaN)).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setSidebarWidth.channel)({ sender }, '300')).toEqual(bad('BAD_REQUEST'))
    expect(store.get().sidebarWidth).toBe(SIDEBAR_MAX_W)
  })

  it.each([
    ['setFavoritesOrder', 'favoritesOrder'],
    ['setFocusOrder', 'focusOrder'],
  ] as const)('state.%s takes two lists of absolute paths and merges them into the one order, and into that order alone (YAZ-2631 D1; the focus order: YAZ-2702 Decision 3)', async (setter, key) => {
    const set = registered(CONTRACT.state[setter].channel)
    expect(await set({ sender }, ['/v/a', '/v/b'], ['/v/b/1.md', '/v/a/1.md'])).toEqual(ok(undefined))
    expect(store.get()[key]).toEqual(['/v/b/1.md', '/v/a/1.md'])
    expect(await set({ sender }, ['/v/a'], ['/v/a/1.md', 'a/2.md'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await set({ sender }, ['v/a'], ['/v/a/1.md'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await set({ sender }, ['/v/a'], '/v/a/1.md')).toEqual(bad('BAD_REQUEST'))
    expect(await set({ sender }, '/v/a', ['/v/a/1.md'])).toEqual(bad('BAD_REQUEST'))
    expect(await set({ sender }, ['/v/a'], ['/v/a/1.md', 5])).toEqual(bad('BAD_REQUEST'))
    expect(await set({ sender }, ['/v/a'], ['/v/a/1.md', ''])).toEqual(bad('BAD_REQUEST'))
    expect(store.get()[key]).toEqual(['/v/b/1.md', '/v/a/1.md'])
    expect(store.get()[key === 'focusOrder' ? 'favoritesOrder' : 'focusOrder']).toEqual([])
  })

  it('state:push-recent needs an absolute path', async () => {
    expect(await registered(CONTRACT.state.pushRecent.channel)({ sender }, '/v')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v'])
    expect(await registered(CONTRACT.state.pushRecent.channel)({ sender }, 'v')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.state.pushRecent.channel)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
  })

  it('state:remove-recent needs an absolute path and drops the entry (unknown path is a no-op)', async () => {
    store.pushRecent('/v', 1)
    store.pushRecent('/w', 2)
    expect(await registered(CONTRACT.state.removeRecent.channel)({ sender }, '/v')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/w'])
    expect(await registered(CONTRACT.state.removeRecent.channel)({ sender }, '/gone')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/w'])
    expect(await registered(CONTRACT.state.removeRecent.channel)({ sender }, 'v')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.state.removeRecent.channel)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
  })

  it('state:set-folder checks the root and the patch shape', async () => {
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { expanded: ['/v/sub'], lastFile: '/v/a.md' })).toEqual(ok(undefined))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, tocFolds: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { lastFile: null })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].lastFile).toBeNull()
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, 'v', {})).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { expanded: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { expanded: [1] })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { lastFile: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, tocFolds: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    // The vault's display name (YAZ-1974 D3): a string (cleaned by the store) or null, nothing else.
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { name: '  Business Wiki ' })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].name).toBe('Business Wiki')
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { name: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].name).toBe('Business Wiki')
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { name: null })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].name).toBeNull()
    // The vault's number (YAZ-2555 D2): a number (cleaned by the store) or null, nothing else.
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { key: 3 })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].key).toBe(3)
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { key: '4' })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].key).toBe(3)
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { key: null })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].key).toBeNull()
    // The focus list is the vault's, behind `focus.set` (YAZ-2702): here `focusList` is an unknown key, ignored like any other.
    expect(await registered(CONTRACT.state.setFolder.channel)({ sender }, '/v', { focusList: ['/v/sub'] })).toEqual(ok(undefined))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, tocFolds: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
  })

  it('state:set-folds checks root, file and keys', async () => {
    expect(await registered(CONTRACT.state.setFolds.channel)({ sender }, '/v', '/v/a.md', ['k1'])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].folds).toEqual({ '/v/a.md': ['k1'] })
    expect(await registered(CONTRACT.state.setFolds.channel)({ sender }, '/v', 'a.md', ['k1'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.state.setFolds.channel)({ sender }, '/v', '/v/a.md', 'k1')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setFolds.channel)({ sender }, '/v', '/v/a.md', [1])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setFolds.channel)({ sender }, '/v', '/v/a.md', [])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].folds).toEqual({})
  })

  it('state:set-toc-folds checks root, file and keys (YAZ-3939 D1)', async () => {
    const setTocFolds = registered(CONTRACT.state.setTocFolds.channel)
    expect(await setTocFolds({ sender }, '/v', '/v/a.md', ['2:Design#0'])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocFolds).toEqual({ '/v/a.md': ['2:Design#0'] })
    expect(await setTocFolds({ sender }, '/v', 'a.md', ['k'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await setTocFolds({ sender }, '/v', '/v/a.md', 'k')).toEqual(bad('BAD_REQUEST'))
    expect(await setTocFolds({ sender }, '/v', '/v/a.md', [])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocFolds).toEqual({})
  })

  it('state:set-toc-source checks root, file and source: `headings`, `bullets` or null, and no other word (YAZ-2700 D14)', async () => {
    const setTocSource = registered(CONTRACT.state.setTocSource.channel)
    expect(await setTocSource({ sender }, '/v', '/v/a.md', 'bullets')).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocSources).toEqual({ '/v/a.md': 'bullets' })
    expect(await setTocSource({ sender }, 'v', '/v/a.md', 'headings')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await setTocSource({ sender }, '/v', 'a.md', 'headings')).toEqual(bad('NOT_ABSOLUTE'))
    for (const junk of ['auto', 'Headings', '', 1, undefined, ['bullets']]) expect(await setTocSource({ sender }, '/v', '/v/a.md', junk)).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].tocSources).toEqual({ '/v/a.md': 'bullets' })
    // null is Auto: the entry goes.
    expect(await setTocSource({ sender }, '/v', '/v/a.md', null)).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocSources).toEqual({})
  })

  it('state:set-section-indent checks root, file and on: `true` or `false`, each stored, and nothing else — `null` is no way to remove the entry (YAZ-2709 D2)', async () => {
    const setSectionIndent = registered(CONTRACT.state.setSectionIndent.channel)
    expect(await setSectionIndent({ sender }, '/v', '/v/a.md', true)).toEqual(ok(undefined))
    expect(store.get().folders['/v'].sectionIndents).toEqual({ '/v/a.md': true })
    expect(await setSectionIndent({ sender }, 'v', '/v/a.md', true)).toEqual(bad('NOT_ABSOLUTE'))
    expect(await setSectionIndent({ sender }, '/v', 'a.md', true)).toEqual(bad('NOT_ABSOLUTE'))
    for (const junk of [null, undefined, 1, 0, 'true', '', [true]]) expect(await setSectionIndent({ sender }, '/v', '/v/a.md', junk)).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].sectionIndents).toEqual({ '/v/a.md': true })
    // Off is stored as `false`: the entry stays.
    expect(await setSectionIndent({ sender }, '/v', '/v/a.md', false)).toEqual(ok(undefined))
    expect(store.get().folders['/v'].sectionIndents).toEqual({ '/v/a.md': false })
  })

  it('state:set-toc-switch checks root, file and on: `true` or `false`, each stored, and nothing else (YAZ-2950)', async () => {
    const setTocSwitch = registered(CONTRACT.state.setTocSwitch.channel)
    expect(await setTocSwitch({ sender }, '/v', '/v/a.md', false)).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocSwitches).toEqual({ '/v/a.md': false })
    expect(await setTocSwitch({ sender }, 'v', '/v/a.md', false)).toEqual(bad('NOT_ABSOLUTE'))
    expect(await setTocSwitch({ sender }, '/v', 'a.md', false)).toEqual(bad('NOT_ABSOLUTE'))
    for (const junk of [null, undefined, 1, 0, 'false', '', [false]]) expect(await setTocSwitch({ sender }, '/v', '/v/a.md', junk)).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].tocSwitches).toEqual({ '/v/a.md': false })
    // On again is stored as `true`: the entry stays.
    expect(await setTocSwitch({ sender }, '/v', '/v/a.md', true)).toEqual(ok(undefined))
    expect(store.get().folders['/v'].tocSwitches).toEqual({ '/v/a.md': true })
  })

  it('state:set-base-groups checks root, key and collapsed', async () => {
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', '/v/a.md::T', ['v:idea'])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/a.md::T': ['v:idea'] })
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, 'v', '/v/a.md::T', ['v:idea'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', 5, ['v:idea'])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', '', ['v:idea'])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', '/v/a.md::T', 'v:idea')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', '/v/a.md::T', [1])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.state.setBaseGroups.channel)({ sender }, '/v', '/v/a.md::T', [])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].baseGroups).toEqual({})
  })

  it('broadcasts state:changed with the new state to every live window, skipping destroyed ones', async () => {
    const live = fakeWindow()
    const gone = fakeWindow({ destroyed: true })
    const halfGone = fakeWindow({ wcDestroyed: true })
    const other = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([live, gone, halfGone, other] as unknown as BrowserWindow[])
    await registered(CONTRACT.state.setSidebarWidth.channel)({ sender }, 321)
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith(CONTRACT.state.onChange.channel, store.get())
    expect(other.webContents.send).toHaveBeenCalledWith(CONTRACT.state.onChange.channel, store.get())
    expect(gone.webContents.send).not.toHaveBeenCalled()
    expect(halfGone.webContents.send).not.toHaveBeenCalled()
    // Direct store mutations (the window manager's upserts) broadcast too.
    store.removeWindow('nope') // no change → no broadcast
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    store.pushRecent('/v', 1)
    expect(live.webContents.send).toHaveBeenCalledTimes(2)
  })
})

describe('state:set-tab-canvas (YAZ-3343 D1)', () => {
  const card = { win: 'w1', path: '/v/a.md', copy: 0, by: 'folder', x: 1, y: 2 }
  beforeEach(() => {
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
  })

  it('applies a good patch in the store; unknown keys of a card are not stored', async () => {
    const set = registered(CONTRACT.state.setTabCanvas.channel)
    expect(await set({ sender }, { allWindows: true, set: [{ ...card, extra: 1 }] })).toEqual(ok(undefined))
    expect(store.get().tabCanvas).toEqual({ allWindows: true, snap: true, cards: [card], frames: [] })
    expect(await set({ sender }, { forget: [{ win: 'w1', path: '/v/a.md', copy: 0, by: 'folder' }] })).toEqual(ok(undefined))
    expect(store.get().tabCanvas).toEqual({ allWindows: true, snap: true, cards: [], frames: [] })
  })

  it('is strict: a bad patch, switch, list or ONE bad card rejects the whole call and stores nothing', async () => {
    const set = registered(CONTRACT.state.setTabCanvas.channel)
    for (const patch of [
      null,
      'patch',
      { allWindows: 'yes' },
      { set: card },
      { set: [card, { ...card, x: Number.NaN }] },
      { set: [{ ...card, path: 'a.md' }] },
      { set: [{ ...card, copy: -1 }] },
      { set: [{ ...card, by: 'grid' }] },
      { set: [{ ...card, win: '' }] },
      { forget: [{ win: 'w1', path: '/v/a.md', by: 'folder' }] },
      { set: Array.from({ length: MAX_CANVAS_CARDS + 1 }, () => card) },
    ]) expect(await set({ sender }, patch)).toEqual(bad('BAD_REQUEST'))
    expect(store.get().tabCanvas).toEqual({ allWindows: true, snap: true, cards: [], frames: [] })
  })
})
