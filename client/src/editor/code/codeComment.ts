/**
 * The code block comment itself (YAZ-4783): the one reader and writer of `<!-- code: … -->`, the line right under a
 * code block's closing fence that holds the block's own width, as `<!-- table: … -->` holds a table's look
 * (`table/tableComment.ts`) and `<!-- line: … -->` a line's (`line/lineComment.ts`). No editor imports (the colour list is plain data), on purpose: the
 * line-number worker (`lineNumbers/blockLines.ts`) reads the same comment to know that it is no block of the page.
 * `codeWidth.ts` joins it to the block on load and writes it back on save.
 *
 * TWO KINDS of part: `width 1300`, the box's width in px at 100% document zoom, a whole number from `CODE_WIDTH_MIN`
 * to `CODE_WIDTH_MAX` with no leading zero; and the marks below. A block with neither writes no comment: a plain code
 * block keeps the bytes of before.
 *
 * The reader is tolerant, as the table's is (YAZ-4161, YAZ-4176): a part it does not know, and a `width` it cannot read
 * (`width 100`, `width wide`), are KEPT as their text, so an older or a newer build never deletes what it cannot read.
 * A part keeps its side of the width part (before it or after it), so a comment this build reads saves with the same
 * bytes. A kept `width …` text goes only when this build writes a width itself. The comment is ours when it has the
 * shape `<!-- code: part, part -->` on ONE line with no empty part; anything else (`<!-- code: -->`, `<!-- codes: … -->`,
 * a comment over two lines) is not ours (`null`), and the editor keeps it as an ordinary HTML block with its text.
 *
 * THE MARKS (YAZ-5794 D1): bold, italic, underline, strike and highlight inside the code. The code lines stay plain, so
 * copy, run, GitHub and other editors see clean code; each mark is one part, `<kind> <line>:<col> "<text>"`:
 * `bold 2:22 "fetchUser"`, `highlight-green 3:10 "user.name"`, `highlight-#a1b2c3 1:1 "x"` (a plain `highlight` is
 * yellow). Line and column count from 1, in UTF-16 units as the editor counts. One mark covers one line. The text is a
 * JSON string with `,` as `\u002c` and `>` as `\u003e`, because the comment splits on `,` and ends at `-->`. It is kept
 * so that a load can check the mark still stands on its text (`fitMarks` below, D2). A highlight colour is one of
 * `HIGHLIGHT_COLORS` or a lowercase `#rrggbb`; a part with another colour is no mark of this build. An older build keeps
 * a mark part as an unknown part, with its bytes. Order on save: the parts before the width, the width, the marks in
 * the code's order, the parts after the width. A comment this build wrote saves with the same bytes; a hand-made one
 * with its marks in another order or place is rewritten in this order at its first save.
 */
import { HIGHLIGHT_COLORS } from '../marks/highlightColours'

/** The narrowest a code block can be dragged or read, in px at 100% zoom. */
export const CODE_WIDTH_MIN = 240
/** The widest a width can be read or written: four digits. */
export const CODE_WIDTH_MAX = 9999

/** A part this build does not read: its text, and whether it stood after the width part. */
export interface CodeUnknownPart {
  afterWidth: boolean
  text: string
}

/** The kinds of mark inside code (YAZ-5794 D4): the page toolbar's Text style group. */
export const CODE_MARK_KINDS = ['bold', 'italic', 'underline', 'strike', 'highlight'] as const
export type CodeMarkKind = (typeof CODE_MARK_KINDS)[number]

/** One mark inside the code as the file holds it (YAZ-5794 D1): one line; `line` and `col` count from 1. */
export interface CodeMark {
  kind: CodeMarkKind
  /** A highlight's colour: `null` is yellow, else a named colour (`green`) or a lowercase `#rrggbb`. Always `null` for the others. */
  color: string | null
  line: number
  col: number
  /** The marked text: never empty, never a line break. */
  text: string
}

/** What the comment holds: the width (`null` for the normal width), the marks, and the parts this build keeps as text. */
export interface CodeLook {
  width: number | null
  marks: CodeMark[]
  unknownParts: CodeUnknownPart[]
}

export const PLAIN_CODE: CodeLook = { width: null, marks: [], unknownParts: [] }

/** `<!-- code: … -->` on one line (`.` takes no line break), any spaces inside the delimiters. */
const COMMENT = /^<!--[ \t]*code:[ \t]*(.*?)[ \t]*-->$/
/** The width part: `width`, one space, a whole number with no leading zero. */
const WIDTH_PART = /^width ([1-9]\d{0,3})$/

/** A width, checked: a whole number in range, else `null`. */
export function codeWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= CODE_WIDTH_MIN && value <= CODE_WIDTH_MAX ? value : null
}

/** The look a comment holds, or `null` when it is not the code comment. */
export function parseCodeComment(value: string): CodeLook | null {
  const body = COMMENT.exec(value.trim())?.[1]
  if (body === undefined || body === '' || body.includes('-->')) return null
  const parts = body.split(/[ \t]*,[ \t]*/)
  if (parts.some((part) => part === '')) return null
  const look: CodeLook = { width: null, marks: [], unknownParts: [] }
  for (const text of parts) {
    const width = look.width === null ? codeWidth(Number(WIDTH_PART.exec(text)?.[1])) : null
    const mark = width === null ? parseMarkPart(text) : null
    if (width !== null) look.width = width
    else if (mark !== null) look.marks.push(mark)
    else look.unknownParts.push({ afterWidth: look.width !== null, text })
  }
  return look
}

/** The comment for a look, or `null` when it holds nothing: the parts before the width, the width, the parts after it. */
export function formatCodeComment(look: CodeLook): string | null {
  const kept = look.width === null ? look.unknownParts : look.unknownParts.filter((part) => !/^width\b/.test(part.text))
  const parts = [
    ...kept.filter((part) => !part.afterWidth).map((part) => part.text),
    ...(look.width === null ? [] : [`width ${look.width}`]),
    ...look.marks.map(formatMarkPart),
    ...kept.filter((part) => part.afterWidth).map((part) => part.text),
  ]
  return parts.length === 0 ? null : `<!-- code: ${parts.join(', ')} -->`
}

/** A mark part: the kind (a highlight with its colour), `line:col`, and the text as a JSON string. */
const MARK_PART = /^(bold|italic|underline|strike|highlight(?:-([a-z]+|#[0-9a-f]{6}))?) ([1-9]\d{0,8}):([1-9]\d{0,8}) ("(?:[^"\\]|\\.)*")$/

/** The text as the comment holds it: a JSON string whose `,` and `>` are escapes, so it never splits a part or ends the comment. */
const quoteText = (text: string): string => JSON.stringify(text).replace(/,/g, '\\u002c').replace(/>/g, '\\u003e')

/** The part for a mark: `bold 2:22 "fetchUser"`, `highlight-green 3:10 "user.name"`. */
export function formatMarkPart(mark: CodeMark): string {
  const kind = mark.kind === 'highlight' && mark.color !== null ? `highlight-${mark.color}` : mark.kind
  return `${kind} ${mark.line}:${mark.col} ${quoteText(mark.text)}`
}

/** The mark a part holds, or `null` when the part is no mark this build reads (then it stays an unknown part). */
export function parseMarkPart(part: string): CodeMark | null {
  const match = MARK_PART.exec(part)
  if (match === null) return null
  let text: unknown
  try {
    text = JSON.parse(match[5])
  } catch {
    return null
  }
  if (typeof text !== 'string' || text === '' || /[\r\n]/.test(text)) return null
  const highlight = match[1].startsWith('highlight')
  if (highlight && match[2] !== undefined && !markColor(match[2])) return null
  return { kind: highlight ? 'highlight' : (match[1] as CodeMarkKind), color: highlight ? (match[2] ?? null) : null, line: Number(match[3]), col: Number(match[4]), text }
}

/**
 * A mark as the editor holds it (YAZ-5794): `from`…`to` are offsets into the block's code. The file holds `CodeMark`s
 * (line, column, text); the `code_block` node holds spans, because a typed key moves a span with plain position mapping.
 */
export interface CodeSpan {
  from: number
  to: number
  kind: CodeMarkKind
  color: string | null
}

/** A highlight colour a mark can hold: a named one (`green`) or a lowercase `#rrggbb`; `null` is yellow. */
const markColor = (value: unknown): value is string =>
  typeof value === 'string' && ((HIGHLIGHT_COLORS as readonly string[]).includes(value) || /^#[0-9a-f]{6}$/.test(value))

/** The offset where each line of `code` starts. */
function lineStarts(code: string): number[] {
  const starts = [0]
  for (let at = code.indexOf('\n'); at >= 0; at = code.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}

/**
 * Spans checked against `code` (a node's attribute, a paste, a mapped edit): whole offsets in the code, the kinds this
 * build knows, never over a line break (a span over one is split at it), none empty, and one span for spans of one
 * style that touch. Sorted by start.
 */
export function cleanSpans(code: string, value: unknown): CodeSpan[] {
  if (!Array.isArray(value)) return []
  const pieces: CodeSpan[] = []
  for (const raw of value) {
    const { from, to, kind, color } = (raw ?? {}) as Partial<Record<keyof CodeSpan, unknown>>
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)) continue
    if (!(CODE_MARK_KINDS as readonly unknown[]).includes(kind)) continue
    const style = { kind: kind as CodeMarkKind, color: kind === 'highlight' && markColor(color) ? color : null }
    const end = Math.min(code.length, to)
    for (let start = Math.max(0, from); start < end; ) {
      const lineEnd = code.indexOf('\n', start)
      const stop = lineEnd < 0 || lineEnd >= end ? end : lineEnd
      if (stop > start) pieces.push({ from: start, to: stop, ...style })
      start = stop + 1
    }
  }
  pieces.sort((a, b) => a.from - b.from || a.to - b.to)
  const out: CodeSpan[] = []
  const last = new Map<string, CodeSpan>()
  for (const piece of pieces) {
    const key = `${piece.kind} ${piece.color}`
    const before = last.get(key)
    // Touching spans of one style join; a line break between them keeps them apart (it is never inside a span).
    if (before !== undefined && before.to >= piece.from) before.to = Math.max(before.to, piece.to)
    else {
      out.push(piece)
      last.set(key, piece)
    }
  }
  return out
}

/** Two clean span lists with the same spans. */
export const sameSpans = (a: readonly CodeSpan[], b: readonly CodeSpan[]): boolean =>
  a.length === b.length && a.every((s, i) => s.from === b[i].from && s.to === b[i].to && s.kind === b[i].kind && s.color === b[i].color)

/**
 * The marks that still fit `code` (YAZ-5794 D2): the code can change outside the app. A mark whose text is at its place
 * stays. Else it moves to the nearest copy of its text on the same line. Else it goes. A mark never lands on other text.
 */
export function fitMarks(code: string, marks: readonly CodeMark[]): CodeMark[] {
  const lines = code.split('\n')
  return marks.flatMap((mark) => {
    const line = lines[mark.line - 1]
    if (line === undefined) return []
    const want = mark.col - 1
    if (line.startsWith(mark.text, want)) return [mark]
    let best = -1
    for (let at = line.indexOf(mark.text); at >= 0; at = line.indexOf(mark.text, at + 1))
      if (best < 0 || Math.abs(at - want) < Math.abs(best - want)) best = at
    return best < 0 ? [] : [{ ...mark, col: best + 1 }]
  })
}

/** The file's marks as spans of `code`, fitted first (D2). */
export function spansFromMarks(code: string, marks: readonly CodeMark[]): CodeSpan[] {
  const starts = lineStarts(code)
  return cleanSpans(
    code,
    fitMarks(code, marks).map((mark) => {
      const from = starts[mark.line - 1] + mark.col - 1
      return { from, to: from + mark.text.length, kind: mark.kind, color: mark.color }
    }),
  )
}

/** The spans of `code` as the file writes them: line, column and text, in the spans' order. */
export function marksFromSpans(code: string, spans: readonly CodeSpan[]): CodeMark[] {
  const starts = lineStarts(code)
  let line = 0
  return cleanSpans(code, spans).map((span) => {
    while (line + 1 < starts.length && starts[line + 1] <= span.from) line++
    return { kind: span.kind, color: span.color, line: line + 1, col: span.from - starts[line] + 1, text: code.slice(span.from, span.to) }
  })
}
