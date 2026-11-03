import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Crepe } from '@milkdown/crepe'
import { docToText, offsetAt, posAt, textBoxEditor } from './textBoxEditor'

// the Crepe the editor makes, to reach its view
const created: Crepe[] = []
vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      created.push(crepe)
      return crepe
    },
  }
})

// The demo board's box (YAZ-4277): a bold title, bullets as their letters, an empty child bullet.
const MOAT = 'Our main Moat:\n• 1) Automated Pipeline\n    ○ \n• 2) Editing (Power User)\n• 3) Schedule / Posting\n• 4) Server / Rendering Scaling'

const mounts: Array<{ destroy: () => void; root: HTMLElement }> = []

afterEach(() => {
  for (const m of mounts.splice(0)) {
    m.destroy()
    m.root.remove()
  }
})

/** Mounts the editor and waits until Crepe is ready, as the engine does on a double click. */
async function mount(text: string, selection = { anchor: 0, head: 0 }) {
  const root = document.createElement('div')
  root.className = 'excalidraw-host-text-editor'
  document.body.appendChild(root)
  const onChange = vi.fn<(text: string) => void>()
  const onSelectionChange = vi.fn<(s: { anchor: number; head: number }) => void>()
  const session = textBoxEditor.mount({ root, text, selection, onChange, onSelectionChange })
  mounts.push({ destroy: session.destroy, root })
  const crepe = created[created.length - 1]
  let view: EditorView | null = null
  await vi.waitFor(() => {
    view = crepe.editor.ctx.get(editorViewCtx)
    if (root.querySelector('.ProseMirror') === null || docToText(view.state.doc) !== text) throw new Error('not ready')
  })
  return { root, session, onChange, onSelectionChange, view: view as unknown as EditorView }
}

describe('textBoxEditor: the notes engine in a drawing text box (YAZ-4277 1A)', () => {
  it('opens the box text as one paragraph a line, and gives it back unchanged', async () => {
    const { view, onChange } = await mount(MOAT)
    expect(view.state.doc.childCount).toBe(6)
    expect(view.state.doc.child(2).textContent).toBe('    ○ ')
    expect(docToText(view.state.doc)).toBe(MOAT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens an empty box as one empty line', async () => {
    const { view } = await mount('')
    expect(view.state.doc.childCount).toBe(1)
    expect(docToText(view.state.doc)).toBe('')
  })

  it('reports an edit as the box text, the selection first', async () => {
    const { view, onChange, onSelectionChange } = await mount('ab\ncd', { anchor: 5, head: 5 })
    const calls: string[] = []
    onChange.mockImplementation(() => calls.push('text'))
    onSelectionChange.mockImplementation(() => calls.push('selection'))
    view.dispatch(view.state.tr.insertText('X', posAt(view.state.doc, 5)))
    expect(onChange).toHaveBeenLastCalledWith('ab\ncdX')
    expect(onSelectionChange).toHaveBeenLastCalledWith({ anchor: 6, head: 6 })
    expect(calls).toEqual(['selection', 'text'])
  })

  it('starts on the selection it is given, and takes a new one from a click', async () => {
    const { view, session } = await mount('hello\nworld', { anchor: 0, head: 11 })
    expect([offsetAt(view.state.doc, view.state.selection.anchor), offsetAt(view.state.doc, view.state.selection.head)]).toEqual([0, 11])
    session.setSelection({ anchor: 8, head: 2 })
    expect(view.state.selection.anchor).toBe(posAt(view.state.doc, 8))
    expect(view.state.selection.head).toBe(posAt(view.state.doc, 2))
  })

  it('does not undo past the text the edit started with', async () => {
    const { view } = await mount('keep')
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    view.dispatch(view.state.tr.insertText('!'))
    const { undo } = await import('@milkdown/kit/prose/history')
    // ⌘Z takes back the typing, then has nothing more: the box text stays
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(docToText(view.state.doc)).toBe('keep')
    expect(undo(view.state, view.dispatch)).toBe(false)
    expect(docToText(view.state.doc)).toBe('keep')
  })

  it('maps text offsets and document positions both ways', async () => {
    const { view } = await mount('ab\n\ncd')
    const { doc } = view.state
    for (const offset of [0, 1, 2, 3, 4, 5, 6]) expect(offsetAt(doc, posAt(doc, offset))).toBe(offset)
  })

  it('stops reporting once destroyed', async () => {
    const { view, session, onChange } = await mount('x')
    session.destroy()
    view.dispatch(view.state.tr.insertText('y', 1))
    expect(onChange).not.toHaveBeenCalled()
  })
})
