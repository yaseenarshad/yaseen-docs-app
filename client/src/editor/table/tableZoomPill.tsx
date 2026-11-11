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
 * - THE VALUE: the widget renders the table's `zoom` at its position. A transaction that changes a table's `zoom` (or
 *   replaces a whole table) gives it a new pill decoration, which keeps the DOM (one key); the plugin view renders
 *   again only those pills (YAZ-4176), never on an Enter or a paste. Typing only maps the set (`tableSpeed.test.ts`).
 * - THE NOTE EDITOR ONLY (`tableZoomPill` of `createCrepe`, YAZ-4176): a hover preview, a read-only preview and the
 *   outline view mount no plugin, so no React root for each table.
 * - A SUPER TABLE (YAZ-4869 S2): the same anchor draws its tabs, left of the pill, and its active view, from the lazy
 *   `super/SuperTable.tsx` (loaded the first time a Super table shows). A pill's spec holds `superTable` too, so a turn
 *   on or off draws it again; `super/superTables.ts` asks the anchor to draw again when its table changed
 *   (`renderSuper`, debounced 150 ms while you type in it) and when ⌘F finds a row in it (`findRow`). A draw for the same
 *   table node, view and found row does nothing.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'
import { DocumentZoom } from '../DocumentZoom'
import { changedTables, typingOnly } from './tableStyle'
import { activeViewAt, type SuperAnchor } from './super/superTables'
import type { SuperTableProps } from './super/SuperTable'

interface ZoomState {
  set: DecorationSet
  /** Counts each transaction that gave a table a new pill: the plugin view looks for them only when it moves. */
  generation: number
}

const zoomKey = new PluginKey<ZoomState>('mdapp-table-zoom')

/** An anchor that renders its pill from the table at its position. */
interface ZoomAnchor extends SuperAnchor {
  renderZoom?: () => void
}

/** The debounce of a Super table's view while you type in it (YAZ-4869 item 20). */
export const SUPER_TYPING_MS = 150

let SuperTable: ComponentType<SuperTableProps> | null = null
let superLoad: Promise<void> | null = null

/** The lazy Super table chunk, loaded once; a test awaits it. */
export function loadSuperTable(): Promise<void> {
  superLoad ??= import('./super/SuperTable').then((mod) => {
    SuperTable = mod.SuperTable
  })
  return superLoad
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
  let drawn: { table: ProseNode; active: string | null; found: SuperTableProps['found']; ready: boolean } | null = null
  let found: SuperTableProps['found'] = null
  let timer: ReturnType<typeof setTimeout> | null = null
  anchor.renderZoom = () => {
    const pos = getPos()
    const table = pos === undefined ? null : view.state.doc.nodeAt(pos)
    if (table?.type.name !== 'table') return
    const isSuper = table.attrs.superTable === true
    const active = isSuper ? activeViewAt(view.state, pos!) : null
    // The same table node, view and find: nothing to draw (YAZ-4869 item 20).
    if (drawn !== null && drawn.table === table && drawn.active === active && drawn.found === found && drawn.ready === (SuperTable !== null)) return
    drawn = { table, active, found, ready: SuperTable !== null }
    const zoom = table.attrs.zoom as number
    anchor.toggleAttribute('data-zoomed', zoom !== 100)
    anchor.toggleAttribute('data-super', isSuper)
    anchor.toggleAttribute('data-super-view', active !== null)
    if (isSuper && SuperTable === null) void loadSuperTable().then(() => anchor.renderZoom?.())
    const Super = isSuper ? SuperTable : null
    flushSync(() =>
      root.render(
        <>
          {Super !== null && <Super editor={view} getPos={getPos} table={table} active={active} found={found} />}
          <DocumentZoom value={zoom} label="Table zoom" onChange={(next) => setZoom(view, getPos(), next)} />
        </>,
      ),
    )
    // The tabs stand left of the pill: its width, read only when a Super table draws.
    if (isSuper) anchor.style.setProperty('--table-pill-w', `${anchor.querySelector<HTMLElement>('.document-zoom')?.offsetWidth || 112}px`)
  }
  anchor.renderSuper = (typing) => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!typing) return anchor.renderZoom?.()
    timer = setTimeout(() => {
      timer = null
      anchor.renderZoom?.()
    }, SUPER_TYPING_MS)
  }
  anchor.findRow = (row) => {
    found = { row, n: (found?.n ?? 0) + 1 }
    anchor.renderZoom?.()
  }
  anchor.addEventListener('table-zoom-unmount', () => {
    if (timer !== null) clearTimeout(timer)
    queueMicrotask(() => root.unmount())
  })
  anchor.renderZoom()
  return anchor
}

const pill = (pos: number, zoom: unknown, superTable: unknown): Decoration =>
  Decoration.widget(pos, zoomAnchor, {
    key: 'table-zoom',
    tableZoom: true,
    zoom,
    superTable,
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
    out.push(pill(pos, node.attrs.zoom, node.attrs.superTable))
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
          let fresh = false
          for (const [pos, node] of changedTables(tr)) {
            const stale = set.find(pos, pos, (spec) => spec.tableZoom === true)
            // Same zoom, same Super table switch: the pill holds. A table replaced whole loses its widget, and gets a new one.
            if (stale.length > 0 && stale.every((deco) => deco.spec.zoom === node.attrs.zoom && deco.spec.superTable === node.attrs.superTable)) continue
            if (stale.length > 0) set = set.remove(stale)
            set = set.add(tr.doc, [pill(pos, node.attrs.zoom, node.attrs.superTable)])
            fresh = true
          }
          return { set, generation: value.generation + (fresh ? 1 : 0) }
        },
      },
      props: { decorations: (state) => zoomKey.getState(state)!.set },
      view: () => ({
        update: (view, prev) => {
          const before = zoomKey.getState(prev)!
          const after = zoomKey.getState(view.state)!
          if (before.generation === after.generation) return
          // A new pill has a new spec; a mapped one keeps its own. Its widget's DOM goes right before its table's block.
          const kept = new Set(before.set.find().map((deco) => deco.spec))
          for (const deco of after.set.find()) {
            if (kept.has(deco.spec)) continue
            const anchor = view.nodeDOM(deco.from)?.previousSibling as ZoomAnchor | null | undefined
            if (anchor instanceof HTMLElement && anchor.classList.contains('table-zoom-anchor')) anchor.renderZoom?.()
          }
        },
      }),
    }),
)
