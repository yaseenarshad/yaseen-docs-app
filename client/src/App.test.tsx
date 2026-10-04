/**
 * The App shell: Welcome on a null root with no auto-dialog (C2, GRO-2164) and openRoot
 * switching the window's folder in place (C3, GRO-2165). Editor and Sidebar are mocked to
 * observable stubs; the bridge is the jsdom stub pattern (storage.test.ts), so the real
 * storage / api / hook modules run against it.
 */
import { LINK_NOTICE_MS, type NoticeKind } from './lib/notice'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type IndexRecord, type SidebarLens, type TreeNode, type TreeResponse, type WindowIdentity } from '@shared/types'
import frameDark from '@milkdown/crepe/theme/frame-dark.css?inline'
import frameLight from '@milkdown/crepe/theme/frame.css?inline'
import { CREPE_THEME_STYLE_ID } from './editor/crepeTheme'
import * as continuity from './lib/renameContinuity'
import * as renameLinks from './links/renameLinks'
import { storage } from './lib/storage'
import { fetchTree } from './lib/treeFeed'
import { flushWindow } from './lib/windowFlush'
import type { MutableViewOnlyLinkSource, ViewOnlyLinkSource } from './editor/wikilink/viewOnlyLinkSource'

interface SidebarStubProps {
  root: string
  activeFile: string | null
  onOpenFile: (path: string) => void
  onOpenFileBackground: (path: string) => void
  onRootMissing: () => void
  onFileMissing: () => void
  /** The ONE rename door (⚡ YAZ-888): the inline rename AND the drag-move both arrive through it. */
  onRenameFile: (oldPath: string, newPath: string, kind: 'file' | 'dir') => Promise<void>
  pendingSearchFocus: boolean
  /** ⌘O (YAZ-1767 D8): a counter, bumped per request; 0 = none pending for this root. */
  switcherOpenRequest: number
  /** The lens tabs (YAZ-847): App owns the value and the write-through; the sidebar only reports clicks. */
  lens: SidebarLens
  onLensChange: (lens: SidebarLens) => void
  onCollapse: () => void
  revealRequest?: { id: number; path: string }
  onRevealConsumed?: (id: number) => void
  /** A folder search row (🔒 D3, YAZ-1491): App flips to Files and issues a reveal request for the dir. */
  onRevealInFiles?: (path: string) => void
  /** The sidebar's own width in px (YAZ-738), applied to its aside only (YAZ-2194). */
  width: number
  /** The aside itself, which a resize drag writes its live width to (YAZ-2239). */
  asideRef?: React.Ref<HTMLElement>
  viewOnlyLinks: ViewOnlyLinkSource
  /**
   * ⌘⇧C's read-only window into the sidebar's selection (YAZ-1338, 🔒 D4): App owns the
   * listener (the sidebar unmounts on collapse), the Sidebar owns the state (🔒 D1) and
   * writes it here; App only ever reads.
   */
  selectionRef: { current: ReadonlySet<string> }
  onNotice: (message: string, icon?: NoticeKind) => void
  /** ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): App asks, the Sidebar (here a stub) answers. */
  clipboardRef: { current: { cutOrCopy: (op: 'copy' | 'cut') => boolean; paste: () => boolean } | null }
  /** The Inbox row (YAZ-2322): App counts what is due and owns the one review session. */
  dueCount: number
  reviewing: boolean
  onOpenInbox: () => void
  /** "Review this folder" (YAZ-2322): the sidebar hands the folder's ABSOLUTE path. */
  onReviewFolder: (dirPath: string) => void
  /** The row menu's review toggle (YAZ-2322): the hook's lookup and its write, straight through. */
  reviewState: (path: string) => boolean | null
  onSetReview: (path: string, on: boolean) => void
}

const captured = vi.hoisted(() => ({
  sidebar: null as SidebarStubProps | null,
  /** Sidebar stub renders — one per App render while the sidebar is open. */
  sidebarRenders: 0,
  editorOpeners: [] as { path: string | null; open: (path: string) => void }[],
  viewOnlyLinks: [] as Array<ViewOnlyLinkSource | undefined>,
}))

vi.mock('./editor/Editor', () => ({
  Editor: ({ root, path, onOpenFile, onOpenFileBackground, viewOnlyLinks }: { root: string; path: string | null; onOpenFile: (path: string) => void; onOpenFileBackground?: (path: string) => void; viewOnlyLinks?: ViewOnlyLinkSource }) => {
    captured.editorOpeners.push({ path, open: onOpenFile })
    captured.viewOnlyLinks.push(viewOnlyLinks)
    return (
      <div data-editor data-root={root} data-path={path ?? ''}>
        <button type="button" data-open-right-current onClick={() => onOpenFile('/v/c.md')} />
        <button type="button" data-open-right-background onClick={() => onOpenFileBackground?.('/v/d.md')} />
      </div>
    )
  },
}))
vi.mock('./sidebar/Sidebar', () => ({
  Sidebar: (props: SidebarStubProps) => {
    captured.sidebar = props
    captured.sidebarRenders++
    return <aside ref={props.asideRef} data-sidebar data-root={props.root} />
  },
}))

import { App } from './App'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The full `window.yaseenDocs` surface the App tree touches, all observable. `files` backs readFile/writeFile (the E1c rewrite path). */
type IdentityFixture = Omit<WindowIdentity, 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusFavorites'> & Partial<Pick<WindowIdentity, 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusFavorites'>>

function installBridge(state: AppState, identity: IdentityFixture, files: Record<string, { content: string; mtime: number }> = {}) {
  const stateChanged = new Set<(next: AppState) => void>()
  const menuOpenRoot = new Set<(path: string) => void>()
  const menuOpenFolder = new Set<() => void>()
  const menuSearch = new Set<() => void>()
  const menuSwitchVault = new Set<() => void>()
  const menuSettings = new Set<() => void>()
  const menuToggleSidebar = new Set<() => void>()
  const menuCloseTab = new Set<() => void>()
  const menuNextTab = new Set<() => void>()
  const menuPrevTab = new Set<() => void>()
  const menuZoom = new Set<() => void>()
  const linkOpenFile = new Set<(path: string) => void>()
  const linkNotice = new Set<(message: string) => void>()
  const fileRenamed = new Set<(ev: { oldPath: string; newPath: string; kind?: 'file' | 'dir' }) => void>()
  const fileDeleted = new Set<(ev: { path: string; kind: 'file' | 'dir' }) => void>()
  const menuSub = (set: Set<() => void>) =>
    vi.fn((l: () => void) => {
      set.add(l)
      return () => set.delete(l)
    })
  const bridge = {
    tree: vi.fn(async (root: string): Promise<TreeResponse> => ({ root, tree: [], generatedAt: 1 })),
    // Empty index (GRO-2190): WikilinkIndexBridge reads it for wikilink resolution.
    index: vi.fn(async (root: string): Promise<{ root: string; records: IndexRecord[]; folders?: IndexRecord[]; generatedAt: number }> => ({ root, records: [], generatedAt: 1 })),
    // No cold diff by default (E1c, GRO-2242): the external-rename tests stub a hit.
    coldDiff: vi.fn(async () => null),
    readFile: vi.fn(async (path: string) => {
      const f = files[path]
      if (f === undefined) return Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist', path })
      return { path, content: f.content, mtime: f.mtime, size: f.content.length }
    }),
    writeFile: vi.fn(async ({ path, content }: { path: string; content: string }) => {
      files[path] = { content, mtime: (files[path]?.mtime ?? 0) + 1 }
      return { path, mtime: files[path].mtime, size: content.length }
    }),
    // Like the real `wx` write it NEVER overwrites: an existing path rejects ALREADY_EXISTS.
    createFile: vi.fn(async (req: string | { path: string; content?: string }) => {
      const { path, content } = typeof req === 'string' ? { path: req, content: '' } : req
      if (files[path] !== undefined) return Promise.reject({ code: 'ALREADY_EXISTS', message: 'path already exists', path })
      files[path] = { content: content ?? '', mtime: 1 }
      return { path, mtime: 1, size: (content ?? '').length }
    }),
    pickFolder: vi.fn(async () => ({ cancelled: true as const })),
    watch: vi.fn(() => () => undefined),
    state: {
      get: vi.fn(async () => state),
      setSettings: vi.fn(async () => undefined),
      setSidebarWidth: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => undefined),
      removeRecent: vi.fn(async () => undefined),
      setFolder: vi.fn(async () => undefined),
      setFolds: vi.fn(async () => undefined),
      setBaseGroups: vi.fn(async () => undefined),
      onChange: vi.fn((listener: (next: AppState) => void) => {
        stateChanged.add(listener)
        return () => stateChanged.delete(listener)
      }),
    },
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({
        ...identity,
        rightPanel: identity.rightPanel ?? defaultRightPanelIdentity(),
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'favorites',
        focusDirs: identity.focusDirs ?? [],
        focusFavorites: identity.focusFavorites ?? [],
      })),
      setIdentity: vi.fn(async () => undefined),
      open: vi.fn(),
      duplicate: vi.fn(),
      closeSelf: vi.fn(async () => undefined),
      // Main's one open-recent door (YAZ-1767 D1): a vault window's picks and Open Recent land here (YAZ-1914 D1).
      openRecent: vi.fn(async (_path: string) => true),
      onFlush: vi.fn(() => () => undefined),
    },
    menu: {
      onOpenFolder: menuSub(menuOpenFolder),
      onOpenRoot: vi.fn((l: (path: string) => void) => {
        menuOpenRoot.add(l)
        return () => menuOpenRoot.delete(l)
      }),
      onSearch: menuSub(menuSearch),
      onSwitchVault: menuSub(menuSwitchVault),
      onSettings: menuSub(menuSettings),
      onToggleSidebar: menuSub(menuToggleSidebar),
      onCloseTab: menuSub(menuCloseTab),
      onNextTab: menuSub(menuNextTab),
      onPrevTab: menuSub(menuPrevTab),
      onZoom: menuSub(menuZoom),
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
    // In-app rename (Links E1, GRO-2194) + external repair (E1c, GRO-2242): App subscribes to
    // the renamed push on mount; the banner's Update goes through repairRename.
    file: {
      rename: vi.fn(async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => ({ oldPath, newPath })),
      repairRename: vi.fn(async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => ({ oldPath, newPath, kind: 'file' as const })),
      onRenamed: vi.fn((l: (ev: { oldPath: string; newPath: string; kind?: 'file' | 'dir' }) => void) => {
        fileRenamed.add(l)
        return () => fileRenamed.delete(l)
      }),
      // In-app delete (GRO-2272): the invoke plus the push every window receives.
      delete: vi.fn(async ({ path }: { path: string }) => ({ path, kind: 'file' as const })),
      onDeleted: vi.fn((l: (ev: { path: string; kind: 'file' | 'dir' }) => void) => {
        fileDeleted.add(l)
        return () => fileDeleted.delete(l)
      }),
    },
    // No declarations (GRO-2202): the sidebar reads them for "New ▸"; empty = no menu change.
    properties: {
      get: vi.fn(async (r: string) => ({ root: r, version: 1, properties: {} })),
      onChange: vi.fn(() => () => undefined),
    },
    // Sync off (YAZ-1081 3A): App owns one `useGithubSync`, which subscribes on mount. `off` is
    // the real default for a vault nobody switched on — no chip state to assert here, and no
    // attention banner. The sync UI's own tests are SyncIndicator/SettingsDialog/syncAttention.
    github: {
      status: vi.fn(async (r: string) => ({ root: r, state: 'off' as const })),
      syncNow: vi.fn(async (r: string) => ({ root: r, state: 'off' as const })),
      setEnabled: vi.fn(async (r: string) => ({ root: r, state: 'off' as const })),
      onStatus: vi.fn(() => () => undefined),
    },
    // No `review.json` (YAZ-2322): App owns one `useReviewSettings`, which reads and subscribes on vault open.
    vaultConfig: { read: vi.fn(async () => null), write: vi.fn(async () => undefined), onChange: vi.fn(() => () => undefined) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    bridge,
    emitStateChanged: (next: AppState) => stateChanged.forEach((listener) => listener(next)),
    emitOpenRoot: (path: string) => menuOpenRoot.forEach((l) => l(path)),
    emitOpenFolder: () => menuOpenFolder.forEach((l) => l()),
    emitSearch: () => menuSearch.forEach((l) => l()),
    emitSwitchVault: () => menuSwitchVault.forEach((l) => l()),
    emitSettings: () => menuSettings.forEach((l) => l()),
    emitToggleSidebar: () => menuToggleSidebar.forEach((l) => l()),
    emitCloseTab: () => menuCloseTab.forEach((l) => l()),
    emitNextTab: () => menuNextTab.forEach((l) => l()),
    emitPrevTab: () => menuPrevTab.forEach((l) => l()),
    emitLinkOpenFile: (path: string) => linkOpenFile.forEach((l) => l(path)),
    emitLinkNotice: (message: string) => linkNotice.forEach((l) => l(message)),
    emitFileRenamed: (oldPath: string, newPath: string, kind?: 'file' | 'dir') => fileRenamed.forEach((l) => l({ oldPath, newPath, kind })),
    emitFileDeleted: (path: string, kind: 'file' | 'dir' = 'file') => fileDeleted.forEach((l) => l({ path, kind })),
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(
  state: AppState,
  identity: IdentityFixture,
  files: Record<string, { content: string; mtime: number }> = {},
  /** Runs BEFORE the first render, for stubs the mount itself consumes (the index). */
  tweak?: (b: ReturnType<typeof installBridge>) => void,
) {
  const b = installBridge(state, identity, files)
  tweak?.(b)
  await storage.init()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<StrictMode><App /></StrictMode>))
  // Settle in-flight bridge fetches (WikilinkIndexBridge's index read) inside act.
  await act(async () => {})
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
  captured.editorOpeners = []
  captured.viewOnlyLinks = []
  history.replaceState(null, '', '/')
  delete document.documentElement.dataset.theme
  document.getElementById(CREPE_THEME_STYLE_ID)?.remove()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  vi.restoreAllMocks()
})

describe('App per-window sidebar visibility (YAZ-1280)', () => {
  it('boots from window identity and View › Toggle Sidebar reuses the one local toggle path', async () => {
    const { bridge, el, emitToggleSidebar } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: true })
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => emitToggleSidebar())
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarCollapsed: false })
  })

  it('plain Cmd+B on app chrome prevents default, toggles once, and the listener is removed on unmount', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    const event = new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true })
    act(() => void el.querySelector('.app')?.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledExactlyOnceWith({ sidebarCollapsed: true })

    act(() => root?.unmount())
    root = null
    const afterUnmount = new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
  })
})

describe('App close/quit handshake (YAZ-2174)', () => {
  it('hands the window flush to the bridge, so the writers below App join the handshake', async () => {
    const { bridge } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    expect(bridge.window.onFlush).toHaveBeenCalledWith(flushWindow)
  })
})

/**
 * ⌘⇧C copies paths (YAZ-1334 → YAZ-1338, 🔒 D4): the sidebar's multi-selection when one is
 * standing, else the active file — so the chord works with the sidebar collapsed too. App owns
 * the listener and reads the selection through the `selectionRef` window the (here mocked)
 * Sidebar maintains; with no rows in the DOM the copy falls back to the set's own order.
 */
describe('App ⌘⇧C copy path (YAZ-1338)', () => {
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }
  const chord = () => new KeyboardEvent('keydown', { key: 'c', metaKey: true, shiftKey: true, bubbles: true, cancelable: true })

  it('with no selection it copies the ACTIVE file’s path, consumes the key, and SAYS SO (YAZ-1341)', async () => {
    const writeText = installClipboard()
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }, { '/v/a.md': { content: '# a', mtime: 1 } })
    const event = chord()
    act(() => void el.querySelector('.app')?.dispatchEvent(event))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(event.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(el.querySelector('.link-notice')?.textContent).toBe('Copied path')
  })

  it('with a selection standing it copies THOSE paths newline-joined, not the active file', async () => {
    const writeText = installClipboard()
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }, { '/v/a.md': { content: '# a', mtime: 1 } })
    const ref = captured.sidebar?.selectionRef
    expect(ref).toBeDefined()
    act(() => {
      if (ref) ref.current = new Set(['/v/notes/b.md', '/v/c.md'])
    })
    act(() => void el.querySelector('.app')?.dispatchEvent(chord()))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/notes/b.md\n/v/c.md')
    await act(async () => {})
    expect(el.querySelector('.link-notice')?.textContent).toBe('Copied 2 paths')
  })

  it('with nothing selected and nothing open it does nothing and leaves the key alone', async () => {
    const writeText = installClipboard()
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    const event = chord()
    act(() => void el.querySelector('.app')?.dispatchEvent(event))
    expect(writeText).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

/**
 * ⌘C / ⌘X / ⌘V for the sidebar's FILE clipboard (D6 amended, YAZ-1674): ⌘⇧C's sibling. The keys
 * are App's window listener — a panel listener needs focus inside the panel, and after a click
 * on the open file it sits in the editor (YAZ-961), on blank space nowhere focusable — with the
 * SAME ownership boundary: a field, a contenteditable (the editor) or a modal keeps the key and
 * text copy/paste is untouched. The Sidebar's handle holds the rules and answers whether it
 * acted; App swallows the key exactly then.
 */
describe('App ⌘C / ⌘X / ⌘V file clipboard (YAZ-1674, D6 amended)', () => {
  const chord = (key: string, over: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...over })
  const handle = () => ({ cutOrCopy: vi.fn((_op: 'copy' | 'cut') => true), paste: vi.fn(() => true) })
  const arm = (h: ReturnType<typeof handle>) => {
    const ref = captured.sidebar?.clipboardRef
    expect(ref).toBeDefined()
    if (ref) ref.current = h
  }
  const open = () => mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }, { '/v/a.md': { content: '# a', mtime: 1 } })

  it('acts from the body, from a tree row and from blank space alike: copy / cut / paste reach the handle and the key is swallowed', async () => {
    const { el } = await open()
    const h = handle()
    arm(h)
    const row = document.createElement('button')
    row.className = 'tree__row'
    el.querySelector('[data-sidebar]')?.appendChild(row)
    const fromBody = chord('c')
    act(() => void el.querySelector('.app')?.dispatchEvent(fromBody))
    const fromRow = chord('x')
    act(() => void row.dispatchEvent(fromRow))
    const fromBlank = chord('v')
    act(() => void document.body.dispatchEvent(fromBlank))
    expect(h.cutOrCopy.mock.calls).toEqual([['copy'], ['cut']])
    expect(h.paste).toHaveBeenCalledTimes(1)
    expect([fromBody, fromRow, fromBlank].map((e) => e.defaultPrevented)).toEqual([true, true, true])
  })

  it('does NOTHING from a contenteditable (the editor) or an input — text copy/paste keeps working, the key is left alone', async () => {
    const { el } = await open()
    const h = handle()
    arm(h)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const input = document.createElement('input')
    el.querySelector('.app')?.append(editable, input)
    const events = [chord('c'), chord('v'), chord('x'), chord('v')]
    act(() => {
      editable.dispatchEvent(events[0]!)
      editable.dispatchEvent(events[1]!)
      input.dispatchEvent(events[2]!)
      input.dispatchEvent(events[3]!)
    })
    expect(h.cutOrCopy).not.toHaveBeenCalled()
    expect(h.paste).not.toHaveBeenCalled()
    expect(events.every((e) => !e.defaultPrevented)).toBe(true)
  })

  it('Shift or ⌥ held is not ours (⌘⇧C is Copy path), and a handle that declines leaves the key alone', async () => {
    const { el } = await open()
    const h = { cutOrCopy: vi.fn(() => false), paste: vi.fn(() => false) }
    arm(h)
    const shifted = chord('c', { shiftKey: true })
    const alted = chord('v', { altKey: true })
    const declined = chord('v')
    act(() => {
      el.querySelector('.app')?.dispatchEvent(shifted)
      el.querySelector('.app')?.dispatchEvent(alted)
      el.querySelector('.app')?.dispatchEvent(declined)
    })
    expect(h.cutOrCopy).not.toHaveBeenCalled()
    expect(h.paste).toHaveBeenCalledTimes(1) // asked…
    expect(declined.defaultPrevented).toBe(false) // …and not swallowed, because it said no
    expect(alted.defaultPrevented).toBe(false)
  })

  it('with the sidebar collapsed (no handle) the keys are not ours at all', async () => {
    const { el } = await open()
    const ref = captured.sidebar?.clipboardRef
    if (ref) ref.current = null
    const ev = chord('v')
    act(() => void el.querySelector('.app')?.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(false)
  })
})

/**
 * The notice's glyph (D10 amended, YAZ-1674): `onNotice(text, icon?)` — the kind rides on the
 * toast as `data-icon` and draws an aria-hidden SVG before the text, so `textContent` and the
 * `role="status"` announcement stay the bare text. No kind → `'info'`, which is what every caller
 * that never changed gets.
 */
describe('App notice icon (D10 amended, YAZ-1674)', () => {
  const open = () => mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }, { '/v/a.md': { content: '# a', mtime: 1 } })

  it.each(['copy', 'cut', 'paste', 'error', 'info'] as const)('renders data-icon="%s" and an aria-hidden svg before the bare text', async (icon) => {
    const { el } = await open()
    act(() => captured.sidebar?.onNotice(`hello ${icon}`, icon))
    const toast = el.querySelector<HTMLElement>('.link-notice')
    expect(toast?.dataset.icon).toBe(icon)
    expect(toast?.getAttribute('role')).toBe('status')
    expect(toast?.textContent).toBe(`hello ${icon}`)
    const svg = toast?.querySelector('svg.link-notice__icon')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(toast?.firstElementChild).toBe(svg)
  })

  it('defaults to info when the caller names no kind', async () => {
    const { el } = await open()
    act(() => captured.sidebar?.onNotice('plain'))
    expect(el.querySelector<HTMLElement>('.link-notice')?.dataset.icon).toBe('info')
    expect(el.querySelector('.link-notice')?.textContent).toBe('plain')
  })
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

describe('App openRoot from Welcome (C3, GRO-2165; YAZ-1914 D1)', () => {
  it('File › Open Recent switches the Welcome window in place: sidebar keyed, file ← the folder\'s lastFile as the sole tab, hash synced', async () => {
    const state = withFolder(defaultAppState(), '/w', '/w/b.md')
    const { bridge, el, emitOpenRoot } = await mount(state, { id: 'w1', root: null, file: null, tabs: [] })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/w/b.md')
    expect([...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)).toEqual(['b'])
    expect(location.hash).toBe('#/w/b.md')
    expect(bridge.state.pushRecent).toHaveBeenCalledWith('/w')
    expect(bridge.window.openRecent).not.toHaveBeenCalled()
    // The window entry records the switch (D6, tabs rule 13): ONE write clears root's file+tabs,
    // then ONE {tabs, file} write restores the folder's remembered file.
    expect(bridge.window.setIdentity.mock.calls).toEqual([
      [{ root: '/w', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusDirs: [], focusFavorites: [] }],
      [{ tabs: ['/w/b.md'], file: '/w/b.md', rightPanel: defaultRightPanelIdentity() }],
    ])
    expect(captured.sidebar?.lens).toBe('files') // the Welcome window's stored lens was Favorites; the vault lands on Files (YAZ-1846 D2)
  })

  it('switching to a folder with no remembered last file leaves no file open', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('')
    expect(location.hash).toBe('')
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusDirs: [], focusFavorites: [] }]])
  })

  it('a dead recent chosen from the menu drops the MRU entry and leaves the window on Welcome', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    bridge.tree.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    await act(async () => emitOpenRoot('/gone'))
    expect(bridge.state.removeRecent).toHaveBeenCalledWith('/gone')
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(el.querySelector('.welcome')).not.toBeNull()
  })

  it('a folder picked on Welcome (Open Folder…) switches the window in place (S5)', async () => {
    const { bridge, el, emitOpenFolder } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    bridge.pickFolder.mockResolvedValueOnce({ path: '/w' } as never)
    await act(async () => emitOpenFolder())
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(bridge.window.openRecent).not.toHaveBeenCalled()
  })
})

describe('App vault-open rule in a vault window (YAZ-1914 D1 — never overwrite the open vault)', () => {
  const VAULT = { id: 'w1', root: '/v', file: '/v/old.md', tabs: ['/v/old.md', '/v/z.md'] }

  const expectUntouched = (bridge: ReturnType<typeof installBridge>['bridge'], el: HTMLElement): void => {
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
    expect([...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)).toEqual(['old', 'z'])
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ root: expect.anything() }))
    expect(bridge.state.pushRecent).not.toHaveBeenCalled() // main's door bumps the MRU, not this window
  }

  it('File › Open Recent hands the path to main\'s open-recent door and leaves this window alone (S7)', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), VAULT)
    await act(async () => emitOpenRoot('/w'))
    expect(bridge.window.openRecent).toHaveBeenCalledExactlyOnceWith('/w')
    expectUntouched(bridge, el)
  })

  it('a folder picked with Open Folder… goes through the same door (S1/S2)', async () => {
    const { bridge, el, emitOpenFolder } = await mount(defaultAppState(), VAULT)
    bridge.pickFolder.mockResolvedValueOnce({ path: '/w' } as never)
    await act(async () => emitOpenFolder())
    expect(bridge.window.openRecent).toHaveBeenCalledExactlyOnceWith('/w')
    expectUntouched(bridge, el)
  })

  it('a cancelled dialog does nothing (S11)', async () => {
    const { bridge, el, emitOpenFolder } = await mount(defaultAppState(), VAULT)
    await act(async () => emitOpenFolder())
    expect(bridge.pickFolder).toHaveBeenCalledOnce()
    expect(bridge.window.openRecent).not.toHaveBeenCalled()
    expectUntouched(bridge, el)
  })

  it('a dead folder (the door answers false) or a failed door leaves the window as it is (S10)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), VAULT)
    bridge.window.openRecent.mockResolvedValueOnce(false)
    await act(async () => emitOpenRoot('/gone'))
    bridge.window.openRecent.mockRejectedValueOnce(new Error('ipc down'))
    await act(async () => emitOpenRoot('/w'))
    expect(error).toHaveBeenCalledWith('[open-vault] openRecent failed:', expect.any(Error))
    expectUntouched(bridge, el)
    error.mockRestore()
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
  it('is the app name on Welcome, then "<file> — <folder>" once a folder with a file opens', async () => {
    const state = withFolder(defaultAppState(), '/vaults/w', '/vaults/w/Note.md')
    const { emitOpenRoot } = await mount(state, { id: 'w1', root: null, file: null, tabs: [] })
    expect(document.title).toBe('Yaseen Docs')
    await act(async () => emitOpenRoot('/vaults/w'))
    expect(document.title).toBe('Note — w')
  })

  it('is the folder alone with no file open', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/vaults/empty', file: null, tabs: [] })
    expect(document.title).toBe('empty')
  })

  it('a FOLDER tab named like a file keeps its whole name, in the title and on the strip, once the Files tree says so (YAZ-2290)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/vaults/named', file: '/vaults/named/Notes.md', tabs: ['/vaults/named/Notes.md'] })
    bridge.tree.mockResolvedValueOnce({ root: '/vaults/named', tree: [{ type: 'dir', name: 'Notes.md', path: '/vaults/named/Notes.md', children: [] }], generatedAt: 2 })
    await act(async () => void (await fetchTree('/vaults/named')))
    expect(document.title).toBe('Notes.md — named')
    expect(el.querySelector('.tabbar [role="tab"]')?.textContent).toBe('Notes.md')
  })
})

describe('App deep links (E1, GRO-2171)', () => {
  it('link:open-file selects the file through the same path as a sidebar click: editor, hash, identity', async () => {
    const { bridge, el, emitLinkOpenFile } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    await act(async () => emitLinkOpenFile('/v/sub/linked.md'))
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/sub/linked.md')
    expect(location.hash).toBe('#/v/sub/linked.md')
    expect(bridge.state.setFolder).toHaveBeenCalledWith('/v', { lastFile: '/v/sub/linked.md' })
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/v/sub/linked.md'], file: '/v/sub/linked.md', rightPanel: defaultRightPanelIdentity() })
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

describe('App rename push (Links E1, GRO-2194)', () => {
  it('file:renamed remaps the active tab in place: strip label, editor, hash, title and ONE identity mirror', async () => {
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/B.md', tabs: ['/v/B.md', '/v/x.md'] })
    vi.mocked(bridge.window.setIdentity).mockClear()
    await act(async () => emitFileRenamed('/v/B.md', '/v/C.md'))
    expect([...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)).toEqual(['C', 'x'])
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('C')
    expect(el.querySelector('[data-editor]')?.getAttribute('data-path')).toBe('/v/C.md')
    expect(location.hash).toBe('#/v/C.md')
    expect(document.title).toBe('C — v')
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/v/C.md', '/v/x.md'], file: '/v/C.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('a rename of a file this window does not show changes nothing (no identity write)', async () => {
    const { bridge, emitFileRenamed } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/x.md', tabs: ['/v/x.md'] })
    vi.mocked(bridge.window.setIdentity).mockClear()
    await act(async () => emitFileRenamed('/other/B.md', '/other/C.md'))
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
  })

  it('carries before one workspace repair and follows right-panel file/directory paths', async () => {
    const order: string[] = []
    const carry = vi.spyOn(continuity, 'carryEditorAcrossRename').mockImplementation(() => void order.push('carry'))
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/main.md',
      tabs: ['/v/main.md'],
      rightPanel: { open: true, width: 440, items: ['/v/Docs/a.md'], expanded: '/v/Docs/a.md' },
    })
    vi.mocked(bridge.window.setIdentity).mockImplementation(async () => void order.push('workspace'))
    await act(async () => emitFileRenamed('/v/Docs/a.md', '/v/Docs/b.md', 'file'))
    expect(order).toEqual(['carry', 'workspace'])
    expect(el.querySelector('.right-panel__header')?.textContent).toContain('b')

    await act(async () => emitFileRenamed('/v/Docs', '/v/Notes', 'dir'))
    expect(el.querySelector('.right-panel__header')?.getAttribute('title')).toBe('/v/Notes/b.md')
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/main.md'],
      file: '/v/main.md',
      rightPanel: { open: true, width: 440, items: ['/v/Notes/b.md'], expanded: '/v/Notes/b.md' },
    })
    carry.mockRestore()
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

describe('App content width (YAZ-1176)', () => {
  it('exposes the stored preset on the app container from the first render', async () => {
    const state: AppState = { ...defaultAppState(), settings: { ...DEFAULT_SETTINGS, contentWidth: 'medium' } }
    const { el } = await mount(state, { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(el.querySelector('.app')?.getAttribute('data-content-width')).toBe('medium')
  })

  it('applies another window\'s content-width change live through the existing state broadcast', async () => {
    const { el, emitStateChanged } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(el.querySelector('.app')?.getAttribute('data-content-width')).toBe('narrow')
    act(() => emitStateChanged({ ...defaultAppState(), settings: { ...DEFAULT_SETTINGS, contentWidth: 'full' } }))
    expect(el.querySelector('.app')?.getAttribute('data-content-width')).toBe('full')
  })
})

describe('App sidebar resize (YAZ-738)', () => {
  const drag = (el: HTMLElement, dx: number) => {
    el.querySelector('.sidebar-resize')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: dx }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: dx }))
  }
  const sideW = () => captured.sidebar?.width
  /** One App render as the stub counts it: `mount` renders under StrictMode, which renders twice. */
  const STRICT_RENDER = 2
  const toggle = (el: HTMLElement) => act(() => void el.querySelector('.app')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true })))

  it('a drag widens the sidebar live and persists the new width once', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(sideW()).toBe(260)
    act(() => drag(el, 120))
    expect(sideW()).toBe(380)
    expect(bridge.state.setSidebarWidth.mock.calls).toEqual([[380]])
  })

  it('the width goes to the sidebar alone, never to the whole window as an inherited variable (YAZ-2194)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => drag(el, 120))
    expect(el.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--side-w')).toBe('')
  })

  it('a 20-move drag writes the width straight to the sidebar and renders App once, when it ends (YAZ-2239)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    const aside = el.querySelector<HTMLElement>('[data-sidebar]')!
    act(() => void el.querySelector('.sidebar-resize')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 })))
    const before = captured.sidebarRenders
    for (let dx = 6; dx <= 120; dx += 6) act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: dx })))
    expect(captured.sidebarRenders).toBe(before)
    expect(aside.style.width).toBe('380px')
    act(() => void window.dispatchEvent(new MouseEvent('mouseup', { clientX: 120 })))
    expect(captured.sidebarRenders).toBe(before + STRICT_RENDER)
    expect(sideW()).toBe(380)
    expect(bridge.state.setSidebarWidth.mock.calls).toEqual([[380]])
  })

  it('the right panel still flips to overlay live, at the move that crosses the threshold (YAZ-2239)', async () => {
    // 1,100 px: sidebar 260 + panel 440 + workspace minimum 360 = 1,060 fits; 320 + 440 + 360 = 1,120 does not.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 })
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: { open: true, width: 440, items: ['/v/b.md'], expanded: '/v/b.md' } })
    expect(el.querySelector('.right-panel--overlay')).toBeNull()
    act(() => void el.querySelector('.sidebar-resize')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 })))
    const before = captured.sidebarRenders
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 })))
    expect(el.querySelector('.right-panel--overlay')).toBeNull()
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60 })))
    expect(el.querySelector('.right-panel--overlay')).not.toBeNull()
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80 })))
    expect(captured.sidebarRenders).toBe(before + STRICT_RENDER) // the flip, and nothing else
    act(() => void window.dispatchEvent(new MouseEvent('mouseup', { clientX: 80 })))
    expect(el.querySelector('.right-panel--overlay')).not.toBeNull()
    expect(sideW()).toBe(340)
  })

  it('dragging well past the minimum collapses the sidebar instead of writing a sliver width', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => drag(el, 50 - 260))
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarCollapsed: true })
    expect(bridge.state.setSidebarWidth).not.toHaveBeenCalled()
    toggle(el)
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(sideW()).toBe(260)
  })
})

/**
 * The sidebar's lens (🔒 D4, YAZ-847): App-owned, persisted as window identity (YAZ-1628), and passed down — never a
 * Sidebar-local flag. The sidebar is mounted `key={root}` and only while it is open, so the
 * collapse → reopen step below is the whole reason the value lives here.
 */
describe('App sidebar lens (🔒 D4, YAZ-847)', () => {
  it('mounts the sidebar on the STORED lens (the fixture\'s Favorites)', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(captured.sidebar?.lens).toBe('favorites')
  })

  it('a stored `files` boots straight onto Files', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarLens: 'files' })
    expect(captured.sidebar?.lens).toBe('files')
  })

  it('a tab click writes through to this window\'s identity and comes back down as the new lens', async () => {
    const { bridge } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => captured.sidebar?.onLensChange('files'))
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarLens: 'files' })
    expect(captured.sidebar?.lens).toBe('files')
  })

  it('the lens survives collapse → reopen, because the value is App\'s and not the sidebar\'s', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => captured.sidebar?.onLensChange('files'))
    // The strip's Show-sidebar button exists only while the sidebar is hidden (YAZ-1759).
    expect(el.querySelector('[aria-label="Show sidebar"]')).toBeNull()
    act(() => captured.sidebar?.onCollapse())
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('.tabbar-nav__btn[aria-label="Show sidebar"]')?.click())
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(captured.sidebar?.lens).toBe('files')
  })
})

describe('App Show in sidebar request ownership (YAZ-1023)', () => {
  const rightClick = (target: Element) =>
    act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
  const showInSidebar = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((item) => item.textContent === 'Show in sidebar')

  it('opens a collapsed sidebar on the captured lens and targets an inactive tab without activating it', async () => {
    const { bridge, el } = await mount(
      defaultAppState(),
      { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], sidebarCollapsed: true, sidebarLens: 'files' },
    )
    rightClick(el.querySelectorAll('.tabbar__tab')[1]!)
    act(() => showInSidebar(el)?.click())
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarCollapsed: false })
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toEqual({ id: 1, path: '/v/b.md' })
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('a')
  })

  it('gives repeated requests for the same path a new identity', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    const tab = el.querySelector('.tabbar__tab')!
    rightClick(tab)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest?.id).toBe(1)
    rightClick(tab)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest).toEqual({ id: 2, path: '/v/a.md' })
  })

  it('a folder search row flips the lens to FILES and issues the same reveal request, ids shared with the tab menu (🔒 D3, YAZ-1491)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    expect(captured.sidebar?.lens).toBe('favorites') // the fixture's lens: the row was chosen from Favorites
    act(() => captured.sidebar?.onRevealInFiles?.('/v/sub'))
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toEqual({ id: 1, path: '/v/sub' })
    // The tab menu's next gesture continues the SAME counter — one reveal channel, not two.
    rightClick(el.querySelector('.tabbar__tab')!)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest).toEqual({ id: 2, path: '/v/a.md' })
  })

  it('consumes handled work without replaying it after collapse/reopen, while later gestures keep monotonic IDs', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    rightClick(el.querySelector('.tabbar__tab')!)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest?.id).toBe(1)
    act(() => captured.sidebar?.onRevealConsumed?.(1))
    expect(captured.sidebar?.revealRequest).toBeNull()

    act(() => captured.sidebar?.onCollapse())
    act(() => el.querySelector<HTMLButtonElement>('.tabbar-nav__btn[aria-label="Show sidebar"]')?.click())
    expect(captured.sidebar?.revealRequest).toBeNull()

    rightClick(el.querySelector('.tabbar__tab')!)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest?.id).toBe(2)
  })
})

describe('App settings dialog (YAZ-1679)', () => {
  it('Yaseen Docs › Settings… (⌘,) mounts the ONE dialog, and its × unmounts it', async () => {
    const { el, emitSettings } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(el.querySelector('.settings-dialog')).toBeNull()
    act(() => emitSettings())
    expect(el.querySelector('.settings-dialog')).not.toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click())
    expect(el.querySelector('.settings-dialog')).toBeNull()
  })
})

describe('App ⌘K search (D4, YAZ-804)', () => {
  it('from a collapsed sidebar it un-collapses through the global setting and mounts the sidebar with the focus flag already true', async () => {
    const { bridge, el, emitSearch } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: true })
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => emitSearch())
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarCollapsed: false })
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)
  })

  it('with the sidebar already open it only raises the focus flag', async () => {
    const { bridge, emitSearch } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(captured.sidebar?.pendingSearchFocus).toBe(false)
    act(() => emitSearch())
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith({ sidebarCollapsed: false })
  })
})

describe('App ⌘O vault switcher (YAZ-1767 D8)', () => {
  it('from a collapsed sidebar it un-collapses first (the ⌘K handshake) and mounts the sidebar with a request pending', async () => {
    const { bridge, el, emitSwitchVault } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: true })
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => emitSwitchVault())
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ sidebarCollapsed: false })
    expect(captured.sidebar?.switcherOpenRequest).toBe(1)
  })

  it('with the sidebar open each ⌘O bumps the counter; the sidebar starts at 0', async () => {
    const { bridge, emitSwitchVault } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(captured.sidebar?.switcherOpenRequest).toBe(0)
    act(() => emitSwitchVault())
    expect(captured.sidebar?.switcherOpenRequest).toBe(1)
    act(() => emitSwitchVault())
    expect(captured.sidebar?.switcherOpenRequest).toBe(2)
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith({ sidebarCollapsed: false })
  })

  it('a request is pinned to the root it was made on: after an in-place root change (the vault folder moved) the remounted sidebar reads 0', async () => {
    const { emitSwitchVault, emitFileRenamed } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => emitSwitchVault())
    expect(captured.sidebar?.switcherOpenRequest).toBe(1)
    await act(async () => emitFileRenamed('/v', '/w', 'dir'))
    expect(captured.sidebar?.root).toBe('/w')
    expect(captured.sidebar?.switcherOpenRequest).toBe(0)
    // A fresh request on the new root counts again.
    act(() => emitSwitchVault())
    expect(captured.sidebar?.switcherOpenRequest).toBe(2)
  })

  it('on Welcome (no root) it is a no-op — nothing to switch from', async () => {
    const { bridge, el, emitSwitchVault } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    act(() => emitSwitchVault())
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith({ sidebarCollapsed: false })
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

  it('owns one ready navigation-only source and threads that same object to retained editors', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    const sources = captured.viewOnlyLinks.filter((source): source is ViewOnlyLinkSource => source !== undefined)
    expect(sources.length).toBeGreaterThan(0)
    expect(new Set(sources).size).toBe(1)
    expect(sources[0]?.ready).toBe(true)
    expect('records' in sources[0]!).toBe(false)
  })

  it.each([
    ['/v/data.json', '/v/report.PDF', ['data.json', 'report.PDF'], 'data.json — v'],
    ['/v/report.PDF', '/v/data.json', ['report.PDF', 'data.json'], 'report.PDF — v'],
    ['/v/photo.PNG', '/v/data.json', ['photo.PNG', 'data.json'], 'photo.PNG — v'],
  ] as const)('restores view-only tabs with exact extension labels and title for %s', async (active, other, labels, title) => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: active, tabs: [active, other] })
    expect(stripLabels(el)).toEqual(labels)
    expect(activeLabel(el)).toBe(labels[0])
    expect(layers(el)).toEqual([[active, false]])
    expect(document.title).toBe(title)
  })

  it('routes text/PDF through current and background tabs without adding duplicate paths', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/data.json', tabs: ['/v/data.json'] })
    act(() => captured.sidebar?.onOpenFileBackground('/v/report.PDF'))
    act(() => captured.sidebar?.onOpenFileBackground('/v/report.PDF'))
    expect(stripLabels(el)).toEqual(['data.json', 'report.PDF'])
    expect(activeLabel(el)).toBe('data.json')
    expect(layers(el)).toEqual([['/v/data.json', false]])

    act(() => captured.sidebar?.onOpenFile('/v/report.PDF'))
    expect(stripLabels(el)).toEqual(['data.json', 'report.PDF'])
    expect(activeLabel(el)).toBe('report.PDF')
    expect(layers(el)).toEqual([
      ['/v/data.json', true],
      ['/v/report.PDF', false],
    ])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/data.json', '/v/report.PDF'], file: '/v/report.PDF', rightPanel: defaultRightPanelIdentity() })
    expect(document.title).toBe('report.PDF — v')
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
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('dragging a tab reorders the strip through the reducer and mirrors ONE {tabs, file} write (I3)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const [tabA, tabB] = [...el.querySelectorAll<HTMLElement>('.tabbar__tab')]
    // jsdom rects are all-zero: clientX 5 lands past b's midpoint — a moves to the end.
    act(() => void tabA.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true })))
    act(() => void tabB.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 5 })))
    expect(stripLabels(el)).toEqual(['b', 'a'])
    expect(activeLabel(el)).toBe('a') // reorder never activates
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/a.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('a sidebar click opens in the CURRENT tab: the active tab is replaced in place and its editor unmounts (rule 4)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/x.md'] })
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['b', 'x'])
    expect(layers(el)).toEqual([['/v/b.md', false]]) // a's editor is GONE (→ autosave flush on unmount)
    // ONE explicit identity write carries BOTH halves — never the legacy {file}-only patch.
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/x.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
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
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
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
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null, rightPanel: defaultRightPanelIdentity() })
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

  it('a tab\'s menu offers "Copy ID" off the window\'s index: under "Copy path" for the note that has an id, absent for a note with none, a PDF and an image (YAZ-2293, scenario E1, E2)', async () => {
    const note = (path: string, id?: string): IndexRecord => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { path, ...(id === undefined ? {} : { id }), name, basename: name.replace(/\.md$/i, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
    }
    const tabs = ['/v/a.md', '/v/b.md', '/v/report.PDF', '/v/photo.PNG']
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs }, {}, (b) =>
      b.bridge.index.mockResolvedValue({ root: '/v', records: [note('/v/a.md', 'k3m9x2pq7abc'), note('/v/b.md')], generatedAt: 1 }),
    )
    const menuOf = (path: string) => {
      const tab = el.querySelector<HTMLElement>(`[role="tab"][title="${path}"]`)?.closest<HTMLElement>('.tabbar__tab')
      act(() => void tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      return [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((item) => item.textContent)
    }
    const labels = menuOf('/v/a.md')
    expect(labels.indexOf('Copy ID')).toBe(labels.indexOf('Copy path') + 1)
    for (const path of tabs.slice(1)) {
      expect(menuOf(path), path).toContain('Copy path')
      expect(menuOf(path), path).not.toContain('Copy ID')
    }
  })

  it('the active file vanishing on disk closes its tab; the neighbour takes over', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => captured.sidebar?.onFileMissing())
    expect(stripLabels(el)).toEqual(['b'])
    expect(activeLabel(el)).toBe('b')
  })
})

describe('App right-panel shell (YAZ-1272)', () => {
  it('restores the shell and switches between split and overlay from available width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const identity = {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 440, items: ['/v/b.md'], expanded: '/v/b.md' },
    }
    const { el } = await mount(defaultAppState(), identity)
    expect(el.querySelector('[aria-label="Right panel"]')).not.toBeNull()
    expect(el.querySelector('.right-panel--overlay')).toBeNull()
    expect(el.querySelector('.right-panel__header')?.textContent).toBe('b')
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(el.querySelector('.right-panel--overlay')).not.toBeNull()
  })

  it('shows the right-edge reopen control when hidden and mirrors one open-state change', async () => {
    const { bridge, el } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: defaultRightPanelIdentity(),
    })
    const show = el.querySelector<HTMLButtonElement>('[aria-label="Show right panel"]')
    expect(show).not.toBeNull()
    act(() => show?.click())
    expect(el.querySelector('[aria-label="Right panel"]')).not.toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/a.md'],
      file: '/v/a.md',
      rightPanel: { ...defaultRightPanelIdentity(), open: true },
    })
  })

  it('hosts the existing Editor in retained right layers with right-local plain and background navigation', async () => {
    const { el } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 440, items: ['/v/b.md'], expanded: '/v/b.md' },
    })
    expect(el.querySelectorAll('[data-editor][data-path="/v/a.md"]')).toHaveLength(1)
    expect(el.querySelectorAll('[data-editor][data-path="/v/b.md"]')).toHaveLength(1)
    const rightB = el.querySelector<HTMLElement>('[data-testid="right-layer-/v/b.md"]')
    expect(rightB).not.toBeNull()
    act(() => rightB?.querySelector<HTMLButtonElement>('[data-open-right-current]')?.click())
    expect(el.querySelector('[data-testid="right-layer-/v/b.md"]')).toBeNull()
    expect(el.querySelector('[data-testid="right-layer-/v/c.md"]')).not.toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Back in right panel"]')?.click())
    expect(el.querySelector('[data-testid="right-layer-/v/b.md"]')).not.toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Forward in right panel"]')?.click())
    const rightC = el.querySelector<HTMLElement>('[data-testid="right-layer-/v/c.md"]')
    expect(rightC).not.toBeNull()
    act(() => rightC?.querySelector<HTMLButtonElement>('[data-open-right-background]')?.click())
    expect([...el.querySelectorAll('.right-panel__header')].map((header) => header.textContent)).toEqual(['c', 'd'])
    expect(el.querySelector('[data-testid="right-layer-/v/d.md"]')).toBeNull()
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.right-panel__header')][1]?.click())
    expect(el.querySelector('[data-testid="right-layer-/v/c.md"]')?.classList.contains('right-panel__editor-layer--hidden')).toBe(true)
    expect(el.querySelector('[data-testid="right-layer-/v/d.md"]')?.classList.contains('right-panel__editor-layer--hidden')).toBe(false)
  })

  it('keeps each retained right editor navigation callback stable across header switches', async () => {
    captured.editorOpeners = []
    const { el } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 440, items: ['/v/b.md', '/v/c.md'], expanded: '/v/b.md' },
    })
    const before = captured.editorOpeners.filter((entry) => entry.path === '/v/b.md').at(-1)?.open
    expect(before).toBeDefined()

    act(() => [...el.querySelectorAll<HTMLButtonElement>('.right-panel__header')][1]?.click())

    const after = captured.editorOpeners.filter((entry) => entry.path === '/v/b.md').at(-1)?.open
    expect(after).toBe(before)
  })

  it('does not rerender retained editor trees when only a right header collapses or expands', async () => {
    captured.editorOpeners = []
    const { el } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 440, items: ['/v/b.md'], expanded: '/v/b.md' },
    })
    const count = (path: string) => captured.editorOpeners.filter((entry) => entry.path === path).length
    const before = { main: count('/v/a.md'), right: count('/v/b.md') }

    const header = el.querySelector<HTMLButtonElement>('.right-panel__header')!
    act(() => header.click())
    expect({ main: count('/v/a.md'), right: count('/v/b.md') }).toEqual(before)

    act(() => header.click())
    expect({ main: count('/v/a.md'), right: count('/v/b.md') }).toEqual(before)
  })

  it('wires the keyboard-equivalent move commands through one-owner workspace transfers', async () => {
    const { el, bridge } = await mount(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md', '/v/b.md'],
      rightPanel: { open: true, width: 440, items: ['/v/c.md'], expanded: '/v/c.md' },
    })
    const tabA = el.querySelector<HTMLElement>('[role="tab"][title="/v/a.md"]')?.closest<HTMLElement>('.tabbar__tab')
    act(() => void tabA?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    const moveToRight = [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Move to right panel')
    act(() => moveToRight?.click())
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/b.md'],
      file: '/v/b.md',
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/a.md'], expanded: '/v/a.md' },
    })

    const rightC = [...el.querySelectorAll<HTMLElement>('.right-panel__header')].find((item) => item.textContent?.includes('c'))
    act(() => void rightC?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    const moveToMain = [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Move to main tabs')
    act(() => moveToMain?.click())
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/b.md', '/v/c.md'],
      file: '/v/c.md',
      rightPanel: { open: true, width: 440, items: ['/v/a.md'], expanded: '/v/a.md' },
    })
  })
})

describe('App external-rename banner (Links E1c, GRO-2242)', () => {
  const record = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/i, ''), folder: '', ext: 'md', size: 7, ctime: 1, mtime: 100, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }
  /** A references B; B2 is the externally renamed B — the post-rename index snapshot. */
  const records = [record('/v/A.md', { links: ['B'], size: 20, mtime: 5 }), record('/v/B2.md')]
  const coldDiff = {
    root: '/v',
    scannedAt: 1,
    cacheStatus: 'hit' as const,
    added: [{ path: '/v/B2.md', size: 7, mtime: 100 }],
    removed: [{ path: '/v/B.md', size: 7, mtime: 100 }],
    changed: [],
  }

  // These two mount by hand (not via mount()): the index/coldDiff stubs must be in place
  // BEFORE the first render, or the first snapshot lands empty and the cold read is spent.

  it('the cold-start feed banners passively: names root-relative, N from the engine, no rewrite before confirmation', async () => {
    const files = { '/v/A.md': { content: 'See [[B]] and [[B|Bee]].\n', mtime: 1 } }
    const b = installBridge(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] }, files)
    b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1 })
    b.bridge.coldDiff.mockResolvedValue(coldDiff as never)
    await storage.init()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<StrictMode><App /></StrictMode>))
    await act(async () => {})
    const el = container
    const banner = el.querySelector('.rename-banner')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('Looks like B.md became B2.md — update 1 link?')
    expect(banner?.getAttribute('role')).toBe('status') // passive: a status region, never a dialog
    expect(b.bridge.writeFile).not.toHaveBeenCalled() // confirm-first, ALWAYS (locked)
    expect(b.bridge.file.repairRename).not.toHaveBeenCalled()

    // Update → repair (store/tabs follow via the existing push) + engine rewrite + summary notice.
    await act(async () => el.querySelectorAll<HTMLButtonElement>('.rename-banner button')[0]?.click())
    expect(b.bridge.file.repairRename).toHaveBeenCalledWith({ oldPath: '/v/B.md', newPath: '/v/B2.md' })
    expect(files['/v/A.md'].content).toBe('See [[B2]] and [[B2|Bee]].\n')
    expect(el.querySelector('.link-notice')?.textContent).toBe('Updated links in 1 note')
    expect(el.querySelector('.rename-banner')).toBeNull()
  })

  it('Dismiss drops the hypothesis: no repair, no rewrite, banner gone', async () => {
    const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
    const b = installBridge(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] }, files)
    b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1 })
    b.bridge.coldDiff.mockResolvedValue(coldDiff as never)
    await storage.init()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<StrictMode><App /></StrictMode>))
    await act(async () => {})
    const el = container
    expect(el.querySelector('.rename-banner')).not.toBeNull()
    await act(async () => el.querySelectorAll<HTMLButtonElement>('.rename-banner button')[1]?.click())
    expect(el.querySelector('.rename-banner')).toBeNull()
    expect(b.bridge.file.repairRename).not.toHaveBeenCalled()
    expect(b.bridge.writeFile).not.toHaveBeenCalled()
    expect(files['/v/A.md'].content).toBe('See [[B]].\n')
  })
})

/**
 * The ONE rename door (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes): every
 * gesture — the sidebar's inline rename, its drag-move, the page title — arrives at App as
 * (oldPath, newPath), and the rule is asked here and nowhere else. A changed NAME confirms
 * first with the honest count; a MOVE runs silently, exactly as it always has.
 */
describe('App rename door (⚡ YAZ-888)', () => {
  const record = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const rel = path.slice('/v/'.length)
    return { path, name, basename: name.replace(/\.md$/i, ''), folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', ext: 'md', size: 7, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }
  /** A references B by name; R references Docs/N by path — one file case, one folder case. */
  const records = [record('/v/A.md', { links: ['B'] }), record('/v/B.md'), record('/v/R.md', { links: ['Docs/N'] }), record('/v/Docs/N.md')]
  const identity = (): IdentityFixture => ({ id: 'w1', root: '/v', file: null, tabs: [] })
  const feed = (b: ReturnType<typeof installBridge>) => b.bridge.index.mockResolvedValue({ root: '/v', records, generatedAt: 1 })
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('a NAME change asks first, with the honest count — and confirming runs the whole pipeline', async () => {
    const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), identity(), files, feed)
    await act(async () => void captured.sidebar?.onRenameFile('/v/B.md', '/v/B2.md', 'file'))
    expect(sheetText(el)).toBe("Rename 'B' to 'B2'? Links in 1 note will be updated.")
    expect(bridge.file.rename).not.toHaveBeenCalled() // nothing moves before the beat

    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/B.md', newPath: '/v/B2.md' })
    expect(files['/v/A.md'].content).toBe('See [[B2]].\n') // links ALWAYS follow on confirm (locked)
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a MOVE stays silent: no sheet, the rename runs straight through', async () => {
    const { bridge, el } = await mount(defaultAppState(), identity(), {}, feed)
    await act(async () => await captured.sidebar?.onRenameFile('/v/B.md', '/v/Docs/B.md', 'file'))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/B.md', newPath: '/v/Docs/B.md' })
  })

  it('Cancel renames nothing and rewrites nothing', async () => {
    const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), identity(), files, feed)
    await act(async () => void captured.sidebar?.onRenameFile('/v/B.md', '/v/B2.md', 'file'))
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).not.toHaveBeenCalled()
    expect(files['/v/A.md'].content).toBe('See [[B]].\n')
  })

  it('clears an open rename confirmation when the window root changes (the vault folder moved)', async () => {
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), identity(), {}, feed)
    await act(async () => void await captured.sidebar?.onRenameFile('/v/B.md', '/v/B2.md', 'file'))
    expect(sheetText(el)).toContain("Rename 'B' to 'B2'?")

    await act(async () => emitFileRenamed('/v', '/w', 'dir'))

    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).not.toHaveBeenCalled()
  })

  it('silently cancels a deferred old-root catalog request after a root change (the vault folder moved)', async () => {
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), identity(), {}, feed)
    const oldRootRename = captured.sidebar?.onRenameFile
    let resolveOldTree!: (response: TreeResponse) => void
    bridge.tree.mockImplementation((path: string): Promise<TreeResponse> => path === '/v'
      ? new Promise((resolve) => { resolveOldTree = resolve })
      : Promise.resolve({ root: path, tree: [], generatedAt: 2 }))
    let request!: Promise<void>
    await act(async () => {
      request = oldRootRename?.('/v/data.json', '/v/data-v2.json', 'file') ?? Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => emitFileRenamed('/v', '/w', 'dir'))
    await act(async () => {
      resolveOldTree({
        root: '/v',
        tree: [{ type: 'file', name: 'data.json', path: '/v/data.json', kind: 'text', size: 1, mtime: 1 }],
        generatedAt: 1,
      })
      await request
    })

    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(el.querySelector('.confirm')).toBeNull()
    expect(el.querySelector('.link-notice')).toBeNull()
    expect(bridge.file.rename).not.toHaveBeenCalled()
  })

  it('a FOLDER rename asks too, and its count is the DIR-mode one — pathed links only', async () => {
    const { el } = await mount(defaultAppState(), identity(), {}, feed)
    await act(async () => void captured.sidebar?.onRenameFile('/v/Docs', '/v/Notes', 'dir'))
    expect(sheetText(el)).toBe("Rename 'Docs' to 'Notes'? Links in 1 note will be updated.")
  })

  it('a page nobody links to says so rather than promising an update of nothing', async () => {
    const { el } = await mount(defaultAppState(), identity(), {}, feed)
    await act(async () => void captured.sidebar?.onRenameFile('/v/A.md', '/v/A2.md', 'file'))
    expect(sheetText(el)).toBe("Rename 'A' to 'A2'? No other notes link to it.")
  })

  it('classifies an image as a navigation-only file without adding it to the semantic index', async () => {
    const semanticRecords = [record('/v/A.md', { links: ['photo.png'] })]
    const files = { '/v/A.md': { content: 'See [[photo.png]].\n', mtime: 1 } }
    const count = vi.spyOn(renameLinks, 'countLinkReferences')
    try {
      const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
        b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, generatedAt: 1 })
        b.bridge.tree.mockImplementation(async () => ({
          root: '/v',
          tree: [{ type: 'file', name: 'photo.png', path: '/v/photo.png', kind: 'image', size: 1, mtime: 1 }] as TreeNode[],
          generatedAt: 1,
        }))
      })
      const treeReadsBeforeRename = bridge.tree.mock.calls.filter(([path]) => path === '/v').length
      await act(async () => void captured.sidebar?.onRenameFile('/v/photo.png', '/v/photo-v2.png', 'file'))

      expect(semanticRecords.some((record) => record.path === '/v/photo.png')).toBe(false)
      expect(count).toHaveBeenCalledWith(expect.objectContaining({
        root: '/v',
        oldPath: '/v/photo.png',
        kind: 'file',
        records: semanticRecords,
        viewOnlyCatalog: expect.objectContaining({ entries: [expect.objectContaining({ path: '/v/photo.png', kind: 'image' })] }),
      }))
      expect(sheetText(el)).toBe("Rename 'photo.png' to 'photo-v2.png'? Links in 1 note will be updated.")
      expect(bridge.tree.mock.calls.filter(([path]) => path === '/v')).toHaveLength(treeReadsBeforeRename)

      ;(captured.sidebar?.viewOnlyLinks as MutableViewOnlyLinkSource | undefined)?.reset()
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/photo.png', newPath: '/v/photo-v2.png' })
      expect(files['/v/A.md'].content).toBe('See [[photo-v2.png]].\n')
    } finally {
      count.mockRestore()
    }
  })

  it('fetches and pins a fresh catalog when a view-only rename starts before the catalog is ready', async () => {
    const semanticRecords = [record('/v/A.md', { links: ['data.json'] })]
    const files = { '/v/A.md': { content: '[[data.json]]\n', mtime: 1 } }
    let rootReads = 0
    // The window's ONE boot read (sidebar + catalog share it since YAZ-2191) is still on the wire;
    // released at the end so the per-window tree feed is not left waiting on it.
    let release!: () => void
    const pending = new Promise<TreeResponse>((r) => (release = () => r({ root: '/v', tree: [], generatedAt: 0 })))
    const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, generatedAt: 1 })
      b.bridge.tree.mockImplementation(async (path: string): Promise<TreeResponse> => {
        if (path !== '/v') return { root: path, tree: [], generatedAt: 1 }
        rootReads++
        if (rootReads <= 1) return pending
        return {
          root: '/v',
          tree: [{ type: 'file', name: 'data.json', path: '/v/data.json', kind: 'text', size: 1, mtime: 1 }],
          generatedAt: 2,
        }
      })
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/data.json', '/v/data-v2.json', 'file'))
    expect(rootReads).toBe(2)
    expect(sheetText(el)).toBe("Rename 'data.json' to 'data-v2.json'? Links in 1 note will be updated.")
    expect(bridge.file.rename).not.toHaveBeenCalled()

    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(files['/v/A.md'].content).toBe('[[data-v2.json]]\n')
    await act(async () => release())
  })

  it('fresh-snapshots directory descendants and rewrites their explicit links after confirmation', async () => {
    const semanticRecords = [record('/v/A.md', { links: ['Old/data.json'] })]
    const files = { '/v/A.md': { content: '[[Old/data.json]]\n', mtime: 1 } }
    let rootReads = 0
    // The window's ONE boot read (sidebar + catalog share it since YAZ-2191) is still on the wire;
    // released at the end so the per-window tree feed is not left waiting on it.
    let release!: () => void
    const pending = new Promise<TreeResponse>((r) => (release = () => r({ root: '/v', tree: [], generatedAt: 0 })))
    const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, generatedAt: 1 })
      b.bridge.tree.mockImplementation(async (path: string): Promise<TreeResponse> => {
        if (path !== '/v') return { root: path, tree: [], generatedAt: 1 }
        rootReads++
        if (rootReads <= 1) return pending
        return {
          root: '/v',
          tree: [{ type: 'dir', name: 'Old', path: '/v/Old', children: [
            { type: 'file', name: 'data.json', path: '/v/Old/data.json', kind: 'text', size: 1, mtime: 1 },
          ] }],
          generatedAt: 2,
        }
      })
      b.bridge.file.rename.mockImplementation(async ({ oldPath, newPath }) => ({ oldPath, newPath, kind: 'dir' }))
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/Old', '/v/New', 'dir'))
    expect(rootReads).toBe(2)
    expect(sheetText(el)).toBe("Rename 'Old' to 'New'? Links in 1 note will be updated.")
    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/Old', newPath: '/v/New' })
    expect(files['/v/A.md'].content).toBe('[[New/data.json]]\n')
    await act(async () => release())
  })

  it('a FOLDER rename counts the name links to the folder itself — a note\u2019s and another folder\u2019s Outline line — and confirming rewrites both (YAZ-2290 D10)', async () => {
    const TEAM = '---\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[Projects]]\n---\n'
    const files = { '/v/A.md': { content: 'See [[Projects]].\n', mtime: 1 }, '/v/Team/.folder.md': { content: TEAM, mtime: 1 } }
    const outline = { views: [{ type: 'outline', name: 'Outline', outline: '- [[Projects]]' }] }
    const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
      b.bridge.index.mockResolvedValue({
        root: '/v',
        records: [record('/v/A.md', { links: ['Projects'] }), record('/v/Projects/Plan.md')],
        folders: [record('/v/Team/.folder.md', { properties: { folder_page_settings: outline } })],
        generatedAt: 1,
      })
      b.bridge.tree.mockResolvedValue({
        root: '/v',
        tree: [{ type: 'dir', name: 'Projects', path: '/v/Projects', children: [] }, { type: 'dir', name: 'Team', path: '/v/Team', children: [] }],
        generatedAt: 1,
      })
      b.bridge.file.rename.mockImplementation(async ({ oldPath, newPath }) => ({ oldPath, newPath, kind: 'dir' }))
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/Projects', '/v/Work', 'dir'))
    expect(sheetText(el)).toBe("Rename 'Projects' to 'Work'? Links in 2 notes will be updated.")
    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/Projects', newPath: '/v/Work' })
    expect(files['/v/A.md'].content).toBe('See [[Work]].\n')
    expect(files['/v/Team/.folder.md'].content).toContain('- [[Work]]')
  })

  it('always refreshes a ready directory catalog so newly visible descendants count and rewrite', async () => {
    const semanticRecords = [record('/v/A.md', { links: ['Old/data.json'] })]
    const files = { '/v/A.md': { content: '[[Old/data.json]]\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, generatedAt: 1 })
      b.bridge.tree.mockResolvedValue({
        root: '/v',
        tree: [{ type: 'dir', name: 'Old', path: '/v/Old', children: [] }],
        generatedAt: 1,
      })
      b.bridge.file.rename.mockImplementation(async ({ oldPath, newPath }) => ({ oldPath, newPath, kind: 'dir' }))
    })
    const readsBeforeRename = bridge.tree.mock.calls.filter(([path]) => path === '/v').length
    bridge.tree.mockResolvedValue({
      root: '/v',
      tree: [{ type: 'dir', name: 'Old', path: '/v/Old', children: [
        { type: 'file', name: 'data.json', path: '/v/Old/data.json', kind: 'text', size: 1, mtime: 2 },
      ] }],
      generatedAt: 2,
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/Old', '/v/New', 'dir'))

    expect(bridge.tree.mock.calls.filter(([path]) => path === '/v')).toHaveLength(readsBeforeRename + 1)
    expect(sheetText(el)).toBe("Rename 'Old' to 'New'? Links in 1 note will be updated.")
    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(files['/v/A.md'].content).toBe('[[New/data.json]]\n')
  })

  it('fails closed with a passive notice when the required fresh rename catalog cannot load', async () => {
    const { bridge, el } = await mount(defaultAppState(), identity(), {}, (b) => {
      b.bridge.tree.mockImplementation(async (path: string): Promise<TreeResponse> => {
        if (path === '/v') throw new Error('tree unavailable')
        return { root: path, tree: [], generatedAt: 1 }
      })
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/data.json', '/v/data-v2.json', 'file'))
    expect(bridge.tree.mock.calls.filter(([path]) => path === '/v')).toHaveLength(2) // one shared boot read (YAZ-2191) + the rename's own
    expect(bridge.file.rename).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
    expect(el.querySelector('.link-notice')?.textContent).toBe("Can't rename: couldn't load the current file list")
  })

  it('rejects a catalog response for a different root before confirmation or mutation', async () => {
    const { bridge, el } = await mount(defaultAppState(), identity(), {}, (b) => {
      b.bridge.tree.mockResolvedValue({ root: '/other', tree: [], generatedAt: 1 })
    })

    await act(async () => void await captured.sidebar?.onRenameFile('/v/data.json', '/v/data-v2.json', 'file'))

    expect(bridge.file.rename).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
    expect(el.querySelector('.link-notice')?.textContent).toBe("Can't rename: couldn't load the current file list")
  })

  it('uses directory-prefix semantics for a directory whose name looks like a supported file', async () => {
    const semanticRecords = [record('/v/R.md', { links: ['Archive.json/N'] }), record('/v/Archive.json/N.md')]
    const count = vi.spyOn(renameLinks, 'countLinkReferences')
    try {
      const { el } = await mount(defaultAppState(), identity(), {}, (b) =>
        b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, generatedAt: 1 }),
      )
      await act(async () => void captured.sidebar?.onRenameFile('/v/Archive.json', '/v/Renamed.json', 'dir'))

      expect(count).toHaveBeenCalledWith({
        root: '/v',
        oldPath: '/v/Archive.json',
        kind: 'dir',
        records: semanticRecords,
        folders: [],
        dirs: [],
      })
      expect(sheetText(el)).toBe("Rename 'Archive.json' to 'Renamed.json'? Links in 1 note will be updated.")
    } finally {
      count.mockRestore()
    }
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
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusDirs: [], focusFavorites: [] })
  })
})

/**
 * Delete wiring (GRO-2272 `B3-`). The ordering test is the point of this block: retire the
 * editor BEFORE the workspace remap, because removing a page unmounts its editor and the unmount
 * flush would write the buffer back to disk, recreating the file that was just trashed.
 */
describe('in-app delete (GRO-2272)', () => {
  it('retires the editor BEFORE remapping the workspace — asserted by call order, not by reading the code', async () => {
    const order: string[] = []
    const retireSpy = vi.spyOn(continuity, 'retireDeletedPath').mockImplementation(() => void order.push('retire'))
    const files = { '/v/a.md': { content: '# a', mtime: 1 }, '/v/b.md': { content: '# b', mtime: 1 } }
    const b = installBridge(defaultAppState(), {
      id: 'w1',
      root: '/v',
      file: '/v/b.md',
      tabs: ['/v/b.md'],
      rightPanel: { open: true, width: 440, items: ['/v/a.md'], expanded: '/v/a.md' },
    }, files)
    await storage.init()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    // setIdentity is the workspace mirror: its first call AFTER the event is the remap.
    b.bridge.window.setIdentity.mockImplementation(async () => void order.push('workspace'))
    await act(async () => b.emitFileDeleted('/v/a.md'))
    expect(order[0]).toBe('retire')
    expect(order).toEqual(['retire', 'workspace'])
    retireSpy.mockRestore()
  })

  it('a file event closes that tab and activates the heir', async () => {
    const files = { '/v/a.md': { content: '# a', mtime: 1 }, '/v/b.md': { content: '# b', mtime: 1 } }
    const b = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] }, files)
    await act(async () => b.emitFileDeleted('/v/a.md'))
    expect(document.title).toContain('b')
  })

  it('a dir event retires and closes every tab under the folder', async () => {
    const retireDir = vi.spyOn(continuity, 'retireDeletedDir')
    const files = { '/v/Docs/a.md': { content: '# a', mtime: 1 }, '/v/x.md': { content: '# x', mtime: 1 } }
    const b = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/Docs/a.md', tabs: ['/v/Docs/a.md', '/v/x.md'] }, files)
    await act(async () => b.emitFileDeleted('/v/Docs', 'dir'))
    expect(retireDir).toHaveBeenCalledWith('/v/Docs')
    expect(document.title).toContain('x')
    retireDir.mockRestore()
  })

  it('the delete path never fetches the index — link rewriting would need it (LOCKED decision C)', async () => {
    // A rename fetches the index to find referencing notes. A delete must NOT: notes linking
    // to a deleted page stay byte-identical. Asserted across BOTH event kinds; the
    // sidebar-triggered call is covered end-to-end in C3, where the menu item exists.
    const files = { '/v/Docs/a.md': { content: '# a', mtime: 1 }, '/v/x.md': { content: '# x', mtime: 1 } }
    const b = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/Docs/a.md', tabs: ['/v/Docs/a.md', '/v/x.md'] }, files)
    b.bridge.index.mockClear()
    await act(async () => b.emitFileDeleted('/v/Docs', 'dir'))
    await act(async () => b.emitFileDeleted('/v/x.md'))
    expect(b.bridge.index).not.toHaveBeenCalled()
    expect(b.bridge.file.rename).not.toHaveBeenCalled()
  })

  it('a delete for a path this window does not have open changes nothing', async () => {
    const files = { '/v/a.md': { content: '# a', mtime: 1 } }
    const b = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }, files)
    const before = document.title
    await act(async () => b.emitFileDeleted('/v/somewhere-else.md'))
    expect(document.title).toBe(before)
  })
})

// ---------------------------------------------------------------- vault open writes nothing

/**
 * Opening a vault creates no file (YAZ-2290). The stub bridge answers `tree` for any path, so
 * this vault has its `.yaseendocs/` — the case that used to get a `Home.md` written into it.
 */
describe('opening a vault creates no file (YAZ-2290)', () => {
  it('a vault with no Home is left exactly as it is, and nothing probes the dotfolder', async () => {
    const b = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(b.bridge.createFile).not.toHaveBeenCalled()
    expect(b.bridge.tree).not.toHaveBeenCalledWith('/v/.yaseendocs')
  })
})

/**
 * An upkeep review (YAZ-2322) REPLACES the main pane and is not a tab: the strip gives way to the
 * review bar, the session's note is the one visible page, and nothing about the workspace —
 * tabs, active tab, right panel — moves until the user moves it. One editor per note, always.
 */
describe('App upkeep review (YAZ-2322)', () => {
  /** A note last changed in 1970: in review by default, and long overdue. */
  const due = (name: string, folder = ''): IndexRecord => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${name}.md`, name: `${name}.md`, basename: name, folder, ext: 'md', size: 1, ctime: 1, mtime: 1,
    properties: {}, aliases: [], tags: [], links: [], embeds: [], text: 'x',
  })
  const withIndex = (...records: IndexRecord[]) => (b: ReturnType<typeof installBridge>) =>
    void b.bridge.index.mockResolvedValue({ root: '/v', records, generatedAt: 1 })
  const TABS: IdentityFixture = { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'] }

  const stripLabels = (el: HTMLElement) => [...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  const layers = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.tabstack__layer')].map((l) => [
      l.querySelector('[data-editor]')?.getAttribute('data-path'),
      l.classList.contains('tabstack__layer--hidden'),
    ])
  const editorsOn = (el: HTMLElement, path: string) => el.querySelectorAll(`[data-editor][data-path="${path}"]`).length
  const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
  const openInbox = () => act(() => captured.sidebar?.onOpenInbox())

  it('the sidebar is handed the due count, and told while a review is open', async () => {
    await mount(defaultAppState(), TABS, {}, withIndex(due('x'), due('y')))
    expect(captured.sidebar?.dueCount).toBe(2)
    expect(captured.sidebar?.reviewing).toBe(false)
    openInbox()
    expect(captured.sidebar?.reviewing).toBe(true)
  })

  it('starting a review moves nothing in the workspace, and closing it returns to exactly the tabs that were there', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const { bridge, el } = await mount(
      defaultAppState(),
      { ...TABS, rightPanel: { open: true, width: 440, items: ['/v/r.md'], expanded: '/v/r.md' } },
      {},
      withIndex(due('x'), due('y')),
    )
    bridge.window.setIdentity.mockClear()
    openInbox()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(document.title).toBe('b — v')
    expect(location.hash).toBe('#/v/b.md')
    expect(el.querySelector('.right-panel__header')?.textContent).toBe('r')
    act(() => button(el, 'Close review')?.click())
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    expect(layers(el)).toEqual([['/v/b.md', false]])
    expect(el.querySelector('.right-panel__header')?.textContent).toBe('r')
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(el.querySelector('.review-answers')).toBeNull()
  })

  it('with a session open the tab strip gives way to the review bar, and the note\'s editor is the only visible layer', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x'), due('y')))
    openInbox()
    expect(el.querySelector('.tabbar')).toBeNull()
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Inbox')
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 2')
    expect(layers(el)).toEqual([
      ['/v/b.md', true],
      ['/v/x.md', false],
    ])
    expect(button(el, 'Still relevant⌘⇧⏎')).toBeDefined()
  })

  it('Skip shows the next note in a layer of its own; the one before is gone', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x'), due('y')))
    openInbox()
    act(() => button(el, 'Skip⌘⇧S')?.click())
    expect(layers(el)).toEqual([
      ['/v/b.md', true],
      ['/v/y.md', false],
    ])
  })

  it('a note that is already an open tab shows through that tab\'s layer — one editor for the path', async () => {
    const { el } = await mount(defaultAppState(), { ...TABS, file: '/v/a.md' }, {}, withIndex(due('a')))
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/b.md', false],
    ])
    openInbox()
    expect(layers(el)).toEqual([
      ['/v/a.md', false],
      ['/v/b.md', true],
    ])
    expect(editorsOn(el, '/v/a.md')).toBe(1)
    act(() => button(el, 'Close review')?.click())
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/b.md', false],
    ])
  })

  it('a note open in the side panel is reviewed there: the main pane says so and mounts no second editor', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const { el } = await mount(
      defaultAppState(),
      { ...TABS, rightPanel: { open: true, width: 440, items: ['/v/r.md'], expanded: '/v/r.md' } },
      {},
      withIndex(due('r')),
    )
    openInbox()
    expect(el.querySelector('.tabstack .review-message')?.textContent).toBe('This note is open in the side panel.')
    expect(layers(el)).toEqual([['/v/b.md', true]])
    expect(editorsOn(el, '/v/r.md')).toBe(1)
    expect(el.querySelector('.review-answers')).not.toBeNull() // the answers still work
  })

  it('nothing due: the empty state, no answers, and "Back to tabs" closes', async () => {
    const { el } = await mount(defaultAppState(), TABS)
    openInbox()
    expect(el.querySelector('.tabstack .review-message p')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.review-answers')).toBeNull()
    act(() => button(el, 'Back to tabs')?.click())
    expect(el.querySelector('.review-message')).toBeNull()
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })

  it('a link clicked in the note opens in a background tab; the review stays', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x')))
    openInbox()
    act(() => el.querySelector<HTMLButtonElement>('[data-path="/v/x.md"] [data-open-right-current]')?.click())
    expect(el.querySelector('.review-bar')).not.toBeNull()
    act(() => button(el, 'Close review')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('b')
  })

  it('"Review this folder" starts a session over that folder alone, named for it', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x'), due('p', 'Work/Projects'), due('q', 'Work/Projects/sub')))
    act(() => captured.sidebar?.onReviewFolder('/v/Work/Projects'))
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Projects')
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 2')
    expect(el.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) [data-editor]')?.getAttribute('data-path')).toBe('/v/Work/Projects/p.md')
  })

  it('the sidebar and the tab menu get the SAME review lookup and write: a note answers, anything else is null', async () => {
    const files = { '/v/a.md': { content: 'Body.\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), TABS, files, withIndex(due('a')))
    expect(captured.sidebar?.reviewState('/v/a.md')).toBe(true)
    expect(captured.sidebar?.reviewState('/v/photo.png')).toBeNull()
    act(() => void el.querySelector('.tabbar__tab')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Turn review off')?.click())
    expect(bridge.writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/v/a.md', content: '---\nreview: false\n---\nBody.\n' }))
  })

  it('the same holds for a note shown through its own tab: its link does not navigate the active tab under the review', async () => {
    const { el } = await mount(defaultAppState(), { ...TABS, file: '/v/a.md' }, {}, withIndex(due('a')))
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    openInbox()
    act(() => el.querySelector<HTMLButtonElement>('[data-path="/v/a.md"] [data-open-right-current]')?.click())
    act(() => button(el, 'Close review')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('b')
  })

  it('clicking the Inbox row again closes the review', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x')))
    openInbox()
    expect(el.querySelector('.review-bar')).not.toBeNull()
    openInbox()
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(captured.sidebar?.reviewing).toBe(false)
  })

  it('opening a file from the sidebar ends the review and shows that file', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('x')))
    openInbox()
    act(() => captured.sidebar?.onOpenFile('/v/a.md'))
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(activeLabel(el)).toBe('a')
  })

  it('File › Close Tab closes the review, not the tab hidden under it', async () => {
    const { el, emitCloseTab } = await mount(defaultAppState(), TABS, {}, withIndex(due('x')))
    openInbox()
    act(() => emitCloseTab())
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })
})

