import './tables.css'

/**
 * TABLES THAT READ CLEANLY ON THE PHONE (YAZ-5471). Yaseen: tables looked "horrendous", "the columns are really junky".
 * The cause: a cell took the reader's `overflow-wrap: anywhere`, so the browser could squeeze every column to one
 * letter, and did, to fit the screen. Now each column gets a width from what it holds, before the page is laid out:
 *
 *  - FIT: a column whose cells are short (numbers, dates, check marks, a word or two: `FIT_MAX` em at most) is as wide
 *    as its longest cell and never wraps (`data-fit`). Numbers align right (`data-num`), unless the Markdown says.
 *  - GROW: a column of longer text wraps between words, inside a width from `--col-min` to `--col-max` em
 *    (`GROW_MIN` .. `GROW_MAX`, a comfortable line), sharing the screen by weight (`tables.css`, a container query unit).
 *    The min follows the column's longest word and its length, so a column of paragraphs never turns into a tower.
 *  - The first column of a table of three columns or more stays in place while it scrolls sideways (`data-sticky`),
 *    at most `STICKY_MAX` em wide.
 *
 * A table wider than the screen scrolls in its own box, with a soft shadow at the side with more, and a ⤢ button that
 * opens it full screen (`useTables`, `tableView`). The widths are counted from the text, not measured: no layout runs
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
}

const round = (n: number) => Math.round(n * 10) / 10

/** The columns of a table, from its cells (pure: no layout). */
export function columnsOf(table: HTMLTableElement): Column[] {
  const rows = [...table.rows]
  const count = Math.max(0, ...rows.map((r) => r.cells.length))
  const cols: Column[] = []
  for (let c = 0; c < count; c++) {
    let body = 0
    let word = 0
    let whole = 0
    let head = 0
    let filled = 0
    let numbers = 0
    for (const row of rows) {
      const cell = row.cells[c]
      if (cell === undefined) continue
      const em = cellEm(cell)
      if (cell.tagName === 'TH') {
        // A header may wrap between its words: only its longest word counts toward a FIT column.
        head = Math.max(head, em.word)
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
    if (natural <= FIT_MAX) {
      cols.push({ kind: 'fit', num, max: round(natural), min: round(natural) })
      continue
    }
    const max = Math.min(GROW_MAX, natural)
    // A whole code (it never wraps) sets the min too, past the long-text cap.
    const min = Math.min(max, Math.max(GROW_MIN, whole + PAD, Math.min(GROW_MIN_LONG, Math.max(word + PAD, natural / 4))))
    cols.push({ kind: 'grow', num: false, max: round(max), min: round(min) })
  }
  // The first column of a wide table stays in place; then it is at most STICKY_MAX wide.
  if (cols.length >= 3 && cols[0].kind === 'grow') {
    cols[0].max = Math.min(cols[0].max, STICKY_MAX)
    cols[0].min = Math.min(cols[0].min, cols[0].max)
  }
  return cols
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
  const group = document.createElement('colgroup')
  for (const col of cols) {
    const el = document.createElement('col')
    if (col.kind === 'grow') {
      el.className = 'page-table__grow'
      el.style.setProperty('--col-min', `${col.min}em`)
      el.style.setProperty('--col-max', `${col.max}em`)
      el.style.setProperty('--col-weight', String(round((col.max / grow) * 1000) / 1000))
    }
    group.append(el)
  }
  table.prepend(group)
  table.style.setProperty('--table-fixed', `${round(fixed)}em`)
  // Its width with every column at its widest: the full-screen view lays it out so.
  table.style.setProperty('--table-full', `${round(fixed + grow)}em`)
  if (cols.length >= 3) table.setAttribute('data-sticky', '')
  for (const row of table.rows) {
    ;[...row.cells].forEach((cell, c) => {
      const col = cols[c]
      if (col === undefined) return
      if (col.kind === 'fit') cell.setAttribute('data-fit', '')
      if (col.num && cell.getAttribute('align') === null) cell.setAttribute('data-num', '')
    })
  }
}

/** The ⤢ button under a table (shown when the table is wider than the screen: `data-wide`, `useTables`). */
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
  box.append(edge, openButton())
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
    frame(scroll)
  }
}
