/**
 * The table comment itself (YAZ-3758, YAZ-3696 🔒 D1 / D3 / D7 / S3; CONTRACTS rule 41a): the one
 * reader and writer of `<!-- table: … -->`. No editor imports, on purpose: the line-number worker
 * (`lineNumbers/blockLines.ts`, rule 34) reads the same comment to know that it is no block of the
 * page, as it does for the line comment (`line/lineComment.ts`). `tableStyle.ts` re-exports all of it.
 *
 * The parts, in their fixed order, each only when set:
 * `widths 140 240 auto, fill A1:C1 blue B3 green, color B2:B5 red, border 2px 40%, header plain,
 * stripes, height compact, nowrap, freeze 2 rows 1 col`. A column's alignment is no part: it is the
 * GFM `:-` row, so GitHub and Obsidian show it too ("Align all columns" sets it, YAZ-3767). Cells are A1 addresses:
 * columns are letters (A…Z, AA…), rows are numbers, row 1 is the header row.
 *
 * The reader is tolerant: an unknown part, or a known part with a value it does not know, is
 * ignored and the other parts are kept. A comment with no known part is not ours (`null`), and the
 * editor keeps it as an HTML node with its text.
 */

/** The cell fills: the highlight colours (YAZ-1480, `marks/highlight.ts`), yellow included. */
export const FILL_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type FillColor = (typeof FILL_COLORS)[number]
/** The cell text colours (YAZ-3696 D8). */
export const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'grey'] as const
export type TextColor = (typeof TEXT_COLORS)[number]
export const ALIGNS = ['left', 'center', 'right'] as const
export type TableAlign = (typeof ALIGNS)[number]

/** A table's settings. `fill` and `color` are keyed by A1 address (`cellAddress`). An absent part is the default. */
export interface TableStyle {
  /** Per column, px; `null` is `auto`. */
  widths: Array<number | null>
  fill: Map<string, FillColor>
  color: Map<string, TextColor>
  /** Thickness in px and darkness in % of the outline colour. */
  border?: { px: number; darkness: number }
  /** The header row's look; shaded is the default. */
  header?: 'plain'
  stripes?: true
  /** The row height; normal is the default. */
  height?: 'compact' | 'tall'
  nowrap?: true
  freeze?: { rows: number; cols: number }
}

export const plainTable = (): TableStyle => ({ widths: [], fill: new Map(), color: new Map() })

export const BORDER_PX_MAX = 10
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

/** `A1:C1 B5 blue B3 green`: each colour takes the addresses before it. `null` when any word is wrong. */
function readCells<C extends string>(words: string[], colors: readonly C[]): Map<string, C> | null {
  const out = new Map<string, C>()
  let pending: string[] = []
  for (const word of words) {
    if ((colors as readonly string[]).includes(word)) {
      if (pending.length === 0) return null
      for (const address of pending) out.set(address, word as C)
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
      const cells = word === 'fill' ? readCells(rest, FILL_COLORS) : readCells(rest, TEXT_COLORS)
      if (cells === null) return false
      if (word === 'fill') style.fill = cells as Map<string, FillColor>
      else style.color = cells as Map<string, TextColor>
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
  let known = false
  for (const part of body.split(/\s*,\s*/)) {
    const [word, ...rest] = part.split(/\s+/)
    if (readPart(style, word, rest)) known = true
  }
  return known ? style : null
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
    groups.set(color, [...(groups.get(color) ?? []), range])
  }
  return [...groups].map(([color, ranges]) => `${ranges.join(' ')} ${color}`).join(' ')
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The comment for the settings, or `null` for a plain table: the set parts, in the fixed order. */
export function formatTableComment(style: TableStyle): string | null {
  const parts: string[] = []
  if (style.widths.some((w) => w !== null)) parts.push(`widths ${style.widths.map((w) => w ?? 'auto').join(' ')}`)
  if (style.fill.size > 0) parts.push(`fill ${formatCells(style.fill)}`)
  if (style.color.size > 0) parts.push(`color ${formatCells(style.color)}`)
  if (style.border) parts.push(`border ${style.border.px}px ${style.border.darkness}%`)
  if (style.header) parts.push(`header ${style.header}`)
  if (style.stripes) parts.push('stripes')
  if (style.height) parts.push(`height ${style.height}`)
  if (style.nowrap) parts.push('nowrap')
  const { rows = 0, cols = 0 } = style.freeze ?? {}
  if (rows > 0 || cols > 0) parts.push(['freeze', ...(rows > 0 ? [plural(rows, 'row')] : []), ...(cols > 0 ? [plural(cols, 'col')] : [])].join(' '))
  return parts.length === 0 ? null : `<!-- table: ${parts.join(', ')} -->`
}
