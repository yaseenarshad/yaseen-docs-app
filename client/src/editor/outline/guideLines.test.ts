/**
 * List guide lines (GRO-2030, click semantics GRO-2107): the line is CSS-only, so these tests
 * cover the TS wiring — a mousedown whose `clientX` falls in the strip left of a nested list
 * (only reachable through the strip pseudo, whose hits target the list element) folds / unfolds
 * the parent items ALONGSIDE the line (the list's direct children that have children) via the
 * GRO-2011 plugin — never the line's owner — without moving the caret or touching the markdown.
 * jsdom rects are all zeros and `font-size` is empty, so the strip centre resolves from the 16px
 * fallback: 0 - (2.15 * 16 / 2 + 5) = -22.2.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { GUIDE_HOVER_CLASS } from './guideLines'
import { OUTLINE_FOLDED_ATTR, toggleOutlineFold, undoLastFold } from './outlineFolding'

const OUTLINE = `* Parent
  * Child A
    * Grandchild A
  * Child B
    * Grandchild B
  * Leaf child
* Leaf
`

/** Strip centre for a rect at left 0 with the 16px fallback font (see header comment). */
const STRIP_X = -(2.15 * 16) / 2 - 5

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: OUTLINE, ...opts })
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

/** The nested list under the item whose first paragraph is `parentText`. */
const nestedListOf = (root: HTMLElement, parentText: string): HTMLElement => {
  const li = [...root.querySelectorAll<HTMLElement>('li.list-item')].find(
    (el) => el.querySelector(':scope > .children > .content-dom > p')?.textContent === parentText,
  )
  const list = li?.querySelector<HTMLElement>(':scope > .children > .content-dom > ul, :scope > .children > .content-dom > ol')
  if (!list) throw new Error(`no nested list under "${parentText}"`)
  return list
}

const mouse = (el: HTMLElement, type: string, clientX: number) =>
  el.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }))

const folded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)
/** Labels of the items whose nested list is folded, in document order. */
const foldedLabels = (root: HTMLElement): string[] =>
  [...folded(root)].map((ul) => ul.closest('li.list-item')?.querySelector(':scope > .children > .content-dom > p')?.textContent ?? '?')
const pressUndo = (crepe: Crepe): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return undoLastFold(view.state, view.dispatch)
  })
const foldItemOf = (crepe: Crepe, root: HTMLElement, label: string) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const li = nestedListOf(root, label).closest('li.list-item') as HTMLElement
    const $pos = view.state.doc.resolve(view.posAtDOM(li, 0))
    toggleOutlineFold($pos.before($pos.depth))(view.state, view.dispatch)
  })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('guide lines: click → fold', () => {
  it('mousedown in the strip folds the parent items alongside the line (not its owner); again unfolds them', async () => {
    const { root } = await mount()
    const list = nestedListOf(root, 'Parent')
    expect(mouse(list, 'mousedown', STRIP_X)).toBe(false) // preventDefault called → caret untouched
    expect(foldedLabels(root)).toEqual(['Child A', 'Child B']) // Parent and Leaf child untouched
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    expect(folded(root)).toHaveLength(0)
  })

  it('any alongside item expanded → collapse all of them', async () => {
    const { crepe, root } = await mount()
    foldItemOf(crepe, root, 'Child A')
    expect(foldedLabels(root)).toEqual(['Child A'])
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    expect(foldedLabels(root)).toEqual(['Child A', 'Child B'])
  })

  it('a line whose bullets are all leaves does nothing but still swallows the click', async () => {
    const { root } = await mount()
    expect(mouse(nestedListOf(root, 'Child A'), 'mousedown', STRIP_X)).toBe(false)
    expect(folded(root)).toHaveLength(0)
  })

  it('undoLastFold right after the click reverts the whole click as one step (Mod-z binding: hotkeys.test.ts)', async () => {
    const { crepe, root } = await mount()
    foldItemOf(crepe, root, 'Child A')
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    expect(foldedLabels(root)).toEqual(['Child A', 'Child B'])
    expect(pressUndo(crepe)).toBe(true)
    expect(foldedLabels(root)).toEqual(['Child A'])
  })

  it('a plugin-appended doc change (Crepe trailing paragraph) keeps the click revertible, positions mapped', async () => {
    const { crepe, root } = await mount()
    foldItemOf(crepe, root, 'Child A')
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      // Insert inside Parent's text so every remembered child position shifts; flagged like a
      // plugin-appended transaction (prosemirror-history expects the meta to be a Transaction).
      view.dispatch(view.state.tr.insertText('zz', 3).setMeta('appendedTransaction', view.state.tr))
    })
    expect(foldedLabels(root)).toEqual(['Child A', 'Child B'])
    expect(pressUndo(crepe)).toBe(true)
    expect(foldedLabels(root)).toEqual(['Child A'])
  })

  it('mousedown on the list but outside the strip falls through', async () => {
    const { root } = await mount()
    const list = nestedListOf(root, 'Parent')
    expect(mouse(list, 'mousedown', 10)).toBe(true) // not prevented
    expect(mouse(list, 'mousedown', -50)).toBe(true)
    expect(folded(root)).toHaveLength(0)
  })

  it('does not move the caret', async () => {
    const { crepe, root } = await mount()
    const before = crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
      return view.state.selection.from
    })
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    const after = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
    expect(after).toBe(before)
  })

  it('strip hover toggles the highlight class; leaving clears it', async () => {
    const { root } = await mount()
    const list = nestedListOf(root, 'Parent')
    mouse(list, 'mousemove', STRIP_X)
    expect(list.classList.contains(GUIDE_HOVER_CLASS)).toBe(true)
    mouse(list, 'mousemove', 10)
    expect(list.classList.contains(GUIDE_HOVER_CLASS)).toBe(false)
  })

  it('never reaches markdownUpdated and leaves the markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount({ onMarkdownUpdated })
    await sleep(400) // let Crepe's start-up markdownUpdated pass
    onMarkdownUpdated.mockClear()
    const md = getMarkdownForSave(crepe)
    mouse(nestedListOf(root, 'Parent'), 'mousedown', STRIP_X)
    mouse(nestedListOf(root, 'Child A'), 'mousedown', STRIP_X)
    await sleep(400)
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(md)
  })
})
