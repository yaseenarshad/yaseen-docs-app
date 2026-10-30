import { parse, postprocess, preprocess } from 'micromark'
import { gfm } from 'micromark-extension-gfm'
import { parseLineComment } from '../line/lineComment'
import { parseTableComment } from '../table/tableComment'

/**
 * One entry per leaf block, in document order: the line it starts on (1-based), the line it ends
 * on, and its kind. Code has two kinds: `c` has a fence line above its first code line, and `i`
 * (indented) starts on that line.
 *
 * A styled line's comment is no block (YAZ-3204, rule 41): the editor joins `***` and the
 * `<!-- line: … -->` right after it, in the same container, into ONE `hr` (`lineStyleRemark`), so
 * the comment is skipped here by the same rule, and the line's entry ends on the comment's last
 * line — a block of two or more lines of the file shows its range (D7), as a setext heading's
 * underline does. A table's comment is skipped the same way (YAZ-3758, rule 41a): the editor joins
 * a `table` and the `<!-- table: … -->` right after it (`tableStyleRemark`), and the table's entry
 * ends on the comment. Any other HTML block is a block, as before.
 */
export interface BlockLines {
  lines: number[]
  ends: number[]
  kinds: string
}

const KIND: Record<string, string> = {
  paragraph: 'p', htmlFlow: 'p', atxHeading: 'h', setextHeadingText: 'h',
  codeFenced: 'c', codeIndented: 'i', thematicBreak: 'r', table: 't',
}
const LISTS = new Set(['listOrdered', 'listUnordered'])

/**
 * An HTML block's text as remark gives it to the editor: its `htmlFlowData` lines joined by a line
 * break, so a container's prefix on a continuation line (a quote's `> `, YAZ-3206) is not in it.
 * `index` is the block's enter event.
 */
function htmlText(events: ReturnType<typeof postprocess>, index: number, text: string): string {
  const html = events[index][1]
  const lines: string[] = []
  for (let i = index + 1; i < events.length; i++) {
    const [phase, token] = events[i]
    if (token === html) break
    if (phase === 'enter' && token.type === 'htmlFlowData') lines.push(text.slice(token.start.offset, token.end.offset))
  }
  return lines.join('\n')
}

/** Block structure only, from micromark's events: no syntax tree is built (YAZ-2643). */
export function blockLines(text: string): BlockLines {
  const events = postprocess(parse({ extensions: [gfm()] }).document().write(preprocess()(text, undefined, true)))
  const lines: number[] = []
  const ends: number[] = []
  let kinds = ''
  // A list item's line, held until its first block shows up: a bare marker is an empty paragraph in the editor.
  let emptyItem: number | null = null
  // Per open quote, the count of blocks when it opened: the editor fills a quote that holds none with an empty paragraph.
  const quotes: number[] = []
  const add = (line: number, end: number, kind: string) => {
    lines.push(line)
    ends.push(end)
    kinds += kind
  }
  // Right after a thematic break or a table, until anything else happens in the flow: the next HTML
  // block may be its comment. The block's kind, or null.
  let after: string | null = null
  const flush = () => {
    if (emptyItem === null) return
    add(emptyItem, emptyItem, 'p')
    emptyItem = null
  }
  for (const [index, [phase, token]] of events.entries()) {
    const { type } = token
    // A new list item, a list or a quote that opens or closes: the next block is no sibling of the line.
    if (LISTS.has(type) || type === 'blockQuote' || type === 'listItemPrefix') after = null
    if (LISTS.has(type)) {
      // A nested list on the item's OWN line (`* - nested`) is the item's first block: the editor adds
      // a paragraph only when the list starts on a later line (listItemRoundTrip rule 2).
      if (phase === 'enter' && emptyItem === token.start.line) emptyItem = null
      else flush()
    }
    if (type === 'blockQuote') {
      if (phase === 'enter') {
        emptyItem = null
        quotes.push(lines.length)
      } else if (quotes.pop() === lines.length) add(token.start.line, token.start.line, 'p')
    }
    if (phase === 'exit') continue
    if (type === 'listItemPrefix') {
      flush()
      emptyItem = token.start.line
    }
    // The heading's entry is the line of its text, and the heading ends on its underline.
    if (type === 'setextHeadingLine') ends[ends.length - 1] = token.start.line
    const kind = KIND[type]
    if (kind === undefined) continue
    emptyItem = null
    // A fence that is never closed runs to the end of the text, and ends at the START of the line under its last one.
    const { start, end } = token
    const last = end.column === 1 && end.line > start.line ? end.line - 1 : end.line
    if (after !== null && type === 'htmlFlow' && (after === 'r' ? parseLineComment : parseTableComment)(htmlText(events, index, text)) !== null) {
      ends[ends.length - 1] = last
      after = null
      continue
    }
    after = kind === 'r' || kind === 't' ? kind : null
    add(start.line, last, kind)
  }
  return { lines, ends, kinds }
}
