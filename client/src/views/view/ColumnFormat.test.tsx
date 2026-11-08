/**
 * YAZ-4591 in the table: a Number or Date column's format shapes its cells (S21/S22) while the
 * editor keeps the raw value, Edit column writes the format into the declaration, and renaming an
 * option in Edit column asks the host to rename it in the notes too (S24) — `setColumn`'s `rename`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import type { ColumnDecl } from '../folderSettings'
import { type ParsedViews, parseViews } from '../viewSchema'
import { type FolderHost, ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'

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

  it('a Date column offers its three formats', () => {
    const { el } = mount({ due: { kind: 'date' }, stage: SELECT })
    editColumn(el, 2)
    expect([...byLabel<HTMLSelectElement>('Format of Due').options].map((o) => o.textContent)).toEqual(['2026-11-07', 'Nov 7, 2026', 'Relative (in 3 days)'])
  })

  it('S24: renaming an option asks the host to rename it in the notes too', () => {
    const { el, setColumn } = mount({ stage: SELECT })
    editColumn(el, 3)
    click(byLabel('Edit option Todo'))
    expect(document.body.textContent).toContain('Renaming this option changes it in every note that holds it.')
    setValue(byLabel<HTMLInputElement>('Option name'), 'Next')
    act(() => void byLabel<HTMLInputElement>('Option name').form!.requestSubmit())
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('stage', { kind: 'select', options: ['Next', 'Done'] }, SELECT, { from: 'Todo', to: 'Next' })
  })
})
