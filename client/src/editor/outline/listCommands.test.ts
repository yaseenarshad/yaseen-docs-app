/**
 * Outliner list commands (GRO-2012): the real editor (`createCrepe`) on a 4-level fixture,
 * keys dispatched through ProseMirror's `handleKeyDown` (so Crepe's own keymaps, the indent
 * plugin and our `outlinerKeymap` all take part, in priority order), then the serialised
 * markdown (`getMarkdownForSave`) is asserted — markers and indent must match depth exactly,
 * which is what bit GRO-1844. Empty bullets serialise as a bare `*` (`listItemRoundTrip.ts`);
 * empty task items as `* [ ]`.
 *
 * YAZ-3695 (Enter keeps the fold, Delete deletes forward, one join rule, the caret guard): one test
 * per scenario row of the record on YAZ-3699, numbered as in the build brief. In jsdom plain character
 * deletion is NATIVE (contenteditable), so "Delete removes the next character" reads as: no handler
 * takes the key and the doc is unchanged. Markdown drops leading empty lines, so an empty paragraph at
 * the top or between blocks is inserted with a transaction (`insertEmptyParagraph`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { closeHistory } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { OUTLINE_TOGGLE_CLASS } from './outlineFolding'
import { getZoomLabel } from './zoom'

const OUTLINE = `* L1 a
  * L2 a
    * L3 a
      * L4 a
    * L3 b
  * L2 b
* L1 b
* L1 c
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const KEY_CODES: Record<string, number> = { Tab: 9, Enter: 13, Backspace: 8, Delete: 46, d: 68, h: 72, z: 90, '.': 190 }

/**
 * One key press as the browser delivers it: the DOM keydown handlers first (the Enter tracker of
 * D7), then `handleKeyDown`. `key` is a ProseMirror key name — `Enter`, `Shift-Tab`, `Ctrl-Alt-Backspace`,
 * `Mod-z`; `Mod` is ⌘ (`test-setup.ts` pins a Mac). Answers whether a handler took the key.
 */
function press(crepe: Crepe, key: string): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parts = key.split('-')
    const name = parts.pop()!
    const init: KeyboardEventInit & { keyCode?: number } = {
      key: name,
      code: name,
      keyCode: KEY_CODES[name],
      shiftKey: parts.includes('Shift'),
      altKey: parts.includes('Alt'),
      ctrlKey: parts.includes('Ctrl'),
      metaKey: parts.includes('Mod'),
      bubbles: true,
      cancelable: true,
    }
    const event = new KeyboardEvent('keydown', init)
    if (view.someProp('handleDOMEvents', (handlers) => handlers.keydown?.(view, event))) return true
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

/** Document position of `text` (start of the first text node containing it) plus `offset`. */
function posOf(crepe: Crepe, text: string, offset = 0): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + offset
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

function select(crepe: Crepe, from: number, to = from): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

/** Caret at the end of `text` (or `offset` characters into it). */
const caretIn = (crepe: Crepe, text: string, offset = text.length) => select(crepe, posOf(crepe, text, offset))
const caretPos = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
const md = (crepe: Crepe) => getMarkdownForSave(crepe)
const viewOf = (crepe: Crepe): EditorView => crepe.editor.ctx.get(editorViewCtx)

/** Click the chevron of the bullet or heading `label` (folded: "Expand …", open: "Collapse …"). */
const fold = (root: HTMLElement, label: string) => root.querySelector<HTMLButtonElement>(`[aria-label="Collapse ${label}"]`)!.click()
const isFolded = (root: HTMLElement, label: string) => root.querySelector(`[aria-label="Expand ${label}"]`) !== null
const isOpen = (root: HTMLElement, label: string) => root.querySelector(`[aria-label="Collapse ${label}"]`) !== null

/** Insert an empty paragraph at `pos` and put the caret in it: a setup step, then `closeHistory`, so the next edit is its own ⌘Z event. */
function insertEmptyParagraph(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  const tr = view.state.tr.insert(pos, view.state.schema.nodes.paragraph.create())
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)))
  view.dispatch(closeHistory(view.state.tr))
}

/** A mouse click on a line: the DOM mousedown handlers run, then the caret moves there (jsdom has no layout to place it). */
function click(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  view.someProp('handleDOMEvents', (handlers) => handlers.mousedown?.(view, event))
  select(crepe, pos)
}

describe('Tab (indent)', () => {
  it('indents level 1 → 2, 2 → 3, 3 → 4 under the previous sibling', async () => {
    let { crepe } = await mount()
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Tab')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n  * L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L2 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n    * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L3 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n      * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('is a no-op on a first sibling (no literal spaces from the indent plugin)', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 a')
    expect(press(crepe, 'Tab')).toBe(true)
    expect(md(crepe)).toBe(OUTLINE)
    caretIn(crepe, 'L3 a', 1)
    press(crepe, 'Tab')
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('indents every item in a multi-item selection', async () => {
    const { crepe } = await mount()
    select(crepe, posOf(crepe, 'L1 b', 1), posOf(crepe, 'L1 c', 2))
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n  * L1 b\n  * L1 c\n')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('indents ordered and task items too', async () => {
    const { crepe } = await mount('1. one\n2. two\n\n* [ ] task a\n* [x] task b\n')
    caretIn(crepe, 'two')
    press(crepe, 'Tab')
    caretIn(crepe, 'task b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('1. one\n   1. two\n\n* [ ] task a\n  * [x] task b\n')
  })
})

describe('Shift-Tab (outdent)', () => {
  it('outdents level 4 → 3, 3 → 2, 2 → 1; following siblings nest under the lifted item', async () => {
    let { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n    * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L3 a')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n  * L3 a\n    * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L2 b')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n* L2 b\n* L1 b\n* L1 c\n')
  })

  it('turns a level-1 item into a paragraph (Obsidian); its children become a top-level list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 b')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n\nL1 b\n\n* L1 c\n')
    caretIn(crepe, 'L1 a')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('L1 a\n\n* L2 a\n  * L3 a\n    * L4 a\n  * L3 b\n* L2 b\n\nL1 b\n\n* L1 c\n')
  })

  it('GRO-1844 regression: indent 2 → 3 then outdent twice leaves markers matching depth exactly', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n    * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe(OUTLINE)
    press(crepe, 'Shift-Tab')
    const out = md(crepe)
    expect(out).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n* L2 b\n* L1 b\n* L1 c\n')
    expect(out).not.toContain('<br />')
    expect(out).not.toMatch(/^( {2})* {1}\*/m)
  })
})

describe('Enter', () => {
  it('splits mid-item into two siblings at the same depth', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b', 2)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3\n    * &#x20;b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('at the end of a childless item creates an empty sibling', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n      *\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('at the end of a parent item creates the new item as its first child', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    *\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a') - 4)
  })

  it('at the end of a FOLDED parent item creates a sibling after the hidden subtree', async () => {
    const { crepe, root } = await mount()
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[aria-label="Collapse L2 a"]`)?.click()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  *\n  * L2 b\n* L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L2 b') - 4)
  })

  it('keeps task state for new children and siblings', async () => {
    const { crepe } = await mount('* [x] done\n  * [x] child\n* [ ] todo\n')
    caretIn(crepe, 'done')
    press(crepe, 'Enter')
    caretIn(crepe, 'todo')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* [x] done\n  * [ ]\n  * [x] child\n* [ ] todo\n* [ ]\n')
  })

  it('on an empty nested item outdents it; on an empty level-1 item leaves the list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  *\n  * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n')
    caretIn(crepe, 'L1 c')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n\n<br />\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L1 c') + 8)
  })
})

describe('Backspace at the start of an item', () => {
  it('joins into the visually previous item with one space (D7) and removes the bullet', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 b', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L1 b'))
    caretIn(crepe, 'L3 b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a L3 b\n  * L2 b L1 b\n* L1 c\n')
  })

  it('joins a first child into its parent and drops the emptied nested list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('deletes an empty item and parks the caret at the end of the previous one', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    press(crepe, 'Enter')
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe(OUTLINE)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L4 a') + 4)
  })

  it('removes an empty parent; its children become the previous sibling\'s last children (D5)', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe(OUTLINE)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 b') + 4)
  })

  it('is not intercepted inside item text (native deletion) nor for a range selection', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 c', 4)
    expect(press(crepe, 'Backspace')).toBe(false)
    expect(md(crepe)).toBe(OUTLINE)
    select(crepe, posOf(crepe, 'L1 b', 0), posOf(crepe, 'L1 b', 3))
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n* b\n* L1 c\n')
  })
})

const DAY = '* 653am\n  * ok plan\n  * where\n* Eng\n'
const AKB = '* a\n  * kid\n* b\n'

describe('YAZ-3695 1- Enter keeps the fold, the zoom and the line format (D1, D2, D8)', () => {
  it('1. at the start of a folded bullet: an empty plain bullet above; the bullet keeps its fold and the caret', async () => {
    const { crepe, root } = await mount(DAY)
    fold(root, '653am')
    caretIn(crepe, '653am', 0)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('*\n* 653am\n  * ok plan\n  * where\n* Eng\n')
    expect(isFolded(root, '653am')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, '653am'))
  })

  it('2. at the start of the zoomed bullet: a new empty first child; the zoom stays on it', async () => {
    const { crepe } = await mount(AKB)
    caretIn(crepe, 'a')
    press(crepe, 'Mod-.')
    caretIn(crepe, 'a', 0)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('* a\n  *\n  * kid\n* b\n')
    expect(getZoomLabel(viewOf(crepe).state)).toBe('a')
  })

  it('3. at the start of a zoomed leaf: nothing happens, the key is taken', async () => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'a')
    press(crepe, 'Mod-.')
    caretIn(crepe, 'a', 0)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('* a\n* b\n')
  })

  it('4. in the middle of a folded parent: the tail goes after the hidden subtree; the first half keeps the fold', async () => {
    const { crepe, root } = await mount(DAY)
    fold(root, '653am')
    caretIn(crepe, '653am', 3)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('* 653\n  * ok plan\n  * where\n* am\n* Eng\n')
    expect(isFolded(root, '653')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'am'))
  })

  it('5. in the middle of an open parent: the tail becomes its first child', async () => {
    const { crepe } = await mount('* 653am\n  * kid\n')
    caretIn(crepe, '653am', 3)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* 653\n  * am\n  * kid\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'am'))
  })

  it('6. YAZ-3702: at the start of a heading bullet: a plain empty bullet above, never an empty heading', async () => {
    const { crepe } = await mount('* NEW\n* ### Missing Features\n  * For future\n')
    caretIn(crepe, 'Missing', 0)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* NEW\n*\n* ### Missing Features\n  * For future\n')
    expect(md(crepe)).not.toContain('* ###\n')
  })

  it('7. in the middle of a heading parent: the tail is an H3 first child; the parent keeps its H3 and its kid', async () => {
    const { crepe } = await mount('* ### Missing Features\n  * kid\n')
    caretIn(crepe, 'Missing Features', 8)
    press(crepe, 'Enter')
    // The space before "Features" stays on the first half.
    expect(md(crepe)).toBe('* ### Missing \n  * ### Features\n  * kid\n')
  })

  it('8. at the start of a done task: the new task above is unchecked', async () => {
    const { crepe } = await mount('* [x] done\n  * kid\n')
    caretIn(crepe, 'done', 0)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* [ ]\n* [x] done\n  * kid\n')
  })

  it('9. at the start of a folded top-level heading: an empty plain line above; the heading keeps its fold', async () => {
    const { crepe, root } = await mount('## Sec\n\nhidden one\n\n## Next\n')
    fold(root, 'Sec')
    caretIn(crepe, 'Sec', 0)
    expect(press(crepe, 'Enter')).toBe(true)
    const first = viewOf(crepe).state.doc.firstChild!
    expect([first.type.name, first.content.size]).toEqual(['paragraph', 0])
    expect(isFolded(root, 'Sec')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'Sec'))
  })

  it('10. in the middle of a folded heading: the tail is a same-level heading after the hidden section', async () => {
    const { crepe, root } = await mount('## Sec\n\nhidden one\n\nhidden two\n\n## Next\n\nafter\n')
    fold(root, 'Sec')
    caretIn(crepe, 'Sec', 1)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('## S\n\nhidden one\n\nhidden two\n\n## ec\n\n## Next\n\nafter\n')
    expect(isFolded(root, 'S')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'ec'))
  })

  it('an open heading still splits into two headings (unchanged)', async () => {
    const { crepe } = await mount('## Sec\n\nbody\n')
    caretIn(crepe, 'Sec', 1)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('## S\n\n## ec\n\nbody\n')
  })
})

describe('YAZ-3695 2- and 3- Delete (D3, D4)', () => {
  it('11. at the start of a bullet: no handler takes it (native deletes the next character); the bullet stays', async () => {
    const { crepe } = await mount('* KT\n  * 1- call\n  * xy 2- down\n')
    caretIn(crepe, 'xy', 0)
    expect(press(crepe, 'Delete')).toBe(false)
    expect(md(crepe)).toBe('* KT\n  * 1- call\n  * xy 2- down\n')
  })

  it('12. at the start of a heading: not taken; the level stays', async () => {
    const { crepe } = await mount('## Head\n\ntext\n')
    caretIn(crepe, 'Head', 0)
    expect(press(crepe, 'Delete')).toBe(false)
    expect(md(crepe)).toBe('## Head\n\ntext\n')
  })

  it('13. on an empty top line: the line goes; the list below stays as it is', async () => {
    const { crepe } = await mount(AKB)
    insertEmptyParagraph(crepe, 0)
    expect(press(crepe, 'Delete')).toBe(true)
    expect(md(crepe)).toBe(AKB)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'a'))
  })

  it('14. at the end of a bullet: the next bullet joins with one space; the caret before its text', async () => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'a')
    expect(press(crepe, 'Delete')).toBe(true)
    expect(md(crepe)).toBe('* a b\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'b'))
  })

  it('15. at the end of a parent: its first child joins', async () => {
    const { crepe } = await mount(AKB)
    caretIn(crepe, 'a')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a kid\n* b\n')
  })

  it('16. at the end of a folded parent: the next visible bullet joins; the fold stays', async () => {
    const { crepe, root } = await mount(AKB)
    fold(root, 'a')
    caretIn(crepe, 'a')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a b\n  * kid\n')
    expect(isFolded(root, 'a b')).toBe(true)
  })

  it('17. at the end of a folded parent before a parent: its children would go into the fold, so the fold opens', async () => {
    const { crepe, root } = await mount('* a\n  * kid\n* b\n  * bk\n')
    fold(root, 'a')
    caretIn(crepe, 'a')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a b\n  * kid\n  * bk\n')
    expect(isOpen(root, 'a b')).toBe(true)
  })

  it('18. at the end of a last child: the next bullet up a level joins', async () => {
    const { crepe } = await mount(AKB)
    caretIn(crepe, 'kid')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a\n  * kid b\n')
  })

  it('19. in an empty bullet: the bullet goes; the caret goes to the next line', async () => {
    const { crepe } = await mount('* a\n*\n* b\n')
    select(crepe, posOf(crepe, 'a') + 5)
    expect(press(crepe, 'Delete')).toBe(true)
    expect(md(crepe)).toBe('* a\n* b\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'b'))
  })

  it('20. in an empty parent: it goes; its children become the previous sibling\'s last children', async () => {
    const { crepe } = await mount('* a\n*\n  * k1\n* b\n')
    select(crepe, posOf(crepe, 'a') + 5)
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a\n  * k1\n* b\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'k1'))
  })

  it('21. at the end of a paragraph before a list: the first bullet joins; its children take its place', async () => {
    const { crepe } = await mount('para\n\n* a\n  * kid\n')
    caretIn(crepe, 'para')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('para a\n\n* kid\n')
  })

  it('22. at the end of a bullet before a heading: the heading text joins in the bullet\'s format', async () => {
    const { crepe } = await mount('* a\n\n## Head\n')
    caretIn(crepe, 'a')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a Head\n')
  })

  it('23. at the end of a paragraph before a heading: the heading text joins as plain text', async () => {
    const { crepe } = await mount('text\n\n## Head\n')
    caretIn(crepe, 'text')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('text Head\n')
  })

  it('24. at the end of the note: nothing happens', async () => {
    const { crepe } = await mount('* a\n')
    caretIn(crepe, 'a')
    press(crepe, 'Delete')
    expect(md(crepe)).toBe('* a\n')
  })

  it.each(['Ctrl-d', 'Alt-Delete', 'Mod-Delete', 'Ctrl-Alt-Backspace', 'Alt-d'])('25. %s at the end of a bullet joins like Delete', async (key) => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'a')
    expect(press(crepe, key)).toBe(true)
    expect(md(crepe)).toBe('* a b\n')
  })
})

describe('YAZ-3695 3- Backspace joins into the previous VISIBLE line (D5, D6, D7)', () => {
  it('26. after a folded bullet: joins its own line, never the hidden child; the fold stays', async () => {
    const { crepe, root } = await mount(AKB)
    fold(root, 'a')
    caretIn(crepe, 'b', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* a b\n  * kid\n')
    expect(isFolded(root, 'a b')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'b'))
  })

  it('27. below an empty top line: the empty line goes; the bullet and its children stay', async () => {
    const { crepe } = await mount(AKB)
    insertEmptyParagraph(crepe, 0)
    caretIn(crepe, 'a', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe(AKB)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'a'))
  })

  it('28. a lone bullet below an empty top line keeps its bullet', async () => {
    const { crepe } = await mount('* b\n')
    insertEmptyParagraph(crepe, 0)
    caretIn(crepe, 'b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* b\n')
  })

  it('29. a parent joins; its children become the previous sibling\'s last children', async () => {
    const { crepe } = await mount('* a\n* b\n  * bk\n')
    caretIn(crepe, 'b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* a b\n  * bk\n')
  })

  it('30. a parent after a folded parent: its children would go into the fold, so the fold opens', async () => {
    const { crepe, root } = await mount('* a\n  * kid\n* b\n  * bk\n')
    fold(root, 'a')
    caretIn(crepe, 'b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* a b\n  * kid\n  * bk\n')
    expect(isOpen(root, 'a b')).toBe(true)
  })

  it('31. a first child that owns children: joins its parent; its children take its place', async () => {
    const { crepe } = await mount('* p\n  * c\n    * ck\n')
    caretIn(crepe, 'c', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* p c\n  * ck\n')
  })

  it('32. the first bullet after a paragraph: joins the paragraph; its children take its place', async () => {
    // "text", not the brief's "para": `posOf('a')` would find the "a" in "para".
    const { crepe } = await mount('text\n\n* a\n  * kid\n* b\n')
    caretIn(crepe, 'a', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('text a\n\n* kid\n* b\n')
  })

  it('33. in an empty parent: it goes, its children stay in place; the caret at the end of the line above', async () => {
    const { crepe } = await mount('* a\n*\n  * k1\n* b\n')
    select(crepe, posOf(crepe, 'a') + 5)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* a\n  * k1\n* b\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'a') + 1)
  })

  it('34. the first bullet of the note lifts to plain text (unchanged)', async () => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'a', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('a\n\n* b\n')
  })

  it('35. at the top of a zoom: nothing happens', async () => {
    const { crepe } = await mount('* a\n  * k1\n  * k2\n')
    caretIn(crepe, 'a')
    press(crepe, 'Mod-.')
    caretIn(crepe, 'k1', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* a\n  * k1\n  * k2\n')
  })

  it('36. after a code block: nothing happens', async () => {
    const { crepe } = await mount('```\ncode\n```\n\n* a\n')
    caretIn(crepe, 'a', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('```\ncode\n```\n\n* a\n')
  })

  it('37. right after an Enter: the join puts no space, so the word comes back', async () => {
    const { crepe } = await mount('* downgrade\n')
    caretIn(crepe, 'downgrade', 4)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* down\n* grade\n')
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* downgrade\n')
  })

  it.each(['Shift-Backspace', 'Ctrl-h', 'Alt-Backspace', 'Mod-Backspace'])('38. %s at the start of a bullet joins like Backspace', async (key) => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'b', 0)
    expect(press(crepe, key)).toBe(true)
    expect(md(crepe)).toBe('* a b\n')
  })

  it('38b. Alt-Backspace mid-line is not taken (native)', async () => {
    const { crepe } = await mount('* a\n* bc\n')
    caretIn(crepe, 'bc', 1)
    expect(press(crepe, 'Alt-Backspace')).toBe(false)
    expect(md(crepe)).toBe('* a\n* bc\n')
  })

  it('39. a heading after a bullet joins in the bullet\'s format', async () => {
    const { crepe } = await mount('* a\n\n## Head\n')
    caretIn(crepe, 'Head', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* a Head\n')
  })

  it('40. a heading after text joins as plain text (never a bigger heading)', async () => {
    const { crepe } = await mount('text\n\n### Head\n')
    caretIn(crepe, 'Head', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('text Head\n')
  })

  it('41. a heading after a folded heading: its section would go into the fold, so the fold opens', async () => {
    const { crepe, root } = await mount('## A\n\nbody a\n\n## B\n\nbody b\n')
    fold(root, 'A')
    caretIn(crepe, 'B', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('## A B\n\nbody a\n\nbody b\n')
    expect(isOpen(root, 'A B')).toBe(true)
  })

  it('42. a folded heading that joins just goes; its body shows', async () => {
    const { crepe, root } = await mount('text\n\n## Sec\n\nbody\n')
    fold(root, 'Sec')
    caretIn(crepe, 'Sec', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('text Sec\n\nbody\n')
    expect(root.querySelector('[data-heading-folded]')).toBeNull()
  })

  it('42b. the fold of a heading that joins never passes to the heading below it', async () => {
    const { crepe, root } = await mount('text\n\n# Sec\n\n## Sub\n\nbody\n')
    fold(root, 'Sec')
    caretIn(crepe, 'Sec', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('text Sec\n\n## Sub\n\nbody\n')
    expect(isOpen(root, 'Sub')).toBe(true)
  })

  it('42c. the fold of a bullet that joins never passes to the child that takes its place', async () => {
    const { crepe, root } = await mount('* p\n  * c\n    * ck\n      * x\n')
    fold(root, 'c')
    caretIn(crepe, 'c', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* p c\n  * ck\n    * x\n')
    expect(isOpen(root, 'ck')).toBe(true)
  })

  it('43. a heading at the top of the note becomes plain text in one step', async () => {
    const { crepe } = await mount('## Head\n\nbody\n')
    caretIn(crepe, 'Head', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('Head\n\nbody\n')
  })

  it('44. a heading below an empty line: the empty line goes; the heading stays', async () => {
    const { crepe } = await mount('text\n\n## Head\n')
    insertEmptyParagraph(crepe, posOf(crepe, 'text') + 5)
    caretIn(crepe, 'Head', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('text\n\n## Head\n')
  })
})

describe('YAZ-3695 4- the caret never stays in a hidden line, and no placeholder (11, 12)', () => {
  it('45. Tab under a folded bullet: the fold opens', async () => {
    const { crepe, root } = await mount(AKB)
    fold(root, 'a')
    caretIn(crepe, 'b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* a\n  * kid\n  * b\n')
    expect(isOpen(root, 'a')).toBe(true)
  })

  it('46. Enter at the end of a folded heading: the fold opens; the caret is on the new line', async () => {
    const { crepe, root } = await mount('## Sec\n\nhidden\n\n## Next\n')
    fold(root, 'Sec')
    caretIn(crepe, 'Sec')
    press(crepe, 'Enter')
    expect(isOpen(root, 'Sec')).toBe(true)
    const { $from } = viewOf(crepe).state.selection
    expect([$from.parent.type.name, $from.parent.content.size, $from.index(0)]).toEqual(['paragraph', 0, 1])
  })

  it('47. a caret move alone into a folded bullet does not open it', async () => {
    const { crepe, root } = await mount(AKB)
    fold(root, 'a')
    caretIn(crepe, 'kid')
    expect(isFolded(root, 'a')).toBe(true)
  })

  it('48. an empty line with the caret in it shows no placeholder', async () => {
    const { crepe, root } = await mount('text\n')
    insertEmptyParagraph(crepe, 0)
    expect(root.querySelector('.crepe-placeholder')).toBeNull()
  })
})

/** One ⌘Z row: the case, the note, the label folded first (it must be folded again after ⌘Z), a setup step (its own ⌘Z event), the edit. */
type UndoRow = [string, string, string | null, ((c: Crepe) => void) | null, (c: Crepe) => unknown]
const toTop = (c: Crepe) => insertEmptyParagraph(c, 0)
const zoomInto = (c: Crepe, text: string) => (caretIn(c, text), press(c, 'Mod-.'))

const UNDO_ROWS: UndoRow[] = [
  ['1', DAY, '653am', null, (c) => (caretIn(c, '653am', 0), press(c, 'Enter'))],
  ['2', AKB, null, (c) => zoomInto(c, 'a'), (c) => (caretIn(c, 'a', 0), press(c, 'Enter'))],
  ['4', DAY, '653am', null, (c) => (caretIn(c, '653am', 3), press(c, 'Enter'))],
  ['5', '* 653am\n  * kid\n', null, null, (c) => (caretIn(c, '653am', 3), press(c, 'Enter'))],
  ['6', '* NEW\n* ### Missing Features\n  * For future\n', null, null, (c) => (caretIn(c, 'Missing', 0), press(c, 'Enter'))],
  ['7', '* ### Missing Features\n  * kid\n', null, null, (c) => (caretIn(c, 'Missing Features', 8), press(c, 'Enter'))],
  ['8', '* [x] done\n  * kid\n', null, null, (c) => (caretIn(c, 'done', 0), press(c, 'Enter'))],
  ['9', '## Sec\n\nhidden one\n\n## Next\n', 'Sec', null, (c) => (caretIn(c, 'Sec', 0), press(c, 'Enter'))],
  ['10', '## Sec\n\nhidden one\n\nhidden two\n\n## Next\n\nafter\n', 'Sec', null, (c) => (caretIn(c, 'Sec', 1), press(c, 'Enter'))],
  ['13', AKB, null, toTop, (c) => press(c, 'Delete')],
  ['14', '* a\n* b\n', null, null, (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
  ['15', AKB, null, null, (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
  ['16', AKB, 'a', null, (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
  ['17', '* a\n  * kid\n* b\n  * bk\n', 'a', null, (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
  ['18', AKB, null, null, (c) => (caretIn(c, 'kid'), press(c, 'Delete'))],
  ['19', '* a\n*\n* b\n', null, null, (c) => (select(c, posOf(c, 'a') + 5), press(c, 'Delete'))],
  ['20', '* a\n*\n  * k1\n* b\n', null, null, (c) => (select(c, posOf(c, 'a') + 5), press(c, 'Delete'))],
  ['21', 'para\n\n* a\n  * kid\n', null, null, (c) => (caretIn(c, 'para'), press(c, 'Delete'))],
  ['22', '* a\n\n## Head\n', null, null, (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
  ['23', 'text\n\n## Head\n', null, null, (c) => (caretIn(c, 'text'), press(c, 'Delete'))],
  ['26', AKB, 'a', null, (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
  ['27', AKB, null, toTop, (c) => (caretIn(c, 'a', 0), press(c, 'Backspace'))],
  ['28', '* b\n', null, toTop, (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
  ['29', '* a\n* b\n  * bk\n', null, null, (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
  ['30', '* a\n  * kid\n* b\n  * bk\n', 'a', null, (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
  ['31', '* p\n  * c\n    * ck\n', null, null, (c) => (caretIn(c, 'c', 0), press(c, 'Backspace'))],
  ['32', 'text\n\n* a\n  * kid\n* b\n', null, null, (c) => (caretIn(c, 'a', 0), press(c, 'Backspace'))],
  ['33', '* a\n*\n  * k1\n* b\n', null, null, (c) => (select(c, posOf(c, 'a') + 5), press(c, 'Backspace'))],
  ['34', '* a\n* b\n', null, null, (c) => (caretIn(c, 'a', 0), press(c, 'Backspace'))],
  ['39', '* a\n\n## Head\n', null, null, (c) => (caretIn(c, 'Head', 0), press(c, 'Backspace'))],
  ['40', 'text\n\n### Head\n', null, null, (c) => (caretIn(c, 'Head', 0), press(c, 'Backspace'))],
  ['41', '## A\n\nbody a\n\n## B\n\nbody b\n', 'A', null, (c) => (caretIn(c, 'B', 0), press(c, 'Backspace'))],
  ['42', 'text\n\n## Sec\n\nbody\n', 'Sec', null, (c) => (caretIn(c, 'Sec', 0), press(c, 'Backspace'))],
  ['42b', 'text\n\n# Sec\n\n## Sub\n\nbody\n', 'Sec', null, (c) => (caretIn(c, 'Sec', 0), press(c, 'Backspace'))],
  ['42c', '* p\n  * c\n    * ck\n      * x\n', 'c', null, (c) => (caretIn(c, 'c', 0), press(c, 'Backspace'))],
  ['42d', '* a\n  * ak\n* b\n  * c\n    * ck\n', 'b', null, (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
  ['43', '## Head\n\nbody\n', null, null, (c) => (caretIn(c, 'Head', 0), press(c, 'Backspace'))],
  ['44', 'text\n\n## Head\n', null, (c) => insertEmptyParagraph(c, posOf(c, 'text') + 5), (c) => (caretIn(c, 'Head', 0), press(c, 'Backspace'))],
  ['45', AKB, 'a', null, (c) => (caretIn(c, 'b'), press(c, 'Tab'))],
  ['46', '## Sec\n\nhidden\n\n## Next\n', 'Sec', null, (c) => (caretIn(c, 'Sec'), press(c, 'Enter'))],
  ['3A', '* a\n  * kid\n\ntext\n', 'a', null, (c) => (caretIn(c, 'text', 0), press(c, 'Backspace'))],
  ['3D', '> quote\n\n* a\n', null, null, (c) => (caretIn(c, 'a', 0), press(c, 'Backspace'))],
  ['3F Delete above a code block', 'text\n\n```\ncode\n```\n', null, (c) => insertEmptyParagraph(c, posOf(c, 'text') + 5), (c) => press(c, 'Delete')],
  ['3F Backspace below a code block', '```\ncode\n```\n\ntext\n', null, (c) => insertEmptyParagraph(c, posOf(c, 'text') - 1), (c) => press(c, 'Backspace')],
  ['3F Delete in an empty bullet above a code block', '* a\n*\n\n```\ncode\n```\n', null, null, (c) => (select(c, posOf(c, 'a') + 5), press(c, 'Delete'))],
  ['3F Delete above a rule', 'text\n\n---\n\nafter\n', null, (c) => insertEmptyParagraph(c, posOf(c, 'text') + 5), (c) => press(c, 'Delete')],
  ['3F Backspace below a rule', 'text\n\n---\n\nafter\n', null, (c) => insertEmptyParagraph(c, posOf(c, 'after') - 1), (c) => press(c, 'Backspace')],
  ['6C Backspace on an empty top line', '## Sec\n\nhidden\n\n## Next\n', 'Sec', toTop, (c) => press(c, 'Backspace')],
  ['3H Delete in a quote', '> one\n>\n> two\n', null, null, (c) => (caretIn(c, 'one'), press(c, 'Delete'))],
]

describe('YAZ-3695 49. one ⌘Z gives the text AND the fold back, one row per scenario', () => {
  it.each(UNDO_ROWS)('case %s', async (_case, markdown, folded, setup, act) => {
    const { crepe, root } = await mount(markdown)
    if (folded !== null) fold(root, folded)
    setup?.(crepe)
    const before = md(crepe)
    act(crepe)
    expect(md(crepe)).not.toBe(before)
    press(crepe, 'Mod-z')
    expect(md(crepe)).toBe(before)
    if (folded !== null) expect(isFolded(root, folded)).toBe(true)
  })
})

describe('YAZ-3695 3B. one ⌘Z gives the text AND the fold back (YAZ-3781); ⌘⇧Z opens it again', () => {
  it.each<[string, string, string, string, (c: Crepe) => void]>([
    ['17 Delete at the end of a folded parent before a parent', '* a\n  * kid\n* b\n  * bk\n', 'a', 'a b', (c) => (caretIn(c, 'a'), press(c, 'Delete'))],
    ['30 Backspace on a parent after a folded parent', '* a\n  * kid\n* b\n  * bk\n', 'a', 'a b', (c) => (caretIn(c, 'b', 0), press(c, 'Backspace'))],
    ['41 Backspace on a heading after a folded heading', '## A\n\nbody a\n\n## B\n\nbody b\n', 'A', 'A B', (c) => (caretIn(c, 'B', 0), press(c, 'Backspace'))],
    ['45 Tab under a folded bullet', '* a\n  * kid\n* b\n', 'a', 'a', (c) => (caretIn(c, 'b'), press(c, 'Tab'))],
    ['46 Enter at the end of a folded heading', '## Sec\n\nhidden\n\n## Next\n', 'Sec', 'Sec', (c) => (caretIn(c, 'Sec'), press(c, 'Enter'))],
    ['probe Delete at the end of a folded heading before a heading', '## A\n\nbody a\n\n## B\n\nbody b\n', 'A', 'A B', (c) => (caretIn(c, 'A'), press(c, 'Delete'))],
  ])('%s', async (_name, markdown, label, joinedLabel, act) => {
    const { crepe, root } = await mount(markdown)
    fold(root, label)
    act(crepe)
    const edited = md(crepe)
    expect(isOpen(root, joinedLabel)).toBe(true)
    press(crepe, 'Mod-z')
    expect(md(crepe)).toBe(markdown)
    expect(isFolded(root, label)).toBe(true)
    press(crepe, 'Mod-Shift-z')
    expect(md(crepe)).toBe(edited)
    expect(isOpen(root, joinedLabel)).toBe(true)
  })
})

describe('YAZ-3695 round 1 bugs', () => {
  describe('3A. Backspace at the start of a plain text line uses the join rule (YAZ-3780, D5, D7)', () => {
    it("after a folded bullet: joins the folded bullet's own line, never the hidden child; the fold stays", async () => {
      const { crepe, root } = await mount('* a\n  * kid\n\ntext\n')
      fold(root, 'a')
      caretIn(crepe, 'text', 0)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe('* a text\n  * kid\n')
      expect(isFolded(root, 'a text')).toBe(true)
    })

    it('after a code block: nothing happens', async () => {
      const { crepe } = await mount('```\ncode\n```\n\ntext\n')
      caretIn(crepe, 'text', 0)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe('```\ncode\n```\n\ntext\n')
    })

    it('after an empty bullet: the empty bullet goes; the text line keeps its format', async () => {
      const { crepe } = await mount('* a\n*\n\ntext\n')
      caretIn(crepe, 'text', 0)
      press(crepe, 'Backspace')
      expect(md(crepe)).toBe('* a\n\ntext\n')
    })

    it.each([
      ['text', 'one\n\ntwo\n', 'two', 'one', 'one two\n'],
      ['a heading', '## H\n\ntext\n', 'text', 'H', '## H text\n'],
      ['a bullet', '* a\n\ntext\n', 'text', 'a', '* a text\n'],
    ])('after %s: one space between the words, the mirror of Delete', async (_kind, markdown, line, above, joined) => {
      const { crepe } = await mount(markdown)
      caretIn(crepe, line, 0)
      press(crepe, 'Backspace')
      expect(md(crepe)).toBe(joined)
      const mirror = await mount(markdown)
      caretIn(mirror.crepe, above)
      press(mirror.crepe, 'Delete')
      expect(md(mirror.crepe)).toBe(joined)
    })

    it('at the top of the note: declines (native: nothing)', async () => {
      const { crepe } = await mount('text\n\n* a\n')
      caretIn(crepe, 'text', 0)
      expect(press(crepe, 'Backspace')).toBe(false)
      expect(md(crepe)).toBe('text\n\n* a\n')
    })
  })

  it('3C. an Enter, then a click to another line, then Backspace: one space (YAZ-3782, D7)', async () => {
    const { crepe } = await mount('* call bluecross\n* downgrade\n* x\n')
    caretIn(crepe, 'x')
    press(crepe, 'Enter')
    click(crepe, posOf(crepe, 'downgrade'))
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* call bluecross downgrade\n* x\n*\n')
  })

  describe('3D. a quote above joins; a table above takes nothing (YAZ-3783)', () => {
    it("Backspace at the start of a bullet below a quote: its text joins the quote's last line", async () => {
      const { crepe } = await mount('> quote\n\n* a\n')
      caretIn(crepe, 'a', 0)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe('> quote a\n')
    })

    it("Delete at the end of a quote's last line before a bullet: the mirror", async () => {
      const { crepe } = await mount('> quote\n\n* a\n')
      caretIn(crepe, 'quote')
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe('> quote a\n')
    })

    it('Backspace at the start of a bullet below a table: nothing happens', async () => {
      const table = '| a | b |\n| - | - |\n| 1 | 2 |\n\n* x\n'
      const { crepe } = await mount(table)
      const before = md(crepe)
      caretIn(crepe, 'x', 0)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe(before)
    })
  })

  describe('3E. a horizontal rule is selected, never joined (YAZ-3784)', () => {
    it('Delete at the end of a bullet before a rule selects the rule; the next Delete removes it', async () => {
      const { crepe } = await mount('* a\n\n---\n\nx\n')
      const before = md(crepe)
      caretIn(crepe, 'a')
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe(before)
      const sel = viewOf(crepe).state.selection
      expect(sel instanceof NodeSelection && sel.node.type.name).toBe('hr')
      press(crepe, 'Delete')
      expect(md(crepe)).toBe('* a\n\nx\n')
    })

    it('Backspace at the start of a line after a rule selects the rule', async () => {
      const { crepe } = await mount('* a\n\n---\n\nx\n')
      const before = md(crepe)
      caretIn(crepe, 'x', 0)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe(before)
      const sel = viewOf(crepe).state.selection
      expect(sel instanceof NodeSelection && sel.node.type.name).toBe('hr')
    })
  })

  describe('3F. an empty line next to a code block or a rule just goes (YAZ-3785, D4, the join rule)', () => {
    it('Delete on an empty line above a code block: the empty line goes', async () => {
      const { crepe } = await mount('text\n\n```\ncode\n```\n')
      insertEmptyParagraph(crepe, posOf(crepe, 'text') + 5)
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe('text\n\n```\ncode\n```\n')
    })

    it('Backspace on an empty line below a code block: the empty line goes', async () => {
      const { crepe } = await mount('```\ncode\n```\n\ntext\n')
      insertEmptyParagraph(crepe, posOf(crepe, 'text') - 1)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe('```\ncode\n```\n\ntext\n')
    })

    it('Delete on an empty bullet above a code block: the empty bullet goes', async () => {
      const { crepe } = await mount('* a\n*\n\n```\ncode\n```\n')
      select(crepe, posOf(crepe, 'a') + 5)
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe('* a\n\n```\ncode\n```\n')
    })

    it('Delete on an empty line above a rule: the empty line goes, the rule stays and is selected', async () => {
      const { crepe } = await mount('text\n\n---\n\nafter\n')
      insertEmptyParagraph(crepe, posOf(crepe, 'text') + 5)
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe('text\n\n***\n\nafter\n')
      const sel = viewOf(crepe).state.selection
      expect(sel instanceof NodeSelection && sel.node.type.name).toBe('hr')
    })

    it('Backspace on an empty line below a rule: the empty line goes, the rule stays and is selected', async () => {
      const { crepe } = await mount('text\n\n---\n\nafter\n')
      insertEmptyParagraph(crepe, posOf(crepe, 'after') - 1)
      expect(press(crepe, 'Backspace')).toBe(true)
      expect(md(crepe)).toBe('text\n\n***\n\nafter\n')
      const sel = viewOf(crepe).state.selection
      expect(sel instanceof NodeSelection && sel.node.type.name).toBe('hr')
    })

    it('Delete on an empty line above a table: the empty line goes, the table stays', async () => {
      const table = '| a | b |\n| - | - |\n| 1 | 2 |\n'
      const { crepe } = await mount(`text\n\n${table}`)
      const before = md(crepe)
      insertEmptyParagraph(crepe, posOf(crepe, 'text') + 5)
      expect(press(crepe, 'Delete')).toBe(true)
      expect(md(crepe)).toBe(before)
    })
  })

  it('3G. ⌘Z after an outside edit never folds a bullet that the user did not fold (YAZ-3786)', async () => {
    const { crepe, root } = await mount('* a\n  * kid\n* b\n  * bk\n* c\n  * ck\n')
    fold(root, 'a')
    caretIn(crepe, 'b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* a b\n  * kid\n  * bk\n* c\n  * ck\n')
    applyExternalMarkdown(crepe, '* c\n  * ck\n')
    expect(isOpen(root, 'c')).toBe(true)
    press(crepe, 'Mod-z')
    expect(isFolded(root, 'c')).toBe(false)
  })

  it('3H. inside a quote both keys join with no space, as on main (YAZ-3787)', async () => {
    const { crepe } = await mount('> one\n>\n> two\n')
    caretIn(crepe, 'two', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('> onetwo\n')
    const mirror = await mount('> one\n>\n> two\n')
    caretIn(mirror.crepe, 'one')
    press(mirror.crepe, 'Delete')
    expect(md(mirror.crepe)).toBe('> onetwo\n')
  })

  it('42d (audit 1). the fold of a bullet that joins its previous sibling never passes to its first child', async () => {
    const { crepe, root } = await mount('* a\n  * ak\n* b\n  * c\n    * ck\n')
    fold(root, 'b')
    caretIn(crepe, 'b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* a\n  * ak b\n  * c\n    * ck\n')
    expect(isOpen(root, 'c')).toBe(true)
  })
})

describe('YAZ-3695 6C. Backspace on an empty line at the top of the note removes it (YAZ-3798)', () => {
  it('a folded heading below moves up, stays folded, and gets the caret at its start', async () => {
    const { crepe, root } = await mount('## Plan for May\n\nfirst hidden line\n\n## Next Section\n')
    fold(root, 'Plan for May')
    toTop(crepe)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('## Plan for May\n\nfirst hidden line\n\n## Next Section\n')
    expect(isFolded(root, 'Plan for May')).toBe(true)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'Plan for May'))
  })

  it('an open heading below stays open', async () => {
    const { crepe, root } = await mount('## Plan for May\n\nbody\n')
    toTop(crepe)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('## Plan for May\n\nbody\n')
    expect(isOpen(root, 'Plan for May')).toBe(true)
  })

  it('a paragraph or a bullet below moves up with its format', async () => {
    const para = await mount('text below\n')
    toTop(para.crepe)
    press(para.crepe, 'Backspace')
    expect(md(para.crepe)).toBe('text below\n')
    expect(caretPos(para.crepe)).toBe(posOf(para.crepe, 'text below'))
    const bullet = await mount(AKB)
    fold(bullet.root, 'a')
    toTop(bullet.crepe)
    press(bullet.crepe, 'Backspace')
    expect(md(bullet.crepe)).toBe(AKB)
    expect(isFolded(bullet.root, 'a')).toBe(true)
  })

  it('a rule below: the empty line goes and the rule is selected', async () => {
    const { crepe } = await mount('---\n\nafter\n')
    const before = md(crepe)
    toTop(crepe)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe(before)
    expect(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection instanceof NodeSelection)).toBe(true)
  })

  it('Enter at the start of the top line, then Backspace on the new empty line: back as it was', async () => {
    const { crepe, root } = await mount('## Plan for May\n\nbody\n')
    fold(root, 'Plan for May')
    caretIn(crepe, 'Plan', 0)
    press(crepe, 'Enter')
    select(crepe, 1)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('## Plan for May\n\nbody\n')
    expect(isFolded(root, 'Plan for May')).toBe(true)
  })

  it('the only line of the note: nothing happens', async () => {
    const { crepe } = await mount('')
    select(crepe, 1)
    expect(press(crepe, 'Backspace')).toBe(false)
    expect(viewOf(crepe).state.doc.childCount).toBe(1)
  })
})

describe('YAZ-3695 the day note, one flow', () => {
  it('fold, Enter at the start, Delete on the empty top line, Delete at a start, Backspace after a fold, Backspace on a heading', async () => {
    const { crepe, root } = await mount(`${DAY}\n## Notes\n\nbody\n`)
    fold(root, '653am')
    caretIn(crepe, '653am', 0)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe(`*\n${DAY}\n## Notes\n\nbody\n`)
    select(crepe, 3)
    expect(press(crepe, 'Delete')).toBe(true)
    expect(md(crepe)).toBe(`${DAY}\n## Notes\n\nbody\n`)
    expect(caretPos(crepe)).toBe(posOf(crepe, '653am'))
    caretIn(crepe, 'Eng', 0)
    expect(press(crepe, 'Delete')).toBe(false)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* 653am Eng\n  * ok plan\n  * where\n\n## Notes\n\nbody\n')
    caretIn(crepe, 'Notes', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* 653am Eng Notes\n  * ok plan\n  * where\n\nbody\n')
    expect(isFolded(root, '653am Eng Notes')).toBe(true)
  })
})
