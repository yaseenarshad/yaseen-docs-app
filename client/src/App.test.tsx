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
import { IDS_FILE } from '@shared/noteId'
import { DEFAULT_SETTINGS, defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type IndexRecord, type IndexResponse, type SidebarTab, type TreeNode, type TreeResponse, type WindowIdentity } from '@shared/types'
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
  /** The first vault of `vaults`, read off them by the stub: the vault the panel is keyed on. */
  root: string
  /** The window's vaults in the order they were added (YAZ-2602 D1): each with its name, its watcher and its index source. */
  vaults: { root: string; name: string; watch: unknown; index: unknown; upkeep: boolean; dueCount: number; reviewing: boolean }[]
  /** The vault rows the user closed (YAZ-2602 R9): App's, for the session. */
  closedVaults: readonly string[]
  onSetVaultOpen: (root: string, open: boolean) => void
  /** "Add vault to this window" (YAZ-2602 D2): resolves whether the vault was added. */
  onAddVault: (path: string) => Promise<boolean>
  /** Its "Open folder…": the system picker, and the picked folder is added. */
  onPickVault: () => void
  /** "Remove from this window" (YAZ-2602 D7). */
  onRemoveVault: (root: string) => void
  /** A drag of a vault row (YAZ-2631 D5): the window's vaults in the new order. */
  onReorderVaults: (next: string[]) => void
  activeFile: string | null
  onOpenFile: (path: string) => void
  /** A double click on a row (YAZ-2648 D2): the workspace's openKept. */
  onKeepFile: (path: string) => void
  onOpenFileBackground: (path: string) => void
  /** The vault whose folder could not be read. */
  onRootMissing: (root: string) => void
  onFileMissing: () => void
  /** The ONE rename door (⚡ YAZ-888): the inline rename AND the drag-move both arrive through it. */
  onRenameFile: (oldPath: string, newPath: string, kind: 'file' | 'dir') => Promise<void>
  /** A title edit (YAZ-2420 D16) arrives at that same door. */
  onRetitle: (path: string, title: string, kind: 'file' | 'dir') => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  pendingSearchFocus: boolean
  /** The sidebar put the caret in the bar (YAZ-801): App lowers the flag. */
  onSearchFocusHandled: () => void
  /** ⌘O (YAZ-1767 D8): a counter, bumped per request; 0 = none pending for this root. */
  switcherOpenRequest: number
  /** The lens tabs (YAZ-847): App owns the value and the write-through; the sidebar only reports clicks. */
  lens: SidebarTab
  onLensChange: (lens: SidebarTab) => void
  onCollapse: () => void
  revealRequest?: { id: number; path: string; focus?: boolean }
  onRevealConsumed?: (id: number) => void
  /** The row menu a row of the new tab page asked for (YAZ-2663 D6): the Sidebar opens its own menu for the path, at the point. */
  menuRequest?: { id: number; path: string; x: number; y: number } | null
  onMenuConsumed?: (id: number) => void
  /** The way out of the empty search bar (YAZ-2663 D7, S33): the keyboard focus goes to the new tab page, when one shows and has a row. */
  onLeaveToPage?: () => boolean
  /** A folder search row (🔒 D3, YAZ-1491): App flips to Files and issues a reveal request for the dir — with `focus` when the keyboard asked (YAZ-2662 D1, D8). */
  onRevealInFiles?: (path: string, focus?: boolean) => void
  /** The preview panel of the search (YAZ-2662 D5): the path that App draws, and the one door that names it or clears it. */
  previewPath: string | null
  onPreview: (path: string | null) => void
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
  /** Whether this vault has upkeep review on (YAZ-2322 🔒 D7): the Inbox row and "Review this folder" exist only then. */
  upkeep: boolean
  /** The Inbox row (YAZ-2322): App counts what is due and owns the one review session. */
  dueCount: number
  reviewing: boolean
  onOpenInbox: () => void
  /** An Inbox row's click (YAZ-2602 R5): the vault whose row it is. */
  onInbox: (root: string) => void
  /** "Review this folder" (YAZ-2322): the sidebar hands the folder's ABSOLUTE path. */
  onReviewFolder: (dirPath: string) => void
  /** The row menu's review toggle (YAZ-2322): the hook's lookup and its write, straight through. */
  reviewState: (path: string) => boolean | null
  onSetReview: (path: string, on: boolean) => void
  /** The vault menu's "Open in this window" (YAZ-1798 D11): the one in-place switch. */
  onOpenVaultHere: (path: string) => Promise<boolean>
}

const captured = vi.hoisted(() => ({
  sidebar: null as SidebarStubProps | null,
  /** Sidebar stub renders — one per App render while the sidebar is open. */
  sidebarRenders: 0,
  editorOpeners: [] as { path: string | null; open: (path: string) => void }[],
  /** The page title's commit, as the newest editor was handed it (YAZ-2420 D16). */
  editorRetitle: undefined as ((path: string, title: string, kind: 'file' | 'dir') => void) | undefined,
  viewOnlyLinks: [] as Array<ViewOnlyLinkSource | undefined>,
  /** The new tab page (YAZ-2663 D3), as App last handed it its doors; null while it does not show. */
  startPage: null as { roots: readonly string[]; onOpen: (path: string) => void; onOpenBackground: (path: string) => void; onShowInFiles: (path: string) => void; onBack: () => void; onRowMenu: (path: string, x: number, y: number) => void; onBackToSearch: () => void; focusRef: { current: (() => boolean) | null }; previewPath?: string | null; onPreview?: (path: string | null) => void } | null,
  /** The door of the new tab page stub (YAZ-2663 S33): whether its first row took the keyboard focus. */
  startPageFocus: vi.fn(() => true),
  /** One entry per Editor stub render, with the vault it was handed (YAZ-2602): its root, its index source, the window's new-note folder. */
  editors: [] as { path: string | null; root: string; wikilinks: unknown; sync?: { state: string } | null; newNoteFolderFor?: (sourcePath: string) => string; onUserEdit?: (path: string) => void }[],
}))

vi.mock('./editor/Editor', () => ({
  Editor: ({ root, path, onOpenFile, onOpenFileBackground, viewOnlyLinks, reviewSettings, onRetitle, wikilinks, sync, newNoteFolderFor, onUserEdit }: { root: string; path: string | null; onOpenFile: (path: string) => void; onOpenFileBackground?: (path: string) => void; viewOnlyLinks?: ViewOnlyLinkSource; reviewSettings?: unknown; onRetitle?: (path: string, title: string, kind: 'file' | 'dir') => void; wikilinks?: unknown; sync?: { state: string } | null; newNoteFolderFor?: (sourcePath: string) => string; onUserEdit?: (path: string) => void }) => {
    captured.editors.push({ path, root, wikilinks, sync, newNoteFolderFor, onUserEdit })
    captured.editorOpeners.push({ path, open: onOpenFile })
    captured.editorRetitle = onRetitle
    captured.viewOnlyLinks.push(viewOnlyLinks)
    return (
      <div data-editor data-root={root} data-path={path ?? ''} data-review-settings={reviewSettings === undefined ? 'none' : 'given'}>
        <button type="button" data-open-right-current onClick={() => onOpenFile('/v/c.md')} />
        <button type="button" data-open-right-background onClick={() => onOpenFileBackground?.('/v/d.md')} />
      </div>
    )
  },
}))
// The new tab page reads the favorites and the trees itself (StartPage.test.tsx): here it is a stub that shows whether App mounts it.
vi.mock('./workspace/StartPage', async () => {
  const { useEffect } = await import('react')
  return {
    StartPage: (props: NonNullable<typeof captured.startPage>) => {
      // In an effect, each render: StrictMode runs the clean-up of a mount one time before the page stays.
      useEffect(() => {
        captured.startPage = props
        // The page fills App's box with its way in, and empties it when it goes (YAZ-2663 S33).
        props.focusRef.current = captured.startPageFocus
        return () => {
          captured.startPage = null
          props.focusRef.current = null
        }
      })
      return <div data-start-page data-roots={props.roots.join(' ')} />
    },
  }
})
vi.mock('./sidebar/Sidebar', () => ({
  Sidebar: (props: Omit<SidebarStubProps, 'root' | 'upkeep' | 'dueCount' | 'reviewing' | 'onOpenInbox'>) => {
    // The first vault's own, as a window with one vault reads them: its folder and its Inbox row (YAZ-2602 R5).
    const { root, upkeep, dueCount, reviewing } = props.vaults[0]
    captured.sidebar = { ...props, root, upkeep, dueCount, reviewing, onOpenInbox: () => props.onInbox(root) }
    captured.sidebarRenders++
    return <aside ref={props.asideRef} data-sidebar data-root={root} />
  },
}))

import { App } from './App'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The full `window.yaseenDocs` surface the App tree touches, all observable. `files` backs readFile/writeFile (the E1c rewrite path). */
type IdentityFixture = Omit<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusList'> & Partial<Pick<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusList'>>

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
  const menuTabOverview = new Set<() => void>()
  const menuNewTab = new Set<() => void>()
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
    index: vi.fn(async (root: string): Promise<IndexResponse> => ({ root, records: [], folders: [], generatedAt: 1, ids: true })),
    // No cold diff by default (E1c, GRO-2242): the external-rename tests stub a hit.
    coldDiff: vi.fn(async (_root?: string): Promise<unknown> => null),
    readFile: vi.fn(async (path: string) => {
      const f = files[path]
      if (f === undefined) return Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist', path })
      return { path, content: f.content, mtime: f.mtime, size: f.content.length }
    }),
    // The tab board's pages (YAZ-2648 D6): no note has a head here, so a page shows its title.
    readHeads: vi.fn(async (paths: readonly string[]) => paths.map(() => null)),
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
    watch: vi.fn((_root?: string, _listener?: unknown): (() => void) => () => undefined),
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
        roots: identity.roots ?? (identity.root === null ? [] : [identity.root]),
        rightPanel: identity.rightPanel ?? defaultRightPanelIdentity(),
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'favorites',
        focusList: identity.focusList ?? [],
      })),
      setIdentity: vi.fn(async () => undefined),
      open: vi.fn(),
      duplicate: vi.fn(),
      closeSelf: vi.fn(async () => undefined),
      // Main's one open-recent door (YAZ-1767 D1): a vault window's picks and Open Recent land here (YAZ-1914 D1).
      openRecent: vi.fn(async (_path: string) => true),
      // Main saves the CALLING window's vaults under the name (YAZ-2602 D8): a reorder asks it for the workspace that matches (YAZ-2631 D5).
      saveSet: vi.fn(async (_name: string) => true),
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
      onTabOverview: menuSub(menuTabOverview),
      onNewTab: menuSub(menuNewTab),
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
      ready: vi.fn(async () => undefined),
    },
    // In-app rename (Links E1, GRO-2194) + external repair (E1c, GRO-2242): App subscribes to
    // the renamed push on mount; the banner's Update goes through repairRename.
    file: {
      rename: vi.fn(async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => ({ oldPath, newPath })),
      // A title edit (YAZ-2420 D16): the name main would build is each test's to say; by default the path stands.
      retitle: vi.fn(async ({ path }: { path: string; title: string }) => ({ oldPath: path, newPath: path, kind: 'file' as 'file' | 'dir' })),
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
    // No `review.json` (YAZ-2322), so upkeep is off: App owns one `useReviewSettings`, which reads and subscribes on vault open.
    vaultConfig: { read: vi.fn(async (_root?: string, _name?: string): Promise<unknown> => null), write: vi.fn(async () => undefined), onChange: vi.fn(() => () => undefined) },
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
    emitTabOverview: () => menuTabOverview.forEach((l) => l()),
    emitNewTab: () => menuNewTab.forEach((l) => l()),
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
  captured.startPage = null
  captured.editorOpeners = []
  captured.viewOnlyLinks = []
  captured.editors = []
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
      [{ root: '/w', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusList: [] }],
      [{ tabs: ['/w/b.md'], file: '/w/b.md', rightPanel: defaultRightPanelIdentity() }],
    ])
    expect(captured.sidebar?.lens).toBe('files') // the Welcome window's stored lens was Favorites; the vault lands on Files (YAZ-1846 D2)
  })

  it('switching to a folder with no remembered last file leaves no file open', async () => {
    const { bridge, el, emitOpenRoot } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    await act(async () => emitOpenRoot('/w'))
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(el.querySelector('[data-start-page]')?.getAttribute('data-roots')).toBe('/w')
    expect(location.hash).toBe('')
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ root: '/w', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusList: [] }]])
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

describe('App window title (C3, GRO-2165; vault first, YAZ-2555 D6)', () => {
  it('is the app name on Welcome, then "<folder> — <file>" once a folder with a file opens', async () => {
    const state = withFolder(defaultAppState(), '/vaults/w', '/vaults/w/Note.md')
    const { emitOpenRoot } = await mount(state, { id: 'w1', root: null, file: null, tabs: [] })
    expect(document.title).toBe('Yaseen Docs')
    await act(async () => emitOpenRoot('/vaults/w'))
    expect(document.title).toBe('w — Note')
  })

  it('is the folder alone with no file open', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/vaults/empty', file: null, tabs: [] })
    expect(document.title).toBe('empty')
  })

  it('a FOLDER tab named like a file keeps its whole name, in the title and on the strip, once the Files tree says so (YAZ-2290)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/vaults/named', file: '/vaults/named/Notes.md', tabs: ['/vaults/named/Notes.md'] })
    bridge.tree.mockResolvedValueOnce({ root: '/vaults/named', tree: [{ type: 'dir', name: 'Notes.md', path: '/vaults/named/Notes.md', children: [] }], generatedAt: 2 })
    await act(async () => void (await fetchTree('/vaults/named')))
    expect(document.title).toBe('named — Notes.md')
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
    expect(document.title).toBe('v — C')
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

  it('the sidebar’s Reveal-in-Files request flips the lens to FILES and issues a reveal request, ids shared with the tab menu (YAZ-1491)', async () => {
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

  it('Enter on a folder of the search tree, and Shift+Enter on a row, ask with `focus`: the request says so, and one from a menu does not (YAZ-2662 D1, D8, S12)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    act(() => captured.sidebar?.onLensChange('search'))
    act(() => captured.sidebar?.onRevealInFiles?.('/v/sub', true))
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toEqual({ id: 1, path: '/v/sub', focus: true })
    // S12: "Show in sidebar" — of a row, and of a tab — asks for the row alone.
    act(() => captured.sidebar?.onRevealInFiles?.('/v/sub'))
    expect(captured.sidebar?.revealRequest).toStrictEqual({ id: 2, path: '/v/sub', focus: undefined })
    rightClick(el.querySelector('.tabbar__tab')!)
    act(() => showInSidebar(el)?.click())
    expect(captured.sidebar?.revealRequest).toStrictEqual({ id: 3, path: '/v/a.md' })
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('a') // no tab opened
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
    expect(captured.sidebar?.lens).toBe('search') // S3 (YAZ-2638): the sidebar shows first, and it mounts on the Search tab
  })

  it('with the sidebar already open it shows the Search tab and raises the focus flag (YAZ-2638 S2)', async () => {
    const { bridge, emitSearch } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect(captured.sidebar?.pendingSearchFocus).toBe(false)
    act(() => emitSearch())
    expect(captured.sidebar?.lens).toBe('search')
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith({ sidebarCollapsed: false })
  })

  it('S15 (YAZ-2638): the Search tab is never stored — ⌘K and a click on the tab show it, `storage.setSidebarLens` never gets `search`, and the stored lens is the last lens', async () => {
    const setLens = vi.spyOn(storage, 'setSidebarLens')
    const { bridge, emitSearch } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => emitSearch())
    expect(captured.sidebar?.lens).toBe('search')
    expect(storage.getSidebarLens()).toBe('favorites') // the fixture's lens: what a window that starts again opens on
    // Esc in the bar: the sidebar asks for the lens the window last showed.
    act(() => captured.sidebar?.onLensChange(storage.getSidebarLens()))
    expect(captured.sidebar?.lens).toBe('favorites')
    act(() => captured.sidebar?.onLensChange('files'))
    // S5: a click on the Search tab.
    act(() => captured.sidebar?.onLensChange('search'))
    expect(captured.sidebar?.lens).toBe('search')
    expect(storage.getSidebarLens()).toBe('files')
    expect(setLens.mock.calls).toEqual([['files']]) // the Esc asked for the lens that is stored: nothing to write
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ sidebarLens: 'search' }))
  })

  it('S4, S5 (YAZ-2638): a click on the Search tab asks for the caret as ⌘K does — `onLensChange(\'search\')` raises the focus flag, also while the Search tab shows', async () => {
    await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['favorites', false])
    act(() => captured.sidebar?.onLensChange('search'))
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])
    act(() => captured.sidebar?.onSearchFocusHandled()) // the bar took the caret
    expect(captured.sidebar?.pendingSearchFocus).toBe(false)
    // The Search tab shows already: the click asks again.
    act(() => captured.sidebar?.onLensChange('search'))
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])
    act(() => captured.sidebar?.onSearchFocusHandled())
    // A lens asks for no caret.
    act(() => captured.sidebar?.onLensChange('files'))
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['files', false])
  })

  it('S16 (YAZ-2638): a switch to a different vault from the Search tab lands on Files (YAZ-1846), on a sidebar of its own key — so the text is gone', async () => {
    const { el, emitSearch } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => emitSearch())
    expect([captured.sidebar?.lens, el.querySelector('[data-sidebar]')?.getAttribute('data-root')]).toEqual(['search', '/v'])
    // The vault menu's "Open in this window" (YAZ-1798): the one in-place switch of a window that has a vault.
    await act(async () => void (await captured.sidebar?.onOpenVaultHere('/w')))
    expect([captured.sidebar?.lens, el.querySelector('[data-sidebar]')?.getAttribute('data-root')]).toEqual(['files', '/w'])
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

  it('a reorder of the vaults mounts no sidebar again, so it changes no request: the panel that was asked is not toggled (YAZ-2631 D5)', async () => {
    const { emitSwitchVault } = await mount(defaultAppState(), { id: 'w1', root: '/v', roots: ['/v', '/w'], file: null, tabs: [] })
    act(() => emitSwitchVault())
    expect(captured.sidebar?.switcherOpenRequest).toBe(1)
    for (const order of [['/w', '/v'], ['/v', '/w']]) {
      act(() => captured.sidebar?.onReorderVaults(order))
      expect(captured.sidebar?.switcherOpenRequest).toBe(1)
    }
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
    ['/v/data.json', '/v/report.PDF', ['data.json', 'report.PDF'], 'v — data.json'],
    ['/v/report.PDF', '/v/data.json', ['report.PDF', 'data.json'], 'v — report.PDF'],
    ['/v/photo.PNG', '/v/data.json', ['photo.PNG', 'data.json'], 'v — photo.PNG'],
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
    expect(document.title).toBe('v — report.PDF')
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
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
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

  it('a sidebar click opens in the PREVIEW tab (YAZ-2648 D1): a new tab at the end, no kept tab replaced; the next click reuses it; a double click or the first edit keeps it (D2)', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/x.md'] })
    const previewLabels = () => [...el.querySelectorAll('.tabbar__tab--preview [role="tab"]')].map((t) => t.textContent)
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'x', 'b'])
    expect(previewLabels()).toEqual(['b'])
    // a was not replaced: its editor stays mounted, hidden.
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/b.md', false],
    ])
    // ONE explicit identity write carries BOTH halves — never the legacy {file}-only patch.
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/x.md', '/v/b.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/v', { lastFile: '/v/b.md' })

    // The next click takes the preview tab's slot: b's editor is GONE (→ autosave flush on unmount).
    act(() => captured.sidebar?.onOpenFile('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'x', 'c'])
    expect(previewLabels()).toEqual(['c'])
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/c.md', false],
    ])

    // A double click keeps it: the mark is the session's (D4). The next click gets a NEW preview tab.
    act(() => captured.sidebar?.onKeepFile('/v/c.md'))
    expect(previewLabels()).toEqual([])
    act(() => captured.sidebar?.onOpenFile('/v/d.md'))
    expect(stripLabels(el)).toEqual(['a', 'x', 'c', 'd'])
    expect(previewLabels()).toEqual(['d'])

    // The first edit of the page keeps it too; an edit in a kept tab changes nothing.
    act(() => captured.editors.filter((editor) => editor.path === '/v/d.md').at(-1)?.onUserEdit?.('/v/d.md'))
    expect(previewLabels()).toEqual([])
    expect(stripLabels(el)).toEqual(['a', 'x', 'c', 'd'])
  })

  it('the blank tab (YAZ-2655): ⌘T and "+" show "New tab" last and active over an empty page, with the caret asked into the search bar; the next page fills it as a KEPT tab (S70, S71, S74, S81)', async () => {
    const { bridge, el, emitNewTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => emitNewTab())
    expect(stripLabels(el)).toEqual(['a', 'b', 'New tab'])
    expect(activeLabel(el)).toBe('New tab')
    // The new tab page a window with no tabs has (YAZ-2663 S11); a's editor stays mounted, hidden behind it.
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
    expect(layers(el)).toEqual([['/v/a.md', true]])
    // D11: the Search tab, with its bar asked to take the caret. The sidebar highlights no row: every row opens.
    expect(captured.sidebar?.lens).toBe('search')
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)
    expect(captured.sidebar?.activeFile).toBeNull()
    // S81: the title shows the vault only.
    expect(document.title).toBe('v')

    // S79: Esc in the search bar goes back to the lens the window showed, as ever; the blank tab stays.
    act(() => captured.sidebar?.onLensChange('files'))
    expect(captured.sidebar?.lens).toBe('files')
    expect(activeLabel(el)).toBe('New tab')
    const writes = bridge.window.setIdentity.mock.calls.length

    // S74: again — by the "+" this time — and there is still one, and the bar is asked for again.
    act(() => captured.sidebar?.onSearchFocusHandled())
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="New tab"]')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b', 'New tab'])
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)

    // S71: the page the user opens fills it — a kept tab where the blank tab stood, in ONE ordinary write.
    act(() => captured.sidebar?.onOpenFile('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('c')
    expect(el.querySelector('.tabbar__tab--preview')).toBeNull()
    expect(el.querySelector('.tabstack > [data-start-page]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md', '/v/c.md'], file: '/v/c.md', rightPanel: defaultRightPanelIdentity() })
    expect(document.title).toBe('v — c')
  })

  it('the blank tab goes away unused (YAZ-2655): for a page that is open already, for a click on a tab, for ⌘W and its ✕ — which close it alone — and when the board opens; ⌘-click leaves it active (S72, S73, S75, S78, S80)', async () => {
    const { bridge, el, emitNewTab, emitCloseTab, emitTabOverview } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const tab = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.tabbar [role="tab"]')].find((t) => t.textContent === label)
    // S72: a page that is open already — here the very tab that was active before.
    act(() => emitNewTab())
    act(() => captured.sidebar?.onOpenFile('/v/a.md'))
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('a')
    // S73: a click on a tab.
    act(() => emitNewTab())
    act(() => tab('b')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    // S75: ⌘W closes the blank tab only, and b is active again; so does its ✕.
    act(() => emitNewTab())
    act(() => emitCloseTab())
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    act(() => emitNewTab())
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Close New tab"]')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    // S78: ⌘-click opens a kept tab in the background, before the blank tab, which stays active.
    act(() => emitNewTab())
    act(() => captured.sidebar?.onOpenFileBackground('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'b', 'c', 'New tab'])
    expect(activeLabel(el)).toBe('New tab')
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md', '/v/c.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
    // S80: the board opens without it, and it is no page of the board.
    act(() => emitTabOverview())
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect([...el.querySelectorAll('.taboverview__title')].map((t) => t.textContent)).toEqual(['a', 'b', 'c'])
    // ⌘T from the board: the board closes for the blank tab.
    act(() => emitNewTab())
    expect(el.querySelector('.taboverview')).toBeNull()
    expect(activeLabel(el)).toBe('New tab')
  })

  it('⌘T in a window with no tabs shows the blank tab (S77); ⌘W then closes it, and only the next ⌘W the window', async () => {
    const { bridge, el, emitNewTab, emitCloseTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    act(() => emitNewTab())
    expect(stripLabels(el)).toEqual(['New tab'])
    expect(captured.sidebar?.pendingSearchFocus).toBe(true)
    act(() => emitCloseTab())
    expect(stripLabels(el)).toEqual([])
    expect(bridge.window.closeSelf).not.toHaveBeenCalled()
    act(() => emitCloseTab())
    expect(bridge.window.closeSelf).toHaveBeenCalledTimes(1)
  })

  it('the new tab page (YAZ-2663 D3) shows under the blank tab and in a window with no tabs, and only then (S11, R1); a click on a file row fills the blank tab as a KEPT tab, and ⌘-click opens a background tab and the page stays (S21)', async () => {
    const { el, emitNewTab, emitCloseTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    // A tab shows: the page is not mounted.
    expect(captured.startPage).toBeNull()
    act(() => emitNewTab())
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
    act(() => captured.startPage?.onOpenBackground('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'c', 'New tab'])
    expect(activeLabel(el)).toBe('New tab')
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
    act(() => captured.startPage?.onOpen('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'c', 'b'])
    expect(activeLabel(el)).toBe('b')
    expect(el.querySelector('.tabbar__tab--preview')).toBeNull()
    expect(el.querySelector('[data-start-page]')).toBeNull()
    expect(captured.startPage).toBeNull()
    // The last tab closes: the window with no tabs shows the same page.
    for (let left = 3; left > 0; left--) act(() => emitCloseTab())
    expect(stripLabels(el)).toEqual([])
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
  })

  it('a folder row of the new tab page shows the folder in Files, open, with the keyboard focus on its row — the sidebar shows first when it is hidden — and opens no tab (YAZ-2663 S22)', async () => {
    const { el, emitNewTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: true, sidebarLens: 'favorites' })
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => captured.startPage?.onShowInFiles('/v/Projects'))
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toMatchObject({ path: '/v/Projects', focus: true })
    expect(stripLabels(el)).toEqual([])
    // From the blank tab, where ⌘T put the Search tab on show: Files again, a new request, and the blank tab stays.
    const first = captured.sidebar?.revealRequest?.id
    act(() => emitNewTab())
    expect(captured.sidebar?.lens).toBe('search')
    act(() => captured.startPage?.onShowInFiles('/v/Projects/Alpha'))
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toMatchObject({ path: '/v/Projects/Alpha', focus: true })
    expect(captured.sidebar?.revealRequest?.id).not.toBe(first)
    expect(stripLabels(el)).toEqual(['New tab'])
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
  })

  it('the keys of the new tab page (YAZ-2663 D7): from the empty search bar the sidebar asks the page for the focus, and only a page that shows answers (S33); ← on the first column, Esc and a typed letter put the caret in the search bar (S37, S41); Shift+Enter shows a file in Files with the keyboard focus on its row (S38)', async () => {
    const { el, emitNewTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarLens: 'files' })
    captured.startPageFocus.mockClear()
    // A tab shows, and no page: the way out of the bar leads nowhere, and the key stays the bar's.
    expect(captured.sidebar?.onLeaveToPage?.()).toBe(false)
    act(() => emitNewTab())
    expect(captured.sidebar?.onLeaveToPage?.()).toBe(true)
    expect(captured.startPageFocus).toHaveBeenCalledTimes(1)
    captured.startPageFocus.mockReturnValueOnce(false) // no column has a row
    expect(captured.sidebar?.onLeaveToPage?.()).toBe(false)

    // The way back, from any tab of the sidebar and from a hidden sidebar: the Search tab, and the caret in its bar.
    act(() => captured.sidebar?.onLensChange('favorites'))
    act(() => captured.sidebar?.onSearchFocusHandled())
    act(() => captured.sidebar?.onCollapse())
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => captured.startPage?.onBackToSearch())
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])

    // The way back is to where the keyboard came from (YAZ-2663 D8). From a row of a sidebar tree — → on a
    // file row of Files, Focus or Favorites — ← and Esc put the focus on that row again, and the tab of the sidebar stays.
    act(() => captured.sidebar?.onLensChange('favorites'))
    act(() => captured.sidebar?.onSearchFocusHandled())
    const treeRow = document.createElement('button')
    treeRow.className = 'tree__row'
    el.querySelector('[data-sidebar]')?.append(treeRow)
    treeRow.focus()
    expect(captured.sidebar?.onLeaveToPage?.()).toBe(true)
    act(() => (document.activeElement as HTMLElement).blur()) // the page took the focus
    act(() => captured.startPage?.onBack())
    expect([document.activeElement, captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual([treeRow, 'favorites', false])
    // That is one trip: with no way in since, back is the search bar. So it is when the row is gone, and when the keyboard came from the bar.
    act(() => captured.startPage?.onBack())
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])
    act(() => captured.sidebar?.onLensChange('favorites'))
    act(() => captured.sidebar?.onSearchFocusHandled())
    treeRow.focus()
    expect(captured.sidebar?.onLeaveToPage?.()).toBe(true)
    treeRow.remove()
    act(() => captured.startPage?.onBack())
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])
    // A typed letter is the search's, wherever the keyboard came from.
    act(() => captured.sidebar?.onLensChange('files'))
    act(() => captured.sidebar?.onSearchFocusHandled())
    act(() => captured.startPage?.onBackToSearch())
    expect([captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]).toEqual(['search', true])

    // Shift+Enter on a file row: the door of the folder row (S22), with the keyboard focus on the row. The blank tab stays.
    act(() => captured.startPage?.onShowInFiles('/v/b.md'))
    expect(captured.sidebar?.lens).toBe('files')
    expect(captured.sidebar?.revealRequest).toMatchObject({ path: '/v/b.md', focus: true })
    expect(stripLabels(el)).toEqual(['a', 'New tab'])
    // Space on a file of the page shows the preview panel of the search (S39; YAZ-2662 D5) on the page's own path:
    // the search follows its own highlight, so the two do not share one. The ✕ of the panel clears it.
    expect([captured.startPage?.previewPath, el.querySelector('.quicklook')]).toEqual([null, null])
    act(() => captured.startPage?.onPreview?.('/v/archive.zip'))
    expect([captured.startPage?.previewPath, captured.sidebar?.previewPath]).toEqual(['/v/archive.zip', null])
    expect(el.querySelector('.tabstack > .quicklook .quicklook__title')?.textContent).toBe('archive.zip')
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull() // S26: the panel is over the page, which stays
    act(() => el.querySelector<HTMLButtonElement>('.quicklook button')?.click())
    expect([captured.startPage?.previewPath, el.querySelector('.quicklook')]).toEqual([null, null])
  })

  it('the preview panel draws the file of the LAST one that asked (YAZ-2663 S39): the search names a file while the panel shows a row of the new tab page — the panel is the search\'s, and the page reads that its own is gone; the panel of the page writes nothing of the window (S5)', async () => {
    const { bridge, el, emitNewTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    act(() => emitNewTab())
    const writes = bridge.window.setIdentity.mock.calls.length
    const drawn = () => [...el.querySelectorAll('.quicklook__title')].map((t) => t.textContent)
    act(() => captured.startPage?.onPreview?.('/v/archive.zip'))
    expect(drawn()).toEqual(['archive.zip'])
    // ⌘K, a word, ↓ and Space: the search asks for its file. Its Esc then closes the panel.
    act(() => captured.sidebar?.onPreview('/v/book.epub'))
    expect(drawn()).toEqual(['book.epub'])
    expect([captured.startPage?.previewPath, captured.sidebar?.previewPath]).toEqual([null, '/v/book.epub'])
    act(() => captured.sidebar?.onPreview(null))
    expect(drawn()).toEqual([])
    // The other way: the page asks while the search holds a file. The panel is the page's until the page lets it go.
    act(() => captured.sidebar?.onPreview('/v/book.epub'))
    act(() => captured.startPage?.onPreview?.('/v/archive.zip'))
    expect(drawn()).toEqual(['archive.zip'])
    act(() => captured.startPage?.onPreview?.(null))
    expect(drawn()).toEqual(['book.epub'])
    // S5: a panel is no page on show. Nothing went to the window identity, so the record got no use.
    expect(bridge.window.setIdentity.mock.calls.length).toBe(writes)
  })

  it('a right-click on a row of the new tab page asks the sidebar for its row menu of that path at the mouse; the sidebar shows first when it is hidden, and a consumed request does not replay (YAZ-2663 S27, S31)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: true, sidebarLens: 'favorites' })
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    act(() => captured.startPage?.onRowMenu('/v/a.md', 412, 96))
    // S31: the sidebar mounts with the request already set, on the tab it had: a row menu changes no tab.
    expect(el.querySelector('[data-sidebar]')).not.toBeNull()
    expect(captured.sidebar?.lens).toBe('favorites')
    expect(captured.sidebar?.menuRequest).toMatchObject({ path: '/v/a.md', x: 412, y: 96 })
    expect(captured.sidebar?.revealRequest ?? null).toBeNull()
    const first = captured.sidebar!.menuRequest!.id
    act(() => captured.sidebar?.onMenuConsumed?.(first))
    expect(captured.sidebar?.menuRequest).toBeNull()
    // The same row again is a new request; the answer to the old one does not take it away.
    act(() => captured.startPage?.onRowMenu('/v/a.md', 10, 20))
    expect(captured.sidebar?.menuRequest).toMatchObject({ path: '/v/a.md', x: 10, y: 20 })
    expect(captured.sidebar?.menuRequest?.id).not.toBe(first)
    act(() => captured.sidebar?.onMenuConsumed?.(first))
    expect(captured.sidebar?.menuRequest).not.toBeNull()
    expect(stripLabels(el)).toEqual([])
  })

  it('the preview panel of the search (YAZ-2662 S31, S43): the path that the sidebar names shows in a panel over the page area, the last of the stack and no layer of it — no tab opens, no page changes and nothing is stored; the ✕ closes it, and the sidebar reads that', async () => {
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const before = { strip: stripLabels(el), layers: layers(el), writes: bridge.window.setIdentity.mock.calls.length }
    expect([captured.sidebar?.previewPath, el.querySelector('.quicklook')]).toEqual([null, null])
    act(() => captured.sidebar?.onPreview('/v/archive.zip'))
    const panel = el.querySelector('.tabstack > .quicklook')
    expect(panel).toBe(el.querySelector('.tabstack')?.lastElementChild)
    expect([panel?.querySelector('.quicklook__title')?.textContent, panel?.querySelector('.quicklook__body')?.textContent]).toEqual(['archive.zip', 'No preview for this file.'])
    expect(captured.sidebar?.previewPath).toBe('/v/archive.zip')
    expect({ strip: stripLabels(el), layers: layers(el), writes: bridge.window.setIdentity.mock.calls.length }).toEqual(before)
    expect([activeLabel(el), captured.sidebar?.activeFile, el.querySelector('.tabbar__tab--preview')]).toEqual(['a', '/v/a.md', null])
    // The panel follows the highlight: the next path takes its place.
    act(() => captured.sidebar?.onPreview('/v/book.epub'))
    expect([...el.querySelectorAll('.quicklook__title')].map((t) => t.textContent)).toEqual(['book.epub'])
    act(() => el.querySelector<HTMLButtonElement>('.quicklook button[aria-label="Close preview"]')?.click())
    expect([el.querySelector('.quicklook'), captured.sidebar?.previewPath]).toEqual([null, null])
    expect({ strip: stripLabels(el), layers: layers(el), writes: bridge.window.setIdentity.mock.calls.length }).toEqual(before)
  })

  it('the preview panel over the blank tab (YAZ-2662 S45): it shows over the empty page, and the blank tab stays', async () => {
    const { el, emitNewTab } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    act(() => emitNewTab())
    act(() => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(el.querySelector('.tabstack > .quicklook .quicklook__title')?.textContent).toBe('archive.zip')
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull() // the empty page is the new tab page (YAZ-2663 D3, S26)
    expect([stripLabels(el), activeLabel(el)]).toEqual([['a', 'New tab'], 'New tab'])
    act(() => captured.sidebar?.onPreview(null))
    expect(el.querySelector('.quicklook')).toBeNull()
    expect(activeLabel(el)).toBe('New tab')
  })

  it('the preview panel gives way to the tab board (YAZ-2662 S67): the board closes the panel, the sidebar reads that, a path named under the board shows no panel, and none comes back when the board closes', async () => {
    const { el, emitTabOverview } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const shown = () => [el.querySelector('.quicklook') !== null, captured.sidebar?.previewPath, el.querySelector('.taboverview') !== null]
    act(() => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(shown()).toEqual([true, '/v/archive.zip', false])
    await act(async () => emitTabOverview())
    expect(shown()).toEqual([false, null, true])
    await act(async () => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(shown()).toEqual([false, null, true])
    await act(async () => emitTabOverview())
    expect(shown()).toEqual([false, null, false])
    // With the board closed the door is the door again.
    act(() => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(shown()).toEqual([true, '/v/archive.zip', false])
  })

  it('Esc with the keyboard focus inside the preview panel (YAZ-2662 S66): the panel closes and the caret is asked back into the search bar, by the door of ⌘K; the ✕ with the caret outside the panel moves no caret', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    const show = () => {
      act(() => captured.sidebar?.onLensChange('search'))
      act(() => captured.sidebar?.onSearchFocusHandled())
      act(() => captured.sidebar?.onPreview('/v/archive.zip'))
      return el.querySelector<HTMLElement>('.quicklook')!
    }
    const state = () => [el.querySelector('.quicklook') !== null, captured.sidebar?.previewPath, captured.sidebar?.lens, captured.sidebar?.pendingSearchFocus]
    show()
    expect(state()).toEqual([true, '/v/archive.zip', 'search', false])
    act(() => el.querySelector<HTMLButtonElement>('.quicklook button[aria-label="Close preview"]')?.click())
    expect(state()).toEqual([false, null, 'search', false])
    // A click in the panel left the keyboard focus on it.
    const panel = show()
    act(() => panel.focus())
    act(() => void panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(state()).toEqual([false, null, 'search', true])
  })

  it('the strip\'s slide (YAZ-2656 S88) is the strip\'s own: a closed tab slides shut as a ghost and no editor renders for it; with the right panel closed the row keeps its end free (S93)', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) })
    try {
      const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
      expect(el.querySelector('.tabbar-row')?.className).toContain('tabbar-row--end')
      act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Close b"]')?.click())
      expect(stripLabels(el)).toEqual(['a'])
      expect(el.querySelector('.tabbar__tab--out')?.textContent).toBe('b')
      const renders = captured.editors.length
      await act(async () => new Promise((done) => setTimeout(done, 200)))
      expect(el.querySelector('.tabbar__tab--out')).toBeNull()
      expect(captured.editors.length).toBe(renders)
    } finally {
      delete (window as unknown as Record<string, unknown>).matchMedia
    }
  })

  it('the tab board (YAZ-2648 D5): the grid button and the menu key open it over the stack with every editor still mounted; a page opens its tab and closes it; a page ✕ and an island ✕ leave it open; going to a page closes it', async () => {
    const { el, emitTabOverview } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md', '/v/Docs/c.md', '/v/Docs/d.md'] })
    const overview = () => el.querySelector('.taboverview')
    const page = (label: string) => [...el.querySelectorAll<HTMLElement>('.taboverview__page')].find((c) => c.querySelector('.taboverview__title')?.textContent === label)
    const button = el.querySelector<HTMLButtonElement>('[aria-label="Show all open tabs"]')!
    expect(button.getAttribute('aria-pressed')).toBe('false')

    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect([...el.querySelectorAll('.taboverview__title')].map((t) => t.textContent)).toEqual(['a', 'b', 'c', 'd'])
    expect(page('a')?.getAttribute('aria-current')).toBe('page')
    // The page under it is hidden, never unmounted: its scroll, caret and unsaved text stay.
    expect(layers(el)).toEqual([['/v/a.md', true]])
    expect(stripLabels(el)).toEqual(['a', 'b', 'c', 'd']) // the strip stays

    // A page: its tab becomes the active one and the board closes.
    act(() => page('b')?.click())
    expect(overview()).toBeNull()
    expect(activeLabel(el)).toBe('b')
    expect(layers(el)).toEqual([
      ['/v/a.md', true],
      ['/v/b.md', false],
    ])

    // ⌘⇧M (Window › Tab Overview) opens it, and closes it again.
    act(() => emitTabOverview())
    expect(overview()).not.toBeNull()
    act(() => emitTabOverview())
    expect(overview()).toBeNull()

    // A page's ✕ on the ACTIVE tab closes that tab and the board stays; so does an island's ✕, which closes every tab of its folder.
    act(() => emitTabOverview())
    act(() => page('b')?.querySelector<HTMLButtonElement>('.taboverview__close')?.click())
    expect(stripLabels(el)).toEqual(['a', 'c', 'd'])
    expect(overview()).not.toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('[role="group"][aria-label="Docs"] .taboverview__island-close')?.click())
    expect(stripLabels(el)).toEqual(['a'])
    expect(overview()).not.toBeNull()
    // A sidebar click is a trip to a page.
    act(() => captured.sidebar?.onOpenFile('/v/c.md'))
    expect(overview()).toBeNull()
    expect(activeLabel(el)).toBe('c')
  })

  it('the ways off the tab board: every trip to a page closes it, the page ALREADY open too (S46, YAZ-2657 A2); ⌘W closes the tab and it (S47); its last tab closes it (S44, R18). A rename of the open page, an island\'s ✕ — ONE identity write — and "Move to right panel" from a strip tab\'s menu leave it open (R12, R30)', async () => {
    const { bridge, el, emitTabOverview, emitNextTab, emitCloseTab, emitLinkOpenFile, emitFileRenamed } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md', '/v/x.md', '/v/Docs/c.md', '/v/Docs/d.md', '/v/Docs/e.md'] })
    const board = () => el.querySelector('.taboverview')
    const open = () => {
      if (board() === null) act(() => emitTabOverview())
      expect(board()).not.toBeNull()
    }
    const stripTab = (label: string) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab [role="tab"]')].find((tab) => tab.textContent === label)
    /** With the board open: do it, and say whether the board is gone and which tab is the active one. */
    const after = async (trip: () => void) => {
      open()
      await act(async () => trip())
      return [board() === null, activeLabel(el)]
    }

    // S46: a tab of the strip, ⌃Tab, a deep link.
    expect(await after(() => stripTab('b')?.click())).toEqual([true, 'b'])
    expect(await after(() => emitNextTab())).toEqual([true, 'x'])
    expect(await after(() => emitLinkOpenFile('/v/Docs/c.md'))).toEqual([true, 'c'])

    // A rename of the open page, or of a folder above it, is no trip: the board stays (YAZ-2657 A5).
    expect(await after(() => emitFileRenamed('/v/Docs', '/v/Papers', 'dir'))).toEqual([false, 'c'])
    expect(await after(() => emitFileRenamed('/v/Papers/c.md', '/v/Papers/c2.md', 'file'))).toEqual([false, 'c2'])

    // A trip to the page ALREADY open: the active tab does not change, and the board still closes.
    expect(await after(() => stripTab('c2')?.click())).toEqual([true, 'c2'])
    expect(await after(() => captured.sidebar?.onOpenFile('/v/Papers/c2.md'))).toEqual([true, 'c2'])
    expect(await after(() => captured.sidebar?.onKeepFile('/v/Papers/c2.md'))).toEqual([true, 'c2'])
    expect(await after(() => emitLinkOpenFile('/v/Papers/c2.md'))).toEqual([true, 'c2'])

    // An island's ✕ closes its three tabs — the active one with them — in ONE identity write, and the board stays (YAZ-2657 A10).
    open()
    bridge.window.setIdentity.mockClear()
    expect(await after(() => el.querySelector<HTMLButtonElement>('[role="group"][aria-label="Papers"] .taboverview__island-close')?.click())).toEqual([false, 'x'])
    expect(stripLabels(el)).toEqual(['a', 'b', 'x'])
    expect(bridge.window.setIdentity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tabs: ['/v/a.md', '/v/b.md', '/v/x.md'], file: '/v/x.md' }))

    // S47: ⌘W closes the active tab, and then the board.
    expect(await after(() => emitCloseTab())).toEqual([true, 'b'])
    expect(stripLabels(el)).toEqual(['a', 'b'])

    // R30: "Move to right panel" in the menu of the ACTIVE tab of the strip moves the page and leaves the board, as the board's own does (YAZ-2657 A4).
    open()
    act(() => void stripTab('b')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(await after(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((item) => item.textContent === 'Move to right panel')?.click())).toEqual([false, 'a'])
    expect(stripLabels(el)).toEqual(['a'])

    // ⌃Tab with one tab goes to the page already open.
    expect(await after(() => emitNextTab())).toEqual([true, 'a'])

    // S44: the last tab closes from the board: the board closes, and the window shows the empty state.
    open()
    act(() => el.querySelector<HTMLButtonElement>('.taboverview__page .taboverview__close')?.click())
    expect(board()).toBeNull()
    expect(stripLabels(el)).toEqual([])
    expect(el.querySelector('.tabstack > [data-start-page]')).not.toBeNull()
  })

  it('S11: a link in a page opens in THAT tab — a kept tab too — and makes no tab; Back returns (the page\'s door is `navigate`, not the sidebar\'s)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => el.querySelector<HTMLButtonElement>('[data-path="/v/a.md"] [data-open-right-current]')?.click())
    expect(stripLabels(el)).toEqual(['c', 'b'])
    expect(activeLabel(el)).toBe('c')
    expect(el.querySelector('.tabbar__tab--preview')).toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Back"]')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })

  it('a page dragged to the board\'s right edge moves its tab to the right panel — the active one too — and the board stays open (YAZ-2648)', async () => {
    const { bridge, el, emitTabOverview } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => emitTabOverview())
    act(() => void el.querySelector('.taboverview__page')?.dispatchEvent(new Event('dragstart', { bubbles: true })))
    act(() => void el.querySelector('.taboverview__drop')?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })))
    expect(stripLabels(el)).toEqual(['b'])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith(expect.objectContaining({ tabs: ['/v/b.md'], file: '/v/b.md', rightPanel: expect.objectContaining({ open: true, items: ['/v/a.md'] }) }))
    expect([...el.querySelectorAll('.taboverview__title')].map((t) => t.textContent)).toEqual(['b'])
  })

  it('the board\'s zoom (YAZ-2648): the layer it opened from zooms out as it hides; a chosen page is active at once, its layer zooms in under the leaving board, and the board is gone when the zoom is over', async () => {
    // jsdom has no matchMedia, and there the board closes at once (every other test). Here motion is allowed.
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) })
    try {
      const { el, emitTabOverview } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
      const classes = () => [...el.querySelectorAll<HTMLElement>('.tabstack__layer')].map((l) => [l.querySelector('[data-editor]')?.getAttribute('data-path'), l.className.replace(/tabstack__layer(--)?/g, '').trim()])
      const renders = captured.editors.length
      act(() => emitTabOverview())
      expect(classes()).toEqual([['/v/a.md', 'hidden zoom-out']])

      act(() => [...el.querySelectorAll<HTMLElement>('.taboverview__page')][1].click())
      // The tab is the active one already, and both editors are on show's side of the zoom.
      expect(activeLabel(el)).toBe('b')
      expect(el.querySelector<HTMLElement>('.taboverview')?.dataset.zoom).toBe('out')
      expect(classes()).toEqual([
        ['/v/a.md', 'hidden'],
        ['/v/b.md', 'zoom-in'],
      ])
      const mountedB = captured.editors.length
      await act(async () => new Promise((done) => setTimeout(done, 300)))
      expect(el.querySelector('.taboverview')).toBeNull()
      expect(classes()).toEqual([
        ['/v/a.md', 'hidden'],
        ['/v/b.md', ''],
      ])
      // The zoom rendered no editor: a's never again, and b's only as its tab was first shown.
      expect(captured.editors.slice(renders).some((editor) => editor.path === '/v/a.md')).toBe(false)
      expect(captured.editors.length).toBe(mountedB)
    } finally {
      delete (window as unknown as Record<string, unknown>).matchMedia
    }
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
    expect(document.title).toBe('v — b')
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
    expect(el.querySelector('[data-start-page]')).not.toBeNull() // the new tab page shows
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

  it('a deep link activates an already-open file\'s tab; a new file opens in the PREVIEW tab, like a sidebar click (rule 10, YAZ-2648 D1)', async () => {
    const { el, emitLinkOpenFile } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    act(() => emitLinkOpenFile('/v/b.md'))
    expect(stripLabels(el)).toEqual(['a', 'b'])
    expect(activeLabel(el)).toBe('b')
    act(() => emitLinkOpenFile('/v/c.md'))
    expect(stripLabels(el)).toEqual(['a', 'b', 'c']) // no kept tab is replaced
    expect(activeLabel(el)).toBe('c')
  })

  it('a tab\'s menu offers "Copy path" and no "Copy ID", for a note whose id the window\'s index holds as for a note with none, a PDF and an image (YAZ-2420 D31)', async () => {
    const note = (path: string, id?: string): IndexRecord => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { path, ...(id === undefined ? {} : { id }), name, basename: name.replace(/\.md$/i, ''), title: name.replace(/\.md$/i, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
    }
    const tabs = ['/v/a.md', '/v/b.md', '/v/report.PDF', '/v/photo.PNG']
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs }, {}, (b) =>
      b.bridge.index.mockResolvedValue({ root: '/v', records: [note('/v/a.md', 'k3m9x2pq7abc'), note('/v/b.md')], folders: [], generatedAt: 1, ids: true }),
    )
    const menuOf = (path: string) => {
      const tab = el.querySelector<HTMLElement>(`[role="tab"][title="${path}"]`)?.closest<HTMLElement>('.tabbar__tab')
      act(() => void tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      return [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((item) => item.textContent)
    }
    for (const path of tabs) {
      expect(menuOf(path), path).toContain('Copy path')
      expect(menuOf(path), path).not.toContain('Copy ID')
    }
  })

  it('E: the window title, the tab strip, the right panel, the rename sheet and a notice all name a page by its title, off the window\'s index (YAZ-2420 D14)', async () => {
    const ABDUL = '/v/up-001-abdul-k3m9x2pq7abc.md'
    const note = (path: string, title: string): IndexRecord => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { path, name, basename: name.replace(/\.md$/i, ''), title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
    }
    const { el, bridge } = await mount(
      defaultAppState(),
      { id: 'w1', root: '/v', file: ABDUL, tabs: [ABDUL, '/v/b.md'], rightPanel: { open: true, width: 440, items: ['/v/c.md'], expanded: '/v/c.md' } },
      {},
      (b) => b.bridge.index.mockResolvedValue({ root: '/v', records: [note('/v/b.md', 'b'), note('/v/c.md', 'Side Note'), note(ABDUL, 'UP-001 - Abdul')], folders: [], generatedAt: 1, ids: true }),
    )
    expect(document.title).toBe('v — UP-001 - Abdul')
    expect(stripLabels(el)).toEqual(['UP-001 - Abdul', 'b'])
    expect(el.querySelector('.right-panel__label')?.textContent).toBe('Side Note')
    await act(async () => void captured.sidebar?.onRenameFile(ABDUL, '/v/renamed.md', 'file'))
    expect(el.querySelector('.confirm__text')?.textContent).toBe("Rename 'UP-001 - Abdul' to 'renamed'? No other notes link to it.")
    bridge.file.delete.mockRejectedValueOnce(new Error('boom'))
    await act(async () => void captured.sidebar?.onDeleteFile(ABDUL))
    expect(el.querySelector('.link-notice')?.textContent).toBe('Can\'t move "UP-001 - Abdul" to the Trash — nothing was deleted')
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
    return { path, name, basename: name.replace(/\.md$/i, ''), title: name.replace(/\.md$/i, ''), folder: '', ext: 'md', size: 7, ctime: 1, mtime: 100, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
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
    b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true })
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
    b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true })
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
 * first with the honest count; a MOVE asks only when it would clear a folder's values (D21).
 */
describe('App rename door (⚡ YAZ-888)', () => {
  const record = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const rel = path.slice('/v/'.length)
    return { path, name, basename: name.replace(/\.md$/i, ''), title: name.replace(/\.md$/i, ''), folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', ext: 'md', size: 7, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }
  /** A references B by name; R references Docs/N by path — one file case, one folder case. */
  const records = [record('/v/A.md', { links: ['B'] }), record('/v/B.md'), record('/v/R.md', { links: ['Docs/N'] }), record('/v/Docs/N.md')]
  const identity = (): IdentityFixture => ({ id: 'w1', root: '/v', file: null, tabs: [] })
  const feed = (b: ReturnType<typeof installBridge>) => b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true })
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
  /** "Ask before renaming" switched off (YAZ-2420 3C1). */
  const askOff = (): AppState => ({ ...defaultAppState(), settings: { ...DEFAULT_SETTINGS, confirmRename: false } })

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

  it('"Ask before renaming" off: a file rename runs with no sheet, and the links still follow with their notice (YAZ-2420 3C1)', async () => {
    const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
    const { bridge, el } = await mount(askOff(), identity(), files, feed)
    await act(async () => await captured.sidebar?.onRenameFile('/v/B.md', '/v/B2.md', 'file'))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: '/v/B.md', newPath: '/v/B2.md' })
    expect(files['/v/A.md'].content).toBe('See [[B2]].\n')
    expect(el.querySelector('.link-notice')?.textContent).toBe('Updated links in 1 note')
  })

  it('a MOVE stays silent: no sheet, the rename runs straight through', async () => {
    const { bridge, el } = await mount(defaultAppState(), identity(), {}, feed)
    await act(async () => await captured.sidebar?.onRenameFile('/v/B.md', '/v/Docs/B.md', 'file'))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/v/B.md', newPath: '/v/Docs/B.md' })
  })

  /** The app asks before a move that clears values (D21): the door's other question, of a MOVE. */
  describe('a move that clears a folder’s values (D21)', () => {
    const HIRING = '3y7505rsr6fd'
    const TEAM = 'mzf9cjhn02vm'
    const ARCHIVE = 'a1b2c3d4e5f6'
    const GONE = 'n0f01der0000' // no folder has it
    const NOOR = '/v/Team/Hiring/Noor.md'
    const held = `---\nin:\n  ${TEAM}:\n    Rank: 2\n  ${HIRING}:\n    Status: Interview\n---\nBody\n`
    const snapshot = (noor: Record<string, unknown> = { in: { [TEAM]: { Rank: 2 }, [HIRING]: { Status: 'Interview' } } }) => ({
      root: '/v',
      records: [record(NOOR, { properties: noor }), record('/v/Team/Hiring/Plain.md'), record('/v/Team/Hiring/Lost.md', { properties: { in: { [GONE]: { Rank: 1 } } } })],
      folders: [record('/v/Team/.folder.md', { id: TEAM, title: 'Team' }), record('/v/Team/Archive/.folder.md', { id: ARCHIVE, title: 'Archive' }), record('/v/Team/Hiring/.folder.md', { id: HIRING, title: 'Hiring' })],
      generatedAt: 1,
      ids: true,
    })
    // The disk as it is once the rename has landed: the note is at its new place.
    const moved = () => ({ '/v/Team/Archive/Noor.md': { content: held, mtime: 1 }, '/v/Team/Archive/Plain.md': { content: 'Body\n', mtime: 1 } })
    const mountTeam = (files: Record<string, { content: string; mtime: number }> = moved()) => mount(defaultAppState(), identity(), files, (b) => b.bridge.index.mockResolvedValue(snapshot()))
    const drag = (oldPath: string, newPath: string) => act(async () => await captured.sidebar?.onRenameFile(oldPath, newPath, 'file'))

    it('a note is moved in the app (a drag in the tree) to a place where a folder that shows it now will not show it, and the note holds values for that folder: a sheet asks first', async () => {
      const { bridge, el } = await mountTeam()
      const fetched = bridge.index.mock.calls.length
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      expect(sheetText(el)).toBe("Move 'Noor' to 'Archive'? Its values for Hiring will be cleared.") // Team, above both places, still shows it
      expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Move'])
      expect(document.activeElement).toBe(sheetBtn(el, 'Cancel'))
      expect(sheetBtn(el, 'Move')?.classList.contains('confirm__btn--danger')).toBe(true)
      expect(bridge.file.rename).not.toHaveBeenCalled() // nothing moves before the answer
      expect(bridge.index.mock.calls).toHaveLength(fetched) // the window's own snapshot answered
    })

    it('Cancel: nothing moves, nothing is written', async () => {
      const files = moved()
      const { bridge, el } = await mountTeam(files)
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      await act(async () => sheetBtn(el, 'Cancel')?.click())
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.rename).not.toHaveBeenCalled()
      expect(bridge.writeFile).not.toHaveBeenCalled()
      expect(files['/v/Team/Archive/Noor.md'].content).toBe(held)
    })

    it('Move: the move runs as it does today, and the values are cleared in that move; a folder that showed the note before and still does keeps its block (D20)', async () => {
      const files = moved()
      const { bridge, el } = await mountTeam(files)
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      expect(bridge.file.rename).not.toHaveBeenCalled()
      await act(async () => sheetBtn(el, 'Move')?.click())
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: NOOR, newPath: '/v/Team/Archive/Noor.md' })
      expect(files['/v/Team/Archive/Noor.md'].content).toBe(`---\nin:\n  ${TEAM}:\n    Rank: 2\n---\nBody\n`)
    })

    it('a move that clears nothing — the same folders show the note before and after; or the note holds no values for the folders it leaves; or its only such block is for a folder the app cannot find: no sheet, the move runs at once, exactly as today', async () => {
      const files = moved()
      const { bridge, el } = await mountTeam(files)
      bridge.readFile.mockClear()
      for (const [from, to] of [
        ['/v/Team/Hiring/Plain.md', '/v/Team/Archive/Plain.md'],
        ['/v/Team/Hiring/Lost.md', '/v/Team/Archive/Lost.md'],
        [NOOR, '/v/Team/Hiring/Sub/Noor.md'],
      ]) {
        await drag(from, to)
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.rename).toHaveBeenLastCalledWith({ oldPath: from, newPath: to })
      }
      // A note that holds nothing stale is not read at all.
      expect(bridge.readFile).not.toHaveBeenCalled()
      expect(bridge.writeFile).not.toHaveBeenCalled()
    })

    // The ID vault's half is every other test of this block.
    it('in a vault that does not use IDs a move and a rename ask nothing about values and write nothing: every `in:` block stays byte for byte (YAZ-2523 V13)', async () => {
      // As such a vault's index hands them out: `in` is a property like any other, and no folder has an id.
      const plain = { ...snapshot(), folders: snapshot().folders.map(({ id: _id, ...folder }) => folder), ids: false }
      const places = ['/v/Team/Archive/Noor.md', '/v/Noor.md', '/v/Team/Hiring/Noor Khan.md']
      const files = Object.fromEntries(places.map((place) => [place, { content: held, mtime: 1 }]))
      const { bridge, el } = await mount(askOff(), identity(), files, (b) => b.bridge.index.mockResolvedValue(plain))
      for (const place of places) {
        await drag(NOOR, place)
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.rename).toHaveBeenLastCalledWith({ oldPath: NOOR, newPath: place })
        expect(files[place].content).toBe(held)
      }
      expect(bridge.writeFile).not.toHaveBeenCalled()
    })

    it('a rename that only changes the name: the rename sheet as today, never this one', async () => {
      const { el } = await mountTeam()
      await act(async () => void captured.sidebar?.onRenameFile(NOOR, '/v/Team/Hiring/Noor Khan.md', 'file'))
      expect(sheetText(el)).toBe("Rename 'Noor' to 'Noor Khan'? No other notes link to it.")
      expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Rename'])
      expect(el.querySelector('.confirm__btn--danger')).toBeNull()
    })

    it('a title edit of a note that holds a folder’s values: the rename sheet, never this one, and the values stay (YAZ-2420 D16)', async () => {
      const files = { [NOOR]: { content: held, mtime: 1 } }
      const { bridge, el } = await mountTeam(files)
      await act(async () => void captured.sidebar?.onRetitle(NOOR, 'Noor Khan', 'file'))
      expect(sheetText(el)).toBe("Rename 'Noor' to 'Noor Khan'? No links need updating.")
      expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Rename'])
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.retitle).toHaveBeenCalledExactlyOnceWith({ path: NOOR, title: 'Noor Khan' })
      expect(files[NOOR].content).toBe(held)
    })

    it('a move to the vault’s top level: the destination is named by the vault’s name, and the folders nearest to the note first', async () => {
      const { el } = await mountTeam()
      await drag(NOOR, '/v/Noor.md')
      expect(sheetText(el)).toBe("Move 'Noor' to 'v'? Its values for Hiring and Team will be cleared.")
    })

    it('the index is behind: the sheet is advice from the window’s snapshot — a note it shows no values for moves unasked, and what the move clears is still decided on a fresh index (D20)', async () => {
      const files = moved()
      const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => b.bridge.index.mockResolvedValue(snapshot({})))
      bridge.index.mockResolvedValue(snapshot()) // the index has moved on; the window has not heard
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      expect(el.querySelector('.confirm')).toBeNull()
      expect(files['/v/Team/Archive/Noor.md'].content).toBe(`---\nin:\n  ${TEAM}:\n    Rank: 2\n---\nBody\n`)
    })

    it('"Ask before renaming" off: a move that would clear values still asks (YAZ-2420 3C1)', async () => {
      const { bridge, el } = await mount(askOff(), identity(), moved(), (b) => b.bridge.index.mockResolvedValue(snapshot()))
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      expect(sheetText(el)).toBe("Move 'Noor' to 'Archive'? Its values for Hiring will be cleared.")
      expect(bridge.file.rename).not.toHaveBeenCalled()
    })

    it('a pending move is dropped when the window root changes (the vault folder moved)', async () => {
      const { bridge, el, emitFileRenamed } = await mountTeam()
      await drag(NOOR, '/v/Team/Archive/Noor.md')
      expect(el.querySelector('.confirm')).not.toBeNull()
      await act(async () => emitFileRenamed('/v', '/w', 'dir'))
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.rename).not.toHaveBeenCalled()
    })
  })

  /** A title edit is the same door (YAZ-2420 D16): the same sheet, the same pipeline, another bridge call. */
  describe('a title edit (YAZ-2420 D16)', () => {
    const ID = 'k3m9x2pq7abc'
    const ABDUL = `/v/abdul-${ID}.md`
    const RENAMED = `/v/up-001-abdul-${ID}.md`
    const titled = [record('/v/A.md', { links: ['Abdul'] }), record('/v/ById.md', { links: [ID] }), record(ABDUL, { id: ID, title: 'Abdul', properties: { id: ID, title: 'Abdul' } })]
    const feedTitled = (b: ReturnType<typeof installBridge>) => {
      b.bridge.index.mockResolvedValue({ root: '/v', records: titled, folders: [], generatedAt: 1, ids: true })
      b.bridge.file.retitle.mockResolvedValue({ oldPath: ABDUL, newPath: RENAMED, kind: 'file' })
    }
    const notes = () => ({ '/v/A.md': { content: 'See [[Abdul]].\n', mtime: 1 }, '/v/ById.md': { content: `See [[${ID}]].\n`, mtime: 1 } })

    it('asks first, counting the notes whose links spell the old title, and confirming retitles through the whole pipeline: `[[Old title]]` becomes `[[New title]]`, an id link is neither counted nor rewritten', async () => {
      const files = notes()
      const { bridge, el } = await mount(defaultAppState(), identity(), files, feedTitled)
      await act(async () => void captured.sidebar?.onRetitle(ABDUL, 'UP-001 - Abdul', 'file'))
      expect(sheetText(el)).toBe("Rename 'Abdul' to 'UP-001 - Abdul'? Links in 1 note will be updated.")
      expect(bridge.file.retitle).not.toHaveBeenCalled() // nothing is written before the beat

      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.retitle).toHaveBeenCalledExactlyOnceWith({ path: ABDUL, title: 'UP-001 - Abdul' })
      expect(bridge.file.rename).not.toHaveBeenCalled()
      expect(files['/v/A.md'].content).toBe('See [[UP-001 - Abdul]].\n')
      expect(files['/v/ById.md'].content).toBe(`See [[${ID}]].\n`)
      expect(el.querySelector('.link-notice')?.textContent).toBe('Updated links in 1 note')
    })

    it('"Ask before renaming" off: a title edit runs with no sheet, and the links that spelled the old title still follow (YAZ-2420 3C1)', async () => {
      const files = notes()
      const { bridge, el } = await mount(askOff(), identity(), files, feedTitled)
      await act(async () => await captured.sidebar?.onRetitle(ABDUL, 'UP-001 - Abdul', 'file'))
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.retitle).toHaveBeenCalledExactlyOnceWith({ path: ABDUL, title: 'UP-001 - Abdul' })
      expect(files['/v/A.md'].content).toBe('See [[UP-001 - Abdul]].\n')
      expect(el.querySelector('.link-notice')?.textContent).toBe('Updated links in 1 note')
    })

    it('the page title commits through the same door as the sidebar', async () => {
      const { bridge, el } = await mount(defaultAppState(), { ...identity(), file: ABDUL, tabs: [ABDUL] }, notes(), feedTitled)
      await act(async () => void captured.editorRetitle?.(ABDUL, 'UP-001 - Abdul', 'file'))
      expect(sheetText(el)).toBe("Rename 'Abdul' to 'UP-001 - Abdul'? Links in 1 note will be updated.")
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.retitle).toHaveBeenCalledExactlyOnceWith({ path: ABDUL, title: 'UP-001 - Abdul' })
    })

    it('a title edit that keeps the file name still rewrites the links: the path main answers with is the one the links are told', async () => {
      const files = notes()
      const { bridge, el } = await mount(defaultAppState(), identity(), files, feedTitled)
      bridge.file.retitle.mockResolvedValue({ oldPath: ABDUL, newPath: ABDUL, kind: 'file' })
      await act(async () => void captured.sidebar?.onRetitle(ABDUL, 'Abdul!', 'file'))
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(files['/v/A.md'].content).toBe('See [[Abdul!]].\n')
    })

    it('a folder is retitled the same way, and named by the title typed', async () => {
      const { bridge, el } = await mount(defaultAppState(), identity(), {}, feed)
      bridge.file.retitle.mockResolvedValue({ oldPath: '/v/Docs', newPath: '/v/notes-2026', kind: 'dir' })
      await act(async () => void captured.sidebar?.onRetitle('/v/Docs', 'Notes 2026', 'dir'))
      expect(sheetText(el)).toBe("Rename 'Docs' to 'Notes 2026'? Links in 1 note will be updated.")
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.retitle).toHaveBeenCalledExactlyOnceWith({ path: '/v/Docs', title: 'Notes 2026' })
    })

    it.each([
      [{ code: 'BAD_REQUEST', message: "this note's properties do not parse", path: ABDUL }, "Can't change the title: this note's properties do not parse"],
      [{ code: 'ALREADY_EXISTS', message: 'a folder with this name already exists', path: RENAMED }, 'Can\'t change the title: "UP-001 - Abdul" already exists'],
    ])('a refused title edit says the title could not be changed, with the reason, and rewrites nothing', async (error, notice) => {
      const files = notes()
      const { bridge, el } = await mount(defaultAppState(), identity(), files, feedTitled)
      bridge.file.retitle.mockRejectedValue(error)
      await act(async () => void captured.sidebar?.onRetitle(ABDUL, 'UP-001 - Abdul', 'file'))
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(el.querySelector('.link-notice')?.textContent).toBe(notice)
      expect(files['/v/A.md'].content).toBe('See [[Abdul]].\n')
    })
  })

  /** The same four surfaces, the same door, in a vault that does not use IDs (YAZ-2523 V3). The ID vault's half is `a title edit`, above. */
  describe('a name typed in a vault that does not use IDs is the file\u2019s name (YAZ-2523 V3)', () => {
    const feedPlain = (b: ReturnType<typeof installBridge>) => b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: false })

    it('from the sidebar: a note is renamed to `<dir>/<typed>.md` through the same sheet and pipeline, the links that named it follow, and no title is written', async () => {
      const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
      const { bridge, el } = await mount(defaultAppState(), identity(), files, feedPlain)
      await act(async () => void captured.sidebar?.onRetitle('/v/B.md', 'Meeting notes', 'file'))
      expect(sheetText(el)).toBe("Rename 'B' to 'Meeting notes'? Links in 1 note will be updated.")
      expect(bridge.file.rename).not.toHaveBeenCalled() // nothing moves before the beat
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: '/v/B.md', newPath: '/v/Meeting notes.md' })
      expect(bridge.file.retitle).not.toHaveBeenCalled()
      expect(files['/v/A.md'].content).toBe('See [[Meeting notes]].\n')
    })

    it('from a note\u2019s page title and a table\u2019s Name cell, the editor\u2019s door: the same rename, in the note\u2019s own folder', async () => {
      const files = { '/v/R.md': { content: 'See [[Docs/N]].\n', mtime: 1 } }
      const { bridge, el } = await mount(askOff(), { ...identity(), file: '/v/Docs/N.md', tabs: ['/v/Docs/N.md'] }, files, feedPlain)
      await act(async () => await captured.editorRetitle?.('/v/Docs/N.md', 'v1.2', 'file'))
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: '/v/Docs/N.md', newPath: '/v/Docs/v1.2.md' })
      expect(bridge.file.retitle).not.toHaveBeenCalled()
      expect(files['/v/R.md'].content).toBe('See [[Docs/v1.2]].\n')
    })

    it('a note stays a note: a name typed with another file’s suffix is the note `talk.pdf.md`, as "New note" makes it', async () => {
      const { bridge } = await mount(askOff(), identity(), {}, feedPlain)
      await act(async () => await captured.sidebar?.onRetitle('/v/B.md', 'talk.pdf', 'file'))
      expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: '/v/B.md', newPath: '/v/talk.pdf.md' })
    })

    it.each([
      ['the sidebar', () => captured.sidebar?.onRetitle('/v/Docs', 'Notes 2026', 'dir')],
      ['its page title', () => captured.editorRetitle?.('/v/Docs', 'Notes 2026', 'dir')],
    ])('a folder, from %s: a directory rename to the name typed, the links through it follow, and no title is written', async (_, retitle) => {
      const files = { '/v/R.md': { content: 'See [[Docs/N]].\n', mtime: 1 } }
      const { bridge } = await mount(askOff(), identity(), files, feedPlain)
      bridge.file.rename.mockResolvedValue({ oldPath: '/v/Docs', newPath: '/v/Notes 2026', kind: 'dir' } as never)
      await act(async () => await retitle())
      expect(bridge.file.rename).toHaveBeenCalledExactlyOnceWith({ oldPath: '/v/Docs', newPath: '/v/Notes 2026' })
      expect(bridge.file.retitle).not.toHaveBeenCalled()
      expect(files['/v/R.md'].content).toBe('See [[Notes 2026/N]].\n')
    })

    it('a name typed before the vault’s index has landed renames nothing and says so: its kind is not known yet (YAZ-2523)', async () => {
      const { bridge, el } = await mount(askOff(), identity(), {}, (b) => b.bridge.index.mockReturnValue(new Promise(() => undefined)))
      await act(async () => await captured.sidebar?.onRetitle('/v/B.md', 'Meeting notes', 'file'))
      expect(el.querySelector('.link-notice')?.textContent).toBe("Can't rename: couldn't load the current file list")
      expect(bridge.file.rename).not.toHaveBeenCalled()
      expect(bridge.file.retitle).not.toHaveBeenCalled()
    })

    it.each([
      [false, "Rename 'B' to 'C'? Links in 1 note will be updated.", 'See [[C]].\n'],
      [true, "Rename 'B' to 'C'? No other notes link to it.", 'See [[B]].\n'],
    ])('a note that holds `title: B`, renamed with IDs %s: `[[B]]` is counted and rewritten only where the title is an ordinary property (YAZ-2523 V12)', async (ids, asked, after) => {
      const held = [record('/v/A.md', { links: ['B'] }), record('/v/B.md', { properties: { title: 'B' } })]
      const files = { '/v/A.md': { content: 'See [[B]].\n', mtime: 1 } }
      const { el } = await mount(defaultAppState(), identity(), files, (b) => b.bridge.index.mockResolvedValue({ root: '/v', records: held, folders: [], generatedAt: 1, ids }))
      await act(async () => void captured.sidebar?.onRenameFile('/v/B.md', '/v/C.md', 'file'))
      expect(sheetText(el)).toBe(asked)
      await act(async () => sheetBtn(el, 'Rename')?.click())
      expect(files['/v/A.md'].content).toBe(after)
    })

    it('the name it already has renames nothing; a name a file cannot hold is said in the notice and renames nothing', async () => {
      // A tab is open: the editor of a page hands in the title typed on it (the new tab page has no title to edit).
      const { bridge, el } = await mount(askOff(), { ...identity(), file: '/v/B.md', tabs: ['/v/B.md'] }, {}, feedPlain)
      await act(async () => await captured.sidebar?.onRetitle('/v/B.md', 'B.md', 'file'))
      expect(el.querySelector('.link-notice')).toBeNull()
      await act(async () => await captured.sidebar?.onRetitle('/v/B.md', 'a/b', 'file'))
      expect(el.querySelector('.link-notice')?.textContent).toBe('Can\'t rename: Name cannot contain "/"')
      await act(async () => await captured.editorRetitle?.('/v/Docs', '.hidden', 'dir'))
      expect(el.querySelector('.link-notice')?.textContent).toBe('Can\'t rename: Names starting with "." are hidden')
      expect(el.querySelector('.confirm')).toBeNull()
      expect(bridge.file.rename).not.toHaveBeenCalled()
      expect(bridge.file.retitle).not.toHaveBeenCalled()
    })
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
        b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, folders: [], generatedAt: 1, ids: true })
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
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, folders: [], generatedAt: 1, ids: true })
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
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, folders: [], generatedAt: 1, ids: true })
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
    const TEAM = '---\nfolder_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[Projects]]\n---\n'
    const files = { '/v/A.md': { content: 'See [[Projects]].\n', mtime: 1 }, '/v/Team/.folder.md': { content: TEAM, mtime: 1 } }
    const outline = { views: [{ type: 'outline', name: 'Outline', outline: '- [[Projects]]' }] }
    const { bridge, el } = await mount(defaultAppState(), identity(), files, (b) => {
      b.bridge.index.mockResolvedValue({
        root: '/v',
        records: [record('/v/A.md', { links: ['Projects'] }), record('/v/Projects/Plan.md')],
        folders: [record('/v/Team/.folder.md', { properties: { folder_settings: outline } })],
        generatedAt: 1,
        ids: true,
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
      b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, folders: [], generatedAt: 1, ids: true })
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
        b.bridge.index.mockResolvedValue({ root: '/v', records: semanticRecords, folders: [], generatedAt: 1, ids: true }),
      )
      await act(async () => void captured.sidebar?.onRenameFile('/v/Archive.json', '/v/Renamed.json', 'dir'))

      expect(count).toHaveBeenCalledWith({
        ids: true,
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
    act(() => captured.sidebar?.onRootMissing('/v'))
    expect(el.querySelector('.welcome__title')?.textContent).toBe('Yaseen Docs')
    expect(el.querySelector('[data-sidebar]')).toBeNull()
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusList: [] })
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
    path: `/v/${folder === '' ? '' : `${folder}/`}${name}.md`, name: `${name}.md`, basename: name, title: name, folder, ext: 'md', size: 1, ctime: 1, mtime: 1,
    properties: {}, aliases: [], tags: [], links: [], embeds: [], text: 'x',
  })
  const withIndex = (...records: IndexRecord[]) => (b: ReturnType<typeof installBridge>) =>
    void b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true })
  /** The vault's `review.json` turns upkeep on, and the index holds `records`. */
  const upkeepOn = (...records: IndexRecord[]) => (b: ReturnType<typeof installBridge>) => {
    b.bridge.vaultConfig.read.mockResolvedValue({ enabled: true })
    withIndex(...records)(b)
  }
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
    await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
    expect(captured.sidebar?.upkeep).toBe(true)
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
      upkeepOn(due('x'), due('y')),
    )
    bridge.window.setIdentity.mockClear()
    openInbox()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(document.title).toBe('v — b')
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

  it('S48: a review that starts closes the tab board, and the board does not open during a review — by the key or by the button', async () => {
    const { el, emitTabOverview } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
    act(() => emitTabOverview())
    expect(el.querySelector('.taboverview')).not.toBeNull()
    openInbox()
    expect(el.querySelector('.taboverview')).toBeNull()
    expect(el.querySelector('.review-bar')).not.toBeNull()
    act(() => emitTabOverview())
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Show all open tabs"]')?.click())
    expect(el.querySelector('.taboverview')).toBeNull()
    expect(el.querySelector('.review-bar')).not.toBeNull()
  })

  it('the new tab page does not show while a review is open, and shows again when it closes (YAZ-2663 S25)', async () => {
    const { el } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] }, {}, upkeepOn(due('x')))
    expect(el.querySelector('[data-start-page]')).not.toBeNull()
    openInbox()
    expect(el.querySelector('.review-bar')).not.toBeNull()
    expect(el.querySelector('[data-start-page]')).toBeNull()
    act(() => button(el, 'Close review')?.click())
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(el.querySelector('[data-start-page]')).not.toBeNull()
  })

  it('YAZ-2662 S67: a review that starts closes the preview panel of the search, and no panel shows during a review or comes back when it closes', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
    const shown = () => [el.querySelector('.quicklook') !== null, captured.sidebar?.previewPath, el.querySelector('.review-bar') !== null]
    act(() => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(shown()).toEqual([true, '/v/archive.zip', false])
    openInbox()
    expect(shown()).toEqual([false, null, true])
    await act(async () => captured.sidebar?.onPreview('/v/archive.zip'))
    expect(shown()).toEqual([false, null, true])
    await act(async () => button(el, 'Close review')?.click())
    expect(shown()).toEqual([false, null, false])
  })

  it('⌘T during a review does nothing (YAZ-2655 S82)', async () => {
    const { el, emitNewTab } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
    openInbox()
    act(() => emitNewTab())
    expect(el.querySelector('.review-bar')).not.toBeNull()
    expect(captured.sidebar?.pendingSearchFocus).toBe(false)
    act(() => button(el, 'Close review')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })

  it('with a session open the tab strip gives way to the review bar, and the note\'s editor is the only visible layer', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
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
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('y')))
    openInbox()
    act(() => button(el, 'Skip⌘⇧S')?.click())
    expect(layers(el)).toEqual([
      ['/v/b.md', true],
      ['/v/y.md', false],
    ])
  })

  it('a note that is already an open tab shows through that tab\'s layer — one editor for the path', async () => {
    const { el } = await mount(defaultAppState(), { ...TABS, file: '/v/a.md' }, {}, upkeepOn(due('a')))
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
      upkeepOn(due('r')),
    )
    openInbox()
    expect(el.querySelector('.tabstack .review-message')?.textContent).toBe('This note is open in the side panel.')
    expect(layers(el)).toEqual([['/v/b.md', true]])
    expect(editorsOn(el, '/v/r.md')).toBe(1)
    expect(el.querySelector('.review-answers')).not.toBeNull() // the answers still work
  })

  it('nothing due: the empty state, no answers, and "Back to tabs" closes', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn())
    openInbox()
    expect(el.querySelector('.tabstack .review-message p')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.review-answers')).toBeNull()
    act(() => button(el, 'Back to tabs')?.click())
    expect(el.querySelector('.review-message')).toBeNull()
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })

  it('a link clicked in the note opens in a background tab; the review stays', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x')))
    openInbox()
    act(() => el.querySelector<HTMLButtonElement>('[data-path="/v/x.md"] [data-open-right-current]')?.click())
    expect(el.querySelector('.review-bar')).not.toBeNull()
    act(() => button(el, 'Close review')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('b')
  })

  it('"Review this folder" starts a session over that folder alone, named for it', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x'), due('p', 'Work/Projects'), due('q', 'Work/Projects/sub')))
    act(() => captured.sidebar?.onReviewFolder('/v/Work/Projects'))
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Projects')
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 2')
    expect(el.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) [data-editor]')?.getAttribute('data-path')).toBe('/v/Work/Projects/p.md')
  })

  it('the sidebar and the tab menu get the SAME review lookup and write: a note answers, anything else is null', async () => {
    const files = { '/v/a.md': { content: 'Body.\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), TABS, files, upkeepOn(due('a')))
    expect(captured.sidebar?.reviewState('/v/a.md')).toBe(true)
    expect(captured.sidebar?.reviewState('/v/photo.png')).toBeNull()
    act(() => void el.querySelector('.tabbar__tab')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Turn review off')?.click())
    expect(bridge.writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/v/a.md', content: '---\nreview: false\n---\nBody.\n' }))
  })

  it('the same holds for a note shown through its own tab: its link does not navigate the active tab under the review', async () => {
    const { el } = await mount(defaultAppState(), { ...TABS, file: '/v/a.md' }, {}, upkeepOn(due('a')))
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    openInbox()
    act(() => el.querySelector<HTMLButtonElement>('[data-path="/v/a.md"] [data-open-right-current]')?.click())
    act(() => button(el, 'Close review')?.click())
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('b')
  })

  it('clicking the Inbox row again closes the review', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x')))
    openInbox()
    expect(el.querySelector('.review-bar')).not.toBeNull()
    openInbox()
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(captured.sidebar?.reviewing).toBe(false)
  })

  it('opening a file from the sidebar ends the review and shows that file', async () => {
    const { el } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x')))
    openInbox()
    act(() => captured.sidebar?.onOpenFile('/v/a.md'))
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(activeLabel(el)).toBe('a')
  })

  it('File › Close Tab closes the review, not the tab hidden under it', async () => {
    const { el, emitCloseTab } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x')))
    openInbox()
    act(() => emitCloseTab())
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(stripLabels(el)).toEqual(['a', 'b'])
  })

  /** Upkeep is off until a vault turns it on (🔒 D7): every test below starts with no `review.json`. */
  describe('off until the vault turns it on', () => {
    const editorSettings = (el: HTMLElement, path: string) => el.querySelector(`[data-editor][data-path="${path}"]`)?.getAttribute('data-review-settings')
    const tabMenu = (el: HTMLElement) => {
      act(() => void el.querySelector('.tabbar__tab')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      return [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
    }
    /** The Settings dialog's "Enable upkeep review" switch, clicked On or Off. */
    const setUpkeep = (el: HTMLElement, emitSettings: () => void, on: boolean) => {
      act(() => emitSettings())
      act(() => el.querySelectorAll<HTMLButtonElement>('[data-setting="enabled"] button')[on ? 0 : 1].click())
      act(() => button(el, 'Close settings')?.click())
    }

    it('upkeep off: the sidebar is told so — no Inbox row, no "Review this folder" — nothing is due, and nothing is written', async () => {
      const { bridge } = await mount(defaultAppState(), TABS, {}, withIndex(due('x'), due('y')))
      expect(captured.sidebar?.upkeep).toBe(false)
      expect(captured.sidebar?.dueCount).toBe(0)
      expect(bridge.vaultConfig.write).not.toHaveBeenCalled()
      expect(bridge.writeFile).not.toHaveBeenCalled()
    })

    it('upkeep off: a note\'s row menu and its tab menu have no "Turn review on" / "Turn review off"', async () => {
      const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('a')))
      expect(captured.sidebar?.reviewState('/v/a.md')).toBeNull()
      const items = tabMenu(el)
      expect(items).toContain('Copy path')
      expect(items.some((label) => label.startsWith('Turn review'))).toBe(false)
    })

    it('upkeep off: a page is handed no review settings, so it has no Reviews section', async () => {
      const { el } = await mount(defaultAppState(), TABS, {}, withIndex(due('b')))
      expect(editorSettings(el, '/v/b.md')).toBe('none')
    })

    it('upkeep off: the review hotkeys do nothing', async () => {
      const { bridge, el } = await mount(defaultAppState(), TABS, { '/v/x.md': { content: 'Body.\n', mtime: 1 } }, withIndex(due('x')))
      for (const key of ['Enter', 'S', 'Escape']) {
        const event = new KeyboardEvent('keydown', { key, metaKey: key !== 'Escape', shiftKey: key !== 'Escape', bubbles: true, cancelable: true })
        act(() => void document.body.dispatchEvent(event))
        expect(event.defaultPrevented).toBe(false)
      }
      expect(bridge.writeFile).not.toHaveBeenCalled()
      expect(el.querySelector('.review-bar')).toBeNull()
      expect(stripLabels(el)).toEqual(['a', 'b'])
    })

    it('turned on in Settings: the Inbox row, the menu items and the Reviews section are there at once, and a review runs', async () => {
      const files = { '/v/a.md': { content: 'Body.\n', mtime: 1 } }
      const { bridge, el, emitSettings } = await mount(defaultAppState(), TABS, files, withIndex(due('a'), due('p', 'Work')))
      setUpkeep(el, emitSettings, true)
      expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', 'review.json', { algorithm: 'upkeep', enabled: true, baseDays: 30, growth: 2, maxDays: 365, reviewByDefault: true })
      expect(captured.sidebar?.upkeep).toBe(true)
      expect(captured.sidebar?.dueCount).toBe(2)
      expect(captured.sidebar?.reviewState('/v/a.md')).toBe(true)
      expect(tabMenu(el)).toContain('Turn review off')
      expect(editorSettings(el, '/v/b.md')).toBe('given')
      act(() => captured.sidebar?.onReviewFolder('/v/Work'))
      expect(el.querySelector('.review-bar__label')?.textContent).toBe('Work')
      expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 1')
    })

    it('turned off while a review is open: the review closes, the tabs are as they were, and nothing is written to a note', async () => {
      const { bridge, el, emitSettings } = await mount(defaultAppState(), TABS, {}, upkeepOn(due('x')))
      openInbox()
      expect(el.querySelector('.review-bar')).not.toBeNull()
      setUpkeep(el, emitSettings, false)
      expect(el.querySelector('.review-bar')).toBeNull()
      expect(el.querySelector('.review-answers')).toBeNull()
      expect(captured.sidebar?.upkeep).toBe(false)
      expect(captured.sidebar?.reviewing).toBe(false)
      expect(captured.sidebar?.dueCount).toBe(0)
      expect(stripLabels(el)).toEqual(['a', 'b'])
      expect(activeLabel(el)).toBe('b')
      expect(bridge.writeFile).not.toHaveBeenCalled()
    })
  })
})

/**
 * The box that asks (YAZ-2523 🔒 V2, V11): a vault with no answer is asked once per window before
 * any note is given an ID. Each answer is saved in the vault's `ids.json`; Esc saves nothing.
 */
describe('App asks before a vault\u2019s notes are given IDs (YAZ-2523 V2)', () => {
  const VAULT: IdentityFixture = { id: 'w1', root: '/v', file: null, tabs: [] }
  const ASK = { notes: 3, folders: 1, foreign: 0 }
  const TEXT = "Give this vault's notes IDs? The app would write an ID into 3 notes and add a hidden settings file to 1 folder. With IDs, links keep working when a note is renamed or moved, and the app names the file of a note you make or retitle. Without them, the app leaves every file exactly as it is."
  /** The index's answer for every root: `ask` only while the vault has not answered. */
  const feed = (ids: boolean, ask?: IndexResponse['ask']) => (b: ReturnType<typeof installBridge>) => void b.bridge.index.mockImplementation(async (root) => ({ root, records: [], folders: [], generatedAt: 1, ids, ask }))
  const mountAsked = () => mount(defaultAppState(), VAULT, {}, feed(false, ASK))
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
  const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
  /** The vault's `ids.json` changed, as main says it: the index is fetched again. */
  const refetch = (bridge: ReturnType<typeof installBridge>['bridge']) =>
    act(async () => (bridge.vaultConfig.onChange.mock.calls as unknown as [(c: { root: string; name: string }) => void][]).forEach(([listener]) => listener({ root: '/v', name: IDS_FILE })))

  it('a vault that has not answered: the box says what a yes would write, and nothing is written', async () => {
    const { bridge, el } = await mountAsked()
    expect(sheetText(el)).toBe(TEXT)
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Not for this vault', 'Give IDs'])
    expect(bridge.vaultConfig.write).not.toHaveBeenCalled()
  })

  it('an empty folder is asked too (V11)', async () => {
    const { el } = await mount(defaultAppState(), VAULT, {}, feed(false, { notes: 0, folders: 0, foreign: 0 }))
    expect(sheetText(el)).toBe("Should this vault's notes have IDs? With IDs, the app names each note's file and links keep working when a note is renamed or moved. Without them, notes are plain files named as you type them, and the app writes nothing extra.")
  })

  it('a vault that answered, yes or no, is not asked', async () => {
    const yes = await mount(defaultAppState(), VAULT, {}, feed(true))
    expect(yes.el.querySelector('.confirm')).toBeNull()
    act(() => root?.unmount())
    const no = await mount(defaultAppState(), VAULT, {}, feed(false))
    expect(no.el.querySelector('.confirm')).toBeNull()
  })

  it('"Give IDs" saves yes in the vault and the box closes', async () => {
    const { bridge, el } = await mountAsked()
    await act(async () => sheetBtn(el, 'Give IDs')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: true })
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('"Not for this vault" saves no in the vault and the box closes', async () => {
    const { bridge, el } = await mountAsked()
    await act(async () => sheetBtn(el, 'Not for this vault')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: false })
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('Enter chooses neither answer: the box stays and nothing is saved', async () => {
    const { bridge, el } = await mountAsked()
    press('Enter')
    expect(sheetText(el)).toBe(TEXT)
    expect(bridge.vaultConfig.write).not.toHaveBeenCalled()
  })

  it('Esc saves nothing and a later snapshot that still asks does not reopen the box; opening the vault again does', async () => {
    const { bridge, el, emitOpenRoot } = await mountAsked()
    press('Escape')
    expect(el.querySelector('.confirm')).toBeNull()
    const fetched = bridge.index.mock.calls.length
    await refetch(bridge)
    expect(bridge.index.mock.calls.length).toBeGreaterThan(fetched)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.vaultConfig.write).not.toHaveBeenCalled()

    act(() => captured.sidebar?.onRootMissing('/v'))
    expect(el.querySelector('.confirm')).toBeNull()
    await act(async () => emitOpenRoot('/v'))
    expect(sheetText(el)).toBe(TEXT)
  })

  it('a click outside is Esc: nothing is saved', async () => {
    const { bridge, el } = await mountAsked()
    expect(sheetText(el)).toBe(TEXT)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.vaultConfig.write).not.toHaveBeenCalled()
  })

  it('an answer whose save lands after the window moved to another vault closes nothing there: that vault is still asked', async () => {
    const { bridge, el, emitFileRenamed } = await mountAsked()
    let saved!: (answer: undefined) => void
    bridge.vaultConfig.write.mockReturnValueOnce(new Promise<undefined>((resolve) => void (saved = resolve)))
    await act(async () => sheetBtn(el, 'Give IDs')?.click())
    await act(async () => emitFileRenamed('/v', '/w', 'dir'))
    expect(sheetText(el)).toBe(TEXT)
    await act(async () => saved(undefined))
    expect(sheetText(el)).toBe(TEXT)
  })

  it('a save that fails says so in the notice and leaves the box to be answered again', async () => {
    const { bridge, el } = await mountAsked()
    bridge.vaultConfig.write.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => sheetBtn(el, 'Give IDs')?.click())
    expect(el.querySelector('.link-notice')?.textContent).toBe("Couldn't save this vault's answer: disk full")
    expect(sheetText(el)).toBe(TEXT)
    await act(async () => sheetBtn(el, 'Not for this vault')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenLastCalledWith('/v', IDS_FILE, { enabled: false })
    expect(el.querySelector('.confirm')).toBeNull()
  })
})

/** The Settings switch (YAZ-2523 🔒 V4, V13) reads the vault's answer off the snapshot and saves through the same door as the box. */
describe('App "Give this vault\u2019s notes IDs" in Settings (YAZ-2523 V4)', () => {
  const VAULT: IdentityFixture = { id: 'w1', root: '/v', file: null, tabs: [] }
  const note = (id?: string): IndexRecord => ({ path: '/v/a.md', name: 'a.md', basename: 'a', title: 'a', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(id === undefined ? {} : { id }) })
  const feed = (ids: boolean, records: IndexRecord[]) => (b: ReturnType<typeof installBridge>) => void b.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids })
  const idsButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[data-setting="ids"] button')]
  const pressed = (el: HTMLElement) => idsButtons(el).map((b) => b.getAttribute('aria-pressed'))

  it('with no vault open there is no row', async () => {
    const { el, emitSettings } = await mount(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [] })
    act(() => emitSettings())
    expect(el.querySelector('.settings-dialog')).not.toBeNull()
    expect(el.querySelector('[data-setting="ids"]')).toBeNull()
  })

  it('a vault that does not use IDs reads Off, and On saves yes', async () => {
    const { bridge, el, emitSettings } = await mount(defaultAppState(), VAULT, {}, feed(false, [note()]))
    act(() => emitSettings())
    expect(pressed(el)).toEqual(['false', 'true'])
    await act(async () => idsButtons(el)[0].click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: true })
  })

  it('a vault whose notes hold IDs reads On, and Off asks before it saves no', async () => {
    const { bridge, el, emitSettings } = await mount(defaultAppState(), VAULT, {}, feed(true, [note('k3m9x2pq7abc')]))
    act(() => emitSettings())
    expect(pressed(el)).toEqual(['true', 'false'])
    act(() => idsButtons(el)[1].click())
    expect(bridge.vaultConfig.write).not.toHaveBeenCalled()
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Turn off')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: false })
  })

  it('an ID vault with no note holding one yet: Off saves no at once', async () => {
    const { bridge, el, emitSettings } = await mount(defaultAppState(), VAULT, {}, feed(true, []))
    act(() => emitSettings())
    await act(async () => idsButtons(el)[1].click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: false })
  })
})

/**
 * A window with one vault asks main for one vault's worth of each read and each subscription
 * (YAZ-2602 S79): a slot with no vault makes no bridge call. StrictMode runs each mount effect twice.
 */
describe('App with one vault makes the bridge calls it made before (YAZ-2602 S79)', () => {
  it('at boot: one vault\'s worth of each read and each subscription, and a tab switch adds none', async () => {
    const { bridge } = await mount(defaultAppState(), { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })
    const asked = () => ({
      index: bridge.index.mock.calls,
      tree: bridge.tree.mock.calls,
      watch: bridge.watch.mock.calls.map(([vault]) => vault),
      properties: bridge.properties.get.mock.calls,
      sync: bridge.github.status.mock.calls,
      config: bridge.vaultConfig.read.mock.calls,
      coldDiff: bridge.coldDiff.mock.calls,
      subscriptions: [bridge.properties.onChange, bridge.github.onStatus, bridge.vaultConfig.onChange].map((spy) => spy.mock.calls.length),
    })
    const boot = {
      index: [['/v'], ['/v']],
      tree: [['/v']],
      watch: ['/v', '/v'],
      properties: [['/v'], ['/v']],
      sync: [['/v'], ['/v']],
      config: [['/v', 'review.json'], ['/v', 'review.json']],
      coldDiff: [['/v']],
      subscriptions: [2, 2, 4],
    }
    expect(asked()).toEqual(boot)
    act(() => captured.sidebar?.onOpenFile('/v/b.md'))
    await act(async () => {})
    expect(asked()).toEqual(boot)
  })
})

/**
 * One scope per vault (YAZ-2602 D1): a window that shows two vaults keeps the watcher, the index,
 * the properties, the sync, the review and the IDs answer of EACH, all loaded, and a page reads
 * the ones of the vault that holds it. The identity fixture gives the window its vaults, and the
 * sidebar is a stub that reports the first.
 */
describe('App with two vaults keeps one scope per vault (YAZ-2602 D1)', () => {
  type Bridge = ReturnType<typeof installBridge>
  const note = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/i, ''), title: name.replace(/\.md$/i, ''), folder: '', ext: 'md', size: 7, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }
  /** A note last changed in 1970: in review by default, and long overdue. */
  const due = (path: string, folder = ''): IndexRecord => note(path, { folder, text: 'x' })
  /** Vault `/v` first, `/w` second, one tab in each; the `/v` tab is the active one. */
  const TWO: IdentityFixture = { id: 'w1', root: '/v', roots: ['/v', '/w'], file: '/v/a.md', tabs: ['/v/a.md', '/w/b.md'] }
  /** Each vault's own index answer. */
  const feed = (byRoot: Record<string, Partial<IndexResponse>>) => (b: Bridge) =>
    void b.bridge.index.mockImplementation(async (vault) => ({ root: vault, records: [], folders: [], generatedAt: 1, ids: true, ...byRoot[vault] }))
  /** Each vault's own `review.json`: upkeep on, or no file. */
  const upkeep = (on: Record<string, boolean>) => (b: Bridge) => void b.bridge.vaultConfig.read.mockImplementation(async (vault) => (vault !== undefined && on[vault] ? { enabled: true } : null))
  const NOTES = feed({ '/v': { records: [note('/v/a.md', { title: 'Ay' })] }, '/w': { records: [note('/w/b.md', { title: 'Bee' })] } })
  const callsFor = (spy: { mock: { calls: unknown[][] } }, vault: string) => spy.mock.calls.filter(([first]) => first === vault).length
  const editor = (path: string) => captured.editors.filter((e) => e.path === path).at(-1)
  const renders = (path: string) => captured.editors.filter((e) => e.path === path).length
  const records = (source: unknown) => (source as { records: IndexRecord[] }).records.map((r) => r.path)
  /** Go to a tab. A visited tab keeps its editor, so after `show('/w/b.md')` both editors are mounted. */
  const show = (path: string) => act(() => captured.sidebar?.onOpenFile(path))
  const stripLabels = (el: HTMLElement) => [...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
  const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
  const shownEditor = (el: HTMLElement) => el.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) [data-editor]')
  /** Main says a vault's file changed, to every listener of the push. */
  const push = <T,>(spy: { mock: { calls: unknown[][] } }, payload: T) => (spy.mock.calls as [(p: T) => void][]).forEach(([listener]) => listener(payload))

  it('each mounted editor gets the root and the index source of ITS vault, and each vault has its own watcher and index (S30)', async () => {
    const { bridge, el } = await mount(defaultAppState(), TWO, {}, NOTES)
    show('/w/b.md')
    expect(editor('/v/a.md')?.root).toBe('/v')
    expect(editor('/w/b.md')?.root).toBe('/w')
    expect(editor('/v/a.md')?.wikilinks).not.toBe(editor('/w/b.md')?.wikilinks)
    expect(records(editor('/v/a.md')?.wikilinks)).toEqual(['/v/a.md'])
    expect(records(editor('/w/b.md')?.wikilinks)).toEqual(['/w/b.md'])
    // One index bridge and one of each subscription per vault: each vault is asked as a window with that vault alone asks (S79).
    for (const vault of ['/v', '/w']) {
      expect(callsFor(bridge.index, vault)).toBe(2)
      expect(callsFor(bridge.watch, vault)).toBe(2)
      expect(callsFor(bridge.tree, vault)).toBe(1)
      expect(callsFor(bridge.properties.get, vault)).toBe(2)
      expect(callsFor(bridge.github.status, vault)).toBe(2)
      expect(callsFor(bridge.vaultConfig.read, vault)).toBe(2)
      expect(callsFor(bridge.coldDiff, vault)).toBe(1)
    }
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
  })

  it('a switch between the tabs of two vaults asks main for nothing: both scopes are loaded (S29, S80)', async () => {
    const { bridge } = await mount(defaultAppState(), TWO, {}, NOTES)
    const asked = () => [bridge.index, bridge.tree, bridge.watch, bridge.properties.get, bridge.github.status, bridge.vaultConfig.read, bridge.coldDiff].map((spy) => spy.mock.calls.length)
    const before = asked()
    show('/w/b.md')
    show('/v/a.md')
    show('/w/b.md')
    await act(async () => {})
    expect(asked()).toEqual(before)
  })

  it('a change in vault /w does not render the mounted editor of /v', async () => {
    const { bridge } = await mount(defaultAppState(), TWO, {}, NOTES)
    show('/w/b.md')
    const before = { v: renders('/v/a.md'), w: renders('/w/b.md') }
    act(() => push(bridge.github.onStatus, { root: '/w', state: 'syncing' }))
    expect(renders('/w/b.md')).toBeGreaterThan(before.w)
    expect(renders('/v/a.md')).toBe(before.v)
    expect([editor('/v/a.md')?.sync?.state, editor('/w/b.md')?.sync?.state]).toEqual(['off', 'syncing']) // each page shows its own vault's sync (S43)
    feed({ '/v': { records: [note('/v/a.md')] }, '/w': { records: [note('/w/b.md'), note('/w/c.md')] } })({ bridge } as Bridge)
    await act(async () => push(bridge.vaultConfig.onChange, { root: '/w', name: IDS_FILE }))
    expect(records(editor('/w/b.md')?.wikilinks)).toEqual(['/w/b.md', '/w/c.md'])
    expect(records(editor('/v/a.md')?.wikilinks)).toEqual(['/v/a.md'])
    expect(renders('/v/a.md')).toBe(before.v)
  })

  it('the window title names the vault of the active tab, and the strip names each tab by its own vault\'s index (S36)', async () => {
    const state = { ...defaultAppState(), folders: { '/w': { ...defaultFolderState(), name: 'Work' } } }
    const { el } = await mount(state, TWO, {}, NOTES)
    expect(document.title).toBe('v — Ay')
    expect(stripLabels(el)).toEqual(['Ay', 'Bee'])
    show('/w/b.md')
    expect(document.title).toBe('Work — Bee')
  })

  it('with no tab open the window is the first vault\'s by its name in the title, and the new tab page is handed every vault (YAZ-2663 S12)', async () => {
    const { el } = await mount(defaultAppState(), { ...TWO, file: null, tabs: [] })
    expect(document.title).toBe('v')
    expect(el.querySelector('[data-start-page]')?.getAttribute('data-roots')).toBe('/v /w')
  })

  it('a new note made from a page goes to the folder of that page, in that page\'s vault (S37)', async () => {
    await mount(defaultAppState(), TWO)
    show('/w/b.md')
    const folderFor = editor('/w/b.md')?.newNoteFolderFor
    expect(folderFor).toBe(editor('/v/a.md')?.newNoteFolderFor) // the window's one getter, stable under every editor
    expect(folderFor?.('/w/sub/x.md')).toBe('sub')
    expect(folderFor?.('/v/deep/er/y.md')).toBe('deep/er')
  })

  it('a tab and a right-panel page are a folder by their own vault\'s tree, and each page gets its own vault (S31, S32)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const { el } = await mount(
      defaultAppState(),
      { ...TWO, tabs: ['/v/a.md', '/w/Notes.md'], rightPanel: { open: true, width: 440, items: ['/w/Plans.md', '/w/r.md'], expanded: '/w/r.md' } },
      {},
      (b) =>
        void b.bridge.tree.mockImplementation(async (vault) => ({
          root: vault,
          tree: vault === '/w' ? ['Notes.md', 'Plans.md'].map((name): TreeNode => ({ type: 'dir', name, path: `/w/${name}`, children: [] })) : [],
          generatedAt: 1,
        })),
    )
    expect(stripLabels(el)).toEqual(['a', 'Notes.md'])
    expect([...el.querySelectorAll('.right-panel__header')].map((h) => h.textContent)).toEqual(['Plans.md', 'r'])
    expect(el.querySelector('[data-testid="right-layer-/w/r.md"] [data-editor]')?.getAttribute('data-root')).toBe('/w')
  })

  it('a file in no vault of the window uses the first vault\'s scope (S35)', async () => {
    await mount(defaultAppState(), { ...TWO, file: '/elsewhere/x.md', tabs: ['/v/a.md', '/elsewhere/x.md'] })
    show('/v/a.md')
    expect(editor('/elsewhere/x.md')?.root).toBe('/v')
    expect(editor('/elsewhere/x.md')?.wikilinks).toBe(editor('/v/a.md')?.wikilinks)
  })

  it('a rename in /w reads /w\'s index, and counts and rewrites the links of /w\'s notes alone (S30)', async () => {
    const files = {
      '/v/A.md': { content: 'See [[B]].\n', mtime: 1 },
      '/w/C.md': { content: 'See [[B]].\n', mtime: 1 },
      '/w/D.md': { content: 'And [[B]].\n', mtime: 1 },
    }
    const index = feed({
      '/v': { records: [note('/v/A.md', { links: ['B'] }), note('/v/B.md')] },
      '/w': { records: [note('/w/C.md', { links: ['B'] }), note('/w/D.md', { links: ['B'] }), note('/w/B.md')] },
    })
    const { bridge, el } = await mount(defaultAppState(), TWO, files, index)
    bridge.index.mockClear()
    await act(async () => void captured.sidebar?.onRenameFile('/w/B.md', '/w/B2.md', 'file'))
    expect(sheetText(el)).toBe("Rename 'B' to 'B2'? Links in 2 notes will be updated.")
    await act(async () => sheetBtn(el, 'Rename')?.click())
    expect(bridge.file.rename).toHaveBeenCalledWith({ oldPath: '/w/B.md', newPath: '/w/B2.md' })
    expect(bridge.index.mock.calls).toEqual([['/w']])
    expect(files['/w/C.md'].content).toBe('See [[B2]].\n')
    expect(files['/w/D.md'].content).toBe('And [[B2]].\n')
    expect(files['/v/A.md'].content).toBe('See [[B]].\n')
    expect(el.querySelector('.link-notice')?.textContent).toBe('Updated links in 2 notes')
  })

  it('a rename that waits for its answer is dropped when the list of vaults changes', async () => {
    const index = feed({ '/v': { records: [note('/v/A.md', { links: ['B'] }), note('/v/B.md')] } })
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), TWO, {}, index)
    await act(async () => void captured.sidebar?.onRenameFile('/v/B.md', '/v/B2.md', 'file'))
    expect(sheetText(el)).toBe("Rename 'B' to 'B2'? Links in 1 note will be updated.")
    await act(async () => emitFileRenamed('/w', '/w2', 'dir'))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.file.rename).not.toHaveBeenCalled()
  })

  it('the Sync, Reviews and IDs settings are the ones of the active tab\'s vault, and a change is saved in that vault (S39)', async () => {
    const index = feed({ '/v': { ids: true, records: [note('/v/a.md', { id: 'k3m9x2pq7abc' })] }, '/w': { ids: false, records: [note('/w/b.md')] } })
    const { bridge, el, emitSettings } = await mount(defaultAppState(), TWO, {}, (b) => {
      index(b)
      upkeep({ '/v': true })(b)
      b.bridge.github.status.mockImplementation(async (vault) => ({ root: vault, state: 'off' as const, enabled: vault === '/v' }))
    })
    const pressed = (setting: string) => [...el.querySelectorAll(`[data-setting="${setting}"] button`)].map((b) => b.getAttribute('aria-pressed'))
    const turnOn = (setting: string) => el.querySelector<HTMLButtonElement>(`[data-setting="${setting}"] button`)?.click()
    act(() => emitSettings())
    expect({ ids: pressed('ids'), review: pressed('enabled'), sync: pressed('githubSync') }).toEqual({ ids: ['true', 'false'], review: ['true', 'false'], sync: ['true', 'false'] })
    act(() => button(el, 'Close settings')?.click())

    show('/w/b.md')
    act(() => emitSettings())
    expect({ ids: pressed('ids'), review: pressed('enabled'), sync: pressed('githubSync') }).toEqual({ ids: ['false', 'true'], review: ['false', 'true'], sync: ['false', 'true'] })
    await act(async () => turnOn('ids'))
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/w', IDS_FILE, { enabled: true })
    await act(async () => turnOn('enabled'))
    expect(bridge.vaultConfig.write).toHaveBeenLastCalledWith('/w', 'review.json', expect.objectContaining({ enabled: true }))
    await act(async () => turnOn('githubSync'))
    expect(bridge.github.setEnabled).toHaveBeenCalledExactlyOnceWith('/w', true)
  })

  it('with two or more vaults the Sync, Review and IDs settings say which vault they act on: the active tab\'s (R10, S39)', async () => {
    const { el, emitSettings } = await mount(defaultAppState(), TWO, {}, (b) => {
      feed({ '/v': { ids: true }, '/w': { ids: false } })(b)
      upkeep({ '/v': true, '/w': true })(b)
    })
    const named = () => [...el.querySelectorAll('.settings-section__note, .settings-group__hint')].map((n) => n.textContent).filter((text) => text?.startsWith('Vault: '))
    act(() => emitSettings())
    expect(named()).toEqual(['Vault: v', 'Vault: v', 'Vault: v'])
    act(() => button(el, 'Close settings')?.click())
    show('/w/b.md')
    act(() => emitSettings())
    expect(named()).toEqual(['Vault: w', 'Vault: w', 'Vault: w'])
  })

  it('the ask names its vault, and the first vault\'s ask shares no key with the sidebar (S40)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ask = { notes: 3, folders: 0, foreign: 0 }
    const { el } = await mount(defaultAppState(), TWO, {}, feed({ '/v': { ids: false, ask }, '/w': { ids: true } }))
    expect(sheetText(el)).toContain('Give the notes in v IDs? The app would write an ID into 3 notes.')
    expect(errors.mock.calls.filter(([message]) => String(message).includes('same key'))).toEqual([])
  })

  it('a vault that has not answered on IDs shows its own ask, and the answer is saved in that vault (S40)', async () => {
    const { bridge, el } = await mount(defaultAppState(), TWO, {}, feed({ '/v': { ids: true }, '/w': { ids: false, ask: { notes: 3, folders: 0, foreign: 0 } } }))
    expect(sheetText(el)).toContain('The app would write an ID into 3 notes.')
    await act(async () => sheetBtn(el, 'Give IDs')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/w', IDS_FILE, { enabled: true })
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('two vaults to ask: one ask shows at a time, the first vault\'s and then the next one\'s (S40)', async () => {
    const { bridge, el } = await mount(defaultAppState(), TWO, {}, feed({ '/v': { ids: false, ask: { notes: 3, folders: 0, foreign: 0 } }, '/w': { ids: false, ask: { notes: 5, folders: 0, foreign: 0 } } }))
    expect(el.querySelectorAll('.confirm').length).toBe(1)
    expect(sheetText(el)).toContain('into 3 notes.')
    await act(async () => sheetBtn(el, 'Not for this vault')?.click())
    expect(bridge.vaultConfig.write).toHaveBeenCalledExactlyOnceWith('/v', IDS_FILE, { enabled: false })
    expect(sheetText(el)).toContain('into 5 notes.')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(bridge.vaultConfig.write).toHaveBeenCalledTimes(1)
  })

  it('a review of a folder of /w runs with /w\'s settings and /w\'s notes while the active tab is in /v (S42)', async () => {
    const files = { '/w/Work/p.md': { content: 'Body.\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), TWO, files, (b) => {
      upkeep({ '/w': true })(b)
      feed({ '/v': { records: [due('/v/x.md')] }, '/w': { records: [due('/w/q.md'), due('/w/Work/p.md', 'Work')] } })(b)
    })
    act(() => captured.sidebar?.onReviewFolder('/w/Work'))
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Work')
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 1')
    expect(shownEditor(el)?.getAttribute('data-path')).toBe('/w/Work/p.md')
    expect(shownEditor(el)?.getAttribute('data-root')).toBe('/w')
    expect(shownEditor(el)?.getAttribute('data-review-settings')).toBe('given')
    expect(el.querySelector('[data-editor][data-path="/v/a.md"]')?.getAttribute('data-review-settings')).toBe('none')
    await act(async () => button(el, 'Still relevant⌘⇧⏎')?.click())
    expect(bridge.writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/w/Work/p.md' }))
    act(() => button(el, 'Close review')?.click())
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(activeLabel(el)).toBe('a')
    expect(captured.sidebar?.reviewState('/w/q.md')).toBe(true) // by path, to the vault that holds it
    expect(captured.sidebar?.reviewState('/v/x.md')).toBeNull() // upkeep is off in /v
  })

  it('one review per window: a start in /v closes the review of /w (S41, S42)', async () => {
    const { el } = await mount(defaultAppState(), TWO, {}, (b) => {
      upkeep({ '/v': true, '/w': true })(b)
      feed({ '/v': { records: [due('/v/x.md')] }, '/w': { records: [due('/w/Work/p.md', 'Work')] } })(b)
    })
    act(() => captured.sidebar?.onReviewFolder('/w/Work'))
    expect(el.querySelector('.review-bar__label')?.textContent).toBe('Work')
    expect(captured.sidebar?.reviewing).toBe(false) // the sidebar's Inbox row is the first vault's
    act(() => captured.sidebar?.onOpenInbox())
    expect([...el.querySelectorAll('.review-bar__label')].map((l) => l.textContent)).toEqual(['Inbox'])
    expect(shownEditor(el)?.getAttribute('data-path')).toBe('/v/x.md')
    expect(captured.sidebar?.reviewing).toBe(true)
    act(() => button(el, 'Close review')?.click())
    expect(el.querySelector('.review-bar')).toBeNull() // the review of /w is not waiting under it
    expect(shownEditor(el)?.getAttribute('data-path')).toBe('/v/a.md')
  })

  it('the sidebar is handed each vault\'s own Inbox — upkeep, count, state — and a row\'s click opens ITS vault\'s review, closes the other vault\'s, and closes its own when it is the one open (R5, S41)', async () => {
    const { el } = await mount(defaultAppState(), { ...TWO, roots: ['/v', '/w', '/x'] }, {}, (b) => {
      upkeep({ '/v': true, '/w': true })(b)
      feed({ '/v': { records: [due('/v/x.md')] }, '/w': { records: [due('/w/p.md'), due('/w/q.md')] }, '/x': { records: [due('/x/z.md')] } })(b)
    })
    const rows = () => captured.sidebar?.vaults.map((vault) => [vault.root, vault.upkeep, vault.dueCount, vault.reviewing])
    expect(rows()).toEqual([['/v', true, 1, false], ['/w', true, 2, false], ['/x', false, 0, false]])
    act(() => captured.sidebar?.onInbox('/w'))
    expect(rows()).toEqual([['/v', true, 1, false], ['/w', true, 2, true], ['/x', false, 0, false]])
    expect(el.querySelector('.review-bar__count')?.textContent).toBe('1 of 2')
    expect(shownEditor(el)?.getAttribute('data-root')).toBe('/w')
    act(() => captured.sidebar?.onInbox('/v'))
    expect(rows()?.map(([, , , reviewing]) => reviewing)).toEqual([true, false, false])
    expect(el.querySelectorAll('.review-bar')).toHaveLength(1)
    expect(shownEditor(el)?.getAttribute('data-path')).toBe('/v/x.md')
    act(() => captured.sidebar?.onInbox('/v'))
    expect(rows()?.map(([, , , reviewing]) => reviewing)).toEqual([false, false, false])
    expect(el.querySelector('.review-bar')).toBeNull()
    expect(shownEditor(el)?.getAttribute('data-path')).toBe('/v/a.md')
  })

  it('each vault syncs as in its own window: the attention banner is the vault\'s that has a problem, and its prompt names that vault (S43)', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { bridge, el } = await mount(defaultAppState(), TWO, {}, NOTES)
    expect(el.querySelector('.sync-banner')).toBeNull()
    act(() => push(bridge.github.onStatus, { root: '/w', state: 'attention', attention: 'auth' }))
    expect(el.querySelector('.sync-banner strong')?.textContent).toBe("GitHub didn't accept this computer's credentials.")
    act(() => button(el, 'Copy setup prompt')?.click())
    expect(writeText.mock.calls[0][0]).toContain('/w')
    expect(writeText.mock.calls[0][0]).not.toContain('/v')
    act(() => button(el, 'Dismiss')?.click())
    expect(el.querySelector('.sync-banner')).toBeNull()
  })

  it('the "renamed outside the app" banner of /w names its paths inside /w, and Update repairs /w\'s links (S44)', async () => {
    const files = { '/w/A.md': { content: 'See [[B]].\n', mtime: 1 } }
    const { bridge, el } = await mount(defaultAppState(), TWO, files, (b) => {
      feed({ '/w': { records: [note('/w/A.md', { links: ['B'], size: 20, mtime: 5 }), note('/w/B2.md', { mtime: 100 })] } })(b)
      b.bridge.coldDiff.mockImplementation(async (vault) =>
        vault === '/w' ? { root: '/w', scannedAt: 1, cacheStatus: 'hit', added: [{ path: '/w/B2.md', size: 7, mtime: 100 }], removed: [{ path: '/w/B.md', size: 7, mtime: 100 }], changed: [] } : null,
      )
    })
    expect(el.querySelector('.rename-banner')?.textContent).toContain('Looks like B.md became B2.md — update 1 link?')
    bridge.index.mockClear()
    await act(async () => el.querySelectorAll<HTMLButtonElement>('.rename-banner button')[0]?.click())
    expect(bridge.file.repairRename).toHaveBeenCalledWith({ oldPath: '/w/B.md', newPath: '/w/B2.md' })
    expect(bridge.index.mock.calls).toEqual([['/w']])
    expect(files['/w/A.md'].content).toBe('See [[B2]].\n')
    expect(el.querySelector('.rename-banner')).toBeNull()
  })

  it('vault /w\'s folder is renamed in another window: the vaults of this window follow, with no identity write, and /v is not touched (S48)', async () => {
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), TWO, {}, NOTES)
    show('/w/b.md')
    const before = { source: editor('/w/b.md')?.wikilinks, index: callsFor(bridge.index, '/v'), watch: callsFor(bridge.watch, '/v'), renders: renders('/v/a.md') }
    bridge.window.setIdentity.mockClear()
    await act(async () => emitFileRenamed('/w', '/w2', 'dir'))
    expect(storage.getRoots()).toEqual(['/v', '/w2'])
    expect(storage.getRoot()).toBe('/v')
    expect(el.querySelector('[data-editor][data-path="/w2/b.md"]')?.getAttribute('data-root')).toBe('/w2')
    expect(editor('/w2/b.md')?.wikilinks).toBe(before.source) // the vault kept its slot
    expect(callsFor(bridge.index, '/w2')).toBeGreaterThan(0)
    expect(callsFor(bridge.watch, '/w2')).toBeGreaterThan(0)
    // Main's store moved the entry already: the mirror of the tabs is the only write.
    expect((bridge.window.setIdentity.mock.calls as unknown[][]).map(([patch]) => Object.keys(patch as object).sort())).toEqual([['file', 'rightPanel', 'tabs']])
    expect({ index: callsFor(bridge.index, '/v'), watch: callsFor(bridge.watch, '/v'), renders: renders('/v/a.md') }).toEqual({ index: before.index, watch: before.watch, renders: before.renders })
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')
  })

  it('the FIRST vault\'s folder is renamed: the window\'s root and its sidebar follow, and /w is not touched', async () => {
    const { bridge, el, emitFileRenamed } = await mount(defaultAppState(), TWO, {}, NOTES)
    show('/w/b.md')
    const before = { index: callsFor(bridge.index, '/w'), watch: callsFor(bridge.watch, '/w'), renders: renders('/w/b.md') }
    await act(async () => emitFileRenamed('/v', '/v2', 'dir'))
    expect(storage.getRoots()).toEqual(['/v2', '/w'])
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v2')
    expect(el.querySelector('[data-editor][data-path="/v2/a.md"]')?.getAttribute('data-root')).toBe('/v2')
    expect({ index: callsFor(bridge.index, '/w'), watch: callsFor(bridge.watch, '/w'), renders: renders('/w/b.md') }).toEqual(before)
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ roots: expect.anything() }))
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ root: expect.anything() }))
  })

  it('"Open in this window" on a third vault leaves the window on that one vault, with the tabs reset and the two scopes unloaded (S61)', async () => {
    const offs: Record<string, ReturnType<typeof vi.fn>[]> = {}
    const { bridge, el } = await mount(withFolder(defaultAppState(), '/z', '/z/last.md'), TWO, {}, (b) => {
      NOTES(b)
      b.bridge.watch.mockImplementation((vault) => {
        const off = vi.fn()
        ;(offs[vault ?? ''] ??= []).push(off)
        return off
      })
    })
    show('/w/b.md')
    const left = [editor('/v/a.md')?.wikilinks, editor('/w/b.md')?.wikilinks]
    expect(left.map(records)).toEqual([['/v/a.md'], ['/w/b.md']])
    bridge.window.setIdentity.mockClear()
    await act(async () => void (await captured.sidebar?.onOpenVaultHere('/z')))
    expect(storage.getRoots()).toEqual(['/z'])
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/z')
    expect(stripLabels(el)).toEqual(['last'])
    expect([...el.querySelectorAll('[data-editor]')].map((e) => [e.getAttribute('data-root'), e.getAttribute('data-path')])).toEqual([['/z', '/z/last.md']])
    expect(bridge.window.setIdentity.mock.calls).toEqual([
      [{ root: '/z', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files', focusList: [] }],
      [{ tabs: ['/z/last.md'], file: '/z/last.md', rightPanel: defaultRightPanelIdentity() }],
    ])
    // A vault that leaves the window unloads its scope: each of its watcher subscriptions ended.
    for (const vault of ['/v', '/w']) expect(offs[vault].map((off) => off.mock.calls.length)).toEqual(offs[vault].map(() => 1))
    // …and its index left the window's memory: the slot's sources are empty until a vault takes it.
    expect(left.map(records).filter((paths) => paths.some((path) => !path.startsWith('/z/')))).toEqual([])
    expect(offs['/z'].some((off) => off.mock.calls.length === 0)).toBe(true)
    expect(callsFor(bridge.index, '/z')).toBeGreaterThan(0)
    expect(document.title).toBe('z — last')
  })

  it('the first vault\'s folder is gone: that vault leaves the window with its tabs, and /w stays loaded as it was (S53)', async () => {
    const { bridge, el } = await mount(defaultAppState(), TWO, {}, NOTES)
    show('/w/b.md')
    const before = { source: editor('/w/b.md')?.wikilinks, index: callsFor(bridge.index, '/w'), watch: callsFor(bridge.watch, '/w') }
    act(() => captured.sidebar?.onRootMissing('/v'))
    await act(async () => {})
    expect(el.querySelector('.welcome')).toBeNull()
    expect(storage.getRoots()).toEqual(['/w'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ roots: ['/w'] })
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(stripLabels(el)).toEqual(['Bee'])
    expect(editor('/w/b.md')?.wikilinks).toBe(before.source)
    expect({ index: callsFor(bridge.index, '/w'), watch: callsFor(bridge.watch, '/w') }).toEqual({ index: before.index, watch: before.watch })
  })
})

/**
 * A vault is added to the window and removed from it (YAZ-2602 D2, D7). The sidebar asks — its
 * blank-space menu, a `⌘O` row's menu, a vault row's menu — and App owns the list: the checks and
 * their notices, the identity write, and the pages of a vault that leaves. A vault that is not the
 * first comes and goes with no remount of the sidebar and no reload of a vault that stays.
 */
describe('App adds and removes a vault (YAZ-2602 D2, D7)', () => {
  const ONE: IdentityFixture = { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarLens: 'files', focusList: ['/v/sub'] }
  const TWO: IdentityFixture = { id: 'w1', root: '/v', roots: ['/v', '/w'], file: '/w/b.md', tabs: ['/v/a.md', '/w/b.md', '/w/c.md'] }
  const named = (names: Record<string, string>): AppState => ({ ...defaultAppState(), folders: Object.fromEntries(Object.entries(names).map(([path, name]) => [path, { ...defaultFolderState(), name }])) })
  const add = async (path: string): Promise<boolean | undefined> => {
    let added: boolean | undefined
    await act(async () => void (added = await captured.sidebar?.onAddVault(path)))
    return added
  }
  const noticeText = (el: HTMLElement) => el.querySelector('.link-notice')?.textContent
  const vaultRoots = () => captured.sidebar?.vaults.map((vault) => vault.root)
  const callsFor = (spy: { mock: { calls: unknown[][] } }, vault: string) => spy.mock.calls.filter(([first]) => first === vault).length
  const stripLabels = (el: HTMLElement) => [...el.querySelectorAll('.tabbar [role="tab"]')].map((t) => t.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  /** What main was asked for one vault: a vault that stays is asked nothing more. */
  const askedOf = (bridge: ReturnType<typeof installBridge>['bridge'], vault: string) =>
    [bridge.index, bridge.tree, bridge.watch, bridge.properties.get, bridge.github.status, bridge.vaultConfig.read, bridge.coldDiff].map((spy) => callsFor(spy, vault))
  /** Each `watch` subscription's unsubscribe, by vault. */
  const watchOffs = (b: ReturnType<typeof installBridge>) => {
    const offs: Record<string, ReturnType<typeof vi.fn>[]> = {}
    b.bridge.watch.mockImplementation((vault) => {
      const off = vi.fn()
      ;(offs[vault ?? ''] ??= []).push(off)
      return off
    })
    return offs
  }

  it('a known vault becomes the last vault: one identity write, the top of the recents, the sidebar not remounted and the first vault not reloaded (S2, S9)', async () => {
    // The vault is open in a second window too (S9): the add does not ask.
    const other = { id: 'w2', root: '/w', roots: ['/w'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } }
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/v', 3), recent('/x', 2), recent('/w', 1)], windows: [other] as AppState['windows'] }, ONE)
    const aside = el.querySelector('[data-sidebar]')
    const before = askedOf(bridge, '/v')
    bridge.window.setIdentity.mockClear()

    expect(await add('/w')).toBe(true)
    expect(storage.getRoots()).toEqual(['/v', '/w'])
    expect(storage.getRoot()).toBe('/v')
    // The tabs, the lens and the focus lists stay: the list of vaults is the only write.
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ roots: ['/v', '/w'] }]])
    expect(stripLabels(el)).toEqual(['a'])
    expect(bridge.state.pushRecent).toHaveBeenCalledExactlyOnceWith('/w')
    expect(storage.getRecentRoots().map((r) => r.path)).toEqual(['/w', '/v', '/x'])
    expect(vaultRoots()).toEqual(['/v', '/w'])
    expect(captured.sidebar?.vaults.map((vault) => vault.name)).toEqual(['v', 'w'])
    expect(captured.sidebar?.closedVaults).toEqual([]) // the new row is open
    expect(el.querySelector('[data-sidebar]')).toBe(aside)
    expect(askedOf(bridge, '/v')).toEqual(before)
    // The new vault has its own scope: its watcher and its index.
    expect(callsFor(bridge.watch, '/w')).toBeGreaterThan(0)
    expect(callsFor(bridge.index, '/w')).toBeGreaterThan(0)
    expect(el.querySelector('.link-notice')).toBeNull()
  })

  it('"Open folder…" adds the folder the system picker answers, and a cancel changes nothing; File › Open Folder… and Open Recent still open beside (S3, S62)', async () => {
    const { bridge, el, emitOpenFolder, emitOpenRoot } = await mount(defaultAppState(), ONE)
    bridge.window.setIdentity.mockClear()
    await act(async () => captured.sidebar?.onPickVault())
    expect(bridge.pickFolder).toHaveBeenCalledTimes(1)
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()

    bridge.pickFolder.mockResolvedValue({ path: '/picked' } as never)
    await act(async () => captured.sidebar?.onPickVault())
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/v', '/picked'])
    expect(bridge.window.openRecent).not.toHaveBeenCalled()
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/v')

    // The app menu's two doors are not the sidebar's: the folder opens beside, and the window keeps its vaults.
    bridge.pickFolder.mockResolvedValue({ path: '/beside' } as never)
    await act(async () => emitOpenFolder())
    act(() => emitOpenRoot('/recent'))
    expect(bridge.window.openRecent.mock.calls).toEqual([['/beside'], ['/recent']])
    expect(storage.getRoots()).toEqual(['/v', '/picked'])
  })

  it('refuses a folder that is in the window, inside one of its vaults, or around one, each with its notice and with nothing asked or written (S4, S5, R8)', async () => {
    const { bridge, el } = await mount(named({ '/data/v': 'Notes' }), { id: 'w1', root: '/data/v', file: null, tabs: [] })
    const quiet = () => [bridge.window.setIdentity, bridge.state.pushRecent, bridge.state.removeRecent].map((spy) => spy.mock.calls.length)
    const trees = bridge.tree.mock.calls.length
    const before = quiet()

    expect(await add('/data/v')).toBe(false)
    expect(noticeText(el)).toBe('Notes is already in this window')
    expect(await add('/data/v/')).toBe(false)
    expect(noticeText(el)).toBe('Notes is already in this window')
    expect(await add('/data/v/sub')).toBe(false)
    expect(noticeText(el)).toBe("Can't add sub: it is inside Notes")
    expect(await add('/data')).toBe(false)
    expect(noticeText(el)).toBe("Can't add data: it contains Notes")
    expect(storage.getRoots()).toEqual(['/data/v'])
    expect(quiet()).toEqual(before)
    expect(bridge.tree.mock.calls.length).toBe(trees)

    // By path segment: a folder whose name only starts like a vault's is not inside it.
    expect(await add('/data/vault')).toBe(true)
    expect(storage.getRoots()).toEqual(['/data/v', '/data/vault'])
  })

  it('a folder that is gone on disk is not added: the notice says so and it leaves the recents (S6)', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/v', 2), recent('/gone', 1)] }, ONE, {}, (b) =>
      void b.bridge.tree.mockImplementation((vault) => (vault === '/gone' ? Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist' }) : Promise.resolve({ root: vault, tree: [], generatedAt: 1 }))),
    )
    bridge.window.setIdentity.mockClear()
    expect(await add('/gone')).toBe(false)
    expect(noticeText(el)).toBe("Can't add gone: folder not found")
    expect(bridge.state.removeRecent).toHaveBeenCalledExactlyOnceWith('/gone')
    expect(storage.getRecentRoots().map((r) => r.path)).toEqual(['/v'])
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(bridge.state.pushRecent).not.toHaveBeenCalled()
  })

  it('the ninth vault is refused: a window holds 8 (S7, R7)', async () => {
    const eight = ['/v', '/v2', '/v3', '/v4', '/v5', '/v6', '/v7', '/v8']
    const { bridge, el } = await mount(defaultAppState(), { id: 'w1', root: '/v', roots: eight, file: null, tabs: [] })
    bridge.window.setIdentity.mockClear()
    expect(await add('/v9')).toBe(false)
    expect(noticeText(el)).toBe('A window holds 8 vaults at most')
    expect(storage.getRoots()).toEqual(eight)
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(bridge.state.pushRecent).not.toHaveBeenCalled()
  })

  it('"Remove from this window" closes that vault\'s tabs and right-panel pages by the close path, and nothing on disk changes (S50, S54)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const retired = [vi.spyOn(continuity, 'retireDeletedDir'), vi.spyOn(continuity, 'retireDeletedPath')]
    let offs: Record<string, ReturnType<typeof vi.fn>[]> = {}
    const { bridge, el } = await mount({ ...defaultAppState(), recents: [recent('/w', 2), recent('/v', 1)] }, { ...TWO, rightPanel: { open: true, width: 440, items: ['/w/r.md', '/v/r.md'], expanded: '/w/r.md' } }, {}, (b) => void (offs = watchOffs(b)))
    const aside = el.querySelector('[data-sidebar]')
    const before = askedOf(bridge, '/v')
    expect(activeLabel(el)).toBe('b')
    expect(el.querySelector('[data-editor][data-path="/w/b.md"]')).not.toBeNull()
    bridge.window.setIdentity.mockClear()

    act(() => captured.sidebar?.onRemoveVault('/w'))
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ roots: ['/v'] })
    expect(vaultRoots()).toEqual(['/v'])
    // The pages of /w are closed, and the tab beside the active one took over (S54).
    expect(stripLabels(el)).toEqual(['a'])
    expect(activeLabel(el)).toBe('a')
    expect([...el.querySelectorAll('.right-panel__header')].map((h) => h.textContent)).toEqual(['r'])
    expect([...el.querySelectorAll('[data-editor]')].map((e) => e.getAttribute('data-path'))).toEqual(['/v/a.md'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md', rightPanel: { open: true, width: 440, items: ['/v/r.md'], expanded: '/v/r.md' } })
    // Each editor of /w went by its unmount, which saves its buffer: none was retired, as a deleted file's is.
    for (const spy of retired) expect(spy).not.toHaveBeenCalled()
    expect(bridge.file.delete).not.toHaveBeenCalled()
    expect(bridge.writeFile).not.toHaveBeenCalled()
    expect(bridge.state.removeRecent).not.toHaveBeenCalled()
    // The vault unloads, the vault that stays is asked nothing, and the sidebar is the one that was there.
    expect(offs['/w'].map((off) => off.mock.calls.length)).toEqual(offs['/w'].map(() => 1))
    expect(askedOf(bridge, '/v')).toEqual(before)
    expect(el.querySelector('[data-sidebar]')).toBe(aside)
    expect(el.querySelector('.link-notice')).toBeNull()
  })

  it('with no tab left after a remove the window shows the empty page (S54)', async () => {
    const { el } = await mount(defaultAppState(), { ...TWO, tabs: ['/w/b.md'] })
    act(() => captured.sidebar?.onRemoveVault('/w'))
    expect(stripLabels(el)).toEqual([])
    expect(el.querySelector('[data-editor]')).toBeNull()
    expect(el.querySelector('[data-start-page]')?.getAttribute('data-roots')).toBe('/v')
  })

  it('removing the first vault makes the next one the window\'s root, and that vault is not reloaded (S52)', async () => {
    const { bridge, el } = await mount(defaultAppState(), TWO)
    const before = askedOf(bridge, '/w')
    bridge.window.setIdentity.mockClear()
    act(() => captured.sidebar?.onRemoveVault('/v'))
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/w'])
    expect(storage.getRoot()).toBe('/w')
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ roots: ['/w'] })
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ root: expect.anything() }))
    expect(el.querySelector('[data-sidebar]')?.getAttribute('data-root')).toBe('/w')
    expect(stripLabels(el)).toEqual(['b', 'c'])
    expect(askedOf(bridge, '/w')).toEqual(before)
  })

  it('removing the first vault with no tab left keeps that vault\'s remembered file; the empty window is the next vault\'s, the root now, as an empty window is its one vault\'s (S52)', async () => {
    const state: AppState = { ...defaultAppState(), folders: { '/v': { ...defaultFolderState(), lastFile: '/v/a.md' }, '/w': { ...defaultFolderState(), lastFile: '/w/b.md' } } }
    const { bridge, el } = await mount(state, { ...TWO, file: '/v/a.md', tabs: ['/v/a.md'] })
    bridge.state.setFolder.mockClear()
    act(() => captured.sidebar?.onRemoveVault('/v'))
    await act(async () => {})
    expect(stripLabels(el)).toEqual([])
    expect(storage.getRoots()).toEqual(['/w'])
    expect(storage.getLastFile('/v')).toBe('/v/a.md')
    expect(bridge.state.setFolder.mock.calls).toEqual([['/w', { lastFile: null }]])
  })

  it('the only vault cannot be removed: the window keeps it (S51)', async () => {
    const { bridge } = await mount(defaultAppState(), ONE)
    bridge.window.setIdentity.mockClear()
    act(() => captured.sidebar?.onRemoveVault('/v'))
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
  })

  it('a vault whose folder is gone drops out as a removed one does, with a notice that names it, and leaves the recents (S53, R6)', async () => {
    const { bridge, el } = await mount({ ...named({ '/w': 'Work' }), recents: [recent('/v', 2), recent('/w', 1)] }, TWO)
    const before = askedOf(bridge, '/v')
    act(() => captured.sidebar?.onRootMissing('/w'))
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ roots: ['/v'] })
    expect(stripLabels(el)).toEqual(['a'])
    expect(noticeText(el)).toBe('Work is gone: its folder was not found')
    expect(bridge.state.removeRecent).toHaveBeenCalledExactlyOnceWith('/w')
    expect(storage.getRecentRoots().map((r) => r.path)).toEqual(['/v'])
    expect(el.querySelector('.welcome')).toBeNull()
    expect(askedOf(bridge, '/v')).toEqual(before)

    // A late report for a vault that already left the window changes nothing and says nothing more.
    bridge.state.removeRecent.mockClear()
    act(() => captured.sidebar?.onRootMissing('/w'))
    expect(storage.getRoots()).toEqual(['/v'])
    expect(bridge.state.removeRecent).not.toHaveBeenCalled()
    expect(el.querySelector('.welcome')).toBeNull()
  })

  it.each([
    ['"Remove from this window"', (root: string) => captured.sidebar?.onRemoveVault(root)],
    ['a folder that is gone (S53)', (root: string) => captured.sidebar?.onRootMissing(root)],
  ])('a vault that leaves by %s takes its focus items in the write that drops it — with the sidebar hidden too, where no panel prunes its own copy (A5)', async (_how, leave) => {
    const { bridge, emitToggleSidebar } = await mount(defaultAppState(), { ...TWO, focusList: ['/w/docs', '/v/sub', '/w/b.md'] })
    act(() => emitToggleSidebar())
    bridge.window.setIdentity.mockClear()
    act(() => void leave('/w'))
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/v'])
    expect(storage.getFocusList()).toEqual(['/v/sub'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ roots: ['/v'], focusList: ['/v/sub'] })
  })

  it('YAZ-2631 S46, S47, S49, S53: a drag of a vault row is ONE identity write, the vaults in the new order, and the sidebar is handed them so; the sidebar is not mounted again, no vault is read again and the tabs stay; a saved workspace of other vaults is not written', async () => {
    const { bridge, el } = await mount({ ...defaultAppState(), vaultSets: [{ id: 's1', name: 'Three', roots: ['/v', '/w', '/x'], lastUsed: 1 }] }, TWO)
    const aside = el.querySelector('[data-sidebar]')
    const before = ['/v', '/w'].map((vault) => askedOf(bridge, vault))
    bridge.window.setIdentity.mockClear()
    bridge.state.setFolder.mockClear()

    act(() => captured.sidebar?.onReorderVaults(['/w', '/v']))
    await act(async () => {})
    expect(storage.getRoots()).toEqual(['/w', '/v'])
    expect(storage.getRoot()).toBe('/w')
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ roots: ['/w', '/v'] }]])
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
    expect(bridge.window.saveSet).not.toHaveBeenCalled()
    // The header's label is the names in this order (S53).
    expect(captured.sidebar?.vaults.map((vault) => [vault.root, vault.name])).toEqual([['/w', 'w'], ['/v', 'v']])
    // S47: the panel that was there, and each vault as it was loaded — its tree, its index, its watcher.
    expect(el.querySelector('[data-sidebar]')).toBe(aside)
    expect(['/v', '/w'].map((vault) => askedOf(bridge, vault))).toEqual(before)
    expect(stripLabels(el)).toEqual(['a', 'b', 'c'])
    expect(activeLabel(el)).toBe('b')
    expect(el.querySelector('.link-notice')).toBeNull()
  })

  it('YAZ-2631 S48: the window\'s vaults are exactly a saved workspace, in any order: after the identity write main is asked once to save this window\'s vaults under that workspace\'s name; a save that fails is logged, and the window keeps its order', async () => {
    const vaultSets = [{ id: 's0', name: 'Other', roots: ['/x', '/y'], lastUsed: 2 }, { id: 's1', name: 'Pair', roots: ['/v', '/w'], lastUsed: 1 }]
    const { bridge } = await mount({ ...defaultAppState(), vaultSets }, TWO)
    bridge.window.setIdentity.mockClear()
    act(() => captured.sidebar?.onReorderVaults(['/w', '/v']))
    await act(async () => {})
    expect(bridge.window.setIdentity.mock.calls).toEqual([[{ roots: ['/w', '/v'] }]])
    expect(bridge.window.saveSet.mock.calls).toEqual([['Pair']])
    expect(bridge.window.setIdentity.mock.invocationCallOrder[0]).toBeLessThan(bridge.window.saveSet.mock.invocationCallOrder[0])
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    bridge.window.saveSet.mockRejectedValueOnce(new Error('ipc down'))
    act(() => captured.sidebar?.onReorderVaults(['/v', '/w']))
    await act(async () => {})
    expect(error).toHaveBeenCalledWith('[reorder-vaults] saveSet failed:', expect.any(Error))
    expect(storage.getRoots()).toEqual(['/v', '/w'])
    error.mockRestore()
  })

  it('YAZ-2631 R12: the sidebar is keyed on the vault that was first when it mounted, while that vault is in the window — a different vault at the top mounts nothing again, and nor does the removal of that top vault; the removal of the key\'s vault mounts the sidebar again, and so does "Open in this window" on a different vault', async () => {
    const { el } = await mount(defaultAppState(), { ...TWO, roots: ['/v', '/w', '/x'] })
    const aside = () => el.querySelector('[data-sidebar]')
    const first = aside()
    act(() => captured.sidebar?.onReorderVaults(['/x', '/w', '/v']))
    expect(aside()).toBe(first)
    // `/x` is the first vault now, and not the key: it leaves as a vault behind the key does.
    act(() => captured.sidebar?.onRemoveVault('/x'))
    await act(async () => {})
    expect(vaultRoots()).toEqual(['/w', '/v'])
    expect(aside()).toBe(first)
    // `/v` is the key: when it leaves, the first vault is the key and the sidebar mounts again.
    act(() => captured.sidebar?.onRemoveVault('/v'))
    await act(async () => {})
    expect(aside()).not.toBe(first)
    expect(aside()?.getAttribute('data-root')).toBe('/w')
    const second = aside()
    await act(async () => void (await captured.sidebar?.onOpenVaultHere('/z')))
    expect(aside()).not.toBe(second)
    expect(aside()?.getAttribute('data-root')).toBe('/z')
  })

  it('a vault row the user closed stays closed while the sidebar is hidden and shown again, and a vault that is added again starts open (R9)', async () => {
    const { bridge, emitToggleSidebar } = await mount(defaultAppState(), TWO)
    bridge.window.setIdentity.mockClear()
    bridge.state.setFolder.mockClear()
    act(() => captured.sidebar?.onSetVaultOpen('/w', false))
    expect(captured.sidebar?.closedVaults).toEqual(['/w'])
    // Window-local, for the session: nothing goes to the store.
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
    act(() => emitToggleSidebar())
    act(() => emitToggleSidebar())
    expect(captured.sidebar?.closedVaults).toEqual(['/w'])
    act(() => captured.sidebar?.onSetVaultOpen('/w', true))
    expect(captured.sidebar?.closedVaults).toEqual([])

    act(() => captured.sidebar?.onSetVaultOpen('/w', false))
    act(() => captured.sidebar?.onRemoveVault('/w'))
    expect(await add('/w')).toBe(true)
    expect(captured.sidebar?.closedVaults).toEqual([])
  })
})
