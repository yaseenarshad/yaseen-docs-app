/**
 * Backlinks — "Linked mentions" (Links D, GRO-2193; decision D of GRO-2096, LOCKED): the notes
 * and folders that link to the open page, computed CLIENT-SIDE in ONE pass over the index snapshot this
 * window already holds, through THE shared resolver (`views/engine.ts` `resolverFor`, the one
 * behind views, wikilink decorations and clicks). No reverse map in the main process, no
 * new IPC, no new index field — and alias-awareness comes free: a note linking `[[CAC]]` IS a
 * linked mention of the page whose frontmatter aliases it (E2, GRO-2214).
 *
 * A mention is a `links` OR an `embeds` entry that resolves to the open path — an `![[embed]]`
 * mentions its target exactly like a `[[link]]` does (locked). The open page never lists itself.
 * One entry per referencing NOTE (however many mentions it holds), path-sorted, so the section
 * renders the same order for the same snapshot.
 *
 * A FOLDER's page mentions what its settings record links by the rename engine's rule
 * (`referenceTargets`: the links of its Page, the `.folder.md` body, as a note's (YAZ-4584 D40); its
 * own link properties, a view's `order` entry, a link column's `target`). Its entry is that record,
 * sorted by its path.
 *
 * Context snippets are read ON DEMAND (`fs:read` per shown entry, `mentionSnippets` below) —
 * the index stores no positions, and nothing is read until the section is expanded. A folder's
 * come from its Page, the body of its `.folder.md` (`BacklinksSection`).
 */
import { isViewOnly } from '@shared/fileKind'
import type { IndexRecord } from '@shared/types'
import { WIKILINK_RE, idLinkTitle, linkDisplayText, linkPageName, type ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import type { PathTitles } from '../lib/pageLabel'
import { maskCode } from '@shared/linkRewrite'
import { mentionsOf } from '@shared/mentions'

/**
 * The reverse map per RESOLVER identity (YAZ-4738 L5) — `resolverFor`'s WeakMap idiom. ONE pass over the snapshot's
 * links builds it (`mentionsOf`); every mounted tab's section and every Linked mentions column of the snapshot read it,
 * so a table of 4,000 rows costs that one pass, never one per row. A refetched index swaps in a NEW resolver and
 * rebuilds (that IS the live update), and dropped snapshots are collectable. The window's source holds ONE resolver per
 * snapshot — and per folder list (YAZ-2290 D10), which the records alone cannot tell apart — so its identity is the
 * whole key.
 */
const mentionsCache = new WeakMap<ResolveLink, ReadonlyMap<string, readonly IndexRecord[]>>()

/** Path → the notes and folders (as their settings records) that mention it in this snapshot: path-sorted, self excluded, embeds included. */
export function mentionsMap(records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink): ReadonlyMap<string, readonly IndexRecord[]> {
  let map = mentionsCache.get(resolve)
  if (map === undefined) mentionsCache.set(resolve, (map = mentionsOf(records, folders, resolve)))
  return map
}

const NONE: readonly IndexRecord[] = []

/** The notes — and the folders, as their settings records (`folders`) — mentioning `path` in this snapshot: path-sorted, self excluded, embeds included. */
export function backlinksFor(path: string, records: readonly IndexRecord[], resolve: ResolveLink, folders: readonly IndexRecord[]): readonly IndexRecord[] {
  return mentionsMap(records, folders, resolve).get(path) ?? NONE
}

// ---------- context snippets ----------

/** Longest snippet text before windowing; the ellipses ride on top. */
export const SNIPPET_MAX_CHARS = 120

/** Snippet LINES shown per referencing note (FN10: one snippet per line, however many mentions it holds). */
export const MAX_SNIPPETS = 5

const ELLIPSIS = '…'

/** Offsets INSIDE a snippet's `text` of one mention of the target — always a whole highlight run. */
export interface MentionRange {
  from: number
  to: number
}

export interface MentionSnippet {
  /**
   * The mention's line AS THE EDITOR SHOWS IT — every wikilink on it replaced by its display
   * text (`linkDisplayText`; an id link by its note's title, YAZ-2293; embeds and empty-display
   * forms stay raw, exactly the decorations' rule) — whitespace-trimmed and windowed to
   * ~`SNIPPET_MAX_CHARS` around the first mention (FN9, GRO-2197).
   */
  text: string
  /**
   * EVERY mention of the target on this line, ascending and non-overlapping (FN10, GRO-2197).
   * Never empty; a range the window cut off is dropped, the first one never is.
   */
  ranges: MentionRange[]
  /** The label of the cell note (YAZ-3818) the line is in, `cell-N`, or absent: a click opens that note's card. */
  cellNote?: string
}

/** A cell note's first line (YAZ-3818 D4): `[^cell-N]: …`. */
const CELL_NOTE_LINE = /^\[\^(cell-\d+)\]:/

/**
 * The cell note that the line at `lineStart` of `content` is in, or null (YAZ-3818): its own `[^cell-N]:` line, or an
 * indented or empty line under one (a footnote's next lines are indented).
 */
function cellNoteOfLine(content: string, lineStart: number): string | null {
  let start = lineStart
  for (;;) {
    const end = content.indexOf('\n', start)
    const line = content.slice(start, end === -1 ? content.length : end)
    const label = CELL_NOTE_LINE.exec(line)?.[1]
    if (label !== undefined) return label
    if (start === 0 || !(line.trim() === '' || /^( {4}|\t)/.test(line))) return null
    start = content.lastIndexOf('\n', start - 2) + 1
  }
}

/** The syntax of a cell's list and of a cell note (YAZ-3818 D2, D4), each form exactly as the app writes it. */
const CELL_SYNTAX = /\[\^cell-\d+\]: ?|\[\^cell-\d+\]|<ol(?: start="(\d+)")?>|<\/?ul>|<\/ol>|<li>(\[[ x]\] )?|<\/li>/g

/**
 * A snippet line with the syntax the cell notes brought (YAZ-3818) read as text, its mention ranges moved with it: a
 * cell's HTML list as "• " items ("1. " in a numbered one, "☐ " / "☑ " for a to-do) joined by a space, a cell note's
 * first line `[^cell-N]: …` as "Cell note: …", and a mark `[^cell-N]` gone. Any other HTML or footnote stays.
 */
export function cellSyntaxAsText(text: string, ranges: readonly MentionRange[]): { text: string; ranges: MentionRange[] } {
  let out = ''
  let cursor = 0
  /** Where each kept stretch of `text` starts: in `text`, and in `out`. */
  const stretches: Array<{ from: number; to: number }> = []
  const lists: Array<number | null> = []
  for (const m of text.matchAll(CELL_SYNTAX)) {
    const token = m[0]
    const at = m.index
    stretches.push({ from: cursor, to: out.length })
    out += text.slice(cursor, at)
    cursor = at + token.length
    let shown = ''
    if (token.startsWith('[^')) shown = token.includes(':') && text.slice(0, at).trim() === '' ? 'Cell note: ' : ''
    else if (token.startsWith('<ol')) lists.push(m[1] === undefined ? 1 : Number(m[1]))
    else if (token === '<ul>') lists.push(null)
    else if (token === '</ul>' || token === '</ol>') lists.pop()
    else if (token.startsWith('<li>')) {
      const top = lists.length === 0 ? null : lists[lists.length - 1]!
      const marker = m[2] === '[x] ' ? '☑ ' : m[2] === '[ ] ' ? '☐ ' : top === null ? '• ' : `${top}. `
      if (top !== null) lists[lists.length - 1] = top + 1
      shown = (out === '' || /\s$/.test(out) ? '' : ' ') + marker
    }
    out += shown
  }
  stretches.push({ from: cursor, to: out.length })
  out += text.slice(cursor)
  // A mention is never inside a token: it moves with the stretch it is in.
  const map = (pos: number): number => {
    let k = stretches.length - 1
    while (k > 0 && stretches[k]!.from > pos) k--
    return stretches[k]!.to + pos - stretches[k]!.from
  }
  return { text: out, ranges: ranges.map(({ from, to }) => ({ from: map(from), to: map(to) })) }
}

/**
 * One snippet for the line owning the matches `line[first..]` (content coords) of `matches`,
 * anchored on `matches[first]` — the first TARGET mention on the line. Builds the display line
 * (every match replaced per `linkDisplayText`, with `titleOf` naming the note an id link points
 * at), records the [from, to) of each target mention, then trims and windows centred on the
 * first of them. Returns the content offset the line ends at, so the caller can skip the matches
 * this snippet consumed.
 */
function lineSnippet(
  content: string,
  matches: readonly RegExpExecArray[],
  first: number,
  isMention: (m: RegExpExecArray) => boolean,
  titleOf: (target: string) => string | undefined,
  named: (page: string) => boolean,
  resolve?: ResolveLink,
): { snippet: MentionSnippet; lineEnd: number } {
  const endOfLine = (pos: number): number => {
    const nl = content.indexOf('\n', pos)
    return nl === -1 ? content.length : nl
  }
  const anchor = matches[first]
  const lineStart = content.lastIndexOf('\n', anchor.index - 1) + 1
  // Back up to the first match STARTING on this line — earlier, non-target links on the same
  // line still get their display replacement (FN9: unrelated links never show brackets either).
  let from = first
  while (from > 0 && matches[from - 1].index >= lineStart) from--
  // A target may span a line break (`[^[\]]+` allows one): a match reaching past the newline
  // extends the line, exactly as the old per-match windowing read it.
  let lineEnd = endOfLine(anchor.index + anchor[0].length)
  let text = ''
  const ranges: MentionRange[] = []
  let cursor = lineStart
  for (let k = from; k < matches.length && matches[k].index < lineEnd; k++) {
    const m = matches[k]
    const matchEnd = m.index + m[0].length
    if (matchEnd > lineEnd) lineEnd = endOfLine(matchEnd)
    text += content.slice(cursor, m.index)
    // Embeds are undecorated in the editor and empty-display forms stay raw (FN12): both keep
    // their raw text here too — the snippet reads exactly like the document.
    const display = m[1] === '!' ? '' : linkDisplayText(m[2], titleOf, named, resolve === undefined ? undefined : { resolve })
    const shown = display === '' ? m[0] : display
    if (isMention(m)) ranges.push({ from: text.length, to: text.length + shown.length })
    text += shown
    cursor = matchEnd
  }
  text += content.slice(cursor, lineEnd)
  // The cell notes' syntax as text (YAZ-3818), before the window is cut.
  const cell = cellSyntaxAsText(text, ranges)
  text = cell.text
  ranges.splice(0, ranges.length, ...cell.ranges)
  const cellNote = cellNoteOfLine(content, lineStart)
  // Trim surrounding whitespace, never into a mention (a mention is never trimmed away).
  const matchFrom = ranges[0].from
  const matchTo = ranges[0].to
  const lastTo = ranges[ranges.length - 1].to
  let start = 0
  let end = text.length
  while (start < matchFrom && /\s/.test(text[start])) start++
  while (end > lastTo && /\s/.test(text[end - 1])) end--
  // Long line: a window centred on the FIRST mention, always containing it whole.
  const slack = Math.max(0, SNIPPET_MAX_CHARS - (matchTo - matchFrom))
  const windowStart = end - start > SNIPPET_MAX_CHARS ? Math.max(start, matchFrom - Math.floor(slack / 2)) : start
  const windowEnd = Math.min(end, Math.max(matchTo, windowStart + SNIPPET_MAX_CHARS))
  const head = windowStart > start ? ELLIPSIS : ''
  const shift = head.length - windowStart
  return {
    snippet: {
      // Newlines (a target spanning a line break) read as spaces, offsets intact.
      text: head + text.slice(windowStart, windowEnd).replace(/[\r\n]/g, ' ') + (windowEnd < end ? ELLIPSIS : ''),
      // Every range shifted into window coords; one the window cut off is dropped (the first
      // never can be — the window always contains it whole).
      ranges: ranges.filter((r) => r.from >= windowStart && r.to <= windowEnd).map((r) => ({ from: r.from + shift, to: r.to + shift })),
      ...(cellNote === null ? {} : { cellNote }),
    },
    lineEnd,
  }
}

/**
 * The mention lines of one referencing note's raw file content: every line holding a `[[link]]`
 * / `![[embed]]` whose page name resolves to `target`, in document order, at most `limit` LINES —
 * one snippet per line with every mention on it highlighted (FN10, GRO-2197). Code is skipped
 * through the rename engine's length-preserving `maskCode` — the same fence/inline-span
 * discipline the index's link extraction uses, so a snippet can only highlight a link the index
 * actually counted. Frontmatter is scanned like any other line (the index reads links there too).
 * `titles` names the note an id link points at (`idLinkTitle`).
 */
export function mentionSnippets(content: string, target: string, resolve: ResolveLink, titles: PathTitles, limit = MAX_SNIPPETS): MentionSnippet[] {
  const masked = maskCode(content)
  const matches = [...masked.matchAll(WIKILINK_RE)]
  const isMention = (m: RegExpExecArray): boolean => {
    // The left side is the page when it resolves (YAZ-4935 round 2: `[[Covid notes|COVID-19]]`).
    const page = linkPageName(m[2], { resolve })
    return page !== '' && resolve(page) === target // '' = the same-file `[[#heading]]` form
  }
  // A found page reads by its name (YAZ-3778 D2, D3). Not `linkIsResolved`: no view-only resolver reaches here, so a gone `[[x.drawio]]` reads "x".
  const named = (page: string) => resolve(page) !== null || isViewOnly(page)
  const out: MentionSnippet[] = []
  for (let i = 0; i < matches.length && out.length < limit; i++) {
    if (!isMention(matches[i])) continue
    const { snippet, lineEnd } = lineSnippet(content, matches, i, isMention, (page) => idLinkTitle(page, resolve, titles), named, resolve)
    out.push(snippet)
    while (i + 1 < matches.length && matches[i + 1].index < lineEnd) i++ // this line is spoken for
  }
  return out
}
