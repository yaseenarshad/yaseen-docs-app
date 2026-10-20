/**
 * The heading level tag (YAZ-2700 D12), against the REAL `createCrepe()` editor: the caret moved
 * with a TextSelection, the one node decoration (`data-heading-caret`) read off the DOM, and the
 * plugin's own state read the way ProseMirror reads it.
 *
 * The contract under test:
 *  - the decoration is on the heading that holds the caret — H1 to H6, in a bullet too — and on no
 *    other; a selection across two blocks is in no ONE heading and gives none;
 *  - 🔒 the typing budget: a caret move inside the same heading, or anywhere outside headings,
 *    returns the SAME state object and the identical decoration set; typing in the heading keeps
 *    its one decoration (through Milkdown's heading-id step as well), and a change that leaves
 *    the heading the node it was moves that same decoration and builds none;
 *  - the tag is view state only: the markdown that is saved has none, and `markdownUpdated` never
 *    fires because of it;
 *  - headingLevelTag.css draws the tag from that one attribute, at once, and never while the line
 *    numbers have the heading's `::after`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { HEADING_CARET_ATTR } from './headingLevelTag'
import tagCss from './headingLevelTag.css?inline'

/** Every level, a heading that is the label of a bullet, and text that is no heading. */
const DOC = `# One

Intro paragraph.

## Two

Body of two.

### Three

#### Four

##### Five

###### Six

* ### In a bullet
  * Plain child

Closing paragraph.
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = DOC, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Absolute doc position of the first occurrence of `needle` (within one text node). */
const posOfText = (doc: ProseNode, needle: string): number => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    const i = node.isText ? (node.text ?? '').indexOf(needle) : -1
    if (i !== -1) found = pos + i
    return found === -1
  })
  if (found === -1) throw new Error(`text "${needle}" not found`)
  return found
}

/** The caret right after `text`, or a selection from there to the end of `to`. */
const select = (view: EditorView, text: string, to?: string): void => {
  const anchor = posOfText(view.state.doc, text) + text.length
  const head = to === undefined ? anchor : posOfText(view.state.doc, to) + to.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
}

/** The elements that carry the decoration, as `TAG text`. */
const tagged = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>(`[${HEADING_CARET_ATTR}]`)].map((el) => `${el.tagName} ${el.textContent}`)

/** The plugin's state and its `decorations` prop, read the way ProseMirror reads them on every view update. */
const pluginOf = (view: EditorView) => {
  const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-heading-level-tag'))!
  return {
    state: () => plugin.getState(view.state) as { pos: number | null; set: DecorationSet },
    decorations: () => plugin.props.decorations!.call(plugin, view.state) as DecorationSet,
  }
}

describe('the heading level tag (YAZ-2700 D12)', () => {
  it('is on the heading that holds the caret and on no other: H1 to H6, a heading in a bullet too, and nothing in a paragraph or a plain bullet', async () => {
    const { root, view } = await mount()
    for (const [text, element] of [
      ['One', 'H1 One'],
      ['Two', 'H2 Two'],
      ['Three', 'H3 Three'],
      ['Four', 'H4 Four'],
      ['Five', 'H5 Five'],
      ['Six', 'H6 Six'],
      ['In a bullet', 'H3 In a bullet'],
    ]) {
      select(view, text)
      expect(tagged(root)).toEqual([element])
    }
    for (const text of ['Intro paragraph.', 'Plain child', 'Closing paragraph.']) {
      select(view, text)
      expect(tagged(root)).toEqual([])
    }
    // Back in a heading from text: it comes back.
    select(view, 'Two')
    expect(tagged(root)).toEqual(['H2 Two'])
  })

  it('a selection across two blocks is in no ONE heading: none; a selection inside one heading keeps it', async () => {
    const { root, view } = await mount()
    select(view, 'Two', 'Body of two.')
    expect(tagged(root)).toEqual([])
    // Two headings in a row, selected across: neither.
    select(view, 'Three', 'Four')
    expect(tagged(root)).toEqual([])
    const start = posOfText(view.state.doc, 'Two')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 3)))
    expect(tagged(root)).toEqual(['H2 Two'])
  })

  it('🔒 a caret move inside the same heading, or anywhere outside headings, returns the SAME state object and the identical decoration set', async () => {
    const { view } = await mount()
    const plugin = pluginOf(view)
    select(view, 'Three')
    const inThree = plugin.state()
    const setInThree = plugin.decorations()
    expect(setInThree).toBe(inThree.set)
    expect(setInThree.find()).toHaveLength(1)
    // One place to the left, then the start of the heading's text: still that heading.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.head - 1)))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'Three'))))
    expect(plugin.state()).toBe(inThree)
    expect(plugin.decorations()).toBe(setInThree)

    // A different heading is a different state.
    select(view, 'Four')
    expect(plugin.state()).not.toBe(inThree)
    expect(plugin.state().pos).not.toBe(inThree.pos)

    // Outside headings: one empty state for every place, from paragraph to paragraph to bullet.
    select(view, 'Intro paragraph.')
    const outside = plugin.state()
    expect(outside.pos).toBeNull()
    expect(plugin.decorations().find()).toHaveLength(0)
    select(view, 'Closing paragraph.')
    select(view, 'Plain child')
    expect(plugin.state()).toBe(outside)
    expect(plugin.decorations()).toBe(outside.set)
  })

  it('typing in the heading keeps the ONE decoration on it, through Milkdown’s own id step too; a change above the heading moves that same decoration, and builds none', async () => {
    const { root, view } = await mount()
    const plugin = pluginOf(view)
    /** What a decoration IS, kept when a set is mapped and made anew when one is built (ProseMirror's own `type`). */
    const kind = (): unknown => (plugin.state().set.find()[0] as unknown as { type: unknown }).type
    select(view, 'Two')
    const before = plugin.state()
    // Each letter is two transactions: the text, then Milkdown's `syncHeadingIdPlugin` writing the
    // heading's new id — a step that replaces the node, which no mapped node decoration survives.
    for (const letter of ['!', '?']) view.dispatch(view.state.tr.insertText(letter))
    expect(view.state.selection.$from.parent.attrs.id).toBe('two!?')
    expect(tagged(root)).toEqual(['H2 Two!?'])
    expect(plugin.state().pos).toBe(before.pos)
    expect(plugin.state().set.find()).toHaveLength(1)
    // Backspace over one of them: the same.
    view.dispatch(view.state.tr.delete(view.state.selection.head - 1, view.state.selection.head))
    expect(tagged(root)).toEqual(['H2 Two!'])
    expect(plugin.state().set.find()).toHaveLength(1)

    // Text that goes in ABOVE the heading while the caret stays in it: the heading is the node it
    // was, one place further down, and its decoration is the SAME one, mapped.
    const made = kind()
    view.dispatch(view.state.tr.insertText('More. ', posOfText(view.state.doc, 'Intro paragraph.')))
    expect(tagged(root)).toEqual(['H2 Two!'])
    expect(plugin.state().pos).toBe(before.pos! + 'More. '.length)
    expect(plugin.state().set.find()).toHaveLength(1)
    expect(kind()).toBe(made)
  })

  it('follows what the block IS: a heading that changes level keeps it, one that becomes text loses it, and text that becomes a heading gets it', async () => {
    const { root, view } = await mount()
    const { heading, paragraph } = view.state.schema.nodes
    select(view, 'Two')
    const blockPos = (): number => view.state.selection.$from.before()
    view.dispatch(view.state.tr.setNodeMarkup(blockPos(), undefined, { ...view.state.selection.$from.parent.attrs, level: 5 }))
    expect(tagged(root)).toEqual(['H5 Two'])
    view.dispatch(view.state.tr.setNodeMarkup(blockPos(), paragraph))
    expect(tagged(root)).toEqual([])
    view.dispatch(view.state.tr.setNodeMarkup(blockPos(), heading, { level: 1 }))
    expect(tagged(root)).toEqual(['H1 Two'])
  })

  it('is view state only: the markdown that is saved has no tag, and no caret move reaches markdownUpdated', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root, view } = await mount(DOC, { onMarkdownUpdated })
    await new Promise((r) => setTimeout(r, 300)) // Crepe's mount-time normalisation, not ours
    onMarkdownUpdated.mockClear()
    const before = getMarkdownForSave(crepe)
    for (const text of ['One', 'Two', 'In a bullet', 'Intro paragraph.', 'Six']) select(view, text)
    expect(tagged(root)).toEqual(['H6 Six'])
    await new Promise((r) => setTimeout(r, 300))
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(before)
    // The source says "###### Six" and nothing says "H6": the tag is no text of the note, in the file or in the DOM.
    expect(before).toContain('###### Six')
    expect(before).not.toMatch(/H[1-6]/)
    expect(root.querySelector('.ProseMirror')?.textContent).not.toMatch(/H[1-6]/)
  })
})

describe('headingLevelTag.css: how the tag is drawn', () => {
  const rules = [...tagCss.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

  it('an `::after` that names the level for H1 to H6, never text and never selectable, and never there while the line numbers have that `::after`', () => {
    expect(rules.length).toBeGreaterThan(0)
    for (const { selector } of rules) {
      // One selector a line: a comma inside `:is(…)` is not the end of one.
      for (const one of selector.split(/,\s*\n/)) {
        expect(one.trim(), one).toMatch(/::after$/)
        expect(one, one).toContain(':not([data-line-numbers])')
      }
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(rules.find(({ selector }) => selector.endsWith(` h${level}::after`))?.body, `h${level}`).toMatch(new RegExp(`content:\\s*'H${level}';`))
    }
    const base = rules[0].body
    expect(base).toMatch(/user-select:\s*none;/)
    expect(base).toMatch(/pointer-events:\s*none;/)
    // An underlined heading's line stops at its text: no decoration reaches an inline-block.
    expect(base).toMatch(/display:\s*inline-block;/)
  })

  it('hidden until asked for; the heading of the caret and the one under the mouse show it at once, with no fade; the page switch shows every heading, a little quieter', () => {
    const opacity = (match: (selector: string) => boolean): string | undefined => rules.find(({ selector }) => match(selector))?.body.match(/opacity:\s*([\d.]+);/)?.[1]
    expect(opacity((selector) => selector === rules[0].selector)).toBe('0')
    const inHand = rules.find(({ selector }) => selector.includes(`[${HEADING_CARET_ATTR}]::after`))
    expect(inHand?.selector).toContain(':hover::after')
    expect(inHand?.body).toMatch(/opacity:\s*0\.85;/)
    expect(opacity((selector) => selector.startsWith('.editor-host[data-heading-levels]'))).toBe('0.55')
    expect(tagCss).not.toMatch(/transition|animation/)
  })
})
