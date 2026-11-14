/**
 * Where a page's columns come from (YAZ-4713): Columns ⚙ parts its hidden columns into the folder's own ("Desserts"),
 * "From <owner>" and "Other properties in these pages" (C4), with Show and "Add to Desserts" on an other property; and
 * Edit column's "Separate value for Desserts" switch with its turn-off ask (C3, 1B). ViewsPane mounted with react-dom in
 * jsdom over `TEST_RECORDS`, with the folder host's doors as spies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import type { FolderHost } from '../ViewsPane'
import type { ColumnDecl } from '../folderSettings'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const STATUS: ColumnDecl = { kind: 'select', options: ['idea', 'published'] }
const PILLAR: ColumnDecl = { kind: 'text' }
/** Schema's `.folder.md`, so the owner reads by its title. */
const SCHEMA: IndexRecord = { ...TEST_RECORDS[0], path: '/vault/schema/.folder.md', name: '.folder.md', title: 'Schema', folder: 'schema', properties: {} }

/** The page shows Name alone; `status` is this folder's own column, `pillar` comes from Schema. */
function mount(over: Partial<FolderHost> = {}, status: ColumnDecl = STATUS) {
  let parsed = parseViews('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
  const columns = { status, pillar: PILLAR }
  const folder = testFolderHost({
    settings: { columns, views: [], problems: [] },
    columns: { status: { decl: status, owner: '' }, pillar: { decl: PILLAR, owner: 'schema' } },
    vaultFolders: [SCHEMA],
    // This page is Desserts (the copy names the folder, YAZ-4713 1B); Pillar comes from Schema (C6).
    sources: { ...testFolderHost().sources, folderName: 'Desserts', of: (key) => (key === 'pillar' ? { from: 'Schema' } : {}) },
    ...over,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={(next: ParsedViews) => {
            parsed = next
            draw()
          }}
          root="/vault"
          folderPath="/vault"
          records={TEST_RECORDS}
          folder={folder}
          onOpenFile={vi.fn()}
        />,
      ),
    )
  draw()
  return { el: container, yaml: () => serializeViews(parsed) }
}

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const byLabel = (el: ParentNode, label: string): HTMLElement => q(el, `[aria-label="${label}"]`)
const openColumns = (el: ParentNode): HTMLElement => {
  click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
  return q(el, '.view-popover--properties')
}
/** Each hidden part's title → the labels of its rows. */
const parts = (pop: ParentNode): Record<string, string[]> =>
  Object.fromEntries(
    [...pop.querySelectorAll('.column-section__part')].map((part) => [
      part.querySelector('.column-section__part-title')?.textContent ?? '',
      [...part.querySelectorAll('.view-prop__name')].map((n) => n.textContent ?? ''),
    ]),
  )

describe('Columns ⚙: where each hidden column comes from (YAZ-4713 C4)', () => {
  it('the folder’s own (by its name), From <owner>, then the pages’ other fields', () => {
    const pop = openColumns(mount().el)
    expect(parts(pop)).toEqual({
      Desserts: ['Status', 'File name', 'Folder'],
      'From Schema': ['Pillar'],
      'Other properties in these pages': ['Cover', 'Date', 'Priority', 'Published', 'Related', 'Tags', 'Views'],
    })
    // An other property has Show and "Add to Desserts" in place of the switch.
    expect(pop.querySelector('[aria-label="Show Tags"]')?.tagName).toBe('BUTTON')
    expect(pop.querySelector('[aria-label="Add Tags to Desserts"]')?.textContent).toBe('Add to Desserts')
  })

  it('Show adds the field to this view only; nothing is declared', () => {
    const setColumns = vi.fn()
    const { el, yaml } = mount({ setColumns })
    click(byLabel(openColumns(el), 'Show Tags'))
    // It asks first (YAZ-4764, C4A); the answer's Show writes.
    expect(yaml()).not.toContain('- note.tags')
    click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Show')!)
    expect(yaml()).toContain('- note.tags')
    expect(setColumns).not.toHaveBeenCalled()
  })

  it('"Add to Desserts" declares it on this folder, beside the page’s columns, and shows it, in one write', () => {
    const setColumns = vi.fn()
    const { el } = mount({ setColumns })
    click(byLabel(openColumns(el), 'Add Tags to Desserts'))
    // It asks first (YAZ-4764, C4A); the answer's "Add to Desserts" writes.
    expect(setColumns).not.toHaveBeenCalled()
    click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Add to Desserts')!)
    expect(setColumns).toHaveBeenCalledOnce()
    const [columns, views] = setColumns.mock.calls[0]
    expect(Object.keys(columns)).toEqual(['status', 'pillar', 'tags'])
    expect(views[0].order).toEqual(['file.name', 'note.tags'])
  })

  it('the CSS (7A 18): the mark and the folder name clip on the row’s one line; Show keeps its size, "Add to <folder>" shrinks with "…"', () => {
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    expect(rule('.view-prop__open .view-prop__name')).toMatch(/flex-wrap:\s*nowrap/)
    expect(rule('.view-column-mark')).toMatch(/white-space:\s*nowrap/)
    const mark = rule('.view-prop__name .view-column-mark')
    expect(mark).toMatch(/min-width:\s*0/)
    expect(mark).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.view-prop__identity > .view-menu__action')).toMatch(/flex:\s*none[^}]*white-space:\s*nowrap/)
    const add = rule('.view-prop__identity > .view-menu__action.view-prop__add')
    expect(add).toMatch(/flex:\s*0 1 auto/)
    expect(add).toMatch(/min-width:\s*0/)
    expect(add).toMatch(/text-overflow:\s*ellipsis/)
    // The header cell clips its content and never grows: a fixed table layout, one line, hidden overflow.
    expect(rule('.view-table th,\n.view-table td')).toMatch(/overflow:\s*hidden[^}]*white-space:\s*nowrap/)
  })
})

describe('Edit column › "Separate value for <folder>" (YAZ-4713 C3, 1B)', () => {
  const openDetail = (el: ParentNode): HTMLElement => {
    click(byLabel(openColumns(el), 'Open Status'))
    return q(el, '.column-detail')
  }
  const switchOf = (detail: ParentNode): HTMLInputElement => byLabel(detail, 'Status: separate value for Desserts') as HTMLInputElement

  it('is not offered where the vault does not use IDs (the host has no door)', () => {
    expect(openDetail(mount().el).querySelector('[aria-label="Status: separate value for Desserts"]')).toBeNull()
  })

  it('on: at once, no ask, and nothing in the pages moves', async () => {
    const set = vi.fn(async () => undefined)
    const counts = vi.fn()
    const detail = openDetail(mount({ separate: { counts, set } }).el)
    expect(switchOf(detail).checked).toBe(false)
    await act(async () => switchOf(detail).click())
    expect(set).toHaveBeenCalledExactlyOnceWith('status', STATUS, true, 'pages')
    expect(counts).not.toHaveBeenCalled()
  })

  it('off asks first, with the numbers and a warning when values differ; each answer reaches the door', async () => {
    const set = vi.fn(async () => undefined)
    const separate = { ...STATUS, separate: true as const }
    const { el } = mount({ separate: { counts: () => ({ total: 12, fill: 9, differ: 3 }), set } }, separate)
    const detail = openDetail(el)
    expect(switchOf(detail).checked).toBe(true)
    act(() => switchOf(detail).click())
    expect(q(el, '.confirm__text').textContent).toBe("12 pages have a Desserts value. 9 fill an empty page field or match it. 3 differ from the page's value.")
    expect(q(el, '.confirm__status--error').textContent).toContain('only one stays')
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Use the Desserts values', 'Cancel', "Keep the pages' values"])
    await act(async () => click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Use the Desserts values')!))
    expect(set).toHaveBeenCalledExactlyOnceWith('status', separate, false, 'page')
    expect(el.querySelector('.confirm__text')).toBeNull()
  })

  it('off with no page value: no ask; Cancel on an ask changes nothing', async () => {
    const set = vi.fn(async () => undefined)
    const separate = { ...STATUS, separate: true as const }
    let total = 0
    const { el } = mount({ separate: { counts: () => ({ total, fill: total, differ: 0 }), set } }, separate)
    const detail = openDetail(el)
    await act(async () => switchOf(detail).click())
    expect(set).toHaveBeenCalledExactlyOnceWith('status', separate, false, 'pages')
    total = 2
    act(() => switchOf(detail).click())
    expect(el.querySelector('.confirm__status--error')).toBeNull() // nothing differs: no warning
    click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!)
    expect(set).toHaveBeenCalledOnce()
  })
})

describe('Edit column on a column from a parent folder (YAZ-4713 C6, C7)', () => {
  const openDetail = (el: ParentNode, label: string): HTMLElement => {
    click(byLabel(openColumns(el), `Open ${label}`))
    return q(el, '.column-detail')
  }

  // YAZ-4769 demo: "Change on Orders only" and "Changed on Orders only · Use Schema's" became one row, Settings [Shared | Only here],
  // with one line under it; Shared again asks first.
  const settingsOf = (detail: ParentNode, label: string) => [...byLabel(detail, `Settings of ${label}`).querySelectorAll<HTMLButtonElement>('button')]
  const pressed = (detail: ParentNode, label: string) => settingsOf(detail, label).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)

  it('names the owner; "Only here" declares it here; Delete is not offered', async () => {
    const here = vi.fn(async () => undefined)
    const { el } = mount({ sources: { ...testFolderHost().sources, folderName: 'Orders', of: (key) => (key === 'pillar' ? { from: 'Schema' } : {}), here } })
    const detail = openDetail(el, 'Pillar')
    expect(pressed(detail, 'Pillar')).toEqual(['Shared'])
    expect(q(detail, '.column-detail__source').textContent).toBe('Shared with Schema: a change here changes it on every page under Schema. Each page keeps one value.')
    expect(detail.querySelector('[aria-label="Delete column Pillar"]')).toBeNull()
    await act(async () => click(settingsOf(detail, 'Pillar').find((b) => b.textContent === 'Only here')!))
    expect(here).toHaveBeenCalledExactlyOnceWith('pillar')
  })

  it('this folder\'s own over a parent\'s: "Shared" asks, then removes the override; own columns keep Delete', async () => {
    const useParent = vi.fn(async () => undefined)
    const { el } = mount({ sources: { ...testFolderHost().sources, folderName: 'Orders', of: (key) => (key === 'status' ? { over: 'Schema' } : {}), useParent } })
    const detail = openDetail(el, 'Status')
    expect(pressed(detail, 'Status')).toEqual(['Only here'])
    expect(q(detail, '.column-detail__source').textContent).toBe('Only on Orders: its own type, options and description (Schema keeps the shared ones). Each page keeps one value.')
    expect(detail.querySelector('[aria-label="Delete column Status"]')).toBeNull()
    click(settingsOf(detail, 'Status').find((b) => b.textContent === 'Shared')!)
    expect(useParent).not.toHaveBeenCalled()
    expect(q(el, '.confirm__text').textContent).toBe('Share the settings of "Status" with Schema again? The own type, options and description on Orders go. The pages keep their values.')
    await act(async () => click([...el.querySelectorAll<HTMLElement>('.confirm__btn')].find((b) => b.textContent === 'Share again')!))
    expect(useParent).toHaveBeenCalledExactlyOnceWith('status')
  })

  it('a separate column over a parent’s: "Shared" asks nothing and writes nothing, and the line says why (7A 24)', () => {
    const useParent = vi.fn(async () => undefined)
    const { el } = mount({ sources: { ...testFolderHost().sources, folderName: 'Orders', of: (key) => (key === 'status' ? { over: 'Schema' } : {}), useParent } }, { ...STATUS, separate: true })
    const detail = openDetail(el, 'Status')
    click(settingsOf(detail, 'Status').find((b) => b.textContent === 'Shared')!)
    expect(el.querySelector('.confirm__text')).toBeNull()
    expect(useParent).not.toHaveBeenCalled()
    expect(q(detail, '[role="alert"]').textContent).toBe('Turn off Separate value for Orders first.')
  })
})
