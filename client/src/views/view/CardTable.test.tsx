/**
 * YAZ-5349 follow-up (Yaseen, 2026-11-14 23:49): "if I have Show rows as cards, and then I add a column. Shouldn't it
 * add that column to the cards and not the page?" A table that shows cards as rows is a table OF CARDS: every table
 * action acts on the cards — the view's card columns and the cards' lines — and none reaches the Pages table, the
 * folder's page columns or a page's front matter. ViewsPane mounted with react-dom in jsdom, as `CardRows.test.tsx`;
 * the page host's column doors throw if they are reached (`testFolderHost`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { formatCardLine, parseCardLine } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { createWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import '../views.css'

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
vi.mock('../../review/useReviewSettings', () => ({ useVaultReviewSettings: () => DEFAULT_REVIEW_SETTINGS }))
vi.mock('../../review/cardFile', () => ({ changeCardLine: vi.fn(async () => undefined) }))
vi.mock('../../review/newCardFile', () => ({ createCardFile: vi.fn(async (dir: string) => `${dir}/GEO-9.md`) }))
vi.mock('../../editor/card/cardOpen', () => ({ landOnCard: vi.fn() }))
import { changeCardLine } from '../../review/cardFile'
import { createCardFile } from '../../review/newCardFile'
import { writeProperties, writeProperty } from '../writeProperty'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TRIP = '/vault/Geo/Europe trip.md'
const record = (name: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  path: `/vault/Geo/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Geo', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: { status: 'draft' }, aliases: [], tags: [], links: [], embeds: [], ...over,
})
const RECORDS = [
  record('Europe trip', { cards: [{ id: 'GEO-1', title: 'Capital of Spain', off: false, next: false, reviews: [], properties: { level: 'A2' } }, { id: 'GEO-2', title: 'Longest river', off: false, next: false, reviews: [] }] }),
]
/** A table that lists cards, its pages' table already set: two columns, a sort, a width. */
const VIEW = 'views:\n  - type: table\n    name: T\n    rows: cards\n    order: [file.name, note.status]\n    sort:\n      - property: note.status\n        direction: ASC\n    columnSize:\n      file.name: 300\n'
const CARD_HEADERS = ['Name', 'Page', 'Card status', 'Card next review', 'Card last review', 'Card reviews', 'Card success rate', 'Card up next', 'Card ID', 'Level']

let root: Root | null = null
let container: HTMLElement | null = null
let redraw: () => void = () => undefined

function mount(text = VIEW) {
  let parsed = parseViews(text)
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update(null, [], [], true)
  const onOpenFile = vi.fn()
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
          folderPath="/vault/Geo"
          records={RECORDS}
          folder={testFolderHost({ wikilinks, vaultRecords: RECORDS, onNotice: vi.fn() })}
          onOpenFile={onOpenFile}
        />,
      ),
    )
  redraw = draw
  draw()
  return { el: container, onOpenFile, yaml: () => serializeViews(parsed), def: () => parsed.def }
}

beforeEach(() => {
  vi.mocked(changeCardLine).mockClear()
  vi.mocked(createCardFile).mockClear()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  // A page's front matter is never written by the Cards table.
  expect(writeProperty).not.toHaveBeenCalled()
  expect(writeProperties).not.toHaveBeenCalled()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element): void => {
  act(() => (el as HTMLElement).click())
  redraw()
}
const rightClick = (el: EventTarget): void => {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
  redraw()
}
/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
const setValue = (el: HTMLInputElement, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  redraw()
}
const press = (el: Element, key: string): void => {
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  redraw()
}
const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent ?? '')
const th = (el: ParentNode, label: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')].find((t) => t.textContent === label)!
const item = (el: ParentNode, text: string): HTMLElement => {
  const n = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === text)
  if (n === undefined) throw new Error(`missing menu item ${text}`)
  return n
}
const columnsPanel = (el: ParentNode): HTMLElement => {
  if (el.querySelector('.view-popover--properties') === null) click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
  return q(el, '.view-popover--properties')
}
const showAs = (el: ParentNode, rows: 'Pages' | 'Cards'): void => {
  const panel = columnsPanel(el)
  click(q(panel, '.view-menu__tab[data-tab="view"]'))
  click([...q(panel, '[aria-label="Show cards as rows"]').querySelectorAll('button')].find((b) => b.textContent === rows)!)
  press(document.activeElement ?? document.body, 'Escape')
}
const addColumn = (scope: ParentNode, name: string): void => {
  setValue(q<HTMLInputElement>(scope, 'input[aria-label="Column name"]'), name)
  click(q(scope, '[aria-label="Save column"]'))
}

describe('YAZ-5349 follow-up: a Cards table acts on the cards, never on the pages', () => {
  it('"+ Add column" in Columns adds a card column: the Cards table shows it, the Pages table does not, and no page column is declared', () => {
    const { el, def } = mount()
    expect(headers(el)).toEqual(CARD_HEADERS)
    const panel = columnsPanel(el)
    click([...panel.querySelectorAll('button')].find((b) => b.textContent === '+ Add column')!)
    addColumn(panel, 'Topic')
    expect(headers(el)).toEqual([...CARD_HEADERS, 'Topic'])
    const view = def().views[0]
    expect(view.cardView).toMatchObject({ columns: { Topic: { kind: 'text' } }, order: [...CARD_HEADERS.map(() => expect.any(String)), 'note.Topic'] })
    // The pages' table is as it was.
    expect(view.order).toEqual(['file.name', 'note.status'])
    showAs(el, 'Pages')
    expect(headers(el)).toEqual(['Name', 'Status'])
    showAs(el, 'Cards')
    expect(headers(el)).toEqual([...CARD_HEADERS, 'Topic'])
  })

  it('"Add column to the right…" puts the card column right after the one clicked', () => {
    const { el, def } = mount()
    rightClick(th(el, 'Card status'))
    click(item(el, 'Add column to the right…'))
    addColumn(q(el, '.ctx-menu'), 'Due')
    expect(headers(el).slice(2, 4)).toEqual(['Card status', 'Due'])
    expect(def().views[0].cardView?.columns).toEqual({ Due: { kind: 'text' } })
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
  })

  it('a new card column\'s cell edit writes that card\'s line', async () => {
    const { el } = mount()
    rightClick(th(el, 'Level'))
    click(item(el, 'Add column to the right…'))
    addColumn(q(el, '.ctx-menu'), 'Topic')
    const at = headers(el).indexOf('Topic')
    const cell = q<HTMLElement>(el, `[data-cell="0:${at}"]`)
    act(() => {
      cell.click()
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const input = q<HTMLInputElement>(cell, 'input, textarea')
    setValue(input, 'Art, history')
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id]).toEqual([TRIP, 'GEO-1'])
    expect(formatCardLine(change(parseCardLine('<!-- card: GEO-1, level "A2" -->')!))).toBe('<!-- card: GEO-1, level "A2", Topic "Art&#44; history" -->')
  })

  it('a rename is the Cards table\'s label: the Pages table\'s Name stays "Name"', () => {
    const { el, def } = mount()
    rightClick(th(el, 'Name'))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Name"]')
    setValue(field, 'Card')
    press(field, 'Enter')
    expect(headers(el)[0]).toBe('Card')
    expect(def().properties).toBeUndefined()
    showAs(el, 'Pages')
    expect(headers(el)[0]).toBe('Name')
  })

  it('hide and sort are the Cards table\'s: the pages\' order and sort stay', () => {
    const { el, def } = mount()
    rightClick(th(el, 'Card ID'))
    click(item(el, 'Hide column'))
    expect(headers(el)).not.toContain('Card ID')
    rightClick(th(el, 'Level'))
    click(item(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitem"]')].find((b) => b.textContent === 'Z to A')!)
    const view = def().views[0]
    expect(view.cardView?.sort).toEqual([{ property: 'note.level', direction: 'DESC' }])
    expect(view.cardView?.order).not.toContain('card.id')
    expect(view.order).toEqual(['file.name', 'note.status'])
    expect(view.sort).toEqual([{ property: 'note.status', direction: 'ASC' }])
    expect(view.columnSize).toEqual({ 'file.name': 300 })
  })

  it('the Columns panel lists the cards\' properties as this table\'s own columns, never under "Other properties in these pages"', () => {
    const { el } = mount()
    rightClick(th(el, 'Level'))
    click(item(el, 'Hide column'))
    const panel = columnsPanel(el)
    expect(panel.textContent).not.toContain('Other properties')
    expect(panel.textContent).toContain('Level')
    expect(panel.textContent).not.toContain('Status')
  })

  it('"+ New" makes a card file in the folder and opens it', async () => {
    const { el, onOpenFile } = mount()
    await act(async () => void q<HTMLElement>(el, '.view-toolbar__new').click())
    expect(createCardFile).toHaveBeenCalledOnce()
    expect(vi.mocked(createCardFile).mock.calls[0].slice(0, 2)).toEqual(['/vault/Geo', 'Title'])
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Geo/GEO-9.md')
  })
})
