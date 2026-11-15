/**
 * The `[[` picker in a drawing's text box (YAZ-4039 D12): the note's picker rows (`rowsFor`, the one matcher of
 * `links/completion.ts`) in the note's popup look (`.wikilink-picker`), at the caret of the engine's text editor. A pick
 * writes the row's link, `[[ID]]` for a page with an ID (YAZ-2293), and the caret goes after it.
 *
 * As in a note: only typing opens it (YAZ-908), ↑ ↓ move, Enter picks, Esc closes it for that `[[` and leaves the typed
 * text, and a `|` closes it. While no row has the typed name, a Create row makes the page at the pick (YAZ-1357 🔒 D3
 * revised, `createLinkedPage`) and links it by the ID it is born with.
 *
 * Per keystroke it costs one look for `[[` before the caret while it is closed; the caret's box is read only to place
 * the open popup.
 */
import { api } from '../api'
import type { LinkCandidate } from '../links/completion'
import { trailingLinkFragment } from '../links/completion'
import { createFromLink } from '../editor/wikilink/createFromLink'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import { linkPageName, type LinkLook, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { WIKILINK_PICKER_CLASS, WIKILINK_PICKER_CREATE_CLASS, WIKILINK_PICKER_ITEM_CLASS, addRowIcon, rowsFor, type PickerRow } from '../editor/wikilink/wikilinkPicker'

/** The engine's `HostTextEditorState`. */
export interface PickerEditor {
  text: string
  caret: number
  typed: boolean
  caretRect: () => { left: number; top: number; right: number; bottom: number }
  replace: (start: number, end: number, text: string) => void
  /** Puts text in place of a link, also after the editor closed; true when the link was there. */
  replaceLink: (raw: string, text: string) => boolean
}

interface Session {
  editor: PickerEditor
  /** Where the `[[` starts. */
  from: number
  fragment: string
  rows: PickerRow[]
  selected: number
}

/**
 * A Create row's page (YAZ-1357 🔒 D3 revised), in the note's order (`createPage` of `wikilinkPicker.ts`, YAZ-2677 S35):
 * where the vault uses IDs, the NUMBER first, from main's door; then the link, `[[ID]]` where the typed name stands; then
 * the note, born with that ID. A step that fails leaves a link that reads: no number, and the link stays the typed
 * name; no note, and the link gets its typed name back. The link was written at the pick as `[[name]]`, so what the
 * user types meanwhile lands after it.
 */
export async function createLinkedPage(editor: PickerEditor, name: string, links: WikilinkResolveSource, nav: WikilinkNav): Promise<void> {
  const page = name.split('#', 1)[0]!
  const rest = name.slice(page.length)
  let id: string | undefined
  let linked = false
  let numbered = links.ids
  if (links.ids && linkPageName(name) !== '') {
    const given = await api.mintNoteId(nav.root).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    if (given instanceof Error) return nav.onNotice(`Can't create "${linkPageName(name)}": ${given.message}`)
    // `null`: the vault stopped using IDs. The page is made the plain way, and the link holds its name.
    if (given === null) numbered = false
    else {
      id = given
      linked = editor.replaceLink(`[[${name}]]`, `[[${given}${rest}]]`)
    }
  }
  const result = await createFromLink(nav.root, name, numbered, nav.createFolder(), id)
  if (result.status === 'created') return nav.onNotice(`Created "${linkPageName(name)}"`)
  if (result.status === 'error') nav.onNotice(result.message)
  if (linked) editor.replaceLink(`[[${id}${rest}]]`, `[[${name}]]`)
}

/**
 * `create`: a Create row's page is made (`createLinkedPage`); absent, no Create row (no vault to make it in). `look`: the
 * rows' file icons, as the note's picker shows them. `onShow`: the picker opened or closed (YAZ-4748: a diagram's frame
 * sends the picker's keys up only while it is open).
 */
export function createDrawingLinkPicker(parent: () => HTMLElement | null, candidates: () => readonly LinkCandidate[], create?: (editor: PickerEditor, name: string) => void, look?: LinkLook, onShow?: (open: boolean) => void) {
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
    const open = session !== null
    session = null
    element.remove()
    if (open) onShow?.(false)
  }
  const pick = (row: PickerRow) => {
    const now = session
    if (now === null) return
    close()
    now.editor.replace(now.from, now.editor.caret, `[[${row.insert}]]`)
    if (row.create) create?.(now.editor, row.insert)
  }
  const render = () => {
    const now = session
    if (now === null) return
    element.replaceChildren(
      ...now.rows.map((row, index) => {
        const item = document.createElement('button')
        item.type = 'button'
        item.setAttribute('role', 'option')
        item.className = row.create ? `${WIKILINK_PICKER_ITEM_CLASS} ${WIKILINK_PICKER_CREATE_CLASS}` : WIKILINK_PICKER_ITEM_CLASS
        item.setAttribute('aria-selected', String(index === now.selected))
        item.textContent = row.create ? `Create "${row.label}"` : row.label
        if (!row.create && row.path !== undefined && look !== undefined) addRowIcon(item, row.path, look)
        // The text editor keeps the caret: a pick never blurs it.
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => pick(row))
        return item
      }),
    )
    if (element.parentElement === null) {
      parent()?.appendChild(element)
      onShow?.(true)
    }
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
      const rows = rowsFor(fragment, candidates()).filter((row) => !row.create || create !== undefined)
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
