/**
 * THE KEYBOARD VIEW ACTIONS OF A READ-ONLY NOTE (YAZ-3076 D8 — "the document is completely normal
 * except the ability to edit" — YAZ-3125, S25).
 *
 * A read-only note has no keyboard path to its own keymaps: `setReadonly(true)` makes the editor
 * `contenteditable="false"`, so a click in its body leaves the focus on `<body>`, and ProseMirror runs
 * no `keydown` handler in a view that is not editable anyway (`keydown` is one of its edit handlers).
 * So while the view is NOT editable this plugin listens on `document` and answers the view-action
 * chords itself, through the editor's OWN keymaps (`handleKeyDown`) — the same commands, at the same
 * priorities — with `view.dispatch` guarded: a transaction that changes the document is dropped. An
 * edit can never land, and ⌘Z undoes a fold or a zoom but never an edit made before the lock.
 *
 * Only the note the reader is in answers: the view must be visible (a hidden tab keeps its DOM
 * selection), and either the focus is in its body (it takes the focus while read only, YAZ-3127) or the
 * focus is on `<body>` with the DOM selection inside it — never with the focus in the find bar, a
 * dialog or another note. An editable view is
 * ProseMirror's own business, so nothing here runs for it.
 *
 * The chords (Settings › Hotkeys, the note's view actions): ⌘⇧U / ⌘⇧I fold / unfold all, ⌘↑ / ⌘↓ fold /
 * unfold at the caret, ⌘. / ⌘⇧. zoom in / out, ⌘Z the view-action undo, ⌘A select all (YAZ-3127).
 *
 * The NOTE EDITOR only (a tab or the right panel, `CreateCrepeOptions.readOnlyKeys`): the read-only
 * previews (the hover card, the search and sidebar previews) neither take the focus nor answer keys. The other view keys have their
 * own paths and need nothing here: ⌘J (the table of contents), ⌘F (the find bar), ⌘+ / ⌘− / ⌘0 (the
 * menu's page zoom), ⌘C (the native selection). Every other chord of the list edits.
 */
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { isShown } from '../lib/readOnlyCaret'

const yes = (): boolean => true

/** Whether `event` is one of the view-action chords — matched the way the keymaps match them. */
const isViewAction = keydownHandler({
  'Mod-Shift-u': yes,
  'Mod-Shift-i': yes,
  'Mod-ArrowUp': yes,
  'Mod-ArrowDown': yes,
  'Mod-.': yes,
  'Mod-Shift-.': yes,
  'Mod->': yes,
  'Mod-z': yes,
  // ProseMirror's own select-all: the note's text, never the page around it (YAZ-3127).
  'Mod-a': yes,
})

/** The DOM selection's caret, when it sits inside `view`; null otherwise. */
function domCaret(view: EditorView): { anchor: number; head: number } | null {
  const sel = view.dom.ownerDocument.getSelection()
  if (sel === null || sel.anchorNode === null || sel.focusNode === null) return null
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return null
  try {
    return { anchor: view.posAtDOM(sel.anchorNode, sel.anchorOffset), head: view.posAtDOM(sel.focusNode, sel.focusOffset) }
  } catch {
    return null
  }
}

/** This note is the one the reader is in: visible, and the focus on `<body>` or inside its own section. */
function holdsReader(view: EditorView): boolean {
  const doc = view.dom.ownerDocument
  if (!isShown(view.dom)) return false
  const active = doc.activeElement
  if (active === null || active === doc.body) return true
  const section = view.dom.closest('section.editor')
  return section !== null && section.contains(active) && !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
}

export const readOnlyKeys = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-read-only-keys'),
      view: (view) => {
        // A read-only body holds the keyboard itself (YAZ-3127): focusable while it is not editable, so
        // a click in it puts the focus there and the window's chrome keys leave it alone.
        const focusable = (): void => {
          if (view.editable) view.dom.removeAttribute('tabindex')
          else view.dom.setAttribute('tabindex', '-1')
        }
        focusable()
        const onKeyDown = (event: KeyboardEvent): void => {
          if (view.editable || event.defaultPrevented || !isViewAction(view, event) || !holdsReader(view)) return
          // The reader is in this note: the focus is in its body (YAZ-3127), or on `<body>` with their
          // DOM selection here. With the focus in the body the editor's own selection stands, even when
          // the DOM has none left (an arrow key in a non-editable body can drop it).
          const caret = domCaret(view)
          if (caret === null && !view.dom.contains(view.dom.ownerDocument.activeElement)) return
          // ProseMirror draws a non-editable view's selection only where a DOM selection already is
          // (`editorOwnsSelection`), so one is put back at the editor's own caret first: then ⌘A shows.
          if (caret === null) {
            const at = view.domAtPos(view.state.selection.head)
            view.dom.ownerDocument.getSelection()?.collapse(at.node, at.offset)
          }
          // The caret the reader clicked is where "at the caret" means.
          const { selection } = view.state
          if (caret !== null && (selection.anchor !== caret.anchor || selection.head !== caret.head)) {
            view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(caret.anchor), view.state.doc.resolve(caret.head))).setMeta('addToHistory', false))
          }
          const dispatch = view.dispatch
          view.dispatch = (tr: Transaction) => {
            if (!tr.docChanged) dispatch(tr)
          }
          try {
            if (view.someProp('handleKeyDown', (handle) => handle(view, event))) event.preventDefault()
          } finally {
            view.dispatch = dispatch
          }
        }
        const doc = view.dom.ownerDocument
        doc.addEventListener('keydown', onKeyDown)
        return {
          update: focusable,
          destroy: () => {
            doc.removeEventListener('keydown', onKeyDown)
            view.dom.removeAttribute('tabindex')
          },
        }
      },
    }),
)
