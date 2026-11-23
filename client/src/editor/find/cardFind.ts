/**
 * ⌘F inside cards (YAZ-5378): what find reads in a card, and how it paints there. Shared by the page's find
 * (`findInPage.ts`: the page's cards and card embeds) and the card file tab (`createCardFinder`), so a card is searched
 * one way wherever it shows.
 *
 * A card draws its own DOM (`renderCard`, the head's `PageTitle`): its Markdown source is not what the reader sees (`**`,
 * `{{…}}`, `---`, link IDs), and ProseMirror's decorations never reach it. So find reads the card AS DRAWN: the text of
 * its title band and of its sides (`CARD_FIND_REGIONS`), case-insensitive and literal, a match within one block (a
 * paragraph, a list item, a cell), as the page's find matches within one textblock. Hidden words count as text: their
 * word is in the card's DOM in every mode (`.card__word`), and the page shows them. The card's buttons, its sound
 * player, the ID and the Reviews strip are not its text.
 *
 * Painting is the CSS Custom Highlight API (`::highlight(find-match)`, find.css): ranges over the card's text, no DOM
 * change, so neither ProseMirror, React (the title) nor the card's own redraws see anything. Each finder owns its ranges
 * (`paintFindRanges`), and the highlights are their union.
 */
import type { FindFolds } from '@shared/types'
import type { FindChannel, FindController, FindResult } from './findChannel'
import { foldableSideAt, openFoldedSideAt, setSideOpen } from '../card/cardFold'

/** A box that reads its card lazily (a card embed) reads it now: find asked (`cardEmbed.ts` listens). */
export const CARD_FIND_READ = 'mdapp:card-find-read'

/**
 * The card's text the reader sees: the title in a card's band (shown), a card file tab's too (YAZ-5392), the sides of a card
 * that is not edited or folded, and the card editor's text while it is.
 */
export const CARD_FIND_REGIONS = [
  '.card__title:not([hidden]) .page-title__text',
  '.card-file__page > .card > .card-band .page-title__text',
  '.card:not(.card--editing):not(.card-embed--folded) > .card__body',
  '.card--editing .card__editor .ProseMirror',
].join(', ')

/** Never a card's text: its controls, its sound player, an empty card's hint. */
const NOT_TEXT = 'button, textarea, audio, video, svg, .card__audio, .card__empty'

/** What starts a new run: a match never crosses one, as the page's never crosses a textblock. */
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dt, dd, figcaption, div'

interface Run {
  text: string
  pieces: { node: Text; start: number }[]
}

/** The region's text as runs: adjacent text in one block; a `<br>` or a new block starts the next run. */
function runsOf(region: Element, skip: string = NOT_TEXT, blocks: string = BLOCK): Run[] {
  const runs: Run[] = []
  let current: Run | null = null
  let block: Element | null = null
  const walker = region.ownerDocument.createTreeWalker(region, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node instanceof Element && node.matches(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.tagName === 'BR') current = null
      continue
    }
    const text = node as Text
    if (text.data === '') continue
    const at = text.parentElement?.closest(blocks) ?? region
    if (current === null || at !== block) {
      current = { text: '', pieces: [] }
      runs.push(current)
      block = at
    }
    current.pieces.push({ node: text, start: current.text.length })
    current.text += text.data
  }
  return runs
}

/** The text node and offset at `offset` in the run; `end`: a boundary goes to the earlier node. */
function pointAt(run: Run, offset: number, end: boolean): [Text, number] {
  for (let i = run.pieces.length - 1; i >= 0; i--) {
    const piece = run.pieces[i]
    if (end ? offset > piece.start : offset >= piece.start) return [piece.node, offset - piece.start]
  }
  return [run.pieces[0].node, 0]
}

/** Each case-insensitive literal occurrence of `needle` (already lower case) in the region, as DOM ranges in order. */
function regionMatches(region: Element, needle: string, skip?: string, blocks?: string): Range[] {
  const ranges: Range[] = []
  for (const run of runsOf(region, skip, blocks)) {
    const haystack = run.text.toLowerCase()
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
      const range = region.ownerDocument.createRange()
      range.setStart(...pointAt(run, i, false))
      range.setEnd(...pointAt(run, i + needle.length, true))
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Every match of `query` in ALL the text under `region`, by the same rule (case-insensitive, literal, within one block),
 * skipping a card's controls and whatever else `skip` names too: the phone's read-only page (YAZ-5456), which has no
 * editor, finds in its drawn page with it.
 */
export function textMatches(region: Element, query: string, skip?: string): Range[] {
  const needle = query.toLowerCase()
  return needle === '' ? [] : regionMatches(region, needle, skip === undefined ? NOT_TEXT : `${NOT_TEXT}, ${skip}`)
}

/**
 * The same rule (case-insensitive, literal, within one block) with the caller's own `skip` and `blocks` in place of a
 * card's: Settings' section find (YAZ-5968) reads its buttons' words, each button a block of its own.
 */
export function drawnTextMatches(region: Element, query: string, { skip, blocks }: { skip: string; blocks: string }): Range[] {
  const needle = query.toLowerCase()
  return needle === '' ? [] : regionMatches(region, needle, skip, blocks)
}

/** A folded card side (YAZ-5904): with "Keep folded" (YAZ-5970) its text is not what shows. */
const FOLDED_SIDE = '.card__side[hidden]'

/**
 * Every match of `query` in the card text under `root` (a card, an embed, a card file tab), in reading order.
 * `shownOnly` (⌘F's "Keep folded", YAZ-5970): a folded card side's text does not count.
 */
export function cardMatches(root: Element, query: string, shownOnly = false): Range[] {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const regions = [...(root.matches(CARD_FIND_REGIONS) ? [root] : []), ...root.querySelectorAll(CARD_FIND_REGIONS)]
  return regions.flatMap((region) => regionMatches(region, needle, shownOnly ? `${NOT_TEXT}, ${FOLDED_SIDE}` : undefined))
}

/**
 * ⌘F'S FOLD CHOICE ON CARD SIDES (YAZ-5970), as on folded bullets (YAZ-4787): "Open every match" opens each folded side
 * that holds a match; "Open the one you are on" opens the current match's side and folds it again when find moves off
 * it; "Keep folded" opens none (and `cardMatches(…, true)` counts none in them). Only the sides find opened fold again:
 * one the reader opened stays. On close the landing's side stays open, as a bullet's does.
 */
export interface CardSideFolds {
  /** Opens what `folds` asks for these matches; folds again what find opened and no longer should be. */
  follow(folds: FindFolds, ranges: readonly Range[], active: Range | null): void
  /** Find closes: every side it opened folds again, but the landing's. */
  land(active: Range | null): void
}

export function createCardSideFolds(): CardSideFolds {
  const opened = new Set<HTMLElement>()
  return {
    follow(folds, ranges, active) {
      const targets = folds === 'keep' ? [] : folds === 'current' ? (active === null ? [] : [active]) : ranges
      const want = new Set<HTMLElement>()
      for (const range of targets) {
        const side = foldableSideAt(range.startContainer)
        if (side !== null && (side.hidden || opened.has(side))) want.add(side)
      }
      for (const side of [...opened]) {
        if (want.has(side)) continue
        opened.delete(side)
        if (side.isConnected && !side.hidden) setSideOpen(side, false, false)
      }
      for (const side of want) {
        if (!side.hidden) continue
        // A passing open: a redraw of the card does not keep it (YAZ-5918's memory is the reader's and the landing's).
        setSideOpen(side, true, false)
        opened.add(side)
      }
    },
    land(active) {
      const keep = active === null ? null : foldableSideAt(active.startContainer)
      for (const side of opened) {
        if (!side.isConnected || side.hidden) continue
        // The landing stays open, kept for the page as a click keeps it; the rest fold again.
        if (side === keep) setSideOpen(side, true)
        else setSideOpen(side, false, false)
      }
      opened.clear()
    },
  }
}

/** Each finder's painted ranges; the highlights are their union. */
const painted = new Map<object, { ranges: readonly Range[]; active: Range | null }>()

/** The ranges painted now, for tests (jsdom has no highlights): each with whether it is the active match. */
export const paintedFindRanges = (): { text: string; active: boolean }[] =>
  [...painted.values()].flatMap(({ ranges, active }) => ranges.map((range) => ({ text: range.toString(), active: range === active })))

interface HighlightRegistry {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

/** Paints `owner`'s matches (none: clears them), `active` as the active one. */
export function paintFindRanges(owner: object, ranges: readonly Range[], active: Range | null): void {
  if (ranges.length === 0) painted.delete(owner)
  else painted.set(owner, { ranges, active })
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights
  const Made = (globalThis as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight
  if (registry === undefined || Made === undefined) return
  const all = [...painted.values()]
  const rest = all.flatMap(({ ranges: r, active: a }) => r.filter((range) => range !== a))
  const actives = all.flatMap(({ active: a }) => (a === null ? [] : [a]))
  registry.set('find-match', new Made(...rest))
  const top = new Made(...actives)
  top.priority = 1
  registry.set('find-match-active', top)
}

/**
 * Centres a match: its text's element, as the page centres its highlight. jsdom has no `scrollIntoView`. A match in a
 * folded card side (YAZ-5904) opens that side first: find reads every side, and the one it lands on shows.
 */
export function scrollToRange(range: Range): void {
  openFoldedSideAt(range.startContainer)
  const node = range.startContainer
  const element = node instanceof Element ? node : node.parentElement
  element?.scrollIntoView?.({ block: 'center' })
}

/**
 * A card file tab's find (YAZ-5378 part 2): the page's bar and channel, over the card text under `root()`. The first
 * match is the active one; next and back wrap; an edit, a rename or a redraw under an open search counts again. Close
 * clears the paint and gives the keys back to the tab (`onClose`).
 */
export function createCardFinder(channel: FindChannel, root: () => Element | null, onClose?: () => void): () => void {
  const owner = {}
  let query = ''
  let matches: Range[] = []
  let active = -1
  let observer: MutationObserver | null = null
  const sides = createCardSideFolds()
  const result = (): FindResult => ({ total: matches.length, activeIndex: active })
  const paint = (): void => paintFindRanges(owner, matches, matches[active] ?? null)
  /** The fold choice on the card's folded sides (YAZ-5970); after it, the current match is where it lands. */
  const follow = (): void => sides.follow(channel.getState().folds, matches, matches[active] ?? null)
  const scan = (): void => {
    const el = root()
    matches = el === null ? [] : cardMatches(el, query, channel.getState().folds === 'keep')
    active = matches.length === 0 ? -1 : Math.min(Math.max(active, 0), matches.length - 1)
  }
  /** While a search is open the card's text is watched: an edit or a redraw counts again. */
  const watch = (on: boolean): void => {
    observer?.disconnect()
    observer = null
    const el = root()
    if (!on || el === null || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver(() => {
      scan()
      // A redraw folds its sides afresh: the fold choice opens the current match's again (a second pass changes nothing).
      follow()
      paint()
      channel.sync(result())
    })
    // A side that folds or opens changes what "Keep folded" counts (YAZ-5970).
    observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] })
  }
  const controller: FindController = {
    search: (next) => {
      query = next
      active = 0
      // "Keep folded" counts what shows: the sides find opened fold first.
      if (channel.getState().folds === 'keep') sides.follow('keep', [], null)
      scan()
      follow()
      paint()
      watch(query !== '')
      if (matches[active] !== undefined) scrollToRange(matches[active])
      return result()
    },
    step: (delta) => {
      if (matches.length > 0) active = (active + delta + matches.length) % matches.length
      follow()
      paint()
      if (matches[active] !== undefined) scrollToRange(matches[active])
      return result()
    },
    close: () => {
      watch(false)
      sides.land(matches[active] ?? null)
      matches = []
      active = -1
      paint()
      onClose?.()
    },
  }
  const unbind = channel.bind(controller)
  return () => {
    watch(false)
    paintFindRanges(owner, [], null)
    unbind()
  }
}
