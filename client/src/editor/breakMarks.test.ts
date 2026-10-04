/**
 * Marks across line breaks (YAZ-2280, CONTRACTS rule 33). Real `createCrepe()` editors, no mocks.
 *
 * A SOFT break is a newline inside a paragraph, shown as a space; a HARD break is a real new line
 * (`\` + newline on disk). Every case checks the saved bytes and then loads them into a second
 * editor: a mark that Markdown cannot read back is the failure these tests exist for.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { toggleStrongCommand } from '@milkdown/kit/preset/commonmark'
import { deleteSelection } from '@milkdown/kit/prose/commands'
import { endOf, md, mount, posOf, pressKey, runCommand, select, selectAcross, selectText, unmountAll } from './marks/markTestKit'
import { setHighlightCommand, type HighlightColor } from './marks/highlight'

afterEach(unmountAll)

const SOFT = 'one two\nthree four\nfive six\n'
const HARD = 'one two\\\nthree four\\\nfive six\n'

const highlight = (crepe: Crepe, color: HighlightColor = null) =>
  crepe.editor.action((ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, color))
const bold = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key))

/** Every break in document order: its kind, and `+mark` when it carries one. */
function breaks(crepe: Crepe): string[] {
  const out: string[] = []
  crepe.editor.ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.type.name === 'hardbreak') out.push((node.attrs.isInline ? 'soft' : 'hard') + (node.marks.length > 0 ? '+mark' : ''))
  })
  return out
}

/** The marked text, one `[run]` per text node. */
function marked(crepe: Crepe): string {
  let out = ''
  crepe.editor.ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.isText && node.marks.length > 0) out += `[${node.text}]`
  })
  return out
}

/** The editor saves exactly `expected`, and those bytes load back to the same marks and bytes. */
async function expectSaved(crepe: Crepe, expected: string): Promise<void> {
  expect(md(crepe)).toBe(expected)
  const { crepe: reloaded } = await mount(expected)
  expect(marked(reloaded)).toBe(marked(crepe))
  expect(md(reloaded)).toBe(expected)
}

describe('a mark added across soft breaks', () => {
  it('1. highlight runs through the breaks and they stay soft', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['soft+mark', 'soft+mark'])
    await expectSaved(crepe, 'one ==two\nthree four\nfive== six\n')
  })

  it('2. a named colour does the same', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe, 'green')
    expect(breaks(crepe)).toEqual(['soft+mark', 'soft+mark'])
    await expectSaved(crepe, 'one <mark class="highlight-green">two\nthree four\nfive</mark> six\n')
  })

  it('3. bold does the same', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    bold(crepe)
    expect(breaks(crepe)).toEqual(['soft+mark', 'soft+mark'])
    await expectSaved(crepe, 'one **two\nthree four\nfive** six\n')
  })

  it('6. on then off returns the original bytes', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['soft', 'soft'])
    await expectSaved(crepe, SOFT)
  })
})

describe('a mark never starts or ends on a break', () => {
  it('4. a selection that starts on a break leaves it unmarked', async () => {
    const { crepe } = await mount(SOFT)
    select(crepe, endOf(crepe, 'two'), endOf(crepe, 'four'))
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['soft', 'soft'])
    await expectSaved(crepe, 'one two\n==three four==\nfive six\n')
  })

  it('5. a selection that ends on a break leaves it unmarked', async () => {
    const { crepe } = await mount(SOFT)
    select(crepe, posOf(crepe, 'three'), posOf(crepe, 'five'))
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['soft', 'soft'])
    await expectSaved(crepe, 'one two\n==three four==\nfive six\n')
  })

  it('7. un-highlighting the last line unmarks the break before it', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    selectText(crepe, 'five')
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['soft+mark', 'soft'])
    await expectSaved(crepe, 'one ==two\nthree four==\nfive six\n')
  })

  it('8. deleting the highlighted text after a break unmarks that break', async () => {
    const { crepe } = await mount(SOFT)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    select(crepe, posOf(crepe, 'five'), posOf(crepe, 'six'))
    runCommand(crepe, deleteSelection)
    expect(breaks(crepe)).toEqual(['soft+mark', 'soft'])
    await expectSaved(crepe, 'one ==two\nthree four==\nsix\n')
  })

  it('9. a loaded multi-line bold keeps its first line when its last line is deleted', async () => {
    const { crepe } = await mount('one **two\nthree** four\n')
    select(crepe, posOf(crepe, 'three'), posOf(crepe, 'four'))
    runCommand(crepe, deleteSelection)
    expect(breaks(crepe)).toEqual(['soft'])
    await expectSaved(crepe, 'one **two**\nfour\n')
  })
})

describe('what stays as it was', () => {
  it('10. hard breaks stay hard and unmarked', async () => {
    const { crepe } = await mount(HARD)
    selectAcross(crepe, 'two', 'five')
    highlight(crepe)
    expect(breaks(crepe)).toEqual(['hard', 'hard'])
    await expectSaved(crepe, 'one ==two==\\\n==three four==\\\n==five== six\n')
  })

  it('11. Shift-Enter inside a highlight inserts an unmarked hard break', async () => {
    const { crepe } = await mount('one ==twothree== four\n')
    select(crepe, endOf(crepe, 'two'))
    pressKey(crepe, 'Enter', { shift: true })
    expect(breaks(crepe)).toEqual(['hard'])
    await expectSaved(crepe, 'one ==two==\\\n==three== four\n')
  })

  it('12. a loaded multi-line highlight saves byte-identical', async () => {
    const { crepe } = await mount('one ==two\nthree== four\n')
    expect(breaks(crepe)).toEqual(['soft+mark'])
    await expectSaved(crepe, 'one ==two\nthree== four\n')
  })
})
