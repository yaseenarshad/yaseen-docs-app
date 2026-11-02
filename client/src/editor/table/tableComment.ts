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
 * rows that touch as `first-last`, a run of one row as its number. It goes after `valign`. `zoom 90%` (YAZ-4091, D13) is
 * the table's own zoom, a whole percent from 50 to 400 (the page zoom pill's range); 100% is the default and writes
 * nothing. It goes after `fold`. `calendar` (YAZ-4162,
 * D1) is the slot length of a calendar table, `15m`, `30m` or `60m`; it is last, so a build that does not know it
 * keeps it in place (YAZ-4161). A column's alignment is no
 * part: it is the GFM `:-` row, so GitHub and Obsidian show it too ("Align all columns" sets it,
 * YAZ-3767); `align` is a cell's own, which wins over its column's (YAZ-3819). Cells are A1 addresses:
 * columns are letters (A…Z, AA…), rows are numbers, row 1 is the header row.
 *
 * The reader is tolerant: a known part with a value it does not know is ignored, and the other
 * parts are kept. A part it does not know (its first word is no part) is KEPT as its text (YAZ-4161):
 * an older or a newer build never deletes a setting it cannot read. It keeps its place after the
 * known part before it; with none before it, or when that part is no longer set, it goes after the
 * known parts, in its order. A comment with no known part is not ours (`null`), and the editor keeps
 * it as an HTML node with its text.
 */

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
 * A part this build does not know (YAZ-4161): its text, and the word of the known part before it in
 * the comment (`null` for none). The save writes it right after that part.
 */
export interface UnknownPart {
  after: string | null
  text: string
}

/** The words of the known parts, in the fixed order. */
export const KNOWN_PARTS = ['widths', 'fill', 'color', 'align', 'valign', 'fold', 'zoom', 'border', 'header', 'stripes', 'height', 'nowrap', 'freeze', 'calendar', 'nonow'] as const

/** The slot lengths of a calendar table, in minutes (YAZ-4162, D1). */
export const CALENDAR_SLOTS = [15, 30, 60] as const
export type CalendarSlot = (typeof CALENDAR_SLOTS)[number]
/** A slot length, checked, or `null`. */
export const calendarSlot = (value: unknown): CalendarSlot | null => ((CALENDAR_SLOTS as readonly unknown[]).includes(value) ? (value as CalendarSlot) : null)

/** An unknown part as the save writes it: a line break is one space, and it holds no `,` and no `-->`. `null` when it cannot be one. */
export function unknownPart(value: unknown): UnknownPart | null {
  if (typeof value !== 'object' || value === null) return null
  const { after, text } = value as { after?: unknown; text?: unknown }
  if (after !== null && !(KNOWN_PARTS as readonly unknown[]).includes(after)) return null
  if (typeof text !== 'string') return null
  const clean = text.trim().replace(/\s*[\r\n]+\s*/g, ' ')
  if (clean === '' || clean.includes(',') || clean.includes('-->') || (KNOWN_PARTS as readonly string[]).includes(clean.split(/\s+/)[0])) return null
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
  /** The folded rows, 0-based, sorted, never 0 (the header row) (YAZ-4165). */
  fold?: number[]
  /** The table's zoom in whole percent, 50–400; 100 is the default (YAZ-4091). */
  zoom?: number
  /** Thickness in px and darkness in % of the outline colour. */
  border?: { px: number; darkness: number }
  /** The header row's look; shaded is the default. */
  header?: 'plain'
  stripes?: true
  /** The row height; normal is the default. */
  height?: 'compact' | 'tall'
  nowrap?: true
  freeze?: { rows: number; cols: number }
  /** A calendar table's slot length (YAZ-4162). */
  calendar?: CalendarSlot
  /** A calendar table with no "Now" chip (the YAZ-4163 demo); the chip shows by default. */
  nonow?: true
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

/** The addresses of `A1` or `A1:C3` (either corner first), or `null`. */
function readRange(text: string): string[] | null {
  const [a, b = a, extra] = text.split(':')
  if (extra !== undefined) return null
  const from = readAddress(a)
  const to = readAddress(b)
  if (from === null || to === null) return null
  const [r0, r1] = [Math.min(from.row, to.row), Math.max(from.row, to.row)]
  const [c0, c1] = [Math.min(from.col, to.col), Math.max(from.col, to.col)]
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > RANGE_CELLS_MAX) return null
  const out: string[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(cellAddress(r, c))
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

/** One part into `style`; `false` when the part is unknown or its value is. */
function readPart(style: TableStyle, word: string, rest: string[]): boolean {
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
    case 'fold': {
      if (rest.length === 0) return false
      const folded = new Set<number>()
      for (const word of rest) {
        const match = /^([1-9]\d{0,5})(?:-([1-9]\d{0,5}))?$/.exec(word)
        const from = Number(match?.[1])
        const to = Number(match?.[2] ?? match?.[1])
        if (match === null || from < 2 || to < from || folded.size + to - from >= RANGE_CELLS_MAX) return false
        for (let row = from; row <= to; row++) folded.add(row - 1)
      }
      style.fold = [...folded].sort((a, b) => a - b)
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
    case 'header':
      if (rest.length !== 1 || (first !== 'plain' && first !== 'shaded')) return false
      if (first === 'plain') style.header = 'plain'
      else delete style.header
      return true
    case 'height':
      if (rest.length !== 1 || !['compact', 'normal', 'tall'].includes(first)) return false
      if (first === 'normal') delete style.height
      else style.height = first as 'compact' | 'tall'
      return true
    case 'stripes':
    case 'nowrap':
    case 'nonow':
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
  for (const part of body.split(/\s*,\s*/)) {
    const [word, ...rest] = part.split(/\s+/)
    if (readPart(style, word, rest)) after = word
    else if (!(KNOWN_PARTS as readonly string[]).includes(word)) {
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
  if (style.fold !== undefined && style.fold.length > 0) push('fold', `fold ${formatRuns(style.fold)}`)
  if (style.zoom !== undefined && style.zoom !== 100) push('zoom', `zoom ${style.zoom}%`)
  if (style.border) push('border', `border ${style.border.px}px ${style.border.darkness}%`)
  if (style.header) push('header', `header ${style.header}`)
  if (style.stripes) push('stripes', 'stripes')
  if (style.height) push('height', `height ${style.height}`)
  if (style.nowrap) push('nowrap', 'nowrap')
  const { rows = 0, cols = 0 } = style.freeze ?? {}
  if (rows > 0 || cols > 0) push('freeze', ['freeze', ...(rows > 0 ? [plural(rows, 'row')] : []), ...(cols > 0 ? [plural(cols, 'col')] : [])].join(' '))
  if (style.calendar) push('calendar', `calendar ${style.calendar}m`)
  if (style.nonow) push('nonow', 'nonow')
  const unknown = style.unknown ?? []
  const written = new Set(known.map(([word]) => word))
  const parts = known.flatMap(([word, text]) => [text, ...unknown.filter((part) => part.after === word).map((part) => part.text)])
  parts.push(...unknown.filter((part) => part.after === null || !written.has(part.after)).map((part) => part.text))
  return parts.length === 0 ? null : `<!-- table: ${parts.join(', ')} -->`
}
