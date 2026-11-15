import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { paintFindRanges, textMatches } from '@client/editor/find/cardFind'
import { landingTop } from '../headings'

/**
 * FIND IN PAGE (YAZ-5456), on the phone's drawn page (no editor). The Mac's rules (`findInPage.ts`, `cardFind.ts`):
 * case-insensitive and literal, a match within one block, never across one; a card's drawn text counts, its controls
 * and its ID do not. The matching is the Mac's own (`textMatches`), and so is the paint: the CSS Custom Highlight API
 * (`paintFindRanges`, `::highlight(find-match)`), ranges over the text, no change to the page's DOM.
 *
 * "2 of 7" (the Mac's words; "0 of 0" for none), ↑ and ↓ step (and wrap), Enter steps on, Shift-Enter back; each step
 * puts the match in the upper third of the screen. ✕ or Escape closes, and the paint goes. A page that draws again (a
 * long page still drawing its slices, or the sync's redraw) is found again, at the same match.
 *
 * A Safari older than 17.2 has no highlights: the count and the steps work, the match is not painted.
 */
const SKIP = '.card__head, .card-embed__head, .linked-mentions'
const TYPE_MS = 80
const REDRAW_MS = 150
/** Each match lands this far down the screen (a share of its height). */
export const MATCH_PLACE = 1 / 3

export default function FindBar({ host, onClose }: { host: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState({ total: 0, active: -1 })
  const input = useRef<HTMLInputElement>(null)
  const state = useRef({ query: '', matches: [] as Range[], active: -1 })
  const owner = useRef({})

  const show = (scroll: boolean) => {
    const { matches, active } = state.current
    const range = matches[active] ?? null
    paintFindRanges(owner.current, matches, range)
    setResult({ total: matches.length, active })
    const scroller = host.current?.closest<HTMLElement>('.screen') ?? null
    if (scroll && range !== null && scroller !== null) scroller.scrollTop = landingTop(scroller, range, MATCH_PLACE)
  }
  const scan = (keep: boolean) => {
    const el = host.current
    const s = state.current
    s.matches = el === null ? [] : textMatches(el, s.query, SKIP)
    s.active = s.matches.length === 0 ? -1 : keep ? Math.min(Math.max(s.active, 0), s.matches.length - 1) : 0
  }

  useLayoutEffect(() => input.current?.focus(), [])
  // Typing: found again a moment after the last letter, from the first match.
  useEffect(() => {
    const timer = setTimeout(() => {
      state.current.query = query
      scan(false)
      show(true)
    }, TYPE_MS)
    return () => clearTimeout(timer)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  // The page draws again: found again, at the same match, with no jump.
  useEffect(() => {
    const el = host.current
    if (el === null || typeof MutationObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (state.current.query === '') return
        scan(true)
        show(false)
      }, REDRAW_MS)
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [host]) // eslint-disable-line react-hooks/exhaustive-deps
  // Closing takes the paint away.
  useEffect(() => () => paintFindRanges(owner.current, [], null), [])

  const step = (delta: number) => {
    const s = state.current
    if (s.query !== query) {
      s.query = query
      scan(false)
    } else if (s.matches.length > 0) s.active = (s.active + delta + s.matches.length) % s.matches.length
    show(true)
  }
  const count = query === '' ? '' : result.total === 0 ? '0 of 0' : `${result.active + 1} of ${result.total}`
  return (
    <div className="find-line" role="search">
      <input
        ref={input}
        className="find-line__input"
        type="search"
        enterKeyHint="search"
        aria-label="Find in page"
        placeholder="Find in page"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <span className="find-line__count" role="status" aria-live="polite">
        {count}
      </span>
      <button type="button" className="find-line__btn" aria-label="Previous match" disabled={result.total === 0} onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" className="find-line__btn" aria-label="Next match" disabled={result.total === 0} onClick={() => step(1)}>
        ↓
      </button>
      <button type="button" className="find-line__btn" aria-label="Close find" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
