/**
 * The table comment itself (YAZ-3758, YAZ-3696 🔒 D1 / D3 / D7 / S3; CONTRACTS rule 41a): the one
 * reader and writer of `<!-- table: … -->`. No editor imports, on purpose: the line-number worker
 * (`lineNumbers/blockLines.ts`, rule 34) reads the same comment to know that it is no block of the
 * page, as it does for the line comment (`line/lineComment.ts`). `tableStyle.ts` re-exports all of it.
 *
 * The parts, in their fixed order, each only when set:
 * `widths 140 240 auto, fill A1:C1 blue B3 #ff8800, color B2:B5 red, align B2:C3 center, valign middle A2:A40 top,
 * border 2px 40%, header plain, stripes, height compact, nowrap, freeze 2 rows 1 col, calendar 30m`. `valign` (YAZ-4166,
 * D10) is ONE part: an optional first bare value is the table's default (`middle` or `bottom`; `top` is the default
 * and writes nothing), then cell ranges and values as `align` writes them; a cell's own value wins over the table's.
 * `fold 20-29 31-33` (YAZ-4165, D3) names the folded rows: 1-based, row 1 is the header (never folded), each run of
 * rows that touch as `first-last`, a run of one row as its number. It goes after `merge`. `merge A1:B1 A2:A3` (YAZ-4792)
 * names the merged cells: each range is one merged cell, its top-left cell first, in reading order, after `valign`.
 * The GFM grid in the file stays whole: a cell a merge covers is written empty, and the merged cell's text is in its
 * top-left cell, so GitHub and Obsidian read a plain table. A range the table cannot take — out of the table, one cell,
 * over another range, or from the header row into the body — is dropped on load (`validMerges`), and so on the next
 * save. `zoom 90%` (YAZ-4091, D13) is
 * the table's own zoom, a whole percent from 50 to 400 (the page zoom pill's range); 100% is the default and writes
 * nothing. It goes after `fold`. `calendar` (YAZ-4162,
 * D1) is the slot length of a calendar table, `15m`, `30m` or `60m`, after `freeze`. `header` (YAZ-4774) is the header
 * row's own look: its set parts in any order, each a word of `HEADER_ROW_CHOICES` (`header red strong regular muted`);
 * an unset part is Settings › Tables › Header row. Strength Off alone writes `plain`, the word of before, and a read
 * takes `plain` as Off and `shaded` as nothing set (the default), so a comment from an older build reads as before.
 * YAZ-4794: a text colour is `text-<colour>` (`text-blue`) and the row's alignment `align-<value>` (`align-follow`,
 * `align-left`, `align-center`, `align-right`), so neither reads as a fill colour (`blue`) or another part; Muted and
 * Full keep their bare words (`muted`, `full`), and `text-muted` / `text-full` read the same. An older build keeps
 * a `header` part with a new word as its text (below), so it never loses it.
 * `nonow` (the YAZ-4163 demo) is a calendar table with no "Now" chip; `notebutton` / `nonotebutton` (YAZ-4790) a table that
 * shows / hides the cell note "+" button whatever Settings say. Then `super` (YAZ-4869 S1) marks a Super table, and each
 * of its views is one `view …` part, in the views' order (`super/viewGrammar.ts` holds that part's grammar): they are
 * last. A `view` part may repeat, and one this build cannot read is kept as its text even when it writes views itself. A column's alignment is no
 * part: it is the GFM `:-` row, so GitHub and Obsidian show it too ("Align all columns" sets it,
 * YAZ-3767); `align` is a cell's own, which wins over its column's (YAZ-3819). Cells are A1 addresses:
 * columns are letters (A…Z, AA…), rows are numbers, row 1 is the header row.
 *
 * The reader is tolerant: a part it does not know (its first word is no part, YAZ-4161), and a known
 * part with a value it cannot read (`calendar 45m`, `zoom 500%`, a new `valign` value; YAZ-4176), are
 * KEPT as their text: an older or a newer build never deletes a setting it cannot read. Such a part
 * keeps its place after the known part before it that it read; with none before it, or when that part
 * is no longer set, it goes after the known parts, in its order. A known part kept as its text goes
 * only when this build writes that part itself. A comment with no part it reads is not ours (`null`),
 * and the editor keeps it as an HTML node with its text.
 */
import { HEADER_ROW_CHOICES, HEADER_ROW_PARTS, type HeaderRowOwn } from '@shared/types'
import { formatView, readView, splitParts, type TableViewDef } from './super/viewGrammar'

/**
 * The cell colours, for fill and text (YAZ-3817, from YAZ-3696 D3 / D8): ten names, each with its own
 * light and dark shade (`table.css`). A custom colour is `#rrggbb`, lowercase.
 */
export const TABLE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'] as const
export type TableColor = (typeof TABLE_COLORS)[number]

/** A cell's fill or text colour, checked: a name, or `#rrggbb` (any case in, lowercase out), else `null`. */
export function cellColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if ((TABLE_COLORS as readonly string[]).includes(value)) return value
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null
}

/** A header part's word in the comment (YAZ-4794): `text-<colour>` and `align-<value>`; every other value is its bare word. */
export function headerWord<K extends keyof HeaderRowOwn>(part: K, value: NonNullable<HeaderRowOwn[K]>): string {
  if (part === 'align') return `align-${value}`
  return part === 'text' && value !== 'muted' && value !== 'full' ? `text-${value}` : value
}

/**
 * The part and value a `header` word names, or `null` (YAZ-4794): `plain` is Strength Off (YAZ-4774), `text-*` and
 * `align-*` the text colour and the alignment, and a bare word a Color, Strength or Weight choice, or `muted` / `full`.
 * A bare colour is always the fill, as before; a bare alignment word is no word.
 */
function readHeaderWord(word: string): [keyof HeaderRowOwn, string] | null {
  if (word === 'plain') return ['strength', 'off']
  const prefixed = /^(text|align)-(.+)$/.exec(word)
  if (prefixed !== null) {
    const part = prefixed[1] as 'text' | 'align'
    return (HEADER_ROW_CHOICES[part] as readonly string[]).includes(prefixed[2]) ? [part, prefixed[2]] : null
  }
  if (word === 'muted' || word === 'full') return ['text', word]
  const part = (['color', 'strength', 'weight'] as const).find((p) => (HEADER_ROW_CHOICES[p] as readonly string[]).includes(word))
  return part === undefined ? null : [part, word]
}

/** A cell's own alignment (YAZ-3819); a column's is the GFM `:-` row. */
export const CELL_ALIGNS = ['left', 'center', 'right'] as const
export type CellAlign = (typeof CELL_ALIGNS)[number]
/** A cell's own alignment, checked, or `null`. */
export const cellAlign = (value: unknown): CellAlign | null => ((CELL_ALIGNS as readonly unknown[]).includes(value) ? (value as CellAlign) : null)

/** Vertical alignment (YAZ-4166, D10): the table's default and a cell's own. Top is the default. */
export const VALIGNS = ['top', 'middle', 'bottom'] as const
export type Valign = (typeof VALIGNS)[number]
/** A vertical alignment, checked, or `null`. */
export const cellValign = (value: unknown): Valign | null => ((VALIGNS as readonly unknown[]).includes(value) ? (value as Valign) : null)

/**
 * A part this build does not know (YAZ-4161), or a known part whose value it cannot read (YAZ-4176):
 * its text, and the word of the known part before it in the comment (`null` for none). The save writes
 * it right after that part.
 */
export interface UnknownPart {
  after: string | null
  text: string
}

/** The words of the known parts, in the fixed order. */
export const KNOWN_PARTS = ['widths', 'fill', 'color', 'align', 'valign', 'merge', 'fold', 'nodim', 'zoom', 'border', 'header', 'stripes', 'height', 'nowrap', 'freeze', 'calendar', 'nonow', 'notebutton', 'nonotebutton', 'super', 'view'] as const

/**
 * One merged cell (YAZ-4792): 0-based rows and columns, `bottom` and `right` one past the last (prosemirror-tables'
 * `Rect`). `A1:B1` is `{ top: 0, left: 0, bottom: 1, right: 2 }`.
 */
export interface MergeRange {
  top: number
  left: number
  bottom: number
  right: number
}

/** The slot lengths of a calendar table, in minutes (YAZ-4162, D1). */
export const CALENDAR_SLOTS = [15, 30, 60] as const
export type CalendarSlot = (typeof CALENDAR_SLOTS)[number]
/** A slot length, checked, or `null`. */
export const calendarSlot = (value: unknown): CalendarSlot | null => ((CALENDAR_SLOTS as readonly unknown[]).includes(value) ? (value as CalendarSlot) : null)

/**
 * An unknown part as the save writes it: a line break is one space, and it holds no `,` and no `-->`. `null` when it
 * cannot be one, and when this build reads it (a pasted `stripes` would write a setting the table does not have).
 */
export function unknownPart(value: unknown): UnknownPart | null {
  if (typeof value !== 'object' || value === null) return null
  const { after, text } = value as { after?: unknown; text?: unknown }
  if (after !== null && !(KNOWN_PARTS as readonly unknown[]).includes(after)) return null
  if (typeof text !== 'string') return null
  const clean = text.trim().replace(/\s*[\r\n]+\s*/g, ' ')
  const [word, ...rest] = clean.split(/\s+/)
  // A `view` part is unknown by its place (a name a view before it has), so a read of it alone says nothing (YAZ-4869).
  if (word === 'view') return clean.includes('-->') ? null : { after: after as string | null, text: clean }
  if (clean === '' || clean.includes(',') || clean.includes('-->') || readPart(plainTable(), word!, rest, clean)) return null
  return { after: after as string | null, text: clean }
}

/** A table's settings. `fill`, `color` and `align` are keyed by A1 address (`cellAddress`). An absent part is the default. */
export interface TableStyle {
  /** Per column, px; `null` is `auto`. */
  widths: Array<number | null>
  fill: Map<string, string>
  color: Map<string, string>
  align: Map<string, CellAlign>
  /** A cell's own vertical alignment (YAZ-4166). */
  valign: Map<string, Valign>
  /** The table's vertical alignment; top is the default (YAZ-4166). */
  valignTable?: 'middle' | 'bottom'
  /** The merged cells (YAZ-4792), as the comment lists them; `validMerges` keeps the ones a table can take. */
  merge?: MergeRange[]
  /** The folded rows, 0-based, sorted, never 0 (the header row) (YAZ-4165). */
  fold?: number[]
  /** Rows a calendar table never dims as past (YAZ-4796: "a todo list on the second row"), 0-based like `fold`. */
  nodim?: number[]
  /** The table's zoom in whole percent, 50–400; 100 is the default (YAZ-4091). */
  zoom?: number
  /** Thickness in px and darkness in % of the outline colour. */
  border?: { px: number; darkness: number }
  /** The header row's own parts (YAZ-4774); an absent part is Settings'. */
  header?: HeaderRowOwn
  stripes?: true
  /** The row height; normal is the default. */
  height?: 'compact' | 'tall'
  nowrap?: true
  freeze?: { rows: number; cols: number }
  /** A calendar table's slot length (YAZ-4162). */
  calendar?: CalendarSlot
  /** A calendar table with no "Now" chip (the YAZ-4163 demo); the chip shows by default. */
  nonow?: true
  /** A table that shows the cell note "+" button whatever Settings say (YAZ-4790 demo: Settings' default is off). */
  notebutton?: true
  /** A table with no cell note "+" button (YAZ-4790); a cell's right-click still adds a note. */
  nonotebutton?: true
  /** A Super table (YAZ-4869 S1): its views show as tabs over it. */
  super?: true
  /** A Super table's views, in their order (YAZ-4869 S1); each is one `view` part. */
  views?: TableViewDef[]
  /** The parts this build does not know, in their order (YAZ-4161). */
  unknown?: UnknownPart[]
}

export const plainTable = (): TableStyle => ({ widths: [], fill: new Map(), color: new Map(), align: new Map(), valign: new Map() })

export const BORDER_PX_MAX = 10
/** The table zoom's range, the page zoom pill's (`DocumentZoom`), in whole percent (YAZ-4091). */
export const ZOOM_MIN = 50
export const ZOOM_MAX = 400
export const WIDTH_MAX = 9999
/** The most cells one range may name: a typo like `A1:ZZ99999` must not hang the load. */
const RANGE_CELLS_MAX = 100_000

/** The column's letters for a 0-based column: 0 → A, 25 → Z, 26 → AA. */
function columnName(col: number): string {
  let name = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** The A1 address of a 0-based row and column. */
export const cellAddress = (row: number, col: number): string => `${columnName(col)}${row + 1}`

const ADDRESS = /^([A-Z]{1,3})([1-9]\d{0,5})$/

/** A1 → 0-based row and column, or `null`. */
function readAddress(text: string): { row: number; col: number } | null {
  const match = ADDRESS.exec(text)
  if (match === null) return null
  let col = 0
  for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, col: col - 1 }
}

/** The corners of `A1` or `A1:C3` (either corner first), or `null`. */
function readCorners(text: string): MergeRange | null {
  const [a, b = a, extra] = text.split(':')
  if (extra !== undefined) return null
  const from = readAddress(a)
  const to = readAddress(b)
  if (from === null || to === null) return null
  return { top: Math.min(from.row, to.row), bottom: Math.max(from.row, to.row) + 1, left: Math.min(from.col, to.col), right: Math.max(from.col, to.col) + 1 }
}

/** The addresses of `A1` or `A1:C3` (either corner first), or `null`. */
function readRange(text: string): string[] | null {
  const corners = readCorners(text)
  if (corners === null) return null
  const { top, bottom, left, right } = corners
  if ((bottom - top) * (right - left) > RANGE_CELLS_MAX) return null
  const out: string[] = []
  for (let r = top; r < bottom; r++) for (let c = left; c < right; c++) out.push(cellAddress(r, c))
  return out
}

/** A range as the comment writes it: `A1:B2`. */
const formatRange = ({ top, left, bottom, right }: MergeRange): string => `${cellAddress(top, left)}:${cellAddress(bottom - 1, right - 1)}`

/**
 * The merges a table of `width` columns and `height` rows can take (YAZ-4792), in reading order: inside the table, two
 * cells or more, not from the header row (row 0) into the body, and none over another. The rest are dropped.
 */
export function validMerges(ranges: readonly MergeRange[], width: number, height: number): MergeRange[] {
  const out: MergeRange[] = []
  const sorted = [...ranges].sort((a, b) => a.top - b.top || a.left - b.left)
  for (const range of sorted) {
    const { top, left, bottom, right } = range
    if (top < 0 || left < 0 || bottom > height || right > width) continue
    if ((bottom - top) * (right - left) < 2) continue
    if (top === 0 && bottom > 1) continue
    if (out.some((other) => top < other.bottom && other.top < bottom && left < other.right && other.left < right)) continue
    out.push(range)
  }
  return out
}

/**
 * `A1:C1 B5 blue B3 #ff8800`: each value (`check` gives it, or `null` for an address) takes the
 * addresses before it. `null` when any word is wrong.
 */
function readCells<V extends string>(words: string[], check: (word: string) => V | null): Map<string, V> | null {
  const out = new Map<string, V>()
  let pending: string[] = []
  for (const word of words) {
    const value = check(word)
    if (value !== null) {
      if (pending.length === 0) return null
      for (const address of pending) out.set(address, value)
      pending = []
      continue
    }
    const range = readRange(word)
    if (range === null) return null
    pending.push(...range)
  }
  return pending.length === 0 && out.size > 0 ? out : null
}

/** A whole number with no leading zero (`0` itself allowed), in its range, or `null`. */
function readWhole(text: string | undefined, min: number, max: number): number | null {
  if (text === undefined || !/^(0|[1-9]\d*)$/.test(text)) return null
  const n = Number(text)
  return n >= min && n <= max ? n : null
}

/** One part into `style`; `false` when the part is unknown or its value is. `part` is its whole text (a `view` reads quotes). */
function readPart(style: TableStyle, word: string, rest: string[], part: string): boolean {
  const [first, second] = rest
  switch (word) {
    case 'widths': {
      if (rest.length === 0) return false
      const widths = rest.map((w) => (w === 'auto' ? null : readWhole(w, 1, WIDTH_MAX)))
      if (widths.some((w, i) => w === null && rest[i] !== 'auto')) return false
      style.widths = widths
      return true
    }
    case 'fill':
    case 'color': {
      const cells = readCells(rest, cellColor)
      if (cells === null) return false
      style[word] = cells
      return true
    }
    case 'align': {
      const cells = readCells(rest, cellAlign)
      if (cells === null) return false
      style.align = cells
      return true
    }
    case 'valign': {
      // An optional table default first, then cells as `align` writes them; with no cells, the default alone.
      const table = cellValign(first)
      const words = table === null ? rest : rest.slice(1)
      const cells = words.length === 0 ? new Map<string, Valign>() : readCells(words, cellValign)
      if (cells === null || (table === null && cells.size === 0)) return false
      style.valign = cells
      if (table === 'middle' || table === 'bottom') style.valignTable = table
      else delete style.valignTable
      return true
    }
    case 'merge': {
      // Each word is one merged cell, `A1:B2`; a word that is no range makes the part one the reader cannot read.
      if (rest.length === 0) return false
      const merge: MergeRange[] = []
      for (const word of rest) {
        const corners = readCorners(word)
        if (corners === null) return false
        merge.push(corners)
      }
      style.merge = merge
      return true
    }
    case 'fold':
    case 'nodim': {
      if (rest.length === 0) return false
      const folded = new Set<number>()
      for (const word of rest) {
        const match = /^([1-9]\d{0,5})(?:-([1-9]\d{0,5}))?$/.exec(word)
        const from = Number(match?.[1])
        const to = Number(match?.[2] ?? match?.[1])
        if (match === null || from < 2 || to < from || folded.size + to - from >= RANGE_CELLS_MAX) return false
        for (let row = from; row <= to; row++) folded.add(row - 1)
      }
      style[word] = [...folded].sort((a, b) => a - b)
      return true
    }
    case 'zoom': {
      const zoom = readWhole(/^(\d+)%$/.exec(first ?? '')?.[1], ZOOM_MIN, ZOOM_MAX)
      if (rest.length !== 1 || zoom === null) return false
      if (zoom === 100) delete style.zoom
      else style.zoom = zoom
      return true
    }
    case 'border': {
      const px = readWhole(/^(\d+)px$/.exec(first ?? '')?.[1], 0, BORDER_PX_MAX)
      const darkness = readWhole(/^(\d+)%$/.exec(second ?? '')?.[1], 0, 100)
      if (rest.length !== 2 || px === null || darkness === null) return false
      style.border = { px, darkness }
      return true
    }
    case 'header': {
      if (rest.length === 0) return false
      const header: HeaderRowOwn = {}
      for (const word of rest) {
        if (word === 'shaded' && rest.length === 1) continue
        const read = readHeaderWord(word)
        if (read === null || header[read[0]] !== undefined) return false
        Object.assign(header, { [read[0]]: read[1] })
      }
      if (Object.keys(header).length > 0) style.header = header
      else delete style.header
      return true
    }
    case 'height':
      if (rest.length !== 1 || !['compact', 'normal', 'tall'].includes(first)) return false
      if (first === 'normal') delete style.height
      else style.height = first as 'compact' | 'tall'
      return true
    case 'stripes':
    case 'nowrap':
    case 'nonow':
    case 'notebutton':
    case 'nonotebutton':
    case 'super':
      if (rest.length !== 0) return false
      style[word] = true
      return true
    case 'freeze': {
      if (rest.length === 0 || rest.length % 2 !== 0) return false
      const freeze = { rows: 0, cols: 0 }
      for (let i = 0; i < rest.length; i += 2) {
        const n = readWhole(rest[i], 1, 999)
        const key = /^rows?$/.test(rest[i + 1]) ? 'rows' : /^cols?$/.test(rest[i + 1]) ? 'cols' : null
        if (n === null || key === null) return false
        freeze[key] = n
      }
      style.freeze = freeze
      return true
    }
    case 'calendar': {
      const slot = calendarSlot(Number(/^(\d+)m$/.exec(first ?? '')?.[1]))
      if (rest.length !== 1 || slot === null) return false
      style.calendar = slot
      return true
    }
    case 'view': {
      // Each view is its own part; a name a view before it holds makes the part one the reader cannot read.
      const view = readView(part)
      if (view === null || style.views?.some((v) => v.name === view.name)) return false
      ;(style.views ??= []).push(view)
      return true
    }
    default:
      return false
  }
}

/** `<!-- table: … -->`, any spaces inside the delimiters. */
const COMMENT = /^<!--\s*table:\s*([^]*?)\s*-->$/

/** The settings a comment holds, or `null` when it is not the table comment (no known part). */
export function parseTableComment(value: string): TableStyle | null {
  const body = COMMENT.exec(value.trim())?.[1]
  if (body === undefined || body === '') return null
  const style = plainTable()
  const unknown: UnknownPart[] = []
  let after: string | null = null
  for (const part of splitParts(body)) {
    const [word, ...rest] = part.split(/\s+/)
    if (readPart(style, word, rest, part)) after = word
    else {
      const kept = unknownPart({ after, text: part })
      if (kept !== null) unknown.push(kept)
    }
  }
  if (after === null) return null
  if (unknown.length > 0) style.unknown = unknown
  return style
}

/**
 * The cells of each colour as rectangles: from each cell not yet written, in reading order, as far
 * right as the colour runs, then as far down as the whole row of that width runs. Each colour once,
 * in the order it first shows, its ranges before it: `A1:C1 D2:D3 blue B3 green`.
 */
function formatCells(cells: Map<string, string>): string {
  const at = [...cells.keys()].map((a) => readAddress(a)!).sort((x, y) => x.row - y.row || x.col - y.col)
  const done = new Set<string>()
  const groups = new Map<string, string[]>()
  const same = (row: number, col: number, color: string) => {
    const address = cellAddress(row, col)
    return cells.get(address) === color && !done.has(address)
  }
  for (const { row, col } of at) {
    const start = cellAddress(row, col)
    if (done.has(start)) continue
    const color = cells.get(start)!
    let w = 1
    while (same(row, col + w, color)) w++
    let h = 1
    while (Array.from({ length: w }, (_, i) => col + i).every((c) => same(row + h, c, color))) h++
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) done.add(cellAddress(r, c))
    const range = w === 1 && h === 1 ? start : `${start}:${cellAddress(row + h - 1, col + w - 1)}`
    const ranges = groups.get(color)
    if (ranges === undefined) groups.set(color, [range])
    else ranges.push(range)
  }
  return [...groups].map(([color, ranges]) => `${ranges.join(' ')} ${color}`).join(' ')
}

/** Sorted 0-based rows as 1-based runs: `20-29 31`. */
function formatRuns(rows: number[]): string {
  const runs: string[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i
    while (j + 1 < rows.length && rows[j + 1] === rows[j]! + 1) j++
    runs.push(j === i ? `${rows[i]! + 1}` : `${rows[i]! + 1}-${rows[j]! + 1}`)
    i = j + 1
  }
  return runs.join(' ')
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The comment for the settings, or `null` for a plain table: the set parts, in the fixed order, each
 * unknown part right after its known part, and the rest of them at the end (YAZ-4161).
 */
export function formatTableComment(style: TableStyle): string | null {
  const known: Array<[string, string]> = []
  const push = (word: string, text: string) => known.push([word, text])
  if (style.widths.some((w) => w !== null)) push('widths', `widths ${style.widths.map((w) => w ?? 'auto').join(' ')}`)
  if (style.fill.size > 0) push('fill', `fill ${formatCells(style.fill)}`)
  if (style.color.size > 0) push('color', `color ${formatCells(style.color)}`)
  if (style.align.size > 0) push('align', `align ${formatCells(style.align)}`)
  const valignTable = style.valignTable === 'middle' || style.valignTable === 'bottom' ? [style.valignTable] : []
  if (valignTable.length > 0 || style.valign.size > 0) push('valign', ['valign', ...valignTable, ...(style.valign.size > 0 ? [formatCells(style.valign)] : [])].join(' '))
  if (style.merge !== undefined && style.merge.length > 0) push('merge', `merge ${[...style.merge].sort((a, b) => a.top - b.top || a.left - b.left).map(formatRange).join(' ')}`)
  if (style.fold !== undefined && style.fold.length > 0) push('fold', `fold ${formatRuns(style.fold)}`)
  if (style.nodim !== undefined && style.nodim.length > 0) push('nodim', `nodim ${formatRuns(style.nodim)}`)
  if (style.zoom !== undefined && style.zoom !== 100) push('zoom', `zoom ${style.zoom}%`)
  if (style.border) push('border', `border ${style.border.px}px ${style.border.darkness}%`)
  const header = HEADER_ROW_PARTS.flatMap((part) => {
    const value = style.header?.[part]
    return value === undefined ? [] : [headerWord(part, value)]
  }).join(' ')
  if (header !== '') push('header', `header ${header === 'off' ? 'plain' : header}`)
  if (style.stripes) push('stripes', 'stripes')
  if (style.height) push('height', `height ${style.height}`)
  if (style.nowrap) push('nowrap', 'nowrap')
  const { rows = 0, cols = 0 } = style.freeze ?? {}
  if (rows > 0 || cols > 0) push('freeze', ['freeze', ...(rows > 0 ? [plural(rows, 'row')] : []), ...(cols > 0 ? [plural(cols, 'col')] : [])].join(' '))
  if (style.calendar) push('calendar', `calendar ${style.calendar}m`)
  if (style.nonow) push('nonow', 'nonow')
  if (style.notebutton) push('notebutton', 'notebutton')
  if (style.nonotebutton) push('nonotebutton', 'nonotebutton')
  if (style.super) push('super', 'super')
  for (const view of style.views ?? []) push('view', formatView(view))
  const written = new Set(known.map(([word]) => word))
  // A known part kept as its text goes when this build writes that part itself (YAZ-4176). A `view` part repeats, so
  // one this build cannot read stays beside the ones it writes (YAZ-4869 S1).
  const unknown = (style.unknown ?? []).filter((part) => part.text.split(' ')[0] === 'view' || !written.has(part.text.split(' ')[0]!))
  // The parts kept after a word go after its LAST part: a `view` part repeats.
  const parts = known.flatMap(([word, text], i) => [text, ...(known.slice(i + 1).some(([w]) => w === word) ? [] : unknown.filter((part) => part.after === word).map((part) => part.text))])
  parts.push(...unknown.filter((part) => part.after === null || !written.has(part.after)).map((part) => part.text))
  return parts.length === 0 ? null : `<!-- table: ${parts.join(', ')} -->`
}
