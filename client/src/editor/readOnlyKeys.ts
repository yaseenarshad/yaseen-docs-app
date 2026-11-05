/**
 * THE KEYBOARD VIEW ACTIONS OF A READ-ONLY NOTE (YAZ-3076 D8 — "the document is completely normal
 * except the ability to edit" — YAZ-3125, S25).
 *
 * A read-only note has no keyboard path to its own keymaps: `setReadonly(true)` makes the view not
 * editable, and ProseMirror runs no `keydown` handler in a view that is not editable (`keydown` is one
 * of its edit handlers). The note editor's body keeps a caret all the same (below, YAZ-4433).
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
 * The chords (the note's view actions, by default; YAZ-3564 K4): ⌘⇧U / ⌘⇧I fold / unfold all, ⌘↑ / ⌘↓ fold /
 * unfold at the caret, ⌘. / ⌘⇧. zoom in / out, ⌘Z the view-action undo, ⌘A select all (YAZ-3127).
 *
 * The NOTE EDITOR only (a tab or the right panel, `CreateCrepeOptions.readOnlyKeys`): the read-only
 * previews (the hover card, the search and sidebar previews) neither take the focus nor answer keys. The other view keys have their
 * own paths and need nothing here: ⌘J (the table of contents), ⌘F (the find bar), ⌘+ / ⌘− / ⌘0 (the
 * menu's page zoom), ⌘C (the native selection). Every other chord of the list edits.
 *
 * And the focus comes BACK here: after the find bar, the table of contents or any other
 * `view.focus()` (YAZ-3130, `focusReadOnlyBody`).
 *
 * THE CARET (YAZ-4433, D30 of YAZ-4278 — "the caret to work as normal, just can't type"): ProseMirror keeps
 * `view.editable` false, so every check of it (the pop-up toolbar, the `/` menu, the block handle, the task boxes, the
 * code blocks, the links, the tables) still means read only. Only the DOM changes: while locked the body is
 * `contenteditable="true"` with `data-read-only`, so the browser draws the caret and moves it, and ProseMirror reads the
 * new selection. The navigation keys (`NAVIGATION_KEYS`, any modifier) go through the note's own keymaps like the view
 * actions (⇧↑ / ⇧↓ select by line, and in a table the arrows cross cells); a key no keymap takes moves the caret natively.
 * Tab / ⇧Tab go to the next / previous table cell, straight through the table's own move. Nothing can edit, at the root: a
 * non-editable view runs none of ProseMirror's edit handlers and ignores DOM changes, `beforeinput` is cancelled for
 * every input type (typing, Enter, delete, paste, drop, spell replace, the native ⌘B / ⌘Z), and a change that cannot be
 * cancelled (IME composition) is drawn again from the document at its `input` event. No `filterTransaction`: a read-only
 * note still takes outside changes from disk by a transaction (`applyExternalMarkdown.ts`).
 */
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { goToNextCell } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Ctx } from '@milkdown/kit/ctx'
import { $prose } from '@milkdown/kit/utils'
import { NOTE_PAGE, claimPage, isShown, pageSelectionHolder } from '../lib/readOnlyCaret'
import { noteKeys, noteOverrides } from './noteKeys'

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

/**
 * The view-action rows. Select all is ProseMirror's own: the note's text, never the page around it (YAZ-3127).
 * Their keys are the rows' now (YAZ-3564 K4), as the note's keymaps bind them.
 */
const VIEW_ACTIONS = ['note.foldAll', 'note.unfoldAll', 'note.foldHere', 'note.unfoldHere', 'note.zoomIn', 'note.zoomOut', 'note.undo', 'note.selectAll']

/** The keys that move the caret (YAZ-4433), with any modifier: the note's keymaps first, else the browser's own move. */
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * Draws the whole body again from the document (YAZ-4433): the one DOM change `beforeinput` cannot cancel is an IME
 * composition, and a non-editable view never reads DOM changes back. ProseMirror's own repair of a DOM change is the
 * same: mark its view tree dirty, then update (`NODE_DIRTY` = 3 rebuilds the tree and drops any node it did not draw).
 */
function redrawFromDoc(view: EditorView): void {
  ;(view as unknown as { docView: { dirty: number } }).docView.dirty = 3
  view.updateState(view.state)
}

/** A locked body cancels the event: it would change the DOM or the clipboard's source, never the note. */
const refuse = (view: EditorView, event: Event): boolean => {
  if (view.editable) return false
  event.preventDefault()
  return true
}

/** Whether a keydown is one of the view-action keys — matched the way the keymaps match them. */
const viewActionMatcher = (ctx: Ctx): ((view: EditorView, event: KeyboardEvent) => boolean) => {
  const overrides = noteOverrides(ctx)
  return keydownHandler(Object.fromEntries(VIEW_ACTIONS.flatMap((id) => noteKeys(id, overrides)).map((key) => [key, yes])))
}

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

/** The editor's selection follows the DOM caret, when the reader moved it elsewhere: there is where "at the caret" means. */
function followCaret(view: EditorView, caret: { anchor: number; head: number } | null): void {
  const { selection } = view.state
  if (caret === null || (selection.anchor === caret.anchor && selection.head === caret.head)) return
  view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(caret.anchor), view.state.doc.resolve(caret.head))).setMeta('addToHistory', false))
}

/** A transaction that changes the document is dropped: a locked note moves its caret, folds and zooms, never edits. */
const viewOnly =
  (dispatch: (tr: Transaction) => void) =>
  (tr: Transaction): void => {
    if (!tr.docChanged) dispatch(tr)
  }

/** This note is the one the reader is in: visible, and the focus on `<body>` or inside its own section. */
function holdsReader(view: EditorView): boolean {
  const doc = view.dom.ownerDocument
  if (!isShown(view.dom)) return false
  const active = doc.activeElement
  if (active === null || active === doc.body || view.dom.contains(active)) return true
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
  (ctx) =>
    new Plugin({
      key: new PluginKey('mdapp-read-only-keys'),
      props: {
        // Every native edit of a locked body, before the DOM changes (YAZ-4433). Paste and cut stop at their own
        // event, as before the caret: ⌘X copies nothing in read only, and ⌘C (`copy`) stays ProseMirror's.
        handleDOMEvents: {
          beforeinput: refuse,
          paste: refuse,
          cut: refuse,
          // Tab indents in a normal note, so it never takes the focus out of the body. In a table cell Tab / ⇧Tab go to
          // the next / previous cell, as in a normal note, but straight to the table's own move: a cell bullet's
          // indent (the note's Tab before the table's) never runs, and the last cell adds no row (YAZ-4433).
          keydown: (view, event) => {
            if (event.key !== 'Tab' || !refuse(view, event)) return false
            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
              followCaret(view, domCaret(view))
              goToNextCell(event.shiftKey ? -1 : 1)(view.state, viewOnly(view.dispatch))
            }
            return true
          },
          input: (view) => {
            if (view.editable) return false
            redrawFromDoc(view)
            return true
          },
        },
      },
      view: (view) => {
        const isViewAction = viewActionMatcher(ctx)
        // A read-only body holds the keyboard itself (YAZ-3127): focusable while it is not editable, so
        // a click in it puts the focus there and the window's chrome keys leave it alone. And it has the caret
        // (YAZ-4433): `contenteditable="true"` for the browser, `data-read-only` for the CSS and the window's key
        // rules, no spellcheck marks. ProseMirror writes `contenteditable` only when its own value changes, and
        // again on a rebuild, so this runs after each update; an editable note pays one boolean.
        let locked = false
        const focusable = (): void => {
          if (view.editable) {
            if (!locked) return
            locked = false
            for (const name of ['tabindex', 'data-read-only', 'spellcheck']) view.dom.removeAttribute(name)
            return
          }
          if (!locked) {
            locked = true
            view.dom.setAttribute('tabindex', '-1')
            view.dom.setAttribute('data-read-only', 'true')
            view.dom.setAttribute('spellcheck', 'false')
          }
          if (view.dom.getAttribute('contenteditable') !== 'true') view.dom.setAttribute('contenteditable', 'true')
        }
        focusable()
        // Every "give the focus back to the note" call goes through `view.focus` (YAZ-3130).
        const ownFocus = Object.prototype.hasOwnProperty.call(view, 'focus')
        const focus = view.focus.bind(view)
        view.focus = () => focusReadOnlyBody(view, focus)
        const onKeyDown = (event: KeyboardEvent): void => {
          if (view.editable || event.defaultPrevented) return
          const navigation = NAVIGATION_KEYS.has(event.key)
          if ((!navigation && !isViewAction(view, event)) || !holdsReader(view)) return
          // The reader is in this note: the focus is in its body (YAZ-3127), or on `<body>` with their
          // DOM selection here. With the focus in the body the editor's own selection stands, even when
          // the DOM has none left. A caret key moves only a caret in the body, never one in the title around it.
          const caret = domCaret(view)
          const inBody = view.dom.contains(view.dom.ownerDocument.activeElement)
          if (caret === null && !inBody && (navigation || !inOwnPage(view))) return
          // ProseMirror draws a non-editable view's selection only where a DOM selection already is
          // (`editorOwnsSelection`), so the body takes the focus with the editor's own selection
          // drawn first (`focusReadOnlyBody`): then ⌘A shows, and the next key starts in the note.
          if (caret === null) view.focus()
          // The caret the reader clicked is where "at the caret" means.
          followCaret(view, caret)
          const dispatch = view.dispatch
          view.dispatch = viewOnly(dispatch)
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
            for (const name of ['tabindex', 'data-read-only', 'spellcheck']) view.dom.removeAttribute(name)
            if (!view.editable) view.dom.setAttribute('contenteditable', 'false')
            if (ownFocus) view.focus = focus
            else delete (view as { focus?: () => void }).focus
          },
        }
      },
    }),
)
