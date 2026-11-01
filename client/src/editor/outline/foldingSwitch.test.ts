import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import type { HandleTarget } from '../blockHandleTarget'
import { foldAllRows } from './foldAllRows'
import { setAllDocumentFolds } from './foldAllHotkeys'
import { isFoldingOn, setFoldingOn } from './foldingSwitch'
import { collapsedHeadingsHiding, collapsedSectionAround, collapsedSectionBlocks, HEADING_FOLDED_ATTR, HEADING_TOGGLE_CLASS, isHeadingCollapsed, setHeadingFoldAtSelection, undoLastHeadingFold } from './headingFolding'
import { collapsedItemsHiding, isOutlineItemCollapsed, OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS, setOutlineFoldAtSelection, setOutlineFoldSet, toggleOutlineFold, undoLastFold } from './outlineFolding'

/**
 * The page's "Folding" switch (YAZ-4094 F1–F3, fixes 1–3): off, no fold path folds and every query sees an
 * open page; the saved folds stay and come back when it is on again.
 */

const DOC = `# Plan

text under the plan

# List

* Parent
  * Child
* Leaf

# End
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(onBlocked = vi.fn()) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const keys: string[][] = []
  const crepe = createCrepe({ root, defaultValue: DOC, onFoldingBlocked: onBlocked, folding: { onCollapsedKeysChange: (k) => keys.push([...k]) } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view, keys, onBlocked }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The position of the first block whose text is `text` (a paragraph, a heading or a list item's paragraph). */
const posOf = (view: EditorView, text: string, type?: string): number => {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && (type === undefined ? node.isTextblock : node.type.name === type) && node.textContent === text) found = pos
    return found < 0
  })
  if (found < 0) throw new Error(`no "${text}"`)
  return found
}
const itemPos = (view: EditorView, text: string): number => view.state.doc.resolve(posOf(view, text) + 1).before(-1)
const caretAt = (view: EditorView, pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
const turn = (view: EditorView, on: boolean) => view.dispatch(setFoldingOn(view.state.tr, on))
const run = (view: EditorView, command: (state: EditorView['state'], dispatch: EditorView['dispatch']) => boolean) => command(view.state, view.dispatch)

/** Fold "Parent" and the "Plan" section with folding on: the page's saved folds. The caret then rests on "End", outside both. */
function foldBoth(view: EditorView) {
  run(view, toggleOutlineFold(itemPos(view, 'Parent')))
  caretAt(view, posOf(view, 'text under the plan') + 1)
  run(view, setHeadingFoldAtSelection(true))
  caretAt(view, posOf(view, 'End', 'heading') + 1)
}

describe('the Folding switch', () => {
  it('off: no chevron and nothing hidden; every query sees an open page; the saved folds are kept and not reported; on again brings them back', async () => {
    const { root, view, keys } = await mount()
    foldBoth(view)
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"], [${HEADING_FOLDED_ATTR}="true"]`).length).toBeGreaterThan(0)
    const reported = keys.length
    turn(view, false)
    expect(isFoldingOn(view.state)).toBe(false)
    expect(root.querySelectorAll(`.${OUTLINE_TOGGLE_CLASS}, .${HEADING_TOGGLE_CLASS}`)).toHaveLength(0)
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"], [${HEADING_FOLDED_ATTR}="true"]`)).toHaveLength(0)
    const child = posOf(view, 'Child') + 1
    const under = posOf(view, 'text under the plan') + 1
    expect(isOutlineItemCollapsed(view.state, itemPos(view, 'Parent'))).toBe(false)
    expect(collapsedItemsHiding(view.state, child)).toEqual([])
    expect(isHeadingCollapsed(view.state, posOf(view, 'Plan', 'heading'))).toBe(false)
    expect(collapsedHeadingsHiding(view.state, under)).toEqual([])
    expect(collapsedSectionAround(view.state, under)).toBeNull()
    expect(collapsedSectionBlocks(view.state).size).toBe(0)
    // An edit while off maps the kept folds and reports nothing new.
    view.dispatch(view.state.tr.insertText('!', posOf(view, 'End', 'heading') + 4))
    expect(keys).toHaveLength(reported)
    turn(view, true)
    expect(isOutlineItemCollapsed(view.state, itemPos(view, 'Parent'))).toBe(true)
    expect(isHeadingCollapsed(view.state, posOf(view, 'Plan', 'heading'))).toBe(true)
    expect(root.querySelectorAll(`.${OUTLINE_TOGGLE_CLASS}`).length).toBeGreaterThan(0)
  })

  it('off: each fold path folds nothing — the fold keys are consumed with the host’s message where they act; fold-undo and a silent reveal decline; the block menu has no fold rows', async () => {
    const { view, onBlocked } = await mount()
    turn(view, false)
    const parent = itemPos(view, 'Parent')
    expect(run(view, toggleOutlineFold(parent))).toBe(true)
    expect(isOutlineItemCollapsed(view.state, parent)).toBe(false)
    // ⌘↑ in a list and on a heading: consumed (GRO-2092), with the message; outside both it declines.
    caretAt(view, posOf(view, 'Parent') + 1)
    expect(run(view, setOutlineFoldAtSelection(true))).toBe(true)
    caretAt(view, posOf(view, 'Plan', 'heading') + 1)
    expect(run(view, setHeadingFoldAtSelection(true))).toBe(true)
    // ⌘⇧U / ⌘⇧I.
    expect(run(view, setAllDocumentFolds(true))).toBe(true)
    expect(onBlocked).toHaveBeenCalledTimes(3)
    // CMD+F's silent reveal and fold-undo.
    run(view, setOutlineFoldSet([parent], true, { silent: true }))
    expect(isOutlineItemCollapsed(view.state, parent)).toBe(false)
    expect(run(view, undoLastFold)).toBe(false)
    expect(run(view, undoLastHeadingFold)).toBe(false)
    const target = { inside: parent } as HandleTarget
    expect(foldAllRows(view, target, {} as Ctx)).toEqual([])
    turn(view, true)
    expect(foldAllRows(view, target, {} as Ctx).map((row) => row.label)).toEqual(['Collapse all', 'Expand all'])
  })

  it('on again with the caret inside a saved fold: only the folds that hide the caret open; the others come back folded', async () => {
    const { view } = await mount()
    foldBoth(view)
    turn(view, false)
    caretAt(view, posOf(view, 'Child') + 1)
    turn(view, true)
    expect(isOutlineItemCollapsed(view.state, itemPos(view, 'Parent'))).toBe(false)
    expect(isHeadingCollapsed(view.state, posOf(view, 'Plan', 'heading'))).toBe(true)
  })
})
