/**
 * Section indent (YAZ-2709): real editor, the page's switch sent as the host sends it, the caret
 * moved with TextSelection, and the marks read from the DOM of each top-level block. The feature is
 * view-only: the markdown must never change and `markdownUpdated` must never fire because of it.
 * The drawing is CSS, which jsdom does not lay out, so the click is covered through its two pure
 * halves: which line a point is on, and what a click on that line folds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection, type Plugin } from '@milkdown/kit/prose/state'
import { DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { createFindChannel } from '../find/findChannel'
import { HEADING_FOLDED_ATTR, setHeadingFoldSet } from './headingFolding'
import sectionIndentCss from './sectionIndent.css?inline'
import { SECTION_DEPTH_ATTR, SECTION_LINE_HOVER_CLASS, SECTION_PATH_ATTR, sectionDepths, sectionLineAtOffset, sectionLineFoldTargets, showSectionIndent } from './sectionIndent'

/**
 * Seventeen top-level blocks. The note starts at H2, skips from H2 to H4, goes down to H6, and holds
 * a list and a quote that each have a heading inside (neither makes a section).
 */
const NOTE = `Intro paragraph

## Alpha

alpha text

#### Deep

deep text

##### Five

five text

###### Six

six text

* bullet
  * # Heading in a list

> # Heading in a quote
>
> quote text

### Beta

beta text

## Gamma

gamma text

# Top

top text
`
//             Intro Alpha alpha Deep deep Five five Six six list quote Beta beta Gamma gamma Top top
const DEPTHS = [0,   0,    1,    1,   2,   2,   3,   3,  4,  4,   4,    1,   2,   0,    1,    0,  1]

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = NOTE, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...opts })
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

const viewOf = (crepe: Crepe): EditorView => crepe.editor.action((ctx) => ctx.get(editorViewCtx))

/** Puts the caret at the end of the first text that holds `text`. */
function caretIn(crepe: Crepe, text: string): void {
  const view = viewOf(crepe)
  let pos = -1
  view.state.doc.descendants((node, nodePos) => {
    if (pos >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) pos = nodePos + index + text.length
    return pos < 0
  })
  if (pos < 0) throw new Error(`text not found: ${text}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** The DOM of every top-level block, in document order. */
function blocks(crepe: Crepe): HTMLElement[] {
  const view = viewOf(crepe)
  const out: HTMLElement[] = []
  view.state.doc.forEach((_block, pos) => out.push(view.nodeDOM(pos) as HTMLElement))
  return out
}

/** `data-sd` of every top-level block, 0 for a block that carries none. */
const depthsShown = (crepe: Crepe): number[] => blocks(crepe).map((el) => Number(el.getAttribute(SECTION_DEPTH_ATTR) ?? 0))
/** `data-sp` of every top-level block, 0 for a block that carries none. */
const pathShown = (crepe: Crepe): number[] => blocks(crepe).map((el) => Number(el.getAttribute(SECTION_PATH_ATTR) ?? 0))

const turnOn = (crepe: Crepe): void => showSectionIndent(crepe, true)

/** The plugin, its state and the set it hands the view: what ProseMirror itself reads. */
function plugin(crepe: Crepe) {
  const { state } = viewOf(crepe)
  const found = state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-section-indent')) as Plugin<{ set: DecorationSet }>
  return { state: found.getState(state)!, set: found.props.decorations!.call(found, state) as DecorationSet }
}

describe('section depths', () => {
  it('counts by nesting: an H2-first note starts at the edge, a skipped level is one step, H4-H6 make sections, and a heading inside a list or a quote makes none', async () => {
    const { crepe } = await mount()
    expect(Array.from(sectionDepths(viewOf(crepe).state.doc))).toEqual(DEPTHS)
    turnOn(crepe)
    expect(depthsShown(crepe)).toEqual(DEPTHS)
    // Nothing inside a block is marked: only direct children of the doc are.
    expect(viewOf(crepe).dom.querySelectorAll(`[${SECTION_DEPTH_ATTR}]`)).toHaveLength(DEPTHS.filter((depth) => depth > 0).length)
  })

  it('is off until the page turns it on, and off again hands back the empty set', async () => {
    const { crepe } = await mount()
    expect(plugin(crepe).set).toBe(DecorationSet.empty)
    expect(depthsShown(crepe)).toEqual(DEPTHS.map(() => 0))
    turnOn(crepe)
    expect(plugin(crepe).set).not.toBe(DecorationSet.empty)
    showSectionIndent(crepe, false)
    expect(plugin(crepe).set).toBe(DecorationSet.empty)
    expect(depthsShown(crepe)).toEqual(DEPTHS.map(() => 0))
  })

  it('follows an edit: a paragraph turned into a heading opens a section under it', async () => {
    const { crepe } = await mount('one\n\ntwo\n\nthree\n')
    turnOn(crepe)
    expect(depthsShown(crepe)).toEqual([0, 0, 0])
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.setNodeMarkup(0, view.state.schema.nodes.heading, { level: 2 }))
    expect(depthsShown(crepe)).toEqual([0, 1, 1])
  })

  it('never changes the markdown and never fires markdownUpdated', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe } = await mount(NOTE, { onMarkdownUpdated })
    const before = getMarkdownForSave(crepe)
    turnOn(crepe)
    caretIn(crepe, 'six text')
    // On said again, as each outside change that lands says it.
    turnOn(crepe)
    showSectionIndent(crepe, false)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(before)
  })
})

describe('the purple path', () => {
  //                Intro Alpha alpha Deep deep Five five Six six list quote Beta beta Gamma gamma Top top
  const cases: Array<[where: string, caret: string, path: number[]]> = [
    ['a paragraph', 'six text', [0, 0, 1, 1, 2, 2, 3, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['a heading', 'Five', [0, 0, 1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['a heading at the edge', 'Alpha', DEPTHS.map(() => 0)],
    ['the text before the first heading', 'Intro paragraph', DEPTHS.map(() => 0)],
  ]
  for (const [where, caret, path] of cases) {
    it(`caret in ${where}: the path ends at the caret's block, and no block after it has a purple line`, async () => {
      const { crepe } = await mount()
      caretIn(crepe, caret)
      turnOn(crepe)
      expect(pathShown(crepe)).toEqual(path)
    })
  }

  it('keeps the SAME state and set while the caret moves inside one block, and makes a new one when it moves to another', async () => {
    const { crepe } = await mount()
    turnOn(crepe)
    caretIn(crepe, 'six te')
    const before = plugin(crepe)
    caretIn(crepe, 'six text')
    const within = plugin(crepe)
    expect(within.state).toBe(before.state)
    expect(within.set).toBe(before.set)
    caretIn(crepe, 'beta text')
    const moved = plugin(crepe)
    expect(moved.state).not.toBe(before.state)
    expect(moved.set).not.toBe(before.set)
    //                             Intro Alpha alpha Deep deep Five five Six six list quote Beta beta
    expect(pathShown(crepe)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0])
  })

  it("follows CMD+F's active match after a query and a step, and a caret move gives it back (YAZ-3166)", async () => {
    const channel = createFindChannel()
    const { crepe } = await mount(NOTE, { find: channel })
    turnOn(crepe)
    caretIn(crepe, 'Intro paragraph')
    expect(pathShown(crepe)).toEqual(DEPTHS.map(() => 0))
    channel.open()
    // The first "text" at or after the caret is "alpha text", then a step goes to "deep text".
    channel.setQuery('text')
    //                             Intro Alpha alpha Deep deep Five five Six six list quote Beta beta Gamma gamma Top top
    expect(pathShown(crepe)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    channel.next()
    expect(pathShown(crepe)).toEqual([0, 0, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    caretIn(crepe, 'beta text')
    expect(pathShown(crepe)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0])
  })
})

describe('the hand-built set', () => {
  it("is what ProseMirror's own builder makes of the same decorations, with the caret on two paths and after an edit", async () => {
    const { crepe } = await mount()
    const view = viewOf(crepe)
    const pinned = () => {
      const { set } = plugin(crepe)
      expect(set.find()).toHaveLength(DEPTHS.filter((depth) => depth > 0).length)
      // `eq` is ProseMirror's own deep comparison of two sets; its types hide it as internal.
      const built = DecorationSet.create(view.state.doc, set.find())
      expect((set as unknown as { eq(other: DecorationSet): boolean }).eq(built)).toBe(true)
      // The set answers "nothing of mine is inside this block" without ProseMirror's walk: the same answer, for every block.
      view.state.doc.forEach((block, pos) => {
        expect(built.forChild(pos, block)).toBe(DecorationSet.empty)
        expect(set.forChild(pos, block)).toBe(DecorationSet.empty)
      })
    }
    caretIn(crepe, 'six text')
    turnOn(crepe)
    pinned()
    caretIn(crepe, 'beta text')
    pinned()
    view.dispatch(view.state.tr.insertText(' more'))
    pinned()
    expect(depthsShown(crepe)).toEqual(DEPTHS)
  })
})

describe('a click on a section line', () => {
  it('finds the line a point is on: a 10px band round one third of each step, and nothing between lines or past the indent', () => {
    // Two steps of 30px: line 1 is centred at 10, line 2 at 40.
    expect([5, 10, 15].map((x) => sectionLineAtOffset(x, 30, 2))).toEqual([1, 1, 1])
    expect([35, 40, 45].map((x) => sectionLineAtOffset(x, 30, 2))).toEqual([2, 2, 2])
    expect([-1, 4, 16, 29, 34, 46, 60, 70].map((x) => sectionLineAtOffset(x, 30, 2))).toEqual([null, null, null, null, null, null, null, null])
    // The narrow-note step of 18px: centred at 6 and 24.
    expect([1, 6, 11, 12, 19, 24].map((x) => sectionLineAtOffset(x, 18, 2))).toEqual([1, 1, 1, null, 2, 2])
    // A block with no measured indent (jsdom, or a page that is off) has no line.
    expect(sectionLineAtOffset(10, Number.NaN, 2)).toBeNull()
    expect(sectionLineAtOffset(10, 0, 0)).toBeNull()
  })

  const FOLDS = `# One

## A

a text

## B

### B1

b1 text

#### B2

b2 text

## C

# Two

two text
`
  //                    One A  a  B  B1 b1 B2 b2 C  Two two   (and the empty paragraph Crepe keeps at no end here)
  const positionsOf = (crepe: Crepe, labels: string[]): number[] => {
    const found: number[] = []
    viewOf(crepe).state.doc.forEach((block, pos) => {
      if (labels.includes(block.textContent)) found.push(pos)
    })
    return found
  }

  it('folds the direct child headings of the heading that owns the line: those with something under them, H1-H3 only', async () => {
    const { crepe } = await mount(FOLDS)
    const { doc } = viewOf(crepe).state
    // Line 1 of "a text" (block 2) belongs to "One": its children A and B fold; C has nothing under it.
    expect(sectionLineFoldTargets(doc, 2, 1)).toEqual(positionsOf(crepe, ['A', 'B']))
    // The same line, from any block beside it: "b2 text" (block 7) is four steps in.
    expect(sectionLineFoldTargets(doc, 7, 1)).toEqual(positionsOf(crepe, ['A', 'B']))
    // Line 2 of "b1 text" (block 5) belongs to "B": its one child B1 folds.
    expect(sectionLineFoldTargets(doc, 5, 2)).toEqual(positionsOf(crepe, ['B1']))
    // Line 3 belongs to "B1": its child B2 is an H4, and folds stay H1-H3.
    expect(sectionLineFoldTargets(doc, 7, 3)).toEqual([])
    // Line 1 of "two text" (block 10) belongs to "Two", which has no child heading.
    expect(sectionLineFoldTargets(doc, 10, 1)).toEqual([])
    // A block at the edge has no line at all.
    expect(sectionLineFoldTargets(doc, 0, 1)).toEqual([])
  })

  it('a mousedown on the line folds them all when any is open, else unfolds them all; with nothing to fold it is swallowed all the same; the caret and the markdown stay', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount(FOLDS, { onMarkdownUpdated })
    const view = viewOf(crepe)
    turnOn(crepe)
    caretIn(crepe, 'two text')
    const selection = view.state.selection
    // The handle gate listens on the document for a move and asks it for a layout jsdom has not: a move stops at the editor's root.
    root.addEventListener('mousemove', (event) => event.stopPropagation())
    // jsdom lays nothing out: each block's indent is given as its depth in steps of 30px and its
    // left edge is 0, so x = 10 is line 1 of every block and x = 25 is between two lines.
    const computed = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((el) => ({ borderLeftWidth: `${Number(el.getAttribute(SECTION_DEPTH_ATTR)) * 30}px` }) as CSSStyleDeclaration)
    const pointer = (type: 'mousedown' | 'mousemove', block: number, clientX: number): MouseEvent => {
      const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
      blocks(crepe)[block].dispatchEvent(event)
      return event
    }
    const folded = () => blocks(crepe).filter((el) => el.getAttribute(HEADING_FOLDED_ATTR) === 'true').map((el) => el.textContent)
    try {
      // Line 1 of "a text" (block 2) belongs to "One": the sections beside it are A and B.
      expect(depthsShown(crepe)[2]).toBe(2)
      expect(pointer('mousedown', 2, 10).defaultPrevented).toBe(true)
      expect(folded()).toEqual(['a text', 'B1', 'b1 text', 'B2', 'b2 text'])
      expect(pointer('mousedown', 2, 10).defaultPrevented).toBe(true)
      expect(folded()).toEqual([])
      // One of them folded by hand, the other open: the press folds them all. "A" is block 1 (the line's own block is hidden now).
      setHeadingFoldSet(positionsOf(crepe, ['A']), true)(view.state, view.dispatch)
      expect(folded()).toEqual(['a text'])
      expect(pointer('mousedown', 1, 10).defaultPrevented).toBe(true)
      expect(folded()).toEqual(['a text', 'B1', 'b1 text', 'B2', 'b2 text'])
      expect(pointer('mousedown', 1, 10).defaultPrevented).toBe(true)
      expect(folded()).toEqual([])
      // Only text beside the line of "Two" (block 10): nothing folds, and the press is still not the editor's.
      expect(pointer('mousedown', 10, 10).defaultPrevented).toBe(true)
      expect(folded()).toEqual([])
      // Between the lines the click is the editor's own.
      expect(pointer('mousedown', 2, 25).defaultPrevented).toBe(false)
      // The hand cursor: the page carries the class only while the pointer is in the band of a line.
      pointer('mousemove', 2, 10)
      expect(view.dom.classList.contains(SECTION_LINE_HOVER_CLASS)).toBe(true)
      pointer('mousemove', 2, 25)
      expect(view.dom.classList.contains(SECTION_LINE_HOVER_CLASS)).toBe(false)
    } finally {
      computed.mockRestore()
    }
    expect(view.state.selection.eq(selection)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
  })
})

describe('the empty last paragraph', () => {
  it('is what the one rule of sectionIndent.css reads to leave its grey lines out: the paragraph the editor keeps after a last list, not a last paragraph with text', async () => {
    // The selector as it ships: the rule that makes `--section-line` transparent for an only-child trailing break.
    const selector = sectionIndentCss.match(/([^{}]+:only-child\))\s*\{\s*--section-line:\s*transparent/)?.[1].trim() ?? ''
    expect(selector).toContain(`p[${SECTION_DEPTH_ATTR}]:last-child`)
    const last = async (markdown: string): Promise<Element> => {
      const { crepe, root } = await mount(markdown)
      root.classList.add('editor-instance')
      turnOn(crepe)
      return viewOf(crepe).dom.lastElementChild!
    }
    const kept = await last('# A\n\n* bullet\n')
    // It is a block of the section like any other: it keeps its depth, so its indent.
    expect([kept.tagName, kept.getAttribute(SECTION_DEPTH_ATTR), kept.textContent]).toEqual(['P', '1', ''])
    expect(kept.matches(selector)).toBe(true)
    expect((await last('# A\n\ntext\n')).matches(selector)).toBe(false)
  })
})

describe('zoom', () => {
  /** `Mod-.` zooms into the caret's bullet and `Mod-Shift-.` out, through the editor's own keymap (as zoom.test.ts presses them). */
  const press = (crepe: Crepe, out: boolean): boolean => {
    const view = viewOf(crepe)
    const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
    const event = new KeyboardEvent('keydown', { key: out ? '>' : '.', code: 'Period', keyCode: 190, shiftKey: out, ...mod, bubbles: true, cancelable: true } as KeyboardEventInit)
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  }

  it('nothing is indented while a bullet is zoomed, and the indent comes back on the way out', async () => {
    const { crepe } = await mount()
    const view = viewOf(crepe)
    turnOn(crepe)
    caretIn(crepe, 'bullet')
    expect(press(crepe, false)).toBe(true)
    expect(plugin(crepe).set).toBe(DecorationSet.empty)
    expect(view.dom.querySelector(`[${SECTION_DEPTH_ATTR}]`)).toBeNull()
    expect(press(crepe, true)).toBe(true)
    expect(depthsShown(crepe)).toEqual(DEPTHS)
  })
})
