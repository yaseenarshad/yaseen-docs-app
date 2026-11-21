import { COMMENTS_KEY, addComment, commentsShape, rawComments } from '@shared/comments'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

/**
 * THE PHONE'S ONE WRITE TO A PAGE: it adds one top-level comment to the page's `comments` list, and changes no
 * other byte of the page.
 *
 * The comment itself is the Mac's: `addComment` (`shared/comments.ts`), the same pure code that the
 * Mac's comment block and the `yaseendocs comment --by` command write through `transformFile`. It numbers the comment
 * (one past the highest top-level number), gives a hand-written entry its id and number (D10), keeps unknown keys on
 * every entry, and refuses a `comments` value that is not a comment list (`foreign`) or a block that does not parse
 * (`invalid`).
 *
 * The phone then SPLICES: the Mac's writer lays the whole properties block out again (`yaml`'s Document: `title:   A`
 * becomes `title: A`, `[a,b]` becomes `[a, b]`). The Mac owns the page; the phone must not touch what it did not change.
 * So the phone takes only the `comments` entry (key and value) from the Mac's result and puts it in place of the page's
 * own `comments` entry, or, when the page has none, as the last entry of the block. Every other byte (the body, the
 * other keys, their order, their quoting and spacing, comments in the YAML, the fences, the line ends) stays. A page
 * with no block gets the Mac's new block, with the page's own line ends.
 *
 * YAZ-5522 N4: and within the `comments` list, only the comment that changed. The Mac's writer lays every comment out
 * again (a one-line `- {id: …, body: …}` becomes six lines), which made noisy diffs on the Mac. So when the page's list
 * is a block list, the phone keeps each entry the Mac's writer left with the same value byte for byte, takes the Mac's
 * lines only for an entry it changed (the new comment; a hand-written one the Mac numbers, D10), and adds a new entry
 * after the last one in the page's own indent. Anything else (a flow list `[…]`, an indent it cannot keep) takes the
 * whole entry from the Mac's writer, as before; both ways go through the same read-back check.
 *
 * A layout the splice cannot hold (a flow-style block `{a: 1}`, a block indented as a whole) is refused, and the
 * result is checked before it is used: it must read back with exactly the Mac's comment list and exactly the page's
 * other properties and body. Pure: no React, no store, no network.
 */

export interface NewComment {
  /** Given ONCE, before the first try (`newCommentId`): a retry that finds it on the page adds nothing (idempotent). */
  id: string
  /** ISO UTC, seconds (`nowIso`): when the person wrote it. */
  at: string
  /** The writer's handle. */
  by?: string
  body: string
}

export type RefusedWhy = 'foreign' | 'invalid' | 'layout'

export type ApplyResult =
  | { kind: 'added'; content: string }
  /** The page already holds this comment (an earlier try reached GitHub): nothing to write. */
  | { kind: 'already' }
  | { kind: 'refused'; why: RefusedWhy }

/** The plain words of a refusal: what the person reads on the page. Nothing was written. */
export const REFUSED_WORDS: Record<RefusedWhy, string> = {
  foreign: 'This page uses "comments" for something else, so the phone did not add your comment. Nothing was changed.',
  invalid: "This page's properties do not read correctly, so the phone did not add your comment. Fix them on the Mac. Nothing was changed.",
  layout: "The phone can't add a comment to this page's properties without changing them. Comment on the Mac. Nothing was changed.",
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Whether the page holds the comment `id` already (any entry with that id). */
export const holdsComment = (content: string, id: string): boolean => rawComments(content).some((e) => isRecord(e) && e.id === id)

/** `content` with `comment` added as the last top-level comment, or why not. */
export function applyComment(content: string, comment: NewComment): ApplyResult {
  const shape = commentsShape(content)
  if (shape === 'foreign' || shape === 'invalid') return { kind: 'refused', why: shape }
  if (holdsComment(content, comment.id)) return { kind: 'already' }
  let mac: string
  try {
    mac = addComment(content, comment.body, { id: comment.id, at: comment.at, ...(comment.by === undefined ? {} : { by: comment.by }) })
  } catch {
    // The Mac's writer refused the block (it is not a map, or not valid YAML).
    return { kind: 'refused', why: 'invalid' }
  }
  const spliced = spliceComments(content, mac)
  return spliced === null ? { kind: 'refused', why: 'layout' } : { kind: 'added', content: spliced }
}

/** The first fence line; a byte order mark before it is the block's (as `splitFrontmatter` reads it). */
const OPEN_FENCE_RE = /^\uFEFF?---[ \t]*\r?\n/

/** The body as the page reads without a block: a BOM is no body text (it goes in front of a new block). */
const bodyOf = (text: string): string => {
  const { frontmatter, body } = splitFrontmatter(text)
  return frontmatter === '' ? body.replace(/^\uFEFF/, '') : body
}

/** Where the `comments` entry sits in a block's interior: [start, end) from its key to its value's end; null: no such key. */
function commentsEntry(interior: string): { start: number; end: number } | null | 'unsure' {
  const doc = parseDocument(interior)
  if (doc.errors.length > 0) return 'unsure'
  if (doc.contents === null) return null
  if (!isMap(doc.contents) || doc.contents.flow === true) return 'unsure'
  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? pair.key : null
    if (key?.value !== COMMENTS_KEY || key.range == null) continue
    const value = pair.value as { range?: [number, number, number] } | null
    let end = value?.range?.[1] ?? key.range[1]
    // The line end after the value stays the page's own.
    while (end > key.range[0] && (interior[end - 1] === '\n' || interior[end - 1] === '\r')) end--
    return { start: key.range[0], end }
  }
  return null
}

/** A block's interior (between the fence lines) and where it starts and ends in the block. */
function blockOf(frontmatter: string): { open: number; close: number; interior: string } {
  const open = OPEN_FENCE_RE.exec(frontmatter)?.[0].length ?? 0
  // The closing fence is the block's last line.
  const close = Math.max(open, frontmatter.replace(/\r?\n$/, '').lastIndexOf('\n') + 1)
  return { open, close, interior: frontmatter.slice(open, close) }
}

/** The page's line end: CRLF when its lines end so. */
const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/** `before` with only its `comments` entry taken from `mac` (the Mac's writer's result of the same page), or null. */
export function spliceComments(before: string, mac: string): string | null {
  const b = splitFrontmatter(before)
  const m = splitFrontmatter(mac)
  if (m.body !== bodyOf(before) || m.frontmatter === '') return null
  let out: string
  if (b.frontmatter === '') {
    // A new block, as the Mac writes it (after a BOM), in the page's own line ends.
    out = eolOf(b.body) === '\r\n' ? `${m.frontmatter.replace(/\r?\n/g, '\r\n')}${m.body}` : mac
  } else {
    const macBlock = blockOf(m.frontmatter)
    const macAt = commentsEntry(macBlock.interior)
    if (macAt === null || macAt === 'unsure') return null
    const eol = eolOf(b.frontmatter)
    const entry = macBlock.interior.slice(macAt.start, macAt.end).replace(/\r\n/g, '\n').replace(/\n/g, eol)
    const { open, close, interior } = blockOf(b.frontmatter)
    const at = commentsEntry(interior)
    if (at === 'unsure') return null
    if (at === null) {
      // No `comments` key: the entry goes last, on the line before the closing fence.
      out = `${before.slice(0, close)}${entry}${eol}${before.slice(close)}`
    } else {
      // The key starts a line (a top-level key of a block map); anything else is a layout the splice does not hold.
      if (at.start > 0 && interior[at.start - 1] !== '\n') return null
      const items = spliceItems(interior, before, macBlock.interior, mac, eol)
      if (items !== null) {
        const fine = `${before.slice(0, open)}${items}${before.slice(close)}`
        if (sameButComments(before, fine, mac)) return fine
      }
      out = `${before.slice(0, open + at.start)}${entry}${before.slice(open + at.end)}`
    }
  }
  return sameButComments(before, out, mac) ? out : null
}

/** The `comments` list's entries in a block's interior: each one's text range [start, end), without its `- `; null: not a block list. */
function commentsItems(interior: string): { start: number; end: number }[] | null {
  const doc = parseDocument(interior)
  if (doc.errors.length > 0 || !isMap(doc.contents)) return null
  const pair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === COMMENTS_KEY)
  const seq = pair?.value
  if (!isSeq(seq) || seq.flow === true) return null
  const out: { start: number; end: number }[] = []
  for (const item of seq.items) {
    const range = (item as { range?: [number, number, number] } | null)?.range
    if (range == null) return null
    let end = range[1]
    while (end > range[0] && /[\r\n \t]/.test(interior[end - 1]!)) end--
    out.push({ start: range[0], end })
  }
  return out
}

/** The column of `offset` in `text`. */
const columnOf = (text: string, offset: number): number => offset - (text.lastIndexOf('\n', offset - 1) + 1)

/** `text` (one entry, its first line after its `- `) moved from column `from` to column `to`; null: a line too far left. */
function reindent(text: string, from: number, to: number, eol: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const moved: string[] = [lines[0]!]
  for (const line of lines.slice(1)) {
    if (line.trim() === '') moved.push('')
    else if (to >= from) moved.push(' '.repeat(to - from) + line)
    else if (line.slice(0, from - to).trim() === '') moved.push(line.slice(from - to))
    else return null
  }
  return moved.join(eol)
}

/**
 * YAZ-5522 N4: the page's block interior with only the changed entries of its `comments` list in the Mac's bytes (and
 * the Mac's new entries after its last one); every other entry byte for byte. Null: the splice cannot hold it.
 */
function spliceItems(interior: string, before: string, macInterior: string, mac: string, eol: string): string | null {
  const was = commentsItems(interior)
  const now = commentsItems(macInterior)
  const wasList = rawComments(before)
  const nowList = rawComments(mac)
  if (was === null || now === null || was.length === 0 || was.length !== wasList.length || now.length !== nowList.length || now.length < was.length) return null
  const col = columnOf(interior, was[was.length - 1]!.start)
  const lineStart = was[was.length - 1]!.start - col
  const dash = interior.slice(lineStart, lineStart + col).lastIndexOf('-')
  if (dash === -1) return null
  const macText = (i: number): string | null => reindent(macInterior.slice(now[i]!.start, now[i]!.end), columnOf(macInterior, now[i]!.start), col, eol)
  const added: string[] = []
  for (let i = was.length; i < now.length; i++) {
    const text = macText(i)
    if (text === null) return null
    added.push(`${eol}${' '.repeat(dash)}-${' '.repeat(col - dash - 1)}${text}`)
  }
  let out = `${interior.slice(0, was[was.length - 1]!.end)}${added.join('')}${interior.slice(was[was.length - 1]!.end)}`
  // From the last entry back, so each range still points at the page's own bytes.
  for (let i = was.length - 1; i >= 0; i--) {
    if (JSON.stringify(wasList[i]) === JSON.stringify(nowList[i])) continue
    const text = macText(i)
    if (text === null) return null
    out = `${out.slice(0, was[i]!.start)}${text}${out.slice(was[i]!.end)}`
  }
  return out
}

/** The check: `out` reads back with the Mac's comment list, and with the page's own body and other properties. */
function sameButComments(before: string, out: string, mac: string): boolean {
  if (bodyOf(out) !== bodyOf(before)) return false
  if (commentsShape(out) !== 'list') return false
  if (JSON.stringify(rawComments(out)) !== JSON.stringify(rawComments(mac))) return false
  const rest = (text: string) => {
    const { properties, error } = parseFrontmatter(splitFrontmatter(text).frontmatter)
    const { [COMMENTS_KEY]: _comments, ...others } = properties
    return error === undefined ? JSON.stringify(others) : null
  }
  const was = rest(before)
  return was !== null && was === rest(out)
}
