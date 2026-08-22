/**
 * Table view (GRO-2136): BaseView mounted with react-dom in jsdom over `TEST_RECORDS`; a
 * `type: table` view renders the real `<table>` (typed cells, column resize, summary row,
 * keyboard navigation, windowing) while other view types keep the placeholder list.
 * `onChange` swaps in the new `ParsedBase` and re-renders, so assertions read the YAML the
 * file would get (`serializeBase`) next to the DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type BaseDefinition, type ParsedBase, parseBase, serializeBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** file.name plus one column per value type, and a formula the evaluator cannot resolve. */
const TYPED_BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
      - note.published
      - note.tags
      - note.related
      - formula.nope
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<BaseViewProps> = {}) {
  let parsed = parseBase(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedBase) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <BaseView
          parsed={parsed}
          onChange={onChange}
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          indexStatus="ready"
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeBase(parsed), def: (): BaseDefinition => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function byText<T extends HTMLElement>(el: ParentNode, sel: string, text: string): T {
  const n = [...el.querySelectorAll<T>(sel)].find((x) => x.textContent === text)
  if (n === undefined) throw new Error(`missing ${sel} "${text}"`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

function mouse(el: EventTarget, type: string, clientX: number): void {
  act(() => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })))
  draw()
}

const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.base-table th')].map((t) => t.textContent ?? '')
const links = (el: ParentNode): string[] => [...el.querySelectorAll('.base-table__link')].map((b) => b.textContent ?? '')
/** Data rows only (spacers excluded). */
const bodyRows = (el: ParentNode): HTMLTableRowElement[] => [...el.querySelectorAll<HTMLTableRowElement>('.base-table tbody tr:not(.base-table__spacer)')]
const cells = (row: HTMLTableRowElement): HTMLTableCellElement[] => [...row.querySelectorAll('td')]

/** 600 empty notes for the windowing tests. */
function manyRecords(n = 600): IndexRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const basename = `n${String(i).padStart(3, '0')}`
    return {
      path: `/vault/${basename}.md`,
      name: `${basename}.md`,
      basename,
      folder: '',
      ext: 'md',
      size: 0,
      ctime: 0,
      mtime: 0,
      properties: {},
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    }
  })
}

// ---------- tests ----------

describe('table structure', () => {
  it('a table view renders columns from order; unknown view types keep the placeholder list', () => {
    const { el } = mount(`${TYPED_BASE}  - type: bogus\n    name: L\n`)
    expect(headers(el)).toEqual(['file.name', 'priority', 'published', 'tags', 'related', 'formula.nope'])
    expect(bodyRows(el)).toHaveLength(8)
    expect(links(el)[0]).toBe('Agentic Agency.md')
    expect(el.querySelector('.base-rows')).toBeNull()

    click(byText(el, '[role="tab"]', 'L'))
    expect(el.querySelector('.base-table')).toBeNull()
    expect(el.querySelectorAll('.base-row')).toHaveLength(8)
  })

  it('header labels use displayName when set', () => {
    const { el } = mount(`${TYPED_BASE}properties:\n  priority:\n    displayName: Rank\n`)
    expect(headers(el)[1]).toBe('Rank')
  })
})

describe('cells by type', () => {
  it('numbers right-align, booleans are read-only checkboxes, lists and links are chips, errors are #ERROR chips', () => {
    const { el } = mount(TYPED_BASE)
    const [agentic, levels, creator] = bodyRows(el)

    // number (priority 2), right-aligned
    const num = cells(agentic)[1]
    expect(num.textContent).toBe('2')
    expect(num.className).toContain('base-table__cell--num')

    // checkbox (published: false / true), live editor (5B, GRO-2142)
    const off = q<HTMLInputElement>(cells(agentic)[2], 'input[type="checkbox"]')
    expect(off.checked).toBe(false)
    expect(off.disabled).toBe(false)
    expect(q<HTMLInputElement>(cells(creator)[2], 'input[type="checkbox"]').checked).toBe(true)

    // list (tags) as chips
    const chips = [...cells(agentic)[3].querySelectorAll('.base-table__chip')].map((c) => c.textContent)
    expect(chips).toEqual(['agentic', 'pillar'])

    // link ([[Agentic Agency]]) as a link chip
    const link = q(cells(levels)[4], '.base-table__chip--link')
    expect(link.textContent).toBe('Agentic Agency')

    // error (unknown formula) as a red #ERROR chip with the message in title
    const err = q<HTMLElement>(cells(agentic)[5], '.base-table__chip--error')
    expect(err.textContent).toBe('#ERROR')
    expect(err.title).toBe('unknown formula nope')

    // missing value renders empty (related is unset on the first note)
    expect(cells(agentic)[4].textContent).toBe('')
  })
})

describe('file.name link', () => {
  it('clicking the name cell link opens the note', () => {
    const { el, onOpenFile, onChange } = mount(TYPED_BASE)
    click(q(el, '.base-table__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('column resize', () => {
  it('dragging a header handle previews the width and writes columnSize once on mouseup', () => {
    const { el, onChange, def, yaml } = mount(TYPED_BASE)
    const handle = el.querySelectorAll('.base-table__resize')[1] // note.priority
    mouse(handle, 'mousedown', 100)
    mouse(window, 'mousemove', 130)
    expect(onChange).not.toHaveBeenCalled()
    expect(q<HTMLElement>(el, '.base-table th:nth-child(2)').style.width).toBe('180px') // 150 default + 30
    mouse(window, 'mouseup', 130)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 180 })
    expect(yaml()).toContain('columnSize:')
    expect(yaml()).toContain('note.priority: 180')
  })

  it('a drag starts from the stored width and clamps at the minimum', () => {
    const { el, def } = mount(`${TYPED_BASE.replace('name: T\n', 'name: T\n    columnSize:\n      note.priority: 90\n')}`)
    expect(q<HTMLElement>(el, '.base-table th:nth-child(2)').style.width).toBe('90px')
    const handle = el.querySelectorAll('.base-table__resize')[1]
    mouse(handle, 'mousedown', 200)
    mouse(window, 'mousemove', 0)
    mouse(window, 'mouseup', 0)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 60 })
  })
})

describe('summary row', () => {
  const SUM_BASE = `summaries:
  Total: '"n=" + values.length'
views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
`

  it('the chooser lists built-ins plus custom names, writes view.summaries and shows the value', () => {
    const { el, onChange, def, yaml } = mount(SUM_BASE)
    click(byLabel(el, 'Summarize priority'))
    const pop = q(el, '.base-popover')
    const items = [...pop.querySelectorAll('.base-popover__item')].map((b) => b.textContent)
    expect(items[0]).toBe('None')
    expect(items).toContain('Sum')
    expect(items).toContain('Total')
    click(byText(pop, '.base-popover__item', 'Sum'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].summaries).toEqual({ 'note.priority': 'Sum' })
    expect(yaml()).toContain('note.priority: Sum')
    expect(el.querySelector('.base-popover')).toBeNull()
    expect(byLabel(el, 'Summarize priority').textContent).toBe('Sum6') // priorities 2 + 1 + 3
  })

  it('a custom summary evaluates with values bound to the column; None deletes the key', () => {
    const { el, def, yaml } = mount(SUM_BASE.replace('name: T\n', 'name: T\n    summaries:\n      note.priority: Total\n'))
    expect(byLabel(el, 'Summarize priority').textContent).toBe('Totaln=8')
    click(byLabel(el, 'Summarize priority'))
    click(byText(el, '.base-popover__item', 'None'))
    expect(def().views[0].summaries).toBeUndefined()
    expect(yaml()).not.toContain('note.priority: Total')
  })
})

describe('keyboard navigation', () => {
  it('arrow keys move the focused cell; Enter on a file.name cell opens the note', () => {
    const { el, onOpenFile } = mount(TYPED_BASE)
    const cell = (r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
    act(() => cell(0, 0).focus())
    press(cell(0, 0), 'ArrowRight')
    expect(document.activeElement).toBe(cell(0, 1))
    press(cell(0, 1), 'ArrowDown')
    expect(document.activeElement).toBe(cell(1, 1))
    press(cell(1, 1), 'ArrowLeft')
    expect(document.activeElement).toBe(cell(1, 0))
    press(cell(1, 0), 'ArrowUp')
    expect(document.activeElement).toBe(cell(0, 0))
    press(cell(0, 0), 'ArrowUp') // clamped at the edges
    expect(document.activeElement).toBe(cell(0, 0))
    press(cell(0, 0), 'ArrowDown')
    press(cell(1, 0), 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md')
  })

  it('Enter on a non-name cell starts editing instead of opening (5B, GRO-2142)', () => {
    const { el, onOpenFile } = mount(TYPED_BASE)
    const cell = q<HTMLElement>(el, '[data-cell="0:1"]')
    act(() => cell.focus())
    press(cell, 'Enter')
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(cell.querySelector('input')).not.toBeNull()
  })
})

describe('row height', () => {
  it('rowHeight presets set the CSS variable on the table', () => {
    const tall = mount(TYPED_BASE.replace('name: T\n', 'name: T\n    rowHeight: tall\n'))
    expect(q<HTMLElement>(tall.el, '.base-table').style.getPropertyValue('--base-table-row-h')).toBe('68px')
    act(() => root?.unmount())
    container?.remove()
    const short = mount(TYPED_BASE)
    expect(q<HTMLElement>(short.el, '.base-table').style.getPropertyValue('--base-table-row-h')).toBe('28px')
  })
})

describe('windowing', () => {
  it('with more than 500 rows only a slice of <tr>s is in the DOM, padded by spacer rows', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n', { records: manyRecords() })
    expect(q(el, '.base-toolbar__count').textContent).toBe('600 items')
    expect(bodyRows(el).length).toBeLessThan(100)
    expect(links(el)[0]).toBe('n000.md')
    expect(links(el)).not.toContain('n599.md')
    expect(el.querySelector('.base-table__spacer')).not.toBeNull()
  })

  it('scrolling moves the rendered slice', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n', { records: manyRecords() })
    const wrap = q<HTMLElement>(el, '.base-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 5000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    expect(links(el)).not.toContain('n000.md')
    expect(bodyRows(el).length).toBeLessThan(100)
    expect(links(el).length).toBeGreaterThan(0)
  })

  it('500 rows or fewer render in full, no spacers', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n', { records: manyRecords(500) })
    expect(bodyRows(el)).toHaveLength(500)
    expect(el.querySelector('.base-table__spacer')).toBeNull()
  })
})
