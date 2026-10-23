/**
 * The line node view (YAZ-3164, YAZ-3168; CONTRACTS rule 41): real editors (`createCrepe`), the
 * `hr` node renders through our view. Pinned here, by scenario key: the wrapper and its custom
 * properties (never `style.width`), a plain line with none (S20), the selected look and the end
 * handle (S30), the drag — live, ONE commit on mouseup, the line still selected (S31) — the full
 * length stored as `null` (S32), the floor (S33), Escape (S34), the window losing focus (S35), a
 * click with no move (S36), undo and redo in one step (S37), read-only (S38), a typed `---` (S24),
 * Backspace on a selected line (S25), a reload with a new style (S27), and `ignoreMutation`.
 *
 * jsdom lays nothing out, so the wrapper's width is set by hand where the drag needs it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { redo, undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, setMarkdown } from '../createCrepe'
import { LINE_DRAGGING_CLASS, LINE_END_CLASS, LINE_SELECTED_CLASS, LINE_VIEW_CLASS } from './lineView'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view }
}

afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) {
    await crepe.destroy()
    root.remove()
  }
})

const wrapperOf = (root: HTMLElement) => root.querySelector<HTMLElement>(`.${LINE_VIEW_CLASS}`) as HTMLElement
const endOf = (root: HTMLElement) => root.querySelector<HTMLElement>(`.${LINE_END_CLASS}`) as HTMLElement
const hrPos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'hr') pos = p
  })
  return pos
}
const select = (view: EditorView) => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos(view))))
/** The wrapper as wide as `width` px on screen: the travel is a share of it. */
const rowWidth = (root: HTMLElement, width: number) => {
  wrapperOf(root).getBoundingClientRect = () => ({ width, left: 0 }) as DOMRect
}
/** Press the end handle at `x`, move through `moves`, and let go (unless `release` is false). */
const drag = (root: HTMLElement, x: number, moves: number[], release = true) => {
  endOf(root).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x }))
  for (const clientX of moves) document.dispatchEvent(new MouseEvent('mousemove', { clientX }))
  if (release) document.dispatchEvent(new MouseEvent('mouseup', {}))
}

/** Counts every transaction that changes the document, through the view's own dispatch. */
const countChanges = (view: EditorView) => {
  const counter = { changes: 0 }
  const dispatch = view.dispatch.bind(view)
  view.dispatch = (tr) => {
    if (tr.docChanged) counter.changes++
    dispatch(tr)
  }
  return counter
}

describe('rendering', () => {
  it('draws the line inside a wrapper that carries the style as custom properties, never style.width (S23)', async () => {
    const { root } = await mount('***\n<!-- line: darkness 50%, thickness 6px, length 40% -->\n')
    const wrapper = wrapperOf(root)
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.getAttribute('contenteditable')).toBe('false')
    expect([...wrapper.children].map((el) => el.tagName)).toEqual(['HR', 'SPAN'])
    expect(wrapper.style.getPropertyValue('--line-darkness')).toBe('50%')
    expect(wrapper.style.getPropertyValue('--line-thickness')).toBe('6px')
    expect(wrapper.style.getPropertyValue('--line-width')).toBe('40%')
    expect(wrapper.style.width).toBe('')
    expect(wrapper.querySelector('hr')?.getAttribute('style')).toBeNull()
  })

  it('S20: a plain line has no property at all, so the stylesheet defaults draw it', async () => {
    const { root } = await mount('a\n\n***\n\nb\n')
    expect(wrapperOf(root).getAttribute('style') ?? '').toBe('')
  })

  it('S24: typing --- makes a default line, as today', async () => {
    const { root, view } = await mount('\n')
    view.focus()
    const from = view.state.selection.from
    // The input rule runs on text input; ProseMirror's handleTextInput is the path a keystroke takes.
    view.dispatch(view.state.tr.insertText('--', from))
    const handled = view.someProp('handleTextInput', (f) => f(view, view.state.selection.from, view.state.selection.from, '-', () => view.state.tr))
    expect(handled).toBe(true)
    expect(view.state.doc.child(0).type.name).toBe('hr')
    expect(view.state.doc.child(0).attrs).toEqual({ darkness: null, thickness: null, width: null })
    expect(wrapperOf(root)).not.toBeNull()
  })

  it('S27: an outside change reloads with the style', async () => {
    const { crepe, root } = await mount('***\n')
    setMarkdown(crepe, '***\n<!-- line: thickness 3px -->\n')
    expect(wrapperOf(root).style.getPropertyValue('--line-thickness')).toBe('3px')
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: thickness 3px -->\n')
  })
})

describe('selection and the length handle', () => {
  it('S30: a selected line gets is-selected, which shows the end handle; leaving it removes the class', async () => {
    const { root, view } = await mount('a\n\n***\n\nb\n')
    expect(wrapperOf(root).classList.contains(LINE_SELECTED_CLASS)).toBe(false)
    select(view)
    expect(wrapperOf(root).classList.contains(LINE_SELECTED_CLASS)).toBe(true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(wrapperOf(root).classList.contains(LINE_SELECTED_CLASS)).toBe(false)
  })

  it('S31: the length follows the pointer live, and mouseup writes it ONCE with the line still selected', async () => {
    const { crepe, root, view } = await mount('a\n\n***\n\nb\n')
    const counter = countChanges(view)
    rowWidth(root, 500)
    drag(root, 500, [400, 300], false)
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('60%')
    expect(wrapperOf(root).classList.contains(LINE_DRAGGING_CLASS)).toBe(true)
    expect(counter.changes).toBe(0)
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(counter.changes).toBe(1)
    expect(wrapperOf(root).classList.contains(LINE_DRAGGING_CLASS)).toBe(false)
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect((view.state.selection as NodeSelection).node.attrs.width).toBe(60)
    expect(wrapperOf(root).classList.contains(LINE_SELECTED_CLASS)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: length 60% -->\n\nb\n')
  })

  it('S32: a drag to the right edge or past it gives a full line, and the length part leaves the comment', async () => {
    const { crepe, root } = await mount('***\n<!-- line: darkness 50%, length 40% -->\n')
    rowWidth(root, 500)
    drag(root, 200, [450, 900])
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('')
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: darkness 50% -->\n')
  })

  it('S33: the line cannot get shorter than 10%', async () => {
    const { crepe, root } = await mount('***\n')
    rowWidth(root, 500)
    drag(root, 500, [-300])
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: length 10% -->\n')
  })

  it('S34: Escape mid-drag puts the length back, and nothing is written', async () => {
    const { crepe, root, view } = await mount('***\n<!-- line: length 40% -->\n')
    const counter = countChanges(view)
    rowWidth(root, 500)
    drag(root, 200, [100], false)
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('20%')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    view.dom.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true) // the drag took the key; the editor's own Escape never saw it
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('40%')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('40%')
    expect(counter.changes).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: length 40% -->\n')
  })

  it('S34: Escape on a full line takes the property away again', async () => {
    const { root, view } = await mount('***\n')
    rowWidth(root, 500)
    drag(root, 500, [250], false)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('')
  })

  it('S35: the window losing focus mid-drag ends it where it stands, and writes it', async () => {
    const { crepe, root } = await mount('***\n')
    rowWidth(root, 500)
    drag(root, 500, [250], false)
    window.dispatchEvent(new Event('blur'))
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: length 50% -->\n')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('50%')
  })

  it('S36: a click on the handle with no move writes nothing', async () => {
    const { crepe, root, view } = await mount('***\n<!-- line: length 40% -->\n')
    const counter = countChanges(view)
    rowWidth(root, 500)
    drag(root, 200, [])
    expect(counter.changes).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: length 40% -->\n')
  })

  it('S37: ⌘Z undoes one drag in one step, and ⌘⇧Z redoes it', async () => {
    const { crepe, root, view } = await mount('a\n\n***\n\nb\n')
    rowWidth(root, 500)
    drag(root, 500, [450, 400, 350, 300])
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: length 60% -->\n\nb\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\nb\n')
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('')
    expect(redo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: length 60% -->\n\nb\n')
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('60%')
  })

  it('S38: a read-only note shows the line with its style, no selected look and no gesture', async () => {
    const { crepe, root, view } = await mount('***\n<!-- line: thickness 6px, length 40% -->\n')
    view.setProps({ editable: () => false })
    expect(wrapperOf(root).style.getPropertyValue('--line-thickness')).toBe('6px')
    select(view)
    expect(wrapperOf(root).classList.contains(LINE_SELECTED_CLASS)).toBe(false)
    rowWidth(root, 500)
    drag(root, 200, [400])
    expect(wrapperOf(root).style.getPropertyValue('--line-width')).toBe('40%')
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: thickness 6px, length 40% -->\n')
  })

  it('S25: Backspace on a selected line removes it, with its style', async () => {
    const { crepe, view } = await mount('a\n\n***\n<!-- line: darkness 50% -->\n\nb\n')
    select(view)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(getMarkdownForSave(crepe)).toBe('a\n\nb\n')
  })

  it('the handle claims its own events; the rest of the line is ProseMirror’s', async () => {
    const { root } = await mount('***\n')
    const desc = (wrapperOf(root) as unknown as { pmViewDesc: { stopEvent: (e: Event) => boolean } }).pmViewDesc
    const onEnd = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(onEnd, 'target', { value: endOf(root) })
    const onLine = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(onLine, 'target', { value: wrapperOf(root).querySelector('hr') })
    expect(desc.stopEvent(onEnd)).toBe(true)
    expect(desc.stopEvent(onLine)).toBe(false)
  })
})

describe('ignoreMutation', () => {
  it('ignores DOM mutations inside the wrapper but never a selection change', async () => {
    const { root } = await mount('***\n')
    const wrapper = wrapperOf(root)
    const desc = (wrapper as unknown as { pmViewDesc: { ignoreMutation: (m: unknown) => boolean } }).pmViewDesc
    expect(desc.ignoreMutation({ type: 'attributes', target: wrapper })).toBe(true)
    expect(desc.ignoreMutation({ type: 'childList', target: wrapper })).toBe(true)
    expect(desc.ignoreMutation({ type: 'selection', target: wrapper })).toBe(false)
  })
})
