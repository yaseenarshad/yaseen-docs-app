/**
 * The fold plugins carry their decoration set through doc edits (YAZ-2131 5C): when an edit leaves
 * every foldable bullet and heading where the mapping puts it, with the same key, label and fold,
 * the old set is mapped instead of rebuilt. These tests pin that the carried set is exactly what a
 * from-scratch build produces, after every step of a long randomized session.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorState, TextSelection, type Plugin } from '@milkdown/kit/prose/state'
import { canSplit } from '@milkdown/kit/prose/transform'
import type { Decoration, DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import { random } from '../testRandom'
import { addHeadingFoldAllMeta, HEADING_TOGGLE_CLASS, undoLastHeadingFold } from './headingFolding'
import { foldAllOutline, OUTLINE_TOGGLE_CLASS, undoLastFold, unfoldAllOutline } from './outlineFolding'

const DOC = `# Part one

Intro paragraph.

* Parent
  * Child
    * Grandchild
  * Second child
* Leaf
* ![Shot](a.png)
* Other parent
  * Other child

## Section

Body text.

### Deep

Deep body.

## 1. Numbered

Numbered body.

> # Quoted heading
>
> quoted body

# Part two

* Tail parent
  * Tail child
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** A real editor whose fold keys are tracked, so a fresh state can be seeded with the same folds. */
async function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const keys = { outline: new Set<string>(), heading: new Set<string>() }
  const crepe = createCrepe({
    root,
    defaultValue: DOC,
    image: { root: '/v', notePath: '/v/n.md' },
    folding: { seedCollapsedKeys: () => keys.outline, onCollapsedKeysChange: (k) => (keys.outline = new Set(k)) },
    headingFolding: { seedCollapsedKeys: () => keys.heading, onCollapsedKeysChange: (k) => (keys.heading = new Set(k)) },
  })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const byKey = (name: string) => view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith(name))!
  return { crepe, root, view, outline: byKey('mdapp-outline-folding'), heading: byKey('mdapp-heading-folding') }
}

const decorationsOf = (plugin: Plugin, state: EditorState) => plugin.props.decorations!.call(plugin, state) as DecorationSet

/** Every decoration as text; a widget as the chevron it renders (label, state, key). */
function normalise(set: DecorationSet, view: EditorView): string[] {
  return set
    .find()
    .map((d) => {
      const type = (d as unknown as { type: { attrs?: unknown; toDOM?: (view: EditorView, getPos: () => number) => HTMLElement } }).type
      return type.toDOM ? `${d.from} ${type.toDOM(view, () => d.from).outerHTML}` : `${d.from}-${d.to} ${JSON.stringify(type.attrs)}`
    })
    .sort()
}

const typeOf = (d: Decoration) => (d as unknown as { type: object }).type

describe('fold decorations are carried through doc edits (YAZ-2131 5C)', () => {
  it('typing inside a bullet maps both fold sets instead of rebuilding them', async () => {
    const { root, view, outline, heading } = await mount()
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[aria-label="Collapse Parent"]`)!.click()
    root.querySelector<HTMLButtonElement>(`.${HEADING_TOGGLE_CLASS}[aria-label="Collapse Deep"]`)!.click()
    const outlineBefore = decorationsOf(outline, view.state).find()
    const headingBefore = decorationsOf(heading, view.state).find()
    let leafEnd = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Leaf') leafEnd = pos + node.nodeSize
    })
    view.dispatch(view.state.tr.insertText('!', leafEnd))
    const outlineAfter = decorationsOf(outline, view.state).find()
    const headingAfter = decorationsOf(heading, view.state).find()
    expect(outlineAfter).toHaveLength(outlineBefore.length)
    expect(headingAfter).toHaveLength(headingBefore.length)
    outlineAfter.forEach((d, i) => expect(typeOf(d)).toBe(typeOf(outlineBefore[i])))
    headingAfter.forEach((d, i) => expect(typeOf(d)).toBe(typeOf(headingBefore[i])))
  })

  it('a label change the fold key ignores (an enumeration prefix) is still rebuilt, so a re-rendered chevron reads the new label', async () => {
    const { view, outline, heading } = await mount()
    const fresh = () => EditorState.create({ doc: view.state.doc, selection: view.state.selection, plugins: [outline, heading] })
    const textStart = (text: string) => {
      let start = -1
      view.state.doc.descendants((node, pos) => {
        if (start < 0 && node.isText && node.text === text) start = pos
      })
      return start
    }
    view.dispatch(view.state.tr.insertText('1. ', textStart('Parent')))
    view.dispatch(view.state.tr.insertText('2', textStart('1. Numbered') + 1)) // `12. Numbered`: same key, new label
    expect(normalise(decorationsOf(outline, view.state), view)).toEqual(normalise(decorationsOf(outline, fresh()), view))
    expect(normalise(decorationsOf(heading, view.state), view)).toEqual(normalise(decorationsOf(heading, fresh()), view))
    expect(normalise(decorationsOf(outline, view.state), view).join()).toContain('Collapse 1. Parent')
    expect(normalise(decorationsOf(heading, view.state), view).join()).toContain('Collapse 12. Numbered')
  })

  it('a second image in a bullet (same key and label) is still rebuilt, so both images get the foldable mark', async () => {
    const { view, outline, heading } = await mount()
    let itemEnd = -1
    view.state.doc.descendants((node, pos) => {
      if (itemEnd < 0 && node.type.name === 'list_item' && node.firstChild?.firstChild?.attrs.alt === 'Shot') itemEnd = pos + node.nodeSize - 1
    })
    const { schema } = view.state
    view.dispatch(view.state.tr.insert(itemEnd, schema.nodes.paragraph.create(null, schema.nodes.image.create({ src: 'c.png', alt: 'Extra' }))))
    const fresh = EditorState.create({ doc: view.state.doc, selection: view.state.selection, plugins: [outline, heading] })
    expect(normalise(decorationsOf(outline, view.state), view)).toEqual(normalise(decorationsOf(outline, fresh), view))
  })

  it('equals a full rebuild after every one of 300 random edits, folds and caret moves', async () => {
    const { root, view, outline, heading } = await mount()
    const next = random(2131)
    const int = (n: number) => Math.floor(next() * n)
    const pick = <T,>(items: T[]): T | undefined => items[int(items.length)]
    const snippets = ['a', ' ', 'word', '1. ', 'Parent', 'x\n', '']
    for (let step = 0; step < 300; step++) {
      const { state } = view
      const size = state.doc.content.size
      const a = int(size + 1)
      const b = Math.min(size, a + int(6))
      const op = int(11)
      try {
        if (op <= 2) view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(a))).insertText(pick(snippets)!))
        else if (op === 3) view.dispatch(state.tr.delete(a, b))
        else if (op === 4) {
          if (state.doc.resolve(a).parent.isTextblock && canSplit(state.doc, a)) view.dispatch(state.tr.split(a))
        } else if (op === 5) view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(a))))
        else if (op === 6) pick([...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}, .${HEADING_TOGGLE_CLASS}`)])?.click()
        else if (op === 7) (next() < 0.5 ? foldAllOutline : unfoldAllOutline)(state, view.dispatch)
        else if (op === 8) {
          const tr = state.tr
          if (addHeadingFoldAllMeta(state, tr, next() < 0.5)) view.dispatch(tr)
        } else if (op === 9) (next() < 0.5 ? undoLastFold : undoLastHeadingFold)(state, view.dispatch)
        else {
          // A few top-level blocks replaced by their own content: same entries, but the mapping deletes them.
          const first = int(state.doc.childCount)
          let from = 0
          for (let i = 0; i < first; i++) from += state.doc.child(i).nodeSize
          let to = from
          for (let i = first; i < Math.min(state.doc.childCount, first + 1 + int(2)); i++) to += state.doc.child(i).nodeSize
          view.dispatch(state.tr.replaceWith(from, to, state.doc.slice(from, to).content))
        }
      } catch {
        continue // an edit this position cannot take: skip it
      }
      // A from-scratch state of the same doc, seeded with the live folds (the plugins' `init`).
      const fresh = EditorState.create({ doc: view.state.doc, selection: view.state.selection, plugins: [outline, heading] })
      expect(normalise(decorationsOf(outline, view.state), view), `outline, step ${step}, op ${op}`).toEqual(normalise(decorationsOf(outline, fresh), view))
      expect(normalise(decorationsOf(heading, view.state), view), `heading, step ${step}, op ${op}`).toEqual(normalise(decorationsOf(heading, fresh), view))
    }
  })
})
