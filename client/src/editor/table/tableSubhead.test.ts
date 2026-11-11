/**
 * Subheader rows (YAZ-4899): the comment's parts, the section math, Make / Turn back, the chevron and the collapsed
 * section (the same `fold` mark, no bar, one undo step), Sort inside sections, the keys, fill and paste, Insert row
 * below, the Super table's records, the drag, and the sticky row — on real editors (`createCrepe`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { moveRowCommand } from '@milkdown/kit/preset/gfm'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem, MenuParent } from '../../sidebar/menuSections'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { pressKey } from '../marks/markTestKit'
import { noteMenuSections } from '../noteMenu'
import { sectionEnd, subheadOf, unfoldedRows } from './cells'
import { tableData } from './super/superData'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import { sectionsOf } from './tableSubhead'
import { cellPos, mountNote, unmountAll } from './tableTestKit'
import { setStickyHeaderSetting } from './timeFormatSetting'

afterEach(async () => {
  setStickyHeaderSetting(true)
  await unmountAll()
  vi.restoreAllMocks()
})

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })

/** A table of body rows `names` (row 2 of the file is the first), then `comment` when given. */
const table = (names: string[], comment?: string): string =>
  ['| Name | Note |', '| ---- | ---- |', ...names.map((n, i) => `| ${n.padEnd(4)} | ${`n${i + 1}`.padEnd(4)} |`)].join('\n') + '\n' + (comment === undefined ? '' : `\n<!-- table: ${comment} -->\n`)
/** Eight body rows r1…r8 with subheader rows at file rows 3 and 7 (r2 and r6): sections r2 [r3 r4 r5] and r6 [r7 r8]. */
const EIGHT = table(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'], 'subhead 3 7')

const firstTable = (view: EditorView): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'table') out = { node, pos }
    return out === null
  })
  return out!
}
const names = (view: EditorView): string[] => {
  const out: string[] = []
  firstTable(view).node.forEach((row) => out.push(row.firstChild!.textContent))
  return out
}
const trs = (view: EditorView) => [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')]
/** Each row's look: `sub` (open), `sub·N` (collapsed, with its count), `hidden`, `bar`, or `-`. */
const looks = (view: EditorView): string[] =>
  trs(view).map((tr) => {
    if (tr.classList.contains('table-subhead-row')) {
      const count = tr.querySelector('.table-subhead-count')?.textContent ?? ''
      return tr.classList.contains('table-subhead-collapsed') ? `sub${count.replace(/ rows?$/, '').replace(' · ', '·')}` : 'sub'
    }
    return tr.classList.contains('table-fold-hidden') ? 'hidden' : tr.classList.contains('table-fold-bar') ? 'bar' : '-'
  })
const items = (view: EditorView, row: number, col: number): MenuItem[] => noteMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2).flat()
const menuItem = (view: EditorView, row: number, col: number, id: string): MenuAction | undefined =>
  items(view, row, col)
    .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
    .find((item) => item.id === id)
const parent = (view: EditorView, row: number, col: number, id: string): MenuParent | undefined => items(view, row, col).find((item): item is MenuParent => item.children !== undefined && item.id === id)
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const caretIn = (view: EditorView, row: number, col: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2)))
const chevronOf = (view: EditorView, row: number) => trs(view)[row]!.querySelector<HTMLElement>('.table-subhead-chevron')
const clickChevron = (view: EditorView, row: number, alt = false) => {
  const chevron = chevronOf(view, row)
  if (chevron === null) throw new Error(`no chevron on row ${row}`)
  chevron.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, altKey: alt }))
}
const caretRowOf = (view: EditorView): number => {
  const $head = view.state.selection.$head
  for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.spec.tableRole === 'row') return $head.index(d - 1)
  return -1
}

describe('the parts (item 22)', () => {
  it('`subhead 5 12`, `subheader …` (the header words) and `sticky` / `nosticky` round-trip, in the fixed order', () => {
    const comment = '<!-- table: fold 6-8, subhead 5 12, header blue, subheader red strong regular text-white align-center, nosticky, stripes -->'
    const parsed = parseTableComment(comment)!
    expect(parsed).toEqual(style({ fold: [5, 6, 7], subhead: [4, 11], header: { color: 'blue' }, subheader: { color: 'red', strength: 'strong', weight: 'regular', text: 'white', align: 'center' }, sticky: false, stripes: true }))
    expect(formatTableComment(parsed)).toBe(comment)
    expect(formatTableComment(style({ sticky: true, subhead: [2, 3] }))).toBe('<!-- table: subhead 3-4, sticky -->')
    // `subheader plain` is Strength Off, as `header plain`; a wrong word keeps the part as its text.
    expect(parseTableComment('<!-- table: subheader plain -->')).toEqual(style({ subheader: { strength: 'off' } }))
    expect(parseTableComment('<!-- table: subheader shiny, stripes -->')).toEqual(style({ stripes: true, unknown: [{ after: null, text: 'subheader shiny' }] }))
    expect(parseTableComment('<!-- table: subhead 1 -->')).toBeNull()
  })

  it('loads onto the rows\' cells, saves byte for byte, and a plain table writes no comment', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    expect(getMarkdownForSave(crepe)).toBe(EIGHT)
    expect(sectionsOf(firstTable(view).node)).toEqual([
      { row: 2, end: 5, collapsed: false },
      { row: 6, end: 8, collapsed: false },
    ])
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', '-', 'sub', '-', '-'])
    expect(trs(view)[2]!.cells[0]!.hasAttribute('data-subhead')).toBe(true)
    const plain = await mountNote(table(['a', 'b']))
    expect(getMarkdownForSave(plain.crepe)).toBe(table(['a', 'b']))
    expect(plain.view.dom.querySelector('.table-subhead-row, .table-subhead-chevron, [data-table-subheads]')).toBeNull()
  })
})

describe('the section math', () => {
  it('`subheadOf`, `sectionEnd` and `unfoldedRows` (fill down and paste skip a subheader row, item 19)', async () => {
    const { view } = await mountNote(EIGHT)
    const { node } = firstTable(view)
    expect([1, 2, 3, 5, 6, 8].map((r) => subheadOf(node, r))).toEqual([null, 2, 2, 2, 6, 6])
    expect(sectionEnd(node, 2)).toBe(5)
    expect(sectionEnd(node, 6)).toBe(8)
    expect(unfoldedRows(node, 1, 4)).toEqual([1, 3, 4, 5])
    expect(unfoldedRows(node, 5, 3)).toEqual([5, 7, 8])
  })

  it('a Super table\'s records leave the subheader rows out; the cells keep every row (item 21)', async () => {
    const { view } = await mountNote(EIGHT)
    const data = tableData(firstTable(view).node)
    expect(data.cells).toHaveLength(9)
    expect(data.records.map((r) => r.name)).toEqual(['r1', 'r3', 'r4', 'r5', 'r7', 'r8'])
  })
})

describe('"Make subheader row" and "Turn back into a normal row" (item 4), one undo step each', () => {
  it('a body row becomes a subheader row; the header row cannot; the save writes `subhead`; ⌘Z undoes it in one step', async () => {
    const { crepe, view } = await mountNote(table(['r1', 'r2', 'r3', 'r4']))
    expect(menuItem(view, 0, 0, 'table-subhead')).toBeUndefined()
    expect(menuItem(view, 2, 0, 'table-subhead')?.label).toBe('Make subheader row')
    menuItem(view, 2, 0, 'table-subhead')!.onSelect()
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4'], 'subhead 3'))
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-'])
    expect(menuItem(view, 2, 0, 'table-subhead-off')?.label).toBe('Turn back into a normal row')
    // Two rows at once count.
    selectCells(view, [3, 0], [4, 1])
    expect(menuItem(view, 3, 0, 'table-subhead')?.label).toBe('Make 2 subheader rows')
    menuItem(view, 3, 0, 'table-subhead')!.onSelect()
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4'], 'subhead 3-5'))
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4'], 'subhead 3'))
    // The cells stay selected after the undo: the menu acts on them. A caret in the subheader row acts on it.
    caretIn(view, 2, 0)
    menuItem(view, 2, 0, 'table-subhead-off')!.onSelect()
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4']))
  })

  it('is off in a Time-slots table, with the reason (item 21)', async () => {
    const { view } = await mountNote(['| Time | Plan |', '| --- | --- |', '| 9:00 am | a |', '| 9:30 am | b |'].join('\n') + '\n\n<!-- table: calendar 30m -->\n')
    const item = menuItem(view, 1, 0, 'table-subhead')!
    expect([item.disabled, item.hint]).toEqual([true, 'Time slots are on'])
  })

  it('a subheader row\'s right-click has the style flyout and Collapse / Expand all; a header-row cell has "Header row style ›" (item 3)', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    const flyout = parent(view, 2, 0, 'table-subheader-style')!
    expect(flyout.label).toBe('Subheader row style')
    // YAZ-4899 demo ("in a different way?"): the six-dot menu's own panel, drawn by its code in this flyout.
    const host = document.createElement('div')
    document.body.appendChild(host)
    flyout.panel!(host, () => {})
    const items = () => [...host.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => `${b.textContent}${b.dataset.hint === '✓' ? '*' : ''}`)
    const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('.fill-target:not(.fill-target--sub) > .fill-target__opt')]
    const bar = () => [...host.querySelectorAll<HTMLButtonElement>('.fill-target--sub .fill-target__opt')].map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`)
    expect(items()).toEqual(['Plain, like any row', 'Gray*', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Black'])
    expect(tabs().map((t) => `${t.textContent}${t.getAttribute('aria-pressed') === 'true' ? '*' : ''}`)).toEqual(['Fill*', 'Text', 'Style'])
    // ✓ at what the table shows (Settings' default: Medium); a pick that equals Settings saves no part. The panel
    // stays, drawn again: the pressed segment moves.
    expect(bar()).toEqual(['Off', 'Light', 'Medium*', 'Strong'])
    host.querySelectorAll<HTMLButtonElement>('.fill-target--sub .fill-target__opt')[3]!.click()
    expect(getMarkdownForSave(crepe)).toContain('subhead 3 7, subheader strong')
    expect(bar()).toEqual(['Off', 'Light', 'Medium', 'Strong*'])
    host.querySelectorAll<HTMLButtonElement>('.fill-target--sub .fill-target__opt')[2]!.click()
    expect(getMarkdownForSave(crepe)).toBe(EIGHT)
    // The Style tab: Weight and Align, as the six-dot menu's.
    tabs()[2]!.click()
    expect(items()).toEqual(['Plain, like any row', 'Bold*', 'Regular', 'Follow column*', 'Left', 'Center', 'Right'])
    expect([...host.querySelectorAll('.ctx-menu__heading')].map((h) => h.textContent)).toEqual(['Weight', 'Align'])
    tabs()[0]!.click()
    host.remove()
    expect(menuItem(view, 2, 0, 'table-subhead-collapse-all')?.label).toBe('Collapse all subheaders')
    expect(menuItem(view, 2, 0, 'table-subhead-expand-all')?.label).toBe('Expand all subheaders')
    expect(parent(view, 1, 0, 'table-subheader-style')).toBeUndefined()
    const header = parent(view, 0, 0, 'table-header-style')!
    expect(header.label).toBe('Header row style')
    expect(parent(view, 1, 0, 'table-header-style')).toBeUndefined()
    const headerHost = document.createElement('div')
    header.panel!(headerHost, () => {})
    ;[...headerHost.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Red')!.click()
    expect(getMarkdownForSave(crepe)).toContain('header red')
  })
})

describe('the chevron and the collapsed section (items 10–12, 14)', () => {
  it('a mousedown collapses the section in the `fold` mark with no bar; the count shows; one ⌘Z opens it', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', '-', 'sub', '-', '-'])
    expect(chevronOf(view, 2)?.dataset.collapsed).toBeUndefined()
    clickChevron(view, 2)
    expect(looks(view)).toEqual(['-', '-', 'sub·3', 'hidden', 'hidden', 'hidden', 'sub', '-', '-'])
    expect(chevronOf(view, 2)?.dataset.collapsed).toBe('')
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'], 'fold 4-6, subhead 3 7'))
    expect(view.dom.querySelector('.table-fold-bar')).toBeNull()
    clickChevron(view, 2)
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', '-', 'sub', '-', '-'])
    undo(view.state, view.dispatch)
    expect(looks(view)[2]).toBe('sub·3')
    undo(view.state, view.dispatch)
    expect(looks(view)[2]).toBe('sub')
  })

  it('⌥-click collapses every section of the table, and again opens them; the menu rows do the same', async () => {
    const { view } = await mountNote(EIGHT)
    clickChevron(view, 6, true)
    expect(looks(view)).toEqual(['-', '-', 'sub·3', 'hidden', 'hidden', 'hidden', 'sub·2', 'hidden', 'hidden'])
    clickChevron(view, 6, true)
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', '-', 'sub', '-', '-'])
    menuItem(view, 2, 0, 'table-subhead-collapse-all')!.onSelect()
    expect(looks(view).filter((l) => l === 'hidden')).toHaveLength(5)
    menuItem(view, 2, 0, 'table-subhead-expand-all')!.onSelect()
    expect(looks(view).filter((l) => l === 'hidden')).toHaveLength(0)
  })

  it('a section with no rows under it has no chevron; a read-only note\'s chevron does nothing', async () => {
    const { view } = await mountNote(table(['r1', 'r2'], 'subhead 3'))
    expect(looks(view)).toEqual(['-', '-', 'sub'])
    expect(chevronOf(view, 2)).toBeNull()
    const other = await mountNote(EIGHT)
    other.view.setProps({ editable: () => false })
    clickChevron(other.view, 2)
    expect(looks(other.view)[3]).toBe('-')
  })

  it('"Turn back into a normal row" on a collapsed subheader row opens its section first', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    clickChevron(view, 2)
    menuItem(view, 2, 0, 'table-subhead-off')!.onSelect()
    expect(getMarkdownForSave(crepe)).toBe(table(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'], 'subhead 7'))
  })

  it('"Insert row below" a collapsed subheader row opens it first, so the new row shows (item 18)', async () => {
    const { view } = await mountNote(EIGHT)
    clickChevron(view, 2)
    menuItem(view, 2, 0, 'table-insert-row-below')!.onSelect()
    expect(names(view)).toEqual(['Name', 'r1', 'r2', '', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'])
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', '-', '-', 'sub', '-', '-'])
  })
})

describe('Sort inside each section (item 15)', () => {
  it('the subheader rows stay; the rows above the first one and each section sort among themselves', async () => {
    const { view } = await mountNote(table(['c', 'a', 'S1', 'z', 'b', 'S2', 'y', 'x'], 'subhead 4 7'))
    menuItem(view, 1, 0, 'table-sort-asc')!.onSelect()
    expect(names(view)).toEqual(['Name', 'a', 'c', 'S1', 'b', 'z', 'S2', 'x', 'y'])
    menuItem(view, 1, 0, 'table-sort-desc')!.onSelect()
    expect(names(view)).toEqual(['Name', 'c', 'a', 'S1', 'z', 'b', 'S2', 'y', 'x'])
    // A collapsed section sorts too, and stays collapsed: the mark is on its rows.
    clickChevron(view, 3)
    menuItem(view, 1, 0, 'table-sort-asc')!.onSelect()
    expect(names(view)).toEqual(['Name', 'a', 'c', 'S1', 'b', 'z', 'S2', 'x', 'y'])
    expect(looks(view)).toEqual(['-', '-', '-', 'sub·2', 'hidden', 'hidden', 'sub', '-', '-'])
  })
})

describe('the keys (item 13)', () => {
  it('⌘↑ in a section collapses it and puts the caret on its subheader row; ⌘↓ opens it; above the first subheader row the keys pass', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    caretIn(view, 4, 1)
    expect(pressKey(crepe, 'ArrowUp', { mod: true })).toBe(true)
    expect(looks(view)[2]).toBe('sub·3')
    expect(caretRowOf(view)).toBe(2)
    expect(pressKey(crepe, 'ArrowDown', { mod: true })).toBe(true)
    expect(looks(view)[2]).toBe('sub')
    caretIn(view, 1, 0)
    expect(pressKey(crepe, 'ArrowUp', { mod: true })).toBe(false)
    expect(looks(view).filter((l) => l === 'hidden')).toHaveLength(0)
  })

  it('⌘⇧U collapses every section of every table and ⌘⇧I opens them', async () => {
    const { crepe, view } = await mountNote(`${EIGHT}\n${table(['a', 'b', 'c'], 'subhead 3')}`)
    caretIn(view, 1, 0)
    pressKey(crepe, 'u', { mod: true, shift: true })
    expect(view.dom.querySelectorAll('.table-subhead-collapsed')).toHaveLength(3)
    pressKey(crepe, 'i', { mod: true, shift: true })
    expect(view.dom.querySelectorAll('.table-subhead-collapsed')).toHaveLength(0)
  })
})

describe('the drag (item 17): `MoveRow` on a table with subheader rows', () => {
  const move = (crepe: Crepe, from: number, to: number) =>
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      ctx.get(commandsCtx).call(moveRowCommand.key, { from, to, pos: firstTable(view).pos + 1 })
    })

  it('a collapsed subheader row moves with its hidden rows, up and down; an open one moves alone', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    clickChevron(view, 2)
    move(crepe, 2, 8)
    expect(names(view)).toEqual(['Name', 'r1', 'r6', 'r7', 'r8', 'r2', 'r3', 'r4', 'r5'])
    expect(looks(view)).toEqual(['-', '-', 'sub', '-', '-', 'sub·3', 'hidden', 'hidden', 'hidden'])
    move(crepe, 5, 1)
    expect(names(view)).toEqual(['Name', 'r2', 'r3', 'r4', 'r5', 'r1', 'r6', 'r7', 'r8'])
    move(crepe, 5, 8)
    expect(names(view)).toEqual(['Name', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r1'])
  })

  it('a row dropped under a collapsed subheader row lands after its section, never inside it', async () => {
    const { crepe, view } = await mountNote(EIGHT)
    clickChevron(view, 6)
    move(crepe, 1, 6)
    expect(names(view)).toEqual(['Name', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r1'])
  })
})

/** The sticky row, the frozen rows' scaffolding: a scroller, rows of 30 px, Web Animations stubbed, frames held until `flush`. */
describe('the sticky subheader row (items 8–9)', () => {
  const moved = new Map<Element, string>()
  const keep = (el: Element, keyframes: Keyframe[]) => moved.set(el, /translateY\((.*)\)/.exec(String(keyframes[0]!.transform))![1]!)
  function animateStub(this: HTMLElement, keyframes: Keyframe[]) {
    keep(this, keyframes)
    return { effect: { setKeyframes: (next: Keyframe[]) => keep(this, next) }, cancel: () => moved.delete(this) }
  }
  const mounted: Array<{ crepe: Crepe; scroller: HTMLElement }> = []
  afterEach(async () => {
    for (const m of mounted.splice(0)) {
      await m.crepe.destroy()
      m.scroller.remove()
    }
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
    moved.clear()
  })

  async function mount(markdown: string, tableTop: number) {
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
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400)
    let top = tableTop
    const rows = 9
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = realCreate(tag, options)
      if (tag === 'table') el.getBoundingClientRect = () => new DOMRect(0, top, 300, 30 * rows)
      // A row's box as the browser gives it: moved by its animation's `translateY`; a hidden row has none.
      if (tag === 'tr')
        el.getBoundingClientRect = () =>
          el.classList.contains('table-fold-hidden') ? new DOMRect() : new DOMRect(0, top + 30 * (el as HTMLTableRowElement).rowIndex + Number.parseFloat(moved.get(el) ?? '0'), 300, 30)
      return el
    })
    const crepe = createCrepe({ root, defaultValue: markdown })
    await crepe.create()
    mounted.push({ crepe, scroller })
    const view = crepe.editor.ctx.get(editorViewCtx)
    const block = view.dom.querySelector<HTMLElement>('.milkdown-table-block')!
    const flush = () => {
      for (const frame of frames.splice(0)) frame(0)
    }
    flush()
    return {
      view,
      block,
      frames,
      offsets: () => trs(view).map((row) => moved.get(row) ?? ''),
      scrollTo: (next: number) => {
        top = next
        scroller.dispatchEvent(new Event('scroll'))
        flush()
      },
    }
  }

  it('the section at the top pins its subheader row by a `translateY`, one update per frame; the next one pushes it up; it stops at the table end', async () => {
    // The subheader rows alone: Settings › Sticky header row Off (YAZ-4899 round 2 tests both below).
    setStickyHeaderSetting(false)
    const { offsets, scrollTo, frames, block } = await mount(EIGHT, 0)
    expect(block.hasAttribute('data-table-subheads')).toBe(true)
    expect(offsets()).toEqual(Array(9).fill(''))
    // Row 2 (r2) starts at 60 px: scrolled 100 px, it is 40 px above the top and moves down by 40.
    scrollTo(-100)
    expect(offsets()).toEqual(['', '', '40px', '', '', '', '', '', ''])
    // Two scrolls, one frame.
    scrollTo(-110)
    scroller(block).dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(1)
    frames.splice(0).forEach((f) => f(0))
    expect(offsets()[2]).toBe('50px')
    // Row 6 starts at 180 px: at 170 px scrolled it is 10 px under the top, and pushes row 2 up: 180 - 30 - 60 = 90.
    scrollTo(-170)
    expect(offsets()).toEqual(['', '', '90px', '', '', '', '', '', ''])
    // Past it, row 6 is the pinned one, and row 2 goes back.
    scrollTo(-200)
    expect(offsets()).toEqual(['', '', '', '', '', '', '20px', '', ''])
    // The table ends at 270 px: row 6 stops 60 px down, at the table's end.
    scrollTo(-400)
    expect(offsets()).toEqual(['', '', '', '', '', '', '60px', '', ''])
    scrollTo(0)
    expect(offsets()).toEqual(Array(9).fill(''))
  })

  it('under the frozen rows: the pin line is the frozen rows\' bottom', async () => {
    const { offsets, scrollTo } = await mount(table(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'], 'subhead 3 7, freeze 1 row'), 0)
    // The header row (30 px) is pinned at the top; row 2 at 60 px pins under it once 30 px have scrolled by.
    scrollTo(-20)
    expect(offsets()[2]).toBe('')
    scrollTo(-100)
    expect(offsets()[2]).toBe('70px')
  })

  it('`nosticky` (and Settings Off by default) has no listener and moves nothing; a table without subheader rows neither', async () => {
    setStickyHeaderSetting(false)
    const { offsets, scrollTo } = await mount(table(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'], 'subhead 3 7, nosticky'), 0)
    scrollTo(-100)
    expect(offsets()).toEqual(Array(9).fill(''))
  })

  it('YAZ-4899 round 2: a sticky header row (Settings On) and sticky subheaders together: the header stays at the top, the section\'s subheader row right under it', async () => {
    setStickyHeaderSetting(true)
    const { offsets, scrollTo } = await mount(EIGHT, 0)
    // The header row (frozen by the default) moves by the scrolled 100 px; r2 (row 2, at 60 px) pins under its 30 px: 30 - (60 - 100) = 70.
    scrollTo(-100)
    expect(offsets()).toEqual(['100px', '', '70px', '', '', '', '', '', ''])
  })
})

const scroller = (block: HTMLElement): HTMLElement => {
  let el = block.parentElement
  while (el !== null && el.style.overflowY !== 'auto') el = el.parentElement
  return el!
}
