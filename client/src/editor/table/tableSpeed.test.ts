/**
 * S6's guard on typing (YAZ-3796, YAZ-3790 "no change in typing speed"): a key in a frozen, styled 500 × 10 table
 * adds no work of the freeze (`tableFreeze.ts`) or the table styles (`tableStyle.ts`). It counts work, not time, so a
 * busy machine can neither hide a cost nor fail the test (a time ratio could not tell the round-1 code, 1.17–1.24,
 * from a loaded machine). For each key, after its animation frames:
 * (a) no layout read on the table block, its cells or the note's scroller;
 * (b) each plugin only maps its decoration set: no `find`, `add` or `remove` on it, and no new set; so the freeze's
 *     view (which `find`s the frozen tables) does not run.
 * The times are in `tableSpeed.perf.test.ts`. jsdom has no layout, so every read gives 0; only the count matters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorState } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import { cellPos } from './tableTestKit'

const COLS = 10
const ROWS = 500
const head = Array.from({ length: COLS }, (_, c) => `H${c + 1}`)
const body = Array.from({ length: ROWS }, (_, r) => head.map((_, c) => `r${r + 1}c${c + 1}`))
const BIG = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells) => `| ${cells.join(' | ')} |`)].join('\n') + '\n'
/** S6's frozen, styled table. */
const STYLED = `${BIG}\n<!-- table: fill A2:B2 blue C5 green, stripes, freeze 1 row 2 cols -->\n`
const KEYS = 'typing in a cell'

const mounted: Array<{ crepe: Crepe; scroller: HTMLElement }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.scroller.remove()
  }
})

/** The frozen, styled table in a note's vertical scroller; every frame is held until `flush`. */
async function mount() {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  const root = document.createElement('div')
  scroller.appendChild(root)
  document.body.appendChild(scroller)
  const crepe = createCrepe({ root, defaultValue: STYLED })
  await crepe.create()
  mounted.push({ crepe, scroller })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const flush = () => {
    for (const frame of frames.splice(0)) frame(0)
  }
  flush()
  return { view, scroller, block: view.dom.querySelector<HTMLElement>('.milkdown-table-block')!, flush }
}

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
    const plugins = { freeze: 'mdapp-table-freeze', style: 'mdapp-table-style' }
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
