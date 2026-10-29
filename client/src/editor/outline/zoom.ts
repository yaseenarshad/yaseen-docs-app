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
 * Triggers: click on the bullet glyph (`.label-wrapper`; task checkboxes keep toggling instead; ⌘- and
 * ⇧-click open the bullet in a new tab instead, YAZ-3646 D10),
 * `Mod-.` = zoom into the item at the caret, `Mod-Shift-.` = zoom out one level. While zoomed,
 * `Shift-Tab` / `Mod-[` on the zoomed item or one of its direct children is a no-op (lifting would
 * move the item out of the visible subtree).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { rowShortcuts } from '../noteKeys'
import { ancestorItemPositions, innermostItemPos, isListItem, itemLabelText } from './listNodes'
import { getOutlineFoldKey, outlineFoldLabel } from './outlineFoldKeys'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

export interface ZoomOptions {
  /** The page's title (YAZ-2420 🔒 D14), read as the breadcrumb is drawn: the first crumb; clicking it zooms out fully. */
  title: () => string
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
   * ⌘-click (behind) and ⇧-click (in front) on a dot or a crumb, and "Open in new tab" (YAZ-3646 D8, D10, YAZ-3647 E2):
   * that level in a new tab; null is the whole page (the title crumb). Absent: no tab to copy.
   */
  onOpen?: (zoom: string | null, background: boolean, label: string | null) => void
}

interface ZoomState {
  /** Position of the zoomed list_item, or null when not zoomed. */
  itemPos: number | null
  /** Where a zoom change goes (`ZoomOptions.onZoom`): the ONE source of it, for the commands, the crumbs and the plugin view. */
  onZoom?: ZoomOptions['onZoom']
  /** Where a dot's or a crumb's ⌘- or ⇧-click goes (`ZoomOptions.onOpen`, YAZ-3646 D10, YAZ-3647 E2): the one source of it too. */
  onOpen?: ZoomOptions['onOpen']
  /**
   * ⌘Z target: the level before the latest zoom change, kept while that change is still the latest
   * view action. `undefined` = nothing to revert; `null` = revert to zoomed-out.
   */
  undoLevel: ZoomLevel | undefined
  /** How many level changes (zoom transactions) this state has seen: a mapped position is no level change (YAZ-3662 F6b). */
  changes: number
}

/** A zoom level: position of the zoomed list_item, or `null` = zoomed out. Also the plugin's transaction meta. */
type ZoomLevel = number | null
/** Set on the ⌘Z revert transaction: it consumes the pending undo instead of creating a new one. */
const UNDO_META = 'mdapp-outline-zoom-undo'

export const ZOOM_HIDDEN_CLASS = 'outline-zoom-hidden'
export const ZOOM_ANCESTOR_CLASS = 'outline-zoom-ancestor'
export const ZOOM_CRUMBS_CLASS = 'outline-zoom-crumbs'
export const ZOOM_CRUMB_CLASS = 'outline-zoom-crumb'

const LABEL_MAX_CHARS = 40
/** How long the zoomed bullet's text rests before its new key goes to the tab (YAZ-3646 D14). */
export const KEY_SETTLE_MS = 1000
/** Priority above Crepe's keymaps (50), like `listCommands.ts` / `hotkeys.ts`. */
const PRIORITY = 100

const pluginKey = new PluginKey<ZoomState>('mdapp-outline-zoom')

/** Position of the zoomed list_item (null when not zoomed or when the plugin is absent). */
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

/** Position-independent key of the list_item at `itemPos` (null when there is no item there). */
export const zoomKeyAt = (doc: ProseNode, itemPos: number): string | null => {
  let found: string | null = null
  eachItemKey(doc, (pos, key) => {
    if (pos !== itemPos) return false
    found = key
    return true
  })
  return found
}

/** Position of the list_item with zoom key `key`, or null when it no longer exists. */
export const itemPosForZoomKey = (doc: ProseNode, key: string): number | null => {
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

/** Breadcrumb label: the item's first-block text, truncated. */
const itemLabel = (item: ProseNode): string => {
  const text = itemLabelText(item)
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : text
}

/** The crumb text of the list_item at `itemPos` (YAZ-3647 E3, E4): what the Back list's menu and the tab's tooltip show. */
export const zoomLabelAt = (doc: ProseNode, itemPos: number): string | null => {
  const item = doc.nodeAt(itemPos)
  return isListItem(item) ? itemLabel(item) : null
}

/** The zoomed bullet's crumb text, or null when not zoomed (YAZ-3647 E3). */
export const getZoomLabel = (state: EditorState): string | null => {
  const itemPos = getZoomedItemPos(state)
  return itemPos === null ? null : zoomLabelAt(state.doc, itemPos)
}

/** Position of the innermost list_item containing the selection head, or null outside lists. */
const itemAtSelection = (state: EditorState): number | null => innermostItemPos(state.selection.$from)

/** Whether the whole selection is inside the list_item at `itemPos`. */
const selectionInItem = (state: EditorState, itemPos: number): boolean => {
  const item = state.doc.nodeAt(itemPos)
  const { from, to } = state.selection
  return item !== null && from >= itemPos && to <= itemPos + item.nodeSize
}

/**
 * Zoom into the list_item at `itemPos` (null = zoom out fully); moves the caret into it if the
 * selection was outside. Every user-driven zoom change goes to the tab's Back list (`onZoom`,
 * YAZ-3647 D2); `quiet` (Back, Forward: `zoomToKey`) restores a level and tells no one.
 */
const zoomTo = (itemPos: ZoomLevel, { quiet = false, isUndo = false } = {}): Command => (state, dispatch) => {
  const zoom = pluginKey.getState(state)
  if (!zoom || zoom.itemPos === itemPos) return false
  if (itemPos !== null && !isListItem(state.doc.nodeAt(itemPos))) return false
  if (dispatch) {
    const tr = state.tr.setMeta(pluginKey, itemPos).setMeta(VIEW_ACTION_META, 'zoom' satisfies ViewAction)
    if (isUndo) tr.setMeta(UNDO_META, true)
    if (itemPos !== null && !selectionInItem(state, itemPos)) tr.setSelection(Selection.near(tr.doc.resolve(itemPos + 1), 1))
    dispatch(tr.scrollIntoView())
    // A step in the window's Back list (YAZ-3647 D2). Back and Forward themselves tell no one.
    if (!quiet) zoom.onZoom?.(itemPos === null ? null : zoomKeyAt(state.doc, itemPos), false, itemPos === null ? null : zoomLabelAt(state.doc, itemPos))
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
export const undoLastZoom: Command = (state, dispatch) => {
  const undoLevel = pluginKey.getState(state)?.undoLevel
  if (undoLevel === undefined) return false
  return zoomTo(undoLevel, { isUndo: true })(state, dispatch)
}

/** Back and Forward (YAZ-3647 D2): the page goes to the step's level, quietly. A key that is no longer found zooms out. */
export const zoomToKey = (key: string | null): Command => (state, dispatch) =>
  zoomTo(key === null ? null : itemPosForZoomKey(state.doc, key), { quiet: true })(state, dispatch)

/** `Mod-.`: zoom into the item at the caret. */
const zoomIntoSelection: Command = (state, dispatch) => {
  const itemPos = itemAtSelection(state)
  return itemPos === null ? false : zoomTo(itemPos)(state, dispatch)
}

/** `Mod-Shift-.`: zoom out one level (to the parent item, or fully when the zoomed item is top-level). */
const zoomOutOneLevel: Command = (state, dispatch) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const parents = ancestorItemPositions(state.doc.resolve(itemPos))
  return zoomTo(parents.length > 0 ? parents[parents.length - 1] : null)(state, dispatch)
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
    // ⌘-click: that level in a new tab behind; ⇧-click: in front, as on a dot (YAZ-3647 E2). The title crumb opens the whole page.
    const open = pluginKey.getState(view.state)?.onOpen
    if (open !== undefined && (event.metaKey || event.shiftKey)) {
      const key = target === null ? null : zoomKeyAt(view.state.doc, target)
      if (target === null || key !== null) return open(key, event.metaKey, target === null ? null : zoomLabelAt(view.state.doc, target))
    }
    zoomTo(target)(view.state, view.dispatch)
  })
  return button
}

const buildDecorations = (state: EditorState, itemPos: number, title: string): Decoration[] => {
  const $item = state.doc.resolve(itemPos)
  const zoomed = $item.nodeAfter
  const decorations: Decoration[] = []
  if (!isListItem(zoomed)) return decorations
  const crumbs: Array<{ label: string; target: ZoomLevel }> = [{ label: title, target: null }]

  // Walk the containers on the path root → zoomed item; hide every child that is off the path.
  for (let depth = 0; depth <= $item.depth; depth++) {
    const container = $item.node(depth)
    if (isListItem(container)) {
      const pos = $item.before(depth)
      decorations.push(Decoration.node(pos, pos + container.nodeSize, { class: ZOOM_ANCESTOR_CLASS }))
      crumbs.push({ label: itemLabel(container), target: pos })
    }
    const pathIndex = $item.index(depth)
    container.forEach((child, _offset, index) => {
      if (index === pathIndex) return
      const pos = $item.posAtIndex(index, depth)
      decorations.push(Decoration.node(pos, pos + child.nodeSize, { class: ZOOM_HIDDEN_CLASS }))
    })
  }
  crumbs.push({ label: itemLabel(zoomed), target: itemPos })

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
        return nav
      },
      { side: -1, key: `outline-zoom-crumbs:${itemPos}:${crumbs.map((c) => c.label).join('\u0000')}` },
    ),
  )
  return decorations
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

export const createOutlineZoom = ({ title, startKey = null, onZoom, onOpen }: ZoomOptions) => {
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
            return { itemPos: key === null ? null : itemPosForZoomKey(state.doc, key), onZoom, onOpen, undoLevel: undefined, changes: 0 }
          },
          apply: (transaction, previous, _oldState, newState) => {
            const meta: ZoomLevel | undefined = transaction.getMeta(pluginKey)
            if (meta !== undefined) {
              // ⌘Z-revertible while it is the latest view action; the revert itself consumes it.
              return { ...previous, itemPos: meta, undoLevel: transaction.getMeta(UNDO_META) ? undefined : previous.itemPos, changes: previous.changes + 1 }
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
                undoLevel = !mappedLast.deleted && isListItem(newState.doc.nodeAt(mappedLast.pos)) ? mappedLast.pos : undefined
              }
              if (itemPos !== null) {
                const mapped = transaction.mapping.mapResult(itemPos, 1)
                itemPos = !mapped.deleted && isListItem(newState.doc.nodeAt(mapped.pos)) ? mapped.pos : null
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
            const itemPos = getZoomedItemPos(state)
            if (itemPos === null) return DecorationSet.empty
            return DecorationSet.create(state.doc, buildDecorations(state, itemPos, title()))
          },
          handleDOMEvents: {
            click: (view, event) => {
              const itemPos = itemPosFromGlyphClick(view, event)
              if (itemPos === null) return false
              event.preventDefault()
              // ⌘-click: the bullet in a new tab behind; ⇧-click: in front (YAZ-3646 D10). A page with no tab zooms in place.
              const open = pluginKey.getState(view.state)?.onOpen
              const key = open !== undefined && (event.metaKey || event.shiftKey) ? zoomKeyAt(view.state.doc, itemPos) : null
              if (key !== null) open?.(key, event.metaKey, zoomLabelAt(view.state.doc, itemPos))
              else zoomTo(itemPos)(view.state, view.dispatch)
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
