/**
 * THE TEXT COLORS OF A TEXT BOX'S POP-UP TOOLBAR (YAZ-4277 1E, D8; YAZ-4445; unified onto Google Docs 10×8
 * `ColourGrid` in YAZ-6727). They set the box's `text_color` mark, `textRuns[].color` on the box.
 *
 * Keeps the three quick tiles on the toolbar (`TEXT_BOX_COLORS`), and replaces the 5-tile `▾` popover with
 * the app's unified 10×8 Google Docs `ColourGrid` (grayscale + 10 base hues + 60 shades + Custom + Eyedropper + None).
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { Mark } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { Hex } from '../lib/colour'
import { ColourGrid } from '../editor/colourGrid'
import { popupLayerOf, toolbarItemOf } from '../editor/toolbarHost'

interface TextColor {
  key: string
  name: string
  color: string
}

/** The board's colors (`COLOR_PALETTE`, the stroke shade); `textColorPanel.test.ts` checks them against the engine. */
const textColor = (name: string, color: string): TextColor => ({ key: `text-color-${name}`, name: `Text ${name}`, color })

/** The three tiles of the toolbar, the board's: black (the box default), red, blue. */
export const TEXT_BOX_COLORS: readonly TextColor[] = [textColor('black', '#1e1e1e'), textColor('red', '#e03131'), textColor('blue', '#1971c2')]

/** Legacy board palette list kept exported for `textColorPanel.test.ts` compatibility. */
export const TEXT_BOX_MORE_COLORS: readonly TextColor[] = [
  textColor('green', '#2f9e44'),
  textColor('white', '#ffffff'),
  textColor('orange', '#e8590c'),
  textColor('violet', '#6741d9'),
  textColor('gray', '#343a40'),
]

/** The ▾'s toolbar key. */
export const TEXT_COLOR_MORE_KEY = 'text-color-more'

/** The ▾'s None: the letters take the box color again. */
export const NONE_LABEL = 'Text color: none'

/** The selection's one color, null when it has none, undefined when its letters have more than one (as the board). */
export function selectionTextColor(state: EditorState): string | null | undefined {
  const { from, to, empty } = state.selection
  const type = state.schema.marks.text_color
  const colorOf = (marks: readonly Mark[]) => (type.isInSet(marks)?.attrs.color as string | undefined) ?? null
  if (empty) return colorOf(state.storedMarks ?? state.selection.$from.marks())
  let found: string | null | undefined
  let mixed = false
  state.doc.nodesBetween(from, to, (node) => {
    if (mixed || !node.isText) return !mixed
    const color = colorOf(node.marks)
    if (found === undefined) found = color
    else if (found !== color) mixed = true
    return true
  })
  return mixed ? undefined : (found ?? null)
}

/** Colors the selected letters, or the next ones at a caret; null takes the color off. */
export const setTextColor = (color: string | null) => (state: EditorState, dispatch: (tr: Transaction) => void) => {
  const type = state.schema.marks.text_color
  const { from, to, empty } = state.selection
  if (empty) {
    dispatch(color ? state.tr.addStoredMark(type.create({ color })) : state.tr.removeStoredMark(type))
    return
  }
  const tr = state.tr.removeMark(from, to, type)
  dispatch(color ? tr.addMark(from, to, type.create({ color })) : tr)
}

/** The ▾ lights, with a bar of the color, when the selection's one color is not one of the 3 quick tiles. */
export function moreTextColor(state: EditorState): string | null {
  const color = selectionTextColor(state)
  if (typeof color !== 'string' || color === '') return null
  return TEXT_BOX_COLORS.some((c) => c.color.toLowerCase() === color.toLowerCase()) ? null : color
}

const panels = new WeakMap<EditorView, TextColorPanel>()

/** The ▾'s press (Crepe runs it on pointerdown): open this editor's panel, or close it. */
export function toggleTextColorPanel(view: EditorView): void {
  panels.get(view)?.toggle()
}

class TextColorPanel {
  #el: HTMLElement | null = null
  #grid!: ColourGrid

  constructor(readonly view: EditorView) {
    panels.set(view, this)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  toggle(): void {
    if (this.open) this.close()
    else this.#show()
  }

  #build(): HTMLElement {
    const doc = this.view.dom.ownerDocument
    const el = doc.createElement('div')
    el.className = 'text-color-panel'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'More text colors')
    el.hidden = true

    this.#grid = new ColourGrid(doc, {
      noneLabel: NONE_LABEL,
      allowAlpha: false,
      defaultBoxHex: () => '#000000',
      onPick: (hex) => {
        if (this.#el!.contains(doc.activeElement)) this.view.focus()
        this.#pick(hex)
      },
      onClear: () => {
        this.#pick(null)
        this.close()
      },
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

  #pick(color: string | null): void {
    const { view } = this
    if (view.isDestroyed) return
    setTextColor(color)(view.state, view.dispatch)
    this.#render()
  }

  #render(): void {
    const color = selectionTextColor(this.view.state)
    const active = typeof color === 'string' ? [color] : []
    const startHex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? (color.toLowerCase() as Hex) : '#000000'
    this.#grid.render(active, startHex)
  }

  #show(): void {
    const doc = this.view.dom.ownerDocument
    this.#el ??= this.#build()
    const layer = popupLayerOf(this.view) ?? doc.body
    if (this.#el.parentElement !== layer) layer.appendChild(this.#el)
    this.#el.hidden = false
    this.#render()
    this.#place()
    toolbarItemOf(this.view, TEXT_COLOR_MORE_KEY)?.setAttribute('aria-expanded', 'true')
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
    this.#grid.closeCustom()
    toolbarItemOf(this.view, TEXT_COLOR_MORE_KEY)?.removeAttribute('aria-expanded')
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('pointerdown', this.#outside, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#scrolled, true)
    if (focused && !this.view.isDestroyed) this.view.focus()
  }

  /** Under the ▾, or over it when the window has no room below; never past the window's sides (the highlight panel's rule). */
  #place(): void {
    const el = this.#el!
    const win = this.view.dom.ownerDocument.defaultView
    const at = (toolbarItemOf(this.view, TEXT_COLOR_MORE_KEY) ?? this.view.dom).getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const roomBelow = win === null || at.bottom + 4 + height <= win.innerHeight - 8
    el.style.top = `${Math.round(roomBelow ? at.bottom + 4 : Math.max(8, at.top - 4 - height))}px`
    el.style.left = `${Math.round(win === null ? at.left : Math.max(8, Math.min(at.left, win.innerWidth - width - 8)))}px`
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
    }
  }

  #outside = (e: Event) => {
    const target = e.target
    if (!(target instanceof Node)) return
    if (this.#el?.contains(target) || toolbarItemOf(this.view, TEXT_COLOR_MORE_KEY)?.contains(target)) return
    this.close()
  }

  /** A scroll moves the panel with its ▾; with the toolbar gone, the panel goes too. */
  #scrolled = (e: Event) => {
    if (e.target instanceof Node && this.#el?.contains(e.target)) return
    if (toolbarItemOf(this.view, TEXT_COLOR_MORE_KEY) === null) this.close()
    else this.#place()
  }

  update(view: EditorView, prev: EditorState): void {
    if (!this.open) return
    if (!prev.selection.eq(view.state.selection) || view.state.selection.empty) this.close()
    else if (prev.doc !== view.state.doc) this.#render()
  }

  destroy(): void {
    this.close()
    this.#el?.remove()
    panels.delete(this.view)
  }
}

/** The panel of each text box editor. */
export const textColorPanel = $prose(() => new Plugin({ key: new PluginKey('textBoxTextColorPanel'), view: (view) => new TextColorPanel(view) }))
