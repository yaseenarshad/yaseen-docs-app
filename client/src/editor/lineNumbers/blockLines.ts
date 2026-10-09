import { parse, postprocess, preprocess } from 'micromark'
import { gfm } from 'micromark-extension-gfm'

/**
 * One entry per leaf block, in document order: the line it starts on (1-based), the line it ends
 * on, and its kind. Code has two kinds: `c` has a fence line above its first code line, and `i`
 * (indented) starts on that line.
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
  const flush = () => {
    if (emptyItem === null) return
    add(emptyItem, emptyItem, 'p')
    emptyItem = null
  }
  for (const [phase, token] of events) {
    const { type } = token
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
    add(start.line, end.column === 1 && end.line > start.line ? end.line - 1 : end.line, kind)
  }
  return { lines, ends, kinds }
}
