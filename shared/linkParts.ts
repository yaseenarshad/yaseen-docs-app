/**
 * THE ONE SPLIT OF A LINK'S TEXT (YAZ-4935): `[[A|B]]` → the page and the words. Mochi writes the words first
 * (`[[staging|WIKI-116]]`); this app and Obsidian write the page first (`[[WIKI-116|staging]]`). A link READS in both
 * orders: when exactly ONE side is a note ID by its shape (`isNoteId`: a number ID or an old 12-character ID), that side
 * is the page; otherwise (two plain words, two IDs) the LEFT side is the page, as it always was. A `#heading` / `#^block`
 * goes with the page side (`[[staging|WIKI-116#Intro]]`). An empty side is no ID: `[[|WIKI-116]]` is the page WIKI-116
 * with no words. The app still WRITES the page first (the picker, a pasted path, a table cell); only reading is both ways.
 *
 * Words can LOOK like an ID (`[[Covid notes|COVID-19]]`). A reader that knows the vault's notes passes `isPage`: when
 * the left side names a found page, the left side wins; the right side is the page only when the left does not resolve
 * (YAZ-4935, round 2). `isPage` is asked only when the shape alone would pick the right side. Without it, the shape decides.
 *
 * A reader that knows NO notes (the index scan, the views' `fromYaml`) cannot pick for such a link, so it keeps both
 * sides (`indexTarget`: `Covid notes|COVID-19`), and the resolver picks by the rule when it reads them (`pickTarget` in
 * `linkResolver.ts`, YAZ-4954). Linked mentions, the views and the editor then agree.
 *
 * Every reader of a `[[…]]` splits here: the index (`vaultIndex/scan.ts`), the rename rewrite (`linkRewrite.ts`), the
 * resolver's key (`linkResolver.ts`), and the editor's pill, menu, read-only links and picker (`client/src/editor/wikilink/`).
 * An embed's options (`embedOptions.ts`, `![[x.drawio|640x360 view=…]]`) never look like an ID, so an embed reads as before.
 */
import { isNoteId } from './noteId'

export interface LinkParts {
  /** The page the link names: its side without `#…`, trimmed. '' for the same-file `[[#h]]` and for `[[|x]]`. */
  page: string
  /** The `#heading` / `#^block` text of the page side with its `#`, as written; '' when none. */
  hash: string
  /** The page side as written: `page`, `#…` and any spaces around them. */
  head: string
  /** The words on the other side of the `|`, as written; null when the link has no `|`. */
  words: string | null
  /** Where the `|` stands in the text; -1 when none. */
  pipe: number
  /** The page is the left side: always without a `|`, and with one unless only the right side is an ID. */
  pageFirst: boolean
}

const sideOf = (text: string): { page: string; hash: string } => {
  const hash = text.indexOf('#')
  return hash < 0 ? { page: text.trim(), hash: '' } : { page: text.slice(0, hash).trim(), hash: text.slice(hash) }
}

/** The parts of the text inside `[[…]]`. One `indexOf`, and the ID test on each side only when there is a `|`. */
export function splitLink(inner: string, isPage?: (page: string) => boolean): LinkParts {
  const pipe = inner.indexOf('|')
  if (pipe < 0) return { ...sideOf(inner), head: inner, words: null, pipe, pageFirst: true }
  const left = inner.slice(0, pipe)
  const right = inner.slice(pipe + 1)
  const l = sideOf(left)
  const r = sideOf(right)
  const pageFirst = isNoteId(l.page) || !isNoteId(r.page) || (isPage !== undefined && l.page !== '' && isPage(l.page))
  return pageFirst ? { ...l, head: left, words: right, pipe, pageFirst } : { ...r, head: right, words: left, pipe, pageFirst }
}

/**
 * Only the shape picked the right side, and the left side names a page too (`Covid notes|COVID-19`): which side is the
 * page depends on the vault's notes (YAZ-4954). For parts split without `isPage`. False when the left side is empty or
 * an ID, or the shape kept the left side.
 */
export const undecided = (parts: LinkParts): boolean => !parts.pageFirst && parts.words !== null && sideOf(parts.words).page !== ''

/**
 * The target the index keeps for the text inside `[[…]]` (YAZ-4954): the page, without its `#…`. When the link is
 * `undecided`, BOTH page sides as `left|right` (`Covid notes|COVID-19`): the scan knows no notes, so the resolver picks
 * when it reads the target. `splitLink` reads that pair as it reads the link, so every reader of the pair agrees.
 */
export function indexTarget(inner: string): string {
  const parts = splitLink(inner)
  return undecided(parts) ? `${sideOf(parts.words ?? '').page}|${parts.page}` : parts.page
}
