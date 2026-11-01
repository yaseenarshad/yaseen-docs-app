/**
 * Merge an outside edit into a note that has unsaved typing (YAZ-3704 D1, D2).
 *
 * Three bodies: the BASE (the body as last saved or read — `useAutosave`'s `diskParts().body`),
 * YOURS (the live doc) and THEIRS (the new file). `diffDocs` gives each side's ranges against the
 * base; theirs are mapped over yours and dispatched as ONE transaction with `addToHistory: false`,
 * the same transaction shape as `applyExternalMarkdown`. prosemirror-history maps the undo items
 * through such a transaction, so ⌘Z keeps undoing your typing and never the outside edit.
 *
 * Three refusals, all 'conflict' (the caller shows the conflict bar, nothing is dispatched):
 *  - a rewrite: one outside range covers `REWRITE_SHARE` of the note — the rule `applyExternalMarkdown`
 *    rebuilds on, so a rewrite never lands as one huge glow with every fold mapped onto one point;
 *  - D2: a range of yours and a range of theirs touch the same block (line, bullet, heading, cell)
 *    — "the AI rewrote the line you are typing in" must never merge silently. An attr change that you
 *    can see (a task ticked, a heading's level) is in its node's first line, as its glow is; one of only
 *    derived attrs (a number, a heading's id) touches no line: the order check below still guards it;
 *  - the two orders disagree: yours mapped over theirs, applied on THEIRS, must give the same doc as
 *    theirs mapped over yours, applied on YOURS. A merge that depends on its order is a guess.
 *
 * No port of prosemirror-collab (D1): every outside edit arrives as a file, so the edit is a diff of
 * two files either way, and the file mtime is the only "version" there is.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Transform } from '@milkdown/kit/prose/transform'
import { normalizeEmptyItems } from '../listItemRoundTrip'
import { EXTERNAL_EDIT_META, firstLineOf, OUTSIDE_RANGES_META, replaceTracked, REWRITE_SHARE, withTrailingParagraphOf } from './applyExternalMarkdown'
import { diffDocs, onlyDerived, type ReplaceRange } from './diffDocs'

/**
 * The span of the textblock a range touches; a range between blocks (a bullet added or removed) stays as it is.
 * An attr range is its node's first line (a ticked task's text, a heading's text).
 */
const blockSpan = (doc: ProseNode, { from, to, attrs }: ReplaceRange): { from: number; to: number } => {
  if (attrs !== undefined) return firstLineOf(doc, from) ?? { from, to }
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return { from: $from.parent.isTextblock ? $from.start() : from, to: $to.parent.isTextblock ? $to.end() : to }
}

/** D2: a range of yours and a range of theirs in ONE block, or touching, is a conflict. */
const touchSameBlock = (base: ProseNode, mine: readonly ReplaceRange[], theirs: readonly ReplaceRange[]): boolean => {
  const theirSpans = theirs.filter((range) => !onlyDerived(range)).map((range) => blockSpan(base, range))
  return mine.some((range) => {
    if (onlyDerived(range)) return false
    const a = blockSpan(base, range)
    return theirSpans.some((b) => a.from <= b.to && b.from <= a.to)
  })
}

/**
 * `quiet` (a copy of this note in another tab saved — the user's own typing) leaves the change list
 * alone, exactly as `applyExternalMarkdown`'s own flag does.
 */
/**
 * 'unchanged': the new file already IS the live note, apart from what the editor works out itself (a
 * heading's id): nothing lands, and the caller has nothing to save either (YAZ-3704 4A).
 */
export const mergeExternalMarkdown = (crepe: Crepe, baseBody: string, diskBody: string, quiet = false): 'merged' | 'unchanged' | 'conflict' => {
  let result: 'merged' | 'unchanged' | 'conflict' = 'conflict'
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parse = ctx.get(parserCtx)
    const base = parse(normalizeEmptyItems(baseBody))
    const fresh = parse(normalizeEmptyItems(diskBody))
    if (base === null || typeof base === 'string' || fresh === null || typeof fresh === 'string') return
    const live = view.state.doc
    const theirsDoc = withTrailingParagraphOf(live, fresh)
    if (diffDocs(live, theirsDoc).every(onlyDerived)) {
      result = 'unchanged' // both sides made the same note
      return
    }
    const baseDoc = withTrailingParagraphOf(live, base)
    const mine = diffDocs(baseDoc, live)
    const theirs = diffDocs(baseDoc, theirsDoc)
    const rewriteWidth = baseDoc.content.size * REWRITE_SHARE
    if (theirs.some(({ from, to }) => to - from >= rewriteWidth)) return
    if (touchSameBlock(baseDoc, mine, theirs)) return
    const onBase = (ranges: readonly ReplaceRange[]): Transform => {
      const tr = new Transform(baseDoc)
      replaceTracked(tr, ranges, baseDoc)
      return tr
    }
    const toLive = onBase(mine).mapping
    const toTheirs = onBase(theirs).mapping
    const tr = view.state.tr
    const landed = replaceTracked(tr, theirs, baseDoc, (pos) => toLive.map(pos))
    // The other order: yours over theirs, on THEIRS. A merge that depends on its order is a guess.
    const other = new Transform(theirsDoc)
    replaceTracked(other, mine, baseDoc, (pos) => toTheirs.map(pos))
    if (!tr.doc.eq(other.doc)) return
    tr.setMeta('addToHistory', false).setMeta(EXTERNAL_EDIT_META, true)
    if (!quiet) tr.setMeta(OUTSIDE_RANGES_META, landed)
    view.dispatch(tr)
    result = 'merged'
  })
  return result
}
