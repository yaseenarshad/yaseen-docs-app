/**
 * Apply an external/AI edit to the open file as a DIFF, not a rebuild (YAZ-1351).
 *
 * The `setMarkdown` path builds a fresh EditorState, so every collapsed bullet re-opens from a
 * content-hash seed and the caret is re-derived from a raw offset (YAZ-1342's boundary). Here the
 * new body is parsed, structurally diffed (`diffDocs`, YAZ-1350) and dispatched as ONE transaction
 * over the live state — ProseMirror's own position mapping then carries folds, selection and
 * scroll for free, which is the whole point: nothing in this path restores them by hand.
 *
 * Two deliberate escapes back to the rebuild, both returning 'rebuilt':
 *  - the body does not parse — the diff has nothing trustworthy to aim at;
 *  - one range covers ≥ 80% of the document, i.e. a whole-document rewrite. Mapping every fold
 *    onto one collapsed point loses them all, whereas the rebuild's key-based reseed can put back
 *    the folds whose lines survived. A rewrite must never behave worse than v0.9.1.
 * The transaction is also discarded (and rebuilt) if it fails to reproduce the parsed document
 * exactly: the diff is an optimisation, never a source of divergence from the file on disk.
 *
 * `addToHistory: false` keeps the user's own ⌘Z pointing at the user's own last edit; the
 * `external-edit` stamp marks the transaction for plugins that must tell it from typing.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import { getZoomKeyOf, setMarkdown, zoomPageTo } from '../createCrepe'
import { normalizeEmptyItems } from '../listItemRoundTrip'
import { diffDocs, type ReplaceRange } from './diffDocs'

/** Share of the old document one range may cover before the edit counts as a rewrite. */
const REWRITE_SHARE = 0.8

/** Transaction meta stamped on every external apply, for plugins that must tell it from typing. */
export const EXTERNAL_EDIT_META = 'external-edit'

/**
 * Transaction meta: where an outside edit landed (YAZ-3704 D3), as `OutsideRange[]` in the NEW
 * document. The change list reads it; a quiet apply (the user's own typing from a copy of the tab) has none.
 */
export const OUTSIDE_RANGES_META = 'outside-ranges'

/** One range an outside edit replaced: its new content's place in the new doc, and the text it removed. */
export interface OutsideRange {
  from: number
  to: number
  removed: string
}

/**
 * Lands `ranges` on `tr` right-to-left (each position through `map`, old → `tr`'s coordinates) and
 * says where each one's new content ended up in the FINAL doc: the step's own map, then every later step.
 * `old` is the document the ranges' positions are in, for the removed text.
 */
export const replaceTracked = (tr: Transaction, ranges: readonly ReplaceRange[], old: ProseNode, map: (pos: number) => number = (pos) => pos): OutsideRange[] => {
  const placed: { step: number; removed: string }[] = []
  for (const { from, to, slice } of [...ranges].sort((a, b) => b.from - a.from)) {
    const step = tr.steps.length
    tr.replace(map(from), map(to), slice)
    if (tr.steps.length > step) placed.push({ step, removed: old.textBetween(from, to, '\n', ' ') })
  }
  return placed.map(({ step, removed }) => {
    let start = 0
    let end = 0
    tr.steps[step].getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      start = newStart
      end = newEnd
    })
    const later = tr.mapping.slice(step + 1)
    return { from: later.map(start, -1), to: later.map(end, 1), removed }
  })
}

const isEmptyParagraph = (node: ProseNode | null): boolean => node !== null && node.type.name === 'paragraph' && node.content.size === 0

/**
 * Milkdown's trailing plugin keeps an empty paragraph after a document that ends in a list or
 * heading; the parser never emits one. Give the diff target that same tail, or the top-level child
 * counts differ on EVERY edit and each apply deletes a paragraph the plugin re-adds a tick later,
 * nudging a caret parked there. `postProcessMarkdown` strips it on save, so disk never sees it.
 */
export const withTrailingParagraphOf = (live: ProseNode, parsed: ProseNode): ProseNode => {
  const tail = live.lastChild
  if (tail === null || !isEmptyParagraph(tail) || isEmptyParagraph(parsed.lastChild)) return parsed
  return parsed.copy(parsed.content.append(Fragment.from(tail)))
}

/** `quiet`: the user's own typing (a copy of this tab saved), so the change list is not told (YAZ-3704). */
export const applyExternalMarkdown = (crepe: Crepe, body: string, quiet = false): 'applied' | 'rebuilt' => {
  let applied = false
  const zoomKey = getZoomKeyOf(crepe)
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    // Exactly what `setMarkdown` feeds `replaceAll`, so the diff target is byte-for-byte the
    // document the rebuild would have produced.
    const fresh = ctx.get(parserCtx)(normalizeEmptyItems(body))
    if (fresh === null || typeof fresh === 'string') return
    const parsed = withTrailingParagraphOf(view.state.doc, fresh)
    const ranges = diffDocs(view.state.doc, parsed)
    if (ranges.length === 0) {
      applied = true
      return
    }
    const rewriteWidth = view.state.doc.content.size * REWRITE_SHARE
    if (ranges.some(({ from, to }) => to - from >= rewriteWidth)) return
    const tr = view.state.tr
    // Right-to-left: every range is expressed in OLD-document coordinates, so applying the later
    // ones first leaves the earlier ones' positions untouched.
    const landed = replaceTracked(tr, ranges, view.state.doc)
    if (!tr.doc.eq(parsed)) return
    tr.setMeta('addToHistory', false).setMeta(EXTERNAL_EDIT_META, true)
    if (!quiet) tr.setMeta(OUTSIDE_RANGES_META, landed)
    view.dispatch(tr)
    applied = true
  })
  if (applied) return 'applied'
  setMarkdown(crepe, body)
  // A rebuilt state starts zoomed out: the page goes back to its tab's bullet when the rewrite kept it, quietly,
  // before the zoom's settle timer can tell the tab "no zoom" (YAZ-3647 E1). A bullet that is gone stays zoomed out.
  if (zoomKey !== null) zoomPageTo(crepe, zoomKey)
  return 'rebuilt'
}
