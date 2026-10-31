/**
 * Folds that an edit opens, and the caret guard (YAZ-3695).
 *
 * THE CARET GUARD (suggestion 11): after a transaction that CHANGES the document, a caret inside a folded bullet's
 * children or a folded heading's section opens the folds that hide it, so the user never types blind: Tab under a
 * folded bullet, Enter at the end of a folded heading. A caret move alone (arrows, a click) opens nothing. A folded
 * ANCESTOR of the zoomed item hides nothing (the zoom shows it expanded), so only folds at or below it count.
 *
 * ⌘Z CLOSES WHAT THE EDIT OPENED (YAZ-3781): fold state lives in the fold plugins, outside history. So an edit that
 * opens folds — the guard, a join (`listCommands.ts`) — also records them as a `FoldStep`: a step that changes no
 * text and maps no position, so history keeps it in the edit's own event. ⌘Z applies its inverse and ⌘⇧Z applies it
 * again; `foldHistory` turns each replayed step into the fold plugins' own silent fold-set metas. History's own
 * depth bounds it, merged events and the redo stack come free, and an edit with no fold to open adds nothing.
 * The stored fold keys keep their format. The step never leaves the editor (no collab), so it has no JSON id.
 */
import { type Mappable, Mapping, StepMap, Step, StepResult } from '@milkdown/kit/prose/transform'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { addHeadingFoldSetMeta, collapsedHeadingsHiding } from './headingFolding'
import { addOutlineFoldSetMeta, collapsedItemsHiding } from './outlineFolding'
import { getZoomedItemPos } from './zoom'

/** Fold positions of one edit: bullet folds (list_item positions) and heading folds (heading positions). */
export interface Folds {
  items: number[]
  headings: number[]
}

/** "These folds open" (or, inverted by ⌘Z, close): no text change, positions mapped like any step's. */
class FoldStep extends Step {
  constructor(
    readonly folds: Folds,
    readonly collapsed: boolean,
  ) {
    super()
  }

  apply(doc: ProseNode): StepResult {
    return StepResult.ok(doc)
  }

  getMap(): StepMap {
    return StepMap.empty
  }

  invert(): FoldStep {
    return new FoldStep(this.folds, !this.collapsed)
  }

  /**
   * A position whose node a change deleted goes, as a ProseMirror step's range does; none left: null (YAZ-3786). "Deleted"
   * is read just INSIDE the node: a change that only rewrites the node's own token (Milkdown's heading-id `setNodeMarkup`)
   * keeps it, a change that removes the node removes the tokens on both sides of that point.
   */
  map(mapping: Mappable): FoldStep | null {
    const map = (positions: number[]) => positions.flatMap((pos) => (mapping.mapResult(pos + 1, 1).deletedAcross ? [] : [mapping.map(pos, 1)]))
    const folds = { items: map(this.folds.items), headings: map(this.folds.headings) }
    return folds.items.length === 0 && folds.headings.length === 0 ? null : new FoldStep(folds, this.collapsed)
  }

  toJSON(): { stepType: string; collapsed: boolean } & Folds {
    return { stepType: 'mdappFold', ...this.folds, collapsed: this.collapsed }
  }
}

/** On an edit that already opened its folds: `foldHistory` leaves its steps alone. */
const appliedKey = new PluginKey('mdapp-fold-reveal-applied')

/**
 * Record, as `tr`'s NEXT step, that the edit opens `folds` (positions in `tr.doc` as it is now), so ⌘Z closes them
 * and ⌘⇧Z opens them again. A fold whose node the edit then removes counts too: ⌘Z brings the node back folded.
 */
export const recordOpenedFolds = (tr: Transaction, folds: Folds): void => {
  if (folds.items.length > 0 || folds.headings.length > 0) tr.step(new FoldStep(folds, false))
}

/** Open `folds` (positions in `tr`'s final document) with the edit itself. */
export const openFolds = (tr: Transaction, folds: Folds): void => {
  addOutlineFoldSetMeta(tr, folds.items, false)
  addHeadingFoldSetMeta(tr, folds.headings, false)
  tr.setMeta(appliedKey, true)
}

/** Replays the fold steps of ⌘Z / ⌘⇧Z (history's own transactions) as folds. Register with `editor.use(foldHistory)`. */
export const foldHistory = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-fold-history'),
      appendTransaction(trs, _old, state) {
        const items: number[] = []
        const headings: number[] = []
        let collapsed = false
        trs.forEach((tr, index) => {
          if (tr.getMeta(appliedKey) === true) return
          tr.steps.forEach((step, at) => {
            if (!(step instanceof FoldStep)) return
            // Each position, mapped through the rest of this transaction and the ones after it.
            const mapping = new Mapping(tr.mapping.maps.slice(at + 1))
            for (const later of trs.slice(index + 1)) mapping.appendMapping(later.mapping)
            // Only a node of the right kind takes the fold: never a bullet or a heading the user did not fold (YAZ-3786).
            const ofKind = (pos: number, kind: string) => (state.doc.nodeAt(pos)?.type.name === kind ? [pos] : [])
            items.push(...step.folds.items.flatMap((pos) => ofKind(mapping.map(pos, 1), 'list_item')))
            headings.push(...step.folds.headings.flatMap((pos) => ofKind(mapping.map(pos, 1), 'heading')))
            collapsed = step.collapsed
          })
        })
        if (items.length === 0 && headings.length === 0) return null
        const tr = state.tr
        addOutlineFoldSetMeta(tr, items, collapsed)
        addHeadingFoldSetMeta(tr, headings, collapsed)
        return tr
      },
    }),
)

/** The caret guard. Register with `editor.use(caretReveal)`, after `foldHistory`, so it sees the folds ⌘Z closed. */
export const caretReveal = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-caret-reveal'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null
        const { head } = state.selection
        const zoomed = getZoomedItemPos(state)
        const folds: Folds = {
          items: collapsedItemsHiding(state, head).filter((itemPos) => zoomed === null || itemPos >= zoomed),
          headings: collapsedHeadingsHiding(state, head),
        }
        if (folds.items.length === 0 && folds.headings.length === 0) return null
        const tr = state.tr
        recordOpenedFolds(tr, folds)
        openFolds(tr, folds)
        return tr
      },
    }),
)
