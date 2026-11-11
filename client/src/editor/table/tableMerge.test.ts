/**
 * Merge cells (YAZ-4792 demo: "Tables: merge cells"), on real editors (`tableTestKit`): a rectangle of selected cells
 * becomes one cell with `colspan` / `rowspan`, every cell's text kept (lines joined by a line break), one ⌘Z; the file
 * keeps the whole grid and says `merge A2:B2` in the table comment (A1 is the header row's first cell); a reload reads
 * the merge back; "Unmerge cells" puts the covered cells back empty, the text staying in the top-left one. Not allowed:
 * one cell, the header row with the body, a selection that holds a folded row.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { formatTableComment, parseTableComment, plainTable } from './tableComment'
import { mergeCells, mergeRect, unmergeCells } from './tableMerge'
import { cellPos, mountNote, unmountAll } from './tableTestKit'

afterEach(unmountAll)

const TABLE = '| Plan | Owner |\n| --- | --- |\n| Set up S3 | Ana |\n| Set up CloudFront | Ben |\n| Done | |\n'
const select = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const tableNode = (view: EditorView) => {
  let found = view.state.doc.firstChild!
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table') found = node
    return node.type.name !== 'table'
  })
  return found
}
/** Each row's cells as `text[colspan x rowspan]`. */
const grid = (view: EditorView) => {
  const out: string[][] = []
  tableNode(view).forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(`${cell.textContent}${cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 ? `[${cell.attrs.colspan}x${cell.attrs.rowspan}]` : ''}`))
    out.push(cells)
  })
  return out
}

describe('YAZ-4792 demo: the comment part', () => {
  it('YAZ-4792 demo: `merge A1:B1 A2:A3` reads into 0-based ranges and writes back the same', () => {
    const parsed = parseTableComment('<!-- table: merge A1:B1 A2:A3 -->')!
    expect(parsed.merge).toEqual([
      { top: 0, left: 0, bottom: 1, right: 2 },
      { top: 1, left: 0, bottom: 3, right: 1 },
    ])
    expect(formatTableComment(parsed)).toBe('<!-- table: merge A1:B1 A2:A3 -->')
    expect(formatTableComment({ ...plainTable(), merge: [{ top: 1, left: 0, bottom: 3, right: 1 }, { top: 0, left: 0, bottom: 1, right: 2 }] })).toBe('<!-- table: merge A1:B1 A2:A3 -->')
  })

  it('YAZ-4792 demo: a word that is no range keeps the part as text the reader does not know', () => {
    expect(parseTableComment('<!-- table: merge A1:zz, stripes -->')?.merge).toBeUndefined()
  })
})

describe('YAZ-4792 demo: merging', () => {
  it('YAZ-4792 demo: two body cells side by side become one cell spanning 2 columns, both texts kept', async () => {
    const { crepe, view } = await mountNote(TABLE)
    select(view, [1, 0], [1, 1])
    expect(mergeRect(view.state.selection)).not.toBeNull()
    expect(mergeCells(view.state, view.dispatch)).toBe(true)
    expect(grid(view)[1]).toEqual(['Set up S3\nAna[2x1]'])
    expect(getMarkdownForSave(crepe)).toContain('merge A2:B2')
  })

  it('YAZ-4792 demo: two lines merged down keep both lines in one cell, joined by a line break', async () => {
    const { crepe, view } = await mountNote(TABLE)
    select(view, [1, 0], [2, 0])
    mergeCells(view.state, view.dispatch)
    const cell = tableNode(view).child(1).child(0)
    expect(cell.attrs.rowspan).toBe(2)
    expect(cell.childCount).toBe(1)
    const kinds: string[] = []
    cell.firstChild!.forEach((n) => kinds.push(n.type.name === 'text' ? `text:${n.text}` : n.type.name))
    expect(kinds).toEqual(['text:Set up S3', 'hardbreak', 'text:Set up CloudFront'])
    const md = getMarkdownForSave(crepe)
    expect(md).toContain('merge A2:A3')
    expect(md).toMatch(/Set up S3<br\s*\/?>Set up CloudFront/)
    // The file keeps the whole grid: the covered cell is an empty cell of its row.
    expect(md).toMatch(/\|\s+\| Ben\s+\|/)
  })

  it('YAZ-4792 demo: one ⌘Z takes the merge off', async () => {
    const { crepe, view } = await mountNote(TABLE)
    const before = getMarkdownForSave(crepe)
    select(view, [1, 0], [2, 1])
    mergeCells(view.state, view.dispatch)
    expect(grid(view)[1][0]).toMatch(/\[2x2\]$/)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('YAZ-4792 demo: a reload of the file reads the merge back', async () => {
    const { crepe, view } = await mountNote(TABLE)
    select(view, [1, 0], [1, 1])
    mergeCells(view.state, view.dispatch)
    const saved = getMarkdownForSave(crepe)
    const again = await mountNote(saved)
    expect(grid(again.view)[1]).toEqual(['Set up S3\nAna[2x1]'])
    expect(getMarkdownForSave(again.crepe)).toBe(saved)
  })

  it('YAZ-4792 demo: the header can merge across its own row', async () => {
    const { crepe, view } = await mountNote(TABLE)
    select(view, [0, 0], [0, 1])
    expect(mergeCells(view.state, view.dispatch)).toBe(true)
    expect(grid(view)[0]).toEqual(['Plan\nOwner[2x1]'])
    expect(getMarkdownForSave(crepe)).toContain('merge A1:B1')
  })
})

describe('YAZ-4792 demo: what cannot merge', () => {
  it('YAZ-4792 demo: one cell, or the header row with a body row, gives no rectangle', async () => {
    const { view } = await mountNote(TABLE)
    select(view, [1, 0], [1, 0])
    expect(mergeRect(view.state.selection)).toBeNull()
    select(view, [0, 0], [1, 0])
    expect(mergeRect(view.state.selection)).toBeNull()
    expect(mergeCells(view.state, view.dispatch)).toBe(false)
  })

  it('YAZ-4792 demo: a selection that holds a folded row does not merge', async () => {
    const { view } = await mountNote(`${TABLE}\n<!-- table: fold 3 -->\n`)
    select(view, [1, 0], [2, 0])
    expect(mergeRect(view.state.selection)).toBeNull()
  })

  it('YAZ-4792 demo: a selection that cuts through a merged cell does not merge', async () => {
    const { view } = await mountNote(TABLE)
    select(view, [1, 0], [2, 0])
    mergeCells(view.state, view.dispatch)
    // The merged cell spans rows 1–2 of column 0; rows 2–3 of columns 0–1 cut through it.
    // Row 2 now holds one cell (Ben, in grid column 1); row 3's first cell is Done (grid column 0).
    const half = CellSelection.create(view.state.doc, cellPos(view, 3, 0), cellPos(view, 2, 0))
    expect(mergeRect(half)).toBeNull()
  })
})

describe('YAZ-4792 demo: unmerging', () => {
  it('YAZ-4792 demo: Unmerge puts the covered cells back, empty; the text stays in the top-left cell; the comment part goes', async () => {
    const { crepe, view } = await mountNote(TABLE)
    select(view, [1, 0], [1, 1])
    mergeCells(view.state, view.dispatch)
    // The caret in the merged cell.
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0))))
    expect(unmergeCells(view.state, view.dispatch)).toBe(true)
    expect(grid(view)[1]).toEqual(['Set up S3\nAna', ''])
    expect(getMarkdownForSave(crepe)).not.toContain('merge')
  })
})
