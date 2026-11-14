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
import type { FindChannel, FindController, FindResult } from './findChannel'

/** A box that reads its card lazily (a card embed) reads it now: find asked (`cardEmbed.ts` listens). */
export const CARD_FIND_READ = 'mdapp:card-find-read'

/**
 * The card's text the reader sees: the title in a card's band (shown) or a card file tab's band (YAZ-5392: `PageTitle`
 * right in the band), the sides of a card that is not edited or folded, and the card editor's text while it is. The tab's
 * selector starts at `.card-file__page`, inside the finder's root: jsdom's selector engine never matches the root itself.
 */
export const CARD_FIND_REGIONS = [
  '.card__title:not([hidden]) .page-title__text',
  '.card-file__page .card-band > .page-title .page-title__text',
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
function runsOf(region: Element): Run[] {
  const runs: Run[] = []
  let current: Run | null = null
  let block: Element | null = null
  const walker = region.ownerDocument.createTreeWalker(region, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node instanceof Element && node.matches(NOT_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.tagName === 'BR') current = null
      continue
    }
    const text = node as Text
    if (text.data === '') continue
    const at = text.parentElement?.closest(BLOCK) ?? region
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
function regionMatches(region: Element, needle: string): Range[] {
  const ranges: Range[] = []
  for (const run of runsOf(region)) {
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

/** Every match of `query` in the card text under `root` (a card, an embed, a card file tab), in reading order. */
export function cardMatches(root: Element, query: string): Range[] {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const regions = [...(root.matches(CARD_FIND_REGIONS) ? [root] : []), ...root.querySelectorAll(CARD_FIND_REGIONS)]
  return regions.flatMap((region) => regionMatches(region, needle))
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

/** Centres a match: its text's element, as the page centres its highlight. jsdom has no `scrollIntoView`. */
export function scrollToRange(range: Range): void {
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
  const result = (): FindResult => ({ total: matches.length, activeIndex: active })
  const paint = (): void => paintFindRanges(owner, matches, matches[active] ?? null)
  const scan = (): void => {
    const el = root()
    matches = el === null ? [] : cardMatches(el, query)
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
      paint()
      channel.sync(result())
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
  }
  const controller: FindController = {
    search: (next) => {
      query = next
      active = 0
      scan()
      paint()
      watch(query !== '')
      if (matches[active] !== undefined) scrollToRange(matches[active])
      return result()
    },
    step: (delta) => {
      if (matches.length > 0) active = (active + delta + matches.length) % matches.length
      paint()
      if (matches[active] !== undefined) scrollToRange(matches[active])
      return result()
    },
    close: () => {
      watch(false)
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
