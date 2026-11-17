/**
 * CMD+F find in the open page (YAZ-968) — the engine behind `FindChannel`.
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
 * What find opens is the channel's `folds` (YAZ-4787): `all` opens every fold that hides a match, as above; `current`
 * (the default) opens only the folds that hide the ACTIVE match, and folds them again on the next step; `keep` opens
 * nothing, and a match that a fold hides is no match: the count is what shows, and a fold or unfold re-counts.
 * Collapsed HEADING sections (YAZ-1140) hide matches the same way and get the same treatment, on
 * their own books: two revealed sets, never merged, because the two kinds are separate plugin
 * states and each must be handed back only its own positions.
 *
 * The thread (YAZ-3166): after a query or a step, bullet threading and section indent point at the
 * active match instead of the caret (`findThreadAnchor`); a caret move or an edit gives them back.
 *
 * Cell notes (YAZ-3818 D19): in the page view, the matches in the hidden cell notes count. When the active match is in
 * one, find opens that cell note as a card beside its cell (`table/cellNoteCard.ts`; the caret stays), and keeps a record
 * of it, as it does of the folds it opened. When the active match moves out of that cell note, find closes the card.
 * `close()` on a match in the cell note leaves the card open with the caret in it.
 *
 * Pills (YAZ-3744 S9): a `[[link]]` the page draws as a pill (`pillLinks`, the wikilink plugin's own drawing) hides
 * text. The matches that touch its hidden text (an ID, `.drawio`, folders, the brackets) are together ONE match, and each
 * match in the title an ID link shows is one. Each marks the whole pill: its shown text, and its title widget (a widget takes no
 * decoration, so the plugin view puts the classes on it). Such a match starts at the link's start, so `close()` lands
 * the caret on the link's edge, where an ID link keeps its title (D1, S17). A link the selection opens is plain text.
 *
 * Cards (YAZ-5378): a card in the page and a card embed (`![[ID]]`) draw their own text, so find reads them AS DRAWN
 * (`cardFind.ts`: the title band and the sides, hidden words too), never their Markdown. The view scans the cards on a
 * query and after any change in them (an edit, Done, an embed that read its card), and hands the state each card's
 * place and count (`CardSpot`); the state puts that many matches at the card's place, in page order with the text, and
 * drops the card block's raw text. A card edited in the raw-text fallback is a code block (its CodeMirror is find's).
 * Their paint is the shared highlight (`paintFindRanges`); the folds, the step, the count and the landing are the page's.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding, hasHeadingFoldMeta, setHeadingFoldSet } from '../outline/headingFolding'
import { cellPosAround } from '../outline/listNodes'
import { collapsedItemsHiding, hasOutlineFoldMeta, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos } from '../outline/zoom'
import { closeCellNote, openCellNote, revealOpenCell, showInCard } from '../table/cellNoteCard'
import { cellNoteAround, cellNoteCardKey, isCellNoteHidden, markPosOf } from '../table/cellNotes'
import { closeHistory } from '@milkdown/kit/prose/history'
import { rowFolded } from '../table/cells'
import { unfoldRun } from '../table/tableFold'
import { boardCheckOf, boardEmbedKey, boardEmbedsIn, embedRevealed } from '../drawing/boardEmbedScan'
import { pillLinks, type PillLink, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import type { FindChannel, FindController, FindResult } from './findChannel'
import type { EditorView as CodeMirrorView } from '@codemirror/view'
import { paintCodeBlocks, scrollCodeMatch } from './codeBlockFind'
import { CARD_FIND_READ, cardMatches, paintFindRanges, scrollToRange } from './cardFind'
import { isCardNode } from '../card/cardBlockLine'

export const FIND_MATCH_CLASS = 'find-match'
/** The active match carries this IN ADDITION to `FIND_MATCH_CLASS`. */
export const FIND_ACTIVE_CLASS = 'find-match--active'

/** The cell note find opened as a card (D19): its position, mapped through every change. */
type OpenedCellNote = number

/** An absolute document range: one match, or the zoomed subtree. */
interface Match {
  from: number
  to: number
  /** A match that marks a whole pill (S9): the link is `from`..`to`. */
  pill?: PillLink
  /** A match in a card's drawn text (YAZ-5378): the card's place, and which of its matches (`from` = `to` = `pos`). */
  card?: { pos: number; nth: number }
}

/** A card the page draws (YAZ-5378): its place (the card block's start, or the embed's) and its matches' count. */
interface CardSpot {
  pos: number
  count: number
}

/** The links find reads as the page draws them (YAZ-3744 S9): the editor's own sources. */
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
  /** The cell note THIS search opened, or null (D19). */
  opened: OpenedCellNote | null
  /**
   * The thread points at the active match (YAZ-3166): true after a query or a step. False once the
   * caret moves, the doc is edited, or a click or a key lands in the page (YAZ-3200). A doc change
   * that another plugin appends to find's own transaction keeps it.
   */
  onMatch: boolean
  /** The cards the view scanned for this query (YAZ-5378), their places mapped through every change. */
  cards: readonly CardSpot[]
}

type FindMeta =
  | { type: 'query'; query: string; cards?: readonly CardSpot[] }
  /** The view counted the cards again (a card changed under an open search). */
  | { type: 'cards'; cards: readonly CardSpot[] }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'revealed'; revealed: ReadonlySet<number>; revealedHeadings: ReadonlySet<number> }
  | { type: 'opened'; opened: OpenedCellNote | null }
  | { type: 'clear' }
  /** A click or a key in the page that sent no transaction of its own: the thread goes back to the caret (YAZ-3200). */
  | { type: 'release' }

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const findKey = new PluginKey<FindState>('mdapp-find-in-page')

const EMPTY: FindState = { query: '', matches: [], activeIndex: -1, revealed: new Set(), revealedHeadings: new Set(), opened: null, onMatch: false, cards: [] }

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

/**
 * One textblock's matches (S9): a match that touches a pill's hidden text marks the pill; a title's matches too. A pill
 * counts once for its hidden text, however many matches that text holds, and not at all when its title counts it: the
 * title of a missing page shows the ID it hides (S10). Each match in a title counts, as in any text.
 */
const blockMatches = (node: ProseNode, pos: number, needle: string, pills: readonly PillLink[]): Match[] => {
  const matches: Match[] = []
  const counted = new Set<PillLink>()
  // A title stands where its ID was: its matches go first, and the stable sort below keeps them before the ID's.
  for (const pill of pills) {
    if (pill.title === null) continue
    for (const _ of occurrences(pill.title.toLowerCase(), needle)) {
      matches.push({ from: pill.from, to: pill.to, pill })
      counted.add(pill)
    }
  }
  for (const run of textRuns(node, pos)) {
    for (const i of occurrences(run.text.toLowerCase(), needle)) {
      const from = run.start + i
      const to = from + needle.length
      const pill = pills.find((link) => from < link.to && to > link.from && link.hidden.some(([a, b]) => from < b && to > a))
      if (pill === undefined) matches.push({ from, to })
      else if (!counted.has(pill)) {
        counted.add(pill)
        matches.push({ from: pill.from, to: pill.to, pill })
      }
    }
  }
  return pills.length === 0 ? matches : matches.sort((a, b) => a.from - b.from)
}

/** No fold hides `pos` (YAZ-4787 `keep`). Find runs after both fold plugins, so `state` holds their new folds. */
const shows = (state: EditorState, pos: number): boolean => collapsedItemsHiding(state, pos).length === 0 && collapsedHeadingsHiding(state, pos).length === 0

/** Every case-insensitive literal occurrence of `query`, in document order; `zoom` filters to the zoomed subtree, `shownOnly` to what no fold hides. */
const findMatches = (state: EditorState, query: string, zoom: Match | null, links: FindLinks | undefined, shownOnly = false, cards: readonly CardSpot[] = []): Match[] => {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const matches: Match[] = []
  const counts = (pos: number): boolean => (zoom === null || (pos >= zoom.from && pos < zoom.to)) && (!shownOnly || shows(state, pos))
  // A drawn card's text is the view's count (YAZ-5378); its block's Markdown is no match.
  const drawn = new Set(cards.map((card) => card.pos))
  // What the board embeds hide, by the host's own scan and reveal rule; nothing in an editor without the host. Its
  // plugin, not its state: find's state is built first, before the host's for the same transaction.
  const host = boardEmbedKey.get(state) !== undefined
  const isBoard = boardCheckOf(state)
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (drawn.has(pos) && isCardNode(node)) return false
    const pills = links === undefined || node.type.spec.code === true ? [] : pillLinks(node, pos, state.selection, links.wikilinks, links.viewOnly)
    // A board embed's text is under its window (YAZ-4827 item 15): none of it is a match, unless "Edit link" opened it.
    const embeds = host ? boardEmbedsIn(node, pos, isBoard).filter((embed) => !embedRevealed(state.selection, embed.from, embed.to)) : []
    for (const match of blockMatches(node, pos, needle, pills)) {
      if (embeds.some((embed) => match.from < embed.to && match.to > embed.from)) continue
      if (counts(match.from)) matches.push(match)
    }
    return false
  })
  const inCards = cards.filter((card) => card.count > 0 && counts(card.pos))
  if (inCards.length === 0) return matches
  for (const card of inCards) for (let nth = 0; nth < card.count; nth++) matches.push({ from: card.pos, to: card.pos, card: { pos: card.pos, nth } })
  // Stable: a card's matches keep their order, and sit where the card stands among the page's.
  return matches.sort((a, b) => a.from - b.from)
}

/** The cards across a transaction: freshly scanned, else the old ones mapped; a card whose place went is gone. */
const carryCards = (transaction: Transaction, meta: FindMeta | undefined, previous: readonly CardSpot[]): readonly CardSpot[] => {
  if ((meta?.type === 'query' || meta?.type === 'cards') && meta.cards !== undefined) return meta.cards
  if (meta?.type === 'query') return []
  if (!transaction.docChanged) return previous
  return previous.flatMap((card) => {
    const mapped = transaction.mapping.mapResult(card.pos, 1)
    return mapped.deletedAfter ? [] : [{ pos: mapped.pos, count: card.count }]
  })
}

const sameCards = (a: readonly CardSpot[], b: readonly CardSpot[]): boolean =>
  a.length === b.length && a.every((card, i) => card.pos === b[i].pos && card.count === b[i].count)

/** A card the view scanned: its place and its matches as drawn. */
interface ScannedCard extends CardSpot {
  ranges: Range[]
}

/** The cards the page draws (YAZ-5378): its cards not edited in the raw-text fallback, and its card embeds. */
const drawnCards = (view: EditorView): Element[] =>
  [...view.dom.querySelectorAll('.card[data-page-card], .card-embed')].filter((el) => el.querySelector('.cm-content') === null && el.parentElement?.closest('.card__editor') == null)

/** A drawn card's place: the card block's start, or the embed widget's place in its text. */
const cardPlace = (view: EditorView, el: Element): number | null => {
  let pos: number
  try {
    pos = view.posAtDOM(el, 0)
  } catch {
    return null
  }
  const doc = view.state.doc
  if (pos < 0 || pos > doc.content.size) return null
  if (el.classList.contains('card-embed')) return pos
  if (isCardNode(doc.nodeAt(pos))) return pos
  const $pos = doc.resolve(pos)
  return $pos.depth > 0 && isCardNode($pos.parent) ? $pos.before() : null
}

/** Every drawn card's matches of `query`, in page order. An embed that has not read its card yet is asked to. */
const scanCards = (view: EditorView, query: string): ScannedCard[] => {
  if (query === '') return []
  const scanned: ScannedCard[] = []
  for (const el of drawnCards(view)) {
    const pos = cardPlace(view, el)
    if (pos === null) continue
    if (el.classList.contains('card-embed') && el.querySelector('.card__body')?.hasChildNodes() !== true) el.dispatchEvent(new Event(CARD_FIND_READ))
    const ranges = cardMatches(el, query)
    scanned.push({ pos, count: ranges.length, ranges })
  }
  return scanned.sort((a, b) => a.pos - b.pos)
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

/** The title widgets of the ID pills, by position: `wikilinkPlugin.ts` `decorate` draws one at the link's end, or at `from + 2` before a heading. */
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

/** The opened cell note across a transaction: the freshly reported one, else the old one mapped; null once the cell note is gone. */
const carryOpened = (transaction: Transaction, meta: FindMeta | undefined, previous: OpenedCellNote | null): OpenedCellNote | null => {
  if (meta?.type === 'opened') return meta.opened
  if (previous === null || !transaction.docChanged) return previous
  const cellNote = transaction.mapping.mapResult(previous, 1)
  return cellNote.deleted ? null : cellNote.pos
}

/** The hidden cell note that holds `pos`, or null (D19). */
const hiddenCellNoteAt = (state: EditorState, pos: number): number | null => {
  const cellNote = cellNoteAround(state.doc.resolve(pos))
  return cellNote !== null && isCellNoteHidden(state, cellNote) ? cellNote : null
}

/** The engine behind the channel's commands. Every step is metadata-only, and synchronous. */
/** What the view scanned of the cards last (YAZ-5378): the controller and the view share it. */
interface CardScan {
  scanned: ScannedCard[]
}

const spotsOf = (scanned: readonly ScannedCard[]): CardSpot[] => scanned.map(({ pos, count }) => ({ pos, count }))

/** A card match's text as drawn, from the last scan. */
const rangeOf = (scan: CardScan, match: Match | undefined): Range | null =>
  match?.card === undefined ? null : (scan.scanned.find((card) => card.pos === match.card!.pos)?.ranges[match.card.nth] ?? null)

const createController = (view: EditorView, channel: FindChannel, scan: CardScan): FindController => {
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
    // YAZ-4787: `current` opens what hides the active match only; `keep` opens nothing (no match is hidden then).
    const folds = channel.getState().folds
    const active = activeMatch()
    const positions = folds === 'keep' ? [] : folds === 'current' ? (active === null ? [] : [active.from]) : findState().matches.map((match) => match.from)
    const revealed = hiders(positions)
    const revealedHeadings = headingHiders(positions)
    fold([...revealed], false)
    foldHeadings([...revealedHeadings], false)
    if (differs(revealed, previous.revealed) || differs(revealedHeadings, previous.revealedHeadings))
      dispatchMeta({ type: 'revealed', revealed, revealedHeadings })
    if (folds !== 'keep' && active !== null) openTableRun(active.from)
    followCellNotes()
  }
  /**
   * A match in a folded table row (a collapsed subheader section, YAZ-4899 item 20, or a "Fold N rows" run) opens the
   * run, so the match shows. A fold is in the file, so this is a document change (one ⌘Z), and it stays open.
   */
  const openTableRun = (pos: number): void => {
    const $pos = view.state.doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.spec.tableRole !== 'row') continue
      if (!rowFolded($pos.node(depth))) return
      const tr = unfoldRun(closeHistory(view.state.tr), $pos.before(depth - 1), $pos.index(depth - 1))
      if (tr.docChanged) view.dispatch(tr)
      return
    }
  }
  /**
   * D19: the card find opened closes when the active match is not in it; the hidden cell note that holds the active
   * match opens as a card. A card the reader closed meanwhile is no longer find's.
   */
  const followCellNotes = (): void => {
    let { opened } = findState()
    const match = activeMatch()
    if (opened !== null && cellNoteCardKey.getState(view.state)?.pos !== opened) opened = null
    if (opened !== null) {
      const cellNote = view.state.doc.nodeAt(opened)!
      if (match === null || match.from < opened || match.from >= opened + cellNote.nodeSize) {
        closeCellNote(view, false)
        opened = null
      }
    }
    const hidden = match === null ? null : hiddenCellNoteAt(view.state, match.from)
    if (hidden !== null) {
      // The cell note's cell: the one that holds its mark.
      const mark = markPosOf(view.state.doc, view.state.doc.nodeAt(hidden)!.attrs.label as string)
      const cell = mark === null ? null : cellPosAround(view.state.doc.resolve(mark))
      if (cell !== null && openCellNote(view, cell, false)) opened = cellNoteCardKey.getState(view.state)?.pos ?? null
    }
    if (opened !== findState().opened) dispatchMeta({ type: 'opened', opened })
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
    // A match in a card's drawn text (YAZ-5378): its text, as the page centres a highlight.
    if (match.card !== undefined) {
      const range = rangeOf(scan, match)
      if (range !== null) scrollToRange(range)
      return
    }
    // A match in a code block (YAZ-4787 demo): CodeMirror draws only the lines on screen, so it scrolls there itself.
    if (scrollCodeMatch(view, match)) return
    const { node } = view.domAtPos(match.from)
    const element = view.dom.querySelector(`.${FIND_ACTIVE_CLASS}`) ?? (node instanceof Element ? node : node.parentElement)
    // A match in the open cell note card (YAZ-3818, round 4 of the demo): its cell shows, the least scroll, and the
    // card scrolls to the match; the page never centres on a card.
    if (element?.closest('.cell-note--open') != null) {
      revealOpenCell(view)
      showInCard(view, element.getBoundingClientRect())
      return
    }
    element?.scrollIntoView?.({ block: 'center' })
  }
  return {
    search: (query) => {
      scan.scanned = scanCards(view, query)
      dispatchMeta({ type: 'query', query, cards: spotsOf(scan.scanned) })
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
      // A card's match lands on the card, selected whole, as a click on it does.
      if (match !== null)
        transaction.setSelection(
          match.card !== undefined && isCardNode(transaction.doc.nodeAt(match.from)) ? NodeSelection.create(transaction.doc, match.from) : TextSelection.create(transaction.doc, match.from),
        )
      view.dispatch(transaction)
      view.focus()
    },
  }
}

/** A modifier alone is not a key in the page: ⌘ on its way to a shortcut must not move the thread. */
const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Alt', 'Control', 'CapsLock'])

/**
 * A click or a key in the page gives the thread back to the caret (YAZ-3200), also when the caret
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
            // Matches are RECOMPUTED, not mapped: an edit creates and destroys them, not just moves them. With `keep`
            // (YAZ-4787) a fold or an unfold changes what shows, so it re-counts too.
            const shownOnly = channel.getState().folds === 'keep'
            const recompute =
              meta?.type === 'query' ||
              meta?.type === 'cards' ||
              (query !== '' && (transaction.docChanged || (shownOnly && (hasOutlineFoldMeta(transaction) || hasHeadingFoldMeta(transaction)))))
            const revealed = carryRevealed(transaction, meta?.type === 'revealed' ? meta.revealed : undefined, previous.revealed)
            const revealedHeadings = carryRevealed(
              transaction,
              meta?.type === 'revealed' ? meta.revealedHeadings : undefined,
              previous.revealedHeadings,
            )
            const opened = carryOpened(transaction, meta, previous.opened)
            const cards = carryCards(transaction, meta, previous.cards)
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
              revealedHeadings === previous.revealedHeadings &&
              opened === previous.opened &&
              cards === previous.cards
            )
              return previous
            const matches = recompute ? findMatches(newState, query, zoomedRange(transaction, oldState, newState), links, shownOnly, cards) : previous.matches
            return { query, matches, activeIndex: nextActive(previous, meta, matches, newState.selection.from), revealed, revealedHeadings, opened, onMatch, cards }
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
                // A card's match is painted in the card's own drawing (YAZ-5378), not by a decoration.
                if (match.card !== undefined) return []
                const attrs = { class: index === activeIndex ? `${FIND_MATCH_CLASS} ${FIND_ACTIVE_CLASS}` : FIND_MATCH_CLASS }
                const ranges = match.pill === undefined ? [[match.from, match.to]] : shownRanges(match.pill)
                return ranges.map(([from, to]) => Decoration.inline(from, to, attrs))
              }),
            )
          },
        },
        view: (editorView) => {
          const scan: CardScan = { scanned: [] }
          const unbind = channel.bind(createController(editorView, channel, scan))
          /** This view's card paint (YAZ-5378): the scanned ranges of the matches the state holds. */
          const owner = {}
          let destroyed = false
          const paintCards = () => {
            const { matches, activeIndex } = findKey.getState(editorView.state) ?? EMPTY
            const ranges = matches.flatMap((match) => rangeOf(scan, match) ?? [])
            paintFindRanges(owner, ranges, rangeOf(scan, matches[activeIndex]))
          }
          /** The cards counted again; a count or a place that changed goes to the state, which paints through `sync`. */
          const rescan = () => {
            const find = findKey.getState(editorView.state) ?? EMPTY
            scan.scanned = scanCards(editorView, find.query)
            const spots = spotsOf(scan.scanned)
            if (sameCards(spots, find.cards)) return paintCards()
            // Not inside the view's own update: the state takes the new count one task later.
            queueMicrotask(() => {
              if (destroyed || (findKey.getState(editorView.state) ?? EMPTY).query !== find.query) return
              editorView.dispatch(editorView.state.tr.setMeta(findKey, { type: 'cards', cards: spots } satisfies FindMeta))
            })
          }
          /** While a search is open, a change in a card's drawing (Done, an embed that read its card, a title) counts again. */
          let observer: MutationObserver | null = null
          let pending = false
          const watch = (on: boolean) => {
            if (on === (observer !== null) || typeof MutationObserver === 'undefined') return
            if (!on) {
              observer?.disconnect()
              observer = null
              return
            }
            observer = new MutationObserver((records) => {
              if (pending || !records.some((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.card, .card-embed') != null)) return
              pending = true
              queueMicrotask(() => {
                pending = false
                if (!destroyed) rescan()
              })
            })
            observer.observe(editorView.dom, { childList: true, subtree: true, characterData: true })
          }
          /**
           * The title widgets this search marked (S9). Marked again when the find state or the doc changed, or when a redraw
           * took a marked widget away (a new one has no classes); not on each caret move (YAZ-3910 A12). ProseMirror ignores
           * a widget's class changes (no DOM read, no transaction).
           */
          let marked: HTMLElement[] = []
          // The code blocks this search painted (YAZ-4787 demo), cleared when their matches go.
          let painted: ReadonlySet<CodeMirrorView> = new Set()
          let paintedBlocks = 0
          const markTitles = (matches: readonly Match[], activeIndex: number) => {
            for (const el of marked) el.classList.remove(FIND_MATCH_CLASS, FIND_ACTIVE_CLASS)
            marked = []
            let widgets: Map<number, HTMLElement> | undefined
            matches.forEach((match, index) => {
              if (match.pill?.title == null) return
              widgets ??= titleWidgets(editorView)
              const widget = widgets.get(match.pill.to) ?? widgets.get(match.pill.from + 2)
              if (widget === undefined) return
              widget.classList.add(FIND_MATCH_CLASS)
              if (index === activeIndex) widget.classList.add(FIND_ACTIVE_CLASS)
              marked.push(widget)
            })
          }
          // An edit under an open find changes the count without anyone asking; the bar hears it here.
          const sync = (_view: EditorView, prevState: EditorState) => {
            const find = findKey.getState(editorView.state) ?? EMPTY
            const { matches, activeIndex } = find
            const changed = find !== findKey.getState(prevState) || editorView.state.doc !== prevState.doc
            // The cards are counted on the query (`search`); an edit may change them: counted again then.
            if (find.query !== '' && editorView.state.doc !== prevState.doc) rescan()
            else if (changed) paintCards()
            watch(find.query !== '')
            if (changed || marked.some((el) => !el.isConnected)) markTitles(matches, activeIndex)
            // A code block drawn after the search (a fold opened, a block drawn again) has no marks yet: while there are
            // matches, a change in the page's code blocks paints again. No search: nothing is counted (typing stays light).
            const blocks = matches.length === 0 && painted.size === 0 ? 0 : editorView.dom.querySelectorAll('.cm-content').length
            if (changed || blocks !== paintedBlocks || [...painted].some((cm) => !cm.dom.isConnected)) {
              painted = paintCodeBlocks(editorView, matches, activeIndex, painted)
              paintedBlocks = blocks
            }
            channel.sync({ total: matches.length, activeIndex })
          }
          return {
            update: sync,
            destroy: () => {
              destroyed = true
              watch(false)
              paintFindRanges(owner, [], null)
              unbind()
            },
          }
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
