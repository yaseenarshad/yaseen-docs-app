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
 * focus is on `<body>` with the DOM selection anywhere in its page — the body, or the title,
 * properties, comments, backlinks and reviews around it (YAZ-3140) — never with the focus in the find
 * bar, a dialog or another note. An editable view is
 * ProseMirror's own business, so nothing here runs for it.
 *
 * The chords (Settings › Hotkeys, the note's view actions): ⌘⇧U / ⌘⇧I fold / unfold all, ⌘↑ / ⌘↓ fold /
 * unfold at the caret, ⌘. / ⌘⇧. zoom in / out, ⌘Z the view-action undo, ⌘A select all (YAZ-3127).
 *
 * The NOTE EDITOR only (a tab or the right panel, `CreateCrepeOptions.readOnlyKeys`): the read-only
 * previews (the hover card, the search and sidebar previews) neither take the focus nor answer keys. The other view keys have their
 * own paths and need nothing here: ⌘J (the table of contents), ⌘F (the find bar), ⌘+ / ⌘− / ⌘0 (the
 * menu's page zoom), ⌘C (the native selection). Every other chord of the list edits.
 *
 * And the focus comes BACK here: after the find bar, the table of contents or any other
 * `view.focus()` (YAZ-3130, `focusReadOnlyBody`).
 */
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { NOTE_PAGE, claimPage, isShown, pageSelectionHolder } from '../lib/readOnlyCaret'
import { FOLD_KEYS } from './outline/foldKeys'

const yes = (): boolean => true

/**
 * GIVE THE FOCUS BACK TO A READ-ONLY NOTE (YAZ-3130). ProseMirror's `view.focus()` does not focus a
 * view that is not editable (`if (this.editable) focusPreventScroll(this.dom)`), and it draws that
 * view's selection only where a DOM selection already is. So after Esc in the find bar or the table
 * of contents the focus stayed on `<body>` with no selection, and the window took the keys (⌘C copied
 * the file, ↓ moved the sidebar). This focuses the body (focusable while read only, YAZ-3127), puts
 * the DOM caret at the editor's selection, then runs ProseMirror's own `focus` to draw it whole.
 *
 * It is THE one path: while the note editor is read only, `view.focus` is this (see the plugin view),
 * so every caller — `focusEditor`, Find close, the table of contents, the editor shell — lands in the
 * note. An editable view runs ProseMirror's `focus` unchanged.
 */
export function focusReadOnlyBody(view: EditorView, focus: () => void): void {
  // Sent here with no click: this page has the keys (YAZ-3145).
  claimPage(view.dom)
  if (!view.editable) {
    view.dom.focus({ preventScroll: true })
    const { anchor, head } = view.state.selection
    const from = view.domAtPos(anchor)
    const to = view.domAtPos(head)
    view.dom.ownerDocument.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset)
  }
  focus()
}

/** Whether `event` is one of the view-action chords — matched the way the keymaps match them. */
const isViewAction = keydownHandler({
  [FOLD_KEYS.foldAll]: yes,
  [FOLD_KEYS.unfoldAll]: yes,
  [FOLD_KEYS.foldHere]: yes,
  [FOLD_KEYS.unfoldHere]: yes,
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

/**
 * The focus is nowhere and the reader's selection is elsewhere in THIS note's visible page — its
 * title, properties, comments, backlinks or reviews (YAZ-3140, "a page holds the keys"): the
 * page's view keys are still this note's.
 */
function inOwnPage(view: EditorView): boolean {
  const doc = view.dom.ownerDocument
  if (doc.activeElement !== null && doc.activeElement !== doc.body) return false
  const page = view.dom.closest(NOTE_PAGE)
  return page !== null && pageSelectionHolder(doc) === page
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
        // Every "give the focus back to the note" call goes through `view.focus` (YAZ-3130).
        const ownFocus = Object.prototype.hasOwnProperty.call(view, 'focus')
        const focus = view.focus.bind(view)
        view.focus = () => focusReadOnlyBody(view, focus)
        const onKeyDown = (event: KeyboardEvent): void => {
          if (view.editable || event.defaultPrevented || !isViewAction(view, event) || !holdsReader(view)) return
          // The reader is in this note: the focus is in its body (YAZ-3127), or on `<body>` with their
          // DOM selection here. With the focus in the body the editor's own selection stands, even when
          // the DOM has none left (an arrow key in a non-editable body can drop it).
          const caret = domCaret(view)
          if (caret === null && !view.dom.contains(view.dom.ownerDocument.activeElement) && !inOwnPage(view)) return
          // ProseMirror draws a non-editable view's selection only where a DOM selection already is
          // (`editorOwnsSelection`), so the body takes the focus with the editor's own selection
          // drawn first (`focusReadOnlyBody`): then ⌘A shows, and the next key starts in the note.
          if (caret === null) view.focus()
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
            if (ownFocus) view.focus = focus
            else delete (view as { focus?: () => void }).focus
          },
        }
      },
    }),
)
