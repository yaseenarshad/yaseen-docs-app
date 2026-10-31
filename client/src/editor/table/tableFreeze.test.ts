/**
 * Frozen rows and columns of a note table (YAZ-3769, YAZ-3696 S3) on the real editor in jsdom: the
 * frozen cells' decorations, the columns' sticky offsets, and the rows' offset on a scroll of the
 * note (the folder page's method, `lib/pinnedHeader.ts`): it follows the scroll, stops at the
 * table's end, keeps one value at each document zoom, and its listeners go when the table unfreezes.
 * jsdom has no layout, so the boxes are given by hand, and no Web Animations, so `animate` is stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; scroller: HTMLElement }> = []
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.scroller.remove()
  }
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
  moved.clear()
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

/** A note in a vertical scroller; every frame is held until `flush`. Rows are 30 px, the table starts at `tableTop`. */
async function mount(comment: string, { tableTop = -80, zoom = 1 } = {}) {
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
    if (tag === 'table') el.getBoundingClientRect = () => box(top * zoom, 150 * zoom)
    if (tag === 'tr') el.getBoundingClientRect = () => box((top + 30 * ((el as HTMLTableRowElement).rowIndex)) * zoom, 30 * zoom)
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
    block,
    frames,
    scroller,
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
