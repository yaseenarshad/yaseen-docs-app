/**
 * Header drag-to-reorder (YAZ-1548): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`;
 * a property `<th>` drags, the hovered header shows the slot on its left or right half, and the
 * drop is ONE `view.order` write through the shared `setViewOrder` — the Properties list's own
 * writer — so `frozenColumns` follows positionally exactly as it does there. The `#` gutter is
 * neither source nor target, the resize grip never starts a drag, a self-drop writes nothing, and
 * Esc cancels. Same synthetic-drag harness as `GroupDrag.test.tsx` and the Properties reorder
 * tests: `MouseEvent`s carry the pointer, `dataTransfer` is absent and guarded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { propertyKeys } from '../engine'
import { type ParsedViews, type ViewSet, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const HOST = testFolderHost()

const BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = BASE, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={HOST} onOpenFile={vi.fn()} {...props} />,
      ),
    )
  draw()
  return { el: container, onChange, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
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

/**
 * The slot is read from where the LAYOUT puts each column (YAZ-4606): the header row starts at x 0 in jsdom, and each
 * cell is as wide as its own style says. On a property header, `half` is px from its midpoint (negative: its left half).
 */
function headerPoint(th: Element, half: number): number {
  const cells = [...(th.parentElement?.children ?? [])] as HTMLElement[]
  const left = cells.slice(0, cells.indexOf(th as HTMLElement)).reduce((x, cell) => x + parseFloat(cell.style.width), 0)
  return left + parseFloat((th as HTMLElement).style.width) / 2 + half
}

/** A synthetic drag event: jsdom has no `DragEvent`, so a `MouseEvent` carries the pointer and `dataTransfer` is absent. */
function fire(target: Element, type: string, half = 0): MouseEvent {
  const clientX = target.matches('thead th[data-col]') ? headerPoint(target, half) : half
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX })
  act(() => void target.dispatchEvent(event))
  draw()
  return event
}

function pressEscape(): void {
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  draw()
}

/** The property headers (the `#` gutter excluded), in order. */
const ths = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')]
const headers = (el: ParentNode): string[] => ths(el).map((t) => t.textContent ?? '')
const gutter = (el: ParentNode): HTMLElement => q(el, '.view-table thead th.view-table__gutter')
/** Left half of a header: the slot BEFORE it; right half: AFTER it. */
const LEFT = -5
const RIGHT = 5

// ---------- tests ----------

describe('header drag-to-reorder (YAZ-1548)', () => {
  it('property headers are draggable; the # gutter is not', () => {
    const { el } = mount()
    for (const th of ths(el)) expect(th.getAttribute('draggable')).toBe('true')
    expect(gutter(el).getAttribute('draggable')).not.toBe('true')
  })

  it('moves a column RIGHT: dropping on the right half of a later header lands after it, in ONE write', () => {
    const { el, onChange, def, yaml } = mount()
    fire(ths(el)[0], 'dragstart')
    expect(q(el, '.view-table').hasAttribute('data-live-parting')).toBe(true) // the gap is the marker: no marker class (YAZ-4606)
    fire(ths(el)[2], 'dragover', RIGHT)
    expect(rules(el)).toMatch(/th\[data-col="2"\][^{]*\{transform:translateX\(-/) // the end slot: the columns after the grab slide left
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['note.status', 'note.priority', 'file.name'])
    expect(headers(el)).toEqual(['Status', 'Priority', 'Name'])
    expect(yaml()).toContain('- note.status\n      - note.priority\n      - file.name')
    expect(rules(el)).toBe('') // the slides cleared
    expect(q(el, '.view-table').hasAttribute('data-live-parting')).toBe(false)
  })

  it('moves a column LEFT: dropping on the left half of an earlier header lands before it', () => {
    const { el, onChange, def } = mount()
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', LEFT)
    expect(rules(el)).toMatch(/th\[data-col="0"\][^{]*\{transform:translateX\(\d/) // Name slides right: the gap opens before it
    fire(ths(el)[0], 'drop', LEFT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
  })

  it('the slot follows the cursor half: right half of the FIRST header is between it and the second', () => {
    const { el, def } = mount()
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', RIGHT)
    expect(rules(el)).toMatch(/th\[data-col="1"\][^{]*\{transform:translateX\(\d/) // Status slides right, Name stays
    expect(rules(el)).not.toContain('th[data-col="0"]')
    fire(ths(el)[0], 'drop', RIGHT)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
  })

  it('INTO the frozen prefix: the prefix is positional (YAZ-1007), so the column dropped into it freezes and the one pushed out thaws', () => {
    const { el, def } = mount(`${BASE}    frozenColumns: 1\n`)
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, false, false])
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'drop', LEFT)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(1)
    expect(headers(el)).toEqual(['Priority', 'Name', 'Status'])
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, false, false])
  })

  it('OUT of the frozen prefix: a frozen header drags too, and the count stays — the next column takes its place in the prefix', () => {
    const { el, def } = mount(`${BASE}    frozenColumns: 2\n`)
    fire(ths(el)[0], 'dragstart')
    fire(ths(el)[2], 'drop', RIGHT)
    expect(def().views[0].order).toEqual(['note.status', 'note.priority', 'file.name'])
    expect(def().views[0].frozenColumns).toBe(2)
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, true, false])
  })

  it('a self-drop — either half of the grabbed header — writes NOTHING', () => {
    const { el, onChange } = mount()
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[1], 'drop', LEFT)
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[1], 'drop', RIGHT)
    // …and so does a drop that lands the column exactly where it already is
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[0], 'drop', RIGHT) // the slot between 0 and 1 = its own place
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[2], 'drop', LEFT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the # gutter is not a drop target: dragover is not accepted, a drop there writes nothing, and nothing lands before it', () => {
    const { el, onChange } = mount()
    fire(ths(el)[1], 'dragstart')
    const over = fire(gutter(el), 'dragover', RIGHT)
    expect(over.defaultPrevented).toBe(false)
    fire(gutter(el), 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
    expect(gutter(el).className).not.toContain('view-table__th--')
    // the leftmost slot is BEFORE the first property header — still after the gutter
    fire(ths(el)[0], 'drop', LEFT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(headers(el)).toEqual(['Status', 'Name', 'Priority'])
    expect(gutter(el).textContent).toBe('#')
  })

  it('the resize grip does not start a drag: a dragstart there is refused and nothing later drops', () => {
    const { el, onChange } = mount()
    const grip = q<HTMLElement>(ths(el)[0], '.view-table__resize')
    const start = fire(grip, 'dragstart')
    expect(start.defaultPrevented).toBe(true)
    expect(q(el, '.view-table').hasAttribute('data-live-parting')).toBe(false)
    const over = fire(ths(el)[2], 'dragover', RIGHT)
    expect(over.defaultPrevented).toBe(false)
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Esc cancels an in-flight drag: the indicator clears and a later drop writes nothing', () => {
    const { el, onChange } = mount()
    fire(ths(el)[0], 'dragstart')
    fire(ths(el)[2], 'dragover', RIGHT)
    expect(rules(el)).toContain('transform:translateX(-')
    pressEscape()
    expect(rules(el)).toBe('')
    expect(q(el, '.view-table').hasAttribute('data-live-parting')).toBe(false)
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a view with NO explicit order writes the full current keys list in the new order — what the Properties list does on its first reorder', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n')
    expect(def().views[0].order).toBeUndefined()
    const before = propertyKeys(def(), def().views[0], TEST_RECORDS)
    expect(before[0]).toBe('file.name')
    expect(before.length).toBeGreaterThan(3)
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[0], 'drop', LEFT)
    const [first, second, ...rest] = before
    expect(def().views[0].order).toEqual([second, first, ...rest])
  })

  /** The rule TableView writes for the drag (YAZ-4606): one per moved column. */
  const rules = (el: ParentNode): string => el.querySelector('style')?.textContent ?? ''
  /** A column's width, from its header's style. */
  const widthAt = (el: ParentNode, i: number): number => parseFloat(ths(el)[i].style.width)

  it('LIVE GAP (YAZ-4606): the columns between the grab and the slot part by its room — header, body cells and summary cell — and the grabbed column leaves one frame on', async () => {
    const { el } = mount()
    fire(ths(el)[0], 'dragstart')
    expect(rules(el)).toBe('') // the Mac takes its picture first
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())))
    draw()
    expect(rules(el)).toContain('th[data-col="0"]')
    expect(rules(el)).toContain('opacity:0')
    fire(ths(el)[2], 'dragover', RIGHT) // the end slot
    const room = widthAt(el, 0)
    for (const c of [1, 2]) {
      expect(rules(el)).toMatch(new RegExp(`th\\[data-col="${c}"\\],[^{]*td\\[data-cell\\$=":${c}"\\],[^{]*tfoot td:nth-child\\(${c + 2}\\)\\{transform:translateX\\(-${room}px\\)`))
    }
    expect(el.querySelector('.view-table')!.hasAttribute('data-live-parting')).toBe(true)
    // A body cell of a parted column is one the rule names.
    expect(el.querySelector('td[data-cell$=":1"]')).not.toBeNull()
    fire(ths(el)[2], 'drop', RIGHT)
    expect(rules(el)).toBe('')
    expect(el.querySelector('.view-table')!.hasAttribute('data-live-parting')).toBe(false)
  })

  it('LIVE GAP across the freeze line (YAZ-4606, coordinator ruling B): a column dragged into the frozen part parts the frozen column too, and the drop freezes it', () => {
    const { el, def } = mount(`${BASE}    frozenColumns: 1\n`)
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', LEFT)
    const room = widthAt(el, 2)
    expect(rules(el)).toContain(`tfoot td:nth-child(2){transform:translateX(${room}px);}`)
    expect(rules(el)).toContain(`tfoot td:nth-child(3){transform:translateX(${room}px);}`)
    fire(ths(el)[0], 'drop', LEFT)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(1)
  })

  it('the slot is read from the layout, not the drawn header: a parted header under the pointer does not move the gap', () => {
    const { el } = mount()
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', LEFT) // the first slot: Name and Status slide right
    expect(rules(el)).toMatch(/th\[data-col="0"\][^{]*\{transform:translateX\(\d/)
    // Name is drawn one room on now; a pointer on its drawn left half is on Status's right half in the layout.
    fire(ths(el)[1], 'dragover', RIGHT)
    expect(rules(el)).not.toContain('transform') // the slot next to Priority: no gap
  })

  it('COUNT (YAZ-4606): a dragover reads the header row\'s place and the scroller\'s, and no cell', () => {
    const { el } = mount(`${BASE}    frozenColumns: 1\n`)
    fire(ths(el)[0], 'dragstart')
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const style = vi.spyOn(window, 'getComputedStyle')
    for (let i = 0; i < 10; i++) {
      act(() => void ths(el)[2].dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: headerPoint(ths(el)[2], i - 5) })))
    }
    expect(rect.mock.instances.filter((t) => t instanceof HTMLTableCellElement)).toHaveLength(0)
    expect(rect).toHaveBeenCalledTimes(20) // the header row (the slot) and the table's scroller (its end zones), once each
    expect(style).not.toHaveBeenCalled()
    rect.mockRestore()
    style.mockRestore()
  })

  it('keyboard navigation, resize and the header menu keep working around the drag wiring', () => {
    const { el, def } = mount()
    // resize still writes columnSize through mouseup, untouched by the drag handlers
    const grip = q<HTMLElement>(ths(el)[1], '.view-table__resize')
    act(() => void grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 })))
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130 })))
    act(() => void window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 130 })))
    draw()
    expect(def().views[0].columnSize).toEqual({ 'note.status': 180 })
    // arrow keys still walk the data cells
    const cell = q<HTMLElement>(el, '[data-cell="0:0"]')
    act(() => cell.focus())
    act(() => void cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement?.getAttribute('data-cell')).toBe('0:1')
    // the header menu still opens on right-click
    act(() => void ths(el)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    draw()
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
  })
})
