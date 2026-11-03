/** The text box editor's test kit (YAZ-4277): the engine's box rules, and a mounted editor with its view. */
import { vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getBulletMarkerForDepth, normalizeTextRuns, remapTextRunsForTextEdit } from '@excalidraw/element'
import { docToBox, type BoxHelpers, type TextRuns } from './textBoxDoc'
import { createTextBoxEditor } from './textBoxEditor'

export const helpers = { getBulletMarkerForDepth, normalizeTextRuns, remapTextRunsForTextEdit } as unknown as BoxHelpers

/**
 * Every Crepe the editor makes, to reach its view. The test file's `vi.mock` of `createCrepe` pushes here, through the
 * global: the mock cannot import this kit, which imports the editor, which imports `createCrepe` (a cycle).
 */
export const created: Crepe[] = ((globalThis as { __textBoxCrepes?: Crepe[] }).__textBoxCrepes ??= [])

const mounts: Array<{ destroy: () => void; root: HTMLElement }> = []

export function unmountAll(): void {
  for (const m of mounts.splice(0)) {
    m.destroy()
    m.root.remove()
  }
}

/** Mounts the editor on a box and waits until Crepe holds its document, as the engine does on a double click. */
export async function mountBox(text: string, textRuns: TextRuns = undefined, selection = { anchor: 0, head: 0 }) {
  const root = document.createElement('div')
  root.className = 'excalidraw-host-text-editor'
  document.body.appendChild(root)
  const onChange = vi.fn<(text: string, textRuns: TextRuns, selection: { anchor: number; head: number }) => void>()
  const onSelectionChange = vi.fn<(s: { anchor: number; head: number }) => void>()
  const session = createTextBoxEditor(helpers).mount({ root, text, textRuns, selection, onChange, onSelectionChange })
  mounts.push({ destroy: session.destroy, root })
  const crepe = created[created.length - 1]
  let view: EditorView | null = null
  await vi.waitFor(() => {
    view = crepe.editor.ctx.get(editorViewCtx)
    if (root.querySelector('.ProseMirror') === null || docToBox(view.state.doc, { text, textRuns }, helpers).text !== text) throw new Error('not ready')
  })
  // one more task: the first document lands after `create()` resolves
  await new Promise((r) => setTimeout(r, 0))
  return { root, session, onChange, onSelectionChange, crepe, view: view as unknown as EditorView }
}

/** Types `text` as the keyboard does: each letter through the editor's text input handlers, else inserted. */
export function typeText(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char, () => view.state.tr.insertText(char, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}
