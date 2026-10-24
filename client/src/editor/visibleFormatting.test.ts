/**
 * Formatting acts on the lines you see (YAZ-3209). The S-numbers are the locked scenario table on
 * the working log (YAZ-3212); the rule is the CONTRACTS row after `Shift-ArrowUp` / `Shift-ArrowDown`.
 *
 * Driven through a REAL editor: the commands are called by their Milkdown keys (the path Crepe's
 * toolbar and the keymaps take) and the keys are pressed. The markdown out is the proof.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { type CmdKey, commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  isMarkSelectedCommand,
  linkSchema,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { undo } from '@milkdown/kit/prose/history'
import { AllSelection, NodeSelection } from '@milkdown/kit/prose/state'
import { caretIn, endOf, md, mount, posOf, pressKey, runCommand, select, selection, unmountAll } from './marks/markTestKit'
import { highlightSchema, rangeHasHighlight, setHighlightCommand } from './marks/highlight'
import { setHeadingFoldAtSelection } from './outline/headingFolding'
import { toggleOutlineFold } from './outline/outlineFolding'

afterEach(unmountAll)

const FOLDED = '* A\n  * a1\n  * a2\n* B\n  * b1\n'

const foldItem = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

/** Call a command by its key — what Crepe's toolbar buttons and the Milkdown keymaps do. */
const call = <T>(crepe: Crepe, command: { key: CmdKey<T> }, payload?: T): boolean =>
  crepe.editor.action((ctx) => ctx.get(commandsCtx).call(command.key, payload))

/** `A` and `B` folded, the selection from the start of A to the end of B. */
async function foldedParents(): Promise<Crepe> {
  const { crepe } = await mount(FOLDED)
  foldItem(crepe, 'A')
  foldItem(crepe, 'B')
  select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
  return crepe
}

/**
 * The toolbar's lit state, asked the way Crepe's Bold button asks it (`isMarkSelectedCommand`) and
 * the way the swatches ask it (`rangeHasHighlight`). The buttons themselves are pressed in the
 * end-to-end test: under jsdom a pointerdown on the strip collapses the selection before `onRun`.
 */
const boldLit = (crepe: Crepe): boolean =>
  crepe.editor.action((ctx) => ctx.get(commandsCtx).call(isMarkSelectedCommand.key, strongSchema.type(ctx)))
const yellowLit = (crepe: Crepe): boolean =>
  crepe.editor.action((ctx) => rangeHasHighlight(ctx.get(editorViewCtx).state, highlightSchema.type(ctx), null))

describe('format commands over hidden lines (YAZ-3209 D1–D3)', () => {
  it('S1: Bold over folded parents bolds the parents only', async () => {
    const crepe = await foldedParents()
    expect(call(crepe, toggleStrongCommand)).toBe(true)
    expect(md(crepe)).toBe('* **A**\n  * a1\n  * a2\n* **B**\n  * b1\n')
  })

  it('S1: Italic and Strikethrough follow the same rule', async () => {
    const crepe = await foldedParents()
    call(crepe, toggleEmphasisCommand)
    call(crepe, toggleStrikethroughCommand)
    expect(md(crepe)).toBe('* *~~A~~*\n  * a1\n  * a2\n* *~~B~~*\n  * b1\n')
  })

  it('S1: Mod-u underlines the parents only', async () => {
    const crepe = await foldedParents()
    expect(pressKey(crepe, 'u', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* <u>A</u>\n  * a1\n  * a2\n* <u>B</u>\n  * b1\n')
  })

  it('S2: the same parents UNFOLDED take the ordinary path — the kids inside the range are visible, so they change too', async () => {
    const { crepe } = await mount(FOLDED)
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **A**\n  * **a1**\n  * **a2**\n* **B**\n  * b1\n')
  })

  it('S3: Bold over a folded heading and the next heading leaves the folded body alone', async () => {
    const { crepe } = await mount('## X\n\nbody x\n\n## Y\n\nbody y\n')
    caretIn(crepe, 'X')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    select(crepe, posOf(crepe, 'X'), endOf(crepe, 'Y'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('## **X**\n\nbody x\n\n## **Y**\n\nbody y\n')
  })

  it('S4: zoomed into an item, a selection that reaches outside the zoom changes only the lines inside it', async () => {
    const { crepe } = await mount('* before\n* A\n  * a1\n* after\n')
    caretIn(crepe, 'A')
    expect(pressKey(crepe, '.', { mod: true })).toBe(true)
    select(crepe, posOf(crepe, 'before'), endOf(crepe, 'after'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* before\n* **A**\n  * **a1**\n* after\n')
  })

  it('S7: a selection inside one line takes the ordinary path', async () => {
    const { crepe } = await mount('* Alpha\n  * a1\n')
    foldItem(crepe, 'Alpha')
    select(crepe, posOf(crepe, 'Alpha'), posOf(crepe, 'Alpha') + 3)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **Alp**ha\n  * a1\n')
  })

  it('S8: a selection that starts and ends mid-line changes only the selected parts', async () => {
    const { crepe } = await mount('* Alpha\n  * a1\n* Beta\n')
    foldItem(crepe, 'Alpha')
    select(crepe, posOf(crepe, 'Alpha') + 2, posOf(crepe, 'Beta') + 2)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* Al**pha**\n  * a1\n* **Be**ta\n')
  })

  it('S9: the zero-width touch on the next line leaves that line alone', async () => {
    const { crepe } = await mount('* A\n  * a1\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'))
    expect(pressKey(crepe, 'ArrowDown', { shift: true })).toBe(true)
    expect(selection(crepe).head).toBe(posOf(crepe, 'B'))
    call(crepe, wrapInHeadingCommand, 2)
    expect(md(crepe)).toBe('* ## A\n  * a1\n* B\n')
  })

  it('S10: H1 / H2 / H3 over folded parents change the parents\' type only', async () => {
    const crepe = await foldedParents()
    call(crepe, wrapInHeadingCommand, 3)
    expect(md(crepe)).toBe('* ### A\n  * a1\n  * a2\n* ### B\n  * b1\n')
  })

  it('S10: T over folded parents turns the parents to text; a hidden heading kid stays a heading', async () => {
    const { crepe } = await mount('* ### A\n  * ### a1\n* ### B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    call(crepe, turnIntoTextCommand)
    expect(md(crepe)).toBe('* A\n  * ### a1\n* B\n')
  })

  it('S11: Mod-Enter over folded parents cycles the parents; hidden kids keep their state', async () => {
    const { crepe } = await mount('* A\n  * [x] a1\n  * a2\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(pressKey(crepe, 'Enter', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* [ ] A\n  * [x] a1\n  * a2\n* [ ] B\n')
  })

  it('S12: a highlight swatch over folded parents marks the parents only', async () => {
    const crepe = await foldedParents()
    call(crepe, setHighlightCommand, null)
    expect(md(crepe)).toBe('* ==A==\n  * a1\n  * a2\n* ==B==\n  * b1\n')
  })

  it('S13: inline code over folded parents codes the parents only, and drops other marks there only', async () => {
    const { crepe } = await mount('* **A**\n  * **a1**\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    call(crepe, toggleInlineCodeCommand)
    expect(md(crepe)).toBe('* `A`\n  * **a1**\n* `B`\n')
    call(crepe, toggleInlineCodeCommand)
    expect(md(crepe)).toBe('* A\n  * **a1**\n* B\n')
  })

  it('S14 + S15: the selection still carries the hidden kids for ⌘C / ⌘X, and one undo reverts the whole click', async () => {
    const crepe = await foldedParents()
    const before = selection(crepe)
    call(crepe, toggleStrongCommand)
    expect(selection(crepe)).toEqual(before)
    const copied = crepe.editor.ctx.get(editorViewCtx).state.selection.content().content
    expect(copied.textBetween(0, copied.size, '\n')).toContain('a1')
    expect(runCommand(crepe, undo)).toBe(true)
    expect(md(crepe)).toBe(FOLDED)
  })

  it('S16: a folded item inside an unfolded parent — the visible levels change, its kids do not', async () => {
    const { crepe } = await mount('* P\n  * C\n    * g1\n  * D\n')
    foldItem(crepe, 'C')
    select(crepe, posOf(crepe, 'P'), endOf(crepe, 'D'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **P**\n  * **C**\n    * g1\n  * **D**\n')
  })

  it('S17: ⌘A (select all) bolds the visible lines only, and Mod-Enter over it agrees', async () => {
    const { crepe, view } = await mount('* A\n* B\n  * b1\n')
    foldItem(crepe, 'B')
    expect(pressKey(crepe, 'a', { mod: true })).toBe(true)
    expect(view.state.selection).toBeInstanceOf(AllSelection)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **A**\n* **B**\n  * b1\n')
    expect(view.state.selection).toBeInstanceOf(AllSelection)
    expect(pressKey(crepe, 'Enter', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* [ ] **A**\n* [ ] **B**\n  * b1\n')
  })

  it('S17: a selection that ends inside hidden lines changes the visible lines only', async () => {
    const { crepe } = await mount('* A\n* B\n  * b1\n')
    foldItem(crepe, 'B')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'b1'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **A**\n* **B**\n  * b1\n')
  })

  it('S18: at a caret, Bold still toggles the stored mark', async () => {
    const { crepe, view } = await mount('* A\n  * a1\n')
    foldItem(crepe, 'A')
    caretIn(crepe, 'A')
    expect(call(crepe, toggleStrongCommand)).toBe(true)
    expect(view.state.storedMarks?.map((mark) => mark.type.name)).toEqual(['strong'])
    expect(md(crepe)).toBe('* A\n  * a1\n')
  })

  it('nothing visible selected (end of a folded line to the start of the next): the commands decline, nothing changes', async () => {
    const crepe = await foldedParents()
    select(crepe, endOf(crepe, 'A'), posOf(crepe, 'B'))
    expect(call(crepe, toggleStrongCommand)).toBe(false)
    expect(call(crepe, wrapInHeadingCommand, 2)).toBe(false)
    expect(call(crepe, setHighlightCommand, null)).toBe(false)
    expect(call(crepe, toggleInlineCodeCommand)).toBe(false)
    expect(pressKey(crepe, 'b', { mod: true })).toBe(false)
    expect(md(crepe)).toBe(FOLDED)
  })

  it('a node selection of a folded item (the block handle) bolds its own line only', async () => {
    const { crepe, view } = await mount(FOLDED)
    foldItem(crepe, 'A')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, posOf(crepe, 'A') - 2)))
    expect(pressKey(crepe, 'b', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* **A**\n  * a1\n  * a2\n* B\n  * b1\n')
  })

  it('an empty line strictly inside the range changes type with the others; the touch on the next line does not', async () => {
    const { crepe, view } = await mount('## X\n\nbody\n\n## W\n\n<br />\n\nY\n\nZ\n')
    caretIn(crepe, 'X')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    select(crepe, posOf(crepe, 'X'), posOf(crepe, 'Z'))
    call(crepe, wrapInHeadingCommand, 3)
    const types = (): string[] => {
      const out: string[] = []
      view.state.doc.forEach((node) => out.push(node.type.name === 'heading' ? `h${node.attrs.level}` : node.type.name))
      return out
    }
    expect(types()).toEqual(['h3', 'paragraph', 'h3', 'h3', 'h3', 'paragraph'])
  })
})

describe('what a fold really hides (YAZ-3209 bugs 1B1, 1B2)', () => {
  it('1B2: a folded bullet\'s own second paragraph is visible — it takes the format; only the nested list is skipped', async () => {
    const { crepe } = await mount('* A\n\n  second para\n\n  * a1\n\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(boldLit(crepe)).toBe(false)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **A**\n\n  **second para**\n\n  * a1\n\n* **B**\n')
    expect(boldLit(crepe)).toBe(true)
  })

  /** Zoom into Z, fold everything (P, Z's parent, too), then unfold Z: the zoom shows P's subtree expanded. */
  async function zoomedUnderFoldedParent(): Promise<Crepe> {
    const { crepe } = await mount('* P\n  * Z\n    * z1\n  * other\n* Q\n')
    caretIn(crepe, 'Z')
    expect(pressKey(crepe, '.', { mod: true })).toBe(true)
    expect(pressKey(crepe, 'u', { mod: true, shift: true })).toBe(true)
    caretIn(crepe, 'Z')
    expect(pressKey(crepe, 'ArrowDown', { mod: true })).toBe(true)
    return crepe
  }

  it('1B1: zoomed into a bullet whose parent is folded, Bold and the lit state work on the zoomed lines', async () => {
    const crepe = await zoomedUnderFoldedParent()
    select(crepe, posOf(crepe, 'Z'), endOf(crepe, 'z1'))
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* P\n  * **Z**\n    * **z1**\n  * other\n* Q\n')
    expect(boldLit(crepe)).toBe(true)
  })

  it('1B1: … and Mod-Enter at a plain caret cycles the zoomed line', async () => {
    const crepe = await zoomedUnderFoldedParent()
    caretIn(crepe, 'z1')
    expect(pressKey(crepe, 'Enter', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('* P\n  * Z\n    * [ ] z1\n  * other\n* Q\n')
  })

  it('1B1: … and ⇧↓ moves onto the zoomed kid, not past it (the YAZ-1734 walk has the same rule)', async () => {
    const crepe = await zoomedUnderFoldedParent()
    select(crepe, posOf(crepe, 'Z'))
    expect(pressKey(crepe, 'ArrowDown', { shift: true })).toBe(true)
    expect(selection(crepe).head).toBe(posOf(crepe, 'z1'))
  })
})

describe('the toolbar over hidden lines (YAZ-3209 D4)', () => {
  it('S5: a hidden kid is bold, the parents are not — Bold is not lit, and the click bolds the parents', async () => {
    const { crepe } = await mount('* A\n  * **a1**\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(boldLit(crepe)).toBe(false)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* **A**\n  * **a1**\n* **B**\n')
  })

  it('S6: the parents are bold, a hidden kid is not — Bold is lit, and the click unbolds the parents only', async () => {
    const { crepe } = await mount('* **A**\n  * a1\n* **B**\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(boldLit(crepe)).toBe(true)
    call(crepe, toggleStrongCommand)
    expect(md(crepe)).toBe('* A\n  * a1\n* B\n')
  })

  it('S12: a highlighted hidden kid does not light the swatch; the click marks the parents', async () => {
    const { crepe } = await mount('* A\n  * ==a1==\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(yellowLit(crepe)).toBe(false)
    call(crepe, setHighlightCommand, null)
    expect(md(crepe)).toBe('* ==A==\n  * ==a1==\n* ==B==\n')
    expect(yellowLit(crepe)).toBe(true)
  })

  it('S19: the Link button keeps Milkdown\'s whole-range lit state — a link under the fold still lights it', async () => {
    const { crepe } = await mount('* A\n  * [a1](https://example.com)\n* B\n')
    foldItem(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(crepe.editor.action((ctx) => ctx.get(commandsCtx).call(isMarkSelectedCommand.key, linkSchema.type(ctx)))).toBe(true)
  })

  it('S5 control: unfolded, the bold kid is visible, so Bold lights', async () => {
    const { crepe } = await mount('* A\n  * **a1**\n* B\n')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    expect(boldLit(crepe)).toBe(true)
  })
})
