/**
 * The App shell: Welcome on a null root with no auto-dialog (C2, GRO-2164) and openRoot
 * switching the window's folder in place (C3, GRO-2165). Editor and Sidebar are mocked to
 * observable stubs; the bridge is the jsdom stub pattern (storage.test.ts), so the real
 * storage / api / hook modules run against it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, defaultAppState, defaultFolderState, type AppState, type WindowIdentity } from '@shared/types'
import frameDark from '@milkdown/crepe/theme/frame-dark.css?inline'
import frameLight from '@milkdown/crepe/theme/frame.css?inline'
import { CREPE_THEME_STYLE_ID } from './editor/crepeTheme'
import { storage } from './lib/storage'

interface SidebarStubProps {
  root: string
  activeFile: string | null
  onOpenFile: (path: string) => void
  onOpenFileBackground: (path: string) => void
  onRootMissing: () => void
  onFileMissing: () => void
}

const captured = vi.hoisted(() => ({ sidebar: null as SidebarStubProps | null }))

vi.mock('./editor/Editor', () => ({
  Editor: ({ root, path }: { root: string; path: string | null }) => <div data-editor data-root={root} data-path={path ?? ''} />,
}))
vi.mock('./sidebar/Sidebar', () => ({
  SidebarPanelIcon: () => null,
  Sidebar: (props: SidebarStubProps) => {
    captured.sidebar = props
    return <aside data-sidebar data-root={props.root} />
  },
}))

import { App, LINK_NOTICE_MS } from './App'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The full `window.yaseenDocs` surface the App tree touches, all observable. */
function installBridge(state: AppState, identity: WindowIdentity) {
  const menuOpenRoot = new Set<(path: string) => void>()
  const menuCloseTab = new Set<() => void>()
  const menuNextTab = new Set<() => void>()
  const menuPrevTab = new Set<() => void>()
  const linkOpenFile = new Set<(path: string) => void>()
  const linkNotice = new Set<(message: string) => void>()
  const menuSub = (set: Set<() => void>) =>
    vi.fn((l: () => void) => {
      set.add(l)
      return () => set.delete(l)
    })
  const bridge = {
    tree: vi.fn(async (root: string) => ({ root, tree: [], generatedAt: 1 })),
    pickFolder: vi.fn(async () => ({ cancelled: true as const })),
    watch: vi.fn(() => () => undefined),
    state: {
      get: vi.fn(async () => state),
      setSettings: vi.fn(async () => undefined),
      setSidebarCollapsed: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => undefined),
      removeRecent: vi.fn(async () => undefined),
      setFolder: vi.fn(async () => undefined),
      setFolds: vi.fn(async () => undefined),
      setBaseGroups: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
    },
    window: {
      identity: vi.fn(async () => identity),
      setIdentity: vi.fn(async () => undefined),
      open: vi.fn(),
      duplicate: vi.fn(),
      closeSelf: vi.fn(async () => undefined),
      onFlush: vi.fn(() => () => undefined),
    },
    menu: {
      onOpenFolder: vi.fn(() => () => undefined),
      onOpenRoot: vi.fn((l: (path: string) => void) => {
        menuOpenRoot.add(l)
        return () => menuOpenRoot.delete(l)
      }),
      onCloseTab: menuSub(menuCloseTab),
      onNextTab: menuSub(menuNextTab),
      onPrevTab: menuSub(menuPrevTab),
    },
    link: {
      onOpenFile: vi.fn((l: (path: string) => void) => {
        linkOpenFile.add(l)
        return () => linkOpenFile.delete(l)
      }),
      onNotice: vi.fn((l: (message: string) => void) => {
        linkNotice.add(l)
        return () => linkNotice.delete(l)
      }),
    },
    // Empty registry (GRO-2202): the sidebar reads it for "New ▸"; empty = no menu change.
    registry: {
      get: vi.fn(async (r: string) => ({ root: r, version: 1, types: {}, properties: {} })),
      onChange: vi.fn(() => () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    bridge,
    emitOpenRoot: (path: string) => menuOpenRoot.forEach((l) => l(path)),
    emitCloseTab: () => menuCloseTab.forEach((l) => l()),
    emitNextTab: () => menuNextTab.forEach((l) => l()),
    emitPrevTab: () => menuPrevTab.forEach((l) => l()),
    emitLinkOpenFile: (path: string) => linkOpenFile.forEach((l) => l(path)),
    emitLinkNotice: (message: string) => linkNotice.forEach((l) => l(message)),
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(state: AppState, identity: WindowIdentity) {
  const b = installBridge(state, identity)
  await storage.init()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<StrictMode><App /></StrictMode>))
  return { ...b, el: container }
}

const recent = (path: string, lastOpened = 1) => ({ path, lastOpened })
const withFolder = (state: AppState, folderRoot: string, lastFile: string | null): AppState => ({
  ...state,
  folders: { ...state.folders, [folderRoot]: { ...defaultFolderState(), lastFile } },
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  captured.sidebar = null
  history.replaceState(null, '', '/')
  delete document.documentElement.dataset.theme
  document.getElementById(CREPE_THEME_STYLE_ID)?.remove()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('App on a null root (C2, GRO-2164)', () => {
  it('boots to the Welcome screen with the recents and never auto-opens the folder dialog', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/vaults/notes')] }, { id: 'w1', root: null, file: null, tabs: [] })
    expect(el.querySelector('.welcome__title')?.textContent).toBe('Yaseen Docs')
    expect([...el.querySelectorAll('.welcome__recent-path')].map((s) => s.textContent)).toEqual(['/vaults/notes'])
    expect(bridge.pickFolder).not.toHaveBeenCalled()
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(el.querySelector('.tabbar')).toBeNull() // the tab strip never shows on Welcome (rule 2)
  })

  it('clicking a live recent opens that folder in place, on its remembered last file', async () => {
    const state = withFolder({ ...defaultAppState(), recents: [recent('/vaults/notes')] }, '/vaults/notes', '/vaults/notes/a.md')
    const { bridge, el } = await mount(state, { id: 'w1', root: null, file: null, tabs: [] })
    await act(async () => el.querySelector<HTMLButtonElement>('.welcome__recent')?.click())
    expect(el.querySelector('.welcome')).toBeNull()
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/vaults/notes')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/vaults/notes/a.md')
    expect(location.hash).toBe('#/vaults/notes/a.md')
    expect(bridge.state.pushRecent).toHaveBeenCalledWith('/vaults/notes')
  })

  it('clicking a dead recent marks the row, drops the MRU entry and does not switch the window', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/vaults/gone')] }, { id: 'w1', root: null, file: null, tabs: [] })
    bridge.tree.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    await act(async () => el.querySelector<HTMLButtonElement>('.welcome__recent')?.click())
    expect(bridge.state.removeRecent).toHaveBeenCalledWith('/vaults/gone')
    expect(bridge.state.pushRecent).not.toHaveBeenCalled()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(el.querySelector('.welcome__recent-when')?.textContent).toBe('Folder not found')
    expect(el.querySelector('[data-sidebar]')).toBeNull()
  })
})

describe('App openRoot (C3, GRO-2165)', () => {
  it('File › Open Recent switches the window in place: sidebar re-keyed, prior tabs cleared, file ← the folder\'s lastFile as the sole tab, hash synced', async () => {
    const state = withFolder(defaultAppState(), '/w', '/w/b.md')
    const { bridge, el, emitOpenRoot } = await mount(state, { id: 'w1', root: '/v', file: '/v/old.md', tabs: ['/v/old.md', '/v/z.md'] })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/w/b.md')
    expect([...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)).toEqual(['b'])
    expect(location.hash).toBe('#/w/b.md')
    expect(bridge.state.pushRecent).toHaveBeenCalledWith('/w')
    // The window entry records the switch (D6, tabs rule 13): ONE write clears root's file+tabs,
    // then ONE {tabs, file} write restores the folder's remembered file.
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null, tabs: [] }], [{ tabs: ['/w/b.md'], file: '/w/b.md' }]])
  })

  it('switching to a folder with no remembered last file leaves no file open', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('')
    expect(location.hash).toBe('')
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null, tabs: [] }]])
  })

  it('a dead recent chosen from the menu drops the MRU entry and leaves the window on its folder', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    bridge.tree.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    await act(async () => emitOpenRoot('/gone'))
    expect(bridge.state.removeRecent).toHaveBeenCalledWith('/gone')
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
  })
})

describe('App boot on a window entry with a file (D2, GRO-2168)', () => {
  it('the entry file wins over the folder lastFile: a ⌘-click window opens on the clicked file', async () => {
    const state = withFolder(defaultAppState(), '/v', '/v/last.md')
    const { el } = await mount(state, { id: 'w2', root: '/v', file: '/v/picked.md', tabs: ['/v/picked.md'] })
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/picked.md')
  })
})

describe('App window title (C3, GRO-2165)', () => {
  it('is "<file> — <folder>" with a file open, the folder alone without one, the app name on Welcome', async () => {
    const state = withFolder(defaultAppState(), '/vaults/w', '/vaults/w/Note.md')
    const { emitOpenRoot } = await mount(state, { id: 'w1', root: null, file: null, tabs: [] })
    expect(document.title).toBe('Yaseen Docs')
    await act(async () => emitOpenRoot('/vaults/w'))
    expect(document.title).toBe('Note — w')
    await act(async () => emitOpenRoot('/vaults/empty'))
    expect(document.title).toBe('empty')
  })
})

describe('App deep links (E1, GRO-2171)', () => {
  it('link:open-file selects the file through the same path as a sidebar click: editor, hash, identity', async () => {
    const { bridge, el, emitLinkOpenFile } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    await act(async () => emitLinkOpenFile('/v/sub/linked.md'))
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/sub/linked.md')
    expect(location.hash).toBe('#/v/sub/linked.md')
    expect(bridge.state.setFolder).toHaveBeenCalledWith('/v', { lastFile: '/v/sub/linked.md' })
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/v/sub/linked.md'], file: '/v/sub/linked.md' })
  })

  it('link:notice shows the transient banner, which dismisses itself after LINK_NOTICE_MS', async () => {
    const { el, emitLinkNotice } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    vi.useFakeTimers()
    try {
      act(() => emitLinkNotice("Can't open /v/a.txt: not a markdown file"))
      expect(el.querySelector('.link-notice')?.textContent).toBe("Can't open /v/a.txt: not a markdown file")
      act(() => vi.advanceTimersByTime(LINK_NOTICE_MS))
      expect(el.querySelector('.link-notice')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App appearance (Desktop K, GRO-2218)', () => {
  it('defaults to System, which reads as light here (jsdom has no matchMedia): data-theme + light Crepe vars on <html>/head', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.getElementById(CREPE_THEME_STYLE_ID)?.textContent).toBe(frameLight)
  })

  it('a stored Dark setting themes the very first render: data-theme="dark" and the dark Crepe frame vars', async () => {
    const state: AppState = { ...defaultAppState(), settings: { ...DEFAULT_SETTINGS, theme: 'dark' } }
    await mount(state, { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.getElementById(CREPE_THEME_STYLE_ID)?.textContent).toBe(frameDark)
  })
})

describe('App tabs (I2, GRO-2234)', () => {
  /** The strip's labels left→right. */
  const stripLabels = (el: HTMLElement) => [...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  /** Mounted editor layers as [path, hidden?] pairs (rule 6: visited tabs stay mounted, inactive hidden). */
  const layers = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.tabstack__layer')].map((l) => [
      l.querySelector('[data-editor]')?.getAttribute('data-path'),
      l.classList.contains('tabstack__layer--hidden'),
    ])

  it('boots from the identity snapshot: every stored tab in the strip, ONLY the active editor mounted (rule 15)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'] })
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    expect(layers(el)).toEqual([['/v/b.md', false]])
  })

  it('a pasted #hash wins as the active tab and is prepended when missing from the stored tabs (rule 12)', async () => {
    history.replaceState(null, '', '#/v/pasted.md')
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    expect(stripLabels(el)).toEqual(['pasted', 'a'])
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/pasted.md')
    expect(location.hash).toBe('#/v/pasted.md')
  })

  it('the strip shows with a folder open even with zero tabs; the editor shows the empty state', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(el.querySelector('.tabbar')).not.toBeNull()
    expect(stripLabels(el)).toEqual([])
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('')
  })

  it('the sidebar ⌘-click path (I3, GRO-2235) opens a BACKGROUND tab: appended, not activated, not mounted', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    act(() => captured.sidebar?.onOpenFileBackground('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('a') // activation (and so focus) never moves
    expect(layers(el)).toEqual([['/v/a.md', false]]) // b's editor lazy-mounts on first activation
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/a.md' })
  })

  it('dragging a tab reorders the strip through the reducer and mirrors ONE {tabs, file} write (I3)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const [tabA, tabB] = [...el.querySelectorAll<HTMLElement>('.tabbar__tab')]
    // jsdom rects are all-zero: clientX 5 lands past b's midpoint — a moves to the end.
    act(() => void tabA.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true })))
    act(() => void tabB.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 5 })))
    expect(stripLabels(el)).toEqual(['b', 'a'])
    expect(activeLabel(el)).toBe('a') // reorder never activates
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/a.md'], file: '/v/a.md' })
  })

  it('a sidebar click opens in the CURRENT tab: the active tab is replaced in place and its editor unmounts (rule 4)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/x.md'] })
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['b', 'x'])
    expect(layers(el)).toEqual([['/v/b.md', false]]) // a's editor is GONE (→ autosave flush on unmount)
    // ONE explicit identity write carries BOTH halves — never the legacy {file}-only patch.
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/x.md'], file: '/v/b.md' })
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/v', { lastFile: '/v/b.md' })
  })

  it('opening an already-open path ACTIVATES its tab (rule 3); both visited editors stay mounted, the inactive one hidden', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'b']) // no duplicate, no reorder
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/b.md', false],
    ])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md' })
    // Title and hash follow the ACTIVE tab (rule 12).
    expect(document.title).toBe('b — v')
    expect(location.hash).toBe('#/v/b.md')
  })

  it('clicking tabs switches without unmounting: both layers survive a round-trip (rule 6)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => el.querySelectorAll<HTMLButtonElement>('.tabbar [role="tab"]')[1]?.click())
    expect(activeLabel(el)).toBe('b')
    act(() => el.querySelectorAll<HTMLButtonElement>('.tabbar [role="tab"]')[0]?.click())
    expect(activeLabel(el)).toBe('a')
    expect(layers(el)).toEqual([
      ['/v/a.md', false],
      ['/v/b.md', true],
    ])
  })

  it('✕ on the active tab activates its right neighbour, else left (rule 7)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md', '/v/c.md'] })
    act(() => el.querySelector<HTMLButtonElement>('.tabbar__tab--active .tabbar__close')?.click())
    expect(stripLabels(el)).toEqual(['a', 'c'])
    expect(activeLabel(el)).toBe('c')
    act(() => el.querySelector<HTMLButtonElement>('.tabbar__tab--active .tabbar__close')?.click())
    expect(stripLabels(el)).toEqual(['a'])
    expect(activeLabel(el)).toBe('a')
  })

  it('⌘W ladder: active tab → neighbours → empty state with the window ALIVE → closeSelf (rule 7)', async () => {
    const { bridge, el, emitCloseTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md', '/v/c.md'] })
    act(() => emitCloseTab())
    expect(activeLabel(el)).toBe('c') // right neighbour of the closed b
    act(() => emitCloseTab())
    expect(activeLabel(el)).toBe('a') // c had nothing to its right: left neighbour
    act(() => emitCloseTab())
    expect(stripLabels(el)).toEqual([])
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('') // empty state renders
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null })
    expect(bridge.window.closeSelf).not.toHaveBeenCalled() // the window stays alive
    act(() => emitCloseTab())
    expect(bridge.window.closeSelf).toHaveBeenCalledTimes(1) // zero tabs: the WINDOW closes
  })

  it('⌘W on the Welcome screen closes the window through the real close path', async () => {
    const { bridge, emitCloseTab } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    act(() => emitCloseTab())
    expect(bridge.window.closeSelf).toHaveBeenCalledTimes(1)
  })

  it('Next/Previous Tab cycle with wraparound (rule 9)', async () => {
    const { el, emitNextTab, emitPrevTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/c.md', tabs: ['/v/a.md', '/v/b.md', '/v/c.md'] })
    act(() => emitNextTab())
    expect(activeLabel(el)).toBe('a') // wrapped past the end
    act(() => emitPrevTab())
    expect(activeLabel(el)).toBe('c') // and back
  })

  it('a deep link activates an already-open file\'s tab; a new file opens in the CURRENT tab (rule 10)', async () => {
    const { el, emitLinkOpenFile } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => emitLinkOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    act(() => emitLinkOpenFile('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'c']) // replaced the active b, like a sidebar click
    expect(activeLabel(el)).toBe('c')
  })

  it('the active file vanishing on disk closes its tab; the neighbour takes over', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => captured.sidebar?.onFileMissing())
    expect(stripLabels(el)).toEqual(['b'])
    expect(activeLabel(el)).toBe('b')
  })
})

describe('App root-missing (C2, GRO-2164)', () => {
  it('the open folder vanishing on disk drops the window to the Welcome screen', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
    expect(el.querySelector('.welcome')).toBeNull()
    act(() => captured.sidebar?.onRootMissing())
    expect(el.querySelector('.welcome__title')?.textContent).toBe('Yaseen Docs')
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null, tabs: [] })
  })
})
