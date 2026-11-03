/**
 * THE TEXT BOX EDITOR (YAZ-4277 D1): the engine's `textEditor`. A drawing text box edits with the notes engine —
 * the same `createCrepe` a note uses — mounted in the root the engine places over the box.
 *
 * INVISIBLE BY DESIGN (YAZ-4300 decision): the canvas keeps drawing the box while it is edited, so no letter moves
 * when the edit starts or ends. This editor takes the keys, the selection and the IME only; the engine's CSS makes it
 * transparent and the engine draws the caret (1.5 px on screen, D10) and the selection from the canvas layout.
 * Offsets in and out are offsets in the box's `originalText`.
 *
 * NO MARKDOWN (D1): the document is built from the box's text after `create()`, and walked back to text on each
 * change. 1A keeps it plain: one paragraph per line, bullets as their letters. 1B maps bullets to list items and the
 * letter styles to marks. The toolbar and the `/` menu stay off until they can live outside the zoomed root (1C, 1E).
 */
import type { ComponentProps } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import type { ExcalidrawModule } from './engine'
import './textBoxEditor.css'

type HostTextEditor = NonNullable<ComponentProps<ExcalidrawModule['Excalidraw']>['textEditor']>
type Selection = Parameters<HostTextEditor['mount']>[0]['selection']

/** The note features minus the UI that draws in the zoomed root, and the blocks a box cannot hold. */
export const textBoxFeatures: Record<CrepeFeature, boolean> = {
  ...features,
  [CrepeFeature.BlockEdit]: false,
  [CrepeFeature.Toolbar]: false,
  [CrepeFeature.Table]: false,
  [CrepeFeature.CodeMirror]: false,
  [CrepeFeature.LinkTooltip]: false,
  [CrepeFeature.Cursor]: false,
}

/** The box's text as the editor's document: one paragraph for each line. */
export function textToDoc(schema: Schema, text: string): ProseNode {
  return schema.node(
    'doc',
    null,
    text.split('\n').map((line) => schema.node('paragraph', null, line ? schema.text(line) : undefined)),
  )
}

/** Each line of the document: where its text starts, and the text. Every text block is one line. */
function lines(doc: ProseNode): { pos: number; text: string }[] {
  const out: { pos: number; text: string }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    out.push({ pos: pos + 1, text: node.textContent })
    return false
  })
  return out
}

export function docToText(doc: ProseNode): string {
  return lines(doc)
    .map((line) => line.text)
    .join('\n')
}

/** The document position of a text offset. */
export function posAt(doc: ProseNode, offset: number): number {
  let start = 0
  const all = lines(doc)
  for (const line of all) {
    if (offset <= start + line.text.length) return line.pos + Math.max(0, offset - start)
    start += line.text.length + 1
  }
  const last = all[all.length - 1]
  return last ? last.pos + last.text.length : 0
}

/** The text offset of a document position. */
export function offsetAt(doc: ProseNode, pos: number): number {
  let start = 0
  for (const line of lines(doc)) {
    if (pos <= line.pos + line.text.length) return start + Math.max(0, pos - line.pos)
    start += line.text.length + 1
  }
  return Math.max(0, start - 1)
}

/** Escape and ⌘Enter end the edit in the engine; here they only keep the note keys (Escape to the sidebar) off. */
const endKeys = $shortcut(() => ({
  Escape: () => true,
  'Mod-Enter': () => true,
}))

export const textBoxEditor: HostTextEditor = {
  mount({ root, text, selection, onChange, onSelectionChange }) {
    let destroyed = false
    let isReady = false
    let wantsFocus = false
    let pending: Selection = selection
    let reported = { text, anchor: selection.anchor, head: selection.head }

    const report = $prose(
      () =>
        new Plugin({
          key: new PluginKey('textBoxReport'),
          view: () => ({
            update: (view) => {
              if (destroyed) return
              const { doc, selection: sel } = view.state
              const next = docToText(doc)
              const anchor = offsetAt(doc, sel.anchor)
              const head = offsetAt(doc, sel.head)
              // the selection first: the engine moves the letter styles with the caret after the edit
              if (anchor !== reported.anchor || head !== reported.head) onSelectionChange({ anchor, head })
              if (next !== reported.text) onChange(next)
              reported = { text: next, anchor, head }
            },
          }),
        }),
    )

    const crepe = createCrepe({ root, defaultValue: '', features: textBoxFeatures })
    crepe.editor.use(endKeys).use(report)

    const select = (sel: Selection) => {
      const view = crepe.editor.ctx.get(editorViewCtx)
      const { doc } = view.state
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, posAt(doc, sel.anchor), posAt(doc, sel.head))))
    }

    const ready = crepe.create().then(() => {
      if (destroyed) return
      const view = crepe.editor.ctx.get(editorViewCtx)
      const doc = textToDoc(view.state.schema, text)
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
      tr.setSelection(TextSelection.create(tr.doc, posAt(tr.doc, pending.anchor), posAt(tr.doc, pending.head)))
      // the box's text is where the edit starts: ⌘Z never goes back past it
      view.dispatch(tr.setMeta('addToHistory', false))
      isReady = true
      if (wantsFocus) view.focus()
    })

    return {
      setSelection(sel) {
        pending = sel
        if (isReady && !destroyed) select(sel)
      },
      focus() {
        wantsFocus = true
        if (isReady && !destroyed) crepe.editor.ctx.get(editorViewCtx).focus()
      },
      destroy() {
        destroyed = true
        void ready.then(() => crepe.destroy())
      },
    }
  },
}
