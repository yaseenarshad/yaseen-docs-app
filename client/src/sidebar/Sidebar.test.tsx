/**
 * Sidebar file-row gestures: ⌘-click opens a BACKGROUND TAB in this window (I3 LOCKED ruling,
 * GRO-2235); the row's context-menu "Open in new window" still opens a new window on
 * {root, file} over the bridge (D2, GRO-2168) — either way the current window's active file
 * is untouched (onOpenFile never fires). Plain click and folder/blank-space context menus are
 * unchanged, and activating a stale tab probes a fresh tree before onFileMissing fires.
 * Real Tree/ContextMenu render against the jsdom bridge stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type TreeNode, type WatchEvent } from '@shared/types'

// The folder-page toggle writes through the shared one-key card writer (🔒 D1/D3, YAZ-817);
// mocked here the way every other writeProperty caller's tests mock it.
vi.mock('../bases/writeProperty', () => ({ writeProperty: vi.fn() }))
import { writeProperty } from '../bases/writeProperty'
import { countChildren, Sidebar } from './Sidebar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TREE: TreeNode[] = [
  { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
  { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
]

/** Just the bridge surface the Sidebar tree touches (the jsdom stub pattern, App.test.tsx). */
function installBridge() {
  const bridge = {
    tree: vi.fn(async (root: string) => ({ root, tree: TREE, generatedAt: 1 })),
    // The delete confirm sheet reads the index for its backlink count (GRO-2272 C3).
    index: vi.fn(async (root: string) => ({ root, records: [] as unknown[], generatedAt: 1 })),
    // The inline-create flow (GRO-2022; "New folder page" YAZ-841). `createFile` takes the bare
    // path OR `{ path, content }` — the content form is the atomic born-with-frontmatter call.
    createFile: vi.fn(async (req: string | { path: string; content?: string }) => ({ path: typeof req === 'string' ? req : req.path, mtime: 2, size: 0 })),
    createDir: vi.fn(async (path: string) => ({ path })),
    state: { setFolder: vi.fn(async () => undefined) },
    window: { open: vi.fn(async () => undefined) },
    // Reveal in Finder (GRO-2274) goes through the shell namespace.
    shell: { reveal: vi.fn(async ({ path }: { path: string }) => ({ path })) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let root: Root | null = null
let container: HTMLElement | null = null

type SidebarProps = Parameters<typeof Sidebar>[0]

async function mount(over: Partial<SidebarProps> = {}, tweakBridge?: (bridge: ReturnType<typeof installBridge>) => void) {
  const bridge = installBridge()
  tweakBridge?.(bridge) // before the first render: the loading/error tree states only exist there
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  const props: SidebarProps = {
    root: '/v',
    activeFile: null,
    watch: { subscribe: () => () => undefined },
    onOpenFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    onPickFolder: vi.fn(),
    pickDisabled: false,
    onCollapse: vi.fn(),
    // Every test below this line is about the FILE TREE, so the harness mounts the FILES lens
    // (YAZ-847). The app's own default is Topics — App owns and persists the value, and the
    // "lens tabs" describe mounts each lens explicitly, including the default.
    lens: 'files',
    onLensChange: vi.fn(),
    settings: { ...DEFAULT_SETTINGS },
    onChangeSettings: vi.fn(),
    onRootMissing: vi.fn(),
    onFileMissing: vi.fn(),
    onRenameFile: vi.fn(async () => undefined),
    onDeleteFile: vi.fn(async () => undefined),
    onNotice: vi.fn(),
    // The window's already-on index feed (WikilinkIndexBridge's source): empty unless a test
    // hands over a snapshot, which is exactly the pre-first-index state.
    indexSource: { resolve: null, records: [], subscribe: () => () => undefined },
    pendingSearchFocus: false,
    onSearchFocusHandled: vi.fn(),
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Sidebar {...props} /></StrictMode>))
  /** Re-render the SAME Sidebar instance with changed props (the App-driven activation path). */
  const rerender = async (next: Partial<SidebarProps>) =>
    act(async () => root?.render(<StrictMode><Sidebar {...props} {...next} /></StrictMode>))
  return { bridge, props, el, rerender }
}

const fileRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file')
const searchInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')
/**
 * Drive the CONTROLLED search input like a user: native value setter + input event (SettingsPanel
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
const menuItems = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
const itemByLabel = (el: HTMLElement, label: string) => menuItems(el).find((b) => b.textContent === label)

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
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

  it('the file row context menu offers "Open in new window" next to "Copy path"; it routes to the bridge and closes', async () => {
    const { bridge, props, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels).toContain('Open in new window')
    expect(labels).toContain('Copy path')
    act(() => itemByLabel(el, 'Open in new window')?.click())
    expect(bridge.window.open).toHaveBeenCalledTimes(1)
    expect(bridge.window.open).toHaveBeenCalledWith({ root: '/v', file: '/v/a.md' })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('folder rows and blank space get no "Open in new window" item', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Open in new window')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Open in new window')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
  })
})

describe('Sidebar copy link (E3, GRO-2173)', () => {
  /** jsdom has no navigator.clipboard; the menu items call writeText, so stub just that. */
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('the file row context menu offers "Copy link" next to "Copy path"; it puts the yaseendocs:// link on the clipboard and closes', async () => {
    const writeText = installClipboard()
    const { el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels.indexOf('Copy link')).toBe(labels.indexOf('Copy path') + 1)
    act(() => itemByLabel(el, 'Copy link')?.click())
    // The exact fileLink('/v/a.md') bytes — the link main's parseFileLink round-trips (links.test.ts).
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('yaseendocs:///v/a.md')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('folder rows and blank space get no "Copy link" (a folder link would only fail the markdown guard)', async () => {
    installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy link')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy link')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
  })
})

describe('Sidebar folder rename + file drag-move (E1b, GRO-2241)', () => {
  /** Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard `dataTransfer` (the TabBar idiom). */
  const fire = (target: Element | null | undefined, type: string) =>
    act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))
  const dirRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--dir')

  it('a FOLDER row\'s context menu offers "Rename"; committing routes old→new (no extension logic) through onRenameFile', async () => {
    const { props, el } = await mount()
    act(() => void dirRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('sub') // the raw folder name — no extension stripping for dirs
    act(() => {
      input!.value = 'archive'
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    expect(props.onRenameFile).toHaveBeenCalledWith('/v/sub', '/v/archive')
  })

  it('dragging a file row onto a folder row moves it there (onRenameFile old→new parent); the target highlights while hovered', async () => {
    const { props, el } = await mount()
    fire(fileRow(el), 'dragstart')
    fire(dirRow(el), 'dragover')
    expect(dirRow(el)?.classList.contains('tree__row--drop')).toBe(true)
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledWith('/v/a.md', '/v/sub/a.md')
    expect(el.querySelector('.tree__row--drop')).toBeNull() // drag state cleared
  })

  it('dropping on the ROOT HEADER targets the vault root — a no-op for a file already there; dragend abandons cleanly', async () => {
    const { props, el } = await mount()
    const header = el.querySelector<HTMLElement>('.sidebar__header')
    fire(fileRow(el), 'dragstart')
    fire(header, 'dragover')
    expect(header?.classList.contains('sidebar__header--drop')).toBe(true)
    fire(header, 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // `/v/a.md` already lives at the root
    fire(fileRow(el), 'dragstart')
    fire(fileRow(el), 'dragend')
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // an abandoned drag drops nothing
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
    expect(props.onFileMissing).not.toHaveBeenCalled()
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

  it('a FILE row targets every item: rename, copy path, copy link, open in new window', async () => {
    const el = await open('.tree__row--file')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'Copy link')).toBeDefined()
    expect(itemByLabel(el, 'Open in new window')).toBeDefined()
  })

  it('a FOLDER row targets rename and copy path; the file-only items stay hidden', async () => {
    const el = await open('.tree__row--dir')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'Copy link')).toBeUndefined()
    expect(itemByLabel(el, 'Open in new window')).toBeUndefined()
  })

  it('BLANK SPACE shows no Rename — the vault root is never renameable (the GRO-2297 guard rail)', async () => {
    const el = await open('.sidebar__body')
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
    expect(itemByLabel(el, 'Copy link')).toBeUndefined()
    expect(itemByLabel(el, 'Open in new window')).toBeUndefined()
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

  it('clicking Delete opens the confirm sheet and deletes NOTHING yet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)).not.toBeNull()
    expect(props.onDeleteFile).not.toHaveBeenCalled()
  })

  it('confirming calls onDeleteFile with the absolute path', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('cancelling calls nothing and closes the sheet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(props.onDeleteFile).not.toHaveBeenCalled()
    expect(sheet(el)).toBeNull()
  })

  it('a FOLDER target shows the sheet and deletes the folder path', async () => {
    const { el, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)?.textContent).toContain('"sub"')
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })

  it('"Don\'t ask me again" persists confirmDelete: false through onChangeSettings', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    act(() => void el.querySelector<HTMLInputElement>('.confirm__ask input')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onChangeSettings).toHaveBeenCalledWith(expect.objectContaining({ confirmDelete: false }))
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('shows the backlink count when notes link to the target', async () => {
    // One note whose body link resolves to a.md — the shared resolver is what countLinkReferences uses.
    // The TARGET must be in the record set too: the shared resolver resolves a link NAME
    // against the indexed records, so without a.md there is nothing for [[a]] to point at.
    // `basename` (no extension) and `folder` are what the shared resolver matches on — a
    // record missing them resolves nothing, which is how the first draft of this test passed
    // vacuously against an empty count.
    const rec = (base: string, links: string[] = []) => ({
      path: `/v/${base}.md`, name: `${base}.md`, basename: base, folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links, embeds: [],
    })
    const records = [rec('a'), rec('hub', ['a'])]
    const m = await mount()
    m.bridge.index.mockResolvedValue({ root: '/v', records, generatedAt: 1 } as never)
    act(() => void m.el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(m.el)?.textContent).toContain('1 note links to this')
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
    expect(m.props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
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
    act(() => itemByLabel(el, 'Reveal in Finder')?.click())
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
  })

  it('a FOLDER row reveals the folder itself — no branching on kind', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'Reveal in Finder')?.click())
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub' })
  })

  it('BLANK SPACE reveals the vault root — unlike Delete, which has no blank-space target', async () => {
    const { el, bridge } = await openOn('.sidebar__body')
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
    act(() => itemByLabel(el, 'Reveal in Finder')?.click())
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v' })
  })

  it('a stale row surfaces a passive notice rather than looking like a dead menu item', async () => {
    const { el, bridge, props } = await openOn('.tree__row--file')
    bridge.shell.reveal.mockRejectedValue(Object.assign(new Error('path does not exist'), { code: 'NOT_FOUND' }))
    await act(async () => itemByLabel(el, 'Reveal in Finder')?.click())
    await act(async () => undefined)
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('no longer there'))
  })

  it('closes the menu after revealing', async () => {
    const { el } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Reveal in Finder')?.click())
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
 * The persistent search bar (YAZ-801): row 2 of the sidebar chrome, ALWAYS present — loading,
 * error and empty vault included, since a bar that comes and goes with the tree would be a view,
 * which is exactly what the rescinded design was. Typing changes nothing below on purpose;
 * YAZ-803 swaps the body to results. The ⌘K focus handshake has no key binding yet (YAZ-804),
 * so it is driven here through the prop — including at MOUNT, which is the ⌘K-while-collapsed path.
 */
describe('persistent search bar (YAZ-801)', () => {
  const pressEscape = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

  it('renders while the tree is still loading', async () => {
    const { el } = await mount({}, (b) => b.tree.mockImplementation(() => new Promise(() => undefined)))
    expect(el.textContent).toContain('Loading…')
    expect(searchInput(el)).not.toBeNull()
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

  it('Escape with text clears the query and KEEPS focus', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    act(() => input.focus())
    await type(input, 'meeting')
    pressEscape(input)
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('Escape with an empty input gives up focus', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    act(() => input.focus())
    pressEscape(input)
    expect(document.activeElement).not.toBe(input)
  })

  it('mounting with pendingSearchFocus focuses the input and reports back (⌘K while collapsed)', async () => {
    const { el, props } = await mount({ pendingSearchFocus: true })
    expect(document.activeElement).toBe(searchInput(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('flipping pendingSearchFocus false → true on a mounted sidebar focuses the input and reports back', async () => {
    const { el, props, rerender } = await mount()
    expect(document.activeElement).not.toBe(searchInput(el))
    await rerender({ pendingSearchFocus: true })
    expect(document.activeElement).toBe(searchInput(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('a plain mount steals no focus', async () => {
    const { el, props } = await mount()
    expect(document.activeElement).not.toBe(searchInput(el))
    expect(props.onSearchFocusHandled).not.toHaveBeenCalled()
  })
})

/**
 * Search results in the body (YAZ-803, 🔒 flat-list ruling on YAZ-739): a typed query swaps the
 * tree for a FLAT ranked list and clearing brings the tree straight back — the swap is a
 * conditional render, so nothing about the tree is torn down. The list is driven entirely from
 * the bar, which never loses focus: arrows clamp at both ends (no wrap, the `[[` picker's rule),
 * Enter opens in place, ⌘Enter in a background tab, and the list stays up either way.
 */
describe('search results (YAZ-803)', () => {
  const record = (basename: string, folder = '') => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`, name: `${basename}.md`, basename, folder, ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  })
  const RECORDS = [record('Alpha'), record('Anchor', 'Docs')]

  /** Mount over an index of Alpha + Docs/Anchor, then type `query` into the bar. */
  const search = async (query: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over, (b) => b.index.mockResolvedValue({ root: '/v', records: RECORDS, generatedAt: 1 } as never))
    const input = searchInput(m.el)!
    await type(input, query)
    return { ...m, input }
  }
  const rowLabels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__row .search-results__label')].map((n) => n.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('.search-results__row--active .search-results__label')?.textContent ?? null
  const press = (input: HTMLInputElement, key: string, metaKey = false) =>
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))

  it('typing swaps the tree for the ranked result list; clearing brings the tree back', async () => {
    const { el, input } = await search('a')
    expect(el.querySelector('.tree')).toBeNull()
    expect(rowLabels(el)).toEqual(['Alpha', 'Anchor'])
    await type(input, '')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(el.querySelector('.tree__row--file')).not.toBeNull()
  })

  it('a query nothing matches says so, and still hides the tree', async () => {
    const { el } = await search('zzz')
    expect(el.textContent).toContain('No matches')
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('a folder label rides along on rows that have one', async () => {
    const { el } = await search('anch')
    expect(el.querySelector('.search-results__folder')?.textContent).toBe('Docs')
  })

  it('the top row starts selected; ArrowDown/ArrowUp clamp at both ends and never wrap', async () => {
    const { el, input } = await search('a')
    expect(activeLabel(el)).toBe('Alpha')
    await press(input, 'ArrowUp')
    expect(activeLabel(el)).toBe('Alpha') // already at the top
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor')
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor') // already at the bottom
    await press(input, 'ArrowUp')
    expect(activeLabel(el)).toBe('Alpha')
  })

  it('Enter opens the SELECTED row in the current tab and leaves the list up', async () => {
    const { el, input, props } = await search('a')
    await press(input, 'ArrowDown')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Anchor.md')
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    expect(input.value).toBe('a')
    expect(rowLabels(el)).toEqual(['Alpha', 'Anchor'])
  })

  it('⌘Enter opens the selected row in a background tab instead', async () => {
    const { input, props } = await search('a')
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/Alpha.md')
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('changing the query re-selects the top row', async () => {
    const { el, input } = await search('a')
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor')
    await type(input, 'an')
    expect(activeLabel(el)).toBe('Anchor') // the new ranking's FIRST row, not the carried index
    expect(rowLabels(el)).toEqual(['Anchor'])
  })

  it('an index refresh that shrinks the list keeps the highlight on the LAST row, and Enter opens that row (YAZ-808)', async () => {
    // The watcher fans out to every subscriber (useWatch's shape) — here the tree's and search's.
    const listeners: ((ev: WatchEvent) => void)[] = []
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        listeners.push(l)
        return () => void listeners.splice(listeners.indexOf(l), 1)
      },
    }
    const { el, input, bridge, props } = await search('a', { watch })
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor') // index 1 of two rows
    bridge.index.mockResolvedValue({ root: '/v', records: [record('Alpha')], generatedAt: 2 } as never)
    await act(async () => [...listeners].forEach((l) => l({ type: 'unlink', path: '/v/Docs/Anchor.md' })))
    expect(rowLabels(el)).toEqual(['Alpha'])
    expect(activeLabel(el)).toBe('Alpha') // the stale index 1 clamps onto the last row, not onto nothing
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Alpha.md')
  })

  it('right-clicking the results offers no menu — "New note" there would have no target', async () => {
    const { el } = await search('a')
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * The lens tabs (🔒 D4/D5, YAZ-847): chrome v2 ROW 1, above the persistent search bar. Topics is
 * the DEFAULT lens and — until YAZ-848 fills it — an empty shell; Files is today's file explorer,
 * unchanged, behind a tab. The VALUE is App's (globally persisted as `AppState.sidebarLens`): the
 * sidebar renders the row and reports clicks, and App hands the new lens back down. Switching is
 * a conditional render, never a teardown — the search wave's rule, re-proved here on the tree's
 * expansion. Search keeps working from both lenses and the query survives a lens switch (🔒 D5).
 */
describe('lens tabs (🔒 D4/D5, YAZ-847)', () => {
  const record = (basename: string, folder = '') => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`, name: `${basename}.md`, basename, folder, ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  })
  const RECORDS = [record('Alpha'), record('Anchor', 'Docs')]
  const withIndex = (b: ReturnType<typeof installBridge>) => b.index.mockResolvedValue({ root: '/v', records: RECORDS, generatedAt: 1 } as never)

  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses[role="tablist"] [role="tab"]')]
  const tabByLabel = (el: HTMLElement, label: string) => tabs(el).find((b) => b.textContent === label)
  const selectedTabs = (el: HTMLElement) => tabs(el).filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.textContent)
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const resultLabels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__row .search-results__label')].map((n) => n.textContent)
  const dirItem = (el: HTMLElement) => el.querySelector('.tree__row--dir')?.closest('[role="treeitem"]') ?? null

  it('renders a tablist of exactly Topics then Files, the active one aria-selected and no other', async () => {
    const { el } = await mount({ lens: 'topics' })
    expect(tabs(el).map((b) => b.textContent)).toEqual(['Topics', 'Files'])
    expect(selectedTabs(el)).toEqual(['Topics'])
    const files = await mount({ lens: 'files' })
    expect(selectedTabs(files.el)).toEqual(['Files'])
  })

  it('the default lens is Topics: a placeholder body, no tree — and the search bar is still there', async () => {
    const { el } = await mount({ lens: 'topics' })
    expect(el.querySelector('.tree')).toBeNull()
    expect(bodyMsg(el)).toContain('YAZ-848')
    expect(searchInput(el)).not.toBeNull() // ALWAYS visible, on both lenses (the locked YAZ-739 rule)
  })

  it('the Files lens is today\'s tree, unchanged', async () => {
    const { el } = await mount({ lens: 'files' })
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(fileRow(el)?.textContent).toBe('a')
  })

  it('clicking a tab reports UP to App and flips nothing by itself — the value is App\'s', async () => {
    const { el, props } = await mount({ lens: 'topics' })
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(selectedTabs(el)).toEqual(['Topics']) // still Topics until App hands the new lens back
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('App handing the new lens back down is what swaps the body', async () => {
    const { el, rerender } = await mount({ lens: 'topics' })
    await rerender({ lens: 'files' })
    expect(selectedTabs(el)).toEqual(['Files'])
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(bodyMsg(el)).toBeNull()
  })

  it('switching Files → Topics → Files never tears the tree down: its expansion is waiting', async () => {
    const { el, rerender } = await mount({ lens: 'files' })
    const before = dirItem(el)?.getAttribute('aria-expanded')
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--dir')?.click())
    const toggled = dirItem(el)?.getAttribute('aria-expanded')
    expect(toggled).not.toBe(before)
    await rerender({ lens: 'topics' })
    expect(el.querySelector('.tree')).toBeNull()
    await rerender({ lens: 'files' })
    expect(dirItem(el)?.getAttribute('aria-expanded')).toBe(toggled)
  })

  it('a query on TOPICS replaces the placeholder with the flat results; clearing brings the placeholder back', async () => {
    const { el } = await mount({ lens: 'topics' }, withIndex)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(resultLabels(el)).toEqual(['Alpha', 'Anchor'])
    expect(bodyMsg(el)).toBeNull()
    await type(input, '')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(bodyMsg(el)).toContain('YAZ-848')
  })

  it('the tabs row stays visible and clickable DURING a search, and a lens switch keeps the query (🔒 D5)', async () => {
    const { el, props, rerender } = await mount({ lens: 'topics' }, withIndex)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(selectedTabs(el)).toEqual(['Topics'])
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    await rerender({ lens: 'files' })
    expect(input.value).toBe('a') // the query is untouched by the switch…
    expect(resultLabels(el)).toEqual(['Alpha', 'Anchor']) // …and still replaces the ACTIVE tab's body
    expect(el.querySelector('.tree')).toBeNull()
    await type(input, '')
    expect(el.querySelector('.tree')).not.toBeNull() // clearing lands on the lens that is now active
  })

  it('right-clicking the Topics placeholder offers no menu — the blank-space menu is the TREE\'s', async () => {
    const { el } = await mount({ lens: 'topics' })
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('context menu order (GRO-2272 C1a)', () => {
  it('a FILE row renders utilities, then create actions, then Rename and Delete last', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((b) => b.textContent?.replace('▸', '').trim())).toEqual([
      'Open in new window',
      'Reveal in Finder',
      'Copy path',
      'Copy link',
      'New note',
      // "New folder page" (🔒 D4, YAZ-817): second in the create group, directly after the
      // note it is a kind of — it CREATES beside the right-clicked row, so it stays in the
      // create group and never drifts down to the act-on-this-row toggle.
      'New folder page',
      'New folder',
      // The folder-page toggle joins the row between the create group and Rename (🔒 D2,
      // YAZ-817): it acts on the right-clicked page, so it belongs with the other
      // act-on-this-row items — and above the destructive pair, which stays last.
      'Turn into folder page',
      'Rename',
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
 * "New folder page" (YAZ-841 — 🔒 D4 + D1 on YAZ-817): the create group's second item, and the
 * only birth gesture for a folder page. It is the EXISTING inline-create flow with one branch at
 * the end — same validation, same placement rule (the file lands where the right-click happened),
 * same open-after-create — so the page is born through `createNewNote` carrying exactly
 * `folder_page: true` and NOTHING else (🔒 D1: the flag alone is the whole declaration; Q7
 * defaults render it once 5- ships, and 4C's panel writes settings only when the user picks some).
 */
describe('New folder page (🔒 D4 / 🔒 D1, YAZ-841)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')
  const errorText = (el: HTMLElement) => el.querySelector('.create-inline__error')?.textContent ?? null
  /** Type a name into the open inline input and commit it with Enter. */
  const commit = async (el: HTMLElement, name: string) => {
    const field = input(el)!
    await act(async () => {
      field.value = name
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }
  /** The birth content (🔒 D1): one frontmatter block, one key, no body. */
  const FLAG_ONLY = '---\nfolder_page: true\n---\n'

  it('is offered wherever the create group is — file rows, folder rows and blank space alike', async () => {
    for (const selector of ['.tree__row--file', '.tree__row--dir', '.sidebar__body']) {
      const { el } = await openOn(selector)
      expect(itemByLabel(el, 'New folder page')).toBeDefined()
    }
  })

  it('opens the SAME inline input as New note, under its own placeholder, and closes the menu', async () => {
    const { el } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder page')?.click())
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(input(el)).not.toBeNull()
    expect(input(el)?.placeholder).toBe('New folder page')
  })

  it('committing a name creates the page born with EXACTLY the flag, in the right-clicked folder, then opens it', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder page')?.click())
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Growth.md', content: FLAG_ONLY })
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Growth.md')
    expect(input(el)).toBeNull() // the input is done
  })

  it('takes the same placement rule as New note: a FILE row creates beside it, blank space at the root', async () => {
    const onFile = await openOn('.tree__row--file')
    act(() => itemByLabel(onFile.el, 'New folder page')?.click())
    await commit(onFile.el, 'Growth')
    expect(onFile.bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Growth.md', content: FLAG_ONLY })

    const onBlank = await openOn('.sidebar__body')
    act(() => itemByLabel(onBlank.el, 'New folder page')?.click())
    await commit(onBlank.el, 'Growth')
    expect(onBlank.bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Growth.md', content: FLAG_ONLY })
  })

  it('leaves New note alone — the same flow with no seed at all, still the bare-path call', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Growth.md')
  })

  it('validates through the SHARED path: an invalid name gives New note\'s exact error and writes nothing', async () => {
    const note = await openOn('.tree__row--dir')
    act(() => itemByLabel(note.el, 'New note')?.click())
    await commit(note.el, 'a/b')
    const shared = errorText(note.el)
    expect(shared).not.toBeNull()
    expect(note.bridge.createFile).not.toHaveBeenCalled()

    const page = await openOn('.tree__row--dir')
    act(() => itemByLabel(page.el, 'New folder page')?.click())
    await commit(page.el, 'a/b')
    expect(errorText(page.el)).toBe(shared)
    expect(page.bridge.createFile).not.toHaveBeenCalled()
    expect(input(page.el)).not.toBeNull() // the input stays open to fix the name
  })
})

/**
 * The folder-page toggle (YAZ-840 — 🔒 D1/D2/D3/D5 on YAZ-817): the first user-facing
 * folder-page gesture. ONE state-aware item on MARKDOWN FILE rows, both directions through the
 * one frontmatter key.
 *
 *  - forward (🔒 D1) is IMMEDIATE and writes exactly `folder_page: true` — no settings stamped,
 *    and no confirm to click through for something this same item undoes;
 *  - reverse (🔒 D5) asks first, and on confirm DELETES the key (🔒 D3) — `folder_page_settings`
 *    and every member note's `folder_pages` entry are left exactly where they are.
 *
 * The flag state behind the label comes off the window's ALREADY-ON index feed (the same
 * snapshot WikilinkIndexBridge pushes at the wikilink resolver), read when the menu opens — no
 * second feed and no fetch of its own.
 */
describe('folder-page toggle (YAZ-840)', () => {
  const write = vi.mocked(writeProperty)

  const MIXED_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  const record = (path: string, properties: Record<string, unknown> = {}) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.[^.]+$/, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }
  }
  /** A stubbed index feed holding this snapshot — the shape App hands over from the bridge's source. */
  const feed = (...records: ReturnType<typeof record>[]): SidebarProps['indexSource'] =>
    ({ resolve: null, records, subscribe: () => () => undefined }) as SidebarProps['indexSource']

  /** Mount over the mixed tree, then right-click one row (or the blank body). */
  const openOn = async (selector: string, indexSource: SidebarProps['indexSource']) => {
    const m = await mount({ indexSource }, (b) =>
      b.tree.mockImplementation(async (r: string) => ({ root: r, tree: MIXED_TREE, generatedAt: 1 })),
    )
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }

  const sheetText = (el: HTMLElement) => el.querySelector('#confirm-turn-back-text')?.textContent ?? null
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  beforeEach(() => {
    write.mockReset()
    write.mockResolvedValue({ mtime: 2 })
  })

  it('offers "Turn into folder page" on a markdown row whose flag is off', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
    expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()
  })

  it('offers "Turn back into normal page" once that row IS a folder page', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    expect(itemByLabel(el, 'Turn back into normal page')).toBeDefined()
    expect(itemByLabel(el, 'Turn into folder page')).toBeUndefined()
  })

  it('reads the flag through isFolderPage — only the boolean true is on', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: 'true' })))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
  })

  it('shows no toggle at all on folder rows or on blank space', async () => {
    for (const selector of ['.tree__row--dir', '.sidebar__body']) {
      const { el } = await openOn(selector, feed(record('/v/a.md', { folder_page: true })))
      expect(itemByLabel(el, 'Turn into folder page')).toBeUndefined()
      expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()
      expect(el.querySelector('.ctx-menu')).not.toBeNull() // the menu itself is still there
    }
  })

  it('FORWARD writes exactly the flag and nothing else, with NO confirm sheet (🔒 D1)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    await act(async () => itemByLabel(el, 'Turn into folder page')?.click())
    expect(write).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'folder_page', true)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('REVERSE opens the sheet with the LOCKED copy and writes nothing yet (🔒 D5)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    expect(sheetText(el)).toBe(
      "Turn 'a.md' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.",
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('Cancel on the sheet writes NOTHING and closes it', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('confirming DELETES the key — lossless, settings untouched (🔒 D3)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Turn back')?.click())
    expect(write).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'folder_page', undefined)
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a failed write surfaces as the passive notice — never a dialog', async () => {
    write.mockRejectedValue(new Error('read-only volume'))
    const { el, props } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    await act(async () => itemByLabel(el, 'Turn into folder page')?.click())
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('read-only volume'))
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a failed turn-BACK names that direction in the notice', async () => {
    write.mockRejectedValue(new Error('read-only volume'))
    const { el, props } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Turn back')?.click())
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('back into a normal page'))
  })
})
