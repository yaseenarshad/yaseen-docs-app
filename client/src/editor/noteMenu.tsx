/**
 * A note's own right-click menu (YAZ-3653): the rows of the native text menu — the spelling
 * suggestions, Cut, Copy, Copy as ▸, Paste, Paste as ▸ — drawn by the app's `ContextMenu`, so a
 * note's menu has the look of the tab and sidebar menus. A right-click on an image keeps the native
 * image menu (Copy Image, Reveal in Finder). Each clipboard row first gives the focus back to what
 * held it (the note, or a code block in it), then asks main to run the row on this window
 * (`menu.edit`), as the native menu's roles do. A suggestion replaces the word in the note itself,
 * so ⌘Z undoes it like typing. A right-click a link's own menu took (the one link menu, YAZ-3609 D23) opens
 * only that menu. With words selected, "Add link…" opens the link box on them (YAZ-3609 D17). Copy as › Without folded lines with the selection inside one line
 * copies the bullet under the pointer: its line and the lines you see under it.
 */
import { useEffect, useState } from 'react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { NoteMenuAction } from '@shared/types'
import { api } from '../api'
import { bulletToCopy, copyVisibleNext, forgetCopyVisible } from './clipboardCopyOut'
import { addLinkOn } from './markdownLink'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'

/** The misspelled word under the pointer: its document range and the spellchecker's first guesses. */
export interface Misspelling {
  word: string
  from: number
  to: number
  suggestions: readonly string[]
}

/** As many guesses as the native menu shows. */
const MAX_SUGGESTIONS = 5
/** A word: letters, with inner apostrophes ("don't"), never one at either end. */
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu

/** The misspelled word at (`x`, `y`), or null: no word there, a word in code, or a word spelled right. */
export function misspellingAt(view: EditorView, x: number, y: number, suggest: (word: string) => string[] | null): Misspelling | null {
  const at = view.posAtCoords({ left: x, top: y })
  if (at === null) return null
  const $pos = view.state.doc.resolve(at.pos)
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code === true) return null
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼')
  for (const match of text.matchAll(WORD)) {
    const start = match.index
    const end = start + match[0].length
    if ($pos.parentOffset < start || $pos.parentOffset > end) continue
    const suggestions = suggest(match[0])
    return suggestions === null ? null : { word: match[0], from: $pos.start() + start, to: $pos.start() + end, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) }
  }
  return null
}

/**
 * Whether nothing is selected: in the note's state and on the page. A right-click can select the word
 * under the pointer on the page before the note reads it, and Cut and Copy act on the page's.
 */
const nothingSelected = (view: EditorView): boolean => {
  const page = view.dom.ownerDocument.getSelection()
  return view.state.selection.empty && (page === null || page.isCollapsed || !view.dom.contains(page.anchorNode))
}

/** The selected words' range: the note's selection, or the page's when the note has not read it yet (see `nothingSelected`). */
function selectedWords(view: EditorView): { from: number; to: number } {
  const { from, to } = view.state.selection
  const page = view.dom.ownerDocument.getSelection()
  if (from < to || page === null || page.isCollapsed || page.anchorNode === null || page.focusNode === null || !view.dom.contains(page.anchorNode) || !view.dom.contains(page.focusNode)) return { from, to }
  try {
    const a = view.posAtDOM(page.anchorNode, page.anchorOffset)
    const b = view.posAtDOM(page.focusNode, page.focusOffset)
    return { from: Math.min(a, b), to: Math.max(a, b) }
  } catch {
    return { from, to }
  }
}

/**
 * The rows, as data: the spelling group (only on a misspelled word), then the copy group, then the
 * paste group. A row that cannot act is shown but inert, as the native menu greys it: Cut and the
 * copies with no selection, Cut and the pastes in a read-only note. Without folded lines stays on in
 * a bullet (`pointer`, the document position right-clicked): it copies that bullet.
 */
export function noteMenuSections(view: EditorView, misspelling: Misspelling | null, run: (action: NoteMenuAction, word?: string) => void, pointer: number | null = null): MenuSection[] {
  const editable = view.editable
  const empty = nothingSelected(view)
  const inBullet = pointer !== null && bulletToCopy(view.state, pointer) !== null
  // The words the menu opened on: Add link… links them, wherever the selection is after the menu closes.
  const words = selectedWords(view)
  const replace = (from: number, to: number, word: string) => () => {
    // The note may have changed since the right-click (a reload, another window): then the word is not there to replace.
    if (view.state.doc.textBetween(from, to) === misspelling?.word) view.dispatch(view.state.tr.insertText(word, from, to))
    view.focus()
  }
  const spelling: MenuSection =
    misspelling === null
      ? []
      : [
          ...(misspelling.suggestions.length === 0
            ? [{ id: 'no-guesses', label: 'No guesses found', disabled: true, onSelect: () => undefined }]
            : misspelling.suggestions.map((word, index) => ({ id: `guess-${index}`, label: word, disabled: !editable, onSelect: replace(misspelling.from, misspelling.to, word) }))),
          { id: 'add-word', label: 'Add to dictionary', onSelect: () => run('add-word', misspelling.word) },
        ]
  return [
    spelling,
    [
      { id: 'cut', label: 'Cut', hint: '⌘X', disabled: empty || !editable, onSelect: () => run('cut') },
      { id: 'copy', label: 'Copy', hint: '⌘C', disabled: empty, onSelect: () => run('copy') },
      {
        id: 'copy-as',
        label: 'Copy as',
        children: [
          [
            { id: 'copy-plain', label: 'Plain text', disabled: empty, onSelect: () => run('copy-plain') },
            { id: 'copy-markdown', label: 'Markdown', disabled: empty, onSelect: () => run('copy-markdown') },
          ],
          [{ id: 'copy-visible', label: 'Without folded lines', disabled: empty && !inBullet, onSelect: () => run('copy-visible') }],
        ],
      },
    ],
    [
      { id: 'paste', label: 'Paste', hint: '⌘V', disabled: !editable, onSelect: () => run('paste') },
      {
        id: 'paste-as',
        label: 'Paste as',
        children: [
          [
            { id: 'paste-plain', label: 'Plain text', hint: '⇧⌘V', disabled: !editable, onSelect: () => run('paste-plain') },
            { id: 'paste-markdown', label: 'Markdown', disabled: !editable, onSelect: () => run('paste-markdown') },
          ],
        ],
      },
    ],
    // Selected words can become a link (YAZ-3609 D17): a web address or a path. Only where the note can change.
    // After the menu closes and gives the note its focus back, so the link box keeps the focus it takes.
    empty || !editable ? [] : [{ id: 'add-link', label: 'Add link…', onSelect: () => void window.setTimeout(() => addLinkOn(view, words)) }],
  ]
}

interface OpenMenu {
  x: number
  y: number
  misspelling: Misspelling | null
  /** The document position right-clicked, and the document it is in: a bullet there is Without folded lines' copy. */
  pointer: number | null
  doc: EditorView['state']['doc']
  /** What held the focus at the right-click: the note, or a code block inside it. */
  focused: HTMLElement | null
}

/** The menu for `view`'s note: a right-click in the note opens it; nothing renders while it is shut. */
export function NoteMenu({ view }: { view: EditorView | null }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  useEffect(() => {
    if (view === null) return
    const onContextMenu = (event: MouseEvent) => {
      // A link's own menu (`markdownLink.ts`, `wikilinkMenu.ts`) has claimed it first; an image keeps the native menu.
      if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('img') !== null) return
      event.preventDefault()
      const active = document.activeElement
      setMenu({
        x: event.clientX,
        y: event.clientY,
        misspelling: misspellingAt(view, event.clientX, event.clientY, (word) => api.spell.suggestions(word)),
        pointer: view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null,
        doc: view.state.doc,
        focused: active instanceof HTMLElement && view.dom.contains(active) ? active : null,
      })
    }
    view.dom.addEventListener('contextmenu', onContextMenu)
    return () => view.dom.removeEventListener('contextmenu', onContextMenu)
  }, [view])
  if (view === null || menu === null) return null
  const refocus = () => (menu.focused ?? view.dom).focus()
  const run = (action: NoteMenuAction, word?: string) => {
    refocus()
    // After the focus is back, so the bullet is checked against the selection the copy will see.
    const bullet = action === 'copy-visible' && menu.pointer !== null && menu.doc === view.state.doc ? bulletToCopy(view.state, menu.pointer) : null
    if (bullet !== null) copyVisibleNext(view, bullet)
    api.menu.edit(action, word).catch((error: unknown) => {
      if (bullet !== null) forgetCopyVisible(view)
      console.error('Menu action failed', error)
    })
  }
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      sections={noteMenuSections(view, menu.misspelling, run, menu.doc === view.state.doc ? menu.pointer : null)}
      onClose={() => {
        setMenu(null)
        refocus()
      }}
    />
  )
}
