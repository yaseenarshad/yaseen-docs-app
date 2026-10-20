/**
 * The heading text (YAZ-3049), against the REAL `createCrepe()` editor: the `.heading-text` spans
 * read off the DOM, and the plugin's set read the way ProseMirror reads it.
 *
 * The contract under test:
 *  - each text node of a non-empty heading wears ONE `.heading-text` span, H1 to H6, in a bullet
 *    and in a quote too; the heading's first text node adds `--first`, its last adds `--last`;
 *    a paragraph and an empty heading have none;
 *  - typing in a heading keeps one span over the whole text (through Milkdown's id step too);
 *    a paragraph that becomes a heading gets one, a heading that becomes a paragraph loses it;
 *  - 🔒 the typing budget: a change rebuilds only the textblocks it touched. Every other heading
 *    keeps its decoration, mapped (ProseMirror's own `type` object stays), and after any edit the
 *    set is the set a full build gives;
 *  - the spans are view state only: the markdown that is saved has none.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Decoration, DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { HEADING_TEXT_CLASS, HEADING_TEXT_FIRST_CLASS, HEADING_TEXT_LAST_CLASS } from './headingText'

/** Every level, a heading that is the label of a bullet, one in a quote, and text that is no heading. */
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

> ## In a quote

Closing paragraph.
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = DOC) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
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

/** The caret right after `text`. */
const caretAfter = (view: EditorView, text: string): void => {
  const pos = posOfText(view.state.doc, text) + text.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** Each block that holds `.heading-text` spans, as `TAG span|span` (the text of each span). */
const wrapped = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.ProseMirror :is(h1, h2, h3, h4, h5, h6, p)')]
    .filter((block) => block.querySelector(`.${HEADING_TEXT_CLASS}`) !== null)
    .map((block) => `${block.tagName} ${[...block.querySelectorAll(`.${HEADING_TEXT_CLASS}`)].map((span) => span.textContent).join('|')}`)

/** The heading whose text is `text`, and its spans. */
const spansOf = (root: HTMLElement, text: string): HTMLElement[] => {
  const heading = [...root.querySelectorAll<HTMLElement>('.ProseMirror :is(h1, h2, h3, h4, h5, h6)')].find((el) => el.textContent === text)
  if (heading === undefined) throw new Error(`heading "${text}" not found`)
  return [...heading.querySelectorAll<HTMLElement>(`.${HEADING_TEXT_CLASS}`)]
}

const pluginOf = (view: EditorView) => {
  const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-heading-text'))!
  return {
    set: () => plugin.getState(view.state) as DecorationSet,
    decorations: () => plugin.props.decorations!.call(plugin, view.state) as DecorationSet,
  }
}

/** A set as comparable rows: `from-to class`, in document order. */
const rows = (decorations: readonly Decoration[]): string[] =>
  decorations
    .map((d) => `${d.from}-${d.to} ${(d as unknown as { type: { attrs: { class: string } } }).type.attrs.class}`)
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))

/** What a full build gives for the current doc: each heading's text nodes, with their classes. */
const expectedRows = (doc: ProseNode): string[] => {
  const out: string[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name !== 'heading') return false
    const texts: Array<{ from: number; to: number }> = []
    node.forEach((child, offset) => {
      if (child.isText) texts.push({ from: pos + 1 + offset, to: pos + 1 + offset + child.nodeSize })
    })
    texts.forEach(({ from, to }, i) => {
      let cls = HEADING_TEXT_CLASS
      if (i === 0) cls += ` ${HEADING_TEXT_FIRST_CLASS}`
      if (i === texts.length - 1) cls += ` ${HEADING_TEXT_LAST_CLASS}`
      out.push(`${from}-${to} ${cls}`)
    })
    return false
  })
  return out
}

describe('the heading text (YAZ-3049)', () => {
  it('wraps the text of each non-empty heading in ONE span, H1 to H6, in a bullet and a quote too; a paragraph gets none', async () => {
    const { root } = await mount()
    expect(wrapped(root)).toEqual(['H1 One', 'H2 Two', 'H3 Three', 'H4 Four', 'H5 Five', 'H6 Six', 'H3 In a bullet', 'H2 In a quote'])
    // One text node: the one span is both the first and the last.
    for (const span of spansOf(root, 'Two')) {
      expect([...span.classList]).toEqual([HEADING_TEXT_CLASS, HEADING_TEXT_FIRST_CLASS, HEADING_TEXT_LAST_CLASS])
    }
  })

  it('a heading with a bold word has a span for each text node: only the first one is `--first`, only the last one is `--last`', async () => {
    const { root } = await mount('## The **real** plan\n\nText.\n')
    const spans = spansOf(root, 'The real plan')
    expect(spans.map((span) => span.textContent)).toEqual(['The ', 'real', ' plan'])
    expect(spans.map((span) => span.classList.contains(HEADING_TEXT_FIRST_CLASS))).toEqual([true, false, false])
    expect(spans.map((span) => span.classList.contains(HEADING_TEXT_LAST_CLASS))).toEqual([false, false, true])
    // The bold word's span is inside its <strong>: the mark wraps the decoration.
    expect(spans[1].parentElement?.tagName).toBe('STRONG')
  })

  it('typing in a heading keeps ONE span over the whole text, at its end, start and middle, through Milkdown’s id step too', async () => {
    const { root, view } = await mount()
    caretAfter(view, 'Two')
    for (const letter of ['!', '?']) view.dispatch(view.state.tr.insertText(letter))
    expect(view.state.selection.$from.parent.attrs.id).toBe('two!?')
    expect(spansOf(root, 'Two!?').map((span) => span.textContent)).toEqual(['Two!?'])
    view.dispatch(view.state.tr.insertText('A ', posOfText(view.state.doc, 'Two!?')))
    view.dispatch(view.state.tr.insertText('-', posOfText(view.state.doc, 'Two!?') + 2))
    expect(spansOf(root, 'A Tw-o!?').map((span) => span.textContent)).toEqual(['A Tw-o!?'])
    // Backspace: the same.
    caretAfter(view, 'A Tw-o!?')
    view.dispatch(view.state.tr.delete(view.state.selection.head - 1, view.state.selection.head))
    expect(spansOf(root, 'A Tw-o!').map((span) => span.textContent)).toEqual(['A Tw-o!'])
    expect(rows(pluginOf(view).decorations().find())).toEqual(expectedRows(view.state.doc))
  })

  it('follows what the block IS: a paragraph that becomes a heading gets one span, a heading that becomes a paragraph loses it', async () => {
    const { root, view } = await mount()
    const { heading, paragraph } = view.state.schema.nodes
    const blockOf = (text: string): number => view.state.doc.resolve(posOfText(view.state.doc, text)).before()
    view.dispatch(view.state.tr.setNodeMarkup(blockOf('Body of two.'), heading, { level: 3 }))
    expect(spansOf(root, 'Body of two.').map((span) => span.textContent)).toEqual(['Body of two.'])
    view.dispatch(view.state.tr.setNodeMarkup(blockOf('Three'), paragraph))
    expect(wrapped(root)).not.toContain('P Three')
    expect(wrapped(root).some((row) => row.endsWith(' Three'))).toBe(false)
    // A heading that changes level keeps its span.
    view.dispatch(view.state.tr.setNodeMarkup(blockOf('Four'), heading, { level: 2 }))
    expect(spansOf(root, 'Four').map((span) => span.textContent)).toEqual(['Four'])
    expect(rows(pluginOf(view).decorations().find())).toEqual(expectedRows(view.state.doc))
  })

  it('an empty heading gets none: one that loses all its text, and a new empty one', async () => {
    const { root, view } = await mount()
    const start = posOfText(view.state.doc, 'Five')
    view.dispatch(view.state.tr.delete(start, start + 'Five'.length))
    const h5 = root.querySelector<HTMLElement>('.ProseMirror h5')!
    expect(h5.textContent).toBe('')
    expect(h5.querySelector(`.${HEADING_TEXT_CLASS}`)).toBeNull()
    // Text typed into it again: one span.
    view.dispatch(view.state.tr.insertText('Back', start))
    expect(spansOf(root, 'Back').map((span) => span.textContent)).toEqual(['Back'])
    // A new empty H4 after the closing paragraph.
    const end = view.state.doc.content.size
    view.dispatch(view.state.tr.insert(end, view.state.schema.nodes.heading.create({ level: 4 })))
    const h4s = [...root.querySelectorAll<HTMLElement>('.ProseMirror h4')]
    expect(h4s.at(-1)!.textContent).toBe('')
    expect(h4s.at(-1)!.querySelector(`.${HEADING_TEXT_CLASS}`)).toBeNull()
    expect(rows(pluginOf(view).decorations().find())).toEqual(expectedRows(view.state.doc))
  })

  it('🔒 a change rebuilds only what it touched: the other headings keep their decoration, mapped; a caret move keeps the identical set', async () => {
    const { view } = await mount()
    const plugin = pluginOf(view)
    const typeAt = (text: string): unknown => (plugin.set().find(posOfText(view.state.doc, text), posOfText(view.state.doc, text) + 1)[0] as unknown as { type: unknown }).type
    const before = { one: typeAt('One'), six: typeAt('Six'), bullet: typeAt('In a bullet'), quote: typeAt('In a quote'), two: typeAt('Two') }

    // A caret move: the same set object.
    const set = plugin.set()
    caretAfter(view, 'Closing paragraph.')
    caretAfter(view, 'Three')
    expect(plugin.set()).toBe(set)
    expect(plugin.decorations()).toBe(set)

    // Typing in a paragraph, then in a heading: every other heading keeps its decoration.
    view.dispatch(view.state.tr.insertText('More. ', posOfText(view.state.doc, 'Intro paragraph.')))
    caretAfter(view, 'Two')
    view.dispatch(view.state.tr.insertText('!'))
    expect(typeAt('One')).toBe(before.one)
    expect(typeAt('Six')).toBe(before.six)
    expect(typeAt('In a bullet')).toBe(before.bullet)
    expect(typeAt('In a quote')).toBe(before.quote)
    expect(rows(plugin.decorations().find())).toEqual(expectedRows(view.state.doc))
  })

  it('after a run of edits (a bold word added and removed, a block split, two blocks joined, a select-all delete) the set is the set a full build gives', async () => {
    const { view } = await mount()
    const plugin = pluginOf(view)
    const check = () => expect(rows(plugin.decorations().find())).toEqual(expectedRows(view.state.doc))
    const { strong } = view.state.schema.marks
    const three = posOfText(view.state.doc, 'Three')
    view.dispatch(view.state.tr.addMark(three + 1, three + 3, strong.create()))
    check()
    view.dispatch(view.state.tr.removeMark(three, three + 5, strong))
    check()
    view.dispatch(view.state.tr.split(posOfText(view.state.doc, 'Four') + 2))
    check()
    const fiveStart = view.state.doc.resolve(posOfText(view.state.doc, 'Five')).before()
    view.dispatch(view.state.tr.join(fiveStart))
    check()
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1))
    check()
  })

  it('is view state only: the markdown that is saved has no trace of it', async () => {
    const { crepe } = await mount('## The **real** plan\n\nText.\n')
    expect(getMarkdownForSave(crepe)).toBe('## The **real** plan\n\nText.\n')
  })
})
