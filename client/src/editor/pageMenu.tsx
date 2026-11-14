/**
 * A page's own right-click menu (YAZ-3653): the rows of the native text menu — the spelling
 * suggestions, Cut, Copy, Copy as ▸, Paste, Paste as ▸ — drawn by the app's `ContextMenu`, so a
 * page's menu has the look of the tab and sidebar menus. A right-click on an image shows the image's
 * rows instead, the native image menu's (Copy image, Reveal in Finder; YAZ-3727 D22). A fold chevron's is the line's menu, as
 * on its text (D23: Collapse all and Expand all are line rows, `outline/foldAllRows.ts`). Each clipboard row first gives the focus back to what
 * held it (the page, or a code block in it), then asks main to run the row on this window
 * (`menu.edit`), as the native menu's roles do. A suggestion replaces the word in the page itself,
 * so ⌘Z undoes it like typing. A right-click in a table cell adds the Table part after the paste rows (YAZ-3769, `table/tableMenu.ts`). A right-click a link's own menu took (the one link menu, YAZ-3609 D23) opens
 * only that menu. With words selected, "Add link…" opens the link box on them (YAZ-3609 D17). Copy as › Without folded lines with the selection inside one line
 * copies the bullet under the pointer: its line and the lines you see under it. On a line's text, the bullet menu's
 * rows for that line come after the spelling rows (YAZ-3727 D15): Open in new tab, the Turn into strip and the
 * children rows, from the same list of rows (`blockMenuItems`), so a right-click on the text and one on the dot agree.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { PageMenuAction, PageMenuArg } from '@shared/types'
import { createSpellWait } from '@shared/spelling'
import { api } from '../api'
import { blockMenuItems } from './blockHandleMenu'
import { textLineTarget } from './blockHandleTarget'
import { bulletToCopy, copyVisibleNext, forgetCopyVisible } from './clipboardCopyOut'
import { addLinkOn } from './markdownLink'
import { HEADING_TOGGLE_CLASS } from './outline/headingFolding'
import { OUTLINE_TOGGLE_CLASS } from './outline/outlineFolding'
import { CellSelection, isInTable } from '@milkdown/kit/prose/tables'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { CELL_NOTE_ASK, type CellNoteAsk } from './table/cellNoteGuard'
import { TABLE_HANDLE_MENU, handleKind, tableMenuSections, type TableMenuKind } from './table/tableMenu'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuEntry, MenuSection } from '../sidebar/menuSections'

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

/** The word at (`x`, `y`) and its document range, or null: no word there, or a word in code. */
export function wordAt(view: EditorView, x: number, y: number): Omit<Misspelling, 'suggestions'> | null {
  const at = view.posAtCoords({ left: x, top: y })
  if (at === null) return null
  const $pos = view.state.doc.resolve(at.pos)
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code === true) return null
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼')
  for (const match of text.matchAll(WORD)) {
    const start = match.index
    const end = start + match[0].length
    if ($pos.parentOffset < start || $pos.parentOffset > end) continue
    return { word: match[0], from: $pos.start() + start, to: $pos.start() + end }
  }
  return null
}

/** `word` (from `wordAt`) with its guesses, or null when it is spelled right. */
export async function misspellingOf(word: Omit<Misspelling, 'suggestions'>, suggest: (word: string) => Promise<string[] | null>): Promise<Misspelling | null> {
  const suggestions = await suggest(word.word)
  return suggestions === null ? null : { ...word, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) }
}

/** A right-click's wait for its guesses (YAZ-4464 D2, idea 8; `createSpellWait`). One for the window: a new one in the tests. */
let spellWait = createSpellWait()
/** For the tests: a new session, whose next right-click waits the first ask's time. */
export const resetSpellWait = () => {
  spellWait = createSpellWait()
}

/** A bullet-menu glyph, an SVG element its row makes, as React draws it: the same markup. */
function glyphOf(make: () => SVGElement): ReactNode {
  const svg = make()
  const attrs = Object.fromEntries([...svg.attributes].map(({ name, value }) => [name === 'class' ? 'className' : /^(aria|data)-/.test(name) ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), value]))
  return <svg {...attrs} dangerouslySetInnerHTML={{ __html: svg.innerHTML }} />
}

/**
 * The line part (YAZ-3727 D15): the bullet menu's rows for the line right-clicked at `pointer`, one section
 * per group as on the dot. `selection` is the page's selection from before the right-click, which may
 * have selected the word under the pointer: the strip reads a highlight from it. None off a line's text
 * (code, a table cell). A row does nothing once the page has changed under the open menu. Hints are keys
 * (Collapse all's ⌘⇧U); no row names a click on the dot (D17, D20).
 */
export function lineSections(view: EditorView, pointer: number | null, selection: Selection): MenuEntry[][] {
  const target = pointer === null ? null : textLineTarget(view.state.doc, pointer, selection)
  if (target === null) return []
  const doc = view.state.doc
  const guarded = (run: () => void) => () => {
    if (view.state.doc === doc) run()
  }
  const sections: MenuEntry[][] = []
  let group: string | undefined
  blockMenuItems(view, target).forEach((item, index) => {
    if (sections.length === 0 || item.group !== group) sections.push([])
    group = item.group
    const id = `line-${index}`
    sections[sections.length - 1].push(
      item.kind === 'strip'
        ? { kind: 'strip', id, label: item.label, buttons: item.buttons.map((b) => ({ label: b.label, icon: glyphOf(b.icon), active: b.active, onSelect: guarded(b.run) })) }
        : { id, label: item.label, hint: item.hint, danger: item.danger, disabled: item.disabled, icon: item.icon && glyphOf(item.icon), onSelect: guarded(item.run) },
    )
  })
  return sections
}

/**
 * Whether nothing is selected: in the page's state and on the page. A right-click can select the word
 * under the pointer on the page before the page reads it, and Cut and Copy act on the page's.
 */
const nothingSelected = (view: EditorView): boolean => {
  const page = view.dom.ownerDocument.getSelection()
  return view.state.selection.empty && (page === null || page.isCollapsed || !view.dom.contains(page.anchorNode))
}

/** The selected words' range: the page's selection, or the page's when the page has not read it yet (see `nothingSelected`). */
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
 * paste group. The menu puts the line part (`lineSections`, D15) after the spelling group. A row that cannot act is shown but inert, as the native menu greys it: Cut and the
 * copies with no selection, Cut and the pastes in a read-only page. Without folded lines stays on in
 * a bullet (`pointer`, the document position right-clicked): it copies that bullet.
 */
/**
 * `reading` (the explore stack's reading layer, YAZ-2571 round 1): the page cannot change, so the rows that would
 * change it are left out instead of greyed: Cut, Paste and Paste as. Copy and Copy as stay.
 */
/**
 * `table` (YAZ-4970): what a table menu opened on, a cell (a right-click) or a row or column handle (`handleKind`). In a
 * table the copy and paste rows stand in one group, and the Table part shows only what applies to it.
 */
export function pageMenuSections(view: EditorView, misspelling: Misspelling | null, run: (action: PageMenuAction, word?: string) => void, pointer: number | null = null, reading = false, table: TableMenuKind = 'cells'): MenuSection[] {
  const editable = view.editable
  const empty = nothingSelected(view)
  const inBullet = pointer !== null && bulletToCopy(view.state, pointer) !== null
  // Paste as › Cells only (YAZ-4206 D18) pastes at the selection: only in a table.
  const inTable = isInTable(view.state)
  // The words the menu opened on: Add link… links them, wherever the selection is after the menu closes.
  const words = selectedWords(view)
  const replace = (from: number, to: number, word: string) => () => {
    // The page may have changed since the right-click (a reload, another window): then the word is not there to replace.
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
  // The Table part (YAZ-3769 D5): a right-click in a cell of an editable page.
  const tableSections = tableMenuSections(view, pointer, table)
  const copyRows: MenuSection = [
      ...(reading ? [] : [{ id: 'cut', label: 'Cut', hint: '⌘X', disabled: empty || !editable, onSelect: () => run('cut') }]),
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
    ]
  const pasteRows: MenuSection = reading ? [] : [
      { id: 'paste', label: 'Paste', hint: '⌘V', disabled: !editable, onSelect: () => run('paste') },
      {
        id: 'paste-as',
        label: 'Paste as',
        children: [
          [
            { id: 'paste-plain', label: 'Plain text', hint: '⇧⌘V', disabled: !editable, onSelect: () => run('paste-plain') },
            { id: 'paste-markdown', label: 'Markdown', disabled: !editable, onSelect: () => run('paste-markdown') },
          ],
          // YAZ-4206 D18: a table's cells with no cell notes; only in a table.
          [{ id: 'paste-cells', label: 'Cells only', disabled: !editable || !inTable, onSelect: () => run('paste-cells') }],
        ],
      },
    ]
  // YAZ-4970: in a table, Cut, Copy, Paste, then Copy as › and Paste as ›, in one group.
  const leaves = (rows: MenuSection) => rows.filter((row) => row.children === undefined)
  const parents = (rows: MenuSection) => rows.filter((row) => row.children !== undefined)
  const clipboard: MenuSection[] = tableSections.length === 0 ? [copyRows, pasteRows] : [[...leaves(copyRows), ...leaves(pasteRows), ...parents(copyRows), ...parents(pasteRows)]]
  // Selected words can become a link (YAZ-3609 D17): a web address or a path. Only where the page can change. Selected
  // cells are not words (YAZ-4970: a row or column handle selects its cells).
  const noWords = empty || view.state.selection instanceof CellSelection
  return [
    spelling,
    ...clipboard,
    ...tableSections,
    // After the menu closes and gives the page its focus back, so the link box keeps the focus it takes.
    noWords || !editable ? [] : [{ id: 'add-link', label: 'Add link…', onSelect: () => void window.setTimeout(() => addLinkOn(view, words)) }],
  ]
}

/**
 * An image's rows (YAZ-3727 D22), as the native image menu had them: main copies the image at the point
 * right-clicked (`x`, `y`, page px), and reveals a vault image's file; any other image has no file, so its
 * Reveal is inert.
 */
export function imageMenuSections(image: { src: string; x: number; y: number }, run: (action: PageMenuAction, arg?: PageMenuArg) => void): MenuSection[] {
  return [
    [
      { id: 'copy-image', label: 'Copy image', onSelect: () => run('copy-image', { x: image.x, y: image.y }) },
      { id: 'reveal-image', label: 'Reveal in Finder', disabled: !image.src.startsWith('app://vault/'), onSelect: () => run('reveal-image', image.src) },
    ],
  ]
}

interface OpenMenu {
  x: number
  y: number
  /** The image right-clicked, by its `src` as loaded: then the menu is its rows only (D22). */
  image: string | null
  misspelling: Misspelling | null
  /** The document position right-clicked, and the document it is in: a bullet there is Without folded lines' copy. */
  pointer: number | null
  doc: EditorView['state']['doc']
  /** The page's selection from before the right-click (D15). */
  selection: Selection
  /** What held the focus at the right-click: the page, or a code block inside it. */
  focused: HTMLElement | null
  /** What a table menu opened on (YAZ-4970): a cell, or the row or column a handle selected. */
  table: TableMenuKind
}

export { TABLE_HANDLE_MENU }

/**
 * The document position right-clicked. A fold arrow is read from its own widget (6B1): it sits left of the text box,
 * where `posAtCoords` finds no line.
 */
function pointerPos(view: EditorView, target: Element, x: number, y: number): number | null {
  const arrow = target.closest(`.${OUTLINE_TOGGLE_CLASS}, .${HEADING_TOGGLE_CLASS}`)
  if (arrow !== null && view.dom.contains(arrow)) return view.posAtDOM(arrow, 0)
  return view.posAtCoords({ left: x, top: y })?.pos ?? null
}

/**
 * The menu for `view`'s page: a right-click in the page, or a table handle, opens it; nothing renders while it is shut.
 * It also answers the editor's asks about cell notes (YAZ-4206 D16, D17; `cellNoteGuard.ts`) with the app's sheet.
 */
/**
 * `extra` (the explore stack, YAZ-2571 round 1): sections after the text menu's, under a line — the page menu of the
 * layer's page; built at each open. `reading`: the layer reads, so Cut and Paste are left out (`pageMenuSections`).
 */
export function PageMenu({ view, extra, reading = false }: { view: EditorView | null; extra?: () => MenuSection[]; reading?: boolean }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [ask, setAsk] = useState<CellNoteAsk | null>(null)
  useEffect(() => {
    if (view === null) return
    const onAsk = (event: Event) => {
      event.preventDefault()
      setAsk((event as CustomEvent<CellNoteAsk>).detail)
    }
    view.dom.addEventListener(CELL_NOTE_ASK, onAsk)
    return () => view.dom.removeEventListener(CELL_NOTE_ASK, onAsk)
  }, [view])
  useEffect(() => {
    if (view === null) return
    // The selection before a right press (D15): the press can select the word under the pointer before the menu opens.
    let pressed: { doc: EditorView['state']['doc']; selection: Selection } | null = null
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2 || event.ctrlKey) pressed = { doc: view.state.doc, selection: view.state.selection }
    }
    // Only the latest right-click opens a menu: an earlier one still waiting for its guesses opens nothing.
    let latest = 0
    const onContextMenu = (event: MouseEvent) => {
      const before = pressed !== null && pressed.doc === view.state.doc ? pressed.selection : view.state.selection
      pressed = null
      // A link's own menu (`markdownLink.ts`, `wikilinkMenu.ts`) has claimed it first.
      if (event.defaultPrevented || !(event.target instanceof Element)) return
      event.preventDefault()
      const active = document.activeElement
      const image = event.target.closest('img')
      const doc = view.state.doc
      const pointer = pointerPos(view, event.target, event.clientX, event.clientY)
      const ask = ++latest
      const open = (misspelling: Misspelling | null) => {
        // The page changed while the menu waited: its rows would act on old text.
        if (ask !== latest || view.state.doc !== doc) return
        setMenu({
          x: event.clientX,
          y: event.clientY,
          image: image === null ? null : image.currentSrc || image.src,
          misspelling,
          pointer,
          doc,
          selection: before,
          focused: active instanceof HTMLElement && view.dom.contains(active) ? active : null,
          table: 'cells',
        })
      }
      const word = image === null ? wordAt(view, event.clientX, event.clientY) : null
      if (word === null) return open(null)
      // YAZ-4464 D2: wait for the guesses, up to a limit; then open without them. A click or a key
      // anywhere during the wait means the person moved on: that menu opens nothing (S9).
      const moved = () => {
        if (latest === ask) latest++
      }
      window.addEventListener('pointerdown', moved, true)
      window.addEventListener('keydown', moved, true)
      void spellWait(misspellingOf(word, (w) => api.spell.suggestions(w))).then((misspelling) => {
        window.removeEventListener('pointerdown', moved, true)
        window.removeEventListener('keydown', moved, true)
        open(misspelling)
      })
    }
    // A table's row or column handle (YAZ-3820): it selected its cells, and asks for this menu as a
    // right-click in `pos`, a cell of its row or column (the vendored table block, `operation.ts`).
    const onHandleMenu = (event: Event) => {
      const { x, y, pos } = (event as CustomEvent<{ x: number; y: number; pos: number }>).detail
      const active = document.activeElement
      // YAZ-4970: the row or column the handle selected names the menu: row actions, or column actions.
      setMenu({ x, y, image: null, misspelling: null, pointer: pos + 1, doc: view.state.doc, selection: view.state.selection, focused: active instanceof HTMLElement && view.dom.contains(active) ? active : null, table: handleKind(view.state.selection) })
    }
    view.dom.addEventListener('mousedown', onMouseDown, true)
    view.dom.addEventListener('contextmenu', onContextMenu)
    view.dom.addEventListener(TABLE_HANDLE_MENU, onHandleMenu)
    return () => {
      // A right-click still waiting for its guesses opens nothing once its page is gone (S9).
      latest = -1
      view.dom.removeEventListener('mousedown', onMouseDown, true)
      view.dom.removeEventListener('contextmenu', onContextMenu)
      view.dom.removeEventListener(TABLE_HANDLE_MENU, onHandleMenu)
    }
  }, [view])
  if (ask !== null && view !== null) {
    const done = (answer: () => void) => () => {
      setAsk(null)
      view.focus()
      answer()
    }
    return (
      <ConfirmSheet
        labelId="cell-note-ask"
        text={ask.text}
        confirmLabel={ask.confirm}
        danger={ask.danger === true}
        keys="sheet"
        onConfirm={done(ask.onConfirm)}
        onCancel={done(() => undefined)}
        other={
          ask.other !== undefined && (
            <button type="button" className="confirm__btn confirm__btn--other" onClick={done(ask.other.run)}>
              {ask.other.label}
            </button>
          )
        }
      />
    )
  }
  if (view === null || menu === null) return null
  const pointer = menu.doc === view.state.doc ? menu.pointer : null
  const refocus = () => (menu.focused ?? view.dom).focus()
  const run = (action: PageMenuAction, arg?: PageMenuArg) => {
    refocus()
    // After the focus is back, so the bullet is checked against the selection the copy will see.
    const bullet = action === 'copy-visible' && menu.pointer !== null && menu.doc === view.state.doc ? bulletToCopy(view.state, menu.pointer) : null
    if (bullet !== null) copyVisibleNext(view, bullet)
    api.menu.edit(action, arg).catch((error: unknown) => {
      if (bullet !== null) forgetCopyVisible(view)
      console.error('Menu action failed', error)
    })
  }
  const [spelling, ...rest] = pageMenuSections(view, menu.misspelling, run, pointer, reading, menu.table)
  const more = extra?.() ?? []
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      sections={menu.image !== null ? imageMenuSections({ src: menu.image, x: menu.x, y: menu.y }, run) : [spelling, ...lineSections(view, pointer, menu.selection), ...rest, ...more]}
      onClose={() => {
        setMenu(null)
        refocus()
      }}
    />
  )
}
