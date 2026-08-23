/**
 * Sidebar file-row gestures: ⌘-click opens a BACKGROUND TAB in this window (I3 LOCKED ruling,
 * GRO-2235); the row's context-menu "Open in new window" still opens a new window on
 * {root, file} over the bridge (D2, GRO-2168) — either way the current window's active file
 * is untouched (onOpenFile never fires). Plain click and folder/blank-space context menus are
 * unchanged, and activating a stale tab probes a fresh tree before onFileMissing fires.
 * Real Tree/ContextMenu render against the jsdom bridge stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type TreeNode, type WatchEvent } from '@shared/types'
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
    state: { setFolder: vi.fn(async () => undefined) },
    window: { open: vi.fn(async () => undefined) },
    // Empty registry (GRO-2202; Round 10 Q4, GRO-2226): the sidebar reads it for "New ▸",
    // which is always present — empty collapses it to the single "New type…" item.
    registry: {
      get: vi.fn(async (root: string) => ({ root, version: 1, types: {}, properties: {} })),
      onChange: vi.fn(() => () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let root: Root | null = null
let container: HTMLElement | null = null

type SidebarProps = Parameters<typeof Sidebar>[0]

async function mount(over: Partial<SidebarProps> = {}) {
  const bridge = installBridge()
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
    settings: { ...DEFAULT_SETTINGS },
    onChangeSettings: vi.fn(),
    onRootMissing: vi.fn(),
    onFileMissing: vi.fn(),
    onRenameFile: vi.fn(async () => undefined),
    onDeleteFile: vi.fn(async () => undefined),
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Sidebar {...props} /></StrictMode>))
  /** Re-render the SAME Sidebar instance with changed props (the App-driven activation path). */
  const rerender = async (next: Partial<SidebarProps>) =>
    act(async () => root?.render(<StrictMode><Sidebar {...props} {...next} /></StrictMode>))
  return { bridge, props, el, rerender }
}

const fileRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file')
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
