/**
 * Shift+arrow in a table cell (YAZ-4171) on the real editor in jsdom, the keys through ProseMirror's `handleKeyDown`
 * (so `lineKeymap`, Crepe's keymaps and `tableEditing` take part in their real order). At the edge of a cell's text,
 * the first Shift+arrow selects only that cell; the next one grows the selection to the neighbour cell.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { endOf, mount, posOf, pressKey, select, unmountAll } from '../marks/markTestKit'

afterEach(unmountAll)

const TABLE = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |\n'
type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** The text of each selected cell, in reading order; or the selection's kind when it is not a CellSelection. */
function selected(crepe: Crepe): string[] | string {
  const { selection } = crepe.editor.ctx.get(editorViewCtx).state
  if (!(selection instanceof CellSelection)) return selection.constructor.name
  const cells: string[] = []
  selection.forEachCell((cell) => { cells.push(cell.textContent) })
  return cells
}

describe('Shift+arrow at the edge of a cell\'s text selects only that cell (YAZ-4171)', () => {
  it.each([
    ['ArrowRight', 'end', ['b2', 'c2']],
    ['ArrowLeft', 'start', ['a2', 'b2']],
    ['ArrowUp', 'end', ['b1', 'b2']],
    ['ArrowUp', 'start', ['b1', 'b2']],
    ['ArrowDown', 'end', ['b2', 'b3']],
    ['ArrowDown', 'start', ['b2', 'b3']],
  ] as Array<[Arrow, 'start' | 'end', string[]]>)('Shift+%s at the %s of the text: the cell, then the cell and its neighbour', async (key, edge, grown) => {
    const { crepe } = await mount(TABLE)
    select(crepe, edge === 'start' ? posOf(crepe, 'b2') : endOf(crepe, 'b2'))
    expect(pressKey(crepe, key, { shift: true })).toBe(true)
    expect(selected(crepe)).toEqual(['b2'])
    expect(pressKey(crepe, key, { shift: true })).toBe(true)
    expect(selected(crepe)).toEqual(grown)
  })

  it('away from the edge, Shift+arrow keeps a text selection in the cell', async () => {
    const { crepe } = await mount(TABLE)
    const view = crepe.editor.ctx.get(editorViewCtx)
    // ⇧← / ⇧→ in the middle of the text: the browser's own move, no handler takes it.
    select(crepe, posOf(crepe, 'b2') + 1)
    expect(pressKey(crepe, 'ArrowRight', { shift: true })).toBe(false)
    expect(pressKey(crepe, 'ArrowLeft', { shift: true })).toBe(false)
    // ⇧↑ on a line box that is not the cell's first (jsdom has no line boxes: `endOfTextblock` says so). Neither
    // table plugin takes it, so `lineKeymap` does (YAZ-1734 D2): the head goes to the start of the cell's text.
    view.endOfTextblock = () => false
    expect(pressKey(crepe, 'ArrowUp', { shift: true })).toBe(true)
    expect(view.state.selection).toBeInstanceOf(TextSelection)
    expect({ anchor: view.state.selection.anchor, head: view.state.selection.head }).toEqual({ anchor: posOf(crepe, 'b2') + 1, head: posOf(crepe, 'b2') })
  })
})
