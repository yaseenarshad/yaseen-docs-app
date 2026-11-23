/**
 * YAZ-4591 in the table: a Number or Date column's format shapes its cells (S21/S22) while the
 * editor keeps the raw value, Edit column writes the format into the declaration, and renaming an
 * option in Edit column asks the host to rename it in the pages too (S24) — `setColumn`'s `rename`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import type { ColumnDecl } from '../folderSettings'
import { type ParsedViews, parseViews } from '../viewSchema'
import { type FolderHost, ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'

vi.mock('../../review/useReviewSettings', () => ({ useVaultReviewSettings: () => DEFAULT_REVIEW_SETTINGS }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const VIEWS = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.amount
      - note.due
      - note.stage
`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord =>
  ({ path: `/vault/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }) as IndexRecord
const RECORDS = [rec('A', { amount: 1234.5, due: '2026-03-04', stage: 'Todo' }), rec('B', { amount: 1, due: '2026-02-30', stage: 'Todo' })]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(columns: Record<string, ColumnDecl>, host: Partial<FolderHost> = {}) {
  let parsed = parseViews(VIEWS)
  const setColumn = vi.fn(async () => undefined)
  const folder = testFolderHost({ settings: { columns, views: [], problems: [] }, vaultRecords: RECORDS, setColumn, ...host })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={(next: ParsedViews) => void (parsed = next)} root="/vault" folderPath="/vault/f/.folder.md" records={RECORDS} folder={folder} onOpenFile={vi.fn()} />,
      ),
    )
  draw()
  return { el: container, setColumn }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const cells = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table tbody tr:not(.view-group) td:not(.view-table__gutter)')].map((td) => td.textContent ?? '')
const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const byLabel = <T extends Element>(label: string): T => {
  const n = document.querySelector<T>(`[aria-label="${label}"]`)
  if (n === null) throw new Error(`missing [aria-label="${label}"]`)
  return n
}
function rightClick(el: EventTarget): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
}
const click = (el: Element): void => act(() => (el as HTMLElement).click())
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function editColumn(el: HTMLElement, index: number): void {
  rightClick(th(el, index))
  const item = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Edit column…')
  click(item!)
}

const SELECT: ColumnDecl = { kind: 'select', options: ['Todo', 'Done'] }

describe('S21/S22: a cell shows its column’s format', () => {
  it('no format: the value as stored, as before', () => {
    const { el } = mount({ amount: { kind: 'number' }, due: { kind: 'date' }, stage: SELECT })
    expect(cells(el).slice(1, 3)).toEqual(['1234.5', '2026-03-04'])
  })

  it('currency and "Nov 7, 2026" formats render through Intl; the editor still holds the raw number', () => {
    const { el } = mount({ amount: { kind: 'number', format: { style: 'currency', currency: 'USD' } }, due: { kind: 'date', format: { style: 'medium' } }, stage: SELECT })
    expect(cells(el).slice(1, 3)).toEqual(['$1,234.50', 'Mar 4, 2026'])
    click(el.querySelector<HTMLElement>('[data-cell="0:1"] [data-edit]')!)
    expect(byLabel<HTMLInputElement>('Edit amount').value).toBe('1234.5')
  })

  it('an impossible date shows as its raw text, never an invented day (YAZ-4644 E3): 2026-02-30 is not "Mar 2, 2026"', () => {
    const { el } = mount({ amount: { kind: 'number' }, due: { kind: 'date', format: { style: 'medium' } }, stage: SELECT })
    expect(cells(el)[6]).toBe('2026-02-30')
  })
})

describe('Edit column', () => {
  it('a Number column offers Format and Decimals; a pick is one declaration write', () => {
    const { el, setColumn } = mount({ amount: { kind: 'number' }, stage: SELECT })
    editColumn(el, 1)
    setValue(byLabel<HTMLSelectElement>('Format of Amount'), 'currency')
    expect(setColumn).toHaveBeenLastCalledWith('amount', { kind: 'number', format: { style: 'currency', currency: 'USD' } }, { kind: 'number' })
  })

  it('choosing the default style back with no decimals writes no format at all', () => {
    const { el, setColumn } = mount({ amount: { kind: 'number', format: { style: 'grouped' } }, stage: SELECT })
    editColumn(el, 1)
    setValue(byLabel<HTMLSelectElement>('Format of Amount'), 'plain')
    expect(setColumn).toHaveBeenLastCalledWith('amount', { kind: 'number' }, { kind: 'number', format: { style: 'grouped' } })
    setValue(byLabel<HTMLSelectElement>('Decimals of Amount'), '2')
    expect(setColumn).toHaveBeenLastCalledWith('amount', { kind: 'number', format: { style: 'grouped', decimals: 2 } }, expect.anything())
  })

  it('a Date column offers its four formats including Custom…', () => {
    const { el } = mount({ due: { kind: 'date' }, stage: SELECT })
    editColumn(el, 2)
    expect([...byLabel<HTMLSelectElement>('Format of Due').options].map((o) => o.textContent)).toEqual(['2026-11-07', 'Nov 7, 2026', 'Relative (in 3 days)', 'Custom…'])
  })

  it('YAZ-6167: Custom… on a Date column shows Pattern input + live preview and saves pattern on commit', () => {
    const { el, setColumn } = mount({ due: { kind: 'date', format: { style: 'custom' } }, stage: SELECT })
    editColumn(el, 2)
    const input = byLabel<HTMLInputElement>('Date pattern for Due')
    expect(input.placeholder).toBe('ddd MMM D')
    expect(byLabel<HTMLElement>('Preview of Due format').textContent).toContain('Preview:')
    setValue(input, 'ddd MMM D')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(setColumn).toHaveBeenLastCalledWith('due', { kind: 'date', format: { style: 'custom', pattern: 'ddd MMM D' } }, { kind: 'date', format: { style: 'custom' } })
  })

  it('YAZ-6167: built-in file.ctime shows Format picker, saves def.properties["file.ctime"].format, and renders formatted cells', () => {
    const ctime = new Date(2026, 10, 7, 15, 30).getTime()
    const datedRecords = [
      { ...RECORDS[0], ctime },
      { ...RECORDS[1], ctime: new Date(2026, 10, 8, 9, 0).getTime() },
    ]
    let parsed = parseViews(`views:
  - type: table
    name: T
    order:
      - file.name
      - file.ctime
`)
    const folder = testFolderHost({ settings: { columns: {}, views: [], problems: [] }, vaultRecords: datedRecords })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const rerender = () =>
      act(() =>
        root?.render(
          <ViewsPane
            parsed={parsed}
            onChange={(next: ParsedViews) => {
              parsed = next
              rerender()
            }}
            root="/vault"
            folderPath="/vault/f/.folder.md"
            records={datedRecords}
            folder={folder}
            onOpenFile={vi.fn()}
          />,
        ),
      )
    rerender()
    // Default Created display is date-only ISO
    expect(cells(container).slice(0, 2)).toEqual(['A', '2026-11-07'])
    // Open Edit column on Created (file.ctime)
    editColumn(container, 1)
    setValue(byLabel<HTMLSelectElement>('Format of Created'), 'custom')
    const patternInput = byLabel<HTMLInputElement>('Date pattern for Created')
    setValue(patternInput, 'ddd MMM D')
    act(() => {
      patternInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(parsed.def.properties?.['file.ctime']?.format).toEqual({ style: 'custom', pattern: 'ddd MMM D' })
    expect(cells(container).slice(0, 2)).toEqual(['A', 'Sat Nov 7'])
  })

  it('YAZ-6167: built-in card.created in a Cards table saves format through cardView.properties and renders formatted cells', () => {
    const ctime = new Date(2026, 10, 7, 15, 30).getTime()
    const cardRecords: IndexRecord[] = [
      {
        ...rec('C-1', {}),
        kind: 'card',
        ctime,
        cards: [{ id: 'C-1', title: 'First card', off: false, next: false, reviews: [] }],
      },
    ]
    let parsed = parseViews(`views:
  - type: table
    name: Cards
    rows: cards
    cardView:
      order:
        - file.name
        - card.created
`)
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update(null, [], [], true)
    const folder = testFolderHost({ wikilinks, settings: { columns: {}, views: [], problems: [] }, vaultRecords: cardRecords })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const rerender = () =>
      act(() =>
        root?.render(
          <ViewsPane
            parsed={parsed}
            onChange={(next: ParsedViews) => {
              parsed = next
              rerender()
            }}
            root="/vault"
            folderPath="/vault/f/.folder.md"
            records={cardRecords}
            folder={folder}
            onOpenFile={vi.fn()}
          />,
        ),
      )
    rerender()
    expect(cells(container).slice(0, 2)).toEqual(['First card', '2026-11-07'])
    editColumn(container, 1)
    setValue(byLabel<HTMLSelectElement>('Format of Created'), 'medium')
    expect(parsed.def.views[0].cardView?.properties?.['card.created']?.format).toEqual({ style: 'medium' })
    expect(cells(container).slice(0, 2)).toEqual(['First card', 'Nov 7, 2026'])
  })

  it('S24: renaming an option asks the host to rename it in the pages too', () => {
    const { el, setColumn } = mount({ stage: SELECT })
    editColumn(el, 3)
    click(byLabel('Edit option Todo'))
    expect(document.body.textContent).toContain('Renaming this option changes it in every page that holds it.')
    setValue(byLabel<HTMLInputElement>('Option name'), 'Next')
    act(() => void byLabel<HTMLInputElement>('Option name').form!.requestSubmit())
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('stage', { kind: 'select', options: ['Next', 'Done'] }, SELECT, { from: 'Todo', to: 'Next' })
  })
})
