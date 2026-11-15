import { Marked, Tokenizer, type Token, type TokenizerExtension, type Tokens } from 'marked'

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

/**
 * `$$ … $$` alone: block math, drawn as its source (`pageRender.ts`). It opens on a line that starts with `$$` (up to
 * 3 spaces in) and closes at the next `$$` that ends a line. YAZ-5547: what is inside stays math, a `- [ ]` line too:
 * no box, no task, and no tick ever writes in it (`pageTasks` reads the same parse).
 */
export const BLOCK_MATH = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/
const blockMath: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return /^ {0,3}\$\$/m.exec(src)?.index
  },
  tokenizer(src) {
    const m = BLOCK_MATH.exec(src)
    return m === null ? undefined : { type: 'blockMath', raw: m[0], text: m[1].trim() }
  },
}

/**
 * YAZ-5547: a math block right under a list item's text (no blank line) ends the list, as it ends a paragraph:
 * `marked` would read its `$$` as more of the item's text, and the `- [ ]` line inside as the next task. Only a `$$`
 * less indented than the item's text does so (deeper, it is the item's own block, read inside the item). `raw`: the
 * list as `marked` read it from `src`; the list's text up to that `$$`, or `null` when there is none.
 */
function listBeforeMath(raw: string, src: string): string | null {
  const head = /^ {0,3}(?:[-*+]|\d{1,9}[.)])( {1,4}|\t|$)/.exec(raw)
  if (head === null || !raw.includes('$$')) return null
  const column = head[0].length
  for (let at = raw.indexOf('\n'); at !== -1 && at + 1 < raw.length; at = raw.indexOf('\n', at + 1)) {
    const m = /^ {0,3}\$\$/.exec(raw.slice(at + 1, at + 6))
    if (m !== null && m[0].length - 2 < column && BLOCK_MATH.test(src.slice(at + 1))) return src.slice(0, at + 1)
  }
  return null
}

export const pageMarked = new Marked({ gfm: true, breaks: true })
pageMarked.use({
  extensions: [blockMath, footnoteDef, wikilinks, footnoteRef, highlight],
  tokenizer: {
    list(src) {
      const list = Tokenizer.prototype.list.call(this, src)
      const cut = list === undefined ? null : listBeforeMath(list.raw, src)
      return cut === null ? list : Tokenizer.prototype.list.call(this, cut)
    },
  },
})

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

/** A list item, with the task the parse found for it: `null` when it is no task the Mac reads (no box is drawn). */
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

/** The columns of a line's leading spaces and tabs (a tab to the next stop of 4). */
const indent = (line: string): number => {
  let col = 0
  for (const c of line) {
    if (c === ' ') col++
    else if (c === '\t') col += 4 - (col % 4)
    else break
  }
  return col
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
 * only when its line in `text` reads as that task (the same core, the same state), and when the Mac reads it as a task
 * (`lazyItems`): else it is no task (`null`, no box), never a guess at another line.
 */
export function markTasks(tokens: readonly Token[], text: string, firstLine = 0): PageTask[] {
  const lines = linesOf(text)
  const out: PageTask[] = []
  /**
   * `inside`: the first block of `list` opens where the Mac's parser would be interrupting (`interrupts`). `lazy`: these
   * are the tokens of an item the Mac reads as paragraph text, whose line starts at that column (`lazyItems`). `dead`:
   * the Mac reads none of this as a list.
   */
  const walk = (list: readonly Token[], start: number, inside: boolean, lazy: number | null, dead: boolean) => {
    let line = start
    list.forEach((token, at) => {
      const interrupting = interrupts(list, at, inside)
      // In a lazy item, a list is the Mac's only right after the item's text (a bullet list interrupts that paragraph)
      // and at most 3 columns in from it; after a blank line or deeper, the Mac reads code or more text.
      const off = dead || (lazy !== null && !(token.type === 'list' && (list[at - 1]?.type === 'text' || list[at - 1]?.type === 'paragraph') && indent(lines[line] ?? '') - lazy <= 3))
      if (token.type === 'list') {
        const lazyN = interrupting ? lazyItems(token as Tokens.List) : 0
        ;(token as LazyList).lazy = lazyN
        let from = line
        ;((token as Tokens.List).items as TaskItem[]).forEach((item, n) => {
          if (item.task) {
            const own = readTaskLine(lines[from] ?? '')
            const first = readTaskLine(item.raw.split('\n', 1)[0]!)
            const ok = !off && n >= lazyN && own !== null && first !== null && own.core === first.core && own.checked === item.checked
            item.pageTask = ok ? { line: from + firstLine, box: own.box, checked: own.checked, core: own.core } : null
            if (item.pageTask) out.push(item.pageTask)
          }
          walk(item.tokens, from, n === 0 && interrupting, n < lazyN ? indent(lines[from] ?? '') : null, off)
          from += newlines(item.raw)
        })
      } else if (token.type === 'blockquote') walk((token as Tokens.Blockquote).tokens, line, interrupting, null, off)
      line += newlines(token.raw)
    })
  }
  walk(tokens, 0, false, null, false)
  return out
}

/** A list, with how many of its first items the Mac reads as paragraph text (`lazyItems`). */
type LazyList = Tokens.List & { lazy?: number }

/**
 * T3, THE MAC'S RULE for a list that does not start at 1 (the Mac reads a page with micromark): such a list cannot
 * INTERRUPT what is open before it. Open is a paragraph right before it (CommonMark: `- parent` then `  2) [ ] X` is
 * the paragraph's own text, which `marked` makes a list), and, as micromark reads it, an indented code block before it
 * (blank lines between do not close it), also for the first block of a quote or a list item that itself opens there
 * (`para` then `> 2) [ ] X`). A list before it whose last item is such text leaves that text open, or the code it ends
 * in. True when the block at `list[at]` opens so.
 */
function interrupts(list: readonly Token[], at: number, inside: boolean): boolean {
  const before = list[at - 1]
  if (before?.type === 'paragraph' || before?.type === 'text') return true
  const lazyLast = (t: Token | undefined) => t?.type === 'list' && ((t as LazyList).lazy ?? 0) >= (t as LazyList).items.length
  if (lazyLast(before)) return true
  let i = at - 1
  while (i >= 0 && list[i]!.type === 'space') i--
  if (i < 0) return inside
  const open = list[i]!
  if (lazyLast(open)) return endsInCode((open as LazyList).items.at(-1)!)
  return open.type === 'code' && (open as Tokens.Code).codeBlockStyle === 'indented'
}

/**
 * How many of an interrupting ordered `list`'s first items the Mac reads as paragraph text (`interrupts`): the first,
 * and each next one with no blank line before it (it cannot interrupt that text either), unless it is numbered 1; after
 * a blank line, only when the text before ended in indented code. None for a list that starts at 1, or a bullet list.
 */
function lazyItems(list: Tokens.List): number {
  if (!list.ordered || list.start === 1) return 0
  let n = 1
  for (; n < list.items.length; n++) {
    const before = list.items[n - 1]!
    const blank = /\n[ \t]*\n$/.test(before.raw)
    if (blank ? !endsInCode(before) : /^[ \t]*0*1[.)]/.test(list.items[n]!.raw)) break
  }
  return n
}

/**
 * An item the Mac reads as paragraph text ends, for the Mac, in an indented code block: its last lines after a blank
 * line start 4 or more columns in from its marker (in a list item `marked` reads them as the item's own text).
 */
function endsInCode(item: Tokens.ListItem): boolean {
  const lines = item.raw.replace(/\s+$/, '').split('\n')
  let last = lines.length - 1
  while (last > 0 && lines[last - 1]!.trim() !== '') last--
  return last > 0 && indent(lines[last]!) - indent(lines[0]!) >= 4
}

/** The tasks of `text` (a page's body, its properties left out), as the reader draws them. */
export function pageTasks(text: string): PageTask[] {
  const own = withoutBom(text)
  return markTasks(pageMarked.lexer(own), own)
}

/** The text the reader parses: a byte order mark at its start is no text (as the Mac reads it). Its lines stay. */
export const withoutBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
