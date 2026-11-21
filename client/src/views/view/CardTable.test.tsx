/**
 * YAZ-5349 follow-up (Yaseen, 2026-11-14 23:49): "if I have Show rows as cards, and then I add a column. Shouldn't it
 * add that column to the cards and not the page?" A table that shows cards as rows is a table OF CARDS: every table
 * action acts on the cards — the view's card columns and the cards' lines — and none reaches the Pages table, the
 * folder's page columns or a page's front matter. ViewsPane mounted with react-dom in jsdom, as `CardRows.test.tsx`;
 * the page host's column doors throw if they are reached (`testFolderHost`). YAZ-5793: the switch is gone; a Card table
 * is made from "+" › Card table, beside the folder's Pages table, and shows seven card columns by default.
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
/** The Pages table alone, two columns: the Card table is added beside it ("+" › Card table, YAZ-5793). */
const PAGES = 'views:\n  - type: table\n    name: T\n    order: [file.name, note.status]\n'
/** VIEW, showing the columns a Card table hides by default that a cell edits: Fix status and Up next status. */
const VIEW_EDITS = `${VIEW}    cardView:\n      order: [file.name, card.status, card.fix, card.upNext, note.level]\n`
const CARD_HEADERS = ['Title', 'Status', 'Next review date', 'Wait time', 'Times forgotten', 'Recall chance', 'Last review date', 'Level']

let root: Root | null = null
let container: HTMLElement | null = null
let redraw: () => void = () => undefined

/** The folder page's Read only as the views see it (YAZ-5411): a test answers the box with `answer`. */
interface LockedVault {
  on: boolean
  answer: boolean
  /** Pages with their own switch: never opened by the box. */
  own: Set<string>
  ask: ReturnType<typeof vi.fn>
}
function lockedVault(answer: boolean, own: string[] = []): LockedVault {
  const state: LockedVault = { on: true, answer, own: new Set(own), ask: vi.fn() }
  state.ask.mockImplementation(async () => {
    if (!state.answer) return false
    state.on = false
    redraw()
    return true
  })
  return state
}

function mount(text = VIEW, vault?: LockedVault, allowFileAction?: () => Promise<boolean>) {
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
          readOnly={vault === undefined ? undefined : vault.on ? new Set([...RECORDS.map((r) => r.path), ...vault.own]) : vault.own}
          folder={testFolderHost({
            wikilinks,
            vaultRecords: RECORDS,
            onNotice: vi.fn(),
            ...(allowFileAction && { allowFileAction }),
            ...(vault && { editLock: { locked: (page?: string) => vault.on && (page === undefined || !vault.own.has(page)), ask: () => vault.ask() } }),
          })}
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
/** "+" › Card table (YAZ-5793): the new tab opens in rename, which Escape leaves as "Card table"; it is the open view. */
const addCardTable = (el: ParentNode): void => {
  click(q(el, '[aria-label="Add view"]'))
  click(item(q(el, '.view-popover--menu'), 'Card table'))
  press(q(el, '[aria-label="View name"]'), 'Escape')
}
/** Open the view whose tab says `name`: the Pages table ("T") or the Card table. */
const openTab = (el: ParentNode, name: string): void => click([...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!)
const addColumn = (scope: ParentNode, name: string): void => {
  setValue(q<HTMLInputElement>(scope, 'input[aria-label="Column name"]'), name)
  click(q(scope, '[aria-label="Save column"]'))
}

describe('YAZ-5349 follow-up: a Cards table acts on the cards, never on the pages', () => {
  it('"+ Add column" in Columns adds a card column: the Card table shows it, the Pages table does not, and no page column is declared', () => {
    const { el, def } = mount(PAGES)
    addCardTable(el)
    expect(headers(el)).toEqual(CARD_HEADERS)
    const panel = columnsPanel(el)
    click([...panel.querySelectorAll('button')].find((b) => b.textContent === '+ Add column')!)
    addColumn(panel, 'Topic')
    expect(headers(el)).toEqual([...CARD_HEADERS, 'Topic'])
    const view = def().views[1]
    expect(view.cardView).toMatchObject({ columns: { Topic: { kind: 'text' } }, order: [...CARD_HEADERS.map(() => expect.any(String)), 'note.Topic'] })
    // The Card table holds no pages' table; the Pages table is as it was.
    expect(view.order).toBeUndefined()
    expect(def().views[0]).toEqual({ type: 'table', name: 'T', order: ['file.name', 'note.status'] })
    press(document.activeElement ?? document.body, 'Escape')
    openTab(el, 'T')
    expect(headers(el)).toEqual(['Name', 'Status'])
    openTab(el, 'Card table')
    expect(headers(el)).toEqual([...CARD_HEADERS, 'Topic'])
  })

  it('"Add column to the right…" puts the card column right after the one clicked', () => {
    const { el, def } = mount()
    rightClick(th(el, 'Status'))
    click(item(el, 'Add column to the right…'))
    addColumn(q(el, '.ctx-menu'), 'Due')
    expect(headers(el).slice(1, 3)).toEqual(['Status', 'Due'])
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

  it('a rename is the Card table\'s label: the Pages table\'s Name stays "Name" (YAZ-5793: the Card table\'s is "Title")', () => {
    const { el, def } = mount(PAGES)
    addCardTable(el)
    rightClick(th(el, 'Title'))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Title"]')
    setValue(field, 'Card')
    press(field, 'Enter')
    expect(headers(el)[0]).toBe('Card')
    expect(def().properties).toBeUndefined()
    expect(def().views[1].cardView?.properties).toEqual({ 'file.name': { displayName: 'Card' } })
    openTab(el, 'T')
    expect(headers(el)[0]).toBe('Name')
  })

  it('hide and sort are the Cards table\'s: the pages\' order and sort stay', () => {
    const { el, def } = mount()
    rightClick(th(el, 'Last review date'))
    click(item(el, 'Hide column'))
    expect(headers(el)).not.toContain('Last review date')
    rightClick(th(el, 'Level'))
    click(item(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitem"]')].find((b) => b.textContent === 'Z to A')!)
    const view = def().views[0]
    expect(view.cardView?.sort).toEqual([{ property: 'note.level', direction: 'DESC' }])
    expect(view.cardView?.order).not.toContain('card.lastReview')
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
    // The pages' `status` is no row: only the card column Status (YAZ-5793), never "Status (card property)".
    expect([...panel.querySelectorAll('[aria-label^="Open "]')].filter((b) => b.getAttribute('aria-label')?.startsWith('Open Status'))).toHaveLength(1)
    expect(panel.textContent).not.toContain('(card property)')
  })

  it('YAZ-5793: Columns ⚙ offers the hidden card columns, each with its switch off', () => {
    const { el } = mount()
    const panel = columnsPanel(el)
    for (const label of ['Days overdue', 'Up next status', 'Fix status', 'Reviews', 'Success rate', 'Page', 'ID', 'File name']) {
      const toggle = panel.querySelector<HTMLInputElement>(`input[aria-label="Show ${label}"]`)
      expect(toggle, label).not.toBeNull()
      expect(toggle!.checked).toBe(false)
    }
    for (const label of CARD_HEADERS) expect(panel.querySelector<HTMLInputElement>(`input[aria-label="Show ${label}"]`)?.checked, label).toBe(true)
  })

  it('"+ New" makes a card file in the folder and opens it', async () => {
    const { el, onOpenFile } = mount()
    await act(async () => void q<HTMLElement>(el, '.view-toolbar__new').click())
    expect(createCardFile).toHaveBeenCalledOnce()
    expect(vi.mocked(createCardFile).mock.calls[0].slice(0, 2)).toEqual(['/vault/Geo', 'Title'])
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Geo/GEO-9.md')
  })
})

/**
 * YAZ-5411: the Cards table's changes in a Read only vault ask the folder page's "Allow edits?" first, as the Pages
 * table's do — through the one guard (`editGuard.ts`) — before any sheet or write. Allow: it goes on. Cancel: nothing.
 */
describe('YAZ-5411: a Cards table in a Read only vault asks "Allow edits?" first', () => {
  const flush = async () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  const cellOf = (el: ParentNode, label: string): HTMLElement => q<HTMLElement>(el, `[data-cell="0:${headers(el).indexOf(label)}"]`)

  it('Add column: Cancel adds nothing; Allow adds the card column with no second Save', async () => {
    const vault = lockedVault(false)
    const { el, def } = mount(VIEW, vault)
    rightClick(th(el, 'Level'))
    click(item(el, 'Add column to the right…'))
    addColumn(q(el, '.ctx-menu'), 'Due')
    await flush()
    expect(vault.ask).toHaveBeenCalledOnce()
    expect(def().views[0].cardView?.columns).toBeUndefined()
    vault.answer = true
    rightClick(th(el, 'Level'))
    click(item(el, 'Add column to the right…'))
    addColumn(q(el, '.ctx-menu'), 'Due')
    await flush()
    expect(def().views[0].cardView?.columns).toEqual({ Due: { kind: 'text' } })
  })

  it('Delete column: the ask comes before the sheet; Cancel opens no sheet and clears no card; Allow opens it and its Delete clears the cards', async () => {
    const vault = lockedVault(false)
    const { el } = mount(VIEW, vault)
    rightClick(th(el, 'Level'))
    click(item(el, 'Delete column…'))
    await flush()
    expect(vault.ask).toHaveBeenCalledOnce()
    expect(document.querySelector('.confirm')).toBeNull()
    expect(changeCardLine).not.toHaveBeenCalled()
    vault.answer = true
    rightClick(th(el, 'Level'))
    click(item(el, 'Delete column…'))
    await flush()
    expect(document.querySelector('.confirm')).not.toBeNull()
    click(q(document, '.confirm__btn--danger'))
    await flush()
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [, id, change] = vi.mocked(changeCardLine).mock.calls[0]
    expect(id).toBe('GEO-1')
    expect(formatCardLine(change(parseCardLine('<!-- card: GEO-1, level "A2" -->')!))).toBe('<!-- card: GEO-1 -->')
  })

  it('a card cell (Level): a double-click asks; Cancel opens nothing; Allow opens the editor and the card line is written', async () => {
    const vault = lockedVault(false)
    const { el } = mount(VIEW, vault)
    act(() => void cellOf(el, 'Level').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(vault.ask).toHaveBeenCalledOnce()
    expect(cellOf(el, 'Level').querySelector('input, textarea')).toBeNull()
    vault.answer = true
    act(() => void cellOf(el, 'Level').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    const input = q<HTMLInputElement>(cellOf(el, 'Level'), 'input, textarea')
    setValue(input, 'B1')
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await flush()
    const go = document.querySelector<HTMLButtonElement>('.change-ask__go')
    if (go !== null) click(go)
    await flush()
    expect(changeCardLine).toHaveBeenCalledOnce()
    expect(vi.mocked(changeCardLine).mock.calls[0].slice(0, 2)).toEqual([TRIP, 'GEO-1'])
  })

  it('Status and Up next status: Enter on the locked cell asks first; Cancel writes nothing', async () => {
    const vault = lockedVault(false)
    const { el } = mount(VIEW_EDITS, vault)
    for (const label of ['Status', 'Up next status']) {
      press(cellOf(el, label), 'Enter')
      await flush()
    }
    expect(vault.ask).toHaveBeenCalledTimes(2)
    expect(changeCardLine).not.toHaveBeenCalled()
  })

  it('YAZ-5430: Fix status asks first too: Cancel writes nothing; Allow opens its Select and Needs fixing writes `fix`', async () => {
    const vault = lockedVault(false)
    const { el } = mount(VIEW_EDITS, vault)
    act(() => void cellOf(el, 'Fix status').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(vault.ask).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="option"]')).toBeNull()
    expect(changeCardLine).not.toHaveBeenCalled()
    vault.answer = true
    act(() => void cellOf(el, 'Fix status').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.startsWith('Needs fixing'))!
    await act(async () => void option.click())
    await flush()
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id]).toEqual([TRIP, 'GEO-1'])
    expect(formatCardLine(change(parseCardLine('<!-- card: GEO-1, title "Capital of Spain", level "A2" -->')!))).toBe('<!-- card: GEO-1, title "Capital of Spain", level "A2", fix -->')
  })

  it('"+ New": the vault\'s file-action ask comes first; refused, no card file and no error line', async () => {
    const allow = vi.fn(async () => false)
    const { el } = mount(VIEW, lockedVault(false), allow)
    await act(async () => void q<HTMLElement>(el, '.view-toolbar__new').click())
    await flush()
    expect(allow).toHaveBeenCalledOnce()
    expect(createCardFile).not.toHaveBeenCalled()
    expect(el.querySelector('.views-pane__error')).toBeNull()
  })

  it('nearby: a card inside a page with its own Read only switch never asks — its cell keeps the tip and writes nothing', async () => {
    const vault = lockedVault(true, [TRIP])
    vault.on = false
    const { el } = mount(VIEW, vault)
    act(() => void cellOf(el, 'Level').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(vault.ask).not.toHaveBeenCalled()
    expect(cellOf(el, 'Level').querySelector('input, textarea')).toBeNull()
    expect(cellOf(el, 'Level').querySelector('[title]')?.getAttribute('title')).toMatch(/read only/i)
  })

  it('a view change of the Cards table (a hide, a sort) never asks', async () => {
    const vault = lockedVault(false)
    const { el, def } = mount(VIEW, vault)
    rightClick(th(el, 'Last review date'))
    click(item(el, 'Hide column'))
    rightClick(th(el, 'Level'))
    click(item(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitem"]')].find((b) => b.textContent === 'Z to A')!)
    await flush()
    expect(vault.ask).not.toHaveBeenCalled()
    expect(def().views[0].cardView?.sort).toEqual([{ property: 'note.level', direction: 'DESC' }])
  })
})
