/**
 * A BOARD EMBED'S OPTIONS (YAZ-4820 D1, D3): the size, view, lock and page of one window into a drawing
 * (`.excalidraw`) or a diagram (`.drawio`), kept in the embed's own text so that two embeds of one board keep two views.
 *
 *   this vault     `![[CloudFront.drawio|640x360 view=120,-40,0.8 locked page=R2lE]]`   (text under decorations)
 *   another vault  `![CloudFront|640x360 view=120,-40,0.8](../Other/CloudFront.drawio)`  (the stock image node's alt)
 *
 * `640x360` is Obsidian's own embed size, and so is `300`, a width alone (its height comes from the board's shape, A7);
 * the words after it are ours. A NEW embed is `![[CloudFront.drawio|locked]]` (YAZ-2571 round 7, `newEmbed`): no size,
 * only our words, so the window takes a new window's size and starts with its view locked. An embed with no options at
 * all is an older one, and stays unlocked as it always was. A word this build does not know is KEPT and
 * written back as it was, so a newer build's option survives an older build's write. `view` is the board point at the
 * window's top-left and the zoom; `formatEmbedOptions` rounds it (whole board units, zoom to 2 decimals) so a write
 * is short and a tiny move never changes the text (item 18 also gates the write itself: `movedEnough`).
 */
import { isBoard } from './fileKind'

export interface EmbedView {
  /** The board point at the window's top-left, in board units. */
  x: number
  y: number
  /** Screen pixels per board unit. */
  zoom: number
}

export interface EmbedOptions {
  /** The window's size in CSS pixels. Null: no size stored (a new embed's `|locked`), so the window takes a new one's. */
  width: number | null
  /** Null: a width alone (`|300`, Obsidian's form); the window takes its height from the board's shape. */
  height: number | null
  /** Null: no view stored yet, so the window fits the board. */
  view: EmbedView | null
  /** The user's lock (D9): saved, survives a reopen. Resting is never saved. */
  locked: boolean
  /** A draw.io page id (D6); null = the first page. */
  page: string | null
  /** Words this build does not know, in their order, kept byte-for-byte. */
  rest: string[]
}

const SIZE_RE = /^(\d{1,5})(?:x(\d{1,5}))?$/
const KNOWN = new Set(['view', 'locked', 'page'])

/** `.excalidraw` or `.drawio`, case-insensitive: the only targets that get a window. */
export function isBoardTarget(target: string): boolean {
  return isBoard(target.trim())
}

/**
 * Where the options start (the YAZ-4821 checker's round 1): the index of the LAST `|` of `text` when the words after
 * it parse as options, else -1. Any text before it, after the first `|`, is an alias, kept byte for byte:
 * `x.drawio|My name|640x360 view=…`. The image node's alt has the same form (`CloudFront|My name|640x360`).
 */
export function optionsPipe(text: string): number {
  const pipe = text.lastIndexOf('|')
  return pipe >= 0 && parseEmbedOptions(text.slice(pipe + 1)) !== null ? pipe : -1
}

/** `![[inner]]`'s parts: the target (with any `#…`, which renames keep) and the options text (`optionsPipe`; null when none). */
export function splitEmbed(inner: string): { target: string; options: string | null } {
  const pipe = inner.indexOf('|')
  const at = optionsPipe(inner)
  return { target: (pipe < 0 ? inner : inner.slice(0, pipe)).trim(), options: at < 0 ? null : inner.slice(at + 1) }
}

/** What a NEW embed's text carries after its `|` (YAZ-2571 round 7): its view starts locked. */
const NEW_EMBED_OPTIONS = 'locked'

/** A new embed of `inner` (a target, or a target and an alias): `![[CloudFront.drawio|locked]]`. Every way that makes an embed writes this. */
export const newEmbed = (inner: string): string => `![[${inner}|${NEW_EMBED_OPTIONS}]]`

/** A new board image's alt (an embed into another vault, `![CloudFront|locked](…)`): the same lock. */
export const newEmbedAlt = (name: string): string => `${name}|${NEW_EMBED_OPTIONS}`

/** The options text → options, or null when it is not an embed's options (a plain alias, say). */
export function parseEmbedOptions(text: string): EmbedOptions | null {
  const words = text.trim().split(/\s+/)
  const size = SIZE_RE.exec(words[0] ?? '')
  // No size (a new embed's `locked`): options only when every word is one of ours, so an alias stays an alias.
  if (size === null && !words.every((w) => KNOWN.has(w.split('=', 1)[0]!))) return null
  const width = size === null ? null : Number(size[1])
  const height = size?.[2] === undefined ? null : Number(size[2])
  if (width === 0 || height === 0) return null
  const out: EmbedOptions = { width, height, view: null, locked: false, page: null, rest: [] }
  for (const word of size === null ? words : words.slice(1)) {
    const eq = word.indexOf('=')
    const key = eq < 0 ? word : word.slice(0, eq)
    const value = eq < 0 ? '' : word.slice(eq + 1)
    if (!KNOWN.has(key)) out.rest.push(word)
    else if (key === 'locked' && eq < 0) out.locked = true
    else if (key === 'page' && value !== '') out.page = value
    else if (key === 'view') out.view = parseView(value) ?? out.view
    else out.rest.push(word)
  }
  return out
}

function parseView(value: string): EmbedView | null {
  const parts = value.split(',')
  if (parts.length !== 3) return null
  const [x, y, zoom] = parts.map(Number) as [number, number, number]
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) && zoom > 0 ? { x, y, zoom } : null
}

/** Rounds a view the way it is written: whole board units, zoom to 2 decimals (never 0). */
export function roundView(view: EmbedView): EmbedView {
  return { x: Math.round(view.x), y: Math.round(view.y), zoom: Math.max(0.01, Math.round(view.zoom * 100) / 100) }
}

/** Options → their text; the inverse of `parseEmbedOptions` for every value it returns. */
export function formatEmbedOptions(options: EmbedOptions): string {
  const words = options.width === null ? [] : [options.height === null ? `${Math.round(options.width)}` : `${Math.round(options.width)}x${Math.round(options.height)}`]
  if (options.view !== null) {
    const v = roundView(options.view)
    words.push(`view=${v.x},${v.y},${v.zoom}`)
  }
  if (options.locked) words.push('locked')
  if (options.page !== null) words.push(`page=${options.page}`)
  return [...words, ...options.rest].join(' ')
}

/** The `|…` part to write: the size and the rest, `|` included. */
export function optionsSuffix(options: EmbedOptions): string {
  return `|${formatEmbedOptions(options)}`
}

/** The smallest move worth a write (item 18): more than 4 screen pixels, or more than 2% of the zoom. */
export const MIN_MOVE_PX = 4
export const MIN_ZOOM_CHANGE = 0.02

/** True when `next` moved far enough from `prev` (the view last written) to write it. A size, lock or page change always counts. */
export function movedEnough(prev: EmbedOptions | null, next: EmbedOptions): boolean {
  if (prev === null) return true
  if (prev.width !== next.width || prev.height !== next.height || prev.locked !== next.locked || prev.page !== next.page) return true
  if (prev.view === null || next.view === null) return prev.view !== next.view
  const zoom = next.view.zoom
  if (Math.abs(next.view.zoom - prev.view.zoom) / prev.view.zoom > MIN_ZOOM_CHANGE) return true
  return Math.abs(next.view.x - prev.view.x) * zoom > MIN_MOVE_PX || Math.abs(next.view.y - prev.view.y) * zoom > MIN_MOVE_PX
}
