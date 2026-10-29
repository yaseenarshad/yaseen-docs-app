/**
 * Right-click on the 6-dot block handle, or on a bullet's own dot (YAZ-3646 D8), opens a `.ctx-menu` popup (YAZ-726). Rows are data
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
 * An item is a row (a label and a run) or, since YAZ-3164, a PICKER (🔒 D3 as amended in the guided
 * test): one row with the name on the left and a value button on the right ("50% ▾"). A picker is a
 * number field (`kind: 'number'`) or a choice (`kind: 'choice'`). The menu opens with every picker
 * closed and takes no focus (S80). A click on a value opens that picker's panel and closes any
 * other (S81); a second click closes it (S82). A number field's panel is the document zoom menu's
 * (`DocumentZoom.tsx`), on its own CSS classes: a box for a typed number, focused and selected, a
 * divider, then its presets. A choice's panel lists its choices, each with an optional sample. Each
 * list starts with "Default (<the current default>)", which picks null, and a picker that follows
 * the default reads that on its value button (YAZ-3208 D11). Enter in the box, a preset or a choice
 * applies and closes the whole menu (S83); a bad number shows the field's error, marks the box
 * `aria-invalid` and keeps the menu open, and typing clears it. The current one is pressed and
 * shows ✓, and picking it applies nothing — no run, so no document change and no undo step. Tab
 * from the editor, while the menu shows, goes to the first value button (the outliner would take it
 * otherwise); Enter or Space opens a picker (S84). Escape, a click away, a scroll and a window blur
 * close with no change, as for rows; when the focus was in the menu it goes back to the editor.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { bulletDotTarget, handleTargetPos, isOwnHandleGrab, type HandleTarget } from './blockHandleTarget'

export interface MenuRow {
  kind?: 'row'
  label: string
  disabled?: boolean
  /** Drawn in the warning colour: a row that takes something away ("Remove link"). */
  danger?: boolean
  /** A line above the row: the link menu's groups (YAZ-3609 D23). */
  divider?: boolean
  run: () => void
  /** Rows of one kind stand together, and a line parts two kinds (YAZ-3646 D9), as the tab menu's groups do. */
  group?: string
  /** A glyph before the label (YAZ-3646 D8), made when the menu opens; it holds no text, so the label stays bare. */
  icon?: () => SVGElement
  /** The click or key that does it too, at the right edge (`data-hint`, drawn by CSS as the tab menu's are). */
  hint?: string
}

/** A typed number with presets (YAZ-3164 D3): a picker row whose panel is the zoom menu's box and presets. */
export interface MenuNumberField {
  kind: 'number'
  /** The row's name, e.g. "Line darkness"; also the box's accessible name. */
  label: string
  unit: '%' | 'px'
  /** The current value, or null when the block follows the default (YAZ-3208 D11): the value button, the box and the pressed item. */
  value: number | null
  presets: number[]
  /** The current default: the first item reads "Default (<n><unit>)" and picks null. */
  fallback: number
  min: number
  max: number
  /** What a bad value shows, e.g. "Use a whole number from 5–100%." */
  error: string
  /** A new value only (null: the "Default" item): the current value never runs. */
  run: (value: number | null) => void
}

/** One choice of a choice picker; `sample` is a class list for a small drawn sample before the label. */
export interface MenuChoice {
  value: string
  label: string
  sample?: string
}

/** A pick from a short list (YAZ-3164 D7, "Line style"): a picker row whose panel lists the choices. */
export interface MenuChoiceField {
  kind: 'choice'
  label: string
  /** The current choice's value, or null when the block follows the default (YAZ-3208 D11). */
  value: string | null
  choices: MenuChoice[]
  /** The current default choice's value: the first item reads "Default (<its label>)" with its sample, and picks null. */
  fallback: string
  /** A new value only (null: the "Default" item): the current value never runs. */
  run: (value: string | null) => void
}

export type MenuItem = MenuRow | MenuNumberField | MenuChoiceField

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

/** A preset or choice button in the zoom menu's shape: the text (and a sample) left, ✓ right when current. */
function optionButton(text: string, current: boolean, apply: () => void, sample?: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-pressed', String(current))
  const name = document.createElement('span')
  if (sample !== undefined) {
    const drawn = document.createElement('span')
    drawn.className = `block-menu-picker__sample ${sample}`
    drawn.setAttribute('aria-hidden', 'true')
    name.appendChild(drawn)
  }
  name.append(text)
  const check = document.createElement('span')
  check.setAttribute('aria-hidden', 'true')
  check.textContent = current ? '✓' : ''
  button.append(name, check)
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', apply)
  return button
}

const optionList = (label: string, buttons: HTMLButtonElement[]): HTMLElement => {
  const list = document.createElement('div')
  list.className = 'document-zoom__presets'
  list.setAttribute('role', 'group')
  list.setAttribute('aria-label', label)
  list.append(...buttons)
  return list
}

/** A number field's panel: the box, a divider and the presets — DocumentZoom's markup, built by hand. Returns the box too. */
function numberPanel(field: MenuNumberField, id: string, close: () => void): { parts: HTMLElement[]; box: HTMLInputElement } {
  const apply = (value: number | null) => {
    if (value !== field.value) field.run(value)
    close()
  }
  const custom = document.createElement('div')
  custom.className = 'document-zoom__custom'
  const input = document.createElement('input')
  input.id = `${id}-box`
  input.inputMode = 'numeric'
  input.setAttribute('aria-label', field.label)
  input.title = `${field.label} (${field.min}–${field.max}${field.unit})`
  input.value = `${field.value ?? field.fallback}${field.unit}`
  input.setAttribute('aria-invalid', 'false')
  const error = document.createElement('div')
  error.id = `${id}-error`
  error.className = 'document-zoom__error'
  error.setAttribute('role', 'alert')
  error.textContent = field.error
  // Typed into since the menu opened (YAZ-3222): the box starts with the current default for a field
  // that follows it, and Enter on that untouched text is no pick — the field keeps following.
  let edited = false
  input.addEventListener('focus', () => input.select())
  input.addEventListener('input', () => {
    edited = true
    error.remove()
    input.setAttribute('aria-invalid', 'false')
    input.removeAttribute('aria-describedby')
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!edited) {
        close()
        return
      }
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
  custom.appendChild(input)
  const presets = [
    optionButton(defaultLabel(field), field.value === null, () => apply(null)),
    ...field.presets.map((preset) => optionButton(`${preset}${field.unit}`, preset === field.value, () => apply(preset))),
  ]
  return { parts: [custom, divider(), optionList(`${field.label} presets`, presets)], box: input }
}

/** A choice field's panel: one button per choice, with its sample. */
function choicePanel(field: MenuChoiceField, close: () => void): HTMLElement[] {
  const pick = (value: string | null) => () => {
    if (value !== field.value) field.run(value)
    close()
  }
  const fallback = field.choices.find((c) => c.value === field.fallback)
  const buttons = [
    optionButton(defaultLabel(field), field.value === null, pick(null), fallback?.sample),
    ...field.choices.map((choice) => optionButton(choice.label, choice.value === field.value, pick(choice.value), choice.sample)),
  ]
  return [optionList(`${field.label} choices`, buttons)]
}

/** "Default (50%)", "Default (Solid)": the first item of a picker, and its value button while it follows the default (D11). */
function defaultLabel(field: MenuNumberField | MenuChoiceField): string {
  const shown = field.kind === 'number' ? `${field.fallback}${field.unit}` : (field.choices.find((c) => c.value === field.fallback)?.label ?? field.fallback)
  return `Default (${shown})`
}

/** What a picker's value button reads: the value, or "Default (…)" while it follows the default. */
function valueLabel(field: MenuNumberField | MenuChoiceField): string {
  if (field.value === null) return defaultLabel(field)
  return field.kind === 'number' ? `${field.value}${field.unit}` : (field.choices.find((c) => c.value === field.value)?.label ?? field.value)
}

/**
 * One picker: the row (name left, value button right) and its panel, closed. `toggle` opens this
 * panel and closes the menu's others, or closes it when it is open.
 */
function renderPicker(field: MenuNumberField | MenuChoiceField, menu: HTMLElement, close: () => void): HTMLElement {
  const id = `block-menu-picker-${++fieldIds}`
  const picker = document.createElement('div')
  picker.className = 'block-menu-picker'
  const row = document.createElement('div')
  row.className = 'block-menu-picker__row'
  const name = document.createElement('span')
  name.className = 'block-menu-picker__label'
  name.id = `${id}-label`
  name.textContent = field.label
  const value = document.createElement('button')
  value.type = 'button'
  value.className = 'block-menu-picker__value'
  value.setAttribute('aria-expanded', 'false')
  value.setAttribute('aria-controls', `${id}-panel`)
  value.setAttribute('aria-labelledby', `${id}-label ${id}-value`)
  const text = document.createElement('span')
  text.id = `${id}-value`
  text.textContent = valueLabel(field)
  const caret = document.createElement('span')
  caret.setAttribute('aria-hidden', 'true')
  caret.textContent = ' ▾'
  value.append(text, caret)
  row.append(name, value)
  const panel = document.createElement('div')
  panel.className = 'block-menu-picker__panel'
  panel.id = `${id}-panel`
  panel.hidden = true
  let box: HTMLInputElement | null = null
  if (field.kind === 'number') {
    const built = numberPanel(field, id, close)
    panel.append(...built.parts)
    box = built.box
  } else panel.append(...choicePanel(field, close))
  value.addEventListener('click', () => {
    const open = !panel.hidden
    for (const other of menu.querySelectorAll<HTMLElement>('.block-menu-picker__panel')) other.hidden = true
    for (const other of menu.querySelectorAll('.block-menu-picker__value')) other.setAttribute('aria-expanded', 'false')
    if (open) return
    panel.hidden = false
    value.setAttribute('aria-expanded', 'true')
    if (box !== null) {
      box.focus({ preventScroll: true })
      box.select()
    }
  })
  picker.append(row, panel)
  return picker
}

/**
 * Draws the popup into `parent`, unplaced: a clicked row runs, then `close`; a picker works as the
 * header says, every one closed, and nothing takes the focus. Exported for the id link's menu
 * (`wikilink/wikilinkMenu.ts`, YAZ-2293) — the same rows, on another target. Rows look like the tab
 * menu's (YAZ-3646 D8): a line between two groups, a glyph slot on every row once one row has a glyph,
 * and the hint at the right edge.
 */
export function renderMenu(parent: HTMLElement | null, items: MenuItem[], close: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = items.some((row) => row.kind !== 'number' && row.kind !== 'choice' && row.icon !== undefined) ? 'ctx-menu ctx-menu--editor ctx-menu--glyphs' : 'ctx-menu ctx-menu--editor'
  el.setAttribute('role', 'menu')
  let pickers = false
  let previous: MenuRow | null = null
  for (const row of items) {
    if (row.kind === 'number' || row.kind === 'choice') {
      // One divider between the rows and the pickers; the pickers sit together.
      if (!pickers && el.childElementCount > 0) el.appendChild(divider())
      pickers = true
      el.appendChild(renderPicker(row, el, close))
      continue
    }
    // A line parts two kinds of rows (YAZ-3646 D9) and stands above a row that asks for one (YAZ-3609 D23).
    if (el.childElementCount > 0 && (row.divider === true || (previous !== null && previous.group !== row.group))) el.appendChild(divider())
    previous = row
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `ctx-menu__item${row.danger === true ? ' ctx-menu__item--danger' : ''}`
    item.setAttribute('role', 'menuitem')
    item.disabled = row.disabled === true
    if (row.icon === undefined) item.textContent = row.label
    else {
      const label = document.createElement('span')
      label.className = 'ctx-menu__label'
      label.append(row.icon(), row.label)
      item.appendChild(label)
    }
    if (row.hint !== undefined) item.dataset.hint = row.hint
    item.addEventListener('mousedown', (e) => e.preventDefault())
    item.addEventListener('click', () => {
      row.run()
      close()
    })
    el.appendChild(item)
  }
  parent?.appendChild(el)
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
            // Something in the menu had the focus: it goes back to the editor, not to the page.
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
            // The 6-dot handle, or a bullet's own dot (YAZ-3646 D8): the same menu, for that bullet.
            const onHandle = isOwnHandleGrab(view, e.target)
            const dot = onHandle ? null : bulletDotTarget(view, e.target)
            if (!onHandle && dot === null) return
            e.preventDefault()
            e.stopImmediatePropagation()
            const target = dot ?? handleTargetPos(view, e)
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
          // Tab while the menu shows and the focus is still in the editor: the first value button (last
          // with Shift) takes it, before the outliner's Tab can indent (S84). Inside the menu Tab is the browser's.
          const onTab = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || popup === null || popup.contains(document.activeElement)) return
            const values = popup.querySelectorAll<HTMLButtonElement>('.block-menu-picker__value')
            const next = e.shiftKey ? values[values.length - 1] : values[0]
            if (next === undefined) return
            e.preventDefault()
            e.stopPropagation()
            next.focus({ preventScroll: true })
          }

          document.addEventListener('mousedown', onMouseDown, true)
          document.addEventListener('mouseup', onMouseUp, true)
          document.addEventListener('contextmenu', onContextMenu, true)
          document.addEventListener('scroll', close, true)
          window.addEventListener('keydown', onKeyDown)
          document.addEventListener('keydown', onTab, true)
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
              document.removeEventListener('keydown', onTab, true)
              window.removeEventListener('blur', close)
              close()
            },
          }
        },
      }),
  )
