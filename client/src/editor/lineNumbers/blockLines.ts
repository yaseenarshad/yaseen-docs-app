import { parse, postprocess, preprocess } from 'micromark'
import { gfm } from 'micromark-extension-gfm'

/** One entry per leaf block, in document order: the line it starts on (1-based) and its kind. */
export interface BlockLines {
  lines: number[]
  kinds: string
}

const KIND: Record<string, string> = {
  paragraph: 'p', htmlFlow: 'p', atxHeading: 'h', setextHeading: 'h',
  codeFenced: 'c', codeIndented: 'c', thematicBreak: 'r', table: 't',
}
const LISTS = new Set(['listOrdered', 'listUnordered'])

/** Block structure only, from micromark's events: no syntax tree is built (YAZ-2643). */
export function blockLines(text: string): BlockLines {
  const events = postprocess(parse({ extensions: [gfm()] }).document().write(preprocess()(text, undefined, true)))
  const lines: number[] = []
  let kinds = ''
  let tables = 0
  // A list item's line, held until its first block shows up: a bare marker is an empty paragraph in the editor.
  let emptyItem: number | null = null
  // Per open quote, the count of blocks when it opened: the editor fills a quote that holds none with an empty paragraph.
  const quotes: number[] = []
  const add = (line: number, kind: string) => {
    lines.push(line)
    kinds += kind
  }
  const flush = () => {
    if (emptyItem === null) return
    add(emptyItem, 'p')
    emptyItem = null
  }
  for (const [phase, token] of events) {
    // A plain string: `table` is the GFM extension's token, and micromark's own type map does not list it.
    const type: string = token.type
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
      } else if (quotes.pop() === lines.length) add(token.start.line, 'p')
    }
    if (type === 'table') tables += phase === 'enter' ? 1 : -1
    if (phase === 'exit') continue
    if (type === 'listItemPrefix') {
      flush()
      emptyItem = token.start.line
    }
    const kind = KIND[type]
    if (kind === undefined || (tables > 0 && type !== 'table')) continue
    emptyItem = null
    add(token.start.line, kind)
  }
  return { lines, kinds }
}
