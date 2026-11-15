import './tables.css'

/**
 * TABLES THAT READ CLEANLY ON THE PHONE. Yaseen: tables looked "horrendous", "the columns are really junky".
 * The cause: a cell took the reader's `overflow-wrap: anywhere`, so the browser could squeeze every column to one
 * letter, and did, to fit the screen. Now each column gets a width from what it holds, before the page is laid out:
 *
 *  - FIT: a column whose cells are short (numbers, dates, check marks, a word or two: `FIT_MAX` em at most) is as wide
 *    as its longest cell and never wraps (`data-fit`). Numbers align right (`data-num`), unless the Markdown says.
 *  - GROW: a column of longer text wraps between words, inside a width from `--col-min` to `--col-max` em
 *    (`GROW_MIN` .. `GROW_MAX`, a comfortable line), sharing the screen by weight (`tables.css`, a container query unit).
 *    The min follows the column's longest word and its length, so a column of paragraphs never turns into a tower.
 *  - The first column of a table of three columns or more stays in place while it scrolls sideways (`data-sticky`),
 *    at most `STICKY_MAX` em wide. A table whose file freezes columns (`freeze 2 cols`, YAZ-5480, `tableFile.ts`)
 *    keeps THOSE in place instead, each at most `STICKY_MAX` em wide (`frozenColumns`).
 *  - YAZ-5480: the frozen rows (the file's `freeze N rows`, else the header row, as the Mac's sticky header) stay at the
 *    top while the page scrolls down through the table (`markFrozen`, `tables.css`).
 *
 * A table wider than the screen scrolls in its own box, with a soft shadow at the side with more, and a ⤢ button (top
 * right) that opens it full screen (`useTables`, `tableView`). The widths are counted from the text, not measured: no layout runs
 * here, so a long page still draws in quick slices. A table whose columns the Mac sized (`data-sized`) keeps them.
 */

/** Em of the table's font, for one character (system font, 14 px; a capital or a digit is wider). */
const EM = { narrow: 0.5, wide: 0.62, mono: 0.6, emoji: 1.3, cjk: 1 }
/** A cell's padding, both sides, in em (`tables.css`: 0.75em each side). */
export const PAD = 1.5
/** A column this wide or less (with its padding) is FIT: it never wraps. */
export const FIT_MAX = 10
/** The narrowest and widest a GROW column gets. */
export const GROW_MIN = 7
export const GROW_MAX = 22
/** The longest min of a GROW column (a column of paragraphs). */
export const GROW_MIN_LONG = 12
/** The widest sticky first column. */
export const STICKY_MAX = 11
/** A column is numbers when this share of its filled cells are. */
const NUM_SHARE = 0.6

const NUMBER = /^[-+−]?[$€£¥]?\s?\d[\d,.\s:/'’-]*\s?(%|[kKmMbB]|[a-zA-Z]{1,3})?$/
const EMOJI = /\p{Extended_Pictographic}/u
const CJK = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/

/** The width of `text` in em of the table's font. */
export function textEm(text: string, mono = false): number {
  let em = 0
  for (const ch of text) {
    if (ch === '\u200d' || ch === '\ufe0f') continue
    if (EMOJI.test(ch)) em += EM.emoji
    else if (CJK.test(ch)) em += EM.cjk
    else if (mono) em += EM.mono
    else em += /[A-Z0-9MW@#%&]/.test(ch) ? EM.wide : EM.narrow
  }
  return em
}

/** A short inline code (a command, a name) stays on one line in a cell (`data-whole`): never broken at a `-` or `.`. */
const WHOLE_CODE = 30

/** A cell's text, its longest word and its longest whole code, in em (code counts as code). */
function cellEm(cell: Element): { all: number; word: number; whole: number } {
  let all = 0
  let word = 0
  let whole = 0
  const walk = (node: Node, mono: boolean) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? ''
        all += textEm(text, mono)
        for (const w of text.split(/\s+/)) word = Math.max(word, textEm(w, mono))
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        if (el.tagName === 'BR') continue
        // A task box or a link pill is about a letter or two wider than its words.
        if (el.classList.contains('page-task')) all += 1.4
        if (el.tagName === 'CODE' && [...(el.textContent ?? '')].length <= WHOLE_CODE) {
          el.setAttribute('data-whole', '')
          whole = Math.max(whole, textEm(el.textContent ?? '', true))
        }
        walk(el, mono || el.tagName === 'CODE')
      }
    }
  }
  walk(cell, false)
  return { all, word, whole }
}

export type ColumnKind = 'fit' | 'grow'
export interface Column {
  kind: ColumnKind
  /** Numbers: aligned right. */
  num: boolean
  /** FIT: its width; GROW: its widest (both with the padding), em. */
  max: number
  /** GROW: its narrowest, em. */
  min: number
  /** GROW: its share of the screen against the other long columns (the Mac's width); else its widest. */
  weight?: number
}

const round = (n: number) => Math.round(n * 10) / 10

/** The columns of a table, from its cells (pure: no layout). */
export function columnsOf(table: HTMLTableElement): Column[] {
  // Each column's cells by the grid (a merged cell sits in its left column); one that spans columns sizes none.
  const grid = gridColumns(table)
  const byColumn: HTMLTableCellElement[][] = []
  for (const [cell, c] of grid) if (cell.colSpan <= 1) (byColumn[c] ??= []).push(cell)
  const count = Math.max(0, ...[...grid].map(([cell, c]) => c + Math.max(1, cell.colSpan)))
  const widths = macWidths(table)
  const cols: Column[] = []
  for (let c = 0; c < count; c++) {
    let body = 0
    let word = 0
    let whole = 0
    let head = 0
    let filled = 0
    let numbers = 0
    let clip = false
    for (const cell of byColumn[c] ?? []) {
      const clipped = cell.hasAttribute('data-clip')
      if (clipped) clip = true
      const em = cellEm(cell)
      if (cell.tagName === 'TH') {
        // A header may wrap between its words: only its longest word counts toward a FIT column. Sweep3 N-6: a clipped
        // header is one line: all of it counts.
        head = Math.max(head, clipped ? em.all : em.word)
        word = Math.max(word, em.word)
        continue
      }
      body = Math.max(body, em.all)
      word = Math.max(word, em.word)
      whole = Math.max(whole, em.whole)
      const text = (cell.textContent ?? '').trim()
      if (text !== '') {
        filled++
        if (NUMBER.test(text)) numbers++
      }
    }
    const natural = Math.max(body, head) + PAD
    const num = filled > 0 && numbers >= filled * NUM_SHARE
    // The Mac's width for the column, in em on a phone (`macWidths`), or null (`auto`).
    const mac = widths[c] ?? null
    if (natural <= FIT_MAX) {
      // A short column stays as wide as its text, whatever the Mac's width: on a phone its room goes to the long ones
      // (in the headless pictures, the Mac's extra room on short columns squeezed the long column into a tower).
      cols.push({ kind: 'fit', num, max: round(natural), min: round(natural) })
      continue
    }
    // A clipped column (one line, cut with "…") has no word that holds it open: its min is GROW_MIN.
    const min0 = clip ? GROW_MIN : Math.max(GROW_MIN, whole + PAD, Math.min(GROW_MIN_LONG, Math.max(word + PAD, natural / 4)))
    const max = Math.min(GROW_MAX, natural)
    // A whole code (it never wraps) sets the min too, past the long-text cap.
    if (mac === null) {
      cols.push({ kind: 'grow', num: false, max: round(max), min: round(Math.min(max, min0)) })
      continue
    }
    // A longer column the Mac sized shares the screen in the Mac's proportions (its weight), and the Mac's
    // width is a floor up to GROW_MIN_LONG (a phone has no room for more); never under the column's own min, so its
    // words stay whole, and never past its widest (a comfortable line).
    const min = Math.min(max, Math.max(min0, Math.min(mac, GROW_MIN_LONG)))
    cols.push({ kind: 'grow', num: false, max: round(max), min: round(min), weight: mac })
  }
  // The columns that stay in place (the first of a wide table, or the file's frozen ones): each at most STICKY_MAX wide.
  for (const col of cols.slice(0, frozenColumns(table, cols.length))) {
    if (col.kind !== 'grow') continue
    col.max = Math.min(col.max, STICKY_MAX)
    col.min = Math.min(col.min, col.max)
  }
  return cols
}

/** The phone's share of a Mac column's width: a phone shows a table smaller than the Mac's page does. */
export const MAC_WIDTH_SCALE = 0.7
/** The px of one em of the phone's table font (14 px: `tables.css`, 0.875em of the reader's 16). */
const TABLE_PX = 14

/**
 * The Mac's column widths (the table comment's `widths`, as `tableFile.ts` puts them on the table,
 * `data-widths="140 240 auto"`), in em of the phone's table font, scaled by `MAC_WIDTH_SCALE`; `null` for `auto`.
 * Translated, not copied (`columnsOf`): a short column keeps its text's width; a longer one takes the Mac's width as
 * its share of the screen and as a floor up to `GROW_MIN_LONG`; no column is ever under its words (readable).
 */
export function macWidths(table: HTMLTableElement): Array<number | null> {
  const own = table.getAttribute('data-widths')
  if (own === null) return []
  return own.split(' ').map((w) => (w === 'auto' || !(Number(w) > 0) ? null : (Number(w) * MAC_WIDTH_SCALE) / TABLE_PX))
}

/**
 * The columns that stay at the left while the table scrolls sideways: the file's frozen columns
 * (`data-freeze-cols`, `tableFile.ts`) when it freezes any; else the phone's own rule, the first column of a table of
 * three columns or more. The Mac freezes no column by default.
 */
export function frozenColumns(table: HTMLTableElement, count: number): number {
  const own = Number(table.getAttribute('data-freeze-cols') ?? 0)
  return own > 0 ? Math.min(own, count) : count >= 3 ? 1 : 0
}

/**
 * The rows that stay at the top while the page scrolls down through the table: the file's
 * (`data-freeze-rows`, the Mac's rule in `tableFile.ts`: its own `freeze N rows`, else the header row unless the table
 * says `nostickyheader`); a table with no comment, the header row: the Mac's Sticky header row is on by default.
 */
export function frozenRows(table: HTMLTableElement): number {
  const own = table.getAttribute('data-freeze-rows')
  const rows = own === null ? (table.tHead !== null ? 1 : 0) : Number(own)
  return Math.max(0, Math.min(rows, table.rows.length))
}

/**
 * Each cell's grid column, a merged cell's (`colspan`, `rowspan`) at its left: the cells a `rowspan` covers in the rows
 * under it push the later cells right. Pure: no layout.
 */
export function gridColumns(table: HTMLTableElement): Map<HTMLTableCellElement, number> {
  const out = new Map<HTMLTableCellElement, number>()
  const taken: number[][] = []
  ;[...table.rows].forEach((row, r) => {
    let c = 0
    for (const cell of row.cells) {
      while (taken[r]?.[c] !== undefined) c++
      out.set(cell, c)
      for (let dr = 0; dr < Math.max(1, cell.rowSpan); dr++) for (let dc = 0; dc < Math.max(1, cell.colSpan); dc++) (taken[r + dr] ??= [])[c + dc] = 1
      c += Math.max(1, cell.colSpan)
    }
  })
  return out
}

/**
 * Marks the frozen rows and columns of a table, once: the table's `data-pin-rows` and `data-pin-cols`, each
 * cell of a frozen row `data-pin-row` (the last row's `data-pin-row-end`), each cell of a frozen column `data-pin-col`
 * with its `left` (`--pin-left`, the column's offset that `useTables` measures, `--freeze-x-<n>`), the last column's
 * `data-pin-col-end`. `tables.css` makes them stay; nothing runs on a scroll.
 */
export function markFrozen(table: HTMLTableElement): void {
  if (table.hasAttribute('data-pin-rows')) return
  const grid = gridColumns(table)
  const count = Math.max(0, ...[...grid].map(([cell, c]) => c + Math.max(1, cell.colSpan)))
  const rows = frozenRows(table)
  const cols = frozenColumns(table, count)
  table.setAttribute('data-pin-rows', String(rows))
  table.setAttribute('data-pin-cols', String(cols))
  table.toggleAttribute('data-sticky', cols > 0)
  ;[...table.rows].forEach((row, r) => {
    for (const cell of row.cells) {
      if (r < rows) {
        cell.setAttribute('data-pin-row', '')
        if (r + Math.max(1, cell.rowSpan) >= rows) cell.setAttribute('data-pin-row-end', '')
      }
      const c = grid.get(cell)!
      if (c < cols) {
        cell.setAttribute('data-pin-col', '')
        cell.style.setProperty('--pin-left', `var(--freeze-x-${c}, 0px)`)
        if (c + Math.max(1, cell.colSpan) >= cols) cell.setAttribute('data-pin-col-end', '')
      }
    }
  })
}

/**
 * Gives a table its column widths and marks (`data-cols`): a `<colgroup>`, `data-fit` / `data-num` on the cells,
 * `data-sticky` on the table. Once per table.
 */
export function layoutTable(table: HTMLTableElement): void {
  if (table.hasAttribute('data-cols') || table.hasAttribute('data-sized') || table.querySelector(':scope > colgroup') !== null) return
  const cols = columnsOf(table)
  table.setAttribute('data-cols', String(cols.length))
  if (cols.length === 0) return
  const fixed = cols.reduce((n, c) => n + (c.kind === 'fit' ? c.max : 0), 0)
  const grow = cols.reduce((n, c) => n + (c.kind === 'grow' ? c.max : 0), 0)
  const weights = cols.reduce((n, c) => n + (c.kind === 'grow' ? (c.weight ?? c.max) : 0), 0)
  const group = document.createElement('colgroup')
  for (const col of cols) {
    const el = document.createElement('col')
    if (col.kind === 'grow') {
      el.className = 'page-table__grow'
      el.style.setProperty('--col-min', `${col.min}em`)
      el.style.setProperty('--col-max', `${col.max}em`)
      el.style.setProperty('--col-weight', String(round(((col.weight ?? col.max) / weights) * 1000) / 1000))
    }
    group.append(el)
  }
  table.prepend(group)
  table.style.setProperty('--table-fixed', `${round(fixed)}em`)
  // Its width with every column at its widest: the full-screen view lays it out so.
  table.style.setProperty('--table-full', `${round(fixed + grow)}em`)
  for (const [cell, c] of gridColumns(table)) {
    const col = cols[c]
    if (col === undefined) continue
    // A clipped cell holds its text in one line, cut with "…" at its column's widest. Sweep3 N-6:
    // only a text truly longer than that: a FIT column is as wide as its text (nothing to cut), and a header that fits
    // its column stays whole (a bold header is wider than the count, and was cut to "Co…" with half the screen free).
    const span = cols.slice(c, c + Math.max(1, cell.colSpan))
    const widest = span.reduce((n, k) => n + k.max, 0) - PAD
    const tooLong = span.some((k) => k.kind === 'grow') && (cell.tagName !== 'TH' || cellEm(cell).all > widest)
    if (cell.hasAttribute('data-clip') && tooLong) clipCell(cell, widest)
    if (cell.colSpan > 1) continue
    if (col.kind === 'fit') cell.setAttribute('data-fit', '')
    if (col.num && cell.getAttribute('align') === null) cell.setAttribute('data-num', '')
  }
}

/** A clipped cell's text in one box, one line, cut with "…" at `max` em (a cell itself cannot cut its text). */
function clipCell(cell: HTMLTableCellElement, max: number): void {
  const box = document.createElement('div')
  box.className = 'page-table__clip'
  box.style.maxWidth = `${max}em`
  box.append(...cell.childNodes)
  cell.append(box)
}

/** The ⤢ button at the top right of a table, above its frame (shown when the table is wider than the screen: `data-wide`, `useTables`). */
function openButton(): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'page-table__bar'
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'page-table__open'
  open.setAttribute('data-table-open', '')
  open.setAttribute('aria-label', 'Open the table full screen')
  open.textContent = '⤢'
  bar.append(open)
  return bar
}

/** Wraps a table's scroll box (`.page-table`) in its frame and box: the shadows, the sticky column, the ⤢ button. */
function frame(scroll: HTMLElement): void {
  const box = document.createElement('div')
  box.className = 'page-table-box'
  const edge = document.createElement('div')
  edge.className = 'page-table-frame'
  scroll.replaceWith(box)
  edge.append(scroll)
  // ⤢ sits at the top right, ABOVE the frame: never over the sticky first column or the header text.
  box.append(openButton(), edge)
}

/**
 * Every table in `root`: a page's table goes in a box that scrolls sideways (`.page-table`); a card's table
 * (`.card__table`, the Mac's `renderCard`) is its own box. Each gets its widths and its frame. Once per table.
 */
export function layoutTables(root: ParentNode): void {
  for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
    if (table.closest('.page-table-box') !== null) continue
    let scroll = table.parentElement
    if (scroll === null || !scroll.classList.contains('card__table')) {
      scroll = document.createElement('div')
      table.replaceWith(scroll)
      scroll.append(table)
    }
    scroll.classList.add('page-table')
    layoutTable(table)
    markFrozen(table)
    frame(scroll)
  }
}
