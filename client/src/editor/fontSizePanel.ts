/**
 * Font size popover (`fontSizePanel.ts`, YAZ-6695 D5): compact popover anchored under `[16 ▾]` (`font-size`) in the
 * selection toolbar.
 *
 *  - Stepper row: `−`, editable numeric `px` input (`8`–`96`), `+`
 *  - `Default` button (removes `font_size` mark cleanly)
 *  - Scrollable presets (`8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 60, 72, 96`)
 *
 * Keeps editor selection and focus intact (cancels mousedown on buttons), 1 undo step per pick (`closeHistory`),
 * closes on Escape, click outside, or selection change.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { closeToolbarPanels, registerToolbarPanel } from './colourPanel'
import {
  applyFontSize,
  clampFontSize,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  fontSizeSchema,
  removeFontSize,
  selectionFontSize,
  stepFontSize,
} from './marks/fontSize'
import { toolbarItemOf } from './toolbarHost'

/** Toolbar key for the `[16 ▾]` Text size button. */
export const FONT_SIZE_KEY = 'font-size'

const panels = new WeakMap<EditorView, FontSizePanel>()

export function toggleFontSizePanel(view: EditorView): void {
  panels.get(view)?.toggle()
}

class FontSizePanel {
  #el: HTMLElement | null = null
  #input!: HTMLInputElement
  #defaultBtn!: HTMLButtonElement
  #presets = new Map<number, HTMLButtonElement>()
  #unregister: () => void

  constructor(
    readonly ctx: Ctx,
    readonly view: EditorView,
  ) {
    panels.set(view, this)
    this.#unregister = registerToolbarPanel(this.close)
    view.dom.ownerDocument.addEventListener('click', this.#keyboardOpen, true)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  #type = () => fontSizeSchema.type(this.ctx)
  #anchor = (): HTMLElement | null => toolbarItemOf(this.view, FONT_SIZE_KEY)

  #keyboardOpen = (e: MouseEvent) => {
    if (e.detail !== 0 || !(e.target instanceof Element)) return
    const anchor = this.#anchor()
    if (anchor === null || !anchor.contains(e.target)) return
    e.preventDefault()
    this.toggle()
  }

  toggle(): void {
    if (this.open) this.close()
    else this.#show()
  }

  #build(): HTMLElement {
    const doc = this.view.dom.ownerDocument
    const el = doc.createElement('div')
    el.className = 'font-size-panel'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Text size')
    el.hidden = true

    const btn = (className: string, text: string, label: string, run: () => void) => {
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = className
      b.textContent = text
      b.tabIndex = -1
      b.setAttribute('aria-label', label)
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', run)
      return b
    }

    const stepper = doc.createElement('div')
    stepper.className = 'font-size-panel__stepper'
    const dec = btn('font-size-panel__step', '−', 'Decrease text size', () => this.#run(stepFontSize(this.#type(), -1)))
    const inc = btn('font-size-panel__step', '+', 'Increase text size', () => this.#run(stepFontSize(this.#type(), 1)))

    const input = doc.createElement('input')
    input.type = 'text'
    input.inputMode = 'numeric'
    input.className = 'font-size-panel__input'
    input.maxLength = 3
    input.spellcheck = false
    input.tabIndex = -1
    input.setAttribute('aria-label', 'Font size in pixels')
    input.addEventListener('keydown', this.#inputKey)
    this.#input = input

    stepper.append(dec, input, inc)

    const def = btn('font-size-panel__default', 'Default', 'Default text size', () => this.#run(removeFontSize(this.#type())))
    this.#defaultBtn = def

    const list = doc.createElement('div')
    list.className = 'font-size-panel__presets'
    for (const size of FONT_SIZE_PRESETS) {
      const item = btn('font-size-panel__preset', String(size), `${size}px`, () => this.#run(applyFontSize(this.#type(), size)))
      item.dataset.size = String(size)
      this.#presets.set(size, item)
      list.append(item)
    }

    el.append(stepper, def, list)
    return el
  }

  #render(): void {
    const size = selectionFontSize(this.view.state, this.#type())
    if (this.view.dom.ownerDocument.activeElement !== this.#input) {
      const nextVal = size === undefined ? '' : String(size ?? DEFAULT_FONT_SIZE)
      if (this.#input.value !== nextVal) this.#input.value = nextVal
    }
    const placeholder = size === undefined ? '—' : ''
    if (this.#input.placeholder !== placeholder) this.#input.placeholder = placeholder

    const isDefault = size === null
    this.#defaultBtn.classList.toggle('active', isDefault)
    this.#defaultBtn.setAttribute('aria-pressed', String(isDefault))
    for (const [preset, btn] of this.#presets) {
      const on = size === preset || (isDefault && preset === DEFAULT_FONT_SIZE)
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-pressed', String(on))
    }
  }

  #show(): void {
    closeToolbarPanels(this.close)
    const doc = this.view.dom.ownerDocument
    this.#el ??= this.#build()
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    this.#el.hidden = false
    this.#render()
    this.#place()
    this.#anchor()?.setAttribute('aria-expanded', 'true')
    doc.addEventListener('keydown', this.#key, true)
    doc.addEventListener('pointerdown', this.#outside, true)
    doc.addEventListener('mousedown', this.#outside, true)
    doc.addEventListener('scroll', this.#scrolled, true)
  }

  close = (): void => {
    if (!this.open) return
    const doc = this.view.dom.ownerDocument
    const focused = this.#el!.contains(doc.activeElement)
    this.#el!.hidden = true
    this.#anchor()?.removeAttribute('aria-expanded')
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('pointerdown', this.#outside, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#scrolled, true)
    if (focused) this.view.focus()
  }

  #place(): void {
    const el = this.#el!
    const win = this.view.dom.ownerDocument.defaultView
    const at = (this.#anchor() ?? this.view.dom).getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const roomBelow = win === null || at.bottom + 4 + height <= win.innerHeight - 8
    const top = `${Math.round(roomBelow ? at.bottom + 4 : Math.max(8, at.top - 4 - height))}px`
    const left = `${Math.round(win === null ? at.left : Math.max(8, Math.min(at.left, win.innerWidth - width - 8)))}px`
    if (el.style.top !== top) el.style.top = top
    if (el.style.left !== left) el.style.left = left
    el.classList.toggle('is-above', !roomBelow)
  }

  #key = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && this.#el?.contains(e.target)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    } else if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) {
      this.close()
    }
  }

  #inputKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const raw = this.#input.value.trim()
      if (!/^\d+$/.test(raw)) return
      const n = Number(raw)
      if (n < 1) return
      const size = clampFontSize(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)))
      this.view.focus()
      this.#run(applyFontSize(this.#type(), size))
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowUp' ? 1 : -1
      const current = /^\d+$/.test(this.#input.value.trim()) ? Number(this.#input.value.trim()) : DEFAULT_FONT_SIZE
      const next = clampFontSize(current + delta)
      // Step the input value only (matching ColourBox R/G/B fields, YAZ-6718): keeps the toolbar visible
      // while stepping, and Enter commits as one undo step with focus back in the editor.
      this.#input.value = String(next)
    }
  }

  #outside = (e: Event) => {
    const target = e.target
    if (!(target instanceof Node)) return
    if (this.#el?.contains(target) || this.#anchor()?.contains(target)) return
    this.close()
  }

  #scrolled = (e: Event) => {
    if (e.target instanceof Node && this.#el?.contains(e.target)) return
    if (this.#anchor() === null) this.close()
    else this.#place()
  }

  #run(command: Command): void {
    const { view } = this
    const applied = command(view.state, (tr) => view.dispatch(closeHistory(tr)))
    if (!applied && this.open) this.#render()
  }

  update(view: EditorView, prev: EditorState): void {
    if (!this.open) return
    if (!prev.selection.eq(view.state.selection) || view.state.selection.empty) this.close()
    else if (prev.doc !== view.state.doc) this.#render()
  }

  destroy(): void {
    this.close()
    this.#unregister()
    this.view.dom.ownerDocument.removeEventListener('click', this.#keyboardOpen, true)
    this.#el?.remove()
    panels.delete(this.view)
  }
}

export const fontSizePanel = $prose(
  (ctx) => new Plugin({ key: new PluginKey('mdapp-font-size-panel'), view: (view) => new FontSizePanel(ctx, view) }),
)
