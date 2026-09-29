/**
 * Incremental bullet fold-entry scan (YAZ-2236, 5C1): a keystroke re-scans only the top-level block
 * it changed; every other block's foldable items come from a cache keyed on that (immutable) block.
 * The entries must equal a plain full scan after every step of a long randomized session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { Node as ProseNode } from '@milkdown/kit/prose/model'
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { TextSelection } from '@milkdown/kit/prose/state'
import { canJoin, canSplit } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import { findNestedLists, findOwnImages, itemLabelText } from './listNodes'
import { getOutlineFoldKey, outlineFoldLabel } from './outlineFoldKeys'
import { HEADING_TOGGLE_CLASS } from './headingFolding'
import { OUTLINE_TOGGLE_CLASS } from './outlineFolding'

const DOC = `# Part one

* Parent
  * Child
    * Grandchild
  * Second child
* Leaf
* ![Shot](a.png)
* Parent
  * Duplicate label child

Between lists.

* 1. Numbered parent
  * Numbered child
* 2. Numbered parent
  * Numbered child

> * Quoted parent
>   * Quoted child

## Section

* Tail parent
  * Tail child
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

async function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: DOC, image: { root: '/v', notePath: '/v/n.md' } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-outline-folding'))!
  const liveEntries = () => (plugin.getState(view.state) as { entries: unknown[] }).entries
  return { root, view, liveEntries }
}

/** The pre-5C1 whole-document scan, kept here as the oracle. */
function fullScan(doc: ProseNode) {
  const entries: unknown[] = []
  const labelOccurrences = new Map<string, number>()
  doc.descendants((node, itemPos) => {
    if (node.type.name !== 'list_item') return true
    const nestedLists = findNestedLists(node)
    const images = findOwnImages(node)
    if (nestedLists.length === 0 && images.length === 0) return true
    const label = itemLabelText(node)
    const keyLabel = outlineFoldLabel(label)
    const occurrence = labelOccurrences.get(keyLabel) ?? 0
    labelOccurrences.set(keyLabel, occurrence + 1)
    entries.push({
      foldKey: getOutlineFoldKey(label, occurrence),
      itemPos,
      label,
      nestedListRanges: nestedLists.map(({ list, offset }) => ({ from: itemPos + 1 + offset, to: itemPos + 1 + offset + list.nodeSize })),
      imageRanges: images.map(({ node: image, offset }) => ({ from: itemPos + 1 + offset, to: itemPos + 1 + offset + image.nodeSize })),
    })
    return true
  })
  return entries
}

/** Small deterministic PRNG (mulberry32), so a failure replays. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const textStart = (view: EditorView, text: string): number => {
  let start = -1
  view.state.doc.descendants((node, pos) => {
    if (start < 0 && node.isText && node.text === text) start = pos
  })
  return start
}

describe('incremental bullet fold entries (YAZ-2236)', () => {
  it('a keystroke re-scans only the top-level block it changed', async () => {
    const { view, liveEntries } = await mount()
    const descendants = vi.spyOn(ProseNode.prototype, 'descendants')
    const at = textStart(view, 'Tail child') + 4
    view.dispatch(view.state.tr.insertText('!', at))
    const topLevel = new Set<ProseNode>()
    view.state.doc.forEach((block) => topLevel.add(block))
    const scanned = descendants.mock.contexts.filter((node) => topLevel.has(node as ProseNode))
    expect(scanned).toHaveLength(1)
    expect(scanned[0]).toBe(view.state.doc.child(view.state.doc.resolve(at).index(0)))
    expect(liveEntries()).toEqual(fullScan(view.state.doc))
  })

  it.each([2236, 7919, 104729])('equals a full scan after every one of 300 random steps (seed %i)', async (seed) => {
    const { root, view, liveEntries } = await mount()
    const next = random(seed)
    const int = (n: number) => Math.floor(next() * n)
    const snippets = ['a', ' ', 'Parent', '1. ', 'Child', '']
    const { schema } = view.state
    for (let step = 0; step < 300; step++) {
      const { state } = view
      const size = state.doc.content.size
      const a = int(size + 1)
      const b = Math.min(size, a + int(8))
      const at = TextSelection.near(state.doc.resolve(a))
      const op = int(12)
      try {
        if (op <= 2) view.dispatch(state.tr.setSelection(at).insertText(snippets[int(snippets.length)]))
        else if (op === 3) view.dispatch(state.tr.delete(a, b))
        else if (op === 4) {
          if (state.doc.resolve(a).parent.isTextblock && canSplit(state.doc, a)) view.dispatch(state.tr.split(a, 1 + int(3)))
        } else if (op === 5) {
          if (canJoin(state.doc, a)) view.dispatch(state.tr.join(a))
        } else if (op === 6) {
          // A heading-level change, or a block turned into / out of a heading.
          const $a = state.doc.resolve(a)
          if ($a.parent.isTextblock) {
            const heading = $a.parent.type === schema.nodes.heading
            const type = heading && next() < 0.5 ? schema.nodes.paragraph : schema.nodes.heading
            view.dispatch(state.tr.setBlockType($a.before(), $a.after(), type, type === schema.nodes.heading ? { level: 1 + int(3) } : null))
          }
        } else if (op === 7) {
          view.dispatch(state.tr.setSelection(at))
          ;(next() < 0.5 ? sinkListItem : liftListItem)(schema.nodes.list_item)(view.state, view.dispatch)
        }
        else if (op === 8) [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}, .${HEADING_TOGGLE_CLASS}`)][int(20)]?.click()
        else if (op === 9) undo(state, view.dispatch)
        else if (op === 10) {
          // A copy of a random slice pasted elsewhere: duplicate labels shift every later occurrence.
          const from = int(size + 1)
          view.dispatch(state.tr.replace(a, a, state.doc.slice(from, Math.min(size, from + int(60)))))
        } else view.dispatch(state.tr.setSelection(at))
      } catch {
        continue // an edit this position cannot take: skip it
      }
      expect(liveEntries(), `seed ${seed}, step ${step}, op ${op}`).toEqual(fullScan(view.state.doc))
    }
  })
})
