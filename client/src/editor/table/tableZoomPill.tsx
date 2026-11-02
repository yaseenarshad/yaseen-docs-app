/**
 * The table zoom pill (YAZ-4091, YAZ-4159 D13; CONTRACTS rule 41a): the page zoom pill, `DocumentZoom` (− 100% +, the
 * presets and a typed value), on each table, for the table's own `zoom` (`tableStyle.ts`; `table.css` zooms the block's
 * content with it, so it multiplies with the page zoom).
 *
 * - THE PILL lives in a widget right before each table: a zero-height anchor (`table-zoom-anchor`) that `table.css`
 *   draws at the table block's top-right corner, outside the cells, with ONE rule (the demo decides the place). It
 *   shows while the pointer is over the table or the pill, while the pill has the focus, and always while the zoom is
 *   not 100% (`data-zoomed`); a read-only note shows none. The widget stops its events and ignores selection, so a key
 *   in the pill's field never reaches the note. One key for every pill: a rebuild keeps its DOM and its React root.
 * - A CHANGE is one transaction with the history closed: one ⌘Z.
 * - THE VALUE: the widget renders the table's `zoom` at its position; the plugin view renders every pill again only
 *   after a transaction that changed a table (`generation`). Typing only maps the set (`tableSpeed.test.ts`).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { DocumentZoom } from '../DocumentZoom'
import { changedTables, typingOnly } from './tableStyle'

interface ZoomState {
  set: DecorationSet
  /** Counts each transaction that changed a table: the plugin view renders the pills again only when it moves. */
  generation: number
}

const zoomKey = new PluginKey<ZoomState>('mdapp-table-zoom')

/** An anchor that renders its pill from the table at its position. */
interface ZoomAnchor extends HTMLElement {
  renderZoom?: () => void
}

/** The table at `pos` gets zoom `zoom`, in one transaction with the history closed. */
function setZoom(view: EditorView, pos: number | undefined, zoom: number): void {
  const table = pos === undefined ? null : view.state.doc.nodeAt(pos)
  if (table?.type.name !== 'table' || table.attrs.zoom === zoom) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos!, 'zoom', zoom))
}

function zoomAnchor(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const anchor: ZoomAnchor = document.createElement('div')
  anchor.className = 'table-zoom-anchor'
  anchor.contentEditable = 'false'
  const root = createRoot(anchor)
  anchor.renderZoom = () => {
    const pos = getPos()
    const table = pos === undefined ? null : view.state.doc.nodeAt(pos)
    if (table?.type.name !== 'table') return
    const zoom = table.attrs.zoom as number
    anchor.toggleAttribute('data-zoomed', zoom !== 100)
    flushSync(() => root.render(<DocumentZoom value={zoom} label="Table zoom" onChange={(next) => setZoom(view, getPos(), next)} />))
  }
  anchor.addEventListener('table-zoom-unmount', () => queueMicrotask(() => root.unmount()))
  anchor.renderZoom()
  return anchor
}

const pill = (pos: number): Decoration =>
  Decoration.widget(pos, zoomAnchor, {
    key: 'table-zoom',
    tableZoom: true,
    side: 1,
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: (dom: Node) => dom.dispatchEvent(new Event('table-zoom-unmount')),
  })

/** A pill before each table of `doc`. */
function pills(doc: ProseNode): Decoration[] {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    out.push(pill(pos))
    return false
  })
  return out
}

export const tableZoomPill = $prose(
  () =>
    new Plugin<ZoomState>({
      key: zoomKey,
      state: {
        init: (_, { doc }) => ({ set: DecorationSet.create(doc, pills(doc)), generation: 0 }),
        apply: (tr, value) => {
          if (!tr.docChanged) return value
          let set = value.set.map(tr.mapping, tr.doc)
          // A key changes no table: the mapped set holds.
          if (typingOnly(tr)) return { ...value, set }
          const tables = changedTables(tr)
          if (tables.size === 0) return { ...value, set }
          for (const pos of tables.keys()) {
            const stale = set.find(pos, pos, (spec) => spec.tableZoom === true)
            if (stale.length > 0) set = set.remove(stale)
            set = set.add(tr.doc, [pill(pos)])
          }
          return { set, generation: value.generation + 1 }
        },
      },
      props: { decorations: (state) => zoomKey.getState(state)!.set },
      view: () => ({
        update: (view, prev) => {
          if (zoomKey.getState(prev)!.generation === zoomKey.getState(view.state)!.generation) return
          for (const anchor of view.dom.querySelectorAll<ZoomAnchor>('.table-zoom-anchor')) anchor.renderZoom?.()
        },
      }),
    }),
)
