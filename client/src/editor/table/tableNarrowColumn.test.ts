/**
 * A table column drags narrower (YAZ-4791 demo: "how come i cant make the column even more smaller? … all the way to
 * the left close to the numbers"): the minimum is 24px, not 60, and a column under `NARROW_COLUMN` (56px) gets narrow
 * cells (`data-narrow`, 4px padding in `table.css`). jsdom has no layout: `tableTestKit` gives each cell 100 × 30 px.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellDOM, cellPos, dragColumnEdge, mountNote, mountTable as mount, unmountAll } from './tableTestKit'
import { NARROW_COLUMN } from './tableStyle'
import { getMarkdownForSave } from '../createCrepe'
import tableCss from './table.css?inline'

afterEach(unmountAll)

const colwidths = (view: EditorView) => [0, 1, 2].map((row) => [0, 1].map((col) => view.state.doc.nodeAt(cellPos(view, row, col))!.attrs.colwidth))
const narrow = (view: EditorView, col: number) => [0, 1, 2].map((row) => cellDOM(view, row, col).hasAttribute('data-narrow'))

describe('YAZ-4791 demo: a column goes down to 24px', () => {
  it('YAZ-4791 demo: dragged far left, the first column stops at 24px, not 60', async () => {
    const view = await mount()
    dragColumnEdge(view, 0, -95)
    expect(colwidths(view).map((row) => row[0])).toEqual([[24], [24], [24]])
  })

  it('YAZ-4791 demo: a drag to 40px keeps 40px', async () => {
    const view = await mount()
    dragColumnEdge(view, 0, -60)
    expect(colwidths(view)[0][0]).toEqual([40])
  })
})

describe('YAZ-4791 demo: a column under 56px gets narrow cells', () => {
  it('YAZ-4791 demo: NARROW_COLUMN is 56', () => {
    expect(NARROW_COLUMN).toBe(56)
  })

  it('YAZ-4791 demo: after a drag to 24px every cell of that column is narrow; the other column is not', async () => {
    const view = await mount()
    expect(narrow(view, 0)).toEqual([false, false, false])
    dragColumnEdge(view, 0, -95)
    expect(narrow(view, 0)).toEqual([true, true, true])
    expect(narrow(view, 1)).toEqual([false, false, false])
  })

  it('YAZ-4791 demo: from the file, widths 24 and 55 are narrow, 56 is not; the widths save as they were', async () => {
    const md = '| # | Name | Note |\n| - | - | - |\n| 1 | a | x |\n\n<!-- table: widths 24 55 56 -->\n'
    const { crepe, view } = await mountNote(md)
    expect([0, 1, 2].map((col) => cellDOM(view, 1, col).hasAttribute('data-narrow'))).toEqual([true, true, false])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: widths 24 55 56 -->')
  })

  it('YAZ-4791 demo: table.css pads a narrow cell 4px on each side', () => {
    const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /\.milkdown \.ProseMirror \.milkdown-table-block :is\(th, td\)\[data-narrow\]\s*\{([^}]*)\}/.exec(css)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/padding-left:\s*4px/)
    expect(m![1]).toMatch(/padding-right:\s*4px/)
  })
})
