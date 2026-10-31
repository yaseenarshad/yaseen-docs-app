/**
 * Column resize (YAZ-3696 D2): `prosemirror-tables`' `columnResizing` as installed (not vendored). The table
 * block draws the `<colgroup>` (`View: null`); the drag writes `colwidth` once, on mouseup.
 *
 * - ORDER: ProseMirror gives a mousedown to the plugins in order and stops at the first that takes it. A grip
 *   drag must not also start `tableEditing`'s cell selection drag (B2), so the plugin goes in just BEFORE
 *   `tableEditing`, which keeps its own place (a plain `$prose` would land after it).
 * - DOCUMENT ZOOM (R2): the plugin adds the mouse travel in screen px to a width in layout px, so under the CSS
 *   zoom on `.ProseMirror` the edge ran ahead of (or behind) the cursor. While an edge drags, a window capture
 *   listener gives each `mousemove`/`mouseup` the travel in layout px, before the plugin reads it.
 * - HEADER ROW ONLY (YAZ-3800, 2D): as in Sheets, a column resizes only from a header cell's edge. Over a body
 *   cell (`td`) the plugin's mousemove clears the grip (its own `mouseleave` code), and its mousedown does not
 *   run, so `tableEditing` starts a cell selection there.
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import { columnResizing, columnResizingPluginKey, tableEditingKey } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cssZoom } from '../../lib/cssZoom'

function zoomedDrag(view: EditorView) {
  const win = view.dom.ownerDocument.defaultView ?? window
  const toLayout = (event: MouseEvent) => {
    const dragging = columnResizingPluginKey.getState(view.state)?.dragging
    const zoom = cssZoom(view.dom)
    if (!dragging || zoom === 1) return
    Object.defineProperty(event, 'clientX', { value: dragging.startX + (event.clientX - dragging.startX) / zoom })
  }
  win.addEventListener('mousemove', toLayout, true)
  win.addEventListener('mouseup', toLayout, true)
  return {
    destroy() {
      win.removeEventListener('mousemove', toLayout, true)
      win.removeEventListener('mouseup', toLayout, true)
    },
  }
}

const inBody = (event: Event) => event.target instanceof Element && event.target.closest('td, th')?.tagName === 'TD'

/** `columnResizing` with its grip on the header row only: the same key, state and decorations. */
function headerResizing(): Plugin {
  const { spec } = columnResizing({ View: null, cellMinWidth: 60 })
  const { mousemove, mouseleave, mousedown } = spec.props!.handleDOMEvents!
  return new Plugin({
    ...spec,
    props: {
      ...spec.props,
      handleDOMEvents: {
        mousemove(view, event) {
          return inBody(event) ? mouseleave!.call(this, view, event) : mousemove!.call(this, view, event)
        },
        mouseleave,
        mousedown(view, event) {
          return inBody(event) ? false : mousedown!.call(this, view, event)
        },
      },
    },
  })
}

export const tableColumnResize: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  const plugins = [headerResizing(), new Plugin({ view: zoomedDrag })]
  ctx.update(prosePluginsCtx, (ps) => {
    const at = ps.findIndex((plugin) => plugin.spec.key === tableEditingKey)
    return at < 0 ? [...ps, ...plugins] : [...ps.slice(0, at), ...plugins, ...ps.slice(at)]
  })
  return () => {
    ctx.update(prosePluginsCtx, (ps) => ps.filter((plugin) => !plugins.includes(plugin)))
  }
}
