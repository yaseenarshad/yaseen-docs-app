/**
 * S6's guard on typing (YAZ-3796, YAZ-3790 "no change in typing speed"): a key in a frozen, styled 500 × 10 table
 * adds no work of the freeze (`tableFreeze.ts`) or the table styles (`tableStyle.ts`). It counts work, not time, so a
 * busy machine can neither hide a cost nor fail the test (a time ratio could not tell the round-1 code, 1.17–1.24,
 * from a loaded machine). For each key, after its animation frames:
 * (a) no layout read on the table block, its cells or the note's scroller;
 * (b) each plugin only maps its decoration set: no `find`, `add` or `remove` on it, and no new set; so the freeze's
 *     view (which `find`s the frozen tables) does not run.
 * The times are in `tableSpeed.perf.test.ts`. jsdom has no layout, so every read gives 0; only the count matters.
 * With lists in the cells (YAZ-3818 D3), a key in a cell bullet rescans the bullets of its own row only. With cell
 * notes too (YAZ-4263), a key in a cell with a mark places no note (D12) and no "Add cell note" button.
 * A calendar table (YAZ-4162) adds its now row and past rows: a key only maps that set too, and starts no clock work.
 * The row band (YAZ-4167) on the caret's row, the table zoom pills (YAZ-4091) and the folded rows (YAZ-4165): a key
 * only maps their sets. The calendar case has a folded run, and an Enter in a cell is one more key (YAZ-4176): it
 * moves neither the chips' watch (`generation`) nor a pill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorState } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import { findFoldedChildren } from '../outline/listNodes'
import { cellNoteButtonPlacements } from './cellNoteButton'
import { cellNoteLabelsIn, cellNotePlacements } from './cellNotes'
import { calendarKey } from './tableCalendar'
import { cellPos } from './tableTestKit'

// Counted, not changed: the fold scan asks it once for each bullet it scans (YAZ-3818 D3).
vi.mock('../outline/listNodes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../outline/listNodes')>()
  return { ...real, findFoldedChildren: vi.fn(real.findFoldedChildren) }
})

const COLS = 10
const ROWS = 500
const head = Array.from({ length: COLS }, (_, c) => `H${c + 1}`)
const body = Array.from({ length: ROWS }, (_, r) => head.map((_, c) => `r${r + 1}c${c + 1}`))
const BIG = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells) => `| ${cells.join(' | ')} |`)].join('\n') + '\n'
/** S6's frozen, styled table, with a folded run away from the typed cells (YAZ-4165). */
const STYLED = `${BIG}\n<!-- table: fill A2:B2 blue C5 green, fold 400-410, stripes, freeze 1 row 2 cols -->\n`
const KEYS = 'typing in a cell'
/** A 3-bullet list, one bullet with a child, in one body cell in five: 1,000 lists, 4,000 bullets. */
const CELL_LIST = '<ul><li>one</li><li>two<ul><li>kid</li></ul></li><li>three</li></ul>'
const LISTS = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') + '\n'

const mounted: Array<{ crepe: Crepe; scroller: HTMLElement }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.scroller.remove()
  }
})

/** The frozen, styled table (or `markdown`) in a note's vertical scroller; every frame is held until `flush`. */
async function mount(markdown = STYLED) {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  const root = document.createElement('div')
  scroller.appendChild(root)
  document.body.appendChild(scroller)
  const crepe = createCrepe({ root, defaultValue: markdown, calendarClock: true, tableZoomPill: true })
  await crepe.create()
  mounted.push({ crepe, scroller })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const flush = () => {
    for (const frame of frames.splice(0)) frame(0)
  }
  flush()
  return { view, scroller, block: view.dom.querySelector<HTMLElement>('.milkdown-table-block')!, flush }
}

/** Enter through ProseMirror's `handleKeyDown`, as a real key: in a cell it is a line break (YAZ-4176). */
const pressEnter = (view: EditorView): boolean =>
  view.someProp('handleKeyDown', (handler) => handler(view, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))) ?? false

/** Counts each layout read whose element `counts`. */
function countLayoutReads(counts: (el: Element) => boolean): { reads: number } {
  const tally = { reads: 0 }
  const methods = ['getBoundingClientRect', 'getClientRects'] as const
  for (const name of methods) {
    const real = Element.prototype[name] as (this: Element) => never
    vi.spyOn(Element.prototype, name).mockImplementation(function (this: Element) {
      if (counts(this)) tally.reads++
      return real.call(this)
    })
  }
  const getters: Array<[object, string]> = [
    ...['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft'].map((name): [object, string] => [HTMLElement.prototype, name]),
    ...['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft'].map((name): [object, string] => [Element.prototype, name]),
  ]
  for (const [proto, name] of getters) {
    const real = Object.getOwnPropertyDescriptor(proto, name)!.get!
    vi.spyOn(proto as Element, name as 'clientWidth', 'get').mockImplementation(function (this: Element) {
      if (counts(this)) tally.reads++
      return real.call(this) as number
    })
  }
  return tally
}

/** The plugin's decoration set, by its key's name. */
function pluginSet(state: EditorState, key: string): DecorationSet {
  const plugin = state.plugins.find((p) => (p as unknown as { key: string }).key === `${key}$`)!
  const value = plugin.getState(state) as DecorationSet | { set: DecorationSet }
  return value instanceof DecorationSet ? value : value.set
}

/**
 * Follows sets through `map`: after `seed(sets)`, `work` lists each other call on one of them or on a set mapped from
 * them (`find`, `add`, `remove`), and `isMapped` tells whether a set came from them by `map` only.
 */
function followSets(): { work: string[]; seed: (sets: DecorationSet[]) => void; isMapped: (set: DecorationSet) => boolean } {
  let mapped = new WeakSet<DecorationSet>()
  const work: string[] = []
  const proto = DecorationSet.prototype
  const realMap = proto.map
  vi.spyOn(proto, 'map').mockImplementation(function (this: DecorationSet, ...args: Parameters<DecorationSet['map']>) {
    const out = realMap.apply(this, args)
    if (mapped.has(this) && out !== DecorationSet.empty) mapped.add(out)
    return out
  })
  for (const name of ['find', 'add', 'remove'] as const) {
    const real = proto[name] as (...args: unknown[]) => unknown
    vi.spyOn(proto, name).mockImplementation(function (this: DecorationSet, ...args: unknown[]) {
      if (mapped.has(this)) work.push(name)
      return real.apply(this, args) as never
    })
  }
  return {
    work,
    seed: (sets) => {
      mapped = new WeakSet(sets)
      work.length = 0
    },
    isMapped: (set) => mapped.has(set),
  }
}

describe('S6: a key in a frozen, styled 500 × 10 table adds no work (YAZ-3796)', () => {
  it('reads no layout, and the freeze and the styles only map their sets', async () => {
    const { view, scroller, block, flush } = await mount()
    const plugins = { freeze: 'mdapp-table-freeze', style: 'mdapp-table-style', band: 'mdapp-table-row-band', zoom: 'mdapp-table-zoom', fold: 'mdapp-table-fold' }
    // The table is frozen and styled: both sets hold decorations.
    expect(pluginSet(view.state, plugins.freeze).find().length).toBeGreaterThan(ROWS)
    expect(pluginSet(view.state, plugins.style).find()).toHaveLength(1)
    const layout = countLayoutReads((el) => el === scroller || block.contains(el))
    const sets = followSets()
    const reads: number[] = []
    const work: string[][] = []
    // A body cell, then a cell of a frozen column.
    for (const [row, col] of [[250, 3], [120, 0]] as const) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2)))
      for (const ch of KEYS) {
        const before = layout.reads
        sets.seed(Object.values(plugins).map((key) => pluginSet(view.state, key)))
        view.dispatch(view.state.tr.insertText(ch))
        flush()
        reads.push(layout.reads - before)
        const rebuilt = Object.entries(plugins).filter(([, key]) => !sets.isMapped(pluginSet(view.state, key)))
        work.push([...sets.work, ...rebuilt.map(([name]) => `new ${name} set`)])
      }
    }
    // (a) and (b) each on its own: each one fails on the round-1 code (YAZ-3796).
    expect.soft(reads, '(a) layout reads per key').toEqual(reads.map(() => 0))
    expect.soft(work, '(b) work on the decoration sets per key').toEqual(work.map(() => []))
    // The keys landed.
    expect(view.state.doc.nodeAt(cellPos(view, 250, 3))!.textContent).toBe(`${KEYS}r250c4`)
  }, 60_000)
})

describe('S6: a key in a cell bullet rescans its own row only (YAZ-3818 D3)', () => {
  it('the fold scan reads the bullets of the edited row, not the other 999 lists', async () => {
    const { view, flush } = await mount(LISTS)
    const scans = vi.mocked(findFoldedChildren)
    // Body row 250 holds lists in columns 1 and 6: 8 bullets.
    const cell = cellPos(view, 250, 5)
    let bullet = -1
    view.state.doc.nodeAt(cell)!.descendants((node, pos) => {
      if (bullet < 0 && node.type.name === 'list_item') bullet = cell + 1 + pos + 2
      return bullet < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bullet)))
    const perKey: number[] = []
    for (const ch of KEYS) {
      scans.mockClear()
      view.dispatch(view.state.tr.insertText(ch))
      flush()
      perKey.push(scans.mock.calls.length)
    }
    expect(Math.max(...perKey)).toBeLessThanOrEqual(8)
    // The keys landed in the bullet.
    expect(view.state.doc.nodeAt(bullet - 2)!.textContent).toBe(`${KEYS}one`)
  }, 60_000)
})

/**
 * LISTS with a cell note on one cell in ten (each one a list cell): 500 marks, and 500 notes of 3 bullets under the
 * table (YAZ-4263, as `tableSpeed.perf.test.ts`).
 */
const NOTED =
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 10 === 0 ? `${cell}[^cell-${(r * COLS + c) / 10 + 1}]${CELL_LIST}` : (r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') +
  '\n\n' +
  Array.from({ length: (ROWS * COLS) / 10 }, (_, n) => `[^cell-${n + 1}]: * one\n    * two\n    * three`).join('\n\n') +
  '\n'

describe('S6: a key in a cell with a cell note places nothing (YAZ-4263)', () => {
  it('500 cell notes: a key in a cell bullet of a cell with a mark runs no note placement and no button placement', async () => {
    const { view, flush } = await mount(NOTED)
    // Body row 250, column 1: a list and the mark of `cell-250`.
    const cell = cellPos(view, 250, 0)
    expect(view.state.doc.nodeAt(cell)!.textContent).toContain('r250c1')
    let bullet = -1
    view.state.doc.nodeAt(cell)!.descendants((node, pos) => {
      if (bullet < 0 && node.type.name === 'list_item') bullet = cell + 1 + pos + 2
      return bullet < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bullet)))
    flush()
    const notes = cellNotePlacements.runs
    const buttons = cellNoteButtonPlacements.runs
    for (const ch of KEYS) {
      view.dispatch(view.state.tr.insertText(ch))
      flush()
    }
    expect(cellNotePlacements.runs - notes).toBe(0)
    expect(cellNoteButtonPlacements.runs - buttons).toBe(0)
    // The keys landed in the bullet, and the mark stays.
    expect(view.state.doc.nodeAt(bullet - 2)!.textContent).toBe(`${KEYS}one`)
    expect(cellNoteLabelsIn(view.state.doc.nodeAt(cell)!)).toEqual(['cell-250'])
  }, 60_000)
})

/** A calendar table of 500 half-hour rows (the times run past midnight, YAZ-4162), frozen like S6's, with a folded run (YAZ-4165). */
const CALENDAR = [
  '| Time | Plan |',
  '| --- | --- |',
  ...Array.from({ length: ROWS }, (_, r) => {
    const m = (r * 30) % 1440
    const h = Math.floor(m / 60)
    return `| ${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'} | plan ${r} |`
  }),
].join('\n') + '\n\n<!-- table: fold 100-120, freeze 1 row 1 col, calendar 30m -->\n\nText\n'

describe('a key in a calendar table adds no work (YAZ-4162)', () => {
  it('reads no layout, and the calendar marks only map their set', async () => {
    const { view, scroller, block, flush } = await mount(CALENDAR)
    const plugins = { freeze: 'mdapp-table-freeze', style: 'mdapp-table-style', calendar: 'mdapp-table-calendar', band: 'mdapp-table-row-band', zoom: 'mdapp-table-zoom', fold: 'mdapp-table-fold' }
    // The table shows a now row or past rows, and a fold bar: both sets hold decorations.
    expect(pluginSet(view.state, plugins.calendar).find().length).toBeGreaterThan(0)
    expect(pluginSet(view.state, plugins.fold).find().length).toBeGreaterThan(0)
    const generation = calendarKey.getState(view.state)!.generation
    const layout = countLayoutReads((el) => el === scroller || block.contains(el))
    const sets = followSets()
    const reads: number[] = []
    const work: string[][] = []
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 250, 1) + 2)))
    for (const ch of [...KEYS, 'Enter']) {
      const before = layout.reads
      sets.seed(Object.values(plugins).map((key) => pluginSet(view.state, key)))
      if (ch === 'Enter') expect(pressEnter(view)).toBe(true)
      else view.dispatch(view.state.tr.insertText(ch))
      flush()
      reads.push(layout.reads - before)
      const rebuilt = Object.entries(plugins).filter(([, key]) => !sets.isMapped(pluginSet(view.state, key)))
      work.push([...sets.work, ...rebuilt.map(([name]) => `new ${name} set`)])
    }
    expect.soft(reads, 'layout reads per key').toEqual(reads.map(() => 0))
    expect.soft(work, 'work on the decoration sets per key').toEqual(work.map(() => []))
    // An Enter in a paragraph of the note splits a block, not typing; no calendar table changed (YAZ-4176).
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    expect(pressEnter(view)).toBe(true)
    flush()
    expect(view.state.doc.lastChild!.type.name).toBe('paragraph')
    expect.soft(calendarKey.getState(view.state)!.generation, 'the chips\' watch').toBe(generation)
    // The keys landed, and the Enter is a line break in the cell.
    const cell = view.state.doc.nodeAt(cellPos(view, 250, 1))!
    expect([cell.childCount, cell.firstChild!.childCount, cell.firstChild!.child(1).type.name]).toEqual([1, 3, 'hardbreak'])
  }, 60_000)
})
