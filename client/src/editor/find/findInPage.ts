/**
 * CMD+F find in the open note (YAZ-968) — the engine behind `FindChannel`.
 *
 * Design, the fold plugin's (outlineFolding.ts): the whole search lives in plugin state (query,
 * matches, active index, the items this search revealed — every position mapped through every
 * transaction) and paints through decorations. Nothing it dispatches changes the document, so
 * `tr.docChanged` is always false, `markdownUpdated` never fires and the file on disk is untouched.
 *
 * Matching is case-insensitive and literal, per TEXTBLOCK: a block's adjacent text nodes are
 * concatenated with their absolute start, so a match crosses mark boundaries (`say wo**rld**` finds
 * `world`) and a soft line break, which reads as the one space it is drawn as (YAZ-2691) — but never
 * a hard break or a block boundary. While zoomed (zoom.ts) only the zoomed subtree counts.
 *
 * Folds and the search (the part with a memory): a collapsed item hiding a match is expanded
 * SILENTLY — `setOutlineFoldSet(..., { silent: true })`, which leaves ⌘Z panic-undo pointing at
 * whatever it pointed at before. `close()` puts every one of them back EXCEPT the ones hiding the
 * active match: the search hands the reader a landing, not a re-opened outline.
 * Collapsed HEADING sections (YAZ-1140) hide matches the same way and get the same treatment, on
 * their own books: two revealed sets, never merged, because the two kinds are separate plugin
 * states and each must be handed back only its own positions.
 *
 * The thread (YAZ-3166): after a query or a step, bullet threading and section indent point at the
 * active match instead of the caret (`findThreadAnchor`); a caret move or an edit gives them back.
 *
 * Pills (YAZ-3744 S9): a `[[link]]` the note draws as a pill (`pillLinks`, the wikilink plugin's own drawing) hides
 * text. A match that touches its hidden text (an ID, `.drawio`, folders, the brackets), and each match in the title an
 * ID link shows, is ONE match that marks the whole pill: its shown text, and its title widget (a widget takes no
 * decoration, so the plugin view puts the classes on it). Such a match starts at the link's start, so `close()` lands
 * the caret on the link's edge, where an ID link keeps its title (D1, S17). A link the selection opens is plain text.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding, setHeadingFoldSet } from '../outline/headingFolding'
import { collapsedItemsHiding, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos } from '../outline/zoom'
import { pillLinks, type PillLink, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import type { FindChannel, FindController, FindResult } from './findChannel'

export const FIND_MATCH_CLASS = 'find-match'
/** The active match carries this IN ADDITION to `FIND_MATCH_CLASS`. */
export const FIND_ACTIVE_CLASS = 'find-match--active'

/** An absolute document range: one match, or the zoomed subtree. */
interface Match {
  from: number
  to: number
  /** A match that marks a whole pill (S9): the link is `from`..`to`. */
  pill?: PillLink
}

/** The links find reads as the note draws them (YAZ-3744 S9): the editor's own sources. */
export interface FindLinks {
  wikilinks: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
}

interface FindState {
  query: string
  matches: readonly Match[]
  /** Index into `matches`; −1 when there are none. */
  activeIndex: number
  /** Items THIS search expanded; `close()` re-collapses all but the active match's. */
  revealed: ReadonlySet<number>
  /** The same, for heading sections (YAZ-1140) — kept apart: the two plugins own different positions. */
  revealedHeadings: ReadonlySet<number>
  /**
   * The thread points at the active match (YAZ-3166): true after a query or a step. False once the
   * caret moves, the doc is edited, or a click or a key lands in the note (YAZ-3200). A doc change
   * that another plugin appends to find's own transaction keeps it.
   */
  onMatch: boolean
}

type FindMeta =
  | { type: 'query'; query: string }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'revealed'; revealed: ReadonlySet<number>; revealedHeadings: ReadonlySet<number> }
  | { type: 'clear' }
  /** A click or a key in the note that sent no transaction of its own: the thread goes back to the caret (YAZ-3200). */
  | { type: 'release' }

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const findKey = new PluginKey<FindState>('mdapp-find-in-page')

const EMPTY: FindState = { query: '', matches: [], activeIndex: -1, revealed: new Set(), revealedHeadings: new Set(), onMatch: false }

/** Where the thread points while you step through the matches (YAZ-3166): the active match's start, else null (the caret). */
export const findThreadAnchor = (state: EditorState): number | null => {
  const find = findKey.getState(state)
  return find?.onMatch ? (find.matches[find.activeIndex]?.from ?? null) : null
}

/**
 * The block's text as runs of ADJACENT text nodes, each with its absolute start. Marks split text
 * nodes but not positions, so one run spans them and a match may too. A SOFT line break (a line
 * ending inside a paragraph, drawn as one space) reads as one space and is one position wide, so
 * the run carries on through it (YAZ-2691); any other non-text inline node (a real hard break,
 * an image) is a real gap and starts a new run.
 */
const textRuns = (block: ProseNode, blockPos: number): { text: string; start: number }[] => {
  const runs: { text: string; start: number }[] = []
  let end = -1
  block.forEach((child, offset) => {
    const text = child.isText ? child.text : child.type.name === 'hardbreak' && child.attrs.isInline ? ' ' : undefined
    if (text === undefined) return
    const start = blockPos + 1 + offset
    if (start === end) runs[runs.length - 1].text += text
    else runs.push({ text, start })
    end = start + child.nodeSize
  })
  return runs
}

/** Each start of `needle` in `haystack`, not overlapping. */
const occurrences = (haystack: string, needle: string): number[] => {
  const found: number[] = []
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) found.push(i)
  return found
}

/** One textblock's matches (S9): a match that touches a pill's hidden text marks the pill; a title's matches too. */
const blockMatches = (node: ProseNode, pos: number, needle: string, pills: readonly PillLink[]): Match[] => {
  const matches: Match[] = []
  // A title stands where its ID was: its matches go first, and the stable sort below keeps them before the ID's.
  for (const pill of pills) {
    if (pill.title === null) continue
    for (const _ of occurrences(pill.title.toLowerCase(), needle)) matches.push({ from: pill.from, to: pill.to, pill })
  }
  for (const run of textRuns(node, pos)) {
    for (const i of occurrences(run.text.toLowerCase(), needle)) {
      const from = run.start + i
      const to = from + needle.length
      const pill = pills.find((link) => from < link.to && to > link.from && link.hidden.some(([a, b]) => from < b && to > a))
      matches.push(pill === undefined ? { from, to } : { from: pill.from, to: pill.to, pill })
    }
  }
  return pills.length === 0 ? matches : matches.sort((a, b) => a.from - b.from)
}

/** Every case-insensitive literal occurrence of `query`, in document order; `zoom` filters to the zoomed subtree. */
const findMatches = (state: EditorState, query: string, zoom: Match | null, links: FindLinks | undefined): Match[] => {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const matches: Match[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const pills = links === undefined || node.type.spec.code === true ? [] : pillLinks(node, pos, state.selection, links.wikilinks, links.viewOnly)
    for (const match of blockMatches(node, pos, needle, pills)) {
      if (zoom === null || (match.from >= zoom.from && match.from < zoom.to)) matches.push(match)
    }
    return false
  })
  return matches
}

/** What a pill match paints (S9): the pill's shown text, the link minus what it hides. The title widget is the view's. */
const shownRanges = ({ from, to, hidden }: PillLink): [number, number][] => {
  const ranges: [number, number][] = []
  let at = from
  for (const [a, b] of [...hidden].sort((x, y) => x[0] - y[0])) {
    if (a > at) ranges.push([at, a])
    at = Math.max(at, b)
  }
  if (to > at) ranges.push([at, to])
  return ranges
}

/** The title widgets of the ID pills (`wikilinkPlugin.ts` `decorate` draws each at the link's `from + 2`), by position. */
const titleWidgets = (view: EditorView): Map<number, HTMLElement> => {
  const widgets = new Map<number, HTMLElement>()
  for (const widget of view.dom.querySelectorAll<HTMLElement>('.ProseMirror-widget.wikilink')) widgets.set(view.posAtDOM(widget, 0), widget)
  return widgets
}

/**
 * The zoomed subtree in the NEW document. Zoom's own plugin state is not applied yet when this
 * plugin's field runs first (createCrepe registers find before `createOutlineZoom`), so the level
 * is read from the old state and mapped the way zoom.ts maps it.
 */
const zoomedRange = (transaction: Transaction, oldState: EditorState, newState: EditorState): Match | null => {
  const itemPos = getZoomedItemPos(oldState)
  if (itemPos === null) return null
  const pos = transaction.mapping.map(itemPos, 1)
  const item = newState.doc.nodeAt(pos)
  return item === null ? null : { from: pos, to: pos + item.nodeSize }
}

/** Where the active match lands: the caret's next match on a new query, a wrapped step, else held in range. */
const nextActive = (previous: FindState, meta: FindMeta | undefined, matches: readonly Match[], caret: number): number => {
  if (matches.length === 0) return -1
  if (meta?.type === 'step') return (previous.activeIndex + meta.delta + matches.length) % matches.length
  if (meta?.type !== 'query') return Math.min(Math.max(previous.activeIndex, 0), matches.length - 1)
  const index = matches.findIndex((match) => match.from >= caret)
  return index === -1 ? 0 : index
}

/** One revealed set across a transaction: the freshly reported one, else the old one mapped through any doc change. */
const carryRevealed = (transaction: Transaction, reported: ReadonlySet<number> | undefined, previous: ReadonlySet<number>): ReadonlySet<number> =>
  reported ?? (transaction.docChanged ? new Set([...previous].map((pos) => transaction.mapping.map(pos, 1))) : previous)

/** The engine behind the channel's commands. Every step is metadata-only, and synchronous. */
const createController = (view: EditorView): FindController => {
  const findState = (): FindState => findKey.getState(view.state) ?? EMPTY
  const result = (): FindResult => {
    const { matches, activeIndex } = findState()
    return { total: matches.length, activeIndex }
  }
  const activeMatch = (): Match | null => {
    const { matches, activeIndex } = findState()
    return matches[activeIndex] ?? null
  }
  const dispatchMeta = (meta: FindMeta): void => {
    view.dispatch(view.state.tr.setMeta(findKey, meta))
  }
  const fold = (positions: readonly number[], collapsed: boolean): void => {
    setOutlineFoldSet(positions, collapsed, { silent: true })(view.state, view.dispatch)
  }
  const foldHeadings = (positions: readonly number[], collapsed: boolean): void => {
    setHeadingFoldSet(positions, collapsed, { silent: true })(view.state, view.dispatch)
  }
  /** The collapsed items hiding any of `positions`, as the document stands right now. */
  const hiders = (positions: readonly number[]): Set<number> => {
    const found = new Set<number>()
    for (const pos of positions) for (const item of collapsedItemsHiding(view.state, pos)) found.add(item)
    return found
  }
  /** The same, for collapsed heading sections. */
  const headingHiders = (positions: readonly number[]): Set<number> => {
    const found = new Set<number>()
    for (const pos of positions) for (const heading of collapsedHeadingsHiding(view.state, pos)) found.add(heading)
    return found
  }
  const differs = (next: ReadonlySet<number>, previous: ReadonlySet<number>): boolean =>
    next.size !== previous.size || [...next].some((pos) => !previous.has(pos))
  /**
   * Re-collapse what the search opened, then open what still hides a match: one pass covers both
   * the reveal and the re-collapse of an item the query has moved off. Both transactions land in
   * the same synchronous turn, so the outline is never rendered half-way. Bullets and headings ride
   * along together — a match can be hidden by either kind, or by both at once.
   */
  const reveal = (): void => {
    const previous = findState()
    fold([...previous.revealed], true)
    foldHeadings([...previous.revealedHeadings], true)
    const positions = findState().matches.map((match) => match.from)
    const revealed = hiders(positions)
    const revealedHeadings = headingHiders(positions)
    fold([...revealed], false)
    foldHeadings([...revealedHeadings], false)
    if (differs(revealed, previous.revealed) || differs(revealedHeadings, previous.revealedHeadings))
      dispatchMeta({ type: 'revealed', revealed, revealedHeadings })
  }
  /**
   * Centres the active HIGHLIGHT, not its block: a block can be many windows tall (one 4.5k-line
   * transcript paragraph, YAZ-2691), and its centre is nowhere near the match. With no highlight
   * in the DOM, the block is still the target.
   * jsdom has no `scrollIntoView` and the contract runs there, so the call stays optional.
   */
  const scrollToActive = (): void => {
    const match = activeMatch()
    if (match === null) return
    const { node } = view.domAtPos(match.from)
    const element = view.dom.querySelector(`.${FIND_ACTIVE_CLASS}`) ?? (node instanceof Element ? node : node.parentElement)
    element?.scrollIntoView?.({ block: 'center' })
  }
  return {
    search: (query) => {
      dispatchMeta({ type: 'query', query })
      reveal()
      scrollToActive()
      return result()
    },
    step: (delta) => {
      dispatchMeta({ type: 'step', delta })
      reveal()
      scrollToActive()
      return result()
    },
    close: () => {
      const { revealed, revealedHeadings } = findState()
      const match = activeMatch()
      fold([...revealed], true)
      foldHeadings([...revealedHeadings], true)
      // The landing stays open: whatever hides the active match is opened straight back.
      if (match !== null) {
        fold([...hiders([match.from])], false)
        foldHeadings([...headingHiders([match.from])], false)
      }
      const transaction = view.state.tr.setMeta(findKey, { type: 'clear' } satisfies FindMeta)
      if (match !== null) transaction.setSelection(TextSelection.create(transaction.doc, match.from))
      view.dispatch(transaction)
      view.focus()
    },
  }
}

/** A modifier alone is not a key in the note: ⌘ on its way to a shortcut must not move the thread. */
const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Alt', 'Control', 'CapsLock'])

/**
 * A click or a key in the note gives the thread back to the caret (YAZ-3200), also when the caret
 * stays where it is and ProseMirror sends no transaction: a click on the caret's own spot, or an
 * arrow key at the end of the doc. A real caret move or edit clears it in `apply` anyway.
 */
const releaseThread = (view: EditorView): false => {
  if (findKey.getState(view.state)?.onMatch === true) view.dispatch(view.state.tr.setMeta(findKey, { type: 'release' } satisfies FindMeta))
  return false
}

const findPlugin = (channel: FindChannel, links?: FindLinks) =>
  $prose(
    () =>
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply: (transaction, previous, oldState, newState) => {
            const meta: FindMeta | undefined = transaction.getMeta(findKey)
            if (meta?.type === 'clear') return EMPTY
            const query = meta?.type === 'query' ? meta.query : previous.query
            // Matches are RECOMPUTED, not mapped: an edit creates and destroys them, not just moves them.
            const recompute = meta?.type === 'query' || (transaction.docChanged && query !== '')
            const revealed = carryRevealed(transaction, meta?.type === 'revealed' ? meta.revealed : undefined, previous.revealed)
            const revealedHeadings = carryRevealed(
              transaction,
              meta?.type === 'revealed' ? meta.revealedHeadings : undefined,
              previous.revealedHeadings,
            )
            // A reveal (fold) transaction is metadata-only and keeps it; `close()` lands the caret on the match.
            // An APPENDED doc change keeps it too: a real edit is the root transaction and clears it first, but
            // Milkdown's trailing paragraph can ride on find's own query, the first transaction after mount.
            const edited = transaction.docChanged && transaction.getMeta('appendedTransaction') === undefined
            // The selection must really move: a hover's class change makes ProseMirror read the DOM and
            // set the selection it already has, which is no caret move (YAZ-3205).
            const caretMoved = !newState.selection.eq(oldState.selection)
            const onMatch =
              meta?.type === 'query' || meta?.type === 'step' || (meta?.type !== 'release' && previous.onMatch && !caretMoved && !edited)
            if (
              meta === undefined &&
              !recompute &&
              onMatch === previous.onMatch &&
              revealed === previous.revealed &&
              revealedHeadings === previous.revealedHeadings
            )
              return previous
            const matches = recompute ? findMatches(newState, query, zoomedRange(transaction, oldState, newState), links) : previous.matches
            return { query, matches, activeIndex: nextActive(previous, meta, matches, newState.selection.from), revealed, revealedHeadings, onMatch }
          },
        },
        props: {
          handleDOMEvents: {
            mousedown: (view) => releaseThread(view),
            keydown: (view, event) => (MODIFIER_KEYS.has(event.key) ? false : releaseThread(view)),
          },
          decorations: (state) => {
            const { matches, activeIndex } = findKey.getState(state) ?? EMPTY
            if (matches.length === 0) return DecorationSet.empty
            return DecorationSet.create(
              state.doc,
              matches.flatMap((match, index) => {
                const attrs = { class: index === activeIndex ? `${FIND_MATCH_CLASS} ${FIND_ACTIVE_CLASS}` : FIND_MATCH_CLASS }
                const ranges = match.pill === undefined ? [[match.from, match.to]] : shownRanges(match.pill)
                return ranges.map(([from, to]) => Decoration.inline(from, to, attrs))
              }),
            )
          },
        },
        view: (editorView) => {
          const unbind = channel.bind(createController(editorView))
          /**
           * The title widgets this search marked (S9). Marked again after each update: a redraw can keep a widget (same
           * title) or make a new one. ProseMirror ignores a widget's class changes (no DOM read, no transaction).
           */
          let marked: HTMLElement[] = []
          const markTitles = (matches: readonly Match[], activeIndex: number) => {
            for (const el of marked) el.classList.remove(FIND_MATCH_CLASS, FIND_ACTIVE_CLASS)
            marked = []
            let widgets: Map<number, HTMLElement> | undefined
            matches.forEach((match, index) => {
              if (match.pill?.title == null) return
              widgets ??= titleWidgets(editorView)
              const widget = widgets.get(match.pill.from + 2)
              if (widget === undefined) return
              widget.classList.add(FIND_MATCH_CLASS)
              if (index === activeIndex) widget.classList.add(FIND_ACTIVE_CLASS)
              marked.push(widget)
            })
          }
          // An edit under an open find changes the count without anyone asking; the bar hears it here.
          const sync = () => {
            const { matches, activeIndex } = findKey.getState(editorView.state) ?? EMPTY
            markTitles(matches, activeIndex)
            channel.sync({ total: matches.length, activeIndex })
          }
          return { update: sync, destroy: unbind }
        },
      }),
  )

/**
 * Escape closes an OPEN find and declines otherwise, so the key falls through untouched.
 * Priority 20: above escape-to-sidebar's 10 (Esc lands the search before it hands focus back to
 * the sidebar, YAZ-936), below the `[[` picker's 100.
 */
const findEscapeKeymap = (channel: FindChannel) =>
  $shortcut(() => ({
    FindEscape: {
      key: 'Escape',
      priority: 20,
      onRun: () => () => {
        if (!channel.getState().open) return false
        channel.close()
        return true
      },
    },
  }))

export function createFindInPage(channel: FindChannel, links?: FindLinks) {
  return [findPlugin(channel, links), findEscapeKeymap(channel)]
}
