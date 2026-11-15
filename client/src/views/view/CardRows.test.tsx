/**
 * YAZ-5319: "Show cards as rows" in a folder page's table. ViewsPane mounted with react-dom in jsdom: the setting is
 * offered only while the vault has Cards and IDs on; a table listing cards shows a row per card with its Page, which
 * opens the page landed on the card; Card status and Card up next edit the card's line (`changeCardLine`).
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
  record('GEO-3', { kind: 'card', title: 'Longest river', cards: [{ id: 'GEO-3', title: 'Longest river', off: false, next: false, reviews: [] }] }),
]
const CARDS_VIEW = 'views:\n  - type: table\n    name: T\n    rows: cards\n'
const PAGES_VIEW = 'views:\n  - type: table\n    name: T\n'

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
  return { el: container, onOpenFile, yaml: () => serializeViews(parsed) }
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

describe('YAZ-5319: Show cards as rows', () => {
  it('the View settings offer it only while the vault has Cards and IDs on; a pick lists the cards', () => {
    const { el, yaml } = mount(PAGES_VIEW)
    const seg = q(viewSettings(el), '[aria-label="Show cards as rows"]')
    expect([...seg.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Pages', 'true'], ['Cards', 'false']])
    click(seg.querySelectorAll('button')[1])
    expect(yaml()).toContain('rows: cards')
    expect(body(el).map((r) => r[0])).toEqual(['Capital of Spain', 'GEO-2', 'Longest river'])
  })

  it('is not offered with Cards off, nor with IDs off; a view that lists cards then lists its pages', () => {
    cardSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: false }
    let { el } = mount(CARDS_VIEW)
    expect(viewSettings(el).querySelector('[aria-label="Show cards as rows"]')).toBeNull()
    expect(body(el).map((r) => r[0])).toEqual(['Europe trip', 'Longest river'])
    act(() => root?.unmount())
    container?.remove()
    cardSettings = DEFAULT_REVIEW_SETTINGS
    ;({ el } = mount(CARDS_VIEW, false))
    expect(viewSettings(el).querySelector('[aria-label="Show cards as rows"]')).toBeNull()
    expect(body(el).map((r) => r[0])).toEqual(['Europe trip', 'Longest river'])
  })

  it('one row per card, each kind, with the card columns; a page\'s columns are hidden; the count says cards', () => {
    const { el } = mount(CARDS_VIEW)
    expect(headers(el)).toEqual(['Name', 'Page', 'Card status', 'Card next review', 'Card last review', 'Card reviews', 'Card success rate', 'Card up next', 'Card ID'])
    const rows = body(el)
    expect(rows.map((r) => [r[0], r[1], r[2], r[8]])).toEqual([
      ['Capital of Spain', 'Europe trip', 'Archived', 'GEO-1'],
      ['GEO-2', 'Europe trip', 'Active', 'GEO-2'],
      ['Longest river', '', 'Active', 'GEO-3'],
    ])
    expect(q(el, '.view-toolbar__count').textContent).toBe('3 cards')
    // No New button: a card row is no page.
    expect(el.querySelector('.view-toolbar__new')).toBeNull()
  })

  it('the Page cell opens the page, landed on the card', () => {
    const { el, onOpenFile } = mount(CARDS_VIEW)
    click(q(cell(el, 0, 1), '.view-card-page'))
    expect(landOnCard).toHaveBeenCalledExactlyOnceWith(TRIP, 'GEO-1')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(TRIP)
  })

  it('Card status edits: Active writes the line without `off`, through the card line of its page', async () => {
    const { el } = mount(CARDS_VIEW)
    doubleClick(cell(el, 0, 2))
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith('Active'))!
    await act(async () => void (option as HTMLElement).click())
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change, index] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id, index]).toEqual([TRIP, 'GEO-1', 0])
    const off: CardLine = { parts: [{ kind: 'id', id: 'GEO-1' }, { kind: 'off' }] }
    expect(change(off)).toEqual({ parts: [{ kind: 'id', id: 'GEO-1' }] })
  })

  it('Card up next edits: a check writes `next` on the card file\'s line', async () => {
    const { el } = mount(CARDS_VIEW)
    await act(async () => doubleClick(cell(el, 2, 7)))
    expect(changeCardLine).toHaveBeenCalledOnce()
    const [path, id, change] = vi.mocked(changeCardLine).mock.calls[0]
    expect([path, id]).toEqual(['/vault/Geo/GEO-3.md', 'GEO-3'])
    expect(change({ parts: [{ kind: 'id', id: 'GEO-3' }] }).parts.some((p) => p.kind === 'next')).toBe(true)
  })

  it('the review numbers are read only, and the name opens no title edit', () => {
    const { el } = mount(CARDS_VIEW)
    doubleClick(cell(el, 0, 5))
    expect(el.querySelector('[data-editing]')).toBeNull()
    doubleClick(cell(el, 0, 0))
    expect(el.querySelector('[aria-label="Edit title"]')).toBeNull()
  })
})
