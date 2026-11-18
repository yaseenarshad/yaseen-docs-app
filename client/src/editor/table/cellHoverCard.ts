/**
 * The hover card of a table cell (YAZ-4901): ONE controller per table host, so two cards never show at once. A note
 * table's (`cellNotePreview.ts`) and a folder page table's (`views/view/TableView.tsx`) both use it; this module has no
 * editor import, so a folder page loads nothing of ProseMirror for it.
 *
 * The host tells it the cell the pointer is over (`enter(cell)`, `enter(null)` off every cell) and gives `build`, which
 * says what card that cell gets, or null. A card shows after its dwell; warm (once a card showed), the next cell's card
 * shows at once, until the pointer has been off every cell for `CARD_WARM_MS` (item 6). The card goes when the pointer
 * leaves the cell, and on a key, a click, the wheel or a scroll anywhere (item 8), listened to only while a dwell or a
 * card is live; such a close ends the warm run too, so a key never brings a card straight back. Built on the pointer
 * only: nothing on a key or a caret move. Everything is cleaned up on `destroy`.
 *
 * The full-text card (items 4, 5): the cell note preview's look (`cellHoverCard.css`), no title and no hint, the cell's
 * lines wrapped, at most `CARD_TEXT_LINES` then "…"; right under the cell at its left edge, as wide as the cell (240 to
 * 420 px), above the cell when there is no room under it, never over the cell (YAZ-5747, `placeUnder`), kept inside the
 * window left and right. On `document.body`,
 * the pointer goes through it.
 */
import './cellHoverCard.css'

/** The dwell before a cut cell's card (item 6); a note-only preview keeps the app's hover dwell. */
export const CUT_CARD_DWELL_MS = 250
/** Warm: once a card showed, the next cell's card shows at once, until the pointer has been off every cell this long. */
export const CARD_WARM_MS = 500
/** The full-text part shows this many lines, then "…". */
export const CARD_TEXT_LINES = 12
/** The full-text card is as wide as its text, up to the cell's width clamped to these (YAZ-4903). */
const MIN_WIDTH = 240
const MAX_WIDTH = 420
/** Between the cell and the card, in px. */
const GAP = 4
/** A card keeps this much room from the top and the bottom of the window, in px: its CSS `max-height` is the window less 2 × this (YAZ-5717). */
const EDGE = 8

/** How many cards were built: a test proves that a key or a caret move builds none. */
export const cellHoverCardRuns = { builds: 0 }

/** A cell's card: its element, its dwell, and whether it goes under the cell (else the host placed it already). */
export interface CellCard {
  box: HTMLElement
  dwell: number
  under: boolean
}

export interface CellCards {
  /** The cell the pointer is over now, null off every cell. */
  enter(cell: HTMLElement | null): void
  /** The dwell or the card goes. */
  close(): void
  destroy(): void
}

/** The card's shell: the cell note preview's look, read-only. */
export function cardShell(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'cell-note-preview'
  box.setAttribute('role', 'status')
  return box
}

/** The full-text part: `lines` wrapped, at most `CARD_TEXT_LINES` of them, then "…". */
export function textPart(lines: string[]): HTMLElement {
  const part = document.createElement('div')
  part.className = 'cell-note-preview__text'
  for (const text of lines.length > CARD_TEXT_LINES ? [...lines.slice(0, CARD_TEXT_LINES), '…'] : lines) part.appendChild(textLine(text))
  return part
}

/** One line of the full-text part. */
function textLine(text: string): HTMLElement {
  const line = document.createElement('div')
  line.className = 'cell-note-preview__text-line'
  line.textContent = text
  return line
}

/** The space under the full-text part (a transparent border, YAZ-5780) and under the note's lines, in px (`cellHoverCard.css`). */
const PAD = 8
/** The full-text part's line height, in em (`.cell-note-preview__text` in `cellHoverCard.css`). */
const TEXT_LINE_HEIGHT = 1.4

/**
 * A card that its `max-height` cuts (YAZ-5717: the window less 16px, or the room beside the cell, YAZ-5747) ends with
 * "…", never in the middle with no sign, never in the note's title. Every card, on show only; a card that is not cut
 * reads only its own rect. True when it changed the card.
 * - The full-text part cut: it clamps to the rows that fit (`--fit-lines`, its own "…"), and the note's part under it goes.
 * - The full-text part fits, but the note's title, hint or first line does not (YAZ-5758): the note's part goes, and the
 *   text gets a last row "…", clamped to the rows that fit as above (then the browser's "…" ends the last row).
 * - Else the note's lines cut (YAZ-5746): the lines past the bottom go, and the last line that shows reads "…".
 */
export function fitCard(box: HTMLElement): boolean {
  const rect = box.getBoundingClientRect()
  // No layout (a box that is not drawn): nothing to measure.
  if (rect.height === 0) return false
  const text = box.querySelector<HTMLElement>('.cell-note-preview__text')
  const textRect = text?.getBoundingClientRect()
  /** The text part alone, in the rows of the card that fit. */
  const textOnly = (part: HTMLElement, partRect: DOMRect) => {
    while (part.nextElementSibling) part.nextElementSibling.remove()
    const row = parseFloat(getComputedStyle(part).fontSize) * TEXT_LINE_HEIGHT
    part.style.setProperty('--fit-lines', String(Math.min(CARD_TEXT_LINES, Math.max(1, Math.floor((rect.bottom - PAD - (partRect.top + PAD)) / row)))))
  }
  if (text && textRect && textRect.bottom > rect.bottom) {
    textOnly(text, textRect)
    return true
  }
  const bottom = rect.bottom - PAD
  const lines = Array.from(box.querySelectorAll<HTMLElement>('.cell-note-preview__line'))
  const past = lines.findIndex((line) => line.getBoundingClientRect().bottom > bottom)
  if (past < 0) return false
  if (past === 0 && text && textRect) {
    if (text.lastElementChild?.textContent !== '…') text.appendChild(textLine('…'))
    textOnly(text, textRect)
    return true
  }
  const keep = Math.max(1, past)
  for (const line of lines.slice(keep)) line.remove()
  lines[keep - 1].textContent = '…'
  return true
}

/**
 * Under the cell at its left edge; above it when there is no room under; inside the window. As wide as its text
 * (YAZ-4903: no empty room beside a short text), up to the cell's width clamped to 240–420 px, then the text wraps.
 * It never covers its cell (YAZ-5747): a card that fits on neither side goes to the side with more room, as tall as
 * that room, and `fitCard` ends what this cuts with "…". Gives the cell's top when the card is above it, else null.
 */
function placeUnder(box: HTMLElement, cell: HTMLElement): number | null {
  const rect = cell.getBoundingClientRect()
  box.style.width = 'max-content'
  box.style.maxWidth = `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.width))}px`
  box.style.top = `${rect.bottom + GAP}px`
  document.body.appendChild(box)
  const width = box.offsetWidth
  box.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - width))}px`
  const height = box.offsetHeight
  // The room under the cell and above it, `EDGE` from the window's edges.
  const under = window.innerHeight - EDGE - (rect.bottom + GAP)
  const above = rect.top - GAP - EDGE
  if (height <= under) return null
  const up = height <= above || above > under
  const room = Math.max(0, up ? above : under)
  if (height > room) box.style.maxHeight = `${room}px`
  if (!up) return null
  box.style.top = `${rect.top - GAP - Math.min(height, room)}px`
  return rect.top
}

export function cellHoverCards(build: (cell: HTMLElement) => CellCard | null): CellCards {
  /** The cell the pointer is over, its card (null when it has none), the dwell, and the card on the page. */
  let current: HTMLElement | null = null
  let card: CellCard | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let shown: HTMLElement | null = null
  /** A card showed, and the pointer has not been off every cell for `CARD_WARM_MS` since. */
  let warm = false
  let cooling: ReturnType<typeof setTimeout> | null = null
  const events = ['keydown', 'mousedown', 'wheel', 'scroll'] as const
  const close = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    shown?.remove()
    shown = null
    if (card !== null) for (const type of events) window.removeEventListener(type, closeByEvent, true)
    card = null
    current = null
  }
  /** A key, a click, the wheel or a scroll: the card goes, and the warm run ends. */
  const closeByEvent = () => {
    close()
    cool()
  }
  const cool = () => {
    if (cooling !== null) clearTimeout(cooling)
    cooling = null
    warm = false
  }
  const show = () => {
    timer = null
    if (card === null || current === null) return
    let cellTop: number | null = null
    if (card.under) cellTop = placeUnder(card.box, current)
    else {
      // The host placed it beside the cell. A box below the window's bottom moves up (YAZ-5717): one read, on show only.
      document.body.appendChild(card.box)
      const rect = card.box.getBoundingClientRect()
      if (rect.bottom > window.innerHeight - EDGE) card.box.style.top = `${Math.max(EDGE, window.innerHeight - EDGE - rect.height)}px`
    }
    // A card above its cell that the fit made shorter moves down, `GAP` above the cell again: one more read, on show only.
    if (fitCard(card.box) && cellTop !== null) card.box.style.top = `${cellTop - GAP - card.box.getBoundingClientRect().height}px`
    shown = card.box
    warm = true
  }
  return {
    enter: (cell) => {
      if (cell === current) return
      close()
      if (cell === null) {
        if (warm && cooling === null) cooling = setTimeout(cool, CARD_WARM_MS)
        return
      }
      if (cooling !== null) clearTimeout(cooling)
      cooling = null
      current = cell
      cellHoverCardRuns.builds++
      card = build(cell)
      if (card === null) return
      for (const type of events) window.addEventListener(type, closeByEvent, true)
      if (warm) show()
      else timer = setTimeout(show, card.dwell)
    },
    close,
    destroy: () => {
      close()
      cool()
    },
  }
}
