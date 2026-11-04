/**
 * The highlight panel's own colour box (YAZ-4388), drawn in the panel right under its Hex code field. It replaces
 * Chromium's `<input type="color">` popup, which Electron opened at the window's top left whatever the input's
 * place. The look is that popup's: a saturation/brightness square with a round handle, an eyedropper, the colour,
 * a hue slider, and R G B fields.
 *
 * The box only chooses; the panel applies (`highlightPanel.ts`). A drag in the square or the slider previews (the
 * handles, the fields, the panel's hex); one finished pick — the pointer up, Enter in a field, the eyedropper's
 * colour — calls `pick` once, so it is one undo step and one use. The square and the slider cancel their
 * mousedown, so the text selection and the note's focus stay; only the R G B fields take the focus, to be typed in.
 *
 * Smoothness: a drag draws at most once a frame (the latest pointer wins), reads the layout before it writes, moves
 * the handles with `transform` only, and writes only what changed.
 */
import type { CustomHighlight } from './marks/highlight'

/** What the box tells the panel. */
export interface ColourBoxHooks {
  /** The colour while it is being chosen (a drag, a typed field). */
  preview: (hex: CustomHighlight) => void
  /** One finished pick. */
  pick: (hex: CustomHighlight) => void
  /** Escape in an R G B field: the box closes, the panel stays. */
  close: () => void
}

type Hsv = { h: number; s: number; v: number }

/** The browser's EyeDropper (Chromium has it, so Electron does), or null. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
const eyeDropperOf = (doc: Document): EyeDropperCtor | null =>
  (doc.defaultView as unknown as { EyeDropper?: EyeDropperCtor } | null)?.EyeDropper ?? null

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hexOfRgb = (rgb: readonly number[]): CustomHighlight => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

export function toHsv(hex: string): Hsv {
  const [r, g, b] = rgbOf(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}

export function fromHsv({ h, s, v }: Hsv): CustomHighlight {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return hexOfRgb([f(5), f(3), f(1)])
}

/** The eyedropper's answer, `#rrggbb` or `rgb(r, g, b)`: lowercase `#rrggbb`, else null. */
function readColour(text: string): CustomHighlight | null {
  const t = text.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t as CustomHighlight
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(t)
  return m === null ? null : hexOfRgb(m.slice(1, 4).map((c) => clamp(Number(c), 0, 255)))
}

/** A typed channel, 0 to 255, else null. */
const readByte = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text) <= 255 ? Number(text) : null)

/** Material's "colorize", the pipette Chromium's popup shows. */
const EYEDROPPER =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 0 0 .01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/></svg>'

export class ColourBox {
  readonly el: HTMLElement
  #sv: HTMLElement
  /** The handles' carriers: as big as their track, moved by a `translate` of their own size. */
  #svThumb: HTMLElement
  #hue: HTMLElement
  #hueThumb: HTMLElement
  #dropper: HTMLButtonElement
  #fields: HTMLInputElement[]
  /** Kept apart from the hex, so the hue survives a drag through gray or black. */
  #hsv: Hsv = { h: 0, s: 0, v: 0 }
  #dropping = false
  /** What #draw wrote last, so an unchanged style or attribute is not written again. */
  #drawn = new Map<string, string>()

  constructor(
    readonly doc: Document,
    readonly hooks: ColourBoxHooks,
  ) {
    const div = (className: string) => {
      const el = doc.createElement('div')
      el.className = className
      return el
    }
    this.el = div('highlight-panel__box')
    this.el.setAttribute('role', 'group')
    this.el.setAttribute('aria-label', 'Custom colour')
    this.el.hidden = true

    this.#sv = div('highlight-panel__sv')
    this.#sv.setAttribute('role', 'slider')
    this.#sv.setAttribute('aria-label', 'Saturation and brightness')
    this.#svThumb = div('highlight-panel__thumb')
    this.#svThumb.append(div('highlight-panel__sv-handle'))
    this.#sv.append(this.#svThumb)
    this.#drag(this.#sv, (x, y) => ({ ...this.#hsv, s: x, v: 1 - y }))

    const dropper = doc.createElement('button')
    dropper.type = 'button'
    dropper.className = 'highlight-panel__eyedropper'
    dropper.tabIndex = -1
    dropper.title = 'Pick a colour from the screen'
    dropper.setAttribute('aria-label', 'Pick a colour from the screen')
    dropper.innerHTML = EYEDROPPER
    dropper.addEventListener('mousedown', (e) => e.preventDefault())
    dropper.addEventListener('click', () => void this.#eyedrop())
    this.#dropper = dropper
    this.#hue = div('highlight-panel__hue')
    this.#hue.setAttribute('role', 'slider')
    this.#hue.setAttribute('aria-label', 'Hue')
    this.#hueThumb = div('highlight-panel__thumb')
    this.#hueThumb.append(div('highlight-panel__hue-handle'))
    this.#hue.append(this.#hueThumb)
    this.#drag(this.#hue, (x) => ({ ...this.#hsv, h: x * 360 }))
    const row = div('highlight-panel__box-row')
    row.append(dropper, div('highlight-panel__box-swatch'), this.#hue)

    const rgb = div('highlight-panel__rgb')
    this.#fields = ['Red', 'Green', 'Blue'].map((name) => {
      const label = doc.createElement('label')
      const input = doc.createElement('input')
      input.type = 'text'
      input.inputMode = 'numeric'
      input.maxLength = 3
      input.spellcheck = false
      input.tabIndex = -1
      input.setAttribute('aria-label', name)
      input.addEventListener('input', this.#typed)
      input.addEventListener('keydown', this.#fieldKey)
      input.addEventListener('blur', () => this.#draw())
      const letter = doc.createElement('span')
      letter.textContent = name[0]
      label.append(input, letter)
      rgb.append(label)
      return input
    })
    this.el.append(this.#sv, row, rgb)
  }

  get open(): boolean {
    return !this.el.hidden
  }

  get hex(): CustomHighlight {
    return fromHsv(this.#hsv)
  }

  show(hex: CustomHighlight): void {
    this.el.hidden = false
    this.#dropper.hidden = eyeDropperOf(this.doc) === null
    this.set(hex)
  }

  hide(): void {
    this.el.hidden = true
  }

  /** A colour from outside (the panel's hex field): the box follows, without a preview back. */
  set(hex: CustomHighlight): void {
    const next = toHsv(hex)
    // Gray has no hue and black no saturation: keep the ones the handles stand on.
    if (next.s === 0 || next.v === 0) next.h = this.#hsv.h
    if (next.v === 0) next.s = this.#hsv.s
    this.#hsv = next
    this.#draw()
  }

  /** `write(value)` unless `key` already holds `value`. */
  #put(key: string, value: string, write: (value: string) => void): void {
    if (this.#drawn.get(key) === value) return
    this.#drawn.set(key, value)
    write(value)
  }

  /** The handles, the square's hue, the colour and the fields (but the one being typed in); only what changed. */
  #draw(except?: HTMLInputElement): void {
    const { h, s, v } = this.#hsv
    const hex = this.hex
    this.#put('hue', `hsl(${h} 100% 50%)`, (x) => this.#sv.style.setProperty('--hue', x))
    this.#put('sv', `translate(${s * 100}%, ${(1 - v) * 100}%)`, (x) => (this.#svThumb.style.transform = x))
    this.#put('h', `translateX(${(h / 360) * 100}%)`, (x) => (this.#hueThumb.style.transform = x))
    this.#put('pick', hex, (x) => {
      this.el.style.setProperty('--pick', x)
      this.#sv.setAttribute('aria-valuetext', x)
    })
    this.#put('now', String(Math.round(h)), (x) => this.#hue.setAttribute('aria-valuenow', x))
    const rgb = rgbOf(hex)
    this.#fields.forEach((f, i) => {
      const value = String(rgb[i])
      if (f !== except && f.value !== value) f.value = value
    })
  }

  /**
   * A press in the square or the slider: the colour follows the pointer, and its release is the pick. The press and
   * the release draw at once; the moves between draw on the next frame, once, at the latest pointer.
   */
  #drag(el: HTMLElement, at: (x: number, y: number) => Hsv): void {
    // The selection and the focus stay where they are.
    el.addEventListener('mousedown', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return
      let x = e.clientX
      let y = e.clientY
      let frame: number | null = null
      const draw = () => {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        // The read comes before this frame's writes, so it forces no layout.
        const r = el.getBoundingClientRect()
        this.#hsv = at(clamp((x - r.left) / (r.width || 1)), clamp((y - r.top) / (r.height || 1)))
        this.#draw()
        this.hooks.preview(this.hex)
      }
      const move = (p: PointerEvent) => {
        x = p.clientX
        y = p.clientY
        frame ??= requestAnimationFrame(draw)
      }
      const end = (p: PointerEvent) => {
        this.doc.removeEventListener('pointermove', move)
        this.doc.removeEventListener('pointerup', end)
        this.doc.removeEventListener('pointercancel', end)
        if (p.type !== 'pointerup') {
          if (frame !== null) cancelAnimationFrame(frame)
          frame = null
          return
        }
        x = p.clientX
        y = p.clientY
        draw()
        if (this.open) this.hooks.pick(this.hex)
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // No capture (a synthetic event): the document's listeners still follow.
      }
      draw()
      this.doc.addEventListener('pointermove', move)
      this.doc.addEventListener('pointerup', end)
      this.doc.addEventListener('pointercancel', end)
    })
  }

  /** A typed R, G or B: previews once all three read. */
  #typed = (e: Event) => {
    const rgb = this.#fields.map((f) => readByte(f.value))
    if (rgb.some((c) => c === null)) return
    this.#hsv = toHsv(hexOfRgb(rgb as number[]))
    this.#draw(e.target as HTMLInputElement)
    this.hooks.preview(this.hex)
  }

  /** Enter picks; Escape closes the box; the up and down arrows step the channel (Shift: by 10). */
  #fieldKey = (e: KeyboardEvent) => {
    const field = e.target as HTMLInputElement
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Enter') {
      if (this.#fields.every((f) => readByte(f.value) !== null)) this.hooks.pick(this.hex)
    } else if (e.key === 'Escape') {
      this.hooks.close()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
      field.value = String(clamp((readByte(field.value) ?? 0) + step, 0, 255))
      this.#typed(e)
    }
  }

  /** The browser's eyedropper: its colour is a pick. Escape cancels it (the API rejects). */
  async #eyedrop(): Promise<void> {
    const EyeDropper = eyeDropperOf(this.doc)
    if (EyeDropper === null || this.#dropping) return
    this.#dropping = true
    this.#dropper.classList.add('is-active')
    try {
      const hex = readColour((await new EyeDropper().open()).sRGBHex)
      if (hex === null || !this.open) return
      this.set(hex)
      this.hooks.preview(hex)
      this.hooks.pick(hex)
    } catch {
      // Cancelled.
    } finally {
      this.#dropping = false
      this.#dropper.classList.remove('is-active')
    }
  }
}
