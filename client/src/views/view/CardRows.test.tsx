/**
 * YAZ-5319: a folder page's table that lists cards; YAZ-5793: the Card table, made from "+" › Card table (the old
 * View › "Show cards as rows" switch is gone). ViewsPane mounted with react-dom in jsdom: Card table is offered only
 * while the vault has Cards and IDs on, and with either off a Card table says so and lists nothing. A row per card with
 * its Page, which opens the page landed on the card; Status, Fix status and Up next status edit the card's line
 * (`changeCardLine`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CardLine } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { createWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import '../views.css'

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
let cardSettings: ReviewSettings | undefined = DEFAULT_REVIEW_SETTINGS
vi.mock('../../review/useReviewSettings', () => ({ useVaultReviewSettings: () => cardSettings }))
vi.mock('../../review/cardFile', () => ({ changeCardLine: vi.fn(async () => undefined) }))
vi.mock('../../editor/card/cardOpen', () => ({ landOnCard: vi.fn() }))
import { changeCardLine } from '../../review/cardFile'
import { landOnCard } from '../../editor/card/cardOpen'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TRIP = '/vault/Geo/Europe trip.md'
const record = (name: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  path: `/vault/Geo/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Geo', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: { status: 'draft' }, aliases: [], tags: [], links: [], embeds: [], ...over,
})
const RECORDS = [
  record('Europe trip', { cards: [{ id: 'GEO-1', title: 'Capital of Spain', off: true, next: false, reviews: [] }, { id: 'GEO-2', off: false, next: false, reviews: [] }] }),
  record('GEO-3', { kind: 'card', title: 'Longest river', cards: [{ id: 'GEO-3', title: 'Longest river', off: false, next: false, reviews: [], fix: true }] }),
]
const CARDS_VIEW = 'views:\n  - type: table\n    name: T\n    rows: cards\n'
const PAGES_VIEW = 'views:\n  - type: table\n    name: T\n'
/** A Card table that shows the columns YAZ-5793 hides by default too: Page, Fix status, Reviews, Success rate, Up next status, ID. */
const FULL_VIEW = `${CARDS_VIEW}    cardView:\n      order: [file.name, card.page, card.status, card.fix, card.nextReview, card.lastReview, card.reviews, card.successRate, card.upNext, card.id]\n`

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, ids = true) {
  let parsed = parseViews(text)
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update(null, [], [], ids)
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
          folder={testFolderHost({ wikilinks, vaultRecords: RECORDS })}
          onOpenFile={onOpenFile}
        />,
      ),
    )
  draw()
  return { el: container, onOpenFile, yaml: () => serializeViews(parsed), def: () => parsed.def }
}

beforeEach(() => {
  cardSettings = DEFAULT_REVIEW_SETTINGS
  vi.mocked(changeCardLine).mockClear()
  vi.mocked(landOnCard).mockClear()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const doubleClick = (el: Element): void =>
  act(() => {
    ;(el as HTMLElement).click()
    ;(el as HTMLElement).click()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent ?? '')
const body = (el: ParentNode): string[][] => [...el.querySelectorAll('.view-table tbody tr')].map((tr) => [...tr.querySelectorAll('td[data-cell]')].map((td) => td.textContent ?? '')).filter((cells) => cells.length > 0)
const cell = (el: ParentNode, r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
const viewSettings = (el: ParentNode): HTMLElement => {
  click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
  click(q(el, '.view-menu__tab[data-tab="view"]'))
  return q(el, '.view-popover--properties')
}
const press = (el: Element, key: string): void => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
/** "+"'s picker: its items, in order. */
const addMenu = (el: ParentNode): HTMLElement => {
  click(q(el, '[aria-label="Add view"]'))
  return q(el, '.view-popover--menu')
}
const menuItems = (menu: ParentNode): string[] => [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent ?? '')
/** "+" › Card table; the new tab opens in rename, which Escape leaves with the given name. */
const addCardTable = (el: ParentNode): void => {
  click([...addMenu(el).querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === 'Card table')!)
  press(q(el, '[aria-label="View name"]'), 'Escape')
}
const tabNames = (el: ParentNode): string[] => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '')
const CARDS_OFF = 'Cards are off. Turn them on in Settings › Cards.'

describe('YAZ-5793: "+" › Card table', () => {
  it('"+" offers Card table last, only while the vault has Cards and IDs on', () => {
    let { el } = mount(PAGES_VIEW)
    const menu = addMenu(el)
    expect(menuItems(menu).at(-1)).toBe('Card table')
    expect(menuItems(menu).filter((t) => t === 'Card table')).toHaveLength(1)
    for (const [settings, ids] of [[{ ...DEFAULT_REVIEW_SETTINGS, enabled: false }, true], [DEFAULT_REVIEW_SETTINGS, false], [undefined, true]] as const) {
      act(() => root?.unmount())
      container?.remove()
      cardSettings = settings
      ;({ el } = mount(PAGES_VIEW, ids))
      expect(menuItems(addMenu(el))).not.toContain('Card table')
    }
  })

  it('picking it adds a Table that lists cards, named "Card table", open in rename; it lists the cards', () => {
    const { el, def } = mount(PAGES_VIEW)
    click([...addMenu(el).querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === 'Card table')!)
    const field = q<HTMLInputElement>(el, '[aria-label="View name"]')
    expect(field.value).toBe('Card table')
    press(field, 'Escape')
    expect(def().views.at(-1)).toEqual({ type: 'table', rows: 'cards', name: 'Card table' })
    expect(tabNames(el)).toEqual(['T', 'Card table'])
    expect(q(el, '[role="tab"][aria-selected="true"]').textContent).toBe('Card table')
    expect(body(el).map((r) => r[0])).toEqual(['Capital of Spain', 'GEO-2', 'Longest river'])
    expect(headers(el)[0]).toBe('Title')
  })

  it('a second one is "Card table 2"', () => {
    const { el, def } = mount(PAGES_VIEW)
    addCardTable(el)
    addCardTable(el)
    expect(tabNames(el)).toEqual(['T', 'Card table', 'Card table 2'])
    expect(def().views.at(-1)).toEqual({ type: 'table', rows: 'cards', name: 'Card table 2' })
  })

  it('View settings no longer offer "Show cards as rows", in a Pages table or a Card table', () => {
    for (const text of [PAGES_VIEW, CARDS_VIEW]) {
      const { el } = mount(text)
      const panel = viewSettings(el)
      expect(panel.querySelector('[aria-label="Show cards as rows"]')).toBeNull()
      expect(panel.textContent).not.toContain('Show as rows')
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('a Card table with Cards off, or IDs off, says "Cards are off…" and lists no pages; its saved setting stays', () => {
    for (const [settings, ids] of [[{ ...DEFAULT_REVIEW_SETTINGS, enabled: false }, true], [DEFAULT_REVIEW_SETTINGS, false], [undefined, true]] as const) {
      cardSettings = settings
      const { el, yaml } = mount(FULL_VIEW, ids)
      expect(q(el, '.views-pane__cards-off').textContent).toBe(CARDS_OFF)
      expect(el.querySelector('.view-table')).toBeNull()
      expect(body(el)).toEqual([])
      expect(el.textContent).not.toContain('Europe trip')
      expect(yaml()).toContain('rows: cards')
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('with Cards on and IDs on the same view lists its cards; a Pages table never says "Cards are off"', () => {
    cardSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: false }
    const { el } = mount(PAGES_VIEW)
    expect(el.querySelector('.views-pane__cards-off')).toBeNull()
    expect(body(el).map((r) => r[0])).toEqual(['Europe trip', 'Longest river'])
    act(() => root?.unmount())
    container?.remove()
    cardSettings = DEFAULT_REVIEW_SETTINGS
    const on = mount(CARDS_VIEW).el
    expect(on.querySelector('.views-pane__cards-off')).toBeNull()
    expect(body(on).map((r) => r[0])).toEqual(['Capital of Spain', 'GEO-2', 'Longest river'])
  })
})

describe('YAZ-5319: a table that lists cards', () => {
  it('one row per card, each kind, with the card columns (YAZ-5793: the seven of a new Card table); a page\'s columns are hidden; the count says cards', () => {
    const { el } = mount(CARDS_VIEW)
    expect(headers(el)).toEqual(['Title', 'Status', 'Next review date', 'Wait time', 'Times forgotten', 'Recall chance', 'Last review date'])
    const rows = body(el)
    // No ✓ yet: New (YAZ-5793); the archived card is Archived whatever its reviews.
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['Capital of Spain', 'Archived'],
      ['GEO-2', 'New'],
      ['Longest river', 'New'],
    ])
    // Shown with the hidden columns: the Page and the ID.
    const full = mount(FULL_VIEW).el
    expect(headers(full)).toEqual(['Title', 'Page', 'Status', 'Fix status', 'Next review date', 'Last review date', 'Reviews', 'Success rate', 'Up next status', 'ID'])
    expect(body(full).map((r) => [r[0], r[1], r[2], r[9]])).toEqual([
      ['Capital of Spain', 'Europe trip', 'Archived', 'GEO-1'],
      ['GEO-2', 'Europe trip', 'New', 'GEO-2'],
      ['Longest river', '', 'New', 'GEO-3'],
    ])
    expect(q(el, '.view-toolbar__count').textContent).toBe('3 cards')
    // "+ New" makes a card (YAZ-5349 follow-up: a row of this table is a card).
    expect(el.querySelector('.view-toolbar__new')).not.toBeNull()
  })

  it('the Page cell opens the page, landed on the card (YAZ-5793: Page is hidden; Columns ⚙ shows it)', () => {
    const { el, onOpenFile, yaml } = mount(CARDS_VIEW)
    expect(headers(el)).not.toContain('Page')
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q<HTMLInputElement>(el, '.view-popover--properties input[aria-label="Show Page"]'))
    expect(yaml()).toContain('card.page')
    const at = headers(el).indexOf('Page')
    expect(at).toBeGreaterThan(0)
    click(q(cell(el, 0, at), '.view-card-page'))
    expect(landOnCard).toHaveBeenCalledExactlyOnceWith(TRIP, 'GEO-1')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(TRIP)
  })

  it('Status edits: its Select offers New, Active and Archived (YAZ-5793); Active writes the line without `off`, through the card line of its page', async () => {
    const { el } = mount(FULL_VIEW)
    doubleClick(cell(el, 0, 2))
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    for (const word of ['New', 'Active', 'Archived']) expect(options.some((o) => o.textContent?.startsWith(word))).toBe(true)
    const option = options.find((o) => o.textContent?.startsWith('Active'))!
    await act(async () => void option.click())
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change, index] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id, index]).toEqual([TRIP, 'GEO-1', 0])
    const off: CardLine = { parts: [{ kind: 'id', id: 'GEO-1' }, { kind: 'off' }] }
    expect(change(off)).toEqual({ parts: [{ kind: 'id', id: 'GEO-1' }] })
  })

  it('YAZ-5793: Status New also clears `off`; Archived sets it', async () => {
    const { el } = mount(FULL_VIEW)
    const pick = async (row: number, word: string) => {
      doubleClick(cell(el, row, 2))
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.startsWith(word))!
      await act(async () => void option.click())
    }
    await pick(0, 'New')
    const [, id, toNew] = vi.mocked(changeCardLine).mock.calls[0]
    expect(id).toBe('GEO-1')
    expect(toNew({ parts: [{ kind: 'id', id: 'GEO-1' }, { kind: 'off' }] })).toEqual({ parts: [{ kind: 'id', id: 'GEO-1' }] })
    await pick(1, 'Archived')
    const [, id2, toArchived] = vi.mocked(changeCardLine).mock.calls[1]
    expect(id2).toBe('GEO-2')
    expect(toArchived({ parts: [{ kind: 'id', id: 'GEO-2' }] })).toEqual({ parts: [{ kind: 'id', id: 'GEO-2' }, { kind: 'off' }] })
  })

  it('YAZ-5430: Fix status shows "Needs fixing" for a marked card, blank for the rest; Needs fixing writes `fix`, Clear takes it off', async () => {
    const { el } = mount(FULL_VIEW)
    // Blank is the table's own muted "Empty", as any empty cell of an editable column shows.
    expect(body(el).map((r) => r[3])).toEqual(['Empty', 'Empty', 'Needs fixing'])
    doubleClick(cell(el, 0, 3))
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.startsWith('Needs fixing'))!
    await act(async () => void option.click())
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, on, index] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id, index]).toEqual([TRIP, 'GEO-1', 0])
    // After the ID and `off`, as the phone writes it.
    const off: CardLine = { parts: [{ kind: 'id', id: 'GEO-1' }, { kind: 'off' }] }
    expect(on(off)).toEqual({ parts: [{ kind: 'id', id: 'GEO-1' }, { kind: 'off' }, { kind: 'fix' }] })
    doubleClick(cell(el, 2, 3))
    const clear = [...document.querySelectorAll<HTMLButtonElement>('.property-value-picker__footer button')].find((b) => b.textContent === 'Clear')!
    await act(async () => void clear.click())
    expect(changeCardLine).toHaveBeenCalledTimes(2)
    const [path2, id2, cleared] = vi.mocked(changeCardLine).mock.calls[1]
    expect([path2, id2]).toEqual(['/vault/Geo/GEO-3.md', 'GEO-3'])
    expect(cleared({ parts: [{ kind: 'id', id: 'GEO-3' }, { kind: 'fix' }] })).toEqual({ parts: [{ kind: 'id', id: 'GEO-3' }] })
  })

  it('Up next status edits: a check writes `next` on the card file\'s line', async () => {
    const { el } = mount(FULL_VIEW)
    await act(async () => doubleClick(cell(el, 2, 8)))
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id]).toEqual(['/vault/Geo/GEO-3.md', 'GEO-3'])
    expect(change({ parts: [{ kind: 'id', id: 'GEO-3' }] }).parts.some((p) => p.kind === 'next')).toBe(true)
  })

  it('the review numbers are read only, and the name opens no title edit', () => {
    const { el } = mount(CARDS_VIEW)
    // Wait time, Times forgotten, Recall chance, Last review date (YAZ-5793's defaults): none opens an editor.
    for (const c of [2, 3, 4, 5, 6]) {
      doubleClick(cell(el, 0, c))
      expect(el.querySelector('[data-editing]')).toBeNull()
    }
    doubleClick(cell(el, 0, 0))
    expect(el.querySelector('[aria-label="Edit title"]')).toBeNull()
  })
})
