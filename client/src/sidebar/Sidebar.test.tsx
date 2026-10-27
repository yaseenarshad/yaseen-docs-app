/**
 * Sidebar file-row gestures: ⌘-click opens a BACKGROUND TAB in this window (I3 LOCKED ruling,
 * GRO-2235); the row's context-menu "Open in new window" still opens a new window on
 * {root, file} over the bridge (D2, GRO-2168) — either way the current window's active file
 * is untouched (onOpenFile never fires). Plain click and folder/blank-space context menus are
 * unchanged, and activating a stale tab probes a fresh tree before onFileMissing fires.
 * Real Tree/ContextMenu render against the jsdom bridge stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act, useCallback, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { copyFoldKey } from '@shared/foldKey'
import { parseFrontmatter } from '@shared/frontmatter'
import { CLIP_CHANGED, DEFAULT_SETTINGS, DEFAULT_SIDEBAR_SORT, DEFAULT_SIDEBAR_TABS, MAX_FOCUS, defaultAppState, defaultFolderState, defaultRightPanelIdentity, isSidebarLens, type AppState, type FileClipRequest, type FileClipState, type ImportResponse, type IndexRecord, type PasteRequest, type PasteResponse, type SidebarTab, type TreeNode, type WatchEvent, type WindowIdentity, type SidebarTabsPrefs } from '@shared/types'
import appCss from '../app.css?inline'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { EMPTY_SELECTION } from '../lib/selection'
// The focus list's persistence is the REAL storage module (no mock in this file): `storage.init()`
// against a mount's bridge is how a test hands the Sidebar a list restored from an earlier session.
import { storage } from '../lib/storage'

/**
 * File-row render counter (YAZ-2194): every file row renders its label through `pageLabel`, so the
 * REAL function behind a counting wrapper tells which rows a change re-rendered.
 */
const labelRenders = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('../lib/pageLabel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/pageLabel')>()
  const pageLabel: typeof real.pageLabel = (path, folder, titles) => {
    if (!folder) labelRenders.names.push(path.slice(path.lastIndexOf('/') + 1))
    return real.pageLabel(path, folder, titles)
  }
  return { ...real, pageLabel }
})

/**
 * Search-row build counter (YAZ-2602 R2): the REAL builders behind recording wrappers, so a test
 * can say which vault's folder rows and file rows a landed tree made the search build again.
 */
const rowBuilds = vi.hoisted(() => ({ folders: [] as string[], files: [] as string[], ranked: [] as string[] }))
vi.mock('../search/searchCandidates', async (importOriginal) => {
  const real = await importOriginal<typeof import('../search/searchCandidates')>()
  /** One entry per ranking (YAZ-2638 D2): the query it ranked. */
  const searchRows: typeof real.searchRows = (candidates, query, first) => {
    rowBuilds.ranked.push(query)
    return real.searchRows(candidates, query, first)
  }
  const folderCandidates: typeof real.folderCandidates = (root, dirs, folders) => {
    rowBuilds.folders.push(root)
    return real.folderCandidates(root, dirs, folders)
  }
  const fileCandidates: typeof real.fileCandidates = (root, files) => {
    rowBuilds.files.push(root)
    return real.fileCandidates(root, files)
  }
  return { ...real, folderCandidates, fileCandidates, searchRows }
})

/** Shortcut-row build counter (YAZ-2602 S30): the REAL `folderShortcuts` behind a recording wrapper, so a test can say which vault an index snapshot read again. */
const shortcutBuilds = vi.hoisted(() => ({ roots: [] as string[] }))
vi.mock('./folderShortcuts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./folderShortcuts')>()
  const folderShortcuts: typeof real.folderShortcuts = (root, records, folders) => {
    shortcutBuilds.roots.push(root)
    return real.folderShortcuts(root, records, folders)
  }
  return { ...real, folderShortcuts }
})

import { testDoor } from '../testNoteIds'
import { PREVIEW_FOLLOW_MS } from './hooks/useSidebarSearch'
import { useSameList } from './hooks/useVaultTree'
import { useVaultListsHere } from '../lists/useVaultListsHere'
import { countChildren, Sidebar, type SidebarClipboard } from './Sidebar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Past the 100 ms quiet window a watcher burst waits out before its trailing tree read (YAZ-2191, YAZ-2240). */
const afterQuiet = () => act(() => new Promise<void>((r) => setTimeout(r, 150)))

const TREE: TreeNode[] = [
  { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
  { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
]

/** Just the bridge surface the Sidebar tree touches (the jsdom stub pattern, App.test.tsx). */
/**
 * A clipboard push, as main sends it (YAZ-3266): main's `clipState` answers the same clip from then on, so the fresh
 * read a paste makes confirms what was pushed.
 */
function pushed(bridge: { file: { clipState: ReturnType<typeof vi.fn> } }, listener: (state: FileClipState) => void) {
  return (state: FileClipState) => {
    bridge.file.clipState.mockResolvedValue(state)
    listener(state)
  }
}
/** A paste into `targetDir` that names the clip the window confirmed (YAZ-3266: `expect`): exactly this verb and these paths, in clipboard order. */
const into = (targetDir: string, op: 'copy' | 'cut', ...paths: string[]) => ({ targetDir, expect: { op, paths } })

function installBridge() {
  const bridge = {
    tree: vi.fn(async (root: string) => ({ root, tree: TREE, generatedAt: 1 })),
    // The delete confirm sheet reads the index for its backlink count (GRO-2272 C3).
    index: vi.fn(async (root: string) => ({ root, records: [] as unknown[], folders: [], generatedAt: 1, ids: true })),
    // The inline-create flow (GRO-2022).
    createFile: vi.fn(async (req: string | { path: string; content?: string; id?: string }) => ({ path: typeof req === 'string' ? req : req.path, mtime: 2, size: 0 })),
    // A note is born from its folder's hidden `.template.md` (YAZ-2290 E3): no folder has one by default.
    readFile: vi.fn((path: string): Promise<{ path: string; content: string; mtime: number; size: number }> => Promise.reject({ code: 'NOT_FOUND', message: `no such file: ${path}` })),
    createDir: vi.fn(async (req: { path: string; title?: string }) => ({ path: req.path })),
    // The door (YAZ-2677 D4): a note's id is the vault's next number, taken before the note is made.
    mintNoteId: testDoor(),
    state: { get: vi.fn(async () => defaultAppState()), setFolder: vi.fn(async () => undefined), setFavoritesOrder: vi.fn(async () => undefined), setFocusOrder: vi.fn(async () => undefined), onChange: vi.fn((_listener: (state: AppState) => void) => () => undefined) },
    // The shared-board marks (YAZ-3040): nothing shared, and no change pushed.
    share: { list: vi.fn(async () => []), onChanged: vi.fn(() => () => undefined) },
    window: {
      open: vi.fn(async () => undefined),
      // "Open by itself" on a vault row (YAZ-2858 D4): main's door; `false` = the folder is gone.
      openAlone: vi.fn(async (_path: string) => true),
      identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })),
      setIdentity: vi.fn(async () => undefined),
    },
    // The file clipboard (YAZ-1674, 🔒 D1) lives in main behind `file.*`: two invokes and the
    // `clip:changed` push every window gets. `onClipChanged` hands back an unsubscribe; a test that
    // wants to PUSH a state captures the listener through `mockImplementation`.
    file: {
      clip: vi.fn(async (_req: FileClipRequest) => undefined),
      paste: vi.fn(async (_req: PasteRequest): Promise<PasteResponse> => ({ pasted: [], failed: [] })),
      // Read on mount, so a window opened after a clip labels Paste from the start; on focus; and FRESH at each paste
      // (YAZ-3266). A test that pushes a clip makes this answer it too (`pushed`), as main does.
      clipState: vi.fn(async (): Promise<FileClipState> => null),
      onClipChanged: vi.fn((_listener: (state: FileClipState) => void) => () => undefined),
      // Drags between Finder and the sidebar (YAZ-3253, YAZ-3254): a dropped File's path, the drop's import, and the OS drag out.
      pathFor: vi.fn((file: File) => `/Users/yasin/Downloads/${file.name}`),
      import: vi.fn(async (_req: { paths: string[]; targetDir: string }): Promise<ImportResponse> => ({ moved: [], copied: [], failed: [] })),
      dragOut: vi.fn(async (_req: { paths: string[]; icon: string }) => undefined),
      // Main's word that this window's drag out landed in another window of the app (YAZ-3263).
      onDragLanded: vi.fn((_listener: (ev: { paths: string[] }) => void) => () => undefined),
      // Main's word that the mouse button came up after this window's drag out (YAZ-3294 D24).
      onDragEnded: vi.fn((_listener: (ev: { paths: string[] }) => void) => () => undefined),
    },
    // The Favorites list (YAZ-1766 6A): `.yaseendocs/favorites.json` behind main; absolute paths both ways.
    // Empty by default; the favorites block seeds `get` and captures the `onChanged` listener.
    favorites: {
      get: vi.fn(async (_root: string): Promise<string[]> => []),
      set: vi.fn(async (_root: string, _paths: readonly string[]) => undefined),
      onChanged: vi.fn((_listener: (change: { root: string }) => void) => () => undefined),
    },
    // A vault's focus list (YAZ-2702): `.yaseendocs/focus.<mac id>.json` behind main; absolute paths both ways,
    // the same three calls as `favorites`. Empty by default; the focus blocks seed `get` and capture the `onChanged` listener.
    focus: {
      get: vi.fn(async (_root: string): Promise<string[]> => []),
      set: vi.fn(async (_root: string, _paths: readonly string[]) => undefined),
      onChanged: vi.fn((_listener: (change: { root: string }) => void) => () => undefined),
    },
    // The sounds of a gesture (YAZ-3267 D15): a Paste of a Copy and a copy in from another disk ask here; a move asks through App (`onMoved`).
    app: { sound: vi.fn(async (_kind: 'land' | 'trash') => undefined) },
    // Reveal in Finder (GRO-2274) goes through the shell namespace.
    shell: {
      reveal: vi.fn(async ({ path }: { path: string }) => ({ path })),
      // Open in default app (YAZ-1577): the row with no viewer's click, and its menu item.
      openDefault: vi.fn(async ({ path }: { path: string }) => ({ path })),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let root: Root | null = null
let container: HTMLElement | null = null
/** The mounted panel's tab switch, as App does it (YAZ-2638 D2): the same Sidebar, a new `lens`. Null between tests. */
let showTab: ((lens: SidebarTab) => void) | null = null

/** The panel's props but `lists`: the harness holds the window's Focus and Favorites, as App does (YAZ-3264 D1). */
type PanelProps = Omit<Parameters<typeof Sidebar>[0], 'lists'>
/** App's half of the preview panel of the search (YAZ-2662 D5), of the mounted panel: the path on show, and App's ✕. Null between tests. */
let previewPanel: { path: string | null; close: () => void } | null = null
/**
 * The Sidebar as App mounts it for the preview panel: the path that `onPreview` names is App's
 * state, handed back as `previewPath` in the same pass. The ✕ of the panel clears that state with
 * no word from the Sidebar. The window's Focus and Favorites are App's too (YAZ-3264 D1).
 */
function WithPreview(props: PanelProps) {
  const [path, setPath] = useState<string | null>(null)
  const { onPreview } = props
  const lists = useVaultListsHere(useSameList(props.vaults.map((vault) => vault.root)), props.onNotice)
  const show = useCallback((next: string | null) => {
    setPath(next)
    onPreview(next)
  }, [onPreview])
  previewPanel = { path, close: () => setPath(null) }
  return <Sidebar {...props} lists={lists} previewPath={path} onPreview={show} />
}
type Vault = PanelProps['vaults'][number]
/** A vault's own review facts (YAZ-2602 R5): upkeep on or off, what is due, whether its review is open; and the Inbox row's click. */
type Inbox = Partial<Pick<Vault, 'upkeep' | 'dueCount' | 'reviewing'>> & { onOpenInbox?: () => void }
/**
 * What a test hands the harness: the panel's props, and for a window with ONE vault that vault's
 * own — its folder, its watcher, its index source and its review facts — which the harness makes
 * the vault of. Handed with `vaults`, the review facts are every vault's.
 */
type SidebarProps = PanelProps & { root?: string; watch?: Vault['watch']; indexSource?: Vault['index'] } & Inbox

/** The review facts a test named, and no others. */
const inboxOf = ({ upkeep, dueCount, reviewing }: Inbox): Partial<Vault> => ({ ...(upkeep !== undefined && { upkeep }), ...(dueCount !== undefined && { dueCount }), ...(reviewing !== undefined && { reviewing }) })

/**
 * The window's one vault, as App hands it: `/v`, a silent watcher and an empty index unless a test
 * says otherwise. Upkeep review (YAZ-2322) is off, as in a new vault, with nothing due and no review open.
 */
const oneVault = ({ root = '/v', watch = { subscribe: () => () => undefined }, indexSource = indexFor(true), ...over }: Partial<SidebarProps>): Vault[] => [
  { root, name: root.slice(root.lastIndexOf('/') + 1), watch, index: indexSource, upkeep: false, dueCount: 0, reviewing: false, ...inboxOf(over) },
]

async function mount(over: Partial<SidebarProps> = {}, tweakBridge?: (bridge: ReturnType<typeof installBridge>) => unknown) {
  const bridge = installBridge()
  await tweakBridge?.(bridge) // before the first render: the loading/error tree states only exist there
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  // Split the one vault's own from the panel's props: the harness makes the vault of them.
  const panel = ({ root: _root, watch: _watch, indexSource: _indexSource, upkeep: _upkeep, dueCount: _dueCount, reviewing: _reviewing, onOpenInbox: _onOpenInbox, ...rest }: Partial<SidebarProps>): Partial<PanelProps> => rest
  /** The window's vaults with a test's review facts on each. */
  const withInbox = (vaults: readonly Vault[], facts: Inbox): Vault[] => vaults.map((vault) => ({ ...vault, ...inboxOf(facts) }))
  // The Inbox row's click, as the tests of a window with one vault read it: App's door without the vault it names.
  const onOpenInbox = over.onOpenInbox ?? vi.fn()
  const props: PanelProps & { onOpenInbox: () => void } = {
    onOpenInbox,
    vaults: oneVault(over),
    // Vault rows (YAZ-2602 R9): none is closed, and App's four doors for the window's list of vaults.
    closedVaults: [],
    onSetVaultOpen: vi.fn(),
    onAddVault: vi.fn(async () => true),
    onPickVault: vi.fn(),
    onRemoveVault: vi.fn(),
    onReorderVaults: vi.fn(),
    width: 260,
    activeFile: null,
    onOpenFile: vi.fn(),
    onKeepFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    // A search row's tree-drawing menu items (🔒 D2, YAZ-2050): App flips to Files and issues the reveal request.
    onRevealInFiles: vi.fn(),
    // The preview panel of the search (YAZ-2662 D5): `WithPreview` holds the path, as App does, and tells this door each path that the Sidebar names.
    previewPath: null,
    onPreview: vi.fn(),
    // A note's hover preview (YAZ-3075 C20): App's text formatting of the vault; none here.
    textVarsFor: () => ({}),
    onPickFolder: vi.fn(),
    pickDisabled: false,
    // The header's vault switcher (YAZ-1767): 0 = no ⌘O pending; the panel itself is VaultSwitcher.test's subject.
    switcherOpenRequest: 0,
    onOpenVaultHere: vi.fn(async () => true),
    onCollapse: vi.fn(),
    // Every test below this line is about the FILE TREE, so the harness mounts the FILES lens
    // (YAZ-847). App owns and persists the value, and the
    // "lens tabs" describe mounts each lens explicitly.
    lens: 'files',
    onLensChange: vi.fn(),
    revealRequest: null,
    onRevealConsumed: vi.fn(),
    // A row menu asked from the new tab page (YAZ-2663 D6): none unless a test makes the request.
    menuRequest: null,
    onMenuConsumed: vi.fn(),
    settings: { ...DEFAULT_SETTINGS },
    onChangeSettings: vi.fn(),
    onOpenSettings: vi.fn(),
    // The Sessions tab's doors (YAZ-3147): App's; SessionList.test is their subject.
    onRestoreSession: vi.fn(),
    onSaveSession: vi.fn(),
    onUpdateSession: vi.fn(),
    sessionNameRequest: null,
    onSessionNameConsumed: vi.fn(),
    // No update (YAZ-2976 D4): the footer shows only the cog.
    update: { kind: 'idle' },
    onOpenWhatsNew: vi.fn(),
    onRootMissing: vi.fn(),
    onFileMissing: vi.fn(),
    onRenameFile: vi.fn(async () => undefined),
    onMoveEntries: vi.fn(async () => undefined),
    onMoved: vi.fn(),
    onDraggedOut: vi.fn(),
    onRetitle: vi.fn(async () => undefined),
    onDeleteEntries: vi.fn(async () => undefined),
    onNotice: vi.fn(),
    pendingSearchFocus: false,
    onSearchFocusHandled: vi.fn(),
    // ⌘⇧C's box (🔒 D4, YAZ-1338): App's in production, the harness's here — every mount gets a
    // fresh one, and the "hands its selection up" case reads it back.
    selectionRef: { current: EMPTY_SELECTION },
    // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): App's listener asks it; the chord tests hold their own box.
    clipboardRef: { current: null },
    // The shortcut rows and the titles read the vault's index source (`oneVault`): empty unless a test
    // feeds it, and of a vault that uses IDs unless a test says otherwise (YAZ-2523).
    onReviewFolder: vi.fn(),
    // No row is a note the index knows unless a test says so: null hides the review toggle.
    reviewState: () => null,
    onSetReview: vi.fn(),
    // An Inbox row's click (YAZ-2602 R5) names its vault.
    onInbox: vi.fn(() => onOpenInbox()),
    ...panel(over),
    ...(over.vaults !== undefined && { vaults: withInbox(over.vaults, over) }),
  }
  const { onOpenInbox: _door, ...panelProps } = props
  await act(async () => root?.render(<StrictMode><WithPreview {...panelProps} /></StrictMode>))
  // The tab that shows is App's state: a later render keeps it unless it names a different one.
  let lens = panelProps.lens
  const again = (next: Partial<PanelProps> & Inbox) => <StrictMode><WithPreview {...panelProps} lens={lens} {...panel(next)} vaults={withInbox(next.vaults ?? panelProps.vaults, { ...over, ...next })} /></StrictMode>
  /** Re-render the SAME Sidebar instance with changed props (the App-driven activation path); a review fact changes on the vaults as they stand. */
  const rerender = async (next: Partial<PanelProps> & Inbox) => {
    lens = next.lens ?? lens
    await act(async () => root?.render(again(next)))
  }
  showTab = (next) => {
    lens = next
    act(() => root?.render(again({})))
  }
  return { bridge, props, el, rerender }
}

const fileRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file')
/** The window's index source for an empty vault that uses IDs, or for one that does not (YAZ-2523). */
const indexFor = (ids: boolean) => {
  const source = createWikilinkResolveSource()
  source.update(() => null, undefined, undefined, ids)
  return source
}
/** An index record for a note of the `/v` vault. */
const indexRecord = (path: string): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: path.slice('/v/'.length, Math.max('/v/'.length, path.lastIndexOf('/'))), ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
}
/** The search bar where it stands, or null: it is in the Search tab only (YAZ-2638 D2, S6). */
const searchBar = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')
/** The search bar to type in: this shows the Search tab first when a different tab shows, as ⌘K and a click on the tab do. */
const searchInput = (el: HTMLElement) => {
  if (searchBar(el) === null) showTab?.('search')
  return searchBar(el)
}
/**
 * Drive the CONTROLLED search input like a user: native value setter + input event (SettingsDialog
 * idiom). Async because the index feed is LAZY since YAZ-808 — the first non-empty query is what
 * starts the read, so a keystroke now has settling to do.
 */
const type = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** An editor stand-in: layoutless jsdom always answers `offsetParent: null`, so it declares its own. */
const editorStub = (): HTMLElement => {
  const instance = document.createElement('div')
  instance.className = 'editor-instance'
  const pm = document.createElement('div')
  pm.className = 'ProseMirror'
  pm.tabIndex = -1
  Object.defineProperty(pm, 'offsetParent', { get: () => document.body })
  instance.appendChild(pm)
  document.body.appendChild(instance)
  return pm
}
const menuItems = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
const itemByLabel = (el: HTMLElement, label: string) => menuItems(el).find((b) => b.textContent === label)
/**
 * A parent's flyout (D7 amended, YAZ-1674): "Open in ▸" unless `parent` names another — a create
 * row (YAZ-3085 D3) such as "New note ▸". It opens with ArrowRight on the parent: at once, with no
 * hover wait (D4), and never running a parent's default (D1) the way a click on a create row does.
 * Then read its children. `subItemByLabel` is undefined when the parent is absent OR the child is
 * not offered, which is exactly the two "no such item" answers the gating tests below ask for. The
 * row and its flyout's first item can share a label (edge case 9): `itemByLabel` finds the row,
 * which comes first, and a child is looked up inside `.ctx-menu__sub` only.
 */
const openFlyout = (el: HTMLElement, parent = 'Open in') => {
  const row = itemByLabel(el, parent)
  if (row !== undefined) act(() => void row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })))
  return [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')]
}
const subLabels = (el: HTMLElement, parent?: string) => openFlyout(el, parent).map((b) => b.textContent)
const subItemByLabel = (el: HTMLElement, label: string, parent?: string) => openFlyout(el, parent).find((b) => b.textContent === label)
/** Open the flyout OUTSIDE the click's own `act`: a nested `act` does not flush, so the child must exist before that act begins. */
const clickSub = (el: HTMLElement, label: string, parent?: string) => {
  const child = subItemByLabel(el, label, parent)
  act(() => child?.click())
}
const clickSubAsync = async (el: HTMLElement, label: string, parent?: string) => {
  const child = subItemByLabel(el, label, parent)
  await act(async () => child?.click())
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  showTab = null
  previewPanel = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

/**
 * Drawing and diagram rows (YAZ-3028 D11): normal rows that open a tab, named by their full file name,
 * a diagram marked; "Info" on their menu reads the board's head through `fs:board-head`.
 */
describe('drawing and diagram rows (YAZ-3028 D11)', () => {
  const BOARD_TREE: TreeNode[] = [
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'Flow.drawio', path: '/v/Flow.drawio', size: 1, mtime: 1, kind: 'diagram' },
    { type: 'file', name: 'Sketch.excalidraw', path: '/v/Sketch.excalidraw', size: 1, mtime: 1, kind: 'drawing' },
  ]
  const withBoards = (bridge: ReturnType<typeof installBridge>) => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: BOARD_TREE, generatedAt: 1 })
    ;(bridge as unknown as Record<string, unknown>).boardHead = vi.fn(async (path: string) => ({ path, mtime: Date.UTC(2026, 9, 20), size: 2048, meta: { createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 20) } }))
  }
  const boardRow = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row--file[title="${path}"]`)

  it('are normal rows: full file name, not external, the draw.io mark on the diagram only, and a click opens a tab', async () => {
    const { el, bridge, props } = await mount({}, withBoards)
    const flow = boardRow(el, '/v/Flow.drawio')
    const sketch = boardRow(el, '/v/Sketch.excalidraw')
    expect(flow?.classList.contains('tree__row--external')).toBe(false)
    expect(sketch?.classList.contains('tree__row--external')).toBe(false)
    expect(flow?.querySelector('.tree__label')?.textContent).toBe('Flow.drawio')
    expect(flow?.querySelector('.diagram-mark')?.getAttribute('aria-label')).toBe('draw.io diagram')
    expect(sketch?.querySelector('.diagram-mark')).toBeNull()
    await act(async () => sketch?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Sketch.excalidraw')
    expect(bridge.shell.openDefault).not.toHaveBeenCalled()
  })

  it('"Info" stands above Delete on a board row only; it reads the head and shows the board`s type and dates', async () => {
    const { el, bridge } = await mount({}, withBoards)
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })))
    expect(itemByLabel(el, 'Info')).toBeUndefined() // a note
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void boardRow(el, '/v/Flow.drawio')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })))
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels.slice(-2)).toEqual(['Info', 'Delete'])
    await act(async () => itemByLabel(el, 'Info')?.click())
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect((bridge as unknown as { boardHead: ReturnType<typeof vi.fn> }).boardHead).toHaveBeenCalledExactlyOnceWith('/v/Flow.drawio')
    await vi.waitFor(() => expect(el.ownerDocument.querySelector('.board-info')).not.toBeNull())
    const info = el.ownerDocument.querySelector('.board-info')?.textContent ?? ''
    expect(info).toContain('draw.io diagram')
    expect(info).toContain('2.0 KB')
  })
})

/** The board picture and Info follow the file while they show (YAZ-3044 A20, A41). */
describe('hover preview setting and live board heads (YAZ-3044 A20, A41)', () => {
  const BOARDS: TreeNode[] = [{ type: 'file', name: 'Flow.drawio', path: '/v/Flow.drawio', size: 1, mtime: 1, kind: 'diagram' }]
  const withBoards = (bridge: ReturnType<typeof installBridge>) => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: BOARDS, generatedAt: 1 })
    ;(bridge as unknown as Record<string, unknown>).boardHead = vi.fn(async (path: string) => ({ path, mtime: 5, size: 2048, meta: null }))
  }
  const headsOf = (bridge: ReturnType<typeof installBridge>) => (bridge as unknown as { boardHead: ReturnType<typeof vi.fn> }).boardHead
  const flowRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file[title="/v/Flow.drawio"]')
  const withWatcher = () => {
    const listeners: ((ev: WatchEvent) => void)[] = []
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        listeners.push(l)
        return () => void listeners.splice(listeners.indexOf(l), 1)
      },
    }
    return { watch, fire: (ev: WatchEvent) => [...listeners].forEach((l) => l(ev)) }
  }
  const dwell = () => act(() => new Promise<void>((r) => setTimeout(r, 450)))

  it('A20: with "Preview on hover" off, resting on a board row opens no preview; on, it does', async () => {
    const off = await mount({ settings: { ...DEFAULT_SETTINGS, hoverPreview: false } }, withBoards)
    act(() => flowRow(off.el)?.focus())
    await dwell()
    expect(headsOf(off.bridge)).not.toHaveBeenCalled()
    act(() => root?.unmount())
    root = null
    const on = await mount({ settings: { ...DEFAULT_SETTINGS, hoverPreview: true } }, withBoards)
    act(() => flowRow(on.el)?.focus())
    await dwell()
    expect(headsOf(on.bridge)).toHaveBeenCalledWith('/v/Flow.drawio')
  })

  it('A41: Info reads the head again on a change of that board, and only of that board', async () => {
    const { watch, fire } = withWatcher()
    const { el, bridge } = await mount({ watch }, withBoards)
    act(() => void flowRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })))
    await act(async () => itemByLabel(el, 'Info')?.click())
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(headsOf(bridge)).toHaveBeenCalledTimes(1)
    await act(async () => fire({ type: 'change', path: '/v/other.md', mtime: 9 }))
    expect(headsOf(bridge)).toHaveBeenCalledTimes(1)
    await act(async () => fire({ type: 'change', path: '/v/Flow.drawio', mtime: 9 }))
    expect(headsOf(bridge)).toHaveBeenCalledTimes(2)
  })
})

/**
 * A note row opens the hover preview too (YAZ-3075): the same 400 ms wait, the mouse or the focus,
 * the top of the note read on each open. The C-numbers are the cases on YAZ-3086.
 */
describe('note rows open the hover preview (YAZ-3075)', () => {
  const NOTES: TreeNode[] = [
    { type: 'file', name: 'Plan.md', path: '/v/Plan.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'Zed.md', path: '/v/Zed.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withNotes = (bridge: ReturnType<typeof installBridge>) => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: NOTES, generatedAt: 1 })
    bridge.readFile.mockImplementation(async (path: string) => ({ path, content: '---\ntitle: Plan\n---\n\n# Hello hover\n', mtime: 1, size: 30 }))
  }
  const noteRow = (el: HTMLElement, path = '/v/Plan.md') => el.querySelector<HTMLButtonElement>(`.tree__row--file[title="${path}"]`)!
  const notePanel = () => document.querySelector<HTMLElement>('.note-preview')
  const dwell = () => act(() => new Promise<void>((r) => setTimeout(r, 450)))
  /** Past the lazy chunk (its first import compiles Crepe) and the read. */
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 50)))
  /** Ticks inside `act` until `ok` holds (10 s at most), so every update on the way is React's. */
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await settle()
    expect(ok()).toBe(true)
  }
  const shows = () => until(() => notePanel() !== null)

  it('C1, C6, C16: the mouse resting 400 ms opens the note`s panel with its body below the frontmatter; the mouse leaving closes it', async () => {
    const { el, bridge } = await mount({}, withNotes)
    act(() => void noteRow(el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(notePanel()).toBeNull()
    await dwell()
    await shows()
    expect(notePanel()?.querySelector('.board-preview__name')?.textContent).toBe('Plan')
    expect(bridge.readFile).toHaveBeenCalledWith('/v/Plan.md')
    await until(() => notePanel()?.querySelector('.ProseMirror')?.textContent?.includes('Hello hover') === true)
    expect(notePanel()?.textContent).not.toContain('title: Plan')
    act(() => void noteRow(el).dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(notePanel()).toBeNull()
  })

  it('C2, C6: the keyboard focus resting 400 ms opens it too; the focus leaving closes it', async () => {
    const { el } = await mount({}, withNotes)
    act(() => noteRow(el).focus())
    await dwell()
    await shows()
    act(() => noteRow(el).blur())
    expect(notePanel()).toBeNull()
  })

  it('C12, C13: Space on the row shows the Space panel and closes the hover panel; while it shows no wait starts', async () => {
    const { el } = await mount({}, withNotes)
    act(() => noteRow(el).focus())
    await dwell()
    await shows()
    act(() => void noteRow(el).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    expect(previewPanel?.path).toBe('/v/Plan.md')
    expect(notePanel()).toBeNull()
    act(() => noteRow(el, '/v/Zed.md').focus())
    await dwell()
    await settle()
    expect(notePanel()).toBeNull()
  })

  it('C32: with "Preview on hover" off, a note row starts no wait', async () => {
    const { el, bridge } = await mount({ settings: { ...DEFAULT_SETTINGS, hoverPreview: false } }, withNotes)
    act(() => noteRow(el).focus())
    await dwell()
    await settle()
    expect(notePanel()).toBeNull()
    expect(bridge.readFile).not.toHaveBeenCalledWith('/v/Plan.md')
  })

  it('C27: the note panel adds no watcher subscription — still one for the vault', async () => {
    const counts = { live: 0 }
    const watch = {
      subscribe: () => {
        counts.live++
        return () => void counts.live--
      },
    }
    const { el } = await mount({ watch }, withNotes)
    expect(counts.live).toBe(1)
    act(() => noteRow(el).focus())
    await dwell()
    await shows()
    expect(counts.live).toBe(1)
  })
})

/**
 * The folder menu makes boards (YAZ-3028 D9): name first, then `fs:create-board`, then the tab. An
 * empty box is Untitled, numbered past a name that is taken; a board has no note ID. Since YAZ-3085
 * they live in "New drawing ▸": a click on the row is an Excalidraw drawing (D1), and a hover opens
 * the list — Excalidraw, dated Excalidraw, a separator, draw.io (D3).
 */
describe('New drawing ▸: New Excalidraw drawing / New draw.io diagram (YAZ-3028 D9, YAZ-3085)', () => {
  type CreateBoard = ReturnType<typeof vi.fn<(req: { root: string; path: string }) => Promise<{ path: string; mtime: number; size: number }>>>
  const withCreateBoard = (taken: string[] = []) => (bridge: ReturnType<typeof installBridge>) => {
    const createBoard: CreateBoard = vi.fn(async (req) => {
      if (taken.includes(req.path)) throw { code: 'ALREADY_EXISTS', message: 'file already exists', path: req.path }
      return { path: req.path, mtime: 2, size: 10 }
    })
    ;(bridge as unknown as Record<string, unknown>).createBoard = createBoard
  }
  const createBoardOf = (bridge: ReturnType<typeof installBridge>) => (bridge as unknown as { createBoard: CreateBoard }).createBoard
  /** Right-click the folder, pick `item` — a click on a create row itself, or with `parent` an item of that row's flyout — and commit `typed`. */
  const newIn = async (el: HTMLElement, item: string, typed: string | null, parent?: string) => {
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    if (parent === undefined) act(() => itemByLabel(el, item)?.click())
    else clickSub(el, item, parent)
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    if (input === null) throw new Error('no create box')
    const placeholder = input.placeholder
    act(() => {
      if (typed !== null) input.value = typed
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    return placeholder
  }

  it('right-click a folder → a click on the "New drawing" ROW itself → the drawing box: an Excalidraw board is born in that folder, then opens in a tab (YAZ-3085 D1)', async () => {
    const { el, bridge, props } = await mount({}, withCreateBoard())
    expect(await newIn(el, 'New drawing', 'Sketch')).toBe('New drawing')
    expect(createBoardOf(bridge)).toHaveBeenCalledExactlyOnceWith({ root: '/v', path: '/v/sub/Sketch.excalidraw' })
    expect(bridge.createFile).not.toHaveBeenCalled()
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Sketch.excalidraw')
    // The click made it at once: no flyout ever opened, and the menu is gone.
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('right-click a folder → open "New drawing ▸" → New Excalidraw drawing in its flyout → a name: the board is born in that folder, then opens in a tab', async () => {
    const { el, bridge, props } = await mount({}, withCreateBoard())
    expect(await newIn(el, 'New Excalidraw drawing', 'Plan', 'New drawing')).toBe('New drawing')
    expect(createBoardOf(bridge)).toHaveBeenCalledExactlyOnceWith({ root: '/v', path: '/v/sub/Plan.excalidraw' })
    expect(bridge.createFile).not.toHaveBeenCalled() // never the note door, and no note ID
    expect(bridge.mintNoteId).not.toHaveBeenCalled()
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Plan.excalidraw')
  })

  it('open "New drawing ▸" → New draw.io diagram in its flyout says "New diagram" and makes a .drawio; an empty box is Untitled, then Untitled 2 past a taken one', async () => {
    const { el, bridge, props } = await mount({}, withCreateBoard(['/v/sub/Untitled.drawio']))
    expect(await newIn(el, 'New draw.io diagram', null, 'New drawing')).toBe('New diagram')
    expect(createBoardOf(bridge).mock.calls.map(([req]) => req.path)).toEqual(['/v/sub/Untitled.drawio', '/v/sub/Untitled 2.drawio'])
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Untitled 2.drawio')
  })

  it('New dated Excalidraw drawing seeds MM_DD- ; Enter on the seed alone is "MM_DD- Untitled"', async () => {
    const { el, bridge } = await mount({}, withCreateBoard())
    await newIn(el, 'New dated Excalidraw drawing', null, 'New drawing')
    const [[req]] = createBoardOf(bridge).mock.calls
    expect(req.path).toMatch(/^\/v\/sub\/\d{2}_\d{2}- Untitled\.excalidraw$/)
  })
})

/**
 * A row with no in-app viewer (`kind: null`, YAZ-1577 D2): the OS default app IS the viewer, so
 * every open gesture hands the path to `shell.openDefault` and no tab callback fires. Shift is
 * still the selection gesture and still wins (YAZ-1336 🔒 D2).
 */
describe('rows with no viewer open in the OS default app (YAZ-1577 D2)', () => {
  const NO_VIEWER_TREE: TreeNode[] = [
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'book.epub', path: '/v/book.epub', size: 1, mtime: 1, kind: null },
  ]
  const withNoViewerTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: NO_VIEWER_TREE, generatedAt: 1 })
  const epubRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file[title="/v/book.epub"]')

  it('is marked external and keeps its full filename; a viewer-able row is not marked', async () => {
    const { el } = await mount({}, withNoViewerTree)
    expect(epubRow(el)?.classList.contains('tree__row--external')).toBe(true)
    expect(epubRow(el)?.textContent).toBe('book.epub')
    expect(fileRow(el)?.classList.contains('tree__row--external')).toBe(false)
  })

  it('a plain click hands the path to the OS and opens no tab', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => epubRow(el)?.click())
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/book.epub' })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('⌘-click does the same — there is no tab to background', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => void epubRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/book.epub' })
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('shift-click selects the row and opens nothing anywhere', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => void epubRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(epubRow(el)?.classList.contains('tree__row--selected')).toBe(true)
    expect(bridge.shell.openDefault).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('a stale row (deleted outside the app) surfaces a passive notice', async () => {
    const { props, el } = await mount({}, (bridge) => {
      withNoViewerTree(bridge)
      bridge.shell.openDefault.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    })
    await act(async () => epubRow(el)?.click())
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t open "book.epub" — it is no longer there', 'error')
  })

  it('every file row\'s "Open in ▸" flyout offers "Default app" directly beside "VS Code" (D7 amended)', async () => {
    const { bridge, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = subLabels(el)
    expect(labels.indexOf('Default app')).toBe(labels.indexOf('VS Code') + 1)
    await clickSubAsync(el, 'Default app')
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
  })
})

describe('Sidebar file-row open gestures (D2 GRO-2168, I3 GRO-2235)', () => {
  it('a plain click on a file row opens it in place (onOpenFile), never over the bridge', async () => {
    const { bridge, props, el } = await mount()
    act(() => fileRow(el)?.click())
    expect(props.onOpenFile).toHaveBeenCalledWith('/v/a.md')
    expect(bridge.window.open).not.toHaveBeenCalled()
  })

  it('⌘-click on a file row opens a BACKGROUND TAB in this window (the LOCKED I3 ruling), never a new window', async () => {
    const { bridge, props, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(1)
    expect(props.onOpenFileBackground).toHaveBeenCalledWith('/v/a.md')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(bridge.window.open).not.toHaveBeenCalled()
  })

  it('the file row context menu offers "Open in ▸ New window" above "Copy path"; it routes to the bridge and closes', async () => {
    const { bridge, props, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels).toContain('Open in')
    expect(labels).toContain('Copy path')
    expect(subLabels(el)).toContain('New window')
    clickSub(el, 'New window')
    expect(bridge.window.open).toHaveBeenCalledTimes(1)
    expect(bridge.window.open).toHaveBeenCalledWith({ root: '/v', file: '/v/a.md' })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('a double click on a FOLDER row opens nothing — its two clicks only select and fold (YAZ-3377 D1, S2)', async () => {
    const { props, el } = await mount()
    const row = el.querySelector<HTMLButtonElement>('.tree__row--dir')!
    const open = row.parentElement!.getAttribute('aria-expanded')
    act(() => row.click())
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(row.className).toContain('tree__row--selected')
    expect(row.parentElement!.getAttribute('aria-expanded')).not.toBe(open)
    act(() => void row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(props.onKeepFile).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('a double click on a FILE row keeps the tab its first click previewed (YAZ-2648 D2); with shift or ⌘ it keeps nothing', async () => {
    const { props, el } = await mount()
    const row = fileRow(el)!
    act(() => row.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(props.onKeepFile).not.toHaveBeenCalled()
    act(() => void row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(props.onKeepFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    act(() => void row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, shiftKey: true })))
    act(() => void row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, metaKey: true })))
    expect(props.onKeepFile).toHaveBeenCalledTimes(1)
  })

  it('the folder row menu LEADS with "Open folder page", which opens the folder as a tab; a file row and blank space have no such item (YAZ-2290 D3, YAZ-3377 D2)', async () => {
    const { props, el } = await mount()
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el)[0]?.textContent).toBe('Open folder page')
    act(() => itemByLabel(el, 'Open folder page')?.click())
    // A kept tab (YAZ-2648 D2).
    expect(props.onKeepFile).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Open folder page')).toBeUndefined()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Open folder page')).toBeUndefined()
  })

  it('Enter on a focused FOLDER row opens the folder as a tab and does not fold it; shift+Enter is left alone (YAZ-2290 D3)', async () => {
    const { props, el } = await mount()
    const row = el.querySelector<HTMLButtonElement>('.tree__row--dir')!
    const open = row.parentElement!.getAttribute('aria-expanded')
    const shifted = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    act(() => void row.dispatchEvent(shifted))
    expect(shifted.defaultPrevented).toBe(false)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => void row.dispatchEvent(enter))
    expect(enter.defaultPrevented).toBe(true) // no click follows, so the row does not fold
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(row.className).toContain('tree__row--selected')
    expect(row.parentElement!.getAttribute('aria-expanded')).toBe(open)
  })

  it('the FOLDER row is the active row while its tab is the active one, exactly as a file row is (YAZ-2290 D3)', async () => {
    const { el, rerender } = await mount({ activeFile: '/v/sub' })
    const row = () => el.querySelector<HTMLButtonElement>('.tree__row--dir')!
    expect(row().classList.contains('tree__row--active')).toBe(true)
    expect(row().parentElement!.getAttribute('aria-selected')).toBe('true')
    expect(fileRow(el)?.classList.contains('tree__row--active')).toBe(false)
    await rerender({ activeFile: '/v/a.md' })
    expect(row().classList.contains('tree__row--active')).toBe(false)
    expect(fileRow(el)?.classList.contains('tree__row--active')).toBe(true)
  })

  it('a note row, a folder row and blank space offer one item that copies text, "Copy path": beside the file clipboard\'s Copy, nothing else is named Copy — no "Copy ID" (YAZ-2420 D22, D31)', async () => {
    const { el } = await mount()
    for (const [target, copies] of [['.tree__row--file', ['Copy', 'Copy path']], ['.tree__row--dir', ['Copy', 'Copy path']], ['.sidebar__body', ['Copy path']]] as const) {
      act(() => void el.querySelector(target)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      expect(menuItems(el).map((b) => b.textContent).filter((label) => label?.startsWith('Copy'))).toEqual(copies)
    }
  })

  it('folder rows and blank space get no "Open in new window" item', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
  })
})

describe('Sidebar view-only file routing (YAZ-1301)', () => {
  const VIEW_ONLY_TREE: TreeNode[] = [
    { type: 'file', name: 'data.json', path: '/v/data.json', size: 1, mtime: 1, kind: 'text' },
    { type: 'file', name: 'report.PDF', path: '/v/report.PDF', size: 1, mtime: 1, kind: 'pdf' },
  ]
  const withViewOnlyTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: VIEW_ONLY_TREE, generatedAt: 1 })

  it('shows exact extensions, selects the active file, and routes plain and command clicks through the existing tab callbacks', async () => {
    const { el, props } = await mount({ activeFile: '/v/data.json' }, withViewOnlyTree)
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.tree__row--file')]
    expect(rows.map((row) => row.textContent)).toEqual(['data.json', 'report.PDF'])
    expect(rows[0]?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    expect(rows[1]?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('false')

    act(() => rows[1]?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/report.PDF')
    act(() => void rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/data.json')
  })

  it.each([
    ['/v/data.json'],
    ['/v/report.PDF'],
  ] as const)('keeps %s on the standard file menu while hiding semantic Markdown actions', async (path) => {
    const { bridge, el, props } = await mount({ settings: { ...DEFAULT_SETTINGS, confirmDelete: false } }, withViewOnlyTree)
    const row = el.querySelector(`[title="${path}"]`)

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((item) => item.textContent)).toEqual(expect.arrayContaining([
      'Open in',
      'Copy path',
      'Rename',
      'Delete',
    ]))
    expect(subLabels(el)).toEqual(['New window', 'VS Code', 'Default app', 'Reveal in Finder'])

    clickSub(el, 'New window')
    expect(bridge.window.open).toHaveBeenCalledExactlyOnceWith({ root: '/v', file: path })

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path })

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith([path])
  })
})

/**
 * "Copy link" is GONE (YAZ-1554): it sat directly under "Copy path" and the two were easy to
 * confuse, and the `[[` picker already links from inside a note. One tombstone test, so the
 * item cannot creep back on any row kind.
 */
describe('Sidebar copy link (retired, YAZ-1554)', () => {
  it('no row kind offers "Copy link" — file, folder or blank space — while "Copy path" stays', async () => {
    const { el } = await mount()
    for (const selector of ['.tree__row--file', '.tree__row--dir', '.sidebar__body']) {
      act(() => void el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      expect(itemByLabel(el, 'Copy link')).toBeUndefined()
      expect(itemByLabel(el, 'Copy path')).toBeDefined()
      act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    }
  })
})

describe('Sidebar folder rename + file drag-move (E1b, GRO-2241)', () => {
  /** Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard `dataTransfer` (the TabBar idiom). */
  const fire = (target: Element | null | undefined, type: string) =>
    act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))
  const dirRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--dir')

  it.each([
    ['data.json', 'profile', '/v/profile.json', 'text'],
    ['report.PDF', 'brief.PDF', '/v/brief.PDF', 'pdf'],
  ] as const)('shows the full view-only filename for %s and renames it deterministically', async (name, nextName, target, kind) => {
    const node: TreeNode = { type: 'file', name, path: `/v/${name}`, size: 1, mtime: 1, kind }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    const row = el.querySelector<HTMLButtonElement>(`.tree__row--file[title="/v/${name}"]`)
    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe(name)
    act(() => {
      input!.value = nextName
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith(`/v/${name}`, target, 'file')
  })

  it('submitting an unchanged full view-only filename is a no-op', async () => {
    const node: TreeNode = { type: 'file', name: 'data.json', path: '/v/data.json', size: 1, mtime: 1, kind: 'text' }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('data.json')
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => undefined)
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('submitting an unchanged compound view-only filename is a no-op', async () => {
    const node: TreeNode = { type: 'file', name: 'schema.graphql.ts', path: '/v/schema.graphql.ts', size: 1, mtime: 1, kind: 'text' }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('schema.graphql.ts')
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => undefined)
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  /** Rename on a row, the box as it opens, then `typed` and Enter. */
  const renameRow = async (el: HTMLElement, row: Element | null | undefined, typed: string) => {
    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    const prefill = input?.value
    act(() => {
      input!.value = typed
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    return prefill
  }
  const titled = () => {
    const indexSource = createWikilinkResolveSource()
    indexSource.update(() => null, [{ ...indexRecord('/v/a.md'), title: 'UP-001 - Abdul' }], [{ ...indexRecord('/v/sub/.folder.md'), title: 'Upwork 2026' }], true)
    return indexSource
  }

  it('a FOLDER row\'s "Rename" edits its TITLE: the box is prefilled with it, and committing is a title edit, free text and all (YAZ-2420 D16)', async () => {
    const { props, el } = await mount({ indexSource: titled() })
    expect(await renameRow(el, dirRow(el), 'Upwork: 2027/28')).toBe('Upwork 2026')
    expect(props.onRetitle).toHaveBeenCalledExactlyOnceWith('/v/sub', 'Upwork: 2027/28', 'dir')
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('bug YAZ-3342: a folder in inline rename marks its li `data-renaming` while the box shows, so the thread draws no coloured chevron over the box; Escape takes the mark away', async () => {
    const { el } = await mount({ indexSource: titled() })
    const li = () => dirRow(el)?.closest('li') ?? el.querySelector('.create-inline')?.closest('li')
    expect(li()?.hasAttribute('data-renaming')).toBe(false)
    act(() => void dirRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input).not.toBeNull()
    // The box is the folder's row: its li keeps `aria-expanded` (the folder still folds) and carries the mark.
    expect(input?.closest('li')?.getAttribute('aria-expanded')).not.toBeNull()
    expect(input?.closest('li')?.hasAttribute('data-renaming')).toBe(true)
    expect(el.querySelectorAll('[data-renaming]')).toHaveLength(1)
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => undefined)
    expect(el.querySelector('.create-inline__input')).toBeNull()
    expect(el.querySelectorAll('[data-renaming]')).toHaveLength(0)
  })

  it('a NOTE row\'s "Rename" edits its TITLE the same way; a note with no title is prefilled with its file name, less the extension (YAZ-2420 D16)', async () => {
    const { props, el } = await mount({ indexSource: titled() })
    expect(await renameRow(el, fileRow(el), 'UP-002 - Ali')).toBe('UP-001 - Abdul')
    expect(props.onRetitle).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'UP-002 - Ali', 'file')
    expect(props.onRenameFile).not.toHaveBeenCalled()
    act(() => root?.unmount())
    const plain = await mount()
    expect(await renameRow(plain.el, fileRow(plain.el), 'Plan')).toBe('a')
    expect(plain.props.onRetitle).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'Plan', 'file')
  })

  // The ID vault's half is the two tests above: a title is free text, `/` and all.
  it.each([
    ['a note', fileRow],
    ['a folder', dirRow],
  ])('where the vault does not use IDs "Rename" on %s edits a file name: one a file cannot hold is refused in the box, which stays open with what was typed (YAZ-2523 V3)', async (_, row) => {
    const { props, el } = await mount({ indexSource: indexFor(false) })
    await renameRow(el, row(el), 'a/b')
    expect(el.querySelector('.create-inline__error')?.textContent).toBe('Name cannot contain "/"')
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('a/b')
    expect(props.onRetitle).not.toHaveBeenCalled()
  })

  it('a title left as it was is no edit: nothing is asked of the door', async () => {
    const { props, el } = await mount({ indexSource: titled() })
    await renameRow(el, fileRow(el), 'UP-001 - Abdul')
    expect(props.onRetitle).not.toHaveBeenCalled()
    expect(el.querySelector('.create-inline__input')).toBeNull()
  })

  it('dragging a file row onto a folder row moves it there (onRenameFile old→new parent); the target highlights while hovered; no top row of Files reorders (YAZ-2631 S38)', async () => {
    const { props, el } = await mount()
    // A folder row drags too since YAZ-3251 D5: to move on disk, never to reorder.
    expect([dirRow(el)?.draggable, fileRow(el)?.draggable]).toEqual([true, true])
    fire(fileRow(el), 'dragstart')
    fire(dirRow(el), 'dragover')
    expect(dirRow(el)?.classList.contains('tree__row--drop')).toBe(true)
    expect(el.querySelector('.tree__row--drop-before, .tree__row--drop-after')).toBeNull()
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledWith('/v/a.md', '/v/sub/a.md', 'file')
    expect(el.querySelector('.tree__row--drop')).toBeNull() // drag state cleared
  })

  it('dropping on the ROOT HEADER targets the vault root — a no-op for a file already there; an abandoned drag ends cleanly at the first move with no button down (the OS drag sends no dragend)', async () => {
    const { props, el } = await mount()
    const header = el.querySelector<HTMLElement>('.sidebar__header')
    fire(fileRow(el), 'dragstart')
    fire(header, 'dragover')
    expect(header?.classList.contains('sidebar__header--drop')).toBe(true)
    fire(header, 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // `/v/a.md` already lives at the root
    fire(fileRow(el), 'dragstart')
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { buttons: 0 })))
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // an abandoned drag drops nothing
    expect(props.onDraggedOut).not.toHaveBeenCalled() // it never left the window
  })
})

/**
 * The tree drag (YAZ-3251): a folder drags, a selection drags as one (D5), a file row takes the
 * drop for its folder (D7), a closed folder springs open (D8), and a hover renders nothing (D2).
 */
describe('the tree drag: folders, the selection, file-row drops, spring open (YAZ-3251)', () => {
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  /** `Docs` holds `Inner` (open) and a note; `Plans` is open; `Closed` is closed; two notes at the top. */
  const DRAG_TREE: TreeNode[] = [
    { type: 'dir', name: 'Docs', path: '/v/Docs', children: [{ type: 'dir', name: 'Inner', path: '/v/Docs/Inner', children: [file('/v/Docs/Inner/deep.md')] }, file('/v/Docs/n.md')] },
    { type: 'dir', name: 'Plans', path: '/v/Plans', children: [file('/v/Plans/p.md')] },
    { type: 'dir', name: 'Closed', path: '/v/Closed', children: [file('/v/Closed/c.md')] },
    file('/v/a.md'),
    file('/v/b.md'),
  ]
  const mountDrag = async () => {
    vi.spyOn(storage, 'getExpanded').mockReturnValue(['/v/Docs', '/v/Docs/Inner', '/v/Plans'])
    return mount({}, (bridge) => bridge.tree.mockResolvedValue({ root: '/v', tree: DRAG_TREE, generatedAt: 1 }))
  }
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  /** A synthetic drag event (jsdom has no DragEvent, and the handlers guard `dataTransfer`); answers whether a handler took it. */
  const fire = (target: Element | null | undefined, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    act(() => void target?.dispatchEvent(event))
    return event.defaultPrevented
  }
  const shiftClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const lit = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row--drop, .sidebar__header--drop')].map((node) => node.dataset.path ?? 'header')
  const selected = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((node) => node.dataset.path)

  it('a folder row drags onto a folder: the target lights by its class alone, and one row goes through onRenameFile as a folder (S2)', async () => {
    const { props, el } = await mountDrag()
    expect(row(el, '/v/Plans')?.draggable).toBe(true)
    fire(row(el, '/v/Plans'), 'dragstart')
    expect(fire(row(el, '/v/Docs'), 'dragover')).toBe(true)
    expect(lit(el)).toEqual(['/v/Docs'])
    fire(row(el, '/v/Docs'), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/Plans', '/v/Docs/Plans', 'dir')
    expect(props.onMoveEntries).not.toHaveBeenCalled()
    expect(lit(el)).toEqual([])
  })

  it('a selected row takes the whole selection in on-screen order, through onMoveEntries (S3); an unselected row becomes the selection and goes alone (S4)', async () => {
    const { props, el } = await mountDrag()
    for (const path of ['/v/b.md', '/v/Plans', '/v/a.md']) shiftClick(row(el, path))
    fire(row(el, '/v/a.md'), 'dragstart')
    fire(row(el, '/v/Docs'), 'dragover')
    fire(row(el, '/v/Docs'), 'drop')
    expect(props.onMoveEntries).toHaveBeenCalledExactlyOnceWith([
      { oldPath: '/v/Plans', newPath: '/v/Docs/Plans', kind: 'dir' },
      { oldPath: '/v/a.md', newPath: '/v/Docs/a.md', kind: 'file' },
      { oldPath: '/v/b.md', newPath: '/v/Docs/b.md', kind: 'file' },
    ])
    expect(props.onRenameFile).not.toHaveBeenCalled()

    fire(row(el, '/v/Closed'), 'dragstart')
    expect(selected(el)).toEqual(['/v/Closed'])
    fire(row(el, '/v/Docs'), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/Closed', '/v/Docs/Closed', 'dir')
  })

  it('a row inside a dragged folder is left out — the folder carries it (S5); the folder, and every row inside it, take no drop and do not light (S6)', async () => {
    const { props, el } = await mountDrag()
    shiftClick(row(el, '/v/Docs'))
    shiftClick(row(el, '/v/Docs/n.md'))
    for (const target of ['/v/Docs', '/v/Docs/Inner', '/v/Docs/n.md', '/v/Docs/Inner/deep.md']) {
      fire(row(el, '/v/Docs'), 'dragstart')
      expect(fire(row(el, target), 'dragover')).toBe(false)
      expect(lit(el)).toEqual([])
      fire(row(el, target), 'drop')
    }
    expect([props.onRenameFile, props.onMoveEntries].map((door) => vi.mocked(door).mock.calls.length)).toEqual([0, 0])
    fire(row(el, '/v/Docs'), 'dragstart')
    fire(row(el, '/v/Plans'), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/Docs', '/v/Plans/Docs', 'dir')
  })

  it('an item already in the drop folder is no move (S7): alone it asks nothing; beside another, the other goes alone', async () => {
    const { props, el } = await mountDrag()
    fire(row(el, '/v/Docs/n.md'), 'dragstart')
    fire(row(el, '/v/Docs'), 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled()
    shiftClick(row(el, '/v/Docs/n.md'))
    shiftClick(row(el, '/v/a.md'))
    fire(row(el, '/v/a.md'), 'dragstart')
    fire(row(el, '/v/Docs'), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/Docs/a.md', 'file')
    expect(props.onMoveEntries).not.toHaveBeenCalled()
  })

  it('a file row takes the drop for its folder and lights that folder’s row; at the top of a one-vault window it lights the header (S12)', async () => {
    const { props, el } = await mountDrag()
    fire(row(el, '/v/a.md'), 'dragstart')
    expect(fire(row(el, '/v/Plans/p.md'), 'dragover')).toBe(true)
    expect(lit(el)).toEqual(['/v/Plans'])
    fire(row(el, '/v/Plans/p.md'), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/Plans/a.md', 'file')
    expect(lit(el)).toEqual([])

    fire(row(el, '/v/Plans/p.md'), 'dragstart')
    fire(row(el, '/v/b.md'), 'dragover')
    expect(lit(el)).toEqual(['header'])
    fire(row(el, '/v/b.md'), 'drop')
    expect(props.onRenameFile).toHaveBeenLastCalledWith('/v/Plans/p.md', '/v/p.md', 'file')
  })

  it('a drag that holds 700 ms over a closed folder opens it, and it stays open; one that moves away first opens nothing (S13)', async () => {
    const { el } = await mountDrag()
    vi.useFakeTimers()
    try {
      fire(row(el, '/v/a.md'), 'dragstart')
      fire(row(el, '/v/Closed'), 'dragover')
      act(() => void vi.advanceTimersByTime(600))
      fire(row(el, '/v/Closed'), 'dragleave')
      fire(row(el, '/v/Plans'), 'dragover')
      act(() => void vi.advanceTimersByTime(1000))
      expect(row(el, '/v/Closed/c.md')).toBeNull()

      fire(row(el, '/v/Plans'), 'dragleave')
      fire(row(el, '/v/Closed'), 'dragover')
      act(() => void vi.advanceTimersByTime(699))
      expect(row(el, '/v/Closed/c.md')).toBeNull()
      act(() => void vi.advanceTimersByTime(1))
      expect(row(el, '/v/Closed/c.md')).not.toBeNull()
      fire(row(el, '/v/a.md'), 'dragend')
      expect(row(el, '/v/Closed/c.md')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the OS drag of a selection comes back as files, in any order: the same items are this window\u2019s own drag, and they move in on-screen order through onMoveEntries (S3 on the real drop path, audit 10)', async () => {
    const { bridge, props, el } = await mountDrag()
    for (const path of ['/v/b.md', '/v/Plans', '/v/a.md']) shiftClick(row(el, path))
    fire(row(el, '/v/a.md'), 'dragstart')
    expect(bridge.file.dragOut).toHaveBeenLastCalledWith({ paths: ['/v/Plans', '/v/a.md', '/v/b.md'], icon: expect.any(String) })
    const back = ['/v/b.md', '/v/Plans', '/v/a.md']
    bridge.file.pathFor.mockImplementation((file: File) => back.find((path) => path.endsWith(`/${file.name}`)) ?? '')
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: back.map((path) => new File(['x'], path.slice(path.lastIndexOf('/') + 1))), dropEffect: 'none' } })
    act(() => void row(el, '/v/Docs')?.dispatchEvent(drop))
    expect(props.onMoveEntries).toHaveBeenCalledExactlyOnceWith([
      { oldPath: '/v/Plans', newPath: '/v/Docs/Plans', kind: 'dir' },
      { oldPath: '/v/a.md', newPath: '/v/Docs/a.md', kind: 'file' },
      { oldPath: '/v/b.md', newPath: '/v/Docs/b.md', kind: 'file' },
    ])
    expect(bridge.file.import).not.toHaveBeenCalled()
  })

  it('the spring only opens: a closed folder that opened another way while the drag held over it stays open (audit 23)', async () => {
    const { el } = await mountDrag()
    vi.useFakeTimers()
    try {
      fire(row(el, '/v/a.md'), 'dragstart')
      fire(row(el, '/v/Closed'), 'dragover')
      act(() => row(el, '/v/Closed')?.click()) // opened by a click, inside the 700 ms
      expect(row(el, '/v/Closed/c.md')).not.toBeNull()
      act(() => void vi.advanceTimersByTime(700))
      expect(row(el, '/v/Closed/c.md')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a hover over many rows renders no row of any tree level (S14, D2)', async () => {
    const { el } = await mountDrag()
    fire(row(el, '/v/a.md'), 'dragstart')
    labelRenders.names = []
    for (const target of ['/v/Docs', '/v/Docs/Inner', '/v/Docs/Inner/deep.md', '/v/Docs/n.md', '/v/Plans', '/v/Plans/p.md', '/v/b.md', '/v/Docs', '/v/Plans']) {
      fire(row(el, target), 'dragover')
      fire(row(el, target), 'dragleave')
    }
    fire(row(el, '/v/Plans'), 'dragover')
    expect(lit(el)).toEqual(['/v/Plans'])
    expect(labelRenders.names).toEqual([])
  })
})

/**
 * Drags between Finder and the sidebar (YAZ-3252): Finder's items move in (YAZ-3253 D3, D9A), and a
 * row drag is the OS drag out (YAZ-3254 D4), which comes back as files when it drops inside.
 */
describe('drags between Finder and the sidebar (YAZ-3253, YAZ-3254)', () => {
  const dirRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--dir')
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  /** A drag event; with `files`, one from the OS (`types` holds `Files`). Answers whether a handler took it. */
  const fire = (target: EventTarget | null | undefined, type: string, files?: File[]) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    if (files !== undefined) Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } })
    act(() => void target?.dispatchEvent(event))
    return event.defaultPrevented
  }
  /** The pointer moves; `buttons` 0 once the OS drag is over. */
  const move = (buttons: number) => act(() => void window.dispatchEvent(new MouseEvent('mousemove', { buttons })))
  const finder = (...names: string[]) => names.map((name) => new File(['x'], name))
  /** Files whose paths are the vault's own: what the OS drag of this window's rows, or of a second window's, drops. */
  const own = (bridge: ReturnType<typeof installBridge>, ...paths: string[]) => {
    bridge.file.pathFor.mockImplementation((file: File) => paths.find((path) => path.endsWith(`/${file.name}`)) ?? '')
    return paths.map((path) => new File(['x'], path.slice(path.lastIndexOf('/') + 1)))
  }

  it('Finder items dropped on a folder row go to fs:import; the folder opens, the tree reads again, and one toast says what moved (S17, S18)', async () => {
    const { bridge, props, el } = await mount()
    bridge.file.import.mockResolvedValueOnce({
      moved: [{ from: '/Users/yasin/Downloads/Plan.md', to: '/v/sub/Plan.md', kind: 'file' }, { from: '/Users/yasin/Downloads/Trip', to: '/v/sub/Trip', kind: 'dir' }],
      copied: [],
      failed: [],
    })
    expect(fire(dirRow(el), 'dragover', [])).toBe(true)
    expect(dirRow(el)?.classList.contains('tree__row--drop')).toBe(true)
    const reads = bridge.tree.mock.calls.length
    fire(dirRow(el), 'drop', finder('Plan.md', 'Trip'))
    await act(async () => {})
    expect(bridge.file.import).toHaveBeenCalledExactlyOnceWith({ paths: ['/Users/yasin/Downloads/Plan.md', '/Users/yasin/Downloads/Trip'], targetDir: '/v/sub' })
    expect(props.onRenameFile).not.toHaveBeenCalled()
    expect(bridge.tree.mock.calls.length).toBeGreaterThan(reads)
    // A move gesture for the undo list (YAZ-3255 S40): App records it and says the toast with Undo.
    expect(props.onMoved).toHaveBeenLastCalledWith(
      { moves: [{ oldPath: '/Users/yasin/Downloads/Plan.md', newPath: '/v/sub/Plan.md', kind: 'file' }, { oldPath: '/Users/yasin/Downloads/Trip', newPath: '/v/sub/Trip', kind: 'dir' }], cleared: [] },
      'Moved 1 folder and 1 file (Plan.md, Trip) from Finder',
      false,
    )
    expect(el.querySelector('.tree__row--drop')).toBeNull()

    // From another disk: some copied (S18). On a file row: its folder (D7) — here the vault root.
    bridge.file.import.mockResolvedValueOnce({
      moved: [{ from: '/Users/yasin/Downloads/Plan.md', to: '/v/Plan.md', kind: 'file' }],
      copied: [{ from: '/Volumes/USB/Trip', to: '/v/Trip', kind: 'dir' }, { from: '/Volumes/USB/Log.md', to: '/v/Log.md', kind: 'file' }],
      failed: [],
    })
    expect(fire(fileRow(el), 'dragover', [])).toBe(true)
    fire(fileRow(el), 'drop', finder('Plan.md'))
    await act(async () => {})
    expect(bridge.file.import).toHaveBeenLastCalledWith({ paths: ['/Users/yasin/Downloads/Plan.md'], targetDir: '/v' })
    // Copies are not moves (S18): only the moved item is for undo.
    expect(props.onMoved).toHaveBeenLastCalledWith({ moves: [{ oldPath: '/Users/yasin/Downloads/Plan.md', newPath: '/v/Plan.md', kind: 'file' }], cleared: [] }, 'Moved 1 file (Plan.md), copied 1 folder and 1 file (Trip, Log.md) from another disk', false)
  })

  it('a clash is named and the rest moved (S19); items of another open vault say the cut-and-paste rule (S22)', async () => {
    const { bridge, props, el } = await mount()
    bridge.file.import.mockResolvedValueOnce({
      moved: [{ from: '/Users/yasin/Downloads/Plan.md', to: '/v/sub/Plan.md', kind: 'file' }],
      copied: [],
      failed: [{ from: '/Users/yasin/Downloads/a.md', code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }],
    })
    fire(dirRow(el), 'drop', finder('Plan.md', 'a.md'))
    await act(async () => {})
    expect(props.onMoved).toHaveBeenLastCalledWith(expect.objectContaining({ cleared: [] }), 'Moved 1 file (Plan.md) from Finder, skipped 1: a.md — a file with this name already exists', true)
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [{ from: '/w/x.md', code: 'BAD_REQUEST', message: 'To move between vaults, use cut and paste' }] })
    fire(dirRow(el), 'drop', finder('x.md'))
    await act(async () => {})
    expect(props.onNotice).toHaveBeenLastCalledWith('To move between vaults, use cut and paste', 'info')
  })

  it("items of this vault dropped from a second window move through App's door, so links follow (S23)", async () => {
    const { bridge, props, el } = await mount()
    fire(dirRow(el), 'drop', own(bridge, '/v/a.md'))
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/sub/a.md', 'file')
    expect(bridge.file.import).not.toHaveBeenCalled()
  })

  it('a Finder drop that copies in from another disk plays ONE land sound here; one that moves leaves the sound to App (onMoved); nothing landed or a refused drop plays none (YAZ-3267 D15, S54, S56)', async () => {
    const { bridge, props, el } = await mount()
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [{ from: '/Volumes/USB/Trip', to: '/v/sub/Trip', kind: 'dir' }, { from: '/Volumes/USB/Log.md', to: '/v/sub/Log.md', kind: 'file' }], failed: [] })
    fire(dirRow(el), 'drop', finder('Trip', 'Log.md'))
    await act(async () => {})
    expect(bridge.app.sound.mock.calls).toEqual([['land']])
    bridge.file.import.mockResolvedValueOnce({ moved: [{ from: '/Users/yasin/Downloads/Plan.md', to: '/v/sub/Plan.md', kind: 'file' }], copied: [{ from: '/Volumes/USB/Log.md', to: '/v/sub/Log.md', kind: 'file' }], failed: [] })
    fire(dirRow(el), 'drop', finder('Plan.md', 'Log.md'))
    await act(async () => {})
    expect(props.onMoved).toHaveBeenCalledTimes(1)
    expect(bridge.app.sound).toHaveBeenCalledTimes(1)
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [{ from: '/Users/yasin/Downloads/a.md', code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }] })
    fire(dirRow(el), 'drop', finder('a.md'))
    await act(async () => {})
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [{ from: '/w/x.md', code: 'BAD_REQUEST', message: 'To move between vaults, use cut and paste' }] })
    fire(dirRow(el), 'drop', finder('x.md'))
    await act(async () => {})
    bridge.file.import.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'disk gone' })
    fire(dirRow(el), 'drop', finder('Plan.md'))
    await act(async () => {})
    expect(bridge.app.sound).toHaveBeenCalledTimes(1)
  })

  it('Finder items dropped on the root header of a one-vault window go to its root (audit 10)', async () => {
    const { bridge, el } = await mount()
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [] })
    const header = el.querySelector('.sidebar__header')
    expect(fire(header, 'dragover', [])).toBe(true)
    fire(header, 'drop', finder('Plan.md'))
    await act(async () => {})
    expect(bridge.file.import).toHaveBeenCalledExactlyOnceWith({ paths: ['/Users/yasin/Downloads/Plan.md'], targetDir: '/v' })
  })

  it('the blank space below the rows takes a drop for the vault root, and the header lights: Finder items and rows alike (D12, S43)', async () => {
    const { bridge, props, el } = await mount()
    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [] })
    const blank = el.querySelector('.sidebar__body')
    expect(fire(blank, 'dragover', [])).toBe(true)
    expect(el.querySelector('.sidebar__header')?.classList.contains('sidebar__header--drop')).toBe(true)
    fire(blank, 'drop', finder('Plan.md'))
    await act(async () => {})
    expect(bridge.file.import).toHaveBeenCalledExactlyOnceWith({ paths: ['/Users/yasin/Downloads/Plan.md'], targetDir: '/v' })
    expect(el.querySelector('.sidebar__header--drop')).toBeNull()
    // A row of this vault, from a folder, lands at the top level through the rename door.
    fire(blank, 'drop', own(bridge, '/v/sub/b.md'))
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/sub/b.md', '/v/b.md', 'file')
  })

  it('a row that refuses a drop keeps it refused: the blank space under it does not take it (D12)', async () => {
    const { el } = await mount()
    fire(dirRow(el), 'dragstart')
    // A folder dragged over itself: its row refuses, and the event reaches the blank space below.
    expect(fire(dirRow(el), 'dragover')).toBe(false)
    expect(el.querySelector('.sidebar__header--drop')).toBeNull()
  })

  it('a hidden item is skipped with no notice, from Finder and from this vault alike (S20, audit 19)', async () => {
    const { bridge, props, el } = await mount()
    fire(dirRow(el), 'drop', own(bridge, '/v/a.md', '/v/.hidden.md'))
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/sub/a.md', 'file')
    fire(dirRow(el), 'drop', own(bridge, '/v/.hidden.md'))
    fire(dirRow(el), 'drop', finder('.DS_Store'))
    await act(async () => {})
    expect(props.onRenameFile).toHaveBeenCalledOnce()
    expect(props.onMoveEntries).not.toHaveBeenCalled()
    expect(bridge.file.import).not.toHaveBeenCalled()
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a row drag is the OS drag: dragstart is taken and dragOut gets the drag set and a pill; dropped back on a folder it moves in the app, and no box asks (D4, S30)', async () => {
    const { bridge, props, el } = await mount()
    expect(fire(fileRow(el), 'dragstart')).toBe(true)
    expect(bridge.file.dragOut).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md'], icon: expect.stringMatching(/^data:image\/png;base64,/) })
    // The OS drag comes back as files: the same paths are this window's own drag.
    expect(fire(dirRow(el), 'dragover', [])).toBe(true)
    fire(dirRow(el), 'drop', own(bridge, '/v/a.md'))
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/sub/a.md', 'file')
    expect(bridge.file.import).not.toHaveBeenCalled()
    move(0)
    expect(props.onDraggedOut).not.toHaveBeenCalled()
  })

  it('a drag that LEFT the window asks once, at the first move with no button down (S26, S29); one that ends over the window asks nothing, though no target took it (S30); a quick flick that never starts the OS drag asks nothing (audit 4, 13)', async () => {
    const { props, el } = await mount()
    /** The OS drag over the window: Chromium fires `dragenter` and `dragover`; it left the window when a `dragleave` has no `relatedTarget`. */
    const over = () => fire(document.body, 'dragover', [])
    const leave = (relatedTarget: EventTarget | null = null) => act(() => void document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget })))
    fire(fileRow(el), 'dragstart')
    over()
    leave()
    move(1) // the button is still down: the OS drag has not taken over yet
    expect(props.onDraggedOut).not.toHaveBeenCalled()
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledOnce()

    // Out and back in, then it ends over the editor or the tab bar: no target took it, no `drop` came, and nothing asks.
    fire(fileRow(el), 'dragstart')
    leave()
    fire(document.body, 'dragenter', [])
    over()
    leave(dirRow(el)) // a move from one element to another inside the window
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledOnce()
    // The button came up before the OS drag began: no drag event at all, and nothing asks.
    fire(fileRow(el), 'dragstart')
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledOnce()
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('a drag out that another window of the app took (main pushes `file:drag-landed`) asks nothing; a push of another drag changes nothing (YAZ-3263)', async () => {
    const { bridge, props, el } = await mount()
    const landed = (paths: string[]) => act(() => (bridge.file.onDragLanded.mock.calls.at(-1)?.[0] as (ev: { paths: string[] }) => void)({ paths }))
    const leave = () => act(() => void document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null })))
    fire(fileRow(el), 'dragstart')
    leave()
    landed(['/v/a.md'])
    move(0)
    expect(props.onDraggedOut).not.toHaveBeenCalled()
    // The next drag starts clean, and a push of other paths is not its own.
    fire(fileRow(el), 'dragstart')
    leave()
    landed(['/v/sub'])
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })
  it('main\'s `file:drag-ended` at the release ends the drag: a drag that left asks at once, with the pointer still over Finder; the later move asks nothing more (YAZ-3294 D24, S80)', async () => {
    const { bridge, props, el } = await mount()
    const ended = (paths: string[]) => act(() => (bridge.file.onDragEnded.mock.calls.at(-1)?.[0] as (ev: { paths: string[] }) => void)({ paths }))
    const leave = () => act(() => void document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null })))
    fire(fileRow(el), 'dragstart')
    leave()
    ended(['/v/a.md'])
    expect(props.onDraggedOut).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledOnce()
    // A push of other paths is not this drag's end: the pointer's return still ends it (S82's fallback).
    fire(fileRow(el), 'dragstart')
    leave()
    ended(['/v/sub'])
    expect(props.onDraggedOut).toHaveBeenCalledOnce()
    move(0)
    expect(props.onDraggedOut).toHaveBeenCalledTimes(2)
    // The move first, then the push: one end per drag, and the push is ignored.
    fire(fileRow(el), 'dragstart')
    leave()
    move(0)
    ended(['/v/a.md'])
    expect(props.onDraggedOut).toHaveBeenCalledTimes(3)
  })

  it('a push of the release after a drop back inside the window asks nothing (YAZ-3294 S81)', async () => {
    const { bridge, props, el } = await mount()
    const ended = (paths: string[]) => act(() => (bridge.file.onDragEnded.mock.calls.at(-1)?.[0] as (ev: { paths: string[] }) => void)({ paths }))
    const leave = () => act(() => void document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null })))
    fire(fileRow(el), 'dragstart')
    leave()
    expect(fire(dirRow(el), 'dragover', [])).toBe(true)
    fire(dirRow(el), 'drop', own(bridge, '/v/a.md'))
    ended(['/v/a.md'])
    move(0)
    expect(props.onDraggedOut).not.toHaveBeenCalled()
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/a.md', '/v/sub/a.md', 'file')
  })
})

describe('Sidebar tree refresh is coalesced (YAZ-2191)', () => {
  const withWatcher = () => {
    const listeners: ((ev: WatchEvent) => void)[] = []
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        listeners.push(l)
        return () => void listeners.splice(listeners.indexOf(l), 1)
      },
    }
    return { watch, fire: (ev: WatchEvent) => [...listeners].forEach((l) => l(ev)) }
  }
  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

  it('a lone structural event reads the tree at once, and nothing follows it (YAZ-2240)', async () => {
    const { watch, fire } = withWatcher()
    const { bridge } = await mount({ watch })
    const before = bridge.tree.mock.calls.length
    act(() => fire({ type: 'add', path: '/v/new.md', mtime: 1 }))
    expect(bridge.tree.mock.calls.length).toBe(before + 1)
    await wait(150)
    expect(bridge.tree.mock.calls.length).toBe(before + 1)
  })

  it('a burst of structural events is one read at once and ONE more, 100 ms after the last of them (YAZ-2240)', async () => {
    const { watch, fire } = withWatcher()
    const { bridge } = await mount({ watch })
    const before = bridge.tree.mock.calls.length
    // A fake clock (YAZ-3430): real 60 ms waits raced the real 100 ms quiet window, and a slow CI runner let it end first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => {
        for (let i = 0; i < 50; i++) fire({ type: 'add', path: `/v/pulled-${i}.md`, mtime: 1 })
      })
      expect(bridge.tree.mock.calls.length).toBe(before + 1) // the leading read
      await act(() => vi.advanceTimersByTimeAsync(60))
      act(() => fire({ type: 'unlinkDir', path: '/v/sub' }))
      await act(() => vi.advanceTimersByTimeAsync(99))
      expect(bridge.tree.mock.calls.length).toBe(before + 1) // still inside the quiet window
      await act(() => vi.advanceTimersByTimeAsync(1))
      expect(bridge.tree.mock.calls.length).toBe(before + 2) // the trailing read, 100 ms after the last event
    } finally {
      vi.useRealTimers()
    }
  })

  it('YAZ-3227 D2: under Last updated a `change` moves the saved note to the top with no read; turning it on reads the vault once', async () => {
    const { watch, fire } = withWatcher()
    const notes = [{ type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' }, { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 5, kind: 'markdown' }] as TreeNode[]
    const { el, bridge, rerender } = await mount({ watch }, (b) => b.tree.mockResolvedValue({ root: '/v', tree: notes, generatedAt: 1 } as never))
    const labels = () => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((n) => n.textContent)
    expect(labels()).toEqual(['a', 'b']) // Name, A to Z
    const before = bridge.tree.mock.calls.length
    await rerender({ settings: { ...DEFAULT_SETTINGS, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, files: { by: 'updated', reverse: false } } } })
    expect(bridge.tree.mock.calls.length).toBe(before + 1) // the one walk that makes the times fresh
    expect(labels()).toEqual(['b', 'a'])
    act(() => fire({ type: 'change', path: '/v/a.md', mtime: 9 }))
    await wait(150)
    expect(labels()).toEqual(['a', 'b'])
    expect(bridge.tree.mock.calls.length).toBe(before + 1) // a save walks nothing
  })

  it('`ready` refreshes at once, and a `change` never refreshes', async () => {
    const { watch, fire } = withWatcher()
    const { bridge } = await mount({ watch })
    const before = bridge.tree.mock.calls.length
    act(() => fire({ type: 'change', path: '/v/a.md', mtime: 2 }))
    await wait(150)
    expect(bridge.tree.mock.calls.length).toBe(before)
    act(() => fire({ type: 'ready', root: '/v' }))
    expect(bridge.tree.mock.calls.length).toBe(before + 1)
  })

  it('shows the tree another consumer of the window fetched (the one feed)', async () => {
    const { bridge, el } = await mount()
    const { fetchTree } = await import('../lib/treeFeed')
    bridge.tree.mockResolvedValue({ root: '/v', tree: [...TREE, { type: 'file', name: 'fresh.md', path: '/v/fresh.md', size: 1, mtime: 1, kind: 'markdown' }], generatedAt: 9 })
    await act(async () => void (await fetchTree('/v')))
    expect([...el.querySelectorAll('.tree__label')].map((l) => l.textContent)).toContain('fresh')
  })
})

describe('Sidebar stale tab activation (I3, GRO-2235)', () => {
  it('activating a file the tree does not show probes a FRESH tree and fires onFileMissing when it is really gone', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: '/v/a.md' })
    bridge.tree.mockClear()
    await rerender({ activeFile: '/v/gone.md' })
    expect(bridge.tree).toHaveBeenCalledWith('/v') // the confirmation probe
    expect(props.onFileMissing).toHaveBeenCalledTimes(1)
  })

  it('a just-created file missing from the CACHED tree but present in the fresh one stays open (the inline-create race)', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: '/v/a.md' })
    const created: TreeNode = { type: 'file', name: 'new.md', path: '/v/new.md', size: 1, mtime: 2, kind: 'markdown' }
    bridge.tree.mockImplementation(async (r: string) => ({ root: r, tree: [...TREE, created], generatedAt: 2 }))
    await rerender({ activeFile: '/v/new.md' })
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })

  it('a FOLDER tab survives both checks while the tree holds the folder, and closes once it has left it (YAZ-2290 D3)', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: '/v/sub' }) // the first tree validates the restored tab
    bridge.tree.mockClear()
    await rerender({ activeFile: '/v/a.md' })
    await rerender({ activeFile: '/v/sub' }) // in the cached tree: no probe
    expect(bridge.tree).not.toHaveBeenCalled()
    expect(props.onFileMissing).not.toHaveBeenCalled()
    await rerender({ activeFile: '/v/gone' })
    expect(props.onFileMissing).toHaveBeenCalledTimes(1)
  })

  it('activating a file the cached tree shows probes nothing; out-of-root activations are skipped', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: null })
    bridge.tree.mockClear()
    await rerender({ activeFile: '/v/a.md' }) // in the cached tree: no probe
    await rerender({ activeFile: '/elsewhere/pasted.md' }) // outside the root: never in the tree, never probed
    expect(bridge.tree).not.toHaveBeenCalled()
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })

  it('a file deleted WHILE active stays open: a tree refresh without an activation change never re-validates', async () => {
    // Boot on a: the first tree validates it. Then a is deleted on disk mid-edit — the
    // watcher-driven refresh delivers a tree WITHOUT it, but the boot validation is spent and
    // no activation changed, so nothing fires (the file is recreated by the next save).
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { bridge, props } = await mount({ activeFile: '/v/a.md', watch })
    bridge.tree.mockImplementation(async (r: string) => ({ root: r, tree: TREE.filter((n) => n.path !== '/v/a.md'), generatedAt: 3 }))
    await act(async () => emit?.({ type: 'unlink', path: '/v/a.md' }))
    await afterQuiet()
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })
})

describe('Show in sidebar — Files reveal (YAZ-1063)', () => {
  const TARGET = '/v/target/deep/Note.md'
  const DEEP_TREE: TreeNode[] = [
    {
      type: 'dir', name: 'other', path: '/v/other',
      children: [{ type: 'file', name: 'Keep.md', path: '/v/other/Keep.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    {
      type: 'dir', name: 'target', path: '/v/target',
      children: [{
        type: 'dir', name: 'deep', path: '/v/target/deep',
        children: [{ type: 'file', name: 'Note.md', path: TARGET, size: 1, mtime: 1, kind: 'markdown' }],
      }],
    },
  ]
  const withDeepTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: DEEP_TREE, generatedAt: 1 })
  const dirRow = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')].find((row) => row.querySelector('.tree__label')?.textContent === label)

  it('waits for the initial tree snapshot, then opens only the missing ancestor chain and exposes an exact-path row', async () => {
    const { el, props } = await mount({ revealRequest: { id: 1, path: TARGET } }, withDeepTree)
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(dirRow(el, 'target')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'deep')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector(`[data-path="${TARGET}"]`)?.classList.contains('tree__row--revealed')).toBe(true)
  })

  it('preserves unrelated expansion when a later request opens the target chain', async () => {
    const { el, rerender } = await mount({}, withDeepTree)
    act(() => dirRow(el, 'other')?.click())
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    await rerender({ revealRequest: { id: 1, path: TARGET } })
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'target')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'deep')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('reports one passive notice when the loaded Files tree cannot show the path (YAZ-2638 S32, S37: "Show in sidebar" on a row asks through this door)', async () => {
    const { props } = await mount({ revealRequest: { id: 1, path: '/v/Missing.md' } }, withDeepTree)
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "Missing" in Files — it is no longer there', 'error')
  })
})

/**
 * A launch shows the restored tab but does not open its folders (YAZ-1642, D2). Only the file the
 * Sidebar MOUNTS with is exempt; every later `activeFile` reveals exactly as before. Fresh vault per
 * mount (the expand-all idiom below): the app-state cache is module-level.
 */
describe('launch: the restored tab is shown, not revealed (YAZ-1642)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 1, mtime: 1, kind: 'markdown' })
  const DEEP = (v: string): TreeNode[] => [
    { type: 'dir', name: 'other', path: `${v}/other`, children: [note(`${v}/other/Keep.md`)] },
    { type: 'dir', name: 'target', path: `${v}/target`, children: [{ type: 'dir', name: 'deep', path: `${v}/target/deep`, children: [note(`${v}/target/deep/Note.md`)] }] },
  ]
  let vaults = 0
  const mountVault = async (activeFile: (v: string) => string) => {
    const v = `/v-launch-${++vaults}`
    const m = await mount({ root: v, activeFile: activeFile(v) }, (b) => b.tree.mockResolvedValue({ root: v, tree: DEEP(v), generatedAt: 1 } as never))
    return { ...m, v }
  }
  const isOpen = (el: HTMLElement, path: string) => el.querySelector(`.tree__row[data-path="${path}"]`)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')

  it('mounting with an active file leaves its ancestors closed', async () => {
    const { el, v } = await mountVault((v) => `${v}/target/deep/Note.md`)
    expect(isOpen(el, `${v}/target`)).toBe('false')
    expect(el.querySelector(`[data-path="${v}/target/deep/Note.md"]`)).toBeNull()
  })

  it('a file opened after the mount still opens its ancestors', async () => {
    const { el, v, rerender } = await mountVault((v) => `${v}/other/Keep.md`)
    expect(isOpen(el, `${v}/other`)).toBe('false')
    await rerender({ activeFile: `${v}/target/deep/Note.md` })
    expect(isOpen(el, `${v}/target`)).toBe('true')
    expect(isOpen(el, `${v}/target/deep`)).toBe('true')
    expect(isOpen(el, `${v}/other`)).toBe('false')
  })

  it('coming back to the restored tab after another file reveals it too', async () => {
    const { el, v, rerender } = await mountVault((v) => `${v}/target/deep/Note.md`)
    await rerender({ activeFile: `${v}/other/Keep.md` })
    expect(isOpen(el, `${v}/other`)).toBe('true')
    await rerender({ activeFile: `${v}/target/deep/Note.md` })
    expect(isOpen(el, `${v}/target`)).toBe('true')
    expect(isOpen(el, `${v}/target/deep`)).toBe('true')
  })
})

/**
 * The context menu's per-item TARGET matrix (GRO-2296). Each menu item resolves its own
 * target; no item derives its visibility from another item's value. These assertions are the
 * guard rail for GRO-2297 (blank-space Copy path → the vault ROOT), GRO-2302 (Reveal in
 * Finder) and GRO-2285 (Delete), all of which add items to this same menu: the blank-space
 * row below is what stops a root fallback for Copy path from silently switching on Rename
 * for the vault root, which main refuses outright (BAD_REQUEST, GRO-2241).
 */
describe('context menu target matrix (GRO-2296)', () => {
  const open = async (selector: string) => {
    const { el } = await mount()
    act(() => void el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return el
  }

  it('a FILE row targets every item: rename, copy path, open in new window', async () => {
    const el = await open('.tree__row--file')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(subItemByLabel(el, 'New window')).toBeDefined()
  })

  it('a FOLDER row targets rename and copy path; the file-only items stay hidden', async () => {
    const el = await open('.tree__row--dir')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
  })

  it('BLANK SPACE shows no Rename — the vault root is never renameable (the GRO-2297 guard rail)', async () => {
    const el = await open('.sidebar__body')
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    // The create actions are always available on blank space (they target the root).
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(itemByLabel(el, 'New folder')).toBeDefined()
  })

  it('Rename on a FOLDER row opens the inline input in DIRECTORY mode (raw name, no extension logic)', async () => {
    const el = await open('.tree__row--dir')
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('sub')
  })

  it('Rename on a FILE row opens the inline input in FILE mode (extension stripped)', async () => {
    const el = await open('.tree__row--file')
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('a')
  })
})

/**
 * Blank-space "Copy path" (GRO-2273): right-clicking below the tree copies the VAULT ROOT's
 * absolute path — the blank area already means "the root" everywhere else in this menu
 * (`targetDirFor` sends "New note" there). VS Code's empty-Explorer menu behaves the same.
 * Copy path only: Copy Relative Path was declined (LOCKED, GRO-2273).
 */
describe('blank-space copy path (GRO-2273)', () => {
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('copies the vault ROOT path, with no trailing slash, and closes the menu', async () => {
    const writeText = installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('/v')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('still offers no Rename on blank space — the root fallback must not leak into it', async () => {
    installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
  })

  it('file and folder rows still copy their OWN path, not the root', async () => {
    const writeText = installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledWith('/v/a.md')
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledWith('/v/sub')
  })
})

/**
 * Delete (GRO-2272 `C1-`/`C3-`): the menu entry, the confirm sheet, and what actually reaches
 * App. The blank-space case is the one that matters most — a destructive item must never
 * appear with no target, and main refuses the vault root anyway.
 */
describe('delete (GRO-2272)', () => {
  const openOn = async (selector: string, over: Partial<SidebarProps> = {}) => {
    // A second mount in one test unmounts the first: a panel left mounted keeps its window listeners for the tests after it.
    act(() => root?.unmount())
    container?.remove()
    const m = await mount(over)
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const sheet = (el: HTMLElement) => el.querySelector('.confirm')
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('file and folder rows offer Delete; BLANK SPACE does not', async () => {
    const f = await openOn('.tree__row--file')
    expect(itemByLabel(f.el, 'Delete')).toBeDefined()
    const d = await openOn('.tree__row--dir')
    expect(itemByLabel(d.el, 'Delete')).toBeDefined()
    const b = await openOn('.sidebar__body')
    expect(itemByLabel(b.el, 'Delete')).toBeUndefined()
  })

  it('E: the confirm sheet names the note by its title (YAZ-2420 D14)', async () => {
    const indexSource = createWikilinkResolveSource()
    indexSource.update(() => null, [{ ...indexRecord('/v/a.md'), title: 'UP-001 - Abdul' }])
    const { el } = await openOn('.tree__row--file', { indexSource })
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)?.querySelector('.confirm__text')?.textContent).toBe('Delete "UP-001 - Abdul"? It moves to the Trash.')
  })

  it('clicking Delete opens the confirm sheet and deletes NOTHING yet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)).not.toBeNull()
    expect(props.onDeleteEntries).not.toHaveBeenCalled()
  })

  it('confirming calls onDeleteEntries with the absolute path', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })

  it('cancelling calls nothing and closes the sheet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(props.onDeleteEntries).not.toHaveBeenCalled()
    expect(sheet(el)).toBeNull()
  })

  it('a FOLDER target shows the sheet and deletes the folder path', async () => {
    const { el, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)?.textContent).toContain('"sub"')
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/sub'])
  })

  it('"Don\'t ask me again" persists confirmDelete: false through onChangeSettings', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    act(() => void el.querySelector<HTMLInputElement>('.confirm__ask input')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onChangeSettings).toHaveBeenCalledWith(expect.objectContaining({ confirmDelete: false }))
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })

  it('confirmDelete: false deletes DIRECTLY — no sheet at all (YAZ-857: the setting finally gates)', async () => {
    const { el, props } = await openOn('.tree__row--file', { settings: { ...DEFAULT_SETTINGS, confirmDelete: false } })
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)).toBeNull()
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })

  it('shows the backlink count when notes link to the target', async () => {
    // One note whose body link resolves to a.md — the shared resolver is what countLinkReferences uses.
    // The TARGET must be in the record set too: the shared resolver resolves a link NAME
    // against the indexed records, so without a.md there is nothing for [[a]] to point at.
    // `basename` (no extension) and `folder` are what the shared resolver matches on — a
    // record missing them resolves nothing, which is how the first draft of this test passed
    // vacuously against an empty count.
    const rec = (base: string, links: string[] = []) => ({
      path: `/v/${base}.md`, name: `${base}.md`, basename: base, title: base, folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links, embeds: [],
    })
    const records = [rec('a'), rec('hub', ['a'])]
    const m = await mount()
    m.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true } as never)
    act(() => void m.el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(m.el)?.textContent).toContain('1 note links to this')
  })

  it('a FOLDER target counts the notes that link to the folder, and a folder whose settings name it (YAZ-2290 D10)', async () => {
    const rec = (path: string, over: object = {}) => ({
      path, name: path.slice(path.lastIndexOf('/') + 1), basename: 'hub', title: 'hub', folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [] as string[], embeds: [], ...over,
    })
    const folders = [rec('/v/other/.folder.md', { folder: 'other', properties: { folder_settings: { columns: { in: { kind: 'link', target: '[[sub]]' } } } } })]
    const m = await mount()
    m.bridge.index.mockResolvedValue({ root: '/v', records: [rec('/v/hub.md', { links: ['sub'] })], folders, generatedAt: 1, ids: true } as never)
    act(() => void m.el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(m.el)?.textContent).toContain('2 notes link to this')
  })

  it('says nothing about links when nothing links to the target', async () => {
    const { el } = await openOn('.tree__row--file')
    await act(async () => itemByLabel(el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(el)?.textContent).not.toContain('link to this')
    expect(sheet(el)?.textContent).not.toContain('links to this')
  })

  it('an unavailable index still opens the sheet and still deletes — a missing count never blocks', async () => {
    const m = await mount()
    m.bridge.index.mockRejectedValue(new Error('no index'))
    act(() => void m.el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    expect(sheet(m.el)).not.toBeNull()
    await act(async () => sheetBtn(m.el, 'Delete')?.click())
    expect(m.props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })
})

/**
 * ⌘⌫ and the whole selection (YAZ-3272 D20, D21): App's window listener asks the handle's `delete`;
 * the RULES are here — a selection, no open menu, no vault row. The menu's Delete takes the ordered
 * selection when the row is in it, and a row inside a selected folder is left out (the folder carries it).
 */
describe('delete the whole selection with ⌘⌫ and the menu (YAZ-3272)', () => {
  const NESTED: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [{ type: 'file', name: 'inner.md', path: '/v/sub/inner.md', size: 1, mtime: 1, kind: 'markdown' }] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withTree = (bridge: ReturnType<typeof installBridge>) => void bridge.tree.mockResolvedValue({ root: '/v', tree: NESTED, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm .confirm__text')?.textContent ?? null
  const enter = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
  const mountWith = (over: Partial<SidebarProps> = {}) => {
    const clipboardRef: SidebarProps['clipboardRef'] = { current: null }
    return mount({ clipboardRef, ...over }, withTree).then((m) => ({ ...m, clipboardRef }))
  }

  it('S66: one row selected, ⌘⌫ asks about that row; Enter deletes it', async () => {
    const { el, props, clipboardRef } = await mountWith()
    act(() => rowByPath(el, '/v/a.md')?.click())
    let acted = false
    act(() => void (acted = clipboardRef.current?.delete() ?? false))
    expect(acted).toBe(true)
    expect(sheetText(el)).toBe('Delete "a"? It moves to the Trash.')
    expect(props.onDeleteEntries).not.toHaveBeenCalled()
    await act(async () => enter())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md'])
  })

  it('S67: three rows selected, ⌘⌫ asks ONCE for all three, in the panel’s order; Enter hands the list to the one door', async () => {
    const { el, props, clipboardRef } = await mountWith()
    shiftClickRow(rowByPath(el, '/v/c.md'))
    shiftClickRow(rowByPath(el, '/v/sub'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    act(() => void clipboardRef.current?.delete())
    expect(sheetText(el)).toBe('Delete 3 items? They move to the Trash.')
    await act(async () => enter())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/c.md'])
  })

  it('a row inside a selected folder is left out: the folder carries it', async () => {
    const { el, props, clipboardRef } = await mountWith()
    // → opens the folder and ← folds it again at the end: the open folders of `/v` outlive this test.
    const arrow = (key: string) => act(() => void rowByPath(el, '/v/sub')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
    arrow('ArrowRight')
    shiftClickRow(rowByPath(el, '/v/sub'))
    shiftClickRow(rowByPath(el, '/v/sub/inner.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(3)
    act(() => void clipboardRef.current?.delete())
    expect(sheetText(el)).toBe('Delete 2 items? They move to the Trash.')
    await act(async () => enter())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/c.md'])
    arrow('ArrowLeft')
  })

  it('S70: the menu of a selected row of 3 says "Delete 1 folder and 2 files" (YAZ-3293 D23) and takes the selection; a row outside it is deleted alone', async () => {
    const { el, props } = await mountWith()
    shiftClickRow(rowByPath(el, '/v/sub'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
    await act(async () => itemByLabel(el, 'Delete 1 folder and 2 files')?.click())
    expect(sheetText(el)).toBe('Delete 3 items? They move to the Trash.')
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Delete')?.click())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/c.md'])

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Delete')?.click())
    expect(sheetText(el)).toBe('Delete "sub"? 1 note moves to the Trash.')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  })

  it('S71: with "Ask before deleting" off, ⌘⌫ deletes at once — no sheet', async () => {
    const { el, props, clipboardRef } = await mountWith({ settings: { ...DEFAULT_SETTINGS, confirmDelete: false } })
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    act(() => void clipboardRef.current?.delete())
    expect(el.querySelector('.confirm')).toBeNull()
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/c.md'])
  })

  it('S72: nothing selected, or an open context menu: the handle answers false and asks nothing', async () => {
    const { el, props, clipboardRef } = await mountWith()
    expect(clipboardRef.current?.delete()).toBe(false)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(clipboardRef.current?.delete()).toBe(false)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(props.onDeleteEntries).not.toHaveBeenCalled()
  })

  it('the links count of N items is of the notes outside them, each note once', async () => {
    const rec = (base: string, links: string[] = []) => ({
      path: `/v/${base}.md`, name: `${base}.md`, basename: base, title: base, folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links, embeds: [],
    })
    // `hub` links to both items: one note. `c` links to `a`, but `c` goes too: not counted.
    const records = [rec('a'), rec('c', ['a']), rec('hub', ['a', 'c'])]
    const m = await mountWith()
    m.bridge.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true } as never)
    shiftClickRow(rowByPath(m.el, '/v/a.md'))
    shiftClickRow(rowByPath(m.el, '/v/c.md'))
    await act(async () => void m.clipboardRef.current?.delete())
    await act(async () => undefined)
    expect(sheetText(m.el)).toBe('Delete 2 items? They move to the Trash. 1 note links to them.')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  })
})

describe('countChildren (GRO-2272 C3)', () => {
  const TREE_DEEP: TreeNode[] = [
    {
      type: 'dir',
      name: 'Docs',
      path: '/v/Docs',
      children: [
        { type: 'file', name: 'a.md', path: '/v/Docs/a.md', size: 1, mtime: 1, kind: 'markdown' },
        { type: 'dir', name: 'deep', path: '/v/Docs/deep', children: [{ type: 'file', name: 'b.md', path: '/v/Docs/deep/b.md', size: 1, mtime: 1, kind: 'markdown' }] },
      ],
    },
    { type: 'file', name: 'x.md', path: '/v/x.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('counts the WHOLE subtree, not just direct children — a delete takes all of it', () => {
    expect(countChildren(TREE_DEEP, '/v/Docs')).toEqual({ notes: 2, folders: 1 })
  })

  it('counts a nested folder found by descent', () => {
    expect(countChildren(TREE_DEEP, '/v/Docs/deep')).toEqual({ notes: 1, folders: 0 })
  })

  it('an unknown or empty folder counts zero rather than throwing', () => {
    expect(countChildren(TREE_DEEP, '/v/nope')).toEqual({ notes: 0, folders: 0 })
    expect(countChildren([], '/v/Docs')).toEqual({ notes: 0, folders: 0 })
  })
})

/**
 * Reveal in Finder (GRO-2274). Available on every row type AND on blank space, where it
 * targets the vault ROOT — the same target Copy path uses. Reveal-in-parent for all of them
 * (LOCKED, VS Code parity): there is no branching on kind, which is the point.
 */
describe('reveal in Finder (GRO-2274)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }

  it('a FILE row reveals its own path', async () => {
    const { el, bridge } = await openOn('.tree__row--file')
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
  })

  it('a FOLDER row reveals the folder itself — no branching on kind', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub' })
  })

  it('BLANK SPACE reveals the vault root — unlike Delete, which has no blank-space target', async () => {
    const { el, bridge } = await openOn('.sidebar__body')
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v' })
  })

  it('a stale row surfaces a passive notice rather than looking like a dead menu item', async () => {
    const { el, bridge, props } = await openOn('.tree__row--file')
    bridge.shell.reveal.mockRejectedValue(Object.assign(new Error('path does not exist'), { code: 'NOT_FOUND' }))
    await clickSubAsync(el, 'Reveal in Finder')
    await act(async () => undefined)
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('no longer there'), 'error')
  })

  it('E: the stale-row notice names the note by its title (YAZ-2420 D14)', async () => {
    const indexSource = createWikilinkResolveSource()
    indexSource.update(() => null, [{ ...indexRecord('/v/a.md'), title: 'UP-001 - Abdul' }])
    const { el, bridge, props } = await mount({ indexSource })
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    bridge.shell.reveal.mockRejectedValue(Object.assign(new Error('path does not exist'), { code: 'NOT_FOUND' }))
    await clickSubAsync(el, 'Reveal in Finder')
    await act(async () => undefined)
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t reveal "UP-001 - Abdul" — it is no longer there', 'error')
  })

  it('closes the menu after revealing', async () => {
    const { el } = await openOn('.tree__row--file')
    clickSub(el, 'Reveal in Finder')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * Menu ORDER (GRO-2272 `C1a-`, LOCKED): VS Code's Explorer grouping — read-only utilities
 * first, then the create actions, then Rename and Delete LAST. Pinned here because order is a
 * deliberate safety property, not an accident of JSX: Delete used to sit directly under
 * Rename, which is the misclick pair that matters most.
 */
/**
 * The search bar (YAZ-801), on the Search tab only (YAZ-2638 D2) — `searchInput` shows that tab —
 * loading, error and empty vault included. The caret goes to the bar on a request alone: ⌘K or a
 * click on the tab, which App hands down as `pendingSearchFocus` — including at MOUNT, which is the
 * ⌘K-while-collapsed path. Esc and the keycap: the Search tab describe below.
 */
describe('search bar (YAZ-801)', () => {
  it('renders while the tree is still loading', async () => {
    let answer!: () => void
    const { el } = await mount({}, (b) => b.tree.mockImplementation((r: string) => new Promise((resolve) => (answer = () => resolve({ root: r, tree: [], generatedAt: 1 })))))
    expect(el.textContent).toContain('Loading…')
    expect(searchInput(el)).not.toBeNull()
    await act(async () => answer()) // the window's one tree feed must not be left waiting on it (YAZ-2191)
  })

  it('renders when the tree failed to load', async () => {
    const { el } = await mount({}, (b) => b.tree.mockRejectedValue(new Error('nope')))
    expect(el.querySelector('.sidebar__msg--error')).not.toBeNull()
    expect(searchInput(el)).not.toBeNull()
  })

  it('renders in an empty vault', async () => {
    const { el } = await mount({}, (b) => b.tree.mockImplementation(async (r: string) => ({ root: r, tree: [], generatedAt: 1 })))
    expect(el.textContent).toContain('No notes here.')
    expect(searchInput(el)).not.toBeNull()
  })

  it('typing updates the query', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    await type(input, 'meeting')
    expect(input.value).toBe('meeting')
  })

  it('mounting on the Search tab with pendingSearchFocus focuses the input and reports back (⌘K while collapsed, YAZ-2638 S3)', async () => {
    const { el, props } = await mount({ lens: 'search', pendingSearchFocus: true })
    expect(searchBar(el)).not.toBeNull()
    expect(document.activeElement).toBe(searchBar(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('⌘K on a mounted sidebar — the Search tab and pendingSearchFocus false → true, as App hands them — focuses the input and reports back (YAZ-2638 S2)', async () => {
    const { el, props, rerender } = await mount()
    expect(document.activeElement).toBe(document.body)
    await rerender({ lens: 'search', pendingSearchFocus: true })
    expect(searchBar(el)).not.toBeNull()
    expect(document.activeElement).toBe(searchBar(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('a plain mount steals no focus: Files has no bar (YAZ-2638 S6)', async () => {
    const { el, props } = await mount()
    expect(searchBar(el)).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(props.onSearchFocusHandled).not.toHaveBeenCalled()
  })

  it('a mount on the Search tab with no request steals no focus either — the sidebar hidden, then shown again — and neither does a tab handed down with none', async () => {
    const { el, props, rerender } = await mount({ lens: 'search' })
    expect(searchBar(el)).not.toBeNull()
    expect(document.activeElement).toBe(document.body)
    await rerender({ lens: 'files' })
    await rerender({ lens: 'search' })
    expect(document.activeElement).toBe(document.body)
    expect(props.onSearchFocusHandled).not.toHaveBeenCalled()
  })
})

/**
 * Search results in the body (YAZ-803), as a TREE since YAZ-2620 (overturning the flat-list ruling
 * on YAZ-739 for the sidebar): on the Search tab (YAZ-2638 D2) typed text draws the Files tree cut
 * down to the matches and their parent folders, and no text draws no tree. The other tabs' trees
 * are waiting as they were — the swap is a conditional render, so nothing about them is torn down. The search has its
 * own folds, in memory, and its own highlight, driven from the bar, which never loses focus: it
 * starts on the BEST match, ↑/↓ walk the matches on screen and clamp at both ends, Enter opens in
 * place, ⌘Enter in a background tab, and the results stay up either way. The S-numbers are the
 * scenario record on YAZ-2620.
 */
describe('search results as a tree (YAZ-803, YAZ-2620)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /** Three branches and two root notes: a folder no note of which says "archive", two `Readme`s, and `plan` — an exact name the tree draws LAST. */
  const VAULT = (v: string): TreeNode[] => [
    folder(`${v}/Archive`, [folder(`${v}/Archive/Deep`, [note(`${v}/Archive/Deep/Old.md`)]), note(`${v}/Archive/Notes.md`)]),
    folder(`${v}/Docs`, [folder(`${v}/Docs/Guides`, [note(`${v}/Docs/Guides/Anchor guide.md`)]), note(`${v}/Docs/Anchor.md`), note(`${v}/Docs/Readme.md`)]),
    folder(`${v}/Plans`, [note(`${v}/Plans/Plan A.md`), note(`${v}/Plans/Readme.md`), note(`${v}/Plans/Zed.md`)]),
    note(`${v}/Alpha.md`),
    note(`${v}/plan.md`),
  ]
  const notePaths = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? notePaths(n.children) : n.kind === 'markdown' ? [n.path] : []))
  const record = (v: string, path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: path.slice(v.length + 1, Math.max(v.length + 1, path.lastIndexOf('/'))), ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }

  let vaults = 0
  /**
   * A fresh vault per mount — the Files tree's folds persist per root across this file — over an
   * index that holds every note of its tree, then `query` typed into the bar.
   */
  const search = async (query: string, over: Partial<SidebarProps> = {}, opts: { nodes?: (v: string) => TreeNode[]; records?: (v: string) => IndexRecord[]; tweak?: (bridge: ReturnType<typeof installBridge>) => unknown } = {}) => {
    const v = `/v-search-${++vaults}`
    const nodes = (opts.nodes ?? VAULT)(v)
    const records = opts.records?.(v) ?? notePaths(nodes).map((path) => record(v, path))
    // The watcher fans out to every subscriber (useWatch's shape) — here the tree's and search's.
    const listeners: ((ev: WatchEvent) => void)[] = []
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        listeners.push(l)
        return () => void listeners.splice(listeners.indexOf(l), 1)
      },
    }
    const m = await mount({ root: v, watch, ...over }, (b) => {
      b.tree.mockResolvedValue({ root: v, tree: nodes, generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records, folders: [], generatedAt: 1, ids: true } as never)
      return opts.tweak?.(b)
    })
    const input = searchInput(m.el)!
    await type(input, query)
    const emit = (ev: WatchEvent) => act(async () => [...listeners].forEach((l) => l(ev)))
    return { ...m, v, input, nodes, records, emit }
  }
  /** The body's rows as the eye reads them: top to bottom, two spaces per depth. */
  const shape = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.sidebar__body .tree__row')].map((row) => {
      let depth = -1
      for (let list = row.closest('ul.tree'); list !== null; list = list.parentElement?.closest('ul.tree') ?? null) depth++
      return `${'  '.repeat(depth)}${row.querySelector('.tree__label')?.textContent}`
    })
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const isOpen = (el: HTMLElement, path: string) => row(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  /** The highlighted rows' labels: one while a match is on screen, none otherwise. */
  const cursor = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row--selected .tree__label')].map((n) => n.textContent)
  const press = (input: HTMLInputElement, key: string, metaKey = false) =>
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))
  const click = (target: Element | null, init: MouseEventInit = {}) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  const FILES_CLOSED = ['Archive', 'Docs', 'Plans', 'Alpha', 'plan']

  it('S1, S3, S4, S6, S8: the body is the Files tree cut to the matches and their parent folders; no query is no tree, and Files is as it was (YAZ-2638 S7)', async () => {
    const { el, input, v, rerender } = await search('anchor')
    // S1: a match keeps its place, below its parents — open, though nobody opened them in Files.
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide', '  Anchor'])
    expect([isOpen(el, `${v}/Docs`), isOpen(el, `${v}/Docs/Guides`)]).toEqual(['true', 'true'])
    // S3: a matched folder with matches inside opens to THOSE only. S4: a root match has no parent.
    await type(input, 'plan')
    expect(shape(el)).toEqual(['Plans', '  Plan A', 'plan'])
    // S8: two notes of one title, each below its own folder.
    await type(input, 'readme')
    expect(shape(el)).toEqual(['Docs', '  Readme', 'Plans', '  Readme'])
    // S6: spaces are no query, and neither is nothing.
    await type(input, '   ')
    expect(shape(el)).toEqual([])
    await type(input, '')
    expect(shape(el)).toEqual([])
    expect(el.querySelector('.sidebar__body .sidebar__msg')?.textContent).toBe('Type to search every note and folder.')
    await rerender({ lens: 'files' })
    expect(shape(el)).toEqual(FILES_CLOSED)
    expect(el.querySelector('.sidebar__body .sidebar__msg')).toBeNull()
  })

  it('S2, S15, S16: a matched folder with no match inside is closed and opens to ALL it holds; a fold lasts as long as its query', async () => {
    const { el, input, v, props } = await search('archive')
    expect(shape(el)).toEqual(['Archive'])
    expect(isOpen(el, `${v}/Archive`)).toBe('false')
    click(row(el, `${v}/Archive`))
    expect(shape(el)).toEqual(['Archive', '  Deep', '  Notes'])
    click(row(el, `${v}/Archive/Deep`))
    expect(shape(el)).toEqual(['Archive', '  Deep', '    Old', '  Notes'])
    // S15: a second click on the same folder closes it again, and a third reopens it as it was.
    click(row(el, `${v}/Archive`))
    expect(shape(el)).toEqual(['Archive'])
    click(row(el, `${v}/Archive`))
    expect(shape(el)).toEqual(['Archive', '  Deep', '    Old', '  Notes'])
    expect(props.onOpenFile).not.toHaveBeenCalled() // D1: a click on a folder result folds it, it no longer opens its page
    // S16: the text changed, so every fold of the search is forgotten.
    await type(input, 'archiv')
    expect(shape(el)).toEqual(['Archive'])
    // S15 on a parent the search opened: closed by a click, and open again on the next query.
    await type(input, 'anchor')
    click(row(el, `${v}/Docs/Guides`))
    expect(shape(el)).toEqual(['Docs', '  Guides', '  Anchor'])
    await type(input, 'ancho')
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide', '  Anchor'])
  })

  it('S17, S25, R4: a fold in the search never reaches the Files tree or the store; Esc goes back to the tree as it was (YAZ-2638 S12) — unfolded to a result that was opened', async () => {
    const { el, input, v, props, bridge, rerender } = await search('anchor')
    click(row(el, `${v}/Docs/Guides`))
    click(row(el, `${v}/Docs`))
    click(row(el, `${v}/Docs`))
    await press(input, 'Escape')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    await rerender({ lens: 'files' }) // App hands the lens back down
    expect(shape(el)).toEqual(FILES_CLOSED)
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
    // S25: opening a result is the open rule's business (`useVaultTree`), so the search that is left lands on its row.
    await rerender({ lens: 'search' })
    expect(searchBar(el)?.value).toBe('anchor')
    await press(searchBar(el)!, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Anchor.md`)
    await rerender({ activeFile: `${v}/Docs/Anchor.md` })
    await press(searchBar(el)!, 'Escape')
    await rerender({ lens: 'files', activeFile: `${v}/Docs/Anchor.md` })
    expect(shape(el)).toEqual(['Archive', 'Docs', '  Guides', '  Anchor', '  Readme', 'Plans', 'Alpha', 'plan'])
    expect(row(el, `${v}/Docs/Anchor.md`)?.classList.contains('tree__row--active')).toBe(true)
  })

  it('S19, S20: the highlight starts on the BEST match, wherever the tree draws it; ↑/↓ walk the matches on screen, never a parent row, and never wrap', async () => {
    const { el, input } = await search('anchor')
    expect(cursor(el)).toEqual(['Anchor']) // the exact name, though `Anchor guide` is drawn above it
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Anchor']) // already the last match
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Anchor guide']) // past `Guides`, which is a parent and not a match
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Anchor guide']) // already the first match: `Docs` above it is no stop
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Anchor'])
    // A name that only STARTS with the text: the first of them in the ranking, a folder before a note.
    await type(input, 'pla')
    expect(cursor(el)).toEqual(['Plans'])
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Plan A'])
    // A new query is a new ranking: its best match — the last row here — not the carried position.
    await type(input, 'plan')
    expect(shape(el)).toEqual(['Plans', '  Plan A', 'plan'])
    expect(cursor(el)).toEqual(['plan'])
  })

  it('S21: the matches below a folder the user closed are not walked; a highlight that stood on one moves to the match now at that position', async () => {
    const { el, input, v, props } = await search('anchor')
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Anchor guide'])
    click(row(el, `${v}/Docs/Guides`))
    expect(shape(el)).toEqual(['Docs', '  Guides', '  Anchor'])
    expect(cursor(el)).toEqual(['Anchor'])
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Anchor']) // the one match on screen
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Anchor.md`)
    // No match on screen at all: nothing is highlighted and Enter has nothing to open.
    click(row(el, `${v}/Docs`))
    expect(shape(el)).toEqual(['Docs'])
    expect(cursor(el)).toEqual([])
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('a fold above the highlight leaves it on its match: the highlight is held by its path, not by its position', async () => {
    const { el, input, v } = await search('a')
    for (let i = 0; i < 4; i++) await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Plans'])
    click(row(el, `${v}/Docs`)) // a parent row above it: three matches leave the screen
    expect(cursor(el)).toEqual(['Plans'])
    click(row(el, `${v}/Docs`)) // …and come back
    expect(cursor(el)).toEqual(['Plans'])
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Readme'])
  })

  it('S22: Enter opens the highlighted row in the current tab, ⌘Enter in a background tab; the bar keeps the focus and the results stay', async () => {
    const { el, input, v, props } = await search('anchor')
    act(() => input.focus())
    await press(input, 'ArrowUp')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Guides/Anchor guide.md`)
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    await press(input, 'ArrowDown')
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Anchor.md`)
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('anchor')
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide', '  Anchor'])
  })

  it('S22: Enter on the page ALREADY open commits the caret into it, and asks for no other page; ⌘-Enter there is still a background tab (YAZ-961)', async () => {
    // The tree rows' rule (YAZ-921), on the search: the first Enter previews — focus stays in the
    // bar, so the walk continues — and the second is the deliberate "take me in".
    const pm = editorStub()
    const { el, input, v, props, rerender } = await search('alpha')
    await rerender({ activeFile: `${v}/Alpha.md` })
    // S39: the open file's row keeps its active style under the highlight.
    expect(row(el, `${v}/Alpha.md`)?.className).toContain('tree__row--active tree__row--selected')
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(`${v}/Alpha.md`)
    expect(document.activeElement).not.toBe(pm)
    await press(input, 'Enter')
    // The page is asked for again — nothing for the workspace to change, and App's cue to close the tab board (YAZ-2648 S46).
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Alpha.md`)
    expect(document.activeElement).toBe(pm)
    pm.remove()
  })

  it('S26 to S29: a click acts as on any tree row and moves the highlight to a MATCH only; shift-click does nothing', async () => {
    const { el, input, v, props } = await search('plan')
    expect(cursor(el)).toEqual(['plan'])
    // S26: a note row opens — ⌘ in a background tab — and takes the highlight.
    click(row(el, `${v}/Plans/Plan A.md`))
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Plans/Plan A.md`)
    expect(cursor(el)).toEqual(['Plan A'])
    click(row(el, `${v}/plan.md`), { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(`${v}/plan.md`)
    expect(cursor(el)).toEqual(['plan'])
    // S27: a folder row folds and, being a match, takes the highlight; a double-click opens nothing (YAZ-3377 D1).
    click(row(el, `${v}/Plans`))
    expect(shape(el)).toEqual(['Plans', 'plan'])
    expect(cursor(el)).toEqual(['Plans'])
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
    act(() => void row(el, `${v}/Plans`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(props.onKeepFile).not.toHaveBeenCalled()
    // S28: a row inside an opened folder is no match — it opens as a tree row does, and the highlight stays.
    await type(input, 'archive')
    click(row(el, `${v}/Archive`))
    click(row(el, `${v}/Archive/Notes.md`))
    expect(props.onOpenFile).toHaveBeenLastCalledWith(`${v}/Archive/Notes.md`)
    expect(cursor(el)).toEqual(['Archive'])
    // S29: a search has no multi-select — shift neither selects, opens nor folds.
    const opened = vi.mocked(props.onOpenFile).mock.calls.length
    click(row(el, `${v}/Archive/Notes.md`), { shiftKey: true })
    click(row(el, `${v}/Archive`), { shiftKey: true })
    expect(cursor(el)).toEqual(['Archive'])
    expect(shape(el)).toEqual(['Archive', '  Deep', '  Notes'])
    expect(props.onOpenFile).toHaveBeenCalledTimes(opened)
  })

  it('S30: a right-click opens the row\'s own menu — a parent row\'s too — and the highlight follows it onto a match, as it follows a click', async () => {
    const { el, v } = await search('plan')
    const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    rightClick(row(el, `${v}/Plans/Plan A.md`))
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(cursor(el)).toEqual(['Plan A'])
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await type(searchInput(el)!, 'anchor')
    rightClick(row(el, `${v}/Docs`))
    expect(itemByLabel(el, 'Add to focus')).toBeDefined()
    // `Docs` is a parent, not a match: the highlight stays, and while its menu is open the row
    // wears the selected style beside it, as on Files — the menu says what it acts on.
    expect(cursor(el)).toEqual(['Docs', 'Anchor'])
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(cursor(el)).toEqual(['Anchor'])
  })

  // The Favorites tab's own tree reorders its top rows and moves a deeper file on disk; the Search tab does neither, whichever tab it was shown from.
  it.each(['files', 'favorites'] as const)('S32, YAZ-2631 S37: on the Search tab, shown from the %s tab, a drag does nothing — no row is a drop target, no row takes a line, nothing moves on disk and no order is written', async (lens) => {
    const { el, v, bridge, props } = await search('plan', { lens }, { tweak: (b) => b.favorites.get.mockImplementation(async (root) => [`${root}/Plans`, `${root}/plan.md`]) })
    for (const dragged of [`${v}/plan.md`, `${v}/Plans/Plan A.md`]) {
      act(() => void row(el, dragged)?.dispatchEvent(new Event('dragstart', { bubbles: true })))
      act(() => void row(el, `${v}/Plans`)?.dispatchEvent(new Event('dragover', { bubbles: true })))
      expect(el.querySelector('.tree__row--drop, .tree__row--drop-before, .tree__row--drop-after')).toBeNull()
      act(() => void row(el, `${v}/Plans`)?.dispatchEvent(new Event('drop', { bubbles: true })))
    }
    expect(props.onRenameFile).not.toHaveBeenCalled()
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('S9, S10: a note is ONE row under its title, whatever of it matched — an alias alone, its title and an alias, or its id', async () => {
    const { el, input, v, props } = await search('first', {}, {
      records: (root) => notePaths(VAULT(root)).map((path) => record(root, path, path.endsWith('/Alpha.md') ? { aliases: ['First letter', 'Alphabet'] } : path.endsWith('/Zed.md') ? { id: 'k3m9x2pq7abc' } : {})),
    })
    expect(shape(el)).toEqual(['Alpha']) // S9: found by its alias, shown by its title
    await type(input, 'alpha')
    expect(shape(el)).toEqual(['Alpha']) // two candidates matched — the title and `Alphabet` — one row
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Alpha'])
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Alpha.md`)
    // S10: text that holds an id is that note alone, with its parents.
    await type(input, `see [[k3m9x2pq7abc]] in ${v}/Plans`)
    expect(shape(el)).toEqual(['Plans', '  Zed'])
    expect(cursor(el)).toEqual(['Zed'])
  })

  it('YAZ-2677 S70: the row of a note found by its number shows its full ID in front of its title; found by its title, it shows the title alone', async () => {
    const { el, input, v } = await search('12', {}, {
      records: (root) => notePaths(VAULT(root)).map((path) => record(root, path, path.endsWith('/Zed.md') ? { id: 'YAZ-12' } : {})),
    })
    expect(shape(el)).toEqual(['Plans', '  YAZ-12 — Zed'])
    expect(row(el, `${v}/Plans/Zed.md`)?.querySelector('.tree__label')?.textContent).toBe('YAZ-12 — Zed')
    await type(input, 'yaz 12')
    expect(shape(el)).toEqual(['Plans', '  YAZ-12 — Zed'])
    await type(input, 'zed')
    expect(shape(el)).toEqual(['Plans', '  Zed'])
  })

  it('S37, S38, S40, S9, S10: a match shows the typed text bold where it first sits — whatever its case, spaces aside — and every other row steps back; a tree outside a search is drawn as ever (R7)', async () => {
    const vault = await search('', {}, {
      records: (root) => notePaths(VAULT(root)).map((path) => record(root, path, path.endsWith('/Alpha.md') ? { aliases: ['First letter'] } : path.endsWith('/Zed.md') ? { id: 'k3m9x2pq7abc' } : {})),
    })
    const { el, v, rerender } = vault
    const body = () => el.querySelector('.sidebar__body')!.innerHTML
    const bold = () => [...el.querySelectorAll('.sidebar__body .tree__mark')].map((n) => n.textContent)
    const grey = () => [...el.querySelectorAll('.sidebar__body .tree__row--context .tree__label')].map((n) => n.textContent)
    await rerender({ lens: 'files' })
    const files = body()
    const input = searchInput(el)!
    await type(input, '  AN  ')
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide', '  Anchor', 'Plans', '  Plan A', 'plan'])
    expect(bold()).toEqual(['An', 'An', 'an', 'an', 'an']) // S37, S40: the label's own letters, the query's spaces ignored
    expect(grey()).toEqual(['Docs', 'Guides']) // S38: the parents; `Plans` holds the text, so it is a match
    // S37: the FIRST place only.
    await type(input, 'a')
    expect(row(el, `${v}/Plans/Plan A.md`)?.querySelector('.tree__label')?.innerHTML).toBe('Pl<mark class="tree__mark">a</mark>n A')
    // S38: the rows inside an opened folder that holds no match are no matches either.
    await type(input, 'archive')
    click(row(el, `${v}/Archive`))
    expect(bold()).toEqual(['Archive'])
    expect(grey()).toEqual(['Deep', 'Notes'])
    // S9, S10: found by an alias, or by an id — a match, in the normal colour, with nothing in its label to mark.
    await type(input, 'first')
    expect([shape(el), bold(), grey()]).toEqual([['Alpha'], [], []])
    await type(input, 'k3m9x2pq7abc')
    expect([shape(el), bold(), grey()]).toEqual([['Plans', '  Zed'], [], ['Plans']])
    // R7: a tab's own tree gets no marks — Files is drawn exactly as before the search.
    await rerender({ lens: 'files' })
    expect(body()).toBe(files)
    expect(el.querySelector('.tree__mark, .tree__row--context')).toBeNull()
  })

  it('S5, S11: nothing matched says so; at the limit a line below the tree says so — the limit counts candidate rows, a title and an alias being two', async () => {
    const many = (v: string): TreeNode[] => [folder(`${v}/Log`, Array.from({ length: 30 }, (_, i) => note(`${v}/Log/Note ${String(i).padStart(2, '0')}.md`)))]
    const { el, input } = await search('not', {}, { nodes: many, records: (v) => notePaths(many(v)).map((path, i) => record(v, path, { aliases: [`Notable ${i}`] })) })
    // 60 candidates matched; the 50 kept are 25 notes' title and alias.
    expect(el.querySelectorAll('.sidebar__body .tree__row--file')).toHaveLength(25)
    expect(el.querySelector('.sidebar__body .tree + .sidebar__msg')?.textContent).toBe('Showing 50 matches. Type more to narrow.')
    await type(input, 'note 1')
    expect(el.querySelectorAll('.sidebar__body .tree__row--file')).toHaveLength(10)
    expect(el.querySelector('.sidebar__body .sidebar__msg')).toBeNull()
    await type(input, 'zzz')
    expect(el.querySelector('.sidebar__body .tree')).toBeNull()
    expect(el.querySelector('.sidebar__body .sidebar__msg')?.textContent).toBe('No matches')
  })

  /** A folder of files that are no notes (🔒 D3) — a script the app cannot show, a PDF it can — beside a note whose file name is not its title. */
  const TOOLS = (v: string): TreeNode[] => [
    folder(`${v}/skills`, [
      { type: 'file', name: 'get-transcript.py', path: `${v}/skills/get-transcript.py`, size: 1, mtime: 1, kind: null },
      { type: 'file', name: 'scan.pdf', path: `${v}/skills/scan.pdf`, size: 1, mtime: 1, kind: 'pdf' },
      note(`${v}/skills/Transcript.md`),
    ]),
    note(`${v}/up-001.md`),
  ]
  const toolRecords = (v: string) => [record(v, `${v}/skills/Transcript.md`), record(v, `${v}/up-001.md`, { title: 'Abdul' })]

  it('S12, S13, S24: a file that is no note is found by its file name, extension included; Enter opens one the app cannot show in its default app, with no tab', async () => {
    // S13: the index may hold a note the tree does not show (a hidden folder, `node_modules`): it is no row.
    const { el, input, v, props, bridge } = await search('transcript', {}, { nodes: TOOLS, records: (root) => [...toolRecords(root), record(root, `${root}/node_modules/pkg/Transcript notes.md`)] })
    expect(shape(el)).toEqual(['skills', '  get-transcript.py', '  Transcript'])
    expect(cursor(el)).toEqual(['Transcript']) // the exact name; the script only holds the text
    await type(input, '.py')
    expect(shape(el)).toEqual(['skills', '  get-transcript.py'])
    // S24: no viewer in the app, so the OS opens it — ⌘ or not, there is no tab to open or to background.
    await press(input, 'Enter')
    await press(input, 'Enter', true)
    expect(bridge.shell.openDefault.mock.calls).toEqual([[{ path: `${v}/skills/get-transcript.py` }], [{ path: `${v}/skills/get-transcript.py` }]])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    // A file the app CAN show opens as a tab, as its tree row does.
    await type(input, 'scan')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/skills/scan.pdf`)
    // S12: a note is found by its title and aliases, never by its file name.
    await type(input, 'up-001')
    expect(el.querySelector('.sidebar__body .sidebar__msg')?.textContent).toBe('No matches')
    await type(input, 'abdul')
    expect(shape(el)).toEqual(['up-001']) // the row's label is the window index's business; the search found it by title
  })

  it('S35: with no index — not loaded, or unreadable — folders and files that are no notes are still found, from the tree, and no error shows; notes arrive with the index', async () => {
    const { el, input, v, props, bridge, emit } = await search('transcript', {}, { nodes: TOOLS, records: toolRecords, tweak: (b) => b.index.mockRejectedValue(new Error('no index')) })
    expect(shape(el)).toEqual(['skills', '  get-transcript.py'])
    await type(input, 'skills')
    expect(shape(el)).toEqual(['skills'])
    expect(el.querySelector('.sidebar__msg--error')).toBeNull()
    expect(props.onNotice).not.toHaveBeenCalled()
    bridge.index.mockResolvedValue({ root: v, records: toolRecords(v), folders: [], generatedAt: 2, ids: true } as never)
    await emit({ type: 'ready', root: v })
    await type(input, 'transcript')
    expect(shape(el)).toEqual(['skills', '  get-transcript.py', '  Transcript'])
  })

  it('S34: a file removed or added during a search — the results follow the new tree and the new index, and the highlight clamps onto a row (YAZ-808)', async () => {
    const { el, input, v, nodes, records, bridge, props, emit } = await search('anchor')
    await press(input, 'ArrowUp')
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['Anchor']) // moved there by the keys: the second of two matches
    const without = (list: readonly TreeNode[]): TreeNode[] => list.flatMap((n): TreeNode[] => (n.path === `${v}/Docs/Anchor.md` ? [] : n.type === 'dir' ? [{ ...n, children: without(n.children) }] : [n]))
    bridge.tree.mockResolvedValue({ root: v, tree: without(nodes), generatedAt: 2 })
    bridge.index.mockResolvedValue({ root: v, records: records.filter((r) => r.path !== `${v}/Docs/Anchor.md`), folders: [], generatedAt: 2, ids: true } as never)
    await emit({ type: 'unlink', path: `${v}/Docs/Anchor.md` })
    await afterQuiet()
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide'])
    expect(cursor(el)).toEqual(['Anchor guide']) // the stale position clamps onto the last match, not onto nothing
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Guides/Anchor guide.md`)
    bridge.tree.mockResolvedValue({ root: v, tree: [...without(nodes), note(`${v}/Anchorage.md`)], generatedAt: 3 })
    bridge.index.mockResolvedValue({ root: v, records: [...records.filter((r) => r.path !== `${v}/Docs/Anchor.md`), record(v, `${v}/Anchorage.md`)], folders: [], generatedAt: 3, ids: true } as never)
    await emit({ type: 'add', path: `${v}/Anchorage.md`, mtime: 1 })
    await afterQuiet()
    expect(shape(el)).toEqual(['Docs', '  Guides', '    Anchor guide', 'Anchorage'])
  })

  it('the highlighted row is scrolled into view as the keys move it — the tree scrolls inside the body', async () => {
    const scrolled: (string | undefined)[] = []
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value(this: HTMLElement) { scrolled.push(this.dataset.path) } })
    try {
      const { input, v } = await search('anchor')
      expect(scrolled.at(-1)).toBe(`${v}/Docs/Anchor.md`)
      await press(input, 'ArrowUp')
      expect(scrolled.at(-1)).toBe(`${v}/Docs/Guides/Anchor guide.md`)
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
  })

  it('YAZ-2638 D2: while a different tab shows, the search that is not on screen scrolls no tree and ranks nothing; back on the Search tab it ranks again and its highlighted row is scrolled into view', async () => {
    const scrolled: (string | undefined)[] = []
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value(this: HTMLElement) { scrolled.push(this.dataset.path) } })
    try {
      const { el, v, nodes, records, bridge, rerender, emit } = await search('anchor')
      expect(cursor(el)).toEqual(['Anchor'])
      await rerender({ lens: 'files' })
      // Files draws the rows the search matched: their folders are open there.
      click(row(el, `${v}/Docs`))
      click(row(el, `${v}/Docs/Guides`))
      expect(row(el, `${v}/Docs/Guides/Anchor guide.md`)).not.toBeNull()
      scrolled.length = 0
      rowBuilds.ranked.length = 0
      // The highlighted match leaves the vault. A search on screen moves its highlight to the match that is left.
      const without = (list: readonly TreeNode[]): TreeNode[] => list.flatMap((n): TreeNode[] => (n.path === `${v}/Docs/Anchor.md` ? [] : n.type === 'dir' ? [{ ...n, children: without(n.children) }] : [n]))
      bridge.tree.mockResolvedValue({ root: v, tree: without(nodes), generatedAt: 2 })
      bridge.index.mockResolvedValue({ root: v, records: records.filter((r) => r.path !== `${v}/Docs/Anchor.md`), folders: [], generatedAt: 2, ids: true } as never)
      await emit({ type: 'unlink', path: `${v}/Docs/Anchor.md` })
      await afterQuiet()
      expect(row(el, `${v}/Docs/Anchor.md`)).toBeNull() // Files followed the disk
      expect(scrolled).toEqual([])
      expect(rowBuilds.ranked).toEqual([])
      await rerender({ lens: 'search' })
      expect([...new Set(rowBuilds.ranked)]).toEqual(['anchor'])
      expect([searchBar(el)?.value, shape(el), cursor(el)]).toEqual(['anchor', ['Docs', '  Guides', '    Anchor guide'], ['Anchor guide']])
      expect(scrolled.at(-1)).toBe(`${v}/Docs/Guides/Anchor guide.md`)
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
  })

  it('the search tree is memoised per level like every tree (YAZ-2194): a render that changes nothing for it re-renders no row', async () => {
    const { rerender } = await search('readme')
    labelRenders.names = []
    await rerender({ width: 300 })
    expect(labelRenders.names).toEqual([])
  })

  it('a reveal request with the Files lens shows the Files tree, and the text stays in the Search tab (YAZ-2638 S23)', async () => {
    const { el, v, rerender } = await search('a')
    const results = shape(el)
    await rerender({ lens: 'files', revealRequest: { id: 1, path: `${v}/Alpha.md` } })
    expect(shape(el)).toEqual(FILES_CLOSED)
    expect(row(el, `${v}/Alpha.md`)?.classList.contains('tree__row--revealed')).toBe(true)
    await rerender({ lens: 'search' })
    expect([searchBar(el)?.value, shape(el)]).toEqual(['a', results])
  })

  it('a request that arrives while the Search tab is showing is dropped, and does not disturb the search', async () => {
    const { el, input, v, props, rerender } = await search('a')
    const results = shape(el)
    await rerender({ revealRequest: { id: 1, path: `${v}/Alpha.md` } })
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect([input.value, shape(el)]).toEqual(['a', results])
    expect(el.querySelector('.tree__row--revealed')).toBeNull()
  })

  it('S31: right-clicking blank space in the results offers no menu — not even the OS one (YAZ-803, YAZ-2050)', async () => {
    const { el } = await search('a')
    let reached = true
    act(() => void (reached = el.querySelector('.sidebar__body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))))
    expect(reached).toBe(false) // default-prevented: Electron's Cut/Copy/Paste menu never opens
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * The Search tab (YAZ-2638 D2): search is a tab of its own, second in the row, and the search bar
 * is in that tab only. ⌘K or a click on the tab puts the caret in the bar and selects the text;
 * Esc and the `esc` keycap go back to the lens the window last showed, the text stays, and the caret
 * goes into the open page (YAZ-2662 D9). With no text the tab shows its line and the keys of the
 * search (YAZ-2662 D10). The text, the folds and the highlight stay while a different tab shows. The tab is App's value and is
 * never stored (S15, `App.test.tsx`). The S-numbers are the case record on YAZ-2638; S8 is the
 * describe above.
 */
describe('the Search tab (YAZ-2638 D2)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  const VAULT = (v: string): TreeNode[] => [folder(`${v}/Docs`, [folder(`${v}/Docs/Guides`, [note(`${v}/Docs/Guides/Anchor guide.md`)]), note(`${v}/Docs/Anchor.md`)]), note(`${v}/Alpha.md`)]
  const NOTES = ['/Docs/Guides/Anchor guide.md', '/Docs/Anchor.md', '/Alpha.md']
  const HINT = 'Type to search every note and folder.'

  let vaults = 0
  /** A fresh vault per mount — the Files tree's folds persist per root across this file — over an index of its three notes. */
  const open = async (over: Partial<SidebarProps> = {}, nodes: (v: string) => TreeNode[] = VAULT) => {
    const v = `/v-tab-${++vaults}`
    const records = NOTES.map((rel) => ({ ...indexRecord(`${v}${rel}`), folder: rel.slice(1, Math.max(1, rel.lastIndexOf('/'))) }))
    const m = await mount({ root: v, ...over }, (b) => {
      b.tree.mockResolvedValue({ root: v, tree: nodes(v), generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records, folders: [], generatedAt: 1, ids: true } as never)
    })
    return { ...m, v }
  }
  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses[role="tablist"] [role="tab"]')]
  const tabName = (b: HTMLButtonElement) => b.textContent || b.getAttribute('aria-label')
  const bar = (el: HTMLElement) => el.querySelector('.sidebar__search')
  const keycap = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__search .sidebar__search-back')
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const labels = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row .tree__label')].map((n) => n.textContent)
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const cursor = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row--selected .tree__label')].map((n) => n.textContent)
  const press = (input: HTMLInputElement, key: string, metaKey = false) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))
  const click = (target: Element | null, init: MouseEventInit = {}) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  const allButton = (el: HTMLElement) => el.querySelector('.sidebar__lenses .sidebar__expand-all')
  /** The text of the bar that is selected, or null when the caret is not in the bar. */
  const selected = (el: HTMLElement) => {
    const input = searchBar(el)
    return input === null || document.activeElement !== input ? null : input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
  }

  it('S1: the tabs are Files, Search, Focus, Favorites, Sessions, Recents, in this order; Search is a glyph, and its name is in `title` and `aria-label`', async () => {
    const { el } = await open()
    expect(tabs(el).map(tabName)).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
    const search = tabs(el)[1]
    expect([search.getAttribute('aria-label'), search.title, search.textContent, search.querySelector('svg') !== null]).toEqual(['Search', 'Search', '', true])
    expect(search.classList.contains('sidebar__lens--glyph')).toBe(true)
    expect(tabs(el).map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
    showTab?.('search')
    expect(tabs(el).map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false'])
  })

  it('S2, S5: a request for the Search tab — ⌘K, or a click on the tab, which App hands down with the tab — puts the caret in the bar and selects the text that is there; the tab alone, with no request, does not', async () => {
    const { el, props, rerender } = await open({ lens: 'search' })
    expect(selected(el)).toBeNull() // a mount with no request: the caret stays where it was
    await type(searchBar(el)!, 'anchor')
    await rerender({ lens: 'files' })
    expect(selected(el)).toBeNull()
    // S5: the click reports up, and App hands the tab back down with the request for the caret.
    click(tabs(el)[1])
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('search')
    await rerender({ lens: 'search', pendingSearchFocus: true })
    expect(selected(el)).toBe('anchor')
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
    // S5 while the Search tab shows: the click reports up again, and the request alone brings the caret back.
    await rerender({ pendingSearchFocus: false })
    act(() => searchBar(el)!.blur())
    click(tabs(el)[1])
    expect(props.onLensChange).toHaveBeenCalledTimes(2)
    expect(props.onLensChange).toHaveBeenLastCalledWith('search')
    expect(selected(el)).toBeNull()
    await rerender({ pendingSearchFocus: true })
    expect(selected(el)).toBe('anchor')
  })

  it('S4: ⌘K while the Search tab shows puts the caret back in the bar, selects the text and reports back', async () => {
    const { el, props, rerender } = await open({ lens: 'search' })
    const input = searchBar(el)!
    await type(input, 'anchor')
    act(() => input.blur())
    expect(selected(el)).toBeNull()
    await rerender({ pendingSearchFocus: true })
    expect(selected(el)).toBe('anchor')
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('S6: the bar is in the Search tab only — Files, Focus and Favorites have none — and it has no magnifier icon: the tab has it', async () => {
    const { el, rerender } = await open()
    for (const lens of ['files', 'focus', 'favorites'] as const) {
      await rerender({ lens })
      expect([lens, bar(el)]).toEqual([lens, null])
    }
    await rerender({ lens: 'search' })
    expect(bar(el)).not.toBeNull()
    expect(bar(el)?.querySelector('svg')).toBeNull()
  })

  it('S7, S9: with no text the body says "Type to search every note and folder." and draws no tree; text that matches nothing says "No matches"', async () => {
    const { el } = await open({ lens: 'search' })
    expect([bodyMsg(el), el.querySelector('.sidebar__body .tree')]).toEqual([HINT, null])
    await type(searchBar(el)!, '   ') // spaces are no text
    expect([bodyMsg(el), el.querySelector('.sidebar__body .tree')]).toEqual([HINT, null])
    await type(searchBar(el)!, 'zzz')
    expect([bodyMsg(el), el.querySelector('.sidebar__body .tree')]).toEqual(['No matches', null])
    await type(searchBar(el)!, 'alpha')
    expect([bodyMsg(el), labels(el)]).toEqual([null, ['Alpha']])
  })

  it('S10, S11: the text, the folds and the highlight stay while a different tab shows and the Search tab shows again; new typed text is a new ranking', async () => {
    // `Anchors` holds no match, so the search draws it closed: a click is a fold of the search's own.
    const { el, v, rerender } = await open({ lens: 'search' }, (root) => [folder(`${root}/Anchors`, [note(`${root}/Anchors/Misc.md`)]), ...VAULT(root)])
    await type(searchBar(el)!, 'anchor')
    const [rows, best] = [labels(el), cursor(el)]
    expect(rows).toEqual(['Anchors', 'Docs', 'Guides', 'Anchor guide', 'Anchor'])
    click(row(el, `${v}/Anchors`))
    await press(searchBar(el)!, 'ArrowDown')
    const [folded, moved] = [labels(el), cursor(el)]
    expect(folded).toEqual(['Anchors', 'Misc', 'Docs', 'Guides', 'Anchor guide', 'Anchor'])
    expect(moved).not.toEqual(best) // the highlight is off the best match
    // Every line the body draws on the way back: no frame may say "No matches" or the line of an empty bar.
    const lines: (string | null)[] = []
    const collect = (changes: MutationRecord[]) => {
      for (const change of changes) for (const added of change.addedNodes) if (added instanceof Element) for (const msg of [added, ...added.querySelectorAll('*')]) if (msg.classList.contains('sidebar__msg')) lines.push(msg.textContent)
    }
    const watcher = new MutationObserver(collect)
    for (const lens of ['files', 'focus', 'favorites'] as const) {
      await rerender({ lens })
      expect(searchBar(el)).toBeNull()
      lines.length = 0
      watcher.observe(el.querySelector('.sidebar__body')!, { childList: true, subtree: true })
      await rerender({ lens: 'search' })
      collect(watcher.takeRecords())
      watcher.disconnect()
      expect([lens, lines]).toEqual([lens, []])
      expect([lens, searchBar(el)?.value, labels(el), cursor(el)]).toEqual([lens, 'anchor', folded, moved])
    }
    // S11: the same matches under new text — the highlight is on the best match again, and the folds are the search's own again.
    await type(searchBar(el)!, 'anchor ')
    expect([labels(el), cursor(el)]).toEqual([rows, best])
  })

  it.each(['files', 'focus', 'favorites'] as const)('S12: Esc in the bar goes back to the lens the window last showed (%s), and the text stays', async (last) => {
    vi.spyOn(storage, 'getSidebarLens').mockReturnValue(last)
    const { el, props, rerender } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'anchor')
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void searchBar(el)!.dispatchEvent(esc))
    expect(esc.defaultPrevented).toBe(true) // the bar's own key: it does not also close what is behind it
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith(last)
    expect(searchBar(el)?.value).toBe('anchor')
    await rerender({ lens: last })
    await rerender({ lens: 'search' })
    expect([searchBar(el)?.value, labels(el)]).toEqual(['anchor', ['Docs', 'Guides', 'Anchor guide', 'Anchor']])
  })

  it('YAZ-3403 S17, S19, D6: a rest of 400 ms on a note result opens the note panel beside the sidebar, as on Files; more typed letters close it', async () => {
    const { el, v } = await open({ lens: 'search' })
    ;(window.yaseenDocs as unknown as { readFile: ReturnType<typeof vi.fn> }).readFile.mockImplementation(async (path: string) => ({ path, content: '# Top of the anchor\n', mtime: 1, size: 20 }))
    const notePanel = () => document.querySelector<HTMLElement>('.note-preview')
    await type(searchBar(el)!, 'anchor')
    const hit = row(el, `${v}/Docs/Anchor.md`)!
    act(() => void hit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(() => new Promise<void>((r) => setTimeout(r, 450)))
    for (let i = 0; i < 200 && notePanel() === null; i++) await act(() => new Promise<void>((r) => setTimeout(r, 50)))
    expect(notePanel()?.querySelector('.board-preview__name')?.textContent).toBe('Anchor')
    await type(searchBar(el)!, 'anchor g')
    expect(notePanel()).toBeNull()
  })

  it('S12: Esc in an empty bar goes back too', async () => {
    const { el, props } = await open({ lens: 'search' })
    await press(searchBar(el)!, 'Escape')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
  })

  it('S13, S14: the `esc` keycap is always in the bar, a click does the same as Esc, and it is no Tab stop; the bar has no clear button', async () => {
    vi.spyOn(storage, 'getSidebarLens').mockReturnValue('favorites')
    const { el, props } = await open({ lens: 'search' })
    // With an empty bar it is there.
    expect([keycap(el)?.textContent, keycap(el)?.title, keycap(el)?.getAttribute('aria-label'), keycap(el)?.tabIndex]).toEqual(['esc', 'Back (Esc)', 'Leave search', -1])
    click(keycap(el))
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('favorites')
    await type(searchBar(el)!, 'anchor')
    expect(keycap(el)?.textContent).toBe('esc')
    click(keycap(el))
    expect(props.onLensChange).toHaveBeenCalledTimes(2)
    expect(props.onLensChange).toHaveBeenLastCalledWith('favorites')
    expect(searchBar(el)?.value).toBe('anchor') // back, not clear
    // S14: the keycap is the bar's one button.
    expect(bar(el)?.querySelectorAll('button')).toHaveLength(1)
  })

  it.each(['Esc', 'a click on the `esc` keycap'])('YAZ-2662 S56, S58: %s goes back to the lens the window last showed, the text stays, and the caret goes into the open page', async (way) => {
    const pm = editorStub()
    const { el, props } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'anchor')
    act(() => searchBar(el)!.focus())
    if (way === 'Esc') await press(searchBar(el)!, 'Escape')
    else click(keycap(el))
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(searchBar(el)?.value).toBe('anchor')
    expect(document.activeElement).toBe(pm)
    pm.remove()
  })

  it('YAZ-2662 S57: with no page open Esc and the keycap go back all the same — no caret moves and nothing is said', async () => {
    const { el, props } = await open({ lens: 'search' })
    act(() => searchBar(el)!.focus())
    await press(searchBar(el)!, 'Escape')
    click(keycap(el))
    expect(props.onLensChange).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(searchBar(el))
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('YAZ-2663 D12: ↑ in the search bar, with the highlight on the first row or with no row, goes to the tab button of Search; with a row above the highlight it moves the highlight, as before', async () => {
    const { el } = await open({ lens: 'search' })
    const input = searchBar(el)!
    const searchTab = el.querySelector<HTMLElement>('.sidebar__lens--active')
    act(() => input.focus())
    await press(input, 'ArrowUp') // no text, no row
    expect(document.activeElement).toBe(searchTab)
    act(() => input.focus())
    await type(input, 'a')
    const top = () => cursor(el)[0]
    await press(input, 'ArrowDown')
    const second = top()
    await press(input, 'ArrowUp') // a row above the highlight: the highlight moves, and the caret stays in the bar
    expect([document.activeElement, top() !== second]).toEqual([input, true])
    for (let n = 0; n < 60 && document.activeElement === input; n++) await press(input, 'ArrowUp')
    expect(document.activeElement).toBe(searchTab) // …and from the first row, to the tab button
  })

  it('YAZ-2663 D10: with no page open Esc goes to the new tab page, when it shows and has a row; the search tab is left all the same', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, props } = await open({ lens: 'search', onLeaveToPage })
    await type(searchBar(el)!, 'no such row')
    act(() => searchBar(el)!.focus())
    await press(searchBar(el)!, 'Escape')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(onLeaveToPage).toHaveBeenCalledTimes(1)
  })

  it('YAZ-2663 D10: with a page open Esc puts the caret in it, and the new tab page is not asked', async () => {
    const pm = editorStub()
    const onLeaveToPage = vi.fn(() => true)
    const { el } = await open({ lens: 'search', onLeaveToPage })
    act(() => searchBar(el)!.focus())
    await press(searchBar(el)!, 'Escape')
    expect([document.activeElement, onLeaveToPage.mock.calls.length]).toEqual([pm, 0])
    pm.remove()
  })

  it('YAZ-2663 D10: a new tab (⌘T) starts a new search — the bar is empty and has the caret; ⌘K keeps the text, selected (YAZ-2638 D2)', async () => {
    const { el, rerender } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'anchor')
    await rerender({ lens: 'files' })
    await rerender({ lens: 'search', pendingSearchFocus: true })
    expect([searchBar(el)?.value, document.activeElement]).toEqual(['anchor', searchBar(el)])
    await rerender({ lens: 'files', pendingSearchFocus: false })
    await rerender({ lens: 'search', pendingSearchFocus: true, pendingSearchClear: true })
    expect([searchBar(el)?.value, document.activeElement]).toEqual(['', searchBar(el)])
    expect(el.querySelector('.sidebar__body .sidebar__msg')?.textContent).toBe('Type to search every note and folder.')
  })

  it('YAZ-2662 S59, S60: the empty Search tab shows its line and, below it, the keys of the search — in the keycap of the bar; with text typed the keys do not show', async () => {
    const { el } = await open({ lens: 'search' })
    /** Each row of the list: its keycaps, and what they do. */
    const keys = () => [...el.querySelectorAll('.sidebar__body .sidebar__keys dt')].map((dt) => [[...dt.querySelectorAll('kbd')].map((cap) => cap.textContent), dt.nextElementSibling?.textContent])
    expect(keys()).toEqual([
      [['↑', '↓'], 'Move'],
      [['↵'], 'Open'],
      [['⌘↵'], 'Open in a background tab'],
      [['⇧↵'], 'Show in Files'],
      [['space'], 'Preview a file or open a folder, after ↑ or ↓'],
      [['→', '←'], 'Open or close a folder, after ↑ or ↓'],
      [['esc'], 'Back to the page'],
    ])
    // The line is its own element, and the list is the one thing below it.
    expect([...el.querySelector('.sidebar__body')!.children].map((child) => child.className)).toEqual(['sidebar__msg', 'sidebar__keys'])
    expect(bodyMsg(el)).toBe(HINT)
    expect(appCss).toMatch(/\n\.sidebar__search-back,\n\.sidebar__keys kbd \{/) // one keycap, the bar's
    await type(searchBar(el)!, '   ') // spaces are no text
    expect(keys()).toHaveLength(7)
    // S60: with text — matches or none — the list is gone.
    for (const text of ['anchor', 'zzz']) {
      await type(searchBar(el)!, text)
      expect([text, el.querySelector('.sidebar__keys')]).toEqual([text, null])
    }
  })

  it('YAZ-2662: with the bar empty no key of the list is taken — ↓, →, ←, Space and Enter are left for what stands beside the bar (the page of a new tab, YAZ-2663); ↑ goes to the tabs of the panel (YAZ-2663 D12)', async () => {
    const { el } = await open({ lens: 'search' })
    const taken = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => void searchBar(el)!.dispatchEvent(event))
      return event.defaultPrevented
    }
    expect(['ArrowDown', 'ArrowRight', 'ArrowLeft', ' ', 'Enter'].map(taken)).toEqual(Array(5).fill(false))
    expect(taken('ArrowUp')).toBe(true)
  })

  it('S17, S19: the Search tab has no expand-all button and no blank-space menu — not even the OS one — with text or with none', async () => {
    const { el, rerender } = await open()
    expect(allButton(el)).not.toBeNull() // Files has folders to unfold
    await rerender({ lens: 'search' })
    for (const text of ['', 'anchor']) {
      if (text !== '') await type(searchBar(el)!, text)
      expect([text, allButton(el)]).toEqual([text, null])
      let reached = true
      act(() => void (reached = el.querySelector('.sidebar__body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))))
      expect([text, reached, el.querySelector('.ctx-menu')]).toEqual([text, false, null])
    }
  })

  it('S18: a selection ends when the Search tab shows, and the search tree has no multi-select', async () => {
    const { el, v, rerender } = await open()
    click(row(el, `${v}/Alpha.md`), { shiftKey: true })
    click(row(el, `${v}/Docs`), { shiftKey: true })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
    await rerender({ lens: 'search' })
    await rerender({ lens: 'files' })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    await rerender({ lens: 'search' })
    await type(searchBar(el)!, 'a')
    const highlight = cursor(el)
    click(row(el, `${v}/Alpha.md`), { shiftKey: true })
    click(row(el, `${v}/Docs/Anchor.md`), { shiftKey: true })
    expect([highlight.length, cursor(el)]).toEqual([1, highlight]) // the highlight alone, where it was
  })

  it('S21: "Add to favorites" on a search row changes the list and stays on the Search tab, the text in place', async () => {
    const { el, v, props, bridge } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'alpha')
    rightClick(row(el, `${v}/Alpha.md`))
    await act(async () => itemByLabel(el, 'Add to favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Alpha.md`])
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect([searchBar(el)?.value, labels(el)]).toEqual(['alpha', ['Alpha']])
  })

  it('S22: New note, New dated note, New folder, New dated folder and Rename on a search row ask for the row in Files first, and the text stays in the Search tab', async () => {
    const { el, v, props, rerender } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'alpha')
    for (const item of ['New note', 'New dated note', 'New folder', 'New dated folder', 'Rename']) {
      rightClick(row(el, `${v}/Alpha.md`))
      // "New note" and "New folder" are the rows' own clicks; the dated twins sit in their flyouts (YAZ-3085 D3).
      if (item === 'New dated note') clickSub(el, item, 'New note')
      else if (item === 'New dated folder') clickSub(el, item, 'New folder')
      else act(() => itemByLabel(el, item)?.click())
      expect([item, vi.mocked(props.onRevealInFiles).mock.lastCall]).toEqual([item, [`${v}/Alpha.md`]])
    }
    expect(props.onRevealInFiles).toHaveBeenCalledTimes(5)
    // What App does with the last of them: Files, and the reveal. The row's input is there, and the row flashes.
    await rerender({ lens: 'files', revealRequest: { id: 1, path: `${v}/Alpha.md` } })
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('Alpha')
    await rerender({ lens: 'search', revealRequest: null })
    expect([searchBar(el)?.value, labels(el)]).toEqual(['alpha', ['Alpha']])
  })

  it('S23: a reveal request while text is typed — "Show in sidebar" on a document tab — shows the row in Files, and the text is still in the Search tab', async () => {
    const { el, v, props, rerender } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'alpha')
    // What App's `showInSidebar` does: Files, and the request.
    await rerender({ lens: 'files', revealRequest: { id: 1, path: `${v}/Docs/Guides/Anchor guide.md` } })
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(row(el, `${v}/Docs/Guides/Anchor guide.md`)?.classList.contains('tree__row--revealed')).toBe(true)
    await rerender({ lens: 'search', revealRequest: null })
    expect([searchBar(el)?.value, labels(el)]).toEqual(['alpha', ['Alpha']])
  })

  it('S24: Enter, a click and a ⌘-click on a result open the page as before, and the Search tab stays', async () => {
    const { el, v, props } = await open({ lens: 'search' })
    await type(searchBar(el)!, 'anchor')
    await press(searchBar(el)!, 'Enter')
    click(row(el, `${v}/Docs/Guides/Anchor guide.md`))
    click(row(el, `${v}/Docs/Anchor.md`), { metaKey: true })
    expect(vi.mocked(props.onOpenFile).mock.calls).toEqual([[`${v}/Docs/Anchor.md`], [`${v}/Docs/Guides/Anchor guide.md`]])
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(`${v}/Docs/Anchor.md`)
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect([searchBar(el)?.value, labels(el)]).toEqual(['anchor', ['Docs', 'Guides', 'Anchor guide', 'Anchor']])
  })

  it('S25: the Inbox row stays above the tabs on each tab', async () => {
    const { el, rerender } = await open({ upkeep: true, dueCount: 2 })
    for (const lens of ['files', 'search', 'focus', 'favorites'] as const) {
      await rerender({ lens })
      const inbox = el.querySelector('.sidebar__inbox')
      expect([lens, inbox?.textContent]).toEqual([lens, 'Inbox2'])
      expect(inbox!.compareDocumentPosition(el.querySelector('.sidebar__lenses')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

/**
 * A search row's right-click (YAZ-2050, S30 on YAZ-2620): the menu its row in Files gets, plus
 * "Show in sidebar" FIRST (YAZ-2638 D1). 🔒 D1: it follows the
 * FILES rules whichever tab the search was shown from — a search row is a disk row. 🔒 D2: the items that draw INTO the tree
 * (Rename, the New group) leave the search through `onRevealInFiles` and then act;
 * everything else — the focus toggle too (YAZ-2619 S11) — acts in place and the query stays.
 */
describe('search-row context menu (YAZ-2050)', () => {
  /** `a` is the tree's own `/v/a.md`, so its row exists once the search is left. */
  const A_NOTE = { path: '/v/a.md', name: 'a.md', basename: 'a', title: 'a', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
  const search = async (query: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over, (b) => b.index.mockResolvedValue({ root: '/v', records: [A_NOTE], folders: [], generatedAt: 1, ids: true } as never))
    const input = searchInput(m.el)!
    await type(input, query)
    return { ...m, input }
  }
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const labels = (el: HTMLElement) => menuItems(el).map((b) => b.textContent)
  /** The search tree's first note row, or its first folder row. */
  const result = (el: HTMLElement, dir = false) => el.querySelector(`.sidebar__body .tree__row--${dir ? 'dir' : 'file'}`)
  /** What App does with `onRevealInFiles`: flip to Files and issue the reveal the Sidebar consumes. */
  const appReveals = (rerender: (next: Partial<SidebarProps>) => Promise<void>, path: string) =>
    rerender({ lens: 'files', revealRequest: { id: 1, path } })

  /** Drop the current mount so the next `mount` in the same test starts clean. */
  const unmountNow = () => {
    act(() => root?.unmount())
    container?.remove()
  }
  /** The tree row's menu, read off a fresh mount — the reference: a search row's menu is this menu plus `Show in sidebar` first (YAZ-2638 D1). */
  const treeMenu = async (selector: string) => {
    const { el } = await mount()
    rightClick(el.querySelector(selector))
    const out = labels(el)
    unmountNow()
    return out
  }

  it('a FILE result opens the file row\'s menu plus `Show in sidebar` first (YAZ-2638 S26, S27), not the OS edit menu', async () => {
    const expected = await treeMenu('.tree__row--file')
    const { el } = await search('a')
    let reached = true
    act(() => void (reached = result(el)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))))
    expect(reached).toBe(false)
    expect(expected).not.toContain('Show in sidebar') // S28: the row in Files has no such item
    expect(labels(el)).toEqual(['Show in sidebar', ...expected])
  })

  it('a FOLDER result opens the folder row\'s menu plus `Show in sidebar` first (YAZ-2638 S26, S27)', async () => {
    const expected = await treeMenu('.tree__row--dir')
    const { el } = await search('sub')
    rightClick(result(el, true))
    expect(expected).not.toContain('Show in sidebar')
    expect(labels(el)).toEqual(['Show in sidebar', ...expected])
    expect(labels(el).slice(0, 3)).toEqual(['Show in sidebar', 'Open folder page', 'Add to focus'])
  })

  it('follows the FILES rules whichever tab the search was shown from (🔒 D1): from Favorites the same menu, "Add to focus"', async () => {
    const files = await search('a')
    rightClick(result(files.el))
    const expected = labels(files.el)
    unmountNow()
    const favorites = await search('a', { lens: 'favorites' })
    rightClick(result(favorites.el))
    expect(labels(favorites.el)).toEqual(expected)
    closeMenu(favorites.el)
    await type(favorites.input, 'sub')
    rightClick(result(favorites.el, true))
    expect(itemByLabel(favorites.el, 'Add to focus')).toBeDefined()
  })

  it('Rename leaves the search, then the inline input mounts on the row (🔒 D2)', async () => {
    const { el, input, props, rerender } = await search('a')
    rightClick(result(el))
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    await appReveals(rerender, '/v/a.md')
    expect(searchBar(el)).toBeNull() // Files shows: the bar is in the Search tab, where the text stays (YAZ-2638 S22)
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('a')
    await rerender({ lens: 'search' })
    expect(searchBar(el)?.value).toBe(input.value)
  })

  it('New note leaves the search, then the create input mounts in the row\'s folder (🔒 D2)', async () => {
    const { el, props, rerender } = await search('sub')
    rightClick(result(el, true))
    act(() => itemByLabel(el, 'New note')?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
    await appReveals(rerender, '/v/sub')
    expect(el.querySelector('.create-inline__input')).not.toBeNull()
  })

  it('items that need no tree act in place and keep the search (🔒 D2)', async () => {
    const { el, input, props, bridge } = await search('a')
    rightClick(result(el))
    await clickSubAsync(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect(input.value).toBe('a')
    expect(result(el)?.classList.contains('tree__row--selected')).toBe(true) // still the search: its highlight is on the row
  })
})

/**
 * The way out of the EMPTY search bar to the new tab page (YAZ-2663 D7): → and ↓ have nothing to do
 * in a bar with no text, so they ask App for the page. With text they are the search's (YAZ-2662).
 */
describe('the way from the empty search bar to the new tab page (YAZ-2663 D7)', () => {
  const press = (input: HTMLInputElement, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    act(() => void input.dispatchEvent(event))
    return event
  }
  const highlighted = (el: HTMLElement) => el.querySelector<HTMLElement>('.tree__row--selected')?.dataset.path

  it('S33: with no text → and ↓ ask for the page, and the key is taken when the page took the focus; when the page says no, when no page is there, and with a modifier, the key is the bar\'s as before', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, rerender } = await mount({ lens: 'search', onLeaveToPage })
    const input = searchBar(el)!
    expect([press(input, 'ArrowRight').defaultPrevented, press(input, 'ArrowDown').defaultPrevented]).toEqual([true, true])
    expect(onLeaveToPage).toHaveBeenCalledTimes(2)
    // Other keys, and a → or ↓ with a modifier, do not ask.
    for (const [key, init] of [['ArrowLeft', {}], ['Enter', {}], [' ', {}], ['ArrowRight', { metaKey: true }], ['ArrowDown', { shiftKey: true }], ['ArrowRight', { altKey: true }]] as const) expect([key, press(input, key, init).defaultPrevented]).toEqual([key, false])
    // ↑ is the tabs' (YAZ-2663 D12): it is taken, and it does not ask for the page.
    expect(press(input, 'ArrowUp').defaultPrevented).toBe(true)
    expect(onLeaveToPage).toHaveBeenCalledTimes(2)
    // No column of the page has a row: the page says no, and the key does nothing, as before.
    onLeaveToPage.mockReturnValue(false)
    expect(press(input, 'ArrowDown').defaultPrevented).toBe(false)
    expect(onLeaveToPage).toHaveBeenCalledTimes(3)
    // No page shows: App hands no door.
    await rerender({ onLeaveToPage: undefined })
    expect([press(input, 'ArrowRight').defaultPrevented, press(input, 'ArrowDown').defaultPrevented]).toEqual([false, false])
    expect(document.activeElement).toBe(el.querySelector('.sidebar__lens--active')) // the ↑ above went to the tab button of Search; → and ↓ moved no focus
  })

  it('S34: with text in the bar → and ↓ do what the search says, and the page is not asked', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const records = ['/v/a.md', '/v/zed/ab.md'].map(indexRecord)
    const tree: TreeNode[] = [TREE[1], { type: 'dir', name: 'zed', path: '/v/zed', children: [{ type: 'file', name: 'ab.md', path: '/v/zed/ab.md', size: 1, mtime: 1, kind: 'markdown' }] }]
    const { el } = await mount({ lens: 'search', onLeaveToPage }, (b) => {
      b.tree.mockResolvedValue({ root: '/v', tree, generatedAt: 1 })
      b.index.mockResolvedValue({ root: '/v', records, folders: [], generatedAt: 1, ids: true } as never)
    })
    const input = searchBar(el)!
    await type(input, 'a')
    expect(highlighted(el)).toBe('/v/a.md')
    // ↓ moves the highlight (YAZ-803), and → is the text's key: the caret moves (YAZ-2662 S50).
    expect(press(input, 'ArrowDown').defaultPrevented).toBe(true)
    expect(highlighted(el)).toBe('/v/zed/ab.md')
    expect(press(input, 'ArrowRight').defaultPrevented).toBe(false)
    // A bar that holds only a space is not empty: → moves the caret over the space.
    await type(input, ' ')
    expect(press(input, 'ArrowRight').defaultPrevented).toBe(false)
    expect(onLeaveToPage).not.toHaveBeenCalled()
  })
})

/**
 * A row menu asked from outside the panel (YAZ-2663 D6): a right-click on a row of the new tab page
 * makes App's `menuRequest`, and the Sidebar opens its OWN row menu for that path at the mouse. The
 * page row is a row like a search row: "Show in sidebar" first, and an item that draws INTO the
 * tree shows the row in Files first. It is no row of the sidebar, so no selection follows it.
 */
describe('a row menu asked for a path: the rows of the new tab page (YAZ-2663 D6)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /** Projects/ holding a note, and a note at the top. */
  const VAULT = (v: string): TreeNode[] => [folder(`${v}/Projects`, [note(`${v}/Projects/plan.md`)]), note(`${v}/top.md`)]
  const ITEM = 'Show in sidebar'
  const POINT = { x: 300, y: 200 }

  let vaults = 0
  const freshVault = () => `/v-ask-${++vaults}`
  /** A fresh vault and a fresh window per mount; `over` is handed the vault, so a request can be set at the mount. */
  const mountVault = async (over: (v: string) => Partial<SidebarProps> = () => ({}), tweak?: (bridge: ReturnType<typeof installBridge>, v: string) => void) => {
    const v = freshVault()
    const m = await mount({ root: v, ...over(v) }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: VAULT(v), generatedAt: 1 })
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      tweak?.(b, v)
      await storage.init()
    })
    return { ...m, v }
  }
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const click = (target: Element | null, init: MouseEventInit = {}) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const labels = (el: HTMLElement) => menuItems(el).map((b) => b.textContent)
  const selected = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((r) => r.dataset.path)
  /** The menu of a row of the Files tab, top level, in order; the menu is closed again. */
  const menuOf = (el: HTMLElement, target: Element | null) => {
    rightClick(target)
    const out = labels(el)
    closeMenu(el)
    return out
  }

  it.each(['files', 'focus'] as const)('S27: with the %s tab on show a request opens the menu of that row at the point, "Show in sidebar" first and then the menu of its row in Files, for a file and for a folder; the request is consumed one time and no selection changes', async (lens) => {
    const { el, v, props, rerender } = await mountVault(() => ({ onMenuConsumed: vi.fn() }))
    const inFiles = Object.fromEntries(['/Projects', '/top.md'].map((rel) => [rel, menuOf(el, row(el, `${v}${rel}`))]))
    expect(inFiles['/top.md']).not.toContain(ITEM)
    // One row of the sidebar is selected, and it is not the row of the request.
    click(row(el, `${v}/top.md`))
    await rerender({ lens })
    const before = selected(el)

    await rerender({ menuRequest: { id: 1, path: `${v}/Projects`, ...POINT } })
    expect(labels(el)).toEqual([ITEM, ...inFiles['/Projects']])
    const menu = el.querySelector<HTMLElement>('.ctx-menu')!
    expect([menu.style.left, menu.style.top]).toEqual(['300px', '200px'])
    expect(props.onMenuConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(selected(el)).toEqual(before)
    // The same request again is no new request: a closed menu stays closed.
    closeMenu(el)
    await rerender({ menuRequest: { id: 1, path: `${v}/Projects`, ...POINT } })
    expect(el.querySelector('.ctx-menu')).toBeNull()

    await rerender({ menuRequest: { id: 2, path: `${v}/top.md`, ...POINT } })
    expect(labels(el)).toEqual([ITEM, ...inFiles['/top.md']])
    act(() => itemByLabel(el, ITEM)?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(`${v}/top.md`)
    expect(selected(el)).toEqual(before)
  })

  it('YAZ-3235 D7, S20: a right-click on a Recents row opens the one-row menu of the file at the point, "Show in sidebar" first and then its menu in Files, and "Show in sidebar" asks App to show it in Files', async () => {
    const { el, v, props, rerender } = await mountVault(
      () => ({}),
      (b, vault) => b.state.get.mockResolvedValue({ ...defaultAppState(), folders: { [vault]: { ...defaultFolderState(), edits: { [`${vault}/top.md`]: 2000, [`${vault}/Projects/plan.md`]: 1000 } } } }),
    )
    const inFiles = menuOf(el, row(el, `${v}/top.md`))
    await rerender({ lens: 'recents' })
    const recentRows = [...el.querySelectorAll<HTMLButtonElement>('.sidebar__body [aria-label="Recents"] li > ul .tree__row')]
    expect(recentRows.map((r) => r.title)).toEqual([`${v}/top.md`, `${v}/Projects/plan.md`])
    const menuAt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })
    act(() => void recentRows[0].dispatchEvent(menuAt))
    expect(menuAt.defaultPrevented).toBe(true)
    expect(labels(el)).toEqual([ITEM, ...inFiles])
    const menu = el.querySelector<HTMLElement>('.ctx-menu')!
    expect([menu.style.left, menu.style.top]).toEqual(['300px', '200px'])
    act(() => itemByLabel(el, ITEM)?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(`${v}/top.md`)
  })

  it('S27: with text in the Search tab a request moves no highlight of the search', async () => {
    const { el, v, rerender } = await mountVault(
      () => ({ lens: 'search' }),
      (b, vault) => b.index.mockResolvedValue({ root: vault, records: ['/Projects/plan.md', '/top.md'].map((rel) => ({ ...indexRecord(`${vault}${rel}`), folder: rel.slice(1, Math.max(1, rel.lastIndexOf('/'))) })), folders: [], generatedAt: 1, ids: true } as never),
    )
    await type(searchBar(el)!, 'p') // `top` and `plan` both match
    const before = selected(el)
    expect(before).toHaveLength(1)
    const other = [`${v}/top.md`, `${v}/Projects/plan.md`].find((path) => path !== before[0])!
    await rerender({ menuRequest: { id: 1, path: other, ...POINT } })
    expect(labels(el)[0]).toBe(ITEM)
    closeMenu(el)
    expect(selected(el)).toEqual(before)
  })

  it('S30: Rename and New note on that menu show the row in Files first, as on a search row; the input then stands on the row', async () => {
    const { el, v, props, rerender } = await mountVault()
    const path = `${v}/Projects/plan.md` // inside a closed folder: Files does not draw the row yet
    expect(row(el, path)).toBeNull()
    await rerender({ menuRequest: { id: 1, path, ...POINT } })
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path)
    // What App does with that door: the Files tab, and the reveal.
    await rerender({ lens: 'files', menuRequest: null, revealRequest: { id: 1, path } })
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('plan')

    await rerender({ menuRequest: { id: 2, path: `${v}/Projects`, ...POINT }, revealRequest: null })
    act(() => itemByLabel(el, 'New note')?.click())
    expect(vi.mocked(props.onRevealInFiles).mock.calls).toEqual([[path], [`${v}/Projects`]])
  })

  it('S32: the menu is always the menu of ONE row: a request for a row inside a selection of two rows has no item that counts, and the selection stays', async () => {
    const { el, v, rerender } = await mountVault()
    click(row(el, `${v}/Projects`))
    click(row(el, `${v}/top.md`), { shiftKey: true })
    expect(selected(el)).toHaveLength(2)
    expect(menuOf(el, row(el, `${v}/top.md`))[0]).toBe('Open 2 in new tabs') // the sidebar's own right-click counts the selection
    await rerender({ menuRequest: { id: 1, path: `${v}/top.md`, ...POINT } })
    expect(labels(el)[0]).toBe(ITEM)
    expect(labels(el).filter((label) => /\d/.test(label ?? ''))).toEqual([])
    expect(labels(el)).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Add to favorites', 'Rename']))
    expect(selected(el)).toHaveLength(2)
  })

  it('a path the tree does not hold opens nothing and says nothing; the request is consumed', async () => {
    const { el, props } = await mountVault((vault) => ({ onMenuConsumed: vi.fn(), menuRequest: { id: 1, path: `${vault}/gone.md`, ...POINT } }))
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onMenuConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('S31, S29: the sidebar was hidden. A request that is set when the panel mounts waits for the tree and for the favorites of its vault, then opens the menu one time: a favorite row says "Remove from favorites"', async () => {
    let land: () => void = () => undefined
    let list: () => void = () => undefined
    const { el, props } = await mountVault(
      (vault) => ({ onMenuConsumed: vi.fn(), menuRequest: { id: 1, path: `${vault}/top.md`, ...POINT } }),
      (b, vault) => {
        b.tree.mockImplementation((r: string) => new Promise((resolve) => (land = () => resolve({ root: r, tree: VAULT(vault), generatedAt: 1 }))))
        b.favorites.get.mockImplementation(() => new Promise((resolve) => (list = () => resolve([`${vault}/top.md`]))))
      },
    )
    await act(async () => land())
    // The tree is here and the favorites are not: a menu now would say "Add to favorites" of a favorite.
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onMenuConsumed).not.toHaveBeenCalled()
    await act(async () => list())
    expect(labels(el)[0]).toBe(ITEM)
    expect(labels(el)).toContain('Remove from favorites')
    expect(props.onMenuConsumed).toHaveBeenCalledExactlyOnceWith(1)
  })
})

/**
 * "Show in sidebar" on a row (YAZ-2638 D1, D3): the FIRST item of the menu of a row of the Search
 * tab, the Focus tab and the Favorites tab — never of a row of the Files tab, of blank space, or of
 * a right-click inside a selection of two or more. A click asks App for the row in Files
 * (`onRevealInFiles`): the Files tab, the parents open, the row flashed. It opens no tab, selects no
 * row and changes no list. The S-numbers are the case record on YAZ-2638.
 */
describe('"Show in sidebar" on a row of Search, Focus and Favorites (YAZ-2638 D1, D3)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /** Projects/ holding Alpha/ and a note, and a note at the top. Projects and the top note are in the focus list and are favorites. */
  const VAULT = (v: string): TreeNode[] => [folder(`${v}/Projects`, [folder(`${v}/Projects/Alpha`, [note(`${v}/Projects/Alpha/a.md`)]), note(`${v}/Projects/plan.md`)]), note(`${v}/top.md`)]
  const LISTED = ['/Projects', '/top.md']
  const ITEM = 'Show in sidebar'

  let vaults = 0
  /** A fresh vault and a fresh window per mount, over an index of the vault's three notes. */
  const mountVault = async (over: Partial<SidebarProps> = {}) => {
    const v = `/v-show-${++vaults}`
    const listed = LISTED.map((rel) => `${v}${rel}`)
    const records = ['/Projects/Alpha/a.md', '/Projects/plan.md', '/top.md'].map((rel) => ({ ...indexRecord(`${v}${rel}`), folder: rel.slice(1, Math.max(1, rel.lastIndexOf('/'))) }))
    const m = await mount({ root: v, ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: VAULT(v), generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records, folders: [], generatedAt: 1, ids: true } as never)
      b.favorites.get.mockResolvedValue(listed)
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue(listed)
      await storage.init()
    })
    return { ...m, v }
  }
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const isOpen = (el: HTMLElement, path: string) => row(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const click = (target: Element | null, init: MouseEventInit = {}) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  /** The menu of a row, top level, in order; the menu is closed again. */
  const menuOf = (el: HTMLElement, target: Element | null) => {
    rightClick(target)
    const out = menuItems(el).map((b) => b.textContent)
    closeMenu(el)
    return out
  }
  /** The four rows a list tab can draw: a top folder, a top file, and a folder and a file inside a folder. */
  const ROWS = ['/Projects', '/top.md', '/Projects/Alpha', '/Projects/plan.md']

  it.each(['focus', 'favorites'] as const)('S34: on the %s tab each row has the item, first in the menu — a top row and a row inside a folder, a file and a folder — and the rest is the menu of its row in Files', async (lens) => {
    const { el, v, rerender } = await mountVault()
    click(row(el, `${v}/Projects`)) // open in Files
    const inFiles = Object.fromEntries(ROWS.map((rel) => [rel, menuOf(el, row(el, `${v}${rel}`))]))
    await rerender({ lens })
    click(row(el, `${v}/Projects`)) // and on the tab: its folds are its own (YAZ-3131 S2)
    for (const rel of ROWS) {
      expect(row(el, `${v}${rel}`), rel).not.toBeNull()
      expect([rel, menuOf(el, row(el, `${v}${rel}`))]).toEqual([rel, [ITEM, ...inFiles[rel]]])
    }
  })

  it('S26, S27: each search row has the item, first in the menu, before "Open folder page" and before "Add to focus" — a file, a folder, and a parent row that is no match', async () => {
    const { el, v, rerender } = await mountVault()
    const inFiles = Object.fromEntries(['/Projects', '/top.md'].map((rel) => [rel, menuOf(el, row(el, `${v}${rel}`))]))
    await rerender({ lens: 'search' })
    await type(searchBar(el)!, 'top')
    expect(menuOf(el, row(el, `${v}/top.md`))).toEqual([ITEM, ...inFiles['/top.md']])
    await type(searchBar(el)!, 'projects')
    expect(menuOf(el, row(el, `${v}/Projects`))).toEqual([ITEM, ...inFiles['/Projects']])
    expect(menuOf(el, row(el, `${v}/Projects`)).slice(0, 3)).toEqual([ITEM, 'Open folder page', 'Remove from focus'])
    await type(searchBar(el)!, 'plan')
    expect(menuOf(el, row(el, `${v}/Projects`))[0]).toBe(ITEM) // the parent of the match
  })

  it('S28, S38: a row of the Files tab never has the item, and blank space of no tab has it', async () => {
    const { el, v, rerender } = await mountVault()
    click(row(el, `${v}/Projects`))
    for (const rel of ROWS) expect([rel, menuOf(el, row(el, `${v}${rel}`)).includes(ITEM)]).toEqual([rel, false])
    for (const lens of ['files', 'focus', 'favorites'] as const) {
      await rerender({ lens })
      const blank = menuOf(el, el.querySelector('.sidebar__body'))
      expect([lens, blank.includes('New note'), blank.includes(ITEM)]).toEqual([lens, true, false])
    }
    // The Search tab has no blank-space menu at all (S19).
    await rerender({ lens: 'search' })
    expect(menuOf(el, el.querySelector('.sidebar__body'))).toEqual([])
  })

  it.each(['focus', 'favorites'] as const)('S35: on the %s tab a right-click inside a selection of two or more rows shows no such item; a row outside the selection has it again', async (lens) => {
    const { el, v } = await mountVault({ lens })
    click(row(el, `${v}/Projects`)) // a click opens the folder, and selects it (YAZ-1674 D9)
    click(row(el, `${v}/Projects/plan.md`), { shiftKey: true })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
    for (const inside of [`${v}/Projects`, `${v}/Projects/plan.md`]) {
      const plural = menuOf(el, row(el, inside))
      expect([plural[0], plural.includes(ITEM)]).toEqual(['Open 2 in new tabs', false])
    }
    // A row the selection does not hold is a fresh target: one row, so the item names it.
    expect(menuOf(el, row(el, `${v}/Projects/Alpha`))[0]).toBe(ITEM)
  })

  it.each(['focus', 'favorites'] as const)('S29, S30, S36: on the %s tab a click asks for the row in Files — it opens no file and changes no list — and App\'s reveal opens each parent folder and flashes the row, which is not selected', async (lens) => {
    const { el, v, props, bridge, rerender } = await mountVault({ lens })
    bridge.window.setIdentity.mockClear()
    const path = `${v}/Projects/plan.md`
    click(row(el, `${v}/Projects`))
    rightClick(row(el, path))
    act(() => itemByLabel(el, ITEM)?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    expect(props.onLensChange).not.toHaveBeenCalled() // the Files tab is App's to show, through the reveal door
    // S36: the focus list and the favorites stay as they were.
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(bridge.focus.set).not.toHaveBeenCalled()
    // What App does with the request: the Files tab, and the reveal. The parent folder is closed there.
    click(row(el, `${v}/Projects`))
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
    await rerender({ lens: 'files', revealRequest: { id: 1, path } })
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(row(el, path)?.classList.contains('tree__row--revealed')).toBe(true)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('S29 to S31, S33: on a search row a click asks for the row in Files and opens no file; a folder row opens itself too, and the text stays in the Search tab', async () => {
    const { el, v, props, rerender } = await mountVault({ lens: 'search' })
    await type(searchBar(el)!, 'alpha')
    const path = `${v}/Projects/Alpha`
    rightClick(row(el, path))
    act(() => itemByLabel(el, ITEM)?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    await rerender({ lens: 'files', revealRequest: { id: 1, path } })
    expect([isOpen(el, `${v}/Projects`), isOpen(el, path)]).toEqual(['true', 'true']) // S31: the folder opens itself too
    expect(row(el, path)?.classList.contains('tree__row--revealed')).toBe(true)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    await rerender({ lens: 'search', revealRequest: null })
    expect(searchBar(el)?.value).toBe('alpha') // S33
    // A file row: the same door.
    await type(searchBar(el)!, 'top')
    rightClick(row(el, `${v}/top.md`))
    act(() => itemByLabel(el, ITEM)?.click())
    expect(props.onRevealInFiles).toHaveBeenLastCalledWith(`${v}/top.md`)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })
})

/**
 * Folders in the search (YAZ-1491). 🔒 D1: the rows come from the tree the Sidebar already
 * holds (`dirs`), not from the index feed. 🔒 D2: the same matcher — a folder is one row, a note
 * still never matches on its folder. Since YAZ-2620 the row is the folder's own TREE row: Enter
 * SHOWS it in Files, the keyboard focus on its row (YAZ-2662 D1) — `onRevealInFiles` — and ⌘-Enter
 * opens its page in a background tab, from EITHER lens; a click folds it and a double-click opens
 * it, as on Files (D1 there). The Files reveal path accepts a DIR (Enter's door, and the row
 * menu's): ancestors AND the dir itself open, the dir row flashes.
 */
describe('folder rows in search (YAZ-1491)', () => {
  const rowLabels = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row .tree__label')].map((n) => n.textContent)
  const dirResult = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__body .tree__row--dir')
  const press = (input: HTMLInputElement, key: string, metaKey = false) =>
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))
  const clickRow = (row: Element | null, metaKey = false) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey })))
  const dirRow = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')].find((row) => row.querySelector('.tree__label')?.textContent === label)
  const expandedState = (el: HTMLElement, label: string) => dirRow(el, label)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')

  /** A folder AND a note both called `sub`, so the tie-break is observable. */
  const SUB_NOTE = { path: '/v/sub.md', name: 'sub.md', basename: 'sub', title: 'sub', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
  const SUB_TREE: TreeNode[] = [...TREE, { type: 'file', name: 'sub.md', path: '/v/sub.md', size: 1, mtime: 1, kind: 'markdown' }]
  const search = async (query: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over, (b) => {
      b.tree.mockResolvedValue({ root: '/v', tree: SUB_TREE, generatedAt: 1 })
      b.index.mockResolvedValue({ root: '/v', records: [SUB_NOTE], folders: [], generatedAt: 1, ids: true } as never)
    })
    const input = searchInput(m.el)!
    await type(input, query)
    return { ...m, input }
  }

  it('a folder of the loaded tree is a row — its own tree row, above the same-named note — and the tie is the folder\'s (🔒 D1/D2, S19)', async () => {
    const { el } = await search('sub')
    expect(rowLabels(el)).toEqual(['sub', 'sub'])
    const [folder, note] = [...el.querySelectorAll('.sidebar__body .tree__row')]
    expect(folder.classList.contains('tree__row--dir')).toBe(true)
    expect(note.classList.contains('tree__row--dir')).toBe(false)
    // Both names are exact: the folder is ranked first, so the highlight starts on it.
    expect(folder.classList.contains('tree__row--selected')).toBe(true)
    expect(note.classList.contains('tree__row--selected')).toBe(false)
  })

  it('E: a folder is found by its title, off the search\'s own index read, and its row shows that title (YAZ-2420 D14)', async () => {
    const folders = [{ ...indexRecord('/v/sub/.folder.md'), title: 'Upwork 2026' }]
    const indexSource = createWikilinkResolveSource()
    act(() => indexSource.update(() => null, [], folders, true))
    const m = await mount({ indexSource }, (b) => b.index.mockResolvedValue({ root: '/v', records: [], folders, generatedAt: 1, ids: true } as never))
    await type(searchInput(m.el)!, 'upwork')
    expect(dirResult(m.el)?.dataset.path).toBe('/v/sub')
    expect(rowLabels(m.el)).toEqual(['Upwork 2026'])
  })

  it('S1 (YAZ-2662 D1): Enter on a folder in the search results asks for the folder in Files, the keyboard focus on its row — no page opens', async () => {
    const { el, input, props } = await search('sub')
    expect(dirResult(el)?.classList.contains('tree__row--selected')).toBe(true)
    await press(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub', true)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('⌘-Enter on a folder row opens it in a background tab, as a note does', async () => {
    const { input, props } = await search('sub')
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
  })

  it('S27: a click on a folder row folds it, as on Files — it no longer opens the page, nor does a double-click (YAZ-3377 D1, S8)', async () => {
    const { el, props } = await search('sub')
    const before = dirResult(el)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
    clickRow(dirResult(el))
    expect(dirResult(el)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).not.toBe(before)
    clickRow(dirResult(el), true)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    act(() => void dirResult(el)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(props.onKeepFile).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
  })

  it('Enter on the folder whose page is already open shows it in Files too — a folder has no "take me in" (YAZ-2662 D1)', async () => {
    const { input, props } = await search('sub', { activeFile: '/v/sub' })
    await press(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub', true)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('the folder result\'s right-click menu is the folder row\'s own menu, "Reveal in Finder" included, plus `Show in sidebar` first (YAZ-2638 D1)', async () => {
    const { el, props } = await search('sub')
    act(() => void dirResult(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((b) => b.textContent)).toEqual(expect.arrayContaining(['Open folder page', 'Add to focus', 'Rename']))
    expect(subItemByLabel(el, 'Reveal in Finder')).toBeDefined()
    // The tree-drawing items still leave the search through the reveal door.
    await act(async () => itemByLabel(el, 'New note')?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })

  it('the note row beneath still OPENS — the rule is per row, not per list', async () => {
    const { input, props } = await search('sub')
    await press(input, 'ArrowDown')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub.md')
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
  })

  it('shown from the FAVORITES lens a folder row is shown in Files too (whichever tab was showing)', async () => {
    const { el, input, props } = await search('sub', { lens: 'favorites' })
    expect(dirResult(el)).not.toBeNull()
    await press(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub', true)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('a Files reveal request for a folder, as its row menu issues, flashes the folder row, and the query stays in the Search tab (YAZ-2638 S22)', async () => {
    const { el, props, rerender } = await search('sub')
    // What `revealInFiles` in App does: the Files lens, and the request.
    await rerender({ lens: 'files', revealRequest: { id: 1, path: '/v/sub' } })
    expect(searchBar(el)).toBeNull()
    expect(dirRow(el, 'sub')?.classList.contains('tree__row--revealed')).toBe(true)
    expect(props.onNotice).not.toHaveBeenCalled()
    await rerender({ lens: 'search' })
    expect(searchBar(el)?.value).toBe('sub')
  })

  it('a Files reveal request for a DIR opens its ancestors AND itself and flashes its row — no "no longer there"', async () => {
    // Its own root: expansion persists PER ROOT across the tests in this file, so a sibling under
    // `/v` could already be open from an earlier click. Nothing has ever touched `/w`.
    const DIR = '/w/target/deep'
    const DEEP_TREE: TreeNode[] = [
      { type: 'dir', name: 'other', path: '/w/other', children: [] },
      {
        type: 'dir', name: 'target', path: '/w/target',
        children: [{
          type: 'dir', name: 'deep', path: DIR,
          children: [{ type: 'file', name: 'Note.md', path: `${DIR}/Note.md`, size: 1, mtime: 1, kind: 'markdown' }],
        }],
      },
    ]
    const { el, props } = await mount(
      { root: '/w', revealRequest: { id: 1, path: DIR } },
      (b) => b.tree.mockResolvedValue({ root: '/w', tree: DEEP_TREE, generatedAt: 1 }),
    )
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(expandedState(el, 'target')).toBe('true')
    expect(expandedState(el, 'deep')).toBe('true') // the folder opens ITSELF too
    expect(expandedState(el, 'other')).toBe('false')
    expect(el.querySelector(`.tree__row--dir[data-path="${DIR}"]`)?.classList.contains('tree__row--revealed')).toBe(true)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a reveal for a folder the tree no longer has still reports the passive notice', async () => {
    const { props } = await mount({ revealRequest: { id: 1, path: '/v/gone' } })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "gone" in Files — it is no longer there', 'error')
  })
})

/**
 * The keys that show a row in Files, and the arrows on a sidebar tree (YAZ-2662 D1, D8, D11). Enter
 * on a FOLDER of the search tree, and Shift+Enter on any row, ask App for the row in Files with the
 * keyboard focus on it (`onRevealInFiles(path, true)`); ⌘ is read first. "Show in sidebar" in a
 * row's menu asks for the row alone and moves no focus (S12). On a row of Files, Focus or Favorites
 * ↓ and ↑ move the keyboard focus, and → and ← fold a folder row: no selection, no page.
 */
describe('Enter and Shift+Enter show a row in Files; the arrows walk a sidebar tree (YAZ-2662 D1, D8, D11)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /** Projects/ holding Alpha/ and a note; a file the app cannot show; a note at the top. Projects and the top note are in the focus list and are favorites. */
  const VAULT = (v: string): TreeNode[] => [
    folder(`${v}/Projects`, [folder(`${v}/Projects/Alpha`, [note(`${v}/Projects/Alpha/a.md`)]), note(`${v}/Projects/plan.md`)]),
    { type: 'file', name: 'book.epub', path: `${v}/book.epub`, size: 1, mtime: 1, kind: null },
    note(`${v}/top.md`),
  ]

  let vaults = 0
  /** A fresh vault and a fresh window per mount — the folds persist per root across this file — over an index of the vault's three notes. */
  const mountVault = async (over: Partial<SidebarProps> = {}) => {
    const v = `/v-keys-${++vaults}`
    const listed = [`${v}/Projects`, `${v}/top.md`]
    const records = ['/Projects/Alpha/a.md', '/Projects/plan.md', '/top.md'].map((rel) => ({ ...indexRecord(`${v}${rel}`), folder: rel.slice(1, Math.max(1, rel.lastIndexOf('/'))) }))
    const m = await mount({ root: v, ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: VAULT(v), generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records, folders: [], generatedAt: 1, ids: true } as never)
      b.favorites.get.mockResolvedValue(listed)
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue(listed)
      await storage.init()
    })
    return { ...m, v }
  }
  /** The Search tab with `query` typed and the caret in the bar. */
  const search = async (query: string) => {
    const m = await mountVault({ lens: 'search' })
    const input = searchBar(m.el)!
    act(() => input.focus())
    await type(input, query)
    return { ...m, input }
  }
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const isOpen = (el: HTMLElement, path: string) => row(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const labels = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row .tree__label')].map((n) => n.textContent)
  const flashes = (el: HTMLElement, path: string) => row(el, path)?.classList.contains('tree__row--revealed')
  /** A key on `target`, as the keyboard sends it; the event comes back, so a test can ask whether the key was taken. */
  const key = (target: Element | null, name: string, mods: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...mods })
    act(() => void target?.dispatchEvent(event))
    return event
  }
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  /** The label of the row that has the keyboard focus. */
  const focused = () => document.activeElement?.querySelector('.tree__label')?.textContent ?? null

  it('S1, S2, S6: Enter on a folder asks for it in Files with the focus on its row, and Shift+Enter does the same; no tab opens. In Files the folders above it and the folder are open, its row flashes and has the keyboard focus; the text stays in the Search tab', async () => {
    const { el, v, input, props, rerender } = await search('alpha')
    const path = `${v}/Projects/Alpha`
    key(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path, true)
    key(input, 'Enter', { shiftKey: true }) // S6
    expect(vi.mocked(props.onRevealInFiles).mock.calls).toEqual([[path, true], [path, true]])
    for (const open of [props.onOpenFile, props.onOpenFileBackground, props.onKeepFile]) expect(open).not.toHaveBeenCalled()
    // What App's `revealInFiles` does with it: Files, and the request with its focus flag.
    await rerender({ lens: 'files', revealRequest: { id: 1, path, focus: true } })
    expect([isOpen(el, `${v}/Projects`), isOpen(el, path)]).toEqual(['true', 'true'])
    expect(flashes(el, path)).toBe(true)
    expect(document.activeElement).toBe(row(el, path))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    for (const open of [props.onOpenFile, props.onOpenFileBackground, props.onKeepFile]) expect(open).not.toHaveBeenCalled()
    // S2: ⌘K shows the Search tab with the same text, selected, and the same search tree.
    await rerender({ lens: 'search', revealRequest: null, pendingSearchFocus: true })
    const bar = searchBar(el)!
    expect([bar.value, bar.value.slice(bar.selectionStart ?? 0, bar.selectionEnd ?? 0), document.activeElement === bar, labels(el)]).toEqual(['alpha', 'alpha', true, ['Projects', 'Alpha']])
  })

  it('S1: the keyboard focus goes to the row one time for each request — a folder above it that is closed and opened again later moves no focus', async () => {
    const { el, v, rerender } = await mountVault()
    const path = `${v}/Projects/Alpha`
    await rerender({ revealRequest: { id: 1, path, focus: true } })
    expect(document.activeElement).toBe(row(el, path))
    key(document.activeElement, 'ArrowUp')
    key(document.activeElement, 'ArrowLeft')
    expect([focused(), row(el, path)]).toEqual(['Projects', null])
    key(document.activeElement, 'ArrowRight')
    expect([focused(), row(el, path) !== null]).toEqual(['Projects', true])
    // The same row asked for again is a new request: the focus goes to it again.
    await rerender({ revealRequest: { id: 2, path, focus: true } })
    expect(document.activeElement).toBe(row(el, path))
  })

  it('S3, S7: ⌘Enter on a folder opens the folder page in a background tab, and ⌘ is read first — ⌘ with Shift and Enter is ⌘Enter, on a folder and on a file', async () => {
    const { v, input, props } = await search('alpha')
    key(input, 'Enter', { metaKey: true })
    key(input, 'Enter', { metaKey: true, shiftKey: true })
    await type(input, 'top')
    key(input, 'Enter', { metaKey: true, shiftKey: true })
    expect(vi.mocked(props.onOpenFileBackground).mock.calls).toEqual([[`${v}/Projects/Alpha`], [`${v}/Projects/Alpha`], [`${v}/top.md`]])
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onLensChange).not.toHaveBeenCalled() // the Search tab stays
  })

  it('S4, S5: Enter on a file opens it, as before; Shift+Enter asks for the file in Files with the focus on its row and opens no tab. In Files the folders above the file are open, its row flashes and has the keyboard focus', async () => {
    const { el, v, input, props, rerender } = await search('plan')
    const path = `${v}/Projects/plan.md`
    key(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(path)
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    key(input, 'Enter', { shiftKey: true })
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path, true)
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    await rerender({ lens: 'files', revealRequest: { id: 1, path, focus: true } })
    expect([isOpen(el, `${v}/Projects`), flashes(el, path), document.activeElement === row(el, path)]).toEqual(['true', true, true])
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
  })

  it('S8: a file that the app cannot show — Enter and ⌘Enter open it in its default app, as before, and Shift+Enter asks for it in Files', async () => {
    const { v, input, props, bridge } = await search('book')
    const path = `${v}/book.epub`
    key(input, 'Enter')
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path })
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    key(input, 'Enter', { shiftKey: true })
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(path, true)
    expect(bridge.shell.openDefault).toHaveBeenCalledTimes(1)
    key(input, 'Enter', { metaKey: true, shiftKey: true }) // S7: ⌘ is read first
    expect(bridge.shell.openDefault).toHaveBeenCalledTimes(2)
    expect(props.onRevealInFiles).toHaveBeenCalledTimes(1)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('S10: the row is gone from the disk when the request arrives — the notice shows, and no focus moves', async () => {
    const { el, v, props, rerender } = await mountVault()
    const before = document.activeElement
    await rerender({ revealRequest: { id: 1, path: `${v}/Projects/Gone`, focus: true } })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "Gone" in Files — it is no longer there', 'error')
    expect(document.activeElement).toBe(before)
    expect(el.querySelector('.tree__row--revealed')).toBeNull()
  })

  it('S12: "Show in sidebar" in the menu of a row asks for the row alone — in Files its row flashes and gets no keyboard focus', async () => {
    const { el, v, props, rerender } = await search('alpha')
    const path = `${v}/Projects/Alpha`
    rightClick(row(el, path))
    act(() => itemByLabel(el, 'Show in sidebar')?.click())
    expect(vi.mocked(props.onRevealInFiles).mock.calls).toEqual([[path]]) // no focus flag
    await rerender({ lens: 'files', revealRequest: { id: 1, path } })
    expect(flashes(el, path)).toBe(true)
    expect(document.activeElement).not.toBe(row(el, path))
  })

  it.each(['files', 'focus', 'favorites'] as const)('S61, S63: on the %s tab ↓ moves the keyboard focus to the next row on show and ↑ to the row before; ↓ stops at the last row, and they change no selection and open no page', async (lens) => {
    const { el, v, props, rerender } = await mountVault()
    await rerender({ lens })
    act(() => row(el, `${v}/Projects`)?.focus())
    key(document.activeElement, 'ArrowRight') // the rows inside the folder are on show
    const rows = labels(el)
    expect(rows).toEqual(lens === 'files' ? ['Projects', 'Alpha', 'plan', 'book.epub', 'top'] : ['Projects', 'Alpha', 'plan', 'top'])
    const walk = (name: string, times: number) => Array.from({ length: times }, () => [key(document.activeElement, name).defaultPrevented, focused()])
    expect(walk('ArrowDown', rows.length)).toEqual([...rows.slice(1), rows.at(-1)].map((label) => [true, label])) // ↓ stops on the last row
    expect(walk('ArrowUp', rows.length - 1)).toEqual(rows.slice(0, -1).reverse().map((label) => [true, label]))
    // ↑ on the first row goes on to the tab button of the tab that shows (YAZ-2663 D12), and ↓ there comes back into the rows.
    key(document.activeElement, 'ArrowUp')
    expect(document.activeElement).toBe(el.querySelector('.sidebar__lens--active'))
    key(document.activeElement, 'ArrowDown')
    expect(focused()).toBe('Projects')
    expect(labels(el)).toEqual(rows) // ↓ and ↑ fold nothing
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    for (const open of [props.onOpenFile, props.onOpenFileBackground, props.onKeepFile]) expect(open).not.toHaveBeenCalled()
  })

  it('S62, S63: → opens a closed folder row and ← closes an open one, and the focus stays on the row; → on an open folder, ← on a closed folder, and both on a file row do nothing', async () => {
    const { el, v, props } = await mountVault()
    const dir = `${v}/Projects`
    act(() => row(el, dir)?.focus())
    const fold = (name: string) => {
      key(document.activeElement, name)
      return [isOpen(el, dir), focused()]
    }
    expect(fold('ArrowLeft')).toEqual(['false', 'Projects']) // closed already
    expect(fold('ArrowRight')).toEqual(['true', 'Projects'])
    expect(fold('ArrowRight')).toEqual(['true', 'Projects']) // open already: the focus does not go into it
    expect(fold('ArrowLeft')).toEqual(['false', 'Projects'])
    act(() => row(el, `${v}/top.md`)?.focus())
    const rows = labels(el)
    expect([fold('ArrowRight'), fold('ArrowLeft')]).toEqual([['false', 'top'], ['false', 'top']])
    expect(labels(el)).toEqual(rows)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    for (const open of [props.onOpenFile, props.onOpenFileBackground, props.onKeepFile]) expect(open).not.toHaveBeenCalled()
  })

  it.each(['files', 'focus', 'favorites'] as const)('YAZ-2663 D8: on the %s tab → on a row that has nothing to open — a file row, an open folder row — asks for the new tab page; a closed folder still opens and does not ask, and ← never asks; when the page says no, and with no page, the key does what it did', async (lens) => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, v, rerender } = await mountVault()
    await rerender({ lens, onLeaveToPage })
    const dir = `${v}/Projects`
    act(() => row(el, dir)?.focus())
    key(document.activeElement, 'ArrowRight') // closed: it opens, and the page is not asked
    expect([isOpen(el, dir), onLeaveToPage.mock.calls.length]).toEqual(['true', 0])
    expect(key(document.activeElement, 'ArrowRight').defaultPrevented).toBe(true) // open already: nothing to open
    expect([isOpen(el, dir), onLeaveToPage.mock.calls.length]).toEqual(['true', 1])
    key(document.activeElement, 'ArrowLeft')
    expect([isOpen(el, dir), onLeaveToPage.mock.calls.length]).toEqual(['false', 1])
    act(() => row(el, `${v}/top.md`)?.focus())
    key(document.activeElement, 'ArrowLeft')
    expect(onLeaveToPage).toHaveBeenCalledTimes(1)
    key(document.activeElement, 'ArrowRight')
    expect(onLeaveToPage).toHaveBeenCalledTimes(2)
    // A → with a modifier is a shortcut of the window: the page is not asked.
    key(document.activeElement, 'ArrowRight', { metaKey: true })
    expect(onLeaveToPage).toHaveBeenCalledTimes(2)
    // The page says no (no column has a row), and then no page shows: the focus stays on the row (S62).
    onLeaveToPage.mockReturnValue(false)
    key(document.activeElement, 'ArrowRight')
    await rerender({ onLeaveToPage: undefined })
    key(document.activeElement, 'ArrowRight')
    expect([onLeaveToPage.mock.calls.length, focused()]).toEqual([3, 'top'])
  })

  it.each(['files', 'focus', 'favorites'] as const)('YAZ-2663 D10: on the %s tab, with the keyboard on nothing or on a tab button of the sidebar, ↓ or ↑ puts the focus on a row, and → asks for the new tab page; a field, a modifier and a row keep their keys', async (lens) => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, v, rerender } = await mountVault()
    await rerender({ lens, onLeaveToPage })
    expect(document.activeElement).toBe(document.body)
    expect([key(document.body, 'ArrowDown').defaultPrevented, focused()]).toEqual([true, 'Projects'])
    act(() => (document.activeElement as HTMLElement).blur())
    const tab = el.querySelector<HTMLElement>('.sidebar__lens--active')
    act(() => tab?.focus())
    // On the tab button of the tab that shows, ↓ goes into its rows. ↑ has nowhere to go (D12).
    expect([key(tab, 'ArrowUp').defaultPrevented, document.activeElement]).toEqual([true, tab])
    expect([key(tab, 'ArrowDown').defaultPrevented, focused()]).toEqual([true, 'Projects'])
    // → from nowhere goes to the page (D8's door). On a row, → is the row's.
    act(() => (document.activeElement as HTMLElement).blur())
    expect([key(document.body, 'ArrowRight').defaultPrevented, onLeaveToPage.mock.calls.length]).toEqual([true, 1])
    onLeaveToPage.mockReturnValue(false)
    expect(key(document.body, 'ArrowRight').defaultPrevented).toBe(false)
    // A key with a modifier, and a key in a field, are not the sidebar's.
    expect(key(document.body, 'ArrowDown', { metaKey: true }).defaultPrevented).toBe(false)
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    expect([key(field, 'ArrowDown').defaultPrevented, document.activeElement]).toEqual([false, field])
    field.remove()
    // With the row of the open page on show, the keyboard starts there.
    if (lens === 'files') {
      await rerender({ activeFile: `${v}/top.md` })
      expect([key(document.body, 'ArrowDown').defaultPrevented, focused()]).toEqual([true, 'top'])
    }
  })

  it('YAZ-2663 D12: on the Search tab, with the keyboard on nothing, ↓ or ↑ puts the caret in the search bar, and → asks for the new tab page', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, rerender } = await mountVault()
    await rerender({ lens: 'search', onLeaveToPage })
    expect(document.activeElement).toBe(document.body)
    expect([key(document.body, 'ArrowDown').defaultPrevented, document.activeElement]).toEqual([true, searchBar(el)])
    act(() => searchBar(el)?.blur())
    expect([key(document.body, 'ArrowUp').defaultPrevented, document.activeElement]).toEqual([true, searchBar(el)])
    act(() => searchBar(el)?.blur())
    expect([key(document.body, 'ArrowRight').defaultPrevented, onLeaveToPage.mock.calls.length]).toEqual([true, 1])
  })

  it('YAZ-2663 D12: the tabs of the sidebar from the keyboard — ↑ on the first row goes to the tab button of the tab that shows; ← and → move between the tab buttons and stop at both ends; ↓ on a tab that does not show asks for it, as Enter does', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, v, props, rerender } = await mountVault()
    await rerender({ onLeaveToPage })
    const tabs = [...el.querySelectorAll<HTMLElement>('.sidebar__lens')]
    const onTab = () => tabs.indexOf(document.activeElement as HTMLElement)
    act(() => row(el, `${v}/top.md`)?.focus())
    key(document.activeElement, 'ArrowUp')
    expect(focused()).not.toBe('top') // a row above it: ↑ walks, as before
    act(() => row(el, `${v}/Projects`)?.focus()) // the first row
    expect([key(document.activeElement, 'ArrowUp').defaultPrevented, onTab()]).toEqual([true, 0]) // Files
    // ← and → on the tab buttons: Files, Search, Focus, Favorites, Sessions, Recents. → never goes to the page from here.
    const walk = ['ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'].map((name) => [key(document.activeElement, name).defaultPrevented, onTab()])
    expect(walk).toEqual([[true, 0], [true, 1], [true, 2], [true, 3], [true, 4], [true, 5], [true, 5], [true, 4], [true, 3]])
    expect(onLeaveToPage).not.toHaveBeenCalled()
    // ↓ on a tab that does not show: the tab is asked for, and the keyboard stays on its button.
    vi.mocked(props.onLensChange).mockClear()
    expect([key(document.activeElement, 'ArrowDown').defaultPrevented, onTab()]).toEqual([true, 3])
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('favorites')
    await rerender({ lens: 'favorites' })
    // It shows now: ↓ goes into its rows.
    key(document.activeElement, 'ArrowDown')
    expect(document.activeElement?.matches('.tree__row')).toBe(true)
  })


  it('YAZ-2663 D10: Esc on a row with no selection goes to the page on show — the open page, else the new tab page; with a selection Esc ends the selection, as before', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el, v, rerender } = await mountVault()
    await rerender({ onLeaveToPage })
    act(() => row(el, `${v}/top.md`)?.focus())
    expect([key(document.activeElement, 'Escape').defaultPrevented, onLeaveToPage.mock.calls.length]).toEqual([true, 1])
    const pm = editorStub()
    act(() => row(el, `${v}/top.md`)?.focus())
    key(document.activeElement, 'Escape')
    expect([document.activeElement, onLeaveToPage.mock.calls.length]).toEqual([pm, 1])
    pm.remove()
    // A click selects the row (D9): the first Esc ends the selection and the keyboard stays.
    act(() => row(el, `${v}/top.md`)?.click())
    act(() => row(el, `${v}/top.md`)?.focus())
    key(document.activeElement, 'Escape')
    expect([el.querySelectorAll('.tree__row--selected').length, onLeaveToPage.mock.calls.length, focused()]).toEqual([0, 1, 'top'])
  })

  describe('Space on a file row of a sidebar tree shows the preview panel (YAZ-2663 D11)', () => {
    afterEach(() => vi.useRealTimers())
    const walk = async (lens: 'files' | 'focus' | 'favorites' = 'files') => {
      const m = await mountVault()
      await m.rerender({ lens })
      act(() => row(m.el, `${m.v}/Projects`)?.focus())
      key(document.activeElement, 'ArrowRight') // the rows inside the folder are on show
      const onPreview = vi.mocked(m.props.onPreview)
      onPreview.mockClear()
      vi.useFakeTimers()
      return { ...m, onPreview, wait: (ms: number) => act(() => void vi.advanceTimersByTime(ms)), panel: () => previewPanel?.path?.slice(m.v.length) ?? null, opened: () => [m.props.onOpenFile, m.props.onKeepFile, m.props.onOpenFileBackground].reduce((n, door) => n + vi.mocked(door).mock.calls.length, 0) }
    }

    it.each(['files', 'focus', 'favorites'] as const)('S59, S60: on the %s tab Space on a file row shows the panel on that file, at once, and opens no tab; Space again closes it; a held Space acts one time', async (lens) => {
      const { el, v, panel, opened } = await walk(lens)
      act(() => row(el, `${v}/top.md`)?.focus())
      expect([key(document.activeElement, ' ').defaultPrevented, panel(), opened(), focused()]).toEqual([true, '/top.md', 0, 'top'])
      expect([key(document.activeElement, ' ', { repeat: true }).defaultPrevented, panel()]).toEqual([true, '/top.md'])
      key(document.activeElement, ' ')
      expect([panel(), opened()]).toEqual([null, 0])
    })

    it('S61: with the panel on show it follows the keyboard focus 120 ms after its last move; on a folder row no panel is drawn, at once, and it comes back on the next file', async () => {
      const { el, v, panel, wait } = await walk()
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      key(document.activeElement, 'ArrowUp') // book.epub or plan: the row before, a file
      const before = focused()
      wait(119)
      expect(panel()).toBe('/top.md') // the earlier file stays until the wait is over
      wait(1)
      expect(panel()).not.toBe('/top.md')
      expect(panel()).not.toBeNull()
      act(() => row(el, `${v}/Projects`)?.focus())
      expect(panel()).toBeNull() // a folder: no panel, at once
      act(() => row(el, `${v}/top.md`)?.focus())
      wait(120)
      expect([panel(), before === 'top']).toEqual(['/top.md', false])
    })

    it('S62: Space on a folder row folds it, as before, and shows no panel', async () => {
      const { el, v, onPreview } = await walk()
      act(() => row(el, `${v}/Projects`)?.focus())
      expect([key(document.activeElement, ' ').defaultPrevented, onPreview.mock.calls]).toEqual([false, []])
    })

    it('S63: Esc with the panel on show closes the panel only, and the keyboard stays on the row; Enter on a row opens it and closes the panel; a click on a row closes the panel', async () => {
      const onLeaveToPage = vi.fn(() => true)
      const { el, v, panel, rerender, props } = await walk()
      await rerender({ onLeaveToPage })
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      expect([key(document.activeElement, 'Escape').defaultPrevented, panel(), focused(), onLeaveToPage.mock.calls.length]).toEqual([true, null, 'top', 0])
      key(document.activeElement, ' ')
      expect(panel()).toBe('/top.md')
      key(document.activeElement, 'Enter')
      act(() => row(el, `${v}/top.md`)?.click()) // Enter on a file row is the button's own click, which the key makes
      expect([panel(), vi.mocked(props.onOpenFile).mock.calls.length]).toEqual([null, 1])
      // A click of the MOUSE on a row closes the panel too (the rule of YAZ-2662 S65).
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      expect(panel()).toBe('/top.md')
      act(() => void row(el, `${v}/top.md`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
      expect(panel()).toBeNull()
    })

    it('S65: Space on a folder row folds it and the preview stays on — the next file row shows the panel again', async () => {
      const { el, v, panel, wait } = await walk()
      const dir = `${v}/Projects`
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      act(() => row(el, dir)?.focus())
      expect([panel(), isOpen(el, dir)]).toEqual([null, 'true'])
      // Space on the folder: the key is the button's, and the click that it makes has no mouse in it (`detail` 0).
      expect(key(document.activeElement, ' ').defaultPrevented).toBe(false)
      act(() => void row(el, dir)?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
      expect(isOpen(el, dir)).toBe('false')
      act(() => row(el, `${v}/top.md`)?.focus())
      wait(120)
      expect(panel()).toBe('/top.md')
    })

    it('S64: the panel closes when a different tab of the sidebar shows, and when the keyboard goes to the page', async () => {
      const { el, v, panel, rerender } = await walk()
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      await rerender({ lens: 'favorites' })
      expect(panel()).toBeNull()
      await rerender({ lens: 'files' })
      act(() => row(el, `${v}/top.md`)?.focus())
      key(document.activeElement, ' ')
      expect(panel()).toBe('/top.md')
      const outside = document.createElement('button')
      document.body.append(outside)
      act(() => outside.focus())
      expect(panel()).toBeNull()
      outside.remove()
    })
  })

  it('S63: Enter on a row, and Space on a folder row, do what they did before — the arrows\' handler takes neither key; Space on a FILE row is the preview\'s now (YAZ-2663 D11)', async () => {
    const { el, v, props } = await mountVault()
    // Enter on a folder row opens its page (YAZ-2290 D3): the row's own key.
    expect(key(row(el, `${v}/Projects`), 'Enter').defaultPrevented).toBe(true)
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Projects`)
    // Space on a folder row, and Enter on a file row, are the button's own click. Space on a file row is taken: it shows the preview panel.
    expect([key(row(el, `${v}/Projects`), ' '), key(row(el, `${v}/top.md`), 'Enter'), key(row(el, `${v}/top.md`), ' ')].map((event) => event.defaultPrevented)).toEqual([false, false, true])
    expect(props.onOpenFile).toHaveBeenCalledTimes(1) // Space opened no page
  })

  it('D1, D8: a held Enter on a row does nothing — Enter and Shift+Enter in the search bar put the keyboard focus on a row of Files, and the repeats of that press arrive there: a folder row and a file row, with Shift and without, open no page, fold nothing and select nothing', async () => {
    const { el, v, props } = await mountVault()
    const held = (path: string, mods: KeyboardEventInit = {}) => key(row(el, path), 'Enter', { repeat: true, ...mods }).defaultPrevented
    // Taken, so the button's own click does not follow: on a folder row it folds, on a file row it opens, and with Shift it toggles the row in the selection.
    expect([held(`${v}/Projects`), held(`${v}/Projects`, { shiftKey: true }), held(`${v}/top.md`), held(`${v}/top.md`, { shiftKey: true }), held(`${v}/book.epub`)]).toEqual([true, true, true, true, true])
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    for (const open of [props.onOpenFile, props.onOpenFileBackground, props.onKeepFile]) expect(open).not.toHaveBeenCalled()
    // A press that is no repeat is the row's own, as before.
    expect(key(row(el, `${v}/top.md`), 'Enter').defaultPrevented).toBe(false)
    key(row(el, `${v}/Projects`), 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Projects`)
  })

  it('D1, D8: a held Enter on a row of the search tree does nothing too, and a rename box keeps its Enter — a box is no row', async () => {
    const { el, v, props, rerender } = await search('alpha')
    expect(key(row(el, `${v}/Projects/Alpha`), 'Enter', { repeat: true }).defaultPrevented).toBe(true)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    await rerender({ lens: 'files' })
    const box = () => el.querySelector<HTMLInputElement>('.sidebar__body .create-inline__input')
    rightClick(row(el, `${v}/top.md`))
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(document.activeElement).toBe(box())
    // Enter in the box is its commit: with the name as it was, the box closes and nothing is renamed.
    await act(async () => void box()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })))
    expect(box()).toBeNull()
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('S4: a held Enter in the search bar is ONE Enter — the repeats of the press that previews a file are taken and do nothing, so no repeat is the second Enter that takes the caret into the page', async () => {
    const page = editorStub()
    const { v, input, props, rerender } = await search('plan')
    const path = `${v}/Projects/plan.md`
    key(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(path)
    await rerender({ activeFile: path }) // App shows the page
    expect(Array.from({ length: 3 }, () => key(input, 'Enter', { repeat: true }).defaultPrevented)).toEqual([true, true, true])
    expect([document.activeElement === input, vi.mocked(props.onOpenFile).mock.calls.length]).toEqual([true, 1])
    // A held Shift+Enter and a held ⌘Enter are one press too.
    key(input, 'Enter', { repeat: true, shiftKey: true })
    key(input, 'Enter', { repeat: true, metaKey: true })
    expect([vi.mocked(props.onRevealInFiles).mock.calls, vi.mocked(props.onOpenFileBackground).mock.calls]).toEqual([[], []])
    // A new press is the second Enter (YAZ-961).
    key(input, 'Enter')
    expect(document.activeElement).toBe(page)
    page.parentElement?.remove()
  })

  it('S64: the arrows do nothing while a rename box or a create box has the focus', async () => {
    const { el, v } = await mountVault()
    const box = () => el.querySelector<HTMLInputElement>('.sidebar__body .create-inline__input')
    for (const item of ['Rename', 'New note']) {
      rightClick(row(el, `${v}/top.md`))
      act(() => itemByLabel(el, item)?.click())
      expect([item, document.activeElement === box()]).toEqual([item, true])
      const taken = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].map((name) => key(box(), name).defaultPrevented)
      expect([item, taken, document.activeElement === box()]).toEqual([item, [false, false, false, false], true])
      key(box(), 'Escape')
      expect([item, box()]).toEqual([item, null])
    }
  })

  it('D11 names Files, Focus and Favorites: a row of the search tree is not walked — its keys are the search bar\'s', async () => {
    const { el, v } = await search('alpha')
    act(() => row(el, `${v}/Projects`)?.focus())
    expect(['ArrowDown', 'ArrowRight', 'ArrowLeft'].map((name) => key(document.activeElement, name).defaultPrevented)).toEqual([false, false, false])
    expect([focused(), labels(el)]).toEqual(['Projects', ['Projects', 'Alpha']])
  })
})

/**
 * The two groups of the search tree (YAZ-2662 D2, D3, D4). A pinned item is a file or a folder of
 * the focus list or of the favorites. The matches that are a pinned item or are inside one are
 * drawn first, under "Favorites and focus": the pinned items are its top rows, the focus items
 * before the favorites. A line and "Everything else" come next, over the Files tree cut to the
 * other matches. The ranking puts each pinned match first, so the limit never cuts one and the
 * highlight starts in the top group. The S-numbers are the case record on YAZ-2662.
 */
describe('the matches of the pinned items show first (YAZ-2662 D2, D3, D4)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /** Archive/ with two notes; Clients/ holding Acme/ and a note; Plans/ holding Deep/ and a note; two notes at the top. */
  const VAULT = (v: string): TreeNode[] => [
    folder(`${v}/Archive`, [note(`${v}/Archive/Old.md`), note(`${v}/Archive/Plan old.md`)]),
    folder(`${v}/Clients`, [folder(`${v}/Clients/Acme`, [note(`${v}/Clients/Acme/Client brief.md`), note(`${v}/Clients/Acme/Plan A.md`)]), note(`${v}/Clients/Plan index.md`)]),
    folder(`${v}/Plans`, [folder(`${v}/Plans/Deep`, [note(`${v}/Plans/Deep/Plan deep.md`)]), note(`${v}/Plans/Old ideas.md`)]),
    note(`${v}/Plan.md`),
    note(`${v}/zeta.md`),
  ]
  /** The focus list: `Plan` is in both lists, and leads this one. */
  const FOCUS = ['/Plan.md', '/Plans']
  /** The favorites: `Acme`, `Plan` again, and `Deep`, which is inside the focus item `Plans`. */
  const FAVORITES = ['/Clients/Acme', '/Plan.md', '/Plans/Deep']
  const notePaths = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? notePaths(n.children) : [n.path]))
  const record = (v: string, path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: path.slice(v.length + 1, Math.max(v.length + 1, path.lastIndexOf('/'))), ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
  }

  let vaults = 0
  /** A fresh vault and a fresh window per mount, over an index of each note of its tree; the lists are paths below the vault. Then `query` typed into the bar of the Search tab. */
  const search = async (query: string, opts: { focus?: string[]; favorites?: string[]; nodes?: (v: string) => TreeNode[]; records?: (v: string) => IndexRecord[] } = {}) => {
    const v = `/v-pinned-${++vaults}`
    const nodes = (opts.nodes ?? VAULT)(v)
    const m = await mount({ root: v, lens: 'search' }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: nodes, generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records: opts.records?.(v) ?? notePaths(nodes).map((path) => record(v, path)), folders: [], generatedAt: 1, ids: true } as never)
      b.favorites.get.mockResolvedValue((opts.favorites ?? FAVORITES).map((rel) => `${v}${rel}`))
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue((opts.focus ?? FOCUS).map((rel) => `${v}${rel}`))
      await storage.init()
    })
    const input = searchBar(m.el)!
    await type(input, query)
    return { ...m, v, input }
  }
  /** The body's rows as the eye reads them: top to bottom, two spaces per depth inside their own tree. */
  const shape = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.sidebar__body .tree__row')].map((row) => {
      let depth = -1
      for (let list = row.closest('ul.tree'); list !== null; list = list.parentElement?.closest('ul.tree') ?? null) depth++
      return `${'  '.repeat(depth)}${row.querySelector('.tree__label')?.textContent}`
    })
  /** What the body holds, top to bottom: a label or a line by its text, a tree as `tree`. */
  const parts = (el: HTMLElement) => [...el.querySelector('.sidebar__body')!.children].map((child) => (child.matches('ul.tree') ? 'tree' : child.textContent))
  const TOP = 'Favorites and focus'
  const REST = 'Everything else'
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${path}"]`)
  const isOpen = (el: HTMLElement, path: string) => row(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const cursor = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row--selected .tree__label')].map((n) => n.textContent)
  const press = (input: HTMLInputElement, key: string) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  const click = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  const pick = async (el: HTMLElement, path: string, label: string) => {
    act(() => void row(el, path)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(el, label)?.click())
  }

  it('S14 to S19: the top group is first, under its label — the pinned items are its top rows, the focus items before the favorites, an item of both lists one time at its focus place, an item inside a pinned folder inside that folder; a line and "Everything else" come next, with no pinned item and no row of one', async () => {
    const { el, v } = await search('plan')
    expect(parts(el)).toEqual([TOP, 'tree', REST, 'tree'])
    expect(shape(el)).toEqual(['Plan', 'Plans', '  Deep', '    Plan deep', 'Acme', '  Plan A', 'Archive', '  Plan old', 'Clients', '  Plan index'])
    // The two trees: no folder above a pinned item is drawn in the first (S14), and no pinned item in the second (S19).
    const trees = [...el.querySelectorAll('.sidebar__body > ul.tree')].map((tree) => [...tree.querySelectorAll('.tree__row')].map((r) => r.getAttribute('data-path')?.slice(v.length)))
    expect(trees).toEqual([['/Plan.md', '/Plans', '/Plans/Deep', '/Plans/Deep/Plan deep.md', '/Clients/Acme', '/Clients/Acme/Plan A.md'], ['/Archive', '/Archive/Plan old.md', '/Clients', '/Clients/Plan index.md']])
    // S14: a pinned folder that only leads to a match is open and dim, with no text marked; one that matches is marked (S13).
    expect([isOpen(el, `${v}/Clients/Acme`), row(el, `${v}/Clients/Acme`)?.classList.contains('tree__row--context'), row(el, `${v}/Clients/Acme`)?.querySelector('.tree__mark')]).toEqual(['true', true, null])
    expect([isOpen(el, `${v}/Plans`), row(el, `${v}/Plans`)?.classList.contains('tree__row--context'), row(el, `${v}/Plans`)?.querySelector('.tree__mark')?.textContent]).toEqual(['true', false, 'Plan'])
    // The labels are quiet lines of their own, and the line is the hairline above the second.
    expect([...el.querySelectorAll('.sidebar__body > .sidebar__group')].map((label) => label.textContent)).toEqual([TOP, REST])
    expect(appCss.match(/\n\.tree \+ \.sidebar__group \{([^}]*)\}/)?.[1]).toContain('border-top: 1px solid var(--border)')
  })

  it('S13, S20: a pinned folder whose name matches, with no match inside, is a top row — closed, and a click opens it to all that it holds; with each match pinned there is the top group and its label, no line and no "Everything else"', async () => {
    const { el, v, input } = await search('acme')
    expect([parts(el), shape(el), isOpen(el, `${v}/Clients/Acme`)]).toEqual([[TOP, 'tree'], ['Acme'], 'false'])
    click(row(el, `${v}/Clients/Acme`))
    expect(shape(el)).toEqual(['Acme', '  Client brief', '  Plan A'])
    // S14, S20: a match inside a pinned folder — the folder above the pinned folder is not drawn at all.
    await type(input, 'brief')
    expect([parts(el), shape(el)]).toEqual([[TOP, 'tree'], ['Acme', '  Client brief']])
  })

  it('S21: with no pinned match there is no label and no line — the one tree, as before this work: a matched folder opens to all that it holds, a pinned folder too', async () => {
    const { el, v, input } = await search('zeta')
    expect([parts(el), shape(el)]).toEqual([['tree'], ['zeta']])
    expect(el.querySelector('.sidebar__group')).toBeNull()
    await type(input, 'clients')
    expect([parts(el), shape(el)]).toEqual([['tree'], ['Clients']])
    click(row(el, `${v}/Clients`))
    expect(shape(el)).toEqual(['Clients', '  Acme', '  Plan index'])
  })

  it('S21: with no pinned item at all the search draws the one tree, and the best match of all is the highlight', async () => {
    const { el } = await search('plan', { focus: [], favorites: [] })
    expect([parts(el), shape(el)]).toEqual([['tree'], ['Archive', '  Plan old', 'Clients', '  Acme', '    Plan A', '  Plan index', 'Plans', '  Deep', '    Plan deep', 'Plan']])
    expect(cursor(el)).toEqual(['Plan'])
  })

  it('S19: a matched folder of "Everything else" that holds a pinned item opens to all that it holds but the pinned item, which the top group draws', async () => {
    const { el, v } = await search('client')
    expect([parts(el), shape(el)]).toEqual([[TOP, 'tree', REST, 'tree'], ['Acme', '  Client brief', 'Clients']])
    expect(cursor(el)).toEqual(['Client brief']) // the pinned match, though the folder `Clients` leads its rank
    click(row(el, `${v}/Clients`))
    expect(shape(el)).toEqual(['Acme', '  Client brief', 'Clients', '  Plan index'])
    expect(el.querySelectorAll(`.sidebar__body .tree__row[data-path="${v}/Clients/Acme"]`)).toHaveLength(1)
  })

  it('S19: a pinned item with no match, which the top group does not draw, stays in its folder of "Everything else"', async () => {
    const { el, v } = await search('client', { favorites: ['/Clients/Acme', '/Clients/Plan index.md'] })
    expect(shape(el)).toEqual(['Acme', '  Client brief', 'Clients'])
    click(row(el, `${v}/Clients`))
    expect(shape(el)).toEqual(['Acme', '  Client brief', 'Clients', '  Plan index'])
  })

  it('S22, S23: the highlight starts on the best pinned match, where the top group draws it; ↑ and ↓ walk the top group from top to bottom, then "Everything else", and stop at both ends; a match below a folder that was closed is no stop, in either group', async () => {
    const { el, v, input, props } = await search('old')
    // S23: `Old` is the exact name and is not pinned; `Old ideas` only starts with the text and is inside a pinned folder.
    expect(shape(el)).toEqual(['Plans', '  Old ideas', 'Archive', '  Old', '  Plan old'])
    expect(cursor(el)).toEqual(['Old ideas'])
    await type(input, 'plan')
    expect(cursor(el)).toEqual(['Plan'])
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['Plan']) // the first row of the top group: no wrap
    const walked: (string | null)[][] = []
    for (let i = 0; i < 6; i++) {
      await press(input, 'ArrowDown')
      walked.push(cursor(el))
    }
    expect(walked).toEqual([['Plans'], ['Plan deep'], ['Plan A'], ['Plan old'], ['Plan index'], ['Plan index']])
    // A folder of the top group that is closed: the rows above a match there start at its pinned item, not at the vault.
    click(row(el, `${v}/Plans/Deep`))
    click(row(el, `${v}/Archive`))
    for (const expected of ['Plan A', 'Plans', 'Plan', 'Plan']) {
      await press(input, 'ArrowUp')
      expect(cursor(el)).toEqual([expected])
    }
    // A match inside a pinned folder, whose own parent folder the search does not draw, is a stop: Enter opens it.
    await type(input, 'brief')
    expect(cursor(el)).toEqual(['Client brief'])
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Clients/Acme/Client brief.md`)
  })

  it('S24: 60 matches outside the pinned items and 3 inside one show the 3 and the best 47 of the others, and the limit line', async () => {
    const many = (v: string): TreeNode[] => [folder(`${v}/Pinned`, Array.from({ length: 3 }, (_, i) => note(`${v}/Pinned/a note ${i}.md`))), ...Array.from({ length: 60 }, (_, i) => note(`${v}/note ${String(i).padStart(2, '0')}.md`))]
    // The index holds the 60 first, as their paths sort: with no pinned item the limit would cut the 3.
    const { el } = await search('note', { nodes: many, focus: ['/Pinned'], favorites: [], records: (v) => [...notePaths(many(v)).slice(3), ...notePaths(many(v)).slice(0, 3)].map((path) => record(v, path)) })
    expect(parts(el)).toEqual([TOP, 'tree', REST, 'tree', 'Showing 50 matches. Type more to narrow.'])
    expect(shape(el)).toEqual(['Pinned', '  a note 0', '  a note 1', '  a note 2', ...Array.from({ length: 47 }, (_, i) => `note ${String(i).padStart(2, '0')}`)])
    expect(cursor(el)).toEqual(['a note 0'])
  })

  it('S25: the rows that an id finds are drawn in the two groups too, the highlight on the pinned one', async () => {
    const ids: Record<string, string> = { '/Archive/Old.md': '7tq2m8vd4xhn', '/Plans/Old ideas.md': 'k3m9x2pq7abc' }
    const { el } = await search('[[7tq2m8vd4xhn]] and [[k3m9x2pq7abc]]', { records: (v) => notePaths(VAULT(v)).map((path) => record(v, path, ids[path.slice(v.length)] === undefined ? {} : { id: ids[path.slice(v.length)] })) })
    expect([parts(el), shape(el), cursor(el)]).toEqual([[TOP, 'tree', REST, 'tree'], ['Plans', '  Old ideas', 'Archive', '  Old'], ['Old ideas']])
  })

  it('S27: "Add to focus" and "Add to favorites" on a search row keep the Search tab and move the row to the top group at once — a focus item before the favorites; "Remove" moves it back', async () => {
    const { el, v, props } = await search('plan')
    const path = `${v}/Archive/Plan old.md`
    const TOP_ROWS = ['Plan', 'Plans', '  Deep', '    Plan deep', 'Acme', '  Plan A']
    await pick(el, path, 'Add to focus')
    expect(shape(el)).toEqual(['Plan', 'Plans', '  Deep', '    Plan deep', 'Plan old', 'Acme', '  Plan A', 'Clients', '  Plan index'])
    expect(cursor(el)).toEqual(['Plan old']) // the highlight is held by its path: it moved with its row
    await pick(el, path, 'Remove from focus')
    expect(shape(el)).toEqual([...TOP_ROWS, 'Archive', '  Plan old', 'Clients', '  Plan index'])
    await pick(el, path, 'Add to favorites')
    expect(shape(el)).toEqual([...TOP_ROWS, 'Plan old', 'Clients', '  Plan index'])
    await pick(el, path, 'Remove from favorites')
    expect(shape(el)).toEqual([...TOP_ROWS, 'Archive', '  Plan old', 'Clients', '  Plan index'])
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect([searchBar(el)?.value, parts(el)]).toEqual(['plan', [TOP, 'tree', REST, 'tree']])
  })

  it('S28: a fold in either group lasts as long as its text — a different tab and back keeps it, and new text forgets it', async () => {
    const { el, v, rerender } = await search('plan')
    click(row(el, `${v}/Clients/Acme`))
    click(row(el, `${v}/Archive`))
    const folded = ['Plan', 'Plans', '  Deep', '    Plan deep', 'Acme', 'Archive', 'Clients', '  Plan index']
    expect(shape(el)).toEqual(folded)
    await rerender({ lens: 'files' })
    await rerender({ lens: 'search' })
    expect(shape(el)).toEqual(folded)
    await type(searchBar(el)!, 'pla')
    expect(shape(el)).toEqual(['Plan', 'Plans', '  Deep', '    Plan deep', 'Acme', '  Plan A', 'Archive', '  Plan old', 'Clients', '  Plan index'])
  })

  it('S29: a pinned path that is gone from the disk gives no row and no error', async () => {
    const { el, input, props } = await search('plan', { focus: ['/Gone', '/Plans'], favorites: ['/Gone.md', '/Clients/Acme'] })
    expect(shape(el)).toEqual(['Plans', '  Deep', '    Plan deep', 'Acme', '  Plan A', 'Archive', '  Plan old', 'Clients', '  Plan index', 'Plan'])
    await type(input, 'gone')
    expect(parts(el)).toEqual(['No matches'])
    expect(el.querySelector('.sidebar__msg--error')).toBeNull()
    expect(vi.mocked(props.onNotice).mock.calls.filter(([, kind]) => kind === 'error')).toEqual([])
  })
})

/**
 * The list keys of the search (YAZ-2662 D6, D7): Space, → and ←. They act on the highlight once ↑
 * or ↓ moved it; until then, and after a change of the text, they are text keys, and so is a list
 * key with nothing to do on the highlight. Space or → on a folder shows ALL that it holds, in the
 * search tree, and ↑ and ↓ then stop on each row on show inside it; Space again puts the folder
 * back as the search drew it, and ← closes an open folder. The S-numbers are the case record on YAZ-2662.
 */
describe('Space, → and ← on a folder of the search tree (YAZ-2662 D6, D7)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  /**
   * `log` finds: the folder Work log, inside Area/, and in it Log week 1 and Team log; the folder Log book and in it Entry log; Changelog at the top.
   * Log book is in the focus list. Team log and Readme, both in Work log, are favorites: the first is a match and the second is not.
   */
  const VAULT = (v: string): TreeNode[] => [
    folder(`${v}/Area`, [
      folder(`${v}/Area/Work log`, [
        folder(`${v}/Area/Work log/Drafts`, [note(`${v}/Area/Work log/Drafts/Idea.md`)]),
        folder(`${v}/Area/Work log/Empty`, []),
        folder(`${v}/Area/Work log/Weeks`, [note(`${v}/Area/Work log/Weeks/Log week 1.md`), note(`${v}/Area/Work log/Weeks/Summary.md`)]),
        note(`${v}/Area/Work log/Readme.md`),
        note(`${v}/Area/Work log/Team log.md`),
      ]),
    ]),
    folder(`${v}/Log book`, [folder(`${v}/Log book/Notes`, [note(`${v}/Log book/Notes/Page.md`)]), note(`${v}/Log book/Cover.md`), note(`${v}/Log book/Entry log.md`)]),
    note(`${v}/Changelog.md`),
  ]
  const notePaths = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? notePaths(n.children) : [n.path]))

  let vaults = 0
  /** A fresh vault and a fresh window per mount, over an index of each note of the tree. Then `query` typed into the bar of the Search tab. */
  const search = async (query: string) => {
    const v = `/v-listkeys-${++vaults}`
    const m = await mount({ root: v, lens: 'search' }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: VAULT(v), generatedAt: 1 })
      b.index.mockResolvedValue({ root: v, records: notePaths(VAULT(v)).map((path) => ({ ...indexRecord(path), folder: path.slice(v.length + 1, Math.max(v.length + 1, path.lastIndexOf('/'))) })), folders: [], generatedAt: 1, ids: true } as never)
      b.favorites.get.mockResolvedValue([`${v}/Area/Work log/Readme.md`, `${v}/Area/Work log/Team log.md`])
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue([`${v}/Log book`])
      await storage.init()
    })
    const input = searchBar(m.el)!
    await type(input, query)
    const shape = () =>
      [...m.el.querySelectorAll<HTMLElement>('.sidebar__body .tree__row')].map((row) => {
        let depth = -1
        for (let list = row.closest('ul.tree'); list !== null; list = list.parentElement?.closest('ul.tree') ?? null) depth++
        return `${'  '.repeat(depth)}${row.querySelector('.tree__label')?.textContent}`
      })
    const row = (rel: string) => m.el.querySelector<HTMLButtonElement>(`.sidebar__body .tree__row[data-path="${v}${rel}"]`)
    const cursor = () => [...m.el.querySelectorAll('.sidebar__body .tree__row--selected .tree__label')].map((n) => n.textContent)
    /** A key in the bar, as the keyboard sends it; the event comes back, so a test can ask whether the key was taken from the text. */
    const press = (key: string, mods: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })
      act(() => void input.dispatchEvent(event))
      return event
    }
    /** ↑ to the first stop, then ↓ to the row labelled `label`: the highlight is on it, moved by the keyboard. */
    const go = (label: string) => {
      // ↑ on the first row goes on to the tab buttons of the panel (YAZ-2663 D12): the walk to the top keeps the focus where it was.
      const held = document.activeElement
      for (let i = 0; i < 20; i++) press('ArrowUp')
      if (held instanceof HTMLElement && document.activeElement !== held) act(() => held.focus())
      for (let i = 0; i < 20 && cursor()[0] !== label; i++) press('ArrowDown')
      expect(cursor()).toEqual([label])
    }
    /** The labels that ↓ stops on from the highlight, until it stops moving. */
    const walk = () => {
      const stops: (string | null)[] = []
      for (let last = cursor()[0]; press('ArrowDown') && cursor()[0] !== last; last = cursor()[0]) stops.push(cursor()[0])
      return stops
    }
    return { ...m, v, input, shape, row, cursor, press, go, walk, isOpen: (rel: string) => row(rel)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded'), dim: (rel: string) => row(rel)?.classList.contains('tree__row--context') }
  }
  const click = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  const TOP = ['Log book', '  Entry log', 'Team log']
  /** The search tree of `log` as the search draws it: the top group, then "Everything else". */
  const DRAWN = [...TOP, 'Area', '  Work log', '    Weeks', '      Log week 1', 'Changelog']
  /** Work log showing all: Team log is drawn by the top group, so it is not here a second time (S19). */
  const WORK_LOG = ['  Work log', '    Drafts', '    Empty', '    Weeks', '      Log week 1', '    Readme']

  it('S30: with no ↑ or ↓ the three keys are text keys — Space types a space, so `work log` can be typed; after ↑ or ↓ a change of the text gives them back to the text', async () => {
    const { input, shape, press, go, isOpen } = await search('log')
    expect(shape()).toEqual(DRAWN)
    expect([' ', 'ArrowRight', 'ArrowLeft'].map((key) => press(key).defaultPrevented)).toEqual([false, false, false])
    expect(shape()).toEqual(DRAWN)
    await type(input, 'work log')
    expect(shape()).toEqual(['Area', '  Work log'])
    go('Work log')
    await type(input, 'work lo')
    expect([' ', 'ArrowRight', 'ArrowLeft'].map((key) => press(key).defaultPrevented)).toEqual([false, false, false])
    expect([shape(), isOpen('/Area/Work log')]).toEqual([['Area', '  Work log'], 'false'])
  })

  it('S46, S47: after ↑ or ↓, Space on a folder shows each row that it holds — a row that is no match is dim and a match keeps its mark; a folder inside it that leads to a match stays open with its matches, one that leads to none is closed; a pinned item that the top group draws is not drawn a second time', async () => {
    const { el, shape, row, press, go, isOpen, dim } = await search('log')
    go('Work log')
    expect(press(' ').defaultPrevented).toBe(true)
    expect(shape()).toEqual([...TOP, 'Area', ...WORK_LOG, 'Changelog'])
    expect(['/Area/Work log/Drafts', '/Area/Work log/Empty', '/Area/Work log/Weeks', '/Area/Work log/Readme.md', '/Area/Work log/Weeks/Log week 1.md'].map(dim)).toEqual([true, true, true, true, false])
    expect([row('/Area/Work log/Weeks/Log week 1.md')?.querySelector('.tree__mark')?.textContent, row('/Area/Work log/Readme.md')?.querySelector('.tree__mark')]).toEqual(['Log', null])
    expect(['/Area/Work log', '/Area/Work log/Drafts', '/Area/Work log/Weeks'].map(isOpen)).toEqual(['true', 'false', 'true'])
    expect(el.querySelectorAll('.sidebar__body .tree__row[data-path$="/Team log.md"]')).toHaveLength(1)
  })

  it('S48: ↑ and ↓ stop on each row on show inside a folder that Space opened, a match or not — and on the rows of a folder inside it that a click opened; outside it they stop on the matches only', async () => {
    const { row, press, go, walk, cursor } = await search('log')
    go('Log book')
    expect(walk()).toEqual(['Entry log', 'Team log', 'Work log', 'Log week 1', 'Changelog'])
    go('Work log')
    press(' ')
    expect(walk()).toEqual(['Drafts', 'Empty', 'Weeks', 'Log week 1', 'Readme', 'Changelog'])
    click(row('/Area/Work log/Drafts'))
    go('Drafts')
    press('ArrowDown')
    expect(cursor()).toEqual(['Idea'])
    for (const expected of ['Drafts', 'Work log', 'Team log']) {
      press('ArrowUp')
      expect(cursor()).toEqual([expected])
    }
  })

  it('S49: Space again on that folder puts it, and each folder inside it, back as the search drew it; the highlight stays on it', async () => {
    const { row, shape, press, go, cursor } = await search('log')
    go('Work log')
    press(' ')
    go('Drafts')
    press(' ')
    click(row('/Area/Work log/Weeks'))
    expect(shape()).toEqual([...TOP, 'Area', '  Work log', '    Drafts', '      Idea', '    Empty', '    Weeks', '    Readme', 'Changelog'])
    go('Work log')
    expect(press(' ').defaultPrevented).toBe(true)
    expect([shape(), cursor()]).toEqual([DRAWN, ['Work log']])
    press(' ')
    expect(shape()).toEqual([...TOP, 'Area', ...WORK_LOG, 'Changelog'])
  })

  it('S50: → on a folder does what the first Space does, in the top group too; → on a folder that shows all, and on a file, is a text key', async () => {
    const { shape, press, go, walk, dim } = await search('log')
    go('Log book')
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    const ALL = ['Log book', '  Notes', '  Cover', '  Entry log', 'Team log', ...DRAWN.slice(TOP.length)]
    expect([shape(), dim('/Log book/Notes'), dim('/Log book/Cover.md'), dim('/Log book/Entry log.md')]).toEqual([ALL, true, true, false])
    expect(press('ArrowRight').defaultPrevented).toBe(false)
    expect(shape()).toEqual(ALL)
    expect(walk().slice(0, 4)).toEqual(['Notes', 'Cover', 'Entry log', 'Team log'])
    go('Entry log')
    expect(press('ArrowRight').defaultPrevented).toBe(false)
    expect(shape()).toEqual(ALL)
  })

  it('S51: ← on an open folder closes it; ← on a closed folder, and on a file, is a text key; → opens it again with all that it holds, and Space then puts it back', async () => {
    const { shape, press, go } = await search('log')
    go('Log book')
    expect(press('ArrowLeft').defaultPrevented).toBe(true)
    const CLOSED = ['Log book', 'Team log', ...DRAWN.slice(TOP.length)]
    expect(shape()).toEqual(CLOSED)
    expect(press('ArrowLeft').defaultPrevented).toBe(false)
    expect(shape()).toEqual(CLOSED)
    press('ArrowRight')
    expect(shape()).toEqual(['Log book', '  Notes', '  Cover', '  Entry log', 'Team log', ...DRAWN.slice(TOP.length)])
    press('ArrowLeft')
    expect(shape()).toEqual(CLOSED)
    // Closed, it does not show all: Space opens it again, and the next Space puts it back.
    press(' ')
    expect(shape()).toEqual(['Log book', '  Notes', '  Cover', '  Entry log', 'Team log', ...DRAWN.slice(TOP.length)])
    press(' ')
    expect(shape()).toEqual(DRAWN)
    go('Entry log')
    expect(press('ArrowLeft').defaultPrevented).toBe(false)
    expect(shape()).toEqual(DRAWN)
  })

  it('R6: a click folds a folder as before — a matched folder with no match inside opens to all that it holds, and ↑ and ↓ do not go into it until → or Space', async () => {
    const { row, shape, press, go, walk, cursor } = await search('book')
    expect(shape()).toEqual(['Log book'])
    click(row('/Log book'))
    const ALL = ['Log book', '  Notes', '  Cover', '  Entry log']
    expect([shape(), walk(), cursor()]).toEqual([ALL, [], ['Log book']])
    // It is open and does not show all to the keys yet: → is taken, and the folder stays open.
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect([shape(), walk()]).toEqual([ALL, ['Notes', 'Cover', 'Entry log']])
    go('Log book')
    click(row('/Log book'))
    expect(shape()).toEqual(['Log book'])
  })

  it('S52: Enter, ⌘Enter and Shift+Enter on a row that is no match do what they do on a match — a file opens, a folder shows in Files; Space on a folder there opens that folder too', async () => {
    const { v, shape, press, go, cursor, props } = await search('log')
    go('Work log')
    press(' ')
    go('Readme')
    press('Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/Area/Work log/Readme.md`)
    press('Enter', { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(`${v}/Area/Work log/Readme.md`)
    press('Enter', { shiftKey: true })
    expect(vi.mocked(props.onRevealInFiles).mock.calls).toEqual([[`${v}/Area/Work log/Readme.md`, true]])
    go('Drafts')
    press('Enter')
    expect(vi.mocked(props.onRevealInFiles).mock.calls[1]).toEqual([`${v}/Area/Work log/Drafts`, true])
    expect(press(' ').defaultPrevented).toBe(true)
    expect(shape()).toEqual([...TOP, 'Area', '  Work log', '    Drafts', '      Idea', ...WORK_LOG.slice(2), 'Changelog'])
    press('ArrowDown')
    expect(cursor()).toEqual(['Idea'])
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('S53: a change of the text puts each folder back as the search draws it for the new text', async () => {
    const { input, shape, press, go } = await search('log')
    go('Work log')
    press(' ')
    go('Log book')
    press('ArrowLeft')
    await type(input, 'lo')
    expect(shape()).toEqual(DRAWN)
    await type(input, 'log')
    expect(shape()).toEqual(DRAWN)
  })

  it('S54: Space on a folder with nothing in it opens it and shows no row, with no error; Space again closes it', async () => {
    const { el, shape, press, go, isOpen, props } = await search('log')
    go('Work log')
    press(' ')
    go('Empty')
    expect(press(' ').defaultPrevented).toBe(true)
    expect([isOpen('/Area/Work log/Empty'), shape()]).toEqual(['true', [...TOP, 'Area', ...WORK_LOG, 'Changelog']])
    expect(press(' ').defaultPrevented).toBe(true)
    expect(isOpen('/Area/Work log/Empty')).toBe('false')
    expect(el.querySelector('.sidebar__msg--error')).toBeNull()
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a click closes a folder above the highlight, which is on a row that is no match: the highlight goes to the next row that the tree still draws', async () => {
    const { row, press, go, cursor } = await search('log')
    go('Work log')
    press(' ')
    go('Readme')
    click(row('/Area'))
    expect(cursor()).toEqual(['Changelog'])
  })

  it('a list key with ⌘, ⌥, ⌃ or Shift is a text key', async () => {
    const { shape, press, go } = await search('log')
    go('Work log')
    expect([{ metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }].flatMap((mods) => [' ', 'ArrowRight', 'ArrowLeft'].map((key) => press(key, mods).defaultPrevented))).toEqual(Array(12).fill(false))
    expect(shape()).toEqual(DRAWN)
  })

  /**
   * Space on a FILE is the preview panel's key (YAZ-2662 D5). The panel is App's: the Sidebar names
   * the path to show through `onPreview`, or `null`, and reads the path that App draws as
   * `previewPath` (`WithPreview`). The clock is a fake one from the first key on.
   */
  describe('Space on a file: the preview panel (YAZ-2662 D5)', () => {
    afterEach(() => vi.useRealTimers())

    const preview = async (query = 'log') => {
      const s = await search(query)
      const onPreview = vi.mocked(s.props.onPreview)
      onPreview.mockClear()
      act(() => s.input.focus())
      vi.useFakeTimers()
      return {
        ...s,
        onPreview,
        wait: (ms: number) => act(() => void vi.advanceTimersByTime(ms)),
        /** The ✕ of the panel. */
        close: () => act(() => previewPanel?.close()),
        /** The file that the panel shows, as a path inside the vault; null with no panel. */
        panel: () => previewPanel?.path?.slice(s.v.length) ?? null,
      }
    }
    /** No door of the workspace was used: no page opened, in a tab or in the background, and nothing was shown in Files. */
    const untouched = (props: PanelProps) => [props.onOpenFile, props.onKeepFile, props.onOpenFileBackground, props.onRevealInFiles, props.onLensChange].every((door) => vi.mocked(door).mock.calls.length === 0)

    it('S30: with no ↑ or ↓, Space on the best match — a file — types a space and shows no panel', async () => {
      const { press, cursor, panel, onPreview } = await preview('entry')
      expect(cursor()).toEqual(['Entry log'])
      expect(press(' ').defaultPrevented).toBe(false)
      expect([panel(), onPreview.mock.calls]).toEqual([null, []])
    })

    it('S31: after ↑ or ↓, Space on a file asks App for the panel on that file, at once — the caret and the text stay in the bar, and no door of the workspace is used', async () => {
      const { v, input, props, press, go, panel, onPreview } = await preview()
      go('Entry log')
      expect(press(' ').defaultPrevented).toBe(true)
      expect([panel(), onPreview.mock.calls]).toEqual(['/Log book/Entry log.md', [[`${v}/Log book/Entry log.md`]]])
      expect([document.activeElement === input, input.value]).toEqual([true, 'log'])
      expect(untouched(props)).toBe(true)
      // With a modifier Space is the text's, as each list key is: the panel stays as it is.
      expect(press(' ', { shiftKey: true }).defaultPrevented).toBe(false)
      expect(panel()).toBe('/Log book/Entry log.md')
    })

    it('S32, S52: the panel follows the highlight 120 ms after its LAST move and keeps the earlier file until then — onto a row that is no match too; back on the file that shows, nothing is asked', async () => {
      const { v, press, go, wait, panel, onPreview } = await preview()
      go('Work log')
      press(' ')
      go('Log week 1')
      press(' ')
      expect(panel()).toBe('/Area/Work log/Weeks/Log week 1.md')
      onPreview.mockClear()
      // Two moves, 100 ms apart: Readme is passed over and is never shown.
      press('ArrowDown')
      wait(100)
      press('ArrowDown')
      wait(PREVIEW_FOLLOW_MS - 1)
      expect([panel(), onPreview.mock.calls]).toEqual(['/Area/Work log/Weeks/Log week 1.md', []])
      wait(1)
      expect([panel(), onPreview.mock.calls]).toEqual(['/Changelog.md', [[`${v}/Changelog.md`]]])
      // Away and back inside the wait: the panel is on that file already.
      press('ArrowUp')
      wait(50)
      press('ArrowDown')
      wait(1000)
      expect(onPreview).toHaveBeenCalledTimes(1)
      // A row that is no match, inside the folder that Space opened (S52).
      press('ArrowUp')
      wait(PREVIEW_FOLLOW_MS)
      expect(panel()).toBe('/Area/Work log/Readme.md')
    })

    it('S33: Space again closes the panel, and the next Space shows it again; the file that the keys were on the way to is not shown later', async () => {
      const { press, go, wait, panel } = await preview()
      go('Entry log')
      press(' ')
      press('ArrowDown')
      expect(press(' ').defaultPrevented).toBe(true)
      expect(panel()).toBeNull()
      wait(1000)
      expect(panel()).toBeNull()
      press(' ')
      expect(panel()).toBe('/Area/Work log/Team log.md')
    })

    it('S34: the first Esc closes the panel only; the next Esc leaves the Search tab', async () => {
      const { props, press, go, panel } = await preview()
      go('Entry log')
      press(' ')
      expect(press('Escape').defaultPrevented).toBe(true)
      expect([panel(), vi.mocked(props.onLensChange).mock.calls]).toEqual([null, []])
      press('Escape')
      expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    })

    it('S35: a change of the text closes the panel, and Space is a text key again', async () => {
      const { input, press, go, wait, panel } = await preview()
      go('Entry log')
      press(' ')
      press('ArrowDown')
      await type(input, 'lo')
      expect(panel()).toBeNull()
      wait(1000)
      expect(panel()).toBeNull()
      expect(press(' ').defaultPrevented).toBe(false)
      expect(panel()).toBeNull()
    })

    it.each([
      ['Enter', {}, 'onOpenFile'],
      ['⌘Enter', { metaKey: true }, 'onOpenFileBackground'],
      ['Shift+Enter', { shiftKey: true }, 'onRevealInFiles'],
    ] as const)('S36: %s with the panel on show does its own work and closes the panel', async (_name, mods, door) => {
      const { v, props, press, go, panel } = await preview()
      go('Entry log')
      press(' ')
      press('Enter', mods)
      expect(vi.mocked(props[door]).mock.calls.map(([path]) => path)).toEqual([`${v}/Log book/Entry log.md`])
      expect(panel()).toBeNull()
    })

    it('R4: Enter on the file whose page is open, with the panel on show over that page — the caret goes into the page, never into the note of the panel', async () => {
      const { v, rerender, press, go, panel } = await preview()
      // The note of the panel wears the editor's class and stands BEFORE the page here: it is passed over for what it is.
      const quicklook = document.createElement('div')
      quicklook.className = 'quicklook'
      document.body.appendChild(quicklook)
      quicklook.appendChild(editorStub().parentElement!)
      const page = editorStub()
      await rerender({ activeFile: `${v}/Log book/Entry log.md` })
      go('Entry log')
      press(' ')
      press('Enter')
      expect([document.activeElement === page, panel()]).toEqual([true, null])
      quicklook.remove()
      page.parentElement?.remove()
    })

    it('S37: a different sidebar tab shows and the panel closes; back on the Search tab the preview is off, so Space shows the panel', async () => {
      const { el, press, go, cursor, panel, onPreview } = await preview()
      go('Entry log')
      press(' ')
      onPreview.mockClear()
      showTab?.('files')
      expect([panel(), onPreview.mock.calls]).toEqual([null, [[null]]])
      showTab?.('search')
      expect([panel(), cursor()]).toEqual([null, ['Entry log']])
      // The bar is drawn again with its tab: the key goes to the bar that is there now.
      act(() => void searchBar(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
      expect(panel()).toBe('/Log book/Entry log.md')
    })

    it('S38: on a folder the panel is not drawn, at once, and Space keeps its meaning for a folder; on the next file the panel shows again after the wait; Esc on the folder leaves the Search tab', async () => {
      const { props, shape, cursor, press, go, wait, panel } = await preview()
      go('Entry log')
      press(' ')
      press('ArrowUp')
      expect([panel(), cursor()]).toEqual([null, ['Log book']])
      // Space on the folder shows all that it holds (D6), and the preview stays on.
      expect(press(' ').defaultPrevented).toBe(true)
      expect(shape().slice(0, 4)).toEqual(['Log book', '  Notes', '  Cover', '  Entry log'])
      press('ArrowDown')
      press('ArrowDown')
      wait(PREVIEW_FOLLOW_MS - 1)
      expect([panel(), cursor()]).toEqual([null, ['Cover']])
      wait(1)
      expect(panel()).toBe('/Log book/Cover.md')
      go('Log book')
      expect(panel()).toBeNull()
      press('Escape')
      expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    })

    it('S43: after the ✕ of the panel the preview is off for the keys too — ↑ and ↓ show no panel, Space shows it again, and Esc leaves the Search tab', async () => {
      const { props, press, go, wait, close, panel, onPreview } = await preview()
      go('Entry log')
      press(' ')
      press('ArrowDown')
      close()
      onPreview.mockClear()
      wait(1000)
      press('ArrowUp')
      wait(1000)
      expect([panel(), onPreview.mock.calls]).toEqual([null, []])
      press(' ')
      expect(panel()).toBe('/Log book/Entry log.md')
      close()
      press('Escape')
      expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    })

    it('S58: a click on the `esc` keycap is the Esc key — with the panel on show it closes the panel only, and a press on it takes no focus from the bar; the next click leaves the Search tab', async () => {
      const { el, input, props, press, go, panel } = await preview()
      const keycap = el.querySelector<HTMLButtonElement>('.sidebar__search-back')!
      go('Entry log')
      press(' ')
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      act(() => void keycap.dispatchEvent(down))
      expect(down.defaultPrevented).toBe(true)
      act(() => keycap.click())
      expect([panel(), vi.mocked(props.onLensChange).mock.calls, document.activeElement === input]).toEqual([null, [], true])
      // The preview is off for the keys, as after Esc: Space shows the panel again.
      press(' ')
      expect(panel()).toBe('/Log book/Entry log.md')
      act(() => keycap.click())
      act(() => keycap.click())
      expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    })

    it.each([
      ['a click on a file row', '/Changelog.md', 'click'],
      ['a click on a folder row', '/Area/Work log', 'click'],
      ['a right-click on a row', '/Changelog.md', 'contextmenu'],
    ])('S65: the mouse on a row of the search tree closes the preview — %s does its own work with no panel over it, and the preview is off for the keys', async (_name, rel, gesture) => {
      const { v, props, row, press, go, wait, panel, onPreview, isOpen } = await preview()
      go('Entry log')
      press(' ')
      onPreview.mockClear()
      act(() => void row(rel)?.dispatchEvent(new MouseEvent(gesture, { bubbles: true, cancelable: true })))
      expect([panel(), onPreview.mock.calls]).toEqual([null, [[null]]])
      // The row's own work: a file opens, a folder folds, a menu shows.
      if (rel === '/Area/Work log') expect(isOpen(rel)).toBe('false')
      else if (gesture === 'click') expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}${rel}`)
      // No panel follows to the row, and ↑ and ↓ show none: the preview is off until the next Space.
      wait(1000)
      press('ArrowUp')
      wait(1000)
      expect([panel(), onPreview.mock.calls]).toEqual([null, [[null]]])
    })

    it('S65: with no preview on, the mouse on a row asks nothing of the panel', async () => {
      const { row, go, onPreview } = await preview()
      go('Entry log')
      act(() => void row('/Changelog.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      expect(onPreview).not.toHaveBeenCalled()
    })

    it('a held Space acts one time: after ↑ or ↓ its repeats are taken and do nothing — the panel does not show and close on each, and a folder does not open and go back on each; a Space that is a text key repeats', async () => {
      const { input, shape, press, go, panel } = await preview()
      go('Entry log')
      press(' ')
      expect(Array.from({ length: 3 }, () => press(' ', { repeat: true }).defaultPrevented)).toEqual([true, true, true])
      expect(panel()).toBe('/Log book/Entry log.md')
      press(' ')
      expect(panel()).toBeNull()
      go('Log book')
      press(' ')
      const all = shape()
      expect(all.slice(0, 4)).toEqual(['Log book', '  Notes', '  Cover', '  Entry log'])
      expect(press(' ', { repeat: true }).defaultPrevented).toBe(true)
      expect(shape()).toEqual(all)
      // The text changed: Space is the text's again, each repeat of it too (S30).
      await type(input, 'lo')
      expect(press(' ', { repeat: true }).defaultPrevented).toBe(false)
    })
  })
})

/**
 * The lens tabs (🔒 D4, YAZ-847): chrome v2 ROW 1. Files is
 * the file explorer; Favorites is the pinned rows (its own describe below —
 * what matters HERE is only which body the tabs swap in). The VALUE is App's (window identity, `WindowEntry.sidebarLens`, since YAZ-1628): the
 * sidebar renders the row and reports clicks, and App hands the new lens back down. Switching is
 * a conditional render, never a teardown — the search wave's rule, re-proved here on the tree's
 * expansion. Search is a tab of the row too (YAZ-2638 D2), and its query survives a tab switch.
 */
describe('lens tabs (🔒 D4, YAZ-847; YAZ-2638 D2)', () => {
  const record = (basename: string, folder = '') => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`, name: `${basename}.md`, basename, title: basename, folder, ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  })
  const RECORDS = [record('Alpha'), record('Anchor', 'Docs')]
  /** The vault those two notes live in: a search draws the tree, so its rows must be IN the tree (YAZ-2620). */
  const SEARCHED: TreeNode[] = [
    { type: 'dir', name: 'Docs', path: '/v/Docs', children: [{ type: 'file', name: 'Anchor.md', path: '/v/Docs/Anchor.md', size: 1, mtime: 1, kind: 'markdown' }] },
    { type: 'file', name: 'Alpha.md', path: '/v/Alpha.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withIndex = (b: ReturnType<typeof installBridge>) => {
    b.tree.mockResolvedValue({ root: '/v', tree: SEARCHED, generatedAt: 1 })
    b.index.mockResolvedValue({ root: '/v', records: RECORDS, folders: [], generatedAt: 1, ids: true } as never)
  }

  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses[role="tablist"] [role="tab"]')]
  /** Favorites is a glyph (YAZ-1766 D1): its name is the `aria-label`, not text. */
  const tabName = (b: HTMLButtonElement) => b.textContent || b.getAttribute('aria-label')
  const tabByLabel = (el: HTMLElement, label: string) => tabs(el).find((b) => tabName(b) === label)
  const selectedTabs = (el: HTMLElement) => tabs(el).filter((b) => b.getAttribute('aria-selected') === 'true').map(tabName)
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  /** Every row the body draws, top to bottom: during a search, the matches and their parent folders. */
  const resultLabels = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row .tree__label')].map((n) => n.textContent)
  const dirItem = (el: HTMLElement) => el.querySelector('.tree__row--dir')?.closest('[role="treeitem"]') ?? null

  it('renders a tablist of exactly Files, Search, Focus, Favorites, Sessions, then Recents (YAZ-1766 D1, YAZ-2619, YAZ-2638 S1, YAZ-3147 D4, YAZ-3235 D4), the active one aria-selected and no other', async () => {
    const { el } = await mount({ lens: 'files' })
    expect(tabs(el).map(tabName)).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
    expect(selectedTabs(el)).toEqual(['Files'])
    expect(selectedTabs((await mount({ lens: 'search' })).el)).toEqual(['Search'])
    expect(selectedTabs((await mount({ lens: 'focus' })).el)).toEqual(['Focus'])
    const favorites = await mount({ lens: 'favorites' })
    expect(selectedTabs(favorites.el)).toEqual(['Favorites'])
    expect(searchBar(favorites.el)).toBeNull() // the bar is in the Search tab only (YAZ-2638 S6)
  })

  it('the Sessions tab (YAZ-3147 D4, S37): a glyph labelled "Sessions"; its body is the session list — no file tree, no expand-all button, and its blank space has no tree menu', async () => {
    const { el, props } = await mount({ lens: 'sessions' })
    const sessions = tabByLabel(el, 'Sessions')
    expect(sessions?.getAttribute('title')).toBe('Sessions')
    expect(sessions?.querySelector('svg.stack-icon')).not.toBeNull()
    expect(selectedTabs(el)).toEqual(['Sessions'])
    expect(el.querySelector('.sidebar__body .tree')).toBeNull()
    expect(el.querySelector('.sidebar__expand-all')).toBeNull()
    expect(el.querySelector('.sidebar__body .sidebar__focus-bar')?.textContent).toBe('No sessionsSave open tabs')
    expect(bodyMsg(el)).toBe('Save your open tabs as a session. Restore them later in one click.')
    const blank = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(blank))
    expect(blank.defaultPrevented).toBe(true)
    expect(document.querySelector('.ctx-menu')).toBeNull()
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
  })

  it('the Recents tab (YAZ-3235 D4, S13, S20, S22): the last tab, a clock glyph labelled "Recents", and a stored lens; its body is the save list — no file tree, no expand-all button, and its blank space has no tree menu', async () => {
    const files = await mount({ lens: 'files' })
    act(() => tabByLabel(files.el, 'Recents')?.click())
    expect(files.props.onLensChange).toHaveBeenCalledExactlyOnceWith('recents')
    expect(isSidebarLens('recents')).toBe(true) // App writes it to the window, and main keeps it
    const { el } = await mount({ lens: 'recents' })
    const recents = tabs(el).at(-1)
    expect([tabName(recents!), recents?.getAttribute('title'), recents?.querySelector('svg.clock-icon') !== null]).toEqual(['Recents', 'Recents', true])
    expect(selectedTabs(el)).toEqual(['Recents'])
    expect(el.querySelector('.sidebar__body .tree')).toBeNull()
    expect(el.querySelector('.sidebar__expand-all')).toBeNull()
    expect(bodyMsg(el)).toBe('Files you edit show here.')
    const blank = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(blank))
    expect(blank.defaultPrevented).toBe(true)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('the Files lens is today\'s tree, unchanged', async () => {
    const { el } = await mount({ lens: 'files' })
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(fileRow(el)?.textContent).toBe('a')
  })

  it('clicking a tab reports UP to App and flips nothing by itself — the value is App\'s', async () => {
    const { el, props } = await mount({ lens: 'favorites' })
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(selectedTabs(el)).toEqual(['Favorites']) // still Favorites until App hands the new lens back
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('App handing the new lens back down is what swaps the body', async () => {
    const { el, rerender } = await mount({ lens: 'favorites' })
    expect(bodyMsg(el)).toContain('No favorites yet')
    await rerender({ lens: 'files' })
    expect(selectedTabs(el)).toEqual(['Files'])
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(bodyMsg(el)).toBeNull()
  })

  it('switching Files → Favorites → Files never tears the tree down: its expansion is waiting', async () => {
    const { el, rerender } = await mount({ lens: 'files' })
    const before = dirItem(el)?.getAttribute('aria-expanded')
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--dir')?.click())
    const toggled = dirItem(el)?.getAttribute('aria-expanded')
    expect(toggled).not.toBe(before)
    await rerender({ lens: 'favorites' })
    expect(el.querySelector('.tree')).toBeNull()
    await rerender({ lens: 'files' })
    expect(dirItem(el)?.getAttribute('aria-expanded')).toBe(toggled)
  })

  it('S33: a search shown from FAVORITES is of the whole vault, favorited or not; back on Favorites the body is the tab\'s own', async () => {
    const { el, rerender } = await mount({ lens: 'favorites' }, withIndex)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(resultLabels(el)).toEqual(['Docs', 'Anchor', 'Alpha'])
    expect(bodyMsg(el)).toBeNull()
    await rerender({ lens: 'favorites' })
    expect(resultLabels(el)).toEqual([])
    expect(bodyMsg(el)).toContain('No favorites yet')
  })

  it('the tabs row stays visible and clickable on the Search tab, and a tab switch keeps the query (YAZ-2638 S10)', async () => {
    const { el, props, rerender } = await mount({ lens: 'favorites' }, withIndex)
    await type(searchInput(el)!, 'a')
    expect(selectedTabs(el)).toEqual(['Search'])
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    await rerender({ lens: 'files' })
    expect(resultLabels(el)).toEqual(['Docs', 'Alpha']) // the Files tree: the query is the body of the Search tab only
    expect(bodyMsg(el)).toBeNull()
    await rerender({ lens: 'search' })
    expect(searchBar(el)?.value).toBe('a') // the query is untouched by the switch
    expect(resultLabels(el)).toEqual(['Docs', 'Anchor', 'Alpha'])
  })

  it('the Search tab offers no blank-space menu, whichever tab it was shown from — a result list has no root to target (YAZ-803)', async () => {
    const { el } = await mount({ lens: 'favorites' }, withIndex)
    await type(searchInput(el)!, 'a')
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('the tab row fits: the saved row and the ⋯ menu (YAZ-3273, YAZ-3278)', () => {
  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses[role="tablist"] [role="tab"]')]
  const tabNames = (el: HTMLElement) => tabs(el).map((b) => b.textContent || b.getAttribute('aria-label'))
  const more = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__more')
  const items = (el: HTMLElement) => menuItems(el).map((b) => `${b.textContent}${b.disabled ? ' (off)' : ''}${b.dataset.hint === undefined ? '' : ` [${b.dataset.hint}]`}`)
  const withTabs = (sidebarTabs: Partial<SidebarTabsPrefs>) => ({ settings: { ...DEFAULT_SETTINGS, sidebarTabs: { ...DEFAULT_SIDEBAR_TABS, ...sidebarTabs } } })
  /** A mouse click: `detail` 1. `HTMLElement.click()` is 0, which is what Enter or Space make. */
  const mouseClick = (b: Element | null) => act(() => void b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
  const rightClick = (target: Element | null) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 })
    act(() => void target?.dispatchEvent(e))
    return e
  }
  const key = (k: string) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  const closeOverlay = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

  it('D8: the row draws the saved order, without the hidden tabs; a tab on the bar does not drag (D5, S27); with nothing off the bar there is no ⋯ (S1)', async () => {
    const plain = await mount({ lens: 'files' })
    expect(tabNames(plain.el)).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
    expect(more(plain.el)).toBeNull()
    const { el } = await mount({ lens: 'files', ...withTabs({ order: ['recents', 'files', 'favorites', 'search', 'focus', 'sessions'], hidden: ['focus'] }) })
    expect(tabNames(el)).toEqual(['Recents', 'Files', 'Favorites', 'Search', 'Sessions'])
    expect(tabs(el).map((b) => b.draggable)).toEqual([false, false, false, false, false])
    // ⋯ stands right of the last tab and left of Sort (D2, D7).
    expect([...el.querySelectorAll('.sidebar__lenses > button')].slice(-3).map((b) => b.className)).toEqual(['sidebar__more', 'sidebar__sort', 'sidebar__expand-all'])
  })

  it('S12, S13: a click on ⋯ opens the menu of the hidden tabs below it; a click on a tab opens it and closes the menu; a second click on ⋯ closes it', async () => {
    const { el, props } = await mount({ lens: 'files', ...withTabs({ hidden: ['focus', 'recents'] }) })
    mouseClick(more(el))
    expect(more(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(items(el)).toEqual(['Focus [hidden]', 'Recents [hidden]', 'Edit tab row…'])
    act(() => itemByLabel(el, 'Recents')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('recents')
    expect(items(el)).toEqual([])
    mouseClick(more(el))
    expect(items(el)).not.toEqual([])
    mouseClick(more(el)) // the overlay takes a real press; the button's own toggle closes it too
    expect(items(el)).toEqual([])
  })

  it('S6, S14: the open tab inside ⋯ lights it, and the row does not move', async () => {
    const { el } = await mount({ lens: 'focus', ...withTabs({ hidden: ['focus'] }) })
    expect(tabNames(el)).toEqual(['Files', 'Search', 'Favorites', 'Sessions', 'Recents'])
    expect(more(el)?.className).toBe('sidebar__more sidebar__more--lit')
    mouseClick(more(el))
    expect(items(el)).toEqual(['Focus [open]', 'Edit tab row…'])
  })

  it('S7: the Search tab inside ⋯ still shows its bar, and ↑ from the bar goes to the lit ⋯ (YAZ-2663 D12)', async () => {
    const { el } = await mount({ lens: 'search', ...withTabs({ hidden: ['search'] }) })
    expect(more(el)?.classList.contains('sidebar__more--lit')).toBe(true)
    act(() => searchInput(el)?.focus())
    key('ArrowUp')
    expect(document.activeElement).toBe(more(el))
  })

  it('S11: right-click on blank space in the row, or on a tab, opens the same menu', async () => {
    const { el } = await mount({ lens: 'files', ...withTabs({ hidden: ['sessions'] }) })
    expect(rightClick(el.querySelector('.sidebar__lenses')).defaultPrevented).toBe(true)
    expect(items(el)).toEqual(['Sessions [hidden]', 'Edit tab row…'])
  })

  it('S9, S10 (YAZ-3279): right-click on a tab puts "Hide <tab>" first; on Files it is off, "Files stays"; no Electron menu', async () => {
    const { el, props } = await mount({ lens: 'files', ...withTabs({ hidden: ['sessions'] }) })
    expect(rightClick(tabs(el)[1]).defaultPrevented).toBe(true)
    expect(items(el)).toEqual(['Hide Search', 'Sessions [hidden]', 'Edit tab row…'])
    closeOverlay(el)
    rightClick(tabs(el)[0])
    expect(items(el)).toEqual(['Hide Files (off) [Files stays]', 'Sessions [hidden]', 'Edit tab row…'])
    act(() => itemByLabel(el, 'Hide Files')?.click())
    expect(props.onChangeSettings).not.toHaveBeenCalled()
    closeOverlay(el)
    rightClick(tabs(el)[2])
    act(() => itemByLabel(el, 'Hide Focus')?.click())
    expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith(withTabs({ hidden: ['sessions', 'focus'] }).settings)
  })

  it('S9: with nothing off the bar, a right-click on a tab is "Hide <tab>" and "Edit tab row…"', async () => {
    const { el } = await mount({ lens: 'files' })
    rightClick(tabs(el)[3])
    expect(items(el)).toEqual(['Hide Favorites', 'Edit tab row…'])
  })

  it('S17, S18, S26 (YAZ-3279): "Edit tab row…" opens the panel where the menu was, the right-clicked tab lit; a box writes the row through the settings and the panel stays; a press outside closes it', async () => {
    const { el, props, rerender } = await mount({ lens: 'files' })
    rightClick(tabs(el)[2])
    act(() => itemByLabel(el, 'Edit tab row…')?.click())
    expect(items(el)).toEqual([]) // the menu gave way to the panel
    const panel = () => el.querySelector<HTMLElement>('.tab-row-panel[role="dialog"]')
    expect([panel()?.style.left, panel()?.style.top]).toEqual(['40px', '30px'])
    expect(panel()?.querySelector('.tab-row-panel__row--focus')?.getAttribute('data-tab')).toBe('focus')
    act(() => panel()?.querySelector<HTMLButtonElement>('[aria-label="Show Recents"]')?.click())
    const next = vi.mocked(props.onChangeSettings).mock.calls[0][0]
    expect(next).toEqual(withTabs({ hidden: ['recents'] }).settings)
    await rerender({ settings: next })
    expect(tabNames(el)).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions']) // S18: it leaves the row at once
    expect(panel()?.querySelector('[aria-label="Show Recents"]')?.getAttribute('aria-checked')).toBe('false')
    act(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(panel()).toBeNull()
  })

  it('S14 (YAZ-3279): "Hide" on the open tab: it goes into ⋯, stays open, and ⋯ lights', async () => {
    const { el, props, rerender } = await mount({ lens: 'favorites' })
    rightClick(tabs(el)[3])
    act(() => itemByLabel(el, 'Hide Favorites')?.click())
    const next = vi.mocked(props.onChangeSettings).mock.calls[0][0]
    expect(next.sidebarTabs.hidden).toEqual(['favorites'])
    await rerender({ settings: next })
    expect(tabNames(el)).toEqual(['Files', 'Search', 'Focus', 'Sessions', 'Recents'])
    expect(more(el)?.classList.contains('sidebar__more--lit')).toBe(true)
    expect(props.onLensChange).not.toHaveBeenCalled()
  })

  it('D9, S15: a hidden Sort leaves the bar and ⋯ shows; "Sort…" opens the sort menu of the tab that shows; a hidden fold acts as the button does', async () => {
    const { el, props } = await mount({ lens: 'files', ...withTabs({ hiddenButtons: ['sort', 'fold'] }) })
    expect(el.querySelector('.sidebar__lenses .sidebar__sort')).toBeNull()
    expect(el.querySelector('.sidebar__lenses .sidebar__expand-all')).toBeNull()
    expect(tabNames(el)).toHaveLength(6)
    mouseClick(more(el))
    const fold = items(el)[1]
    expect([items(el)[0], ['Expand all', 'Collapse all'].includes(fold)]).toEqual(['Sort…', true]) // the fold button's own label
    act(() => itemByLabel(el, 'Sort…')?.click())
    expect(menuItems(el).map((b) => `${b.textContent}${b.dataset.hint ?? ''}`)).toEqual(['Name✓', 'Last updated', 'A to Z✓', 'Z to A'])
    act(() => itemByLabel(el, 'Last updated')?.click())
    expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith({ ...withTabs({ hiddenButtons: ['sort', 'fold'] }).settings, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, files: { by: 'updated', reverse: false } } })
    mouseClick(more(el))
    act(() => itemByLabel(el, fold)?.click())
    mouseClick(more(el))
    expect(items(el)).toEqual(['Sort…', fold === 'Expand all' ? 'Collapse all' : 'Expand all', 'Edit tab row…']) // the fold ran, as the button's click does
  })

  it('S5: on Sessions neither Sort nor fold shows, so a hidden one is not in the menu either: no ⋯', async () => {
    const { el } = await mount({ lens: 'sessions', ...withTabs({ hiddenButtons: ['sort', 'fold'] }) })
    expect(more(el)).toBeNull()
  })

  it('S16: Enter on ⋯ puts the focus in the menu; ↑ ↓ walk its items, from the tabs with no room past the line to the hidden tabs; ← → and ↓ do nothing else; Esc closes it and the focus is back on ⋯', async () => {
    const { el } = await mount({ lens: 'files', ...withTabs({ hidden: ['focus', 'sessions'] }) })
    more(el)?.focus()
    act(() => more(el)?.click()) // detail 0: a key
    expect(document.activeElement?.textContent).toBe('Focus')
    key('ArrowDown')
    expect(document.activeElement?.textContent).toBe('Sessions')
    key('ArrowDown')
    key('ArrowDown')
    expect(document.activeElement?.textContent).toBe('Edit tab row…') // stops at the end
    key('ArrowUp')
    key('ArrowUp')
    key('ArrowUp')
    expect(document.activeElement?.textContent).toBe('Focus') // back at the first item
    key('ArrowRight')
    key('ArrowLeft')
    expect(document.activeElement?.textContent).toBe('Focus')
    expect(el.querySelector('.tree__row:focus')).toBeNull()
    key('Escape')
    expect(items(el)).toEqual([])
    expect(document.activeElement).toBe(more(el))
  })

  it('YAZ-2663 D12: ← and → walk the tabs on the bar only', async () => {
    const { el } = await mount({ lens: 'files', ...withTabs({ hidden: ['search'] }) })
    tabs(el)[0].focus()
    key('ArrowRight')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Focus')
    key('ArrowLeft')
    key('ArrowLeft')
    expect(document.activeElement?.textContent).toBe('Files')
  })

  it('YAZ-3300: ← on the lit ⋯, where ↑ from the search bar lands, goes to the last tab on the bar', async () => {
    const { el } = await mount({ lens: 'search', ...withTabs({ hidden: ['search'] }) })
    act(() => searchInput(el)?.focus())
    key('ArrowUp')
    expect(document.activeElement).toBe(more(el))
    key('ArrowLeft')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Recents')
  })

  it('YAZ-3300: → on ⋯ stays in the row, as → on the last tab does; it does not leave for the page', async () => {
    const onLeaveToPage = vi.fn(() => true)
    const { el } = await mount({ lens: 'search', onLeaveToPage, ...withTabs({ hidden: ['search'] }) })
    act(() => searchInput(el)?.focus())
    key('ArrowUp')
    key('ArrowRight')
    expect(onLeaveToPage).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(more(el))
  })

  it('YAZ-3278 S16: Shift+F10 on a tab opens its menu with the focus on the first item; Esc puts the focus back on the tab', async () => {
    const { el } = await mount({ lens: 'files', ...withTabs({ hidden: ['sessions'] }) })
    tabs(el)[1].focus()
    act(() => void tabs(el)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })))
    expect(items(el)).toEqual(['Hide Search', 'Sessions [hidden]', 'Edit tab row…'])
    expect(document.activeElement?.textContent).toBe('Hide Search')
    key('ArrowDown')
    expect(document.activeElement?.textContent).toBe('Sessions')
    key('Escape')
    expect(items(el)).toEqual([])
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Search')
  })

  it('YAZ-3278 S16: the context-menu key on ⋯ opens the row menu with the focus on the first item, and ⋯ says it is open; Esc puts the focus back on ⋯', async () => {
    const { el } = await mount({ lens: 'files', ...withTabs({ hidden: ['sessions'] }) })
    more(el)?.focus()
    key('ContextMenu')
    expect(items(el)).toEqual(['Sessions [hidden]', 'Edit tab row…'])
    expect(more(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('Sessions')
    key('Escape')
    expect(document.activeElement).toBe(more(el))
  })

  const panelOf = (el: HTMLElement) => el.querySelector('.tab-row-panel')

  it('YAZ-3279 S26: from ⋯ by the keyboard, the panel takes the focus, and Esc gives it back to ⋯', async () => {
    const panel = panelOf
    const a = await mount({ lens: 'files', ...withTabs({ hidden: ['sessions'] }) })
    more(a.el)?.focus()
    act(() => more(a.el)?.click()) // detail 0: a key
    key('End')
    act(() => (document.activeElement as HTMLElement).click())
    expect(panel(a.el)?.contains(document.activeElement)).toBe(true)
    key('Escape')
    expect(panel(a.el)).toBeNull()
    expect(document.activeElement).toBe(more(a.el))
  })

  it('YAZ-3279 S26: the panel from a right-click on a tab gives the focus back to that tab when it closes', async () => {
    const panel = panelOf
    const b = await mount({ lens: 'files' })
    rightClick(tabs(b.el)[2])
    act(() => itemByLabel(b.el, 'Edit tab row…')?.click())
    key('Escape')
    expect(panel(b.el)).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Focus')
  })

  it('YAZ-3279 S26: the panel from a right-click on blank space gives the focus to the tab that shows when it closes', async () => {
    const c = await mount({ lens: 'favorites' })
    rightClick(c.el.querySelector('.sidebar__lenses'))
    act(() => itemByLabel(c.el, 'Edit tab row…')?.click())
    key('Escape')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Favorites')
  })

  describe('the fit (D1, S2 to S5, S30)', () => {
    // A fake layout: the row is `width` px wide, Files 47 px, a glyph 31 px, each button 30 px, no gap and no padding (no CSS in jsdom).
    let width = 400
    let observed: (() => void)[] = []
    beforeEach(() => {
      width = 400
      observed = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private cb: () => void) {}
          observe() {
            observed.push(this.cb)
          }
          disconnect() {
            observed = observed.filter((cb) => cb !== this.cb)
          }
        },
      )
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('sidebar__lenses') ? width : 0
      })
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const w = this.matches('.sidebar__lens') ? (this.dataset.tab === 'files' ? 47 : 31) : this.matches('.sidebar__more, .sidebar__sort, .sidebar__expand-all') ? 30 : 0
        return new DOMRect(0, 0, w, 20)
      })
    })
    afterEach(() => vi.unstubAllGlobals())
    const resize = (w: number) => {
      width = w
      act(() => [...new Set(observed)].forEach((cb) => cb()))
    }

    it('S2, S4, S6: narrow, the last tabs go into ⋯, first in its menu, and the open one lights it; wider, they come back in order', async () => {
      const { el } = await mount({ lens: 'recents' })
      expect(tabNames(el)).toHaveLength(6)
      // Sort is not on Recents (S5): fold only, if it shows — here there is nothing to fold either.
      resize(200) // 47 + 31 × 3 + 30 (⋯) = 170 fits; a fourth glyph does not
      expect(tabNames(el)).toEqual(['Files', 'Search', 'Focus', 'Favorites'])
      expect(more(el)?.className).toBe('sidebar__more sidebar__more--lit')
      mouseClick(more(el))
      expect(items(el)).toEqual(['Sessions', 'Recents [open]', 'Edit tab row…'])
      closeOverlay(el)
      resize(400)
      expect(tabNames(el)).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
      expect(more(el)).toBeNull()
    })

    it('S5: on Files the fit counts Sort and fold, so fewer tabs fit than on Recents at the same width', async () => {
      const files = await mount({ lens: 'files' })
      resize(260) // 47 + 31 × n + 30 (⋯) + 60 ≤ 260 → n = 3
      expect(tabNames(files.el)).toEqual(['Files', 'Search', 'Focus', 'Favorites'])
      expect([...files.el.querySelectorAll('.sidebar__lenses > button')].slice(-3).map((b) => b.className)).toEqual(['sidebar__more', 'sidebar__sort', 'sidebar__expand-all'])
    })

    it('S30: a width change that keeps the count keeps the row as it is; the row is measured on each change', async () => {
      const { el } = await mount({ lens: 'recents' })
      resize(200)
      const before = tabs(el)
      const spy = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
      spy.mockClear()
      resize(195)
      resize(190)
      expect(tabs(el)).toEqual(before) // the same four buttons: no tab came or went
      expect(spy).toHaveBeenCalled()
    })
  })
})

/**
 * Expand / collapse all (⚡ YAZ-862): ONE double-chevron button at the end of the lens row,
 * replacing the whole expanded set in a single dispatch. Anything open means the click collapses;
 * only a fully closed tree expands. It belongs to the tree BODY,
 * so it is GONE (never disabled) on the Search tab (YAZ-2638 S17) and in a vault with no folders to open.
 */
describe('expand / collapse all (⚡ YAZ-862)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: 'n.md', path, size: 1, mtime: 1, kind: 'markdown' })
  /** Two depths of folder: docs/ holding deep/, notes/ empty beside it, and a note at the top. */
  const NESTED = (v: string): TreeNode[] => [
    {
      type: 'dir',
      name: 'docs',
      path: `${v}/docs`,
      children: [{ type: 'dir', name: 'deep', path: `${v}/docs/deep`, children: [note(`${v}/docs/deep/n.md`)] }],
    },
    { type: 'dir', name: 'notes', path: `${v}/notes`, children: [] },
    note(`${v}/n.md`),
  ]

  // Expansion is persisted per ROOT in the app-state cache, which is module-level and outlives a
  // test — so every mount here opens its OWN vault and therefore starts from an empty set.
  let vaults = 0
  const mountVault = async (nodes: (v: string) => TreeNode[] = NESTED) => {
    const vault = `/v-all-${++vaults}`
    return mount({ root: vault }, (b) => b.tree.mockResolvedValue({ root: vault, tree: nodes(vault), generatedAt: 1 } as never))
  }
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
  const label = (el: HTMLElement) => allButton(el)?.getAttribute('aria-label') ?? null
  const dirLabels = (el: HTMLElement) => [...el.querySelectorAll('.tree__row--dir .tree__label')].map((n) => n.textContent)
  const dirRow = (el: HTMLElement, i: number) => el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')[i]

  it('a closed tree offers "Expand all", and one click opens every folder at every depth', async () => {
    const { el } = await mountVault()
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
    expect(allButton(el)?.title).toBe('Expand all')
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'deep', 'notes'])
    expect(label(el)).toBe('Collapse all')
    expect(allButton(el)?.title).toBe('Collapse all')
  })

  it('an open tree — fully or PARTLY — offers "Collapse all", and one click closes the lot; with one vault the button asks nothing of a vault row (YAZ-2631 S61)', async () => {
    const { el, props } = await mountVault()
    act(() => allButton(el)?.click())
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
    // One open folder is enough — the button never offers to expand a tree that is already part way.
    act(() => dirRow(el, 1)?.click())
    expect(label(el)).toBe('Collapse all')
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
    expect(props.onSetVaultOpen).not.toHaveBeenCalled()
  })

  it('there is no button on the Search tab (YAZ-2638 S17), or in a vault with no folders', async () => {
    const searched = await mountVault()
    const input = searchInput(searched.el)!
    await type(input, 'a')
    expect(allButton(searched.el)).toBeNull()
    await type(input, '')
    expect(allButton(searched.el)).toBeNull()
    await searched.rerender({ lens: 'files' })
    expect(allButton(searched.el)).not.toBeNull() // back with the tree it belongs to

    const flat = await mountVault((v) => [note(`${v}/n.md`)])
    expect(flat.el.querySelector('.tree__row--file')).not.toBeNull()
    expect(allButton(flat.el)).toBeNull()
  })

  it('each open level carries its depth for the level line, the top level none; a fold takes the level away (YAZ-3309 D1)', async () => {
    const { el } = await mountVault()
    const depths = () => [...el.querySelectorAll<HTMLElement>('.tree[role="group"]')].map((ul) => ul.style.getPropertyValue('--tree-depth'))
    expect(depths()).toEqual([])
    act(() => allButton(el)?.click())
    // docs/ (1) holding deep/ (2), then the empty notes/ (1): app.css draws each line at depth * 14 + 1 px.
    expect(depths()).toEqual(['1', '2', '1'])
    expect(el.querySelector('.tree[role="tree"]')?.getAttribute('style')).toBeNull()
    act(() => dirRow(el, 1)?.click())
    expect(depths()).toEqual(['1', '1'])
  })

  it('bug YAZ-3329: "On hover" is two attributes that the sidebar writes on the list, only when a value changes and only with that choice; the mouse and the keys inside the list render nothing again (YAZ-3309 D3)', async () => {
    const { el, rerender } = await mountVault()
    act(() => allButton(el)?.click())
    const body = el.querySelector<HTMLElement>('.sidebar__body')!
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.tree__row')]
    const marks = () => [body.hasAttribute('data-mouse-in'), body.hasAttribute('data-key-focus')]
    // Only the list's own attributes change: no row renders again, and nothing else in the DOM moves.
    labelRenders.names = []
    const changes: string[] = []
    const watch = new MutationObserver((records) => changes.push(...records.map((r) => (r.type === 'attributes' && r.target === body ? r.attributeName! : `${r.type} ${(r.target as Element).className}`))))
    watch.observe(el, { attributes: true, childList: true, subtree: true, characterData: true })
    const fire = (target: Element, type: 'mouseenter' | 'mouseleave') => act(() => void target.dispatchEvent(new MouseEvent(type)))

    fire(body, 'mouseenter')
    expect(marks()).toEqual([true, false])
    fire(rows[1], 'mouseenter') // a row's own enter does not reach the list: no write
    fire(body, 'mouseleave')
    expect(marks()).toEqual([false, false])
    // `:focus-visible` as Chromium has it when `focusin` runs (jsdom says no there): the focused row, unless a mouse click focused it.
    const byMouse = new Set<Element>()
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === '.tree__row:focus-visible' ? this === document.activeElement && this.matches('.tree__row') && !byMouse.has(this) : matches.call(this, selector)
    })
    // The keyboard on a row, then from row to row: one write.
    const focus = (row: HTMLElement) => act(() => row.focus())
    focus(rows[0])
    focus(rows[1])
    focus(rows[2])
    expect(marks()).toEqual([false, true])
    // A row that a mouse click focuses is no keyboard focus (S3): the mark goes.
    byMouse.add(rows[0])
    focus(rows[0])
    expect(marks()).toEqual([false, false])
    focus(rows[1])
    expect(marks()).toEqual([false, true])
    // The focus leaves the list: the mark goes.
    act(() => rows[1].blur())
    expect(marks()).toEqual([false, false])
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    watch.disconnect()
    expect(changes).toEqual(['data-mouse-in', 'data-mouse-in', 'data-key-focus', 'data-key-focus', 'data-key-focus', 'data-key-focus'])
    expect(labelRenders.names).toEqual([])

    // "Always show" and "Never": nothing is written, and a mark that stood goes.
    fire(body, 'mouseenter')
    for (const sidebarLines of ['always', 'off'] as const) {
      await rerender({ settings: { ...DEFAULT_SETTINGS, sidebarLines } })
      expect(marks()).toEqual([false, false])
      fire(body, 'mouseenter')
      act(() => rows[2].focus())
      expect(marks()).toEqual([false, false])
      act(() => rows[2].blur())
    }
    await rerender({ settings: { ...DEFAULT_SETTINGS } })
    fire(body, 'mouseenter')
    expect(marks()).toEqual([true, false])
  })
})

/**
 * The Focus tab (YAZ-2619): the lens between Files and the heart, listing the files and folders the
 * user added from any row's menu, in the order added, each a full tree row (D2). The list is the
 * VAULT's, kept in the vault (YAZ-2702 Decision 1): read through `focus.get`, written through
 * `focus.set`, and read again on `focus.onChanged` — never the window's identity, never the vault
 * bucket of the app state. Every mount here opens its OWN vault. The lens itself is App's: an add
 * reports `onLensChange('focus')`, and the test hands the new lens back down as App does. Each
 * title names the cases of the scenario record it proves; a YAZ-2702 case says so.
 */
describe('focus tab (YAZ-2619)', () => {
  const note = (path: string, name: string): TreeNode => ({ type: 'file', name, path, size: 1, mtime: 1, kind: 'markdown' })
  /** Notes/ holding Sub/, Projects/ holding Alpha/, the prefix-sharing Projects-Archive/, and a root note. */
  const FOCUS = (v: string): TreeNode[] => [
    {
      type: 'dir', name: 'Notes', path: `${v}/Notes`,
      children: [{ type: 'dir', name: 'Sub', path: `${v}/Notes/Sub`, children: [] }, note(`${v}/Notes/n.md`, 'n.md')],
    },
    {
      type: 'dir', name: 'Projects', path: `${v}/Projects`,
      children: [
        { type: 'dir', name: 'Alpha', path: `${v}/Projects/Alpha`, children: [note(`${v}/Projects/Alpha/a.md`, 'a.md')] },
        note(`${v}/Projects/p.md`, 'p.md'),
      ],
    },
    { type: 'dir', name: 'Projects-Archive', path: `${v}/Projects-Archive`, children: [note(`${v}/Projects-Archive/old.md`, 'old.md')] },
    note(`${v}/top.md`, 'top.md'),
  ]
  const EVERY_TOP_ROW = ['Notes', 'Projects', 'Projects-Archive', 'top']
  const EMPTY = 'Nothing in focus. Right-click a file or folder → Add to focus.'

  let vaults = 0
  /**
   * One fresh vault AND one fresh WINDOW per mount (`storage.init()` against this mount's bridge).
   * `focus` seeds the list the VAULT holds, the way main reads it from the vault's focus file
   * (YAZ-2702): what `focus.get` answers. `emitFocus` is main's push that a focus file changed.
   */
  const mountVault = async (over: Partial<SidebarProps> = {}, opts: { nodes?: (v: string) => TreeNode[]; focus?: string[] } = {}, tweak?: (bridge: ReturnType<typeof installBridge>) => void) => {
    const v = `/v-focus-${++vaults}`
    const held: { emit: ((change: { root: string }) => void) | null } = { emit: null }
    const m = await mount({ root: v, ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: (opts.nodes ?? FOCUS)(v), generatedAt: 1 } as never)
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue((opts.focus ?? []).map((p) => `${v}${p}`))
      b.focus.onChanged.mockImplementation((listener) => {
        held.emit = listener
        return () => undefined
      })
      tweak?.(b)
      await storage.init()
    })
    return { ...m, v, emitFocus: (root: string) => act(async () => held.emit?.({ root })) }
  }

  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const rowsByPath = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)]
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const dropSelection = (el: HTMLElement) => act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  /** Only the rows drawn at depth 0 — every nested list is a `role="group"`, so this is what "a top row" means. */
  const topLabels = (el: HTMLElement) => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((n) => n.textContent)
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
  const isOpen = (el: HTMLElement, path: string) => rowByPath(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  /** The line above the list (D4): "N in focus", or null when it is not drawn. */
  const countLine = (el: HTMLElement) => el.querySelector('.sidebar__focus-bar span')?.textContent ?? null
  const clearButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__focus-bar .sidebar__focus-clear')
  const focusLabels = (el: HTMLElement) => menuItems(el).map((b) => b.textContent).filter((t) => t?.endsWith('focus'))
  /** The only way in or out of the list for one row: right-click it and take the menu's item. */
  const pick = async (el: HTMLElement, path: string, label: string) => {
    rightClick(rowByPath(el, path))
    await act(async () => itemByLabel(el, label)?.click())
  }
  /** jsdom has no DragEvent: a MouseEvent with the row's edge in `clientY` (the zero rect reads `< 0` as "before"). */
  const drag = (target: Element | null | undefined, type: string, clientY = 0) => act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
  /** What a drag draws: the line on a row's edge (a reorder), or the fill of a drop folder (a move on disk). */
  const marker = (el: HTMLElement) => el.querySelector('.tree__row--drop-before, .tree__row--drop-after, .tree__row--drop')
  /** The watcher-driven refresh idiom: a new tree answers the next `bridge.tree`, an event triggers it. */
  const withWatcher = () => {
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    return { watch, fire: (ev: WatchEvent) => emit?.(ev) }
  }

  it('S1, S2, S40, R3, R4: "Add to focus" on a folder, then on a file — the list grows in the order added, each add shows the Focus tab, the folder is open, and Files still shows the full vault', async () => {
    const { el, v, bridge, props, rerender } = await mountVault()
    await pick(el, `${v}/Projects`, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`])
    expect(bridge.window.setIdentity).not.toHaveBeenCalled() // the list is the vault's (YAZ-2702 S1): the window's identity holds none
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('focus')
    expect(props.onNotice).toHaveBeenLastCalledWith('Added to focus', 'info', 'lists')
    expect(topLabels(el)).toEqual(EVERY_TOP_ROW) // App has not handed the lens back yet: this is still Files, and it is not narrowed
    await pick(el, `${v}/top.md`, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`, `${v}/top.md`])
    // The folder opened in its own copy only (YAZ-3131 S4), never in Files; the file opened nothing.
    expect(storage.getExpanded(v)).toEqual([copyFoldKey(`${v}/Projects`, `${v}/Projects`)])
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['Projects', 'top'])
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(countLine(el)).toBe('2 in focus')
    await rerender({ lens: 'files' })
    expect(topLabels(el)).toEqual(EVERY_TOP_ROW)
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
  })

  it('S3, S4, S6, R5, R9, R12: a selection adds in panel order; a mixed one reads Add and puts in only the missing row; an all-in one reads "Remove 3 from focus" and keeps the tab', async () => {
    const { el, v, bridge, props, rerender } = await mountVault()
    shiftClickRow(rowByPath(el, `${v}/top.md`)) // click order top → Projects → Notes…
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    await pick(el, `${v}/Notes`, 'Add 3 to focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`, `${v}/top.md`]) // …panel order in
    expect(props.onNotice).toHaveBeenLastCalledWith('Added 3 to focus', 'info', 'lists')
    // The tab change an add asks for ends the selection, as every tab change does (R12).
    expect(el.querySelectorAll('.tree__row--selected')).not.toHaveLength(0)
    await rerender({ lens: 'focus' })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    await rerender({ lens: 'files' })
    shiftClickRow(rowByPath(el, `${v}/Projects`)) // already in the list…
    shiftClickRow(rowByPath(el, `${v}/Projects-Archive`)) // …this one not
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(focusLabels(el)).toEqual(['Add 2 to focus'])
    await act(async () => itemByLabel(el, 'Add 2 to focus')?.click())
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`, `${v}/top.md`, `${v}/Projects-Archive`])
    dropSelection(el)
    vi.mocked(props.onLensChange).mockClear()
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    shiftClickRow(rowByPath(el, `${v}/top.md`))
    await pick(el, `${v}/top.md`, 'Remove 3 from focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects-Archive`])
    expect(props.onNotice).toHaveBeenLastCalledWith('Removed 3 from focus', 'info', 'lists')
    expect(props.onLensChange).not.toHaveBeenCalled()
  })

  it('S5, S14, S16, S9, S7, S13, S15: Remove reads on an item from any tab and keeps the tab; a row inside a focused folder reads Add and becomes a top row too; removing the last item shows the empty message', async () => {
    const { el, v, bridge, props, rerender } = await mountVault({}, { focus: ['/Projects', '/top.md'] })
    await pick(el, `${v}/top.md`, 'Remove from focus') // on Files (S5, S14)
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`])
    expect(props.onNotice).toHaveBeenLastCalledWith('Removed from focus', 'info', 'lists')
    expect(props.onLensChange).not.toHaveBeenCalled()
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['Projects'])
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    dropSelection(el) // that click selected the folder (D9, YAZ-1674); this case is about single rows
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(focusLabels(el)).toEqual(['Remove from focus'])
    closeMenu(el)
    rightClick(rowByPath(el, `${v}/Projects/Alpha`))
    expect(focusLabels(el)).toEqual(['Add to focus']) // inside a focused folder, not in the list itself (S16)
    await act(async () => itemByLabel(el, 'Add to focus')?.click())
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`, `${v}/Projects/Alpha`])
    expect(props.onLensChange).not.toHaveBeenCalled() // already the Focus tab (S9)
    expect(topLabels(el)).toEqual(['Projects', 'Alpha'])
    expect(rowsByPath(el, `${v}/Projects/Alpha`)).toHaveLength(2) // a top row AND still inside its parent (S7)
    await pick(el, `${v}/Projects`, 'Remove from focus')
    expect(topLabels(el)).toEqual(['Alpha'])
    expect(countLine(el)).toBe('1 in focus')
    await pick(el, `${v}/Projects/Alpha`, 'Remove from focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [])
    expect(bodyMsg(el)).toBe(EMPTY)
    expect(countLine(el)).toBeNull()
    expect(props.onLensChange).not.toHaveBeenCalled()
  })

  it('S8: a file is in the list, then its parent folder is added — the two are top rows, and the file also shows inside the folder', async () => {
    const { el, v, rerender } = await mountVault({}, { focus: ['/Notes/n.md'] })
    await pick(el, `${v}/Notes`, 'Add to focus')
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['n', 'Notes'])
    expect(rowsByPath(el, `${v}/Notes/n.md`)).toHaveLength(2)
  })

  it('S12, R2; YAZ-2702 S5: an add past the limit keeps the first 500 of the vault and says so; at 500, one more changes nothing', async () => {
    const many = (v: string) => Array.from({ length: MAX_FOCUS + 1 }, (_, i) => note(`${v}/n${String(i).padStart(3, '0')}.md`, `n${String(i).padStart(3, '0')}.md`))
    const seeded = Array.from({ length: MAX_FOCUS - 1 }, (_, i) => `/n${String(i).padStart(3, '0')}.md`)
    const { el, v, bridge, props } = await mountVault({}, { nodes: many, focus: seeded })
    shiftClickRow(rowByPath(el, `${v}/n499.md`))
    shiftClickRow(rowByPath(el, `${v}/n500.md`))
    await pick(el, `${v}/n500.md`, 'Add 2 to focus')
    expect(bridge.focus.set).toHaveBeenCalledExactlyOnceWith(v, [...seeded.map((p) => `${v}${p}`), `${v}/n499.md`])
    expect(props.onNotice).toHaveBeenLastCalledWith(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
    vi.mocked(props.onNotice).mockClear()
    dropSelection(el)
    await pick(el, `${v}/n500.md`, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenCalledTimes(1) // the list did not change, so nothing was written
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
  })

  it('S18, S19, S21, S39: the tab row reads Files, magnifier (YAZ-2638 D2), eye, heart — the eye a glyph named "Focus" — and an empty list shows the message, no count line, no chevrons and no eye button', async () => {
    const { el, props } = await mountVault({ lens: 'focus' })
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses [role="tab"]')]
    expect(tabs.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
    const eye = tabs[2]
    expect(eye.textContent).toBe('')
    expect(eye.querySelector('svg')).not.toBeNull()
    expect(eye.title).toBe('Focus')
    expect(eye.className).toBe('sidebar__lens sidebar__lens--glyph sidebar__lens--active') // the accent rides on these two classes (app.css)
    expect(eye.getAttribute('aria-selected')).toBe('true')
    expect(el.querySelectorAll('.sidebar__lenses button')).toHaveLength(7) // the six tabs and the sort button (YAZ-3227 D5): no eye button at the far end, nothing to unfold
    expect(el.querySelector('.sidebar__lenses .sidebar__sort')).not.toBeNull()
    expect(bodyMsg(el)).toBe(EMPTY)
    expect(countLine(el)).toBeNull()
    act(() => tabs[0].click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
  })

  it('S17, S21, R5, R10, R11: the count is the top rows; the chevrons act on the tab\'s folders only and are gone when it shows none; "Clear" empties the list and keeps the tab', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'focus' }, { focus: ['/Projects', '/top.md'] })
    expect(bridge.focus.set).not.toHaveBeenCalled() // a list that was read is never written back
    expect(countLine(el)).toBe('2 in focus')
    expect(allButton(el)?.getAttribute('aria-label')).toBe('Expand all')
    act(() => allButton(el)?.click())
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(isOpen(el, `${v}/Projects/Alpha`)).toBe('true')
    // The copy's own keys (YAZ-3131 S5); Notes is not on the tab, so it never opened, and Files opened nothing.
    expect(storage.getExpanded(v)).toEqual([copyFoldKey(`${v}/Projects`, `${v}/Projects`), copyFoldKey(`${v}/Projects`, `${v}/Projects/Alpha`)])
    await pick(el, `${v}/Projects`, 'Remove from focus')
    expect(topLabels(el)).toEqual(['top'])
    expect(allButton(el)).toBeNull() // a file is no folder to unfold (S21)
    await act(async () => clearButton(el)?.click())
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [])
    expect(bodyMsg(el)).toBe(EMPTY)
    expect(countLine(el)).toBeNull()
    expect(props.onLensChange).not.toHaveBeenCalled()
  })

  it('S11, S20, S23; YAZ-2638 S20: a search shown from the Focus tab covers the full vault and has no count line; "Add to focus" on a result changes the list and stays on the Search tab, the query and the results in place; Esc goes back to the list', async () => {
    const { el, v, bridge, props, rerender } = await mountVault({ lens: 'focus' }, { focus: ['/Projects'] })
    vi.spyOn(storage, 'getSidebarLens').mockReturnValue('focus') // the lens the window last showed
    const input = searchInput(el)!
    await type(input, 'Notes')
    const result = rowByPath(el, `${v}/Notes`) // Notes is not in the list: the search is the vault's, drawn as its tree (YAZ-2620)
    expect([result?.querySelector('.tree__mark')?.textContent, result?.classList.contains('tree__row--context')]).toEqual(['Notes', false])
    expect(countLine(el)).toBeNull()
    rightClick(result)
    await act(async () => itemByLabel(el, 'Add to focus')?.click())
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`, `${v}/Notes`])
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect(props.onLensChange).not.toHaveBeenCalled() // YAZ-2638 S20: no jump to the Focus tab
    expect(input.value).toBe('Notes')
    expect(rowByPath(el, `${v}/Notes`)?.querySelector('.tree__mark')).not.toBeNull()
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('focus')
    expect(input.value).toBe('Notes')
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['Projects', 'Notes'])
    expect(countLine(el)).toBe('2 in focus')
  })

  it('YAZ-2702 S13 (overturns S31, R13): an item whose file is not on this Mac draws no row and STAYS in the list — at the first tree and at a tree refresh that loses one — and no write prunes it; the next write of the user still holds it', async () => {
    const { watch, fire: emit } = withWatcher()
    const { el, v, bridge } = await mountVault({ lens: 'focus', watch }, { focus: ['/Projects', '/not-synced-yet.md', '/top.md'] })
    expect(topLabels(el)).toEqual(['Projects', 'top'])
    expect(countLine(el)).toBe('2 in focus')
    bridge.tree.mockResolvedValue({ root: v, tree: FOCUS(v).filter((n) => n.path !== `${v}/top.md`), generatedAt: 2 } as never)
    await act(async () => emit({ type: 'unlink', path: `${v}/top.md` }))
    await afterQuiet()
    expect(topLabels(el)).toEqual(['Projects'])
    expect(bridge.focus.set).not.toHaveBeenCalled()
    await pick(el, `${v}/Projects`, 'Remove from focus')
    expect(bridge.focus.set.mock.calls).toEqual([[v, [`${v}/not-synced-yet.md`, `${v}/top.md`]]])
    expect(bodyMsg(el)).toBe(EMPTY) // two items, no row
  })

  it('YAZ-2702 S7, S12: `focus:changed` for the vault of the window reads its list again and draws it at once — another window\'s change, or a file that a sync brought; one for a different vault reads nothing; the read writes nothing back', async () => {
    const { el, v, bridge, emitFocus } = await mountVault({ lens: 'focus' }, { focus: ['/Projects'] })
    expect(topLabels(el)).toEqual(['Projects'])
    bridge.focus.get.mockClear() // the read of the mount (StrictMode mounts twice)
    bridge.focus.get.mockResolvedValue([`${v}/top.md`, `${v}/Projects`, `${v}/Notes`])
    await emitFocus('/some/other/vault')
    expect(bridge.focus.get).not.toHaveBeenCalled()
    expect(topLabels(el)).toEqual(['Projects'])
    await emitFocus(v)
    expect(bridge.focus.get.mock.calls).toEqual([[v]])
    expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
    expect(countLine(el)).toBe('3 in focus')
    expect(bridge.focus.set).not.toHaveBeenCalled()
  })

  it('YAZ-2702 S6, S14: an add before the vault\'s list has been read writes nothing and says so; a write that main refuses puts the list back and says why', async () => {
    let answer: ((list: string[]) => void) | undefined
    const { el, v, bridge, props, rerender } = await mountVault({}, {}, (b) => b.focus.get.mockImplementation(() => new Promise((resolve) => (answer = resolve))))
    await pick(el, `${v}/top.md`, 'Add to focus')
    expect(bridge.focus.set).not.toHaveBeenCalled() // the list on disk is not known yet: a write would replace it
    expect(props.onNotice).toHaveBeenLastCalledWith('Focus is still loading. Try again.', 'error')
    await act(async () => answer?.([`${v}/Projects`]))
    bridge.focus.set.mockRejectedValueOnce(new Error('the focus file is read-only'))
    await pick(el, `${v}/top.md`, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenCalledExactlyOnceWith(v, [`${v}/Projects`, `${v}/top.md`])
    expect(props.onNotice).toHaveBeenLastCalledWith("Can't save focus: the focus file is read-only", 'error')
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['Projects'])
    expect(countLine(el)).toBe('1 in focus')
  })

  it('S34, S40: a restored list never narrows Files, and "Show in sidebar" shows a row outside the list there without changing the list', async () => {
    const { el, v, bridge, rerender } = await mountVault({ lens: 'focus' }, { focus: ['/Projects'] })
    // What App's `showInSidebar` does from any other tab: flip to Files and issue the request.
    await rerender({ lens: 'files', revealRequest: { id: 1, path: `${v}/Notes/n.md` } })
    expect(topLabels(el)).toEqual(EVERY_TOP_ROW)
    expect(rowByPath(el, `${v}/Notes/n.md`)?.classList.contains('tree__row--revealed')).toBe(true)
    expect(bridge.focus.set).not.toHaveBeenCalled()
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['Projects'])
  })

  it('S35, S36, R7: "New note" on a folder the tab shows opens the input inside it; a target the tab does not show — or an empty list, the heart tab\'s as well — goes to Files; blank space has no focus item', async () => {
    const { el, v, props } = await mountVault({ lens: 'focus' }, { focus: ['/Projects', '/Notes/n.md'] })
    await pick(el, `${v}/Projects`, 'New note')
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(rowByPath(el, `${v}/Projects`)?.closest('[role="treeitem"]')?.querySelector('.create-inline__input')).not.toBeNull()
    act(() => void el.querySelector('.create-inline__input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await pick(el, `${v}/Notes/n.md`, 'New note') // its folder, Notes, is not on the tab
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    act(() => root?.unmount())
    container?.remove()
    for (const lens of ['focus', 'favorites'] as const) {
      const empty = await mountVault({ lens })
      rightClick(empty.el.querySelector('.sidebar__body'))
      expect(focusLabels(empty.el)).toEqual([])
      await act(async () => itemByLabel(empty.el, 'New note')?.click())
      expect(empty.props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
      await empty.rerender({ lens: 'files' })
      expect(empty.el.querySelector('.create-inline__input')).not.toBeNull()
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('S38: on the Focus tab a row carries the row menu of Files — Rename edits in place, Cut reaches the file clipboard', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'focus' }, { focus: ['/Projects', '/top.md'] })
    rightClick(rowByPath(el, `${v}/top.md`))
    for (const label of ['Remove from focus', 'Cut', 'Copy', 'Paste', 'Copy path', 'New note', 'Rename', 'Add to favorites', 'Open in', 'Delete']) expect(itemByLabel(el, label), label).toBeDefined()
    await act(async () => itemByLabel(el, 'Cut')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: [`${v}/top.md`], op: 'cut' })
    await pick(el, `${v}/top.md`, 'Rename')
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('top')
  })

  it('YAZ-2631 S26, S27, S29, S35, S40; YAZ-2702 S11: a top row, a file or a folder, drags to a new place — a line on the hovered edge, never the fill of a drop folder; the new order is the vault\'s, written to its focus file and to no order across vaults, and nothing moves on disk; a drop on itself and a drag that ends elsewhere change nothing', async () => {
    const { el, v, bridge, props, rerender } = await mountVault({ lens: 'focus' }, { focus: ['/Projects', '/top.md', '/Notes'] })
    const [projects, top, notes] = [`${v}/Projects`, `${v}/top.md`, `${v}/Notes`]
    expect([projects, top].map((path) => rowByPath(el, path)?.draggable)).toEqual([true, true])
    // A top FILE row over the top half of a top FOLDER row (S29): it lands before it, and is not moved into it.
    drag(rowByPath(el, top), 'dragstart')
    drag(rowByPath(el, projects), 'dragover', -1)
    expect(rowByPath(el, projects)?.classList.contains('tree__row--drop-before')).toBe(true)
    expect(el.querySelector('.tree__row--drop')).toBeNull()
    drag(rowByPath(el, projects), 'drop')
    expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [top, projects, notes])
    expect(marker(el)).toBeNull()
    // A FOLDER row over the bottom half of a FILE row.
    drag(rowByPath(el, notes), 'dragstart')
    drag(rowByPath(el, top), 'dragover', 1)
    expect(rowByPath(el, top)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, top), 'drop')
    expect(topLabels(el)).toEqual(['top', 'Notes', 'Projects'])
    expect(bridge.focus.set.mock.calls).toEqual([[v, [top, projects, notes]], [v, [top, notes, projects]]])
    // S27: the order is the list's own, so another tab and back shows it as it was left.
    await rerender({ lens: 'files' })
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['top', 'Notes', 'Projects'])
    // S35: a drop on itself; then a drag that ends with no drop takes its line with it.
    drag(rowByPath(el, notes), 'dragstart')
    drag(rowByPath(el, notes), 'dragover', -1)
    drag(rowByPath(el, notes), 'drop')
    drag(rowByPath(el, notes), 'dragstart')
    drag(rowByPath(el, projects), 'dragover', 1)
    expect(marker(el)).toBe(rowByPath(el, projects))
    drag(rowByPath(el, notes), 'dragend')
    expect(marker(el)).toBeNull()
    drag(rowByPath(el, projects), 'drop')
    expect(topLabels(el)).toEqual(['top', 'Notes', 'Projects'])
    expect(bridge.focus.set).toHaveBeenCalledTimes(2)
    expect(bridge.state.setFocusOrder).not.toHaveBeenCalled() // one vault: its file holds the order
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('YAZ-2631 S30, S32, S33, S34, S39: below the top rows nothing reorders — a file inside a focused folder drags into a folder and moves on disk, and finds no place on a top file row; a folder there drags only to move on disk (YAZ-3251 D5); a reorder drag finds no place on a deeper row; an item that shows on both levels does each', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'focus' }, { focus: ['/Projects', '/Projects/p.md', '/Notes', '/top.md'] })
    const [projects, p, notes, top, alpha] = [`${v}/Projects`, `${v}/Projects/p.md`, `${v}/Notes`, `${v}/top.md`, `${v}/Projects/Alpha`]
    act(() => rowByPath(el, projects)?.click())
    // S39: the item stands inside its focused folder, and again as a top row.
    const twice = () => rowsByPath(el, p)
    expect(twice().map((row) => row.closest('ul')?.getAttribute('role'))).toEqual(['group', 'tree'])
    // S32: a folder below the top rows does not reorder; since YAZ-3251 D5 it drags to move on disk.
    expect([...twice(), rowByPath(el, alpha)].map((row) => row?.draggable)).toEqual([true, true, true])
    // S30: from inside the folder it moves on disk, into a top folder or a deeper one — the fill, and no line.
    drag(twice()[0], 'dragstart')
    drag(rowByPath(el, notes), 'dragover', -1)
    expect(marker(el)).toBe(rowByPath(el, notes))
    expect(rowByPath(el, notes)?.classList.contains('tree__row--drop')).toBe(true)
    drag(rowByPath(el, notes), 'drop')
    expect(props.onRenameFile).toHaveBeenLastCalledWith(p, `${v}/Notes/p.md`, 'file')
    drag(twice()[0], 'dragstart')
    drag(rowByPath(el, alpha), 'drop')
    expect(props.onRenameFile).toHaveBeenLastCalledWith(p, `${v}/Projects/Alpha/p.md`, 'file')
    // S33: a top FILE row is no folder to move into, and no place in the list for a row from inside a folder.
    drag(twice()[0], 'dragstart')
    drag(rowByPath(el, top), 'dragover', -1)
    expect(marker(el)).toBeNull()
    drag(rowByPath(el, top), 'drop')
    drag(twice()[0], 'dragend')
    expect(props.onRenameFile).toHaveBeenCalledTimes(2)
    expect(bridge.focus.set).not.toHaveBeenCalled()
    // S39: its top row takes a new place in the list.
    drag(twice()[1], 'dragstart')
    drag(rowByPath(el, notes), 'dragover', 1)
    expect(rowByPath(el, notes)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, notes), 'drop')
    expect(topLabels(el)).toEqual(['Projects', 'Notes', 'p', 'top'])
    expect(bridge.focus.set.mock.calls).toEqual([[v, [projects, notes, p, top]]])
    // S34: a reorder drag over a deeper row, a folder or a file: no line, no fill, and a drop there changes nothing.
    for (const deeper of [() => rowByPath(el, alpha), () => twice()[0]]) {
      drag(rowByPath(el, top), 'dragstart')
      drag(deeper(), 'dragover', -1)
      expect(marker(el)).toBeNull()
      drag(deeper(), 'drop')
      drag(rowByPath(el, top), 'dragend')
    }
    expect(topLabels(el)).toEqual(['Projects', 'Notes', 'p', 'top'])
    expect(bridge.focus.set).toHaveBeenCalledTimes(1)
    expect(props.onRenameFile).toHaveBeenCalledTimes(2)
  })
})

/**
 * The Favorites tab (YAZ-1766): the second lens, listing the files and folders the user pinned from any
 * row's menu, in insertion order, each a full tree row — a pinned folder unfolds in place through
 * the Files tree's own expansion (D7), a pinned file inside a pinned folder shows twice (root and
 * nested), the toast names the kind, the list persists in the vault's `.yaseendocs/favorites.json`
 * through `favorites.get/set` (D2, in the vault since 6A/D11), root rows drag to reorder (D4), and
 * the tab has no focus of its own (YAZ-2619 S39). One fresh vault and window per mount, as the Focus
 * tab's block above does it.
 */
describe('favorites (YAZ-1766)', () => {
  const note = (path: string, name: string): TreeNode => ({ type: 'file', name, path, size: 1, mtime: 1, kind: 'markdown' })
  const FAV = (v: string): TreeNode[] => [
    { type: 'dir', name: 'Notes', path: `${v}/Notes`, children: [note(`${v}/Notes/n.md`, 'n.md')] },
    {
      type: 'dir', name: 'Projects', path: `${v}/Projects`,
      children: [{ type: 'dir', name: 'Alpha', path: `${v}/Projects/Alpha`, children: [] }, note(`${v}/Projects/p.md`, 'p.md')],
    },
    note(`${v}/top.md`, 'top.md'),
  ]

  let vaults = 0
  /** A fresh vault + window; `favorites` seeds what `favorites.get` answers — the vault file's list, absolute, as main hands it over (6A); `focus` seeds the window's focus list. */
  const mountVault = async (over: Partial<SidebarProps> = {}, opts: { favorites?: string[]; focus?: string[]; nodes?: (v: string) => TreeNode[] } = {}) => {
    const v = `/v-fav-${++vaults}`
    let emit: ((c: { root: string }) => void) | undefined
    const m = await mount({ root: v, lens: 'files', ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: (opts.nodes ?? FAV)(v), generatedAt: 1 } as never)
      b.favorites.get.mockResolvedValue((opts.favorites ?? []).map((p) => `${v}${p}`))
      b.favorites.onChanged.mockImplementation((l) => {
        emit = l
        return () => undefined
      })
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, roots: [v], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      b.focus.get.mockResolvedValue((opts.focus ?? []).map((p) => `${v}${p}`))
      await storage.init()
    })
    return { ...m, v, emit: (c: { root: string }) => emit?.(c) }
  }

  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const rowsByPath = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)]
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const topLabels = (el: HTMLElement) => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((n) => n.textContent)
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const isOpen = (el: HTMLElement, path: string) => rowByPath(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const pick = async (el: HTMLElement, path: string, label: string) => {
    rightClick(rowByPath(el, path))
    await act(async () => itemByLabel(el, label)?.click())
  }
  /** jsdom has no DragEvent: a MouseEvent with the row's edge in `clientY` (the zero rect reads `< 0` as "before"). */
  const drag = (target: Element | null | undefined, type: string, clientY = 0) =>
    act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
  /** What a drag draws: the line on a row's edge (a reorder), or the fill of a drop folder (a move on disk). */
  const marker = (el: HTMLElement) => el.querySelector('.tree__row--drop-before, .tree__row--drop-after, .tree__row--drop')

  it('YAZ-2648 S5: a row of Favorites and a row of Focus open their page as a row of Files does: a click asks for it — the page ALREADY open too — and a double click keeps it', async () => {
    for (const lens of ['favorites', 'focus'] as const) {
      const { el, v, props, rerender } = await mountVault({ lens }, { favorites: ['/top.md'], focus: ['/top.md'] })
      act(() => void rowByPath(el, `${v}/top.md`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
      expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${v}/top.md`)
      await rerender({ activeFile: `${v}/top.md` })
      act(() => void rowByPath(el, `${v}/top.md`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
      expect(props.onOpenFile).toHaveBeenCalledTimes(2)
      expect(props.onOpenFile).toHaveBeenLastCalledWith(`${v}/top.md`)
      act(() => void rowByPath(el, `${v}/top.md`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(props.onKeepFile).toHaveBeenCalledExactlyOnceWith(`${v}/top.md`)
    }
  })

  it('the tab is right of Focus and left of Sessions (YAZ-2619, YAZ-3147 D4; Search is the second, YAZ-2638 D2), and starts on the empty hint', async () => {
    const { el } = await mountVault({ lens: 'favorites' })
    expect([...el.querySelectorAll('.sidebar__lenses [role="tab"]')].map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Files', 'Search', 'Focus', 'Favorites', 'Sessions', 'Recents'])
    expect(bodyMsg(el)).toBe('No favorites yet. Right-click a file or folder → Add to favorites.')
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('New note from a ROOT favorited FILE hops to Files — its parent dir is not on the tab; from a favorited FOLDER the input mounts in place (3B1)', async () => {
    const { el, v, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes/n.md', '/Projects'] })
    await pick(el, `${v}/Notes/n.md`, 'New note')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(el.querySelector('.create-inline')).toBeNull() // the tab has no `Notes` node to mount it under
    vi.mocked(props.onLensChange).mockClear()
    await pick(el, `${v}/Projects`, 'New note')
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(el.querySelector('.create-inline')).not.toBeNull()
  })

  it('"Add to favorites" is on file AND folder rows in Files, never on blank space; adding toasts, persists to the vault file and lists the row on the tab', async () => {
    const { el, v, bridge, props, rerender } = await mountVault()
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Add to favorites')).toBeDefined()
    closeMenu(el)
    rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Add to favorites')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
    closeMenu(el)
    await pick(el, `${v}/Projects`, 'Add to favorites')
    expect(props.onNotice).toHaveBeenCalledWith('Added to favorites', 'favorite', 'lists')
    expect(bridge.favorites.set).toHaveBeenCalledWith(v, [`${v}/Projects`])
    expect(bridge.state.setFolder).not.toHaveBeenCalled() // vault content, not app state (D15)
    expect(bridge.focus.set).not.toHaveBeenCalled() // nor window identity
    await rerender({ lens: 'favorites' })
    expect(topLabels(el)).toEqual(['Projects'])
    // The pinned row now reads Remove, on the Favorites tab and back on Files alike.
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(itemByLabel(el, 'Remove from favorites')).toBeDefined()
    closeMenu(el)
    await rerender({ lens: 'files' })
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(itemByLabel(el, 'Remove from favorites')).toBeDefined()
  })

  it('every favorites row carries the full row menu — Add to focus, Copy path, Rename, Open in, Delete', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects', '/top.md'] })
    rightClick(rowByPath(el, `${v}/Projects`))
    for (const label of ['Add to focus', 'Cut', 'Copy', 'Copy path', 'New note', 'Rename', 'Remove from favorites', 'Open in', 'Delete']) expect(itemByLabel(el, label), label).toBeDefined()
    closeMenu(el)
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'Add to focus')).toBeDefined() // a file row too (YAZ-2619 D3)
  })

  it('"Remove from favorites" drops the row, toasts, and persists the shorter list', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects', '/top.md'] })
    expect(topLabels(el)).toEqual(['Projects', 'top'])
    await pick(el, `${v}/Projects`, 'Remove from favorites')
    expect(topLabels(el)).toEqual(['top'])
    expect(props.onNotice).toHaveBeenCalledWith('Removed from favorites', 'favorite', 'lists')
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`])
  })

  it('a restored list renders in STORED order (not tree order) and is never written back', async () => {
    const { el, bridge } = await mountVault({ lens: 'favorites' }, { favorites: ['/top.md', '/Projects', '/Notes'] })
    expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('a favorited folder unfolds in place, and its fold is its own, not the Files tree\'s (D7, as YAZ-3131 S2 changed it)', async () => {
    const { el, v, rerender } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects'] })
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(rowByPath(el, `${v}/Projects/p.md`)).not.toBeNull()
    // Files keeps its own folds, both ways.
    await rerender({ lens: 'files' })
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    await rerender({ lens: 'favorites' })
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    await rerender({ lens: 'files' })
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
  })

  it('redundancy: a file AND its parent folder both listed — the file at the root and again inside the folder', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects/p.md', '/Projects'] })
    expect(topLabels(el)).toEqual(['p', 'Projects'])
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(rowsByPath(el, `${v}/Projects/p.md`)).toHaveLength(2)
  })

  it('a path drawn on TWO rows counts, copies and opens ONCE (YAZ-1337 🔒 D3), still in visible order, and lights in the copy it was picked in (YAZ-3131 S16)', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el, v, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects', '/Projects/p.md', '/top.md'] })
    act(() => rowByPath(el, `${v}/Projects`)?.click()) // unfolds it — and selects it (D9), so drop that first
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    const twice = rowsByPath(el, `${v}/Projects/p.md`)
    expect(twice).toHaveLength(2) // both occurrences are on screen…
    shiftClickRow(twice[0])
    shiftClickRow(rowByPath(el, `${v}/top.md`))
    // …and only the copy it was picked in lights (YAZ-3131 S11, S16): the ONE selected path is still one path.
    expect([...el.querySelectorAll('.tree__row--selected')]).toEqual([twice[0], rowByPath(el, `${v}/top.md`)])
    rightClick(twice[1]) // either occurrence is the file
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    expect(itemByLabel(el, 'Copy 3 paths')).toBeUndefined()
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${v}/Projects/p.md\n${v}/top.md`)
    rightClick(twice[0])
    act(() => itemByLabel(el, 'Open 2 in new tabs')?.click())
    expect((props.onOpenFileBackground as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([`${v}/Projects/p.md`, `${v}/top.md`])
  })

  it('a 2-row selection reads "Add 2 to favorites" and pins both in panel order; a MIXED one reads Add and pins only the missing; all-pinned reads "Remove 2 from favorites"', async () => {
    const { el, v, bridge } = await mountVault()
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    rightClick(rowByPath(el, `${v}/Notes`))
    await act(async () => itemByLabel(el, 'Add 2 to favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, `${v}/Projects`)) // already pinned…
    shiftClickRow(rowByPath(el, `${v}/top.md`)) // …this one not
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Add 2 to favorites')).toBeDefined()
    await act(async () => itemByLabel(el, 'Add 2 to favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`, `${v}/top.md`])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    rightClick(rowByPath(el, `${v}/Notes`))
    expect(itemByLabel(el, 'Remove 2 from favorites')).toBeDefined()
    await act(async () => itemByLabel(el, 'Remove 2 from favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`])
  })

  it('S10, S11, S39; YAZ-2638 S20: "Add to focus" on the heart tab — on a row, then on a search result — writes THIS window\'s focus list, never the vault file; from the row it shows the Focus tab, from the search result the Search tab stays; the heart tab is not narrowed and the search stays', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    await pick(el, `${v}/Projects`, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`])
    expect(bridge.favorites.set).not.toHaveBeenCalled() // the fold it opened is the other write, and that is app state
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('focus')
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top']) // until App hands the lens back, still every favorite
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    const input = searchInput(el)!
    await type(input, 'Alpha')
    rightClick(rowByPath(el, `${v}/Projects/Alpha`))
    await act(async () => itemByLabel(el, 'Add to focus')?.click())
    expect(bridge.focus.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`, `${v}/Projects/Alpha`])
    expect(props.onLensChange).toHaveBeenCalledTimes(1) // the add from the Search tab asks for no tab
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
    expect(input.value).toBe('Alpha')
    expect(rowByPath(el, `${v}/Projects/Alpha`)?.querySelector('.tree__mark')).not.toBeNull()
  })

  it('top rows drag to reorder: a line on the hovered edge, the new order written to the vault\'s file, and nothing moved on disk — a top file over a top folder too; below them a folder drags only to move on disk (YAZ-3251 D5); the drag draws the top rows alone; one vault writes no order across vaults and names no vault (YAZ-2631 S1, S29, S32, R4)', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    expect(rowByPath(el, `${v}/Notes`)?.getAttribute('draggable')).toBe('true')
    expect(rowByPath(el, `${v}/top.md`)?.getAttribute('draggable')).toBe('true')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(rowByPath(el, `${v}/Projects/Alpha`)?.getAttribute('draggable')).toBe('true') // it moves on disk too (YAZ-3251 D5)
    expect(rowByPath(el, `${v}/Projects/p.md`)?.getAttribute('draggable')).toBe('true') // it moves on disk
    labelRenders.names = []
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    expect(rowByPath(el, `${v}/Notes`)?.classList.contains('tree__row--drop-before')).toBe(true)
    drag(rowByPath(el, `${v}/Notes`), 'dragover', 1)
    expect(rowByPath(el, `${v}/Notes`)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    // The line is the top level's own: the rows of an open folder below it are not drawn again.
    expect([...new Set(labelRenders.names)]).toEqual(['top.md'])
    drag(rowByPath(el, `${v}/Notes`), 'drop')
    expect(topLabels(el)).toEqual(['top', 'Notes', 'Projects'])
    expect([...new Set(labelRenders.names)]).toEqual(['top.md'])
    expect(el.querySelector('.tree__row--drop-before, .tree__row--drop-after')).toBeNull()
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`, `${v}/Notes`, `${v}/Projects`])
    // Below the midpoint lands AFTER; nothing moved on disk at any point.
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/Projects`), 'dragover', 1)
    expect(rowByPath(el, `${v}/Projects`)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, `${v}/Projects`), 'drop')
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    expect(props.onRenameFile).not.toHaveBeenCalled()
    expect(bridge.state.setFavoritesOrder).not.toHaveBeenCalled()
    expect(el.querySelector('.tree__vault')).toBeNull()
  })

  it('YAZ-2631 S30, S33, S34, S35, S40: a file inside a favorited folder drags into a folder and moves on disk, and finds no place on a top file row; a reorder drag over a deeper row shows no line and no fill, a drop there or on itself changes nothing, and dragend takes the line with it', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    const [notes, top, alpha, inner] = [`${v}/Notes`, `${v}/top.md`, `${v}/Projects/Alpha`, `${v}/Projects/p.md`]
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    // S30: the fill of a drop folder, no line; the drop is the rename flow of the Files tab.
    drag(rowByPath(el, inner), 'dragstart')
    drag(rowByPath(el, notes), 'dragover', -1)
    expect(marker(el)).toBe(rowByPath(el, notes))
    expect(rowByPath(el, notes)?.classList.contains('tree__row--drop')).toBe(true)
    drag(rowByPath(el, notes), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith(inner, `${v}/Notes/p.md`, 'file')
    // S33: a top FILE row is no folder to move into, and no place in the list for a row from inside a folder.
    drag(rowByPath(el, inner), 'dragstart')
    drag(rowByPath(el, top), 'dragover', -1)
    expect(marker(el)).toBeNull()
    drag(rowByPath(el, top), 'drop')
    drag(rowByPath(el, inner), 'dragend')
    // S34, S40: a reorder drag over a deeper row, a folder or a file.
    for (const deeper of [alpha, inner]) {
      drag(rowByPath(el, top), 'dragstart')
      drag(rowByPath(el, deeper), 'dragover', -1)
      expect(marker(el)).toBeNull()
      drag(rowByPath(el, deeper), 'drop')
      drag(rowByPath(el, top), 'dragend')
    }
    // S35: a drop on itself; then a drag that ends with no drop.
    drag(rowByPath(el, top), 'dragstart')
    drag(rowByPath(el, top), 'dragover', -1)
    drag(rowByPath(el, top), 'drop')
    drag(rowByPath(el, top), 'dragstart')
    drag(rowByPath(el, notes), 'dragover', -1)
    expect(rowByPath(el, notes)?.classList.contains('tree__row--drop-before')).toBe(true)
    expect(el.querySelector('.tree__row--drop')).toBeNull()
    drag(rowByPath(el, top), 'dragend')
    expect(marker(el)).toBeNull()
    drag(rowByPath(el, notes), 'drop')
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(props.onRenameFile).toHaveBeenCalledTimes(1)
  })

  it('reorder is always on: a focus list in this window neither narrows the tab nor stops the drag (YAZ-2619 S39)', async () => {
    const { el, v, bridge } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects'], focus: ['/Notes'] })
    expect(topLabels(el)).toEqual(['Notes', 'Projects'])
    expect(el.querySelectorAll('.sidebar__lenses button:not([role="tab"]):not(.sidebar__expand-all):not(.sidebar__sort)')).toHaveLength(0) // no eye button
    drag(rowByPath(el, `${v}/Projects`), 'dragstart')
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    expect(rowByPath(el, `${v}/Notes`)?.classList.contains('tree__row--drop-before')).toBe(true)
    drag(rowByPath(el, `${v}/Notes`), 'drop')
    expect(topLabels(el)).toEqual(['Projects', 'Notes'])
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Projects`, `${v}/Notes`])
    expect(bridge.focus.set).not.toHaveBeenCalled() // the restored list is never written back
  })

  it('another window\'s — or a synced — write lands through favorites:changed for THIS root: re-read, never re-written', async () => {
    const { el, v, bridge, emit } = await mountVault({ lens: 'favorites' })
    expect(bodyMsg(el)).not.toBeNull()
    const reads = bridge.favorites.get.mock.calls.length // the mount read (StrictMode runs the effect twice)
    await act(async () => emit({ root: '/some-other-vault' }))
    expect(bridge.favorites.get).toHaveBeenCalledTimes(reads) // another vault's change is not this window's
    bridge.favorites.get.mockResolvedValue([`${v}/top.md`])
    await act(async () => emit({ root: v }))
    expect(topLabels(el)).toEqual(['top'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('a refused write (a malformed favorites.json → INVALID_CONFIG, D12) reverts the list and toasts an error', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes'] })
    bridge.favorites.set.mockRejectedValueOnce({ code: 'INVALID_CONFIG', message: 'favorites.json is malformed; fix or delete it' })
    await pick(el, `${v}/Notes`, 'Remove from favorites')
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [])
    expect(topLabels(el)).toEqual(['Notes']) // reverted
    expect(props.onNotice).toHaveBeenCalledWith("Can't save favorites: favorites.json is malformed; fix or delete it", 'error')
  })

  it('a favorite the tree lacks (not synced yet, or gone) draws no row and is NOT pruned — no write (D14)', async () => {
    let fire: ((ev: WatchEvent) => void) | undefined
    const watch = { subscribe: (l: (ev: WatchEvent) => void) => ((fire = l), () => undefined) }
    const { el, v, bridge } = await mountVault({ lens: 'favorites', watch }, { favorites: ['/Ghost.md', '/Notes', '/Projects'] })
    expect(topLabels(el)).toEqual(['Notes', 'Projects'])
    bridge.tree.mockResolvedValue({ root: v, tree: FAV(v).filter((n) => n.path !== `${v}/Projects`), generatedAt: 2 } as never)
    await act(async () => fire?.({ type: 'unlinkDir', path: `${v}/Projects` }))
    await afterQuiet()
    expect(topLabels(el)).toEqual(['Notes'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('expand / collapse all acts on the favorited folders only', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects'] })
    const all = el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
    expect(all?.getAttribute('aria-label')).toBe('Expand all')
    act(() => all?.click())
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(isOpen(el, `${v}/Projects/Alpha`)).toBe('true')
    expect(storage.getExpanded(v)).not.toContain(`${v}/Notes`)
  })

  describe('a folder that shows two times (YAZ-2845)', () => {
    // "Work" and "Work/Wrenly" both listed, as in the bug report: Wrenly is a top row AND a row inside Work.
    const WORK = (v: string): TreeNode[] => [
      {
        type: 'dir', name: 'Work', path: `${v}/Work`,
        children: [{ type: 'dir', name: 'Wrenly', path: `${v}/Work/Wrenly`, children: [{ type: 'dir', name: 'GTM', path: `${v}/Work/Wrenly/GTM`, children: [note(`${v}/Work/Wrenly/GTM/plan.md`, 'plan.md')] }] }],
      },
      note(`${v}/top.md`, 'top.md'),
    ]
    const listed = ['/Work/Wrenly', '/Work']
    /** The input of the tab, and the top row's item that holds it (0: under the top Wrenly, 1: under Work). */
    const inputs = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>('.create-inline__input')]
    const copyOf = (el: HTMLElement, input: Element) => [...el.querySelectorAll('ul.tree[role="tree"] > li')].findIndex((li) => li.contains(input))
    const type = async (input: HTMLInputElement, name: string) => {
      await act(async () => {
        input.value = name
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
    }
    const mountWork = async (lens: 'favorites' | 'focus') => {
      const m = await mountVault({ lens }, { favorites: listed, focus: listed, nodes: WORK })
      act(() => rowByPath(m.el, `${m.v}/Work/Wrenly`)?.click()) // the top copy unfolds, and with it GTM shows
      // Each copy folds on its own (YAZ-3131 S1): Work, then its own Wrenly, open for GTM to show a second time.
      act(() => rowByPath(m.el, `${m.v}/Work`)?.click())
      act(() => rowsByPath(m.el, `${m.v}/Work/Wrenly`)[1]?.click())
      return m
    }

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S1, S2, S6 on %s: each copy of Wrenly folds on its own, by a click and by the arrow keys, and Files keeps its own folds', async (lens) => {
      const { el, v, rerender } = await mountVault({ lens }, { favorites: listed, focus: listed, nodes: WORK })
      const wrenly = `${v}/Work/Wrenly`
      const open = (copy: number) => rowsByPath(el, wrenly)[copy]?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
      const key = (copy: number, name: string) => act(() => void rowsByPath(el, wrenly)[copy]?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })))
      act(() => rowByPath(el, `${v}/Work`)?.click())
      expect(rowsByPath(el, wrenly)).toHaveLength(2) // 0: the top row, 1: inside Work
      act(() => rowsByPath(el, wrenly)[0]?.click())
      expect([open(0), open(1)]).toEqual(['true', 'false'])
      key(1, 'ArrowRight')
      expect([open(0), open(1)]).toEqual(['true', 'true'])
      key(0, 'ArrowLeft')
      expect([open(0), open(1)]).toEqual(['false', 'true'])
      expect(rowsByPath(el, `${wrenly}/GTM`)).toHaveLength(1) // only the open copy draws its rows
      await rerender({ lens: 'files' })
      expect(rowByPath(el, `${v}/Work`)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false')
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S11, S12, S15 on %s: the open page and the selection light in ONE copy — the copy that was clicked, else the first that shows it', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      expect(rowsByPath(el, plan)).toHaveLength(2) // 0: under the top Wrenly, 1: under Work
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      // S12: a page opened from elsewhere lights in the first copy that shows it.
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
      // S11: a click in the other copy takes the light there, as the open page and as the selection.
      act(() => rowsByPath(el, plan)[1]?.click())
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      expect(lit(plan, 'tree__row--selected')).toEqual([false, true])
      // S15: a right-click on a row outside the selection picks it in that copy.
      rightClick(rowsByPath(el, gtm)[0] ?? null)
      expect(lit(gtm, 'tree__row--selected')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S13 (YAZ-3141) on %s: a click on a page in copy B, then a click that closes its folder in copy B — no row lights, and copy A does not take the light', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      expect(rowsByPath(el, plan)).toHaveLength(2) // 0: under the top Wrenly (copy A), 1: under Work (copy B)
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      // The click in copy B opens the page there.
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      // Close GTM in copy B with a click on its row. The page belongs to copy B, so no row lights (S13).
      act(() => rowsByPath(el, gtm)[1]?.click())
      expect(rowsByPath(el, plan)).toHaveLength(1) // only copy A still draws the page
      expect(lit(plan, 'tree__row--active')).toEqual([false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S12, S17 on %s: a page clicked in copy B, then Files and back — the page lights in the first copy that shows it', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      await rerender({ lens: 'files', activeFile: plan })
      await rerender({ lens, activeFile: plan })
      expect(rowsByPath(el, plan)).toHaveLength(2)
      // S17 clears the recorded copies on a tab change, so S12 applies: the first copy that shows the page.
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S12 (YAZ-3143) on %s: a page clicked in copy B, a fold click, another page, then the page again from the tab bar — it lights in the first copy that shows it', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      // A click on a folder row moves the selection (D9): close and open GTM in copy A.
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[0]?.click())
      expect(rowsByPath(el, plan)).toHaveLength(2)
      await rerender({ activeFile: `${v}/top.md` })
      await rerender({ activeFile: plan }) // the tab bar: S12, the first copy that shows it
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S12 (YAZ-3143) on %s: a page clicked in copy B, another page, then the page again from the tab bar — it lights in the first copy that shows it', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      await rerender({ activeFile: `${v}/top.md` })
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R1) on %s: a double click on a FOLDER in copy B opens nothing — it selects copy B and folds (YAZ-3377 D1, S10)', async (lens) => {
      const { el, v, props } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      expect(rowsByPath(el, gtm)).toHaveLength(2)
      // A real double click: two clicks (each selects and folds), then the dblclick. The menu opens the page (R6).
      act(() => rowsByPath(el, gtm)[1]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      act(() => void rowsByPath(el, gtm)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(props.onKeepFile).not.toHaveBeenCalled()
      expect(lit(gtm, 'tree__row--selected')).toEqual([false, true])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R2) on %s: Enter opens a FOLDER page in copy B — the folder row lights in copy B', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => void rowsByPath(el, gtm)[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      await rerender({ activeFile: gtm })
      expect(lit(gtm, 'tree__row--active')).toEqual([false, true])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R3) on %s: a double click on a FILE in copy B keeps the light in copy B', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      act(() => void rowsByPath(el, plan)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R4) on %s: a click in copy B, a blank tab (no page), then the page again — the first copy lights (S12)', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      await rerender({ activeFile: null })
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R5) on %s: a click on the open page in copy A after copy B — the light moves to copy A (S11)', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      act(() => rowsByPath(el, plan)[0]?.click())
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
      act(() => rowsByPath(el, plan)[1]?.click())
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      // A fold click in copy A, then the light must stay in copy B while the page stays open (S13).
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[0]?.click())
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 Decision 3 (YAZ-3144, R6) on %s: the row menu "Open folder page" on a FOLDER in copy B — its page lights in copy B (Decision 3, S15)', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      // "Open folder page" is a FOLDER row's item (YAZ-2290 D3, YAZ-3377 D2); a file row opens on its click and has none.
      act(() => void rowsByPath(el, gtm)[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })))
      const open = itemByLabel(el, 'Open folder page')
      expect(open).toBeDefined()
      act(() => open?.click())
      await rerender({ activeFile: gtm })
      expect(lit(gtm, 'tree__row--selected')).toEqual([false, true])
      expect(lit(gtm, 'tree__row--active')).toEqual([false, true])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S13 by the arrow key on %s: ← closes the folder in copy B — no row lights', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      act(() => rowsByPath(el, plan)[1]?.click())
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      act(() => void rowsByPath(el, gtm)[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
      expect(rowsByPath(el, plan)).toHaveLength(1)
      expect(lit(plan, 'tree__row--active')).toEqual([false])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S21 on %s: ⌘V with a row picked in copy B, and Paste from the menu of copy A, each open GTM in that copy alone', async (lens) => {
      const clipboardRef = { current: null as SidebarClipboard | null }
      const { el, v, bridge } = await mountVault({ lens, clipboardRef }, { favorites: listed, focus: listed, nodes: WORK })
      act(() => rowByPath(el, `${v}/Work/Wrenly`)?.click())
      act(() => rowByPath(el, `${v}/Work`)?.click())
      act(() => rowsByPath(el, `${v}/Work/Wrenly`)[1]?.click())
      const gtm = `${v}/Work/Wrenly/GTM`
      const open = (copy: number) => rowsByPath(el, gtm)[copy]?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
      expect([open(0), open(1)]).toEqual(['false', 'false'])
      const listener = bridge.file.onClipChanged.mock.calls.at(-1)?.[0] as ((state: FileClipState) => void) | undefined
      act(() => (listener === undefined ? undefined : pushed(bridge, listener)({ count: 1, op: 'copy', paths: ['/w/x.md'] })))
      // ⌘V: pick GTM alone in copy B (two plain clicks: it opens and closes again), then paste.
      act(() => rowsByPath(el, gtm)[1]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      expect([open(0), open(1)]).toEqual(['false', 'false'])
      await act(async () => void clipboardRef.current?.paste())
      expect(bridge.file.paste).toHaveBeenLastCalledWith(into(gtm, 'copy', '/w/x.md'))
      expect([open(0), open(1)]).toEqual(['false', 'true'])
      // The menu's Paste on copy A opens copy A.
      rightClick(rowsByPath(el, gtm)[0] ?? null)
      await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
      expect([open(0), open(1)]).toEqual(['true', 'true'])
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S12, S14, S17 on %s: the light follows the folds when no click chose a copy; a shift-click on the same path in the other copy removes it; a tab change clears the copies', async (lens) => {
      const { el, v, rerender } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      const plan = `${gtm}/plan.md`
      act(() => rowsByPath(el, gtm)[0]?.click())
      act(() => rowsByPath(el, gtm)[1]?.click())
      act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      const lit = (path: string, cls: string) => rowsByPath(el, path).map((row) => row.classList.contains(cls))
      await rerender({ activeFile: plan })
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
      // S12: ← closes GTM in copy A. Copy B is now the first copy that shows the page, so it takes the light.
      act(() => void rowsByPath(el, gtm)[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
      expect(lit(plan, 'tree__row--active')).toEqual([true])
      act(() => void rowsByPath(el, gtm)[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
      // S14: shift-click adds the row in copy B; a shift-click on the same path in copy A removes the path.
      shiftClickRow(rowsByPath(el, plan)[1] ?? null)
      expect(lit(plan, 'tree__row--selected')).toEqual([false, true])
      shiftClickRow(rowsByPath(el, plan)[0] ?? null)
      expect(lit(plan, 'tree__row--selected')).toEqual([false, false])
      // S17: a change of tab clears the selection and the copies.
      act(() => rowsByPath(el, plan)[1]?.click())
      expect(lit(plan, 'tree__row--active')).toEqual([false, true])
      await rerender({ lens: 'files', activeFile: plan })
      await rerender({ lens, activeFile: plan })
      expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
      expect(lit(plan, 'tree__row--active')).toEqual([true, false])
    })

    it.each(['favorites', 'focus'] as const)('S3, S4, S5, S20 on %s: "New folder" on either copy of GTM opens ONE input, under the right-clicked copy; Enter makes the folder there, the tab stays, and no list changes', async (lens) => {
      const { el, v, bridge, props } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      for (const copy of [0, 1]) {
        rightClick(rowsByPath(el, gtm)[copy] ?? null)
        await act(async () => itemByLabel(el, 'New folder')?.click())
        // GTM shows two times — yet one input stands, in the copy that was clicked, and only that copy opened (YAZ-3131 S20).
        expect(rowsByPath(el, gtm)).toHaveLength(2)
        expect(inputs(el)).toHaveLength(1)
        expect(copyOf(el, inputs(el)[0]!)).toBe(copy)
        // The first create opened GTM in its own copy; the other copy of GTM stayed closed (YAZ-3131 S20).
        if (copy === 0) expect(rowsByPath(el, gtm)[1]?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false')
        await type(inputs(el)[0]!, `Made ${copy}`)
        expect(bridge.createDir).toHaveBeenCalledTimes(copy + 1)
        expect(bridge.createDir.mock.calls[copy]?.[0].path.startsWith(`${gtm}/`)).toBe(true)
        expect(inputs(el)).toHaveLength(0)
      }
      // A note inside a copy (S6): its folder is GTM, and the input stands in that copy alone.
      rightClick(rowsByPath(el, `${gtm}/plan.md`)[1] ?? null)
      await act(async () => itemByLabel(el, 'New note')?.click())
      expect(inputs(el)).toHaveLength(1)
      expect(copyOf(el, inputs(el)[0]!)).toBe(1)
      expect(props.onLensChange).not.toHaveBeenCalled()
      expect(bridge.favorites.set).not.toHaveBeenCalled()
      expect(bridge.focus.set).not.toHaveBeenCalled()
    })

    it.each(['favorites', 'focus'] as const)('S8 on %s: "Rename" on a copy of a folder that shows two times opens ONE input, on that copy, and Enter renames it', async (lens) => {
      const { el, v, props } = await mountWork(lens)
      const gtm = `${v}/Work/Wrenly/GTM`
      rightClick(rowsByPath(el, gtm)[1] ?? null)
      await act(async () => itemByLabel(el, 'Rename')?.click())
      expect(inputs(el)).toHaveLength(1)
      expect(copyOf(el, inputs(el)[0]!)).toBe(1)
      await type(inputs(el)[0]!, 'Go to market')
      expect(vi.mocked(props.onRenameFile).mock.calls.length + vi.mocked(props.onRetitle).mock.calls.length).toBe(1)
      expect(props.onLensChange).not.toHaveBeenCalled()
    })

    it.each(['favorites', 'focus'] as const)('S11, S12 on %s: on blank space of a tab with rows, "New folder" goes to Files — the tab could never show it — and "New note" stays (YAZ-2619 R18)', async (lens) => {
      const { el, props, rerender } = await mountWork(lens)
      rightClick(el.querySelector('.sidebar__body'))
      await act(async () => itemByLabel(el, 'New note')?.click())
      expect(props.onLensChange).not.toHaveBeenCalled()
      expect(inputs(el)).toHaveLength(1)
      act(() => void inputs(el)[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      for (const label of ['New folder', 'New dated folder']) {
        vi.mocked(props.onLensChange).mockClear()
        rightClick(el.querySelector('.sidebar__body'))
        // The row's click, then the dated twin through the "New folder ▸" flyout (YAZ-3085 D3).
        if (label === 'New folder') await act(async () => itemByLabel(el, label)?.click())
        else await clickSubAsync(el, label, 'New folder')
        expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
      }
      // In Files the input stands at the top of the vault: the tab's copy means nothing there.
      await rerender({ lens: 'files' })
      expect(inputs(el)).toHaveLength(1)
      expect(el.querySelector('ul.tree[role="tree"] > li')?.contains(inputs(el)[0]!)).toBe(true)
    })
  })

  describe('sort (YAZ-3227)', () => {
    const sortButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__sort')
    const openSort = (el: HTMLElement) => act(() => sortButton(el)?.click())
    const items = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => `${b.textContent}${b.dataset.hint ?? ''}`)
    const withSort = (tab: 'files' | 'focus' | 'favorites', by: 'manual' | 'name' | 'updated', reverse = false) => ({ settings: { ...DEFAULT_SETTINGS, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, [tab]: { by, reverse } } } })

    it('D4, D5: the button stands left of expand-all on Files, Focus and Favorites only; Files offers no Manual; a pick saves the tab\'s sort', async () => {
      const { el, props, rerender } = await mountVault({ lens: 'files' })
      expect(sortButton(el)?.nextElementSibling?.classList.contains('sidebar__expand-all')).toBe(true)
      openSort(el)
      expect(items(el)).toEqual(['Name✓', 'Last updated', 'A to Z✓', 'Z to A'])
      await act(async () => itemByLabel(el, 'Last updated')?.click())
      expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, files: { by: 'updated', reverse: false } } })
      expect(items(el)).toEqual([]) // a pick closes the menu
      for (const lens of ['search', 'sessions'] as const) {
        await rerender({ lens })
        expect(sortButton(el)).toBeNull()
      }
    })

    it('D5: a second click on the button closes its menu', async () => {
      const { el } = await mountVault({ lens: 'files' })
      openSort(el)
      expect(items(el)).not.toEqual([])
      act(() => void sortButton(el)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      openSort(el)
      expect(items(el)).toEqual([])
    })

    it('D6: Favorites under Manual keeps its drag order; under a sort the top rows sort, do not drag, and the saved order stays; Manual brings it back', async () => {
      const { el, v, bridge, rerender } = await mountVault({ lens: 'favorites' }, { favorites: ['/top.md', '/Projects', '/Notes'] })
      expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
      openSort(el)
      expect(items(el)).toEqual(['Manual✓', 'Name', 'Last updated']) // no way group under Manual
      closeMenu(el)
      await rerender(withSort('favorites', 'name'))
      expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top']) // folders first, then files
      expect(rowByPath(el, `${v}/top.md`)?.draggable).toBe(false)
      expect(rowByPath(el, `${v}/Notes`)?.draggable).toBe(false)
      expect(rowByPath(el, `${v}/Projects/p.md`)).toBeNull()
      await rerender(withSort('favorites', 'name', true))
      expect(topLabels(el)).toEqual(['Projects', 'Notes', 'top'])
      expect(bridge.favorites.set).not.toHaveBeenCalled()
      await rerender(withSort('favorites', 'manual'))
      expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
      expect(rowByPath(el, `${v}/top.md`)?.draggable).toBe(true)
    })

    it('D6: Focus offers Manual too, and a sort orders its top rows by the tab\'s own choice', async () => {
      const { el, rerender } = await mountVault({ lens: 'focus' }, { focus: ['/top.md', '/Notes'] })
      expect(topLabels(el)).toEqual(['top', 'Notes'])
      openSort(el)
      expect(items(el)).toEqual(['Manual✓', 'Name', 'Last updated'])
      closeMenu(el)
      await rerender(withSort('favorites', 'name')) // another tab's sort leaves Focus as it is
      expect(topLabels(el)).toEqual(['top', 'Notes'])
      await rerender(withSort('focus', 'name'))
      expect(topLabels(el)).toEqual(['Notes', 'top'])
    })
  })
})

describe('context menu order (GRO-2272 C1a)', () => {
  it('a FILE row renders utilities, then create actions, then Rename and Delete last', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((b) => b.textContent?.replace('▸', '').trim())).toEqual([
      // The Open group (🔒 D7 amended, YAZ-1674) holds the focus toggle alone on one file row
      // (YAZ-2619 R6) — the OS verbs fold into the "Open in ▸" flyout, in its own group before Delete.
      'Add to focus',
      // The clipboard group: the file clipboard first (Paste is DISABLED, not hidden, while it is
      // empty — 🔒 D5), then the text clipboard. Hints are `data-hint`, so the text stays bare.
      'Cut',
      'Copy',
      'Paste',
      'Copy path',
      // The create rows (YAZ-3085 D3): note, drawing, folder — each a click and a hover list. The
      // dated twins and the boards' items are in the lists, which stay closed until a hover.
      'New note',
      'New drawing',
      'New folder',
      'Rename',
      // The favorite toggle (YAZ-1766 D3) leads the "Open in ▸" group, one hairline above Delete.
      'Add to favorites',
      'Open in',
      'Delete',
    ])
  })

  it('Delete is the LAST item wherever it appears', async () => {
    for (const row of ['.tree__row--file', '.tree__row--dir']) {
      const m = await mount()
      act(() => void m.el.querySelector(row)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      const labels = menuItems(m.el).map((b) => b.textContent)
      expect(labels[labels.length - 1]).toBe('Delete')
    }
  })
})

/**
 * "New note" (GRO-2022): the inline-create flow — validation, the placement rule (the file lands
 * where the right-click happened) and open-after-create.
 */
describe('New note (GRO-2022)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')
  const errorText = (el: HTMLElement) => el.querySelector('.create-inline__error')?.textContent ?? null
  /** The one create the flow made: the note titled `Growth`, wherever it landed, born holding `properties` and then its title. */
  const growthIn = (bridge: Awaited<ReturnType<typeof mount>>['bridge'], dir: string, properties = '', body = '') => {
    const { id } = bridge.createFile.mock.calls[0][0] as { id: string }
    // The id is the vault's next number, from the door (YAZ-2677 D4); the file name holds it in lowercase (R8).
    expect(id).toMatch(/^YAZ-[1-9]\d*$/)
    const path = `${dir}/growth-${id.toLowerCase()}.md`
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path, content: `---\n${properties}title: Growth\n---\n${body}`, id })
    return path
  }
  /** Type a name into the open inline input and commit it with Enter. */
  const commit = async (el: HTMLElement, name: string) => {
    const field = input(el)!
    await act(async () => {
      field.value = name
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  it('is offered wherever the create group is — file rows, folder rows and blank space alike', async () => {
    for (const selector of ['.tree__row--file', '.tree__row--dir', '.sidebar__body']) {
      const { el } = await openOn(selector)
      expect(itemByLabel(el, 'New note')).toBeDefined()
    }
  })

  it('opens the inline input, under its own placeholder, and closes the menu', async () => {
    const { el } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(input(el)).not.toBeNull()
    expect(input(el)?.placeholder).toBe('New note')
  })

  it('B: committing a title creates the note in the right-clicked folder — its `title` and nothing else, with no template there, under its built name — then opens it (YAZ-2420 D20)', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(bridge.readFile).toHaveBeenCalledExactlyOnceWith('/v/sub/.template.md')
    const path = growthIn(bridge, '/v/sub')
    expect(path).toMatch(/^\/v\/sub\/growth-yaz-\d+\.md$/)
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(path)
    expect(input(el)).toBeNull() // the input is done
  })

  it('the placement rule: a FILE row creates beside it, blank space at the root', async () => {
    const onFile = await openOn('.tree__row--file')
    act(() => itemByLabel(onFile.el, 'New note')?.click())
    await commit(onFile.el, 'Growth')
    growthIn(onFile.bridge, '/v')

    const onBlank = await openOn('.sidebar__body')
    act(() => itemByLabel(onBlank.el, 'New note')?.click())
    await commit(onBlank.el, 'Growth')
    growthIn(onBlank.bridge, '/v')
  })

  /** The folder `dir` holds this `.template.md`; every other folder holds none. */
  const withTemplate = (bridge: Awaited<ReturnType<typeof mount>>['bridge'], dir: string, content: string) =>
    bridge.readFile.mockImplementation((path) =>
      path === `${dir}/.template.md` ? Promise.resolve({ path, content, mtime: 1, size: content.length }) : Promise.reject({ code: 'NOT_FOUND', message: `no such file: ${path}` }),
    )

  it('is born like "New" in the folder view (YAZ-2290 E3): the folder\'s `.template.md` gives its frontmatter and body', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    withTemplate(bridge, '/v/sub', '---\nowner: me\nstatus: 1-Backlog\n---\n## Notes\n')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(growthIn(bridge, '/v/sub', 'owner: me\nstatus: 1-Backlog\n', '## Notes\n'))
  })

  it('the vault root follows the same rule: its own `.template.md`, and never a subfolder\'s', async () => {
    const onBlank = await openOn('.sidebar__body')
    withTemplate(onBlank.bridge, '/v', '---\nkind: inbox\n---\n')
    act(() => itemByLabel(onBlank.el, 'New note')?.click())
    await commit(onBlank.el, 'Growth')
    growthIn(onBlank.bridge, '/v', 'kind: inbox\n')

    const onDir = await openOn('.tree__row--dir')
    withTemplate(onDir.bridge, '/v', '---\nkind: inbox\n---\n')
    act(() => itemByLabel(onDir.el, 'New note')?.click())
    await commit(onDir.el, 'Growth')
    growthIn(onDir.bridge, '/v/sub')
  })

  it('writes no empty column keys (YAZ-2290 E1): the columns the folder declares are not stamped into the note, with a template or without', async () => {
    const declares = { path: '/v/sub/.folder.md', properties: { folder_settings: { columns: { status: { kind: 'select', options: ['1-Backlog'] }, due: { kind: 'date' }, tags: { kind: 'list' } } } } }
    const bare = await openOn('.tree__row--dir')
    bare.bridge.index.mockResolvedValue({ root: '/v', records: [declares], folders: [], generatedAt: 1, ids: true })
    act(() => itemByLabel(bare.el, 'New note')?.click())
    await commit(bare.el, 'Growth')
    growthIn(bare.bridge, '/v/sub')

    const templated = await openOn('.tree__row--dir')
    templated.bridge.index.mockResolvedValue({ root: '/v', records: [declares], folders: [], generatedAt: 1, ids: true })
    withTemplate(templated.bridge, '/v/sub', '---\nowner: me\n---\n')
    act(() => itemByLabel(templated.el, 'New note')?.click())
    await commit(templated.el, 'Growth')
    growthIn(templated.bridge, '/v/sub', 'owner: me\n')
  })

  it('a template that cannot be read is an error in the box, and nothing is created', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    bridge.readFile.mockRejectedValue({ code: 'FORBIDDEN', message: 'permission denied' })
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(errorText(el)).toContain('permission denied')
    expect(bridge.createFile).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('B: a title is free text — `/`, `:`, `?`, quotes and a leading dot are accepted, and the title is what was typed (YAZ-2420 D20)', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, '.a/b: "c"?')
    expect(errorText(el)).toBeNull()
    const born = bridge.createFile.mock.calls[0][0] as { path: string; content: string; id: string }
    expect(born.path).toBe(`/v/sub/a-b-c-${born.id.toLowerCase()}.md`)
    expect(parseFrontmatter(born.content).properties).toEqual({ title: '.a/b: "c"?' })
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(born.path)
  })

  it('B: an empty title is not accepted: nothing is created and the box stays open (YAZ-2420 D20)', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, '   ')
    expect(bridge.createFile).not.toHaveBeenCalled()
    expect(input(el)).not.toBeNull()
  })

  it('before the vault’s index has landed its kind is not known: nothing is created, the box says so and keeps the name, and the same Enter works once it has (YAZ-2523)', async () => {
    const indexSource = createWikilinkResolveSource()
    const { el, bridge } = await mount({ indexSource })
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(errorText(el)).toBe('Vault index is still loading — try again in a moment')
    expect(bridge.createFile).not.toHaveBeenCalled()
    expect(input(el)?.value).toBe('Growth')
    indexSource.update(() => null, undefined, undefined, true)
    await commit(el, 'Growth')
    growthIn(bridge, '/v/sub')
  })

  // The ID vault's half of each row is the `B:` tests above.
  describe('in a vault that does not use IDs (YAZ-2523 V3)', () => {
    const openPlain = async () => {
      const m = await mount({ indexSource: indexFor(false) })
      act(() => void m.el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      act(() => itemByLabel(m.el, 'New note')?.click())
      return m
    }

    it('committing a name creates `<name>.md` in the right-clicked folder, empty with no template there, then opens it: no id and no `title` is sent', async () => {
      const { el, bridge, props } = await openPlain()
      await commit(el, 'Meeting notes')
      expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Meeting notes.md', content: '' })
      expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Meeting notes.md')
    })

    it('the folder\u2019s `.template.md` is the note as it is', async () => {
      const { el, bridge } = await openPlain()
      withTemplate(bridge, '/v/sub', '---\nowner: me\ntitle: Template\n---\n## Notes\n')
      await commit(el, 'Growth')
      expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Growth.md', content: '---\nowner: me\ntitle: Template\n---\n## Notes\n' })
    })

    it('a name a file cannot hold is refused in the box with the reason, and one that is taken as the bridge refuses it: nothing is created, and the box stays open', async () => {
      const { el, bridge, props } = await openPlain()
      await commit(el, 'a/b')
      expect(errorText(el)).toBe('Name cannot contain "/"')
      await commit(el, '.hidden')
      expect(errorText(el)).toBe('Names starting with "." are hidden')
      expect(bridge.createFile).not.toHaveBeenCalled()
      bridge.createFile.mockRejectedValue({ code: 'ALREADY_EXISTS', message: 'path already exists' })
      await commit(el, 'Taken')
      expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Taken.md', content: '' })
      expect(errorText(el)).toBe('path already exists')
      expect(input(el)).not.toBeNull()
      expect(props.onOpenFile).not.toHaveBeenCalled()
    })
  })
})

/**
 * New dated note (YAZ-2242): "New note" with the dated folder's seed (🔒 D3 — one `datedSeed`).
 * The caret and the no-op Enter on a bare seed are CreateInline.test's; this pins only the wiring.
 */
describe('New dated note (YAZ-2242)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')

  it('opens the New note box pre-filled with today\'s `MM_DD- ` and creates the dated note in that folder', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // only Date: the seed is read when the item is clicked
    vi.setSystemTime(new Date(2026, 8, 29))
    try {
      const { el, bridge, props } = await openOn('.tree__row--dir')
      clickSub(el, 'New dated note', 'New note') // in the "New note ▸" flyout (YAZ-3085 D3)
      expect(input(el)?.value).toBe('09_29- ')
      expect(input(el)?.placeholder).toBe('New note')
      await act(async () => {
        input(el)!.value = '09_29- Launch'
        input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      const { id } = bridge.createFile.mock.calls[0][0] as { id: string }
      expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: `/v/sub/09-29-launch-${id.toLowerCase()}.md`, content: '---\ntitle: 09_29- Launch\n---\n', id })
      expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`/v/sub/09-29-launch-${id.toLowerCase()}.md`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is born from the folder\'s `.template.md` too — frontmatter and body (YAZ-2290 E3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 29))
    try {
      const { el, bridge, props } = await openOn('.tree__row--dir')
      const template = '---\nowner: me\n---\n## Notes\n'
      bridge.readFile.mockImplementation((path) =>
        path === '/v/sub/.template.md' ? Promise.resolve({ path, content: template, mtime: 1, size: template.length }) : Promise.reject({ code: 'NOT_FOUND', message: `no such file: ${path}` }),
      )
      clickSub(el, 'New dated note', 'New note')
      await act(async () => {
        input(el)!.value = '09_29- Launch'
        input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      const { id } = bridge.createFile.mock.calls[0][0] as { id: string }
      expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: `/v/sub/09-29-launch-${id.toLowerCase()}.md`, content: '---\nowner: me\ntitle: 09_29- Launch\n---\n## Notes\n', id })
      expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`/v/sub/09-29-launch-${id.toLowerCase()}.md`)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * New folder (GRO-2022) and its dated twin (YAZ-1604): the SAME inline box, a directory at the end.
 * The caret and the no-op Enter on a bare seed are CreateInline.test's; this pins only the wiring.
 */
describe('New folder / New dated folder (GRO-2022, YAZ-1604)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')
  const errorText = (el: HTMLElement) => el.querySelector('.create-inline__error')?.textContent ?? null
  const commit = async (el: HTMLElement, name: string) => {
    await act(async () => {
      input(el)!.value = name
      input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  it('C: New folder, titled `Upwork 2026`, creates the directory `upwork-2026` inside the right-clicked folder, sends its title along, and opens nothing (YAZ-2420 D6)', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder')?.click())
    expect(input(el)?.placeholder).toBe('New folder')
    await commit(el, 'Upwork 2026')
    expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/upwork-2026', title: 'Upwork 2026' })
    expect(bridge.createFile).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('C: a folder title with no letter or digit is refused with a notice in the box, and nothing is created (YAZ-2420 D25)', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder')?.click())
    await commit(el, '—')
    expect(errorText(el)).toBe('A folder name needs a letter or a digit')
    expect(bridge.createDir).not.toHaveBeenCalled()
    expect(input(el)).not.toBeNull() // the input stays open to fix the title
  })

  it('C: a title whose kebab-case name a folder beside it already has is refused as a duplicate name is — no `-2` (YAZ-2420 D25)', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    bridge.createDir.mockRejectedValue({ code: 'ALREADY_EXISTS', message: 'path already exists' })
    act(() => itemByLabel(el, 'New folder')?.click())
    await commit(el, 'Upwork, 2026!')
    expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/upwork-2026', title: 'Upwork, 2026!' })
    expect(errorText(el)).toBe('path already exists')
    expect(input(el)).not.toBeNull()
  })

  it('New dated folder opens the create box pre-filled with today\'s `MM_DD- ` in that folder (YAZ-1604)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // only Date: the seed is read when the item is clicked
    vi.setSystemTime(new Date(2026, 5, 22))
    try {
      const { el, bridge } = await openOn('.tree__row--dir')
      clickSub(el, 'New dated folder', 'New folder') // in the "New folder ▸" flyout (YAZ-3085 D3)
      expect(input(el)?.value).toBe('06_22- ')
      await commit(el, '06_22- Launch')
      expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/06-22-launch', title: '06_22- Launch' }) // C: a dated folder (YAZ-2420 D6)
    } finally {
      vi.useRealTimers()
    }
  })

  // The ID vault's half is the `C:` tests above.
  it('in a vault that does not use IDs New folder creates the directory under the name typed and sends no title; a name a folder cannot hold is refused in the box (YAZ-2523 V3)', async () => {
    const { el, bridge } = await mount({ indexSource: indexFor(false) })
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'New folder')?.click())
    await commit(el, '.git')
    expect(errorText(el)).toBe('Names starting with "." are hidden')
    expect(bridge.createDir).not.toHaveBeenCalled()
    await commit(el, 'Q3 Plans')
    expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Q3 Plans' })
    expect(bridge.createFile).not.toHaveBeenCalled()
  })
})

/**
 * Multi-select (YAZ-1334 → YAZ-1336). Shift+click TOGGLES a file row in/out of a path-keyed
 * selection (🔒 D2 amended: toggle-accumulate, range is out of v1) — it never opens, never
 * previews. Selection is Sidebar-owned view state (🔒 D1): Escape and a lens switch clear it;
 * since D9 (YAZ-1674) a plain click — and ⌘-click's LOCKED background-open gesture (I3) — makes
 * it EXACTLY the clicked row, so every clipboard chord has a target the moment a row is clicked.
 */
describe('Sidebar multi-select via shift+click (YAZ-1336)', () => {
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withMultiTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) =>
    el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClick = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const selectedPaths = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((r) => r.dataset.path)

  it('shift+click toggles file rows into and out of the selection without opening anything', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/b.md'))
    expect(selectedPaths(el)).toEqual(['/v/a.md', '/v/b.md'])
    expect(rowByPath(el, '/v/a.md')?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    shiftClick(rowByPath(el, '/v/a.md'))
    expect(selectedPaths(el)).toEqual(['/v/b.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('plain click makes the selection EXACTLY the clicked file and opens it as before (D9, YAZ-1674)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/b.md'))
    act(() => rowByPath(el, '/v/c.md')?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/c.md')
    expect(selectedPaths(el)).toEqual(['/v/c.md'])
  })

  it('a MOUSE click on the file ALREADY open only selects it — no other page asked for, no caret jump into the editor (D11, YAZ-1674)', async () => {
    // Click-then-⌘C must work on the open note too: YAZ-961's "take me in" is Enter's (detail 0), never the mouse's.
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.tabIndex = -1
    Object.defineProperty(pm, 'offsetParent', { get: () => document.body })
    instance.appendChild(pm)
    document.body.appendChild(instance)
    const { el, props } = await mount({ activeFile: '/v/a.md' }, withMultiTree)
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    // The row asks for its own page: nothing for the workspace to change, and App's cue to close the tab board (YAZ-2648 S46).
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    expect(document.activeElement).not.toBe(pm)
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    expect(document.activeElement).toBe(pm) // Enter (detail 0) still takes the caret in (YAZ-961)
    instance.remove()
  })

  it('⌘-click selects the clicked row too and still opens a background tab (LOCKED I3)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    act(() => void rowByPath(el, '/v/b.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/b.md')
    expect(selectedPaths(el)).toEqual(['/v/b.md'])
  })

  it('shift+click on a dir row toggles it in and out beside files — folders select too (YAZ-1578, 🔒 D1)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/sub'))
    expect(selectedPaths(el)).toEqual(['/v/sub', '/v/a.md']) // panel order, not click order
    expect(rowByPath(el, '/v/sub')?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    shiftClick(rowByPath(el, '/v/sub'))
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('Escape clears the selection', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(selectedPaths(el)).toEqual([])
  })

  it('switching lens clears the selection', async () => {
    const { el, rerender } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    await rerender({ lens: 'favorites' })
    await rerender({ lens: 'files' })
    expect(selectedPaths(el)).toEqual([])
  })
})

/** The other two ways a selection ends (YAZ-1336), and the one press that must NOT be taken. */
describe('Sidebar multi-select: search, Escape-when-empty, and the prune', () => {
  const selectedRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row--selected')]
  const shiftClick = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))

  it('the Search tab ends it (YAZ-2638 S18): the tree comes back with nothing selected', async () => {
    const { el, rerender } = await mount()
    shiftClick(fileRow(el))
    expect(selectedRows(el)).toHaveLength(1)
    // The Search tab REPLACES the tab's tree — with the search's own (YAZ-2620), or with "No matches" as
    // here — so a selection cannot survive underneath it and be waiting when Files shows again.
    await type(searchInput(el) as HTMLInputElement, 'a')
    expect(el.querySelector('.tree')).toBeNull()
    await rerender({ lens: 'files' })
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(selectedRows(el)).toHaveLength(0)
  })

  it('Escape with NOTHING selected is left alone — the key still belongs to everyone else', async () => {
    const { el } = await mount()
    const body = el.querySelector('.sidebar__body') as HTMLElement
    const spare = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void body.dispatchEvent(spare))
    expect(spare.defaultPrevented).toBe(false)
    // With a selection standing it IS the selection's key: taken, not passed on.
    shiftClick(fileRow(el))
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void body.dispatchEvent(taken))
    expect(taken.defaultPrevented).toBe(true)
    expect(selectedRows(el)).toHaveLength(0)
  })

  it('a file that leaves the tree leaves the selection with it, and the rest stays selected', async () => {
    const A: TreeNode = { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' }
    const B: TreeNode = { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' }
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { el, bridge } = await mount({ watch }, (b) => b.tree.mockResolvedValue({ root: '/v', tree: [A, B], generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClick(row)
    expect(selectedRows(el)).toHaveLength(2)
    // b is deleted on disk: the watcher-driven refresh brings the tree that no longer has it.
    bridge.tree.mockResolvedValue({ root: '/v', tree: [A], generatedAt: 2 })
    await act(async () => emit?.({ type: 'unlink', path: '/v/b.md' }))
    await afterQuiet()
    expect(selectedRows(el).map((r) => r.dataset.path)).toEqual(['/v/a.md'])
  })

  it('a refresh keeps a selected FOLDER that is still on disk and drops one that left (YAZ-1578)', async () => {
    const A: TreeNode = { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' }
    const KEPT: TreeNode = { type: 'dir', name: 'kept', path: '/v/kept', children: [] }
    const GONE: TreeNode = { type: 'dir', name: 'gone', path: '/v/gone', children: [] }
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { el, bridge } = await mount({ watch }, (b) => b.tree.mockResolvedValue({ root: '/v', tree: [GONE, KEPT, A], generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row[data-path]')) shiftClick(row)
    expect(selectedRows(el)).toHaveLength(3)
    bridge.tree.mockResolvedValue({ root: '/v', tree: [KEPT, A], generatedAt: 2 })
    await act(async () => emit?.({ type: 'unlinkDir', path: '/v/gone' }))
    await afterQuiet()
    expect(selectedRows(el).map((r) => r.dataset.path)).toEqual(['/v/kept', '/v/a.md'])
  })
})

/**
 * Multi-select context-menu actions (YAZ-1334 → YAZ-1337, 🔒 D5). Right-clicking a row that is
 * INSIDE a 2+ selection adds "Copy N paths" / "Open N in new tabs" ABOVE the singular items —
 * plural targets live in their OWN MenuTargets fields per the one-field-per-item doctrine.
 * Right-clicking outside the selection clears it; blank space leaves it alone. Copied paths come
 * out in VISIBLE tree order (not click order), newline-joined, deduped by construction.
 */
describe('Sidebar multi-select context menu (YAZ-1337)', () => {
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withMultiTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) =>
    el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null) =>
    act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const selectedCount = (el: HTMLElement) => el.querySelectorAll('.tree__row--selected').length
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('right-click inside a 2-selection: "Open 2 in new tabs" LEADS, "Copy 2 paths" leads the clipboard group; copy is VISIBLE order, selection survives', async () => {
    const writeText = installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/c.md')) // click order c → a…
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    const labels = menuItems(el).map((b) => b.textContent)
    // 🔒 D7 (YAZ-1674) loosens YAZ-1337's "the plural pair leads": the plural OPEN still leads the
    // whole menu, but the plural COPY now sits in the clipboard group, below the Open group —
    // directly above the singular "Copy path", which it still leads.
    expect(labels[0]).toBe('Open 2 in new tabs')
    expect(labels.indexOf('Copy 2 paths')).toBeGreaterThan(labels.indexOf('Open 2 in new tabs'))
    expect(labels.indexOf('Copy 2 paths')).toBe(labels.indexOf('Copy path') - 1)
    expect(labels).toContain('Open 2 in new tabs')
    expect(labels).toContain('Copy path') // singular items still target the clicked row
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/a.md\n/v/c.md') // …but tree order out
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(2)
    await act(async () => {})
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 paths', 'info', 'clipboard') // YAZ-1341: a copy SAYS SO
  })

  it('the singular "Copy path" confirms too — every copy speaks with the one voice (YAZ-1341)', async () => {
    installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    rightClick(rowByPath(el, '/v/a.md'))
    act(() => itemByLabel(el, 'Copy path')?.click())
    await act(async () => {})
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied path', 'info', 'clipboard')
  })

  it('"Open N in new tabs" background-opens every selected path and keeps the selection', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    rightClick(rowByPath(el, '/v/b.md'))
    act(() => itemByLabel(el, 'Open 3 in new tabs')?.click())
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(3)
    expect((props.onOpenFileBackground as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(3)
  })

  it('a 1-selection gets no plural items — the singular menu already is that menu', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 1 paths')).toBeUndefined()
    expect(itemByLabel(el, 'Copy 1 path')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
  })

  it('right-click on a row OUTSIDE the selection SELECTS that row (D9, Finder) and shows the ordinary menu', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(rowByPath(el, '/v/c.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(selectedCount(el)).toBe(1)
    expect(rowByPath(el, '/v/c.md')?.classList.contains('tree__row--selected')).toBe(true)
  })

  it('right-click on blank space leaves the selection alone and stays plural-free', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(selectedCount(el)).toBe(2)
  })

  // ---- Mixed selections (YAZ-1578; YAZ-2290 D3): a folder is a tab too, so it opens with the files ----

  it('right-click a selected FOLDER in a mixed selection: "Copy N paths" and "Open N in new tabs" both take all N', async () => {
    const writeText = installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/b.md'))
    shiftClickRow(rowByPath(el, '/v/sub'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Copy 3 paths')).toBeDefined()
    expect(itemByLabel(el, 'Open 3 in new tabs')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined() // the singular items still target the folder
    act(() => itemByLabel(el, 'Copy 3 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/sub\n/v/a.md\n/v/b.md') // panel order
    rightClick(rowByPath(el, '/v/sub'))
    act(() => itemByLabel(el, 'Open 3 in new tabs')?.click())
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(3)
    expect(props.onOpenFileBackground).toHaveBeenNthCalledWith(1, '/v/sub')
    expect(props.onOpenFileBackground).toHaveBeenNthCalledWith(2, '/v/a.md')
    expect(props.onOpenFileBackground).toHaveBeenNthCalledWith(3, '/v/b.md')
    expect(selectedCount(el)).toBe(3)
  })

  it('a folders-only selection offers "Copy N paths" and "Open N in new tabs"', async () => {
    const TWO_DIRS: TreeNode[] = [
      { type: 'dir', name: 'one', path: '/v/one', children: [] },
      { type: 'dir', name: 'two', path: '/v/two', children: [] },
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: TWO_DIRS, generatedAt: 1 }))
    shiftClickRow(rowByPath(el, '/v/one'))
    shiftClickRow(rowByPath(el, '/v/two'))
    rightClick(rowByPath(el, '/v/two'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    expect(itemByLabel(el, 'Open 2 in new tabs')).toBeDefined()
  })

  // ---- Polish pins (YAZ-1340): shift means selection EVERYWHERE, and one Escape does one thing ----

  it('shift+click on a dir row selects it and never folds it; a plain click folds it and selects it (YAZ-1578 🔒 D1; D9 YAZ-1674 supersedes its D4)', async () => {
    // Expansion PERSISTS per root across mounts in this file (storage-backed), so this test
    // assumes nothing about the starting state and puts it back the way it found it.
    const { el } = await mount({}, withMultiTree)
    const dirRow = () => el.querySelector<HTMLButtonElement>('.tree__row--dir')
    const expandedNow = () => dirRow()?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
    const before = expandedNow()
    shiftClickRow(dirRow())
    expect(expandedNow()).toBe(before) // shift never folds…
    expect(selectedCount(el)).toBe(1) // …it selects the folder
    act(() => dirRow()?.click())
    expect(expandedNow()).not.toBe(before) // a plain click still folds…
    expect(selectedCount(el)).toBe(1) // …and the folder is the selection (D9: it was already, so nothing changes)
    act(() => dirRow()?.click())
    expect(expandedNow()).toBe(before)
  })

  it('Escape with the context menu open closes the MENU and leaves the selection standing', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(2)
  })
})

/**
 * The plural items' harder halves (YAZ-1337): a clipboard the OS refuses has to be reported, not
 * swallowed. (One path drawn on two rows counting ONCE, 🔒 D3, is pinned on the Favorites tab above.)
 */
describe('Sidebar multi-select context menu: the copy failure (YAZ-1337)', () => {
  const shiftClickRow = (row: HTMLElement | undefined) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null | undefined) =>
    act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

  it('a clipboard the OS refuses is REPORTED through the panel notice, never swallowed', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('DENIED')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const MULTI: TreeNode[] = [
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el, props } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: MULTI, generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClickRow(row)
    rightClick(el.querySelector('.tree__row[data-path="/v/a.md"]'))
    await act(async () => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(props.onNotice).toHaveBeenCalledWith("Can't copy paths: DENIED")
  })

  it('a right-click on a DIR row outside the selection makes the selection THAT folder (D9)', async () => {
    const TREE_WITH_DIR: TreeNode[] = [
      { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: TREE_WITH_DIR, generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClickRow(row)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
    rightClick(el.querySelector('.tree__row--dir'))
    expect([...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((r) => r.dataset.path)).toEqual(['/v/sub'])
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'New folder')).toBeDefined() // …and the dir's own ordinary menu stands
  })
})

/**
 * ⚡ Fable's ruling on YAZ-1338, at the panel: THE SELECTION IS THE TRUTH, THE DOM IS ONLY THE
 * ORDER. Folding a folder over a selected note hides its ROW; the note stays picked, so N keeps
 * counting it and the copy keeps carrying it — after the paths still on screen. The `selectionRef`
 * window App reads for ⌘⇧C is the same fact, handed up.
 */
describe('Sidebar multi-select: folded rows and the ⌘⇧C window (YAZ-1338)', () => {
  const NESTED: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [{ type: 'file', name: 'b.md', path: '/v/sub/b.md', size: 1, mtime: 1, kind: 'markdown' }] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withNested = (bridge: ReturnType<typeof installBridge>) => bridge.tree.mockResolvedValue({ root: '/v', tree: NESTED, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  /**
   * Expand / Collapse all (⚡ YAZ-862) is the fold gesture here: since D9 (YAZ-1674) a plain click
   * on the folder row would make the selection THAT folder, and this test is about a pick that
   * survives its row disappearing — the all-button folds without touching the selection.
   */
  const foldAll = (el: HTMLElement) => act(() => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')?.click())
  const rightClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

  it('a selected note inside a folder the user then FOLDS still counts, and copies after the visible ones', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el } = await mount({}, withNested)
    // Expansion persists per root across mounts in this file, so ENSURE the states rather than
    // toggling blind — this test must not care what its neighbours left behind.
    if (rowByPath(el, '/v/sub/b.md') === null) foldAll(el) // "Expand all": open `sub` so its note has a row to pick
    shiftClickRow(rowByPath(el, '/v/sub/b.md'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    foldAll(el) // "Collapse all": the row goes, the pick does not
    expect(rowByPath(el, '/v/sub/b.md')).toBeNull()
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1)
    rightClickRow(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined() // N is the SELECTION's size, not the DOM's
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/a.md\n/v/sub/b.md')
  })

  it('hands its selection up through selectionRef and empties it on the way out (🔒 D4)', async () => {
    const selectionRef = { current: EMPTY_SELECTION }
    const { el } = await mount({ selectionRef }, withNested)
    expect(selectionRef.current.size).toBe(0)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    expect([...selectionRef.current]).toEqual(['/v/a.md'])
    // D9: a PLAIN click is a one-row selection, so App's ⌘⇧C copies the clicked row's path.
    act(() => rowByPath(el, '/v/sub/b.md')?.click() ?? el.querySelector<HTMLButtonElement>('.tree__row--dir')?.click())
    expect(selectionRef.current.size).toBe(1)
    // The sidebar collapsing IS this component unmounting (App renders it conditionally), and a
    // chord must never copy a selection nobody can see any more.
    act(() => root?.unmount())
    root = null
    expect(selectionRef.current).toBe(EMPTY_SELECTION)
  })
})

/**
 * The Inbox row (YAZ-2322): the notes due for review, counted by App — the sidebar only shows
 * the number and reports the click. It sits above the lens tabs, so no lens and no search hides it.
 */
describe('Inbox row (YAZ-2322)', () => {
  const inbox = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__inbox')

  it('shows the due count, and carries it in its accessible name', async () => {
    const { el } = await mount({ upkeep: true, dueCount: 3 })
    expect(inbox(el)?.textContent).toBe('Inbox3')
    expect(inbox(el)?.getAttribute('aria-label')).toBe('Inbox, 3 due')
  })

  it('shows no number at zero: the row reads "Inbox" alone', async () => {
    const { el } = await mount({ upkeep: true, dueCount: 0 })
    expect(inbox(el)?.textContent).toBe('Inbox')
    expect(inbox(el)?.getAttribute('aria-label')).toBe('Inbox')
  })

  it('a click asks App to open the Inbox', async () => {
    const { el, props } = await mount({ upkeep: true, dueCount: 3 })
    act(() => inbox(el)?.click())
    expect(props.onOpenInbox).toHaveBeenCalledTimes(1)
  })

  it('reads as active exactly while a review is open', async () => {
    const { el, rerender } = await mount({ upkeep: true, dueCount: 3 })
    expect(inbox(el)?.getAttribute('aria-pressed')).toBe('false')
    expect(inbox(el)?.classList.contains('sidebar__inbox--active')).toBe(false)
    await rerender({ dueCount: 3, reviewing: true })
    expect(inbox(el)?.getAttribute('aria-pressed')).toBe('true')
    expect(inbox(el)?.classList.contains('sidebar__inbox--active')).toBe(true)
  })

  it('stays put in every lens and on the Search tab, with a query typed', async () => {
    for (const lens of ['files', 'favorites'] as const) {
      const { el } = await mount({ upkeep: true, lens, dueCount: 2 })
      expect(inbox(el)?.textContent).toBe('Inbox2')
    }
    const { el } = await mount({ upkeep: true, dueCount: 2 })
    await type(searchInput(el)!, 'a')
    expect(inbox(el)?.textContent).toBe('Inbox2')
  })

  it('upkeep off: no Inbox row, in any lens, on the Search tab with a query typed, whatever App counts', async () => {
    for (const lens of ['files', 'favorites'] as const) {
      const { el } = await mount({ upkeep: false, lens, dueCount: 2 })
      expect(inbox(el)).toBeNull()
    }
    const { el } = await mount({ upkeep: false, dueCount: 2 })
    await type(searchInput(el)!, 'a')
    expect(inbox(el)).toBeNull()
  })

  it('turned on: the Inbox row appears at once; turned off, it goes', async () => {
    const { el, rerender } = await mount({ upkeep: false, dueCount: 2 })
    await rerender({ upkeep: true })
    expect(inbox(el)?.textContent).toBe('Inbox2')
    await rerender({ upkeep: false })
    expect(inbox(el)).toBeNull()
  })
})

/** The row menu's review items (YAZ-2322): the sidebar names the row, App owns what happens. */
describe('review menu items (YAZ-2322)', () => {
  const rightClick = (el: HTMLElement, selector: string) =>
    act(() => void el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

  it('"Review this folder" sits on a FOLDER row, above Rename, and hands App the folder — in Favorites too', async () => {
    for (const lens of ['files', 'favorites'] as const) {
      const { el, props } = await mount({ upkeep: true, lens }, (b) => b.favorites.get.mockResolvedValue(['/v/sub']))
      rightClick(el, '.tree__row--dir')
      const labels = menuItems(el).map((b) => b.textContent)
      expect(labels.indexOf('Review this folder')).toBe(labels.indexOf('Rename') - 1)
      act(() => itemByLabel(el, 'Review this folder')?.click())
      expect(props.onReviewFolder).toHaveBeenCalledExactlyOnceWith('/v/sub')
    }
  })

  it('upkeep off: a folder\'s menu has no "Review this folder" — in Favorites too — until it is turned on', async () => {
    for (const lens of ['files', 'favorites'] as const) {
      const { el, rerender } = await mount({ upkeep: false, lens }, (b) => b.favorites.get.mockResolvedValue(['/v/sub']))
      rightClick(el, '.tree__row--dir')
      expect(menuItems(el).map((b) => b.textContent)).toContain('Rename')
      expect(itemByLabel(el, 'Review this folder')).toBeUndefined()
      await rerender({ upkeep: true })
      rightClick(el, '.tree__row--dir')
      expect(itemByLabel(el, 'Review this folder')).toBeDefined()
    }
  })

  it('a FILE row and blank space do not offer it', async () => {
    const { el } = await mount({ upkeep: true })
    rightClick(el, '.tree__row--file')
    expect(itemByLabel(el, 'Review this folder')).toBeUndefined()
    rightClick(el, '.sidebar__body')
    expect(itemByLabel(el, 'Review this folder')).toBeUndefined()
  })

  it.each([
    [true, 'Turn review off'],
    [false, 'Turn review on'],
  ])('a note whose review state is %s reads "%s", above Rename, and asks App for the opposite', async (state, label) => {
    const reviewState = vi.fn(() => state)
    const { el, props } = await mount({ upkeep: true, reviewState })
    rightClick(el, '.tree__row--file')
    expect(reviewState).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels.indexOf(label)).toBe(labels.indexOf('Rename') - 1)
    act(() => itemByLabel(el, label)?.click())
    expect(props.onSetReview).toHaveBeenCalledExactlyOnceWith('/v/a.md', !state)
  })

  it('a file App has no review state for — every note, with upkeep off — gets no toggle, and a folder is never asked about', async () => {
    const reviewState = vi.fn(() => null)
    const { el } = await mount({ reviewState })
    rightClick(el, '.tree__row--file')
    expect(menuItems(el).some((b) => b.textContent?.startsWith('Turn review'))).toBe(false)
    reviewState.mockClear()
    rightClick(el, '.tree__row--dir')
    expect(reviewState).not.toHaveBeenCalled()
    expect(menuItems(el).some((b) => b.textContent?.startsWith('Turn review'))).toBe(false)
  })
})

describe('settings cog (YAZ-1679)', () => {
  it('the footer cog only asks App for the dialog — the sidebar edits no setting itself', async () => {
    const { el, props } = await mount()
    act(() => el.querySelector<HTMLButtonElement>('.settings-button')?.click())
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(props.onChangeSettings).not.toHaveBeenCalled()
  })
})

describe('update pill (YAZ-2976 D4)', () => {
  it('sits after the cog in the footer, and its click asks App for the "What\'s new" window', async () => {
    const { el, props } = await mount({ update: { kind: 'ready', version: '1.0.13' } })
    const footer = [...el.querySelector('.sidebar__footer')!.children].map((child) => child.className)
    expect(footer).toEqual(['settings-button', 'zoom-chip', 'update-pill-slot'])
    act(() => el.querySelector<HTMLButtonElement>('.update-pill')?.click())
    expect(props.onOpenWhatsNew).toHaveBeenCalledTimes(1)
  })

  it('no update, no pill: the footer has the cog and the zoom chip', async () => {
    const { el } = await mount()
    const footer = [...el.querySelector('.sidebar__footer')!.children].map((child) => child.className)
    expect(footer).toEqual(['settings-button', 'zoom-chip'])
  })

  it('the sidebar zoom (YAZ-3389): the lists take `--sidebar-zoom` from the setting, the chip shows it, the menu\'s + writes the next step over the other settings, and the same value writes nothing (D6)', async () => {
    const { el, props, rerender } = await mount({ settings: { ...DEFAULT_SETTINGS, sidebarZoom: 125, theme: 'dark' } })
    expect(el.querySelector<HTMLElement>('.sidebar__body')!.style.getPropertyValue('--sidebar-zoom')).toBe('1.25')
    expect(el.querySelector('.zoom-chip')?.textContent).toBe('125%')
    act(() => el.querySelector<HTMLButtonElement>('.zoom-chip')!.click())
    act(() => document.querySelector<HTMLButtonElement>('.zoom-menu button[aria-label="Zoom the sidebar in"]')!.click())
    expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, sidebarZoom: 150, theme: 'dark' })

    await rerender({ settings: { ...DEFAULT_SETTINGS, sidebarZoom: 100 } })
    act(() => document.querySelector<HTMLButtonElement>('.zoom-menu .sidebar-zoom__value')!.click())
    expect(props.onChangeSettings).toHaveBeenCalledTimes(1)
  })

  it('the App size (YAZ-3432): the menu\'s App row writes `appZoom` over the other settings; the same value writes nothing', async () => {
    const { el, props } = await mount({ settings: { ...DEFAULT_SETTINGS, sidebarZoom: 150, theme: 'dark' } })
    act(() => el.querySelector<HTMLButtonElement>('.zoom-chip')!.click())
    const size = (p: number) => document.querySelector<HTMLButtonElement>(`.zoom-menu [aria-label="App size"] button[title="Every window at ${p}%"]`)!
    expect(size(100).getAttribute('aria-pressed')).toBe('true')
    act(() => size(100).click())
    expect(props.onChangeSettings).not.toHaveBeenCalled()
    act(() => size(125).click())
    expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, sidebarZoom: 150, theme: 'dark', appZoom: 125 })
  })

  it('YAZ-3389 D13: a Files window zooms its own list — the footer (cog, zoom, chip, pill) reads and writes the window\'s zoom, never the settings', async () => {
    const onFilesZoom = vi.fn()
    const { el, props } = await mount({ settings: { ...DEFAULT_SETTINGS, sidebarZoom: 100 }, filesZoom: 150, onFilesZoom, onToNormalWindow: vi.fn(), update: { kind: 'ready', version: '1.0.13' } })
    const footer = [...el.querySelector('.sidebar__footer')!.children].map((child) => child.className)
    expect(footer).toEqual(['settings-button', 'zoom-chip', 'sidebar__files-chip', 'update-pill-slot'])
    expect(el.querySelector<HTMLElement>('.sidebar__body')!.style.getPropertyValue('--sidebar-zoom')).toBe('1.5')
    expect(el.querySelector('.zoom-chip')?.textContent).toBe('150%')
    act(() => el.querySelector<HTMLButtonElement>('.zoom-chip')!.click())
    act(() => document.querySelector<HTMLButtonElement>('.zoom-menu button[aria-label="Zoom the sidebar in"]')!.click())
    expect(onFilesZoom).toHaveBeenCalledExactlyOnceWith(200)
    expect(props.onChangeSettings).not.toHaveBeenCalled()
  })
})

/**
 * Cut / Copy / Paste (YAZ-1674): the menu items (🔒 D5) and the chords (D6) both hand the ORDERED
 * selection to main's one app-wide clipboard (🔒 D1) over `file.clip`, and Paste goes to the menu's
 * `targetDir` — or, from ⌘V, beside the first selected row — over `file.paste`. "Paste N items"
 * reads the `clip:changed` push, so a copy in ANOTHER window labels this one's menu.
 */
describe('Cut / Copy / Paste (YAZ-1674)', () => {
  /** The clipboard as main tells it: these paths, counted, under this verb. */
  const clipOf = (op: 'copy' | 'cut', ...paths: string[]): FileClipState => ({ count: paths.length, op, paths })
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  /** The bridge's clipboard push, captured so a test can play "another window just copied". */
  let pushClip: ((state: FileClipState) => void) | null = null
  const withClipboard = (bridge: ReturnType<typeof installBridge>) => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
    bridge.file.onClipChanged.mockImplementation((listener) => {
      pushClip = pushed(bridge, listener)
      return () => undefined
    })
  }
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const body = (el: HTMLElement) => el.querySelector('.sidebar__body')

  beforeEach(() => {
    pushClip = null
  })

  it('a row offers Cut and Copy with their hints, and a DISABLED Paste while the clipboard is empty (🔒 D5)', async () => {
    const { el } = await mount({}, withClipboard)
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Cut')?.getAttribute('data-hint')).toBe('⌘X')
    expect(itemByLabel(el, 'Copy')?.getAttribute('data-hint')).toBe('⌘C')
    const paste = itemByLabel(el, 'Paste')
    expect(paste?.disabled).toBe(true)
    expect(paste?.getAttribute('data-hint')).toBe('⌘V')
    // Six groups drawn on one Markdown file row (YAZ-3085 D3): the focus toggle alone in the Open
    // group (YAZ-2619 R6), clipboard, create, this-row, "Open in" alone, Delete.
    expect(el.querySelectorAll('.ctx-menu__group')).toHaveLength(6)
  })

  it('blank space offers no Cut / Copy (nothing to clip) but keeps the disabled Paste — the root is a paste target', async () => {
    const { el } = await mount({}, withClipboard)
    rightClick(body(el))
    expect(itemByLabel(el, 'Cut')).toBeUndefined()
    expect(itemByLabel(el, 'Copy')).toBeUndefined()
    expect(itemByLabel(el, 'Paste')?.disabled).toBe(true)
    // No row to rename or delete: clipboard, create, and the root's own "Open in" — three groups (YAZ-3085 D3).
    expect(el.querySelectorAll('.ctx-menu__group')).toHaveLength(3)
  })

  it('Cut on a single row clips that one path and SAYS SO (YAZ-1341); the menu closes', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    rightClick(rowByPath(el, '/v/a.md'))
    await act(async () => itemByLabel(el, 'Cut')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md'], op: 'cut' })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Cut 1 file (a.md)', 'cut', 'clipboard') // names, as every gesture toast (YAZ-3305)
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('inside a 2-selection the items count it by kind — "Copy 2 files" (YAZ-3293 D23) — and clip the ORDERED selection, which stands', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    shiftClickRow(rowByPath(el, '/v/c.md')) // click order c → a…
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Cut 2 files')).toBeDefined()
    await act(async () => itemByLabel(el, 'Copy 2 files')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md', '/v/c.md'], op: 'copy' }) // …tree order out
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 files (a.md, c.md)', 'copy', 'clipboard') // names, in the order clipped (YAZ-3305)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
  })

  it('a clipboard push labels Paste "Paste 2 items"; clicking it pastes into the row\'s targetDir, refreshes and reports', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValue({ pasted: [{ from: '/w/x.md', to: '/v/sub/x.md', kind: 'file' }, { from: '/w/y.md', to: '/v/sub/y.md', kind: 'file' }], failed: [] })
    const treeReads = bridge.tree.mock.calls.length
    act(() => pushClip?.(clipOf('copy', '/w/x.md', '/w/y.md')))
    rightClick(rowByPath(el, '/v/sub'))
    const paste = itemByLabel(el, 'Paste 2 items')
    expect(paste?.disabled).toBe(false)
    await act(async () => paste?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/sub', 'copy', '/w/x.md', '/w/y.md'))
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Pasted 2 files (x.md, y.md)', 'paste', 'clipboard')
    expect(props.onMoved).not.toHaveBeenCalled() // a copy is not in the undo list (YAZ-3255 D10)
    expect(bridge.tree.mock.calls.length).toBe(treeReads + 1) // the explicit refresh: a copy broadcasts nothing
  })

  it('a Paste of a Copy that lands items plays ONE land sound; a Paste of a Cut leaves it to App (onMoved); nothing pasted, a failure or a rejected paste plays none (YAZ-3267 D15, S54, S56)', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValueOnce({ pasted: [{ from: '/w/x.md', to: '/v/sub/x.md', kind: 'file' }, { from: '/w/y.md', to: '/v/sub/y.md', kind: 'file' }], failed: [] })
    act(() => pushClip?.(clipOf('copy', '/w/x.md', '/w/y.md')))
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    expect(bridge.app.sound.mock.calls).toEqual([['land']])
    bridge.file.paste.mockResolvedValueOnce({ pasted: [], failed: [{ from: '/w/x.md', code: 'ALREADY_EXISTS', message: 'already exists' }] })
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    bridge.file.paste.mockResolvedValueOnce({ pasted: [], failed: [] })
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    bridge.file.paste.mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'target dir is gone' })
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    expect(bridge.app.sound).toHaveBeenCalledTimes(1)
    bridge.file.paste.mockResolvedValueOnce({ pasted: [{ from: '/w/x.md', to: '/v/x.md', kind: 'file' }], failed: [] })
    act(() => pushClip?.(clipOf('cut', '/w/x.md')))
    rightClick(rowByPath(el, '/v/a.md'))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onMoved).toHaveBeenCalledTimes(1)
    expect(bridge.app.sound).toHaveBeenCalledTimes(1)
  })

  it('a FILE row pastes into its PARENT (the "New note" rule), and per-entry failures are counted and named', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValue({ pasted: [{ from: '/w/x.md', to: '/v/x.md', kind: 'file' }], failed: [{ from: '/w/Note.md', code: 'ALREADY_EXISTS', message: 'already exists' }] })
    act(() => pushClip?.(clipOf('cut', '/w/x.md', '/w/Note.md')))
    rightClick(rowByPath(el, '/v/a.md'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v', 'cut', '/w/x.md', '/w/Note.md'))
    // A Paste of a Cut is a move gesture (YAZ-3255 S39): only what moved is in it.
    expect(props.onMoved).toHaveBeenCalledExactlyOnceWith({ moves: [{ oldPath: '/w/x.md', newPath: '/v/x.md', kind: 'file' }], cleared: [] }, 'Pasted 1 file (x.md), skipped 1: Note — already exists', true)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('E: a paste that fails names the note by its title (YAZ-2420 D14)', async () => {
    const indexSource = createWikilinkResolveSource()
    indexSource.update(() => null, [{ ...indexRecord('/v/a.md'), title: 'UP-001 - Abdul' }])
    const { el, bridge, props } = await mount({ indexSource }, withClipboard)
    bridge.file.paste.mockResolvedValueOnce({ pasted: [], failed: [{ from: '/v/a.md', code: 'ALREADY_EXISTS', message: 'already exists' }] })
    act(() => pushClip?.(clipOf('copy', '/v/a.md')))
    rightClick(rowByPath(el, '/v/sub'))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith("Couldn't paste: UP-001 - Abdul — already exists", 'error')
  })

  it('nothing pasted → "Couldn\'t paste: …"; a rejected paste → a notice, never a throw', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValueOnce({ pasted: [], failed: [{ from: '/w/Note.md', code: 'NOT_FOUND', message: 'gone' }] })
    act(() => pushClip?.(clipOf('copy', '/w/x.md')))
    rightClick(body(el))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith("Couldn't paste: Note — gone", 'error')
    bridge.file.paste.mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'target dir is gone' })
    rightClick(body(el))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith("Can't paste: target dir is gone", 'error')
  })

  it('a window opened AFTER a clip reads the clipboard ONCE on mount: Paste is labelled and enabled from the start', async () => {
    const { el, bridge } = await mount({}, (bridge) => {
      withClipboard(bridge)
      bridge.file.clipState.mockResolvedValue(clipOf('copy', '/w/x.md', '/w/y.md'))
    })
    expect(bridge.file.clipState).toHaveBeenCalled()
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 2 items')?.disabled).toBe(false)
  })

  it('a push that lands while the mount read is in flight WINS over the read', async () => {
    let settle: ((state: FileClipState) => void) | null = null
    const { el, bridge } = await mount({}, (bridge) => {
      withClipboard(bridge)
      bridge.file.clipState.mockImplementation(() => new Promise((resolve) => (settle = resolve)))
    })
    expect(bridge.file.clipState).toHaveBeenCalled()
    act(() => pushClip?.(clipOf('cut', '/w/x.md', '/w/y.md', '/w/z.md')))
    await act(async () => settle?.(clipOf('copy', '/w/x.md')))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 3 items')).toBeDefined()
  })

  it("S53: back from Finder, the window's focus reads the clipboard again, so Paste counts Finder's files; unmounted, it stops listening (YAZ-3265 D13)", async () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const focusHandlers = (spy: typeof added | typeof removed) => spy.mock.calls.filter(([type]) => type === 'focus').map(([, handler]) => handler)
    const { el, bridge } = await mount({}, withClipboard)
    expect(focusHandlers(added).length).toBeGreaterThan(0)
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste')?.disabled).toBe(true)
    // ⌘C on two files in Finder: main's clip-state now answers them.
    bridge.file.clipState.mockResolvedValue(clipOf('copy', '/Users/me/Downloads/a.pdf', '/Users/me/Downloads/b.md'))
    await act(async () => void window.dispatchEvent(new Event('focus')))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 2 items')?.disabled).toBe(false)
    // Unmounted, it stops listening: every focus handler it added goes.
    act(() => root?.unmount())
    root = null
    expect(focusHandlers(removed)).toEqual(expect.arrayContaining(focusHandlers(added)))
    added.mockRestore()
    removed.mockRestore()
  })

  it('a push that lands while a focus read is in flight WINS over the read (YAZ-3265 D13)', async () => {
    const { el, bridge } = await mount({}, withClipboard)
    let settle: ((state: FileClipState) => void) | null = null
    bridge.file.clipState.mockImplementation(() => new Promise((resolve) => (settle = resolve)))
    await act(async () => void window.dispatchEvent(new Event('focus')))
    act(() => pushClip?.(clipOf('cut', '/w/x.md', '/w/y.md', '/w/z.md')))
    await act(async () => settle?.(clipOf('copy', '/w/x.md')))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 3 items')).toBeDefined()
  })

  /**
   * YAZ-3266 (checker 2C1): the window's cached clip can be old — text copied in a note changes the system clipboard with
   * no event. So a paste reads `clipState` FRESH and uses that one answer for D21, D20, the undo record and the sound; the
   * paste names it (`expect`), and main pastes that clip or nothing (`CONFLICT`).
   */
  describe('YAZ-3266: a paste reads the clipboard fresh and names the clip it confirmed', () => {
    const REPORT = '/w/report.pdf'
    const NOTE = '/Users/me/Downloads/Note.md'
    /** App ⌘X, then ⌘C in Finder and back (the focus read caches Finder's file): the menu says "Paste 1 item" for Note.md. */
    const finderShown = async () => {
      const mounted = await mount({}, withClipboard)
      act(() => pushClip?.(clipOf('cut', REPORT)))
      mounted.bridge.file.clipState.mockResolvedValue(clipOf('copy', NOTE))
      await act(async () => void window.dispatchEvent(new Event('focus')))
      return mounted
    }

    it("the window shows Finder's copy, then text copied in a note makes main answer the app's cut: the paste runs that cut as a move, with Undo (S39)", async () => {
      const { el, bridge, props } = await finderShown()
      // Text copied in a note: no focus event, no push. Only main's answer changes.
      bridge.file.clipState.mockResolvedValue(clipOf('cut', REPORT))
      bridge.file.paste.mockResolvedValueOnce({ pasted: [{ from: REPORT, to: '/v/sub/report.pdf', kind: 'file' }], failed: [] })
      const reads = bridge.file.clipState.mock.calls.length
      rightClick(rowByPath(el, '/v/sub'))
      await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
      expect(bridge.file.clipState.mock.calls.length).toBe(reads + 1) // read again at paste time
      expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/sub', expect: { op: 'cut', paths: [REPORT] } })
      // A move: on the undo list with its toast (App says it and plays the sound), never "Pasted" as a copy.
      expect(props.onMoved).toHaveBeenCalledExactlyOnceWith({ moves: [{ oldPath: REPORT, newPath: '/v/sub/report.pdf', kind: 'file' }], cleared: [] }, 'Pasted 1 file (report.pdf)', false)
      expect(props.onNotice).not.toHaveBeenCalled()
      expect(bridge.app.sound).not.toHaveBeenCalled()
    })

    it('⌘V goes through the same fresh read', async () => {
      const clipboardRef = box()
      const { el, bridge } = await mount({ clipboardRef }, withClipboard)
      act(() => pushClip?.(clipOf('copy', NOTE)))
      bridge.file.clipState.mockResolvedValue(clipOf('cut', REPORT))
      act(() => rowByPath(el, '/v/sub')?.click())
      await act(async () => void clipboardRef.current?.paste())
      expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/sub', expect: { op: 'cut', paths: [REPORT] } })
    })

    it('the clipboard changes between the read and the paste: main pastes nothing (CONFLICT), the notice says so, nothing is a move, and the label reads again', async () => {
      const { el, bridge, props } = await finderShown()
      bridge.file.paste.mockRejectedValueOnce({ code: 'CONFLICT', message: CLIP_CHANGED })
      rightClick(rowByPath(el, '/v/sub'))
      await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
      expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/sub', expect: { op: 'copy', paths: [NOTE] } })
      expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('The clipboard changed. Paste again.', 'info')
      expect(props.onMoved).not.toHaveBeenCalled()
      expect(bridge.app.sound).not.toHaveBeenCalled()
      const reads = bridge.file.clipState.mock.calls.length
      bridge.file.clipState.mockResolvedValue(clipOf('cut', REPORT))
      bridge.file.paste.mockRejectedValueOnce({ code: 'CONFLICT', message: CLIP_CHANGED })
      rightClick(rowByPath(el, '/v/sub'))
      await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
      expect(bridge.file.clipState.mock.calls.length).toBe(reads + 2) // the paste's read, and the read after the CONFLICT
    })

    it('nothing on the clipboard by paste time: "Nothing to paste", and no paste is sent', async () => {
      const { el, bridge, props } = await finderShown()
      bridge.file.clipState.mockResolvedValue(null)
      rightClick(rowByPath(el, '/v/sub'))
      await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
      expect(bridge.file.paste).not.toHaveBeenCalled()
      expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Nothing to paste', 'info')
      rightClick(rowByPath(el, '/v/sub'))
      expect(itemByLabel(el, 'Paste')?.disabled).toBe(true) // the label learned it too
    })
  })

  // ---- The chords' handle (D6 amended): App's window listener asks these; the RULES are here ----

  /** A box App would hold; the Sidebar fills it every render and empties it on unmount. */
  const box = () => ({ current: null as SidebarClipboard | null })
  const verb = (ref: { current: SidebarClipboard | null }, op: 'copy' | 'cut' | 'paste') =>
    op === 'paste' ? (ref.current?.paste() ?? false) : (ref.current?.cutOrCopy(op) ?? false)

  it('cutOrCopy with a selection clips the ORDERED paths and answers true; the cut is the same call with its op', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    shiftClickRow(rowByPath(el, '/v/c.md'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    expect(verb(clipboardRef, 'copy')).toBe(true)
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md', '/v/c.md'], op: 'copy' })
    expect(verb(clipboardRef, 'cut')).toBe(true)
    expect(bridge.file.clip).toHaveBeenLastCalledWith({ paths: ['/v/a.md', '/v/c.md'], op: 'cut' })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2) // the selection stands
  })

  it('with NO selection cutOrCopy answers false and clips nothing — the key is not ours', async () => {
    const clipboardRef = box()
    const { bridge } = await mount({ clipboardRef }, withClipboard)
    expect(verb(clipboardRef, 'copy')).toBe(false)
    expect(bridge.file.clip).not.toHaveBeenCalled()
  })

  it('paste answers false with an empty clipboard; with one it pastes beside the FIRST selected row — a folder → into it, a file → its parent, none → the root', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    expect(verb(clipboardRef, 'paste')).toBe(false)
    expect(bridge.file.paste).not.toHaveBeenCalled()
    act(() => pushClip?.(clipOf('copy', '/w/x.md')))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith(into('/v', 'copy', '/w/x.md'))
    shiftClickRow(rowByPath(el, '/v/sub'))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith(into('/v/sub', 'copy', '/w/x.md'))
    act(() => void body(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith(into('/v', 'copy', '/w/x.md'))
    expect(bridge.file.paste).toHaveBeenCalledTimes(3)
  })

  it('an open context menu owns the verbs: both answer false while it stands', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.(clipOf('copy', '/w/x.md')))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(verb(clipboardRef, 'copy')).toBe(false)
    expect(verb(clipboardRef, 'paste')).toBe(false)
    expect(bridge.file.clip).not.toHaveBeenCalled()
    expect(bridge.file.paste).not.toHaveBeenCalled()
  })

  it('the handle is emptied on unmount — a collapsed sidebar has no verbs to offer', async () => {
    const clipboardRef = box()
    await mount({ clipboardRef }, withClipboard)
    expect(clipboardRef.current).not.toBeNull()
    act(() => root?.unmount())
    root = null
    expect(clipboardRef.current).toBeNull()
  })

  it('D9: a plain click on a file, then copy, clips exactly that file; ⌘⇧C sees the same one-row selection', async () => {
    const clipboardRef = box()
    const selectionRef = { current: EMPTY_SELECTION }
    const { el, bridge, props } = await mount({ selectionRef, clipboardRef }, withClipboard)
    act(() => rowByPath(el, '/v/a.md')?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect([...selectionRef.current]).toEqual(['/v/a.md'])
    expect(verb(clipboardRef, 'copy')).toBe(true)
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md'], op: 'copy' })
  })

  it('D9: a plain click on a FOLDER selects it, so paste goes INTO it', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.(clipOf('copy', '/w/x.md')))
    act(() => rowByPath(el, '/v/sub')?.click())
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/sub', 'copy', '/w/x.md'))
    act(() => rowByPath(el, '/v/sub')?.click()) // fold it back the way it was found
  })

  it('a plain LEFT click on BLANK SPACE clears the selection, so paste goes to the ROOT; a right-click there keeps it (YAZ-1337)', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.(clipOf('copy', '/w/x.md')))
    act(() => rowByPath(el, '/v/sub')?.click())
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1)
    act(() => void body(el)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1) // a right-click is not a pick
    act(() => void body(el)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v', 'copy', '/w/x.md'))
    act(() => rowByPath(el, '/v/sub')?.click()) // fold it back the way it was found
  })

  it('a LEFT mousedown ON a row is the row\'s own gesture — it never clears through the body', async () => {
    const { el } = await mount({}, withClipboard)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
  })
})

describe('the tree re-renders only the rows a change touches (YAZ-2194)', () => {
  const NESTED: TreeNode[] = [
    { type: 'dir', name: 'A', path: '/v/A', children: ['a1.md', 'a2.md', 'a3.md'].map((name) => ({ type: 'file' as const, name, path: `/v/A/${name}`, size: 1, mtime: 1, kind: 'markdown' as const })) },
    { type: 'dir', name: 'B', path: '/v/B', children: ['b1.md', 'b2.md'].map((name) => ({ type: 'file' as const, name, path: `/v/B/${name}`, size: 1, mtime: 1, kind: 'markdown' as const })) },
    { type: 'file', name: 'r.md', path: '/v/r.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const mountNested = async (over: Partial<SidebarProps> = {}) => {
    vi.spyOn(storage, 'getExpanded').mockReturnValue(['/v/A', '/v/B'])
    const mounted = await mount({ activeFile: '/v/A/a1.md', ...over }, (bridge) => bridge.tree.mockResolvedValue({ root: '/v', tree: NESTED, generatedAt: 1 }))
    expect(mounted.el.querySelectorAll('.tree__row--file')).toHaveLength(6)
    labelRenders.names = []
    return mounted
  }
  const rendered = () => [...new Set(labelRenders.names)].sort()

  it('collapsing a folder re-renders its parent level only — never the sibling folder\'s rows', async () => {
    const { el } = await mountNested()
    const b = [...el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')].find((row) => row.dataset.path === '/v/B')!
    await act(async () => b.click())
    expect(el.querySelectorAll('.tree__row--file')).toHaveLength(4)
    expect(rendered()).toEqual(['r.md'])
  })

  it('a tab switch re-renders the levels holding the old and the new active file only', async () => {
    const { rerender } = await mountNested()
    await rerender({ activeFile: '/v/B/b1.md' })
    expect(rendered()).toEqual(['a1.md', 'a2.md', 'a3.md', 'b1.md', 'b2.md', 'r.md'])
    labelRenders.names = []
    await rerender({ activeFile: '/v/B/b2.md' })
    expect(rendered()).toEqual(['b1.md', 'b2.md', 'r.md'])
  })

  it('a sidebar resize re-renders no row at all', async () => {
    const { el, rerender } = await mountNested()
    await rerender({ width: 300 })
    expect(el.querySelector<HTMLElement>('.sidebar')?.style.width).toBe('300px')
    expect(rendered()).toEqual([])
  })

  it('a settings copy that changes no setting — a state:changed broadcast — re-renders no row at all (YAZ-3237)', async () => {
    const { rerender } = await mountNested()
    await rerender({ settings: structuredClone(DEFAULT_SETTINGS) })
    expect(rendered()).toEqual([])
  })

  it('an index snapshot that moves no shortcut — a save — re-renders no row at all (YAZ-2290 D2)', async () => {
    const indexSource = createWikilinkResolveSource()
    const records = NESTED.flatMap((node) => (node.type === 'dir' ? node.children.map((child) => indexRecord(child.path)) : []))
    act(() => indexSource.update(() => null, records))
    await mountNested({ indexSource })
    act(() => indexSource.update(() => null, records.map((r) => ({ ...r, mtime: 2 }))))
    expect(rendered()).toEqual([])
  })
})

/** Every row is labelled with its title, looked up in the window's index (YAZ-2420 🔒 D15); the tree itself stays a directory listing. */
describe('tree rows show the title (YAZ-2420 D15)', () => {
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const ABDUL = '/v/upwork/up-001-abdul-k3m9x2pq7abc.md'
  const TITLED: TreeNode[] = [{ type: 'dir', name: 'upwork', path: '/v/upwork', children: [file('/v/upwork/plan.md'), { type: 'file', name: 'scan.pdf', path: '/v/upwork/scan.pdf', size: 1, mtime: 1, kind: 'pdf' }, file(ABDUL)] }]
  const RECORDS = [indexRecord('/v/upwork/plan.md'), { ...indexRecord(ABDUL), title: 'UP-001 - Abdul' }]
  const FOLDERS = [{ ...indexRecord('/v/upwork/.folder.md'), title: 'Upwork 2026' }]
  const labels = (el: HTMLElement) => [...el.querySelectorAll('.tree__label')].map((label) => label.textContent)
  const mountTitled = async (indexSource = createWikilinkResolveSource()) => {
    vi.spyOn(storage, 'getExpanded').mockReturnValue(['/v/upwork'])
    const mounted = await mount({ indexSource }, (bridge) => bridge.tree.mockResolvedValue({ root: '/v', tree: TITLED, generatedAt: 1 }))
    return { ...mounted, indexSource }
  }

  it('E: before the index has loaded a row shows its file name, then its title — a file that is no note keeps its name', async () => {
    const { el, indexSource } = await mountTitled()
    expect(labels(el)).toEqual(['upwork', 'plan', 'scan.pdf', 'up-001-abdul-k3m9x2pq7abc'])
    act(() => indexSource.update(() => null, RECORDS, FOLDERS))
    expect(labels(el)).toEqual(['Upwork 2026', 'plan', 'scan.pdf', 'UP-001 - Abdul'])
  })

  it('a snapshot that changes no title re-renders no row; one that changes a title re-renders them', async () => {
    const indexSource = createWikilinkResolveSource()
    act(() => indexSource.update(() => null, RECORDS, FOLDERS))
    await mountTitled(indexSource)
    labelRenders.names = []
    act(() => indexSource.update(() => null, RECORDS.map((r) => ({ ...r, mtime: 2 })), FOLDERS))
    expect(labelRenders.names).toEqual([])
    act(() => indexSource.update(() => null, RECORDS.map((r) => (r.path === ABDUL ? { ...r, title: 'Renamed' } : r)), FOLDERS))
    expect([...new Set(labelRenders.names)].sort()).toEqual(['plan.md', 'scan.pdf', 'up-001-abdul-k3m9x2pq7abc.md'])
  })
})

/**
 * Shortcuts (YAZ-2290 D2): a note lives in one folder and also appears in another — its
 * `also_in` names that folder's id, the `id` of the folder's `.folder.md`. The folder row's menu
 * adds one through the picker; the writes run for real over an in-memory disk behind the bridge.
 */
describe('note shortcuts (YAZ-2290 D2)', () => {
  const PROJECTS_ID = 'k3m9x2pq7abc'
  const HEALTH = '/v/Areas/Health.md'
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const LINKED: TreeNode[] = [
    { type: 'dir', name: 'Areas', path: '/v/Areas', children: [file(HEALTH)] },
    { type: 'dir', name: 'Projects', path: '/v/Projects', children: [file('/v/Projects/Alpha.md'), file('/v/Projects/Zeta.md')] },
    file('/v/top.md'),
  ]
  /** The snapshot, in path order; `alsoIn` is Health's own `also_in`. */
  const records = (alsoIn?: unknown): IndexRecord[] => [
    { ...indexRecord(HEALTH), properties: alsoIn === undefined ? {} : { also_in: alsoIn } },
    indexRecord('/v/Projects/Alpha.md'),
    indexRecord('/v/Projects/Zeta.md'),
    indexRecord('/v/top.md'),
  ]
  const FOLDERS: IndexRecord[] = [{ ...indexRecord('/v/Projects/.folder.md'), id: PROJECTS_ID, title: 'Projects' }]
  const row = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const rightClick = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const picker = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Find a note"]')
  const sheetText = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  const mountLinked = async (alsoIn?: unknown, over: Partial<SidebarProps> = {}, tweak?: (bridge: ReturnType<typeof installBridge>) => unknown) => {
    // Open in Files, and as the top rows of Focus and Favorites, whose folds are their own (YAZ-3131 S2).
    vi.spyOn(storage, 'getExpanded').mockReturnValue(['/v/Areas', '/v/Projects', copyFoldKey('/v/Areas', '/v/Areas'), copyFoldKey('/v/Projects', '/v/Projects')])
    const indexSource = createWikilinkResolveSource()
    act(() => indexSource.update(() => null, records(alsoIn), FOLDERS, true))
    const disk = new Map([
      [HEALTH, alsoIn === undefined ? 'Body\n' : `---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`],
      ['/v/Projects/.folder.md', `---\nid: ${PROJECTS_ID}\n---\n`],
    ])
    const writeFile = vi.fn(async ({ path, content }: { path: string; content: string }) => {
      disk.set(path, content)
      return { path, mtime: 2, size: content.length }
    })
    const mounted = await mount({ indexSource, ...over }, (bridge) => {
      bridge.tree.mockResolvedValue({ root: '/v', tree: LINKED, generatedAt: 1 })
      bridge.readFile.mockImplementation((path) => {
        const content = disk.get(path)
        return content === undefined ? Promise.reject({ code: 'NOT_FOUND', message: `no such file: ${path}` }) : Promise.resolve({ path, content, mtime: 1, size: content.length })
      })
      Object.assign(bridge, { writeFile })
      return tweak?.(bridge)
    })
    return { ...mounted, indexSource, disk, writeFile }
  }

  /** Health lives in Areas and is a shortcut in Projects: its row there, as opposed to `row(el, HEALTH)` — the real one, first in the panel. */
  const shortcutRow = (el: HTMLElement) => row(el, '/v/Projects')?.closest('li')?.querySelector<HTMLButtonElement>(`.tree__row[data-path="${HEALTH}"]`) ?? null

  describe('the shortcut row', () => {
    it('stands under the folder among its files, in name order, wearing the mark (YAZ-2631 S24)', async () => {
      const { el } = await mountLinked([PROJECTS_ID])
      const rows = [...(row(el, '/v/Projects')?.closest('li')?.querySelectorAll('.tree__row--file') ?? [])]
      expect(rows.map((r) => r.textContent)).toEqual(['Alpha', 'Health', 'Zeta'])
      expect(rows.map((r) => r.querySelector('.shortcut-mark') !== null)).toEqual([false, true, false])
      expect(row(el, HEALTH)?.querySelector('.shortcut-mark')).toBeNull() // where it lives, it is a plain file row
    })

    it('E: shows the note\'s title, as its real row does, and stands in the order of the label it shows (YAZ-2420 D15, YAZ-3227 D8)', async () => {
      const { el, indexSource } = await mountLinked([PROJECTS_ID])
      act(() => indexSource.update(() => null, records([PROJECTS_ID]).map((r) => (r.path === HEALTH ? { ...r, title: 'Zz Top' } : r)), FOLDERS, true))
      expect(row(el, HEALTH)?.textContent).toBe('Zz Top')
      expect([...(row(el, '/v/Projects')?.closest('li')?.querySelectorAll('.tree__row--file') ?? [])].map((r) => r.textContent)).toEqual(['Alpha', 'Zeta', 'Zz Top'])
    })

    it('a click opens the REAL note, exactly as a file row does', async () => {
      const { el, props } = await mountLinked([PROJECTS_ID])
      act(() => shortcutRow(el)?.click())
      expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(HEALTH)
    })

    it('S7, S14 (YAZ-2620): a search draws the note ONCE, in the folder it lives in — no shortcut row', async () => {
      const { el } = await mountLinked([PROJECTS_ID], {}, (bridge) => bridge.index.mockResolvedValue({ root: '/v', records: records([PROJECTS_ID]), folders: FOLDERS, generatedAt: 1, ids: true } as never))
      const labels = () => [...el.querySelectorAll('.sidebar__body .tree__row .tree__label')].map((label) => label.textContent)
      await type(searchInput(el)!, 'health')
      expect(labels()).toEqual(['Areas', 'Health'])
      expect(el.querySelector('.sidebar__body .shortcut-mark')).toBeNull()
      await type(searchInput(el)!, 'alpha')
      expect(labels()).toEqual(['Projects', 'Alpha'])
    })

    it('is not draggable — a drag would move the note out of the folder it lives in — while its real row still is; so too on a tab that reorders, where the file rows beside it move on disk (YAZ-2631 S36)', async () => {
      const { el, props } = await mountLinked([PROJECTS_ID])
      expect(shortcutRow(el)?.draggable).toBe(false)
      expect(row(el, HEALTH)?.draggable).toBe(true)
      act(() => void shortcutRow(el)?.dispatchEvent(new Event('dragstart', { bubbles: true })))
      act(() => void row(el, '/v/Projects')?.dispatchEvent(new Event('drop', { bubbles: true })))
      expect(props.onRenameFile).not.toHaveBeenCalled()
      act(() => root?.unmount())
      container?.remove()

      const favorites = await mountLinked([PROJECTS_ID], { lens: 'favorites' }, (bridge) => bridge.favorites.get.mockResolvedValue(['/v/Areas', '/v/Projects']))
      expect([shortcutRow(favorites.el)?.draggable, row(favorites.el, '/v/Projects/Alpha.md')?.draggable]).toEqual([false, true])
      act(() => void shortcutRow(favorites.el)?.dispatchEvent(new Event('dragstart', { bubbles: true })))
      act(() => void row(favorites.el, '/v/Areas')?.dispatchEvent(new Event('dragover', { bubbles: true })))
      expect(favorites.el.querySelector('.tree__row--drop, .tree__row--drop-before, .tree__row--drop-after')).toBeNull()
      act(() => void row(favorites.el, '/v/Areas')?.dispatchEvent(new Event('drop', { bubbles: true })))
      expect(favorites.props.onRenameFile).not.toHaveBeenCalled()
      expect(favorites.bridge.favorites.set).not.toHaveBeenCalled()
    })

    it('is the same note as its real row: the open file and the selection light BOTH (🔒 D3)', async () => {
      const { el, rerender } = await mountLinked([PROJECTS_ID])
      await rerender({ activeFile: HEALTH })
      expect(row(el, HEALTH)?.classList.contains('tree__row--active')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--active')).toBe(true)
      act(() => row(el, HEALTH)?.click())
      expect(row(el, HEALTH)?.classList.contains('tree__row--selected')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--selected')).toBe(true)
      await rerender({ activeFile: '/v/top.md' })
      expect(shortcutRow(el)?.classList.contains('tree__row--active')).toBe(false)
    })

    it.each(['favorites', 'focus'] as const)('on %s, the shortcut row still lights with its real row, as the open page and as the selection (YAZ-3131 S18, YAZ-3142)', async (lens) => {
      const { el, rerender } = await mountLinked([PROJECTS_ID], { lens }, (bridge) => {
        bridge.favorites.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
        bridge.focus.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
      })
      await rerender({ activeFile: HEALTH })
      expect(shortcutRow(el)).not.toBeNull()
      expect(row(el, HEALTH)?.classList.contains('tree__row--active')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--active')).toBe(true)
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S18 (YAZ-3142) on %s: a click on the real row — the shortcut row shows selected and active too (YAZ-2290 D3)', async (lens) => {
      const { el, rerender } = await mountLinked([PROJECTS_ID], { lens }, (bridge) => {
        bridge.favorites.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
        bridge.focus.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
      })
      act(() => row(el, HEALTH)?.click())
      await rerender({ activeFile: HEALTH })
      expect(row(el, HEALTH)?.classList.contains('tree__row--selected')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--selected')).toBe(true)
      expect(row(el, HEALTH)?.classList.contains('tree__row--active')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--active')).toBe(true)
    })

    it.each(['favorites', 'focus'] as const)('YAZ-3131 S18 (YAZ-3142) on %s: a click on the shortcut row — the real row lights as the open page too', async (lens) => {
      const { el, rerender } = await mountLinked([PROJECTS_ID], { lens }, (bridge) => {
        bridge.favorites.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
        bridge.focus.get.mockResolvedValue(['/v/Areas', '/v/Projects'])
      })
      act(() => shortcutRow(el)?.click())
      await rerender({ activeFile: HEALTH })
      expect(row(el, HEALTH)?.classList.contains('tree__row--active')).toBe(true)
      expect(shortcutRow(el)?.classList.contains('tree__row--active')).toBe(true)
    })

    it('a click, a shift-click or a right-click on it selects nothing, so ⌘C / ⌘X never reach the real note from here', async () => {
      const clipboardRef: SidebarProps['clipboardRef'] = { current: null }
      const { el, bridge } = await mountLinked([PROJECTS_ID], { clipboardRef })
      act(() => shortcutRow(el)?.click())
      act(() => void shortcutRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
      rightClick(shortcutRow(el))
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(el.querySelector('.tree__row--selected')).toBeNull()
      expect(clipboardRef.current?.cutOrCopy('cut')).toBe(false)
      expect(bridge.file.clip).not.toHaveBeenCalled()
    })

    // The root level (the old active file) and Areas (the real row) re-render either way; Projects — Alpha, the shortcut, Zeta — only while it draws the shortcut row.
    it.each([
      ['the level that draws its shortcut row re-renders too', [PROJECTS_ID], ['Alpha.md', 'Health.md', 'Zeta.md', 'top.md']],
      ['with no shortcut there, that level does not', undefined, ['Health.md', 'top.md']],
    ])('a tab switch to the note: %s (YAZ-2194)', async (_name, alsoIn, rows) => {
      const { rerender } = await mountLinked(alsoIn, { activeFile: '/v/top.md' })
      labelRenders.names = []
      await rerender({ activeFile: HEALTH })
      expect([...new Set(labelRenders.names)].sort()).toEqual(rows)
    })

    it('its menu: "Remove shortcut" where Delete would be, no Rename, no Cut / Copy / Paste; the real-place items stay (E5)', async () => {
      const { el } = await mountLinked([PROJECTS_ID])
      rightClick(shortcutRow(el))
      const labels = menuItems(el).map((item) => item.textContent)
      expect(labels[labels.length - 1]).toBe('Remove shortcut')
      for (const absent of ['Delete', 'Rename', 'Cut', 'Copy', 'Paste', 'Add note shortcut']) expect(labels).not.toContain(absent)
      for (const kept of ['Add to focus', 'Copy path', 'Add to favorites', 'Open in']) expect(labels).toContain(kept)
      // The real row's menu is a file row's, as ever.
      rightClick(row(el, HEALTH))
      expect(itemByLabel(el, 'Delete')).toBeDefined()
      expect(itemByLabel(el, 'Remove shortcut')).toBeUndefined()
    })

    it('R8 (YAZ-2619): the focus item on a shortcut row acts on the note\'s real path, both ways', async () => {
      const { el, bridge } = await mountLinked([PROJECTS_ID])
      rightClick(shortcutRow(el))
      await act(async () => itemByLabel(el, 'Add to focus')?.click())
      expect(bridge.focus.set).toHaveBeenLastCalledWith('/v', [HEALTH])
      rightClick(shortcutRow(el))
      await act(async () => itemByLabel(el, 'Remove from focus')?.click())
      expect(bridge.focus.set).toHaveBeenLastCalledWith('/v', [])
    })

    it('renaming the note from its real row puts ONE input there; the shortcut row stays a row', async () => {
      const { el } = await mountLinked([PROJECTS_ID])
      rightClick(row(el, HEALTH))
      act(() => itemByLabel(el, 'Rename')?.click())
      expect(el.querySelectorAll('.create-inline__input')).toHaveLength(1)
      expect(row(el, '/v/Areas')?.closest('li')?.querySelector('.create-inline__input')).not.toBeNull()
      expect(shortcutRow(el)).not.toBeNull()
    })

    it('"New note" from its menu creates in the folder the row STANDS in', async () => {
      const { el } = await mountLinked([PROJECTS_ID])
      rightClick(shortcutRow(el))
      act(() => itemByLabel(el, 'New note')?.click())
      expect(row(el, '/v/Projects')?.closest('li')?.querySelector('.create-inline')).not.toBeNull()
      expect(row(el, '/v/Areas')?.closest('li')?.querySelector('.create-inline')).toBeNull()
    })

    it('"Remove shortcut" takes the folder\'s id out of the note — the key with its last entry — and the row goes with the index', async () => {
      const { el, disk, indexSource, props } = await mountLinked([PROJECTS_ID])
      rightClick(shortcutRow(el))
      await act(async () => itemByLabel(el, 'Remove shortcut')?.click())
      expect(disk.get(HEALTH)).toBe('---\n---\nBody\n')
      expect(props.onDeleteEntries).not.toHaveBeenCalled()
      act(() => indexSource.update(() => null, records(), FOLDERS, true))
      expect(shortcutRow(el)).toBeNull()
      expect(row(el, HEALTH)).not.toBeNull() // the note is where it lives
    })

    it('"Remove shortcut" also removes, in that one write, the values of the folders that no longer show the note (D20)', async () => {
      const { el, disk, writeFile } = await mountLinked([PROJECTS_ID])
      disk.set(HEALTH, `---\nalso_in:\n  - ${PROJECTS_ID}\nin:\n  ${PROJECTS_ID}:\n    order: 1\n  n0f01der0000:\n    order: 2\n---\nBody\n`)
      rightClick(shortcutRow(el))
      await act(async () => itemByLabel(el, 'Remove shortcut')?.click())
      expect(disk.get(HEALTH)).toBe('---\nin:\n  n0f01der0000:\n    order: 2\n---\nBody\n') // a folder the app cannot find keeps its block
      expect(writeFile).toHaveBeenCalledTimes(1)
    })

    describe('the app asks before a removal that clears values (D21)', () => {
      const HELD = `---\nalso_in:\n  - ${PROJECTS_ID}\nin:\n  ${PROJECTS_ID}:\n    order: 1\n---\nBody\n`
      /** Health is a shortcut in Projects and, by the window's snapshot, holds values for it. */
      const mountHolding = async () => {
        const mounted = await mountLinked([PROJECTS_ID])
        mounted.disk.set(HEALTH, HELD)
        act(() => mounted.indexSource.update(() => null, records([PROJECTS_ID]).map((r) => (r.path === HEALTH ? { ...r, properties: { ...r.properties, in: { [PROJECTS_ID]: { order: 1 } } } } : r)), FOLDERS, true))
        return mounted
      }
      const askToRemove = async (el: HTMLElement) => {
        rightClick(shortcutRow(el))
        await act(async () => itemByLabel(el, 'Remove shortcut')?.click())
      }

      it('"Remove shortcut", and the note holds values for a folder that will no longer show it: a sheet asks first — Cancel, Remove, the focus on Cancel', async () => {
        const { el, writeFile } = await mountHolding()
        await askToRemove(el)
        expect(el.querySelector('.confirm__text')?.textContent).toBe("Remove the shortcut from 'Projects'? The values of 'Health' for Projects will be cleared.")
        expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Remove'])
        expect(document.activeElement).toBe(sheetBtn(el, 'Cancel'))
        expect(sheetBtn(el, 'Remove')?.classList.contains('confirm__btn--danger')).toBe(true)
        expect(writeFile).not.toHaveBeenCalled()
      })

      it('Cancel: nothing is written, and the shortcut stays', async () => {
        const { el, disk, writeFile } = await mountHolding()
        await askToRemove(el)
        await act(async () => sheetBtn(el, 'Cancel')?.click())
        expect(el.querySelector('.confirm')).toBeNull()
        expect(writeFile).not.toHaveBeenCalled()
        expect(disk.get(HEALTH)).toBe(HELD)
        expect(shortcutRow(el)).not.toBeNull()
      })

      it('Remove: the removal runs as it does today, and the values are cleared in that one write (D20)', async () => {
        const { el, disk, writeFile } = await mountHolding()
        await askToRemove(el)
        expect(writeFile).not.toHaveBeenCalled()
        await act(async () => sheetBtn(el, 'Remove')?.click())
        expect(el.querySelector('.confirm')).toBeNull()
        expect(disk.get(HEALTH)).toBe('---\n---\nBody\n')
        expect(writeFile).toHaveBeenCalledTimes(1)
      })

      it('"Remove shortcut" with no such values: no sheet, as today', async () => {
        const { el, disk, writeFile } = await mountLinked([PROJECTS_ID])
        await askToRemove(el)
        expect(el.querySelector('.confirm')).toBeNull()
        expect(disk.get(HEALTH)).toBe('---\n---\nBody\n')
        expect(writeFile).toHaveBeenCalledTimes(1)
      })
    })

    /** A Cut is a move: pasting one that would clear a folder's values asks first (D21), on the paths main's clipboard holds. */
    describe('Cut, then Paste (D20, D21)', () => {
      const ALPHA = '/v/Projects/Alpha.md'
      const ZETA = '/v/Projects/Zeta.md'
      const SUB = '/v/Projects/Sub'
      const HELD = `---\nin:\n  ${PROJECTS_ID}:\n    order: 1\n---\nBody\n`
      const holding = (r: IndexRecord): IndexRecord => ({ ...r, properties: { in: { [PROJECTS_ID]: { order: 1 } } } })
      /** LINKED, and a folder under Projects holding one note. */
      const WITH_SUB = LINKED.map((node) => (node.path === '/v/Projects' && node.type === 'dir' ? { ...node, children: [{ type: 'dir' as const, name: 'Sub', path: SUB, children: [file(`${SUB}/Deep.md`)] }, ...node.children] } : node))

      /** By the window's snapshot Alpha, Zeta and Sub/Deep hold values for Projects; `paste` plays main's clipboard push — a cut made in ANY window — then Paste on a folder row. */
      const mountCut = async (over: Partial<SidebarProps> = {}) => {
        let pushClip: ((state: FileClipState) => void) | null = null
        const mounted = await mountLinked(undefined, over, (b) => {
          b.tree.mockResolvedValue({ root: '/v', tree: WITH_SUB, generatedAt: 1 })
          b.file.onClipChanged.mockImplementation((listener) => {
            pushClip = pushed(b, listener)
            return () => undefined
          })
        })
        const { el, indexSource } = mounted
        act(() => indexSource.update(() => null, [...records().map((r) => (r.path === ALPHA || r.path === ZETA ? holding(r) : r)), holding(indexRecord(`${SUB}/Deep.md`))], FOLDERS, true))
        const clip = (op: 'copy' | 'cut', ...paths: string[]) => act(() => pushClip?.({ count: paths.length, op, paths }))
        const paste = async (op: 'copy' | 'cut', paths: string[], into = '/v/Areas'): Promise<void> => {
          clip(op, ...paths)
          rightClick(row(el, into))
          await act(async () => itemByLabel(el, paths.length === 1 ? 'Paste 1 item' : `Paste ${paths.length} items`)?.click())
        }
        return { ...mounted, clip, paste }
      }

      it('Cut, then Paste into a folder: the same sheet, before the paste — the cut may be any window’s', async () => {
        const { el, bridge, paste } = await mountCut()
        await paste('cut', [ALPHA])
        expect(sheetText(el)).toBe("Move 'Alpha' to 'Areas'? Its values for Projects will be cleared.")
        expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Move'])
        expect(document.activeElement).toBe(sheetBtn(el, 'Cancel'))
        expect(sheetBtn(el, 'Move')?.classList.contains('confirm__btn--danger')).toBe(true)
        expect(bridge.file.paste).not.toHaveBeenCalled()
        expect(bridge.file.clip).not.toHaveBeenCalled() // this window cut nothing: the paths are main's
        await act(async () => sheetBtn(el, 'Move')?.click())
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/Areas', 'cut', ALPHA))
      })

      it('a note Cut and Pasted into another folder leaves the old folder’s values behind in that move (D20)', async () => {
        const { el, disk, bridge, writeFile, paste, props } = await mountCut()
        disk.set('/v/Areas/Alpha.md', HELD) // where the paste lands it
        bridge.file.paste.mockResolvedValue({ pasted: [{ from: ALPHA, to: '/v/Areas/Alpha.md', kind: 'file' }], failed: [] })
        await paste('cut', [ALPHA])
        expect(writeFile).not.toHaveBeenCalled()
        await act(async () => sheetBtn(el, 'Move')?.click())
        expect(disk.get('/v/Areas/Alpha.md')).toBe('---\n---\nBody\n')
        // The undo list gets the move and the blocks it cleared (YAZ-3255 S39), so an undo can put them back.
        expect(props.onMoved).toHaveBeenCalledExactlyOnceWith({ moves: [{ oldPath: ALPHA, newPath: '/v/Areas/Alpha.md', kind: 'file' }], cleared: [{ path: ALPHA, values: { [PROJECTS_ID]: { order: 1 } } }] }, 'Pasted 1 file (Alpha.md)', false)
      })

      it('YAZ-3266: Move on the sheet pastes the clip the sheet asked about, never what the clipboard holds by then; another clip pushed while it stands closes it, the same one does not', async () => {
        const { el, bridge, clip, paste } = await mountCut()
        await paste('cut', [ALPHA])
        expect(el.querySelector('.confirm')).not.toBeNull()
        // The same clip pushed again (another window's echo): the question stands.
        clip('cut', ALPHA)
        expect(el.querySelector('.confirm')).not.toBeNull()
        // Text copied in a note while the sheet stands: no event, main now answers another clip. Move still names the cut it asked about.
        bridge.file.clipState.mockResolvedValue({ count: 1, op: 'copy', paths: ['/Users/me/Downloads/Note.md'] })
        await act(async () => sheetBtn(el, 'Move')?.click())
        expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/Areas', expect: { op: 'cut', paths: [ALPHA] } })
        // Another clip pushed while a sheet stands ends the question: nothing is pasted.
        await paste('cut', [ALPHA])
        expect(el.querySelector('.confirm')).not.toBeNull()
        clip('copy', '/Users/me/Downloads/Note.md')
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste).toHaveBeenCalledTimes(1)
      })

      it('several items: ONE sheet for all of them', async () => {
        const { el, bridge, paste } = await mountCut()
        await paste('cut', [ALPHA, ZETA, '/v/top.md'])
        expect(el.querySelectorAll('.confirm')).toHaveLength(1)
        expect(sheetText(el)).toBe("Move 3 items to 'Areas'? 2 notes will lose their values for Projects.")
        expect(bridge.file.paste).not.toHaveBeenCalled()
        await act(async () => sheetBtn(el, 'Move')?.click())
        expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/Areas', 'cut', ALPHA, ZETA, '/v/top.md'))
      })

      it('Cancel: nothing is pasted and the cut stays on the clipboard', async () => {
        const { el, bridge, writeFile, paste } = await mountCut()
        await paste('cut', [ALPHA])
        await act(async () => sheetBtn(el, 'Cancel')?.click())
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste).not.toHaveBeenCalled()
        expect(bridge.file.clip).not.toHaveBeenCalled()
        expect(writeFile).not.toHaveBeenCalled()
        rightClick(row(el, '/v/Areas'))
        expect(itemByLabel(el, 'Paste 1 item')?.disabled).toBe(false)
      })

      /**
       * A copy keeps no values for the folders that do not show it, and the app asks first
       * (YAZ-2420 3E1). Main lands the copy under a name of its own; the index has not heard of it
       * when the paste answers, so the tree is what lists it. The original is never written.
       */
      describe('Copy, then Paste (YAZ-2420 3E1)', () => {
        const COPY = '/v/Areas/alpha-copy-n3w1d0000001.md'
        /** The tree once main has copied: `added` stands in the top-level folder `dir`. */
        const landed = (bridge: ReturnType<typeof installBridge>, dir: string, added: TreeNode, to: string, from: string) => {
          bridge.tree.mockResolvedValue({ root: '/v', tree: WITH_SUB.map((node) => (node.path === dir && node.type === 'dir' ? { ...node, children: [...node.children, added] } : node)), generatedAt: 2 })
          bridge.file.paste.mockResolvedValue({ pasted: [{ from, to, kind: added.type }], failed: [] })
        }
        const indexed = (bridge: ReturnType<typeof installBridge>, folders: IndexRecord[] = FOLDERS) => bridge.index.mockResolvedValue({ root: '/v', records: [], folders, generatedAt: 2, ids: true } as never)

        it('a note with values for a folder, copied into another: the sheet asks in the copy wording; Copy pastes, and the copy holds no block for that folder while the original still does', async () => {
          const { el, disk, bridge, writeFile, paste } = await mountCut()
          disk.set(ALPHA, HELD)
          disk.set(COPY, HELD) // as main lands it
          await paste('copy', [ALPHA])
          expect(sheetText(el)).toBe("Copy 'Alpha' to 'Areas'? Its values for Projects will not be copied.")
          expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Copy'])
          expect(document.activeElement).toBe(sheetBtn(el, 'Cancel'))
          expect(bridge.file.paste).not.toHaveBeenCalled()
          landed(bridge, '/v/Areas', file(COPY), COPY, ALPHA)
          indexed(bridge)
          await act(async () => sheetBtn(el, 'Copy')?.click())
          expect(el.querySelector('.confirm')).toBeNull()
          expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/Areas', 'copy', ALPHA))
          expect(disk.get(COPY)).toBe('---\n---\nBody\n')
          expect(disk.get(ALPHA)).toBe(HELD)
          expect(writeFile).toHaveBeenCalledTimes(1)
        })

        it('Cancel: nothing is copied, nothing is written, and the copy stays on the clipboard', async () => {
          const { el, bridge, writeFile, paste } = await mountCut()
          await paste('copy', [ALPHA])
          await act(async () => sheetBtn(el, 'Cancel')?.click())
          expect(el.querySelector('.confirm')).toBeNull()
          expect(bridge.file.paste).not.toHaveBeenCalled()
          expect(writeFile).not.toHaveBeenCalled()
          rightClick(row(el, '/v/Areas'))
          expect(itemByLabel(el, 'Paste 1 item')?.disabled).toBe(false)
        })

        it('a copy into the folder the original is in asks nothing, and the copy, looked at, keeps every block', async () => {
          const SAME = '/v/Projects/alpha-copy-n3w1d0000001.md'
          const { el, disk, bridge, writeFile, paste } = await mountCut()
          disk.set(SAME, HELD)
          landed(bridge, '/v/Projects', file(SAME), SAME, ALPHA)
          indexed(bridge)
          await paste('copy', [ALPHA], '/v/Projects')
          expect(el.querySelector('.confirm')).toBeNull()
          expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/Projects', 'copy', ALPHA))
          expect(bridge.readFile).toHaveBeenCalledWith(SAME)
          expect(disk.get(SAME)).toBe(HELD)
          expect(writeFile).not.toHaveBeenCalled()
        })

        it('a copied folder: its notes keep their values under the copy’s id, and lose the blocks of the folders outside it that no longer show them', async () => {
          const SUB_ID = 's0bf01der000'
          const COPY_ID = 'c0pyf01der00'
          const SUB_COPY = '/v/Areas/sub-copy'
          const DEEP_COPY = `${SUB_COPY}/deep-n3w1d0000002.md`
          const sub: IndexRecord = { ...indexRecord(`${SUB}/.folder.md`), id: SUB_ID, title: 'Sub' }
          const { el, disk, bridge, writeFile, indexSource, paste } = await mountCut()
          // By the window's snapshot Deep holds values for Projects and for Sub, the folder it is in.
          act(() => indexSource.update(() => null, [{ ...indexRecord(`${SUB}/Deep.md`), properties: { in: { [PROJECTS_ID]: { order: 1 }, [SUB_ID]: { order: 2 } } } }], [...FOLDERS, sub], true))
          await paste('copy', [SUB])
          expect(sheetText(el)).toBe("Copy 'Sub' to 'Areas'? 1 note will not keep its values for Projects.")
          // As main lands it: the copy has an id of its own, and its note's values for Sub were carried to it.
          disk.set(DEEP_COPY, `---\nin:\n  ${PROJECTS_ID}:\n    order: 1\n  ${COPY_ID}:\n    order: 2\n---\nBody\n`)
          landed(bridge, '/v/Areas', { type: 'dir', name: 'sub-copy', path: SUB_COPY, children: [file(DEEP_COPY)] }, SUB_COPY, SUB)
          indexed(bridge, [...FOLDERS, sub, { ...indexRecord(`${SUB_COPY}/.folder.md`), id: COPY_ID, title: 'Sub copy' }])
          await act(async () => sheetBtn(el, 'Copy')?.click())
          expect(disk.get(DEEP_COPY)).toBe(`---\nin:\n  ${COPY_ID}:\n    order: 2\n---\nBody\n`)
          expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: DEEP_COPY })) // the original is never written
        })

        it('in a vault that does not use IDs a pasted copy is left as it landed: no sheet, and nothing is read or written after the paste (YAZ-2523 V3)', async () => {
          const PLAIN = '/v/Areas/Alpha copy.md'
          const { el, disk, bridge, writeFile, indexSource, paste } = await mountCut()
          // As such a vault's index hands them out: `in` is a property like any other, and no folder has an id.
          act(() => indexSource.update(() => null, [holding(indexRecord(ALPHA))], [indexRecord('/v/Projects/.folder.md')], false))
          disk.set(PLAIN, HELD)
          landed(bridge, '/v/Areas', file(PLAIN), PLAIN, ALPHA)
          bridge.index.mockClear()
          await paste('copy', [ALPHA])
          expect(el.querySelector('.confirm')).toBeNull()
          expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into('/v/Areas', 'copy', ALPHA))
          expect(bridge.index).not.toHaveBeenCalled()
          expect(bridge.readFile).not.toHaveBeenCalledWith(PLAIN)
          expect(writeFile).not.toHaveBeenCalled()
          expect(disk.get(PLAIN)).toBe(HELD)
        })

        it('nothing to leave behind — a note with no values, a copy from outside this vault — means no sheet: the paste runs at once', async () => {
          const { el, bridge, paste } = await mountCut()
          await paste('copy', ['/v/top.md'])
          await paste('copy', ['/w/Projects/Alpha.md'])
          expect(el.querySelector('.confirm')).toBeNull()
          expect(bridge.file.paste.mock.calls).toEqual([[into('/v/Areas', 'copy', '/v/top.md')], [into('/v/Areas', 'copy', '/w/Projects/Alpha.md')]])
        })
      })

      it('a folder is moved (Cut then Paste) and notes under it would lose values', async () => {
        const { el, bridge, paste } = await mountCut()
        await paste('cut', [SUB])
        expect(sheetText(el)).toBe("Move 'Sub' to 'Areas'? 1 note will lose its values for Projects.")
        expect(bridge.file.paste).not.toHaveBeenCalled()
      })

      it('a cut that clears nothing pastes at once: a note with no values, a move under the same folders, an item already in that folder', async () => {
        const { el, bridge, paste } = await mountCut()
        await paste('cut', ['/v/top.md'])
        await paste('cut', [ALPHA], SUB) // Projects still shows it
        await paste('cut', [ALPHA], '/v/Projects') // where it already is: main skips it, so it is no move
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste.mock.calls).toEqual([[into('/v/Areas', 'cut', '/v/top.md')], [into(SUB, 'cut', ALPHA)], [into('/v/Projects', 'cut', ALPHA)]])
      })

      it('an item already in the folder is not counted among the moves', async () => {
        const { el, paste } = await mountCut()
        await paste('cut', [ALPHA, HEALTH]) // Health lives in Areas
        expect(sheetText(el)).toBe("Move 'Alpha' to 'Areas'? Its values for Projects will be cleared.")
      })

      it('a cut from outside this window’s vault never asks: the index cannot speak for those notes', async () => {
        const { el, bridge, paste } = await mountCut()
        await paste('cut', ['/w/Projects/Alpha.md'])
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste).toHaveBeenCalledTimes(1)
      })

      it('⌘V asks through the same door', async () => {
        const clipboardRef: SidebarProps['clipboardRef'] = { current: null }
        const { el, bridge, clip } = await mountCut({ clipboardRef })
        clip('cut', ALPHA)
        act(() => row(el, '/v/Areas')?.click()) // the selected folder is ⌘V's target
        await act(async () => void clipboardRef.current?.paste())
        expect(sheetText(el)).toBe("Move 'Alpha' to 'Areas'? Its values for Projects will be cleared.")
        expect(bridge.file.paste).not.toHaveBeenCalled()
      })

      it('the clipboard changes under the sheet: the question is dropped, nothing is pasted', async () => {
        const { el, bridge, clip, paste } = await mountCut()
        await paste('cut', [ALPHA])
        clip('copy', ZETA)
        expect(el.querySelector('.confirm')).toBeNull()
        expect(bridge.file.paste).not.toHaveBeenCalled()
      })
    })

    it('a refused removal says so through the notice', async () => {
      const { el, writeFile, props } = await mountLinked([PROJECTS_ID])
      writeFile.mockRejectedValue({ code: 'IO_ERROR', message: 'disk full' })
      rightClick(shortcutRow(el))
      await act(async () => itemByLabel(el, 'Remove shortcut')?.click())
      expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("Can't remove the shortcut: disk full", 'error')
    })

    it('the Favorites tab shows it too, under its favorited folder', async () => {
      const { el } = await mountLinked([PROJECTS_ID], { lens: 'favorites' }, (bridge) => bridge.favorites.get.mockResolvedValue(['/v/Projects']))
      expect(shortcutRow(el)?.querySelector('.shortcut-mark')).not.toBeNull()
      expect(shortcutRow(el)?.draggable).toBe(false)
    })
  })

  describe('"Add note shortcut"', () => {
    it('is a FOLDER row\'s item — not a file row\'s, not blank space\'s, not a 2+ selection\'s', async () => {
      const { el } = await mountLinked()
      rightClick(row(el, '/v/Projects'))
      expect(itemByLabel(el, 'Add note shortcut')).toBeDefined()
      rightClick(row(el, HEALTH))
      expect(itemByLabel(el, 'Add note shortcut')).toBeUndefined()
      rightClick(el.querySelector('.sidebar__body'))
      expect(itemByLabel(el, 'Add note shortcut')).toBeUndefined()
      act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      // The right-click on Health selected it (D9); shift adds the folder: a selection of two.
      act(() => void row(el, '/v/Projects')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
      rightClick(row(el, '/v/Projects'))
      expect(itemByLabel(el, 'Open 2 in new tabs')).toBeDefined()
      expect(itemByLabel(el, 'Add note shortcut')).toBeUndefined()
    })

    it('opens the picker for that folder; ⏎ writes the folder\'s id into the picked note\'s `also_in` and closes it', async () => {
      const { el, disk, writeFile, props } = await mountLinked()
      rightClick(row(el, '/v/Projects'))
      act(() => itemByLabel(el, 'Add note shortcut')?.click())
      // Alpha and Zeta live in Projects: only the notes it does not already show are offered.
      expect([...el.querySelectorAll('.search-results__label')].map((label) => label.textContent)).toEqual(['Health', 'top'])
      await type(picker(el)!, 'hea')
      await act(async () => void picker(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      expect(picker(el)).toBeNull()
      expect(writeFile).toHaveBeenCalledTimes(1)
      expect(disk.get(HEALTH)).toBe(`---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
      expect(props.onNotice).not.toHaveBeenCalled()
    })

    it('Esc closes the picker and writes nothing', async () => {
      const { el, writeFile } = await mountLinked()
      rightClick(row(el, '/v/Projects'))
      act(() => itemByLabel(el, 'Add note shortcut')?.click())
      await act(async () => void picker(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(picker(el)).toBeNull()
      expect(writeFile).not.toHaveBeenCalled()
    })

    it('a write that is refused says so through the notice', async () => {
      const { el, writeFile, props } = await mountLinked()
      writeFile.mockRejectedValue({ code: 'IO_ERROR', message: 'disk full' })
      rightClick(row(el, '/v/Projects'))
      act(() => itemByLabel(el, 'Add note shortcut')?.click())
      await act(async () => void el.querySelector<HTMLElement>('.search-results__row')?.click())
      expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("Can't add the shortcut: disk full", 'error')
    })
  })

  // The ID vault's half is `its menu` and `is a FOLDER row's item`, above.
  it('in a vault that does not use IDs no menu offers a shortcut: a folder row has no "Add note shortcut", and a note whose `also_in` names a folder has no shortcut row to remove (YAZ-2523 V5)', async () => {
    const { el, indexSource } = await mountLinked([PROJECTS_ID])
    // As such a vault's index hands them out: `also_in` is a property like any other, and no folder has an id.
    act(() => indexSource.update(() => null, records([PROJECTS_ID]), [indexRecord('/v/Projects/.folder.md')], false))
    expect(shortcutRow(el)).toBeNull()
    rightClick(row(el, '/v/Projects'))
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(itemByLabel(el, 'Add note shortcut')).toBeUndefined()
    rightClick(row(el, HEALTH))
    expect(itemByLabel(el, 'Delete')).toBeDefined()
    expect(itemByLabel(el, 'Remove shortcut')).toBeUndefined()
  })
})

/**
 * Two or more vaults in one window (YAZ-2602 D2, D3, D7). Each vault is one folder row of the Files
 * tab, in the window's order, with its tree below it; a rule about "the vault of this row" asks the
 * vault that holds the row. A window with one vault has no vault row, and every test above runs on
 * one. A fresh pair of vaults and a fresh window per mount: the app-state cache is module-level.
 */
describe('several vaults in one window (YAZ-2602)', () => {
  let n = 0
  /** This mount's two vaults: `a` is "Notes" — `a/sub/in.md`, `a/a.md` — and `b` is "Work" — `b/docs/d.md`, `b/b.md`. */
  const pair = () => {
    n++
    return { a: `/mv${n}/notes`, b: `/mv${n}/work` }
  }
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const treeOf = (root: string): TreeNode[] =>
    root.endsWith('/notes')
      ? [{ type: 'dir', name: 'sub', path: `${root}/sub`, children: [file(`${root}/sub/in.md`)] }, file(`${root}/a.md`)]
      : [{ type: 'dir', name: 'docs', path: `${root}/docs`, children: [file(`${root}/docs/d.md`)] }, file(`${root}/b.md`)]
  type Bridge = ReturnType<typeof installBridge>
  /** A watcher that counts its subscriptions and the ones that ended, and can speak. */
  const watcher = () => {
    const listeners = new Set<(ev: WatchEvent) => void>()
    const counts = { subscribed: 0, ended: 0 }
    return {
      counts,
      fire: (ev: WatchEvent) => listeners.forEach((l) => l(ev)),
      watch: {
        subscribe: (l: (ev: WatchEvent) => void) => {
          counts.subscribed++
          listeners.add(l)
          return () => {
            counts.ended++
            listeners.delete(l)
          }
        },
      },
    }
  }
  const vault = (root: string, name: string, over: Partial<Vault> = {}): Vault => ({ root, name, watch: { subscribe: () => () => undefined }, index: indexFor(true), upkeep: false, dueCount: 0, reviewing: false, ...over })
  /** Mount a window on this test's vaults, each with its own tree, on a window identity of its own. */
  const mountVaults = async (vaults: Vault[], over: Partial<SidebarProps> = {}, tweak?: (bridge: Bridge) => unknown) =>
    mount({ vaults, ...over }, async (bridge) => {
      bridge.tree.mockImplementation(async (root: string) => ({ root, tree: treeOf(root), generatedAt: 1 }))
      bridge.window.identity.mockResolvedValue({ id: 'w1', root: vaults[0].root, roots: vaults.map((v) => v.root), file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })
      await tweak?.(bridge)
      await storage.init()
    })
  const two = async (over: Partial<SidebarProps> = {}, tweak?: (bridge: Bridge, at: { a: string; b: string }) => unknown) => {
    const at = pair()
    const mounted = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], over, (bridge) => tweak?.(bridge, at))
    return { ...mounted, ...at }
  }
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const isOpen = (el: HTMLElement, path: string) => rowByPath(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const topLabels = (el: HTMLElement) => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((l) => l.textContent)
  const vaultRowLabels = (el: HTMLElement) => [...el.querySelectorAll('.tree__row--vault .tree__label')].map((l) => l.textContent)
  const body = (el: HTMLElement) => el.querySelector<HTMLElement>('.sidebar__body')
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const shiftClick = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const fire = (target: Element | null | undefined, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    act(() => void target?.dispatchEvent(event))
    return event
  }
  const topItems = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu:not(.ctx-menu__sub) > .ctx-menu__group > .ctx-menu__item, .ctx-menu:not(.ctx-menu__sub) > .ctx-menu__group > .ctx-menu__parent > .ctx-menu__item')].map((b) => b.textContent)
  /** Open a parent's flyout and read its leaves (the click is outside any other `act`). */
  const flyout = (el: HTMLElement, parent: string) => {
    act(() => itemByLabel(el, parent)?.click())
    return [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')]
  }
  const clipOf = (op: 'copy' | 'cut', ...paths: string[]): FileClipState => ({ count: paths.length, op, paths })
  /** Captures the clipboard push, so a test can play a Cut or a Copy. */
  const clipboard = (bridge: Bridge) => {
    const held: { push: ((state: FileClipState) => void) | null } = { push: null }
    bridge.file.onClipChanged.mockImplementation((listener) => {
      held.push = pushed(bridge, listener)
      return () => undefined
    })
    return held
  }
  const setFolderCalls = (bridge: Bridge) => bridge.state.setFolder.mock.calls as unknown as [string, { expanded?: string[] }][]
  /** Every row on screen, by its path, top to bottom. */
  const allRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row')].map((row) => row.dataset.path)
  /** The vault a top row of the Focus tab is tagged with (A4); null for a row with no tag. */
  const tag = (el: HTMLElement, path: string) => rowByPath(el, path)?.querySelector('.tree__vault')?.textContent ?? null
  /** The line above the Focus tab's list: "N in focus", or null when it is not drawn. */
  const countLine = (el: HTMLElement) => el.querySelector('.sidebar__focus-bar span')?.textContent ?? null
  /** The focus items of the open menu: none, or the one toggle. */
  const focusItems = (el: HTMLElement) => topItems(el).filter((label) => label?.endsWith('focus'))
  /**
   * The focus lists as the vaults hold them (YAZ-2702): each path is in the list of the vault that
   * holds it, in the order given. The same order is this Mac's order across vaults (`focusOrder`,
   * Decision 3), so the tab shows the paths as they are given here.
   */
  const withFocus = (...paths: string[]) => async (bridge: Bridge) => {
    bridge.focus.get.mockImplementation(async (root: string) => paths.filter((path) => path.startsWith(`${root}/`)))
    const state = await bridge.state.get()
    bridge.state.get.mockResolvedValue({ ...state, focusOrder: paths })
  }
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const choose = (el: HTMLElement, label: string) => act(async () => itemByLabel(el, label)?.click())
  /** jsdom has no DragEvent: a MouseEvent with the row's edge in `clientY` (the zero rect reads `< 0` as "before"). */
  const drag = (target: Element | null | undefined, type: string, clientY = 0) => act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
  const marker = (el: HTMLElement) => el.querySelector('.tree__row--drop-before, .tree__row--drop-after, .tree__row--drop')
  /** Each vault's own `favorites.json`, by its root and read as it stands, and main's push that one changed. */
  const favoritesOf = (bridge: Bridge, lists: Record<string, string[]>) => {
    const held: { emit: ((change: { root: string }) => void) | null } = { emit: null }
    bridge.favorites.get.mockImplementation(async (root: string) => lists[root] ?? [])
    bridge.favorites.onChanged.mockImplementation((listener) => {
      held.emit = listener
      return () => undefined
    })
    return held
  }
  const inboxes = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__inbox')]

  it('one vault: no vault row, and blank space gains "Add vault to this window ▸" — the known vaults that are not in the window, in the list\'s order, then "Open folder…" (S1 to S3, S11, S51)', async () => {
    const { el, props } = await mount()
    vi.spyOn(storage, 'listVaults').mockReturnValue([
      { path: '/v', name: 'v', key: null, open: true, lastUsed: 3 },
      { path: '/k/two', name: 'Second', key: null, open: false, lastUsed: 2 },
      { path: '/k/one', name: 'First', key: 1, open: true, lastUsed: null },
    ])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect(topLabels(el)).toEqual(['sub', 'a'])
    for (const row of ['.tree__row--dir', '.tree__row--file']) {
      rightClick(el.querySelector(row))
      expect(itemByLabel(el, 'Remove from this window')).toBeUndefined()
      expect(itemByLabel(el, 'Add vault to this window')).toBeUndefined()
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    }
    rightClick(body(el))
    expect(topItems(el)).toEqual(['Paste', 'Copy path', 'New note', 'New drawing', 'New folder', 'Open in', 'Add vault to this window'])
    const leaves = flyout(el, 'Add vault to this window')
    expect(leaves.map((b) => b.textContent)).toEqual(['Second', 'First', 'Open folder…'])
    act(() => leaves[1].click())
    expect(props.onAddVault).toHaveBeenCalledExactlyOnceWith('/k/one')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(body(el))
    const pick = flyout(el, 'Add vault to this window').at(-1)
    act(() => pick?.click())
    expect(props.onPickVault).toHaveBeenCalledTimes(1)
    expect(props.onAddVault).toHaveBeenCalledTimes(1)
  })

  it('two vaults: one top row per vault, in the order added, named as the app names the vault, each open with its tree below it (S12)', async () => {
    const { el, a, b, bridge } = await two()
    expect(topLabels(el)).toEqual(['Notes', 'Work'])
    expect(vaultRowLabels(el)).toEqual(['Notes', 'Work'])
    expect([isOpen(el, a), isOpen(el, b)]).toEqual(['true', 'true'])
    // Each vault's own tree, one level in: its folders closed, its files shown.
    expect([...el.querySelectorAll<HTMLElement>('.tree__row')].map((row) => row.dataset.path)).toEqual([a, `${a}/sub`, `${a}/a.md`, b, `${b}/docs`, `${b}/b.md`])
    expect(rowByPath(el, `${a}/a.md`)?.style.paddingLeft).toBe('36px')
    expect(bridge.tree.mock.calls.map(([root]) => root).sort()).toEqual([a, b])
    expect(el.querySelector('.sidebar__msg')).toBeNull()
  })

  it('a vault row closes and opens through App, for the session: nothing goes to the store; it is no page, so no gesture opens it as a tab (R9)', async () => {
    const { el, b, props, bridge, rerender } = await two()
    bridge.state.setFolder.mockClear()
    bridge.window.setIdentity.mockClear()
    act(() => rowByPath(el, b)?.click())
    expect(props.onSetVaultOpen).toHaveBeenCalledExactlyOnceWith(b, false)
    expect(rowByPath(el, b)?.classList.contains('tree__row--selected')).toBe(true)
    await rerender({ closedVaults: [b] })
    expect(isOpen(el, b)).toBe('false')
    expect(rowByPath(el, `${b}/b.md`)).toBeNull()
    expect(rowByPath(el, `${b.replace('/work', '/notes')}/a.md`)).not.toBeNull()
    act(() => rowByPath(el, b)?.click())
    expect(props.onSetVaultOpen).toHaveBeenLastCalledWith(b, true)
    act(() => void rowByPath(el, b)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    act(() => void rowByPath(el, b)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(rowByPath(el, b)?.draggable).toBe(true) // to reorder the vaults (YAZ-2631 D5)
  })

  it('the vault row\'s menu: Paste, Copy path · the three create rows (YAZ-3085) · Open in (VS Code, Reveal in Finder) · Remove from this window — and nothing else: a vault is no item of the focus list (S13, A2)', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el, b, props } = await two({ upkeep: true })
    rightClick(rowByPath(el, b))
    expect(topItems(el)).toEqual(['Paste', 'Copy path', 'New note', 'New drawing', 'New folder', 'Open by itself', 'Open in', 'Remove from this window'])
    expect(flyout(el, 'Open in').map((item) => item.textContent)).toEqual(['VS Code', 'Reveal in Finder'])
    await act(async () => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith(b)
    rightClick(rowByPath(el, b))
    act(() => itemByLabel(el, 'Remove from this window')?.click())
    expect(props.onRemoveVault).toHaveBeenCalledExactlyOnceWith(b)
  })

  it('"Open by itself" on a vault row (YAZ-2858 D4, S15) calls main\'s window.openAlone with that vault\'s root, and a failure is logged; a file row, a folder row and blank space have no such item (S16)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { el, a, b, bridge } = await two()
    rightClick(rowByPath(el, b))
    act(() => itemByLabel(el, 'Open by itself')?.click())
    expect(bridge.window.openAlone).toHaveBeenCalledExactlyOnceWith(b)
    expect(bridge.window.open).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    bridge.window.openAlone.mockRejectedValueOnce(new Error('ipc down'))
    rightClick(rowByPath(el, a))
    await act(async () => itemByLabel(el, 'Open by itself')?.click())
    expect(bridge.window.openAlone).toHaveBeenLastCalledWith(a)
    expect(error).toHaveBeenCalledWith('[sidebar] window.openAlone failed:', expect.any(Error))
    for (const target of [rowByPath(el, `${a}/a.md`), rowByPath(el, `${a}/sub`), body(el)]) {
      rightClick(target)
      expect(itemByLabel(el, 'Open by itself')).toBeUndefined()
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    }
    error.mockRestore()
  })

  it('"New note" on a vault row creates in that vault\'s root, as that vault makes a note, and opens the row if it was closed (S13, R4)', async () => {
    const at = pair()
    const { el, props, bridge } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work', { index: indexFor(false) })], { closedVaults: [at.b] })
    rightClick(rowByPath(el, at.b))
    act(() => itemByLabel(el, 'New note')?.click())
    expect(props.onSetVaultOpen).toHaveBeenCalledExactlyOnceWith(at.b, true)
    await act(async () => root?.render(<StrictMode><WithPreview {...props} closedVaults={[]} /></StrictMode>))
    const field = el.querySelector<HTMLInputElement>('.create-inline__input')!
    // The input stands at the head of the vault's own tree, under its row.
    expect(field.closest('ul.tree')?.parentElement?.querySelector(':scope > .tree__row')).toBe(rowByPath(el, at.b))
    await act(async () => {
      field.value = 'Growth'
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    // `b` does not use IDs (YAZ-2523 🔒 V3): the name typed is the file's name, and `a`'s answer is not asked.
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: `${at.b}/Growth.md`, content: '' })
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${at.b}/Growth.md`)
  })

  it('blank space with two or more vaults offers only "Add vault to this window"; ⌘V with no selection pastes nothing and says what to select, and with a vault row selected pastes into that vault (S10)', async () => {
    const clipboardRef = { current: null as SidebarClipboard | null }
    let held: ReturnType<typeof clipboard> | undefined
    const { el, b, props, bridge } = await two({ clipboardRef }, (bridge) => void (held = clipboard(bridge)))
    rightClick(body(el))
    expect(topItems(el)).toEqual(['Add vault to this window'])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    act(() => held?.push?.(clipOf('copy', '/elsewhere/x.md')))
    expect(clipboardRef.current?.paste()).toBe(true)
    expect(bridge.file.paste).not.toHaveBeenCalled()
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Select a vault or a folder first')

    shiftClick(rowByPath(el, b))
    // A vault is not a file to clip: ⌘C is not the panel's key while the selection holds one (S18).
    expect(clipboardRef.current?.cutOrCopy('copy')).toBe(false)
    expect(bridge.file.clip).not.toHaveBeenCalled()
    await act(async () => void clipboardRef.current?.paste())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into(b, 'copy', '/elsewhere/x.md'))
  })

  it('a vault is no file: with a vault row in the selection ⌘⌫ deletes nothing and the menu offers no Delete; rows of two vaults delete together (YAZ-3272 S72, D21)', async () => {
    const clipboardRef = { current: null as SidebarClipboard | null }
    const { el, a, b, props } = await two({ clipboardRef })
    shiftClick(rowByPath(el, `${a}/a.md`))
    shiftClick(rowByPath(el, b))
    expect(clipboardRef.current?.delete()).toBe(false)
    rightClick(rowByPath(el, `${a}/a.md`))
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
    expect(itemByLabel(el, 'Delete 1 folder and 1 file')).toBeUndefined()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    shiftClick(rowByPath(el, b)) // out of the selection again
    shiftClick(rowByPath(el, `${b}/b.md`))
    act(() => void clipboardRef.current?.delete())
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((btn) => btn.textContent === 'Delete')?.click())
    expect(props.onDeleteEntries).toHaveBeenCalledExactlyOnceWith([`${a}/a.md`, `${b}/b.md`])
  })

  it('a file dropped on its own vault\'s row moves to that vault\'s root — the row shows the fill of a drop folder, never the line of a reorder; a drop on a folder or the row of a different vault is refused with a notice; no drop of a file reorders the vaults; the header is no drop target (S14, S45, R11; YAZ-2631 S50)', async () => {
    const { el, a, b, props } = await two()
    act(() => rowByPath(el, `${a}/sub`)?.click())
    const inner = `${a}/sub/in.md`
    fire(rowByPath(el, inner), 'dragstart')
    fire(rowByPath(el, a), 'dragover')
    expect(rowByPath(el, a)?.classList.contains('tree__row--drop')).toBe(true)
    expect(el.querySelector('.tree__row--drop-before, .tree__row--drop-after')).toBeNull()
    fire(rowByPath(el, a), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith(inner, `${a}/in.md`, 'file')

    for (const target of [`${b}/docs`, b]) {
      fire(rowByPath(el, inner), 'dragstart')
      fire(rowByPath(el, target), 'drop')
      expect(props.onNotice).toHaveBeenLastCalledWith('To move between vaults, use cut and paste')
    }
    expect(props.onNotice).toHaveBeenCalledTimes(2)
    expect(props.onRenameFile).toHaveBeenCalledTimes(1)
    expect(props.onReorderVaults).not.toHaveBeenCalled()

    const header = el.querySelector<HTMLElement>('.sidebar__header')
    fire(rowByPath(el, inner), 'dragstart')
    expect(fire(header, 'dragover').defaultPrevented).toBe(false)
    expect(header?.classList.contains('sidebar__header--drop')).toBe(false)
    // Hovering the FIRST vault's own row lights that row alone: its path is the header's old target.
    fire(rowByPath(el, a), 'dragover')
    expect(header?.classList.contains('sidebar__header--drop')).toBe(false)
    fire(header, 'drop')
    expect(props.onRenameFile).toHaveBeenCalledTimes(1)
  })

  it('a vault row in the selection never moves on disk (S8): the drag of a selected file leaves it out, and a drag of the vault row is its reorder, never the OS drag; Finder items dropped on a vault row go to that vault\u2019s root (audit 10)', async () => {
    const { el, a, b, bridge } = await two()
    shiftClick(rowByPath(el, b))
    shiftClick(rowByPath(el, `${a}/a.md`))
    expect(fire(rowByPath(el, `${a}/a.md`), 'dragstart').defaultPrevented).toBe(true)
    expect(bridge.file.dragOut).toHaveBeenCalledExactlyOnceWith({ paths: [`${a}/a.md`], icon: expect.any(String) })
    expect(fire(rowByPath(el, b), 'dragstart').defaultPrevented).toBe(false)
    expect(bridge.file.dragOut).toHaveBeenCalledOnce()
    fire(rowByPath(el, b), 'dragend')

    bridge.file.import.mockResolvedValueOnce({ moved: [], copied: [], failed: [] })
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['x'], 'Plan.md')], dropEffect: 'none' } })
    act(() => void rowByPath(el, b)?.dispatchEvent(drop))
    await act(async () => {})
    expect(bridge.file.import).toHaveBeenCalledExactlyOnceWith({ paths: ['/Users/yasin/Downloads/Plan.md'], targetDir: b })
  })

  it('a Copy made in one vault pastes into a folder of the other, judged by the vault it lands in — as a paste from another window is (S46)', async () => {
    let held: ReturnType<typeof clipboard> | undefined
    const { el, a, b, props, bridge } = await two({}, (bridge) => void (held = clipboard(bridge)))
    rightClick(rowByPath(el, `${a}/a.md`))
    await act(async () => itemByLabel(el, 'Copy')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: [`${a}/a.md`], op: 'copy' })
    act(() => held?.push?.(clipOf('copy', `${a}/a.md`)))

    bridge.file.paste.mockResolvedValueOnce({ pasted: [{ from: `${a}/a.md`, to: `${b}/docs/a.md`, kind: 'file' }], failed: [] })
    bridge.tree.mockClear()
    bridge.index.mockClear()
    rightClick(rowByPath(el, `${b}/docs`))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into(`${b}/docs`, 'copy', `${a}/a.md`))
    expect(props.onNotice).toHaveBeenLastCalledWith('Pasted 1 file (a.md)', 'paste', 'clipboard')
    // The folder it landed in opens, and the tree and the index read are the target vault's alone.
    expect(isOpen(el, `${b}/docs`)).toBe('true')
    expect(bridge.tree.mock.calls.every(([root]) => root === b)).toBe(true)
    expect(bridge.index.mock.calls).toEqual([[b]])
  })

  it('a Cut made in one vault pastes into the other vault\'s row: the move is main\'s, to that vault\'s root (S46)', async () => {
    let held: ReturnType<typeof clipboard> | undefined
    const { el, a, b, props, bridge } = await two({}, (bridge) => void (held = clipboard(bridge)))
    act(() => held?.push?.(clipOf('cut', `${a}/a.md`)))
    bridge.file.paste.mockResolvedValueOnce({ pasted: [{ from: `${a}/a.md`, to: `${b}/a.md`, kind: 'file' }], failed: [] })
    rightClick(rowByPath(el, b))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith(into(b, 'cut', `${a}/a.md`))
    expect(props.onMoved).toHaveBeenLastCalledWith({ moves: [{ oldPath: `${a}/a.md`, newPath: `${b}/a.md`, kind: 'file' }], cleared: [] }, 'Pasted 1 file (a.md)', false)
    expect(el.querySelector('.confirm')).toBeNull()
  })

  /** App's list of closed vault rows, as it follows `onSetVaultOpen` (R9): a test hands `closed()` back down, as App does. */
  const vaultDoors = () => {
    let closed: string[] = []
    const onSetVaultOpen = vi.fn((root: string, open: boolean) => void (closed = open ? closed.filter((v) => v !== root) : closed.includes(root) ? closed : [...closed, root]))
    return { onSetVaultOpen, closed: () => closed }
  }
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__expand-all')
  const allLabel = (el: HTMLElement) => allButton(el)?.getAttribute('aria-label') ?? null

  it('YAZ-2631 S56, S57, S58, S62: on Files with two vaults "Collapse all" closes each folder and each vault row, and "Expand all" opens them all; one open vault row is enough for "Collapse all"; each vault\'s open folders are stored under that vault, and a vault row is never stored as an open folder', async () => {
    const doors = vaultDoors()
    const { el, a, b, bridge, rerender } = await two({ onSetVaultOpen: doors.onSetVaultOpen })
    const press = async () => {
      act(() => allButton(el)?.click())
      await rerender({ closedVaults: doors.closed() })
    }
    // S56: the vault rows are open, with no folder open below them.
    expect(allLabel(el)).toBe('Collapse all')
    act(() => rowByPath(el, `${a}/sub`)?.click())
    act(() => rowByPath(el, `${b}/docs`)?.click())
    await press()
    expect(doors.onSetVaultOpen.mock.calls).toEqual([[a, false], [b, false]])
    expect([isOpen(el, a), isOpen(el, b)]).toEqual(['false', 'false'])
    expect(allRows(el)).toEqual([a, b])
    expect(allLabel(el)).toBe('Expand all')

    // S58: one vault row opened by a click. Its folders stay closed, and the button closes again.
    act(() => rowByPath(el, a)?.click())
    await rerender({ closedVaults: doors.closed() })
    expect([isOpen(el, a), isOpen(el, `${a}/sub`), isOpen(el, b)]).toEqual(['true', 'false', 'false'])
    expect(allLabel(el)).toBe('Collapse all')
    await press()
    expect(doors.closed()).toEqual([b, a])
    expect(allLabel(el)).toBe('Expand all')

    // S57: all closed. One click opens each vault row and each folder.
    await press()
    expect(doors.closed()).toEqual([])
    expect([a, `${a}/sub`, b, `${b}/docs`].map((row) => isOpen(el, row))).toEqual(['true', 'true', 'true', 'true'])
    expect(allLabel(el)).toBe('Collapse all')

    // S62: the store holds folders only, each under its own vault.
    const stored = setFolderCalls(bridge).filter(([, patch]) => patch.expanded !== undefined)
    expect(stored).toEqual([[a, { expanded: [`${a}/sub`] }], [b, { expanded: [`${b}/docs`] }], [a, { expanded: [] }], [b, { expanded: [] }], [a, { expanded: [`${a}/sub`] }], [b, { expanded: [`${b}/docs`] }]])
  })

  it('YAZ-2631 S59, S60: two vaults with no folder in either still show the button on Files, for the vault rows alone, and not on Focus or Favorites; on those tabs the button moves that tab\'s folders and leaves the vault rows as they were', async () => {
    const doors = vaultDoors()
    const flat = pair()
    const bare = await mountVaults([vault(flat.a, 'Notes'), vault(flat.b, 'Work')], { onSetVaultOpen: doors.onSetVaultOpen }, (bridge) => void bridge.tree.mockImplementation(async (root: string) => ({ root, tree: [file(`${root}/x.md`)], generatedAt: 1 })))
    expect(allLabel(bare.el)).toBe('Collapse all')
    act(() => allButton(bare.el)?.click())
    expect(doors.closed()).toEqual([flat.a, flat.b])
    await bare.rerender({ closedVaults: doors.closed() })
    expect(allRows(bare.el)).toEqual([flat.a, flat.b])
    expect(allLabel(bare.el)).toBe('Expand all')
    for (const lens of ['focus', 'favorites'] as const) {
      await bare.rerender({ closedVaults: doors.closed(), lens })
      expect(allButton(bare.el), lens).toBeNull()
    }
    act(() => root?.unmount())
    container?.remove()

    for (const lens of ['focus', 'favorites'] as const) {
      const at = pair()
      const { el, props } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { lens, closedVaults: [at.b] }, async (bridge) => {
        await withFocus(`${at.a}/sub`, `${at.b}/docs`)(bridge)
        favoritesOf(bridge, { [at.a]: [`${at.a}/sub`], [at.b]: [`${at.b}/docs`] })
      })
      // A vault row closed on Files does not count here: the tab's own folders are closed.
      expect(allLabel(el), lens).toBe('Expand all')
      act(() => allButton(el)?.click())
      expect(allRows(el), lens).toEqual([`${at.a}/sub`, `${at.a}/sub/in.md`, `${at.b}/docs`, `${at.b}/docs/d.md`])
      expect(allLabel(el), lens).toBe('Collapse all')
      act(() => allButton(el)?.click())
      expect(allRows(el), lens).toEqual([`${at.a}/sub`, `${at.b}/docs`])
      expect(props.onSetVaultOpen, lens).not.toHaveBeenCalled()
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('YAZ-2631 S45, S51, S52: on Files with two or more vaults a vault row drags over the top half or the bottom half of a different vault row — a line on that edge — and the drop hands App the vaults in the new order; a drop where the row stands asks nothing; no row below a vault row reorders, and a vault row finds no place on one; the vault rows of the search tree do not reorder', async () => {
    const at = pair()
    const plain = at.b.replace('/work', '/plain')
    const { el, props } = await mountVaults([vault(at.a, 'Notes'), vault(plain, 'Plain'), vault(at.b, 'Work')])
    // A folder below a vault row drags to move on disk (YAZ-3251 D5), never to reorder.
    expect([at.a, plain, at.b, `${at.a}/sub`].map((row) => rowByPath(el, row)?.draggable)).toEqual([true, true, true, true])
    const dragTo = (from: string, to: string, edge: 'before' | 'after') => {
      drag(rowByPath(el, from), 'dragstart')
      drag(rowByPath(el, to), 'dragover', edge === 'before' ? -1 : 1)
      expect(marker(el)).toBe(rowByPath(el, to))
      expect(rowByPath(el, to)?.classList.contains(`tree__row--drop-${edge}`)).toBe(true)
      drag(rowByPath(el, to), 'drop')
      expect(marker(el)).toBeNull()
    }
    dragTo(at.b, at.a, 'before')
    expect(props.onReorderVaults).toHaveBeenLastCalledWith([at.b, at.a, plain])
    dragTo(at.a, plain, 'after')
    expect(props.onReorderVaults).toHaveBeenLastCalledWith([plain, at.a, at.b])
    // The row already stands there: the order is the same, so App is asked nothing.
    dragTo(plain, at.a, 'after')
    dragTo(plain, at.b, 'before')
    expect(props.onReorderVaults).toHaveBeenCalledTimes(2)

    // S51: a folder and a file inside a vault are no place for a vault row.
    drag(rowByPath(el, at.b), 'dragstart')
    for (const deeper of [`${at.a}/sub`, `${at.a}/a.md`]) {
      drag(rowByPath(el, deeper), 'dragover', -1)
      expect(marker(el), deeper).toBeNull()
      drag(rowByPath(el, deeper), 'drop')
    }
    drag(rowByPath(el, at.b), 'dragend')
    expect(props.onReorderVaults).toHaveBeenCalledTimes(2)
    expect(props.onRenameFile).not.toHaveBeenCalled()
    expect(props.onNotice).not.toHaveBeenCalled()
    act(() => root?.unmount())
    container?.remove()

    // S52: the cut tree of a search draws the vault rows, and none of them drags.
    const found = await searchTwo()
    await type(found.input, 'plan')
    expect([found.a, found.b].map((row) => rowByPath(found.el, row)?.draggable)).toEqual([false, false])
    drag(rowByPath(found.el, found.b), 'dragstart')
    drag(rowByPath(found.el, found.a), 'dragover', -1)
    expect(marker(found.el)).toBeNull()
    drag(rowByPath(found.el, found.a), 'drop')
    expect(found.props.onReorderVaults).not.toHaveBeenCalled()
  })

  it('YAZ-2631 S47, S53, S55: the vaults in a new order, as App hands them after a drag — the vault rows and the header follow, and the panel reads nothing again: no tree, no favorites file, no watcher, no write; its open folders and its selection stay; with no stored order the Favorites tab follows the vault order, and the Focus tab keeps its own', async () => {
    const at = pair()
    const [first, second] = [watcher(), watcher()]
    const [notes, work] = [vault(at.a, 'Notes', { watch: first.watch }), vault(at.b, 'Work', { watch: second.watch })]
    const [sub, aMd, bMd] = [`${at.a}/sub`, `${at.a}/a.md`, `${at.b}/b.md`]
    const { el, bridge, rerender } = await mountVaults([notes, work], { lens: 'favorites' }, async (bridge) => {
      await withFocus(bMd, sub)(bridge)
      favoritesOf(bridge, { [at.a]: [aMd], [at.b]: [bMd] })
    })
    expect(topLabels(el)).toEqual(['a', 'b'])
    await rerender({ lens: 'focus' })
    expect(topLabels(el)).toEqual(['b', 'sub'])
    await rerender({ lens: 'files' })
    act(() => rowByPath(el, sub)?.click())
    shiftClick(rowByPath(el, bMd))
    const header = () => el.querySelector('.sidebar__root-name')?.textContent
    const selected = () => [...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((row) => row.dataset.path)
    expect([vaultRowLabels(el), header(), selected()]).toEqual([['Notes', 'Work'], 'notes + work', [sub, bMd]])
    const quiet = [bridge.tree, bridge.index, bridge.favorites.get, bridge.favorites.set, bridge.focus.get, bridge.focus.set, bridge.state.setFavoritesOrder, bridge.state.setFocusOrder, bridge.state.setFolder, bridge.window.setIdentity]
    for (const spy of quiet) spy.mockClear()
    const watched = JSON.stringify([first.counts, second.counts])

    await rerender({ lens: 'files', vaults: [work, notes] })
    expect([vaultRowLabels(el), header(), selected()]).toEqual([['Work', 'Notes'], 'work + notes', [bMd, sub]])
    expect(isOpen(el, sub)).toBe('true')
    await rerender({ lens: 'favorites', vaults: [work, notes] })
    expect(topLabels(el)).toEqual(['b', 'a'])
    await rerender({ lens: 'focus', vaults: [work, notes] })
    expect(topLabels(el)).toEqual(['b', 'sub'])
    for (const spy of quiet) expect(spy).not.toHaveBeenCalled()
    expect(JSON.stringify([first.counts, second.counts])).toBe(watched)
  })

  it('"Show in sidebar" for a file of a vault whose row is closed opens the row, then that vault\'s folders, and flashes the row (S17)', async () => {
    const at = pair()
    const target = `${at.b}/docs/d.md`
    const { el, props, rerender } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { closedVaults: [at.b], revealRequest: { id: 1, path: target } })
    expect(props.onSetVaultOpen).toHaveBeenCalledWith(at.b, true)
    expect(props.onNotice).not.toHaveBeenCalled()
    expect(rowByPath(el, target)).toBeNull()
    await rerender({ closedVaults: [], revealRequest: { id: 1, path: target } })
    expect(isOpen(el, `${at.b}/docs`)).toBe('true')
    expect(isOpen(el, `${at.a}/sub`)).toBe('false')
    expect(rowByPath(el, target)?.classList.contains('tree__row--revealed')).toBe(true)
  })

  it('Enter on a folder of a vault whose row is closed (YAZ-2662 S9): the vault row opens, then the folder is open, flashes and has the keyboard focus', async () => {
    const at = pair()
    const target = `${at.b}/docs`
    const { el, props, rerender } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { closedVaults: [at.b], revealRequest: { id: 1, path: target, focus: true } })
    expect(props.onSetVaultOpen).toHaveBeenCalledWith(at.b, true)
    expect(rowByPath(el, target)).toBeNull()
    await rerender({ closedVaults: [], revealRequest: { id: 1, path: target, focus: true } })
    expect([isOpen(el, target), rowByPath(el, target)?.classList.contains('tree__row--revealed'), document.activeElement === rowByPath(el, target)]).toEqual(['true', true, true])
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a selection holds rows of two vaults; with a vault row in it no plural item is offered, on any of its rows (S18, A3)', async () => {
    const { el, a, b } = await two()
    shiftClick(rowByPath(el, `${a}/sub`))
    shiftClick(rowByPath(el, b))
    shiftClick(rowByPath(el, `${b}/b.md`))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(3)
    for (const row of [b, `${a}/sub`, `${b}/b.md`]) {
      rightClick(rowByPath(el, row))
      const labels = topItems(el)
      expect(labels.filter((label) => /\d/.test(label ?? ''))).toEqual([])
      expect(focusItems(el)).toEqual([])
      for (const hidden of ['Cut', 'Copy', 'Add to favorites', 'Remove from favorites']) expect(labels).not.toContain(hidden)
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    }
    // Without the vault row the same two vaults give the plural items back.
    shiftClick(rowByPath(el, b))
    rightClick(rowByPath(el, `${b}/b.md`))
    expect(topItems(el)).toEqual(expect.arrayContaining(['Open 2 in new tabs', 'Add 2 to focus', 'Cut 1 folder and 1 file', 'Copy 1 folder and 1 file', 'Copy 2 paths', 'Add 2 to favorites']))
  })

  it('a row is its own vault\'s: "Open in ▸ New window" opens that vault alone, and the delete count comes from that vault\'s index (S33)', async () => {
    const { el, bridge, ...at } = await two()
    rightClick(rowByPath(el, `${at.b}/b.md`))
    const newWindow = flyout(el, 'Open in').find((item) => item.textContent === 'New window')
    act(() => newWindow?.click())
    expect(bridge.window.open).toHaveBeenCalledExactlyOnceWith({ root: at.b, file: `${at.b}/b.md` })
    bridge.index.mockClear()
    rightClick(rowByPath(el, `${at.b}/b.md`))
    await act(async () => itemByLabel(el, 'Delete')?.click())
    expect(el.querySelector('.confirm')).not.toBeNull()
    expect(bridge.index.mock.calls).toEqual([[at.b]])
  })

  it('an index snapshot of one vault reads the shortcuts of that vault alone (S30)', async () => {
    const at = pair()
    const [notes, work] = [createWikilinkResolveSource(), createWikilinkResolveSource()]
    notes.update(() => null, [{ ...indexRecord(`${at.a}/sub/in.md`), folder: 'sub' }])
    work.update(() => null, [{ ...indexRecord(`${at.b}/docs/d.md`), folder: 'docs' }])
    await mountVaults([vault(at.a, 'Notes', { index: notes }), vault(at.b, 'Work', { index: work })])
    shortcutBuilds.roots.length = 0
    // A save in "Work": its index hands a new snapshot, and "Notes" still holds the one it had.
    act(() => work.update(() => null, [{ ...indexRecord(`${at.b}/docs/d.md`), folder: 'docs' }, { ...indexRecord(`${at.b}/docs/e.md`), folder: 'docs' }]))
    expect(new Set(shortcutBuilds.roots)).toEqual(new Set([at.b]))
  })

  it('no folder row shows a number, on Files, Focus, Favorites and in the search tree, with one vault and with two; the Inbox row keeps its due number and the Focus tab its "N in focus" line (YAZ-2631 S21 to S23)', async () => {
    for (const size of [1, 2]) {
      const at = pair()
      const roots = [at.a, at.b].slice(0, size)
      const dirs = [`${at.a}/sub`, `${at.b}/docs`].slice(0, size)
      // Each folder holds a note that its vault's index knows.
      const records = [{ ...indexRecord(`${at.a}/sub/in.md`), folder: 'sub' }, { ...indexRecord(`${at.b}/docs/d.md`), folder: 'docs' }]
      const vaults = roots.map((root, i) => {
        const index = createWikilinkResolveSource()
        index.update(() => null, [records[i]])
        return vault(root, i === 0 ? 'Notes' : 'Work', { index })
      })
      const { el, rerender } = await mountVaults(vaults, { upkeep: true, dueCount: 3 }, async (bridge) => {
        favoritesOf(bridge, Object.fromEntries(roots.map((root, i) => [root, [dirs[i]]])))
        bridge.index.mockImplementation(async (root: string) => ({ root, records: [records[roots.indexOf(root)]], folders: [], generatedAt: 1, ids: true }))
        await withFocus(...dirs)(bridge)
      })
      /** Every number at a row's right edge: the row it stands on, and what it reads. */
      const numbers = () => [...el.querySelectorAll('.tree__count')].map((number) => [number.parentElement?.className, number.textContent])
      const inboxOnly = roots.map(() => ['sidebar__inbox', '3'])
      for (const lens of ['files', 'focus', 'favorites'] as const) {
        await rerender({ lens })
        for (const dir of dirs) expect(rowByPath(el, dir), `${lens}: ${dir}`).not.toBeNull()
        expect(numbers(), lens).toEqual(inboxOnly)
      }
      await rerender({ lens: 'focus' })
      expect(countLine(el)).toBe(`${size} in focus`)
      await type(searchInput(el)!, 's')
      for (const dir of dirs) expect(el.querySelector(`.sidebar__body .tree__row--dir[data-path="${dir}"]`), `search: ${dir}`).not.toBeNull()
      expect(numbers(), 'search').toEqual(inboxOnly)
    }
  })

  it('a vault that joins does not remount the panel or read the first vault again, and its first tree is the walk App just made; a vault that leaves ends its watcher subscription', async () => {
    const at = pair()
    const first = watcher()
    const second = watcher()
    const { fetchTree } = await import('../lib/treeFeed')
    vi.spyOn(storage, 'getExpanded').mockImplementation((root) => (root === at.b ? [`${at.b}/docs`] : []))
    const { el, bridge, rerender } = await mountVaults([vault(at.a, 'Notes', { watch: first.watch })])
    const [aside, search] = [el.querySelector('aside'), el.querySelector('.sidebar__lenses')]
    expect(topLabels(el)).toEqual(['sub', 'a'])
    const asked = () => ({ trees: bridge.tree.mock.calls.filter(([root]) => root === at.a).length, index: bridge.index.mock.calls.length, subscribed: first.counts.subscribed, ended: first.counts.ended })
    const before = asked()
    bridge.state.setFolder.mockClear()

    // App's add: the probe walks the folder, then the vault is in the window.
    await act(async () => void (await fetchTree(at.b)))
    await rerender({ vaults: [vault(at.a, 'Notes', { watch: first.watch }), vault(at.b, 'Work', { watch: second.watch })] })
    expect(topLabels(el)).toEqual(['Notes', 'Work'])
    expect(isOpen(el, at.b)).toBe('true')
    expect(isOpen(el, `${at.b}/docs`)).toBe('true') // the vault came with its own stored folders
    expect(bridge.state.setFolder).not.toHaveBeenCalled() // and none of them was written back, or over
    expect([el.querySelector('aside'), el.querySelector('.sidebar__lenses')]).toEqual([aside, search])
    expect(asked()).toEqual(before)
    expect(bridge.tree.mock.calls.filter(([root]) => root === at.b)).toHaveLength(1)
    expect(second.counts).toEqual({ subscribed: 1, ended: 0 })
    // Its own watcher refreshes its own tree, and no other.
    await act(async () => second.fire({ type: 'ready' } as WatchEvent))
    expect(bridge.tree.mock.calls.filter(([root]) => root === at.b)).toHaveLength(2)
    expect(asked()).toEqual(before)

    await rerender({ vaults: [vault(at.a, 'Notes', { watch: first.watch })] })
    expect(second.counts).toEqual({ subscribed: 1, ended: 1 })
    expect(asked()).toEqual(before)
    expect(topLabels(el)).toEqual(['sub', 'a'])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect([el.querySelector('aside'), el.querySelector('.sidebar__lenses')]).toEqual([aside, search])
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
  })

  it('a vault that leaves takes its rows off the Focus tab, and the selection with it, and its focus file is not written; when it comes back its list is read again and its rows are there (S50; YAZ-2702 S8, S9, which overturn A5); the items of a vault whose tree has not landed yet have no row yet', async () => {
    const at = pair()
    let land: (() => void) | undefined
    const both = [vault(at.a, 'Notes'), vault(at.b, 'Work')]
    const { el, bridge, props, rerender } = await mountVaults(both, { lens: 'focus' }, async (bridge) => {
      await withFocus(`${at.b}/docs`, `${at.a}/sub`, `${at.b}/b.md`)(bridge)
      bridge.tree.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (land = () => resolve({ root, tree: treeOf(root), generatedAt: 1 }))) : Promise.resolve({ root, tree: treeOf(root), generatedAt: 1 })))
    })
    // Vault `b` is still loading: its items have no row yet.
    expect(topLabels(el)).toEqual(['sub'])
    expect(bodyMsg(el)).toBeNull()
    await act(async () => land?.())
    expect(topLabels(el)).toEqual(['docs', 'sub', 'b'])

    shiftClick(rowByPath(el, `${at.a}/sub`))
    shiftClick(rowByPath(el, `${at.b}/docs`))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
    bridge.focus.get.mockClear()
    await rerender({ vaults: [both[0]] })
    expect(topLabels(el)).toEqual(['sub'])
    expect(countLine(el)).toBe('1 in focus')
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    // The vault comes back: one read of ITS list, none of the list of the vault that stayed. It took its
    // list with it, so its rows wait for that read — and a toggle before it writes nothing (S6).
    let answer: ((paths: string[]) => void) | undefined
    bridge.focus.get.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (answer = resolve)) : Promise.resolve([`${at.a}/sub`])))
    bridge.tree.mockImplementation(async (root: string) => ({ root, tree: treeOf(root), generatedAt: 2 }))
    await rerender({ vaults: both })
    expect(topLabels(el)).toEqual(['sub'])
    await rerender({ vaults: both, lens: 'files' })
    rightClick(rowByPath(el, `${at.b}/b.md`))
    await choose(el, 'Add to focus')
    expect(props.onNotice).toHaveBeenLastCalledWith('Focus is still loading. Try again.', 'error')
    await act(async () => answer?.([`${at.b}/docs`, `${at.b}/b.md`]))
    await rerender({ vaults: both, lens: 'focus' })
    expect(topLabels(el)).toEqual(['docs', 'sub', 'b'])
    expect(bridge.focus.get.mock.calls).toEqual([[at.b]])
    expect(bridge.focus.set).not.toHaveBeenCalled()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
  })

  it('a vault whose folder is gone is reported by its own root, and the other vault still shows (S53)', async () => {
    const at = pair()
    const { el, props } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], {}, (bridge) =>
      bridge.tree.mockImplementation((root: string) => (root === at.b ? Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist' }) : Promise.resolve({ root, tree: treeOf(root), generatedAt: 1 }))),
    )
    expect(props.onRootMissing).toHaveBeenCalledWith(at.b)
    expect(props.onRootMissing).not.toHaveBeenCalledWith(at.a)
    expect(topLabels(el)).toEqual(['Notes'])
  })

  it('a load error is its own vault\'s: two vaults that fail show a line each, under the vault\'s name; a vault that loads clears its own line alone; a vault that leaves takes its line, and a late failure of it draws none; one vault names no vault', async () => {
    const at = pair()
    const first = watcher()
    const second = watcher()
    const both = [vault(at.a, 'Notes', { watch: first.watch }), vault(at.b, 'Work', { watch: second.watch })]
    const errors = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__msg--error')].map((line) => line.textContent)
    let failB: (() => void) | undefined
    const { el, bridge, rerender } = await mountVaults(both, {}, (bridge) => bridge.tree.mockImplementation((root: string) => Promise.reject({ code: 'IO_ERROR', message: root === at.a ? 'notes unreadable' : 'work unreadable' })))
    expect(errors(el)).toEqual(['Notes: notes unreadable', 'Work: work unreadable'])
    expect(bodyMsg(el)).toBe('Notes: notes unreadable') // no "Loading…" beside an error

    // Vault `a` loads: its line goes, and the line of `b` — the older or the newer — stays.
    bridge.tree.mockImplementation((root: string) => (root === at.a ? Promise.resolve({ root, tree: treeOf(root), generatedAt: 2 }) : new Promise((_resolve, reject) => (failB = () => reject({ code: 'IO_ERROR', message: 'work unreadable, late' })))))
    await act(async () => first.fire({ type: 'ready' } as WatchEvent))
    expect(errors(el)).toEqual(['Work: work unreadable'])
    expect(topLabels(el)).toEqual(['Notes'])

    // Vault `b` leaves with a read of it still on the wire: its line leaves, and the late failure draws none.
    await act(async () => second.fire({ type: 'ready' } as WatchEvent))
    await rerender({ vaults: [both[0]] })
    expect(errors(el)).toEqual([])
    await act(async () => failB?.())
    expect(errors(el)).toEqual([])
    expect(topLabels(el)).toEqual(['sub', 'a'])

    // One vault: the message alone, as a window with one vault always showed it.
    await act(async () => first.fire({ type: 'error', message: 'watcher stopped' } as WatchEvent))
    expect(errors(el)).toEqual(['watcher stopped'])
  })

  it('"Add to focus" on a file of the second vault, then on a folder of the first: each goes to the list of the vault that holds it (YAZ-2702 S1), each add asks for the Focus tab, and each top row there, file or folder, names its vault, as each top row of the Favorites tab does; an add writes no order across vaults, so the rows follow the vaults; Files names none and is not narrowed (A1, A4, A7; YAZ-2631 S41, S43)', async () => {
    const { el, a, b, bridge, props, rerender } = await two({}, (bridge, at) => void favoritesOf(bridge, { [at.a]: [`${at.a}/sub`] }))
    rightClick(rowByPath(el, `${b}/b.md`))
    await choose(el, 'Add to focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(b, [`${b}/b.md`])
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('focus')
    rightClick(rowByPath(el, `${a}/sub`))
    await choose(el, 'Add to focus')
    expect(bridge.focus.set.mock.calls).toEqual([[b, [`${b}/b.md`]], [a, [`${a}/sub`]]])
    // With two vaults each add also gives the order across vaults, so a new item goes LAST on the tab (YAZ-2619 D1: the order added).
    expect(bridge.state.setFocusOrder.mock.calls).toEqual([[[a, b], [`${b}/b.md`]], [[a, b], [`${b}/b.md`, `${a}/sub`]]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Added to focus', 'info', 'lists')
    // App has not handed the lens back yet: this is still Files — every vault, whole, and no row names a vault.
    expect(topLabels(el)).toEqual(['Notes', 'Work'])
    expect(el.querySelector('.tree__vault')).toBeNull()

    await rerender({ lens: 'focus' })
    // The order added, not the order of the vaults: the file of the second vault came first.
    expect(topLabels(el)).toEqual(['b', 'sub'])
    expect([tag(el, `${b}/b.md`), tag(el, `${a}/sub`)]).toEqual(['Work', 'Notes'])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect(countLine(el)).toBe('2 in focus')
    // The folder opened in its own vault (YAZ-2619 R4), as its own copy (YAZ-3131 S4); what stands below a top row is not tagged.
    expect(allRows(el)).toEqual([`${b}/b.md`, `${a}/sub`, `${a}/sub/in.md`])
    expect(setFolderCalls(bridge)).toContainEqual([a, { expanded: [copyFoldKey(`${a}/sub`, `${a}/sub`)] }])
    expect(el.querySelectorAll('.tree__vault')).toHaveLength(2)
    // The tag stands after the label, on a file row as on a folder row.
    for (const row of [`${b}/b.md`, `${a}/sub`]) expect(rowByPath(el, row)?.querySelector('.tree__vault')?.previousElementSibling?.className).toBe('tree__label')

    await rerender({ lens: 'favorites' })
    expect(allRows(el)).toEqual([`${a}/sub`, `${a}/sub/in.md`])
    expect([tag(el, `${a}/sub`), tag(el, `${a}/sub/in.md`)]).toEqual(['Notes', null])
  })

  it('one vault: no top row of the Focus tab names a vault, file or folder (S11, A4; YAZ-2631 S42)', async () => {
    const { el } = await mount({ lens: 'focus' }, async (bridge) => {
      await withFocus('/v/a.md', '/v/sub')(bridge)
      await storage.init()
    })
    expect(topLabels(el)).toEqual(['a', 'sub'])
    expect(el.querySelector('.tree__vault')).toBeNull()
  })

  it('the vault name\'s rule is its own: 10px, the muted colour at 60%, 40% of the row at most with an ellipsis (YAZ-2631 S41, S44, R10)', () => {
    const rule = appCss.match(/\n\.tree__vault \{([^}]*)\}/)?.[1]
    for (const declaration of ['font-size: 10px;', 'color: color-mix(in srgb, var(--fg-muted) 60%, transparent);', 'max-width: 40%;', 'text-overflow: ellipsis;']) expect(rule).toContain(declaration)
    // No other rule names the vault name: none shares the number's, none follows a count.
    expect(appCss.match(/\.tree__vault[^{]*\{/g)).toEqual(['.tree__vault {'])
  })

  it('a selection across two vaults goes in, in panel order; a remove on a row of the second vault keeps the tab; a mixed selection reads Add and puts in the missing row; all in reads "Remove 2 from focus" (A7)', async () => {
    const { el, a, b, bridge, props } = await two()
    const escape = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    const dropSelection = () => act(() => void body(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    /** Both rows by shift-click alone: a plain click on the folder would open it, and the add must. */
    const both = () => {
      dropSelection()
      shiftClick(rowByPath(el, `${b}/docs`))
      shiftClick(rowByPath(el, `${a}/a.md`))
    }
    both()
    rightClick(rowByPath(el, `${b}/docs`))
    expect(focusItems(el)).toEqual(['Add 2 to focus'])
    await choose(el, 'Add 2 to focus')
    // YAZ-2702 S2: one write for each vault, each with its own part of the selection.
    expect(bridge.focus.set.mock.calls).toEqual([[a, [`${a}/a.md`]], [b, [`${b}/docs`]]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Added 2 to focus', 'info', 'lists')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('focus')
    // The folder opened in ITS vault, the second, as its own copy (YAZ-3131 S4): its open folders are stored under that vault (YAZ-2619 R4).
    expect(setFolderCalls(bridge)).toContainEqual([b, { expanded: [copyFoldKey(`${b}/docs`, `${b}/docs`)] }])

    dropSelection()
    rightClick(rowByPath(el, `${b}/docs`))
    expect(focusItems(el)).toEqual(['Remove from focus'])
    await choose(el, 'Remove from focus')
    expect(bridge.focus.set).toHaveBeenLastCalledWith(b, [])
    expect(props.onNotice).toHaveBeenLastCalledWith('Removed from focus', 'info', 'lists')
    expect(props.onLensChange).toHaveBeenCalledTimes(1) // a remove keeps the tab (YAZ-2619 R5)

    both()
    rightClick(rowByPath(el, `${a}/a.md`))
    expect(focusItems(el)).toEqual(['Add 2 to focus']) // one of the two is missing (R9)
    await choose(el, 'Add 2 to focus')
    // The vault whose list holds its part already is not written again.
    expect(bridge.focus.set.mock.calls.slice(3)).toEqual([[b, [`${b}/docs`]]])
    rightClick(rowByPath(el, `${a}/a.md`))
    expect(focusItems(el)).toEqual(['Remove 2 from focus'])
    escape()
  })

  it('a restored list whose only items are of a vault still loading: the Focus tab says "Loading…", never the empty text, and shows them as that tree lands', async () => {
    const at = pair()
    let land: (() => void) | undefined
    const { el, bridge } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { lens: 'focus' }, async (bridge) => {
      await withFocus(`${at.b}/docs`)(bridge)
      bridge.tree.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (land = () => resolve({ root, tree: treeOf(root), generatedAt: 1 }))) : Promise.resolve({ root, tree: treeOf(root), generatedAt: 1 })))
    })
    expect([...el.querySelectorAll('.sidebar__body .sidebar__msg')].map((msg) => msg.textContent)).toEqual(['Loading…'])
    expect(countLine(el)).toBeNull()
    await act(async () => land?.())
    expect(bodyMsg(el)).toBeNull()
    expect(topLabels(el)).toEqual(['docs'])
    expect(bridge.focus.set).not.toHaveBeenCalled()
  })

  it('a vault that leaves takes its rows; when they were the only ones the Focus tab shows the empty text, and the tab stays; nothing is written (S21; YAZ-2702 S9)', async () => {
    const at = pair()
    const both = [vault(at.a, 'Notes'), vault(at.b, 'Work')]
    const { el, bridge, props, rerender } = await mountVaults(both, { lens: 'focus' }, withFocus(`${at.b}/docs`, `${at.b}/b.md`))
    expect(topLabels(el)).toEqual(['docs', 'b'])
    expect([tag(el, `${at.b}/docs`), tag(el, `${at.b}/b.md`)]).toEqual(['Work', 'Work'])
    await rerender({ vaults: [both[0]] })
    expect(bridge.focus.set).not.toHaveBeenCalled()
    expect(bodyMsg(el)).toBe('Nothing in focus. Right-click a file or folder → Add to focus.')
    expect(countLine(el)).toBeNull()
    expect(props.onLensChange).not.toHaveBeenCalled()
  })

  it('a focus item that leaves its vault\'s tree from outside — deleted, or renamed to another path — loses its row, and the rows of the other vault stay; the list is not written here (S22; YAZ-2702 S13)', async () => {
    const at = pair()
    const work = watcher()
    const { el, bridge } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work', { watch: work.watch })], { lens: 'focus' }, withFocus(`${at.a}/sub`, `${at.b}/docs`, `${at.b}/b.md`))
    expect(topLabels(el)).toEqual(['sub', 'docs', 'b'])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    bridge.tree.mockImplementation(async (root: string) => ({ root, tree: root === at.b ? [{ type: 'dir', name: 'docs2', path: `${at.b}/docs2`, children: [] }, file(`${at.b}/b.md`)] : treeOf(root), generatedAt: 2 }))
    await act(async () => work.fire({ type: 'unlinkDir', path: `${at.b}/docs` } as WatchEvent))
    await afterQuiet()
    expect(bridge.focus.set).not.toHaveBeenCalled()
    expect(topLabels(el)).toEqual(['sub', 'b'])
    expect([tag(el, `${at.a}/sub`), tag(el, `${at.b}/b.md`)]).toEqual(['Notes', 'Work'])
  })

  it('"New note" on a top file row of the Focus tab, with two vaults: its folder is a vault\'s root, which that tab does not hold, so the create moves to Files and stands under the vault\'s row — for the first vault as for the second (YAZ-2619 S36), and on the Favorites tab as on Focus (YAZ-2631 D1)', async () => {
    for (const lens of ['focus', 'favorites'] as const) {
      for (const pick of ['a', 'b'] as const) {
        const at = pair()
        const top = pick === 'a' ? `${at.a}/a.md` : `${at.b}/b.md`
        const { el, props, rerender } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { lens }, async (bridge) => {
          await withFocus(top)(bridge)
          favoritesOf(bridge, { [at[pick]]: [top] })
        })
        rightClick(rowByPath(el, top))
        act(() => itemByLabel(el, 'New note')?.click())
        expect(props.onLensChange, lens).toHaveBeenCalledExactlyOnceWith('files')
        await rerender({ lens: 'files' })
        const field = el.querySelector<HTMLInputElement>('.create-inline__input')
        expect(field?.closest('ul.tree')?.parentElement?.querySelector(':scope > .tree__row'), lens).toBe(rowByPath(el, at[pick]))
        act(() => root?.unmount())
        container?.remove()
      }
    }
  })

  it('"New note" on a folder that the Focus tab holds, with two vaults: the input stands inside that folder, on the Focus tab (YAZ-2619 S35)', async () => {
    const at = pair()
    const { el, props } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { lens: 'focus' }, withFocus(`${at.b}/docs`))
    rightClick(rowByPath(el, `${at.b}/docs`))
    act(() => itemByLabel(el, 'New note')?.click())
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(el.querySelector('.create-inline__input')?.closest('ul.tree')?.parentElement?.querySelector(':scope > .tree__row')).toBe(rowByPath(el, `${at.b}/docs`))
  })

  it('YAZ-2631 S18: "Expand all" and "Collapse all" on the Favorites tab act on the favorited folders of every vault, each stored under its own vault; no vault row is on the tab, and none is opened, closed or stored', async () => {
    const { el, a, b, bridge, props } = await two({ lens: 'favorites' }, (bridge, at) => void favoritesOf(bridge, { [at.a]: [`${at.a}/sub`], [at.b]: [`${at.b}/docs`] }))
    const button = () => el.querySelector<HTMLButtonElement>('.sidebar__expand-all')
    expect(button()?.getAttribute('aria-label')).toBe('Expand all')
    act(() => button()?.click())
    expect(allRows(el)).toEqual([`${a}/sub`, `${a}/sub/in.md`, `${b}/docs`, `${b}/docs/d.md`])
    // Each copy's own key (YAZ-3131 S5), each under the vault that holds it.
    expect(setFolderCalls(bridge).filter(([, patch]) => patch.expanded !== undefined)).toEqual([[a, { expanded: [copyFoldKey(`${a}/sub`, `${a}/sub`)] }], [b, { expanded: [copyFoldKey(`${b}/docs`, `${b}/docs`)] }]])
    expect(button()?.getAttribute('aria-label')).toBe('Collapse all')
    act(() => button()?.click())
    expect(allRows(el)).toEqual([`${a}/sub`, `${b}/docs`])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect(props.onSetVaultOpen).not.toHaveBeenCalled()
  })

  it('YAZ-2631 S2, S3, S9, S16, S19, S41: with two or more vaults the Favorites tab is one flat list, in vault order and then each file\'s order while no order is stored; no vault row, each top row names its vault, and a favorite whose file is not here draws no row; a favorite inside a favorited folder stands at the top and inside it; a top row has its row menu of Files; a vault row closed on Files hides nothing here', async () => {
    const at = pair()
    const plain = at.b.replace('/work', '/plain')
    const lists = { [at.a]: [`${at.a}/a.md`, `${at.a}/sub/in.md`, `${at.a}/sub`], [plain]: [`${plain}/gone.md`], [at.b]: [`${at.b}/docs`, `${at.b}/gone.md`, `${at.b}/b.md`] }
    const { el, props, bridge, rerender } = await mountVaults([vault(at.a, 'Notes'), vault(plain, 'Plain'), vault(at.b, 'Work')], { lens: 'favorites' }, (bridge) => void favoritesOf(bridge, lists))
    const top = [`${at.a}/a.md`, `${at.a}/sub/in.md`, `${at.a}/sub`, `${at.b}/docs`, `${at.b}/b.md`]
    expect(allRows(el)).toEqual(top)
    expect(topLabels(el)).toEqual(['a', 'in', 'sub', 'docs', 'b'])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect(top.map((path) => tag(el, path))).toEqual(['Notes', 'Notes', 'Notes', 'Work', 'Work'])
    expect([rowByPath(el, `${at.a}/a.md`)?.style.paddingLeft, rowByPath(el, `${at.a}/sub`)?.style.paddingLeft]).toEqual(['22px', '8px'])
    expect(bodyMsg(el)).toBeNull()
    expect([...new Set(bridge.favorites.get.mock.calls.map(([root]) => root))].sort()).toEqual([at.a, plain, at.b].sort())
    // S16: a favorited folder unfolds in place, and the favorite inside it stands there too, with no vault name.
    act(() => rowByPath(el, `${at.a}/sub`)?.click())
    const twice = [...el.querySelectorAll<HTMLElement>(`.tree__row[data-path="${at.a}/sub/in.md"]`)]
    expect(twice.map((row) => row.querySelector('.tree__vault')?.textContent ?? null)).toEqual(['Notes', null])
    // S19: the row's own menu, as on Files — of a file and of a folder, of either vault.
    for (const path of [`${at.b}/b.md`, `${at.a}/sub`]) {
      rightClick(rowByPath(el, path))
      expect(topItems(el), path).toEqual(expect.arrayContaining(['Add to focus', 'Cut', 'Copy', 'Copy path', 'Rename', 'Remove from favorites', 'Delete']))
      expect(topItems(el), path).not.toContain('Remove from this window')
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    }
    // The vault row is the Files tab's alone: closed there, its favorites still stand here.
    await rerender({ closedVaults: [at.b] })
    expect(topLabels(el)).toEqual(['a', 'in', 'sub', 'docs', 'b'])
    expect(props.onSetVaultOpen).not.toHaveBeenCalled()
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(bridge.state.setFavoritesOrder).not.toHaveBeenCalled()
  })

  it('two or more vaults and no favorite that exists: the "No favorites yet" text, and no row (YAZ-2631 S20)', async () => {
    const { el } = await two({ lens: 'favorites' }, (bridge, at) => void favoritesOf(bridge, { [at.b]: [`${at.b}/gone.md`] }))
    expect(bodyMsg(el)).toBe('No favorites yet. Right-click a file or folder → Add to favorites.')
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('"Add to favorites" writes the file of the vault that holds the row; a selection across two vaults writes one file per vault, and the notice counts every row (S25; YAZ-2631 S17)', async () => {
    const { el, a, b, bridge, props } = await two({}, (bridge, at) => void favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`] }))
    rightClick(rowByPath(el, `${b}/b.md`))
    await choose(el, 'Add to favorites')
    expect(bridge.favorites.set.mock.calls).toEqual([[b, [`${b}/b.md`]]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Added to favorites', 'favorite', 'lists')
    // A row of the other vault reads its own vault's list: `a.md` is a favorite there.
    rightClick(rowByPath(el, `${a}/a.md`))
    expect(itemByLabel(el, 'Remove from favorites')).toBeDefined()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    bridge.favorites.set.mockClear()
    shiftClick(rowByPath(el, `${a}/a.md`)) // out of the selection the right-click made
    shiftClick(rowByPath(el, `${a}/sub`))
    shiftClick(rowByPath(el, `${b}/docs`))
    shiftClick(rowByPath(el, `${b}/b.md`))
    rightClick(rowByPath(el, `${a}/sub`))
    // One of the three is a favorite already, so the item adds: each file gains its own vault's rows.
    await choose(el, 'Add 3 to favorites')
    expect(bridge.favorites.set.mock.calls).toEqual([[a, [`${a}/a.md`, `${a}/sub`]], [b, [`${b}/b.md`, `${b}/docs`]]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Added 3 to favorites', 'favorite', 'lists')

    bridge.favorites.set.mockClear()
    rightClick(rowByPath(el, `${b}/docs`))
    await choose(el, 'Remove 3 from favorites')
    expect(bridge.favorites.set.mock.calls).toEqual([[a, [`${a}/a.md`]], [b, []]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Removed 3 from favorites', 'favorite', 'lists')
  })

  it('YAZ-2631 S4, S5, S9, S12, S15, R3, R4: a favorite drags to any place of the flat list, between the rows of either vault; a drag that keeps each vault\'s own order writes the order across vaults alone, and one that changes a vault\'s own order writes that vault\'s file too — with the favorite that draws no row still in it; a refused file write puts that vault\'s list back; another window\'s drag lands here', async () => {
    let broadcast: ((state: AppState) => void) | undefined
    const { el, a, b, bridge, props } = await two({ lens: 'favorites' }, (bridge, at) => {
      favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`, `${at.a}/gone.md`, `${at.a}/sub`], [at.b]: [`${at.b}/docs`, `${at.b}/b.md`] })
      bridge.state.onChange.mockImplementation((listener) => {
        broadcast = listener
        return () => undefined
      })
    })
    const [aMd, gone, sub, docs, bMd] = [`${a}/a.md`, `${a}/gone.md`, `${a}/sub`, `${b}/docs`, `${b}/b.md`]
    const dragTo = (from: string, to: string, edge: 'before' | 'after') => {
      drag(rowByPath(el, from), 'dragstart')
      drag(rowByPath(el, to), 'dragover', edge === 'before' ? -1 : 1)
      expect(marker(el)).toBe(rowByPath(el, to))
      expect(rowByPath(el, to)?.classList.contains(`tree__row--drop-${edge}`)).toBe(true)
      drag(rowByPath(el, to), 'drop')
      expect(marker(el)).toBeNull()
    }
    expect(allRows(el)).toEqual([aMd, sub, docs, bMd])
    expect([aMd, sub, docs, bMd].map((path) => rowByPath(el, path)?.draggable)).toEqual([true, true, true, true])

    // S4: a favorite of Work lands between two of Notes. Each vault's own order is the same: no file is written.
    dragTo(docs, sub, 'before')
    expect(allRows(el)).toEqual([aMd, docs, sub, bMd])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(bridge.state.setFavoritesOrder.mock.calls).toEqual([[[a, b], [aMd, gone, docs, sub, bMd]]])

    // S5: two favorites of Work change places: Work's file gets its order, and Notes' is not written.
    dragTo(bMd, docs, 'before')
    expect(allRows(el)).toEqual([aMd, bMd, docs, sub])
    expect(bridge.favorites.set.mock.calls).toEqual([[b, [bMd, docs]]])
    expect(bridge.state.setFavoritesOrder).toHaveBeenLastCalledWith([a, b], [aMd, gone, bMd, docs, sub])

    // S12: a drag in another window on the same vaults lands as the state broadcast.
    await act(async () => broadcast?.({ ...defaultAppState(), favoritesOrder: [bMd, docs, sub, aMd, gone] }))
    expect(allRows(el)).toEqual([bMd, docs, aMd, sub])

    // S15, S9: Notes' file is malformed. A drag inside Notes sends its whole list, the hidden favorite in it;
    // the refusal is said, and Notes' list is back as its file has it.
    bridge.favorites.set.mockClear()
    bridge.favorites.set.mockRejectedValueOnce({ code: 'INVALID_CONFIG', message: 'favorites.json is malformed; fix or delete it' })
    dragTo(sub, aMd, 'before')
    expect(allRows(el)).toEqual([bMd, docs, sub, aMd])
    await act(async () => undefined)
    expect(bridge.favorites.set.mock.calls).toEqual([[a, [sub, aMd, gone]]])
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("Can't save favorites: favorites.json is malformed; fix or delete it", 'error')
    expect(allRows(el)).toEqual([bMd, docs, aMd, sub])
    // A drag that keeps Notes' own order writes nothing to Notes.
    dragTo(docs, sub, 'after')
    expect(allRows(el)).toEqual([bMd, aMd, sub, docs])
    expect(bridge.favorites.set).toHaveBeenCalledTimes(1)
    expect(bridge.state.setFavoritesOrder).toHaveBeenCalledTimes(4)
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('YAZ-2631 S35: with two vaults a favorite dropped on the edge where it already stands changes no order — no vault file is written, and no order across vaults', async () => {
    const { el, a, b, bridge } = await two({ lens: 'favorites' }, (bridge, at) => void favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`, `${at.a}/sub`], [at.b]: [`${at.b}/docs`] }))
    const [aMd, sub, docs] = [`${a}/a.md`, `${a}/sub`, `${b}/docs`]
    for (const [to, half] of [[aMd, 1], [docs, -1]] as const) {
      drag(rowByPath(el, sub), 'dragstart')
      drag(rowByPath(el, to), 'dragover', half)
      expect(marker(el)).toBe(rowByPath(el, to))
      drag(rowByPath(el, to), 'drop')
      expect(marker(el)).toBeNull()
    }
    expect(allRows(el)).toEqual([aMd, sub, docs])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(bridge.state.setFavoritesOrder).not.toHaveBeenCalled()
  })

  it('YAZ-2631 S6, S7, R23: "Add to favorites" puts the row at the end of the flat list, after the rows of every vault, and writes no order across vaults; "Remove from favorites" takes the row and the others keep their order — and takes the path out of the order across vaults, only when that order holds it, so the same favorite added again goes last and no other row moves; with one vault too', async () => {
    const { el, a, b, bridge, rerender } = await two({}, (bridge, at) => {
      favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`], [at.b]: [`${at.b}/docs`, `${at.b}/b.md`] })
      bridge.state.get.mockResolvedValue({ ...defaultAppState(), favoritesOrder: [`${at.b}/docs`, `${at.a}/a.md`, `${at.b}/b.md`] })
    })
    const [aMd, sub, docs, bMd] = [`${a}/a.md`, `${a}/sub`, `${b}/docs`, `${b}/b.md`]
    rightClick(rowByPath(el, sub))
    await choose(el, 'Add to favorites')
    expect(bridge.favorites.set.mock.calls).toEqual([[a, [aMd, sub]]])
    await rerender({ lens: 'favorites' })
    expect(allRows(el)).toEqual([docs, aMd, bMd, sub])
    // R23: `sub` has no place in the order across vaults, so its remove sends none.
    rightClick(rowByPath(el, sub))
    await choose(el, 'Remove from favorites')
    expect(allRows(el)).toEqual([docs, aMd, bMd])
    expect(bridge.state.setFavoritesOrder).not.toHaveBeenCalled()
    // `docs` holds the first place: its remove takes that place out, and each other entry stays where it is.
    rightClick(rowByPath(el, docs))
    await choose(el, 'Remove from favorites')
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(b, [bMd])
    expect(allRows(el)).toEqual([aMd, bMd])
    expect(bridge.state.setFavoritesOrder.mock.calls).toEqual([[[a, b], [aMd, bMd]]])
    expect(storage.getFavoritesOrder()).toEqual([aMd, bMd])
    // A favorite again, `docs` goes last (S6): no other row moved, and the add sent no order.
    await rerender({ lens: 'files' })
    rightClick(rowByPath(el, docs))
    await choose(el, 'Add to favorites')
    await rerender({ lens: 'favorites' })
    expect(allRows(el)).toEqual([aMd, bMd, docs])
    expect(bridge.state.setFavoritesOrder).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    container?.remove()

    // One vault in the window: the remove still takes its path out, and the entry of a vault that is not here keeps its place.
    const at = pair()
    const one = await mountVaults([vault(at.a, 'Notes')], { lens: 'favorites' }, (bridge) => {
      favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`] })
      bridge.state.get.mockResolvedValue({ ...defaultAppState(), favoritesOrder: [`${at.b}/b.md`, `${at.a}/a.md`, `${at.b}/docs`] })
    })
    rightClick(rowByPath(one.el, `${at.a}/a.md`))
    await choose(one.el, 'Remove from favorites')
    expect(one.bridge.state.setFavoritesOrder.mock.calls).toEqual([[[at.a], [`${at.b}/b.md`, `${at.b}/docs`]]])
    expect(storage.getFavoritesOrder()).toEqual([`${at.b}/b.md`, `${at.b}/docs`])
  })

  it('YAZ-2631 R25: a drag gives the store only the vaults whose favorites this window has read — a vault whose read is still on its way keeps its places in the order across vaults; once it has answered, with no favorite, the next drag takes its stale entries out', async () => {
    let answer: ((paths: string[]) => void) | undefined
    const { el, a, b, bridge } = await two({ lens: 'favorites' }, (bridge, at) => {
      bridge.favorites.get.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (answer = resolve)) : Promise.resolve([`${at.a}/a.md`, `${at.a}/sub`])))
      bridge.state.get.mockResolvedValue({ ...defaultAppState(), favoritesOrder: [`${at.a}/a.md`, `${at.b}/b.md`, `${at.a}/sub`] })
    })
    const [aMd, sub, bMd] = [`${a}/a.md`, `${a}/sub`, `${b}/b.md`]
    expect(allRows(el)).toEqual([aMd, sub])
    drag(rowByPath(el, sub), 'dragstart')
    drag(rowByPath(el, aMd), 'dragover', -1)
    drag(rowByPath(el, aMd), 'drop')
    expect(allRows(el)).toEqual([sub, aMd])
    expect(bridge.state.setFavoritesOrder.mock.calls).toEqual([[[a], [sub, aMd]]])
    expect(storage.getFavoritesOrder()).toEqual([sub, bMd, aMd])
    // Work has answered: it has no favorite, and it counts as read.
    await act(async () => answer?.([]))
    drag(rowByPath(el, aMd), 'dragstart')
    drag(rowByPath(el, sub), 'dragover', -1)
    drag(rowByPath(el, sub), 'drop')
    expect(bridge.state.setFavoritesOrder).toHaveBeenLastCalledWith([a, b], [aMd, sub])
    expect(storage.getFavoritesOrder()).toEqual([aMd, sub])
    expect(bridge.favorites.set.mock.calls).toEqual([[a, [sub, aMd]], [a, [aMd, sub]]])
  })

  it('YAZ-2631 R26: the favorite toggle writes nothing for a vault whose favorites this window has not read — a write would replace the list on disk — and says so; once the vault has answered, the add keeps what the file held', async () => {
    let answer: ((paths: string[]) => void) | undefined
    const { el, a, b, bridge, props } = await two({}, (bridge, at) => {
      bridge.favorites.get.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (answer = resolve)) : Promise.resolve([])))
    })
    rightClick(rowByPath(el, `${b}/b.md`))
    await choose(el, 'Add to favorites')
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(props.onNotice).toHaveBeenLastCalledWith('Favorites are still loading. Try again.', 'error')
    // A selection that holds one row of that vault writes no vault at all: the notice counts every row or none.
    vi.mocked(props.onNotice).mockClear()
    shiftClick(rowByPath(el, `${b}/b.md`)) // out of the selection the right-click made
    shiftClick(rowByPath(el, `${a}/a.md`))
    shiftClick(rowByPath(el, `${b}/docs`))
    rightClick(rowByPath(el, `${a}/a.md`))
    await choose(el, 'Add 2 to favorites')
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(vi.mocked(props.onNotice).mock.calls).toEqual([['Favorites are still loading. Try again.', 'error']])

    await act(async () => answer?.([`${b}/docs`]))
    rightClick(rowByPath(el, `${b}/b.md`))
    await choose(el, 'Add to favorites')
    expect(bridge.favorites.set.mock.calls).toEqual([[b, [`${b}/docs`, `${b}/b.md`]]])
    expect(props.onNotice).toHaveBeenLastCalledWith('Added to favorites', 'favorite', 'lists')
  })

  it('YAZ-2631 R24: a reorder drag that lost its `dragend` on one tab moves nothing on the next — a file dropped on a vault row of Files hands App no order, and the line is gone', async () => {
    const { el, a, props, rerender } = await two({ lens: 'favorites' }, (bridge, at) => void favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`] }))
    drag(rowByPath(el, `${a}/a.md`), 'dragstart')
    await rerender({ lens: 'files' })
    drag(rowByPath(el, `${a}/a.md`), 'dragstart')
    drag(rowByPath(el, a), 'dragover', -1)
    drag(rowByPath(el, a), 'drop')
    expect(props.onReorderVaults).not.toHaveBeenCalled()
    expect(marker(el)).toBeNull()
  })

  it('YAZ-2631 S28, S31; YAZ-2702 S3, S4, S11: with two vaults a top row of the Focus tab drags to any place, between the rows of either vault — each vault\'s file gets its own part when that part changed, and the order across vaults goes to this Mac\'s store; "Remove from focus" takes the item out of its vault\'s list and out of that order; "Clear" empties the list of each vault and their places in that order; a file inside a folder, dropped on a folder of a different vault, is refused with the notice — on Focus as on Favorites', async () => {
    const at = pair()
    const [sub, a, docs, b] = [`${at.a}/sub`, `${at.a}/a.md`, `${at.b}/docs`, `${at.b}/b.md`]
    const { el, bridge, props } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work')], { lens: 'focus' }, withFocus(sub, a, docs, b))
    drag(rowByPath(el, b), 'dragstart')
    drag(rowByPath(el, a), 'dragover', -1)
    expect(rowByPath(el, a)?.classList.contains('tree__row--drop-before')).toBe(true)
    drag(rowByPath(el, a), 'drop')
    expect(allRows(el)).toEqual([sub, b, a, docs])
    drag(rowByPath(el, sub), 'dragstart')
    drag(rowByPath(el, docs), 'dragover', 1)
    expect(rowByPath(el, docs)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, docs), 'drop')
    expect(allRows(el)).toEqual([b, a, docs, sub])
    // S11: the first drag moved a row of `b` alone, the second a row of `a` alone; each wrote the order across the two.
    expect(bridge.focus.set.mock.calls).toEqual([[at.b, [b, docs]], [at.a, [a, sub]]])
    expect(bridge.state.setFocusOrder.mock.calls).toEqual([[[at.a, at.b], [sub, b, a, docs]], [[at.a, at.b], [b, a, docs, sub]]])
    expect(storage.getFocusOrder()).toEqual([b, a, docs, sub])
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
    expect(props.onRenameFile).not.toHaveBeenCalled()
    // S3: a remove is a write of the item's vault alone, and the path leaves the order across vaults.
    rightClick(rowByPath(el, docs))
    await choose(el, 'Remove from focus')
    expect(bridge.focus.set.mock.calls.slice(2)).toEqual([[at.b, [b]]])
    expect(storage.getFocusOrder()).toEqual([b, a, sub])
    expect(allRows(el)).toEqual([b, a, sub])
    // S4: "Clear" is one write for each vault that has items, and those vaults leave the order.
    await act(async () => el.querySelector<HTMLButtonElement>('.sidebar__focus-clear')?.click())
    expect(bridge.focus.set.mock.calls.slice(3)).toEqual([[at.a, []], [at.b, []]])
    expect(storage.getFocusOrder()).toEqual([])
    expect(bodyMsg(el)).toBe('Nothing in focus. Right-click a file or folder → Add to focus.')
    act(() => root?.unmount())
    container?.remove()

    for (const lens of ['focus', 'favorites'] as const) {
      const other = pair()
      const inner = `${other.a}/sub/in.md`
      const mounted = await mountVaults([vault(other.a, 'Notes'), vault(other.b, 'Work')], { lens }, async (bridge) => {
        await withFocus(`${other.a}/sub`, `${other.b}/docs`)(bridge)
        favoritesOf(bridge, { [other.a]: [`${other.a}/sub`], [other.b]: [`${other.b}/docs`] })
      })
      act(() => rowByPath(mounted.el, `${other.a}/sub`)?.click())
      drag(rowByPath(mounted.el, inner), 'dragstart')
      drag(rowByPath(mounted.el, `${other.b}/docs`), 'drop')
      expect(mounted.props.onNotice, lens).toHaveBeenCalledExactlyOnceWith('To move between vaults, use cut and paste')
      expect(mounted.props.onRenameFile, lens).not.toHaveBeenCalled()
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('favorites:changed for any vault of the window re-reads that vault alone and refreshes its rows; another vault\'s change is not this window\'s (S27)', async () => {
    const lists: Record<string, string[]> = {}
    let pushes: ReturnType<typeof favoritesOf> | undefined
    const { el, a, b, bridge } = await two({ lens: 'favorites' }, (bridge, at) => {
      lists[at.a] = [`${at.a}/a.md`]
      pushes = favoritesOf(bridge, lists)
    })
    expect(allRows(el)).toEqual([`${a}/a.md`])
    bridge.favorites.get.mockClear()
    lists[b] = [`${b}/b.md`]
    await act(async () => pushes?.emit?.({ root: b }))
    expect(bridge.favorites.get.mock.calls).toEqual([[b]])
    expect(allRows(el)).toEqual([`${a}/a.md`, `${b}/b.md`])
    lists[a] = []
    await act(async () => pushes?.emit?.({ root: a }))
    expect(allRows(el)).toEqual([`${b}/b.md`])
    await act(async () => pushes?.emit?.({ root: '/some-other-vault' }))
    expect(bridge.favorites.get).toHaveBeenCalledTimes(2)
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('a vault that joins brings its favorites without a second read of the vault that stays, into the places the stored order keeps for it; one that leaves takes its rows, and writes no favorites file and no order (S28, S50; YAZ-2631 S14)', async () => {
    const at = pair()
    const { fetchTree } = await import('../lib/treeFeed')
    const both = [vault(at.a, 'Notes'), vault(at.b, 'Work')]
    const { el, bridge, rerender } = await mountVaults([both[0]], { lens: 'favorites' }, (bridge) => {
      favoritesOf(bridge, { [at.a]: [`${at.a}/a.md`], [at.b]: [`${at.b}/b.md`] })
      bridge.state.get.mockResolvedValue({ ...defaultAppState(), favoritesOrder: [`${at.b}/b.md`, `${at.a}/a.md`] })
    })
    expect(allRows(el)).toEqual([`${at.a}/a.md`]) // one vault: its own list (S28)
    bridge.favorites.get.mockClear()
    await act(async () => void (await fetchTree(at.b)))
    await rerender({ vaults: both })
    expect(bridge.favorites.get.mock.calls).toEqual([[at.b]])
    expect(allRows(el)).toEqual([`${at.b}/b.md`, `${at.a}/a.md`])
    await rerender({ vaults: [both[0]] })
    expect(allRows(el)).toEqual([`${at.a}/a.md`])
    expect(bridge.favorites.get).toHaveBeenCalledTimes(1)
    // A vault that leaves the window leaves its `favorites.json` as it is (S50), and its places in the store (S14).
    expect(bridge.favorites.set).not.toHaveBeenCalled()
    expect(bridge.state.setFavoritesOrder).not.toHaveBeenCalled()
    // It took its list with it: back in the window, its rows wait for its own read, and stand in its place.
    let answer: ((paths: string[]) => void) | undefined
    bridge.favorites.get.mockImplementation((root: string) => (root === at.b ? new Promise((resolve) => (answer = resolve)) : Promise.resolve([`${at.a}/a.md`])))
    await rerender({ vaults: both })
    expect(allRows(el)).toEqual([`${at.a}/a.md`])
    await act(async () => answer?.([`${at.b}/docs`, `${at.b}/b.md`]))
    expect(allRows(el)).toEqual([`${at.b}/docs`, `${at.a}/a.md`, `${at.b}/b.md`])
  })

  /** Two vaults for the search: "Notes" holds `sub/plan notes.md`, `a.md`, `old plan.md`; "Work" holds `docs/d.md`, `docs/plan d.md`, `b.md`, `plan.md` and a script. Each index holds its vault's notes, titled as the files are named. */
  const searchTrees = (at: { a: string; b: string }): Record<string, TreeNode[]> => ({
    [at.a]: [{ type: 'dir', name: 'sub', path: `${at.a}/sub`, children: [file(`${at.a}/sub/plan notes.md`)] }, file(`${at.a}/a.md`), file(`${at.a}/old plan.md`)],
    [at.b]: [{ type: 'dir', name: 'docs', path: `${at.b}/docs`, children: [file(`${at.b}/docs/d.md`), file(`${at.b}/docs/plan d.md`)] }, file(`${at.b}/b.md`), file(`${at.b}/plan.md`), { type: 'file', name: 'plan.py', path: `${at.b}/plan.py`, size: 1, mtime: 1, kind: null }],
  })
  const notesOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? notesOf(n.children) : n.kind === 'markdown' ? [n.path] : []))
  const titled = (path: string): IndexRecord => ({ ...indexRecord(path), title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '') })
  /** Mount two vaults over `trees`, each with an index of its own notes; the search bar is ready to type in. */
  const searchTwo = async (over: Partial<SidebarProps> = {}, opts: { trees?: (at: { a: string; b: string }) => Record<string, TreeNode[]>; work?: ReturnType<typeof watcher>; tweak?: (bridge: Bridge, at: { a: string; b: string }) => unknown } = {}) => {
    const at = pair()
    const trees = (opts.trees ?? searchTrees)(at)
    const byRoot: Record<string, IndexRecord[]> = Object.fromEntries(Object.entries(trees).map(([root, nodes]) => [root, notesOf(nodes).map(titled)]))
    const mounted = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work', opts.work === undefined ? {} : { watch: opts.work.watch })], over, (bridge) => {
      bridge.tree.mockImplementation(async (root: string) => ({ root, tree: trees[root], generatedAt: 1 }))
      bridge.index.mockImplementation(async (root: string) => ({ root, records: byRoot[root] ?? [], folders: [], generatedAt: 1, ids: true }))
      return opts.tweak?.(bridge, at)
    })
    return { ...mounted, ...at, byRoot, trees, input: searchInput(mounted.el)! }
  }
  /** The body's rows as the eye reads them: top to bottom, two spaces per depth. */
  const shape = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.sidebar__body .tree__row')].map((row) => {
      let depth = -1
      for (let list = row.closest('ul.tree'); list !== null; list = list.parentElement?.closest('ul.tree') ?? null) depth++
      return `${'  '.repeat(depth)}${row.querySelector('.tree__label')?.textContent}`
    })
  /** The highlighted rows' labels: one while a match is on screen. */
  const cursor = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row--selected .tree__label')].map((n) => n.textContent)
  /** The rows the query matched: every other row of the cut tree is a parent, drawn dim. */
  const matches = (el: HTMLElement) => [...el.querySelectorAll('.sidebar__body .tree__row:not(.tree__row--context) .tree__label')].map((n) => n.textContent)
  const press = (input: HTMLInputElement, key: string) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  const LIMIT_LINE = 'Showing 50 matches. Type more to narrow.'

  it('a query that matches in two vaults: the cut tree is the forest — each match under its own vault\'s row, in the tree\'s order; a vault row is a parent, dim and open, and never a match, whatever its name holds (A9, S38)', async () => {
    const { el, a, b, input } = await searchTwo()
    await type(input, 'plan')
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work', '  docs', '    plan d', '  plan', '  plan.py'])
    expect(matches(el)).toEqual(['plan notes', 'old plan', 'plan d', 'plan', 'plan.py'])
    // The vault rows are the Files tab's rows, as parents: dim, open, and with no typed text marked.
    for (const row of [a, b]) {
      expect(rowByPath(el, row)?.className).toContain('tree__row--vault')
      expect(rowByPath(el, row)?.className).toContain('tree__row--context')
      expect(isOpen(el, row)).toBe('true')
    }
    expect([...el.querySelectorAll('.sidebar__body .tree__mark')].map((mark) => mark.closest('.tree__row')?.getAttribute('data-path'))).toEqual([`${a}/sub/plan notes.md`, `${a}/old plan.md`, `${b}/docs/plan d.md`, `${b}/plan.md`, `${b}/plan.py`])
    expect(el.querySelector('.tree__vault')).toBeNull()
    expect(el.querySelector('.search-results')).toBeNull()
    // A vault that holds no match has no row; a vault's NAME is not searched.
    await type(input, 'old')
    expect(shape(el)).toEqual(['Notes', '  old plan'])
    await type(input, 'notes')
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes'])
    expect(matches(el)).toEqual(['plan notes'])
    await type(input, 'work')
    expect(shape(el)).toEqual([])
    expect(bodyMsg(el)).toBe('No matches')
  })

  it('one ranking over every vault drives the keys: the highlight starts on the best match, in the second vault; ↑/↓ walk the matches of both vaults in the order on screen and stop at the ends; ⏎ opens the row, a file with no viewer in its default app (A9; YAZ-2620 S19, S20, S24)', async () => {
    const { el, a, b, input, props, bridge } = await searchTwo()
    await type(input, 'plan')
    expect(cursor(el)).toEqual(['plan']) // the exact name, of the SECOND vault's note
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['plan.py'])
    await press(input, 'ArrowDown') // the last match: no wrap
    expect(cursor(el)).toEqual(['plan.py'])
    await press(input, 'Enter')
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: `${b}/plan.py` })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    for (const expected of ['plan', 'plan d', 'old plan', 'plan notes', 'plan notes']) {
      await press(input, 'ArrowUp') // across the vault row, which is no stop
      expect(cursor(el)).toEqual([expected])
    }
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${a}/sub/plan notes.md`)
  })

  it('a vault row the user closed on Files shows open in the cut tree; a click folds it for this query alone — its matches are then no stop for the keys — and reaches neither App\'s list nor the store (A9; YAZ-2620 S15 to S17, S21)', async () => {
    const { el, b, props, bridge, rerender } = await searchTwo()
    await rerender({ lens: 'files', closedVaults: [b] })
    expect(isOpen(el, b)).toBe('false')
    await rerender({ lens: 'search', closedVaults: [b] })
    const input = searchBar(el)!
    await type(input, 'plan')
    expect(isOpen(el, b)).toBe('true')
    expect(cursor(el)).toEqual(['plan'])
    // A folder of the SECOND vault, folded: the match inside it is no stop on the way up.
    act(() => rowByPath(el, `${b}/docs`)?.click())
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['old plan'])
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['plan'])
    act(() => rowByPath(el, `${b}/docs`)?.click())
    await press(input, 'ArrowUp')
    expect(cursor(el)).toEqual(['plan d'])
    await type(input, 'plan ')
    await type(input, 'plan')
    act(() => rowByPath(el, b)?.click())
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work'])
    expect(isOpen(el, b)).toBe('false')
    // The best match is below the fold, and nobody moved the highlight: it is on the first match the
    // tree still draws, and ↓ stops at the last one of the first vault.
    expect(cursor(el)).toEqual(['plan notes'])
    for (const expected of ['old plan', 'old plan']) {
      await press(input, 'ArrowDown')
      expect(cursor(el)).toEqual([expected])
    }
    expect(props.onSetVaultOpen).not.toHaveBeenCalled()
    expect(bridge.state.setFolder).not.toHaveBeenCalled()
    // A new query is a new tree: the vault row stands open over its matches again.
    await type(input, 'pla')
    expect(isOpen(el, b)).toBe('true')
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work', '  docs', '    plan d', '  plan', '  plan.py'])
  })

  it('each vault\'s index is read once, at the first query; a keystroke reads nothing; a vault\'s own watcher re-reads that vault alone, and the cut tree follows (R2, A9)', async () => {
    const work = watcher()
    const { el, a, b, input, bridge, byRoot, trees } = await searchTwo({}, { work })
    expect(bridge.index).not.toHaveBeenCalled()
    await type(input, 'plan')
    expect(bridge.index.mock.calls.map(([root]) => root).sort()).toEqual([a, b].sort())
    await type(input, 'pla')
    expect(bridge.index).toHaveBeenCalledTimes(2)

    bridge.index.mockClear()
    trees[b] = [...trees[b], file(`${b}/planet.md`)]
    byRoot[b] = [...byRoot[b], titled(`${b}/planet.md`)]
    await act(async () => work.fire({ type: 'add', path: `${b}/planet.md` } as WatchEvent))
    await afterQuiet()
    expect(new Set(bridge.index.mock.calls.map(([root]) => root))).toEqual(new Set([b]))
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work', '  docs', '    plan d', '  plan', '  plan.py', '  planet'])
  })

  it('a tree of one vault is that vault\'s alone: the search builds the folder rows and the file rows of the vault whose tree landed, and no row of the other vault (R2)', async () => {
    const work = watcher()
    const { el, a, b, input, bridge, trees } = await searchTwo({}, { work })
    await type(input, 'plan')
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work', '  docs', '    plan d', '  plan', '  plan.py'])
    rowBuilds.folders.length = 0
    rowBuilds.files.length = 0
    const treesOfA = bridge.tree.mock.calls.filter(([root]) => root === a).length

    trees[b] = [...trees[b], { type: 'dir', name: 'plans', path: `${b}/plans`, children: [] }]
    await act(async () => work.fire({ type: 'ready' } as WatchEvent))
    expect(shape(el)).toEqual(['Notes', '  sub', '    plan notes', '  old plan', 'Work', '  docs', '    plan d', '  plan', '  plan.py', '  plans'])
    expect(bridge.tree.mock.calls.filter(([root]) => root === a)).toHaveLength(treesOfA)
    expect(new Set(rowBuilds.folders)).toEqual(new Set([b]))
    expect(new Set(rowBuilds.files)).toEqual(new Set([b]))
  })

  it('the limit of 50 counts the matches of every vault together: 30 and 30 show the best 50 and the limit line; fewer than 50 in all show no line (A9; YAZ-2620 S11)', async () => {
    const many = (root: string, n: number): TreeNode[] => Array.from({ length: n }, (_, i) => file(`${root}/note ${String(i + 1).padStart(2, '0')}.md`))
    const { el, a, b, input } = await searchTwo({}, { trees: (at) => ({ [at.a]: many(at.a, 30), [at.b]: many(at.b, 30) }) })
    const lines = () => [...el.querySelectorAll('.sidebar__body .sidebar__msg')].map((msg) => msg.textContent)
    await type(input, 'note')
    expect(matches(el)).toHaveLength(50)
    // One ranking: the names tie, so the first vault's rows lead and the second vault's fill what is left.
    expect(shape(el).filter((row) => !row.startsWith('  '))).toEqual(['Notes', 'Work'])
    expect([a, b].map((root) => el.querySelectorAll(`.sidebar__body .tree__row[data-path^="${root}/"]`).length)).toEqual([30, 20])
    expect(lines()).toEqual([LIMIT_LINE])
    await type(input, 'note 2')
    expect(matches(el)).toHaveLength(20) // 20 to 29, of each vault
    expect(lines()).toEqual([])
  })

  it('YAZ-2662 S26: with two or more vaults a top row of the top group names its vault, as on the Favorites tab — the focus items of each vault before the favorites; "Everything else" keeps its vault rows, and a vault with pinned matches only has no row there', async () => {
    const { el, a, b, input } = await searchTwo({}, {
      tweak: async (bridge, at) => {
        favoritesOf(bridge, { [at.a]: [`${at.a}/old plan.md`] })
        await withFocus(`${at.b}/docs`)(bridge)
      },
    })
    await type(input, 'plan')
    expect([...el.querySelector('.sidebar__body')!.children].map((child) => (child.matches('ul.tree') ? 'tree' : child.textContent))).toEqual(['Favorites and focus', 'tree', 'Everything else', 'tree'])
    expect(shape(el)).toEqual(['docs', '  plan d', 'old plan', 'Notes', '  sub', '    plan notes', 'Work', '  plan', '  plan.py'])
    expect([tag(el, `${b}/docs`), tag(el, `${a}/old plan.md`), tag(el, `${b}/docs/plan d.md`)]).toEqual(['Work', 'Notes', null])
    expect(vaultRowLabels(el)).toEqual(['Notes', 'Work'])
    // One ranking over both vaults: the best pinned match leads, and the keys walk the top group first.
    expect(cursor(el)).toEqual(['plan d'])
    await press(input, 'ArrowDown')
    await press(input, 'ArrowDown')
    expect(cursor(el)).toEqual(['plan notes'])
    await type(input, 'plan d')
    expect(shape(el)).toEqual(['docs', '  plan d'])
    expect(vaultRowLabels(el)).toEqual([])
  })

  it('YAZ-2662 S55: a vault row is never the highlight, so no list key acts on it — ↑ from a folder that Space opened stops at the folder, and ← with nothing to close leaves the vault row open', async () => {
    const { el, input } = await searchTwo()
    await type(input, 'docs')
    expect(shape(el)).toEqual(['Work', '  docs'])
    await press(input, 'ArrowUp')
    await press(input, ' ')
    expect(shape(el)).toEqual(['Work', '  docs', '    d', '    plan d'])
    const stops: (string | null)[] = []
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
      await press(input, key)
      stops.push(cursor(el)[0])
    }
    expect(stops).toEqual(['d', 'plan d', 'plan d', 'd', 'docs', 'docs'])
    await press(input, 'ArrowLeft')
    await press(input, 'ArrowLeft')
    expect(shape(el)).toEqual(['Work', '  docs'])
  })

  it('one vault: the cut tree has no vault row, and a match stands at its own depth, as before (S11, A9)', async () => {
    const { el } = await mount({}, (bridge) => bridge.index.mockResolvedValue({ root: '/v', records: [indexRecord('/v/a.md')], folders: [], generatedAt: 1, ids: true }))
    await type(searchInput(el)!, 'a')
    expect(shape(el)).toEqual(['a'])
    expect(el.querySelector('.tree__row--vault')).toBeNull()
    expect(el.querySelector('.tree__vault')).toBeNull()
  })

  it('a vault row of the cut tree has the vault row\'s menu plus `Show in sidebar` first (YAZ-2638 S26); "New note" there leaves the search and shows the vault\'s row in Files with the input under it, and no notice of a row that is missing (A9; YAZ-2620 S30)', async () => {
    const { el, b, input, props, rerender } = await searchTwo()
    await type(input, 'plan')
    rightClick(rowByPath(el, b))
    expect(topItems(el)).toEqual(['Show in sidebar', 'Paste', 'Copy path', 'New note', 'New drawing', 'New folder', 'Open by itself', 'Open in', 'Remove from this window'])
    act(() => itemByLabel(el, 'New note')?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(b)
    await rerender({ lens: 'files', revealRequest: { id: 1, path: b } })
    expect(searchBar(el)).toBeNull() // Files shows
    expect(props.onNotice).not.toHaveBeenCalled()
    expect(el.querySelector('.create-inline__input')?.closest('ul.tree')?.parentElement?.querySelector(':scope > .tree__row')).toBe(rowByPath(el, b))
    // The text stays in the Search tab (YAZ-2638 S22).
    await rerender({ lens: 'search' })
    expect(searchBar(el)?.value).toBe('plan')
  })

  it('the Inbox: one row per vault that has upkeep on, in vault order, named for its vault when there are two or more; each shows its own count and state and opens its own vault\'s review (R5, S41)', async () => {
    const at = pair()
    const plain = at.b.replace('/work', '/plain')
    const all = [vault(at.a, 'Notes', { upkeep: true, dueCount: 2 }), vault(plain, 'Plain', { dueCount: 9 }), vault(at.b, 'Work', { upkeep: true, reviewing: true })]
    const { el, props, rerender } = await mountVaults(all)
    expect(inboxes(el).map((row) => row.textContent)).toEqual(['Inbox · Notes2', 'Inbox · Work'])
    expect(inboxes(el).map((row) => row.getAttribute('aria-label'))).toEqual(['Inbox · Notes, 2 due', 'Inbox · Work'])
    expect(inboxes(el).map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(inboxes(el).map((row) => row.classList.contains('sidebar__inbox--active'))).toEqual([false, true])
    act(() => inboxes(el)[1].click())
    expect(props.onInbox).toHaveBeenCalledExactlyOnceWith(at.b)
    act(() => inboxes(el)[0].click())
    expect(props.onInbox).toHaveBeenLastCalledWith(at.a)
    // Exactly one vault with upkeep on: the row reads "Inbox", as in a window with one vault.
    await rerender({ vaults: [{ ...all[0], upkeep: false }, all[1], { ...all[2], reviewing: false, dueCount: 4 }] })
    expect(inboxes(el).map((row) => [row.textContent, row.getAttribute('aria-label'), row.getAttribute('aria-pressed')])).toEqual([['Inbox4', 'Inbox, 4 due', 'false']])
    act(() => inboxes(el)[0].click())
    expect(props.onInbox).toHaveBeenLastCalledWith(at.b)
    await rerender({ vaults: all.map((one) => ({ ...one, upkeep: false })) })
    expect(inboxes(el)).toEqual([])
  })

  it('"Review this folder" is offered by the upkeep of the vault that holds the folder, whatever the first vault has (R5)', async () => {
    const at = pair()
    const { el, props } = await mountVaults([vault(at.a, 'Notes'), vault(at.b, 'Work', { upkeep: true })])
    rightClick(rowByPath(el, `${at.a}/sub`))
    expect(itemByLabel(el, 'Review this folder')).toBeUndefined()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    rightClick(rowByPath(el, at.b))
    expect(itemByLabel(el, 'Review this folder')).toBeUndefined() // a vault row is not reviewed (S13)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    rightClick(rowByPath(el, `${at.b}/docs`))
    await choose(el, 'Review this folder')
    expect(props.onReviewFolder).toHaveBeenCalledExactlyOnceWith(`${at.b}/docs`)
  })
})

describe('Sidebar: the Files window chip (YAZ-3357 D13)', () => {
  it('a Files window shows "Files window" beside the cog; the first click turns it red "Make full window", the second converts; a move off, Esc or a press elsewhere lets it go; a full window has no chip', async () => {
    const onToNormalWindow = vi.fn()
    const { el } = await mount({ onToNormalWindow })
    const chip = el.querySelector<HTMLButtonElement>('.sidebar__footer .sidebar__files-chip')!
    expect(chip.textContent).toBe('Files window')
    act(() => chip.click())
    expect(chip.textContent).toBe('Make full window')
    expect(chip.classList.contains('sidebar__files-chip--armed')).toBe(true)
    expect(onToNormalWindow).not.toHaveBeenCalled()
    act(() => void chip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(chip.textContent).toBe('Files window')
    act(() => chip.click())
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(chip.textContent).toBe('Files window')
    act(() => chip.click())
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(chip.textContent).toBe('Files window')
    expect(onToNormalWindow).not.toHaveBeenCalled()
    act(() => chip.click())
    act(() => chip.click())
    expect(onToNormalWindow).toHaveBeenCalledTimes(1)
    expect(chip.textContent).toBe('Files window')
    act(() => root?.unmount())
    container?.remove()
    const normal = await mount()
    expect(normal.el.querySelector('.sidebar__files-chip')).toBeNull()
  })
})
