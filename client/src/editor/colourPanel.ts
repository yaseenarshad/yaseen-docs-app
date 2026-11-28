/**
 * Shared colour popup engine (`ColourPanel`, YAZ-6695 D4, unified onto Google Docs 10×8 `ColourGrid` in YAZ-6727):
 * ONE popup engine serving BOTH the selection toolbar's Highlight `▾` (`highlightPanel.ts`) and Text Colour `A̲▾` (below).
 *
 * Delegates all swatch rendering, `CUSTOM` row, Hex input, `ColourBox` (+ optional Opacity slider), Eyedropper,
 * and keyboard grid navigation to `ColourGrid` (`colourGrid.ts`).
 *
 * Preserves editor selection and focus, hides the OS blue selection wash while open (`data-colour-preview`, YAZ-6728),
 * and closes history on every pick (`closeHistory`) for single-step undo.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { hexOfRgb, rgbOf, type Hex } from '../lib/colour'
import { ColourGrid, readHex } from './colourGrid'
import {
  applyTextColor,
  isCustomTextColor,
  removeTextColor,
  textColorHex,
  textColorsIn,
  textColorSchema,
  type TextColor,
} from './marks/textColor'
import { toolbarItemOf } from './toolbarHost'

export { readHex }

/** Five shades of `hex` (kept exported for tests and legacy callers). */
const SHADE_STEPS = [
  { to: 255, by: 0.5 },
  { to: 255, by: 0.25 },
  { to: 0, by: 0 },
  { to: 0, by: 0.2 },
  { to: 0, by: 0.4 },
] as const

export function shadesOf(hex: Hex): Hex[] {
  const rgb = rgbOf(hex)
  return SHADE_STEPS.map(({ to, by }) => hexOfRgb(rgb.map((c) => c + (to - c) * by)))
}

/** Hide the OS blue selection wash while picking or previewing a highlight / text colour so the true colour shows live (YAZ-6728). */
export function previewColourSelection(view: EditorView): void {
  view.dom.setAttribute('data-colour-preview', '')
}

export function clearColourPreview(view: EditorView): void {
  view.dom.removeAttribute('data-colour-preview')
}

/** Currently open toolbar popovers (ColourPanels and FontSizePanel), so opening one closes the others. */
const activeClosers = new Set<() => void>()

export function registerToolbarPanel(close: () => void): () => void {
  activeClosers.add(close)
  return () => activeClosers.delete(close)
}

export function closeToolbarPanels(except?: () => void): void {
  for (const close of activeClosers) if (close !== except) close()
}

export interface ColourSwatchSpec<C> {
  key: string
  label: string
  value: C
  swatch: string
  hex: Hex
}

/** Parameterized behaviour for one mark's `ColourPanel` (Highlight or Text colour). */
export interface ColourPanelSpec<C extends string | null> {
  anchorKey: string
  ariaLabel: string
  panelId: string
  noneLabel: string
  defaultBoxHex: () => Hex
  allowAlpha: boolean
  normalizeCustom: (raw: string) => (C & Hex) | null
  hexOf: (color: C) => Hex
  colorsIn: (ctx: Ctx, state: EditorState) => C[]
  apply: (ctx: Ctx, color: C) => Command
  remove: (ctx: Ctx) => Command
  /** Optional callback after a colour is applied from the panel (e.g. per-page recent highlights). */
  onCommit?: (view: EditorView, color: C) => void
}

class ColourPanel<C extends string | null> {
  #el: HTMLElement | null = null
  #grid!: ColourGrid
  #renders = 0
  #unregister: () => void

  constructor(
    readonly ctx: Ctx,
    readonly view: EditorView,
    readonly spec: ColourPanelSpec<C>,
    registry: WeakMap<EditorView, ColourPanel<C>>,
  ) {
    registry.set(view, this)
    this.#unregister = registerToolbarPanel(this.close)
    view.dom.ownerDocument.addEventListener('click', this.#keyboardOpen, true)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  #anchor(): HTMLElement | null {
    return toolbarItemOf(this.view, this.spec.anchorKey)
  }

  #keyboardOpen = (e: MouseEvent) => {
    if (e.detail !== 0 || !(e.target instanceof Element)) return
    const anchor = this.#anchor()
    if (anchor === null || !anchor.contains(e.target)) return
    e.preventDefault()
    this.toggle('keyboard')
  }

  toggle(by: 'pointer' | 'keyboard'): void {
    if (this.open) this.close()
    else this.#show(by)
  }

  #build(): HTMLElement {
    const doc = this.view.dom.ownerDocument
    const el = doc.createElement('div')
    el.className = 'highlight-panel'
    el.dataset.panel = this.spec.panelId
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', this.spec.ariaLabel)
    el.hidden = true

    this.#grid = new ColourGrid(doc, {
      noneLabel: this.spec.noneLabel,
      allowAlpha: this.spec.allowAlpha,
      defaultBoxHex: this.spec.defaultBoxHex,
      normalizeCustom: (raw) => this.spec.normalizeCustom(raw),
      onPick: (hex) => {
        const norm = this.spec.normalizeCustom(hex)
        if (norm === null) return
        if (this.#el!.contains(doc.activeElement)) this.view.focus()
        this.#apply(norm)
      },
      onClear: () => this.#remove(),
      onResize: () => {
        if (this.open) this.#place()
      },
      onBoxClose: () => {
        if (!this.view.isDestroyed) this.view.focus()
      },
    })
    el.append(this.#grid.el)
    return el
  }

  #render(): void {
    this.#renders++
    const colours = this.spec.colorsIn(this.ctx, this.view.state)
    const activeValues = colours.map((c) => (typeof c === 'string' && c.startsWith('#') ? c : this.spec.hexOf(c)))
    const startHex = colours.length === 1 ? (typeof colours[0] === 'string' && colours[0].startsWith('#') ? (colours[0] as Hex) : this.spec.hexOf(colours[0])) : null
    this.#grid.render(activeValues, startHex)
  }

  #renderOnce(since: number): void {
    if (this.open && this.#renders === since) this.#render()
  }

  #show(by: 'pointer' | 'keyboard'): void {
    closeToolbarPanels(this.close)
    const doc = this.view.dom.ownerDocument
    this.#el ??= this.#build()
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    this.#el.hidden = false
    this.#grid.move(null)
    this.#render()
    if (by === 'keyboard') this.#grid.move(this.#grid.rows[0]?.[0]?.id ?? null)
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
    this.#grid.hideMenu()
    this.#grid.closeCustom()
    this.#grid.move(null)
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
      if (this.#grid.boxOpen) {
        this.#grid.closeCustom()
        if (!this.view.isDestroyed) this.view.focus()
      } else this.close()
      return
    }
    if (this.#grid.handleNavKey(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) this.close()
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

  #apply(color: C): void {
    const { view, ctx } = this
    const since = this.#renders
    this.spec.apply(ctx, color)(view.state, (tr) => view.dispatch(closeHistory(tr)))
    this.spec.onCommit?.(view, color)
    previewColourSelection(view)
    this.#renderOnce(since)
  }

  #remove(): void {
    const { view, ctx } = this
    const since = this.#renders
    this.spec.remove(ctx)(view.state, (tr) => view.dispatch(closeHistory(tr)))
    clearColourPreview(view)
    this.#renderOnce(since)
  }

  update(view: EditorView, prev: EditorState): void {
    const selectionChanged = !prev.selection.eq(view.state.selection) || view.state.selection.empty
    if (selectionChanged && view.dom.hasAttribute('data-colour-preview')) clearColourPreview(view)
    if (!this.open) return
    if (selectionChanged) this.close()
    else if (prev.doc !== view.state.doc) this.#render()
  }

  destroy(): void {
    this.close()
    this.#unregister()
    this.view.dom.ownerDocument.removeEventListener('click', this.#keyboardOpen, true)
    this.#el?.remove()
  }
}

/** Create a ProseMirror plugin + toggle handle backed by the shared `ColourPanel` engine. */
export function createColourPanel<C extends string | null>(pluginKeyName: string, spec: ColourPanelSpec<C>) {
  const registry = new WeakMap<EditorView, ColourPanel<C>>()
  const toggle = (view: EditorView, by: 'pointer' | 'keyboard' = 'pointer'): void => {
    registry.get(view)?.toggle(by)
  }
  const plugin = $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey(pluginKeyName),
        view: (view) => {
          const panel = new ColourPanel(ctx, view, spec, registry)
          return {
            update: (v, prev) => panel.update(v, prev),
            destroy: () => {
              panel.destroy()
              registry.delete(view)
            },
          }
        },
      }),
  )
  return { plugin, toggle }
}

/** Toolbar key for the single `A̲▾` Text colour button (YAZ-6695 D6). */
export const TEXT_COLOR_KEY = 'text-color'

type NonNullTextColor = Exclude<TextColor, null>

const textColorHandle = createColourPanel<NonNullTextColor>('mdapp-text-color-panel', {
  anchorKey: TEXT_COLOR_KEY,
  ariaLabel: 'Text colours',
  panelId: 'text-color',
  noneLabel: 'Default colour',
  defaultBoxHex: () => '#000000',
  allowAlpha: false,
  normalizeCustom: (raw) => {
    if (isCustomTextColor(raw)) return raw as NonNullTextColor & Hex
    if (/^#[0-9a-f]{8}$/i.test(raw)) return raw.slice(0, 7).toLowerCase() as NonNullTextColor & Hex
    return null
  },
  hexOf: (color) => textColorHex(color),
  colorsIn: (ctx, state) => textColorsIn(state, textColorSchema.type(ctx)),
  apply: (ctx, color) => applyTextColor(textColorSchema.type(ctx), color),
  remove: (ctx) => removeTextColor(textColorSchema.type(ctx)),
})

export const toggleTextColorPanel = textColorHandle.toggle
export const textColorPanelPlugin = textColorHandle.plugin
