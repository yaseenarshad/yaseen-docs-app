/**
 * The App shell: Welcome on a null root with no auto-dialog (C2, GRO-2164) and openRoot
 * switching the window's folder in place (C3, GRO-2165). Editor and Sidebar are mocked to
 * observable stubs; the bridge is the jsdom stub pattern (storage.test.ts), so the real
 * storage / api / hook modules run against it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, defaultFolderState, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from './lib/storage'

interface SidebarStubProps {
  root: string
  activeFile: string | null
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

import { App } from './App'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The full `window.yaseenDocs` surface the App tree touches, all observable. */
function installBridge(state: AppState, identity: WindowIdentity) {
  const menuOpenRoot = new Set<(path: string) => void>()
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
      onFlush: vi.fn(() => () => undefined),
    },
    menu: {
      onOpenFolder: vi.fn(() => () => undefined),
      onOpenRoot: vi.fn((l: (path: string) => void) => {
        menuOpenRoot.add(l)
        return () => menuOpenRoot.delete(l)
      }),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return { bridge, emitOpenRoot: (path: string) => menuOpenRoot.forEach((l) => l(path)) }
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
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('App on a null root (C2, GRO-2164)', () => {
  it('boots to the Welcome screen with the recents and never auto-opens the folder dialog', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/vaults/notes')] }, { id: 'w1', root: null, file: null })
    expect(el.querySelector('.welcome__title')?.textContent).toBe('Yaseen Docs')
    expect([...el.querySelectorAll('.welcome__recent-path')].map((s) => s.textContent)).toEqual(['/vaults/notes'])
    expect(bridge.pickFolder).not.toHaveBeenCalled()
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(el.querySelector('[data-sidebar]')).toBeNull()
  })

  it('clicking a live recent opens that folder in place, on its remembered last file', async () => {
    const state = withFolder({ ...defaultAppState(), recents: [recent('/vaults/notes')] }, '/vaults/notes', '/vaults/notes/a.md')
    const { bridge, el } = await mount(state, { id: 'w1', root: null, file: null })
    await act(async () => el.querySelector<HTMLButtonElement>('.welcome__recent')?.click())
    expect(el.querySelector('.welcome')).toBeNull()
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/vaults/notes')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/vaults/notes/a.md')
    expect(location.hash).toBe('#/vaults/notes/a.md')
    expect(bridge.state.pushRecent).toHaveBeenCalledWith('/vaults/notes')
  })

  it('clicking a dead recent marks the row, drops the MRU entry and does not switch the window', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/vaults/gone')] }, { id: 'w1', root: null, file: null })
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
  it('File › Open Recent switches the window in place: sidebar re-keyed, file ← the folder\'s lastFile, hash synced, entry updated', async () => {
    const state = withFolder(defaultAppState(), '/w', '/w/b.md')
    const { bridge, el, emitOpenRoot } = await mount(state, { id: 'w1', root: '/v', file: null })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/w/b.md')
    expect(location.hash).toBe('#/w/b.md')
    expect(bridge.state.pushRecent).toHaveBeenCalledWith('/w')
    // The window entry records the switch (D6): root first (file cleared), then the restored file.
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null }], [{ file: '/w/b.md' }]])
  })

  it('switching to a folder with no remembered last file leaves no file open', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('')
    expect(location.hash).toBe('')
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null }]])
  })

  it('a dead recent chosen from the menu drops the MRU entry and leaves the window on its folder', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null })
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
    const { el } = await mount(state, { id: 'w2', root: '/v', file: '/v/picked.md' })
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/picked.md')
  })
})

describe('App window title (C3, GRO-2165)', () => {
  it('is "<file> — <folder>" with a file open, the folder alone without one, the app name on Welcome', async () => {
    const state = withFolder(defaultAppState(), '/vaults/w', '/vaults/w/Note.md')
    const { emitOpenRoot } = await mount(state, { id: 'w1', root: null, file: null })
    expect(document.title).toBe('Yaseen Docs')
    await act(async () => emitOpenRoot('/vaults/w'))
    expect(document.title).toBe('Note — w')
    await act(async () => emitOpenRoot('/vaults/empty'))
    expect(document.title).toBe('empty')
  })
})

describe('App root-missing (C2, GRO-2164)', () => {
  it('the open folder vanishing on disk drops the window to the Welcome screen', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null })
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
    expect(el.querySelector('.welcome')).toBeNull()
    act(() => captured.sidebar?.onRootMissing())
    expect(el.querySelector('.welcome__title')?.textContent).toBe('Yaseen Docs')
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null })
  })
})
