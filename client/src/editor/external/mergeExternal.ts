/**
 * Merge an outside edit into a note that has unsaved typing (YAZ-3704 D1, D2).
 *
 * Three bodies: the BASE (the body as last saved or read — `useAutosave`'s `diskParts().body`),
 * YOURS (the live doc) and THEIRS (the new file). `diffDocs` gives each side's ranges against the
 * base; theirs are mapped over yours and dispatched as ONE transaction with `addToHistory: false`,
 * the same transaction shape as `applyExternalMarkdown`. prosemirror-history maps the undo items
 * through such a transaction, so ⌘Z keeps undoing your typing and never the outside edit.
 *
 * Two refusals, both 'conflict' (the caller shows the conflict bar, nothing is dispatched):
 *  - D2: a range of yours and a range of theirs touch the same block (line, bullet, heading, cell)
 *    — "the AI rewrote the line you are typing in" must never merge silently;
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
import { EXTERNAL_EDIT_META, OUTSIDE_RANGES_META, replaceTracked, withTrailingParagraphOf } from './applyExternalMarkdown'
import { diffDocs, type ReplaceRange } from './diffDocs'

/** Applies `ranges` right-to-left, each position first passed through `map` (old-document → target coordinates). */
const applyRanges = (tr: Transform, ranges: readonly ReplaceRange[], map: (pos: number) => number = (pos) => pos): Transform => {
  for (const { from, to, slice } of [...ranges].sort((a, b) => b.from - a.from)) tr.replace(map(from), map(to), slice)
  return tr
}

/** The span of the textblock a range touches; a range between blocks (a bullet added or removed) stays as it is. */
const blockSpan = (doc: ProseNode, { from, to }: ReplaceRange): { from: number; to: number } => {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return { from: $from.parent.isTextblock ? $from.start() : from, to: $to.parent.isTextblock ? $to.end() : to }
}

/** D2: a range of yours and a range of theirs in ONE block, or touching, is a conflict. */
const touchSameBlock = (base: ProseNode, mine: readonly ReplaceRange[], theirs: readonly ReplaceRange[]): boolean => {
  const theirSpans = theirs.map((range) => blockSpan(base, range))
  return mine.some((range) => {
    const a = blockSpan(base, range)
    return theirSpans.some((b) => a.from <= b.to && b.from <= a.to)
  })
}

/**
 * `quiet` (a copy of this note in another tab saved — the user's own typing) leaves the change list
 * alone, exactly as `applyExternalMarkdown`'s own flag does.
 */
export const mergeExternalMarkdown = (crepe: Crepe, baseBody: string, diskBody: string, quiet = false): 'merged' | 'conflict' => {
  let result: 'merged' | 'conflict' = 'conflict'
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parse = ctx.get(parserCtx)
    const base = parse(normalizeEmptyItems(baseBody))
    const fresh = parse(normalizeEmptyItems(diskBody))
    if (base === null || typeof base === 'string' || fresh === null || typeof fresh === 'string') return
    const live = view.state.doc
    const theirsDoc = withTrailingParagraphOf(live, fresh)
    if (live.eq(theirsDoc)) {
      result = 'merged' // both sides made the same note: nothing to land
      return
    }
    const baseDoc = withTrailingParagraphOf(live, base)
    const mine = diffDocs(baseDoc, live)
    const theirs = diffDocs(baseDoc, theirsDoc)
    if (touchSameBlock(baseDoc, mine, theirs)) return
    const toLive = applyRanges(new Transform(baseDoc), mine).mapping
    const toTheirs = applyRanges(new Transform(baseDoc), theirs).mapping
    const tr = view.state.tr
    const landed = replaceTracked(tr, theirs, baseDoc, (pos) => toLive.map(pos))
    if (!tr.doc.eq(applyRanges(new Transform(theirsDoc), mine, (pos) => toTheirs.map(pos)).doc)) return
    tr.setMeta('addToHistory', false).setMeta(EXTERNAL_EDIT_META, true)
    if (!quiet) tr.setMeta(OUTSIDE_RANGES_META, landed)
    view.dispatch(tr)
    result = 'merged'
  })
  return result
}
