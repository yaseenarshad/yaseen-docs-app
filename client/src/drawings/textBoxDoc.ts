/**
 * BOX ↔ EDITOR (YAZ-4277 1B, D1, D4): a drawing text box's native form — `originalText` and `textRuns` — as the
 * text box editor's ProseMirror document, and back, with no loss.
 *
 *  - A line is a paragraph, or a list item when it is a box bullet as the canvas draws one: 4 spaces for each level,
 *    the marker of its level (`•` `○` `▪`, `getBulletMarkerForDepth`) or a checklist marker (`☐` open, `☑` done,
 *    YAZ-4302), and one space. Any other line — a wrong marker for its level, a level with no parent, two spaces —
 *    stays a paragraph that holds its letters as they are, so it comes back byte for byte.
 *  - The letter styles are marks: bold `strong`, italic `emphasis`, underline `underline`, strike `strike_through`,
 *    highlight `highlight` (yellow is the page's `null`), color `text_color` (the box's own mark, `textBoxLock.ts`).
 *  - The letters the document has no place for — each line break, and a bullet's indent, marker and space — keep the
 *    styles they had: the runs of the text before the edit are moved over the edit (`remapTextRunsForTextEdit`) and
 *    kept on those letters only. So an unchanged box gives back the same `textRuns` after `normalizeTextRuns`.
 *  - `[[link]]` pills stay letters, as in a page: the canvas draws the pill.
 *
 * Offsets in and out of the editor are offsets in `originalText`: `posAt` / `offsetAt` skip a bullet's prefix.
 */
import type { ComponentProps } from 'react'
import { Fragment, type Mark, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import type { ExcalidrawModule } from './engine'

type HostTextEditor = NonNullable<ComponentProps<ExcalidrawModule['Excalidraw']>['textEditor']>
export type TextRuns = Parameters<HostTextEditor['mount']>[0]['textRuns']
type TextRun = NonNullable<TextRuns>[number]
type MutableRun = { -readonly [K in keyof TextRun]: TextRun[K] }

/** What the conversion needs of the engine: its run rules and its bullet glyphs, one source for the box format. */
export type BoxHelpers = Pick<ExcalidrawModule, 'normalizeTextRuns' | 'remapTextRunsForTextEdit' | 'getBulletMarkerForDepth'>

export const CHECK_OPEN = '☐'
export const CHECK_DONE = '☑'
const INDENT = '    '
const ITEM_LINE = /^((?: {4})*)([•○▪☐☑]) (.*)$/su

/** A line of the box: where its letters start in the text, and, for a list item, its level and its tick. */
type BoxLine = { start: number; text: string; contentStart: number; item: { depth: number; checked: boolean | null } | null }

/** The box text's lines, each one a paragraph or a list item (see the header for the rule). */
export function boxLines(text: string, helpers: BoxHelpers): BoxLine[] {
  const out: BoxLine[] = []
  let start = 0
  let lastDepth = -1
  for (const line of text.split('\n')) {
    const match = ITEM_LINE.exec(line)
    let item: BoxLine['item'] = null
    if (match) {
      const depth = match[1].length / INDENT.length
      const marker = match[2]
      const fits = marker === CHECK_OPEN || marker === CHECK_DONE || marker === helpers.getBulletMarkerForDepth(depth)
      if (fits && depth <= lastDepth + 1) item = { depth, checked: marker === CHECK_OPEN ? false : marker === CHECK_DONE ? true : null }
    }
    lastDepth = item ? item.depth : -1
    const prefix = item ? item.depth * INDENT.length + 2 : 0
    out.push({ start, text: line, contentStart: start + prefix, item })
    start += line.length + 1
  }
  return out
}

/** The marks of a run's style. */
function marksOf(schema: Schema, run: Omit<TextRun, 'start' | 'end'>): Mark[] {
  const marks: Mark[] = []
  if (run.bold) marks.push(schema.marks.strong.create())
  if (run.italic) marks.push(schema.marks.emphasis.create())
  if (run.underline) marks.push(schema.marks.underline.create())
  if (run.strikethrough) marks.push(schema.marks.strike_through.create())
  if (run.highlight) marks.push(schema.marks.highlight.create({ color: run.highlight === 'yellow' ? null : run.highlight }))
  if (run.color) marks.push(schema.marks.text_color.create({ color: run.color }))
  return marks
}

/** The inline content of `text[from, to)`, cut where the runs start and end. */
function inline(schema: Schema, text: string, from: number, to: number, runs: readonly TextRun[]): ProseNode[] {
  const cuts = new Set([from, to])
  for (const run of runs) {
    if (run.start > from && run.start < to) cuts.add(run.start)
    if (run.end > from && run.end < to) cuts.add(run.end)
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: ProseNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]]
    if (a === b) continue
    const style: Omit<MutableRun, 'start' | 'end'> = {}
    for (const { start, end, ...rest } of runs) if (start <= a && b <= end) Object.assign(style, rest)
    out.push(schema.text(text.slice(a, b), marksOf(schema, style)))
  }
  return out
}

type Item = { checked: boolean | null; paragraph: ProseNode; children: Item[] }

/** The box as the editor's document. */
export function boxToDoc(schema: Schema, text: string, runs: TextRuns, helpers: BoxHelpers): ProseNode {
  const blocks: Array<ProseNode | Item[]> = []
  let stack: Item[][] = []
  for (const line of boxLines(text, helpers)) {
    const paragraph = schema.nodes.paragraph.create(null, inline(schema, text, line.contentStart, line.start + line.text.length, runs ?? []))
    if (!line.item) {
      blocks.push(paragraph)
      stack = []
      continue
    }
    const item: Item = { checked: line.item.checked, paragraph, children: [] }
    if (line.item.depth === 0) {
      if (stack.length === 0) blocks.push((stack = [[]])[0])
      stack = [stack[0]]
      stack[0].push(item)
    } else {
      const parentList = stack[line.item.depth - 1]
      const parent = parentList[parentList.length - 1]
      stack = stack.slice(0, line.item.depth)
      stack.push(parent.children)
      parent.children.push(item)
    }
  }
  const list = (items: Item[]): ProseNode =>
    schema.nodes.bullet_list.create(
      null,
      items.map((item) =>
        schema.nodes.list_item.create({ checked: item.checked, listType: 'bullet', spread: false }, item.children.length ? [item.paragraph, list(item.children)] : [item.paragraph]),
      ),
    )
  return schema.nodes.doc.create(
    null,
    Fragment.fromArray(blocks.map((block) => (Array.isArray(block) ? list(block) : block))),
  )
}

/** Each text block of the document, the box line it is, and where its letters start in the document. */
type DocLine = { pos: number; node: ProseNode; prefix: string; item: boolean }

/**
 * The last walk of each document (YAZ-4312 S2). A document never changes, and one key asks for its lines up to four
 * times (the caret's two offsets, the box text, the folds); a caret move asks again for the same document.
 */
const walked = new WeakMap<ProseNode, { helpers: BoxHelpers; lines: DocLine[] }>()

function docLines(doc: ProseNode, helpers: BoxHelpers): DocLine[] {
  const known = walked.get(doc)
  if (known?.helpers === helpers) return known.lines
  const out: DocLine[] = []
  const walk = (node: ProseNode, pos: number, depth: number) => {
    node.forEach((child, offset) => {
      const at = pos + offset
      if (child.type.name === 'list_item') {
        const checked = child.attrs.checked as boolean | null
        const marker = checked === true ? CHECK_DONE : checked === false ? CHECK_OPEN : helpers.getBulletMarkerForDepth(depth)
        let first = true
        child.forEach((inner, innerOffset) => {
          const innerAt = at + 1 + innerOffset
          if (inner.isTextblock) {
            // the item's own line, then any other line of it one level in, with no marker
            out.push({ pos: innerAt + 1, node: inner, prefix: first ? INDENT.repeat(depth) + marker + ' ' : INDENT.repeat(depth + 1), item: first })
            first = false
          } else walk(inner, innerAt + 1, depth + 1)
        })
      } else if (child.isTextblock) out.push({ pos: at + 1, node: child, prefix: '', item: false })
      else walk(child, at + 1, depth)
    })
  }
  walk(doc, 0, 0)
  walked.set(doc, { helpers, lines: out })
  return out
}

/** A text block's letters, a hard break as a line break. */
const blockText = (node: ProseNode) => node.textBetween(0, node.content.size, undefined, '\n')

/**
 * The document as the box saves it. `before` is the box before this change: the letters with no place in the
 * document (line breaks, bullet prefixes) keep the styles they had there.
 */
export function docToBox(
  doc: ProseNode,
  before: { text: string; textRuns: TextRuns; caret?: number },
  helpers: BoxHelpers,
): { text: string; textRuns: TextRuns } {
  const lines = docLines(doc, helpers)
  const visible: TextRun[] = []
  const hidden: Array<[number, number]> = []
  let text = ''
  lines.forEach((line, index) => {
    if (index > 0) {
      hidden.push([text.length, text.length + 1])
      text += '\n'
    }
    if (line.prefix) hidden.push([text.length, text.length + line.prefix.length])
    text += line.prefix
    const start = text.length
    line.node.forEach((child, offset) => {
      const from = start + offset
      if (child.isText) {
        const style = styleOf(child.marks)
        if (Object.keys(style).length) visible.push({ start: from, end: from + child.nodeSize, ...style })
      }
    })
    text += blockText(line.node)
  })
  const carried = helpers.remapTextRunsForTextEdit(before.text, text, before.textRuns, before.caret === undefined ? undefined : { caret: before.caret }) ?? []
  const kept: TextRun[] = []
  for (const run of carried) {
    for (const [a, b] of hidden) {
      const start = Math.max(a, run.start)
      const end = Math.min(b, run.end)
      if (start < end) kept.push({ ...run, start, end })
    }
  }
  return { text, textRuns: helpers.normalizeTextRuns([...visible, ...kept], text.length) }
}

/** The page highlight names a box draws by name (the engine's `TEXT_HIGHLIGHT_FILLS`); yellow is the page's `null`. */
const BOX_HIGHLIGHT_NAMES = new Set(['green', 'blue', 'pink'])

/**
 * The ▾ panel's other names (YAZ-4388) as their hex: `HIGHLIGHT_HEX` of `editor/marks/highlight.ts`, copied so this
 * file loads no editor module (an import cycle); `textBoxPopups.test.ts` fails when the two differ.
 */
export const PANEL_HIGHLIGHT_HEX: Readonly<Record<string, string>> = { orange: '#ff9632', purple: '#a06eff', red: '#ff5a50', gray: '#969696' }

/**
 * A page highlight as a box run keeps it. A panel name that is no box name would be dropped by the engine, so it
 * becomes its own hex, which a box draws (a custom highlight).
 */
function boxHighlight(color: string | null): string {
  if (color === null) return 'yellow'
  if (BOX_HIGHLIGHT_NAMES.has(color)) return color
  return PANEL_HIGHLIGHT_HEX[color] ?? color
}

function styleOf(marks: readonly Mark[]): Omit<MutableRun, 'start' | 'end'> {
  const style: Omit<MutableRun, 'start' | 'end'> = {}
  for (const mark of marks) {
    const name = mark.type.name
    if (name === 'strong') style.bold = true
    else if (name === 'emphasis') style.italic = true
    else if (name === 'underline') style.underline = true
    else if (name === 'strike_through') style.strikethrough = true
    else if (name === 'highlight') style.highlight = boxHighlight(mark.attrs.color as string | null)
    else if (name === 'text_color' && mark.attrs.color) style.color = mark.attrs.color as string
  }
  return style
}

/** The document position of a text offset; an offset in a bullet's prefix goes to the start of its letters. */
export function posAt(doc: ProseNode, offset: number, helpers: BoxHelpers): number {
  let start = 0
  const lines = docLines(doc, helpers)
  for (const line of lines) {
    const length = line.prefix.length + line.node.content.size
    if (offset <= start + length) return line.pos + Math.max(0, offset - start - line.prefix.length)
    start += length + 1
  }
  const last = lines[lines.length - 1]
  return last ? last.pos + last.node.content.size : 0
}

/** The text offset of a document position. */
export function offsetAt(doc: ProseNode, pos: number, helpers: BoxHelpers): number {
  let start = 0
  for (const line of docLines(doc, helpers)) {
    const length = line.prefix.length + line.node.content.size
    if (pos <= line.pos + line.node.content.size) return start + line.prefix.length + Math.max(0, pos - line.pos)
    start += length + 1
  }
  return Math.max(0, start - 1)
}

/** YAZ-4306: the positions of the list items on box lines `lines` (a line that is no list item has none). */
export function itemPositions(doc: ProseNode, lines: readonly number[], helpers: BoxHelpers): number[] {
  const all = docLines(doc, helpers)
  // an item's first line starts 2 after the item: the item, then its paragraph
  return lines.flatMap((line) => (all[line]?.item ? [all[line].pos - 2] : []))
}

/** YAZ-4306: the box lines of the list items at `positions`, sorted. */
export function itemLines(doc: ProseNode, positions: Iterable<number>, helpers: BoxHelpers): number[] {
  const wanted = new Set([...positions].map((pos) => pos + 2))
  const out: number[] = []
  docLines(doc, helpers).forEach((line, index) => {
    if (line.item && wanted.has(line.pos)) out.push(index)
  })
  return out
}
