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
 *
 * An item is a row (a label and a run) or, since YAZ-3164 (🔒 D3), a NUMBER FIELD in the shape of
 * the document zoom menu (`DocumentZoom.tsx`), on that menu's own CSS classes: a labelled box for a
 * typed number, then its presets, each part after a divider. The first box takes the focus with
 * its text selected when the menu opens. Enter applies a valid value (the unit is optional) and
 * closes; a bad value shows the field's error, marks the box `aria-invalid` and keeps the menu
 * open, and typing clears it. A preset click applies and closes; the current one is pressed and
 * shows ✓. The current value applies nothing — no run, so no document change and no undo step.
 * Escape, a click away, a scroll and a window blur close with no change, as for rows; when the
 * focus was in the menu it goes back to the editor.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { handleTargetPos, isOwnHandleGrab, type HandleTarget } from './blockHandleTarget'

export interface MenuRow {
  kind?: 'row'
  label: string
  disabled?: boolean
  run: () => void
}

/** A typed number with presets (YAZ-3164 D3): the zoom menu's box and presets, in the block menu. */
export interface MenuNumberField {
  kind: 'number'
  /** The box's label, e.g. "Line darkness". */
  label: string
  unit: '%' | 'px'
  /** The current value, the default resolved (never null): what the box shows and the pressed preset. */
  value: number
  presets: number[]
  /** The default: its preset reads "<n><unit> (default)". */
  fallback: number
  min: number
  max: number
  /** What a bad value shows, e.g. "Use a whole number from 5–100%." */
  error: string
  /** A new value only: the current value never runs. */
  run: (value: number) => void
}

export type MenuItem = MenuRow | MenuNumberField

/** Called at open time with the handle's target (from blockHandleTarget.handleTargetPos) and the editor ctx. */
export type RowProvider = (view: EditorView, target: HandleTarget, ctx: Ctx) => MenuItem[]

/** A whole number in the field's range, with or without its unit, or null. */
export const parseNumberField = (field: Pick<MenuNumberField, 'unit' | 'min' | 'max'>, draft: string): number | null => {
  const match = /^(\d{1,3})\s*(%|px)?$/.exec(draft.trim())
  if (match === null || (match[2] !== undefined && match[2] !== field.unit)) return null
  const value = Number(match[1])
  return value >= field.min && value <= field.max ? value : null
}

const divider = (): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'document-zoom__divider'
  el.setAttribute('aria-hidden', 'true')
  return el
}

let fieldIds = 0

/** The box, a divider and the presets of one number field: DocumentZoom's markup, built by hand. */
function renderNumberField(field: MenuNumberField, close: () => void): HTMLElement[] {
  const id = `block-menu-field-${++fieldIds}`
  const apply = (value: number) => {
    if (value !== field.value) field.run(value)
    close()
  }
  const custom = document.createElement('div')
  custom.className = 'document-zoom__custom'
  const label = document.createElement('label')
  label.htmlFor = id
  label.textContent = field.label
  const input = document.createElement('input')
  input.id = id
  input.inputMode = 'numeric'
  input.title = `${field.label} (${field.min}–${field.max}${field.unit})`
  input.value = `${field.value}${field.unit}`
  input.setAttribute('aria-invalid', 'false')
  const error = document.createElement('div')
  error.id = `${id}-error`
  error.className = 'document-zoom__error'
  error.setAttribute('role', 'alert')
  error.textContent = field.error
  const clearError = () => {
    error.remove()
    input.setAttribute('aria-invalid', 'false')
    input.removeAttribute('aria-describedby')
  }
  input.addEventListener('focus', () => input.select())
  input.addEventListener('input', clearError)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const value = parseNumberField(field, input.value)
      if (value !== null) apply(value)
      else {
        input.setAttribute('aria-invalid', 'true')
        input.setAttribute('aria-describedby', error.id)
        custom.appendChild(error)
      }
    } else if (event.key === 'Escape') {
      // The box's own Escape: the menu closes and nothing else hears it (the zoom menu does the same).
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  custom.append(label, input)
  const presets = document.createElement('div')
  presets.className = 'document-zoom__presets'
  presets.setAttribute('role', 'group')
  presets.setAttribute('aria-label', `${field.label} presets`)
  for (const preset of field.presets) {
    const button = document.createElement('button')
    button.type = 'button'
    const current = preset === field.value
    button.setAttribute('aria-pressed', String(current))
    const text = document.createElement('span')
    text.textContent = `${preset}${field.unit}${preset === field.fallback ? ' (default)' : ''}`
    const check = document.createElement('span')
    check.setAttribute('aria-hidden', 'true')
    check.textContent = current ? '✓' : ''
    button.append(text, check)
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', () => apply(preset))
    presets.appendChild(button)
  }
  return [custom, divider(), presets]
}

/**
 * Draws the popup into `parent`, unplaced: a clicked row runs, then `close`; a number field applies
 * as the header says. The first number box takes the focus (no scroll: the popup is not placed
 * yet). Exported for the id link's menu (`wikilink/wikilinkMenu.ts`, YAZ-2293) — the same rows,
 * on another target.
 */
export function renderMenu(parent: HTMLElement | null, items: MenuItem[], close: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ctx-menu ctx-menu--editor'
  el.setAttribute('role', 'menu')
  for (const row of items) {
    if (row.kind === 'number') {
      if (el.childElementCount > 0) el.appendChild(divider())
      el.append(...renderNumberField(row, close))
      continue
    }
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
    el.appendChild(item)
  }
  parent?.appendChild(el)
  const box = el.querySelector('input')
  if (box !== null) {
    box.focus({ preventScroll: true })
    box.select()
  }
  return el
}

export const createBlockHandleMenu = (rows: RowProvider) =>
  $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('mdapp-block-handle-menu'),
        view: (view) => {
          // Exists only while open: `.ctx-menu` means "open" everywhere (the sidebar menu is
          // mounted only while open too), so nothing lingers per mounted editor.
          let popup: HTMLElement | null = null

          const close = () => {
            // A number box had the focus: it goes back to the editor, not to the page.
            const hadFocus = popup !== null && popup.contains(document.activeElement)
            popup?.remove()
            popup = null
            if (hadFocus) view.focus()
          }
          const rightGrab = (e: MouseEvent) => e.button === 2 && isOwnHandleGrab(view, e.target)

          const onMouseDown = (e: MouseEvent) => {
            if (rightGrab(e)) e.stopImmediatePropagation()
            else if (popup === null || !(e.target instanceof Node && popup.contains(e.target))) close()
          }
          const onMouseUp = (e: MouseEvent) => {
            if (rightGrab(e)) e.stopImmediatePropagation()
          }
          const onContextMenu = (e: MouseEvent) => {
            if (!isOwnHandleGrab(view, e.target)) return
            e.preventDefault()
            e.stopImmediatePropagation()
            const target = handleTargetPos(view, e)
            if (target === null) return
            const items = rows(view, target, ctx)
            if (items.length === 0) return
            close()
            popup = renderMenu(view.dom.parentElement, items, close)
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
              close()
            },
          }
        },
      }),
  )
