/**
 * The folder page's OUTLINE view (YAZ-820; 🔒 D4 of YAZ-818, [D3]-[D6] of the mockup). Mounted
 * through the REAL host (`FolderPageContents` → `BaseView`), the same harness 5.1's tests use, so
 * the routing — `type: outline` INSIDE the folder-page mode and nowhere else — is proven by the
 * rows appearing at all, and every write travels the real door it will travel in the app.
 *
 * Pinned here: order is `orderedMembers` and nothing else; the chevron expands, with
 * `walkFolderPage`'s ancestor-path guard node for node (an A↔B loop terminates, a diamond renders
 * under BOTH parents); the glyph and the direct-member count are folder-page rows only; a drag at
 * depth 0 writes the outline view's `order` and touches NO card; the add row is picker-only —
 * self and members excluded, a pick appends to the TARGET's `folder_pages` preserving what was
 * there, Enter never commits free text, the explicit create row births a member; and the × is a
 * confirm sheet whose copy is a pure function, whose Cancel writes nothing and whose Confirm
 * removes only THIS folder page's entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CreateFileRequest, IndexRecord } from '@shared/types'
import { resolverFor } from '../engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { parseBase } from '../baseFile'
import { BaseView } from '../BaseView'
import { FolderPageContents } from '../FolderPageContents'
import { removeMemberMessage } from './ConfirmRemoveMember'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { readFile: vi.fn(), createDir: vi.fn(), createFile: vi.fn() },
}))

import { api, BridgeRequestError } from '../../api'
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)
const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)
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
const NURTURE = '/vault/stages/Nurture.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const KPIS = '/vault/KPIs.md'

const OUTLINE = { type: 'outline', name: 'Outline' }
const TABLE = { type: 'table', name: 'Table', order: ['file.name'] }
const SETTINGS = { columns: {}, folder: 'stages', views: [OUTLINE, TABLE] }

/**
 * The folder page, three members (one of them ALSO in a second folder page, so the remove sheet
 * has something to name), a second folder page nobody here belongs to, and one loose page the
 * picker can offer.
 */
function vault(settings: unknown = SETTINGS): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: settings }),
    rec(KPIS, { folder_page: true }),
    rec(OTHER, { title: 'not a member' }),
    rec(LEAD, { folder_pages: ['[[Funnel Stages]]'] }),
    rec(NURTURE, { folder_pages: ['[[Funnel Stages]]', '[[KPIs]]'], note: 'keep me' }),
    rec(SALES, { folder_pages: ['[[Funnel Stages]]'] }),
  ]
}

/**
 * The NESTING vault: `Alpha` and `Beta` are folder pages that contain EACH OTHER (the one-keystroke
 * `A → B → A` loop the guard exists for), and `Diamond` belongs to both of them.
 */
function nested(): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: { views: [OUTLINE, TABLE] } }),
    rec('/vault/Alpha.md', { folder_page: true, folder_pages: ['[[Funnel Stages]]', '[[Beta]]'] }),
    rec('/vault/Beta.md', { folder_page: true, folder_pages: ['[[Funnel Stages]]', '[[Alpha]]'] }),
    rec('/vault/Diamond.md', { folder_pages: ['[[Alpha]]', '[[Beta]]'] }),
  ]
}

// ---------- harness (FolderPageContents.test.tsx's, verbatim) ----------

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()
const onOpenFileBackground = vi.fn()

function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path = FUNNELS, records: IndexRecord[] = vault()): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <FolderPageContents path={path} root="/vault" source={source} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} />,
    ),
  )
  feed(records)
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

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const all = <T extends Element>(el: ParentNode, sel: string): T[] => [...el.querySelectorAll<T>(sel)]
const texts = (el: ParentNode, sel: string): string[] => all(el, sel).map((n) => n.textContent ?? '')
/** The outline's own rows, in render order — nesting included, since nested rows are siblings. */
const rowNames = (el: ParentNode): string[] => texts(el, '.base-outline__link')
const rowFor = (el: ParentNode, path: string): HTMLElement => q<HTMLElement>(el, `[data-outline-row="${path}"]`)
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element, init: MouseEventInit = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(el: Element, key: string): void {
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

/**
 * Drag events bubble like the real thing; jsdom has no DragEvent and the handlers guard
 * `dataTransfer` (the TabBar / groupDrag idiom). jsdom rects are all-zero, so the midpoint test
 * reduces to the sign of `clientY`: negative = before the row, else after it.
 */
const fire = (target: Element, type: string, clientY = 0): void =>
  act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))

async function flush(): Promise<void> {
  await act(async () => {})
}

const addInput = (el: ParentNode): HTMLInputElement => byLabel<HTMLInputElement>(el, 'Link a page')
const picks = (el: ParentNode): string[] => texts(el, '.base-outline__pick')

function focusAdd(el: ParentNode, query: string): HTMLInputElement {
  const input = addInput(el)
  act(() => input.focus())
  setValue(input, query)
  return input
}

// ---------- routing ----------

describe('the outline is the folder page’s skin — and only ever hers', () => {
  it('a folder page’s `type: outline` view renders the outline, not the placeholder rows', () => {
    const el = mount()
    expect(el.querySelector('.base-outline')).not.toBeNull()
    expect(el.querySelector('.base-row__link')).toBeNull() // the old unknown-view placeholder
    expect(texts(el, '.base-tab__btn')).toEqual(['Outline', 'Table'])
  })

  it('a `type: outline` view with no folder page keeps the placeholder rows — an outline of WHAT?', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <BaseView
          parsed={parseBase('views:\n  - type: outline\n    name: Outline\n')}
          onChange={vi.fn()}
          root="/vault"
          thisFile="/vault/x.md"
          records={[rec(LEAD)]}
          indexStatus="ready"
          onOpenFile={onOpenFile}
        />,
      ),
    )
    expect(container.querySelector('.base-outline')).toBeNull()
    expect(texts(container, '.base-row__link')).toEqual(['Lead Gen.md'])
  })

  it('the Properties menu is not offered while it shows — its every gesture rewrites `view.order`', () => {
    const el = mount()
    expect(el.querySelector('[aria-label="Properties"]')).toBeNull()
    const tab = all<HTMLElement>(el, '.base-tab__btn').find((b) => b.textContent === 'Table')!
    click(tab)
    expect(el.querySelector('[aria-label="Properties"]')).not.toBeNull() // the table keeps it
  })
})

// ---------- order (🔒 the [D5] rule, in ONE place) ----------

describe('rows come out in `orderedMembers` order', () => {
  it('no `order` at all is all-alphabetical by basename', () => {
    expect(rowNames(mount())).toEqual(['Lead Gen', 'Nurture', 'Sales'])
  })

  it('the outline view’s `order` places its entries first, the rest alphabetical behind them', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    expect(rowNames(el)).toEqual(['Sales', 'Lead Gen', 'Nurture'])
  })

  it('a stale entry is ignored harmlessly and every member still appears exactly once', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Gone]]', '[[Other]]', '[[Nurture]]'] }, TABLE] }))
    expect(rowNames(el)).toEqual(['Nurture', 'Lead Gen', 'Sales'])
  })

  it('the toolbar search still narrows the rows once an `order` is stored', () => {
    // The trap the engine hand-off closes: `order` here is MEMBERS, not columns, so a view run
    // with it would give every row empty values and search would hide the whole outline.
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    click(byLabel(el, 'Search'))
    setValue(byLabel<HTMLInputElement>(el, 'Search rows'), 'Nurture')
    expect(rowNames(el)).toEqual(['Nurture'])
  })
})

// ---------- opening ----------

describe('a row opens its page — the standard two handlers', () => {
  it('a click opens in place; ⌘-click opens in a background tab', () => {
    const el = mount()
    click(q(rowFor(el, LEAD), '.base-outline__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(LEAD)
    expect(onOpenFileBackground).not.toHaveBeenCalled()

    click(q(rowFor(el, SALES), '.base-outline__link'), { metaKey: true })
    expect(onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(SALES)
    expect(onOpenFile).toHaveBeenCalledTimes(1) // still just the first one
  })
})

// ---------- nesting (🔒 D6: the ancestor-path guard) ----------

describe('a folder-page member expands to its own members', () => {
  it('the glyph and the direct-member count ride folder-page rows ONLY', () => {
    const el = mount(FUNNELS, nested())
    expect(rowNames(el)).toEqual(['Alpha', 'Beta'])
    expect(texts(el, '.base-outline__count')).toEqual(['2', '2']) // Beta+Diamond, Alpha+Diamond

    const plain = mount()
    expect(plain.querySelector('.base-outline__glyph')).toBeNull()
    expect(plain.querySelector('.base-outline__count')).toBeNull()
  })

  it('an ordinary member gets a chevron SLOT and no chevron — nothing shifts sideways', () => {
    const el = mount()
    expect(el.querySelectorAll('.base-outline__chevron').length).toBe(0)
    expect(el.querySelectorAll('.base-outline__row .base-outline__chevron-slot').length).toBe(3)
  })

  it('the chevron is its own hit target: expanding never opens the page', () => {
    const el = mount(FUNNELS, nested())
    click(byLabel(el, 'Expand Alpha'))
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(rowNames(el)).toEqual(['Alpha', 'Beta', 'Diamond', 'Beta'])
    click(byLabel(el, 'Collapse Alpha'))
    expect(rowNames(el)).toEqual(['Alpha', 'Beta'])
  })

  it('the A↔B loop TERMINATES: a member already standing above the branch is skipped', () => {
    const el = mount(FUNNELS, nested())
    click(byLabel(el, 'Expand Alpha')) // Alpha ▸ Beta, Diamond
    const beta = all<HTMLElement>(el, '[data-outline-row="/vault/Beta.md"]')[0]
    click(q(beta, '.base-outline__chevron'))
    // Beta's own members are Alpha and Diamond — and Alpha is an ANCESTOR here, so it is not
    // rendered at all and the branch ends. Depth 0's Beta is untouched.
    expect(rowNames(el)).toEqual(['Alpha', 'Beta', 'Diamond', 'Diamond', 'Beta'])
  })

  it('a DIAMOND renders under both its parents, and each copy expands on its own', () => {
    const el = mount(FUNNELS, nested())
    click(byLabel(el, 'Expand Alpha'))
    click(all<HTMLElement>(el, '[aria-label="Expand Beta"]').at(-1)!) // the depth-0 Beta
    expect(rowNames(el)).toEqual(['Alpha', 'Beta', 'Diamond', 'Beta', 'Alpha', 'Diamond'])
    expect(all(el, '[data-outline-row="/vault/Diamond.md"]').length).toBe(2)
  })

  it('depth > 0 carries no × and no drag — a nested level belongs to ITS folder page', () => {
    const el = mount(FUNNELS, nested())
    click(byLabel(el, 'Expand Alpha'))
    const nestedDiamond = rowFor(el, '/vault/Diamond.md')
    expect(nestedDiamond.getAttribute('draggable')).toBe('false')
    expect(nestedDiamond.querySelector('.base-outline__x')).toBeNull()
    expect(all(el, '.base-outline__row[draggable="true"]').length).toBe(2) // Alpha and Beta, depth 0
  })

  it('each level orders by its OWN folder page’s settings, never the outer one’s', () => {
    const records = nested().map((r) =>
      r.path === '/vault/Alpha.md'
        ? rec('/vault/Alpha.md', {
            folder_page: true,
            folder_pages: ['[[Funnel Stages]]', '[[Beta]]'],
            folder_page_settings: { views: [{ ...OUTLINE, order: ['[[Diamond]]'] }] },
          })
        : r,
    )
    const el = mount(FUNNELS, records)
    click(byLabel(el, 'Expand Alpha'))
    expect(rowNames(el)).toEqual(['Alpha', 'Diamond', 'Beta', 'Beta'])
  })
})

// ---------- drag (🔒 presentation only) ----------

describe('drag-to-reorder at depth 0 writes the view’s order, and nothing else', () => {
  it('a drop past a row’s midpoint writes the new sequence as wikilinks — ONE settings key', async () => {
    const el = mount()
    fire(rowFor(el, LEAD), 'dragstart')
    expect(rowFor(el, LEAD).className).toContain('base-outline__row--dragging')
    fire(rowFor(el, SALES), 'dragover', 5)
    fire(rowFor(el, SALES), 'drop', 5) // after Sales = last
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(FUNNELS) // the FOLDER PAGE's card — no member is touched
    expect(key).toBe('folder_page_settings')
    expect(value).toEqual({ folder: 'stages', views: [{ ...OUTLINE, order: ['[[Nurture]]', '[[Sales]]', '[[Lead Gen]]'] }, TABLE] })
  })

  it('a drop on a row’s top half inserts BEFORE it, and the indicator marks that row', async () => {
    const el = mount()
    fire(rowFor(el, SALES), 'dragstart')
    fire(rowFor(el, LEAD), 'dragover', -5)
    expect(rowFor(el, LEAD).className).toContain('base-outline__row--insert-before')
    fire(rowFor(el, LEAD), 'drop', -5)
    await flush()
    expect(write.mock.calls[0][2]).toMatchObject({ views: [{ order: ['[[Sales]]', '[[Lead Gen]]', '[[Nurture]]'] }, TABLE] })
  })

  it('dropping back on the grabbed slot writes nothing; dragend clears an abandoned drag', async () => {
    const el = mount()
    fire(rowFor(el, LEAD), 'dragstart')
    fire(rowFor(el, LEAD), 'drop', -5) // before itself = its own slot
    await flush()
    expect(write).not.toHaveBeenCalled()

    fire(rowFor(el, LEAD), 'dragstart')
    fire(rowFor(el, LEAD), 'dragend')
    expect(el.querySelector('.base-outline__row--dragging')).toBeNull()
  })

  it('the order the drag rewrites lands on the FIRST outline view, which is what reads it back', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    expect(rowNames(el)).toEqual(['Sales', 'Lead Gen', 'Nurture'])
    fire(rowFor(el, SALES), 'dragstart')
    fire(rowFor(el, NURTURE), 'drop', 5)
    await flush()
    expect(write.mock.calls[0][2]).toMatchObject({ views: [{ order: ['[[Lead Gen]]', '[[Nurture]]', '[[Sales]]'] }, TABLE] })
  })
})

// ---------- the add row (🔒 rows are pages) ----------

describe('the add row is picker-only', () => {
  it('candidates exclude this folder page and everyone already in it', () => {
    const el = mount()
    focusAdd(el, '')
    expect(picks(el)).toEqual(['KPIs', 'Other'])
    expect(picks(el)).not.toContain('Funnel Stages')
  })

  it('typing narrows through the SHARED matcher: prefix bucket first, snapshot order within it', () => {
    const el = mount(FUNNELS, [...vault(), rec('/vault/Theory.md'), rec('/vault/The Other One.md')])
    focusAdd(el, 'the')
    // `matchLinkCandidates` (Links B) ranks exact → prefix → substring and keeps input order
    // inside each bucket — the ranking the `[[` picker and every cell editor already use. And
    // `the` names no page, so the explicit create row rides at the bottom.
    expect(picks(el)).toEqual(['Theory', 'The Other One', 'Other', "+ Create 'the' here"])
  })

  it('picking appends this folder page to the TARGET’s card, preserving what was already there', () => {
    const el = mount()
    focusAdd(el, 'Oth')
    click(q(el, '.base-outline__pick'))
    expect(write).toHaveBeenCalledExactlyOnceWith(OTHER, 'folder_pages', ['[[Funnel Stages]]'])

    // …and a page that already belongs somewhere keeps that entry: read-modify-WRITE.
    write.mockClear()
    const withKpis = mount(FUNNELS, vault().map((r) => (r.path === OTHER ? rec(OTHER, { folder_pages: ['[[KPIs]]'] }) : r)))
    focusAdd(withKpis, 'Oth')
    click(q(withKpis, '.base-outline__pick'))
    expect(write).toHaveBeenCalledExactlyOnceWith(OTHER, 'folder_pages', ['[[KPIs]]', '[[Funnel Stages]]'])
  })

  it('Enter picks the first match — and with no match it commits NOTHING', () => {
    const el = mount()
    const input = focusAdd(el, 'Oth')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(OTHER, 'folder_pages', ['[[Funnel Stages]]'])

    write.mockClear()
    const fresh = mount()
    press(focusAdd(fresh, 'Nothing By That Name'), 'Enter')
    expect(write).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('a name no page carries offers ONE explicit create row, which births a member and opens nothing', async () => {
    const el = mount()
    focusAdd(el, 'Expansion')
    expect(picks(el)).toEqual(["+ Create 'Expansion' here"])
    click(q(el, '.base-outline__pick--create'))
    await flush()

    expect(createFile).toHaveBeenCalledTimes(1)
    const { path, content } = created(0)
    expect(path).toBe('/vault/stages/Expansion.md') // parked per the settings (🔒 Q5)
    expect(content).toContain('folder_pages:\n  - "[[Funnel Stages]]"')
    expect(content).not.toContain('folder_page:') // an ORDINARY page
    expect(onOpenFile).not.toHaveBeenCalled() // we stay in the outline
  })

  it('a name an existing page already carries gets no create row — only the pick', () => {
    const el = mount()
    focusAdd(el, 'KPIs')
    expect(picks(el)).toEqual(['KPIs'])

    // …including a name that belongs to a MEMBER, who is excluded from the picker: offering to
    // "create" it would collide with a file that plainly exists.
    setValue(addInput(el), 'Sales')
    expect(picks(el)).toEqual([])
  })
})

// ---------- remove (🔒 the confirm-sheet idiom) ----------

describe('the confirm copy is a pure function', () => {
  it('names where the page still lives', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', ['KPIs', 'Roadmap'])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It remains in: KPIs, Roadmap.",
    )
  })

  it('names Uncategorized when this was its last folder page', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', [])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It has no other folder pages, so it moves to Uncategorized.",
    )
  })
})

describe('the hover × removes the membership, and only after the sheet', () => {
  it('the × opens the sheet — it never removes on the click itself', () => {
    const el = mount()
    click(byLabel(el, 'Remove Nurture from Funnel Stages'))
    expect(q(document.body, '[role="dialog"]').textContent).toContain('It remains in: KPIs.')
    expect(write).not.toHaveBeenCalled()
  })

  it('Cancel writes nothing at all', () => {
    const el = mount()
    click(byLabel(el, 'Remove Lead Gen from Funnel Stages'))
    click(all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === 'Cancel')!)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('Confirm removes ONLY this folder page’s entry, on the member’s own card', () => {
    const el = mount()
    click(byLabel(el, 'Remove Nurture from Funnel Stages'))
    click(all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === 'Remove')!)
    expect(write).toHaveBeenCalledExactlyOnceWith(NURTURE, 'folder_pages', ['[[KPIs]]'])
  })

  it('the last folder page leaves an empty list, and the copy said so', () => {
    const el = mount()
    click(byLabel(el, 'Remove Lead Gen from Funnel Stages'))
    expect(q(document.body, '[role="dialog"]').textContent).toContain('it moves to Uncategorized')
    click(all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === 'Remove')!)
    expect(write).toHaveBeenCalledExactlyOnceWith(LEAD, 'folder_pages', [])
  })

  it('an entry that merely SPELLS the folder page is not a link, and is left alone', () => {
    const el = mount(
      FUNNELS,
      vault().map((r) => (r.path === LEAD ? rec(LEAD, { folder_pages: ['Funnel Stages', '[[Funnel Stages]]'] }) : r)),
    )
    click(byLabel(el, 'Remove Lead Gen from Funnel Stages'))
    click(all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === 'Remove')!)
    expect(write).toHaveBeenCalledExactlyOnceWith(LEAD, 'folder_pages', ['Funnel Stages'])
  })

  it('a failed write is reported in place and never takes the block down', async () => {
    write.mockRejectedValue(new Error('read-only vault'))
    const el = mount()
    click(byLabel(el, 'Remove Lead Gen from Funnel Stages'))
    click(all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === 'Remove')!)
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('read-only vault')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Nurture', 'Sales'])
  })
})
