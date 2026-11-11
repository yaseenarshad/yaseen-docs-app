/**
 * Wrap or Clip per column (YAZ-4582, D29): ViewsPane mounted in jsdom. With no choice a column goes by its kind, as on
 * `main`: a chip column (list, link, select…) wraps and its row grows; a text, number or date column is one line with
 * the full value in `title`. `view.columnWrap[<canonical key>]` chooses: `true` Wrap, `false` Clip. A windowed table
 * clips every cell, so each line is exactly the row height. Frozen rows stick by their measured heights.
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

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
      - note.tags
      - note.status
    sort:
      - property: file.name
        direction: ASC
${extra}`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})
/** 600 notes, n000…n599, for the windowing case. */
const manyRecords = (n = 600): IndexRecord[] => Array.from({ length: n }, (_, i) => rec(`n${String(i).padStart(3, '0')}`, { tags: ['a', 'b'], status: 'idea' }))

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const records = props.records ?? TEST_RECORDS
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={records} folder={testFolderHost({ vaultRecords: records })} onOpenFile={vi.fn()} {...props} />),
    )
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  draw()
  return { el: container, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const items = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
const item = (el: ParentNode, label: string) => {
  const found = items(el).find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`no item ${label}: ${items(el).map((b) => b.textContent).join(', ')}`)
  return found
}
function rightClick(target: Element): void {
  act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
}
/** Right-click a header and open its Text › flyout (YAZ-4588 D42): its Wrap / Clip rows (the first group; the Align group follows since YAZ-3746 13Y, `TableAlign.test.tsx`), the ✓ read from `data-hint`. */
function textMenu(target: Element): string[] {
  rightClick(target)
  act(() => item(document.body, 'Text').click())
  return [...document.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="group"]:first-child [role="menuitem"]')].map((b) => `${b.getAttribute('data-hint') === '✓' ? '✓ ' : ''}${b.textContent}`)
}
/** The body cells of column `c`, in row order. */
const column = (el: ParentNode, c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)]
const CLIP = 'view-table__cell--clip'

describe('"Wrap text" and "Clip text" in the column header menu (YAZ-4582, D29)', () => {
  it('a chip column (Tags, a list) has ✓ Wrap text; Clip text writes columnWrap[canonical key] = false, and Wrap text deletes it and the empty map', () => {
    const { el, yaml } = mount(table())
    expect(textMenu(th(el, 1))).toEqual(['✓ Wrap text', 'Clip text'])
    act(() => item(el, 'Clip text').click())
    expect(yaml()).toContain('columnWrap:\n      note.tags: false')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    expect(textMenu(th(el, 1))).toEqual(['Wrap text', '✓ Clip text'])
    act(() => item(el, 'Wrap text').click())
    expect(yaml()).not.toContain('columnWrap')
  })

  it('a text column (Status) has ✓ Clip text; Wrap text writes columnWrap[canonical key] = true, and Clip text deletes it', () => {
    const { el, yaml } = mount(table())
    expect(textMenu(th(el, 2))).toEqual(['Wrap text', '✓ Clip text'])
    act(() => item(el, 'Wrap text').click())
    expect(yaml()).toContain('columnWrap:\n      note.status: true')
    expect(column(el, 2).some((td) => td.classList.contains(CLIP))).toBe(false)

    expect(textMenu(th(el, 2))).toEqual(['✓ Wrap text', 'Clip text'])
    act(() => item(el, 'Clip text').click())
    expect(yaml()).not.toContain('columnWrap')
  })

  it('reads a key in any spelling, and the by-kind choice removes that spelling; other columns keep theirs', () => {
    const { el, yaml } = mount(table('    columnWrap:\n      tags: false\n      note.status: true\n'))
    expect(column(el, 1).every((td) => td.classList.contains(CLIP))).toBe(true)
    expect(column(el, 2).some((td) => td.classList.contains(CLIP))).toBe(false)
    textMenu(th(el, 1))
    act(() => item(el, 'Wrap text').click())
    expect(yaml()).toContain('columnWrap:\n      note.status: true')
    expect(yaml()).not.toContain('tags:')
  })

  it('the two items are the Text › flyout, after Sort › and Group › (YAZ-4588 D42)', () => {
    const { el } = mount(table())
    rightClick(th(el, 1))
    const parents = [...el.querySelectorAll('.ctx-menu [aria-haspopup="menu"]')].map((b) => b.textContent)
    // Then the column's fill flyout, in its own group (YAZ-3746 13AQ), and the header row's look (YAZ-4794).
    expect(parents).toEqual(['Sort', 'Group', 'Text', 'Fill column', 'Header row'])
  })
})

describe('the ✓ and the cells read the kind from ONE source (YAZ-4544 4E)', () => {
  it('a column that is a list in the shown rows and text in the hidden ones: the menu ✓ and the cells agree', () => {
    const records = [rec('A', { mixed: ['x', 'y'], status: 'keep' }), rec('B', { mixed: 't', status: 'drop' }), rec('C', { mixed: 'u', status: 'drop' })]
    const { el } = mount(`views:
  - type: table
    name: T
    order:
      - file.name
      - note.mixed
    filters: status == "keep"
`, { records })
    expect(column(el, 1)).toHaveLength(1)
    const clipped = column(el, 1).some((td) => td.classList.contains(CLIP))
    expect(textMenu(th(el, 1))).toEqual(clipped ? ['Wrap text', '✓ Clip text'] : ['✓ Wrap text', 'Clip text'])
  })
})

describe('the cells of a Wrap or a Clip column (YAZ-4582)', () => {
  it('with no choice: the chip column wraps, with no clip class and no tooltip; the text column clips, its full value kept for the tooltip', () => {
    const { el } = mount(table())
    expect(column(el, 1).some((td) => td.classList.contains(CLIP) || td.hasAttribute('data-clip-title'))).toBe(false)
    const status = column(el, 2)
    expect(status.every((td) => td.classList.contains(CLIP))).toBe(true)
    expect(status[0].dataset.clipTitle).toBe('idea')
  })

  it('YAZ-4867: the tooltip shows on hover only when the text is really cut', () => {
    const { el } = mount(table())
    const cell = column(el, 2)[0]
    const widths = (scroll: number, client: number) => {
      Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: scroll })
      Object.defineProperty(cell, 'clientWidth', { configurable: true, value: client })
    }
    const hover = () => act(() => cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
    widths(40, 120) // "idea" fits: no tooltip
    hover()
    expect(cell.hasAttribute('title')).toBe(false)
    widths(300, 120) // the column got narrow: cut, so the full value shows
    hover()
    expect(cell.title).toBe('idea')
    widths(40, 120) // wide again: the tooltip goes
    hover()
    expect(cell.hasAttribute('title')).toBe(false)
  })

  it('a clipped chip column has its whole list in title', () => {
    const { el } = mount(table('    columnWrap:\n      note.tags: false\n'))
    const tags = column(el, 1)
    expect(tags.every((td) => td.classList.contains(CLIP))).toBe(true)
    // Agentic Agency's tags: the whole list, as text.
    expect(tags[0].dataset.clipTitle).toBe('agentic, pillar')
  })

  it('the Name column is one line with the title in title, unless the view wraps it', () => {
    const one = mount(table())
    expect(column(one.el, 0)[0].classList.contains(CLIP)).toBe(true)
    expect(column(one.el, 0)[0].dataset.clipTitle).toBe('Agentic Agency')
    act(() => root?.unmount())
    container?.remove()
    const wrapped = mount(table('    columnWrap:\n      file.name: true\n'))
    expect(column(wrapped.el, 0)[0].classList.contains(CLIP)).toBe(false)
  })

  it('a windowed table (more than 500 lines) clips every cell, whatever columnWrap says', () => {
    const { el } = mount(table('    columnWrap:\n      note.tags: true\n      note.status: true\n'), { records: manyRecords() })
    const cells = [...el.querySelectorAll<HTMLElement>('.view-table tbody td[data-cell]')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((td) => td.classList.contains(CLIP))).toBe(true)
  })

  it('the CSS: a wrapped cell wraps its text and chips, a clipped one is one line with "…", and its chips stay in the row height', () => {
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    const wrap = rule('.view-table tbody td')
    expect(wrap).toMatch(/white-space:\s*normal/)
    expect(wrap).toMatch(/height:\s*var\(--view-table-row-h, 28px\)/)
    const clip = rule('.view-table tbody td.view-table__cell--clip')
    expect(clip).toMatch(/white-space:\s*nowrap/)
    expect(clip).toMatch(/overflow:\s*hidden/)
    expect(clip).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.view-table tbody td.view-table__cell--clip .property-choice-chips')).toMatch(/flex-wrap:\s*nowrap/)
    expect(rule('.view-table tbody td.view-table__cell--clip .property-choice-chip')).toMatch(/line-height:\s*17px/)
    // No chip rule outside the clip class: a Wrap column's chips wrap and keep their size.
    expect(viewsCss).not.toMatch(/\n\.view-table tbody td \.property-choice-chips?\s*\{/)
  })
})

describe('frozen rows with rows of different heights (YAZ-4582)', () => {
  /** Line heights by the row's Name: a wrapped Attribution is 60px; every other line 28px; the header 31px. */
  function fakeHeights(heights: Record<string, number> = { Attribution: 60 }) {
    vi.spyOn(HTMLTableSectionElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 31))
    return vi.spyOn(HTMLTableRowElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLTableRowElement) {
      return new DOMRect(0, 0, 400, heights[this.querySelector('.view-table__name')?.textContent ?? ''] ?? 28)
    })
  }
  const tops = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('.view-table tbody tr.view-table__row--frozen')].map((tr) => tr.style.getPropertyValue('--view-frozen-top'))

  it('a frozen row taller than the row height pushes the next frozen line down by its real height', () => {
    fakeHeights()
    const { el } = mount(table('    frozenRows: 3\n'))
    // Agentic Agency 28, Attribution 60, then Creator Economy.
    expect(tops(el)).toEqual(['31px', '59px', '119px'])
  })

  it('a ResizeObserver watches the header and the frozen lines only, and a resize measures again; a scroll reads nothing', () => {
    const observed: Element[] = []
    const callbacks: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callbacks.push(cb)
        }
        observe(t: Element) {
          observed.push(t)
        }
        unobserve() {}
        disconnect() {}
      },
    )
    const heights: Record<string, number> = { Attribution: 60 }
    const rect = fakeHeights(heights)
    const { el } = mount(table('    frozenRows: 2\n'), { records: manyRecords().map((r, i) => (i === 0 ? { ...r, title: 'Attribution' } : r)) })
    const frozen = [...el.querySelectorAll('.view-table tbody tr.view-table__row--frozen')]
    expect(frozen).toHaveLength(2)
    const rows = observed.filter((t) => t instanceof HTMLTableRowElement)
    expect(rows).toEqual(frozen)
    expect(tops(el)).toEqual(['31px', '91px'])

    const reads = rect.mock.calls.length
    const wrap = q<HTMLElement>(el, '.view-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 4000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(rect.mock.calls.length).toBe(reads)
    expect(observed.filter((t) => t instanceof HTMLTableRowElement)).toHaveLength(2)

    heights.Attribution = 28
    act(() => callbacks.forEach((cb) => cb()))
    expect(tops(el)).toEqual(['31px', '59px'])
  })

  it('the CSS: a frozen cell sticks at its measured top, with the old sum as the fallback', () => {
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    expect(rule('.view-table tbody tr.view-table__row--frozen > td')).toMatch(/top:\s*var\(--view-frozen-top, calc\(var\(--view-table-head-h, 0px\) \+ var\(--view-frozen-i, 0\) \* var\(--view-table-row-h, 28px\)\)\)/)
  })
})
