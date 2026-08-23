/**
 * Right-click on the 6-dot block handle opens a `.ctx-menu` popup (YAZ-726). Rows are data
 * from a provider called at open time with the handle's target; the plugin never knows what
 * a row does.
 *
 * Event order in the browser is doc-capture mousedown → Crepe's handle mousedown (dispatches
 * a NodeSelection + focus) → doc-capture contextmenu, and Crepe's mouseup re-focuses in a rAF.
 * So right-button mousedown/mouseup on the handle are stopped at document capture (no
 * preventDefault, same idiom as multiBlockDrag) and the menu opens on contextmenu. The handle
 * lives in `view.dom.parentElement` and tabs keep hidden editors mounted, so only this
 * editor's own handle is handled.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { handleTargetPos, isDragHandleGrab, type HandleTarget } from './blockHandleTarget'

export interface MenuRow {
  label: string
  disabled?: boolean
  run: () => void
}

/** Called at open time with the handle's target (from blockHandleTarget.handleTargetPos). */
export type RowProvider = (view: EditorView, target: HandleTarget) => MenuRow[]

export const createBlockHandleMenu = (rows: RowProvider) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-block-handle-menu'),
        view: (view) => {
          const popup = document.createElement('div')
          popup.className = 'ctx-menu ctx-menu--editor'
          popup.setAttribute('role', 'menu')
          popup.hidden = true
          view.dom.parentElement?.appendChild(popup)

          const close = () => {
            popup.hidden = true
          }
          const own = (t: EventTarget | null) => t instanceof Node && (view.dom.parentElement?.contains(t) ?? false)
          const rightGrab = (e: MouseEvent) => e.button === 2 && isDragHandleGrab(e.target) && own(e.target)

          const render = (items: MenuRow[]) => {
            popup.replaceChildren()
            for (const row of items) {
              const item = document.createElement('button')
              item.type = 'button'
              item.className = 'ctx-menu__item'
              item.setAttribute('role', 'menuitem')
              item.disabled = row.disabled === true
              item.textContent = row.label
              item.addEventListener('mousedown', (e) => e.preventDefault())
              item.addEventListener('click', () => {
                row.run()
                close()
              })
              popup.appendChild(item)
            }
          }

          const onMouseDown = (e: MouseEvent) => {
            if (rightGrab(e)) e.stopImmediatePropagation()
            else if (!(e.target instanceof Node && popup.contains(e.target))) close()
          }
          const onMouseUp = (e: MouseEvent) => {
            if (rightGrab(e)) e.stopImmediatePropagation()
          }
          const onContextMenu = (e: MouseEvent) => {
            if (!isDragHandleGrab(e.target) || !own(e.target)) return
            e.preventDefault()
            e.stopImmediatePropagation()
            const target = handleTargetPos(view, e)
            if (target === null) return
            const items = rows(view, target)
            if (items.length === 0) return
            render(items)
            popup.hidden = false
            const r = popup.getBoundingClientRect()
            popup.style.left = `${Math.max(0, Math.min(e.clientX, window.innerWidth - r.width))}px`
            popup.style.top = `${Math.max(0, Math.min(e.clientY, window.innerHeight - r.height))}px`
          }
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close()
          }

          document.addEventListener('mousedown', onMouseDown, true)
          document.addEventListener('mouseup', onMouseUp, true)
          document.addEventListener('contextmenu', onContextMenu, true)
          document.addEventListener('scroll', close, true)
          window.addEventListener('keydown', onKeyDown)
          window.addEventListener('blur', close)
          return {
            update: (v, prevState) => {
              if (v.state.doc !== prevState.doc) close()
            },
            destroy: () => {
              document.removeEventListener('mousedown', onMouseDown, true)
              document.removeEventListener('mouseup', onMouseUp, true)
              document.removeEventListener('contextmenu', onContextMenu, true)
              document.removeEventListener('scroll', close, true)
              window.removeEventListener('keydown', onKeyDown)
              window.removeEventListener('blur', close)
              popup.remove()
            },
          }
        },
      }),
  )
