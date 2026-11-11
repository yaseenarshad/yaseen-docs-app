/**
 * The folder view (YAZ-2290; the adapter is 🔒 D3 of YAZ-818). Mounted with react-dom in jsdom over
 * a REAL `WikilinkResolveSource` — the App-owned feed the whole view runs on — with `writeProperty`
 * mocked (the settings door), `writeRouted` mocked (every value a view writes, YAZ-4713 C1) and `api`
 * mocked for the create path. Some blocks swap in the REAL writers over an in-memory disk.
 *
 * Pinned here: its rows are the notes UNDER the folder, at any depth, and its shortcuts; a folder with no
 * `.folder.md` shows the defaults and opening it writes nothing; link resolution and the link
 * pickers read the WHOLE vault even though the rows are a subset; a config edit is ONE
 * `folder_settings` write on the folder's `.folder.md` while a cell edit writes the NOTE's own field
 * (a "Separate value for <folder>" column's goes to the page's block of `in`, C3); columns flow down
 * from the parent folders (C2); switching view writes nothing at all; and "New" births a note
 * in the folder from its template and the seed alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { noteFileName } from '@shared/noteName'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { CreateFileRequest, IndexRecord, TreeNode } from '@shared/types'
import { declarationForKind } from './view/declarationForKind'
import { fetchTree } from '../lib/treeFeed'
import { linkResolver, vaultDirs } from '../links/folderLinks'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { click, flush, press, q, rec, renderFolderView, setValue, unmountFolderView } from './testFolderView'
import { DEFAULT_FOLDER_PAGES } from '@shared/types'
import tocCss from '../editor/toc/toc.css?inline'

/** The page with Settings › Folder pages › Confirm changes off (YAZ-3746 13AN): these tests pin where a write goes, not the ask before it. */
const renderNoAsk: typeof renderFolderView = (props) => renderFolderView({ folderPages: { ...DEFAULT_FOLDER_PAGES, confirmChanges: false }, ...props })

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn(), writeRouted: vi.fn(), transformFile: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn(), mintNoteId: vi.fn(), tree: vi.fn() },
}))
/** The real pane, wrapped, so a test can reach the host's bundle directly. */
const captured = vi.hoisted(() => ({ folder: null as FolderHost | null, records: [] as readonly IndexRecord[] }))
vi.mock('./ViewsPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ViewsPane')>()
  return {
    ...actual,
    ViewsPane: (props: ViewsPaneProps) => {
      captured.folder = props.folder
      captured.records = props.records
      return <actual.ViewsPane {...props} />
    },
  }
})


import { api, BridgeRequestError } from '../api'
import { testDoor } from '../testNoteIds'
import type { FolderHost, ViewsPaneProps } from './ViewsPane'
import { transformFile, writeProperties, writeProperty, writeRouted } from './writeProperty'

const write = vi.mocked(writeProperty)
/** The ONE door a view writes a value through (YAZ-4713 C1): the note, the fields, the page's separate keys, the page's id when one is separate. */
const writeValues = vi.mocked(writeRouted)
/** No column of the page is separate (C3): every value is the note's own field, and no page id is asked for. */
const SHARED = new Set<string>()
/** The one-file transform behind a declaration write (`writeFolderColumn`) and a column delete's note strips. */
const transform = vi.mocked(transformFile)
const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createFile = vi.mocked(api.createFile)
/** The atomic content-at-create form is the only one this path uses (`createNote`). */
const created = (call: number): CreateFileRequest => createFile.mock.calls[call][0] as CreateFileRequest
/** What a create from a view is expected to have sent (YAZ-2420 D20): the note titled `title` in `dir`, under its built name, holding `properties` and then its title. */
const born = (call: number, dir: string, properties = '', title = 'Untitled'): CreateFileRequest => {
  const id = created(call).id!
  return { path: `${dir}/${noteFileName(title, id)}`, content: `---\n${properties}title: ${title}\n---\n`, id }
}

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
/** A Select column a test declares itself: no folder has one by default (YAZ-4713 C5). */
const STATUS = { status: { kind: 'select' as const, options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] } }
const SETTINGS = {
  columns: { order: { kind: 'number' as const }, related: { kind: 'multi-link' as const, target: '[[KPIs]]' } },
  views: [{ type: 'page', name: 'Page' }, TABLE],
}

/** A note's properties holding `values` as its own fields (YAZ-4713 C1: one value per note, read the same from every page), beside its `own` other fields. */
const held = (values: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, unknown> => ({ ...own, ...values })
/** The folder under test's own block of `in` (D19): today only a separate column's values (C3), and what a column delete strips. */
const inBlock = (values: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, unknown> => ({ ...own, in: { [STAGES_ID]: values } })

/** The whole snapshot, in the index's path order: the folder's two notes, one in a SUBFOLDER, and notes elsewhere. */
function vault(): IndexRecord[] {
  return [
    rec(OTHER, held({ order: 7 }, { title: 'in another folder' })),
    rec(OUTSIDER, {}),
    rec('/vault/kpis/CAC.md'),
    rec('/vault/kpis/LTV.md'),
    rec(LEAD, held({ order: 2, owner: '[[Sub/Outsider]]' })),
    rec(SALES, held({ order: 1 })),
    rec(DEEP, held({ order: 3 })),
  ]
}

// ---------- harness ----------

let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()

/**
 * WikilinkIndexBridge's own wrapping: THE link resolver — a note, else a folder of the Files
 * tree — the notes, and the folder settings records riding beside them. `settings: null` = the
 * folder has no `.folder.md`. The vault uses IDs, here and wherever a test feeds the source itself,
 * but for the blocks that say otherwise (YAZ-2523): with `ids` false no record has an id, the folder's included.
 */
function feed(settings: unknown = SETTINGS, records: IndexRecord[] = vault(), ids = true, mtime = 1): void {
  const folders = settings === null ? [] : [{ ...rec(SETTINGS_FILE, { folder_settings: settings }, mtime), ...(ids && { id: STAGES_ID }) }]
  act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, ids))
}

/** Mounts, hands over the first snapshot — the order the window does it in — and lets the settings file's read answer. */
async function mount(settings: unknown = SETTINGS, records: IndexRecord[] = vault(), ids = true): Promise<HTMLElement> {
  const el = renderNoAsk({ path: STAGES, source, onOpenFile })
  feed(settings, records, ids)
  await flush()
  return el
}

beforeEach(async () => {
  source = createWikilinkResolveSource()
  vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: DIRS, generatedAt: 1 })
  await fetchTree('/vault') // the window's tree feed: a folder tab only mounts once it has answered
  write.mockResolvedValue({ mtime: 2 })
  writeValues.mockResolvedValue({ mtime: 2 })
  transform.mockResolvedValue({ mtime: 2, content: '' })
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
  // The door in the main process (YAZ-2677 D4): a new note's id is the vault's next number.
  vi.mocked(api.mintNoteId).mockImplementation(testDoor())
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
 * extension and all). The Page tab has no rows at all: it is a document.
 */
const rowNames = (el: ParentNode): string[] => texts(el, '.view-row__link, .view-table__name')

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
  it('shows its notes under the default views — Table, then Board, no Page — and opening writes NOTHING', async () => {
    const el = await mount(null)
    await flush()
    expect(q(el, 'h1').textContent).toBe('stages')
    expect(texts(el, '.view-tab__btn')).toEqual(['Table', 'Board'])
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
    expect(captured.folder!.settings.columns).toEqual({}) // YAZ-4713 C5: a folder starts with no column
    expect(write).not.toHaveBeenCalled()
    expect(writeValues).not.toHaveBeenCalled()
    expect(transform).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('Empty folder: opens with empty views — the default Table, then Board, no rows, "0 items" — and opening writes NOTHING', async () => {
    const el = await mount(null, [rec(OTHER), rec(OUTSIDER), rec('/vault/kpis/CAC.md')]) // notes elsewhere; none under the folder
    await flush()
    expect(q(el, 'h1').textContent).toBe('stages')
    expect(texts(el, '.view-tab__btn')).toEqual(['Table', 'Board'])
    expect(rowNames(el)).toEqual([])
    // No data rows: only the "+ New" row (YAZ-4539).
    expect([...el.querySelectorAll('.view-table tbody tr')].map((tr) => tr.className)).toEqual(['view-table__new'])
    expect(q(el, '.view-toolbar__count').textContent).toBe('0 items')
    selectView(el, 'Board')
    expect(el.querySelectorAll('.view-board__card')).toHaveLength(0)
    expect(q(el, '.view-toolbar__count').textContent).toBe('0 items')
    expect(write).not.toHaveBeenCalled()
    expect(writeValues).not.toHaveBeenCalled()
    expect(transform).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('its Board has no column to group by (YAZ-4713 C5): it shows the empty state with "Group by…", and creates nothing', async () => {
    const el = await mount(null)
    selectView(el, 'Board')
    expect(q(el, '.view-board__hint').textContent).toContain('Pick a property to group by')
    expect([...el.querySelectorAll('.view-board__hint button')].map((b) => b.textContent)).toEqual(['Group by…'])
    expect(write).not.toHaveBeenCalled()
  })

  it('the FIRST change writes the whole block into `.folder.md` — with no column: a folder starts blank (E2, YAZ-4713 C5)', async () => {
    const el = await mount(null)
    click(byLabel(el, 'Add view'))
    expect(texts(el, '.view-popover--menu [role="menuitem"]')).toEqual(['Table', 'Board', 'Calendar', 'Cards', 'List', 'Page']) // the Page is the "+" menu's (D5a, YAZ-4584)
    click(menuItem(el, 'Cards'))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      views: [
        { type: 'table', name: 'Table' },
        { type: 'board', name: 'Board' },
        { type: 'cards', name: 'Cards' },
      ],
    }, expect.any(Function))
    expect(byLabel<HTMLInputElement>(el, 'View name').value).toBe('Cards') // the appended tab mounts in rename
  })

  it('a column added there, then a view edit before the index echoes either: the second write still leaves the column on disk', async () => {
    const el = await mount(null)
    act(() => captured.folder!.setColumns({ owner: { kind: 'link' } }))
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    const columns = { owner: { kind: 'link' } }
    expect((write.mock.calls[0][2] as { columns: unknown }).columns).toEqual(columns)
    // The view write changed no column (YAZ-4637 M1): its rebase keeps the one the first write put on disk.
    const onDisk = { columns, views: [{ type: 'table', name: 'Table' }, { type: 'board', name: 'Board' }] }
    expect((write.mock.calls[1][3]!(onDisk) as { columns: unknown }).columns).toEqual(columns)
  })

  it.each([
    [true, ['Table', 'Board']],
    [false, ['Table']],
  ])('saved views that cannot be read back fall back to the defaults of the vault they are in (IDs %s)', async (ids, tabs) => {
    const el = await mount({ views: [{ type: 'table', name: 'Broken', bad: Symbol('no YAML for this') }] }, vault(), ids)
    expect(texts(el, '.view-tab__btn')).toEqual(tabs)
  })

  it('a note’s own `id`, `title` and `also_in` are no columns where the vault uses IDs: they are the app’s keys (YAZ-4713 C1)', async () => {
    const el = await mount({}, [rec(LEAD, held({ order: 2 }, { id: 'n0tead000001', title: 'Lead', also_in: [STAGES_ID] }))])
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)')).toEqual(['Name', 'Order'])
  })

  it('before the first snapshot nothing renders: only the index can say the folder has no settings', async () => {
    expect(renderNoAsk({ path: STAGES, source, onOpenFile }).innerHTML).toBe('')
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
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', expect.anything(), expect.any(Function)) // the settings, and no note
    expect(writeValues).not.toHaveBeenCalled()
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
    const el = renderNoAsk({ path: STAGES, source, onOpenFile })
    const folders = [{ ...rec(SETTINGS_FILE, { folder_settings: SETTINGS }), id: STAGES_ID }, { ...rec('/vault/stages/archive/.folder.md'), id: 'z8y7x6w5v4t3' }]
    act(() => source.update(linkResolver(vault(), '/vault', vaultDirs('/vault'), folders), vault(), folders, true))
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

  /** One table per filter, over the folder's two direct notes and the one in its subfolder `archive`. */
  const filtered = (name: string, filters?: string): Record<string, unknown> => ({ type: 'table', name, order: ['file.name'], ...(filters === undefined ? {} : { filters }) })

  it('Filter Folder to this folder (the exact-match operator, `file.folder == "<folder>"` / "is any of"): only the notes directly in it — while the folder page with no filter shows every note under it at any depth', async () => {
    const el = await mount({ views: [filtered('All'), filtered('Exact', 'file.folder == "stages"'), filtered('Any of', '["stages"].contains(file.folder)')] })
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old']) // no filter: the subfolder's note is a row
    selectView(el, 'Exact')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
    selectView(el, 'Any of')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
  })

  it('the OTHER Folder operator, "in folder" (`file.inFolder("<folder>")`), is not exact: it matches the notes under that folder at any depth', async () => {
    const el = await mount({ views: [filtered('Under', 'file.inFolder("stages")'), filtered('Under the subfolder', 'file.inFolder("stages/archive")')] }, [...vault(), rec('/vault/stages/archive/2019/Older.md')])
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old', 'Older']) // the folder's own notes and every depth below
    selectView(el, 'Under the subfolder')
    expect(rowNames(el)).toEqual(['Old', 'Older']) // the subfolder's own note and the one below it; not its parent's
  })

  /** Each group header's label → the names of the rows under it, read down the table body. */
  const groupedNames = (el: ParentNode): Record<string, string[]> => {
    const groups: Record<string, string[]> = {}
    let under: string[] | null = null
    for (const row of el.querySelectorAll('.view-table tbody tr')) {
      const header = row.querySelector('.view-group__value')
      if (header !== null) under = groups[header.textContent ?? ''] = []
      else under?.push(...texts(row, '.view-table__name'))
    }
    return groups
  }
  const BY_FOLDER = { type: 'table', name: 'By folder', order: ['file.name'], groupBy: { property: 'file.folder' } }

  it('Group by Folder (YAZ-2541): one group per folder ONE step below this one, a deeper note rolled up into it, the direct notes under the folder’s own group; a subfolder with no settings file is headed by its directory name', async () => {
    const el = await mount({ views: [BY_FOLDER] }, [...vault(), rec('/vault/stages/archive/2019/Older.md')])
    expect(groupedNames(el)).toEqual({ stages: ['Lead Gen', 'Sales'], archive: ['Old', 'Older'] })
    expect(texts(el, '.view-group__count')).toEqual(['2', '2'])
  })

  it('a Folder group is headed by the folder’s TITLE when it has a settings record (YAZ-2541)', async () => {
    const el = renderNoAsk({ path: STAGES, source, onOpenFile })
    const records = [...vault(), rec('/vault/stages/archive/2019/Older.md')]
    const folders = [
      { ...rec(SETTINGS_FILE, { folder_settings: { ...SETTINGS, views: [BY_FOLDER] } }), id: STAGES_ID, title: 'Pipeline stages' },
      { ...rec('/vault/stages/archive/.folder.md'), id: 'z8y7x6w5v4t3', title: 'The archive' },
    ]
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders))
    await flush()
    expect(groupedNames(el)).toEqual({ 'Pipeline stages': ['Lead Gen', 'Sales'], 'The archive': ['Old', 'Older'] })
    expect(el.querySelector('.view-group__value')?.getAttribute('title')).toBe('Pipeline stages') // a cut-off name is whole in its tooltip
  })

  it('Folder then Folder (YAZ-2541): the inner groups are the next folder down, a subfolder’s own notes directly under it', async () => {
    const el = await mount({ views: [{ ...BY_FOLDER, groupBy: [{ property: 'file.folder' }, { property: 'file.folder' }] }] }, [...vault(), rec('/vault/stages/archive/2019/Older.md')])
    expect(groupedNames(el)).toEqual({ stages: ['Lead Gen', 'Sales'], archive: ['Old'], '2019': ['Older'] })
    expect(texts(el, '.view-group__count')).toEqual(['2', '2', '1'])
  })

  it('"Open folder page ↗" on a subfolder’s group opens its page through the host’s door (YAZ-4564 D27)', async () => {
    const onOpenFolderPage = vi.fn()
    const el = renderNoAsk({ path: STAGES, source, onOpenFile, onOpenFolderPage })
    feed({ views: [BY_FOLDER] })
    await flush()
    expect(el.querySelector('[aria-label="Open folder page stages"]')).toBeNull() // the page's own group
    click(q(el, '[aria-label="Open folder page archive"]'))
    expect(onOpenFolderPage).toHaveBeenCalledWith('/vault/stages/archive')
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
    expect(marked(el, '.view-table__name')).toEqual(['Other'])
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
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(OTHER, [{ key: 'order', value: 9 }], SHARED, undefined) // in this folder's block of it
  })

  /** The snapshot with a second settings file beside the folder's own: `dir`'s, saving `columns`. */
  const feedWith = (dir: string, columns: Record<string, unknown>, records: IndexRecord[] = shortcut()): void => {
    const folders = [{ ...rec(`${dir}/.folder.md`, { folder_settings: { columns, views: [TABLE] } }), id: 'z8y7x6w5v4t3' }, { ...rec(SETTINGS_FILE, { folder_settings: SETTINGS }), id: STAGES_ID }]
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
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
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(OTHER, [{ key: 'order', value: 9 }], SHARED, undefined) // a number: stages' own declaration
  })

  it('Delete column and clear (YAZ-4713 C7): the field leaves every note under the folder that holds it — at any depth, and a shortcut — and a note the folder does not show keeps it', async () => {
    await mount(SETTINGS, shortcut())
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES, DEEP])
    const strip = transform.mock.calls[0][1]
    // The note's own field goes; a separate page's block (C3) is not this column's value.
    expect(strip(`---\ntitle: mine\norder: 5\nin:\n  z8y7x6w5v4t3:\n    order: 4\n---\n`)).toBe('---\ntitle: mine\nin:\n  z8y7x6w5v4t3:\n    order: 4\n---\n')
    transform.mockClear()
    await mount(SETTINGS, vault()) // no shortcut: Other is no row here, and keeps its `order`
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([LEAD, SALES, DEEP])
  })

  it('"Keep the values in the notes" (C7): the column goes, and no note is written', async () => {
    await mount(SETTINGS, shortcut())
    await act(async () => captured.folder!.deleteColumn!('order', false))
    expect(transform.mock.calls.map(([path]) => path)).not.toContain(LEAD)
  })

  it('a subfolder that defines the key itself keeps its notes’ values: its page shows its own definition (C7)', async () => {
    await mount(SETTINGS, shortcut())
    feedWith('/vault/stages/archive', { order: { kind: 'text' } })
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES])
  })

  it('a note that cannot be written is reported in the column banner; the others are still cleared', async () => {
    transform.mockRejectedValueOnce(new Error('frontmatter is not valid YAML'))
    const el = await mount(SETTINGS, shortcut())
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(q(el, '[role="alert"]').textContent).toContain('Could not remove "order" from 1 note: Other (frontmatter is not valid YAML)')
    expect(transform.mock.calls.map(([path]) => path)).toEqual([OTHER, LEAD, SALES, DEEP])
  })

  it('the confirm sheet names the folder and counts the notes under it holding the field, taken once, when the sheet opens (C7)', async () => {
    const own = rec('/vault/stages/Own.md', { order: 9 })
    const el = await mount(SETTINGS, [...vault(), own]) // Other is no row here: not counted
    openDeleteSheet(el)
    const text = q(el, '.confirm__text').textContent
    expect(text).toMatch(/^Delete the column "Order"\? It goes from .+ and every page under it\.$/)
    const main = () => [...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)
    expect(main()).toContain('Delete column and clear 4 values')
    expect(main()).toContain('Keep the values in the notes')
    feed(SETTINGS, [...vault(), own, rec('/vault/stages/New.md', { order: 4 })])
    expect(main()).toContain('Delete column and clear 4 values')
  })

  it('a cell edit on a row from a subfolder writes that note, in the OPENED folder’s block', async () => {
    const el = await mount()
    selectView(el, 'Table')
    openCell(el, 2, 1) // archive/Old's `order`
    const input = byLabel<HTMLInputElement>(el, 'Edit order')
    setValue(input, '9')
    press(input, 'Enter')
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(DEEP, [{ key: 'order', value: 9 }], SHARED, undefined)
  })

  it('a board drag on a row from a subfolder writes that note, in the OPENED folder’s block', async () => {
    const el = await mount({ ...SETTINGS, views: [{ ...BOARD, order: ['file.name'], groupBy: { property: 'note.order' } }] })
    const fire = (target: Element, type: string): void => act(() => void target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
    const old = [...el.querySelectorAll('.view-board__title')].find((title) => title.textContent === 'Old')!.closest('.view-board__card')!
    const column = [...el.querySelectorAll('.view-board__col')].find((col) => q(col, '.view-group__value').textContent === '1')!
    fire(old, 'dragstart')
    fire(column, 'drop')
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(DEEP, [{ key: 'order', value: 1, prevRaw: 3 }], SHARED, undefined)
  })

  it('"New" creates the note DIRECTLY in the opened folder, whatever rows its subfolders show', async () => {
    const el = await mount(SETTINGS, [...vault(), rec('/vault/stages/archive/Untitled.md')])
    selectView(el, 'Table')
    expect(rowNames(el)).toContain('Untitled') // a row here, from the subfolder
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).path).toBe(born(0, '/vault/stages').path)
  })
})

describe('Delete column leaves no stale reference (YAZ-4596 S37)', () => {
  it('sort, group levels, filters, wrap, fills, the frozen count and a calendar\'s "Show by" lose the column in the one write; `other_files` and the rest stay; every view renders after the echo', async () => {
    const table = {
      type: 'table',
      name: 'Table',
      order: ['file.name', 'note.order', 'note.related'],
      frozenColumns: 2, // frozen up to Order: the line moves back to Name, never on to Related
      sort: [{ property: 'note.order', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
      groupBy: [{ property: 'note.order' }, { property: 'file.folder' }],
      filters: { and: ['note.order != 9', 'file.name.contains("")'] },
      columnWrap: { 'note.order': false, 'note.related': false },
      fills: [{ note: '[[Lead Gen]]', column: 'note.order', fill: 'red' }, { note: '[[Sales]]', fill: 'blue' }, { note: '[[Sales]]', column: 'order', fill: 'green' }],
    }
    const calendar = { type: 'calendar', name: 'Calendar', dateProperty: 'note.order' }
    const settings = { ...SETTINGS, views: [SETTINGS.views[0], table, BOARD, calendar], other_files: ['[[Old]]'] }
    const el = await mount(settings)
    selectView(el, 'Table')
    rightClick([...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')][1])
    click(menuItem(el, 'Delete column…'))
    click(q(el, '.confirm__btn--danger'))
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const after = written() as typeof settings
    expect(after.columns).toEqual({ related: SETTINGS.columns.related })
    expect(after.views[1]).toEqual({
      type: 'table',
      name: 'Table',
      order: ['file.name', 'note.related'],
      frozenColumns: 1,
      sort: [{ property: 'file.name', direction: 'ASC' }],
      groupBy: [{ property: 'file.folder' }],
      filters: { and: ['file.name.contains("")'] },
      columnWrap: { 'note.related': false },
      fills: [{ note: '[[Sales]]', fill: 'blue' }],
    })
    expect(after.views[2]).toEqual(BOARD)
    expect(after.views[3]).toEqual({ type: 'calendar', name: 'Calendar' })
    expect(after.other_files).toEqual(['[[Old]]'])
    expect(JSON.stringify(after.views)).not.toMatch(/note\.order|"column":"order"/)

    // The echo: every view renders on the new settings, with no banner.
    feed(after)
    await flush()
    for (const name of ['Table', 'Board', 'Calendar']) {
      selectView(el, name)
      await flush()
      expect(el.querySelector('[role="alert"]')).toBeNull()
    }
    selectView(el, 'Table')
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim())).not.toContain('Order')
  })
})

// ---------- the chrome (🔒 rule 4 + Q3) ----------

describe('the Page tab is the folder\'s own document (YAZ-4584 D38)', () => {
  /** The editor `Editor` builds, stood in for: what it is handed is what is under test here (Editor.test.tsx mounts the real one). */
  const renderPage = vi.fn(() => <pre className="page-doc">the Page</pre>)
  const mountPage = async (settings: unknown): Promise<HTMLElement> => {
    const el = renderNoAsk({ path: STAGES, source, onOpenFile, renderPage })
    feed(settings)
    await flush()
    return el
  }

  it('a stored `type: outline` shows as the Page tab, and its body is the note editor on `.folder.md`; opening writes nothing', async () => {
    const el = await mountPage({ ...SETTINGS, views: [{ type: 'outline', name: 'Outline', outline: '- [[Sales]]' }, TABLE] })
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
    expect(q(el, '.view-page .page-doc').textContent).toBe('the Page')
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull() // a document, not rows
    expect(write).not.toHaveBeenCalled()
  })

  it('the first settings write states `type: page`, and the old outline string rides along untouched for the hand move (D39)', async () => {
    const el = await mountPage({ ...SETTINGS, views: [{ type: 'outline', name: 'Outline', outline: '- [[Sales]]' }, TABLE] })
    rightClick(tab(el, 'Table'))
    click(menuItem(el, 'Rename'))
    const input = byLabel<HTMLInputElement>(el, 'View name')
    setValue(input, 'Grid')
    press(input, 'Enter')
    await flush()
    expect(written().views).toEqual([{ type: 'page', name: 'Outline', outline: '- [[Sales]]' }, { ...TABLE, name: 'Grid' }])
  })

  it('at most one Page tab: "+" leaves Page out while there is one, and Duplicate is off on it', async () => {
    const el = await mountPage(SETTINGS)
    click(byLabel(el, 'Add view'))
    expect(texts(el, '.view-popover--menu [role="menuitem"]')).toEqual(['Table', 'Board', 'Calendar', 'Cards', 'List'])
    click(byLabel(el, 'Add view'))
    rightClick(tab(el, 'Page'))
    expect((menuItem(el, 'Duplicate') as HTMLButtonElement).disabled).toBe(true)
  })

  it('the outline\'s names keep the whole page clear: the folder page\'s scroller makes the room a note\'s does (YAZ-4849)', async () => {
    // The Page's note editor puts its outline beside its body, in the Page tab (Editor.tsx, `inFolderPage`): deep in
    // the folder page's scroller, never a child of `section.editor` as on a note.
    const el = renderNoAsk({ path: STAGES, source, onOpenFile, renderPage })
    el.classList.add('editor') // Editor.tsx: the folder page's `section.editor`
    // While the names show, the outline marks the section it measures (tocFrame.tsx `useTocWidthVar`).
    el.setAttribute('data-toc-names', '')
    feed(SETTINGS)
    await flush()
    const sheet = document.head.appendChild(document.createElement('style'))
    sheet.textContent = tocCss
    try {
      const host = q<HTMLElement>(el, ':scope > .editor-host')
      // The title, the view tabs and toolbar, the Page, Other files and Comments are all in this scroller.
      expect(getComputedStyle(host).paddingRight).toBe('var(--toc-width)')
      // The lines look (no names), or no outline at all (the Table tab), takes no room, as on a note.
      el.removeAttribute('data-toc-names')
      expect(getComputedStyle(host).paddingRight).not.toBe('var(--toc-width)')
    } finally {
      sheet.remove()
    }
  })

  it('a folder with no `.folder.md` yet mounts no editor: there is no file to read until the first write makes one', async () => {
    const el = renderNoAsk({ path: STAGES, source, onOpenFile, renderPage })
    act(() => source.update(linkResolver(vault(), '/vault', vaultDirs('/vault'), []), vault(), [], true))
    await flush()
    expect(el.querySelector('.page-doc')).toBeNull()
    expect(captured.folder!.renderPage).toBeUndefined()
  })
})

describe('the chrome is the views chrome', () => {
  it('both skins render and the tabs switch between them', async () => {
    const el = await mount()
    expect(texts(el, '.view-tab__btn')).toEqual(['Page', 'Table']) // what the settings list is what you get (D3)
    expect(el.querySelector('.view-page')).not.toBeNull() // YAZ-820's renderer
    expect(el.querySelector('.view-table')).toBeNull()
    selectView(el, 'Table')
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales', 'Old'])
  })

  it('switching view writes NOTHING — which view is active is session state, never the file', async () => {
    const el = await mount()
    selectView(el, 'Table')
    selectView(el, 'Page')
    expect(write).not.toHaveBeenCalled()
  })

  it('the tabs EDIT (YAZ-1471): "+" adds, a right-click opens the menu; the outline, a document, still offers no Filter (YAZ-1218)', async () => {
    const el = await mount()
    expect(el.querySelector('[aria-label="Add view"]')).not.toBeNull()
    rightClick(tab(el, 'Page'))
    // YAZ-4585 (D41): "Make default view" (YAZ-3746 13S, was "Open on this view") and "View settings…" sit between Duplicate
    // and Delete. The Page has no rows, so its menu has no "Export as CSV…" / "Copy as table" (YAZ-4643 S8); `Toolbar.test.tsx` lists a Table's.
    expect(texts(el, '.ctx-menu[role="menu"] [role^="menuitem"]')).toEqual(['Rename', 'Duplicate', 'Make default view', 'View settings…', 'Delete'])
    // The Page is a document (YAZ-4584 D38): no copy, and no Properties menu for "View settings…" to open.
    const item = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu[role="menu"] [role^="menuitem"]')].find((b) => b.textContent === label)
    expect(item('Duplicate')?.disabled).toBe(true)
    expect(item('View settings…')?.disabled).toBe(true)
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
    expect(texts(el, '.view-tab__btn')).toEqual(['Page', 'Table'])
  })

  it('so does the delete sheet it opened', async () => {
    const el = await mount(THREE)
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    feed(SETTINGS)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(texts(el, '.view-tab__btn')).toEqual(['Page', 'Table'])
  })
})

// ---------- the default view (YAZ-1104) ----------

describe('the default view: a saved START, while which view is ACTIVE stays session state', () => {
  it('a page with a defaultView opens on that view — and opening writes nothing', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(el.querySelector('.view-page')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('a stale saved name falls back to the first view, silently', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Ghost' })
    expect(el.querySelector('.view-page')).not.toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('Page → Default view is ONE whole-key settings write carrying the name', async () => {
    const el = await mount()
    click(tab(el, 'Table')) // the Page offers no Properties menu; switching writes nothing
    click(byLabel(el, 'Columns and view'))
    click(el.querySelector('.view-popover--properties .view-menu__tab[data-tab="view"]')!) // the View tab (YAZ-4607 D59)
    setSelect(byLabel<HTMLSelectElement>(el, 'Default view'), 'Table')
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, defaultView: 'Table' }, expect.any(Function))
  })

  it('the dropdown shows the saved value, and First view clears the key', async () => {
    const el = await mount({ ...SETTINGS, defaultView: 'Table' })
    click(byLabel(el, 'Columns and view'))
    click(el.querySelector('.view-popover--properties .view-menu__tab[data-tab="view"]')!) // the View tab (YAZ-4607 D59)
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
    click(tab(el, 'Table')) // the Page has no Properties button of its own
    click(byLabel(el, 'Columns and view'))
    click(el.querySelector('.view-popover--properties .view-menu__tab[data-tab="view"]')!) // the View tab (YAZ-4607 D59)
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
    click(byLabel(el, 'Columns and view'))
    const clear = [...el.querySelectorAll<HTMLButtonElement>('.view-menu__action')].find((button) => button.textContent === 'Hide all')! // was "Unselect all" (YAZ-3746 demo round 2)
    click(clear)
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      ...settings,
      views: views.map((view) => {
        if (view.name !== name) return view
        const { frozenColumns: _frozen, ...rest } = view
        return { ...rest, order: [] }
      }),
    }, expect.any(Function))
    // Nothing is left to hide: the Shown section has no rows, so it has no "Hide all" (YAZ-3746 demo round 2), and no second write can follow.
    expect([...el.querySelectorAll('.view-menu__action')].some((button) => button.textContent === 'Hide all')).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a Board column-width edit is one whole-key folder_settings write', async () => {
    const withBoard = { ...SETTINGS, views: [...SETTINGS.views, BOARD] } // the settings SAY board now (D3)
    const el = await mount(withBoard)
    selectView(el, 'Board')
    click(byLabel(el, 'Columns and view'))
    click(el.querySelector('.view-popover--properties .view-menu__tab[data-tab="view"]')!) // the View tab (YAZ-4607 D59)
    const width = byLabel<HTMLInputElement>(el, 'Column width in pixels')
    setValue(width, '400')
    press(width, 'Enter')
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', {
      ...withBoard,
      views: [...SETTINGS.views, { ...BOARD, cardSize: 400 }],
    }, expect.any(Function))
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

    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, properties: { order: { displayName: 'Rank' } } }, expect.any(Function))
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
    fire(wrap('Page'), 'dragover', -5)
    fire(wrap('Page'), 'drop', -5)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [TABLE, SETTINGS.views[0]] })
    expect(tab(el, 'Table').getAttribute('aria-selected')).toBe('true')
  })

  it('a Board deleted through the menu STAYS deleted — nothing puts it back on the next read (D3)', async () => {
    const el = await mount({ ...SETTINGS, views: [...SETTINGS.views, BOARD] })
    expect(texts(el, '.view-tab__btn')).toEqual(['Page', 'Table', 'Board'])
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual(SETTINGS)
    feed(written()) // the index echoes our own write back
    expect(texts(el, '.view-tab__btn')).toEqual(['Page', 'Table'])
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
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(write).toHaveBeenCalledTimes(1)
    // The delete is this write's one change (YAZ-4637 M1); the declaration, on disk since its own write, is kept by the rebase.
    expect((write.mock.calls[0][2] as { columns: unknown }).columns).toEqual({ related: SETTINGS.columns.related })
    expect((write.mock.calls[0][3]!({ ...SETTINGS, columns: { ...SETTINGS.columns, owner: { kind: 'link' } } }) as { columns: unknown }).columns).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
    expect(columnsOf()).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
  })

  /** A sort added on the Table tab: one view write, whose rebase the test then runs over a block "on disk". */
  const addSort = async (el: HTMLElement) => {
    click(tab(el, 'Table'))
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
  }
  const rebased = (call: number, onDisk: unknown) => write.mock.calls[call][3]!(onDisk) as { columns: unknown }

  it('the echo of this page\'s own write clears the ahead copy whatever else disk holds (YAZ-4637 M1): an outside column change shows, and the next view write keeps it', async () => {
    const el = await mount()
    // "+ Add column", a Link with no target, as AddColumn builds it (the undefined target that kept the stamps apart).
    act(() => captured.folder!.setColumns({ ...SETTINGS.columns, rel: declarationForKind({ kind: 'link', target: undefined }, 'link') }))
    await flush()
    // Meanwhile a note's Properties panel made `order` a Text column; the index echoes disk after the write landed (mtime 2).
    const echoed = { ...SETTINGS, columns: { order: { kind: 'text' as const }, related: SETTINGS.columns.related, rel: { kind: 'link' as const } } }
    feed(echoed, vault(), true, 2)
    await flush()
    expect(columnsOf()).toEqual(echoed.columns)
    await addSort(el)
    expect(write).toHaveBeenCalledTimes(2)
    expect(rebased(1, echoed).columns).toEqual(echoed.columns)
  })

  it('a view write never carries a column this page did not change (M1): with the ahead copy stuck, the rebase still keeps disk\'s columns', async () => {
    const el = await mount()
    act(() => captured.folder!.setColumns({ ...SETTINGS.columns, rel: { kind: 'link' } }))
    await flush()
    // The echo differs (an outside change) and is not known to be this write's (mtime 1): the ahead copy stays.
    const echoed = { ...SETTINGS, columns: { order: { kind: 'text' as const }, related: SETTINGS.columns.related, rel: { kind: 'link' as const } } }
    feed(echoed)
    await flush()
    await addSort(el)
    expect(write).toHaveBeenCalledTimes(2)
    expect(rebased(1, echoed).columns).toEqual(echoed.columns)
    // A column added now rides as THE change: disk's other columns are kept under it. The block is stated over this
    // page's own last write (YAZ-4741: the echo is not known to be it), and the rebase onto disk keeps disk's `order`.
    act(() => captured.folder!.setColumns({ ...columnsOf(), extra: { kind: 'text' } }))
    await flush()
    expect(write).toHaveBeenCalledTimes(3)
    expect(rebased(2, echoed).columns).toEqual({ ...echoed.columns, extra: { kind: 'text' } })
  })

  it('two windows (M1): this one sets a column\'s type while another adds a column — the echo shows both, and a later view write keeps the other\'s column', async () => {
    const el = await mount()
    await setColumn('order', { kind: 'text' })
    const echoed = { ...SETTINGS, columns: { order: { kind: 'text' as const }, related: SETTINGS.columns.related, y: { kind: 'number' as const } } }
    feed(echoed, vault(), true, 2)
    await flush()
    expect(columnsOf()).toEqual(echoed.columns)
    await addSort(el)
    expect(write).toHaveBeenCalledTimes(1)
    expect(rebased(0, echoed).columns).toEqual(echoed.columns)
  })

  it('a refused settings write ABORTS a delete: the banner says why, the ahead copy is put back, and not one note is touched', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const el = await mount()
    await act(async () => captured.folder!.deleteColumn!('order'))
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
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, columns: COLUMNS }, expect.any(Function))
  })

  it('columns AND views ride in that SAME single write when views are passed', async () => {
    await mount()
    const views = [{ type: 'page', name: 'Page', order: ['[[Sales]]'] }, TABLE]
    act(() => captured.folder!.setColumns(COLUMNS, views))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_settings', { ...SETTINGS, columns: COLUMNS, views }, expect.any(Function))
  })

  /**
   * The LIVE def, never the index snapshot (YAZ-1471 D4): `settings` is the last snapshot the
   * index handed over, so a default-view choice (or a sort/filter edit, when the caller passes no
   * `views`) whose echo is still in flight would be clobbered by the next column write — YAZ-1234's
   * two-gestures-in-a-second data loss, through the other door.
   */
  it('carries an in-flight defaultView choice the index has not echoed back yet', async () => {
    const el = await mount()
    click(tab(el, 'Table')) // the Page offers no Properties menu
    click(byLabel(el, 'Columns and view'))
    click(el.querySelector('.view-popover--properties .view-menu__tab[data-tab="view"]')!) // the View tab (YAZ-4607 D59)
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
    expect(el.querySelector('.view-page')).not.toBeNull()

    feed(SETTINGS, [...vault(), rec('/vault/stages/Expansion.md')])
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
  })
})

describe('cell editing writes the NOTE’s own field, typed by the page’s columns (🔒 Q8, YAZ-4713 C1/C2)', () => {
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
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), source.folders), records, source.folders, true)) // the bridge, on a folder list that moved
    expect(typed()).toEqual(['One'])
  })

  it('a link cell naming a FOLDER by its id reads as the folder’s name (YAZ-2290 D10)', async () => {
    const el = await mount(SETTINGS, vault().map((r) => (r.path === LEAD ? { ...r, properties: held({ related: [`[[${STAGES_ID}]]`] }) } : r)))
    selectView(el, 'Table')
    expect(q(el, '[data-cell="0:2"]').textContent).toBe('stages')
  })

  it('committing writes the note’s own field, through the folder’s writer', async () => {
    const el = await mount()
    selectView(el, 'Table')
    openCell(el, 0, 2)
    setValue(byLabel<HTMLInputElement>(el, 'Edit related'), '[[')
    click(q(el, '[role="option"]')) // completes to [[CAC]]
    press(byLabel(el, 'Edit related'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit related'), 'Enter') // empty input commits the list
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(LEAD, [{ key: 'related', value: ['[[CAC]]'] }], SHARED, undefined)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('one key, capitals ignored (YAZ-4769, option B)', () => {
  // The view still names the column in the other capitals too, as a page's view may from before.
  const settings = { columns: { 'Dessert Column': { kind: 'text' as const } }, views: [{ type: 'table', name: 'Table', order: ['file.name', 'note.Dessert Column', 'note.dessert column'] }] }
  const records = (): IndexRecord[] => vault().map((r) => (r.path === LEAD ? { ...r, properties: held({ 'dessert column': 'Pie', 'DESSERT COLUMN': 'Tart' }) } : r))

  it('a note’s `dessert column` is the page’s `Dessert Column` cell, the first of two spellings winning; a view that names it in both capitals shows ONE column', async () => {
    const el = await mount(settings, records())
    selectView(el, 'Table')
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('Pie')
    expect(el.querySelector('[data-cell="0:2"]')).toBeNull()
    // One key on the row the views read: no second spelling waits under "Other properties".
    expect(captured.records.find((r) => r.path === LEAD)?.properties).toEqual({ 'Dessert Column': 'Pie' })
  })

  it('a write in any capitals goes through the one door under the column’s spelling', async () => {
    await mount(settings, records())
    await act(() => captured.folder!.writeValues!(LEAD, [{ key: 'dessert column', value: 'Cake' }]))
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(LEAD, [{ key: 'Dessert Column', value: 'Cake' }], SHARED, undefined)
  })
})

describe('New births a note in the folder (D4/E1/E3)', () => {
  it('creates it IN the folder holding its `title` and nothing else — no empty column keys — and opens it', async () => {
    const el = await mount()
    click(byLabel(el, 'New note'))
    await flush()

    expect(readFile.mock.calls).toEqual([[SETTINGS_FILE], ['/vault/stages/.template.md']]) // the page's own bytes (D9), then E3: the folder's own hidden template
    expect(createFile).toHaveBeenCalledTimes(1)
    expect(created(0)).toEqual(born(0, '/vault/stages'))
    expect(created(0).path).toMatch(/^\/vault\/stages\/untitled-yaz-\d+\.md$/)
    expect(onOpenFile).toHaveBeenCalledWith(created(0).path)
  })

  it('B: "New" titles the note `Untitled` every time — no `Untitled 2`: two clicks are two notes of one title, kept apart by their ids (YAZ-2420 D20)', async () => {
    const el = await mount(SETTINGS, [...vault(), rec('/vault/stages/Untitled.md')])
    click(byLabel(el, 'New note'))
    await flush()
    click(byLabel(el, 'New note'))
    await flush()
    expect([created(0), created(1)]).toEqual([born(0, '/vault/stages'), born(1, '/vault/stages')])
    expect(created(0).path).not.toBe(created(1).path)
    expect(onOpenFile.mock.calls).toEqual([[created(0).path], [created(1).path]])
  })

  it('"New" from a folder’s `.template.md`: the template is copied as written — its own fields, its `in:` blocks and its body', async () => {
    const template = `---\nowner: me\nin:\n  ${STAGES_ID}:\n    order: 1\n  z8y7x6w5v4t3:\n    status: 2-Todo\n---\n## Notes\n`
    readFile.mockResolvedValue({ path: '/vault/stages/.template.md', content: template, mtime: 1, size: 0 })
    const el = await mount()
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).content).toBe(`---\nowner: me\nin:\n  ${STAGES_ID}:\n    order: 1\n  z8y7x6w5v4t3:\n    status: 2-Todo\ntitle: Untitled\n---\n## Notes\n`)
  })

  it('a board column\'s "+" writes the one real seed — that column\'s value, as the note\'s own field (YAZ-4713 C1) — and nothing else', async () => {
    const el = await mount({ columns: STATUS, views: [{ ...BOARD, groupBy: { property: 'note.status' } }] }, [...vault(), rec('/vault/stages/Done one.md', held({ status: '4-Done' }))])
    click(byLabel(el, 'New note in group 4-Done'))
    await flush()
    expect(created(0)).toEqual(born(0, '/vault/stages', 'status: 4-Done\n'))
  })

  it.each(['table', 'board', 'cards', 'list'])('the "+" on a group header when a %s is grouped by Folder (`file.folder`) creates the note in that group’s folder — the subfolder one step down, not the deeper folder rolled up into it (YAZ-2541)', async (type) => {
    const view = { type, name: 'View', order: ['file.name'], groupBy: { property: 'file.folder' } }
    const el = await mount({ ...SETTINGS, views: [view] }, [...vault(), rec('/vault/stages/Untitled.md'), rec('/vault/stages/archive/2019/Older.md')])
    click(byLabel(el, 'New note in group archive'))
    await flush()
    // Born in the subfolder, from ITS template.
    expect(readFile.mock.calls.at(-1)).toEqual(['/vault/stages/archive/.template.md'])
    expect(created(0)).toEqual(born(0, '/vault/stages/archive'))
    expect(onOpenFile).toHaveBeenCalledWith(created(0).path)
    click(byLabel(el, 'New note in group stages'))
    await flush()
    expect(created(1)).toEqual(born(1, '/vault/stages'))
  })

  it.each(['table', 'board'])('Folder then Folder on a %s (YAZ-2541): the "+" on an INNER group creates in the inner folder, the one on its outer in the outer’s', async (type) => {
    const view = { type, name: 'View', order: ['file.name'], groupBy: [{ property: 'file.folder' }, { property: 'file.folder' }] }
    const el = await mount({ ...SETTINGS, views: [view] }, [...vault(), rec('/vault/stages/archive/2019/Older.md')])
    click(byLabel(el, 'New note in group 2019'))
    await flush()
    expect(created(0)).toEqual(born(0, '/vault/stages/archive/2019'))
    click(byLabel(el, 'New note in group archive'))
    await flush()
    expect(created(1)).toEqual(born(1, '/vault/stages/archive'))
  })

  // YAZ-4799: grouped by Folder, a shortcut counts in the folder it is a shortcut in — here the opened folder itself —
  // so the vault-root note no longer makes a "vault" group of its own.
  it('a shortcut that lives in the vault root sits in the group of the folder it is a shortcut in, the opened one; that group’s "+" creates in the opened folder (YAZ-2541, YAZ-4799)', async () => {
    const records = vault().map((r) => (r.path === OTHER ? { ...r, properties: { also_in: [STAGES_ID] } } : r))
    const el = await mount({ ...SETTINGS, views: [{ type: 'table', name: 'View', order: ['file.name'], groupBy: { property: 'file.folder' } }] }, records)
    expect(texts(el, '.view-group__value')).toEqual(['stages', 'archive'])
    // Other is in the first group, stages, before archive's Old.
    expect(texts(el, '.view-table__name')).toEqual(['Other', 'Lead Gen', 'Sales', 'Old'])
    click(byLabel(el, 'New note in group stages'))
    await flush()
    expect(created(0).path).toBe(born(0, '/vault/stages').path)
  })

  it('the "+" under a group-by-Folder group that is not under the opened folder (a shortcut’s home) creates in the opened folder', async () => {
    const records = vault().map((r) => (r.path === OUTSIDER ? { ...r, properties: { also_in: [STAGES_ID] } } : r))
    const el = await mount({ ...SETTINGS, views: [{ type: 'table', name: 'View', order: ['file.name'], groupBy: { property: 'file.folder' } }] }, records)
    click(byLabel(el, 'New note in group Sub'))
    await flush()
    expect(created(0).path).toBe(born(0, '/vault/stages').path)
  })

  it('B: a card name typed on a board (YAZ-943) is the note’s title, a title another note here has included; the path that comes back is the one created (YAZ-2420 D20)', async () => {
    await mount()
    const paths = [await captured.folder!.create({ properties: {} }, 'Ship it'), await captured.folder!.create({ properties: {} }, 'Lead Gen')]
    expect([created(0), created(1)]).toEqual([born(0, '/vault/stages', '', 'Ship it'), born(1, '/vault/stages', '', 'Lead Gen')])
    expect(paths).toEqual([created(0).path, created(1).path])
    expect(paths[1]).toMatch(/^\/vault\/stages\/lead-gen-yaz-\d+\.md$/)
  })

  it('B: a typed title keeps its `/` — it is text, not a path; whitespace-only falls back to Untitled (YAZ-2420 D20)', async () => {
    await mount()
    expect(await captured.folder!.create({ properties: {} }, 'a/b')).toBe(`/vault/stages/a-b-${created(0).id?.toLowerCase()}.md`)
    expect(created(0).content).toBe('---\ntitle: a/b\n---\n')
    expect(await captured.folder!.create({ properties: {} }, '   ')).toBe(born(1, '/vault/stages').path)
  })

  it('a create the disk refuses is not retried under another name (YAZ-2420 D20)', async () => {
    await mount()
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'file exists'))
    await expect(captured.folder!.create({ properties: {} }, 'Ship it')).rejects.toThrow('file exists')
    expect(createFile).toHaveBeenCalledTimes(1)
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

// The ID vault's half of each row is the block above.
describe('New in a vault that does not use IDs makes the note the plain way (YAZ-2523 V3)', () => {
  /** The folder as such a vault's index hands it out: its settings record has no id. */
  const mountPlain = (settings: unknown = SETTINGS): Promise<HTMLElement> => mount(settings, vault(), false)

  it('"New" creates `Untitled.md` in the folder, empty: no id and no `title` is sent', async () => {
    const el = await mountPlain()
    click(byLabel(el, 'New note'))
    await flush()
    expect(createFile.mock.calls).toEqual([[{ path: '/vault/stages/Untitled.md', content: '' }]])
    expect(onOpenFile).toHaveBeenCalledWith('/vault/stages/Untitled.md')
  })

  it('when `Untitled.md` is taken "New" creates `Untitled 2.md`, then `Untitled 3.md`', async () => {
    const taken = new Set(['/vault/stages/Untitled.md', '/vault/stages/Untitled 2.md'])
    createFile.mockImplementation(async (req) => {
      const { path } = req as CreateFileRequest
      if (taken.has(path)) throw new BridgeRequestError('ALREADY_EXISTS', 'file exists')
      return { path, mtime: 1, size: 0 }
    })
    const el = await mountPlain()
    click(byLabel(el, 'New note'))
    await flush()
    expect(createFile.mock.calls.map(([req]) => (req as CreateFileRequest).path)).toEqual(['/vault/stages/Untitled.md', '/vault/stages/Untitled 2.md', '/vault/stages/Untitled 3.md'])
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/stages/Untitled 3.md')
  })

  it('a view\u2019s seeded values are the note\u2019s own properties beside the template\u2019s: no `in:` block is written, and the folder is given no id', async () => {
    readFile.mockResolvedValue({ path: '/vault/stages/.template.md', content: '---\nowner: me\n---\n## Notes\n', mtime: 1, size: 0 })
    const el = await mountPlain({ ...SETTINGS, views: [{ type: 'table', name: 'Table', order: ['file.name'], filters: { and: ['file.hasTag("hiring")', 'kind == "task"'] } }] })
    click(byLabel(el, 'New note'))
    await flush()
    expect(createFile.mock.calls).toEqual([[{ path: '/vault/stages/Untitled.md', content: '---\nowner: me\nkind: task\ntags:\n  - hiring\n---\n## Notes\n' }]])
    expect(transform).not.toHaveBeenCalled()
  })

  it('a typed name that is taken, or one a file cannot hold, is refused and never made under another name', async () => {
    await mountPlain()
    expect(await captured.folder!.create({ properties: {} }, 'Ship it')).toBe('/vault/stages/Ship it.md')
    createFile.mockRejectedValue(new BridgeRequestError('ALREADY_EXISTS', 'file exists'))
    await expect(captured.folder!.create({ properties: {} }, 'Ship it')).rejects.toThrow('file exists')
    expect(createFile).toHaveBeenCalledTimes(2)
    await expect(captured.folder!.create({ properties: {} }, 'a/b')).rejects.toThrow('Name cannot contain "/"')
    expect(createFile).toHaveBeenCalledTimes(2)
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

// ---------- each folder has its own properties (D19) ----------

/**
 * A note's value for a column is the note's own field, one per key, read and written the same from every page
 * (YAZ-4713 C1). A column set to "Separate value on this page" (C3) keeps this page's value in the note's `in` block
 * named by the page's id, as before. Columns flow down the folder chain (C2). Here the writers are the REAL ones over
 * an in-memory disk, so what is pinned is the bytes a gesture leaves in the note.
 */
describe('a note’s value is its own field (YAZ-4713 C1)', () => {
  const ARCHIVE = '/vault/stages/archive'
  const ARCHIVE_ID = 'z8y7x6w5v4t3'
  const SUB_ID = 'a1b2c3d4e5f6'
  const disk = new Map<string, string>()

  beforeEach(async () => {
    disk.clear()
    const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
    writeValues.mockImplementation(real.writeRouted)
    transform.mockImplementation(real.transformFile)
    readFile.mockImplementation(async (path) => {
      const content = disk.get(path)
      if (content === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
      return { path, content, mtime: 1, size: content.length }
    })
    writeFile.mockImplementation(async ({ path, content }) => {
      disk.set(path, content)
      return { path, mtime: 2, size: content.length }
    })
  })

  /** The cell of the row named `name`, in an ungrouped table. */
  const cell = (el: ParentNode, name: string, column: number): HTMLElement => q<HTMLElement>(el, `[data-cell="${rowNames(el).indexOf(name)}:${column}"]`)
  const editNumber = (el: ParentNode, name: string, column: number, label: string, value: string): void => {
    click(q(cell(el, name, column), '[data-edit]'))
    const input = byLabel<HTMLInputElement>(el, label)
    setValue(input, value)
    press(input, 'Enter')
  }
  const fire = (target: Element, type: string): void => act(() => void target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
  const card = (el: ParentNode, name: string): Element => [...el.querySelectorAll('.view-board__title')].find((title) => title.textContent === name)!.closest('.view-board__card')!
  const columnHolding = (el: ParentNode, name: string): Element => card(el, name).closest('.view-board__col')!
  const ORDER_BOARD = { ...BOARD, order: ['file.name'], groupBy: { property: 'note.order' } }
  /** A note holding its own `order`, and the old per-page values of another folder and of this one (D19). */
  const THREE = `---\ntitle: mine\norder: 500\nin:\n  ${ARCHIVE_ID}:\n    order: 30\n  ${STAGES_ID}:\n    order: 3\n---\nBody\n`

  it('Edit a cell in a folder’s table: the value is written to the note’s own field — its `in:` blocks stay byte for byte', async () => {
    disk.set(DEEP, THREE)
    const el = await mount()
    selectView(el, 'Table')
    editNumber(el, 'Old', 1, 'Edit order', '9')
    await flush()
    expect(disk.get(DEEP)).toBe(THREE.replace('order: 500\n', 'order: 9\n'))
    expect(writeFile).toHaveBeenCalledTimes(1) // the note, and nothing else
  })

  it('Drag a card on a folder’s board: the note’s own field for the grouped column changes, nothing else', async () => {
    disk.set(DEEP, THREE)
    const el = await mount({ ...SETTINGS, views: [ORDER_BOARD] })
    fire(card(el, 'Old'), 'dragstart')
    fire(columnHolding(el, 'Sales'), 'drop') // the column of `order: 1`
    await flush()
    expect(disk.get(DEEP)).toBe(THREE.replace('order: 500\n', 'order: 1\n'))
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('The same note on two pages (a parent and a child, or a home and a shortcut): every page shows its one value', async () => {
    const settings = { columns: { order: { kind: 'number' } }, views: [{ type: 'table', name: 'Table', order: ['file.name', 'note.order'] }] }
    const folders = [
      { ...rec('/vault/Sub/.folder.md', { folder_settings: settings }), id: SUB_ID },
      { ...rec(SETTINGS_FILE, { folder_settings: settings }), id: STAGES_ID },
      { ...rec(`${ARCHIVE}/.folder.md`, { folder_settings: settings }), id: ARCHIVE_ID },
    ]
    const records = [
      // Old per-page values (D19) are no longer read: they wait for the one-time move (C10).
      rec(OUTSIDER, { also_in: [STAGES_ID], order: 7, in: { [SUB_ID]: { order: 70 } } }), // lives in Sub, a shortcut in stages
      rec(DEEP, { order: 3, in: { [ARCHIVE_ID]: { order: 30 } } }), // lives in the child, shown by the parent
    ]
    const open = async (path: string): Promise<HTMLElement> => {
      unmountFolderView()
      const el = renderNoAsk({ path, source, onOpenFile })
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      return el
    }
    const orders = (el: ParentNode): Record<string, string | null> => Object.fromEntries(rowNames(el).map((name) => [name, cell(el, name, 1).textContent]))

    expect(orders(await open(STAGES))).toEqual({ Outsider: '7', Old: '3' }) // the parent, and the folder the shortcut is in
    expect(orders(await open(ARCHIVE))).toEqual({ Old: '3' }) // the child
    expect(orders(await open('/vault/Sub'))).toEqual({ Outsider: '7' }) // the shortcut's home
  })

  it('end to end (YAZ-4713): a column added on Schema shows on Orders with its ↳ mark; a value set on Orders is the same value on Schema; a move out and back keeps it', async () => {
    const SCHEMA = '/vault/schema'
    const ORDERS = '/vault/schema/orders'
    const ARCHIVE_DIR = '/vault/archive'
    const IN_ORDERS = '/vault/schema/orders/Orders table.md'
    const IN_ARCHIVE = '/vault/archive/Orders table.md'
    const domain = { kind: 'select' as const, options: ['Billing', 'Payments'] }
    const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
    write.mockImplementation(real.writeProperty) // the settings door writes the disk too
    disk.set(`${SCHEMA}/.folder.md`, `---\nid: ${SUB_ID}\ntitle: Schema\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n---\n`)
    disk.set(IN_ORDERS, '---\ntitle: Orders table\n---\n')
    /** The index as the scan reads the disk: each `.folder.md` and note by its own frontmatter. */
    const fromDisk = (path: string): IndexRecord => {
      const { properties } = parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter)
      return { ...rec(path, properties), ...(typeof properties.title === 'string' && { title: properties.title }), ...(typeof properties.id === 'string' && { id: properties.id }) }
    }
    const open = async (path: string, note: string): Promise<HTMLElement> => {
      unmountFolderView()
      const el = renderNoAsk({ path, source, onOpenFile })
      const folders = [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`].filter((file) => disk.has(file)).map(fromDisk)
      const records = [fromDisk(note)]
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      return el
    }
    const headerMark = (el: ParentNode, label: string): HTMLElement | null =>
      [...el.querySelectorAll<HTMLElement>('.view-table thead th')].find((th) => th.textContent?.startsWith(label))?.querySelector<HTMLElement>('.view-column-mark') ?? null
    /** A move as the app makes it (C9): the file goes to its new folder, byte for byte; no value is written away. */
    const move = (from: string, to: string): void => {
      disk.set(to, disk.get(from)!)
      disk.delete(from)
    }

    // 1. Add Domain on Schema: one definition, in Schema's own `.folder.md`; no note is written (E1).
    let el = await open(SCHEMA, IN_ORDERS)
    await act(async () => void captured.folder!.setColumns({ ...captured.folder!.settings.columns, domain }))
    await flush()
    expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('    domain:\n      kind: select\n')
    expect(disk.get(IN_ORDERS)).toBe('---\ntitle: Orders table\n---\n')
    expect(disk.has(`${ORDERS}/.folder.md`)).toBe(false) // nothing is copied down

    // 2. Open Orders: Domain is there, owned by Schema, its header marked ↳ "From Schema" (C2, C11).
    el = await open(ORDERS, IN_ORDERS)
    expect(captured.folder!.columns).toEqual({ domain: { decl: domain, owner: 'schema' } })
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim())).toEqual(['Name', 'Domain'])
    // The words are the app's hover box and the icon's name (YAZ-4772: a native title showed nothing).
    expect(headerMark(el, 'Domain')).toMatchObject({ dataset: { mark: 'parent' } })
    expect(headerMark(el, 'Domain')!.querySelector('svg')!.getAttribute('aria-label')).toBe('From Schema')

    // 3. Set Billing on Orders: the note's own field, readable by anyone (C1).
    click(q(cell(el, 'Orders table', 1), '[data-edit]'))
    click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.startsWith('Billing'))!)
    await flush()
    const billing = '---\ntitle: Orders table\ndomain: Billing\n---\n'
    expect(disk.get(IN_ORDERS)).toBe(billing)

    // 4. Open Schema: the same one value; Schema's own column has no mark.
    el = await open(SCHEMA, IN_ORDERS)
    expect(cell(el, 'Orders table', 1).textContent).toContain('Billing')
    expect(headerMark(el, 'Domain')).toBeNull()

    // 5. Move the note out of Schema and back: the value goes with it, and comes back with it (C9).
    move(IN_ORDERS, IN_ARCHIVE)
    el = await open(ARCHIVE_DIR, IN_ARCHIVE) // a page with no columns shows every field
    expect(disk.get(IN_ARCHIVE)).toBe(billing)
    expect(captured.folder!.columns).toEqual({})
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim())).toContain('Domain')
    expect(cell(el, 'Orders table', texts(el, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim()).indexOf('Domain')).textContent).toContain('Billing')
    move(IN_ARCHIVE, IN_ORDERS)
    el = await open(ORDERS, IN_ORDERS)
    expect(disk.get(IN_ORDERS)).toBe(billing)
    expect(cell(el, 'Orders table', 1).textContent).toContain('Billing')
    el = await open(SCHEMA, IN_ORDERS)
    expect(cell(el, 'Orders table', 1).textContent).toContain('Billing')
  })

  describe('Schema declares Domain; Orders, below it, shows it (YAZ-4713 C6, C7)', () => {
    const SCHEMA = '/vault/schema'
    const ORDERS = '/vault/schema/orders'
    const TABLE_NOTE = '/vault/schema/orders/Orders table.md'
    const domain = { kind: 'select' as const, options: ['Billing', 'Payments'] }
    const schemaFile = '---\nfolder_settings:\n  columns:\n    domain:\n      kind: select\n      options: [Billing, Payments]\n  views:\n    - type: table\n      name: Table\n---\n'
    const ordersFile = '---\nfolder_settings:\n  views:\n    - type: table\n      name: Orders\n      sort:\n        - property: note.domain\n          direction: ASC\n---\n'
    const open = async (path: string): Promise<void> => {
      const folders = [
        { ...rec(`${SCHEMA}/.folder.md`, { folder_settings: { columns: { domain }, views: [{ type: 'table', name: 'Table' }] } }), id: SUB_ID },
        { ...rec(`${ORDERS}/.folder.md`, { folder_settings: { views: [{ type: 'table', name: 'Orders', sort: [{ property: 'note.domain', direction: 'ASC' }] }] } }), id: ARCHIVE_ID },
      ]
      const records = [rec(TABLE_NOTE, { title: 'Orders table', domain: 'Billing' })]
      unmountFolderView()
      renderNoAsk({ path, source, onOpenFile })
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
    }
    beforeEach(() => {
      disk.set(`${SCHEMA}/.folder.md`, schemaFile)
      disk.set(`${ORDERS}/.folder.md`, ordersFile)
      disk.set(TABLE_NOTE, '---\ntitle: Orders table\ndomain: Billing\n---\n')
    })

    it('C6: an edit of Domain from Orders is written to Schema’s `.folder.md`; Orders’ file is untouched', async () => {
      await open(ORDERS)
      expect(captured.folder!.sources.of('domain')).toEqual({ from: expect.any(String) })
      await act(async () => void (await captured.folder!.setColumn('domain', { ...domain, options: ['Billing', 'Payments', 'Refunds'] }, domain)))
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('Refunds')
      expect(disk.get(`${ORDERS}/.folder.md`)).toBe(ordersFile)
      // Ahead of the index: the page shows the edit at once.
      expect(captured.folder!.settings.columns.domain).toEqual({ ...domain, options: ['Billing', 'Payments', 'Refunds'] })
    })

    it('C6: "Change on this folder only" declares Domain in Orders’ file; Schema is unchanged; the note keeps its one value', async () => {
      await open(ORDERS)
      await act(async () => void (await captured.folder!.sources.here('domain')))
      expect(disk.get(`${ORDERS}/.folder.md`)).toContain('domain:')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toBe(schemaFile)
      expect(disk.get(TABLE_NOTE)).toBe('---\ntitle: Orders table\ndomain: Billing\n---\n')
    })

    it('C7: on Orders, Domain offers no Delete; on Schema, Delete with Clear removes the note field and Orders’ sort on it', async () => {
      await open(ORDERS)
      expect(captured.folder!.sources.of('domain').from).toBeDefined() // the menus offer Hide only (`deletableHere`)
      await open(SCHEMA)
      expect(captured.folder!.valueCount('note.domain')).toBe(1)
      await act(async () => captured.folder!.deleteColumn!('domain', true))
      await flush()
      expect(disk.get(TABLE_NOTE)).toBe('---\ntitle: Orders table\n---\n')
      expect(disk.get(`${ORDERS}/.folder.md`)).not.toContain('domain')
    })

    it('C11: a column only a subfolder defines is typed by it on the parent page but is no column there; two that differ leave it untyped', async () => {
      const sweet = { kind: 'select' as const, options: ['Low', 'High'] }
      const show = async (pies: unknown) => {
        const folders = [
          { ...rec(`${SCHEMA}/.folder.md`, { folder_settings: { views: [{ type: 'table', name: 'Table' }] } }), id: SUB_ID },
          { ...rec(`${ORDERS}/.folder.md`, { folder_settings: { columns: { sweetness: sweet }, views: [] } }), id: ARCHIVE_ID },
          { ...rec(`${SCHEMA}/pies/.folder.md`, { folder_settings: { columns: { sweetness: pies }, views: [] } }), id: 'p1e5p1e5p1e5' },
        ]
        unmountFolderView()
        renderNoAsk({ path: SCHEMA, source, onOpenFile })
        act(() => source.update(linkResolver([], '/vault', vaultDirs('/vault'), folders), [], folders, true))
        await flush()
      }
      await show(sweet)
      expect(captured.folder!.columns.sweetness).toBeUndefined() // no column of this page (C4)
      expect(captured.folder!.settings.columns.sweetness).toEqual(sweet) // but typed by the subfolders' agreed definition
      expect(captured.folder!.settings.fromBelow).toEqual(['sweetness'])
      expect(captured.folder!.sources.of('sweetness').below).toMatch(/,/) // both subfolders named
      await show({ kind: 'text' })
      expect(captured.folder!.settings.columns.sweetness).toBeUndefined()
      expect(captured.folder!.sources.of('sweetness').below).toBeDefined()
    })

    it('C7: Keep leaves every note’s field; Orders’ views still lose the column', async () => {
      await open(SCHEMA)
      await act(async () => captured.folder!.deleteColumn!('domain', false))
      await flush()
      expect(disk.get(TABLE_NOTE)).toBe('---\ntitle: Orders table\ndomain: Billing\n---\n')
      expect(disk.get(`${ORDERS}/.folder.md`)).not.toContain('domain')
    })

    /** The page at `path`, its index read from the disk as the scan reads it: every `.folder.md` and note in `files`. */
    const fromDisk = (path: string): IndexRecord => {
      const { properties } = parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter)
      return { ...rec(path, properties), ...(typeof properties.title === 'string' && { title: properties.title }), ...(typeof properties.id === 'string' && { id: properties.id }) }
    }
    const openFromDisk = async (path: string, files: string[], onNotice = vi.fn()): Promise<typeof onNotice> => {
      const folders = files.filter((file) => file.endsWith('/.folder.md') && disk.has(file)).map(fromDisk)
      const records = files.filter((file) => !file.endsWith('/.folder.md') && disk.has(file)).map(fromDisk)
      unmountFolderView()
      renderNoAsk({ path, source, onOpenFile, onNotice })
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      return onNotice
    }
    const withFilter = (name: string, extra = '') => `---\n${extra}folder_settings:\n  views:\n    - type: table\n      name: ${name}\n      filters: note.domain == "Billing"\n---\n`

    it('C6, 7A 2/4/9: an option rename of Schema’s Domain from Orders renames Schema’s notes and the filters below that take Domain from Schema; a read-only page and a subfolder with its own Domain keep theirs; Undo puts all back', async () => {
      const LOCKED = `${SCHEMA}/locked/.folder.md`
      const OWN = `${SCHEMA}/own/.folder.md`
      const OWN_NOTE = `${SCHEMA}/own/Own note.md`
      disk.set(`${ORDERS}/.folder.md`, withFilter('Orders'))
      disk.set(LOCKED, withFilter('Locked', 'readonly: true\n'))
      disk.set(OWN, '---\nfolder_settings:\n  columns:\n    domain:\n      kind: select\n      options: [Billing]\n  views:\n    - type: table\n      name: Own\n      filters: note.domain == "Billing"\n---\n')
      disk.set(OWN_NOTE, '---\ndomain: Billing\n---\n')
      const files = [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, LOCKED, OWN, TABLE_NOTE, OWN_NOTE]
      const before = new Map(disk)
      const onNotice = await openFromDisk(ORDERS, files)
      const renamed = { ...domain, options: ['Ledger', 'Payments'] }
      await act(async () => void (await captured.folder!.setColumn('domain', renamed, domain, { from: 'Billing', to: 'Ledger' })))
      await flush()
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('Ledger') // the owner's definition
      expect(disk.get(TABLE_NOTE)).toBe('---\ntitle: Orders table\ndomain: Ledger\n---\n') // a note of Schema's scope
      expect(disk.get(`${ORDERS}/.folder.md`)).toContain('filters: note.domain == "Ledger"') // a page below that takes Domain from Schema
      expect(disk.get(LOCKED)).toBe(before.get(LOCKED)) // read only (D36)
      expect(disk.get(OWN)).toBe(before.get(OWN)) // its own Domain: another column
      expect(disk.get(OWN_NOTE)).toBe(before.get(OWN_NOTE))
      expect(onNotice).toHaveBeenCalledExactlyOnceWith('Renamed “Billing” to “Ledger” in 1 note', 'info', 'undo', expect.objectContaining({ label: 'Undo' }))
      await act(async () => onNotice.mock.calls[0][3].run())
      await flush()
      expect(disk.get(TABLE_NOTE)).toBe(before.get(TABLE_NOTE))
      expect(disk.get(`${ORDERS}/.folder.md`)).toContain('filters: note.domain == "Billing"')
      expect(disk.get(`${SCHEMA}/.folder.md`)).not.toContain('Ledger')
    })

    it('C6, 7A 4: a second edit of Schema’s Domain from Orders before the index echoes the first builds on the first (`aheadParents`)', async () => {
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      const first = { ...domain, options: ['Billing', 'Payments', 'Refunds'] }
      await act(async () => void (await captured.folder!.setColumn('domain', first, domain)))
      expect(captured.folder!.settings.columns.domain).toEqual(first) // ahead of the index
      const second = { ...first, description: 'Which team owns it' }
      await act(async () => void (await captured.folder!.setColumn('domain', second, captured.folder!.settings.columns.domain)))
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('Refunds')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('Which team owns it')
      expect(captured.folder!.settings.columns.domain).toEqual(second)
    })

    it('C6, D36, 7A 4: Schema’s folder page is read only, so an edit of its Domain from Orders is refused and writes nothing', async () => {
      disk.set(`${SCHEMA}/.folder.md`, schemaFile.replace('---\nfolder_settings', '---\nreadonly: true\nfolder_settings'))
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      writeFile.mockClear()
      await act(async () => expect(captured.folder!.setColumn('domain', { ...domain, options: ['Billing'] }, domain)).rejects.toThrow("schema's folder page is read only"))
      expect(writeFile).not.toHaveBeenCalled()
      expect(captured.folder!.settings.columns.domain).toEqual(domain)
    })

    it('C6, 7A 4: "Use Schema’s" removes Orders’ own Domain with the real writers; Undo declares it on Orders again', async () => {
      const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
      write.mockImplementation(real.writeProperty) // the settings door writes the disk too
      disk.set(`${ORDERS}/.folder.md`, '---\nfolder_settings:\n  columns:\n    domain:\n      kind: select\n      options: [Orders only]\n  views:\n    - type: table\n      name: Orders\n---\n')
      const onNotice = await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      expect(captured.folder!.sources.of('domain')).toEqual({ over: 'schema' })
      await act(async () => void (await captured.folder!.sources.useParent('domain')))
      await flush()
      expect(disk.get(`${ORDERS}/.folder.md`)).not.toContain('domain')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toBe(schemaFile)
      expect(onNotice).toHaveBeenCalledExactlyOnceWith('Domain uses schema\'s again', 'info', 'undo', expect.objectContaining({ label: 'Undo' }))
      await act(async () => onNotice.mock.calls[0][3].run())
      await flush()
      expect(disk.get(`${ORDERS}/.folder.md`)).toContain('Orders only')
      expect(disk.get(TABLE_NOTE)).toBe('---\ntitle: Orders table\ndomain: Billing\n---\n') // the note's one value never moved
    })

    // CHECKER (YAZ-4713 round 1): bugs found by the checker. Each test fails at 0f4b998b8.
    it('CHECKER B1: Schema keeps its own value of Domain (separate on Schema); an edit of Domain from Orders still reaches Schema and keeps the switch', async () => {
      const separateSchema = schemaFile.replace('      options: [Billing, Payments]\n', '      options: [Billing, Payments]\n      separate: true\n')
      disk.set(`${SCHEMA}/.folder.md`, separateSchema)
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      expect(captured.folder!.sources.of('domain').from).toBeDefined() // Orders shows Schema's Domain, shared
      const base = captured.folder!.settings.columns.domain // as Edit column hands it: the page's definition
      const next = { ...base, options: ['Billing', 'Payments', 'Refunds'] }
      let error: unknown = null
      await act(async () => {
        await captured.folder!.setColumn('domain', next, base).catch((err: unknown) => void (error = err))
      })
      expect(error).toBeNull()
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('Refunds')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('separate: true')
    })

    it('CHECKER B2: "Separate value for Orders" on, then off, on Schema’s Domain gives Orders Schema’s column back (no hidden copy on Orders)', async () => {
      const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
      write.mockImplementation(real.writeProperty) // the settings door writes the disk too: Off removes Orders' declaration
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      const shown = captured.folder!.settings.columns.domain
      await act(async () => captured.folder!.separate!.set('domain', shown, true, 'notes'))
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      expect(captured.folder!.settings.columns.domain.separate).toBe(true)
      await act(async () => captured.folder!.separate!.set('domain', captured.folder!.settings.columns.domain, false, 'notes'))
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      // Expected: Domain is Schema's again, so a later edit on Schema reaches Orders.
      expect(captured.folder!.sources.of('domain')).toEqual({ from: expect.any(String) })
    })

    it('1B: Orders’ own Domain ("Changed on Orders only") stays Orders’ own after "Separate value for Orders" goes on, then off', async () => {
      const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
      write.mockImplementation(real.writeProperty)
      disk.set(`${ORDERS}/.folder.md`, '---\nfolder_settings:\n  columns:\n    domain:\n      kind: select\n      options: [Orders only]\n  views:\n    - type: table\n      name: Orders\n---\n')
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      expect(captured.folder!.sources.of('domain')).toEqual({ over: 'schema' })
      await act(async () => captured.folder!.separate!.set('domain', captured.folder!.settings.columns.domain, true, 'notes'))
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      await act(async () => captured.folder!.separate!.set('domain', captured.folder!.settings.columns.domain, false, 'notes'))
      await openFromDisk(ORDERS, [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`, TABLE_NOTE])
      expect(captured.folder!.sources.of('domain')).toEqual({ over: 'schema' })
      expect(captured.folder!.settings.columns.domain).toEqual({ kind: 'select', options: ['Orders only'] })
    })
  })

  it('C2: the nearest declaration of a key wins, and the folder ⚙ "Show parent folders’ columns" Off shows the folder’s own alone', async () => {
    const parent = { columns: { order: { kind: 'number' }, owner: { kind: 'text' } }, views: [TABLE] }
    const child = { columns: { order: { kind: 'text' } }, views: [{ type: 'table', name: 'Table' }] }
    const folders = [
      { ...rec(SETTINGS_FILE, { folder_settings: parent }), id: STAGES_ID },
      { ...rec(`${ARCHIVE}/.folder.md`, { folder_settings: child }), id: ARCHIVE_ID },
    ]
    const open = async (properties: Record<string, unknown> = {}): Promise<void> => {
      unmountFolderView()
      renderNoAsk({ path: ARCHIVE, source, onOpenFile })
      const own = [{ ...folders[0] }, { ...folders[1], properties: { ...folders[1].properties, ...properties } }]
      act(() => source.update(linkResolver(vault(), '/vault', vaultDirs('/vault'), own), vault(), own, true))
      await flush()
    }
    await open()
    expect(captured.folder!.columns).toEqual({ order: { decl: { kind: 'text' }, owner: 'stages/archive', over: 'stages' }, owner: { decl: { kind: 'text' }, owner: 'stages' } })
    await open({ inherit_columns: false })
    expect(captured.folder!.columns).toEqual({ order: { decl: { kind: 'text' }, owner: 'stages/archive' } })
  })

  it('C2: a column edit on a subfolder page writes only what it changed into the subfolder’s own file — an inherited column is never copied there', async () => {
    const folders = [
      { ...rec(SETTINGS_FILE, { folder_settings: SETTINGS }), id: STAGES_ID },
      { ...rec(`${ARCHIVE}/.folder.md`, { folder_settings: { views: [TABLE] } }), id: ARCHIVE_ID },
    ]
    renderNoAsk({ path: ARCHIVE, source, onOpenFile })
    act(() => source.update(linkResolver(vault(), '/vault', vaultDirs('/vault'), folders), vault(), folders, true))
    await flush()
    write.mockResolvedValue({ mtime: 2 })
    act(() => captured.folder!.setColumns({ ...captured.folder!.settings.columns, stage: { kind: 'text' } }))
    await flush()
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).toBe(`${ARCHIVE}/.folder.md`)
    expect((write.mock.calls[0][2] as { columns: unknown }).columns).toEqual({ stage: { kind: 'text' } })
  })

  it('A folder’s table: which values — the page’s columns, plus the built-in file columns (name, folder, tags, dates, links); the note’s other fields wait in Columns ⚙ (C4)', async () => {
    const lead: IndexRecord = {
      ...rec(LEAD, { id: 'n0tehasan1dx', secret: 'own', also_in: [ARCHIVE_ID], order: 2, extra: 'here', in: { [ARCHIVE_ID]: { elsewhere: 1 } } }),
      tags: ['topic'],
      links: ['Sales'],
      mtime: Date.UTC(2026, 0, 2),
    }
    // No `order` on the view: the default columns are the name and the page's columns alone.
    const el = await mount({ columns: SETTINGS.columns, views: [{ type: 'table', name: 'Table' }] }, [lead])
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)').map((header) => header.trim())).toEqual(['Name', 'Order', 'Related'])
    expect(cell(el, 'Lead Gen', 1).textContent).toBe('2')

    feed({ columns: SETTINGS.columns, views: [{ type: 'table', name: 'Table', order: ['file.name', 'file.folder', 'file.tags', 'file.links', 'file.mtime', 'note.secret', 'note.id', 'note.elsewhere'] }] }, [lead])
    await flush()
    const shown = [1, 2, 3, 4, 5, 6, 7].map((column) => cell(el, 'Lead Gen', column).textContent)
    // A note directly in the page's folder shows the page, never a blank (YAZ-4801 demo: the path from this page).
    expect(shown.slice(0, 3)).toEqual(['stages', 'topic', 'Sales'])
    expect(shown[3]).toContain('2026')
    expect(shown.slice(4)).toEqual(['own', 'Empty', 'Empty']) // the note's own field shows; its id is the app's; another page's old block is not read
  })

  it('Filter, sort, group, summary and formula in a folder’s views work on the notes’ own values', async () => {
    /** Every note carries decoys: the same names in two pages' old blocks. */
    const note = (path: string, order: number, stage: string): IndexRecord => rec(path, { order, stage, in: { [ARCHIVE_ID]: { order: 900, stage: 'theirs' }, [STAGES_ID]: { order: 500, stage: 'old' } } })
    const view = { type: 'table', name: 'Table', order: ['file.name', 'note.order', 'formula.double'], filters: 'order >= 2', sort: [{ property: 'note.order', direction: 'DESC' }], summaries: { 'note.order': 'Sum' } }
    const settings = { columns: { order: { kind: 'number' }, stage: { kind: 'text' } }, formulas: { double: 'order * 2' }, views: [view, { ...view, name: 'Grouped', groupBy: { property: 'note.stage' } }] }
    const el = await mount(settings, [note(LEAD, 2, 'warm'), note(SALES, 1, 'warm'), note(DEEP, 3, 'cold'), note('/vault/stages/Won.md', 4, 'warm')])

    expect(rowNames(el)).toEqual(['Won', 'Old', 'Lead Gen']) // filtered (Sales is 1) and sorted, by the notes' `order`
    expect(rowNames(el).map((name) => cell(el, name, 2).textContent)).toEqual(['8', '6', '4']) // the formula
    expect(byLabel(el, 'Summarize Order').textContent).toBe('Sum9') // the summary

    selectView(el, 'Grouped')
    expect(texts(el, '.view-group__value')).toEqual(['cold', 'warm']) // the groups
  })

  it('"New" in a folder’s view, with a filter or group that seeds a value: the seed is the new note’s own field', async () => {
    const view = { type: 'board', name: 'Board', order: ['file.name'], filters: 'kind == "task"', groupBy: { property: 'note.order' } }
    const el = await mount({ ...SETTINGS, views: [view] }, [rec(LEAD, held({ kind: 'task', order: 2 }))])
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0)).toEqual(born(0, '/vault/stages', 'kind: task\n')) // the filter's seed
    click(byLabel(el, 'New note in group 2'))
    await flush()
    expect(created(1).content).toBe('---\nkind: task\norder: 2\ntitle: Untitled\n---\n') // and the group's
    expect(disk.has(SETTINGS_FILE)).toBe(false) // a shared value needs no page id
  })

  it('"New" seeds beside what the folder’s template already holds: the seed is a field, the template’s fields and blocks stay', async () => {
    disk.set('/vault/stages/.template.md', `---\nowner: me\nkind: idea\nin:\n  ${ARCHIVE_ID}:\n    status: 2-Todo\n---\n## Notes\n`)
    const el = await mount({ ...SETTINGS, views: [{ type: 'table', name: 'Table', order: ['file.name'], filters: 'kind == "task"' }] })
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).content).toBe(`---\nowner: me\nkind: task\nin:\n  ${ARCHIVE_ID}:\n    status: 2-Todo\ntitle: Untitled\n---\n## Notes\n`)
  })

  it('a group "+" under group-by-Folder still creates in that group’s folder, with the seeded value as its field', async () => {
    const view = { type: 'table', name: 'Table', order: ['file.name'], filters: 'kind == "task"', groupBy: { property: 'file.folder' } }
    const el = await mount({ ...SETTINGS, views: [view] }, [rec(LEAD, held({ kind: 'task' })), rec(DEEP, held({ kind: 'task' }))])
    click(byLabel(el, 'New note in group archive')) // headed by the subfolder's name (YAZ-2541), born in its path
    await flush()
    expect(created(0)).toEqual(born(0, '/vault/stages/archive', 'kind: task\n'))
  })

  it('a `file.hasTag` filter seeds the note’s OWN tags, at the top level', async () => {
    const tagged = { ...rec(LEAD, held({ kind: 'task' })), tags: ['hiring'] }
    const el = await mount({ ...SETTINGS, views: [{ type: 'table', name: 'Table', order: ['file.name'], filters: { and: ['file.hasTag("hiring")', 'kind == "task"'] } }] }, [tagged])
    click(byLabel(el, 'New note'))
    await flush()
    expect(created(0).content).toBe('---\nkind: task\ntags:\n  - hiring\ntitle: Untitled\n---\n')
  })

  it('A folder with nothing saved has no column (C5): it shows the notes’ own fields, as a plain vault does', async () => {
    const folders = [{ ...rec(SETTINGS_FILE), id: STAGES_ID }] // born holding only its id (D13)
    const records = [rec(LEAD, { status: '4-Done', in: { [STAGES_ID]: { status: '2-Todo' } } }), rec(SALES, { status: '1-Backlog' })]
    const el = renderNoAsk({ path: STAGES, source, onOpenFile })
    act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
    await flush()
    expect(captured.folder!.settings.columns).toEqual({})
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)')).toEqual(['Name', 'Status'])
    expect([cell(el, 'Lead Gen', 1).textContent, cell(el, 'Sales', 1).textContent]).toEqual(['4-Done', '1-Backlog'])
  })

  it('A note with no value for a column: an empty cell, and nothing is written until a value is set', async () => {
    disk.set(SALES, '---\ntitle: Sales\n---\n')
    const el = await mount(SETTINGS, [rec(SALES, { title: 'Sales' })])
    selectView(el, 'Table')
    expect(cell(el, 'Sales', 1).textContent).toBe('Empty')
    click(q(cell(el, 'Sales', 1), '[data-edit]'))
    press(byLabel(el, 'Edit order'), 'Escape')
    await flush()
    expect(writeValues).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    editNumber(el, 'Sales', 1, 'Edit order', '4')
    await flush()
    expect(disk.get(SALES)).toBe('---\ntitle: Sales\norder: 4\n---\n')
  })

  it('A value cleared on a board removes the note’s field; another page’s old block stays', async () => {
    const records = [rec(LEAD, { order: 2, in: { [ARCHIVE_ID]: { order: 30 } } }), rec(SALES, held({ order: 1 }, { title: 'Sales' })), rec('/vault/stages/Blank.md')]
    disk.set(LEAD, `---\norder: 2\nin:\n  ${ARCHIVE_ID}:\n    order: 30\n---\n`)
    disk.set(SALES, '---\ntitle: Sales\norder: 1\n---\n')
    const el = await mount({ ...SETTINGS, views: [ORDER_BOARD] }, records)
    // Onto the column of the notes with no `order`: the value is cleared.
    fire(card(el, 'Lead Gen'), 'dragstart')
    fire(columnHolding(el, 'Blank'), 'drop')
    fire(card(el, 'Sales'), 'dragstart')
    fire(columnHolding(el, 'Blank'), 'drop')
    await flush()
    expect(disk.get(LEAD)).toBe(`---\nin:\n  ${ARCHIVE_ID}:\n    order: 30\n---\n`)
    expect(disk.get(SALES)).toBe('---\ntitle: Sales\n---\n')
  })

  it('An old per-page value (D19, `in.<page id>`) is not read: the page shows the note’s own field (C1); the old values wait for the one-time move (C10)', async () => {
    const el = await mount(SETTINGS, [rec(LEAD, { order: 99, in: { [STAGES_ID]: { order: 2 } } }), rec(SALES, inBlock({ order: 1 }))])
    selectView(el, 'Table')
    expect(cell(el, 'Lead Gen', 1).textContent).toBe('99')
    expect(cell(el, 'Sales', 1).textContent).toBe('Empty')
  })

  it('a key the app owns is no column: the views list none, and the write door refuses one', async () => {
    const el = await mount({ views: [{ type: 'table', name: 'Table' }] }, [rec(LEAD, { order: 2, also_in: [ARCHIVE_ID], title: 'Lead', in: { [ARCHIVE_ID]: { x: 1 } } })])
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)')).toEqual(['Name', 'Order'])
    await expect(captured.folder!.writeValues(LEAD, [{ key: 'in', value: {} }])).rejects.toThrow("in is the app's own property")
    await expect(captured.folder!.writeValues(LEAD, [{ key: 'folder_settings', value: {} }])).rejects.toThrow("folder_settings is the app's own property")
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a Linked mentions column is no note field: the write door refuses one (YAZ-4738)', async () => {
    await mount({ columns: { used_by: { kind: 'mentions' } }, views: [{ type: 'table', name: 'Table' }] }, [rec(LEAD, { order: 2 })])
    await expect(captured.folder!.writeValues(LEAD, [{ key: 'used_by', value: ['[[Sales]]'] }])).rejects.toThrow('used_by is a Linked mentions column')
    expect(writeValues).not.toHaveBeenCalled()
  })

  /**
   * Link and Multi-link columns ride the same model (YAZ-4736): the value is the note's own field, the column's `target`
   * comes down with the definition, and a delete, an Undo and a move treat a link like any value. Backlinks and a rename
   * read and rewrite the field and a page's block alike (`scan.test.ts` extractLinks, `renameLinks.test.ts`).
   */
  describe('link columns in the new model (YAZ-4736)', () => {
    const SCHEMA = '/vault/schema'
    const ORDERS = '/vault/schema/orders'
    const NOTE = '/vault/schema/orders/Orders table.md'
    const MOVED = '/vault/Sub/Orders table.md'
    const schemaFile = `---\nid: ${SUB_ID}\ntitle: Schema\nfolder_settings:\n  columns:\n    points_to:\n      kind: link\n      target: "[[KPIs]]"\n  views:\n    - type: table\n      name: Table\n      order:\n        - file.name\n        - note.points_to\n---\n`
    const onNotice = vi.fn()
    const fromDisk = (path: string): IndexRecord => {
      const { properties } = parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter)
      return { ...rec(path, properties), ...(typeof properties.title === 'string' && { title: properties.title }), ...(typeof properties.id === 'string' && { id: properties.id }) }
    }
    /** The page at `path`, its index read from the disk: the two folder files, the note wherever it is, and the notes the targets name. */
    const open = async (path: string, note = NOTE): Promise<HTMLElement> => {
      unmountFolderView()
      const el = renderNoAsk({ path, source, onOpenFile, onNotice })
      const folders = [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`].filter((file) => disk.has(file)).map(fromDisk)
      const records = [rec('/vault/kpis/CAC.md'), rec('/vault/kpis/LTV.md'), rec(OUTSIDER), fromDisk(note)].sort((a, b) => (a.path < b.path ? -1 : 1))
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      return el
    }
    /** The index's echo of the disk, on the mounted page. */
    const echo = (note = NOTE): void => {
      const folders = [`${SCHEMA}/.folder.md`, `${ORDERS}/.folder.md`].filter((file) => disk.has(file)).map(fromDisk)
      const records = [rec('/vault/kpis/CAC.md'), rec('/vault/kpis/LTV.md'), rec(OUTSIDER), fromDisk(note)].sort((a, b) => (a.path < b.path ? -1 : 1))
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
    }
    const picked = (el: ParentNode, key: string): (string | null)[] => {
      openCell(el, 0, 1)
      setValue(byLabel<HTMLInputElement>(el, `Edit ${key}`), '[[')
      const offered = options(el)
      press(byLabel(el, `Edit ${key}`), 'Escape')
      return offered
    }
    beforeEach(async () => {
      const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
      write.mockImplementation(real.writeProperty)
      disk.set(`${SCHEMA}/.folder.md`, schemaFile)
      disk.set(NOTE, '---\ntitle: Orders table\n---\n')
    })

    it('a link set on a subfolder page picks from the inherited target and is the note’s own field; every page shows it; a move out and back keeps it', async () => {
      let el = await open(ORDERS)
      expect(captured.folder!.columns.points_to).toEqual({ decl: { kind: 'link', target: '[[KPIs]]' }, owner: 'schema' })
      expect(picked(el, 'points_to')).toEqual(['CAC', 'LTV']) // the notes of Schema's target, on Orders
      openCell(el, 0, 1)
      setValue(byLabel<HTMLInputElement>(el, 'Edit points_to'), '[[')
      click(q(el, '[role="option"]')) // completes to [[CAC]]
      press(byLabel(el, 'Edit points_to'), 'Enter')
      await flush()
      const linked = '---\ntitle: Orders table\npoints_to: "[[CAC]]"\n---\n'
      expect(disk.get(NOTE)).toBe(linked) // a plain field: the index reads it as a link, so CAC lists the note as a backlink
      el = await open(SCHEMA)
      expect(cell(el, 'Orders table', 1).textContent).toBe('CAC')
      // A move writes no value away (C9): the link goes with the note and comes back with it.
      disk.set(MOVED, disk.get(NOTE)!)
      disk.delete(NOTE)
      el = await open('/vault/Sub', MOVED)
      expect(disk.get(MOVED)).toBe(linked)
      disk.set(NOTE, disk.get(MOVED)!)
      disk.delete(MOVED)
      el = await open(ORDERS)
      expect(cell(el, 'Orders table', 1).textContent).toBe('CAC')
    })

    it('"Change on this folder only" gives Orders its own target; Schema keeps its target and its picker', async () => {
      await open(ORDERS)
      await act(async () => void (await captured.folder!.sources.here('points_to')))
      let el = await open(ORDERS)
      expect(captured.folder!.columns.points_to).toMatchObject({ owner: 'schema/orders', over: 'schema' })
      await act(async () => void (await captured.folder!.setColumn('points_to', { kind: 'link', target: '[[Sub]]' }, { kind: 'link', target: '[[KPIs]]' })))
      expect(disk.get(`${SCHEMA}/.folder.md`)).toBe(schemaFile)
      el = await open(ORDERS)
      expect(picked(el, 'points_to')).toEqual(['Outsider']) // the notes of Orders' own target
      el = await open(SCHEMA)
      expect(picked(el, 'points_to')).toEqual(['CAC', 'LTV'])
    })

    it('"Delete column and clear N values" removes the link field (so its backlink goes); Undo puts back the column and the link', async () => {
      disk.set(NOTE, '---\ntitle: Orders table\npoints_to: "[[CAC]]"\n---\n')
      await open(SCHEMA)
      expect(captured.folder!.valueCount('note.points_to')).toBe(1)
      await act(async () => captured.folder!.deleteColumn!('points_to', true))
      await flush()
      expect(disk.get(NOTE)).toBe('---\ntitle: Orders table\n---\n')
      expect(disk.get(`${SCHEMA}/.folder.md`)).not.toContain('points_to')
      const undo = onNotice.mock.calls.find((call) => call[2] === 'undo')
      expect(undo).toBeDefined()
      echo() // the index catches up with the delete before the Undo, as in the app
      await act(async () => void (await undo![3].run()))
      await flush()
      expect(disk.get(NOTE)).toBe('---\ntitle: Orders table\npoints_to: "[[CAC]]"\n---\n')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toContain('    points_to:\n      kind: link\n')
    })

    it('Undo BEFORE the index has seen the delete (YAZ-4741): the column, its place in the view and the link all come back', async () => {
      disk.set(NOTE, '---\ntitle: Orders table\npoints_to: "[[CAC]]"\n---\n')
      await open(SCHEMA)
      await act(async () => captured.folder!.deleteColumn!('points_to', true))
      await flush()
      expect(disk.get(`${SCHEMA}/.folder.md`)).not.toContain('points_to')
      const undo = onNotice.mock.calls.find((call) => call[2] === 'undo')
      // No echo: the index still holds the column, as when a fast click beats it.
      await act(async () => void (await undo![3].run()))
      await flush()
      expect(disk.get(NOTE)).toBe('---\ntitle: Orders table\npoints_to: "[[CAC]]"\n---\n')
      expect(disk.get(`${SCHEMA}/.folder.md`)).toBe(schemaFile)
    })

    it('a view change between the delete and its echo keeps the delete (YAZ-4741): the view write builds on the pruned views', async () => {
      const el = await open(SCHEMA)
      await act(async () => captured.folder!.deleteColumn!('points_to', false))
      await flush()
      expect(disk.get(`${SCHEMA}/.folder.md`)).not.toContain('points_to')
      // A view write before the echo: the Table tab gets a sort.
      click(byLabel(el, 'Sort'))
      click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
      await flush()
      const after = disk.get(`${SCHEMA}/.folder.md`)!
      expect(after).not.toContain('points_to')
      expect(after).toContain('property: file.name')
    })

    it('a link field no folder defines waits under "Other properties"; shown, it reads and edits as a link', async () => {
      disk.set(NOTE, '---\ntitle: Orders table\ncontact: "[[Outsider]]"\n---\n')
      const el = await open(ORDERS)
      expect(texts(el, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim())).toEqual(['Name', 'Points to'])
      click(byLabel(el, 'Columns and view'))
      click(byLabel(el, 'Show Contact'))
      // An "Other properties" row's Show asks first (YAZ-4764, C4A).
      click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Show')!)
      await flush()
      const ordersView = await open(ORDERS)
      const headers = texts(ordersView, '.view-table thead th:not(.view-table__gutter)').map((t) => t.trim())
      expect(headers).toContain('Contact')
      const column = headers.indexOf('Contact')
      expect(cell(ordersView, 'Orders table', column).textContent).toBe('Outsider') // resolved as a link
      click(q(cell(ordersView, 'Orders table', column), '[data-edit]'))
      setValue(byLabel<HTMLInputElement>(ordersView, 'Edit contact'), '[[')
      expect(options(ordersView).length).toBeGreaterThan(0) // the link picker, typed by the value (no column)
    })
  })

  describe('a write drops no value when the note has moved (C9)', () => {
    const GONE_ID = 'n0f01der0000' // a block for a folder no settings record has
    const settings = { columns: { order: { kind: 'number' } }, views: [{ type: 'table', name: 'Table', order: ['file.name', 'note.order'] }, ORDER_BOARD] }
    const folders = [
      { ...rec('/vault/Sub/.folder.md', { folder_settings: settings }), id: SUB_ID },
      { ...rec(SETTINGS_FILE, { folder_settings: settings }), id: STAGES_ID },
      { ...rec(`${ARCHIVE}/.folder.md`, { folder_settings: settings }), id: ARCHIVE_ID },
    ]
    /** `Old` lives in stages/archive: moved there from Sub outside the app, so it still holds Sub's old values — and a deleted folder's. */
    const values = { [SUB_ID]: { order: 70 }, [GONE_ID]: { order: 5 } }
    const MOVED = `---\ntitle: mine\norder: 3\nin:\n  ${SUB_ID}:\n    order: 70\n  ${GONE_ID}:\n    order: 5\n---\nBody\n`
    const records = [rec(SALES, held({ order: 1 })), rec(DEEP, { title: 'mine', order: 3, in: values })]
    const open = async (): Promise<HTMLElement> => {
      disk.set(DEEP, MOVED)
      const el = renderNoAsk({ path: STAGES, source, onOpenFile })
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      return el
    }

    it('opening the folder that shows it writes nothing', async () => {
      await open()
      expect(writeFile).not.toHaveBeenCalled()
      expect(disk.get(DEEP)).toBe(MOVED)
    })

    it('a cell edit changes the one field; every block stays (D20 is gone)', async () => {
      const el = await open()
      editNumber(el, 'Old', 1, 'Edit order', '9')
      await flush()
      expect(disk.get(DEEP)).toBe(MOVED.replace('order: 3\n', 'order: 9\n'))
      expect(writeFile).toHaveBeenCalledTimes(1)
    })

    it('a board drag does the same, in its one save', async () => {
      const el = await open()
      selectView(el, 'Board')
      fire(card(el, 'Old'), 'dragstart')
      fire(columnHolding(el, 'Sales'), 'drop') // the column of `order: 1`
      await flush()
      expect(disk.get(DEEP)).toBe(MOVED.replace('order: 3\n', 'order: 1\n'))
      expect(writeFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('a page with no id (its `.folder.md` is missing or has none)', () => {
    const idOf = (content: string): string => /^id: (\S+)$/m.exec(content)![1]

    it('a shared value needs no id: the first value written is the note’s field, and no `.folder.md` is made', async () => {
      disk.set(LEAD, `---\norder: 30\nin:\n  ${ARCHIVE_ID}:\n    order: 30\n---\n`)
      const el = await mount(null, [rec(LEAD, { order: 30, in: { [ARCHIVE_ID]: { order: 30 } } })])
      expect(cell(el, 'Lead Gen', 1).textContent).toBe('30')
      editNumber(el, 'Lead Gen', 1, 'Edit order', '9')
      await flush()
      expect(writeFile.mock.calls.map(([request]) => request.path)).toEqual([LEAD])
      expect(disk.get(LEAD)).toBe(`---\norder: 9\nin:\n  ${ARCHIVE_ID}:\n    order: 30\n---\n`)
    })

    it('a separate column (C3): the id lands beside the settings first, then the value in that id’s block', async () => {
      const settings = '---\nfolder_settings:\n  columns:\n    order:\n      kind: number\n      separate: true\n  views:\n    - type: table\n      name: Table\n---\n'
      disk.set(SETTINGS_FILE, settings)
      disk.set(LEAD, '---\norder: 30\n---\n')
      const folders = [rec(SETTINGS_FILE, { folder_settings: { columns: { order: { kind: 'number', separate: true } }, views: [{ type: 'table', name: 'Table' }] } })]
      const records = [rec(LEAD, { order: 30 })]
      const el = renderNoAsk({ path: STAGES, source, onOpenFile })
      act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, true))
      await flush()
      expect(cell(el, 'Lead Gen', 1).textContent).toBe('Empty') // this page's own value: none yet; the note's 30 is not this page's
      editNumber(el, 'Lead Gen', 1, 'Edit order', '4')
      await flush()
      const id = idOf(disk.get(SETTINGS_FILE)!)
      expect(disk.get(SETTINGS_FILE)).toBe(settings.replace(/---\n$/, `id: ${id}\n---\n`))
      expect(disk.get(LEAD)).toBe(`---\norder: 30\nin:\n  ${id}:\n    order: 4\n---\n`)
    })

    it('"New" with a seed of a separate column gives the page its id first too', async () => {
      // A `.folder.md` that saved a filter on a separate column but holds no id.
      disk.set(SETTINGS_FILE, '---\nowner: me\n---\n')
      const folders = [rec(SETTINGS_FILE, { folder_settings: { columns: { kind: { kind: 'text', separate: true } }, views: [{ type: 'table', name: 'Table', filters: 'kind == "task"' }] } })]
      const el = renderNoAsk({ path: STAGES, source, onOpenFile })
      act(() => source.update(linkResolver([], '/vault', vaultDirs('/vault'), folders), [], folders, true))
      await flush()
      click(byLabel(el, 'New note'))
      await flush()
      const id = idOf(disk.get(SETTINGS_FILE)!)
      expect(disk.get(SETTINGS_FILE)).toBe(`---\nowner: me\nid: ${id}\n---\n`)
      expect(created(0).content).toBe(`---\nin:\n  ${id}:\n    kind: task\ntitle: Untitled\n---\n`)
    })
  })

  describe('"Separate value on this page" (C3, 1B)', () => {
    const SEPARATE = { columns: { order: { kind: 'number', separate: true } }, views: [TABLE] }
    const OWN_AND_PAGE = `---\norder: 1\nin:\n  ${STAGES_ID}:\n    order: 3\n---\n`

    it('reads and writes this page’s block; the note’s field and every other page stay as they were', async () => {
      disk.set(LEAD, OWN_AND_PAGE)
      const el = await mount(SEPARATE, [rec(LEAD, { order: 1, in: { [STAGES_ID]: { order: 3 } } })])
      expect(cell(el, 'Lead Gen', 1).textContent).toBe('3')
      editNumber(el, 'Lead Gen', 1, 'Edit order', '9')
      await flush()
      expect(disk.get(LEAD)).toBe(OWN_AND_PAGE.replace('    order: 3\n', '    order: 9\n'))
    })

    it('turning it off with "Keep the notes’ values": page values fill empty fields, a differing one is dropped; Undo puts every block and field back', async () => {
      disk.set(SETTINGS_FILE, `---\nid: ${STAGES_ID}\nfolder_settings:\n  columns:\n    order:\n      kind: number\n      separate: true\n---\n`)
      disk.set(LEAD, OWN_AND_PAGE) // differs: 1 against the page's 3
      disk.set(SALES, `---\nin:\n  ${STAGES_ID}:\n    order: 5\n---\n`) // fills an empty field
      const onNotice = vi.fn()
      renderNoAsk({ path: STAGES, source, onOpenFile, onNotice })
      feed(SEPARATE, [rec(LEAD, { order: 1, in: { [STAGES_ID]: { order: 3 } } }), rec(SALES, { in: { [STAGES_ID]: { order: 5 } } })])
      await flush()
      expect(captured.folder!.separate!.counts('order')).toEqual({ total: 2, fill: 1, differ: 1 })
      await act(async () => captured.folder!.separate!.set('order', { kind: 'number', separate: true }, false, 'notes'))
      expect(disk.get(SETTINGS_FILE)).not.toContain('separate')
      expect(disk.get(LEAD)).toBe('---\norder: 1\n---\n')
      expect(disk.get(SALES)).toBe('---\norder: 5\n---\n')
      expect(onNotice).toHaveBeenCalledExactlyOnceWith('Order has one value per note again', 'info', 'undo', expect.objectContaining({ label: 'Undo' }))
      await act(async () => onNotice.mock.calls[0][3].run())
      await flush()
      expect(disk.get(SETTINGS_FILE)).toContain('separate: true')
      expect(disk.get(LEAD)).toBe(OWN_AND_PAGE)
      expect(disk.get(SALES)).toBe(`---\nin:\n  ${STAGES_ID}:\n    order: 5\n---\n`)
    })

    it('"Use this page’s values": the page value overwrites a differing field', async () => {
      disk.set(SETTINGS_FILE, `---\nid: ${STAGES_ID}\nfolder_settings:\n  columns:\n    order:\n      kind: number\n      separate: true\n---\n`)
      disk.set(LEAD, OWN_AND_PAGE)
      await mount(SEPARATE, [rec(LEAD, { order: 1, in: { [STAGES_ID]: { order: 3 } } })])
      await act(async () => captured.folder!.separate!.set('order', { kind: 'number', separate: true }, false, 'page'))
      expect(disk.get(LEAD)).toBe('---\norder: 3\n---\n')
    })

    it('is offered only where the vault uses IDs', async () => {
      await mount(SETTINGS, vault(), false)
      expect(captured.folder!.separate).toBeUndefined()
    })
  })

  // The ID vault's half of each row is the block above; "New" with a seed is in the block of the plain "New".
  describe('where the vault does not use IDs a folder\u2019s columns are the notes\u2019 own properties (YAZ-2523 V6)', () => {
    const writeOwn = vi.mocked(writeProperties)
    /** The notes as such a vault's index holds them: every key is the note's own, `id`, `title`, `also_in` and `in` like the rest (V12). */
    const OWN = [rec(LEAD, { owner: 'Ana', id: 'k3m9x2pq7abc', also_in: [ARCHIVE_ID] }), rec(SALES, { order: 1 }), rec(DEEP, { title: 'mine', order: 500, in: { [ARCHIVE_ID]: { order: 30 }, [STAGES_ID]: { order: 3 } } })]
    const headers = (el: ParentNode): string[] => texts(el, '.view-table thead th:not(.view-table__gutter)')

    beforeEach(async () => {
      const real = await vi.importActual<typeof import('./writeProperty')>('./writeProperty')
      writeOwn.mockImplementation(real.writeProperties)
      write.mockImplementation(real.writeProperty)
    })

    it('a folder with nothing saved is a Table alone — no Board, no `status` column — listing Name and the notes\u2019 own keys with their values, `id`, `title`, `also_in` and `in` among them; opening writes NOTHING', async () => {
      const el = await mount(null, OWN, false)
      expect(texts(el, '.view-tab__btn')).toEqual(['Table'])
      expect(captured.folder!.settings.columns).toEqual({})
      expect(headers(el)).toEqual(['Name', 'Also in', 'Id', 'In', 'Order', 'Owner', 'Title'])
      expect([cell(el, 'Lead Gen', 2).textContent, cell(el, 'Lead Gen', 5).textContent, cell(el, 'Old', 4).textContent, cell(el, 'Old', 6).textContent]).toEqual(['k3m9x2pq7abc', 'Ana', '500', 'mine'])
      expect(write).not.toHaveBeenCalled()
      expect(writeOwn).not.toHaveBeenCalled()
      expect(writeValues).not.toHaveBeenCalled()
      expect(transform).not.toHaveBeenCalled()
      expect(createFile).not.toHaveBeenCalled()
      expect(writeFile).not.toHaveBeenCalled()
    })

    it('a cell edit writes that one line at the top of the note: an `in:` block already there stays byte for byte, and no `.folder.md` is made', async () => {
      disk.set(DEEP, THREE)
      const el = await mount(null, OWN, false)
      editNumber(el, 'Old', 4, 'Edit order', '9')
      await flush()
      expect(disk.get(DEEP)).toBe(THREE.replace('order: 500\n', 'order: 9\n'))
      expect([...disk.keys()]).toEqual([DEEP])
    })

    it('a board drop writes the grouped property at the top of the note, and nothing else', async () => {
      disk.set(DEEP, THREE)
      const el = await mount({ ...SETTINGS, views: [ORDER_BOARD] }, OWN, false)
      fire(card(el, 'Old'), 'dragstart')
      fire(columnHolding(el, 'Sales'), 'drop') // the column of `order: 1`
      await flush()
      expect(disk.get(DEEP)).toBe(THREE.replace('order: 500\n', 'order: 1\n'))
      expect([...disk.keys()]).toEqual([DEEP])
    })

    it('a view change makes `.folder.md`, holding `folder_settings` and nothing else: no `id`, no `title`, no `status` column', async () => {
      const el = await mount(null, OWN, false)
      click(byLabel(el, 'Add view'))
      click(menuItem(el, 'Cards'))
      await flush()
      expect(disk.get(SETTINGS_FILE)).toBe('---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n    - type: cards\n      name: Cards\n---\n')
      expect([...disk.keys()]).toEqual([SETTINGS_FILE])
    })

    it('a column declared there is the only one the file states, and the folder is still a Table alone', async () => {
      const el = await mount(null, OWN, false)
      await act(async () => void (await captured.folder!.setColumn('owner', { kind: 'text' }, undefined)))
      expect(disk.get(SETTINGS_FILE)).toBe('---\nfolder_settings:\n  columns:\n    owner:\n      kind: text\n---\n')
      feed({ columns: { owner: { kind: 'text' } } }, OWN, false)
      expect(texts(el, '.view-tab__btn')).toEqual(['Table'])
    })

    it('"Delete column…" is not offered, by the header\u2019s menu or the Properties menu; hiding the column is a settings write that leaves every note as it was', async () => {
      const el = await mount(null, OWN, false)
      expect(captured.folder!.deleteColumn).toBeUndefined()
      // The value is the note's own field in both kinds of vault (YAZ-4713 C1), so the count is real; only the Delete is withheld (V11).
      expect(captured.folder!.valueCount('note.owner')).toBe(1)
      click(byLabel(el, 'Columns and view'))
      click(byLabel(el, 'Open Owner'))
      expect(byLabel(el, 'Hide Owner in this view')).toBeDefined()
      expect(el.querySelector('[aria-label="Delete column Owner"]')).toBeNull()
      click(byLabel(el, 'Columns and view'))
      rightClick([...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')][5])
      // "Header row ›" (YAZ-4794) after Fill column.
      expect(texts(el, '[role="menuitem"]')).toEqual(['Edit column…', 'Rename column…', 'Add column to the right…', 'Sort', 'Group', 'Text', 'Fill column', 'Header row', 'Hide column', 'Freeze up to this column', 'Unfreeze columns'])
      click(menuItem(el, 'Hide column'))
      await flush()
      expect(headers(el)).toEqual(['Name', 'Also in', 'Id', 'In', 'Order', 'Title'])
      expect([...disk.keys()]).toEqual([SETTINGS_FILE])
    })
  })
})

/**
 * A read-only note in a folder that uses IDs (YAZ-3076 D6, S52, S53, S57): the views show the
 * folder's block of `in`, never the note's top-level fields, so the switch must reach them from the
 * note's OWN properties. Its cell opens no editor, its card does not move, and nothing is written.
 */
describe('a read-only note in a folder that uses IDs (YAZ-3076 D6)', () => {
  const locked = (): IndexRecord[] => vault().map((r) => (r.path === DEEP ? { ...r, properties: { ...r.properties, readonly: true } } : r))
  const cellOf = (el: ParentNode, name: string, column: number): HTMLElement => q<HTMLElement>(el, `[data-cell="${rowNames(el).indexOf(name)}:${column}"]`)
  const cardOf = (el: ParentNode, name: string): Element => [...el.querySelectorAll('.view-board__title')].find((title) => title.textContent === name)!.closest('.view-board__card')!

  it('its cell shows the folder’s value and has no editor, while another note’s cell still edits', async () => {
    const el = await mount({ ...SETTINGS, views: [TABLE] }, locked())
    expect(cellOf(el, 'Old', 1).textContent).toContain('3')
    expect(cellOf(el, 'Old', 1).querySelector('[data-edit]')).toBeNull()
    expect(cellOf(el, 'Old', 1).querySelector('[title="This note is read only"]')).not.toBeNull()
    expect(cellOf(el, 'Sales', 1).querySelector('[data-edit]')).not.toBeNull()
  })

  it('its board card does not drag; nothing is written', async () => {
    const el = await mount({ ...SETTINGS, views: [{ ...BOARD, order: ['file.name'], groupBy: { property: 'note.order' } }] }, locked())
    expect(cardOf(el, 'Old').getAttribute('draggable')).not.toBe('true')
    act(() => void cardOf(el, 'Old').dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })))
    const sales = cardOf(el, 'Sales').closest('.view-board__col')!
    act(() => void sales.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })))
    await flush()
    expect(writeValues).not.toHaveBeenCalled()
  })

  it('S57: a new snapshot without the switch gives the cell its editor back', async () => {
    const el = await mount({ ...SETTINGS, views: [TABLE] }, locked())
    feed({ ...SETTINGS, views: [TABLE] }, vault())
    await flush()
    expect(cellOf(el, 'Old', 1).querySelector('[data-edit]')).not.toBeNull()
  })
})

describe('S24: renaming an option rewrites the notes that hold it (YAZ-4591)', () => {
  const STAGE = { kind: 'select' as const, options: ['Todo', 'Done'] }
  const RENAMED = { kind: 'select' as const, options: ['Next', 'Done'] }
  const WITH_STAGE = { columns: { stage: STAGE }, views: [TABLE] }
  /** The files `transformFile` reads and rewrites: the settings file and the notes. */
  let disk: Map<string, string>
  const yaml = (values: string, own = ''): string => `---\n${own}in:\n  ${STAGES_ID}:\n    ${values}\n---\n`
  /** A note holding the value as its own field (YAZ-4713 C1). */
  const own = (values: string, before = ''): string => `---\n${before}${values}\n---\n`

  beforeEach(() => {
    disk = new Map([[SETTINGS_FILE, `---\nid: ${STAGES_ID}\nfolder_settings:\n  columns:\n    stage:\n      kind: select\n      options: [Todo, Done]\n  views:\n    - type: table\n      name: Table\n      filters: note.stage == "Todo"\n---\n`]])
    transform.mockImplementation(async (path: string, fn: (content: string) => string) => {
      const after = fn(disk.get(path) ?? '')
      disk.set(path, after)
      return { mtime: 2, content: after }
    })
  })

  async function mountWith(records: IndexRecord[], ids = true, settings: unknown = WITH_STAGE) {
    const onNotice = vi.fn()
    renderNoAsk({ path: STAGES, source, onOpenFile, onNotice })
    feed(settings, records, ids)
    await flush()
    return onNotice
  }

  it('ID vault: the declaration and the views\' filters first, then one write per note of the column’s folder holding it as its own field (YAZ-4713 C1) — a list keeps its other elements; Undo puts all back', async () => {
    disk.set(LEAD, own('stage: Todo'))
    // The list holds both labels (YAZ-4637 M5): the rename folds it to one, and Undo puts the exact list back.
    disk.set(SALES, own('stage: [Todo, Next]'))
    disk.set(OTHER, own('stage: Todo')) // no row of this folder: another folder's note keeps its value
    const onNotice = await mountWith([rec(OTHER, held({ stage: 'Todo' })), rec(LEAD, held({ stage: 'Todo' })), rec(SALES, held({ stage: ['Todo', 'Next'] })), rec(DEEP, held({ stage: 'Done' }))])
    await act(async () => captured.folder!.setColumn('stage', RENAMED, STAGE, { from: 'Todo', to: 'Next' }))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE, LEAD, SALES])
    expect(disk.get(LEAD)).toBe(own('stage: Next'))
    expect(disk.get(SALES)).toMatch(/stage:\n\s+- Next\n---/)
    expect(disk.get(OTHER)).toBe(own('stage: Todo'))
    // The view's filter on that value follows in the same settings write (M5).
    expect(disk.get(SETTINGS_FILE)).toContain('filters: note.stage == "Next"')
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Renamed “Todo” to “Next” in 2 notes', 'info', 'undo', expect.objectContaining({ label: 'Undo', fades: true }))
    transform.mockClear()
    await act(async () => onNotice.mock.calls[0][3].run())
    await flush()
    expect(transform.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE, LEAD, SALES])
    expect(disk.get(LEAD)).toBe(own('stage: Todo'))
    expect(disk.get(SALES)).toMatch(/stage:\n\s+- Todo\n\s+- Next\n/)
    expect(disk.get(SETTINGS_FILE)).toMatch(/options:\s*\[\s*Todo,\s*Done\s*\]|- Todo\n\s*- Done/)
    expect(disk.get(SETTINGS_FILE)).toContain('filters: note.stage == "Todo"')
  })

  it('a separate column (C3): the notes holding it in this page’s block, wherever they are; the note’s own field is not this page’s', async () => {
    disk.set(SETTINGS_FILE, disk.get(SETTINGS_FILE)!.replace('      options: [Todo, Done]\n', '      options: [Todo, Done]\n      separate: true\n'))
    disk.set(OTHER, yaml('stage: Todo', 'stage: Todo\n'))
    const onNotice = await mountWith([rec(OTHER, inBlock({ stage: 'Todo' }, { stage: 'Todo' }))], true, { columns: { stage: { ...STAGE, separate: true } }, views: [TABLE] })
    await act(async () => captured.folder!.setColumn('stage', { ...RENAMED, separate: true }, { ...STAGE, separate: true }, { from: 'Todo', to: 'Next' }))
    expect(disk.get(OTHER)).toBe(yaml('stage: Next', 'stage: Todo\n'))
    expect(onNotice.mock.calls[0][0]).toBe('Renamed “Todo” to “Next” in 1 note')
  })

  it('a note that is read only on disk is never written (YAZ-4637 M6): the toast counts it as not changed', async () => {
    disk.set(LEAD, own('stage: Todo'))
    disk.set(SALES, own('stage: Todo', 'readonly: true\n'))
    const onNotice = await mountWith([rec(SALES, held({ stage: 'Todo' })), rec(LEAD, held({ stage: 'Todo' }))])
    await act(async () => captured.folder!.setColumn('stage', RENAMED, STAGE, { from: 'Todo', to: 'Next' }))
    expect(disk.get(SALES)).toBe(own('stage: Todo', 'readonly: true\n'))
    expect(onNotice.mock.calls[0][0]).toBe('Renamed “Todo” to “Next” in 1 note · 1 note not changed')
  })

  it('a refused declaration touches no note', async () => {
    disk.set(LEAD, own('stage: Todo'))
    const onNotice = await mountWith([rec(LEAD, held({ stage: 'Todo' }))])
    await act(async () => expect(captured.folder!.setColumn('stage', RENAMED, { kind: 'select', options: ['Other'] }, { from: 'Todo', to: 'Next' })).rejects.toThrow('changed since'))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE])
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('a read-only note keeps the old label, and the toast says so', async () => {
    disk.set(LEAD, own('stage: Todo'))
    disk.set(SALES, own('stage: Todo', 'readonly: true\n'))
    const onNotice = await mountWith([rec(LEAD, held({ stage: 'Todo' })), rec(SALES, held({ stage: 'Todo' }, { readonly: true }))])
    await act(async () => captured.folder!.setColumn('stage', RENAMED, STAGE, { from: 'Todo', to: 'Next' }))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE, LEAD])
    expect(onNotice.mock.calls[0][0]).toBe('Renamed “Todo” to “Next” in 1 note · 1 note not changed')
  })

  it('a vault without IDs: the rows’ own top-level key', async () => {
    disk.set(LEAD, '---\nstage: Todo\n---\n')
    disk.set(SETTINGS_FILE, '---\nfolder_settings:\n  columns:\n    stage:\n      kind: select\n      options: [Todo, Done]\n  views: []\n---\n')
    const onNotice = await mountWith([rec(LEAD, { stage: 'Todo' }), rec(OTHER, { stage: 'Todo' })], false)
    await act(async () => captured.folder!.setColumn('stage', RENAMED, STAGE, { from: 'Todo', to: 'Next' }))
    expect(transform.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE, LEAD]) // Other is no row of this folder
    expect(disk.get(LEAD)).toBe('---\nstage: Next\n---\n')
    expect(onNotice.mock.calls[0][0]).toBe('Renamed “Todo” to “Next” in 1 note')
  })
})
