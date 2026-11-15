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
 * 420 px), above the cell when there is no room under it, kept inside the window left and right. On `document.body`,
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
  for (const text of lines.length > CARD_TEXT_LINES ? [...lines.slice(0, CARD_TEXT_LINES), '…'] : lines) {
    const line = document.createElement('div')
    line.className = 'cell-note-preview__text-line'
    line.textContent = text
    part.appendChild(line)
  }
  return part
}

/**
 * Under the cell at its left edge; above it when there is no room under; inside the window. As wide as its text
 * (YAZ-4903: no empty room beside a short text), up to the cell's width clamped to 240–420 px, then the text wraps.
 */
function placeUnder(box: HTMLElement, cell: HTMLElement): void {
  const rect = cell.getBoundingClientRect()
  box.style.width = 'max-content'
  box.style.maxWidth = `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.width))}px`
  box.style.top = `${rect.bottom + GAP}px`
  document.body.appendChild(box)
  const width = box.offsetWidth
  box.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - width))}px`
  const height = box.offsetHeight
  if (rect.bottom + GAP + height > window.innerHeight) box.style.top = `${Math.max(0, rect.top - GAP - height)}px`
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
    if (card.under) placeUnder(card.box, current)
    else document.body.appendChild(card.box)
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
