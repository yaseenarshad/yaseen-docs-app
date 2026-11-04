/**
 * The highlight ▾ menu of the selection toolbar (YAZ-4348 demo round 2): the ▾ after the highlight buttons opens
 * more colours (orange, purple, red, gray — each `<mark class="highlight-<name>">`), "Remove highlight", and
 * "Custom…", which opens the system colour picker (`table/colours.ts`, the cell colours' own) and saves the pick
 * as `<mark style="background-color: #rrggbb">` (CONTRACTS rule 31).
 *
 * The menu lives on the page's body, `position: fixed` under the ▾: Crepe's toolbar has `overflow: hidden`, so a
 * menu inside it would be cut off. It never takes the focus — its buttons cancel their mousedown and the keys
 * are read on the document while it is open — so the selection, and the toolbar over it, stay. Arrow keys,
 * Home and End move through its items, Enter or Space picks one, Escape closes it; any other key closes it and
 * goes on to the note. A click outside, a scroll or a new selection closes it too.
 *
 * A custom pick goes to the text that was selected when the picker opened: the macOS colour panel does not
 * block the window, so the user can select other text or type while it is open. The target is kept in this
 * plugin's state and mapped through each change, as `customColourPick` does for cells; a pick on text that
 * was deleted does nothing. One pick, one undo step.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx } from '@milkdown/kit/core'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  customWash,
  highlightColorsIn,
  highlightRange,
  highlightSchema,
  isCustomHighlight,
  MORE_HIGHLIGHTS,
  QUICK_HIGHLIGHTS,
  removeHighlightCommand,
  setHighlightCommand,
  type HighlightColor,
} from './marks/highlight'
import { openColourPicker } from './table/colours'
import { highlightIcon } from './toolbarButtons'

/** The ▾'s toolbar key. */
export const MORE_KEY = 'highlight-more'

/** Where the picker opens when the selection has no one custom colour: the yellow's own hue. */
const START = '#ffd500'

/** The text a custom pick goes to while the picker is open, or null. */
type Target = { from: number; to: number } | null
const pickKey = new PluginKey<Target>('mdapp-highlight-pick')

/** Whether the selection has a colour that is not a toolbar button: the ▾ lights for it. */
export const hasMenuColour = (colours: readonly HighlightColor[]): boolean =>
  colours.some((c) => c !== null && !(QUICK_HIGHLIGHTS as readonly string[]).includes(c))

/** Each open note's menu, so the toolbar's ▾ reaches the one of its own editor. */
const menus = new WeakMap<EditorView, HighlightMenu>()

/** The ▾'s press (Crepe runs it on pointerdown): open this editor's menu, or close it. */
export function toggleHighlightMenu(view: EditorView, by: 'pointer' | 'keyboard' = 'pointer'): void {
  menus.get(view)?.toggle(by)
}

interface Item {
  button: HTMLButtonElement
  run: () => void
}

class HighlightMenu {
  #el: HTMLElement | null = null
  #items: Item[] = []
  #current = -1
  #swatches = new Map<HighlightColor, HTMLButtonElement>()
  #custom: { button: HTMLButtonElement; swatch: HTMLElement } | null = null

  constructor(
    readonly ctx: Ctx,
    readonly view: EditorView,
  ) {
    menus.set(view, this)
    view.dom.ownerDocument.addEventListener('click', this.#keyboardOpen, true)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

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

  #build(): HTMLElement {
    const doc = this.view.dom.ownerDocument
    const el = doc.createElement('div')
    el.className = 'highlight-menu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', 'More highlight colours')
    el.hidden = true
    const button = (className: string, label: string, run: () => void): HTMLButtonElement => {
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = className
      b.tabIndex = -1
      b.title = label
      b.setAttribute('aria-label', label)
      // The selection and the focus stay in the note.
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => this.#pick(run))
      this.#items.push({ button: b, run })
      return b
    }
    const row = doc.createElement('div')
    row.className = 'highlight-menu__swatches'
    for (const color of MORE_HIGHLIGHTS) {
      const b = button('highlight-menu__swatch', `Highlight ${color}`, () => this.ctx.get(commandsCtx).call(setHighlightCommand.key, color))
      b.setAttribute('role', 'menuitemcheckbox')
      b.innerHTML = highlightIcon(color)
      this.#swatches.set(color, b)
      row.appendChild(b)
    }
    const remove = button('highlight-menu__row', 'Remove highlight', () => this.ctx.get(commandsCtx).call(removeHighlightCommand.key))
    remove.setAttribute('role', 'menuitem')
    remove.textContent = 'Remove highlight'
    const custom = button('highlight-menu__row', 'Custom…', () => this.#pickCustom())
    custom.setAttribute('role', 'menuitemcheckbox')
    const swatch = doc.createElement('span')
    swatch.className = 'highlight-menu__custom-swatch'
    swatch.setAttribute('aria-hidden', 'true')
    custom.append(swatch, doc.createTextNode('Custom…'))
    this.#custom = { button: custom, swatch }
    el.append(row, remove, custom)
    return el
  }

  #show(by: 'pointer' | 'keyboard'): void {
    const doc = this.view.dom.ownerDocument
    this.#el ??= this.#build()
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    this.#el.hidden = false
    this.#mark(this.view.state)
    this.#move(by === 'keyboard' ? 0 : -1)
    this.#place()
    doc.addEventListener('keydown', this.#key, true)
    doc.addEventListener('pointerdown', this.#outside, true)
    doc.addEventListener('mousedown', this.#outside, true)
    doc.addEventListener('scroll', this.#scrolled, true)
  }

  close = (): void => {
    if (!this.open) return
    this.#el!.hidden = true
    this.#move(-1)
    const doc = this.view.dom.ownerDocument
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('pointerdown', this.#outside, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#scrolled, true)
  }

  /** Under the ▾, or over it when the window has no room below; never past the window's sides. */
  #place(): void {
    const el = this.#el!
    const win = this.view.dom.ownerDocument.defaultView
    const at = (this.#arrow() ?? this.view.dom).getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const roomBelow = win === null || at.bottom + 4 + height <= win.innerHeight - 8
    const top = roomBelow ? at.bottom + 4 : Math.max(8, at.top - 4 - height)
    const left = win === null ? at.left : Math.max(8, Math.min(at.left, win.innerWidth - width - 8))
    el.style.top = `${Math.round(top)}px`
    el.style.left = `${Math.round(left)}px`
  }

  /** The colours the selection has: a ring on each, and the custom row shows its colour. */
  #mark(state: EditorState): void {
    const colours = highlightColorsIn(state, highlightSchema.type(this.ctx))
    for (const [color, b] of this.#swatches) {
      const on = colours.includes(color)
      b.classList.toggle('active', on)
      b.setAttribute('aria-checked', String(on))
    }
    const custom = colours.find(isCustomHighlight)
    const { button, swatch } = this.#custom!
    button.classList.toggle('active', custom !== undefined)
    button.setAttribute('aria-checked', String(custom !== undefined))
    swatch.style.background = custom === undefined ? '' : customWash(custom)
  }

  /** The keyboard's item: a class, since the focus never leaves the note or the ▾. */
  #move(index: number): void {
    this.#items[this.#current]?.button.classList.remove('is-current')
    this.#current = index
    this.#items[index]?.button.classList.add('is-current')
  }

  #key = (e: KeyboardEvent) => {
    const count = this.#items.length
    const step = (to: number) => {
      e.preventDefault()
      e.stopPropagation()
      this.#move(to)
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        this.close()
        return
      case 'ArrowDown':
      case 'ArrowRight':
        return step(this.#current < 0 ? 0 : (this.#current + 1) % count)
      case 'ArrowUp':
      case 'ArrowLeft':
        return step(this.#current <= 0 ? count - 1 : this.#current - 1)
      case 'Home':
        return step(0)
      case 'End':
        return step(count - 1)
      case 'Enter':
      case ' ': {
        e.preventDefault()
        e.stopPropagation()
        const item = this.#items[this.#current]
        if (item === undefined) this.close()
        else this.#pick(item.run)
        return
      }
      default:
        // Typing, Tab, a shortcut: the menu steps aside and the key goes on.
        if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) this.close()
    }
  }

  #outside = (e: Event) => {
    const target = e.target
    if (!(target instanceof Node)) return
    if (this.#el?.contains(target) || this.#arrow()?.contains(target)) return
    this.close()
  }

  #scrolled = (e: Event) => {
    if (e.target instanceof Node && this.#el?.contains(e.target)) return
    this.close()
  }

  #pick(run: () => void): void {
    this.close()
    run()
  }


  /** Custom…: the picker opens on the selection's one custom colour, else on yellow's hue; the pick goes to the text selected now. */
  #pickCustom(): void {
    const { view } = this
    const { from, to, empty } = view.state.selection
    if (empty) return
    const custom = highlightColorsIn(view.state, highlightSchema.type(this.ctx)).filter(isCustomHighlight)
    view.dispatch(view.state.tr.setMeta(pickKey, { from, to }))
    openColourPicker(view.dom.ownerDocument, custom.length === 1 ? custom[0] : START, (color) => {
      if (view.isDestroyed) return
      const target = pickKey.getState(view.state) ?? null
      const marked = target !== null && isCustomHighlight(color) ? highlightRange(view.state, highlightSchema.type(this.ctx), target.from, target.to, color) : null
      view.dispatch((marked === null ? view.state.tr : closeHistory(marked)).setMeta(pickKey, null))
    })
  }

  update(view: EditorView, prev: EditorState): void {
    if (!this.open) return
    if (!prev.selection.eq(view.state.selection) || view.state.selection.empty) this.close()
    else this.#mark(view.state)
  }

  destroy(): void {
    this.close()
    this.view.dom.ownerDocument.removeEventListener('click', this.#keyboardOpen, true)
    this.#el?.remove()
    menus.delete(this.view)
  }
}

/** The menu of each note, and the custom pick's target text, mapped through each change. */
export const highlightMenu = $prose(
  (ctx) =>
    new Plugin<Target>({
      key: pickKey,
      state: {
        init: () => null,
        apply: (tr, target) => {
          const meta = tr.getMeta(pickKey) as Target | undefined
          if (meta !== undefined) return meta
          if (target === null || !tr.docChanged) return target
          const from = tr.mapping.map(target.from, 1)
          const to = tr.mapping.map(target.to, -1)
          return from < to ? { from, to } : null
        },
      },
      view: (view) => new HighlightMenu(ctx, view),
    }),
)
