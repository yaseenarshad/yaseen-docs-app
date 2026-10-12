/**
 * Section indent (YAZ-2709): in a note that uses headings, the text stands below its heading, one
 * step in for each section that holds it, and thin vertical lines show the sections. The lines on
 * the way to the caret take bullet threading's colour.
 *
 * Design: view state only, like folding, zoom and line numbers. The host says on or off for the
 * page (the page cog) in a metadata-only transaction, so `markdownUpdated` never fires for it and
 * the markdown on disk never changes. The decorations are ONE node decoration for each TOP-LEVEL
 * block that is inside a section:
 *  - SECTION_DEPTH_ATTR (`data-sd`, 1-6): how many sections hold the block, so how many steps in;
 *  - SECTION_PATH_ATTR (`data-sp`, 1-6): how many of its lines, from the left, are on the caret's path.
 * Drawing is pure CSS (sectionIndent.css): the indent is a transparent left border and the lines
 * are a gradient inside it.
 *
 * Steps count by NESTING, not by heading number: a note that starts at H2 has its H2s at the edge,
 * and an H4 right under an H2 is one step in, not two. All six levels make a section; folds stay
 * H1-H3 (headingFolding.ts). Only a direct child of the doc counts: a heading inside a list or a
 * quote makes no section. Nothing is indented while a bullet is zoomed.
 *
 * The set is REBUILT on every document change and never mapped, and it is handed to ProseMirror's
 * own `DecorationSet` constructor. Both are measured: `DecorationSet.create` and `set.map` validate
 * each root-level node decoration with a linear scan of the doc's children, 23.6 ms per key at
 * 2,500 blocks; one pass into the constructor is 0.19 ms. sectionIndent.test.ts pins the hand-built
 * set to what `DecorationSet.create` builds from the same decorations.
 * The view has the same trap on its own side: on every document change it asks the set, for each
 * child of the doc, what reaches INSIDE that child (`forChild`), and ProseMirror answers by scanning
 * every root-level decoration: 16.5 ms per key at 2,557 blocks, measured in the running app. Nothing
 * of this set is ever inside a block, so its `forChild` says so at once (`SectionSet` below).
 *
 * A click on a line folds the sections beside it, the rule a list guide line has (guideLines.ts):
 * the direct child headings of the heading that owns the line, all folded if any is open, else all
 * unfolded. The caret does not move.
 */
import type { Crepe } from '../crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cssZoom } from '../../lib/cssZoom'
import { DEEPEST_FOLDABLE_LEVEL, headingLevel, isHeadingCollapsed, setHeadingFoldSet } from './headingFolding'
import { getZoomedItemPos } from './zoom'

export const SECTION_DEPTH_ATTR = 'data-sd'
export const SECTION_PATH_ATTR = 'data-sp'
/** On the page (`view.dom`) while the pointer is over the click band of a line: sectionIndent.css shows the pointer cursor. */
export const SECTION_LINE_HOVER_CLASS = 'section-line-hover'

/** A click within this many px of a line's centre is on the line: the same 10px band as a list guide line (guideLines.css). */
export const LINE_BAND_HALF_WIDTH = 5

interface SectionIndentState {
  /** The page's switch: what the host sends (`showSectionIndent`). */
  on: boolean
  /** Index of the top-level block that holds the caret: all the path reads besides the doc itself. */
  caret: number
  set: DecorationSet
}

const pluginKey = new PluginKey<SectionIndentState>('mdapp-section-indent')

/** Every page that is off shares this one state, so an off page never builds or compares anything. */
const OFF: SectionIndentState = { on: false, caret: -1, set: DecorationSet.empty }

/** `ATTRS[depth - 1][path]`: shared objects, so an unchanged block compares equal at once. */
const ATTRS: readonly (readonly Record<string, string>[])[] = [1, 2, 3, 4, 5, 6].map((depth) =>
  [0, 1, 2, 3, 4, 5, 6].map((path): Record<string, string> =>
    path === 0 ? { [SECTION_DEPTH_ATTR]: String(depth) } : { [SECTION_DEPTH_ATTR]: String(depth), [SECTION_PATH_ATTR]: String(path) },
  ),
)

/**
 * ProseMirror's own constructor, `(local, children)`. The types hide it as internal; `local` is the
 * root-level decorations in document order, which is the order the one pass makes them in.
 */
const HandBuiltSet = DecorationSet as unknown as new (local: Decoration[], children: never[]) => DecorationSet

/**
 * The set of this plugin: node decorations on direct children of the doc and nothing else, so no
 * decoration of it is ever inside a block. `forChild` is the view's question "what of this set is
 * inside this child", asked for every child of the doc on every document change; ProseMirror's own
 * answer walks all of `local` each time, n × n for n blocks, to find inline decorations that this
 * set never holds. The answer is the same (pinned by sectionIndent.test.ts), without the walk.
 */
class SectionSet extends HandBuiltSet {
  override forChild(): DecorationSet {
    return DecorationSet.empty
  }
}

/**
 * How many sections hold each top-level block: the steps it stands in. A stack of the open heading
 * levels: a heading closes every open level at or below its own, stands at the depth that is left,
 * and opens its own. So the first headings of a note stand at the edge whatever their number, and a
 * skipped level is no extra step.
 */
export const sectionDepths = (doc: ProseNode): Uint8Array => {
  const depths = new Uint8Array(doc.childCount)
  const open: number[] = []
  doc.forEach((block, _offset, index) => {
    const level = headingLevel(block)
    if (level !== null) {
      while (open.length > 0 && open[open.length - 1] >= level) open.pop()
      depths[index] = open.length
      open.push(level)
    } else depths[index] = open.length
  })
  return depths
}

/** The headings of the sections that hold block `caret`, outermost first: heading k owns line k. */
export const pathHeadings = (doc: ProseNode, depths: Uint8Array, caret: number): number[] => {
  const path: number[] = []
  for (let index = caret - 1, need = depths[caret] - 1; index >= 0 && need >= 0; index--) {
    if (depths[index] !== need || headingLevel(doc.child(index)) === null) continue
    path.unshift(index)
    need--
  }
  return path
}

/**
 * How many lines of each top-level block are purple, counted from the left. Line k is purple from
 * the block after path heading k down to the caret's block. The path stops at the caret's line
 * (YAZ-2709 D6): no block after it has a purple line.
 */
export const sectionPaths = (doc: ProseNode, depths: Uint8Array, caret: number): Uint8Array => {
  const purple = new Uint8Array(doc.childCount)
  const path = pathHeadings(doc, depths, caret)
  path.forEach((heading, k) => {
    const last = k + 1 < path.length ? path[k + 1] : caret
    for (let index = heading + 1; index <= last; index++) purple[index] = k + 1
  })
  return purple
}

/** One pass: a node decoration for each top-level block inside a section, in document order. */
const build = (state: EditorState): DecorationSet => {
  const { doc } = state
  const depths = sectionDepths(doc)
  const purple = sectionPaths(doc, depths, state.selection.$from.index(0))
  const local: Decoration[] = []
  doc.forEach((block, pos, index) => {
    const depth = depths[index]
    if (depth > 0) local.push(Decoration.node(pos, pos + block.nodeSize, ATTRS[depth - 1][purple[index]]))
  })
  return local.length === 0 ? DecorationSet.empty : new SectionSet(local, [])
}

/**
 * Which line of a block's indent a point is on, 1 for the leftmost, or null between lines.
 * `offset` is px from the block's left edge, `step` the width of one step; line k is centred at
 * `step * (k - 1) + step / 3`, as sectionIndent.css draws it.
 */
export const sectionLineAtOffset = (offset: number, step: number, depth: number): number | null => {
  if (!(step > 0) || offset < 0 || offset >= step * depth) return null
  const line = Math.floor(offset / step) + 1
  return Math.abs(offset - (step * (line - 1) + step / 3)) <= LINE_BAND_HALF_WIDTH ? line : null
}

/**
 * The line of `block` under viewport `x`, or null. The indent is the block's own left border, so
 * its width is depth × step whatever the setting, the narrow-note step and the document zoom are.
 * Shared with the block-handle gate (blockHandleGate.ts), so both hit the same drawn line.
 */
export const sectionLineAt = (x: number, block: Element): number | null => {
  const depth = Number(block.getAttribute(SECTION_DEPTH_ATTR))
  if (!(depth >= 1)) return null
  const indent = Number.parseFloat(getComputedStyle(block).borderLeftWidth)
  return sectionLineAtOffset((x - block.getBoundingClientRect().left) / cssZoom(block), indent / depth, depth)
}

/**
 * What a click on line `line` of top-level block `index` folds: the direct child headings of the
 * heading that owns the line, those a chevron folds (H1-H3 with something under them). Document
 * positions, in document order; empty when nothing beside the line folds.
 */
export const sectionLineFoldTargets = (doc: ProseNode, index: number, line: number): number[] => {
  const depths = sectionDepths(doc)
  const owner = pathHeadings(doc, depths, index)[line - 1]
  const targets: number[] = []
  if (owner === undefined) return targets
  let pos = 0
  for (let at = 0; at < doc.childCount; at++) {
    const block = doc.child(at)
    const level = headingLevel(block)
    if (at > owner && level !== null) {
      // The owner's section ends at the first heading that is not inside it.
      if (depths[at] < line) break
      const next = at + 1 < doc.childCount ? headingLevel(doc.child(at + 1)) : null
      const hasSection = at + 1 < doc.childCount && (next === null || next > level)
      if (depths[at] === line && level <= DEEPEST_FOLDABLE_LEVEL && hasSection) targets.push(pos)
    }
    pos += block.nodeSize
  }
  return targets
}

/** The top-level block and line under a pointer event, or null. A block's indent is its own border, so a hit targets the block itself. */
const lineHit = (view: EditorView, event: MouseEvent): { index: number; line: number } | null => {
  const target = event.target
  if (!(target instanceof HTMLElement) || target.parentElement !== view.dom) return null
  const line = sectionLineAt(event.clientX, target)
  if (line === null) return null
  return { index: view.state.doc.resolve(view.posAtDOM(target, 0)).index(0), line }
}

export const sectionIndent = $prose(() => {
  return new Plugin<SectionIndentState>({
    key: pluginKey,
    state: {
      init: () => OFF,
      apply: (transaction, previous, _oldState, newState) => {
        const meta = transaction.getMeta(pluginKey) as boolean | undefined
        if (!(meta ?? previous.on)) return OFF
        const caret = newState.selection.$from.index(0)
        // A caret move inside one block changes no depth and no path: keep the SAME state object (YAZ-2189).
        if (meta === undefined && !transaction.docChanged && caret === previous.caret) return previous
        return { on: true, caret, set: build(newState) }
      },
    },
    props: {
      // Zoom is asked here, not in `apply`: a zoom in or out is a metadata-only transaction of its own.
      decorations: (state) => {
        const own = pluginKey.getState(state)
        return own === undefined || getZoomedItemPos(state) !== null ? DecorationSet.empty : own.set
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false
          const hit = lineHit(view, event)
          if (hit === null) return false
          // Swallow the event BEFORE folding: the caret must not move and no text may select —
          // also when no section beside the line folds.
          event.preventDefault()
          const targets = sectionLineFoldTargets(view.state.doc, hit.index, hit.line)
          const collapse = targets.some((pos) => !isHeadingCollapsed(view.state, pos))
          setHeadingFoldSet(targets, collapse)(view.state, view.dispatch)
          return true
        },
        mousemove: (view, event) => {
          const on = pluginKey.getState(view.state)?.on === true
          view.dom.classList.toggle(SECTION_LINE_HOVER_CLASS, on && lineHit(view, event) !== null)
          return false
        },
        mouseleave: (view) => {
          view.dom.classList.remove(SECTION_LINE_HOVER_CLASS)
          return false
        },
      },
    },
    view: (view) => ({
      destroy: () => {
        view.dom.classList.remove(SECTION_LINE_HOVER_CLASS)
      },
    }),
  })
})

/**
 * Sends the page's switch to the plugin: a metadata-only transaction that is not a step of the
 * history, so ⌘Z never undoes it and the note never turns unsaved.
 */
export const showSectionIndent = (crepe: Crepe, on: boolean): void =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setMeta(pluginKey, on).setMeta('addToHistory', false))
  })
