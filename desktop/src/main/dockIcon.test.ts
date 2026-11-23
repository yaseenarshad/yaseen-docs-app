import { describe, expect, it, vi } from 'vitest'
import { defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type WindowEntry } from '@shared/types'
import { createDockIconController, defaultDockIconPath, resolveDockIconPath } from './dockIcon'

const bounds = { x: 0, y: 0, width: 800, height: 600 }
const makeWin = (id: string, extra: Partial<WindowEntry> = {}): WindowEntry => ({
  id,
  root: null,
  file: null,
  tabs: [],
  rightPanel: defaultRightPanelIdentity(),
  sidebarCollapsed: false,
  sidebarLens: 'files',
  bounds,
  ...extra,
  roots: extra.roots ?? (extra.root == null ? [] : [extra.root]),
})

function makeMemoryStore(initial: AppState) {
  let state = initial
  const listeners = new Set<(s: AppState) => void>()
  return {
    get: () => state,
    onChange: (fn: (s: AppState) => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set: (next: AppState) => {
      state = next
      for (const fn of listeners) fn(state)
    },
  }
}

describe('resolveDockIconPath (YAZ-6374)', () => {
  const launcherA = { name: 'Alpha', appPath: '/Applications/Alpha.app', iconPath: '/userData/vault-icons/aaa.png' }
  const launcherB = { name: 'Beta', appPath: '/Applications/Beta.app', iconPath: '/userData/vault-icons/bbb.png' }

  const baseState: AppState = {
    ...defaultAppState(),
    windows: [
      makeWin('w-alpha', { root: '/vaults/alpha', roots: ['/vaults/alpha'] }),
      makeWin('w-multi', { root: '/vaults/alpha', roots: ['/vaults/alpha', '/vaults/beta'], file: '/vaults/beta/note.md' }),
      makeWin('w-multi-blank', { root: '/vaults/alpha', roots: ['/vaults/alpha', '/vaults/beta'], file: null }),
      makeWin('w-welcome', { root: null, roots: [] }),
    ],
    folders: {
      '/vaults/alpha': { ...defaultFolderState(), launcher: launcherA },
      '/vaults/beta': { ...defaultFolderState(), launcher: launcherB },
    },
  }

  it('returns launcher.iconPath when both appPath and iconPath exist', () => {
    const existing = new Set([launcherA.appPath, launcherA.iconPath])
    expect(resolveDockIconPath(baseState, 'w-alpha', (p) => existing.has(p))).toBe(launcherA.iconPath)
  })

  it('uses active file root in a multi-vault window, and falls back to entry.root when no file is active', () => {
    const existing = new Set([launcherA.appPath, launcherA.iconPath, launcherB.appPath, launcherB.iconPath])
    expect(resolveDockIconPath(baseState, 'w-multi', (p) => existing.has(p))).toBe(launcherB.iconPath)
    expect(resolveDockIconPath(baseState, 'w-multi-blank', (p) => existing.has(p))).toBe(launcherA.iconPath)
  })

  it('returns null on Welcome / empty window or when no window is focused', () => {
    const allExist = () => true
    expect(resolveDockIconPath(baseState, 'w-welcome', allExist)).toBeNull()
    expect(resolveDockIconPath(baseState, null, allExist)).toBeNull()
    expect(resolveDockIconPath(baseState, undefined, allExist)).toBeNull()
    expect(resolveDockIconPath(baseState, 'w-missing', allExist)).toBeNull()
  })

  it('returns null when the launcher .app was removed in Finder or the PNG is missing', () => {
    expect(resolveDockIconPath(baseState, 'w-alpha', (p) => p === launcherA.iconPath)).toBeNull()
    expect(resolveDockIconPath(baseState, 'w-alpha', (p) => p === launcherA.appPath)).toBeNull()
  })
})

describe('createDockIconController (YAZ-6374)', () => {
  const launcherA = { name: 'Alpha', appPath: '/Applications/Alpha.app', iconPath: '/userData/vault-icons/aaa.png' }
  const launcherB = { name: 'Beta', appPath: '/Applications/Beta.app', iconPath: '/userData/vault-icons/bbb.png' }
  const DEFAULT_ICON = '/app/build/icon.png'

  it('dedupes repeated sync calls, caches loaded images, switches on tab change, and resets on Welcome', () => {
    const store = makeMemoryStore({
      ...defaultAppState(),
      windows: [
        makeWin('w1', { root: '/vaults/alpha', roots: ['/vaults/alpha', '/vaults/beta'], file: '/vaults/alpha/a.md' }),
        makeWin('w-welcome', { root: null, roots: [] }),
      ],
      folders: {
        '/vaults/alpha': { ...defaultFolderState(), launcher: launcherA },
        '/vaults/beta': { ...defaultFolderState(), launcher: launcherB },
      },
    })

    let focused: string | null = 'w1'
    const setDockIcon = vi.fn()
    const loadImage = vi.fn((p: string) => `img:${p}`)
    const existing = new Set([launcherA.appPath, launcherA.iconPath, launcherB.appPath, launcherB.iconPath, DEFAULT_ICON])

    const controller = createDockIconController({
      store,
      getFocusedWindowId: () => focused,
      defaultIconPath: DEFAULT_ICON,
      setDockIcon,
      loadImage,
      exists: (p) => existing.has(p),
    })

    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(1)
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${launcherA.iconPath}`)
    expect(loadImage).toHaveBeenCalledTimes(1)

    // Repeated sync for the same vault makes 0 setDockIcon calls.
    controller.sync()
    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(1)

    // Tab switch in multi-vault window triggers store.onChange -> swaps to Beta's icon.
    store.set({
      ...store.get(),
      windows: store.get().windows.map((w) => (w.id === 'w1' ? { ...w, file: '/vaults/beta/b.md' } : w)),
    })
    expect(setDockIcon).toHaveBeenCalledTimes(2)
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${launcherB.iconPath}`)
    expect(loadImage).toHaveBeenCalledTimes(2)

    // Switching back to Alpha uses the cached image (no extra loadImage call).
    store.set({
      ...store.get(),
      windows: store.get().windows.map((w) => (w.id === 'w1' ? { ...w, file: '/vaults/alpha/a.md' } : w)),
    })
    expect(setDockIcon).toHaveBeenCalledTimes(3)
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${launcherA.iconPath}`)
    expect(loadImage).toHaveBeenCalledTimes(2)

    // Focusing Welcome resets to default icon.
    focused = 'w-welcome'
    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(4)
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${DEFAULT_ICON}`)

    // Repeated sync on Welcome makes 0 extra calls.
    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(4)

    controller.dispose()
  })

  it('evicts cache and re-applies on invalidate(iconPath), and stops reacting after dispose()', () => {
    const store = makeMemoryStore({
      ...defaultAppState(),
      windows: [makeWin('w1', { root: '/vaults/alpha', roots: ['/vaults/alpha'] })],
      folders: {
        '/vaults/alpha': { ...defaultFolderState(), launcher: launcherA },
      },
    })

    let version = 1
    const setDockIcon = vi.fn()
    const loadImage = vi.fn((p: string) => `img:${p}@v${version}`)

    const controller = createDockIconController({
      store,
      getFocusedWindowId: () => 'w1',
      defaultIconPath: DEFAULT_ICON,
      setDockIcon,
      loadImage,
      exists: () => true,
    })

    controller.sync()
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${launcherA.iconPath}@v1`)

    // In-place PNG update at the same iconPath: invalidate reloads and re-applies.
    version = 2
    controller.invalidate(launcherA.iconPath)
    expect(setDockIcon).toHaveBeenCalledTimes(2)
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${launcherA.iconPath}@v2`)
    expect(loadImage).toHaveBeenCalledTimes(2)

    // After dispose, store changes and sync() do nothing.
    controller.dispose()
    store.set({
      ...store.get(),
      folders: { '/vaults/alpha': defaultFolderState() },
    })
    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(2)
  })

  it('falls back to default icon when loadImage returns null for a corrupt PNG', () => {
    const store = makeMemoryStore({
      ...defaultAppState(),
      windows: [makeWin('w1', { root: '/vaults/alpha', roots: ['/vaults/alpha'] })],
      folders: {
        '/vaults/alpha': { ...defaultFolderState(), launcher: launcherA },
      },
    })

    const setDockIcon = vi.fn()
    const loadImage = vi.fn((p: string) => (p === DEFAULT_ICON ? 'default-img' : null))

    const controller = createDockIconController({
      store,
      getFocusedWindowId: () => 'w1',
      defaultIconPath: DEFAULT_ICON,
      setDockIcon,
      loadImage,
      exists: () => true,
    })

    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(1)
    expect(setDockIcon).toHaveBeenLastCalledWith('default-img')

    // Subsequent sync stays on default without redundant setDockIcon calls.
    controller.sync()
    expect(setDockIcon).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('skips exists checks on unrelated store.onChange commits, but still detects Finder deletion on explicit sync()', () => {
    const store = makeMemoryStore({
      ...defaultAppState(),
      windows: [makeWin('w1', { root: '/vaults/alpha', roots: ['/vaults/alpha'], file: '/vaults/alpha/a.md' })],
      folders: {
        '/vaults/alpha': { ...defaultFolderState(), launcher: launcherA },
      },
    })

    const existing = new Set([launcherA.appPath, launcherA.iconPath, DEFAULT_ICON])
    const exists = vi.fn((p: string) => existing.has(p))
    const setDockIcon = vi.fn()
    const loadImage = vi.fn((p: string) => `img:${p}`)

    const controller = createDockIconController({
      store,
      getFocusedWindowId: () => 'w1',
      defaultIconPath: DEFAULT_ICON,
      setDockIcon,
      loadImage,
      exists,
    })

    controller.sync()
    expect(setDockIcon).toHaveBeenCalledWith(`img:${launcherA.iconPath}`)
    exists.mockClear()

    // Unrelated store commit (same vault/launcher): 0 exists calls.
    store.set({
      ...store.get(),
      windows: store.get().windows.map((w) => (w.id === 'w1' ? { ...w, file: '/vaults/alpha/b.md' } : w)),
    })
    expect(exists).not.toHaveBeenCalled()

    // Finder removes the .app; explicit sync() (e.g. browser-window-focus) detects it and resets to default.
    existing.delete(launcherA.appPath)
    controller.sync()
    expect(exists).toHaveBeenCalled()
    expect(setDockIcon).toHaveBeenLastCalledWith(`img:${DEFAULT_ICON}`)
    controller.dispose()
  })

  it('resolves a PNG default Dock icon path in both dev and packaged builds (YAZ-6386)', () => {
    const devPath = defaultDockIconPath({ isPackaged: false, resourcesPath: '/app/Contents/Resources', mainDir: '/repo/desktop/out/main' })
    const packagedPath = defaultDockIconPath({ isPackaged: true, resourcesPath: '/app/Contents/Resources', mainDir: '/repo/desktop/out/main' })
    expect(devPath.endsWith('/build/icon.png')).toBe(true)
    expect(packagedPath).toBe('/app/Contents/Resources/icon.png')
    expect(packagedPath.endsWith('.icns')).toBe(false)
  })
})
