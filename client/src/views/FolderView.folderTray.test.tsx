/**
 * A whole subfolder to Other files (YAZ-4747 13BK, OF1-OF6): `FolderView` over a REAL `WikilinkResolveSource` and the
 * Files tree, with the `api` mock under the real writer over a tiny in-memory disk, as `FolderView.otherFiles.test.tsx`
 * mounts it (that file pins a PAGE's move). The page `recipes` holds Soup, and three subfolders: `Desserts` (Apple pie,
 * Brownies, and `Cakes` with Sponge), `Drinks` (Tea) and `Empty` (a PDF only). None of them has a `.folder.md`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { FileKind, IndexRecord, TreeNode } from '@shared/types'
import { linkResolver, vaultDirs } from '../links/folderLinks'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { fetchTree } from '../lib/treeFeed'
import { storage } from '../lib/storage'
import { SWITCH_MS } from '../components/Flyout'
import { click, flush, q, rec, renderFolderView, unmountFolderView } from './testFolderView'
import { folderTrayMessage, type FolderViewProps } from './FolderView'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  // The tray's open state (OF3) goes through `storage` to the bridge: a plain answer, which `resetAllMocks` leaves alone.
  api: { readFile: vi.fn(), writeFile: vi.fn(), tree: vi.fn(), state: { setBaseGroups: async () => undefined } },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const RECIPES = '/vault/recipes'
const SETTINGS_FILE = '/vault/recipes/.folder.md'
const DESSERTS = `${RECIPES}/Desserts`
const CAKES = `${DESSERTS}/Cakes`
const DRINKS = `${RECIPES}/Drinks`
const EMPTY = `${RECIPES}/Empty`
const SOUP = `${RECIPES}/Soup.md`
const APPLE = `${DESSERTS}/Apple pie.md`
const BROWNIES = `${DESSERTS}/Brownies.md`
const SPONGE = `${CAKES}/Sponge.md`
const TEA = `${DRINKS}/Tea.md`

/** The page's settings: one table, with its Subfolders mode (`pages` is the default, "Their pages") and an optional grouping. */
const settingsFile = (subfolders: 'pages' | 'rows' | 'both' | 'hide', extra = ''): string => `---
folder_settings:
  views:
    - type: table
      name: Table
      subfolders: ${subfolders}
${extra}---
`
const file = (dir: string, name: string, kind: FileKind | null): TreeNode => ({ type: 'file', name, path: `${dir}/${name}`, size: 2048, mtime: 1_700_000_000_000, kind })
const TREE: TreeNode[] = [
  {
    type: 'dir',
    name: 'recipes',
    path: RECIPES,
    children: [
      {
        type: 'dir',
        name: 'Desserts',
        path: DESSERTS,
        children: [
          { type: 'dir', name: 'Cakes', path: CAKES, children: [file(CAKES, 'Sponge.md', 'markdown')] },
          file(DESSERTS, 'Apple pie.md', 'markdown'),
          file(DESSERTS, 'Brownies.md', 'markdown'),
          file(DESSERTS, 'menu.pdf', 'pdf'),
        ],
      },
      { type: 'dir', name: 'Drinks', path: DRINKS, children: [file(DRINKS, 'Tea.md', 'markdown')] },
      { type: 'dir', name: 'Empty', path: EMPTY, children: [file(EMPTY, 'scan.pdf', 'pdf')] },
      file(RECIPES, 'Soup.md', 'markdown'),
    ],
  },
]

let source: MutableWikilinkResolveSource
let disk: Map<string, { content: string; mtime: number }>
let clock = 100

/** The index's snapshot of the disk: the pages, and the page's settings record. A link resolves to a folder too, as the window's does. */
function feed(): void {
  const records: IndexRecord[] = [rec(SOUP), rec(APPLE), rec(BROWNIES), rec(SPONGE), rec(TEA)]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, false))
}

async function mount(subfolders: 'pages' | 'rows' | 'both' | 'hide', extra: Partial<FolderViewProps> = {}, settingsExtra = ''): Promise<HTMLElement> {
  disk.set(SETTINGS_FILE, { content: settingsFile(subfolders, settingsExtra), mtime: 50 })
  const el = renderFolderView({ path: RECIPES, source, onOpenFile: () => undefined, ...extra })
  feed()
  await flush()
  return el
}

/** A write lands, then the index echoes it. */
async function settle(): Promise<void> {
  await flush()
  feed()
  await flush()
}

beforeEach(async () => {
  source = createWikilinkResolveSource()
  disk = new Map()
  storage.setViewGroups('/vault', `${RECIPES}::`, []) // the tray and its folders' open state (OF3), kept per page across mounts
  vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: TREE, generatedAt: 1 })
  await fetchTree('/vault')
  readFile.mockImplementation(async (path) => {
    const f = disk.get(path)
    if (f === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
    return { path, ...f, size: f.content.length }
  })
  writeFile.mockImplementation(async ({ path, content, expectedMtime }) => {
    const was = disk.get(path)?.mtime ?? 0
    if (expectedMtime !== undefined && expectedMtime !== was) throw new BridgeRequestError('CONFLICT', 'file changed')
    disk.set(path, { content, mtime: ++clock })
    return { path, mtime: clock, size: content.length }
  })
})

afterEach(() => {
  vi.useRealTimers()
  unmountFolderView()
  vi.resetAllMocks()
})

/** The page's `folder_settings` block as it stands on disk. */
const block = (): Record<string, unknown> => parseFrontmatter(splitFrontmatter(disk.get(SETTINGS_FILE)!.content).frontmatter).properties.folder_settings as Record<string, unknown>
/** A Name cell's text without a folder row's "N inside". */
const cellName = (cell: Element): string => {
  const copy = cell.cloneNode(true) as Element
  copy.querySelector('.view-folder-row__inside')?.remove()
  return copy.textContent ?? ''
}
const rowNames = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map(cellName)
const nameCell = (el: ParentNode, name: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table__name')].find((c) => cellName(c) === name)!
const trayNames = (el: ParentNode): string[] => [...el.querySelectorAll('.other-files__line')].map((l) => l.querySelector('.other-files__name')?.textContent ?? '')
const trayLine = (el: ParentNode, name: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.other-files__line')].find((l) => l.querySelector('.other-files__name')?.textContent === name)!
const rightClick = (target: Element): void => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
/** The main menu's rows, a flyout's left out. */
const mainItems = (el: ParentNode): string[] => [...el.querySelectorAll('[role="menuitem"]')].filter((b) => b.closest('.ctx-menu__sub') === null).map((b) => b.textContent ?? '')
const menuItem = (el: ParentNode, text: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === text)!
const flyoutItems = (el: ParentNode): string[] => [...el.querySelectorAll('.ctx-menu__sub [role="menuitem"]')].map((b) => b.textContent ?? '')
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (scope: ParentNode, text: string): HTMLElement => [...scope.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === text)!
/** The pointer comes to rest on `to`, from `from`: React's enter/leave from the `mouseout`, the menus' own listeners from the `mouseover`. */
const pointer = (from: Element | null, to: Element): void =>
  act(() => {
    from?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }))
    to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }))
  })

describe('folderTrayMessage: the ask\'s line (OF2)', () => {
  it('counts the pages, one and many, and names where they are', () => {
    expect(folderTrayMessage(0, [])).toBe('It holds 0 pages. Move them with it, and they leave this table. Move the folder only, and they stay.')
    expect(folderTrayMessage(1, [])).toBe('It holds 1 page. Move them with it, and they leave this table. Move the folder only, and they stay.')
    expect(folderTrayMessage(3, ['Cakes'])).toBe('It holds 3 pages, with the ones in Cakes. Move them with it, and they leave this table. Move the folder only, and they stay.')
    expect(folderTrayMessage(4, ['Cakes', 'Pies'])).toMatch(/^It holds 4 pages, with the ones in Cakes and Pies\. /)
    // Past two subfolders, a count of them.
    expect(folderTrayMessage(9, ['A', 'B', 'C'])).toMatch(/^It holds 9 pages, with the ones in its 3 subfolders\. /)
  })
})

describe('a folder row\'s "Move to Other files" (OF1, Subfolders: Both)', () => {
  it('a folder row has the plain item, no flyout and no "(folder)"; a page of the page itself has the plain item too', async () => {
    const el = await mount('both')
    expect(rowNames(el)).toEqual(expect.arrayContaining(['Desserts', 'Drinks', 'Empty', 'Soup', 'Apple pie', 'Brownies', 'Sponge', 'Tea']))
    rightClick(nameCell(el, 'Desserts'))
    expect(mainItems(el)).toContain('Move to Other files')
    expect(menuItem(el, 'Move to Other files').getAttribute('aria-haspopup')).toBeNull()
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    rightClick(nameCell(el, 'Soup'))
    expect(menuItem(el, 'Move to Other files').getAttribute('aria-haspopup')).toBeNull()
  })

  it('many pages: the ask names them and Cakes; "Move the folder and its pages" writes the folder\'s link, the folder and its pages leave the table, the tray shows its line', async () => {
    const onNotice = vi.fn()
    const el = await mount('both', { onNotice })
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    const ask = dialog()!
    expect(ask.textContent).toContain('Move Desserts (folder) to Other files?')
    expect(ask.textContent).toContain(folderTrayMessage(3, ['Cakes']))
    // Its three answers: the folder only, Cancel, and the default.
    expect([...ask.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Move the folder only', 'Cancel', 'Move the folder and its pages']))
    expect(document.activeElement?.textContent).toBe('Move the folder and its pages')
    expect(writeFile).not.toHaveBeenCalled()
    click(button(ask, 'Move the folder and its pages'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toEqual(['[[Desserts]]'])
    expect(block().other_files_keep_pages).toBeUndefined()
    expect(rowNames(el)).toEqual(expect.arrayContaining(['Drinks', 'Empty', 'Soup', 'Tea']))
    for (const gone of ['Desserts', 'Apple pie', 'Brownies', 'Sponge']) expect(rowNames(el)).not.toContain(gone)
    // OF3: one line, closed at first, with no "(folder)".
    expect(trayNames(el)).toEqual(['Desserts'])
    expect(q(trayLine(el, 'Desserts'), '.other-files__name').getAttribute('aria-expanded')).toBe('false')
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved Desserts (folder) to Other files', 'info', 'undo', expect.objectContaining({ label: 'Undo', fades: true }))
  })

  it('"Move the folder only": the folder goes to the tray and is listed as keeping its pages; the pages stay in the table', async () => {
    const el = await mount('both')
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    click(button(dialog()!, 'Move the folder only'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toEqual(['[[Desserts]]'])
    expect(block().other_files_keep_pages).toEqual(['[[Desserts]]'])
    expect(rowNames(el)).not.toContain('Desserts')
    expect(rowNames(el)).toEqual(expect.arrayContaining(['Apple pie', 'Brownies', 'Sponge', 'Soup']))
    expect(trayNames(el)).toEqual(['Desserts'])
  })

  it('one page: the ask says "It holds 1 page."; Cancel writes nothing', async () => {
    const el = await mount('both')
    rightClick(nameCell(el, 'Drinks'))
    click(menuItem(el, 'Move to Other files'))
    expect(dialog()!.textContent).toContain('Move Drinks (folder) to Other files?')
    expect(dialog()!.textContent).toContain(folderTrayMessage(1, []))
    expect(dialog()!.textContent).toContain('It holds 1 page.')
    click(button(dialog()!, 'Cancel'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toBeUndefined()
    expect(rowNames(el)).toEqual(expect.arrayContaining(['Drinks', 'Tea']))
  })

  it('no pages in the table: no ask, the folder moves at once', async () => {
    const onNotice = vi.fn()
    const el = await mount('both', { onNotice })
    rightClick(nameCell(el, 'Empty'))
    click(menuItem(el, 'Move to Other files'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toEqual(['[[Empty]]'])
    expect(block().other_files_keep_pages).toBeUndefined()
    expect(trayNames(el)).toEqual(['Empty'])
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved Empty (folder) to Other files', 'info', 'undo', expect.anything())
  })

  it('Subfolders: As rows shows none of Desserts\' pages, so no ask: the folder moves with its pages', async () => {
    const el = await mount('rows')
    expect(rowNames(el)).not.toContain('Apple pie')
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toEqual(['[[Desserts]]'])
    expect(block().other_files_keep_pages).toBeUndefined()
    expect(rowNames(el)).not.toContain('Desserts')
  })

  it('OF3: open, the folder line shows its subfolders first, then its files, indented; the open state is kept for the page', async () => {
    let el = await mount('both')
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    click(button(dialog()!, 'Move the folder and its pages'))
    await settle()
    click(q(trayLine(el, 'Desserts'), '.other-files__name'))
    expect(trayNames(el)).toEqual(['Desserts', 'Cakes', 'Apple pie', 'Brownies', 'menu.pdf'])
    expect(trayLine(el, 'Cakes').style.getPropertyValue('--other-files-depth')).toBe('1')
    unmountFolderView()
    el = await mount('both', {}, '  other_files:\n    - "[[Desserts]]"\n')
    expect(trayNames(el)).toEqual(['Desserts', 'Cakes', 'Apple pie', 'Brownies', 'menu.pdf'])
  })
})

describe('Undo and Move back (OF4)', () => {
  it('the toast\'s Undo puts the folder and its pages back in the table as they were, with no toast of its own', async () => {
    const onNotice = vi.fn()
    const el = await mount('both', { onNotice })
    const before = rowNames(el)
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    click(button(dialog()!, 'Move the folder and its pages'))
    await settle()
    expect(rowNames(el)).not.toContain('Desserts')
    await act(async () => onNotice.mock.calls[0][3].run())
    await settle()
    expect(block().other_files).toBeUndefined()
    expect(block().other_files_keep_pages).toBeUndefined()
    expect(rowNames(el)).toEqual(before)
    expect(trayNames(el)).toEqual([])
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('Undo of "Move the folder only" takes the folder and its keep-pages mark off', async () => {
    const onNotice = vi.fn()
    const el = await mount('both', { onNotice })
    const before = rowNames(el)
    rightClick(nameCell(el, 'Desserts'))
    click(menuItem(el, 'Move to Other files'))
    click(button(dialog()!, 'Move the folder only'))
    await settle()
    await act(async () => onNotice.mock.calls[0][3].run())
    await settle()
    expect(block().other_files).toBeUndefined()
    expect(block().other_files_keep_pages).toBeUndefined()
    expect(rowNames(el)).toEqual(before)
  })

  it('the tray\'s "Move back to the table" on the folder line puts it back, and its Undo moves it out again the same way', async () => {
    const onNotice = vi.fn()
    const el = await mount('both', { onNotice }, '  other_files:\n    - "[[Desserts]]"\n  other_files_keep_pages:\n    - "[[Desserts]]"\n')
    expect(rowNames(el)).not.toContain('Desserts')
    expect(rowNames(el)).toContain('Apple pie')
    rightClick(trayLine(el, 'Desserts'))
    click(menuItem(el, 'Move back to the table'))
    await settle()
    expect(block().other_files).toBeUndefined()
    expect(rowNames(el)).toContain('Desserts')
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved Desserts (folder) back to the table', 'info', 'undo', expect.objectContaining({ label: 'Undo' }))
    await act(async () => onNotice.mock.calls[0][3].run())
    await settle()
    expect(block().other_files).toEqual(['[[Desserts]]'])
    expect(block().other_files_keep_pages).toEqual(['[[Desserts]]'])
  })

  it('a file inside a moved folder has the plain menu: no "Move back to the table" of its own', async () => {
    const el = await mount('both', {}, '  other_files:\n    - "[[Desserts]]"\n')
    click(q(trayLine(el, 'Desserts'), '.other-files__name'))
    rightClick(trayLine(el, 'Apple pie'))
    expect(mainItems(el)).not.toContain('Move back to the table')
    expect(mainItems(el)).toContain('Copy path')
  })
})

describe('a page in a subfolder: "Move to Other files ›" (OF1, Their pages)', () => {
  it('the parent opens a flyout naming the page and the folder; Desserts is named for a page in Desserts/Cakes too', async () => {
    const el = await mount('pages')
    rightClick(nameCell(el, 'Apple pie'))
    const parent = menuItem(el, 'Move to Other files')
    expect(parent.getAttribute('aria-haspopup')).toBe('menu')
    act(() => void parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(flyoutItems(el)).toEqual(['Apple pie (page)', 'Desserts (folder)'])
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    rightClick(nameCell(el, 'Sponge'))
    act(() => void menuItem(el, 'Move to Other files').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(flyoutItems(el)).toEqual(['Sponge (page)', 'Desserts (folder)'])
  })

  it('a page directly in the page has no flyout', async () => {
    const el = await mount('pages')
    rightClick(nameCell(el, 'Soup'))
    expect(menuItem(el, 'Move to Other files').getAttribute('aria-haspopup')).toBeNull()
  })

  it('a click on the parent still moves the page, alone', async () => {
    const onNotice = vi.fn()
    const el = await mount('pages', { onNotice })
    rightClick(nameCell(el, 'Apple pie'))
    click(menuItem(el, 'Move to Other files'))
    expect(dialog()).toBeNull()
    await settle()
    expect(block().other_files).toEqual(['[[Apple pie]]'])
    expect(rowNames(el)).not.toContain('Apple pie')
    expect(rowNames(el)).toContain('Brownies')
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved to Other files', 'info', 'undo', expect.anything())
  })

  it('"Apple pie (page)" moves the page; "Desserts (folder)" asks with the pages this view shows, and moves the folder', async () => {
    const el = await mount('pages')
    rightClick(nameCell(el, 'Brownies'))
    act(() => void menuItem(el, 'Move to Other files').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    click(menuItem(el, 'Brownies (page)'))
    await settle()
    expect(block().other_files).toEqual(['[[Brownies]]'])

    rightClick(nameCell(el, 'Apple pie'))
    act(() => void menuItem(el, 'Move to Other files').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    click(menuItem(el, 'Desserts (folder)'))
    // Brownies already left the table: the ask counts Apple pie and Sponge.
    expect(dialog()!.textContent).toContain(folderTrayMessage(2, ['Cakes']))
    click(button(dialog()!, 'Move the folder and its pages'))
    await settle()
    expect(block().other_files).toEqual(['[[Brownies]]', '[[Desserts]]'])
    expect(rowNames(el)).toEqual(['Soup', 'Tea'])
    // Brownies is under the moved folder: it shows there, not as its own line.
    expect(trayNames(el)).toEqual(['Desserts'])
  })

  it('the demo path: from "Open in ›" over "Copy path" into "Move to Other files ›" opens its flyout (the cross-flyout fix)', async () => {
    const el = await mount('pages')
    rightClick(nameCell(el, 'Apple pie'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const openIn = menuItem(el, 'Open in')
    const copy = menuItem(el, 'Copy path')
    const toTray = menuItem(el, 'Move to Other files')
    pointer(null, openIn)
    expect(flyoutItems(el)).toContain('Reveal in Finder')
    pointer(openIn, copy)
    act(() => void vi.advanceTimersByTime(SWITCH_MS / 2))
    pointer(copy, toTray)
    act(() => void vi.advanceTimersByTime(SWITCH_MS * 2))
    expect(toTray.getAttribute('aria-expanded')).toBe('true')
    expect(flyoutItems(el)).toEqual(['Apple pie (page)', 'Desserts (folder)'])
    expect(el.querySelectorAll('.ctx-menu__sub')).toHaveLength(1)
  })
})

describe('a Folder group\'s header (OF1)', () => {
  it('"Move Desserts (folder) to Other files" asks, then moves the folder', async () => {
    const el = await mount('pages', {}, '      groupBy:\n        property: file.folder\n')
    const header = [...el.querySelectorAll<HTMLElement>('.view-group')].find((g) => g.textContent?.includes('Desserts'))
    expect(header).toBeDefined()
    rightClick(header!)
    // The header's menu is on `document.body` (a frozen row is translated).
    click(menuItem(document, 'Move Desserts (folder) to Other files'))
    expect(dialog()!.textContent).toContain('Move Desserts (folder) to Other files?')
    click(button(dialog()!, 'Move the folder and its pages'))
    await settle()
    expect(block().other_files).toEqual(['[[Desserts]]'])
  })
})

describe('Read only (D36, OF5)', () => {
  it('no folder move on a read-only page', async () => {
    disk.set(SETTINGS_FILE, { content: settingsFile('both').replace('---\n', '---\nreadonly: true\n'), mtime: 50 })
    const el = renderFolderView({ path: RECIPES, source, onOpenFile: () => undefined })
    feed()
    await flush()
    rightClick(nameCell(el, 'Desserts'))
    expect(mainItems(el)).not.toContain('Move to Other files')
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    rightClick(nameCell(el, 'Apple pie'))
    expect(mainItems(el)).not.toContain('Move to Other files')
  })
})
