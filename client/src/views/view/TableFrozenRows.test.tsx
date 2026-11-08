/**
 * Frozen rows in the folder table (YAZ-4537, D9b changed by S4): ViewsPane mounted in jsdom. `frozenRows` counts
 * DATA rows, at most 10. The frozen lines are every line from the top through the Nth shown data row, so the group
 * headers above it come along, and a collapsed group's count goes on to the next rows that show. The frozen lines
 * always mount under windowing. The row right-click writes the count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})

/** Group A holds a1 and a2, group B holds b1 and b2. */
const GROUPED_RECORDS = [rec('a1', { g: 'A' }), rec('a2', { g: 'A' }), rec('b1', { g: 'B' }), rec('b2', { g: 'B' })]

const table = (extra: string) => `views:
  - type: table
    name: T
    order:
      - file.name
    sort:
      - property: file.name
        direction: ASC
${extra}`

const GROUPED = (frozen: number) => table(`    groupBy:
      property: note.g
    frozenRows: ${frozen}
`)

/** 600 empty notes, n000…n599, for the windowing case. */
const manyRecords = (n = 600): IndexRecord[] => Array.from({ length: n }, (_, i) => rec(`n${String(i).padStart(3, '0')}`, {}))

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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={records} folder={testFolderHost({ vaultRecords: records })} onOpenFile={vi.fn()} {...props} />),
    )
  draw()
  return { el: container, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
/** What each body line shows: a group header's value, or a data row's name; spacers left out. */
const lineName = (tr: HTMLTableRowElement): string =>
  tr.classList.contains('view-table__group') ? `[${q(tr, '.view-group__value').textContent}]` : tr.classList.contains('view-table__new') ? '+' : (q(tr, '.view-table__name').textContent ?? '')
const bodyLines = (el: ParentNode) => [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr:not(.view-table__spacer):not(.view-table__new)')]
/** The frozen lines, top first, as `name@i` with their sticky index. */
const frozenLines = (el: ParentNode): string[] =>
  [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr.view-table__row--frozen')].map((tr) => `${lineName(tr)}@${tr.style.getPropertyValue('--view-frozen-i')}`)
const frozenEnd = (el: ParentNode): string[] => [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr.view-table__row--frozen-end')].map(lineName)
const rowNamed = (el: ParentNode, name: string): HTMLTableRowElement => bodyLines(el).find((tr) => tr.querySelector('.view-table__name')?.textContent === name)!
const items = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
const item = (el: ParentNode, label: string) => {
  const found = items(el).find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`no item ${label}: ${items(el).map((b) => b.textContent).join(', ')}`)
  return found
}
const click = (b: HTMLElement) => act(() => b.click())
function rightClick(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
}
const rightClickRow = (el: ParentNode, name: string) => rightClick(q(rowNamed(el, name), 'td[data-cell]'))
function scrollTo(el: ParentNode, top: number): void {
  const wrap = q<HTMLElement>(el, '.view-table-wrap')
  act(() => {
    Object.defineProperty(wrap, 'scrollTop', { value: top, configurable: true })
    wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

describe('the frozen lines (YAZ-4537)', () => {
  it('a flat table freezes its top N rows, each with its sticky index, and marks the last one', () => {
    const { el } = mount(table('    frozenRows: 2\n'))
    expect(frozenLines(el)).toEqual(['Agentic Agency@0', 'Attribution@1'])
    expect(frozenEnd(el)).toEqual(['Attribution'])
    // The rest of the rows are not frozen, and keep their `#` numbers and cells.
    expect(bodyLines(el)[2].classList.contains('view-table__row--frozen')).toBe(false)
    expect(q(bodyLines(el)[1], '.view-table__gutter').textContent).toBe('2')
  })

  it('no frozenRows freezes nothing', () => {
    const { el } = mount(table(''))
    expect(frozenLines(el)).toEqual([])
  })

  it('a grouped table counts data rows, and the group headers above them come along', () => {
    const one = mount(GROUPED(1), { records: GROUPED_RECORDS })
    expect(frozenLines(one.el)).toEqual(['[A]@0', 'a1@1'])
    act(() => root?.unmount())
    container?.remove()
    const three = mount(GROUPED(3), { records: GROUPED_RECORDS })
    expect(frozenLines(three.el)).toEqual(['[A]@0', 'a1@1', 'a2@2', '+@3', '[B]@4', 'b1@5'])
    expect(frozenEnd(three.el)).toEqual(['b1'])
  })

  it('with a group collapsed, the count covers the next rows that show', () => {
    const { el } = mount(GROUPED(1), { records: GROUPED_RECORDS })
    click(q(el, '[aria-label="Toggle group A"]'))
    expect(frozenLines(el)).toEqual(['[A]@0', '[B]@1', 'b1@2'])
  })

  it('more than the rows that show freezes through the last row', () => {
    const { el } = mount(GROUPED(9), { records: GROUPED_RECORDS })
    // Through b2: the last "+ New" row (YAZ-4539) is not a data row, so it stays out.
    expect(frozenLines(el)).toHaveLength(7)
    expect(frozenEnd(el)).toEqual(['b2'])
  })

  it('three levels with one row in each group, and a "+ New" row in each: "Freeze up to this row" on row 10 freezes 10 rows (YAZ-4544)', () => {
    const records = Array.from({ length: 12 }, (_, i) => rec(`r${String(i).padStart(2, '0')}`, { a: `A${i}`, b: `B${i}`, c: `C${i}` }))
    const { el } = mount(
      table(`    groupBy:
      - property: note.a
      - property: note.b
      - property: note.c
    frozenRows: 10
`),
      { records },
    )
    const frozen = frozenLines(el).map((l) => l.split('@')[0])
    // Each row: three headers, the row and its "+ New": the 10th row is line 49.
    expect(frozen.filter((l) => !l.startsWith('[') && l !== '+')).toEqual(records.slice(0, 10).map((r) => r.title))
    expect(frozenEnd(el)).toEqual(['r09'])
  })

  it('freezes at most 10 rows', () => {
    const { el } = mount(table('    frozenRows: 50\n'), { records: manyRecords(30) })
    expect(frozenLines(el).map((l) => l.split('@')[0])).toEqual(['n000', 'n001', 'n002', 'n003', 'n004', 'n005', 'n006', 'n007', 'n008', 'n009'])
  })
})

describe('frozen lines under windowing (YAZ-4537)', () => {
  it('600 notes: the frozen lines stay mounted at any scroll, and the window starts below them', () => {
    const { el } = mount(table('    frozenRows: 3\n'), { records: manyRecords() })
    const names = () => bodyLines(el).map(lineName)
    for (const top of [0, 5000, 600 * 28]) {
      scrollTo(el, top)
      expect(frozenLines(el)).toEqual(['n000@0', 'n001@1', 'n002@2'])
      // The three frozen lines come first in the DOM; no row mounts twice.
      expect(names().slice(0, 3)).toEqual(['n000', 'n001', 'n002'])
      expect(new Set(names()).size).toBe(names().length)
    }
    // Scrolled: the top spacer stands in for the lines between the frozen ones and the window, no more.
    scrollTo(el, 5000)
    const spacer = q<HTMLTableRowElement>(el, '.view-table__spacer')
    const firstWindowed = Number(names()[3].slice(1))
    expect(spacer.previousElementSibling).toBe(rowNamed(el, 'n002'))
    expect(spacer.style.height).toBe(`${(firstWindowed - 3) * 28}px`)
    expect(names()).not.toContain('n003')
  })
})

describe('"Freeze up to this row" in the row right-click (YAZ-4537)', () => {
  it('a group after the Fill group: Freeze up to this row, then Unfreeze rows, disabled with nothing frozen', () => {
    const { el } = mount(table(''))
    rightClickRow(el, 'Attribution')
    expect(items(el).map((b) => b.textContent)).toEqual(['Open', 'Copy path', 'Reveal in Finder', 'Fill cell', 'Fill row', 'Freeze up to this row', 'Unfreeze rows'])
    const groups = [...el.querySelectorAll('.ctx-menu .ctx-menu__group')]
    expect(groups).toHaveLength(3)
    expect([...groups[2].querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Freeze up to this row', 'Unfreeze rows'])
    expect(item(el, 'Unfreeze rows').disabled).toBe(true)
  })

  it('a click freezes down to that row; on that row the item reads ✓ and a click unfreezes', () => {
    const { el, yaml } = mount(table(''))
    rightClickRow(el, 'Attribution')
    click(item(el, 'Freeze up to this row'))
    expect(yaml()).toContain('frozenRows: 2')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(frozenLines(el)).toEqual(['Agentic Agency@0', 'Attribution@1'])

    rightClickRow(el, 'Attribution')
    click(item(el, '✓ Frozen up to this row'))
    expect(yaml()).not.toContain('frozenRows')
    expect(frozenLines(el)).toEqual([])
  })

  it('"Unfreeze rows" on another row removes the count', () => {
    const { el, yaml } = mount(table('    frozenRows: 2\n'))
    rightClickRow(el, 'Creator Economy')
    expect(item(el, 'Freeze up to this row').disabled).toBe(false)
    click(item(el, 'Unfreeze rows'))
    expect(yaml()).not.toContain('frozenRows')
  })

  it('in a grouped table the count is the data row’s place, headers not counted', () => {
    const { el, yaml } = mount(table('    groupBy:\n      property: note.g\n'), { records: GROUPED_RECORDS })
    rightClickRow(el, 'b1')
    click(item(el, 'Freeze up to this row'))
    expect(yaml()).toContain('frozenRows: 3')
    expect(frozenLines(el).map((l) => l.split('@')[0])).toEqual(['[A]', 'a1', 'a2', '+', '[B]', 'b1'])
  })

  it('past the 10th row the item is disabled', () => {
    const { el } = mount(table(''), { records: manyRecords(30) })
    rightClickRow(el, 'n009')
    expect(item(el, 'Freeze up to this row').disabled).toBe(false)
    rightClickRow(el, 'n010')
    expect(item(el, 'Freeze up to this row').disabled).toBe(true)
  })
})

describe('the frozen lines’ place and look (YAZ-4537)', () => {
  it('the header height is measured once into --view-table-head-h, and a scroll reads no layout for it', () => {
    const rect = vi.spyOn(HTMLTableSectionElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 31))
    const { el } = mount(table('    frozenRows: 2\n'), { records: manyRecords() })
    const wrap = q<HTMLElement>(el, '.view-table-wrap')
    expect(wrap.style.getPropertyValue('--view-table-head-h')).toBe('31px')
    const reads = rect.mock.calls.length
    scrollTo(el, 3000)
    scrollTo(el, 6000)
    expect(rect.mock.calls.length).toBe(reads)
  })

  it('the CSS: sticky under the header by line, the header’s translate, z-index 2, opaque cells, a 3px line at the end that adds no height', () => {
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    const row = rule('.view-table tbody tr.view-table__row--frozen')
    expect(row).toMatch(/position:\s*relative/)
    expect(row).toMatch(/z-index:\s*2/)
    expect(row).toMatch(/transform:\s*translateY\(var\(--view-table-header-y, 0px\)\)/)
    const cell = rule('.view-table tbody tr.view-table__row--frozen > td')
    expect(cell).toMatch(/position:\s*sticky/)
    // The measured top (YAZ-4582), with the header's height plus the line's place × the row height before it.
    expect(cell).toMatch(/top:\s*var\(--view-frozen-top, calc\(var\(--view-table-head-h, 0px\) \+ var\(--view-frozen-i, 0\) \* var\(--view-table-row-h, 28px\)\)\)/)
    expect(rule('.view-table__row--frozen > td')).toMatch(/background-color:\s*var\(--bg\)/)
    // The 3px line is the cell's 1px border in the line's colour and a 2px strip inside it (YAZ-4534 polish): a 3px
    // border made the last frozen line 2px taller than the row height windowing counts on.
    const end = rule('.view-table tbody tr.view-table__row--frozen-end > td')
    expect(end).not.toMatch(/border-bottom-width/)
    expect(end).toMatch(/border-bottom-color:\s*color-mix\(in srgb, var\(--border\) 60%, var\(--fg\) 40%\)/)
    const strip = rule('.view-table tbody tr.view-table__row--frozen-end > td::before')
    expect(strip).toMatch(/content:\s*''/)
    expect(strip).toMatch(/position:\s*absolute/)
    expect(strip).toMatch(/bottom:\s*0/)
    expect(strip).toMatch(/height:\s*2px/)
    expect(strip).toMatch(/background:\s*color-mix\(in srgb, var\(--border\) 60%, var\(--fg\) 40%\)/)
    expect(strip).toMatch(/pointer-events:\s*none/)
  })
})
