/**
 * ⌘F IN SETTINGS (YAZ-5968): find in the OPEN section only — the words the pane shows: row names, help text, group
 * titles and the choices' labels (a Segmented button's word, a select's shown option). The all-sections search
 * (`searchSettings.ts`) is a different thing and is left alone.
 *
 * The rule is the page's (`cardFind.ts`): case-insensitive and literal, a match within one block — here each button
 * and each select is a block of its own, so "Always" and "Never" side by side never make one word. Painting is the
 * page find's: the CSS Custom Highlight API over ranges (`::highlight(find-match)` / `find-match-active`, find.css),
 * no DOM change to a row. A select's shown option counts and is scrolled to; the native select draws its own text, so
 * no highlight shows on it.
 *
 * While the bar searches the pane is watched: a row that shows or hides, a choice that changes, counts again.
 */
import { drawnTextMatches, paintFindRanges } from '../editor/find/cardFind'
import type { FindChannel, FindController, FindResult } from '../editor/find/findChannel'
import { leastScroll, SHOW_GAP } from '../editor/find/leastScroll'
import { cssZoom } from '../lib/cssZoom'

/** Never the section's words: the find bar itself, what is hidden, glyphs, typed values, a select's other options. */
const NOT_TEXT = '.find-bar-dock, [hidden], [aria-hidden="true"], svg, script, style, textarea, input, option:not(:checked)'

/** What starts a new run: the page's blocks, and each control. */
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dt, dd, figcaption, div, section, button, label, select, summary'

/** Where a match shows: its select for an option (the select draws it), else the element holding its text. */
const shownElement = (range: Range): Element | null => {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest('select') ?? el
}

/** Every match of `query` in the pane's shown text, in reading order. jsdom has no `checkVisibility`: there all shows. */
export function sectionMatches(root: Element, query: string): Range[] {
  return drawnTextMatches(root, query, { skip: NOT_TEXT, blocks: BLOCKS }).filter((range) => {
    const el = shownElement(range)
    return el instanceof HTMLElement && (el.checkVisibility?.() ?? true)
  })
}

/** Brings a match into the pane by ⌘F's least-scroll rule, below the find bar that sticks to the pane's top. */
export function revealMatch(range: Range, pane: HTMLElement): void {
  const el = shownElement(range)
  const box = el instanceof HTMLSelectElement || typeof range.getBoundingClientRect !== 'function' ? el?.getBoundingClientRect() : range.getBoundingClientRect()
  if (box === undefined) return
  const view = pane.getBoundingClientRect()
  const bar = pane.querySelector('.find-bar')?.getBoundingClientRect()
  const top = bar === undefined ? view.top : Math.max(view.top, bar.bottom)
  const dy = leastScroll({ start: box.top, end: box.bottom }, { start: top, end: view.bottom }, SHOW_GAP)
  if (dy !== 0) pane.scrollTop += dy / cssZoom(pane)
}

/**
 * Binds the section find to `channel` over the pane `root()`. The first match is the current one; next and back wrap.
 * Close clears the paint and calls `onClose` (the dialog takes the focus back). The returned function unbinds.
 */
export function createSectionFinder(channel: FindChannel, root: () => HTMLElement | null, onClose?: () => void): () => void {
  const owner = {}
  let query = ''
  let matches: Range[] = []
  let active = -1
  let observer: MutationObserver | null = null
  let watched: HTMLElement | null = null
  let recountTimer: ReturnType<typeof setTimeout> | undefined
  const result = (): FindResult => ({ total: matches.length, activeIndex: active })
  const paint = (): void => paintFindRanges(owner, matches, matches[active] ?? null)
  const scan = (): void => {
    const el = root()
    matches = el === null ? [] : sectionMatches(el, query)
    active = matches.length === 0 ? -1 : Math.min(Math.max(active, 0), matches.length - 1)
  }
  const show = (): void => {
    const el = root()
    if (el !== null && matches[active] !== undefined) revealMatch(matches[active], el)
  }
  const recount = (): void => {
    scan()
    paint()
    channel.sync(result())
  }
  /** A select's change sets a property, not the DOM: its shown option is read again once React has settled. */
  const onChange = (): void => {
    clearTimeout(recountTimer)
    recountTimer = setTimeout(recount, 0)
  }
  const watch = (on: boolean): void => {
    observer?.disconnect()
    observer = null
    watched?.removeEventListener('change', onChange)
    watched = null
    clearTimeout(recountTimer)
    const el = root()
    if (!on || el === null) return
    watched = el
    el.addEventListener('change', onChange)
    if (typeof MutationObserver === 'undefined') return
    observer = new MutationObserver((records) => {
      // The bar's own count changing is not the section's text.
      if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.find-bar-dock') != null)) return
      recount()
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open'] })
  }
  const controller: FindController = {
    search: (next) => {
      query = next
      active = 0
      scan()
      paint()
      watch(query !== '')
      show()
      return result()
    },
    step: (delta) => {
      if (matches.length > 0) active = (active + delta + matches.length) % matches.length
      paint()
      show()
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
