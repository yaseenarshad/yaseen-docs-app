/**
 * Unified Google Docs-style 10×8 colour picker widget (`ColourGrid`, YAZ-6727).
 *
 * One zero-dependency DOM component used by:
 *  1. Page Selection Toolbar — Text colour (`A̲▾`) and Highlight (`▾`) (`colourPanel.ts`, `highlightPanel.ts`)
 *  2. Table Cell Toolbar — Fill (`▾`) and Text (`▾`) (`table/cellToolbar.ts`)
 *  3. Drawing Text Box Pop-up Toolbar (`drawings/textColorPanel.ts`)
 *  4. Settings › Quick highlight colours (`settings/QuickHighlightControl.tsx`)
 *
 * Layout:
 *  - Optional top reset row (`Default colour` / `No highlight` / `No fill`)
 *  - Optional extra preset row (e.g. named soft washes in Quick Highlight settings)
 *  - Row 1: 10-step Black → White grayscale
 *  - Row 2: 10 vibrant pure base hues
 *  - Rows 3–8: 60 tints & shades directly beneath each base hue
 *  - Bottom `CUSTOM` section: shared recent custom circles + `+` (expands Hex input + `ColourBox`
 *    with optional Opacity slider) + native `EyeDropper`
 */
import { GDOCS_BASE_HUES, GDOCS_GRAYSCALE, GDOCS_SHADES, isLightSwatch } from '@shared/palette'
import { solidHex, type Hex } from '../lib/colour'
import { ColourBox } from './highlightColourBox'
import { mostUsedHighlightColors, recordHighlightColorUse } from './highlightUsed'
import './colourGrid.css'

/** Parse `#rrggbb`, `rrggbb`, `#rgb`, `rgb`, and (when `allowAlpha`) `#rrggbbaa` / `rrggbbaa`. */
export function readHex(text: string, allowAlpha = false): Hex | null {
  const s = text.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase() as Hex
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}` as Hex
  if (allowAlpha && /^[0-9a-f]{8}$/i.test(s)) return `#${s.toLowerCase()}` as Hex
  return null
}

/** One keyboard-navigable button item inside `ColourGrid`. */
export interface GridItem {
  id: string
  el: HTMLElement
  run: () => void
}

export interface ExtraSwatchItem {
  key: string
  label: string
  value: string
  swatch: string
  isLight?: boolean
}

export interface ColourGridOptions {
  /** Label for the top reset button (e.g. 'Default colour', 'No highlight', 'No fill'), or `null` to omit. */
  noneLabel: string | null
  /** Whether custom colours allow `#rrggbbaa` opacity and show the Opacity slider in `ColourBox`. */
  allowAlpha: boolean
  /** Default hex when opening `+` with no active colour (defaults to `'#000000'`). */
  defaultBoxHex?: () => Hex
  /** Optional extra preset row rendered above the 10×8 grid (e.g. soft washes). */
  extraRow?: { heading?: string; items: readonly ExtraSwatchItem[] }
  /** Called when the user picks a colour (`isCustom` is true for `+`, Hex Enter, or Eyedropper picks). */
  onPick: (value: string, isCustom: boolean) => void
  /** Called when the user clicks the top reset button. */
  onClear?: () => void
  /** Called whenever the custom drawer toggles or custom circles change height so popovers can re-anchor. */
  onResize?: () => void
  /** Called when Escape closes the custom drawer from inside the hex/RGB inputs. */
  onBoxClose?: () => void
  /** Normalize a stored custom colour from `highlightCustomColors` for this surface. */
  normalizeCustom?: (raw: string) => Hex | null
  /** Whether to record custom picks into shared `highlightCustomColors` (default true). */
  recordCustom?: boolean
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
const eyeDropperOf = (doc: Document): EyeDropperCtor | null =>
  (doc.defaultView as unknown as { EyeDropper?: EyeDropperCtor } | null)?.EyeDropper ?? null

const EYEDROPPER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 0 0 .01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/></svg>'

const defaultNormalize = (allowAlpha: boolean) => (raw: string): Hex | null => {
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase() as Hex
  if (/^#[0-9a-f]{8}$/i.test(raw)) return (allowAlpha ? raw.toLowerCase() : raw.slice(0, 7).toLowerCase()) as Hex
  return null
}

/** Max custom circles shown beside `+` and Eyedropper in the `CUSTOM` row. */
const MAX_CUSTOM_DOTS = 8

export class ColourGrid {
  readonly el: HTMLElement
  #resetBtn: HTMLButtonElement | null = null
  #extraItems: { value: string; item: GridItem }[] = []
  #paletteItems: { hex: Hex; item: GridItem }[] = []
  #customRow: HTMLElement
  #customDots = new Map<string, GridItem>()
  #plusBtn: HTMLButtonElement
  #dropperBtn: HTMLButtonElement
  #drawer: HTMLElement
  #hexInput: HTMLInputElement
  #box: ColourBox
  #rows: GridItem[][] = []
  #current: string | null = null
  #dropping = false
  #lastStartHex: Hex = '#000000'
  #normalize: (raw: string) => Hex | null

  constructor(
    readonly doc: Document,
    readonly opts: ColourGridOptions,
  ) {
    this.#normalize = opts.normalizeCustom ?? defaultNormalize(opts.allowAlpha)
    const div = (className: string) => {
      const el = doc.createElement('div')
      el.className = className
      return el
    }

    this.el = div('colour-grid')

    // 1. Optional top reset row (Default / None / No fill).
    if (opts.noneLabel !== null) {
      const reset = doc.createElement('button')
      reset.type = 'button'
      reset.className = 'colour-grid__reset'
      reset.tabIndex = -1
      reset.title = opts.noneLabel
      reset.setAttribute('aria-label', opts.noneLabel)
      reset.setAttribute('aria-pressed', 'false')
      reset.dataset.item = 'none'
      const icon = doc.createElement('span')
      icon.className = 'colour-grid__reset-icon'
      icon.setAttribute('aria-hidden', 'true')
      reset.append(icon, doc.createTextNode(opts.noneLabel))
      reset.addEventListener('mousedown', (e) => e.preventDefault())
      reset.addEventListener('click', () => opts.onClear?.())
      this.#resetBtn = reset
      this.el.append(reset)
    }

    // 2. Optional extra preset row (e.g. soft washes).
    if (opts.extraRow !== undefined && opts.extraRow.items.length > 0) {
      const extra = div('colour-grid__extra')
      if (opts.extraRow.heading) {
        const label = div('colour-grid__label')
        label.textContent = opts.extraRow.heading
        extra.append(label)
      }
      const row = div('colour-grid__extra-row')
      for (const spec of opts.extraRow.items) {
        const b = this.#makeDot(`extra:${spec.key}`, spec.label, spec.swatch, spec.isLight ?? true, false, () =>
          opts.onPick(spec.value, false),
        )
        row.append(b.el)
        this.#extraItems.push({ value: spec.value, item: b })
      }
      extra.append(row)
      this.el.append(extra)
    }

    // 3. Google Docs 10×8 grid: Row 1 grayscale, Row 2 base hues, Rows 3–8 shades.
    const rowsWrap = div('colour-grid__rows')
    const makeRow = (swatches: readonly { hex: Hex; label: string }[], className: string) => {
      const container = div(className)
      for (const s of swatches) {
        const item = this.#makeDot(`hex:${s.hex}`, s.label, s.hex, isLightSwatch(s.hex), false, () =>
          opts.onPick(s.hex, false),
        )
        container.append(item.el)
        this.#paletteItems.push({ hex: s.hex, item })
      }
      return container
    }
    rowsWrap.append(
      makeRow(GDOCS_GRAYSCALE, 'colour-grid__row'),
      makeRow(GDOCS_BASE_HUES, 'colour-grid__row'),
      makeRow(GDOCS_SHADES.flat(), 'colour-grid__shades'),
    )
    this.el.append(rowsWrap)

    // 4. Bottom CUSTOM section (recent custom dots + `+` button + Eyedropper).
    const customSec = div('colour-grid__custom')
    const customLabel = div('colour-grid__label')
    customLabel.textContent = 'Custom'
    this.#customRow = div('colour-grid__custom-row')

    const plus = doc.createElement('button')
    plus.type = 'button'
    plus.className = 'colour-grid__action'
    plus.tabIndex = -1
    plus.textContent = '+'
    plus.title = 'Custom colour…'
    plus.setAttribute('aria-label', 'Custom colour…')
    plus.setAttribute('aria-expanded', 'false')
    plus.dataset.item = 'custom-plus'
    plus.addEventListener('mousedown', (e) => e.preventDefault())
    plus.addEventListener('click', () => this.toggleCustom())
    this.#plusBtn = plus

    const dropper = doc.createElement('button')
    dropper.type = 'button'
    dropper.className = 'colour-grid__action'
    dropper.tabIndex = -1
    dropper.innerHTML = EYEDROPPER_SVG
    dropper.title = 'Pick a colour from the screen'
    dropper.setAttribute('aria-label', 'Pick a colour from the screen')
    dropper.dataset.item = 'eyedropper'
    dropper.addEventListener('mousedown', (e) => e.preventDefault())
    dropper.addEventListener('click', () => void this.#eyedrop())
    this.#dropperBtn = dropper

    this.#customRow.append(this.#plusBtn)
    customSec.append(customLabel, this.#customRow)
    this.el.append(customSec)

    // 5. Collapsible custom drawer (Hex input + ColourBox with optional Opacity slider).
    this.#drawer = div('colour-grid__drawer')
    this.#drawer.hidden = true

    const hexWrap = div('colour-grid__hex')
    const hash = doc.createElement('span')
    hash.className = 'colour-grid__hash'
    hash.textContent = '#'
    const input = doc.createElement('input')
    input.type = 'text'
    input.className = 'colour-grid__hex-input'
    input.spellcheck = false
    input.maxLength = opts.allowAlpha ? 9 : 7
    input.tabIndex = -1
    input.setAttribute('aria-label', 'Hex code')
    input.addEventListener('input', () => {
      const parsed = readHex(input.value, opts.allowAlpha)
      if (parsed !== null && this.#box.open) this.#box.set(parsed)
    })
    input.addEventListener('keydown', this.#hexKey)
    hexWrap.append(hash, input)
    this.#hexInput = input

    this.#box = new ColourBox(doc, {
      showAlpha: opts.allowAlpha,
      preview: (color) => {
        if (doc.activeElement !== this.#hexInput) this.#hexInput.value = color.slice(1)
      },
      pick: (color) => this.#commitCustom(color),
      close: () => {
        this.closeCustom()
        opts.onBoxClose?.()
      },
    })
    this.#drawer.append(hexWrap, this.#box.el)
    this.el.append(this.#drawer)
  }

  get boxOpen(): boolean {
    return !this.#drawer.hidden
  }

  get hexInput(): HTMLInputElement {
    return this.#hexInput
  }

  get rows(): readonly (readonly GridItem[])[] {
    return this.#rows
  }

  get currentId(): string | null {
    return this.#current
  }

  #makeDot(id: string, label: string, swatch: string, light: boolean, alphaBackdrop: boolean, run: () => void): GridItem {
    const b = this.doc.createElement('button')
    b.type = 'button'
    b.className = 'colour-grid__dot'
    if (light) b.classList.add('is-light')
    if (alphaBackdrop) b.classList.add('colour-grid__dot--alpha')
    b.style.setProperty('--swatch', swatch)
    b.tabIndex = -1
    b.title = label
    b.setAttribute('aria-label', label)
    b.setAttribute('aria-pressed', 'false')
    b.dataset.item = id
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    return { id, el: b, run }
  }

  #commitCustom(raw: Hex): void {
    const norm = this.#normalize(raw)
    if (norm === null) return
    if (this.opts.recordCustom !== false) recordHighlightColorUse(norm)
    this.opts.onPick(norm, true)
  }

  #hexKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.closeCustom()
      this.opts.onBoxClose?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const parsed = readHex(this.#hexInput.value, this.opts.allowAlpha)
      if (parsed !== null) this.#commitCustom(parsed)
    }
  }

  async #eyedrop(): Promise<void> {
    const EyeDropper = eyeDropperOf(this.doc)
    if (EyeDropper === null || this.#dropping) return
    this.#dropping = true
    try {
      const hex = solidHex((await new EyeDropper().open()).sRGBHex)
      if (hex === null) return
      if (this.boxOpen) this.#box.set(hex)
      this.#hexInput.value = hex.slice(1)
      this.#commitCustom(hex)
    } catch {
      // Cancelled by user.
    } finally {
      this.#dropping = false
    }
  }

  toggleCustom(startHex?: Hex): void {
    if (this.boxOpen) this.closeCustom()
    else this.openCustom(startHex)
  }

  openCustom(startHex?: Hex): void {
    const hex = startHex ?? this.#lastStartHex ?? this.opts.defaultBoxHex?.() ?? '#000000'
    this.#drawer.hidden = false
    this.#plusBtn.setAttribute('aria-expanded', 'true')
    this.#hexInput.value = hex.slice(1)
    this.#box.show(hex)
    this.opts.onResize?.()
  }

  closeCustom(): void {
    if (!this.boxOpen) return
    this.#drawer.hidden = true
    this.#box.hide()
    this.#plusBtn.setAttribute('aria-expanded', 'false')
    this.opts.onResize?.()
  }

  static #setPressed(el: HTMLElement, on: boolean): void {
    if (el.classList.contains('active') === on) return
    el.classList.toggle('active', on)
    el.setAttribute('aria-pressed', String(on))
  }

  /**
   * Sync active checkmarks, custom recent dots, eyedropper visibility, and hex field.
   * Zero DOM rebuild of the 80 palette swatches.
   */
  render(selected: readonly string[], startHex?: Hex | null): void {
    const activeSet = new Set(selected.map((s) => s.toLowerCase()))
    const isEmpty = selected.length === 0

    if (this.#resetBtn !== null) ColourGrid.#setPressed(this.#resetBtn, isEmpty)
    for (const { value, item } of this.#extraItems) {
      ColourGrid.#setPressed(item.el, activeSet.has(value.toLowerCase()))
    }
    for (const { hex, item } of this.#paletteItems) {
      ColourGrid.#setPressed(item.el, activeSet.has(hex))
    }

    // Recent custom colours (deduplicated after normalizing for this surface).
    const seen = new Set<string>()
    const customHexes: Hex[] = []
    for (const raw of mostUsedHighlightColors()) {
      const norm = this.#normalize(raw)
      if (norm !== null && !seen.has(norm)) {
        seen.add(norm)
        customHexes.push(norm)
        if (customHexes.length >= MAX_CUSTOM_DOTS) break
      }
    }

    const customItems: GridItem[] = []
    const rowChildren: HTMLElement[] = []
    for (const hex of customHexes) {
      let item = this.#customDots.get(hex)
      if (item === undefined) {
        item = this.#makeDot(`custom:${hex}`, hex, hex, isLightSwatch(hex), hex.length === 9, () =>
          this.#commitCustom(hex),
        )
        this.#customDots.set(hex, item)
      }
      ColourGrid.#setPressed(item.el, activeSet.has(hex))
      customItems.push(item)
      rowChildren.push(item.el)
    }
    for (const key of [...this.#customDots.keys()]) {
      if (!seen.has(key)) this.#customDots.delete(key)
    }

    const hasDropper = eyeDropperOf(this.doc) !== null
    this.#dropperBtn.hidden = !hasDropper
    rowChildren.push(this.#plusBtn)
    if (hasDropper) rowChildren.push(this.#dropperBtn)

    const kids = this.#customRow.children
    if (kids.length !== rowChildren.length || rowChildren.some((el, i) => kids[i] !== el)) {
      this.#customRow.replaceChildren(...rowChildren)
    }

    // Remember starting hex for `+` and keep Hex input synced when not actively edited.
    const nextHex = startHex ?? this.opts.defaultBoxHex?.() ?? '#000000'
    this.#lastStartHex = nextHex
    if (this.doc.activeElement !== this.#hexInput) {
      const raw = nextHex.slice(1)
      if (this.#hexInput.value !== raw) this.#hexInput.value = raw
    }

    // Build keyboard navigation grid rows.
    const nav: GridItem[][] = []
    if (this.#resetBtn !== null) {
      nav.push([{ id: 'none', el: this.#resetBtn, run: () => this.opts.onClear?.() }])
    }
    if (this.#extraItems.length > 0) nav.push(this.#extraItems.map((e) => e.item))
    for (let i = 0; i < this.#paletteItems.length; i += 10) {
      nav.push(this.#paletteItems.slice(i, i + 10).map((p) => p.item))
    }
    const bottomRow: GridItem[] = [
      ...customItems,
      { id: 'custom-plus', el: this.#plusBtn, run: () => this.toggleCustom() },
      ...(hasDropper ? [{ id: 'eyedropper', el: this.#dropperBtn, run: () => void this.#eyedrop() }] : []),
    ]
    nav.push(bottomRow)
    this.#rows = nav
    this.move(this.#current)
  }

  /** Highlight one item as keyboard-focused (`.is-current`), or `null` to clear. */
  move(id: string | null): void {
    this.#current = id
    for (const row of this.#rows) {
      for (const item of row) item.el.classList.toggle('is-current', item.id === id)
    }
  }

  /** Handle arrow / Home / End / Enter keyboard navigation over the grid. Returns true if consumed. */
  handleNavKey(e: KeyboardEvent): boolean {
    if (this.#rows.length === 0) return false
    const flat = this.#rows.flat()
    const find = () => {
      for (let r = 0; r < this.#rows.length; r++) {
        const c = this.#rows[r].findIndex((i) => i.id === this.#current)
        if (c >= 0) return { r, c }
      }
      return null
    }
    const pos = find()
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const i = pos === null ? -1 : flat.findIndex((item) => item.id === this.#current)
      const step = e.key === 'ArrowRight' ? 1 : -1
      const next = i < 0 ? (step > 0 ? 0 : flat.length - 1) : (i + step + flat.length) % flat.length
      this.move(flat[next]!.id)
      return true
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1
      if (pos === null) {
        this.move(step > 0 ? this.#rows[0]![0]!.id : this.#rows.at(-1)![0]!.id)
      } else {
        const r = (pos.r + step + this.#rows.length) % this.#rows.length
        const row = this.#rows[r]!
        this.move(row[Math.min(pos.c, row.length - 1)]!.id)
      }
      return true
    }
    if (e.key === 'Home') {
      this.move(flat[0]!.id)
      return true
    }
    if (e.key === 'End') {
      this.move(flat.at(-1)!.id)
      return true
    }
    if ((e.key === 'Enter' || e.key === ' ') && pos !== null) {
      this.#rows[pos.r]![pos.c]!.run()
      return true
    }
    return false
  }
}
