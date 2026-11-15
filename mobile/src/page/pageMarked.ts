import { Marked, type Token, type TokenizerExtension, type Tokens } from 'marked'

/**
 * THE READER'S MARKDOWN PARSER (YAZ-5513): the one `marked` (GitHub flavour, a single line break is a line break) with
 * the page's own block and inline tokenizers. The page renderer draws with it (`pageRender.ts` adds its renderers to
 * THIS instance), and the phone's tick finds its task with it (`pageTasks`, `comments/taskWrite.ts`). So the box a
 * person taps and the line a tick writes are found by the same parse, never by a second reading of the text: a line in
 * a code fence, an indented code block, an HTML block or a card block is never a task, as the reader never draws a box
 * for it. Only the tokenizers live here (no DOM, no cleaner): the send loads this file without the renderer.
 */

export interface PageLinkToken extends Tokens.Generic {
  inner: string
  embed: boolean
}

/** `[[inner]]` and `![[inner]]`, as the card's tokenizer reads them (`cardRender.ts`): before marked's own links. */
const wikilinks: TokenizerExtension = {
  name: 'pageLink',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at > 0 && src[at - 1] === '!' ? at - 1 : at
  },
  tokenizer(src) {
    const m = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src)
    return m === null ? undefined : ({ type: 'pageLink', raw: m[0], inner: m[2], embed: m[1] === '!' } as PageLinkToken)
  },
}

/** `==text==`: the Mac's yellow highlight (`marks/highlight.ts`). */
const highlight: TokenizerExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) {
    const at = src.indexOf('==')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = /^==(?=\S)([^=\n]*?\S)==/.exec(src)
    return m === null ? undefined : { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) }
  },
}

/** `[^id]`: a footnote mark (as the Mac's GFM page). */
const footnoteRef: TokenizerExtension = {
  name: 'footnoteRef',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[^')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src)
    return m === null ? undefined : { type: 'footnoteRef', raw: m[0], id: m[1] }
  },
}

/** `[^id]: text`: the note, where it is written (as the Mac's page). */
const footnoteDef: TokenizerExtension = {
  name: 'footnoteDef',
  level: 'block',
  start(src) {
    return /^\[\^[^\]\s]+\]:/m.exec(src)?.index
  },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*\n)(?!\[\^)[^\n]*)*)(?:\n+|$)/.exec(src)
    return m === null ? undefined : { type: 'footnoteDef', raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(m[2]) }
  },
}

/** `$$ … $$` alone: block math, drawn as its source (`pageRender.ts`). */
const blockMath: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return /^\$\$/m.exec(src)?.index
  },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
    return m === null ? undefined : { type: 'blockMath', raw: m[0], text: m[1].trim() }
  },
}

export const pageMarked = new Marked({ gfm: true, breaks: true })
pageMarked.use({ extensions: [blockMath, footnoteDef, wikilinks, footnoteRef, highlight] })

/**
 * A task as the reader draws it: its line in the text it was parsed from (0-based; a line ends at LF, CRLF or CR, as
 * the parser reads it), where its box's mark (the byte between the brackets) is in that line, its state, and its core
 * (the line from its marker on, its box as `[ ]`: `comments/taskWrite.ts`).
 */
export interface PageTask {
  line: number
  box: number
  checked: boolean
  core: string
}

/** A list item, with the task the parse found for it: `null` when its line does not read as that task. */
export type TaskItem = Tokens.ListItem & { pageTask?: PageTask | null }

/**
 * A task line: container marks before it (quote marks, the markers of the lists it sits in on the same line, the
 * indent), then its marker, the space, the box, a space and the rest (`marked`'s `listIsTask`).
 */
const TASK = /^((?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t])))*?[ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\]( .*)$/

/** `line` (no line end) read as a task line: where its box's mark is, its state and its core. Or `null`. */
export function readTaskLine(line: string): Omit<PageTask, 'line'> | null {
  const m = TASK.exec(line)
  if (m === null) return null
  return { box: m[1]!.length + m[2]!.length + 1, checked: m[3] !== ' ', core: `${m[2]}[ ]${m[4]}` }
}

const LINE_END = /\r\n|\r|\n/g

/** The lines of `text` (no line ends), as the parser counts them. */
export function linesOf(text: string): string[] {
  return text.split(LINE_END)
}

const newlines = (raw: string): number => {
  let n = 0
  for (let i = raw.indexOf('\n'); i !== -1; i = raw.indexOf('\n', i + 1)) n++
  return n
}

/**
 * Each task item of `tokens` (the parse of `text`, its first line `firstLine` of a longer text) gets its task
 * (`pageTask`), and the tasks come back in document order. A token's `raw` is its text with the line ends made LF, so
 * counting its LFs walks the lines; a list item's and a quote's own tokens start on their first line. A task is kept
 * only when its line in `text` reads as that task (the same core, the same state): else it is no task (`null`), never
 * a guess at another line.
 */
export function markTasks(tokens: readonly Token[], text: string, firstLine = 0): PageTask[] {
  const lines = linesOf(text)
  const out: PageTask[] = []
  const walk = (list: readonly Token[], start: number) => {
    let line = start
    for (const token of list) {
      if (token.type === 'list') {
        let from = line
        for (const item of (token as Tokens.List).items as TaskItem[]) {
          if (item.task) {
            const own = readTaskLine(lines[from] ?? '')
            const first = readTaskLine(item.raw.split('\n', 1)[0]!)
            const ok = own !== null && first !== null && own.core === first.core && own.checked === item.checked
            item.pageTask = ok ? { line: from + firstLine, box: own.box, checked: own.checked, core: own.core } : null
            if (item.pageTask) out.push(item.pageTask)
          }
          walk(item.tokens, from)
          from += newlines(item.raw)
        }
      } else if (token.type === 'blockquote') walk((token as Tokens.Blockquote).tokens, line)
      line += newlines(token.raw)
    }
  }
  walk(tokens, 0)
  return out
}

/** The tasks of `text` (a page's body, its properties left out), as the reader draws them. */
export function pageTasks(text: string): PageTask[] {
  return markTasks(pageMarked.lexer(text), text)
}
