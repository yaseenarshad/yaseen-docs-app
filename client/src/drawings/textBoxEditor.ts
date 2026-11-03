/**
 * THE TEXT BOX EDITOR (YAZ-4277 D1): the engine's `textEditor`. A drawing text box edits with the notes engine —
 * the same `createCrepe` a note uses — mounted in the root the engine places over the box.
 *
 * INVISIBLE BY DESIGN (YAZ-4300 decision): the canvas keeps drawing the box while it is edited, so no letter moves
 * when the edit starts or ends. This editor takes the keys, the selection and the IME only; the engine's CSS makes it
 * transparent and the engine draws the caret (1.5 px on screen, D10) and the selection from the canvas layout.
 * Offsets in and out are offsets in the box's `originalText`.
 *
 * NO MARKDOWN (D1): the document is built from the box's text and letter styles after `create()`, and walked back to
 * them on each change (`textBoxDoc.ts`, 1B). `textBoxLock.ts` keeps it to what a box draws (D4). Made from the loaded
 * engine module (`createTextBoxEditor(engine)`), whose run rules and bullet glyphs it uses: the box format has one
 * source. The pop-up toolbar and the `/` menu move to a layer of their own, at screen size (1C).
 */
import type { ComponentProps } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { HIDDEN_IN_CELL } from '../editor/slashMenu'
import type { ExcalidrawModule } from './engine'
import { boxToDoc, docToBox, offsetAt, posAt, type BoxHelpers, type TextRuns } from './textBoxDoc'
import { lockToTextBox } from './textBoxLock'
import './textBoxEditor.css'

type HostTextEditor = NonNullable<ComponentProps<ExcalidrawModule['Excalidraw']>['textEditor']>
type Selection = Parameters<HostTextEditor['mount']>[0]['selection']

/** The note features minus the blocks a box cannot hold. The pop-up toolbar and the `/` menu (BlockEdit) stay (D4, D8). */
export const textBoxFeatures: Record<CrepeFeature, boolean> = {
  ...features,
  [CrepeFeature.Table]: false,
  [CrepeFeature.CodeMirror]: false,
  [CrepeFeature.LinkTooltip]: false,
  [CrepeFeature.Cursor]: false,
}

/** The toolbar buttons and the `/` rows of what a box cannot hold (D4): headings, numbered lists, code, quotes, … */
export const TEXT_BOX_HIDDEN = {
  toolbar: ['h1', 'h2', 'h3', 'numberedList', 'code', 'link'],
  slash: [...HIDDEN_IN_CELL, 'ordered-list'],
} as const

/** The pop-ups Crepe puts beside its view; they move out of the root, which is invisible and zoomed (1C). */
const POPUPS = '.milkdown-toolbar, .milkdown-slash-menu'

/** Escape and ⌘Enter end the edit in the engine; here they only keep the note keys (Escape to the sidebar) off. */
const endKeys = $shortcut(() => ({
  Escape: () => true,
  'Mod-Enter': () => true,
}))

/** Same text, same runs: nothing to tell the engine. */
const sameRuns = (a: TextRuns, b: TextRuns) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

export function createTextBoxEditor(helpers: BoxHelpers): HostTextEditor {
  return {
    mount({ root, text, textRuns, selection, onChange, onSelectionChange }) {
      let destroyed = false
      let isReady = false
      let wantsFocus = false
      let pending: Selection = selection
      let reported = { text, textRuns, anchor: selection.anchor, head: selection.head }

      const report = $prose(
        () =>
          new Plugin({
            key: new PluginKey('textBoxReport'),
            view: () => ({
              update: (view, prev) => {
                if (destroyed || !isReady) return
                const { doc, selection: sel } = view.state
                const anchor = offsetAt(doc, sel.anchor, helpers)
                const head = offsetAt(doc, sel.head, helpers)
                // the selection first: a caret move alone costs no walk of the document
                if (anchor !== reported.anchor || head !== reported.head) onSelectionChange({ anchor, head })
                let next = { text: reported.text, textRuns: reported.textRuns }
                if (doc !== prev.doc) {
                  next = docToBox(doc, { text: reported.text, textRuns: reported.textRuns, caret: Math.max(anchor, head) }, helpers)
                  if (next.text !== reported.text || !sameRuns(next.textRuns, reported.textRuns)) onChange(next.text, next.textRuns)
                }
                reported = { ...next, anchor, head }
              },
            }),
          }),
      )

      const crepe = createCrepe({ root, defaultValue: '', features: textBoxFeatures, hidden: TEXT_BOX_HIDDEN })
      lockToTextBox(crepe)
      crepe.editor.use(endKeys).use(report)

      // The toolbar and the `/` menu draw at screen size, over the board: in a layer of their own on the page, with
      // Crepe's look (`milkdown`). Floating UI places them from the selection's box on screen, as in a note.
      const popups = document.createElement('div')
      popups.className = 'milkdown excalidraw-text-box-popups'
      document.body.appendChild(popups)
      const movePopups = () => {
        for (const popup of root.querySelectorAll(POPUPS)) popups.appendChild(popup)
      }
      const popupWatch = new MutationObserver(movePopups)
      popupWatch.observe(root, { childList: true, subtree: true })

      const select = (sel: Selection) => {
        const view = crepe.editor.ctx.get(editorViewCtx)
        const { doc } = view.state
        view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, posAt(doc, sel.anchor, helpers), posAt(doc, sel.head, helpers))))
      }

      const ready = crepe.create().then(() => {
        if (destroyed) return
        const view = crepe.editor.ctx.get(editorViewCtx)
        const doc = boxToDoc(view.state.schema, text, textRuns, helpers)
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
        tr.setSelection(TextSelection.create(tr.doc, posAt(tr.doc, pending.anchor, helpers), posAt(tr.doc, pending.head, helpers)))
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
          popupWatch.disconnect()
          popups.remove()
          void ready.then(() => crepe.destroy())
        },
      }
    },
  }
}
