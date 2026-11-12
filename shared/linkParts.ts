/**
 * THE ONE SPLIT OF A LINK'S TEXT (YAZ-4935): `[[A|B]]` → the page and the words. Mochi writes the words first
 * (`[[staging|WIKI-116]]`); this app and Obsidian write the page first (`[[WIKI-116|staging]]`). A link READS in both
 * orders: when exactly ONE side is a note ID by its shape (`isNoteId`: a number ID or an old 12-character ID), that side
 * is the page; otherwise (two plain words, two IDs) the LEFT side is the page, as it always was. A `#heading` / `#^block`
 * goes with the page side (`[[staging|WIKI-116#Intro]]`). An empty side is no ID: `[[|WIKI-116]]` is the page WIKI-116
 * with no words. The app still WRITES the page first (the picker, a pasted path, a table cell); only reading is both ways.
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
export function splitLink(inner: string): LinkParts {
  const pipe = inner.indexOf('|')
  if (pipe < 0) return { ...sideOf(inner), head: inner, words: null, pipe, pageFirst: true }
  const left = inner.slice(0, pipe)
  const right = inner.slice(pipe + 1)
  const l = sideOf(left)
  const r = sideOf(right)
  const pageFirst = isNoteId(l.page) || !isNoteId(r.page)
  return pageFirst ? { ...l, head: left, words: right, pipe, pageFirst } : { ...r, head: right, words: left, pipe, pageFirst }
}
