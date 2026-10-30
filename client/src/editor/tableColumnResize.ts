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
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import { columnResizing, columnResizingPluginKey, tableEditingKey } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'

function zoomedDrag(view: EditorView) {
  const win = view.dom.ownerDocument.defaultView ?? window
  const toLayout = (event: MouseEvent) => {
    const dragging = columnResizingPluginKey.getState(view.state)?.dragging
    const zoom = (view.dom as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
    if (!dragging || zoom === undefined || !(zoom > 0) || zoom === 1) return
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

export const tableColumnResize: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  const plugins = [columnResizing({ View: null, cellMinWidth: 60 }), new Plugin({ view: zoomedDrag })]
  ctx.update(prosePluginsCtx, (ps) => {
    const at = ps.findIndex((plugin) => plugin.spec.key === tableEditingKey)
    return at < 0 ? [...ps, ...plugins] : [...ps.slice(0, at), ...plugins, ...ps.slice(at)]
  })
  return () => {
    ctx.update(prosePluginsCtx, (ps) => ps.filter((plugin) => !plugins.includes(plugin)))
  }
}
