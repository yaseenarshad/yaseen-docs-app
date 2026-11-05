/**
 * The highlight ▾ panel of the selection toolbar (YAZ-4348 demo round 2): the board's (Excalidraw) colour popup,
 * rebuilt for the note (`engine/…/ColorPicker/Picker.tsx` is the look and the order). Top to bottom:
 *  - **Most used custom colours** — the custom colours picked most (`highlightUsed.ts`, the setting
 *    `highlightCustomColors`); the row is gone while there are none.
 *  - **Colours** — the 8 highlight colours (yellow, green, blue, pink, orange, purple, red, gray; each its wash
 *    token, `<mark class="highlight-<name>">` on disk) and **None**, a checkerboard square that removes the
 *    highlight.
 *  - **Shades** — 5 steps, lighter to darker, of the colour picked; a shade is a custom colour.
 *  - **Hex code** — `#`, the colour's hex, and a pencil. A valid hex and Enter applies it; a click on the field or
 *    the pencil opens the panel's own colour box right under the field (`highlightColourBox.ts`, YAZ-4388: Chromium's
 *    popup opened at the window's top left); the pencil again, or Escape, closes just the box.
 * A custom colour saves as `<mark style="background-color: #rrggbb">` (CONTRACTS rule 31).
 *
 * As the board's, the panel stays open for the next pick, and the colours the selection has wear a ring. Each
 * pick is one undo step. The panel lives on the page's body, `position: fixed` under the ▾: Crepe's toolbar has
 * `overflow: hidden`, so a panel inside it would be cut off. It never takes the selection: its swatches cancel
 * their mousedown and the keys are read on the document while it is open — arrows move through the swatches as
 * a grid, Home and End, Enter or Space picks, Escape closes it; any other key closes it and goes on to the note.
 * Only the Hex code field and the box's R G B fields take the focus, to be typed in; a pick from them gives the
 * focus back to the note first. A click outside or a new selection closes the panel; a scroll moves it with the ▾.
 *
 * The box's pick goes to the selection, as a swatch's does: any new selection closes the panel and the box with it.
 *
 * Speed: each swatch is made once and kept by its colour, so a pick moves the rings and leaves the nodes; a pick
 * renders once; the panel is placed before its first paint, with one layout read.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  applyHighlight,
  customWash,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_HEX,
  highlightColorsIn,
  highlightSchema,
  isCustomHighlight,
  QUICK_HIGHLIGHTS,
  removeHighlight,
  type CustomHighlight,
  type HighlightColor,
} from './marks/highlight'
import { ColourBox } from './highlightColourBox'
import { mostUsedHighlightColors, noteHighlightColorUse } from './highlightUsed'

/** The ▾'s toolbar key. */
export const MORE_KEY = 'highlight-more'

/** Whether the selection has a colour that is not a toolbar button: the ▾ lights for it. */
export const hasPanelColour = (colours: readonly HighlightColor[]): boolean =>
  colours.some((c) => c !== null && !(QUICK_HIGHLIGHTS as readonly string[]).includes(c))

/** A colour's name in the panel: yellow is the mark's `null`. */
const nameOf = (color: HighlightColor): string => (color === null ? 'yellow' : color)

/** A colour's solid `#rrggbb`: its own for a custom colour, the wash token's hue for a named one. */
const hexOf = (color: HighlightColor): CustomHighlight => (isCustomHighlight(color) ? color : HIGHLIGHT_HEX[color === null ? 'yellow' : color])

/** `hex` mixed toward `to` (`#ffffff` or `#000000`) by `amount`. */
function mix(hex: string, to: string, amount: number): CustomHighlight {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const part = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount)
  return `#${[16, 8, 0].map((s) => part(s).toString(16).padStart(2, '0')).join('')}`
}

/** The Shades row: lighter to darker, `base` in the middle. Narrow steps: each is shown, and saved, as a 40% wash. */
export const shadesOf = (base: string): CustomHighlight[] => [
  mix(base, '#ffffff', 0.5),
  mix(base, '#ffffff', 0.25),
  base.toLowerCase() as CustomHighlight,
  mix(base, '#000000', 0.2),
  mix(base, '#000000', 0.4),
]

/** A typed hex, `#` or not, three or six digits: lowercase `#rrggbb`, else null. */
export function readHex(typed: string): CustomHighlight | null {
  const raw = typed.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((d) => d + d).join('')}`
  return null
}

/** Each open note's panel, so the toolbar's ▾ reaches the one of its own editor. */
const panels = new WeakMap<EditorView, HighlightPanel>()

/** The ▾'s press (Crepe runs it on pointerdown): open this editor's panel, or close it. */
export function toggleHighlightPanel(view: EditorView, by: 'pointer' | 'keyboard' = 'pointer'): void {
  panels.get(view)?.toggle(by)
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

class HighlightPanel {
  #el: HTMLElement | null = null
  #used!: HTMLElement
  #usedRow!: HTMLElement
  #colours!: HTMLElement
  #shades!: HTMLElement
  #hexField!: HTMLElement
  #hexInput!: HTMLInputElement
  #pencil!: HTMLButtonElement
  #box!: ColourBox
  /** The places the keyboard walks, row by row, as drawn now. */
  #rows: Item[][] = []
  /** Each swatch made, by its row and colour: a render reuses them. */
  #made = new Map<string, Item>()
  #noShades: HTMLElement | null = null
  /** Renders so far: a pick renders only when its change did not already. */
  #renders = 0
  #current: string | null = null
  /** Where the Shades start: the colour picked last in this panel, else the selection's own. */
  #base: CustomHighlight | null = null

  constructor(
    readonly ctx: Ctx,
    readonly view: EditorView,
  ) {
    panels.set(view, this)
    view.dom.ownerDocument.addEventListener('click', this.#keyboardOpen, true)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  #type = () => highlightSchema.type(this.ctx)

  /** The strip's ▾ of this editor, or null while the toolbar is not drawn. */
  #arrow(): HTMLElement | null {
    return this.view.dom.parentElement?.querySelector<HTMLElement>(`.milkdown-toolbar [data-toolbar-item="${MORE_KEY}"]`) ?? null
  }

  /** Enter or Space on a focused ▾ is a click with no pointer: Crepe's own buttons answer only the pointer. */
  #keyboardOpen = (e: MouseEvent) => {
    if (e.detail !== 0 || !(e.target instanceof Element)) return
    const arrow = this.#arrow()
    if (arrow === null || !arrow.contains(e.target)) return
    e.preventDefault()
    this.toggle('keyboard')
  }

  toggle(by: 'pointer' | 'keyboard'): void {
    if (this.open) this.close()
    else this.#show(by)
  }

  /** The panel's frame, once: the headings, the rows' boxes and the Hex code field. */
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
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Highlight colours')
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
    input.maxLength = 7
    input.tabIndex = -1
    input.setAttribute('aria-label', 'Hex code')
    // A click on the field opens the colour box under it, and leaves the caret in it for typing. Before the field
    // takes the focus (a listener runs before the mousedown's default), so the toolbar sees the note focused.
    input.addEventListener('mousedown', () => {
      if (!this.#box.open) this.#openBox()
    })
    input.addEventListener('keydown', this.#hexKey)
    input.addEventListener('input', () => {
      const hex = readHex(input.value)
      if (hex !== null && this.#box.open) this.#box.set(hex)
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

  /** One square, its colour as `--swatch`: the one made for `key` before, else a new one. */
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
    // The selection and the focus stay in the note.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    const item = { id, el: b, run }
    this.#made.set(key, item)
    return item
  }

  /** `els` in `row`, touching the row only when they differ from what is there. */
  static #fill(row: HTMLElement, els: readonly HTMLElement[]): void {
    const kids = row.children
    if (kids.length !== els.length || els.some((el, i) => kids[i] !== el)) row.replaceChildren(...els)
  }

  /** The ring on a swatch the selection has, written only when it changes. */
  static #ring(item: Item, on: boolean): void {
    if (item.el.classList.contains('active') === on) return
    item.el.classList.toggle('active', on)
    item.el.setAttribute('aria-pressed', String(on))
  }

  /** Draw the rows for the selection as it is now. The Hex code field keeps what is being typed in it. */
  #render(): void {
    this.#renders++
    const colours = highlightColorsIn(this.view.state, this.#type())
    const one = colours.length === 1 ? colours[0] : undefined
    this.#base ??= one === undefined ? null : hexOf(one)
    const rows: Item[][] = []
    const live = new Set<string>()

    const usedColours = mostUsedHighlightColors() as CustomHighlight[]
    const used = usedColours.map((c) => this.#swatch(`used:${c}`, `used:${c}`, c, customWash(c), () => this.#apply(c), live))
    used.forEach((item, i) => HighlightPanel.#ring(item, colours.includes(usedColours[i])))
    this.#used.hidden = used.length === 0
    HighlightPanel.#fill(this.#usedRow, used.map((i) => i.el))
    if (used.length > 0) rows.push(used)

    const named = [null, ...HIGHLIGHT_COLORS] as HighlightColor[]
    const none = this.#swatch('none', 'none', 'None', null, () => this.#remove(), live)
    HighlightPanel.#ring(none, colours.length === 0)
    const swatches = [
      none,
      ...named.map((c) => {
        const item = this.#swatch(`color:${nameOf(c)}`, `color:${nameOf(c)}`, `Highlight ${nameOf(c)}`, c === null ? 'var(--mark-bg)' : `var(--mark-bg-${c})`, () => this.#apply(c), live)
        HighlightPanel.#ring(item, colours.includes(c))
        return item
      }),
    ]
    HighlightPanel.#fill(this.#colours, swatches.map((i) => i.el))
    rows.push(swatches.slice(0, 5), swatches.slice(5))

    if (this.#base === null) {
      if (this.#noShades === null) {
        this.#noShades = this.view.dom.ownerDocument.createElement('div')
        this.#noShades.className = 'highlight-panel__no-shades'
        this.#noShades.textContent = 'No shades available for this colour'
      }
      HighlightPanel.#fill(this.#shades, [this.#noShades])
    } else {
      const shades = shadesOf(this.#base).map((s, i) => {
        const item = this.#swatch(`shade:${i}:${s}`, `shade:${i}`, `Shade ${i + 1} ${s}`, customWash(s), () => this.#apply(s, false), live)
        HighlightPanel.#ring(item, colours.includes(s))
        return item
      })
      HighlightPanel.#fill(this.#shades, shades.map((i) => i.el))
      rows.push(shades)
    }
    // Swatches no row shows now are let go.
    for (const key of this.#made.keys()) if (!live.has(key)) this.#made.delete(key)

    if (this.view.dom.ownerDocument.activeElement !== this.#hexInput) {
      const value = this.#box.open ? this.#box.hex.slice(1) : one === undefined ? '' : hexOf(one).slice(1)
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

  /** Render, unless the change just made already did (`update` renders on each change of the note). */
  #renderOnce(since: number): void {
    if (this.open && this.#renders === since) this.#render()
  }

  #show(by: 'pointer' | 'keyboard'): void {
    const doc = this.view.dom.ownerDocument
    this.#el ??= this.#build()
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    this.#el.hidden = false
    this.#base = null
    this.#current = null
    this.#render()
    if (by === 'keyboard') this.#move(this.#rows[0]?.[0]?.id ?? null)
    this.#place()
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
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('pointerdown', this.#outside, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#scrolled, true)
    if (focused) this.view.focus()
  }

  /**
   * Under the ▾, or over it when the window has no room below; never past the window's sides. Run in the same task
   * as the change that showed or grew the panel, so it lands before the first paint: all reads, then the writes.
   * The size is the layout's (`offset*`), not the open animation's scaled box.
   */
  #place(): void {
    const el = this.#el!
    const win = this.view.dom.ownerDocument.defaultView
    const at = (this.#arrow() ?? this.view.dom).getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const roomBelow = win === null || at.bottom + 4 + height <= win.innerHeight - 8
    const top = `${Math.round(roomBelow ? at.bottom + 4 : Math.max(8, at.top - 4 - height))}px`
    const left = `${Math.round(win === null ? at.left : Math.max(8, Math.min(at.left, win.innerWidth - width - 8)))}px`
    if (el.style.top !== top) el.style.top = top
    if (el.style.left !== left) el.style.left = left
    el.classList.toggle('is-above', !roomBelow)
  }

  /** The keyboard's place: a class, since the focus stays in the note (or on the ▾). */
  #move(id: string | null): void {
    this.#current = id
    for (const row of this.#rows) for (const item of row) item.el.classList.toggle('is-current', item.id === id)
  }

  /** Where the keyboard stands: its row and column, or null. */
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
    // The panel's fields read their own keys.
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
        // Typing, Tab, a shortcut: the panel steps aside and the key goes on.
        if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) this.close()
    }
  }

  /** Enter applies a valid hex, the focus back in the note first so its toolbar stays; Escape closes the box, else the panel. */
  #hexKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (this.#box.open) this.#closeBox()
      else this.close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const hex = readHex(this.#hexInput.value)
      if (hex === null) return
      this.view.focus()
      this.#current = 'hex'
      this.#apply(hex)
    }
  }

  #outside = (e: Event) => {
    const target = e.target
    if (!(target instanceof Node)) return
    if (this.#el?.contains(target) || this.#arrow()?.contains(target)) return
    this.close()
  }

  /** A scroll moves the panel with its ▾; with the toolbar gone, the panel goes too. */
  #scrolled = (e: Event) => {
    if (e.target instanceof Node && this.#el?.contains(e.target)) return
    if (this.#arrow() === null) this.close()
    else this.#place()
  }

  /** Run `command` as one undo step of its own. */
  #run(command: Command): void {
    const { view } = this
    command(view.state, (tr) => view.dispatch(closeHistory(tr)))
  }

  /** A colour on the selection. A custom one counts as a use; a shade keeps the row of shades it came from. */
  #apply(color: HighlightColor, newBase = true): void {
    if (newBase) this.#base = hexOf(color)
    if (isCustomHighlight(color)) noteHighlightColorUse(color)
    const since = this.#renders
    this.#run(applyHighlight(this.#type(), color))
    this.#renderOnce(since)
  }

  #remove(): void {
    const since = this.#renders
    this.#run(removeHighlight(this.#type()))
    this.#renderOnce(since)
  }

  #toggleBox(): void {
    if (this.#box.open) this.#closeBox()
    else this.#openBox()
  }

  /** The colour box under the Hex code field, on the field's colour. */
  #openBox(): void {
    if (this.view.state.selection.empty || !this.open) return
    this.#box.show(readHex(this.#hexInput.value) ?? HIGHLIGHT_HEX.yellow)
    this.#pencil.setAttribute('aria-expanded', 'true')
    this.#place()
  }

  /** Just the box; a focus in it goes back to the note. */
  #closeBox(): void {
    const doc = this.view.dom.ownerDocument
    const focused = this.#box.el.contains(doc.activeElement)
    this.#box.hide()
    this.#pencil.setAttribute('aria-expanded', 'false')
    if (focused) this.view.focus()
    if (this.open) this.#place()
  }

  /** One finished pick in the box: on the selection, as a swatch (one undo step, one use). The box stays open for the next. */
  #pickBox = (color: CustomHighlight): void => {
    const { view } = this
    if (view.isDestroyed || !this.open || !this.#box.open) return
    // Back in the note before the change lands, so its toolbar (and the ▾ under the panel) stays.
    if (this.#el!.contains(view.dom.ownerDocument.activeElement)) view.focus()
    this.#apply(color)
  }

  update(view: EditorView, prev: EditorState): void {
    if (!this.open) return
    if (!prev.selection.eq(view.state.selection) || view.state.selection.empty) this.close()
    // A new doc is a change (`eq` would walk the whole note on each one).
    else if (prev.doc !== view.state.doc) this.#render()
  }

  destroy(): void {
    this.close()
    this.view.dom.ownerDocument.removeEventListener('click', this.#keyboardOpen, true)
    this.#el?.remove()
    panels.delete(this.view)
  }
}

/** The panel of each note. */
export const highlightPanel = $prose((ctx) => new Plugin({ key: new PluginKey('mdapp-highlight-panel'), view: (view) => new HighlightPanel(ctx, view) }))
