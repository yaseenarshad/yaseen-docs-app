/**
 * The folder view (YAZ-2290; the adapter is 🔒 D3 of YAZ-818). Mounted with react-dom in jsdom over
 * a REAL `WikilinkResolveSource` — the App-owned feed the whole view runs on — with `writeProperty`
 * mocked (the ONE frontmatter writer, shared by the settings door and every cell) and `api` mocked
 * for the create path.
 *
 * Pinned here: its rows are the notes UNDER the folder, at any depth, and its shortcuts; a folder with no
 * `.folder.md` shows the defaults and opening it writes nothing; link resolution and the link
 * pickers read the WHOLE vault even though the rows are a subset; a config edit is ONE
 * `folder_settings` write on the folder's `.folder.md` while a cell edit still writes the
 * NOTE's own frontmatter; switching view writes nothing at all; and "New" births a note in
 * the folder from its template and the seed alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { CreateFileRequest, IndexRecord, TreeNode } from '@shared/types'
import { DEFAULT_COLUMNS } from './folderSettings'
import { fetchTree } from '../lib/treeFeed'
import { linkResolver, vaultDirs } from '../links/folderLinks'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { click, flush, press, q, rec, renderFolderView, setValue, unmountFolderView } from './testFolderView'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(), transformFile: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn(), tree: vi.fn() },
}))
/** The real pane, wrapped, so a test can reach the host's bundle directly. */
const captured = vi.hoisted(() => ({ folder: null as FolderHost | null }))
vi.mock('./ViewsPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ViewsPane')>()
  return {
    ...actual,
    ViewsPane: (props: ViewsPaneProps) => {
      captured.folder = props.folder
      return <actual.ViewsPane {...props} />
    },
  }
})

/** The outline's editor, stubbed (YAZ-903): a real Crepe in jsdom is `OutlineEditor.test.tsx`'s job. */
vi.mock('./view/OutlineEditor', () => ({
  OutlineEditor: ({ markdown }: { markdown: string }) => <pre className="outline-doc">{markdown}</pre>,
}))

import { api, BridgeRequestError } from '../api'
import type { FolderHost, ViewsPaneProps } from './ViewsPane'
import { transformFile, writeProperty } from './writeProperty'

const write = vi.mocked(writeProperty)
/** The one-file transform behind a declaration write (`writeFolderColumn`) and a column delete's note strips. */
const transform = vi.mocked(transformFile)
const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createFile = vi.mocked(api.createFile)
/** The atomic content-at-create form is the only one this path uses (`createNote`). */
const created = (call: number): CreateFileRequest => createFile.mock.calls[call][0] as CreateFileRequest

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

/** The folder under test: the tab's identity is its directory path (D3). */
const STAGES = '/vault/stages'
/** Where its settings live once anything is saved (D1). */
const SETTINGS_FILE = '/vault/stages/.folder.md'
/** The folder's id (YAZ-2293): the `id` of that file, which a note's `also_in` names (D2). */
const STAGES_ID = 'k3m9x2pq7abc'
const LEAD ='/vault/stages/Lead Gen.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const DEEP = '/vault/stages/archive/Old.md'
/** The folders, as the Files tree lists them: the link-column pickers ask it which folder a target names (D10). */
const DIRS: TreeNode[] = ['kpis', 'stages', 'Sub'].map((name) => ({ type: 'dir', name, path: `/vault/${name}`, children: [] }))
const OUTSIDER = '/vault/Sub/Outsider.md'

const TABLE = { type: 'table', name: 'Table', order: ['file.name', 'note.order', 'note.related'] }
const BOARD = { type: 'board', name: 'Board' }
const SETTINGS = {
  columns: { order: { kind: 'number' as const }, related: { kind: 'multi-link' as const, target: '[[KPIs]]' } },
  views: [{ type: 'outline', name: 'Outline' }, TABLE],
}

/** The whole snapshot, in the index's path order: the folder's two notes, one in a SUBFOLDER, and notes elsewhere. */
function vault(): IndexRecord[] {
  return [
    rec(OTHER, { title: 'in another folder', order: 7 }),
    rec(OUTSIDER, {}),
    rec('/vault/kpis/CAC.md'),
    rec('/vault/kpis/LTV.md'),
    rec(LEAD, { order: 2, owner: '[[Sub/Outsider]]' }),
    rec(SALES, { order: 1 }),
    rec(DEEP, { order: 3 }),
  ]
}

// ---------- harness ----------

let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()

/**
 * WikilinkIndexBridge's own wrapping: THE link resolver — a note, else a folder of the Files
 * tree — the notes, and the folder settings records riding beside them. `settings: null` = the
 * folder has no `.folder.md`.
 */
function feed(settings: unknown = SETTINGS, records: IndexRecord[] = vault()): void {
  const folders = settings === null ? [] : [{ ...rec(SETTINGS_FILE, { folder_settings: settings }), id: STAGES_ID }]
  act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders))
}

/** Mounts, hands over the first snapshot — the order the window does it in — and lets the settings file's read answer. */
async function mount(settings: unknown = SETTINGS, records: IndexRecord[] = vault()): Promise<HTMLElement> {
  const el = renderFolderView({ path: STAGES, source, onOpenFile })
  feed(settings, records)
  await flush()
  return el
}

beforeEach(async () => {
  source = createWikilinkResolveSource()
  vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: DIRS, generatedAt: 1 })
  await fetchTree('/vault') // the window's tree feed: a folder tab only mounts once it has answered
  write.mockResolvedValue({ mtime: 2 })
  transform.mockResolvedValue({ mtime: 2, content: '' })
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
})

afterEach(() => {
  unmountFolderView()
  vi.resetAllMocks()
})

// ---------- DOM helpers (RelationColumn.test.tsx style) ----------

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)
const texts = (el: ParentNode, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.textContent ?? '')
const options = (el: ParentNode): (string | null)[] => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)
/**
 * Row names, whichever body is rendering: the placeholder list or the real table (`file.name`,
 * extension and all). The outline has no rows at all: it is a document.
 */
const rowNames = (el: ParentNode): string[] => texts(el, '.view-row__link, .view-table__link')
/** The outline document the editor was seeded with (YAZ-903). */
const doc = (el: ParentNode): string => q(el, '.outline-doc').textContent ?? ''

/** The filter row's Property is the searchable picker (YAZ-1466): open it, click the option. */
function chooseProperty(el: ParentNode, value: string): void {
  click(byLabel(el, 'Property'))
  const option = [...el.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.value === value)
  if (option === undefined) throw new Error(`no Property option ${value}`)
  click(option)
}

/** What that picker's trigger currently shows — its property's display label. */
const propertyShown = (el: ParentNode): string => byLabel<HTMLElement>(el, 'Property').textContent ?? ''

const openTable = (el: ParentNode): void => click(q(el, '.view-tab__btn:nth-of-type(1)'))

const openCell = (el: ParentNode, r: number, c: number): void => click(q(q<HTMLElement>(el, `[data-cell="${r}:${c}"]`), '[data-edit]'))

/** Toolbar.test's select setter: native prototype setter + bubbling change, so React's tracker sees it. */
function setSelect(el: HTMLSelectElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const tab = (el: ParentNode, name: string): HTMLElement => {
  const t = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === name)
  if (t === undefined) throw new Error(`no view tab ${name}`)
  return t
}
/** Activate the view named `name`. Switching is session state — it writes nothing of its own. */
const selectView = (el: ParentNode, name: string): void => click(tab(el, name))
const rightClick = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
const menuItem = (el: ParentNode, text: string): HTMLElement => {
  const b = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === text)
  if (b === undefined) throw new Error(`no menu item ${text}`)
  return b
}
const written = (): Record<string, unknown> => write.mock.calls[0][2] as Record<string, unknown>

// ---------- the folder itself (D1/D4/E2) ----------

describe('a folder with no settings file', () => {
  it('shows its notes under the default views — Table, then Board, no Outline — and opening writes NOTHING', async () => {
    const el = await mount(null)
    await flush()
    expect(q(el, 'h1').textContent).toBe('stages')
    expect(texts(el, '.view-tab__btn')).toEqual(['Table', 'Board'])
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
    expect(captured.folder!.settings.columns).toEqual(DEFAULT_COLUMNS) // E2: the default Status column, on no file
    expect(write).not.toHaveBeenCalled()
    expect(transform).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('the FIRST change writes the whole block into `.folder.md` — the default columns stated with it (E2)', async () => {
    const el = await mount(null)
    click(byLabel(el, 'Add view'))
    expect(texts(el, '.view-popover--menu [role="menuitem"]')).toEqual(['Table', 'Board', 'Cards', 'List', 'Outline']) // the Outline is the "+" menu's (D5a)
    click(menuItem(el, 'Cards'))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      columns: DEFAULT_COLUMNS,
      views: [
        { type: 'table', name: 'Table' },
        { type: 'board', name: 'Board' },
        { type: 'cards', name: 'Cards' },
      ],
    })
    expect(byLabel<HTMLInputElement>(el, 'View name').value).toBe('Cards') // the appended tab mounts in rename
  })

  it('a column added there, then a view edit before the index echoes either: the second write still states the column', async () => {
    const el = await mount(null)
    act(() => captured.folder!.setColumns({ ...DEFAULT_COLUMNS, owner: { kind: 'link' } }))
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect((write.mock.calls[1][2] as { columns: unknown }).columns).toEqual({ ...DEFAULT_COLUMNS, owner: { kind: 'link' } })
  })

  it('before the first snapshot nothing renders: only the index can say the folder has no settings', async () => {
    expect(renderFolderView({ path: STAGES, source, onOpenFile }).innerHTML).toBe('')
  })
})

describe('a folder whose `.folder.md` declares columns', () => {
  it('has exactly those columns — the default Status is not added back (E2)', async () => {
    await mount()
    expect(captured.folder!.settings.columns).toEqual(SETTINGS.columns)
  })

  it('a settings file that saved NO columns means none', async () => {
    await mount({ views: [TABLE] })
    expect(captured.folder!.settings.columns).toEqual({})
  })

  it('opening it, and adding a column, write nothing into the notes (E1)', async () => {
    await mount()
    await flush()
    act(() => captured.folder!.setColumns({ ...SETTINGS.columns, owner: { kind: 'link' } }))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', expect.anything()) // the settings, and no note
    expect(transform).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------- the rows (D4) ----------

describe('rows are the notes UNDER the folder, at any depth, and only those', () => {
  it('a note in a subfolder, at any depth, is a row', async () => {
    const el = await mount(SETTINGS, [...vault(), rec('/vault/stages/archive/2019/Older.md')])
    selectView(el, 'Table')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old', 'Older'])
  })

  it('a subfolder is never a row — not even one with a settings file of its own', async () => {
    const el = renderFolderView({ path: STAGES, source, onOpenFile })
    const folders = [{ ...rec(SETTINGS_FILE, { folder_settings: SETTINGS }), id: STAGES_ID }, { ...rec('/vault/stages/archive/.folder.md'), id: 'z8y7x6w5v4t3' }]
    act(() => source.update(linkResolver(vault(), '/vault', vaultDirs('/vault'), folders), vault(), folders))
    await flush()
    selectView(el, 'Table')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
    expect(rowNames(el)).not.toContain('archive')
  })

  it('a note that lands in the folder on the next snapshot is a row with no user action', async () => {
    const el = await mount()
    selectView(el, 'Table')
    feed(SETTINGS, [...vault(), rec('/vault/stages/Expansion.md')])
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old', 'Expansion']) // the snapshot's order
  })

  it('the whole-vault resolver reaches the engine: a link pointing OUTSIDE the folder resolves', async () => {
    // The trap: with only the rows behind it, `link("Outsider")` names nothing and the
    // spellings never meet. The row shows because the resolver came from the whole snapshot.
    const el = await mount({ views: [{ type: 'table', name: 'T', order: ['file.name'], filters: 'owner == link("Outsider")' }] })
    expect(rowNames(el)).toEqual(['Lead Gen'])
  })
})

describe('a shortcut is a row too (D2/D4)', () => {
  /** Other.md lives at the vault root and ALSO appears in the folder: its `also_in` names the folder's id. */
  const shortcut = (): IndexRecord[] => vault().map((r) => (r.path === OTHER ? { ...r, properties: { ...r.properties, also_in: [STAGES_ID] } } : r))

  it('a note whose `also_in` holds the folder’s id shows among its rows, in the snapshot’s order', async () => {
    const el = await mount(SETTINGS, shortcut())
    selectView(el, 'Table')
    expect(rowNames(el)).toEqual(['Other', 'Lead Gen', 'Sales', 'Old'])
  })

  it('the shortcut mark: a row that does not live under the folder wears it in every view; a note that lives here, or in a subfolder, wears none', async () => {
    /** Of the four titles a view draws, the ones wearing the mark — by the name they read as, which the mark adds nothing to. */
    const marked = (el: ParentNode, title: string): string[] => {
      const titles = [...el.querySelectorAll(title)]
      expect(titles).toHaveLength(4)
      return titles.filter((name) => name.querySelector('.shortcut-mark') !== null).map((name) => name.textContent ?? '')
    }
    const order = ['file.name']
    const el = await mount({ ...SETTINGS, views: [TABLE, { ...BOARD, order, groupBy: { property: 'note.order' } }, { type: 'cards', name: 'Cards', order }, { type: 'list', name: 'List', order }] }, shortcut())
    expect(marked(el, '.view-table__link')).toEqual(['Other'])
    selectView(el, 'Board')
    expect(marked(el, '.view-board__title')).toEqual(['Other'])
    selectView(el, 'Cards')
    expect(marked(el, '.view-card__title')).toEqual(['Other'])
    selectView(el, 'List')
    expect(marked(el, '.view-list__title')).toEqual(['Other'])
  })

  it('a folder with no `.folder.md` has no id, so the same note is no row there', async () => {
    const el = await mount(null, shortcut())
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
  })

  it('editing a cell on the shortcut row writes the ORIGINAL file — it is the same note', async () => {
    const el = await mount(SETTINGS, shortcut())
    selectView(el, 'Table')
    openCell(el, 0, 1) // Other's `order`: a number by the folder's own declaration
    const input = byLabel<HTMLInputElement>(el, 'Edit order')
    setValue(input, '9')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(OTHER, 'order', 9)
  })

  /** The snapshot with a second settings file beside the folder's own: `dir`'s, saving `columns`. */
  const feedWith = (dir: string, columns: Record<string, unknown>, records: IndexRecord[] = shortcut()): void => {
    const folders = [{ ...rec(`${dir}/.folder.md`, { folder_settings: { columns, views: [TABLE] } }), id: 'z8y7x6w5v4t3' }, { ...rec(SETTINGS_FILE, { folder_settings: SETTINGS }), id: STAGES_ID }]
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders))
  }
  const openDeleteSheet = (el: HTMLElement): void => {
    selectView(el, 'Table')
    rightClick([...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')][1]) // `order`: Other, Lead Gen, Sales and Old all carry it
    click(menuItem(el, 'Delete column…'))
  }

  it('a cell in a folder’s table is typed by that folder’s own columns, whatever the folder the note lives in declares', async () => {
    const el = await mount(SETTINGS, shortcut())
    feedWith('/vault', { order: { kind: 'text' } }) // Other lives at the root, which says `order` is text
    selectView(el, 'Table')
    openCell(el, 0, 1)
    const input = byLabel<HTMLInputElement>(el, 'Edit order')
    setValue(input, '9')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(OTHER, 'order', 9) // a number: stages' own declaration
  })

  it('deleting a column removes the value from every note in the folder’s table: a note under it at any depth, and a shortcut', async () => {
    await mount(SETTINGS, shortcut())
    await act(async () => captured.folder!.deleteColumn('order'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES, DEEP])
  })

  it('a note that ANOTHER folder showing it still has a column of that name for keeps the value', async () => {
    await mount(SETTINGS, shortcut())
    feedWith('/vault/stages/archive', { order: { kind: 'text' } })
    await act(async () => captured.folder!.deleteColumn('order'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES]) // archive/Old keeps its `order`
  })

  it('a note that cannot be written is reported in the column banner; the others are still stripped', async () => {
    transform.mockRejectedValueOnce(new Error('frontmatter is not valid YAML'))
    const el = await mount(SETTINGS, shortcut())
    await act(async () => captured.folder!.deleteColumn('order'))
    expect(q(el, '[role="alert"]').textContent).toContain('Could not remove "order" from 1 note: Other (frontmatter is not valid YAML)')
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES, DEEP])
  })

  it('the confirm sheet states how many notes lose the value; when none are kept it says nothing about kept notes', async () => {
    const el = await mount(SETTINGS, shortcut())
    openDeleteSheet(el)
    expect(q(el, '.confirm__text').textContent).toBe('Delete "Order"? This removes the column from this folder and the "order" value from 4 notes.')
  })

  it('the confirm sheet states how many notes keep the value because another folder uses it — both numbers taken once, when the sheet opens', async () => {
    const el = await mount(SETTINGS, shortcut())
    feedWith('/vault/stages/archive', { order: { kind: 'text' } })
    openDeleteSheet(el)
    const text = 'Delete "Order"? This removes the column from this folder and the "order" value from 3 notes. 1 note keeps it because another folder uses it.'
    expect(q(el, '.confirm__text').textContent).toBe(text)
    feedWith('/vault/stages/archive', { order: { kind: 'text' } }, [...shortcut(), rec('/vault/stages/New.md', { order: 4 }), rec('/vault/stages/archive/Older.md', { order: 5 })])
    expect(q(el, '.confirm__text').textContent).toBe(text)
  })

  it('a cell edit on a row from a subfolder writes that note’s own frontmatter', async () => {
    const el = await mount()
    selectView(el, 'Table')
    openCell(el, 2, 1) // archive/Old's `order`
    const input = byLabel<HTMLInputElement>(el, 'Edit order')
    setValue(input, '9')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(DEEP, 'order', 9)
  })

  it('a board drag on a row from a subfolder writes that note’s own frontmatter', async () => {
    const el = await mount({ ...SETTINGS, views: [{ ...BOARD, order: ['file.name'], groupBy: { property: 'note.order' } }] })
    const fire = (target: Element, type: string): void => act(() => void target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
    const old = [...el.querySelectorAll('.view-board__title')].find((title) => title.textContent === 'Old')!.closest('.view-board__card')!
    const column = [...el.querySelectorAll('.view-board__col')].find((col) => q(col, '.view-group__value').textContent === '1')!
    fire(old, 'dragstart')
    fire(column, 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith(DEEP, 'order', 1)
  })

  it('"New" creates the note DIRECTLY in the opened folder; its name-clash check looks only at notes directly in it, not at rows from subfolders', async () => {
    const el = await mount(SETTINGS, [...vault(), rec('/vault/stages/archive/Untitled.md')])
    selectView(el, 'Table')
    expect(rowNames(el)).toContain('Untitled') // a row here, from the subfolder
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).path).toBe('/vault/stages/Untitled.md')
  })

  it('New steps past the names of the notes that live here, never a shortcut’s', async () => {
    const records = vault().map((r) => (r.path === OTHER ? { ...r, path: '/vault/Untitled.md', name: 'Untitled.md', basename: 'Untitled', properties: { also_in: [STAGES_ID] } } : r))
    const el = await mount(SETTINGS, records)
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).path).toBe('/vault/stages/Untitled.md')
  })
})

// ---------- the chrome (🔒 rule 4 + Q3) ----------

describe('the outline is a plain document (D5)', () => {
  const card = (outline: string) => ({ ...SETTINGS, views: [{ type: 'outline', name: 'Outline', outline }, TABLE] })

  it('it shows what the settings hold and names no note of its own accord', async () => {
    expect(doc(await mount())).toBe('') // Lead Gen and Sales live here; the document does not say so
    expect(write).not.toHaveBeenCalled()
  })

  it('an outline edited outside the app reaches the rendered document on the next snapshot (YAZ-1356)', async () => {
    const el = await mount(card('- [[Sales]]\n- [[Lead Gen]]'))
    feed(card('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI'))
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI')
    expect(write).not.toHaveBeenCalled() // a link line is just a link: nothing is tagged
  })
})

describe('the chrome is the views chrome', () => {
  it('both skins render and the tabs switch between them', async () => {
    const el = await mount()
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table']) // what the settings list is what you get (D3)
    expect(el.querySelector('.view-outline')).not.toBeNull() // YAZ-820's renderer
    expect(el.querySelector('.view-table')).toBeNull()
    selectView(el, 'Table')
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
  })

  it('switching view writes NOTHING — which view is active is session state, never the file', async () => {
    const el = await mount()
    selectView(el, 'Table')
    selectView(el, 'Outline')
    expect(write).not.toHaveBeenCalled()
  })

  it('the tabs EDIT (YAZ-1471): "+" adds, a right-click opens the menu; the outline, a document, still offers no Filter (YAZ-1218)', async () => {
    const el = await mount()
    expect(el.querySelector('[aria-label="Add view"]')).not.toBeNull()
    rightClick(tab(el, 'Outline'))
    expect(texts(el, '.ctx-menu[role="menu"] [role="menuitem"]')).toEqual(['Rename', 'Duplicate', 'Delete'])
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull() // documentView — rows-bearing views offer it
    expect(el.querySelector('[aria-label="Sort"]')).not.toBeNull() // the rest of the toolbar is untouched
    expect(el.querySelector('[aria-label="New note"]')).not.toBeNull()
  })

})

/**
 * Open UI vs an EXTERNAL shrink (YAZ-1488): `menu`, `confirm` and `renaming` are INDICES into
 * `views`, and another window (or a hand edit) can drop views out from under an open one. The
 * strip derives the view in render, so a stale index renders NOTHING — this block has no error
 * boundary above it, and a throw here is a blank window.
 */
describe('an open menu or sheet survives the views list shrinking under it (YAZ-1488)', () => {
  const THREE = { ...SETTINGS, views: [...SETTINGS.views, BOARD] }

  it('the right-click menu on the LAST tab goes away with the view it named', async () => {
    const el = await mount(THREE)
    rightClick(tab(el, 'Board'))
    expect(el.querySelector('[role="menu"]')).not.toBeNull()
    feed(SETTINGS)
    expect(el.querySelector('[role="menu"]')).toBeNull()
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })

  it('so does the delete sheet it opened', async () => {
    const el = await mount(THREE)
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    feed(SETTINGS)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })
})

// ---------- the default view (YAZ-1104) ----------

describe('the default view: a saved START, while which view is ACTIVE stays session state', () => {
  it('a page with a defaultView opens on that view — and opening writes nothing', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(el.querySelector('.view-outline')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('a stale saved name falls back to the first view, silently', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Ghost' })
    expect(el.querySelector('.view-outline')).not.toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('Page → Default view is ONE whole-key settings write carrying the name', async () => {
    const el = await mount()
    click(tab(el, 'Table')) // the outline offers no Properties menu; switching writes nothing
    click(byLabel(el, 'Properties'))
    setSelect(byLabel<HTMLSelectElement>(el, 'Default view'), 'Table')
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, defaultView: 'Table' })
  })

  it('the dropdown shows the saved value, and First view clears the key', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    click(byLabel(el, 'Properties'))
    const select = byLabel<HTMLSelectElement>(el, 'Default view')
    expect(select.value).toBe('Table')
    setSelect(select, '')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual(SETTINGS)
  })

  it('renaming the default view carries the saved START along, in the SAME write', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    rightClick(tab(el, 'Table'))
    click(menuItem(el, 'Rename'))
    const input = byLabel<HTMLInputElement>(el, 'View name')
    setValue(input, 'Grid')
    press(input, 'Enter')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, name: 'Grid' }], defaultView: 'Grid' })
  })

  it('deleting the default view clears the START in the same write', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    rightClick(tab(el, 'Table'))
    click(menuItem(el, 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [SETTINGS.views[0]] })
  })

  it('an EXTERNAL edit that changes ONLY defaultView rebuilds the def (D4: it rides in the stamp)', async () => {
    const el = await mount()
    feed({ ...SETTINGS, defaultView: 'Table' })
    click(tab(el, 'Table')) // the outline has no Properties button of its own
    click(byLabel(el, 'Properties'))
    expect(byLabel<HTMLSelectElement>(el, 'Default view').value).toBe('Table')
    expect(write).not.toHaveBeenCalled()
  })
})

// ---------- the adapter (🔒 D3) ----------

describe('config edits are ONE settings write on the folder', () => {
  it.each(['Table', 'Board'])('bulk clearing %s writes only its order and frozen-column cleanup in one settings write', async (name) => {
    const views = [{ ...TABLE, frozenColumns: 2 }, { ...BOARD, order: ['file.name', 'note.order'], frozenColumns: 1 }]
    const settings = { ...SETTINGS, views }
    const el = await mount(settings)
    selectView(el, name)
    click(byLabel(el, 'Properties'))
    const clear = [...el.querySelectorAll<HTMLButtonElement>('.view-menu__action')].find((button) => button.textContent === 'Unselect all')!
    click(clear)
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      ...settings,
      views: views.map((view) => {
        if (view.name !== name) return view
        const { frozenColumns: _frozen, ...rest } = view
        return { ...rest, order: [] }
      }),
    })
    expect(clear.disabled).toBe(true)
    click(clear)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a Board column-width edit is one whole-key folder_settings write', async () => {
    const withBoard = { ...SETTINGS, views: [...SETTINGS.views, BOARD] } // the settings SAY board now (D3)
    const el = await mount(withBoard)
    selectView(el, 'Board')
    click(byLabel(el, 'Properties'))
    const width = byLabel<HTMLInputElement>(el, 'Column width in pixels')
    setValue(width, '400')
    press(width, 'Enter')
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      ...withBoard,
      views: [...SETTINGS.views, { ...BOARD, cardSize: 400 }],
    })
  })

  it('a sort change goes back through the one door, whole-key, views verbatim', async () => {
    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(SETTINGS_FILE) // the FOLDER's settings file, not a note
    expect(key).toBe('folder_settings')
    expect(value).toEqual({
      ...SETTINGS,
      views: [SETTINGS.views[0], { ...TABLE, sort: [{ property: 'file.name', direction: 'ASC' }] }],
    })
  })

  it('a filter edit uses that same door, and emptying it deletes the key (YAZ-1235)', async () => {
    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(SETTINGS_FILE)
    expect(key).toBe('folder_settings')
    expect(value).toEqual({
      ...SETTINGS,
      views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['file.name.contains("")'] } }],
    })

    click(byLabel(el, 'Remove rule'))
    await flush()

    expect(write).toHaveBeenCalledTimes(2)
    const emptied = write.mock.calls[1][2] as { views: Record<string, unknown>[] }
    expect(emptied.views[1]).not.toHaveProperty('filters') // empty deletes the key, never `filters: {}`
    expect(emptied).toEqual(SETTINGS)
  })

  it('a write echo arriving after a newer optimistic edit does not take it back (YAZ-1241)', async () => {
    const settingsOf = (call: number): unknown => write.mock.calls[call][2]

    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush() // write 1: the default `file.name contains ""` rule
    chooseProperty(el, 'note.order')
    await flush() // write 2: the rule re-targeted
    expect(write).toHaveBeenCalledTimes(2)
    expect(propertyShown(el)).toContain('Order')

    // Write 1's echo lands AFTER write 2's optimistic state — the race YAZ-1234 caught in the
    // DOM. It is OUR OWN stale write, not an external edit: it must not rebuild anything.
    feed(settingsOf(0))
    expect(propertyShown(el)).toContain('Order')

    // The next gesture edits what the menu renders — the property edit must survive it.
    setSelect(byLabel<HTMLSelectElement>(el, 'Operator'), 'isEmpty')
    await flush() // write 3
    const third = (settingsOf(2) as { views: { filters?: unknown }[] }).views[1]
    expect(JSON.stringify(third.filters)).toContain('note.order')

    // The remaining echoes drain in order; an external edit afterwards still adopts as always.
    feed(settingsOf(1))
    feed(settingsOf(2))
    expect(propertyShown(el)).toContain('Order')
    feed({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['note.order == 9'] } }] })
    expect(q<HTMLInputElement>(el, '[aria-label="Value"]').value).toBe('9')
  })

  it('the edit shows immediately, without waiting for the index to come back', async () => {
    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(byLabel<HTMLButtonElement>(el, 'Sort property').textContent).toContain('Name')
  })

  it('a column rename lands in folder_settings.properties — ONE write, the label persisted, its echo not fought (YAZ-1513)', async () => {
    // Before YAZ-1513 the def's `properties` was never persisted: the pencil's rename showed until
    // the next echo and then silently vanished. Now the header menu and the pencil share one writer.
    const el = await mount()
    selectView(el, 'Table')
    rightClick(q(el, '.view-table thead th:not(.view-table__gutter):nth-of-type(3)')) // note.order → "Order"
    click(menuItem(el, 'Rename column…'))
    const field = byLabel<HTMLInputElement>(el, 'Rename Order')
    setValue(field, 'Rank')
    press(field, 'Enter')
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, properties: { order: { displayName: 'Rank' } } })
    const headers = () => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    // the index echoes our own write back: the label stays, nothing is rebuilt from an older def
    feed({ ...SETTINGS, properties: { order: { displayName: 'Rank' } } })
    await flush()
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a stored column label renders on mount, and an external change to it rebuilds the def (YAZ-1513)', async () => {
    const el = await mount({ ...SETTINGS, properties: { order: { displayName: 'Rank' } } })
    selectView(el, 'Table')
    const headers = () => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    feed({ ...SETTINGS, properties: { order: { displayName: 'Position' } } })
    await flush()
    expect(headers()).toEqual(['Name', 'Position', 'Related'])
    expect(write).not.toHaveBeenCalled()
  })

  it('a drag past the first tab writes the new order and the active view follows; switching alone writes nothing', async () => {
    const el = await mount()
    click(tab(el, 'Table'))
    expect(write).not.toHaveBeenCalled()
    const fire = (target: Element, type: string, clientX = 0) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX })))
    const wrap = (name: string): Element => tab(el, name).closest('.view-tab') as Element
    fire(wrap('Table'), 'dragstart')
    fire(wrap('Outline'), 'dragover', -5)
    fire(wrap('Outline'), 'drop', -5)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [TABLE, SETTINGS.views[0]] })
    expect(tab(el, 'Table').getAttribute('aria-selected')).toBe('true')
  })

  it('a Board deleted through the menu STAYS deleted — nothing puts it back on the next read (D3)', async () => {
    const el = await mount({ ...SETTINGS, views: [...SETTINGS.views, BOARD] })
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table', 'Board'])
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual(SETTINGS)
    feed(written()) // the index echoes our own write back
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })

  it('a failed write says so and never takes the block down', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-table')).not.toBeNull()
  })
})

/**
 * The host owns the declarations AHEAD of the index (YAZ-1549): `settings.columns` on the mode is
 * what every menu spreads and hands back as `base` — so a column added a moment ago is not dropped
 * by the next write.
 */
describe('the declarations ride AHEAD of the index (YAZ-1549)', () => {
  const columnsOf = () => captured.folder!.settings.columns
  const setColumn = async (key: string, next: { kind: 'link' | 'text' }) => {
    let failure: unknown = null
    await act(async () => {
      await captured.folder!.setColumn(key, next, undefined).catch((err: unknown) => {
        failure = err
      })
    })
    return failure
  }

  it('a setColumn write shows in settings.columns at once — before any echo — and is ONE file transform', async () => {
    await mount()
    expect(columnsOf()).toEqual(SETTINGS.columns)
    expect(await setColumn('owner', { kind: 'link' })).toBeNull()
    expect(columnsOf()).toEqual({ ...SETTINGS.columns, owner: { kind: 'link' } })
    expect(transform).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, expect.any(Function))
    expect(write).not.toHaveBeenCalled() // the declaration write is `writeFolderColumn`'s, not the whole-key door
  })

  it('the echo carrying the same columns clears the ahead copy: the index leads again, and a later different echo shows through', async () => {
    await mount()
    await setColumn('owner', { kind: 'link' })
    const echoed = { ...SETTINGS, columns: { ...SETTINGS.columns, owner: { kind: 'link' } } }
    feed(echoed)
    await flush()
    expect(columnsOf()).toEqual(echoed.columns)
    // ahead is null now: an EXTERNAL change to that column is what the mode shows
    feed({ ...SETTINGS, columns: { ...SETTINGS.columns, owner: { kind: 'text' } } })
    await flush()
    expect(columnsOf().owner).toEqual({ kind: 'text' })
  })

  it('a refused declaration write puts the ahead copy back and rejects to the caller — the panel shows the text, the host shows what stands', async () => {
    transform.mockRejectedValueOnce(new Error('Property “owner” changed since these settings were opened. Reopen the property and try again.'))
    await mount()
    const failure = await setColumn('owner', { kind: 'link' })
    expect(String(failure)).toContain('changed since these settings were opened')
    expect(columnsOf()).toEqual(SETTINGS.columns)
  })

  it('two rapid writes COMPOSE: a column added, then another deleted before either echoes — the first declaration survives (the YAZ-1549 finding)', async () => {
    await mount()
    await setColumn('owner', { kind: 'link' })
    await act(async () => captured.folder!.deleteColumn('order'))
    expect(write).toHaveBeenCalledTimes(1)
    expect((write.mock.calls[0][2] as { columns: unknown }).columns).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
    expect(columnsOf()).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
  })

  it('a refused settings write ABORTS a delete: the banner says why, the ahead copy is put back, and not one note is touched', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const el = await mount()
    await act(async () => captured.folder!.deleteColumn('order'))
    expect(transform).not.toHaveBeenCalled() // LEAD and SALES carry `order`; neither was stripped
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(columnsOf()).toEqual(SETTINGS.columns)
  })
})

describe('setColumns is the DECLARATIONS door (YAZ-895)', () => {
  const COLUMNS = { order: { kind: 'number' as const }, owner: { kind: 'link' as const } }

  it('one write, whole-key: the new columns, the views verbatim', async () => {
    await mount()
    act(() => captured.folder!.setColumns(COLUMNS))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, columns: COLUMNS })
  })

  it('columns AND views ride in that SAME single write when views are passed', async () => {
    await mount()
    const views = [{ type: 'outline', name: 'Outline', order: ['[[Sales]]'] }, TABLE]
    act(() => captured.folder!.setColumns(COLUMNS, views))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, columns: COLUMNS, views })
  })

  /**
   * The LIVE def, never the index snapshot (YAZ-1471 D4): `settings` is the last snapshot the
   * index handed over, so a default-view choice (or a sort/filter edit, when the caller passes no
   * `views`) whose echo is still in flight would be clobbered by the next column write — YAZ-1234's
   * two-gestures-in-a-second data loss, through the other door.
   */
  it('carries an in-flight defaultView choice the index has not echoed back yet', async () => {
    const el = await mount()
    click(tab(el, 'Table')) // the outline offers no Properties menu
    click(byLabel(el, 'Properties'))
    setSelect(byLabel<HTMLSelectElement>(el, 'Default view'), 'Table')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)

    const columns = { ...COLUMNS, extra: { kind: 'text' as const } }
    act(() => captured.folder!.setColumns(columns))
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][2]).toEqual({ ...SETTINGS, columns, defaultView: 'Table' })
  })

  it('a failed write lands in the banner every other config edit uses', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = await mount()
    act(() => captured.folder!.setColumns(COLUMNS))
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-outline')).not.toBeNull()

    feed(SETTINGS, [...vault(), rec('/vault/stages/Expansion.md')])
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
  })
})

describe('cell editing still writes the NOTE, typed by the folder (🔒 Q8)', () => {
  it('the picker narrows to the notes in the FOLDER the column targets — from the WHOLE vault (🔒 D2, YAZ-2290 D10)', async () => {
    const el = await mount()
    selectView(el, 'Table')
    openCell(el, 0, 2) // Lead Gen's empty `related` cell: multi-link by the folder's own declaration
    const input = byLabel<HTMLInputElement>(el, 'Edit related')
    setValue(input, '[[')
    // The folder [[KPIs]] names is not this one and its notes are no rows here — a picker fed
    // the rows alone would have fallen back to the two notes instead.
    expect(options(el)).toEqual(['CAC', 'LTV'])
  })

  it('a new folder narrows the picker as soon as the tree has it — no note has to change', async () => {
    const settings = { ...SETTINGS, columns: { ...SETTINGS.columns, related: { kind: 'multi-link', target: '[[Fresh]]' } } }
    const el = await mount(settings)
    selectView(el, 'Table')
    const typed = (): (string | null)[] => {
      openCell(el, 0, 2)
      setValue(byLabel<HTMLInputElement>(el, 'Edit related'), '[[')
      const offered = options(el)
      press(byLabel(el, 'Edit related'), 'Escape')
      return offered
    }
    expect(typed()).toHaveLength(7) // no folder named Fresh: every note
    const records = [...vault(), rec('/vault/Fresh/One.md')].sort((a, b) => (a.path < b.path ? -1 : 1))
    feed(settings, records) // the note is indexed before the tree shows its folder
    expect(typed()).toHaveLength(8)
    vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: [...DIRS, { type: 'dir', name: 'Fresh', path: '/vault/Fresh', children: [] }], generatedAt: 2 })
    await fetchTree('/vault')
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), source.folders), records, source.folders)) // the bridge, on a folder list that moved
    expect(typed()).toEqual(['One'])
  })

  it('a link cell naming a FOLDER by its id reads as the folder’s name (YAZ-2290 D10)', async () => {
    const el = await mount(SETTINGS, vault().map((r) => (r.path === LEAD ? { ...r, properties: { ...r.properties, related: [`[[${STAGES_ID}]]`] } } : r)))
    selectView(el, 'Table')
    expect(q(el, '[data-cell="0:2"]').textContent).toBe('stages')
  })

  it('committing writes the note’s own frontmatter, one key, through the shared writer', async () => {
    const el = await mount()
    selectView(el, 'Table')
    openCell(el, 0, 2)
    setValue(byLabel<HTMLInputElement>(el, 'Edit related'), '[[')
    click(q(el, '[role="option"]')) // completes to [[CAC]]
    press(byLabel(el, 'Edit related'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit related'), 'Enter') // empty input commits the list
    expect(write).toHaveBeenCalledExactlyOnceWith(LEAD, 'related', ['[[CAC]]'])
  })
})

describe('New births a note in the folder (D4/E1/E3)', () => {
  it('creates it IN the folder with no frontmatter at all — no empty column keys — and opens it', async () => {
    const el = await mount()
    click(byLabel(el, 'New note'))
    await flush()

    expect(readFile.mock.calls).toEqual([[SETTINGS_FILE], ['/vault/stages/.template.md']]) // the page's own bytes (D9), then E3: the folder's own hidden template
    expect(createFile).toHaveBeenCalledTimes(1)
    expect(created(0)).toEqual({ path: '/vault/stages/Untitled.md', content: '' })
    expect(onOpenFile).toHaveBeenCalledWith('/vault/stages/Untitled.md')
  })

  it("with a `.template.md` in the folder, its frontmatter and body are the note's", async () => {
    readFile.mockResolvedValue({ path: '/vault/stages/.template.md', content: '---\nowner: me\n---\n## Notes\n', mtime: 1, size: 0 })
    const el = await mount()
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).content).toBe('---\nowner: me\n---\n## Notes\n')
  })

  it('a board column\'s "+" writes the one real seed — that column\'s value — and nothing else', async () => {
    const el = await mount({ columns: DEFAULT_COLUMNS, views: [{ ...BOARD, groupBy: { property: 'note.status' } }] }, [...vault(), rec('/vault/stages/Done one.md', { status: '4-Done' })])
    click(byLabel(el, 'New note in group 4-Done'))
    await flush()
    expect(created(0)).toEqual({ path: '/vault/stages/Untitled.md', content: '---\nstatus: 4-Done\n---\n' })
  })

  it.each(['table', 'board', 'cards', 'list'])('the "+" on a group header when a %s is grouped by Folder (`file.folder`) creates the note in that group’s folder', async (type) => {
    const view = { type, name: 'View', order: ['file.name'], groupBy: { property: 'file.folder' } }
    const el = await mount({ ...SETTINGS, views: [view] }, [...vault(), rec('/vault/stages/Untitled.md')])
    click(byLabel(el, 'New note in group stages/archive'))
    await flush()
    // Born in the subfolder, from ITS template, and named past ITS notes alone: `stages/Untitled` is no clash there.
    expect(readFile.mock.calls.at(-1)).toEqual(['/vault/stages/archive/.template.md'])
    expect(created(0)).toEqual({ path: '/vault/stages/archive/Untitled.md', content: '' })
    expect(onOpenFile).toHaveBeenCalledWith('/vault/stages/archive/Untitled.md')
    click(byLabel(el, 'New note in group stages'))
    await flush()
    expect(created(1).path).toBe('/vault/stages/Untitled 2.md')
  })

  it('the "+" under a group-by-Folder group that is not under the opened folder (a shortcut’s home) creates in the opened folder', async () => {
    const records = vault().map((r) => (r.path === OUTSIDER ? { ...r, properties: { also_in: [STAGES_ID] } } : r))
    const el = await mount({ ...SETTINGS, views: [{ type: 'table', name: 'View', order: ['file.name'], groupBy: { property: 'file.folder' } }] }, records)
    click(byLabel(el, 'New note in group Sub'))
    await flush()
    expect(created(0).path).toBe('/vault/stages/Untitled.md')
  })

  it('a TYPED name (YAZ-943) lands in the folder under that name and dedups like Untitled', async () => {
    await mount()
    await expect(captured.folder!.create({ properties: {} }, 'Ship it')).resolves.toBe('/vault/stages/Ship it.md')
    // A note's basename is taken → the typed base steps to " 2", same scheme as Untitled.
    await expect(captured.folder!.create({ properties: {} }, 'Lead Gen')).resolves.toBe('/vault/stages/Lead Gen 2.md')
  })

  it('a second add of the same name before the index has the first steps to " 2" instead of failing', async () => {
    await mount()
    await captured.folder!.create({ properties: {} }, 'Ship it')
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'file exists')) // on disk, not yet in the snapshot
    await expect(captured.folder!.create({ properties: {} }, 'Ship it')).resolves.toBe('/vault/stages/Ship it 2.md')
  })

  it('a typed name with path separators is tamed (slashes become spaces); whitespace-only falls back to Untitled', async () => {
    await mount()
    await expect(captured.folder!.create({ properties: {} }, 'a/b')).resolves.toBe('/vault/stages/a b.md')
    await expect(captured.folder!.create({ properties: {} }, '   ')).resolves.toBe('/vault/stages/Untitled.md')
  })

  it('a create failure is reported in place, never thrown at the tab', async () => {
    createFile.mockRejectedValue(new Error('read-only vault'))
    const el = await mount()
    click(byLabel(el, 'New note'))
    await flush()
    expect(el.textContent).toContain('read-only vault')
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

// ---------- the write-echo guard vs rapid gestures (YAZ-1241) ----------

describe('the write-echo guard vs rapid gestures (YAZ-1241)', () => {
  it('a genuinely external edit still rebuilds, even while a write is in flight', async () => {
    const el = await mount()
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush()

    // An outside editor rewrites the settings before our echo arrives: disk truth outranks the
    // unechoed local write (the guard's `pending` queue clears, the external state adopts).
    feed({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['note.order == 1'] } }] })
    expect(propertyShown(el)).toContain('Order')
  })
})
