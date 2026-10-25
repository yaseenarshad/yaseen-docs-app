/**
 * The picture under the pointer while rows drag out to Finder (YAZ-3254 D6): a pill that holds the
 * row's name, or "N items", in the theme's `--accent-soft` and `--accent`, at the screen's pixel
 * ratio. Main hands it to the OS drag as the `icon` (`fs:drag-out`), so it is a PNG data URL.
 */

/** A 1×1 clear PNG: the OS drag needs a picture that is not empty (macOS), and a page with no canvas engine (jsdom) has no other. */
export const BLANK_PILL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

const HEIGHT = 22
const PAD = 10
/** A long name is cut with an ellipsis: the pill never grows past this width (CSS pixels). */
const MAX_TEXT = 240
const FONT = '500 12px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'

/** What the pill says: one row's name, or how many rows go. */
export const pillLabel = (names: readonly string[]): string => (names.length === 1 ? names[0] : `${names.length} items`)

/** `text` cut to `max` CSS pixels as `ctx` measures it, with an ellipsis where it was cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * The pill for `label` as a PNG data URL, drawn on a page canvas. Only where a canvas engine draws:
 * the probe is the 2D context that canvas draws with — Chromium has `CanvasRenderingContext2D`, jsdom
 * has none (it would only log "not implemented") — and anywhere else the blank pill.
 */
export function dragPill(label: string): string {
  if (typeof CanvasRenderingContext2D !== 'function') return BLANK_PILL
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx === null) return BLANK_PILL
  const theme = getComputedStyle(document.documentElement)
  const fill = theme.getPropertyValue('--accent-soft').trim() || '#eef0ff'
  const ink = theme.getPropertyValue('--accent').trim() || '#5b6cff'
  const ratio = window.devicePixelRatio || 1
  ctx.font = FONT
  const text = fit(ctx, label, MAX_TEXT)
  const width = Math.ceil(ctx.measureText(text).width) + PAD * 2
  canvas.width = Math.ceil(width * ratio)
  canvas.height = Math.ceil(HEIGHT * ratio)
  // A resize clears the context's state: scale and font again.
  ctx.scale(ratio, ratio)
  ctx.font = FONT
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(0, 0, width, HEIGHT, HEIGHT / 2)
  ctx.fill()
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, PAD, HEIGHT / 2)
  return canvas.toDataURL('image/png')
}
