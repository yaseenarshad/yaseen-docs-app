/**
 * Shared colour popup engine (`ColourPanel`, YAZ-6695 D4): ONE popup engine serving BOTH the selection toolbar's
 * Highlight `▾` (`highlightPanel.ts`) and Text Color `A̲▾` (below).
 *
 * Top to bottom (the board's colour popup):
 *  - **Most used custom colours** — shared `highlightCustomColors` setting (`highlightUsed.ts`).
 *  - **Colours** — `None` / `Default` (checkerboard, removes mark) + named/preset swatches in 5-column rows.
 *  - **Shades** — 5 lighter-to-darker steps of the active colour.
 *  - **Hex code** — `#`, editable hex field, and pencil opening `ColourBox` (`highlightColourBox.ts`).
 *
 * Preserves editor selection and focus, full keyboard grid navigation, single-step undo (`closeHistory`), and
 * O(1) swatch DOM reuse across renders.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { hexOfRgb, rgbOf, type Hex } from '../lib/colour'
import { ColourBox } from './highlightColourBox'
import { mostUsedHighlightColors, recordHighlightColorUse } from './highlightUsed'
import {
  applyTextColor,
  isCustomTextColor,
  removeTextColor,
  TEXT_COLOR_HEX,
  TEXT_COLORS,
  textColorCss,
  textColorHex,
  textColorsIn,
  textColorSchema,
  type TextColor,
} from './marks/textColor'
import { toolbarItemOf } from './toolbarHost'

/** Currently open toolbar popovers (ColourPanels and FontSizePanel), so opening one closes the others. */
const activeClosers = new Set<() => void>()

export function registerToolbarPanel(close: () => void): () => void {
  activeClosers.add(close)
  return () => activeClosers.delete(close)
}

export function closeToolbarPanels(except?: () => void): void {
  for (const close of activeClosers) if (close !== except) close()
}

/** `hex` mixed toward `to` (`#ffffff` or `#000000`) by `amount`. */
function mix(hex: string, to: string, amount: number): Hex {
  const toward = rgbOf(to)
  return hexOfRgb(rgbOf(hex.slice(0, 7)).map((c, i) => c * (1 - amount) + toward[i] * amount))
}

/** The Shades row: lighter to darker, `base` (its 6-digit hue) in the middle. */
export const shadesOf = (base: string): Hex[] => {
  const solid = base.slice(0, 7).toLowerCase() as Hex
  return [
    mix(solid, '#ffffff', 0.5),
    mix(solid, '#ffffff', 0.25),
    solid,
    mix(solid, '#000000', 0.2),
    mix(solid, '#000000', 0.4),
  ]
}

/** A typed hex, `#` or not: 3 or 6 digits (and 8 digits when `allowAlpha` is true) → lowercase `#rrggbb[aa]`, else null. */
export function readHex(typed: string, allowAlpha = false): Hex | null {
  const raw = typed.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  if (allowAlpha && /^[0-9a-f]{8}$/.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((d) => d + d).join('')}`
  return null
}

/** One named/preset colour swatch in the Colours section. */
export interface ColourSwatchSpec<C extends string | null> {
  key: string
  label: string
  value: C
  swatch: string
  hex: Hex
}

/** Configuration parameterizing one `ColourPanel` instance (Highlight or Text Color). */
export interface ColourPanelSpec<C extends string | null> {
  /** Toolbar item key of the trigger button (`'highlight-more'` or `'text-color'`). */
  anchorKey: string
  /** Accessible dialog label (`'Highlight colours'` or `'Text colours'`). */
  ariaLabel: string
  /** Data attribute distinguishing the panel (`'highlight'` or `'text-color'`). */
  panelId: string
  /** Label of the clear/none swatch (`'None'` or `'Default'`). */
  noneLabel: string
  /** Ordered named/preset swatches (evaluated lazily to avoid editor module init cycles). */
  swatches: () => readonly ColourSwatchSpec<C>[]
  /** Fallback hex when `ColourBox` opens on an unstyled selection. */
  defaultBoxHex: () => Hex
  /** Accept 8-digit `#rrggbbaa` hex input and show ColourBox alpha slider when available (Highlight = true). */
  allowAlpha?: boolean
  /** CSS fill for a custom hex swatch (`hex` directly for solid/alpha highlights and text colors). */
  customSwatch: (hex: Hex) => string
  /** Normalize a stored custom colour from `highlightCustomColors` for this mark (e.g. strip alpha for text color). */
  normalizeCustom: (hex: string) => (C & Hex) | null
  /** Whether `color` is a custom hex colour. */
  isCustom: (color: C) => color is C & Hex
  /** Solid `#rrggbb` for Hex field and Shades base. */
  hexOf: (color: C) => Hex
  /** Current colours on the selection. */
  colorsIn: (ctx: Ctx, state: EditorState) => C[]
  /** Apply `color` (non-toggling). */
  apply: (ctx: Ctx, color: C) => Command
  /** Remove the mark (`None` / `Default`). */
  remove: (ctx: Ctx) => Command
}

/** One place the keyboard can stand: a swatch, the hex field or the pencil. */
interface Item {
  id: string
  el: HTMLElement
  run: () => void
}

/** The board's Hex code icon (`eyeDropperIcon`, a Tabler pencil), stroke for stroke. */
const PENCIL =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M11 7l6 6"/><path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z"/></svg>'

export class ColourPanel<C extends string | null> {
  #el: HTMLElement | null = null
  #used!: HTMLElement
  #usedRow!: HTMLElement
  #colours!: HTMLElement
  #shades!: HTMLElement
  #hexField!: HTMLElement
  #hexInput!: HTMLInputElement
  #pencil!: HTMLButtonElement
  #box!: ColourBox
  #rows: Item[][] = []
  #made = new Map<string, Item>()
  #noShades: HTMLElement | null = null
  #renders = 0
  #current: string | null = null
  #base: Hex | null = null
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

  /** Enter or Space on a focused trigger button is a click with no pointer: Crepe's own buttons answer only the pointer. */
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
    const div = (className: string) => {
      const el = doc.createElement('div')
      el.className = className
      return el
    }
    const heading = (text: string) => {
      const el = div('highlight-panel__heading')
      el.textContent = text
      return el
    }
    const el = div('highlight-panel')
    el.dataset.panel = this.spec.panelId
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', this.spec.ariaLabel)
    el.hidden = true
    this.#used = div('highlight-panel__section')
    this.#usedRow = div('highlight-panel__grid')
    this.#used.append(heading('Most used custom colours'), this.#usedRow)
    const colours = div('highlight-panel__section')
    this.#colours = div('highlight-panel__grid')
    colours.append(heading('Colours'), this.#colours)
    const shades = div('highlight-panel__section')
    this.#shades = div('highlight-panel__grid')
    shades.append(heading('Shades'), this.#shades)

    const hex = div('highlight-panel__section')
    this.#hexField = div('highlight-panel__hex')
    const hash = div('highlight-panel__hash')
    hash.textContent = '#'
    const input = doc.createElement('input')
    input.type = 'text'
    input.className = 'highlight-panel__hex-input'
    input.spellcheck = false
    input.maxLength = this.spec.allowAlpha ? 9 : 7
    input.tabIndex = -1
    input.setAttribute('aria-label', 'Hex code')
    input.addEventListener('mousedown', () => {
      if (!this.#box.open) this.#openBox()
    })
    input.addEventListener('keydown', this.#hexKey)
    input.addEventListener('input', () => {
      const parsed = readHex(input.value, this.spec.allowAlpha)
      if (parsed !== null && this.#box.open) this.#box.set(parsed)
    })
    this.#hexInput = input
    const pencil = doc.createElement('button')
    pencil.type = 'button'
    pencil.className = 'highlight-panel__pencil'
    pencil.tabIndex = -1
    pencil.title = 'Custom colour…'
    pencil.setAttribute('aria-label', 'Custom colour…')
    pencil.innerHTML = PENCIL
    pencil.addEventListener('mousedown', (e) => e.preventDefault())
    pencil.addEventListener('click', () => this.#toggleBox())
    pencil.setAttribute('aria-expanded', 'false')
    this.#pencil = pencil
    this.#hexField.append(hash, input, div('highlight-panel__hex-divider'), pencil)
    this.#box = new ColourBox(doc, {
      showAlpha: this.spec.allowAlpha,
      preview: (color) => {
        if (doc.activeElement !== this.#hexInput) this.#hexInput.value = color.slice(1)
      },
      pick: this.#pickBox,
      close: () => this.#closeBox(),
    })
    hex.append(heading('Hex code'), this.#hexField, this.#box.el)
    el.append(this.#used, colours, shades, hex)
    return el
  }

  #swatch(key: string, id: string, label: string, fill: string | null, run: () => void, live: Set<string>): Item {
    live.add(key)
    const made = this.#made.get(key)
    if (made !== undefined) return made
    const b = this.view.dom.ownerDocument.createElement('button')
    b.type = 'button'
    b.className = 'highlight-panel__swatch'
    if (fill === null) b.classList.add('is-none')
    else b.style.setProperty('--swatch', fill)
    b.tabIndex = -1
    b.title = label
    b.setAttribute('aria-label', label)
    b.setAttribute('aria-pressed', 'false')
    b.dataset.item = id
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    const item = { id, el: b, run }
    this.#made.set(key, item)
    return item
  }

  static #fill(row: HTMLElement, els: readonly HTMLElement[]): void {
    const kids = row.children
    if (kids.length !== els.length || els.some((el, i) => kids[i] !== el)) row.replaceChildren(...els)
  }

  static #ring(item: Item, on: boolean): void {
    if (item.el.classList.contains('active') === on) return
    item.el.classList.toggle('active', on)
    item.el.setAttribute('aria-pressed', String(on))
  }

  #render(): void {
    this.#renders++
    const colours = this.spec.colorsIn(this.ctx, this.view.state)
    const one = colours.length === 1 ? colours[0] : undefined
    this.#base ??= one === undefined ? null : this.spec.hexOf(one)
    const rows: Item[][] = []
    const live = new Set<string>()

    // Most used custom colours (deduplicated after normalizing for this mark).
    const usedSeen = new Set<string>()
    const usedColours: (C & Hex)[] = []
    for (const raw of mostUsedHighlightColors()) {
      const norm = this.spec.normalizeCustom(raw)
      if (norm !== null && !usedSeen.has(norm)) {
        usedSeen.add(norm)
        usedColours.push(norm)
      }
    }
    const used = usedColours.map((c) => this.#swatch(`used:${c}`, `used:${c}`, c, this.spec.customSwatch(c), () => this.#apply(c, true, true), live))
    used.forEach((item, i) => ColourPanel.#ring(item, colours.includes(usedColours[i])))
    this.#used.hidden = used.length === 0
    ColourPanel.#fill(this.#usedRow, used.map((i) => i.el))
    if (used.length > 0) rows.push(used)

    const none = this.#swatch('none', 'none', this.spec.noneLabel, null, () => this.#remove(), live)
    ColourPanel.#ring(none, colours.length === 0)
    const swatches = [
      none,
      ...this.spec.swatches().map((s) => {
        const item = this.#swatch(`color:${s.key}`, `color:${s.key}`, s.label, s.swatch, () => this.#apply(s.value, true, false), live)
        ColourPanel.#ring(item, colours.includes(s.value))
        return item
      }),
    ]
    ColourPanel.#fill(this.#colours, swatches.map((i) => i.el))
    for (let i = 0; i < swatches.length; i += 5) rows.push(swatches.slice(i, i + 5))

    if (this.#base === null) {
      if (this.#noShades === null) {
        this.#noShades = this.view.dom.ownerDocument.createElement('div')
        this.#noShades.className = 'highlight-panel__no-shades'
        this.#noShades.textContent = 'No shades available for this colour'
      }
      ColourPanel.#fill(this.#shades, [this.#noShades])
    } else {
      const shades = shadesOf(this.#base).map((s, i) => {
        const val = s as C & Hex
        const item = this.#swatch(`shade:${i}:${s}`, `shade:${i}`, `Shade ${i + 1} ${s}`, this.spec.customSwatch(s), () => this.#apply(val, false, true), live)
        ColourPanel.#ring(item, colours.includes(val))
        return item
      })
      ColourPanel.#fill(this.#shades, shades.map((i) => i.el))
      rows.push(shades)
    }
    for (const key of this.#made.keys()) if (!live.has(key)) this.#made.delete(key)

    if (this.view.dom.ownerDocument.activeElement !== this.#hexInput) {
      const value = this.#box.open
        ? this.#box.hex.slice(1)
        : one === undefined
          ? ''
          : (this.spec.isCustom(one) ? one : this.spec.hexOf(one)).slice(1)
      if (this.#hexInput.value !== value) this.#hexInput.value = value
    }
    const placeholder = one === undefined && colours.length > 1 ? 'mixed' : ''
    if (this.#hexInput.placeholder !== placeholder) this.#hexInput.placeholder = placeholder
    rows.push([
      { id: 'hex', el: this.#hexField, run: () => this.#hexInput.focus() },
      { id: 'pencil', el: this.#pencil, run: () => this.#toggleBox() },
    ])
    this.#rows = rows
    this.#move(this.#current)
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
    this.#base = null
    this.#current = null
    this.#render()
    if (by === 'keyboard') this.#move(this.#rows[0]?.[0]?.id ?? null)
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
    this.#box.hide()
    this.#pencil.setAttribute('aria-expanded', 'false')
    this.#move(null)
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

  #move(id: string | null): void {
    this.#current = id
    for (const row of this.#rows) for (const item of row) item.el.classList.toggle('is-current', item.id === id)
  }

  #at(): { r: number; c: number } | null {
    for (let r = 0; r < this.#rows.length; r++) {
      const c = this.#rows[r].findIndex((i) => i.id === this.#current)
      if (c >= 0) return { r, c }
    }
    return null
  }

  #step(key: string): void {
    const rows = this.#rows
    const flat = rows.flat()
    const at = this.#at()
    if (at === null || key === 'Home') return this.#move(flat[0]?.id ?? null)
    if (key === 'End') return this.#move(flat[flat.length - 1]?.id ?? null)
    const index = flat.findIndex((i) => i.id === this.#current)
    if (key === 'ArrowRight') return this.#move(flat[(index + 1) % flat.length].id)
    if (key === 'ArrowLeft') return this.#move(flat[(index - 1 + flat.length) % flat.length].id)
    const r = key === 'ArrowDown' ? (at.r + 1) % rows.length : (at.r - 1 + rows.length) % rows.length
    this.#move(rows[r][Math.min(at.c, rows[r].length - 1)].id)
  }

  #key = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && this.#el?.contains(e.target)) return
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    switch (e.key) {
      case 'Escape':
        stop()
        if (this.#box.open) this.#closeBox()
        else this.close()
        return
      case 'ArrowDown':
      case 'ArrowUp':
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'Home':
      case 'End':
        stop()
        this.#step(e.key)
        return
      case 'Enter':
      case ' ': {
        stop()
        const item = this.#rows.flat().find((i) => i.id === this.#current)
        if (item === undefined) this.close()
        else item.run()
        return
      }
      default:
        if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) this.close()
    }
  }

  #hexKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (this.#box.open) this.#closeBox()
      else this.close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const hex = readHex(this.#hexInput.value, this.spec.allowAlpha)
      if (hex === null) return
      this.view.focus()
      this.#current = 'hex'
      this.#apply(hex as C, true, true)
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
    command(view.state, (tr) => view.dispatch(closeHistory(tr)))
  }

  #apply(color: C, newBase = true, recordCustom = true): void {
    if (newBase) this.#base = this.spec.hexOf(color)
    if (recordCustom && this.spec.isCustom(color)) recordHighlightColorUse(color)
    const since = this.#renders
    this.#run(this.spec.apply(this.ctx, color))
    this.#renderOnce(since)
  }

  #remove(): void {
    const since = this.#renders
    this.#run(this.spec.remove(this.ctx))
    this.#renderOnce(since)
  }

  #toggleBox(): void {
    if (this.#box.open) this.#closeBox()
    else this.#openBox()
  }

  #openBox(): void {
    if (this.view.state.selection.empty || !this.open) return
    this.#box.show(readHex(this.#hexInput.value, this.spec.allowAlpha) ?? this.spec.defaultBoxHex())
    this.#pencil.setAttribute('aria-expanded', 'true')
    this.#place()
  }

  #closeBox(): void {
    const doc = this.view.dom.ownerDocument
    const focused = this.#box.el.contains(doc.activeElement)
    this.#box.hide()
    this.#pencil.setAttribute('aria-expanded', 'false')
    if (focused) this.view.focus()
    if (this.open) this.#place()
  }

  #pickBox = (color: Hex): void => {
    const { view } = this
    if (view.isDestroyed || !this.open || !this.#box.open) return
    const norm = this.spec.normalizeCustom(color)
    if (norm === null) return
    if (this.#el!.contains(view.dom.ownerDocument.activeElement)) view.focus()
    this.#apply(norm, true, true)
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

/** Toolbar key for the page Text Color `A̲▾` button (YAZ-6695 D6). */
export const TEXT_COLOR_KEY = 'text-color'

type NonNullTextColor = Exclude<TextColor, null>

let textColorSwatchesCache: readonly ColourSwatchSpec<NonNullTextColor>[] | undefined
const textColorSwatches = (): readonly ColourSwatchSpec<NonNullTextColor>[] =>
  (textColorSwatchesCache ??= [
    ...TEXT_COLORS.map((name) => ({
      key: name,
      label: `Text ${name}`,
      value: name as NonNullTextColor,
      swatch: textColorCss(name),
      hex: TEXT_COLOR_HEX[name],
    })),
    { key: 'black', label: 'Text black', value: '#000000' as NonNullTextColor, swatch: '#000000', hex: '#000000' },
    { key: 'white', label: 'Text white', value: '#ffffff' as NonNullTextColor, swatch: '#ffffff', hex: '#ffffff' },
  ])

const textColorPanelHandle = createColourPanel<NonNullTextColor>('mdapp-text-color-panel', {
  anchorKey: TEXT_COLOR_KEY,
  ariaLabel: 'Text colours',
  panelId: 'text-color',
  noneLabel: 'Default',
  swatches: textColorSwatches,
  defaultBoxHex: () => TEXT_COLOR_HEX.red,
  allowAlpha: false,
  customSwatch: (hex) => hex,
  normalizeCustom: (raw) => {
    if (typeof raw !== 'string') return null
    const hex = raw.slice(0, 7).toLowerCase()
    return isCustomTextColor(hex) ? (hex as NonNullTextColor & Hex) : null
  },
  isCustom: (c): c is NonNullTextColor & Hex => isCustomTextColor(c),
  hexOf: (c) => textColorHex(c),
  colorsIn: (ctx, state) => textColorsIn(state, textColorSchema.type(ctx)),
  apply: (ctx, color) => applyTextColor(textColorSchema.type(ctx), color),
  remove: (ctx) => removeTextColor(textColorSchema.type(ctx)),
})

export const textColorPanelPlugin = textColorPanelHandle.plugin
export const toggleTextColorPanel = textColorPanelHandle.toggle
