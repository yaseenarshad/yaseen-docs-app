/**
 * The row band (YAZ-4167, YAZ-4159 D16): one node decoration on the body row that holds the caret
 * (`tableRowBand.ts`), none with a CellSelection; the mouse band is CSS only; Settings › Editor › Tables › "Row band"
 * lands as `data-table-row-band` on `.app`, and `table.css` draws the band for each value.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DEFAULT_SETTINGS, TABLE_ROW_BANDS } from '@shared/types'
import { rowBandKey } from './tableRowBand'
import { cellPos, mountNote, unmountAll } from './tableTestKit'
import tableCss from './table.css?inline'

afterEach(unmountAll)

const TABLE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n| c  | d  |\n'
const caretIn = (view: EditorView, row: number, col: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2)))
/** The rows of the first table that carry the band. */
const banded = (view: EditorView) =>
  [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')].flatMap((tr, i) => (tr.classList.contains('table-band-row') ? [i] : []))
const bandSet = (view: EditorView) => rowBandKey.getState(view.state)!.set

describe('the caret band', () => {
  it('is on the caret\'s body row; it moves with the caret to another row; the header row has none', async () => {
    const { view } = await mountNote(TABLE)
    caretIn(view, 1, 1)
    expect(banded(view)).toEqual([1])
    caretIn(view, 2, 0)
    expect(banded(view)).toEqual([2])
    caretIn(view, 0, 0)
    expect(banded(view)).toEqual([])
  })

  it('a key in the row, or a caret move inside it, keeps the same set (mapped), with no new decoration', async () => {
    const { view } = await mountNote(TABLE)
    caretIn(view, 1, 0)
    const before = bandSet(view)
    // A caret move in the same row: no document change, the very same set.
    caretIn(view, 1, 1)
    expect(bandSet(view)).toBe(before)
    // A key: the set mapped, its one decoration the same.
    view.dispatch(view.state.tr.insertText('x'))
    const after = bandSet(view)
    expect(after.find()).toHaveLength(1)
    expect(after.find()[0]!.spec).toBe(before.find()[0]!.spec)
    expect(banded(view)).toEqual([1])
  })

  it('a CellSelection (of two cells, or one) shows none', async () => {
    const { view } = await mountNote(TABLE)
    caretIn(view, 1, 0)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0), cellPos(view, 2, 1))))
    expect(banded(view)).toEqual([])
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 2, 0))))
    expect(banded(view)).toEqual([])
    caretIn(view, 2, 0)
    expect(banded(view)).toEqual([2])
  })

  it('a caret outside a table shows none; the band adds nothing to the file', async () => {
    const { crepe, view } = await mountNote(`text\n\n${TABLE}`)
    caretIn(view, 1, 0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(banded(view)).toEqual([])
    caretIn(view, 1, 0)
    const { getMarkdownForSave } = await import('../createCrepe')
    expect(getMarkdownForSave(crepe)).toBe(`text\n\n${TABLE}`)
  })
})

describe('the setting', () => {
  it('Off, Calendar tables or All tables; All tables by default', () => {
    expect(TABLE_ROW_BANDS).toEqual(['off', 'calendar', 'all'])
    expect(DEFAULT_SETTINGS.tableRowBand).toBe('all')
  })

  it('table.css: a band rule for `all` and one for `calendar` (calendar tables only), none for `off`; hover on body rows only', () => {
    const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
    // Each selector of the rules that set the band, one a line (a comma inside `:is(…)` does not split the list).
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*--table-band:[^{}]*\}/g)].flatMap(([, sel]) => sel!.split(/,\s*\n/).map((one) => one.trim()))
    // The caret's row and the mouse's, each unless "Rows it marks" leaves it out (the YAZ-3818 demo).
    expect(selectors.some((s) => s.startsWith("[data-table-row-band='all']:not([data-table-band-rows='mouse'])") && s.includes('.table-band-row'))).toBe(true)
    expect(selectors.some((s) => s.startsWith("[data-table-row-band='all']:not([data-table-band-rows='caret'])") && s.includes('tr:not(:first-child):hover'))).toBe(true)
    expect(selectors.some((s) => s.startsWith("[data-table-row-band='calendar']") && s.includes('[data-table-calendar]') && s.includes('.table-band-row'))).toBe(true)
    expect(css).not.toContain("[data-table-row-band='off']")
    // Bold first cell (the YAZ-3818 demo): each bold rule is off under `data-table-band-bold='off'`; the band is not.
    const bold = [...css.matchAll(/([^{}]+)\{[^{}]*font-weight: 600;[^{}]*\}/g)].flatMap(([, sel]) => sel!.split(/,\s*\n/).map((one) => one.trim())).filter((s) => s.startsWith('[data-table-row-band'))
    expect(bold).toHaveLength(4)
    for (const s of bold) expect(s).toContain(":not([data-table-band-bold='off'])")
    expect(selectors.some((s) => s.includes('data-table-band-bold'))).toBe(false)
    // The band is a background layer under the now mark's line; a frozen cell keeps its tint layer.
    // The cell note's corner triangle is the top layer of each list (the YAZ-3818 demo).
    expect(css).toMatch(/\.table-now-row > \* \{\s*background-image: var\(--table-note-mark, none\), var\(--table-open-ring, none\), var\(--table-now-line\), var\(--table-now-tint\), var\(--table-band, none\)/)
    expect(css).toMatch(/:is\(\.table-frozen-row > \*, \.table-frozen-col\) \{[^}]*background-image: var\(--table-note-mark, none\), var\(--table-open-ring, none\), var\(--table-band, none\), var\(--table-past, none\), linear-gradient/)
  })
})
