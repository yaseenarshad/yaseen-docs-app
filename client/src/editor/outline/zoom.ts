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
 *    zooms to that ancestor; the file-name crumb zooms out fully.
 * Zooming dispatches a metadata-only transaction (`tr.docChanged === false`), so the listener never
 * fires `markdownUpdated`, the file on disk is untouched and fold state is unaffected. Zoom is not
 * persisted: switching files remounts the editor and therefore clears it.
 *
 * Triggers: click on the bullet glyph (`.label-wrapper`; task checkboxes keep toggling instead),
 * `Mod-.` = zoom into the item at the caret, `Mod-Shift-.` = zoom out one level. While zoomed,
 * `Shift-Tab` / `Mod-[` on the zoomed item or one of its direct children is a no-op (lifting would
 * move the item out of the visible subtree).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'

export interface ZoomOptions {
  /** Shown as the first breadcrumb; clicking it zooms out fully. */
  fileName: string
}

interface ZoomState {
  /** Position of the zoomed list_item, or null when not zoomed. */
  itemPos: number | null
}

/** Transaction meta: zoom to the list_item at this position, or `null` to zoom out fully. */
type ZoomMeta = number | null

export const ZOOM_HIDDEN_CLASS = 'outline-zoom-hidden'
export const ZOOM_ANCESTOR_CLASS = 'outline-zoom-ancestor'
export const ZOOM_CRUMBS_CLASS = 'outline-zoom-crumbs'
export const ZOOM_CRUMB_CLASS = 'outline-zoom-crumb'

const LABEL_MAX_CHARS = 40
/** Priority above Crepe's keymaps (50), like `listCommands.ts` / `hotkeys.ts`. */
const PRIORITY = 100

const pluginKey = new PluginKey<ZoomState>('mdapp-outline-zoom')

const isListItem = (node: ProseNode | null | undefined): node is ProseNode => node?.type.name === 'list_item'

/** Position of the zoomed list_item (null when not zoomed or when the plugin is absent). */
export const getZoomedItemPos = (state: EditorState): number | null => pluginKey.getState(state)?.itemPos ?? null

/** First-block text of a list item, trimmed and truncated for the breadcrumb. */
export const itemLabel = (item: ProseNode): string => {
  const text = item.firstChild?.textContent.trim() || 'Untitled item'
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : text
}

/** Positions of the list_item ancestors of `$pos` (outermost first); `$pos` itself may sit inside an item. */
const ancestorItemPositions = ($pos: ResolvedPos): number[] => {
  const positions: number[] = []
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if (isListItem($pos.node(depth))) positions.push($pos.before(depth))
  }
  return positions
}

/** Position of the innermost list_item containing the selection head, or null outside lists. */
const itemAtSelection = (state: EditorState): number | null => {
  const positions = ancestorItemPositions(state.selection.$from)
  return positions.length > 0 ? positions[positions.length - 1] : null
}

/** Zoom into the list_item at `itemPos`; moves the caret into it if the selection was outside. */
export const zoomTo = (itemPos: ZoomMeta): Command => (state, dispatch) => {
  const zoom = pluginKey.getState(state)
  if (!zoom || zoom.itemPos === itemPos) return false
  if (itemPos !== null && !isListItem(state.doc.nodeAt(itemPos))) return false
  if (dispatch) {
    const tr = state.tr.setMeta(pluginKey, itemPos)
    if (itemPos !== null) {
      const item = state.doc.nodeAt(itemPos)
      const { from, to } = state.selection
      const inside = item !== null && from >= itemPos && to <= itemPos + item.nodeSize
      if (!inside) tr.setSelection(Selection.near(tr.doc.resolve(itemPos + 1), 1))
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** `Mod-.`: zoom into the item at the caret. */
export const zoomIntoSelection: Command = (state, dispatch) => {
  const itemPos = itemAtSelection(state)
  return itemPos === null ? false : zoomTo(itemPos)(state, dispatch)
}

/** `Mod-Shift-.`: zoom out one level (to the parent item, or fully when the zoomed item is top-level). */
export const zoomOutOneLevel: Command = (state, dispatch) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const parents = ancestorItemPositions(state.doc.resolve(itemPos))
  return zoomTo(parents.length > 0 ? parents[parents.length - 1] : null)(state, dispatch)
}

/**
 * Swallow a lift (`Shift-Tab` / `Mod-[`) that would move the caret's item out of the zoomed
 * subtree: the zoomed item itself or one of its direct children.
 */
const blockEscapingLift: Command = (state) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const positions = ancestorItemPositions(state.selection.$from)
  const index = positions.indexOf(itemPos)
  return index >= 0 && positions.length - index <= 2
}

const crumbButton = (view: EditorView, label: string, target: ZoomMeta, current: boolean): HTMLButtonElement => {
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
    zoomTo(target)(view.state, view.dispatch)
  })
  return button
}

const buildDecorations = (state: EditorState, itemPos: number, fileName: string): Decoration[] => {
  const $item = state.doc.resolve(itemPos)
  const zoomed = $item.nodeAfter
  const decorations: Decoration[] = []
  if (!isListItem(zoomed)) return decorations
  const crumbs: Array<{ label: string; target: ZoomMeta }> = [{ label: fileName, target: null }]

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

export const createOutlineZoom = ({ fileName }: ZoomOptions) =>
  $prose(
    () =>
      new Plugin<ZoomState>({
        key: pluginKey,
        state: {
          init: () => ({ itemPos: null }),
          apply: (transaction, previous, _oldState, newState) => {
            const meta: ZoomMeta | undefined = transaction.getMeta(pluginKey)
            if (meta !== undefined) return { itemPos: meta }
            if (previous.itemPos === null || !transaction.docChanged) return previous
            const mapped = transaction.mapping.mapResult(previous.itemPos, 1)
            if (mapped.deleted || !isListItem(newState.doc.nodeAt(mapped.pos))) return { itemPos: null }
            return { itemPos: mapped.pos }
          },
        },
        props: {
          decorations: (state) => {
            const itemPos = getZoomedItemPos(state)
            if (itemPos === null) return DecorationSet.empty
            return DecorationSet.create(state.doc, buildDecorations(state, itemPos, fileName))
          },
          handleDOMEvents: {
            click: (view, event) => {
              const itemPos = itemPosFromGlyphClick(view, event)
              if (itemPos === null) return false
              event.preventDefault()
              zoomTo(itemPos)(view.state, view.dispatch)
              return true
            },
          },
        },
      }),
  )

/** Keymap: `Mod-.` / `Mod-Shift-.` plus the escape guard; register with `editor.use(zoomKeymap)`. */
export const zoomKeymap = $shortcut((_ctx: Ctx) => ({
  ZoomIn: { key: 'Mod-.', priority: PRIORITY, onRun: () => zoomIntoSelection },
  ZoomOut: { key: 'Mod-Shift-.', priority: PRIORITY, onRun: () => zoomOutOneLevel },
  ZoomLiftGuardTab: { key: 'Shift-Tab', priority: PRIORITY, onRun: () => blockEscapingLift },
  ZoomLiftGuardBracket: { key: 'Mod-[', priority: PRIORITY, onRun: () => blockEscapingLift },
}))
