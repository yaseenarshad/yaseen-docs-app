/**
 * Bullet threading / bullet paths (GRO-2094), the Roam / Logseq-dev-theme look: the vertical
 * lines from each list's top down to the bullet at the caret — and the glyphs on that path — take
 * the accent colour and stop at the active bullet.
 *
 * Design: view state only, like folding and zoom. Nothing is stored; the decorations are derived
 * from the ANCHOR on every update (`threadAnchor`): `state.selection.$from`, or CMD+F's active match
 * while you step through the matches (YAZ-3166). They are plain node classes on the `list_item`
 * blocks (`div.milkdown-list-item-block`):
 *  - THREAD_NODE_CLASS on every list_item on the root → caret path (glyph accent);
 *  - inside each NESTED list on the path (top-level lists have no guide line, same as Logseq),
 *    THREAD_SEG_CLASS on the items from the list's first child down to the path child, whose
 *    segment is cut at its glyph centre by THREAD_STOP_CLASS. Contiguous full-height segments
 *    make one continuous line that ends at the active bullet.
 * Drawing is pure CSS (bulletThreading.css), gated by `data-threading`: the page cog's "Bullet threading" on the
 * page's host, else Settings' "Bullet threading default" on `:root` (YAZ-4432).
 */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { findThreadAnchor } from '../find/findInPage'
import { typingOnly } from '../table/tableStyle'
import { isListItem } from './listNodes'

export const THREAD_NODE_CLASS = 'outline-thread-node'
export const THREAD_SEG_CLASS = 'outline-thread-seg'
export const THREAD_STOP_CLASS = 'outline-thread-stop'

interface ThreadState {
  positions: readonly number[]
  set: DecorationSet
}

const EMPTY_STATE: ThreadState = { positions: [], set: DecorationSet.empty }

const pluginKey = new PluginKey<ThreadState>('mdapp-bullet-threading')

/** What the thread points at: CMD+F's active match while you step through the matches (YAZ-3166), else the caret. */
export const threadAnchor = (state: EditorState): ResolvedPos => {
  const match = findThreadAnchor(state)
  return match === null ? state.selection.$from : state.doc.resolve(match)
}

/** Positions of the list_items holding the anchor: all `buildDecorations` reads besides the doc itself. */
const caretPositions = ($from: ResolvedPos): number[] => {
  const out: number[] = []
  for (let depth = 1; depth <= $from.depth; depth++) if (isListItem($from.node(depth))) out.push($from.before(depth))
  return out
}

const samePositions = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((p, i) => p === b[i])

/** One decoration per block with the merged class list (several per range would work too; one keeps tests plain). */
const buildDecorations = ($from: ResolvedPos): Decoration[] => {
  const classes = new Map<number, { node: ProseNode; names: Set<string> }>()
  const add = (pos: number, node: ProseNode, name: string) => {
    const entry = classes.get(pos) ?? { node, names: new Set<string>() }
    entry.names.add(name)
    classes.set(pos, entry)
  }

  for (let depth = 1; depth <= $from.depth; depth++) {
    const item = $from.node(depth)
    if (!isListItem(item)) continue
    add($from.before(depth), item, THREAD_NODE_CLASS)
    // The list holding this item is at depth-1; it is nested iff a list_item owns it (depth-2).
    if (depth < 2 || !isListItem($from.node(depth - 2))) continue
    const list = $from.node(depth - 1)
    const pathIndex = $from.index(depth - 1)
    for (let index = 0; index <= pathIndex; index++) {
      const pos = $from.posAtIndex(index, depth - 1)
      add(pos, list.child(index), THREAD_SEG_CLASS)
      if (index === pathIndex) add(pos, list.child(index), THREAD_STOP_CLASS)
    }
  }

  return [...classes].map(([pos, { node, names }]) =>
    Decoration.node(pos, pos + node.nodeSize, { class: [...names].join(' ') }),
  )
}

const buildState = ($anchor: ResolvedPos, doc: ProseNode, positions: readonly number[]): ThreadState => {
  if (positions.length === 0) return EMPTY_STATE
  const decorations = buildDecorations($anchor)
  return { positions, set: decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations) }
}

export const bulletThreading = $prose(
  () =>
    new Plugin<ThreadState>({
      key: pluginKey,
      state: {
        init: (_config, state) => {
          const $anchor = threadAnchor(state)
          return buildState($anchor, state.doc, caretPositions($anchor))
        },
        apply: (tr, prev, _old, state) => {
          const $anchor = threadAnchor(state)
          const positions = caretPositions($anchor)
          if (positions.length === 0) return EMPTY_STATE
          // Caret move within the same bullet: keep the exact set (YAZ-2131 4C).
          if (!tr.docChanged) return samePositions(prev.positions, positions) ? prev : buildState($anchor, state.doc, positions)
          // Inline typing in the same bullet: map existing decorations instead of rebuilding (YAZ-6028).
          if (
            prev.positions.length === positions.length &&
            typingOnly(tr) &&
            prev.positions.every((p, i) => tr.mapping.map(p, 1) === positions[i])
          ) {
            return { positions, set: prev.set.map(tr.mapping, state.doc) }
          }
          return buildState($anchor, state.doc, positions)
        },
      },
      props: {
        decorations: (state) => pluginKey.getState(state)?.set ?? DecorationSet.empty,
      },
    }),
)
