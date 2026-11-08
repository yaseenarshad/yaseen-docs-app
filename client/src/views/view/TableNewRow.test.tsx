/**
 * The "+ New" row of the folder table (YAZ-4539, S12): ViewsPane mounted in jsdom, the folder host's `create` spied.
 * One row at the end of an ungrouped table and one at the end of each innermost group's rows. A click takes the
 * group header "+" path, so the note gets the filter seed and every group value above it. It is a line of the flat
 * list (windowing counts it), but not a data row: no `data-cell`, no `#` number, not in the note window's order,
 * and not counted by frozen rows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import type { NewNoteSeed } from '../newNote'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

const create = vi.fn<(seed: NewNoteSeed, name?: string) => Promise<string>>(async () => '/vault/Untitled.md')

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})

/** A holds a1 (direct) and the inner sections p1 and p2; B holds b1 in p1. */
const NESTED_RECORDS = [rec('a1', { dept: 'A', proc: 'A' }), rec('a2', { dept: 'A', proc: 'p1' }), rec('a3', { dept: 'A', proc: 'p2' }), rec('b1', { dept: 'B', proc: 'p1' })]

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
    sort:
      - property: file.name
        direction: ASC
${extra}`

const NESTED = table(`    filters:
      and:
        - kind == "task"
    groupBy:
      - property: note.dept
      - property: note.proc
`)

const manyRecords = (n: number): IndexRecord[] => Array.from({ length: n }, (_, i) => rec(`n${String(i).padStart(3, '0')}`, {}))

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  const records = props.records ?? TEST_RECORDS
  const folder = testFolderHost({ vaultRecords: records, create })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() => root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={records} folder={folder} onOpenFile={vi.fn()} {...props} />))
  draw()
  return { el: container }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
/** Each body line: `[value]` for a group header, `+` for a "+ New" row, else the row's name; spacers left out. */
const lineNames = (el: ParentNode): string[] =>
  [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr:not(.view-table__spacer)')].map((tr) =>
    tr.classList.contains('view-table__group') ? `[${q(tr, '.view-group__value').textContent}]` : tr.classList.contains('view-table__new') ? '+' : (q(tr, '.view-table__name').textContent ?? ''),
  )
const newRows = (el: ParentNode) => [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr.view-table__new')]
const click = (b: Element) => act(() => (b as HTMLElement).click())
const seed = (n = 0) => create.mock.calls[n][0].properties

describe('the "+ New" row (YAZ-4539)', () => {
  it('an ungrouped table ends with one "+ New" row, the full width, one row high', () => {
    const { el } = mount(table())
    const names = lineNames(el)
    expect(names.at(-1)).toBe('+')
    expect(names.filter((n) => n === '+')).toHaveLength(1)
    const [row] = newRows(el)
    const cell = q<HTMLTableCellElement>(row, 'td')
    expect(row.cells).toHaveLength(1)
    expect(cell.colSpan).toBe(2) // the `#` gutter and Name
    expect(q(row, 'button').textContent).toBe('+ New')
  })

  it('a click makes a note through the "+" path, with the filter seed', async () => {
    const { el } = mount(table('    filters:\n      and:\n        - status == "idea"\n'))
    await act(async () => click(q(newRows(el)[0], 'button')))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][1]).toBeUndefined()
    expect(seed()).toEqual({ status: 'idea' })
  })

  it('a grouped table has one at the end of each innermost group’s rows', () => {
    const { el } = mount(NESTED, { records: NESTED_RECORDS.map((r) => ({ ...r, properties: { ...r.properties, kind: 'task' } })) })
    expect(lineNames(el)).toEqual(['[A]', 'a1', '[p1]', 'a2', '+', '[p2]', 'a3', '+', '[B]', '[p1]', 'b1', '+'])
  })

  it('a click seeds the filter, the group and every group above it', async () => {
    const { el } = mount(NESTED, { records: NESTED_RECORDS.map((r) => ({ ...r, properties: { ...r.properties, kind: 'task' } })) })
    await act(async () => click(q(newRows(el)[2], 'button')))
    expect(seed()).toEqual({ kind: 'task', dept: 'B', proc: 'p1' })
  })

  it('a collapsed group shows no "+ New" row', () => {
    const { el } = mount(table('    groupBy:\n      property: note.dept\n'), { records: NESTED_RECORDS })
    expect(lineNames(el)).toEqual(['[A]', 'a1', 'a2', 'a3', '+', '[B]', 'b1', '+'])
    click(q(el, '[aria-label="Toggle group A"]'))
    expect(lineNames(el)).toEqual(['[A]', '[B]', 'b1', '+'])
  })

  it('no row where the group header offers no "+": a level that is not a note property', () => {
    const { el } = mount(table('    groupBy:\n      property: file.ext\n'), { records: NESTED_RECORDS })
    expect(el.querySelector('.view-group__new')).toBeNull()
    expect(newRows(el)).toHaveLength(0)
  })

  it('is not a data row: no data-cell, no # number, no row menu, and the arrow keys stop at the last row', () => {
    const { el } = mount(table())
    const [row] = newRows(el)
    expect(row.querySelector('[data-cell]')).toBeNull()
    expect(row.querySelector('.view-table__gutter')).toBeNull()
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    act(() => void q(row, 'td').dispatchEvent(menu))
    expect(el.querySelector('.ctx-menu')).toBeNull()
    const cells = [...el.querySelectorAll<HTMLElement>('td[data-cell$=":0"]')]
    const last = cells.at(-1)!
    expect(last.dataset.cell).toBe(`${TEST_RECORDS.length - 1}:0`)
    act(() => last.focus())
    act(() => void last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(last)
  })

  it('frozen rows do not count it', () => {
    const { el } = mount(table('    groupBy:\n      property: note.dept\n    frozenRows: 4\n'), { records: NESTED_RECORDS })
    const frozen = [...el.querySelectorAll<HTMLTableRowElement>('tbody tr.view-table__row--frozen')]
    // A's three rows, its "+ New" line, then B's header and b1: four data rows.
    expect(frozen.map((tr) => (tr.classList.contains('view-table__new') ? '+' : tr.classList.contains('view-table__group') ? 'header' : q(tr, '.view-table__name').textContent))).toEqual([
      'header', 'a1', 'a2', 'a3', '+', 'header', 'b1',
    ])
  })

  it('the hover band skips it', () => {
    const band = /([^{}]*\.view-table tbody tr[^{}]*:hover > td)\s*\{/.exec(viewsCss)![1]
    expect(band).toContain(':not(.view-table__new)')
  })
})

describe('the "+ New" row under windowing (YAZ-4539)', () => {
  it('counts as a line: 500 notes and the row make 501 lines, so the table windows', () => {
    const { el } = mount(table(), { records: manyRecords(500) })
    expect(el.querySelector('.view-table__spacer')).not.toBeNull()
    expect(newRows(el)).toHaveLength(0)
  })

  it('scrolled to the end, the row mounts last and no bottom spacer follows it', () => {
    const { el } = mount(table(), { records: manyRecords(600) })
    const wrap = q<HTMLElement>(el, '.view-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 601 * 28, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    const body = q<HTMLElement>(el, '.view-table tbody')
    expect(body.lastElementChild?.classList.contains('view-table__new')).toBe(true)
    expect(lineNames(el).at(-2)).toBe('n599')
    // The top spacer and the mounted lines add up to all 601 lines.
    const top = q<HTMLTableRowElement>(el, '.view-table__spacer')
    expect(parseInt(top.style.height) / 28 + lineNames(el).length).toBe(601)
  })
})
