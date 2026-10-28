import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { MAX_FOLD_KEYS_PER_FILE, MAX_SESSIONS, MAX_VAULT_NAME, MAX_VAULT_SETS, MAX_WINDOW_ROOTS, defaultRightPanelIdentity, type PageView, type StartView, type TabRef, type WindowEntry, type WindowIdentity } from '@shared/types'
import { CONTRACT, SPECIAL, type Envelope } from '@shared/ipc'
import { createStore, type Store } from '../store'
import * as windows from '../windows'
import { MAX_CLOSE_REFS, registerWindowIpc } from './window'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })
const bounds = { x: 10, y: 20, width: 800, height: 600 }
const RIGHT = { open: true, width: 520, items: ['/v/right.md'], expanded: '/v/right.md' }
const entry: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', bounds }

let dir: string
let store: Store
let unregister: () => void
/** The manager slice the IPC layer drives: the real lookup, spies for the plumbing. */
let manager: {
  idFor: typeof windows.idFor
  openWindow: ReturnType<typeof vi.fn>
  duplicateWindow: ReturnType<typeof vi.fn>
  popOut: ReturnType<typeof vi.fn>
  moveTo: ReturnType<typeof vi.fn<(to: string, path: string) => boolean>>
  focusTab: ReturnType<typeof vi.fn<(to: string, ref: TabRef) => boolean>>
  closeTabs: ReturnType<typeof vi.fn<(to: string, refs: readonly TabRef[]) => boolean>>
  moveTab: ReturnType<typeof vi.fn<(from: string, to: string, ref: TabRef) => boolean>>
  setName: ReturnType<typeof vi.fn<(id: string, name: string | null) => boolean>>
  closeOther: ReturnType<typeof vi.fn<(id: string) => boolean>>
  setRoots: ReturnType<typeof vi.fn<(id: string, roots: readonly string[]) => boolean>>
  popOutTab: ReturnType<typeof vi.fn<(from: string, ref: TabRef) => boolean>>
  showWindow: ReturnType<typeof vi.fn<(id: string) => boolean>>
  hiddenWindows: ReturnType<typeof vi.fn<() => string[]>>
  minimizedWindows: ReturnType<typeof vi.fn<() => string[]>>
  highlightTab: ReturnType<typeof vi.fn<(to: string, ref: TabRef | null) => void>>
  tabAction: ReturnType<typeof vi.fn<(to: string, ref: TabRef, action: unknown) => boolean>>
  openBehind: ReturnType<typeof vi.fn<(from: WindowEntry) => string>>
  highlight: ReturnType<typeof vi.fn>
  openRecentBeside: ReturnType<typeof vi.fn>
  openAlone: ReturnType<typeof vi.fn>
  openVaultSet: ReturnType<typeof vi.fn>
  closeWindow: ReturnType<typeof vi.fn>
  handleFlushed: ReturnType<typeof vi.fn>
  handleLinkReady: ReturnType<typeof vi.fn>
  vaultNotice: ReturnType<typeof vi.fn>
  takeStartView: ReturnType<typeof vi.fn<(id: string) => StartView | undefined>>
  takeStartEmpty: ReturnType<typeof vi.fn<(id: string) => boolean>>
  takeStartCollapsed: ReturnType<typeof vi.fn<(id: string) => boolean>>
  openFilesWindow: ReturnType<typeof vi.fn<(from: string | undefined, root: string | null) => boolean>>
  openFromFiles: ReturnType<typeof vi.fn<(from: string, action: unknown) => boolean>>
  filesWide: ReturnType<typeof vi.fn<(id: string, open: boolean) => boolean>>
  filesPreview: ReturnType<typeof vi.fn<(id: string, req: unknown) => boolean>>
  setFilesZoom: ReturnType<typeof vi.fn<(id: string, percent: number) => boolean>>
  filesZoomMenu: ReturnType<typeof vi.fn<(id: string, open: boolean) => boolean>>
  filesToNormal: ReturnType<typeof vi.fn<(id: string) => boolean>>
}
/** `event.sender` stand-ins: webContents 1 is registered as window w1, webContents 9 is unknown. */
const sender = { id: 1 }
const stranger = { id: 9 }
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(ipcMain.on).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-window-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  store.upsertWindow(entry)
  unregister = windows.register({ webContents: sender }, 'w1')
  manager = { idFor: windows.idFor, openWindow: vi.fn(), duplicateWindow: vi.fn(), popOut: vi.fn(), moveTo: vi.fn(() => true), focusTab: vi.fn(() => true), closeTabs: vi.fn(() => true), moveTab: vi.fn(() => true), setName: vi.fn(() => true), closeOther: vi.fn(() => true), setRoots: vi.fn(() => true), popOutTab: vi.fn(() => true), showWindow: vi.fn(() => true), hiddenWindows: vi.fn(() => ['w9']), minimizedWindows: vi.fn(() => ['w2']), highlightTab: vi.fn(), tabAction: vi.fn(() => true), openBehind: vi.fn(() => 'w9'), highlight: vi.fn(), openRecentBeside: vi.fn(() => true), openAlone: vi.fn(() => true), openVaultSet: vi.fn(() => ({ opened: true, missing: [] })), closeWindow: vi.fn(), handleFlushed: vi.fn(), handleLinkReady: vi.fn(), vaultNotice: vi.fn(), takeStartView: vi.fn(() => undefined), takeStartEmpty: vi.fn(() => false), takeStartCollapsed: vi.fn(() => false), openFilesWindow: vi.fn(() => true), openFromFiles: vi.fn(() => true), filesWide: vi.fn(() => true), filesPreview: vi.fn(() => true), setFilesZoom: vi.fn(() => true), filesZoomMenu: vi.fn(() => true), filesToNormal: vi.fn(() => true) }
  registerWindowIpc(store, manager)
})
afterEach(async () => {
  unregister()
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('window lookup', () => {
  it('maps a webContents id to its window id until unregistered', () => {
    expect(windows.idFor(sender)).toBe('w1')
    expect(windows.idFor(stranger)).toBeUndefined()
    unregister()
    expect(windows.idFor(sender)).toBeUndefined()
    unregister = windows.register({ webContents: sender }, 'w1')
  })
})

describe('registerWindowIpc', () => {
  it('registers every window channel the preload invokes, `link:ready` and the paste fallback (and nothing else)', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CONTRACT.window.identity.channel, CONTRACT.window.setIdentity.channel, CONTRACT.window.open.channel, CONTRACT.window.duplicate.channel, CONTRACT.window.popOut.channel, CONTRACT.window.moveTo.channel, CONTRACT.window.focusTab.channel, CONTRACT.window.closeTabs.channel, CONTRACT.window.moveTab.channel, CONTRACT.window.setName.channel, CONTRACT.window.closeOther.channel, CONTRACT.window.openBehind.channel, CONTRACT.window.setRoots.channel, CONTRACT.window.popOutTab.channel, CONTRACT.window.showWindow.channel, CONTRACT.window.hiddenWindows.channel, CONTRACT.window.minimizedWindows.channel, CONTRACT.window.highlightTab.channel, CONTRACT.window.tabAction.channel, CONTRACT.window.highlight.channel, CONTRACT.window.openRecent.channel, CONTRACT.window.openAlone.channel, CONTRACT.window.noteClosed.channel, CONTRACT.window.forgetClosed.channel, CONTRACT.window.openSet.channel, CONTRACT.window.saveSet.channel, CONTRACT.window.renameSet.channel, CONTRACT.window.removeSet.channel, CONTRACT.window.saveSession.channel, CONTRACT.window.restoreSession.channel, CONTRACT.window.renameSession.channel, CONTRACT.window.setSessionTabs.channel, CONTRACT.window.removeSession.channel, CONTRACT.window.closeSelf.channel, CONTRACT.window.openFiles.channel, CONTRACT.window.openFromFiles.channel, CONTRACT.window.filesWide.channel, CONTRACT.window.filesPreview.channel, CONTRACT.window.filesToNormal.channel, CONTRACT.window.filesZoom.channel, CONTRACT.window.filesZoomMenu.channel, CONTRACT.link.ready.channel, SPECIAL.menuPasteTextFallback.channel].sort())
  })

  it('native paste fallback inserts the captured text into only the registered sender', async () => {
    const target = { ...sender, insertText: vi.fn(async () => undefined) }
    expect(await registered(SPECIAL.menuPasteTextFallback.channel)({ sender: target }, '# literal\nline')).toEqual(ok(undefined))
    expect(target.insertText).toHaveBeenCalledExactlyOnceWith('# literal\nline')
    expect(await registered(SPECIAL.menuPasteTextFallback.channel)({ sender: target }, '')).toEqual(ok(undefined))
    expect(target.insertText).toHaveBeenCalledTimes(1)
    expect(await registered(SPECIAL.menuPasteTextFallback.channel)({ sender: stranger }, 'text')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(SPECIAL.menuPasteTextFallback.channel)({ sender: target }, { text: 'bad' })).toEqual(bad('BAD_REQUEST'))
    expect(target.insertText).toHaveBeenCalledTimes(1)
  })

  it('window:identity answers the complete per-window identity for a registered sender', async () => {
    expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(ok({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files' }))
  })

  it('window:identity rejects an unregistered sender (BAD_REQUEST) and a window the state no longer has (NOT_FOUND)', async () => {
    expect(await registered(CONTRACT.window.identity.channel)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(bad('NOT_FOUND'))
  })

  it('window:set-identity merges root / file into the entry, keeping id and bounds; tabs follow the invariant', async () => {
    // file → null clears tabs (tabs [] ⇔ file null); a new file not in tabs is prepended.
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { root: '/other', file: null })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', roots: ['/other'], file: null, tabs: [], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', bounds }])
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { file: '/other/b.md' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', roots: ['/other'], file: '/other/b.md', tabs: ['/other/b.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', bounds }])
    // Unknown keys cannot touch id / bounds.
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { id: 'hijack', bounds: { x: 0, y: 0, width: 1, height: 1 } })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', roots: ['/other'], file: '/other/b.md', tabs: ['/other/b.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', bounds }])
  })

  it('window:set-identity accepts a tabs patch: de-duplicated, and the active file is prepended when missing (GRO-2232)', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { tabs: ['/v/a.md', '/v/b.md', '/v/a.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md'])
    // The invariant holds on the entry AS WRITTEN: a tabs patch missing the untouched active file repairs by prepending.
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { tabs: ['/v/b.md', '/v/c.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    // file and tabs patched together: the new file leads.
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { file: '/v/b.md', tabs: ['/v/b.md', '/v/c.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0]).toEqual({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/b.md', tabs: ['/v/b.md', '/v/c.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', bounds })
  })

  it('window:set-identity accepts one complete right-panel patch and enforces main/right exclusivity', async () => {
    const rightPanel = { open: true, width: 600, items: ['/v/a.md', '/v/b.md', '/v/b.md'], expanded: '/v/a.md' }
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { rightPanel })).toEqual(ok(undefined))
    expect(store.get().windows[0].rightPanel).toEqual({ open: true, width: 600, items: ['/v/b.md'], expanded: null })
  })

  it('window:set-identity rejects incomplete or malformed right-panel patches atomically', async () => {
    for (const rightPanel of [
      { open: true, width: 440, items: [] },
      { open: true, width: '440', items: [], expanded: null },
      { open: true, width: 440, items: ['relative.md'], expanded: null },
      { open: true, width: 440, items: [], expanded: 3 },
    ]) {
      expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { rightPanel })).toEqual(bad(rightPanel.items[0] === 'relative.md' ? 'NOT_ABSOLUTE' : 'BAD_REQUEST'))
    }
    expect(store.get().windows[0]).toEqual(entry)
  })

  it('window:set-identity validates and patches sidebar visibility without changing other identity or bounds', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarCollapsed: true })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarCollapsed: true }])
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarCollapsed: 'true' })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().windows).toEqual([{ ...entry, sidebarCollapsed: true }])
  })

  it('window:set-identity validates and patches the lens, and identity reads it back (YAZ-1628; the `focus` tab, YAZ-2619 S33)', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'focus' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'focus' }])
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'favorites' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'favorites' }])
    expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(ok({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'favorites' }))
    // The Sessions tab is a stored lens too (YAZ-3147 D4, S35).
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'sessions' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'sessions' }])
    // And the Recents tab (YAZ-3235 D4, S13).
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'recents' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'recents' }])
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'favorites' })).toEqual(ok(undefined))
    // A value that is not a tab is refused, and the message names the five stored tabs.
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'nope' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: "'sidebarLens' must be 'files', 'focus', 'favorites', 'sessions' or 'recents'" }) })
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 1 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { sidebarLens: 'topics' })).toEqual(bad('BAD_REQUEST')) // the retired lens (YAZ-2290)
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'favorites' }])
  })

  it('window:set-identity holds no focus list: the list is the vault\'s, behind `focus.set` (YAZ-2702 Decision 1) — a `focusList` in a patch is an unknown key, and neither the entry nor window:identity gains it', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { focusList: ['/v/a', '/v/b.md'], sidebarCollapsed: true })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarCollapsed: true }])
    expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(ok({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: true, sidebarLens: 'files' }))
  })

  describe('the vault list (YAZ-2602 D1, S76)', () => {
    const set = (patch: unknown) => registered(CONTRACT.window.setIdentity.channel)({ sender }, patch)
    const stored = () => store.get().windows[0]

    it('window:set-identity accepts `roots`: `root` follows roots[0], nothing else of the identity moves, and window:identity reads a COPY back', async () => {
      expect(await set({ roots: ['/v', '/w'] })).toEqual(ok(undefined))
      expect(store.get().windows).toEqual([{ ...entry, roots: ['/v', '/w'] }]) // the tabs, the panel and the lens stay
      // A new first vault: `root` follows it. One vault under two spellings is one entry.
      expect(await set({ roots: ['/w', '/v/', '/w/', '/x'] })).toEqual(ok(undefined))
      expect(stored()).toEqual({ ...entry, root: '/w', roots: ['/w', '/v', '/x'] })
      // The list leads: a `root` beside it in the patch does not decide.
      expect(await set({ root: '/x', roots: ['/v', '/w'] })).toEqual(ok(undefined))
      expect(stored()).toEqual({ ...entry, roots: ['/v', '/w'] })
      const read = await registered(CONTRACT.window.identity.channel)({ sender })
      expect(read).toEqual(ok(expect.objectContaining({ root: '/v', roots: ['/v', '/w'] })))
      if (!read.ok) throw new Error('expected ok')
      expect((read.value as WindowIdentity).roots).not.toBe(stored().roots)
      // The empty list is the Welcome window.
      expect(await set({ roots: [] })).toEqual(ok(undefined))
      expect(stored()).toMatchObject({ root: null, roots: [] })
    })

    it('window:set-identity with `root` alone (the old patch): the SAME root keeps the list, a DIFFERENT root is the whole list, and null is no vault (S76 as amended, A10)', async () => {
      await set({ roots: ['/v', '/w'] })
      expect(await set({ root: '/v' })).toEqual(ok(undefined))
      expect(stored()).toMatchObject({ root: '/v', roots: ['/v', '/w'] })
      expect(await set({ file: '/w/b.md', sidebarCollapsed: true })).toEqual(ok(undefined)) // a patch that names neither leaves both
      expect(stored()).toMatchObject({ root: '/v', roots: ['/v', '/w'] })
      expect(await set({ root: '/w' })).toEqual(ok(undefined)) // the window's SECOND vault is still a different root
      expect(stored()).toMatchObject({ root: '/w', roots: ['/w'] })
      await set({ roots: ['/w', '/v'] })
      expect(await set({ root: null })).toEqual(ok(undefined))
      expect(stored()).toMatchObject({ root: null, roots: [] })
    })

    it('window:set-identity rejects the whole call on a bad `roots`, leaving the entry untouched: not a list, one bad element, or more than MAX_WINDOW_ROOTS', async () => {
      const vaults = (n: number) => Array.from({ length: n }, (_, i) => `/v${i}`)
      expect(await set({ roots: '/w' })).toEqual(bad('BAD_REQUEST'))
      expect(await set({ roots: ['/v', 'rel'], sidebarCollapsed: true })).toEqual(bad('NOT_ABSOLUTE')) // the `tabs` rule
      expect(await set({ roots: ['/v', 5] })).toEqual(bad('NOT_ABSOLUTE'))
      expect(await set({ roots: ['/v', ''] })).toEqual(bad('BAD_REQUEST'))
      expect(await set({ roots: vaults(MAX_WINDOW_ROOTS + 1), sidebarCollapsed: true })).toEqual(bad('BAD_REQUEST'))
      expect(store.get().windows).toEqual([entry])
      expect(await set({ roots: vaults(MAX_WINDOW_ROOTS) })).toEqual(ok(undefined)) // 8 is the most a window holds (R7)
      expect(stored().roots).toEqual(vaults(MAX_WINDOW_ROOTS))
    })
  })

  describe('the open history (YAZ-2663 D1, R2)', () => {
    const T = 1_700_000_000_000
    const set = (patch: unknown) => registered(CONTRACT.window.setIdentity.channel)({ sender }, patch)
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(T)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('S1, S2: a page comes on show → its vault\'s record gets one use and the time, in ONE commit with the window; a trip to another tab\'s page is one use of that page; a page in no vault of the window adds nothing', async () => {
      let commits = 0
      store.onChange(() => commits++)
      // S1: a click in the sidebar puts `b.md` on show in a new tab.
      expect(await set({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md' })).toEqual(ok(undefined))
      expect(commits).toBe(1)
      expect(store.get().windows[0]).toMatchObject({ file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'] })
      expect(store.get().folders['/v'].opens).toEqual({ '/v/b.md': { score: 1, last: T } })
      // S2: a trip to the other tab, then back.
      vi.setSystemTime(T + 5)
      await set({ file: '/v/a.md' })
      expect(store.get().folders['/v'].opens).toEqual({ '/v/b.md': { score: 1, last: T }, '/v/a.md': { score: 1, last: T + 5 } })
      vi.setSystemTime(T + 9)
      await set({ file: '/v/b.md' })
      const again = store.get().folders['/v'].opens['/v/b.md']
      expect(again.last).toBe(T + 9)
      expect(again.score).toBeCloseTo(2, 6)
      // A page of the window's second vault goes in the record of that vault; a page no vault holds goes in none.
      await set({ roots: ['/v', '/w'] })
      await set({ file: '/w/c.md' })
      await set({ file: '/else/d.md' })
      expect(store.get().folders['/w'].opens).toEqual({ '/w/c.md': { score: 1, last: T + 9 } })
      expect(Object.keys(store.get().folders['/v'].opens)).toEqual(['/v/b.md', '/v/a.md'])
      expect(Object.keys(store.get().folders).sort()).toEqual(['/v', '/w'])
      expect(commits).toBe(6) // one for each call: the use never has a commit of its own
    })

    it('S3, S4: a patch that puts no new page on show adds nothing — no `file` in it (the blank tab mirrors nothing; the lens, the right panel), `file: null`, the page the window shows now, and a patch that main rejects', async () => {
      await set({ sidebarLens: 'focus' })
      await set({ rightPanel: { ...RIGHT, open: false } })
      await set({ file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] }) // S4: `a.md` is the page of the window
      expect(await set({ file: '/v/b.md', tabs: ['rel.md'] })).toEqual(bad('NOT_ABSOLUTE'))
      await set({ file: null })
      expect(store.get().folders).toEqual({})
    })
  })

  it('window:set-identity rejects the whole call on any bad tabs element, leaving the entry untouched', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { tabs: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { tabs: ['/v/a.md', 'rel.md'] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { tabs: ['/v/a.md', 5] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(store.get().windows).toEqual([entry])
  })

  it('window:close-self hands the caller id to the manager (real close path); unknown callers are rejected', async () => {
    expect(await registered(CONTRACT.window.closeSelf.channel)({ sender })).toEqual(ok(undefined))
    expect(manager.closeWindow).toHaveBeenCalledWith('w1')
    expect(await registered(CONTRACT.window.closeSelf.channel)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    expect(manager.closeWindow).toHaveBeenCalledTimes(1)
  })

  it('window:set-identity validates the patch', async () => {
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { root: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { root: 'rel' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { file: 'a.md' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { rightPanel: defaultRightPanelIdentity(), extra: true })).toEqual(ok(undefined))
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender: stranger }, { root: '/v' })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { root: '/v' })).toEqual(bad('NOT_FOUND'))
  })

  it('window:open validates the options and hands them to the manager (absent paths read as null)', async () => {
    expect(await registered(CONTRACT.window.open.channel)({ sender }, { root: '/v', file: '/v/a.md' })).toEqual(ok(undefined))
    expect(manager.openWindow).toHaveBeenCalledWith({ root: '/v', file: '/v/a.md' })
    expect(await registered(CONTRACT.window.open.channel)({ sender }, {})).toEqual(ok(undefined))
    expect(manager.openWindow).toHaveBeenCalledWith({ root: null, file: null })
    expect(await registered(CONTRACT.window.open.channel)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.open.channel)({ sender }, { root: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.open.channel)({ sender }, { root: 'rel' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(manager.openWindow).toHaveBeenCalledTimes(2)
  })

  it('window:note-closed (YAZ-3487 D10): the closed notes go to the vaults of the CALLER\'s window; a wrong list is refused', async () => {
    const addClosed = vi.spyOn(store, 'addClosed')
    expect(await registered(CONTRACT.window.noteClosed.channel)({ sender }, ['/v/a.md'])).toEqual(ok(undefined))
    expect(addClosed).toHaveBeenCalledExactlyOnceWith(['/v'], ['/v/a.md'])
    expect(await registered(CONTRACT.window.noteClosed.channel)({ sender }, '/v/a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.noteClosed.channel)({ sender }, ['rel.md'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.noteClosed.channel)({ sender: stranger }, ['/v/a.md'])).toEqual(bad('BAD_REQUEST'))
    expect(addClosed).toHaveBeenCalledTimes(1)
  })

  it('window:forget-closed (YAZ-3487 D14): a list drops those notes, null clears the list of the CALLER\'s vaults; anything else is refused', async () => {
    const forgetClosed = vi.spyOn(store, 'forgetClosed')
    expect(await registered(CONTRACT.window.forgetClosed.channel)({ sender }, ['/v/a.md'])).toEqual(ok(undefined))
    expect(await registered(CONTRACT.window.forgetClosed.channel)({ sender }, null)).toEqual(ok(undefined))
    expect(forgetClosed.mock.calls).toEqual([[['/v'], ['/v/a.md']], [['/v'], null]])
    expect(await registered(CONTRACT.window.forgetClosed.channel)({ sender }, 'x')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.forgetClosed.channel)({ sender }, ['rel.md'])).toEqual(bad('NOT_ABSOLUTE'))
  })

  it('window:open-recent validates the path and returns the door\'s verdict (YAZ-1767 D1)', async () => {
    expect(await registered(CONTRACT.window.openRecent.channel)({ sender }, '/v/other')).toEqual(ok(true))
    expect(manager.openRecentBeside).toHaveBeenCalledExactlyOnceWith('/v/other', 'w1') // the caller, for the empty-window door (YAZ-3487 D1)
    manager.openRecentBeside.mockReturnValueOnce(false)
    expect(await registered(CONTRACT.window.openRecent.channel)({ sender }, '/v/gone')).toEqual(ok(false))
    expect(await registered(CONTRACT.window.openRecent.channel)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.openRecent.channel)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
    expect(manager.openRecentBeside).toHaveBeenCalledTimes(2)
  })

  it('window:open-alone validates the path and returns the door\'s verdict; it never touches the open-recent door (YAZ-2858 D1)', async () => {
    expect(await registered(CONTRACT.window.openAlone.channel)({ sender }, '/v/other')).toEqual(ok(true))
    expect(manager.openAlone).toHaveBeenCalledExactlyOnceWith('/v/other', 'w1')
    manager.openAlone.mockReturnValueOnce(false)
    expect(await registered(CONTRACT.window.openAlone.channel)({ sender: stranger }, '/v/gone')).toEqual(ok(false)) // any window may ask
    expect(await registered(CONTRACT.window.openAlone.channel)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CONTRACT.window.openAlone.channel)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
    expect(manager.openAlone).toHaveBeenCalledTimes(2)
    expect(manager.openRecentBeside).not.toHaveBeenCalled()
  })

  describe('saved sets of vaults (YAZ-2602 D8)', () => {
    const TWO = ['/v', '/w']
    const showTwo = () => store.upsertWindow({ ...entry, roots: TWO })

    it('window:open-set validates the id and returns the door\'s answer: what opened, and the folders that are gone (S65, S66)', async () => {
      expect(await registered(CONTRACT.window.openSet.channel)({ sender }, 's1')).toEqual(ok({ opened: true, missing: [] }))
      expect(manager.openVaultSet).toHaveBeenCalledExactlyOnceWith('s1', 'w1')
      manager.openVaultSet.mockReturnValueOnce({ opened: false, missing: ['/v', '/w'] })
      expect(await registered(CONTRACT.window.openSet.channel)({ sender: stranger }, 's2')).toEqual(ok({ opened: false, missing: ['/v', '/w'] })) // any window may ask
      for (const junk of [undefined, 5, null, ['s1']]) expect(await registered(CONTRACT.window.openSet.channel)({ sender }, junk)).toEqual(bad('BAD_REQUEST'))
      expect(manager.openVaultSet).toHaveBeenCalledTimes(2)
    })

    it('window:save-set saves the vaults of the CALLING window under the name; the same name replaces; false when the store refuses (S63, S68, S70)', async () => {
      // S70: a window with one vault has nothing to save.
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, 'Work')).toEqual(ok(false))
      expect(store.get().vaultSets).toEqual([])
      showTwo()
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, '  Work  ')).toEqual(ok(true))
      expect(store.get().vaultSets).toEqual([{ id: expect.any(String), name: 'Work', roots: TWO, lastUsed: expect.any(Number) }])
      const { id } = store.get().vaultSets[0]
      // The window's vaults change: the saved set does not (S69), until the same name is saved again.
      store.upsertWindow({ ...entry, roots: ['/v', '/x', '/w'] })
      expect(store.get().vaultSets[0].roots).toEqual(TWO)
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, 'Work')).toEqual(ok(true))
      expect(store.get().vaultSets).toEqual([{ id, name: 'Work', roots: ['/v', '/x', '/w'], lastUsed: expect.any(Number) }])

      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, '   ')).toEqual(ok(false))
      for (let i = 1; i < MAX_VAULT_SETS; i++) store.saveVaultSet(`Set ${i}`, TWO)
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, 'The 21st')).toEqual(ok(false)) // R12
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, 'Work')).toEqual(ok(true))
      expect(store.get().vaultSets).toHaveLength(MAX_VAULT_SETS)

      const before = store.get()
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, 5)).toEqual(bad('BAD_REQUEST'))
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
      expect(await registered(CONTRACT.window.saveSet.channel)({ sender: stranger }, 'Mine')).toEqual(bad('BAD_REQUEST'))
      expect(store.get()).toBe(before)
    })

    it('a drag of a vault row is `window:set-identity` and then `window:save-set`, sent with no wait between them: main holds the new order before it saves, so the workspace takes it, keeps its name and its id, and moves to the front (YAZ-2631 S48)', async () => {
      showTwo()
      const pair = store.saveVaultSet('Pair', TWO, 1)
      store.saveVaultSet('Other', ['/x', '/y'], 2)
      expect(store.get().vaultSets.map((set) => set.name)).toEqual(['Other', 'Pair'])
      // As the renderer sends them: neither answer is awaited before the next call.
      const answers = [registered(CONTRACT.window.setIdentity.channel)({ sender }, { roots: ['/w', '/v'] }), registered(CONTRACT.window.saveSet.channel)({ sender }, 'Pair')]
      expect(await Promise.all(answers)).toEqual([ok(undefined), ok(true)])
      expect(store.get().windows[0]).toMatchObject({ root: '/w', roots: ['/w', '/v'] })
      expect(store.get().vaultSets).toEqual([{ id: pair?.id, name: 'Pair', roots: ['/w', '/v'], lastUsed: expect.any(Number) }, { id: expect.any(String), name: 'Other', roots: ['/x', '/y'], lastUsed: 2 }])
      expect(store.get().vaultSets[0].lastUsed).toBeGreaterThan(2)
    })

    it('window:rename-set and window:remove-set act on the set by id: a refused rename is false, a remove forgets the entry alone (S67)', async () => {
      const a = store.saveVaultSet('A', TWO, 1)
      const b = store.saveVaultSet('B', ['/x', '/y'], 2)
      if (a === null || b === null) throw new Error('the store refused a set')
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, a.id, '  Alpha  ')).toEqual(ok(true))
      expect(store.get().vaultSets).toEqual([b, { ...a, name: 'Alpha' }])
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, a.id, 'B')).toEqual(ok(false))
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, a.id, '')).toEqual(ok(false))
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, 'nope', 'New')).toEqual(ok(false))
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, 5, 'New')).toEqual(bad('BAD_REQUEST'))
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, a.id, 5)).toEqual(bad('BAD_REQUEST'))
      expect(await registered(CONTRACT.window.renameSet.channel)({ sender }, a.id)).toEqual(bad('BAD_REQUEST'))
      expect(store.get().vaultSets).toEqual([b, { ...a, name: 'Alpha' }])

      const windowsBefore = store.get().windows
      expect(await registered(CONTRACT.window.removeSet.channel)({ sender }, b.id)).toEqual(ok(undefined))
      expect(store.get().vaultSets).toEqual([{ ...a, name: 'Alpha' }])
      expect(store.get().windows).toBe(windowsBefore)
      expect(await registered(CONTRACT.window.removeSet.channel)({ sender }, 'nope')).toEqual(ok(undefined)) // an unknown id is a no-op
      expect(await registered(CONTRACT.window.removeSet.channel)({ sender }, 5)).toEqual(bad('BAD_REQUEST'))
      expect(store.get().vaultSets).toEqual([{ ...a, name: 'Alpha' }])
    })
  })

  describe('sessions (YAZ-3147 D2, D3)', () => {
    const save = (name: unknown, replaceId?: unknown, from: unknown = sender) => registered(CONTRACT.window.saveSession.channel)({ sender: from }, name, replaceId)

    it('window:save-session saves the CALLING window\'s own tabs: the strip with its copies and names, else `tabs` with `file` active; the vaults that hold a tab; null when the store refuses; BAD_REQUEST for junk', async () => {
      // No strip: `tabs`, with `file` as the active tab.
      store.upsertWindow({ ...entry, roots: ['/v', '/w', '/x'], file: '/w/b.md', tabs: ['/v/a.md', '/w/b.md'] })
      const first = await save('  Work  ')
      expect(first).toEqual(ok(expect.any(String)))
      expect(store.get().sessions).toEqual([{ id: (first as { value: string }).value, name: 'Work', tabs: [{ path: '/v/a.md' }, { path: '/w/b.md', active: true }], roots: ['/v', '/w'], lastUsed: expect.any(Number) }])
      // A strip (YAZ-3057): two copies, a display name, the active copy (S5).
      store.upsertWindow({ ...entry, file: '/v/a.md', tabs: ['/v/a.md'], tabStrip: [{ path: '/v/a.md', name: 'One' }, { path: '/v/a.md', active: true }] })
      const second = (await save('Copies')) as { value: string }
      expect(store.get().sessions[0]).toEqual({ id: second.value, name: 'Copies', tabs: [{ path: '/v/a.md', name: 'One' }, { path: '/v/a.md', active: true }], roots: ['/v'], lastUsed: expect.any(Number) })
      // Update (S28): the id and name stay, the tabs are the window's now.
      store.upsertWindow(entry)
      expect(await save('ignored', (first as { value: string }).value)).toEqual(first)
      expect(store.get().sessions.map((s) => [s.name, s.tabs])).toEqual([['Work', [{ path: '/v/a.md', active: true }]], ['Copies', [{ path: '/v/a.md', name: 'One' }, { path: '/v/a.md', active: true }]]])

      // Refused: no tab (S4, S29), an unknown id, 30 sessions for a new one (S7) — an update at the cap still saves.
      store.upsertWindow({ ...entry, file: null, tabs: [] })
      expect(await save('Empty')).toEqual(ok(null))
      expect(await save('Work', second.value)).toEqual(ok(null))
      store.upsertWindow(entry)
      expect(await save('X', 'nope')).toEqual(ok(null))
      for (let i = 2; i < MAX_SESSIONS; i++) store.saveSession(`S${i}`, [{ path: '/v/a.md' }], ['/v'])
      expect(await save('The 31st')).toEqual(ok(null))
      expect(await save('', second.value)).toEqual(ok(second.value))

      const before = store.get()
      for (const [name, id, from] of [[5, undefined, sender], [undefined, undefined, sender], ['Ok', 5, sender], ['Mine', undefined, stranger]] as const) expect(await save(name, id, from)).toEqual(bad('BAD_REQUEST'))
      expect(store.get()).toBe(before)
    })

    it('window:restore-session answers the tabs whose file exists, the vaults whose folder exists, one missing path per gone tab (S20, S23), and touches the session (S26); an unknown id opens nothing', async () => {
      const v = path.join(dir, 'v')
      const w = path.join(dir, 'w')
      await mkdir(v)
      await writeFile(path.join(v, 'a.md'), 'a')
      const tabs = [{ path: path.join(v, 'a.md'), name: 'A' }, { path: path.join(v, 'gone.md'), active: true as const }, { path: path.join(v, 'gone.md') }, { path: path.join(w, 'b.md') }]
      const s = store.saveSession('Mixed', tabs, [v, w], undefined, 1)
      store.saveSession('Later', [{ path: '/v/a.md' }], ['/v'], undefined, 2)
      if (s === null) throw new Error('the store refused the session')
      expect(store.get().sessions[0].name).toBe('Later')
      const restore = registered(CONTRACT.window.restoreSession.channel)
      expect(await restore({ sender: stranger }, s.id)).toEqual(ok({ tabs: [{ path: path.join(v, 'a.md'), name: 'A' }], roots: [v], missing: [path.join(v, 'gone.md'), path.join(v, 'gone.md'), path.join(w, 'b.md')] }))
      expect(store.get().sessions[0]).toMatchObject({ id: s.id, tabs })
      expect(store.get().sessions[0].lastUsed).toBeGreaterThan(2)
      const before = store.get()
      expect(await restore({ sender }, 'nope')).toEqual(ok({ tabs: [], roots: [], missing: [] }))
      expect(await restore({ sender }, 5)).toEqual(bad('BAD_REQUEST'))
      expect(store.get()).toBe(before)
    })

    it('window:rename-session, window:set-session-tabs (checked as a strip) and window:remove-session act by id', async () => {
      const a = store.saveSession('A', [{ path: '/v/a.md' }, { path: '/v/b.md', active: true }], ['/v'], undefined, 1)
      if (a === null) throw new Error('the store refused the session')
      const rename = registered(CONTRACT.window.renameSession.channel)
      expect(await rename({ sender }, a.id, '  Alpha ')).toEqual(ok(true))
      expect(await rename({ sender }, a.id, '   ')).toEqual(ok(false))
      expect(await rename({ sender }, 'nope', 'B')).toEqual(ok(false))
      expect(await rename({ sender }, a.id, 5)).toEqual(bad('BAD_REQUEST'))
      expect(store.get().sessions[0].name).toBe('Alpha')

      const setTabs = registered(CONTRACT.window.setSessionTabs.channel)
      expect(await setTabs({ sender }, a.id, [{ path: '/v/b.md', active: true }])).toEqual(ok(true))
      expect(store.get().sessions[0].tabs).toEqual([{ path: '/v/b.md', active: true }])
      expect(await setTabs({ sender }, 'nope', [])).toEqual(ok(false))
      for (const junk of [undefined, 'tabs', [{ path: 'rel.md' }], [5]]) expect(await setTabs({ sender }, a.id, junk)).toEqual(bad('BAD_REQUEST'))
      expect(await setTabs({ sender }, 5, [])).toEqual(bad('BAD_REQUEST'))
      expect(store.get().sessions[0].tabs).toEqual([{ path: '/v/b.md', active: true }])

      const remove = registered(CONTRACT.window.removeSession.channel)
      expect(await remove({ sender }, 'nope')).toEqual(ok(undefined))
      expect(await remove({ sender }, 5)).toEqual(bad('BAD_REQUEST'))
      expect(store.get().sessions).toHaveLength(1)
      expect(await remove({ sender }, a.id)).toEqual(ok(undefined))
      expect(store.get().sessions).toEqual([])
    })
  })

  it('bug YAZ-3392: a Files window\'s page that starts (a launch, a reload) ends a wide state, so the window is narrow again; a full window\'s identity never asks', async () => {
    await registered(CONTRACT.window.identity.channel)({ sender })
    expect(manager.filesWide).not.toHaveBeenCalled()
    store.upsertWindow({ ...entry, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), kind: 'files' })
    await registered(CONTRACT.window.identity.channel)({ sender })
    expect(manager.filesWide).toHaveBeenCalledExactlyOnceWith('w1', false)
  })

  it('YAZ-3389 D13: a Files window\'s identity carries its own sidebar zoom, normalized; window:files-zoom checks the percent and writes the CALLER\'s window only', async () => {
    const identity = registered(CONTRACT.window.identity.channel)
    const set = registered(CONTRACT.window.filesZoom.channel)
    // A full window: no zoom of its own on the identity, and main refuses the write (its zoom is settings.sidebarZoom).
    expect(await identity({ sender })).toEqual(ok(expect.not.objectContaining({ zoom: expect.anything() })))
    manager.setFilesZoom.mockReturnValueOnce(false)
    expect(await set({ sender }, 150)).toEqual(bad('BAD_REQUEST'))
    // A Files window: a stored old Chromium level reads as the default, a stored percent as itself.
    store.upsertWindow({ ...entry, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), kind: 'files', zoom: 3 })
    expect(await identity({ sender })).toEqual(ok(expect.objectContaining({ kind: 'files', zoom: 125 })))
    store.upsertWindow({ ...entry, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), kind: 'files', zoom: 150 })
    expect(await identity({ sender })).toEqual(ok(expect.objectContaining({ zoom: 150 })))
    expect(await set({ sender }, 200)).toEqual(ok(undefined))
    expect(manager.setFilesZoom).toHaveBeenLastCalledWith('w1', 200)
    for (const junk of ['150', Number.NaN, null]) expect(await set({ sender }, junk)).toEqual(bad('BAD_REQUEST'))
    expect(await set({ sender: stranger }, 150)).toEqual(bad('BAD_REQUEST'))
    expect(manager.setFilesZoom).toHaveBeenCalledTimes(2)
  })

  it('YAZ-3444: window:files-zoom-menu takes a boolean and tells main about the CALLER\'s Files window only; a full window is refused', async () => {
    const menu = registered(CONTRACT.window.filesZoomMenu.channel)
    expect(await menu({ sender }, true)).toEqual(ok(undefined))
    expect(await menu({ sender }, false)).toEqual(ok(undefined))
    expect(manager.filesZoomMenu.mock.calls).toEqual([['w1', true], ['w1', false]])
    manager.filesZoomMenu.mockReturnValueOnce(false)
    expect(await menu({ sender }, true)).toEqual(bad('BAD_REQUEST'))
    for (const junk of ['true', 1, null]) expect(await menu({ sender }, junk)).toEqual(bad('BAD_REQUEST'))
    expect(await menu({ sender: stranger }, true)).toEqual(bad('BAD_REQUEST'))
    expect(manager.filesZoomMenu).toHaveBeenCalledTimes(3)
  })

  it('the Files window doors (YAZ-3357): kind on the identity; open-from-files only from a Files window, its action checked against the window\'s vaults; wide and preview take checked values', async () => {
    const files: WindowEntry = { ...entry, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), kind: 'files' }
    store.upsertWindow(files)
    expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(ok(expect.objectContaining({ kind: 'files' })))
    const fromFiles = registered(CONTRACT.window.openFromFiles.channel)
    expect(await fromFiles({ sender }, { kind: 'open', path: '/v/a.md', how: 'keep' })).toEqual(ok(undefined))
    expect(manager.openFromFiles).toHaveBeenCalledExactlyOnceWith('w1', { kind: 'open', path: '/v/a.md', how: 'keep' })
    expect(await fromFiles({ sender }, { kind: 'session', id: 's1', extra: 1 })).toEqual(ok(undefined))
    expect(manager.openFromFiles).toHaveBeenLastCalledWith('w1', { kind: 'session', id: 's1' })
    expect(await fromFiles({ sender }, { kind: 'open', path: '/elsewhere/a.md', how: 'keep' })).toEqual(bad('BAD_REQUEST'))
    expect(await fromFiles({ sender }, { kind: 'open', path: '/v/a.md', how: 'tab' })).toEqual(bad('BAD_REQUEST'))
    expect(await fromFiles({ sender }, { kind: 'delete', path: '/v/a.md' })).toEqual(bad('BAD_REQUEST'))
    expect(manager.openFromFiles).toHaveBeenCalledTimes(2)
    // The identity read above already ended any wide state (bug YAZ-3392); the door's own call is the last one.
    expect(await registered(CONTRACT.window.filesWide.channel)({ sender }, true)).toEqual(ok(undefined))
    expect(manager.filesWide).toHaveBeenLastCalledWith('w1', true)
    expect(await registered(CONTRACT.window.filesWide.channel)({ sender }, 'yes')).toEqual(bad('BAD_REQUEST'))
    const preview = registered(CONTRACT.window.filesPreview.channel)
    expect(await preview({ sender }, { width: 400, height: 300, top: 10, bottom: 30 })).toEqual(ok(undefined))
    expect(await preview({ sender }, null)).toEqual(ok(undefined))
    expect(manager.filesPreview.mock.calls).toEqual([['w1', { width: 400, height: 300, top: 10, bottom: 30 }], ['w1', null]])
    expect(await preview({ sender }, { width: 0, height: 300, top: 0, bottom: 0 })).toEqual(bad('BAD_REQUEST'))
    // A full window has no such door.
    store.upsertWindow(entry)
    expect(await fromFiles({ sender }, { kind: 'open', path: '/v/a.md', how: 'keep' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CONTRACT.window.openFiles.channel)({ sender }, null)).toEqual(ok(undefined))
    expect(manager.openFilesWindow).toHaveBeenCalledExactlyOnceWith('w1', null)
  })

  it('window:duplicate hands the caller entry to the manager; unknown callers are rejected', async () => {
    expect(await registered(CONTRACT.window.duplicate.channel)({ sender })).toEqual(ok(undefined))
    expect(manager.duplicateWindow).toHaveBeenCalledWith(entry)
    expect(await registered(CONTRACT.window.duplicate.channel)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    expect(manager.duplicateWindow).toHaveBeenCalledTimes(1)
  })

  it('window:pop-out hands the caller entry and the tab to the manager; a stranger, a relative path and a path in no vault of the window are rejected (YAZ-2933 D1)', async () => {
    const popOut = registered(CONTRACT.window.popOut.channel)
    expect(await popOut({ sender }, '/v/a.md')).toEqual(ok(undefined))
    expect(manager.popOut).toHaveBeenCalledWith(entry, '/v/a.md', {})
    expect(await popOut({ sender: stranger }, '/v/a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await popOut({ sender }, 'a.md')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await popOut({ sender }, '/other/a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await popOut({ sender }, '/vault/a.md')).toEqual(bad('BAD_REQUEST')) // a sibling folder whose name starts with the vault's is no part of it
    expect(manager.popOut).toHaveBeenCalledTimes(1)
  })

  it('window:pop-out passes the tab\'s display name, trimmed and cut like a vault name; a blank or non-string name is no name, never an error; a carry that is not an object is BAD_REQUEST (YAZ-2949 D7, joined with YAZ-2951 D2)', async () => {
    const popOut = registered(CONTRACT.window.popOut.channel)
    await popOut({ sender }, '/v/a.md', { name: '  Outline  ' })
    expect(manager.popOut).toHaveBeenLastCalledWith(entry, '/v/a.md', { name: 'Outline' })
    await popOut({ sender }, '/v/a.md', { name: 'x'.repeat(100) })
    expect(manager.popOut.mock.lastCall?.[2].name).toHaveLength(80)
    for (const carry of [undefined, { name: '   ' }, { name: 7 }, {}]) {
      await popOut({ sender }, '/v/a.md', carry)
      expect(manager.popOut).toHaveBeenLastCalledWith(entry, '/v/a.md', {})
    }
    expect(await popOut({ sender }, '/v/a.md', null)).toEqual(bad('BAD_REQUEST'))
    expect(await popOut({ sender }, '/v/a.md', 'Outline')).toEqual(bad('BAD_REQUEST'))
  })

  it('window:move-to passes the target id, the path and the clean carry; a stranger, its own window, a relative path and a bad id are rejected; a refusal is NOT_FOUND (YAZ-3091 D1, D2, S19, S21)', async () => {
    const moveTo = registered(CONTRACT.window.moveTo.channel)
    const view: PageView = { scrollTop: 40, zoomKey: null, folds: [], magnification: 1 }
    expect(await moveTo({ sender }, 'w2', '/v/a.md', { view, name: '  Outline  ', extra: 1 })).toEqual(ok(undefined))
    expect(manager.moveTo).toHaveBeenLastCalledWith('w2', '/v/a.md', { view, name: 'Outline' })
    expect(await moveTo({ sender }, 'w2', '/v/a.md')).toEqual(ok(undefined))
    expect(manager.moveTo).toHaveBeenLastCalledWith('w2', '/v/a.md', {})
    // A quiet move (YAZ-3343 D13): only `true` is one.
    expect(await moveTo({ sender }, 'w2', '/v/a.md', { background: true })).toEqual(ok(undefined))
    expect(manager.moveTo).toHaveBeenLastCalledWith('w2', '/v/a.md', { background: true })
    expect(await moveTo({ sender }, 'w2', '/v/a.md', { background: 'yes' })).toEqual(ok(undefined))
    expect(manager.moveTo).toHaveBeenLastCalledWith('w2', '/v/a.md', {})
    expect(await moveTo({ sender: stranger }, 'w2', '/v/a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await moveTo({ sender }, 'w1', '/v/a.md')).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('its own window') }) }))
    expect(await moveTo({ sender }, 'w2', 'a.md')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await moveTo({ sender }, 7, '/v/a.md')).toEqual(bad('BAD_REQUEST'))
    expect(await moveTo({ sender }, 'w2', '/v/a.md', 'Outline')).toEqual(bad('BAD_REQUEST'))
    expect(manager.moveTo).toHaveBeenCalledTimes(4)
    // The manager refuses: the window closed, or it shows no vault of the page (D2). The source keeps its tab.
    manager.moveTo.mockReturnValueOnce(false)
    expect(await moveTo({ sender }, 'w2', '/v/a.md')).toEqual(bad('NOT_FOUND'))
  })

  describe('the tab board doors (YAZ-3343 D3, D13, D14)', () => {
    const REF = { path: '/v/a.md', copy: 1 }

    it('window:close-other closes another window by its real close (never the caller, which has close-self); window:open-behind opens one on the CALLER\'s window and answers its id', async () => {
      const closeOther = registered(CONTRACT.window.closeOther.channel)
      const openBehind = registered(CONTRACT.window.openBehind.channel)
      expect(await closeOther({ sender }, 'w2')).toEqual(ok(undefined))
      expect(manager.closeOther).toHaveBeenLastCalledWith('w2')
      expect(await closeOther({ sender }, 'w1')).toEqual(bad('BAD_REQUEST'))
      expect(await closeOther({ sender }, 7)).toEqual(bad('BAD_REQUEST'))
      expect(await closeOther({ sender: stranger }, 'w2')).toEqual(bad('BAD_REQUEST'))
      manager.closeOther.mockReturnValueOnce(false)
      expect(await closeOther({ sender }, 'w2')).toEqual(bad('NOT_FOUND'))
      expect(await openBehind({ sender })).toEqual(ok('w9'))
      expect(manager.openBehind.mock.calls[0][0]).toMatchObject({ id: 'w1' })
      expect(await openBehind({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
      // The vault chip: absolute roots, one at least; a window with tabs refuses.
      const setRoots = registered(CONTRACT.window.setRoots.channel)
      expect(await setRoots({ sender }, 'w9', ['/x'])).toEqual(ok(undefined))
      expect(manager.setRoots).toHaveBeenLastCalledWith('w9', ['/x'])
      for (const roots of [[], ['x'], '/x', undefined]) expect((await setRoots({ sender }, 'w9', roots) as { ok: boolean }).ok).toBe(false)
      manager.setRoots.mockReturnValueOnce(false)
      expect(await setRoots({ sender }, 'w9', ['/x'])).toEqual(bad('NOT_FOUND'))
      // "Move to new window" on another window's card: that window does it; the caller's own is window:pop-out.
      const popOutTab = registered(CONTRACT.window.popOutTab.channel)
      expect(await popOutTab({ sender }, 'w2', { path: '/v/a.md', copy: 0 })).toEqual(ok(undefined))
      expect(manager.popOutTab).toHaveBeenLastCalledWith('w2', { path: '/v/a.md', copy: 0 })
      expect(await popOutTab({ sender }, 'w1', { path: '/v/a.md', copy: 0 })).toEqual(bad('BAD_REQUEST'))
      manager.popOutTab.mockReturnValueOnce(false)
      expect(await popOutTab({ sender }, 'w2', { path: '/v/a.md', copy: 0 })).toEqual(bad('NOT_FOUND'))
      // The hidden windows: read, and shown.
      expect(await registered(CONTRACT.window.hiddenWindows.channel)({ sender })).toEqual(ok(['w9']))
      expect(await registered(CONTRACT.window.minimizedWindows.channel)({ sender })).toEqual(ok(['w2']))
      const show = registered(CONTRACT.window.showWindow.channel)
      expect(await show({ sender }, 'w9')).toEqual(ok(undefined))
      expect(manager.showWindow).toHaveBeenLastCalledWith('w9')
      manager.showWindow.mockReturnValueOnce(false)
      expect(await show({ sender }, 'w9')).toEqual(bad('NOT_FOUND'))
      const lightTab = registered(CONTRACT.window.highlightTab.channel)
      expect(await lightTab({ sender }, 'w2', { path: '/v/a.md', copy: 1 })).toEqual(ok(undefined))
      expect(manager.highlightTab).toHaveBeenLastCalledWith('w2', { path: '/v/a.md', copy: 1 })
      expect(await lightTab({ sender }, 'w2', null)).toEqual(ok(undefined))
      expect(manager.highlightTab).toHaveBeenLastCalledWith('w2', null)
      expect(await lightTab({ sender }, 'w2', { path: 'a.md', copy: 0 })).toEqual(bad('NOT_ABSOLUTE'))
      // A card menu's tab action on another window's tab: cleaned, and that window runs it.
      const act = registered(CONTRACT.window.tabAction.channel)
      const REF0 = { path: '/v/a.md', copy: 0 }
      expect(await act({ sender }, 'w2', REF0, { kind: 'set-name', name: '  Plan  ' })).toEqual(ok(undefined))
      expect(manager.tabAction).toHaveBeenLastCalledWith('w2', REF0, { kind: 'set-name', name: 'Plan' })
      for (const action of [{ kind: 'duplicate' }, { kind: 'show-in-sidebar' }, { kind: 'set-review', on: true }, { kind: 'set-name', name: null }]) {
        expect(await act({ sender }, 'w2', REF0, action)).toEqual(ok(undefined))
        expect(manager.tabAction).toHaveBeenLastCalledWith('w2', REF0, action)
      }
      for (const action of [null, { kind: 'delete' }, { kind: 'set-review' }, { kind: 'set-name', name: 3 }]) expect(await act({ sender }, 'w2', REF0, action)).toEqual(bad('BAD_REQUEST'))
      manager.tabAction.mockReturnValueOnce(false)
      expect(await act({ sender }, 'w2', REF0, { kind: 'duplicate' })).toEqual(bad('NOT_FOUND'))
    })

    it('window:focus-tab and window:close-tabs pass the target and clean refs; a stranger, the caller as target, a bad id and a bad ref are rejected; a refusal is NOT_FOUND', async () => {
      const focusTab = registered(CONTRACT.window.focusTab.channel)
      const closeTabs = registered(CONTRACT.window.closeTabs.channel)
      expect(await focusTab({ sender }, 'w2', { ...REF, extra: 1 })).toEqual(ok(undefined))
      expect(manager.focusTab).toHaveBeenLastCalledWith('w2', REF)
      expect(await closeTabs({ sender }, 'w2', [REF, { path: '/v/b.md', copy: 0 }])).toEqual(ok(undefined))
      expect(manager.closeTabs).toHaveBeenLastCalledWith('w2', [REF, { path: '/v/b.md', copy: 0 }])
      expect(await focusTab({ sender: stranger }, 'w2', REF)).toEqual(bad('BAD_REQUEST'))
      expect(await focusTab({ sender }, 'w1', REF)).toEqual(bad('BAD_REQUEST'))
      expect(await closeTabs({ sender }, 'w1', [REF])).toEqual(bad('BAD_REQUEST'))
      expect(await focusTab({ sender }, 7, REF)).toEqual(bad('BAD_REQUEST'))
      expect(await focusTab({ sender }, 'w2', { path: 'a.md', copy: 0 })).toEqual(bad('NOT_ABSOLUTE'))
      for (const copy of [-1, 1.5, '0', undefined]) expect(await focusTab({ sender }, 'w2', { path: '/v/a.md', copy })).toEqual(bad('BAD_REQUEST'))
      expect(await closeTabs({ sender }, 'w2', REF)).toEqual(bad('BAD_REQUEST')) // not an array
      expect(await closeTabs({ sender }, 'w2', [REF, null])).toEqual(bad('BAD_REQUEST')) // one bad ref rejects the call
      // A list longer than any window holds is refused whole, as state:set-tab-canvas refuses its long lists.
      expect(await closeTabs({ sender }, 'w2', Array.from({ length: MAX_CLOSE_REFS + 1 }, (_, copy) => ({ path: '/v/a.md', copy })))).toEqual(bad('BAD_REQUEST'))
      // The error names the parameter the caller got wrong.
      expect(await focusTab({ sender }, 7, REF)).toEqual(expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining("'to'") }) }))
      expect(manager.focusTab).toHaveBeenCalledTimes(1)
      expect(manager.closeTabs).toHaveBeenCalledTimes(1)
      manager.focusTab.mockReturnValueOnce(false)
      manager.closeTabs.mockReturnValueOnce(false)
      expect(await focusTab({ sender }, 'w2', REF)).toEqual(bad('NOT_FOUND'))
      expect(await closeTabs({ sender }, 'w2', [REF])).toEqual(bad('NOT_FOUND'))
    })

    it('window:move-tab passes from, to and the ref; from may be the caller; the same window both ends is BAD_REQUEST and a refusal NOT_FOUND', async () => {
      const moveTab = registered(CONTRACT.window.moveTab.channel)
      expect(await moveTab({ sender }, 'w1', 'w2', REF)).toEqual(ok(undefined))
      expect(manager.moveTab).toHaveBeenLastCalledWith('w1', 'w2', REF)
      expect(await moveTab({ sender }, 'w2', 'w3', REF)).toEqual(ok(undefined))
      expect(manager.moveTab).toHaveBeenLastCalledWith('w2', 'w3', REF)
      expect(await moveTab({ sender: stranger }, 'w1', 'w2', REF)).toEqual(bad('BAD_REQUEST'))
      expect(await moveTab({ sender }, 'w2', 'w2', REF)).toEqual(bad('BAD_REQUEST'))
      expect(await moveTab({ sender }, 'w1', null, REF)).toEqual(bad('BAD_REQUEST'))
      expect(await moveTab({ sender }, 'w1', 'w2', { path: '/v/a.md' })).toEqual(bad('BAD_REQUEST'))
      expect(manager.moveTab).toHaveBeenCalledTimes(2)
      manager.moveTab.mockReturnValueOnce(false)
      expect(await moveTab({ sender }, 'w1', 'w2', REF)).toEqual(bad('NOT_FOUND'))
    })

    it('window:set-name passes any window id and a string or null; a stranger and a bad name are rejected; a window that is not live is NOT_FOUND; identity answers the stored name', async () => {
      const setName = registered(CONTRACT.window.setName.channel)
      expect(await setName({ sender }, 'w2', 'Writing')).toEqual(ok(undefined))
      expect(manager.setName).toHaveBeenLastCalledWith('w2', 'Writing')
      expect(await setName({ sender }, 'w1', null)).toEqual(ok(undefined))
      expect(manager.setName).toHaveBeenLastCalledWith('w1', null)
      expect(await setName({ sender: stranger }, 'w1', 'X')).toEqual(bad('BAD_REQUEST'))
      expect(await setName({ sender }, 'w1', 42)).toEqual(bad('BAD_REQUEST'))
      expect(await setName({ sender }, 7, 'X')).toEqual(bad('BAD_REQUEST'))
      manager.setName.mockReturnValueOnce(false)
      expect(await setName({ sender }, 'w9', 'X')).toEqual(bad('NOT_FOUND'))
      // The name rides every identity read, and a set-identity patch can neither set nor drop it.
      store.setWindowName('w1', 'Writing')
      expect(await registered(CONTRACT.window.setIdentity.channel)({ sender }, { name: 'Hijack', sidebarCollapsed: true })).toEqual(ok(undefined))
      expect(store.get().windows[0].name).toBe('Writing')
      expect(await registered(CONTRACT.window.identity.channel)({ sender })).toEqual(ok(expect.objectContaining({ id: 'w1', name: 'Writing' })))
    })
  })

  it('window:highlight passes the CALLER and the window its row points at, or null to clear; a stranger and a bad id are rejected (YAZ-3091 D8)', async () => {
    const highlight = registered(CONTRACT.window.highlight.channel)
    expect(await highlight({ sender }, 'w2')).toEqual(ok(undefined))
    expect(manager.highlight).toHaveBeenLastCalledWith('w1', 'w2')
    expect(await highlight({ sender }, null)).toEqual(ok(undefined))
    expect(manager.highlight).toHaveBeenLastCalledWith('w1', null)
    expect(await highlight({ sender: stranger }, 'w2')).toEqual(bad('BAD_REQUEST'))
    expect(await highlight({ sender }, 7)).toEqual(bad('BAD_REQUEST'))
    expect(manager.highlight).toHaveBeenCalledTimes(2)
  })

  describe('the tab strip: copies, display names and the active copy (YAZ-3057 D1, D2)', () => {
    const setIdentity = () => registered(CONTRACT.window.setIdentity.channel)
    const identity = () => registered(CONTRACT.window.identity.channel)

    it('window:set-identity stores the strip; window:identity answers it on EVERY read (a reload keeps it), as a copy', async () => {
      const tabStrip = [{ path: '/v/a.md', name: 'Draft' }, { path: '/v/b.md' }, { path: '/v/a.md', active: true }]
      expect(await setIdentity()({ sender }, { tabs: ['/v/a.md', '/v/b.md'], tabStrip, file: '/v/a.md' })).toEqual(ok(undefined))
      expect(store.get().windows[0].tabStrip).toEqual(tabStrip)
      for (let read = 0; read < 2; read++) {
        expect(await identity()({ sender })).toEqual(ok({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], tabStrip, rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files' }))
      }
      const answered = (await identity()({ sender })) as { value: { tabStrip: unknown[] } }
      expect(answered.value.tabStrip[0]).not.toBe(store.get().windows[0].tabStrip?.[0])
    })

    it('a name is cleaned like a vault name (S26): trimmed, cut at MAX_VAULT_NAME, and blank is no name; a strip with no copy and no name is not kept (S23)', async () => {
      const long = `  ${'n'.repeat(MAX_VAULT_NAME + 5)}  `
      expect(await setIdentity()({ sender }, { tabStrip: [{ path: '/v/a.md', name: long }] })).toEqual(ok(undefined))
      expect(store.get().windows[0].tabStrip).toEqual([{ path: '/v/a.md', name: 'n'.repeat(MAX_VAULT_NAME) }])
      expect(await setIdentity()({ sender }, { tabStrip: [{ path: '/v/a.md', name: '   ', active: true }] })).toEqual(ok(undefined))
      expect(store.get().windows[0]).not.toHaveProperty('tabStrip')
    })

    it('a patch without the strip keeps the stored one, made true to the new tabs: a closed file\'s copies drop (S10); a strip that disagrees drops whole (S26)', async () => {
      await setIdentity()({ sender }, { tabs: ['/v/a.md', '/v/b.md'], tabStrip: [{ path: '/v/a.md' }, { path: '/v/b.md', name: 'B' }, { path: '/v/b.md' }], file: '/v/a.md' })
      expect(await setIdentity()({ sender }, { tabs: ['/v/b.md'], file: '/v/b.md' })).toEqual(ok(undefined))
      expect(store.get().windows[0].tabStrip).toEqual([{ path: '/v/b.md', name: 'B' }, { path: '/v/b.md' }])
      // The strip names a tab that is not in `tabs`, and misses one that is: it cannot be the window's tabs.
      expect(await setIdentity()({ sender }, { tabs: ['/v/b.md', '/v/c.md'], tabStrip: [{ path: '/v/c.md', name: 'C' }, { path: '/v/b.md' }] })).toEqual(ok(undefined))
      expect(store.get().windows[0]).not.toHaveProperty('tabStrip')
      expect(store.get().windows[0].tabs).toEqual(['/v/b.md', '/v/c.md'])
    })

    it('rejects the whole call on a bad strip, leaving the entry untouched (S26)', async () => {
      const before = store.get().windows[0]
      for (const wrong of ['nope', [{ path: 'rel.md' }], [{ path: '/v/a.md' }, 5], [{ name: 'x' }]]) {
        expect(await setIdentity()({ sender }, { tabs: ['/v/a.md'], tabStrip: wrong })).toEqual(bad('BAD_REQUEST'))
      }
      expect(store.get().windows[0]).toEqual(before)
    })
  })

  describe('the page view a new window starts with (YAZ-2951 D5, S17, S19)', () => {
    const VIEW: PageView = { scrollTop: 420, zoomKey: 'l2 a:1', folds: ['abc:0', 'h:def:0'], magnification: 125 }

    it('window:pop-out passes a good view on; a bad one is dropped and the window still opens; folds are cut at MAX_FOLD_KEYS_PER_FILE (⌘⇧N carries none since YAZ-3343)', async () => {
      const popOut = registered(CONTRACT.window.popOut.channel)
      expect(await popOut({ sender }, '/v/a.md', { view: VIEW })).toEqual(ok(undefined))
      expect(manager.popOut).toHaveBeenLastCalledWith(entry, '/v/a.md', { view: VIEW })
      for (const wrong of [null, 'view', { ...VIEW, scrollTop: 'x' }, { ...VIEW, zoomKey: 3 }, { ...VIEW, folds: [1] }, { ...VIEW, folds: 'a' }, { ...VIEW, magnification: Number.NaN }, { scrollTop: 0 }]) {
        expect(await popOut({ sender }, '/v/a.md', { view: wrong })).toEqual(ok(undefined))
        expect(manager.popOut).toHaveBeenLastCalledWith(entry, '/v/a.md', {})
      }
      const many = Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 20 }, (_, i) => `k${i}:0`)
      await popOut({ sender }, '/v/a.md', { view: { ...VIEW, folds: many } })
      expect(manager.popOut.mock.lastCall?.[2]).toEqual({ view: { ...VIEW, folds: many.slice(0, MAX_FOLD_KEYS_PER_FILE) } })
      // The options themselves must be an object.
      expect(await popOut({ sender }, '/v/a.md', 'view')).toEqual(bad('BAD_REQUEST'))
    })

    it('window:identity gives the start view out one time (S17)', async () => {
      const start: StartView = { path: '/v/a.md', view: VIEW }
      manager.takeStartView.mockReturnValueOnce(start)
      const identity = registered(CONTRACT.window.identity.channel)
      expect(await identity({ sender })).toEqual(ok({ id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', startView: start }))
      expect(manager.takeStartView).toHaveBeenCalledWith('w1')
      const again = (await identity({ sender })) as { value: WindowIdentity }
      expect(again.value).not.toHaveProperty('startView')
    })
  })

  it('app:flushed routes the renderer ack to the manager by sender', () => {
    const call = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === SPECIAL.appFlushed)
    expect(call).toBeDefined()
    const handler = call?.[1] as unknown as (e: { sender: { id: number } }) => void
    handler({ sender })
    expect(manager.handleFlushed).toHaveBeenCalledWith(sender)
  })

  it('link:ready tells the manager which renderer now listens for link pushes (YAZ-2589 A2)', async () => {
    expect(await registered(CONTRACT.link.ready.channel)({ sender })).toEqual(ok(undefined))
    expect(manager.handleLinkReady).toHaveBeenCalledExactlyOnceWith(sender)
  })
})
