/**
 * Crepe's list-item node view restores the caret one frame after it mounts (the pinned
 * `@milkdown/components` build, `client/vendor/milkdown-components-7.22.1-yaz1410.*`). YAZ-2131 4B:
 * that restore runs once per editor view per frame, not once per list item — opening a note with N
 * bullets used to run N whole-plugin passes in one frame (22.6 s at 5k lines) — and the caret
 * still lands where the last of those N dispatches put it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'

/** A manual frame clock: callbacks queued now run on the next `runFrame()`, cancels are honoured. */
const frames = new Map<number, FrameRequestCallback>()
let nextFrameId = 0
function runFrame() {
  for (const id of [...frames.keys()]) {
    const callback = frames.get(id)
    frames.delete(id)
    callback?.(performance.now())
  }
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
  frames.clear()
  vi.unstubAllGlobals()
})

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const selectionOnly: Transaction[] = []
  const dispatch = view.dispatch
  view.dispatch = (tr: Transaction) => {
    if (tr.selectionSet && !tr.docChanged) selectionOnly.push(tr)
    dispatch(tr)
  }
  return { view, selectionOnly }
}

const bullets = (n: number) => Array.from({ length: n }, (_, i) => `* item ${i + 1}`).join('\n')

/** Position just after the text `needle` in the doc. */
function after(view: EditorView, needle: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle)) found = pos + node.text.indexOf(needle) + needle.length
  })
  expect(found).toBeGreaterThan(0)
  return found
}

describe('list-item caret restore (YAZ-2131 4B)', () => {
  it('N list items mounting in one frame dispatch ONE selection restore, to the selection they captured', async () => {
    const { view, selectionOnly } = await mount(bullets(40))
    const captured = view.state.selection
    expect(view.dom.querySelectorAll('.milkdown-list-item-block')).toHaveLength(40)
    runFrame()
    expect(selectionOnly).toHaveLength(1)
    expect(view.state.selection.anchor).toBe(captured.anchor)
    expect(view.state.selection.head).toBe(captured.head)
    runFrame()
    expect(selectionOnly).toHaveLength(1)
  })

  it('the last mount in the frame decides the caret, exactly as the last of the N dispatches did', async () => {
    const { view, selectionOnly } = await mount(bullets(3))
    runFrame()
    selectionOnly.length = 0
    // Two separate list-item mounts in one frame, each under a different caret.
    const first = after(view, 'item 1')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first)))
    view.dispatch(view.state.tr.split(first, 2))
    const second = after(view, 'item 3')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, second)))
    view.dispatch(view.state.tr.split(second, 2))
    const lastCaptured = view.state.selection.head
    // Something moves the caret before the frame; the restore still puts it back where the last
    // mount saw it, as the last per-item dispatch did upstream.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first)))
    selectionOnly.length = 0
    runFrame()
    expect(selectionOnly).toHaveLength(1)
    expect(view.state.selection.head).toBe(lastCaptured)
  })

  it('an item destroyed before the frame no longer restores (its own capture is dropped)', async () => {
    const { view, selectionOnly } = await mount(bullets(3))
    runFrame()
    selectionOnly.length = 0
    const pos = after(view, 'item 2')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    const before = view.state.doc
    view.dispatch(view.state.tr.split(pos, 2))
    // Undo-like: put the old doc back, destroying the item that just mounted.
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, before.content))
    selectionOnly.length = 0
    runFrame()
    expect(selectionOnly).toHaveLength(0)
  })

  it('each editor view restores on its own', async () => {
    const a = await mount(bullets(10))
    const b = await mount(bullets(10))
    runFrame()
    expect(a.selectionOnly).toHaveLength(1)
    expect(b.selectionOnly).toHaveLength(1)
  })
})
