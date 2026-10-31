/**
 * Empty list items round-trip (GRO-2012). Milkdown serialises an empty paragraph as the html
 * node `<br />`, so an empty bullet (Enter at the end of an item, outdented empty item, …)
 * was written as `* <br />`. That is not harmless: on the next load CommonMark reads `<br />`
 * as the start of an HTML block that runs to the next blank line, so the item's nested
 * children became literal text. Obsidian writes an empty bullet as a bare marker.
 *
 * Eight pieces, all schema/remark/text-level (no Milkdown fork):
 *  1. serialise: an empty paragraph that STARTS a list item is emitted as an empty mdast
 *     paragraph → bare marker (`*`, `1.`); other empty paragraphs keep `<br />`. Inside Milkdown
 *     an empty TASK item stays `* [ ] <br />` (remark drops the checkbox from `* [ ]`, and `[ ]`
 *     already stops the HTML-block reading) — see 4 for what reaches the disk.
 *  2. parse: a listItem whose nested list (or table, YAZ-3696 D12) starts on a later line (`* ` + children — what
 *     Obsidian writes for an empty parent) gets an empty leading paragraph, instead of
 *     becoming a list_item that starts with a bullet_list and serialising as `* * child`.
 *     A numeric marker immediately after a bullet is armored before parsing (see 6), so it is
 *     paragraph text rather than a nested ordered list.
 *  3. load: `normalizeEmptyItems()` rewrites `* <br />` lines (written by earlier builds) to
 *     bare markers so their children are not swallowed, and Obsidian's empty task `* [ ] ` /
 *     `* [ ]` (text `[ ]` for remark, round-tripped as `* \[ ]`) to `* [ ] <br />` so it stays a
 *     checkbox.
 *  4. save: `restoreItemLine()` turns `* [ ] <br />` back into `* [ ]` — `<br />` never
 *     reaches the disk, and 3 restores the checkbox on the next load.
 *  5. load (GRO-2112): `unifySiblingMarkers()` makes `-` / `*` / `+` siblings at one indent share a
 *     marker so they parse as ONE list (see its docblock).
 *  6. load/save (YAZ-1329): `* 6) text` / `* 6. text` are bullet text, not an implicit ordered
 *     child. Load temporarily escapes that inner delimiter for CommonMark; save
 *     (`restoreItemLine()`) restores the visible source spelling. Real ordered lines (`6. text`)
 *     remain structural.
 *  7. load (YAZ-1357): `separateEmptyNestedItems()` puts a blank line between a text item and a
 *     deeper bare marker on the next line — an EMPTY item cannot interrupt a paragraph in
 *     CommonMark, so without it rule 1's spelling reads back as text (or a setext heading).
 *  8. load (YAZ-3727 D1): `alignNestedIndent()` reads the list depth from the indentation: a list
 *     line indented past its parent's marker moves to the parent's text column, so 3 spaces under
 *     `10.` or a tab under `-` nests (see its docblock). It runs before 5, which reads the indent.
 *
 * 🔒 ONE WALK: every text rule (3 to 8), on load and on save, reads the text through
 * `mapOutsideFences()`, and so does the save rule for wikilinks: `postProcessMarkdown()`
 * (createCrepe.ts) is that walk on save. The walk skips fenced code. It knows the fence character,
 * the fence length, and that a closing fence has no text after it, so a line of 3 backticks inside
 * a fence of 4, a backtick line inside a `~~~` fence and a line such as ```js inside a fence do not
 * end the code. Not seen as code: indented code (4 spaces, no fence), where a guess can read a
 * nested list as code, and a code span over two or more lines.
 */
import { paragraphSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as MdNode } from '@milkdown/kit/transformer'
import { $remark } from '@milkdown/kit/utils'

type MdParent = MdNode & { children?: MdParent[]; position?: { start: { line: number } } }

const emptyParagraphFirstInListItem = paragraphSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const parent = state.top()
        if (node.content.size === 0 && parent?.type === 'listItem' && !parent.children?.length && typeof parent.props.checked !== 'boolean') {
          state.openNode('paragraph')
          state.closeNode()
          return
        }
        base.toMarkdown.runner(state, node)
      },
    },
  }
})

/**
 * An item whose nested list starts on a LATER line (`* ` + children). A table there too: `/table` in
 * a bullet keeps an empty label line above the table, written `*` + the indented table (YAZ-3696 D12).
 */
const isEmptyParent = (item: MdParent): boolean => {
  const first = item.children?.[0]
  if (first?.type !== 'list' && first?.type !== 'table') return false
  const itemLine = item.position?.start.line
  const listLine = first.position?.start.line
  return itemLine === undefined || listLine === undefined || listLine > itemLine
}

const addLeadingParagraph = (node: MdParent): void => {
  if (!node.children) return
  if (node.type === 'listItem' && isEmptyParent(node)) node.children.unshift({ type: 'paragraph', children: [] })
  node.children.forEach(addLeadingParagraph)
}

const listItemLeadingParagraph = $remark('mdapp-list-item-leading-paragraph', () => () => (tree: MdParent) => {
  addLeadingParagraph(tree)
})

/** Register with `editor.use(...)`. */
export const listItemRoundTrip = [emptyParagraphFirstInListItem, listItemLeadingParagraph].flat()

const MARKER = String.raw`[ \t]*(?:[-*+]|\d+[.)])`
/** The end of ONE line of the walk, which keeps the `\r` of a CRLF file: the two load rules stop before it, so the line keeps its ending. */
const LINE_END = String.raw`(?=\r?$)`
const LEGACY_EMPTY_ITEM = new RegExp(String.raw`^(${MARKER}) <br />[ \t]*${LINE_END}`)
const EMPTY_TASK_ITEM = new RegExp(String.raw`^(${MARKER} \[[ xX]\])[ \t]*${LINE_END}`)
const EMPTY_TASK_ITEM_BREAK = new RegExp(String.raw`^(${MARKER} \[[ xX]\]) <br />$`)

const SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)([.)])(?=[ \t\r]|$)/
const ESCAPED_SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)\\([.)])(?=[ \t\r]|$)/
const FENCE_BOUNDARY = /^[ \t]*(`{3,}|~{3,})/

/**
 * Transform ordinary Markdown lines while leaving complete fenced code blocks byte-identical.
 * 🔒 EVERY text rule of the editor, on load and on save, goes through this ONE walk: a rule that
 * reads the text by itself reads code as Markdown. `next` is the line below, for a rule that looks ahead.
 */
export const mapOutsideFences = (markdown: string, transform: (line: string, next: string | undefined) => string): string => {
  let fence: { marker: '`' | '~'; length: number } | null = null
  return markdown
    .split('\n')
    .map((line, index, lines) => {
      const boundary = FENCE_BOUNDARY.exec(line)
      if (fence !== null) {
        if (
          boundary !== null &&
          boundary[1][0] === fence.marker &&
          boundary[1].length >= fence.length &&
          line.slice(boundary[0].length).trim() === ''
        ) {
          fence = null
        }
        return line
      }
      if (boundary !== null) {
        fence = { marker: boundary[1][0] as '`' | '~', length: boundary[1].length }
        return line
      }
      return transform(line, lines[index + 1])
    })
    .join('\n')
}

/** Before parsing: make an immediate inner `6)` / `6.` delimiter literal to CommonMark. */
export const escapeSameLineOrderedMarkers = (markdown: string): string =>
  mapOutsideFences(markdown, (line) => line.replace(SAME_LINE_ORDERED_MARKER, '$1\\$2'))

/**
 * Before writing, ONE line outside code: `* [ ] <br />` (Milkdown's empty task) → `* [ ]`, and the
 * same-line delimiter back to its visible, unescaped spelling.
 */
export const restoreItemLine = (line: string): string =>
  line.replace(EMPTY_TASK_ITEM_BREAK, '$1').replace(ESCAPED_SAME_LINE_ORDERED_MARKER, '$1$2')

/** Before parsing: `* <br />` → bare marker; empty task `* [ ]` → `* [ ] <br />` (keeps the checkbox);
 * then each list line moves to the depth its indentation gives (rule 8; before the marker rule,
 * which reads the indent); then markers unified; then (LAST, since the blank line resets the marker
 * memory) an empty bullet nested directly under text gets its blank line (rule 7). */
export const normalizeEmptyItems = (markdown: string): string =>
  separateEmptyNestedItems(
    unifySiblingMarkers(
      alignNestedIndent(
        mapOutsideFences(escapeSameLineOrderedMarkers(markdown), (line) => line.replace(LEGACY_EMPTY_ITEM, '$1').replace(EMPTY_TASK_ITEM, '$1 <br />')),
      ),
    ),
  )

/** A bullet line, including a bare empty marker (`*` / `-` alone, what rule 1 writes). */
const BULLET_LINE = /^(\s*)([-*+])(?:\s|$)/
/** `- - -` / `* * *` / `***`: a thematic break, which would otherwise pass as a bullet. */
const THEMATIC_BREAK = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/
/** Tabs count as four spaces, the editor's own rule for depth. */
const indentWidth = (indent: string): number => indent.replace(/\t/g, '    ').length

/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. To CommonMark a marker
 * change starts a NEW list, so `* a` then `- b` at one indent become two sibling lists (two guide
 * lines, folding / line click / drag each seeing half the children). Outliners treat indentation
 * as the structure, so on load every bullet takes the marker of the previous bullet at its indent
 * (tabs = 4 spaces). Deeper indents are forgotten when a shallower bullet appears; a blank line
 * resets everything (`* a`, blank, `- b` stays two lists — Obsidian shows the same); non-bullet
 * lines never reset, since a lazy continuation keeps the list going and anything that really ends
 * it (heading, fence, thematic break) makes remark split the lists whatever the marker; fenced
 * code and thematic breaks are skipped; ordered items are not bullets. Save already normalises
 * markers (CONTRACTS rule 6), so nothing on disk is lost.
 */
export const unifySiblingMarkers = (markdown: string): string => {
  const markerAtIndent = new Map<number, string>()
  return mapOutsideFences(markdown, (line) => {
    if (THEMATIC_BREAK.test(line)) return line
    const match = BULLET_LINE.exec(line)
    if (match === null) {
      if (line.trim() === '') markerAtIndent.clear()
      return line
    }
    const indent = indentWidth(match[1])
    for (const deeper of [...markerAtIndent.keys()]) if (deeper > indent) markerAtIndent.delete(deeper)
    const marker = markerAtIndent.get(indent) ?? match[2]
    markerAtIndent.set(indent, marker)
    return marker === match[2] ? line : `${match[1]}${marker}${line.slice(match[1].length + 1)}`
  })
}

/** A bullet or numbered line: its indent, its marker (with the number), and the spaces before its text. */
const LIST_LINE = /^([ \t]*)([-*+]|(\d+)[.)])([ \t]+|(?=\r?$))/
/** A heading or a quote: like a thematic break or a fence, it closes the items right of it, blank line or not. */
const CLOSES_ITEMS = /^[ \t]*(?:#{1,6}(?:[ \t]|\r?$)|>)/

/** One open item: its marker and text columns as written (`from`, `fromText`) and as aligned (`to`, `text`). */
interface Level {
  from: number
  fromText: number
  to: number
  text: number
}

/**
 * Before parsing (YAZ-3727 D1, rule 8): the list depth comes from the indentation, as in an
 * outliner. CommonMark nests a line only at its parent's TEXT column, and that column moves with
 * the marker: `9. ` is 3 wide, `10. ` is 4. An AI that indents every child by 3 spaces so puts the
 * children of 10 and up out of the list, and the next save writes that flat shape to disk.
 *  - A list line indented past the marker of an open item is that item's child, however wide the
 *    indent (Obsidian's tabs, 3 spaces under `10.`, 6 spaces under `*`). It moves to the parent's
 *    text column. A line at or left of a marker closes that item.
 *  - A text line moves with the deepest item whose text column it reaches. A lazy line (no blank
 *    line above it) stays as written: CommonMark keeps it in the paragraph above.
 *  - A numbered child that does not start at 1, right under its parent's text, gets a blank line
 *    first: CommonMark lets a numbered list interrupt a paragraph only when it starts at 1. A blank
 *    line is also what Milkdown writes there, so the file converges on it. An empty parent (a bare
 *    marker) has no paragraph, and a blank line would end it, so its child gets none.
 *  - A heading, a quote, a thematic break or a fence left of an item's text closes that item, as in
 *    CommonMark: a line below it is not moved into the closed item (where 4 spaces read as code).
 *    The walk never shows a fence to a rule, so the rule sees it as the `next` line.
 * Markdown the app writes is already aligned, so it passes through byte-identical. Fenced code is
 * skipped by the walk, so a fence inside a moved item keeps its indent (a known limit).
 */
export const alignNestedIndent = (markdown: string): string => {
  const levels: Level[] = []
  /** What the line above leaves open: an item's paragraph, a paragraph outside lists (`null`), or nothing (`'blank'`). */
  let previous: Level | 'blank' | null = null
  /** The indent of a fence right under the line before, which closed the items right of it. */
  let fenceAt: number | null = null
  const closeRightOf = (column: number): void => {
    while (levels.length > 0 && levels[levels.length - 1].fromText > column) levels.pop()
  }
  return mapOutsideFences(markdown, (line, next) => {
    if (fenceAt !== null) {
      closeRightOf(fenceAt)
      previous = 'blank'
    }
    const fence = next === undefined ? null : FENCE_BOUNDARY.exec(next)
    fenceAt = fence === null ? null : indentWidth(fence[0].slice(0, -fence[1].length))
    if (line.trim() === '') {
      previous = 'blank'
      return line
    }
    const indent = /^[ \t]*/.exec(line)![0]
    const width = indentWidth(indent)
    const breaks = THEMATIC_BREAK.test(line)
    const item = breaks ? null : LIST_LINE.exec(line)
    if (item === null) {
      const top = levels[levels.length - 1]
      // A lazy line keeps the paragraph above going.
      if (top !== undefined && top.fromText > width && previous !== 'blank' && !breaks && !CLOSES_ITEMS.test(line)) return line
      closeRightOf(width)
      const owner = levels[levels.length - 1]
      previous = owner ?? null
      return owner === undefined || owner.text === owner.fromText ? line : ' '.repeat(width + owner.text - owner.fromText) + line.slice(indent.length)
    }
    while (levels.length > 0 && levels[levels.length - 1].from >= width) levels.pop()
    const parent = levels[levels.length - 1]
    const to = parent === undefined ? width : parent.text
    const gap = item[4].length === 0 || item[4].length > 4 ? 1 : indentWidth(item[4])
    const level: Level = { from: width, fromText: width + item[2].length + gap, to, text: to + item[2].length + gap }
    // CommonMark lets a numbered list interrupt a paragraph only when it starts at 1.
    const interrupts = parent !== undefined && previous === parent && item[3] !== undefined && item[3] !== '1'
    levels.push(level)
    previous = line.slice(item[0].length).trim() === '' ? 'blank' : level
    const aligned = to === width ? line : ' '.repeat(to) + line.slice(indent.length)
    return interrupts ? `\n${aligned}` : aligned
  })
}

/** A bullet or ordered item WITH text. */
const TEXT_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\S/
/** A bare marker: an empty item (what rule 1 writes). */
const BARE_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]*\r?$/

/**
 * Before parsing (YAZ-1357, rule 7): a text item followed on the VERY NEXT line by a deeper bare
 * marker gets one blank line between them. CommonMark forbids an EMPTY list item from interrupting
 * a paragraph, so `* a` + `  *` (Enter, Tab) read back as the text `a *` in the note editor and, in
 * the outline editor's `-` spelling, as a setext heading that the bullets-only schema drops whole
 * (the YAZ-974 guard then locked the view). The blank line is the one spelling every parser reads
 * as a nested empty item — and the one Milkdown writes back, so the file converges on it. A no-op
 * once the blank line exists; fenced code is left alone; a SIBLING bare marker is not nested.
 */
export const separateEmptyNestedItems = (markdown: string): string =>
  mapOutsideFences(markdown, (line, below) => {
    const text = TEXT_ITEM.exec(line)
    const next = below === undefined ? null : BARE_ITEM.exec(below)
    // The line plus one line ending: the walk joins it to the next, which leaves a blank line between.
    return text !== null && next !== null && indentWidth(next[1]) > indentWidth(text[1]) ? `${line}\n` : line
  })

