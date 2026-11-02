/**
 * Zoom into a bullet (GRO-2029), obsidian-zoom / Workflowy style.
 *
 * Design: zoom is VIEW STATE ONLY. The plugin state holds the position of the zoomed
 * `list_item` (mapped through every transaction, like the fold plugin's collapsed set) and
 * renders two kinds of decorations:
 *  - node decorations adding `outline-zoom-hidden` (CSS `display:none`) to every block that is
 *    not on the path from the doc root to the zoomed item and not inside it, plus
 *    `outline-zoom-ancestor` on the ancestor list_items (their glyph/chevron are hidden and a
 *    folded ancestor is shown expanded — fold state itself is untouched);
 *  - a breadcrumb widget at the start of the document: `File › Ancestor › … › Zoomed`. Each crumb
 *    zooms to that ancestor; the first crumb, the page's title, zooms out fully. ⌘- and ⇧-click on a crumb
 *    open that level in a new tab, as on a dot; the title crumb opens the whole page (YAZ-3647 E2).
 * Zooming dispatches a metadata-only transaction (`tr.docChanged === false`), so the listener never
 * fires `markdownUpdated`, the file on disk is untouched and fold state is unaffected. The FILE never
 * holds the zoom: the page's TAB does (`Tab.zoom`, a zoom key), and the window stores it with the tab
 * (YAZ-3646 D14). A page starts at its tab's level (see "Start level" below), and a rebuild from
 * outside zooms back to the bullet while it is still there (`applyExternalMarkdown`, YAZ-3647 E1).
 *
 * The window's Back list (YAZ-3647 D2, replaces GRO-2091 A's browser history): every user-driven zoom
 * change tells the page's tab (`onZoom`), and the tab keeps the level as a zoom key and adds a Back
 * step. Back and Forward come back through `zoomToKey`, which tells no one. Keys are the fold-key
 * scheme (first-block text + occurrence) counted over ALL list items; an unresolvable key zooms out.
 *
 * ⌘Z panic-undo (GRO-2091 B, same rule as folds in GRO-2075): the state remembers the level
 * before the latest zoom change while that change is the latest VIEW action — cleared by a user
 * document change (plugin-appended transactions excepted) or by a fold (viewActions.ts stamp).
 * `undoLastZoom` (Mod-z, priority 100) reverts exactly that one step and declines otherwise.
 *
 * Start level (YAZ-2951 D1): a copy of a tab, or a page in a new window, starts drilled into its
 * source's bullet (`startKey`, a zoom key). `init` resolves it against the parsed page; a key that
 * is not found starts zoomed out (S7). It adds no Back step (S21) and sets no ⌘Z level (S22).
 * The host then moves the caret into that bullet (`caretIntoZoom`), once the editor is made: never
 * from the plugin view, which ProseMirror builds inside the EditorView constructor.
 *
 * A cell note (YAZ-3818 D9) opens the same way: the zoom's level is a `list_item` or a `cell_note`. The cell note is
 * a block of its own right under its table, so the path walk hides the table with the rest. Its crumb is
 * "Note: <column> · <row>", its zoom key `note:<label>`, its page has an × at the end of the crumbs ("Close cell note"),
 * and ⌘⇧. from it zooms out fully. A click on a cell's corner triangle and ⌘. on a plain line of a cell open the cell's note
 * (`openCellNote`, made first when the cell has none). Leaving the page puts the caret back after the mark, and a cell
 * note left with one empty line goes, with its mark, in the same transaction (D15).
 *
 * Triggers: click on the bullet glyph (`.label-wrapper`; task checkboxes keep toggling instead), by the gestures of
 * Settings › Hotkeys › "Bullet dots" (YAZ-3936, read at the click): by default a click zooms in ("Open in this tab"),
 * ⇧-click opens the bullet in a new tab and ⌘-click in a background tab (YAZ-3646 D10); a crumb follows them too,
 * `Mod-.` = zoom into the item at the caret, `Mod-Shift-.` = zoom out one level. While zoomed,
 * `Shift-Tab` / `Mod-[` on the zoomed item or one of its direct children is a no-op (lifting would
 * move the item out of the visible subtree).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { gestureAction } from '@shared/keys'
import { rowShortcuts } from '../noteKeys'
import { addCellNote, cellNoteAround, cellNoteCornerAt, cellNoteCrumbParts, cellNoteOf, isCellNote, isEmptyCellNote, markPosOf, notePosOf, removeCellNote, tableAround } from '../table/cellNotes'
import { wikilinkKey } from '../wikilink/wikilinkPlugin'
import { ancestorItemPositions, cellPosAround, innermostItemPos, isListItem, itemLabelText } from './listNodes'
import { getOutlineFoldKey, outlineFoldLabel } from './outlineFoldKeys'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

export interface ZoomOptions {
  /** The page's title (YAZ-2420 🔒 D14), read as the breadcrumb is drawn: the first crumb; clicking it zooms out fully. */
  title: () => string
  /** A bullet's text as its labels show it (YAZ-3744 D6): each `[[link]]` as the note shows it. Absent: as written. */
  linkText?: (text: string) => string
  /** The zoom key to start drilled into (YAZ-2951 D1): a copied page view's `zoomKey`. Absent, null or not found = zoomed out. */
  startKey?: string | null
  /**
   * Each user-driven zoom change, to the page's tab (YAZ-3647 D2): the zoom key, null the whole page. Absent: the right
   * panel, a review. `label` is the bullet's crumb text, for the Back list's menu and the tab's tooltip (E3, E4).
   * `from` (a quiet key report only, YAZ-3662 F6b): the key this report replaces, the one the page last reported or
   * was set to, so the tab's steps at that key take the new one even after a Back or as the page goes.
   */
  onZoom?: (zoom: string | null, quiet: boolean, label: string | null, from?: string | null) => void
  /**
   * "Open in a new tab" (in front) and "Open in a background tab" (behind) on a dot or a crumb, and the menu's "Open in
   * new tab" (YAZ-3646 D8, D10, YAZ-3647 E2): that level in a new tab; null is the whole page (the title crumb). Absent:
   * no tab to copy.
   */
  onOpen?: (zoom: string | null, background: boolean, label: string | null) => void
  /** The user's changes of Settings › Hotkeys (`settings.hotkeys`), read at each click: the "Bullet dots" gestures (YAZ-3936). Absent → the defaults. */
  hotkeys?: () => HotkeyOverrides | undefined
}

interface ZoomState {
  /** Position of the zoomed list_item, or null when not zoomed. */
  itemPos: number | null
  /** Where a zoom change goes (`ZoomOptions.onZoom`): the ONE source of it, for the commands, the crumbs and the plugin view. */
  onZoom?: ZoomOptions['onZoom']
  /** Where a dot's or a crumb's new-tab gestures go (`ZoomOptions.onOpen`, YAZ-3646 D10, YAZ-3647 E2): the one source of it too. */
  onOpen?: ZoomOptions['onOpen']
  /** `ZoomOptions.hotkeys`: the gestures a dot and a crumb read. */
  hotkeys?: ZoomOptions['hotkeys']
  /** `ZoomOptions.linkText`: every label of a bullet reads it, the crumbs, the tab's tooltip and its Back list. */
  linkText?: ZoomOptions['linkText']
  /**
   * ⌘Z target: the level before the latest zoom change, kept while that change is still the latest
   * view action. `undefined` = nothing to revert; `null` = revert to zoomed-out.
   */
  undoLevel: ZoomLevel | undefined
  /** How many level changes (zoom transactions) this state has seen: a mapped position is no level change (YAZ-3662 F6b). */
  changes: number
  /** How many link index refreshes (`wikilinkKey` metas) this state has seen: the crumbs' `linkText` reads the index (5A-4). */
  links: number
}

/** A zoom level: position of the zoomed list_item or cell note, or `null` = zoomed out. Also the plugin's transaction meta. */
type ZoomLevel = number | null
/** Set on the ⌘Z revert transaction: it consumes the pending undo instead of creating a new one. */
const UNDO_META = 'mdapp-outline-zoom-undo'

export const ZOOM_HIDDEN_CLASS = 'outline-zoom-hidden'
export const ZOOM_ANCESTOR_CLASS = 'outline-zoom-ancestor'
export const ZOOM_CRUMBS_CLASS = 'outline-zoom-crumbs'
export const ZOOM_CRUMB_CLASS = 'outline-zoom-crumb'
/** The zoomed cell note, or the one that holds the zoomed bullet (YAZ-3818 D9): shown, over `.cell-note { display: none }`. */
export const ZOOM_NOTE_CLASS = 'outline-zoom-note'
/** The × at the end of a cell note page's crumbs (D9). */
export const ZOOM_CLOSE_CLASS = 'outline-zoom-close'
/** A cell note's zoom key: `note:` and its label. A bullet's key is a hash and a number, so the two never meet. */
const NOTE_KEY = 'note:'

const LABEL_MAX_CHARS = 40
/** How long the zoomed bullet's text rests before its new key goes to the tab (YAZ-3646 D14). */
export const KEY_SETTLE_MS = 1000
/** Priority above Crepe's keymaps (50), like `listCommands.ts` / `hotkeys.ts`. */
const PRIORITY = 100

const pluginKey = new PluginKey<ZoomState>('mdapp-outline-zoom')

/** A node the zoom opens as a page: a bullet, or a cell note (YAZ-3818 D9). */
const isZoomable = (node: ProseNode | null | undefined): node is ProseNode => isListItem(node) || (node != null && isCellNote(node))

/** How many times the zoom built its decorations: a test proves that a caret move builds none (YAZ-3818). */
export const zoomDecorationBuilds = { runs: 0 }

/** Position of the zoomed list_item or cell note (null when not zoomed or when the plugin is absent). */
export const getZoomedItemPos = (state: EditorState): number | null => pluginKey.getState(state)?.itemPos ?? null

/**
 * Walk every list_item in document order with its zoom key — fold-key scheme, but the occurrence
 * index counts ALL items (fold keys only count parents), so this is a separate key space.
 * `visit` returning true ends the visits (the underlying `descendants` still iterates, skipping
 * children — fine at document scale).
 */
const eachItemKey = (doc: ProseNode, visit: (pos: number, key: string) => boolean): void => {
  const occurrences = new Map<string, number>()
  let stop = false
  doc.descendants((node, pos) => {
    if (stop) return false
    if (!isListItem(node)) return true
    const label = itemLabelText(node)
    const keyLabel = outlineFoldLabel(label)
    const occurrence = occurrences.get(keyLabel) ?? 0
    occurrences.set(keyLabel, occurrence + 1)
    if (visit(pos, getOutlineFoldKey(label, occurrence))) stop = true
    return !stop
  })
}

/** Position-independent key of the list_item or cell note at `itemPos` (null when there is none there). */
export const zoomKeyAt = (doc: ProseNode, itemPos: number): string | null => {
  const node = doc.nodeAt(itemPos)
  if (node !== null && isCellNote(node)) return `${NOTE_KEY}${node.attrs.label as string}`
  let found: string | null = null
  eachItemKey(doc, (pos, key) => {
    if (pos !== itemPos) return false
    found = key
    return true
  })
  return found
}

/** Position of the list_item or cell note with zoom key `key`, or null when it no longer exists. */
export const itemPosForZoomKey = (doc: ProseNode, key: string): number | null => {
  if (key.startsWith(NOTE_KEY)) return notePosOf(doc, key.slice(NOTE_KEY.length))
  let found: number | null = null
  eachItemKey(doc, (pos, itemKey) => {
    if (itemKey !== key) return false
    found = pos
    return true
  })
  return found
}

/** The zoomed bullet's zoom key, or null when not zoomed (YAZ-2951 D4): read once, by the page view reader, never per transaction. */
export const getZoomKey = (state: EditorState): string | null => {
  const itemPos = getZoomedItemPos(state)
  return itemPos === null ? null : zoomKeyAt(state.doc, itemPos)
}

const truncated = (text: string): string => (text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : text)

/** Breadcrumb label: the item's first-block text, truncated. */
const itemLabel = (item: ProseNode, linkText: (text: string) => string = (text) => text): string => truncated(linkText(itemLabelText(item)))

/** A cell note's crumb (YAZ-3818 D9): "Note: <column> · <row>", the column's header and the row's first cell, truncated. */
const noteLabel = (doc: ProseNode, note: ProseNode, linkText: (text: string) => string = (text) => text): string => {
  const { column, row } = cellNoteCrumbParts(doc, note.attrs.label as string)
  const parts = [column, row].map((text) => linkText(text).trim()).filter((text) => text !== '')
  return truncated(parts.length === 0 ? 'Note' : `Note: ${parts.join(' · ')}`)
}

/** The crumb of the zoomable node `node`: a bullet's text, or a cell note's "Note: …". */
const crumbLabel = (doc: ProseNode, node: ProseNode, linkText?: (text: string) => string): string => (isCellNote(node) ? noteLabel(doc, node, linkText) : itemLabel(node, linkText))

/** The crumb text of the list_item or cell note at `itemPos` (YAZ-3647 E3, E4): what the Back list's menu and the tab's tooltip show. */
export const zoomLabelAt = (state: EditorState, itemPos: number): string | null => {
  const node = state.doc.nodeAt(itemPos)
  return isZoomable(node) ? crumbLabel(state.doc, node, pluginKey.getState(state)?.linkText) : null
}

/** The zoomed bullet's crumb text, or null when not zoomed (YAZ-3647 E3). */
export const getZoomLabel = (state: EditorState): string | null => {
  const itemPos = getZoomedItemPos(state)
  return itemPos === null ? null : zoomLabelAt(state, itemPos)
}

/** Position of the innermost list_item containing the selection head, or null outside lists. */
const itemAtSelection = (state: EditorState): number | null => innermostItemPos(state.selection.$from)

/** Whether the whole selection (of a state or a transaction) is inside the node at `itemPos`. */
const selectionInItem = ({ doc, selection }: Pick<EditorState, 'doc' | 'selection'>, itemPos: number): boolean => {
  const item = doc.nodeAt(itemPos)
  const { from, to } = selection
  return item !== null && from >= itemPos && to <= itemPos + item.nodeSize
}

/** The cell note at `pos`, or the one that holds it (a bullet in a cell note), with its position; or null. */
const noteAround = (doc: ProseNode, pos: number): { pos: number; node: ProseNode } | null => {
  const at = isCellNote(doc.nodeAt(pos)!) ? pos : cellNoteAround(doc.resolve(pos))
  return at === null ? null : { pos: at, node: doc.nodeAt(at)! }
}

/**
 * The zoom leaves a cell note's page for `target` (YAZ-3818 D9, D15), in `tr`: a cell note that holds one empty line
 * goes, with its mark, unless the note is read-only (`removeEmpty` false, 5A-6: rule 40); with `moveCaret`, the caret
 * goes back after the mark, so no key types into a hidden note. Returns `target` mapped through `tr`. Nothing happens
 * when the zoom is on no cell note, or `target` is inside it.
 */
const leaveNote = (state: EditorState, tr: Transaction, target: ZoomLevel, moveCaret: boolean, removeEmpty: boolean): ZoomLevel => {
  const zoomed = getZoomedItemPos(state)
  const note = zoomed === null ? null : noteAround(state.doc, zoomed)
  if (note === null || (target !== null && target >= note.pos && target < note.pos + note.node.nodeSize)) return target
  const label = note.node.attrs.label as string
  const mark = markPosOf(state.doc, label)
  if (removeEmpty && isEmptyCellNote(note.node)) removeCellNote(tr, label)
  if (moveCaret && mark !== null) tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(mark + 1)), -1))
  return target === null ? null : tr.mapping.map(target)
}

/**
 * Zoom into the list_item or cell note at `itemPos` (null = zoom out fully); moves the caret into it if the
 * selection was outside, unless `moveCaret` is false (find's own zoom, `zoomQuietly`). Leaving a cell note's page goes
 * through `leaveNote`, which reads the view's `editable` (a run with no view counts as editable). Every user-driven
 * zoom change goes to the tab's Back list (`onZoom`, YAZ-3647 D2); `quiet` (Back, Forward: `zoomToKey`) restores a
 * level and tells no one.
 */
const zoomTo = (itemPos: ZoomLevel, { quiet = false, isUndo = false, moveCaret = true } = {}): Command => (state, dispatch, view) => {
  const zoom = pluginKey.getState(state)
  if (!zoom || zoom.itemPos === itemPos) return false
  if (itemPos !== null && !isZoomable(state.doc.nodeAt(itemPos))) return false
  if (dispatch) {
    const tr = state.tr
    const target = leaveNote(state, tr, itemPos, moveCaret, view?.editable !== false)
    tr.setMeta(pluginKey, target).setMeta(VIEW_ACTION_META, 'zoom' satisfies ViewAction)
    if (isUndo) tr.setMeta(UNDO_META, true)
    if (moveCaret && target !== null && !selectionInItem(tr, target)) tr.setSelection(Selection.near(tr.doc.resolve(target + 1), 1))
    dispatch(tr.scrollIntoView())
    // A step in the window's Back list (YAZ-3647 D2). Back and Forward themselves tell no one.
    if (!quiet) zoom.onZoom?.(itemPos === null ? null : zoomKeyAt(state.doc, itemPos), false, itemPos === null ? null : zoomLabelAt(state, itemPos))
  }
  return true
}

/**
 * Put the caret in the drilled-in bullet when it is outside it (YAZ-2951 D1): a page that STARTS
 * drilled in has its caret at the page start, in a hidden block. A selection-only transaction: no
 * zoom meta, so no history entry (S21) and no ⌘Z level (S22). Declines when not drilled in or
 * when the caret is inside already. The host runs it once the editor is made (`moveCaretIntoZoom`).
 */
export const caretIntoZoom: Command = (state, dispatch) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null || selectionInItem(state, itemPos)) return false
  dispatch?.(state.tr.setSelection(Selection.near(state.doc.resolve(itemPos + 1), 1)))
  return true
}

/**
 * `Mod-z` (GRO-2091 B): revert the latest zoom change iff it is still the latest view action;
 * declines otherwise so the fold undo / ProseMirror history get the key. The revert is itself a
 * zoom change (history entry pushed, so Back returns to the zoomed view) and consumes the undo.
 */
export const undoLastZoom: Command = (state, dispatch, view) => {
  const undoLevel = pluginKey.getState(state)?.undoLevel
  if (undoLevel === undefined) return false
  return zoomTo(undoLevel, { isUndo: true })(state, dispatch, view)
}

/** Back and Forward (YAZ-3647 D2): the page goes to the step's level, quietly. A key that is no longer found zooms out. */
export const zoomToKey = (key: string | null): Command => (state, dispatch, view) =>
  zoomTo(key === null ? null : itemPosForZoomKey(state.doc, key), { quiet: true })(state, dispatch, view)

/** Zoom out fully, as the title crumb does: a step in the Back list. The table of contents' jump out of a zoom (YAZ-4094 4C). */
export const zoomOutFully: Command = (state, dispatch, view) => zoomTo(null)(state, dispatch, view)

/**
 * Find's own zoom (YAZ-3818 D19): into the hidden cell note at `itemPos` that holds the current match, or back to the
 * level find came from. Quiet, as a fold that find opens is silent, and the caret stays where the reader left it.
 */
export const zoomQuietly = (itemPos: ZoomLevel): Command => zoomTo(itemPos, { quiet: true, moveCaret: false })

/**
 * Tell the page's tab the level it shows now, as a user-driven change: a step in its Back list. Find closes on a cell
 * note it opened quietly, and the page stays there (D19).
 */
export const reportZoom = (state: EditorState): void => {
  const zoom = pluginKey.getState(state)
  if (zoom?.itemPos != null) zoom.onZoom?.(zoomKeyAt(state.doc, zoom.itemPos), false, zoomLabelAt(state, zoom.itemPos))
}

/**
 * Can `openCellNote` open a page for the cell at `cellPos`? An editable note always can (it makes the note); a
 * read-only one only when the cell's mark has its cell note (5A-22).
 */
export function canOpenCellNote(view: EditorView, cellPos: number): boolean {
  const label = cellNoteOf(view.state.doc, cellPos)
  return view.editable || (label !== null && notePosOf(view.state.doc, label) !== null)
}

/**
 * Open the cell note of the cell at `cellPos` as a page (YAZ-3818 D8, D9): the corner's click, the "Add cell note"
 * button, the table menu and ⌘.. A cell with no mark gets a cell note first (`addCellNote`); a mark with no cell note
 * gets an empty one under its table. Then the note is found by its label, as `notesFollowTables` may have moved it. A
 * read-only note only opens a cell note that is there.
 */
export function openCellNote(view: EditorView, cellPos: number): boolean {
  if (!canOpenCellNote(view, cellPos)) return false
  let label = cellNoteOf(view.state.doc, cellPos)
  if (label === null) {
    if (!addCellNote(cellPos)(view.state, view.dispatch)) return false
    label = cellNoteOf(view.state.doc, cellPos)!
  }
  if (notePosOf(view.state.doc, label) === null) {
    view.dispatch(view.state.tr.insert(tableAround(view.state.doc, cellPos).end, view.state.schema.nodes.cell_note.createAndFill({ label })!))
  }
  const notePos = notePosOf(view.state.doc, label)
  return notePos !== null && zoomTo(notePos)(view.state, view.dispatch, view)
}

/**
 * `Mod-.`: zoom into the item at the caret; on a plain line of a cell, open the cell's note (YAZ-3818 D9). A bullet in
 * a cell is the item (`innermostItemPos`), so the cell here is a plain line's.
 */
const zoomIntoSelection: Command = (state, dispatch, view) => {
  const itemPos = itemAtSelection(state)
  if (itemPos !== null) return zoomTo(itemPos)(state, dispatch, view)
  const cellPos = cellPosAround(state.selection.$from)
  if (cellPos === null || view === undefined) return false
  return dispatch === undefined ? canOpenCellNote(view, cellPos) : openCellNote(view, cellPos)
}

/**
 * `Mod-Shift-.`: zoom out one level, to the bullet or the cell note around the zoomed bullet, or fully when there is
 * none. From a cell note's page: fully (D9).
 */
const zoomOutOneLevel: Command = (state, dispatch, view) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const $item = state.doc.resolve(itemPos)
  let parent: ZoomLevel = null
  if (!isCellNote(state.doc.nodeAt(itemPos)!)) {
    for (let depth = $item.depth; depth > 0 && parent === null; depth--) if (isZoomable($item.node(depth))) parent = $item.before(depth)
  }
  return zoomTo(parent)(state, dispatch, view)
}

/**
 * Swallow a lift (`Shift-Tab` / `Mod-[`) that would move the caret's item out of the zoomed
 * subtree: the zoomed item itself or one of its direct children. The outliner's outdent calls
 * it on the covered lines (YAZ-3003); the bindings below still guard outside list items.
 */
export const blockEscapingLift: Command = (state) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const positions = ancestorItemPositions(state.selection.$from)
  const index = positions.indexOf(itemPos)
  return index >= 0 && positions.length - index <= 2
}

const crumbButton = (view: EditorView, label: string, target: ZoomLevel, current: boolean): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ZOOM_CRUMB_CLASS
  button.textContent = label
  button.disabled = current
  if (current) button.setAttribute('aria-current', 'location')
  // Keep the caret where it is: crumbs must not steal focus or move the selection.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    // The new-tab gestures open that level in a new tab, as on a dot (YAZ-3647 E2, YAZ-3936); any other click zooms. The title crumb opens the whole page.
    const plugin = pluginKey.getState(view.state)
    const where = gestureAction('bullets', event, plugin?.hotkeys?.())
    const open = plugin?.onOpen
    if (open !== undefined && (where === 'newTab' || where === 'backgroundTab')) {
      const key = target === null ? null : zoomKeyAt(view.state.doc, target)
      if (target === null || key !== null) return open(key, where === 'backgroundTab', target === null ? null : zoomLabelAt(view.state, target))
    }
    zoomTo(target)(view.state, view.dispatch, view)
  })
  return button
}

/** The × of a cell note's page (YAZ-3818 D9): zooms out fully, as the title crumb does. */
const closeButton = (view: EditorView): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ZOOM_CLOSE_CLASS
  button.textContent = '×'
  button.title = 'Close cell note'
  button.setAttribute('aria-label', 'Close cell note')
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    zoomTo(null)(view.state, view.dispatch, view)
  })
  return button
}

const buildDecorations = (state: EditorState, itemPos: number, title: string, linkText?: (text: string) => string): Decoration[] => {
  const $item = state.doc.resolve(itemPos)
  const zoomed = $item.nodeAfter
  const decorations: Decoration[] = []
  if (!isZoomable(zoomed)) return decorations
  const crumbs: Array<{ label: string; target: ZoomLevel }> = [{ label: title, target: null }]

  // Walk the containers on the path root → zoomed node; hide every child that is off the path. A cell note on the
  // path (a bullet in it is zoomed) shows, and has its crumb.
  for (let depth = 0; depth <= $item.depth; depth++) {
    const container = $item.node(depth)
    if (isZoomable(container)) {
      const pos = $item.before(depth)
      decorations.push(Decoration.node(pos, pos + container.nodeSize, { class: isCellNote(container) ? ZOOM_NOTE_CLASS : ZOOM_ANCESTOR_CLASS }))
      crumbs.push({ label: crumbLabel(state.doc, container, linkText), target: pos })
    }
    const pathIndex = $item.index(depth)
    container.forEach((child, _offset, index) => {
      if (index === pathIndex) return
      const pos = $item.posAtIndex(index, depth)
      decorations.push(Decoration.node(pos, pos + child.nodeSize, { class: ZOOM_HIDDEN_CLASS }))
    })
  }
  crumbs.push({ label: crumbLabel(state.doc, zoomed, linkText), target: itemPos })
  // A cell note's page: the note shows, and its crumbs end with the × (D9).
  const notePage = isCellNote(zoomed)
  if (notePage) decorations.push(Decoration.node(itemPos, itemPos + zoomed.nodeSize, { class: ZOOM_NOTE_CLASS }))

  decorations.push(
    Decoration.widget(
      0,
      (view) => {
        const nav = document.createElement('nav')
        nav.className = ZOOM_CRUMBS_CLASS
        nav.setAttribute('aria-label', 'Zoom breadcrumbs')
        nav.contentEditable = 'false'
        crumbs.forEach((crumb, index) => {
          if (index > 0) {
            const separator = document.createElement('span')
            separator.className = `${ZOOM_CRUMB_CLASS}-separator`
            separator.setAttribute('aria-hidden', 'true')
            separator.textContent = '›'
            nav.appendChild(separator)
          }
          nav.appendChild(crumbButton(view, crumb.label, crumb.target, index === crumbs.length - 1))
        })
        if (notePage) nav.appendChild(closeButton(view))
        return nav
      },
      { side: -1, key: `outline-zoom-crumbs:${itemPos}:${notePage ? 'note:' : ''}${crumbs.map((c) => c.label).join('\u0000')}` },
    ),
  )
  return decorations
}

/**
 * The decorations of a doc at its level, title and link index (YAZ-3818): a caret move or a fold builds none; a link
 * index refresh builds them again (5A-4). Per doc, so per editor.
 */
const builtSets = new WeakMap<ProseNode, { itemPos: number; title: string; links: number; set: DecorationSet }>()

/** The cell whose corner triangle received `event` (YAZ-3818 D8, 5A-18), or null: a mark outside a table has none. */
const cellFromCornerClick = (view: EditorView, event: MouseEvent): number | null => {
  const cell = cellNoteCornerAt(view, event)
  return cell === null ? null : cellPosAround(view.state.doc.resolve(view.posAtDOM(cell, 0)))
}

/** The list_item whose bullet glyph (`.label-wrapper`) received `event`, or null. */
const itemPosFromGlyphClick = (view: EditorView, event: MouseEvent): number | null => {
  const target = event.target
  if (!(target instanceof Element)) return null
  const wrapper = target.closest('.label-wrapper')
  if (wrapper === null || !view.dom.contains(wrapper)) return null
  // Task checkboxes toggle on click (Crepe); only plain bullets / ordered labels zoom.
  if (wrapper.querySelector('.label.checked, .label.unchecked') !== null) return null
  const $pos = view.state.doc.resolve(view.posAtDOM(wrapper, 0))
  return isListItem($pos.parent) ? $pos.before() : null
}

export const createOutlineZoom = ({ title, startKey = null, onZoom, onOpen, linkText, hotkeys }: ZoomOptions) => {
  // Used by the FIRST state only: a rebuilt state (`setMarkdown` → `replaceAll(md, true)`) starts zoomed out, as before.
  let pendingStartKey = startKey
  return $prose(
    () =>
      new Plugin<ZoomState>({
        key: pluginKey,
        state: {
          // The start level (YAZ-2951 D1) is plain state: no transaction, so no Back step and no ⌘Z level.
          init: (_config, state) => {
            const key = pendingStartKey
            pendingStartKey = null
            return { itemPos: key === null ? null : itemPosForZoomKey(state.doc, key), onZoom, onOpen, hotkeys, linkText, undoLevel: undefined, changes: 0, links: 0 }
          },
          apply: (transaction, previous, _oldState, newState) => {
            // A link index refresh is meta-only: the doc stays, but a crumb's link text may change (YAZ-3818 5A-4).
            if (transaction.getMeta(wikilinkKey) !== undefined) previous = { ...previous, links: previous.links + 1 }
            const meta: ZoomLevel | undefined = transaction.getMeta(pluginKey)
            if (meta !== undefined) {
              // ⌘Z-revertible while it is the latest view action; the revert itself consumes it. A cell note that the
              // change removed (D15) is no level to go back to.
              const last = previous.itemPos === null ? null : transaction.mapping.mapResult(previous.itemPos, 1)
              const undoLevel = transaction.getMeta(UNDO_META) || last?.deleted ? undefined : (last?.pos ?? null)
              return { ...previous, itemPos: meta, undoLevel, changes: previous.changes + 1 }
            }
            let { itemPos, undoLevel } = previous
            // A newer view action of another kind — a bullet or heading fold (YAZ-1140) — owns ⌘Z now (viewActions.ts).
            const viewAction: unknown = transaction.getMeta(VIEW_ACTION_META)
            if (viewAction !== undefined && viewAction !== 'zoom') undoLevel = undefined
            if (transaction.docChanged) {
              // User edits hand ⌘Z back to history; plugin-appended transactions (Crepe's trailing
              // paragraph) are not user actions and only map the remembered position.
              if (transaction.getMeta('appendedTransaction') === undefined) undoLevel = undefined
              else if (typeof undoLevel === 'number') {
                const mappedLast = transaction.mapping.mapResult(undoLevel, 1)
                undoLevel = !mappedLast.deleted && isZoomable(newState.doc.nodeAt(mappedLast.pos)) ? mappedLast.pos : undefined
              }
              if (itemPos !== null) {
                // A change of the zoomed item's own attributes — a task tick (⌘Enter), a list button
                // (YAZ-3806 4A) — is a `setNodeMarkup`: it replaces the item's opening token, so the item's start
                // maps as deleted. The start of its content does not: the item is still there, one token before.
                const mapped = transaction.mapping.mapResult(itemPos, 1)
                const inside = transaction.mapping.mapResult(itemPos + 1, 1)
                const pos = !mapped.deleted ? mapped.pos : !inside.deleted ? inside.pos - 1 : null
                itemPos = pos !== null && isZoomable(newState.doc.nodeAt(pos)) ? pos : null
              }
            }
            return itemPos === previous.itemPos && undoLevel === previous.undoLevel ? previous : { ...previous, itemPos, undoLevel }
          },
        },
        // The zoomed bullet's key is its text (YAZ-3646 D14): edit its first line, or delete it, and the tab must
        // store the new key. Told quietly once typing stops; per keystroke only a timer moves. Each report names the
        // key it replaces (`from`, YAZ-3662 F6b). A report still waiting goes AT ONCE, with the key before the change,
        // when the level changes (a zoom, ⌘Z, Back and Forward through `zoomToKey`) and when the view goes (the tab
        // shows another page, closes, or the page is rebuilt): else it would read the new level, or be lost.
        view: (editorView) => {
          let timer: number | undefined
          /** The last state this view saw: on destroy, `view.state` may be the rebuilt state already. */
          let seen = editorView.state
          /** The key the page last reported or was set to (YAZ-3662 F6b). */
          let lastKey = getZoomKey(seen)
          const report = (state: EditorState) => {
            window.clearTimeout(timer)
            timer = undefined
            const key = getZoomKey(state)
            const from = lastKey
            lastKey = key
            // The same key: nothing to tell (typing in a child, or the text came back).
            if (key !== from) pluginKey.getState(state)?.onZoom?.(key, true, getZoomLabel(state), from)
          }
          const flush = (state: EditorState) => {
            if (timer !== undefined) report(state)
          }
          return {
            update: (view, prev) => {
              // A level change: the waiting report first, at the old level. A doc change that comes with it is the
              // editor's own (a trailing paragraph), not typing, so it starts no timer.
              if (pluginKey.getState(view.state)?.changes !== pluginKey.getState(prev)?.changes) {
                flush(prev)
                lastKey = getZoomKey(view.state)
                seen = view.state
                return
              }
              seen = view.state
              const zoomed = getZoomedItemPos(view.state) !== null || getZoomedItemPos(prev) !== null
              if (pluginKey.getState(view.state)?.onZoom === undefined || view.state.doc === prev.doc || !zoomed) return
              window.clearTimeout(timer)
              timer = window.setTimeout(() => report(seen), KEY_SETTLE_MS)
            },
            destroy: () => flush(seen),
          }
        },
        props: {
          decorations: (state) => {
            const zoom = pluginKey.getState(state)
            const itemPos = zoom?.itemPos ?? null
            if (itemPos === null) return DecorationSet.empty
            const name = title()
            const links = zoom!.links
            let built = builtSets.get(state.doc)
            if (built === undefined || built.itemPos !== itemPos || built.title !== name || built.links !== links) {
              zoomDecorationBuilds.runs++
              built = { itemPos, title: name, links, set: DecorationSet.create(state.doc, buildDecorations(state, itemPos, name, linkText)) }
              builtSets.set(state.doc, built)
            }
            return built.set
          },
          handleDOMEvents: {
            click: (view, event) => {
              // A click on a cell's corner triangle opens its cell note (YAZ-3818 D8).
              const cellPos = cellFromCornerClick(view, event)
              if (cellPos !== null) {
                event.preventDefault()
                return openCellNote(view, cellPos)
              }
              const itemPos = itemPosFromGlyphClick(view, event)
              if (itemPos === null) return false
              // The "Bullet dots" gestures (YAZ-3936; by default click, ⇧-click, ⌘-click: YAZ-3646 D10). A click no row
              // has is the editor's. A page with no tab zooms in place.
              const plugin = pluginKey.getState(view.state)
              const where = gestureAction('bullets', event, plugin?.hotkeys?.())
              if (where === null) return false
              event.preventDefault()
              const open = plugin?.onOpen
              const key = open !== undefined && where !== 'thisTab' ? zoomKeyAt(view.state.doc, itemPos) : null
              if (key !== null) open?.(key, where === 'backgroundTab', zoomLabelAt(view.state, itemPos))
              else zoomTo(itemPos)(view.state, view.dispatch, view)
              return true
            },
          },
        },
      }),
  )
}

/**
 * Keymap: `Mod-.` / `Mod-Shift-.` / `Mod-z` (zoom panic-undo) plus the escape guard; register with `editor.use(zoomKeymap)`.
 * The chords are the rows' (`shared/keys/note.ts`, YAZ-3564 K4): the guard follows Outdent's key.
 */
export const zoomKeymap = $shortcut((ctx: Ctx) => ({
  ...rowShortcuts(ctx, 'note.zoomIn', 'ZoomIn', { priority: PRIORITY, onRun: () => zoomIntoSelection }),
  ...rowShortcuts(ctx, 'note.undo', 'UndoZoom', { priority: PRIORITY, onRun: () => undoLastZoom }),
  ...rowShortcuts(ctx, 'note.zoomOut', 'ZoomOut', { priority: PRIORITY, onRun: () => zoomOutOneLevel }),
  ZoomLiftGuardTab: { key: 'Shift-Tab', priority: PRIORITY, onRun: () => blockEscapingLift },
  ...rowShortcuts(ctx, 'note.outdent', 'ZoomLiftGuardBracket', { priority: PRIORITY, onRun: () => blockEscapingLift }),
}))
