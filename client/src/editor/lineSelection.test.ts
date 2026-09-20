/**
 * Whole-line selection (YAZ-1734): the real editor (`createCrepe`), `Shift-ArrowDown` /
 * `Shift-ArrowUp` dispatched through ProseMirror's `handleKeyDown` (so Crepe's keymaps and
 * `lineKeymap` take part in priority order), then the selection positions and — after a plain
 * `Backspace` — the serialised markdown (`getMarkdownForSave`) are asserted. The delete path is
 * ProseMirror's own `deleteRange` (D3): these tests pin what it does to a whole-line selection.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { caretIn, md, mount, posOf, pressKey, unmountAll } from './marks/markTestKit'
import { setHeadingFoldAtSelection } from './outline/headingFolding'
import { toggleOutlineFold } from './outline/outlineFolding'
import { getZoomedItemPos } from './outline/zoom'
import { deleteVisible } from './lineSelection'

afterEach(unmountAll)

const shiftDown = (crepe: Crepe) => pressKey(crepe, 'ArrowDown', { shift: true, mod: false })
const shiftUp = (crepe: Crepe) => pressKey(crepe, 'ArrowUp', { shift: true, mod: false })
const backspace = (crepe: Crepe) => pressKey(crepe, 'Backspace', { mod: false })
const forwardDelete = (crepe: Crepe) => pressKey(crepe, 'Delete', { mod: false })
/** Typed text through ProseMirror's `handleTextInput` chain, as the DOM input path would deliver it. */
const typeText = (crepe: Crepe, text: string): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    return view.someProp('handleTextInput', (h) => h(view, from, to, text, () => view.state.tr)) ?? false
  })

const startOf = (crepe: Crepe, text: string) => posOf(crepe, text)
const endOf = (crepe: Crepe, text: string) => posOf(crepe, text) + text.length

function select(crepe: Crepe, anchor: number, head = anchor): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  })
}

const sel = (crepe: Crepe) =>
  crepe.editor.action((ctx) => {
    const { anchor, head } = ctx.get(editorViewCtx).state.selection
    return { anchor, head }
  })

/** Run a ProseMirror command against the live view (the fold plugins' own test pattern). */
const runCommand = (crepe: Crepe, command: (state: EditorView['state'], dispatch: EditorView['dispatch']) => boolean): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return command(view.state, view.dispatch)
  })

/** Fold the parent bullet whose own text is `text` (item = text pos - paragraph open - item open). */
const foldItem = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

const THREE = 'one\n\ntwo\n\nthree\n'
const FIVE = 'l1\n\nl2\n\nl3\n\nl4\n\nl5\n'

describe('Shift-ArrowDown / Shift-ArrowUp from a block edge (D1, D2)', () => {
  it('⇧↓ from the start of paragraph 1 selects exactly [start p1, start p2]; ⌫ removes p1 only', async () => {
    const { crepe } = await mount(THREE)
    select(crepe, startOf(crepe, 'one'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'one'), head: startOf(crepe, 'two') })
    expect(backspace(crepe)).toBe(true)
    expect(md(crepe)).toBe('two\n\nthree\n')
  })

  it('repeats: three ⇧↓ from the start of line 1 land on the start of line 4 — three whole lines, never part of a fourth', async () => {
    const { crepe } = await mount(FIVE)
    select(crepe, startOf(crepe, 'l1'))
    expect(shiftDown(crepe)).toBe(true)
    expect(shiftDown(crepe)).toBe(true)
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'l1'), head: startOf(crepe, 'l4') })
    backspace(crepe)
    expect(md(crepe)).toBe('l4\n\nl5\n')
  })

  it('repeats upward: three ⇧↑ from the end of line 5 land on the end of line 2', async () => {
    const { crepe } = await mount(FIVE)
    select(crepe, endOf(crepe, 'l5'))
    expect(shiftUp(crepe)).toBe(true)
    expect(shiftUp(crepe)).toBe(true)
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'l5'), head: endOf(crepe, 'l2') })
    backspace(crepe)
    expect(md(crepe)).toBe('l1\n\nl2\n')
  })

  it('⇧↑ from the END of a paragraph puts the head at the end of the previous one; ⌫ removes only this paragraph', async () => {
    const { crepe } = await mount(THREE)
    select(crepe, endOf(crepe, 'two'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'two'), head: endOf(crepe, 'one') })
    backspace(crepe)
    expect(md(crepe)).toBe('one\n\nthree\n')
  })

  it('⇧↓ from the END of a paragraph puts the head at the end of the next one (same edge, D2)', async () => {
    const { crepe } = await mount(THREE)
    select(crepe, endOf(crepe, 'one'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'one'), head: endOf(crepe, 'two') })
  })
})

describe('list items (D1: a line is the item\'s OWN paragraph; D3: children survive)', () => {
  const NESTED = '* parent\n  * child a\n  * child b\n* sibling\n'

  it('⇧↓ from the start of a parent lands on the start of its first child; ⌫ puts the children in its place, one level up (D3)', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, startOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'parent'), head: startOf(crepe, 'child a') })
    backspace(crepe)
    // `deleteRange` alone leaves `list_item(bullet_list(...))` — `* * child a`; `liftHeadlessItems`
    // normalises it in the same dispatch. The caret stays on its line.
    expect(md(crepe)).toBe('* child a\n* child b\n* sibling\n')
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'child a'), head: startOf(crepe, 'child a') })
  })

  it('D3: a parent that is the FIRST item of a nested list — its children take its place at that level', async () => {
    const { crepe } = await mount('* top\n  * parent\n    * child a\n    * child b\n  * sib\n')
    select(crepe, startOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* top\n  * child a\n  * child b\n  * sib\n')
  })

  it('D3: a parent in the middle of its list', async () => {
    const { crepe } = await mount('* before\n* parent\n  * c1\n  * c2\n* after\n')
    select(crepe, startOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* before\n* c1\n* c2\n* after\n')
  })

  it('D3: grandchildren stay nested under their own child', async () => {
    const { crepe } = await mount('* parent\n  * child a\n    * grand a\n    * grand b\n  * child b\n* sibling\n')
    select(crepe, startOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* child a\n  * grand a\n  * grand b\n* child b\n* sibling\n')
  })

  it('D3 is path-agnostic: any transaction that leaves an item without its paragraph is normalised', async () => {
    const { crepe } = await mount(NESTED)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const $p = view.state.doc.resolve(startOf(crepe, 'parent'))
      view.dispatch(view.state.tr.delete($p.before(), $p.after()))
    })
    expect(md(crepe)).toBe('* child a\n* child b\n* sibling\n')
  })

  it('walks child → next sibling → back OUT to a parent-level item (the less-indented neighbour)', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, startOf(crepe, 'child a'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe).head).toBe(startOf(crepe, 'child b'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'child a'), head: startOf(crepe, 'sibling') })
    backspace(crepe)
    // Exactly the two child lines go; `sibling` keeps its own level.
    expect(md(crepe)).toBe('* parent\n* sibling\n')
  })

  it('⇧↑ from the end of a parent-level item climbs INTO the previous item\'s last child', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, endOf(crepe, 'sibling'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'sibling'), head: endOf(crepe, 'child b') })
  })
})

describe('headings and empty lines', () => {
  it('a heading line selected via ⇧↓ then ⌫: the paragraph below stays a paragraph', async () => {
    const { crepe } = await mount('# Title\n\nbody text\n')
    select(crepe, startOf(crepe, 'Title'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'Title'), head: startOf(crepe, 'body text') })
    backspace(crepe)
    expect(md(crepe)).toBe('body text\n')
  })

  it('an empty line: ⇧↓ takes the start edge, ⇧↑ the end edge (D2)', async () => {
    const { crepe } = await mount('above\n\n<br />\n\nbelow\n')
    const emptyPos = crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      let pos = -1
      doc.forEach((node, offset) => {
        if (pos < 0 && node.isTextblock && node.content.size === 0) pos = offset + 1
      })
      if (pos < 0) throw new Error('no empty paragraph')
      return pos
    })
    select(crepe, emptyPos)
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: emptyPos, head: startOf(crepe, 'below') })
    select(crepe, emptyPos)
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: emptyPos, head: endOf(crepe, 'above') })
  })
})

describe('head mid-line: the rest of its own line first (D2, demo amendment)', () => {
  it('⇧↓ selects to the end of THIS line, then continues one whole line per press', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'l2')
    const { anchor } = sel(crepe)
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l2') })
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l3') })
  })

  it('⇧↑ selects to the start of THIS line, then continues one whole line per press', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'l4')
    const { anchor } = sel(crepe)
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l4') })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l3') })
  })

  it('mid-line ⇧↓ then ⌫ removes only the rest of that line; the line below is untouched', async () => {
    const { crepe } = await mount('one two\n\nthree\n')
    select(crepe, endOf(crepe, 'one'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('one\n\nthree\n')
  })
})

describe('rule A: a press never crosses the anchor — ⇧↑ undoes exactly one ⇧↓', () => {
  it('mid l2: ⇧↓ end l2 → ⇧↓ end l3 → ⇧↑ end l2 → ⇧↑ collapses on the anchor → ⇧↑ start l2 → ⇧↑ start l1', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'l2')
    const { anchor } = sel(crepe)
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l2') })
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l3') })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l2') })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l2') })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l1') })
  })

  it('the same chain upward first: mid l4 → ⇧↑ start l4 → ⇧↑ start l3 → ⇧↓ start l4 → ⇧↓ anchor → ⇧↓ end l4 → ⇧↓ end l5', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'l4')
    const { anchor } = sel(crepe)
    shiftUp(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l4') })
    shiftUp(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l3') })
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l4') })
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: anchor })
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l4') })
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l5') })
  })

  it('whole lines: anchor start l2, ⇧↓×2 → start l4, ⇧↑×2 → collapsed on l2, ⇧↑ once more → start of l1', async () => {
    const { crepe } = await mount(FIVE)
    const anchor = startOf(crepe, 'l2')
    select(crepe, anchor)
    shiftDown(crepe)
    shiftDown(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l4') })
    shiftUp(crepe)
    shiftUp(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: anchor })
    shiftUp(crepe)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l1') })
  })
})

describe('rule B: the head only lands on a VISIBLE line; hidden text between goes with the selection', () => {
  const FOLDED = '* P\n  * k1\n  * k2\n* S\n'

  it('folded parent then sibling: start of P, ⇧↓ → start of S (kids skipped); ⌫ takes P\'s line only — the hidden kids lift (rule C + D3)', async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, startOf(crepe, 'P'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'P'), head: startOf(crepe, 'S') })
    backspace(crepe)
    expect(md(crepe)).toBe('* k1\n* k2\n* S\n')
  })

  it('start of S, ⇧↑ → start of P (over the hidden kids); ⌫ takes P\'s line only', async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, startOf(crepe, 'S'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'S'), head: startOf(crepe, 'P') })
    backspace(crepe)
    expect(md(crepe)).toBe('* k1\n* k2\n* S\n')
  })

  it("end of P's own text, ⇧↓ → end of S, the hidden kids inside the range", async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, endOf(crepe, 'P'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'P'), head: endOf(crepe, 'S') })
  })

  it('unfolded, the same ⇧↓ lands on the first kid (the fold is what hides it)', async () => {
    const { crepe } = await mount(FOLDED)
    select(crepe, startOf(crepe, 'P'))
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(startOf(crepe, 'k1'))
  })

  it('a folded H2 section then another H2: the section body is skipped both ways; ⌫ takes the heading only, its body reappears, B stays a heading', async () => {
    const { crepe } = await mount('## A\n\nbody a\n\n## B\n\nbody b\n')
    caretIn(crepe, 'A')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    select(crepe, startOf(crepe, 'A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'A'), head: startOf(crepe, 'B') })
    select(crepe, startOf(crepe, 'B'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'B'), head: startOf(crepe, 'A') })
    backspace(crepe)
    expect(md(crepe)).toBe('body a\n\n## B\n\nbody b\n')
  })

  it('zoomed into an item: the last visible line ⇧↓ and the first visible line ⇧↑ are consumed no-ops', async () => {
    const { crepe } = await mount('intro\n\n* Z\n  * z1\n  * z2\n* S\n\nafter\n')
    caretIn(crepe, 'Z')
    expect(pressKey(crepe, '.')).toBe(true) // ⌘. zooms into Z
    expect(crepe.editor.action((ctx) => getZoomedItemPos(ctx.get(editorViewCtx).state))).toBe(startOf(crepe, 'Z') - 2)
    select(crepe, endOf(crepe, 'z2'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'z2'), head: endOf(crepe, 'z2') })
    select(crepe, startOf(crepe, 'Z'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'Z'), head: startOf(crepe, 'Z') })
    // Inside the zoom the walk is the ordinary one.
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe).head).toBe(startOf(crepe, 'z1'))
  })
})

describe('rule C: delete never touches hidden text', () => {
  // A's line is two words so "mid A" is a real cut; A is folded in every test but the control.
  const DOC = '* A-first-half tail\n  * a1\n  * a2\n* B\n* C\n'
  const A = 'A-first-half tail'

  it('mid A → ⇧↓ (end A) → ⇧↓ (end B) → ⌫: A\'s tail and B gone, kids still under A, caret at the cut', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    const cut = endOf(crepe, 'A-first-half')
    select(crepe, cut)
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(endOf(crepe, A))
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(endOf(crepe, 'B'))
    expect(backspace(crepe)).toBe(true)
    expect(md(crepe)).toBe('* A-first-half\n  * a1\n  * a2\n* C\n')
    expect(sel(crepe)).toEqual({ anchor: cut, head: cut })
  })

  it('end of A → ⇧↓ → ⌫: B gone, A\'s text and kids intact', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, A))
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(endOf(crepe, 'B'))
    backspace(crepe)
    expect(md(crepe)).toBe('* A-first-half tail\n  * a1\n  * a2\n* C\n')
  })

  it('start of A → ⇧↓ → ⌫: A\'s line gone, kids lifted (the unfolded D3 result), B and C intact', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, startOf(crepe, A))
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(startOf(crepe, 'B'))
    backspace(crepe)
    expect(md(crepe)).toBe('* a1\n* a2\n* B\n* C\n')
  })

  it('end of B → ⇧↑ → Delete: B gone, A and its kids intact', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, 'B'))
    shiftUp(crepe)
    expect(sel(crepe).head).toBe(endOf(crepe, A))
    expect(forwardDelete(crepe)).toBe(true)
    expect(md(crepe)).toBe('* A-first-half tail\n  * a1\n  * a2\n* C\n')
  })

  it('mid A → ⇧↓ ×3 (head at end of C) → type x: only the visible pieces are replaced', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, 'A-first-half'))
    shiftDown(crepe)
    shiftDown(crepe)
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(endOf(crepe, 'C'))
    expect(typeText(crepe, 'x')).toBe(true)
    expect(md(crepe)).toBe('* A-first-halfx\n  * a1\n  * a2\n')
  })

  it('folded H2 section then another: start of `## One` ⇧↓ ⌫ → the heading goes, its section text is back and intact, `## Two` intact', async () => {
    const { crepe } = await mount('## One\n\nbody one\n\n## Two\n\nbody two\n')
    caretIn(crepe, 'One')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    select(crepe, startOf(crepe, 'One'))
    shiftDown(crepe)
    expect(sel(crepe).head).toBe(startOf(crepe, 'Two'))
    backspace(crepe)
    expect(md(crepe)).toBe('body one\n\n## Two\n\nbody two\n')
  })

  it('D7: Enter over a range spanning hidden lines removes only the visible pieces, then the ordinary Enter splits there — kids survive', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, 'A-first-half'))
    expect(shiftDown(crepe)).toBe(true) // own end
    expect(shiftDown(crepe)).toBe(true) // end of B, hidden kids skipped
    pressKey(crepe, 'Enter', { mod: false })
    // The visible pieces went (A's tail, B); the ordinary Enter then split A's item after the cut.
    expect(md(crepe)).toBe('* A-first-half\n  * a1\n  * a2\n*\n* C\n')
  })

  it('control: a selection spanning NO hidden line is not ours — deleteVisible returns false and the ordinary path runs', async () => {
    const { crepe } = await mount(DOC)
    select(crepe, startOf(crepe, A), startOf(crepe, 'B'))
    expect(runCommand(crepe, deleteVisible())).toBe(false)
    expect(typeText(crepe, 'x')).toBe(false)
    backspace(crepe)
    // Unfolded, a1 and a2 are VISIBLE lines inside the range — the ordinary path rightly takes them.
    expect(md(crepe)).toBe('* B\n* C\n')
  })
})

describe('document edge: consumed no-op (rule B — native never gets the key)', () => {
  it('⇧↑ on the first line and ⇧↓ on the last line return true and leave the selection alone', async () => {
    const { crepe } = await mount(THREE)
    select(crepe, startOf(crepe, 'one'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'one'), head: startOf(crepe, 'one') })
    select(crepe, endOf(crepe, 'three'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'three'), head: endOf(crepe, 'three') })
  })
})

describe('falls through to the native move (returns false)', () => {

  it('a horizontal rule between two paragraphs blocks both directions', async () => {
    const { crepe } = await mount('above\n\n---\n\nbelow\n')
    select(crepe, startOf(crepe, 'above'))
    expect(shiftDown(crepe)).toBe(false)
    expect(sel(crepe)).toEqual({ anchor: startOf(crepe, 'above'), head: startOf(crepe, 'above') })
    select(crepe, endOf(crepe, 'below'))
    expect(shiftUp(crepe)).toBe(false)
  })

  it('an image line (`![](x.png)`) parses as a paragraph holding an inline image — a textblock, so it is a line like any other', async () => {
    // Crepe's ImageBlock feature is off (featureConfig.ts); commonmark's `image` is an inline
    // atom, so the paragraph around it is what the head lands in.
    const { crepe } = await mount('above\n\n![](x.png)\n\nbelow\n')
    const imageParaStart = crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      let pos = -1
      doc.descendants((node, nodePos) => {
        if (pos < 0 && node.type.name === 'image') pos = nodePos
        return pos < 0
      })
      if (pos < 0) throw new Error('no image node')
      return pos
    })
    select(crepe, startOf(crepe, 'above'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe).head).toBe(imageParaStart)
  })

  it('a node selection', async () => {
    const { crepe } = await mount('above\n\n---\n\nbelow\n')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let hrPos = -1
      view.state.doc.forEach((node, offset) => {
        if (hrPos < 0 && node.type.name === 'hr') hrPos = offset
      })
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)))
    })
    expect(shiftDown(crepe)).toBe(false)
    expect(shiftUp(crepe)).toBe(false)
  })
})

describe('Rule A on the first / last line: the way back still reaches the anchor', () => {
  it('first line: mid l1 ⇧↓ to its end, then ⇧↑ collapses to the anchor instead of doing nothing', async () => {
    const { crepe } = await mount(THREE)
    caretIn(crepe, 'one')
    const { anchor } = sel(crepe)
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'one') })
    expect(shiftUp(crepe)).toBe(true) // no line above, but the anchor is below the head: go there
    expect(sel(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'one') })
    expect(shiftUp(crepe)).toBe(true) // first line, nothing above, anchor not ahead: consumed no-op
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'one') })
  })

  it('last line: mid l3 ⇧↑ to its start, then ⇧↓ collapses to the anchor', async () => {
    const { crepe } = await mount(THREE)
    caretIn(crepe, 'three')
    const { anchor } = sel(crepe)
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'three') })
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: anchor })
  })
})

describe('the anchor never moves', () => {
  it('a non-empty selection whose head is on an edge keeps its anchor across ⇧↓ and ⇧↑', async () => {
    const { crepe } = await mount(FIVE)
    const anchor = startOf(crepe, 'l2') + 1
    select(crepe, anchor, startOf(crepe, 'l3'))
    expect(shiftDown(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l4') })
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor, head: startOf(crepe, 'l3') })
    // Backwards selection (head above anchor) too.
    select(crepe, anchor, endOf(crepe, 'l1'))
    expect(shiftUp(crepe)).toBe(true) // l1 is the first line: consumed no-op, anchor and head untouched
    expect(sel(crepe)).toEqual({ anchor, head: endOf(crepe, 'l1') })
    select(crepe, endOf(crepe, 'l4'), endOf(crepe, 'l3'))
    expect(shiftUp(crepe)).toBe(true)
    expect(sel(crepe)).toEqual({ anchor: endOf(crepe, 'l4'), head: endOf(crepe, 'l2') })
  })
})
