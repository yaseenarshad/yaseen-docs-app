/**
 * The folder page's contents block (YAZ-819; 🔒 D1/D2/D3 of YAZ-818). Mounted with react-dom in
 * jsdom over a REAL `WikilinkResolveSource` — the App-owned feed the whole block runs on — with
 * `writeProperty` mocked (the ONE card writer, shared by the settings door and every cell) and
 * `api` mocked for the create path.
 *
 * Pinned here: the block appears only for a flagged page; its rows are the MEMBERS and nobody
 * else; link resolution and the link pickers read the WHOLE vault even though the rows are a
 * subset (🔒 D2 — the trap the design closed); a config edit is ONE `folder_page_settings` write
 * on the FOLDER PAGE while a cell edit still writes the MEMBER's own card; switching view writes
 * nothing at all; and "New" births a member from the declaration, parked per the settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CreateFileRequest, IndexRecord } from '@shared/types'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { FolderPageContents } from './FolderPageContents'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), createDir: vi.fn(), createFile: vi.fn() },
}))
/** The real pane, wrapped: YAZ-895's columns door has no menu caller yet, so it is reached as the bundle. */
const captured = vi.hoisted(() => ({ folderPage: null as FolderPageMode | null }))
vi.mock('./ViewsPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ViewsPane')>()
  return {
    ...actual,
    ViewsPane: (props: ViewsPaneProps) => {
      captured.folderPage = props.folderPage
      return <actual.ViewsPane {...props} />
    },
  }
})

import { api, BridgeRequestError } from '../api'
import type { FolderPageMode, ViewsPaneProps } from './ViewsPane'
import { writeProperty } from './writeProperty'

const write = vi.mocked(writeProperty)
const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)
/** The atomic content-at-create form is the only one this path uses (`createNewNote`). */
const created = (call: number): CreateFileRequest => createFile.mock.calls[call][0] as CreateFileRequest

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const FUNNELS = '/vault/Funnel Stages.md'
const LEAD = '/vault/stages/Lead Gen.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const KPIS = '/vault/KPIs.md'
const OUTSIDER = '/vault/Sub/Outsider.md'

const TABLE = { type: 'table', name: 'Table', order: ['file.name', 'note.order', 'note.related'] }
const SETTINGS = {
  columns: { order: { kind: 'number' }, related: { kind: 'multi-link', target: '[[KPIs]]' } },
  folder: 'stages',
  views: [{ type: 'outline', name: 'Outline' }, TABLE],
}

/** The whole snapshot: the folder page, its two members, and a SECOND folder page nobody here belongs to. */
function vault(settings: unknown = SETTINGS): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: settings }),
    rec(OTHER, { title: 'not a member' }),
    rec(KPIS, { folder_page: true }),
    rec('/vault/kpis/CAC.md', { folder_pages: ['[[KPIs]]'] }),
    rec('/vault/kpis/LTV.md', { folder_pages: ['[[KPIs]]'] }),
    rec(SALES, { folder_pages: ['[[Funnel Stages]]'], order: 1 }),
    rec(LEAD, { folder_pages: ['[[Funnel Stages]]'], order: 2, owner: '[[Sub/Outsider]]' }),
    rec(OUTSIDER, {}),
  ]
}

// ---------- harness ----------

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()

/** WikilinkIndexBridge's own wrapping: THE shared resolver, unwrapped to a path. */
function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path: string, records: IndexRecord[] | null = vault()): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<FolderPageContents path={path} root="/vault" source={source} onOpenFile={onOpenFile} />))
  if (records !== null) feed(records)
  return container
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  write.mockResolvedValue({ mtime: 2 })
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createDir.mockResolvedValue({ path: '/vault/stages' })
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
})

// ---------- DOM helpers (RelationColumn.test.tsx style) ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)
const texts = (el: ParentNode, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.textContent ?? '')
const options = (el: ParentNode): (string | null)[] => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)
/**
 * Row names, whichever body is rendering: the outline (YAZ-820, which names pages the way a link
 * does — no extension), the placeholder list, or the real table (`file.name`, extension and all).
 */
const rowNames = (el: ParentNode): string[] => texts(el, '.view-outline__link, .view-row__link, .view-table__link')

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

async function flush(): Promise<void> {
  await act(async () => {})
}

const openTable = (el: ParentNode): void => click(q(el, '.view-tab__btn:nth-of-type(1)'))
/** Switch to the view named `name` (tabs are switch-only here). */
function selectView(el: ParentNode, name: string): void {
  const tab = [...el.querySelectorAll<HTMLElement>('.view-tab__btn')].find((b) => b.textContent === name)
  if (tab === undefined) throw new Error(`no view tab ${name}`)
  click(tab)
}

const openCell = (el: ParentNode, r: number, c: number): void => click(q(q<HTMLElement>(el, `[data-cell="${r}:${c}"]`), '[data-edit]'))

// ---------- the block itself (🔒 D1) ----------

describe('who gets a contents block', () => {
  it('an ordinary page gets nothing at all — no chrome, no empty block', () => {
    expect(mount(OTHER).innerHTML).toBe('')
  })

  it('a page that IS one but has no snapshot yet gets nothing either (the pre-index window)', () => {
    expect(mount(FUNNELS, null).innerHTML).toBe('')
  })

  it('a flagged page renders the block, and drops it again if the flag goes away', () => {
    const el = mount(FUNNELS)
    expect(el.querySelector('.folder-page-contents')).not.toBeNull()
    feed(vault().map((r) => (r.path === FUNNELS ? rec(FUNNELS, {}) : r)))
    expect(el.innerHTML).toBe('')
  })

  it('the flag is STRICTLY the boolean (the click rule, "Links": Folder pages)', () => {
    const el = mount(FUNNELS, vault().map((r) => (r.path === FUNNELS ? rec(FUNNELS, { folder_page: 'true' }) : r)))
    expect(el.innerHTML).toBe('')
  })
})

// ---------- the rows (🔒 D2) ----------

describe('rows are the members, and only the members', () => {
  it('the lookup fills the block — never a filter over the whole vault', () => {
    const el = mount(FUNNELS)
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales']) // the outline, alphabetical (🔒 the [D5] rule)
    selectView(el, 'Table')
    expect(rowNames(el)).toEqual(['Lead Gen.md', 'Sales.md']) // path order, as `pagesIn` gives them
    expect(el.textContent).not.toContain('Other')
    expect(el.textContent).not.toContain('CAC')
  })

  it('a member added on the next snapshot lands in the block with no user action', () => {
    const el = mount(FUNNELS)
    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    expect(rowNames(el)).toEqual(['Expansion', 'Lead Gen', 'Sales'])
  })

  it('the whole-vault resolver reaches the engine: a link pointing OUTSIDE the members resolves (🔒 D2)', () => {
    // The trap: with only the members behind it, `link("Outsider")` names nothing and the
    // spellings never meet. The row shows because the resolver came from the whole snapshot.
    const el = mount(FUNNELS, vault({ views: [{ type: 'table', name: 'T', order: ['file.name'], filters: 'owner == link("Outsider")' }] }))
    expect(rowNames(el)).toEqual(['Lead Gen.md'])
  })
})

// ---------- the chrome (🔒 rule 4 + Q3) ----------

describe('the chrome is the views chrome, minus what a folder page cannot have', () => {
  it('both skins render and the tabs switch between them (🔒 Q7: outline first)', () => {
    const el = mount(FUNNELS)
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
    expect(el.querySelector('.view-outline')).not.toBeNull() // YAZ-820's renderer
    expect(el.querySelector('.view-table')).toBeNull()
    selectView(el, 'Table')
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(rowNames(el)).toEqual(['Lead Gen.md', 'Sales.md'])
  })

  it('switching view writes NOTHING — which view is active is session state, never the card', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    selectView(el, 'Outline')
    expect(write).not.toHaveBeenCalled()
  })

  it('the tabs are switch-only (no add, no view menu) and there is no Filter button (🔒 Q3)', () => {
    const el = mount(FUNNELS)
    expect(el.querySelector('[aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('[aria-label="View menu"]')).toBeNull()
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull()
    expect(el.querySelector('[aria-label="Sort"]')).not.toBeNull() // the rest of the toolbar is untouched
    expect(el.querySelector('[aria-label="New note"]')).not.toBeNull()
  })
})

// ---------- the adapter (🔒 D3) ----------

describe('config edits are ONE settings write on the folder page', () => {
  it('a sort change goes back through the one door, whole-key, views verbatim', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(FUNNELS) // the FOLDER PAGE's card, not a member's
    expect(key).toBe('folder_page_settings')
    expect(value).toEqual({
      ...SETTINGS,
      views: [SETTINGS.views[0], { ...TABLE, sort: [{ property: 'file.name', direction: 'ASC' }] }],
    })
  })

  it('the edit shows immediately, without waiting for the index to come back', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(byLabel<HTMLSelectElement>(el, 'Sort property').value).toBe('file.name')
  })

  it('a failed write says so and never takes the block down', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-table')).not.toBeNull()
  })
})

describe('setColumns is the DECLARATIONS door (YAZ-895)', () => {
  const COLUMNS = { order: { kind: 'number' as const }, owner: { kind: 'link' as const } }

  it('one write, whole-key: the new columns, the card’s views verbatim', async () => {
    mount(FUNNELS)
    act(() => captured.folderPage!.setColumns(COLUMNS))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, columns: COLUMNS })
  })

  it('columns AND views ride in that SAME single write when views are passed', async () => {
    mount(FUNNELS)
    const views = [{ type: 'outline', name: 'Outline', order: ['[[Sales]]'] }, TABLE]
    act(() => captured.folderPage!.setColumns(COLUMNS, views))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, columns: COLUMNS, views })
  })

  it('a failed write lands in the banner every other config edit uses', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = mount(FUNNELS)
    act(() => captured.folderPage!.setColumns(COLUMNS))
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-outline')).not.toBeNull()
  })
})

describe('cell editing still writes the MEMBER, typed by the folder page (🔒 Q8)', () => {
  it('the picker narrows to the pages of the folder page the column targets — from the WHOLE vault (🔒 D2)', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    openCell(el, 0, 2) // Lead Gen's empty `related` cell: multi-link by the folder page's own declaration
    const input = byLabel<HTMLInputElement>(el, 'Edit related')
    setValue(input, '[[')
    // [[KPIs]] is not a row here and neither are its pages — a picker fed the rows alone would
    // have fallen back to the two members instead.
    expect(options(el)).toEqual(['CAC', 'LTV'])
  })

  it('committing writes the member’s own card, one key, through the shared writer', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    openCell(el, 0, 2)
    setValue(byLabel<HTMLInputElement>(el, 'Edit related'), '[[')
    click(q(el, '[role="option"]')) // completes to [[CAC]]
    press(byLabel(el, 'Edit related'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit related'), 'Enter') // empty input commits the list
    expect(write).toHaveBeenCalledExactlyOnceWith(LEAD, 'related', ['[[CAC]]'])
  })
})

describe('New births a member from the declaration (🔒 Q5)', () => {
  it('parks it in the settings folder, stamps the belonging LAST, and opens it', async () => {
    const el = mount(FUNNELS)
    click(byLabel(el, 'New note'))
    await flush()

    expect(createDir).toHaveBeenCalledWith('/vault/stages')
    expect(createFile).toHaveBeenCalledTimes(1)
    const { path, content } = created(0)
    expect(path).toBe('/vault/stages/Untitled.md') // Lead Gen / Sales are taken
    expect(content).toBe('---\norder:\nrelated: []\nfolder_pages:\n  - "[[Funnel Stages]]"\n---\n')
    expect(content).not.toContain('folder_page:') // an ORDINARY page: the flag is never born here
    expect(onOpenFile).toHaveBeenCalledWith('/vault/stages/Untitled.md')
  })

  it('without a settings folder it lands beside the folder page itself', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, folder: undefined }))
    click(byLabel(el, 'New note'))
    await flush()
    expect(createDir).not.toHaveBeenCalled()
    expect(created(0).path).toBe('/vault/Untitled.md')
  })

  it('a create failure is reported in place, never thrown at the note', async () => {
    createFile.mockRejectedValue(new Error('read-only vault'))
    const el = mount(FUNNELS)
    click(byLabel(el, 'New note'))
    await flush()
    expect(el.textContent).toContain('read-only vault')
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})
