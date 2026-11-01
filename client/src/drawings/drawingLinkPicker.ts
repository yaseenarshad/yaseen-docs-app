/**
 * The `[[` picker in a drawing's text box (YAZ-4039 D12): the note's picker rows (`rowsFor`, the one matcher of
 * `links/completion.ts`) in the note's popup look (`.wikilink-picker`), at the caret of the engine's text editor. A pick
 * writes the row's link, `[[ID]]` for a page with an ID (YAZ-2293), and the caret goes after it.
 *
 * As in a note: only typing opens it (YAZ-908), ↑ ↓ move, Enter picks, Esc closes it for that `[[` and leaves the typed
 * text, and a `|` closes it. No Create row: a missing page is made by the first open of its link (the follower), as a
 * dead link in a note is.
 *
 * Per keystroke it costs one look for `[[` before the caret while it is closed; the caret's box is read only to place
 * the open popup.
 */
import type { LinkCandidate } from '../links/completion'
import { trailingLinkFragment } from '../links/completion'
import { WIKILINK_PICKER_CLASS, WIKILINK_PICKER_ITEM_CLASS, rowsFor, type PickerRow } from '../editor/wikilink/wikilinkPicker'

/** The engine's `HostTextEditor`. */
export interface PickerEditor {
  text: string
  caret: number
  typed: boolean
  caretRect: () => { left: number; top: number; right: number; bottom: number }
  replace: (start: number, end: number, text: string) => void
}

interface Session {
  editor: PickerEditor
  /** Where the `[[` starts. */
  from: number
  fragment: string
  rows: PickerRow[]
  selected: number
}

export function createDrawingLinkPicker(parent: () => HTMLElement | null, candidates: () => readonly LinkCandidate[]) {
  let session: Session | null = null
  /** The `[[` that Esc closed: it stays closed until the caret leaves it. */
  let dismissed: number | null = null
  const element = document.createElement('div')
  element.className = WIKILINK_PICKER_CLASS
  element.setAttribute('role', 'listbox')
  element.setAttribute('aria-label', 'Link suggestions')
  element.dataset.show = 'true'
  element.style.position = 'fixed'

  const close = () => {
    session = null
    element.remove()
  }
  const pick = (row: PickerRow) => {
    const now = session
    if (now === null) return
    close()
    now.editor.replace(now.from, now.editor.caret, `[[${row.insert}]]`)
  }
  const render = () => {
    const now = session
    if (now === null) return
    element.replaceChildren(
      ...now.rows.map((row, index) => {
        const item = document.createElement('button')
        item.type = 'button'
        item.setAttribute('role', 'option')
        item.className = WIKILINK_PICKER_ITEM_CLASS
        item.setAttribute('aria-selected', String(index === now.selected))
        item.textContent = row.label
        // The text editor keeps the caret: a pick never blurs it.
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => pick(row))
        return item
      }),
    )
    if (element.parentElement === null) parent()?.appendChild(element)
    const caret = now.editor.caretRect()
    element.style.left = `${caret.left}px`
    element.style.top = `${caret.bottom + 4}px`
  }

  return {
    /** The engine's `onEditorChange`. */
    change(editor: PickerEditor | null) {
      const before = editor === null ? '' : editor.text.slice(0, editor.caret)
      const fragment = before.includes('[[') ? trailingLinkFragment(before) : null
      if (editor === null || fragment === null || fragment.includes('|')) {
        dismissed = null
        close()
        return
      }
      const from = editor.caret - fragment.length - 2
      if (from === dismissed || (session === null && !editor.typed)) return
      const rows = rowsFor(fragment, candidates()).filter((row) => !row.create)
      if (rows.length === 0) {
        close()
        return
      }
      const held = session !== null && session.from === from && session.fragment === fragment ? Math.min(session.selected, rows.length - 1) : 0
      session = { editor, from, fragment, rows, selected: held }
      render()
    },
    /** The engine's `onEditorKeyDown`: true when the open picker took the key. */
    keyDown(event: KeyboardEvent): boolean {
      const now = session
      if (now === null || event.isComposing) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        now.selected = (now.selected + (event.key === 'ArrowDown' ? 1 : -1) + now.rows.length) % now.rows.length
        render()
        return true
      }
      if (event.key === 'Enter') {
        pick(now.rows[now.selected]!)
        return true
      }
      if (event.key === 'Escape') {
        dismissed = now.from
        close()
        return true
      }
      return false
    },
    close,
  }
}
