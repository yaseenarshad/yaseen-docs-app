/**
 * Frozen rows and columns of a page table (YAZ-3769, YAZ-3696 S3) on the real editor in jsdom: the
 * frozen cells' decorations, the columns' sticky offsets, and the rows' offset on a scroll of the
 * note (the folder page's method, `lib/pinnedHeader.ts`): it follows the scroll, stops at the
 * table's end, keeps one value at each document zoom, and its listeners go when the table unfreezes; and
 * the column handle under a pinned header (YAZ-4170).
 * jsdom has no layout, so the boxes are given by hand, and no Web Animations, so `animate` is stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { TABLE_HANDLE_MENU } from '../pageMenu'
import { cellPos } from './tableTestKit'
import { setStickyHeaderSetting } from './timeFormatSetting'

const mounted: Array<{ crepe: Crepe; scroller: HTMLElement }> = []
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.scroller.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
  moved.clear()
  setStickyHeaderSetting(true)
})

/** Web Animations, which jsdom lacks: the `translateY` that each row's animation holds now. */
const moved = new Map<Element, string>()
const keep = (el: Element, keyframes: Keyframe[]) => moved.set(el, /translateY\((.*)\)/.exec(String(keyframes[0]!.transform))![1]!)
function animateStub(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  expect(options).toEqual({ duration: 0, fill: 'forwards' })
  keep(this, keyframes)
  return { effect: { setKeyframes: (next: Keyframe[]) => keep(this, next) }, cancel: () => moved.delete(this) }
}
/** Each row's offset, top to bottom; '' for a row that does not move. */
const offsets = (view: EditorView) => rowsOf(view).map((row) => moved.get(row) ?? '')

const TABLE = '| h1 | h2 | h3 |\n| -- | -- | -- |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n'
const box = (top: number, height: number) => new DOMRect(0, top, 300, height)

/**
 * A note in a vertical scroller; every frame is held until `flush`. Rows are 30 px, the table starts at `tableTop`.
 * `tableZoom` is the table's own zoom (YAZ-4091): the table and its rows are drawn at both zooms, the block at the page's.
 */
async function mount(comment: string, { tableTop = -80, zoom = 1, tableZoom = 1, stickyHeader = false } = {}) {
  // The tests of the freeze itself run with Settings › Sticky header row Off (YAZ-4899 round 2): with it On, every
  // table has a frozen header row. `stickyHeader` mounts with it On.
  setStickyHeaderSetting(stickyHeader)
  Object.assign(HTMLElement.prototype, { animate: animateStub })
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  const root = document.createElement('div')
  scroller.appendChild(root)
  document.body.appendChild(scroller)
  scroller.getBoundingClientRect = () => box(0, 400 * zoom)
  // The boxes exist before the editor measures.
  let top = tableTop
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = realCreate(tag, options)
    if (tag === 'table') {
      el.getBoundingClientRect = () => box(top * zoom, 150 * zoom * tableZoom)
      Object.defineProperty(el, 'currentCSSZoom', { value: zoom * tableZoom, configurable: true })
    }
    // A row of a folded run (YAZ-4165) is `display: none`: no box.
    if (tag === 'tr') el.getBoundingClientRect = () => (el.classList.contains('table-fold-hidden') ? new DOMRect() : box((top + 30 * tableZoom * (el as HTMLTableRowElement).rowIndex) * zoom, 30 * zoom * tableZoom))
    if (tag === 'th' || tag === 'td') Object.defineProperty(el, 'offsetWidth', { value: 100 })
    return el
  })
  const crepe = createCrepe({ root, defaultValue: `${TABLE}\n${comment}\n` })
  await crepe.create()
  mounted.push({ crepe, scroller })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const block = view.dom.querySelector<HTMLElement>('.milkdown-table-block')!
  Object.defineProperty(block, 'currentCSSZoom', { value: zoom, configurable: true })
  return {
    view,
    crepe,
    block,
    frames,
    scroller,
    tableTop: () => top,
    setTableTop: (next: number) => {
      top = next
    },
    scroll: () => scroller.dispatchEvent(new Event('scroll')),
    flush: () => {
      for (const frame of frames.splice(0)) frame(0)
    },
  }
}

const rowsOf = (view: EditorView) => [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')]
const tablePos = (view: EditorView) => {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'table') found = pos
    return found < 0
  })
  return found
}
const setFreeze = (view: EditorView, rows: number, cols: number) => {
  const pos = tablePos(view)
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos)!.attrs, freezeRows: rows, freezeCols: cols }))
}

describe('the sticky header row (YAZ-4899 round 2): the header row frozen by Settings, a table\'s own choice or freeze over it', () => {
  const frozenRows = (view: EditorView) => rowsOf(view).map((row) => row.classList.contains('table-frozen-row'))
  const blockOf = (view: EditorView) => view.dom.querySelector<HTMLElement>('.milkdown-table-block')!

  it('Settings On freezes the header row of a plain table (the frozen-row classes, the block mark); Off at once clears it; On again brings it back', async () => {
    const { view, crepe } = await mount('', { stickyHeader: true })
    expect(frozenRows(view)).toEqual([true, false, false, false])
    expect(rowsOf(view)[0].classList.contains('table-frozen-row-end')).toBe(true)
    expect(blockOf(view).hasAttribute('data-table-frozen')).toBe(true)
    setStickyHeaderSetting(false)
    expect(frozenRows(view)).toEqual([false, false, false, false])
    expect(blockOf(view).hasAttribute('data-table-frozen')).toBe(false)
    setStickyHeaderSetting(true)
    expect(frozenRows(view)).toEqual([true, false, false, false])
    // No part in the file: the table follows Settings.
    expect(getMarkdownForSave(crepe)).not.toContain('table:')
  })

  it('`nostickyheader` keeps the header row free with Settings On; `stickyheader` freezes it with Settings Off; both round-trip', async () => {
    const off = await mount('<!-- table: nostickyheader -->', { stickyHeader: true })
    expect(frozenRows(off.view)).toEqual([false, false, false, false])
    expect(getMarkdownForSave(off.crepe)).toContain('<!-- table: nostickyheader -->')
    const on = await mount('<!-- table: stickyheader -->')
    expect(frozenRows(on.view)).toEqual([true, false, false, false])
    expect(getMarkdownForSave(on.crepe)).toContain('<!-- table: stickyheader -->')
  })

  it('the table\'s own freeze wins and is kept: `freeze 2 rows` freezes two rows with Settings On, and the file keeps only `freeze`', async () => {
    const { view, crepe } = await mount('<!-- table: freeze 2 rows -->', { stickyHeader: true })
    expect(frozenRows(view)).toEqual([true, true, false, false])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: freeze 2 rows -->')
    // "Unfreeze rows" (the attribute back to 0): the header row stays frozen by Settings; the file says nothing.
    setFreeze(view, 0, 0)
    expect(frozenRows(view)).toEqual([true, false, false, false])
    expect(getMarkdownForSave(crepe)).not.toContain('table:')
  })
})

describe('the frozen cells', () => {
  it('frozen rows and the cells of frozen columns carry their classes, and lose them on unfreeze', async () => {
    const { view } = await mount('<!-- table: freeze 2 rows 2 cols -->')
    expect(rowsOf(view).map((row) => row.classList.contains('table-frozen-row'))).toEqual([true, true, false, false])
    const cells = rowsOf(view)[2].cells
    expect([...cells].map((cell) => cell.classList.contains('table-frozen-col'))).toEqual([true, true, false])
    expect(cells[1].getAttribute('style')).toContain('--table-frozen-left: var(--table-frozen-x-1, 0px)')
    setFreeze(view, 0, 0)
    expect(view.dom.querySelector('.table-frozen-row, .table-frozen-col')).toBeNull()
  })

  // YAZ-3804 (4F): the thick freeze line goes after the last frozen row and the last frozen column.
  it('the last frozen row and each cell of the last frozen column carry the line\'s class; it moves with the counts', async () => {
    const { view } = await mount('<!-- table: freeze 2 rows 2 cols -->')
    const rowEnds = () => rowsOf(view).map((row) => row.classList.contains('table-frozen-row-end'))
    const colEnds = () => rowsOf(view).map((row) => [...row.cells].map((cell) => cell.classList.contains('table-frozen-col-end')))
    expect(rowEnds()).toEqual([false, true, false, false])
    expect(colEnds()).toEqual(Array.from({ length: 4 }, () => [false, true, false]))
    setFreeze(view, 1, 0)
    expect(rowEnds()).toEqual([true, false, false, false])
    expect(view.dom.querySelector('.table-frozen-col-end')).toBeNull()
    setFreeze(view, 0, 3)
    expect(view.dom.querySelector('.table-frozen-row-end')).toBeNull()
    expect(colEnds()).toEqual(Array.from({ length: 4 }, () => [false, false, true]))
  })

  it('a frozen table block carries `data-table-frozen` (its cells draw their own borders, YAZ-3788); unfreeze drops it', async () => {
    const { view, block } = await mount('<!-- table: freeze 1 row -->')
    expect(block.hasAttribute('data-table-frozen')).toBe(true)
    setFreeze(view, 0, 0)
    expect(block.hasAttribute('data-table-frozen')).toBe(false)
  })

  it('a block that scrolls sideways gets `data-table-scrolls` (its frozen columns stick, YAZ-3790); one that fits does not', async () => {
    const { view, block, flush } = await mount('<!-- table: freeze 1 col -->')
    flush()
    expect(block.hasAttribute('data-table-scrolls')).toBe(false)
    Object.defineProperty(block, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(block, 'clientWidth', { value: 600, configurable: true })
    setFreeze(view, 0, 2)
    flush()
    expect(block.hasAttribute('data-table-scrolls')).toBe(true)
    setFreeze(view, 0, 0)
    expect(block.hasAttribute('data-table-scrolls')).toBe(false)
  })

  it('a column offset is the width of the columns before it, on the table block', async () => {
    const { block, flush } = await mount('<!-- table: freeze 2 cols -->')
    flush()
    expect(block.style.getPropertyValue('--table-frozen-x-0')).toBe('0px')
    expect(block.style.getPropertyValue('--table-frozen-x-1')).toBe('100px')
    expect(block.style.getPropertyValue('--table-frozen-x-2')).toBe('')
  })
})

describe('two frozen tables and edits', () => {
  /** Each table's start, in order. */
  const tableStarts = (view: EditorView) => {
    const out: number[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') out.push(pos)
      return node.type.name !== 'table'
    })
    return out
  }
  const frozenColsOf = (table: Element) => [...table.querySelectorAll('tbody[data-content-dom] > tr:nth-child(3) > *')].map((cell) => cell.classList.contains('table-frozen-col'))

  it('two frozen tables side by side stay independent when one of them is edited', async () => {
    // The comment ends the first table: in the document the two tables touch, with no block between them.
    const { view, flush } = await mount(`<!-- table: freeze 1 row 2 cols -->\n\n${TABLE}\n<!-- table: freeze 1 row 2 cols -->`)
    const blocks = [...view.dom.querySelectorAll<HTMLElement>('.milkdown-table-block')]
    expect(blocks).toHaveLength(2)
    expect(tableStarts(view)[1]).toBe(tableStarts(view)[0] + view.state.doc.nodeAt(tableStarts(view)[0])!.nodeSize)
    flush()
    for (const block of blocks) expect(block.style.getPropertyValue('--table-frozen-x-1')).toBe('100px')
    // Type in the second table's last cell, then in the first table's.
    view.dispatch(view.state.tr.insertText('x', tableStarts(view)[1] + view.state.doc.nodeAt(tableStarts(view)[1])!.nodeSize - 4))
    flush()
    for (const block of blocks) {
      expect(block.style.getPropertyValue('--table-frozen-x-1')).toBe('100px')
      expect(frozenColsOf(block)).toEqual([true, true, false])
      expect(block.querySelector('tbody[data-content-dom] > tr')!.classList.contains('table-frozen-row')).toBe(true)
    }
    view.dispatch(view.state.tr.insertText('y', tableStarts(view)[1] - 4))
    flush()
    for (const block of blocks) {
      expect(block.style.getPropertyValue('--table-frozen-x-1')).toBe('100px')
      expect(frozenColsOf(block)).toEqual([true, true, false])
    }
  })

  it('typing in a cell maps the frozen decorations; a new row builds them again (no rebuild per key)', async () => {
    const { view } = await mount('<!-- table: freeze 1 row 1 col -->')
    const headerDecorations = () => {
      const plugin = view.state.plugins.find((p) => (p.spec.key as unknown as { key: string } | undefined)?.key === 'mdapp-table-freeze$')!
      const { set } = plugin.getState(view.state) as { set: { find: (from: number, to: number) => Array<{ from: number; type: unknown }> } }
      const header = tableStarts(view)[0] + 1
      // `find` copies each decoration out of its child set; its `type` (the attributes) is the one built.
      return set.find(header, header + 1).filter((deco) => deco.from >= header).map((deco) => deco.type)
    }
    const before = headerDecorations()
    expect(before.length).toBeGreaterThan(0)
    view.dispatch(view.state.tr.insertText('typed', tableStarts(view)[0] + view.state.doc.nodeAt(tableStarts(view)[0])!.nodeSize - 4))
    expect(headerDecorations()).toEqual(before)
    headerDecorations().forEach((type, i) => expect(type).toBe(before[i]))
    const lastRow = view.state.doc.nodeAt(tableStarts(view)[0])!.lastChild!
    view.dispatch(view.state.tr.insert(tableStarts(view)[0] + view.state.doc.nodeAt(tableStarts(view)[0])!.nodeSize - 1, lastRow.type.create(null, [...Array(lastRow.childCount)].map(() => view.state.schema.nodes.table_cell.createAndFill()!))))
    expect(headerDecorations()[0]).not.toBe(before[0])
    expect(rowsOf(view)).toHaveLength(5)
    expect(rowsOf(view)[4].cells[0].classList.contains('table-frozen-col')).toBe(true)
  })

  it('typing in a cell measures nothing (YAZ-3790); a new column width measures the columns again', async () => {
    const { view, block, flush } = await mount('<!-- table: freeze 1 row 1 col -->')
    flush()
    const set = vi.spyOn(block.style, 'setProperty')
    view.dispatch(view.state.tr.insertText('typed', tableStarts(view)[0] + view.state.doc.nodeAt(tableStarts(view)[0])!.nodeSize - 4))
    view.dispatch(view.state.tr.insertText('head', tableStarts(view)[0] + 4))
    flush()
    expect(set).not.toHaveBeenCalled()
    // A column drag sets `colwidth` on each cell of the column, the header cell too.
    const tr = view.state.tr
    view.state.doc.nodeAt(tableStarts(view)[0])!.forEach((row, offset) => {
      const pos = tableStarts(view)[0] + 1 + offset + 1
      tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos)!.attrs, colwidth: [140] })
    })
    view.dispatch(tr)
    flush()
    expect(set.mock.calls.map(([name]) => name)).toContain('--table-frozen-x-0')
  })

  it('typing keeps the frozen cells; a column inserted before a frozen column moves them', async () => {
    const { view } = await mount('<!-- table: freeze 1 row 1 col -->')
    const table = view.dom.querySelector('.milkdown-table-block')!
    view.dispatch(view.state.tr.insertText('typed', tableStarts(view)[0] + 4))
    expect(frozenColsOf(table)).toEqual([true, false, false])
    expect(rowsOf(view).map((row) => row.classList.contains('table-frozen-row'))).toEqual([true, false, false, false])
    // A new first column: it is the frozen one now, and the old first column is not.
    const start = tableStarts(view)[0]
    const tr = view.state.tr
    const { schema } = view.state
    view.state.doc.nodeAt(start)!.forEach((row, offset, r) => {
      const type = r === 0 ? schema.nodes.table_header : schema.nodes.table_cell
      tr.insert(tr.mapping.map(start + 1 + offset + 1), type.createAndFill({ alignment: null })!)
    })
    view.dispatch(tr)
    expect(frozenColsOf(table)).toEqual([true, false, false, false])
    expect(rowsOf(view)[2].cells[1].textContent).toBe('d')
  })
})

describe('the frozen rows follow the scroll (the folder-page method)', () => {
  it('moves only the frozen rows, by the scrolled distance, one update per frame; nothing on the block (YAZ-3792)', async () => {
    const { view, block, frames, scroll, flush } = await mount('<!-- table: freeze 2 rows -->')
    flush()
    scroll()
    scroll()
    expect(frames).toHaveLength(1)
    flush()
    expect(offsets(view)).toEqual(['80px', '80px', '', ''])
    // An inherited custom property on the block restyled every cell of the table on each scroll.
    expect(block.style.getPropertyValue('--table-frozen-y')).toBe('')
  })

  it('a scroll writes no property: the column offsets are not measured again, the rows move by Web Animations', async () => {
    const { view, block, scroll, flush, setTableTop } = await mount('<!-- table: freeze 2 rows 2 cols -->')
    flush()
    const set = vi.spyOn(block.style, 'setProperty')
    setTableTop(-50)
    scroll()
    flush()
    expect(set).not.toHaveBeenCalled()
    expect(offsets(view)).toEqual(['50px', '50px', '', ''])
  })

  it('stays at the table start, and stops at the table end', async () => {
    const { view, scroll, flush, setTableTop } = await mount('<!-- table: freeze 2 rows -->', { tableTop: 40 })
    scroll()
    flush()
    expect(offsets(view)[0]).toBe('0px')
    setTableTop(-400)
    scroll()
    flush()
    // The table is 150 px, the two frozen rows 60 px: they stop 90 px down.
    expect(offsets(view)[0]).toBe('90px')
  })

  // YAZ-4165: the last frozen row is hidden in a folded run; the frozen rows end at the last one shown (the bar).
  it('a folded run in the frozen rows: they stop at the table end by the rows shown', async () => {
    const { view, scroll, flush } = await mount('<!-- table: fold 3-4, freeze 4 rows -->', { tableTop: -400 })
    scroll()
    flush()
    // The table is 150 px; the rows shown of the four frozen rows are three, 90 px: they stop 60 px down.
    expect(offsets(view)).toEqual(['60px', '60px', '60px', '60px'])
  })

  it.each([
    [1, '80px'],
    [2, '80.5px'],
  ])('moves the rows by whole device pixels at %i× pixel ratio, rounded up the page (YAZ-3788)', async (ratio, offset) => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(ratio)
    const { view, scroll, flush } = await mount('<!-- table: freeze 1 row -->', { tableTop: -80.75 })
    scroll()
    flush()
    expect(offsets(view)[0]).toBe(offset)
  })

  // YAZ-4091: the rows are inside the table's zoomed content, so their offset is in its px: the screen offset ÷ both zooms.
  it.each([
    [1, 0.5],
    [0.5, 0.5],
  ])('at document zoom %s and table zoom %s the rows move by the same layout offset', async (zoom, tableZoom) => {
    // The table starts 40 layout px of the note above its top: 40 × the document zoom on screen, 80 px of the table's own.
    const { view, scroll, flush } = await mount('<!-- table: freeze 1 row, zoom 50% -->', { zoom, tableZoom, tableTop: -40 })
    scroll()
    flush()
    expect(offsets(view)[0]).toBe('80px')
  })

  it.each([0.5, 2])('keeps the same layout offset at %× document zoom', async (zoom) => {
    const { view, scroll, flush } = await mount('<!-- table: freeze 1 row -->', { zoom })
    scroll()
    flush()
    expect(offsets(view)[0]).toBe('80px')
  })

  it('a frozen row that the editor draws again gets its offset back, with no scroll', async () => {
    const { view, scroll, flush } = await mount('<!-- table: freeze 2 rows -->')
    scroll()
    flush()
    // A new row node in place of the second frozen row (as a sort does): ProseMirror draws a new <tr>.
    const start = tablePos(view)
    const table = view.state.doc.nodeAt(start)!
    const second = start + 1 + table.firstChild!.nodeSize
    const row = table.child(1)
    view.dispatch(view.state.tr.replaceWith(second, second + row.nodeSize, row.type.create(null, [...Array(row.childCount)].map(() => view.state.schema.nodes.table_cell.createAndFill()!))))
    flush()
    expect(offsets(view)).toEqual(['80px', '80px', '', ''])
  })

  it('unfreezing the rows drops their offset and the scroll listener', async () => {
    const { view, frames, scroll, flush } = await mount('<!-- table: freeze 1 row -->')
    scroll()
    flush()
    expect(offsets(view)[0]).toBe('80px')
    setFreeze(view, 0, 0)
    flush()
    expect(offsets(view)).toEqual(['', '', '', ''])
    scroll()
    expect(frames).toHaveLength(0)
  })
})

// YAZ-4170: the column handle went above the header cell (`placement: 'top'`). A pinned header sits at the note's top
// edge, so the handle was above the note, off the screen. Now it goes inside the header's top edge, and it follows
// the frozen rows when they move.
describe('the column handle under a pinned header (YAZ-4170)', () => {
  it('shows inside the pinned header\'s top edge, follows the rows on a note scroll, and a click opens the column menu', async () => {
    const { view, block, scroll, flush, tableTop, setTableTop } = await mount('<!-- table: freeze 1 row -->')
    scroll()
    flush()
    // The cells' boxes: 100 px columns, 30 px rows; the frozen header row moves by its animation's offset.
    const rows = rowsOf(view)
    const rowTop = (r: number) => tableTop() + 30 * r + (r === 0 ? parseFloat(moved.get(rows[0]!) ?? '0') : 0)
    rows[0]!.getBoundingClientRect = () => box(rowTop(0), 30)
    rows.forEach((row, r) => [...row.cells].forEach((cell, c) => {
      cell.getBoundingClientRect = () => new DOMRect(c * 100, rowTop(r), 100, 30)
    }))
    view.posAtCoords = ({ left, top }) => {
      const pos = cellPos(view, Math.floor((top - tableTop()) / 30), Math.floor(left / 100))
      return { pos: pos + 2, inside: pos + 1 }
    }
    // Crepe's handle sizes (a 40 × 16 column pill and a 16 × 28 row pill; jsdom has no CSS).
    const col = block.querySelector<HTMLElement>('[data-role="col-drag-handle"]')!
    const row = block.querySelector<HTMLElement>('[data-role="row-drag-handle"]')!
    for (const [el, w, h] of [[col, 40, 16], [row, 16, 28]] as const) {
      Object.defineProperty(el, 'offsetWidth', { value: w })
      Object.defineProperty(el, 'offsetHeight', { value: h })
    }
    const placed = () => new Promise((resolve) => setTimeout(resolve, 30))
    // The note is 80 px down the table: the header is pinned at the note's top (0 px). The pointer is on B4 (10–40 px).
    expect(rowTop(0)).toBe(0)
    col.parentElement!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 25 }))
    await placed()
    // Crepe's `translateY(50%)` moves the pill down by half its height (8 px): its top edge is the header's top edge.
    expect(col.style.top).toBe('-8px')
    expect(row.style.top).toBe('11px')
    // The note scrolls 5 px more, and the pointer stays still: the frozen rows move, so the handles are placed again.
    setTableTop(-85)
    scroll()
    flush()
    await placed()
    expect(rowTop(0)).toBe(0)
    expect(col.style.top).toBe('-8px')
    expect(row.style.top).toBe('6px')
    // A click on the handle opens the column menu at a cell of column B in row 1.
    const got: Array<{ pos: number }> = []
    view.dom.addEventListener(TABLE_HANDLE_MENU, (e) => got.push((e as CustomEvent).detail))
    col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 0 }))
    expect(got.map((detail) => detail.pos)).toEqual([cellPos(view, 0, 1)])
  })
})

describe('YAZ-4834 P4: the scroll work of a note with 30 tables, each with a sticky header row (Settings On by default)', () => {
  /** An `IntersectionObserver` the test drives: `settle` reports each watched table block near or far by its table's box. */
  class FakeObserver {
    static instances: FakeObserver[] = []
    targets = new Set<Element>()
    constructor(
      readonly callback: IntersectionObserverCallback,
      readonly options: IntersectionObserverInit,
    ) {
      FakeObserver.instances.push(this)
    }
    observe = (target: Element) => void this.targets.add(target)
    unobserve = (target: Element) => void this.targets.delete(target)
    disconnect = () => this.targets.clear()
    settle(near: (target: Element) => boolean) {
      this.callback([...this.targets].map((target) => ({ target, isIntersecting: near(target) }) as IntersectionObserverEntry), this as unknown as IntersectionObserver)
    }
  }

  it('a scroll frame measures only the tables within one scroller height of the note, and writes keyframes only when a table\'s offset changed (count guard)', async () => {
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    setStickyHeaderSetting(true)
    const counts = { reads: 0, writes: 0 }
    const animate = function (this: HTMLElement, keyframes: Keyframe[]) {
      counts.writes++
      keep(this, keyframes)
      return { effect: { setKeyframes: (next: Keyframe[]) => void (counts.writes++, keep(this, next)) }, cancel: () => moved.delete(this) }
    }
    Object.assign(HTMLElement.prototype, { animate })
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const flush = () => {
      for (const frame of frames.splice(0)) frame(0)
    }
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    const root = document.createElement('div')
    scroller.appendChild(root)
    document.body.appendChild(scroller)
    scroller.getBoundingClientRect = () => (counts.reads++, box(0, 400))
    // Table i starts at -80 + 200 i, less what the note scrolled: tables 0–4 are within one scroller height (400 px) of it.
    let scrolled = 0
    const blocks = () => [...document.querySelectorAll('.milkdown-table-block')]
    const tableTop = (el: Element) => -80 + 200 * blocks().indexOf(el.closest('.milkdown-table-block')!) - scrolled
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = realCreate(tag, options)
      if (tag === 'table') el.getBoundingClientRect = () => (counts.reads++, box(tableTop(el), 150))
      if (tag === 'tr') el.getBoundingClientRect = () => (counts.reads++, box(tableTop(el) + 30 * (el as HTMLTableRowElement).rowIndex, 30))
      if (tag === 'th' || tag === 'td') Object.defineProperty(el, 'offsetWidth', { value: 100 })
      return el
    })
    const crepe = createCrepe({ root, defaultValue: Array.from({ length: 30 }, () => TABLE).join('\n') })
    await crepe.create()
    mounted.push({ crepe, scroller })
    expect(blocks()).toHaveLength(30)
    flush()
    // One observer for the scroller, every table block in it.
    expect(FakeObserver.instances).toHaveLength(1)
    const observer = FakeObserver.instances[0]!
    expect(observer.options.root).toBe(scroller)
    expect(observer.targets.size).toBe(30)
    const near = (target: Element) => {
      const top = tableTop(target)
      return top + 150 >= -400 && top <= 800
    }
    observer.settle(near)
    flush()
    // A scroll of 10 px: 5 tables near the note, 4 reads each (the frozen rows' box, the table's, the scroller's); only
    // table 0, which the note's top edge cuts, gets a new offset (90 px).
    scrolled = 10
    counts.reads = 0
    counts.writes = 0
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    console.log(`P4: 30 tables, 5 near · a scroll that moves one table's rows: ${counts.reads} rect reads, ${counts.writes} keyframe writes`)
    expect(counts.reads).toBeLessThanOrEqual(20)
    expect(counts.writes).toBe(1)
    // The same scroll again (a scroll event with no new offset): the near tables measure, nothing writes.
    counts.reads = 0
    counts.writes = 0
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    console.log(`P4: a scroll that moves nothing: ${counts.reads} rect reads, ${counts.writes} keyframe writes`)
    expect(counts.reads).toBeLessThanOrEqual(20)
    expect(counts.writes).toBe(0)
    // Table 5 comes near (the note scrolls 500 px): the observer says so, and its rows catch up in the next frame.
    scrolled = 500
    observer.settle(near)
    counts.writes = 0
    flush()
    expect(counts.writes).toBeGreaterThanOrEqual(1)
    // The editor's end drops every target.
    await crepe.destroy()
    mounted.pop()
    scroller.remove()
    expect(observer.targets.size).toBe(0)
  })
})
