import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchCandidate } from '@client/search/searchCandidates'
import { useApp } from '../app/AppState'
import { buildRows, emptyBoxRows, findRows, type PhoneType } from '../search/searchRun'
import { keepPlace, keepSearch, searchStateOf, takeSearchNotice } from '../search/searchState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import '../search/search.css'

/** The tree (YAZ-5438): its own chunk, loaded when the box is empty. */
const SearchTree = lazy(() => import('../search/SearchTree'))
/** The result rows with their icons: the same chunk (the first load stays under its ceiling, YAZ-5377). */
const ResultList = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.ResultList })))

/** Rows drawn at first, and added at each "Show more" (5,000 pages are not drawn at once). */
const STEP = 100

/**
 * THE SEARCH TAB (YAZ-5079, 4C; decisions 10 and 21, round 15 item 2). One box: cards and pages in one list, by title,
 * alias and ID, as the Mac's search finds them (`searchRun.ts`). The list changes with each letter, from the phone's own
 * index, so it works with no signal. The Type filter: All types, Pages, Cards (Cards only while the vault's Review is
 * on). A tap on a page opens it read only; a tap on a card opens the card alone (round 12, item 10). The words follow
 * the vault's word for "page" (`unit`).
 *
 * YAZ-5438: the box empty shows the Mac's sidebar tree (`SearchTree`): folders that open and close, pages and card
 * files, with the Mac's icons and order (Cards: the cards, each with the card icon). A result row has the same icons
 * (a page, a card file, a card in a page) in place of the word "page".
 * YAZ-5439: the ✕ at the right of the box (and Escape) clears the text and leaves the search: the keyboard goes away
 * and the tree shows again.
 */
export function Search() {
  const app = useApp()
  const { unit, vaultKey } = app
  const data = useVaultData()
  const held = searchStateOf(vaultKey)
  const [query, setQuery] = useState(held.query)
  const [type, setType] = useState<PhoneType>(held.type)
  const [menu, setMenu] = useState(false)
  const [rows, setRows] = useState<SearchCandidate[] | null>(null)
  const [found, setFound] = useState<SearchCandidate[] | null>(null)
  const [shown, setShown] = useState(held.shown ?? STEP)
  /** The query and Type the rows shown are for: a new one starts the list again at its top (YAZ-5211). */
  const listOf = useRef(`${held.query}\n${held.type}`)
  const section = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  /** YAZ-5439: clear the box and leave the search (the keyboard goes away). */
  const leave = () => {
    setQuery('')
    input.current?.blur()
  }
  const [notice] = useState(() => takeSearchNotice())
  const cards = data?.review.enabled ?? false
  // Cards is a choice only while Review is on, as on the Mac.
  const kind: PhoneType = type === 'cards' && !cards ? 'all' : type

  // The rows, built again when the index changes (R4: a new page is in search after the pass that brings it).
  useEffect(() => {
    if (data === null) return
    let live = true
    void buildRows({ records: data.records, letters: data.letters, cards: data.review.enabled }, uiSlicer(), () => live).then((built) => {
      if (live && built !== null) setRows(built)
    })
    return () => {
      live = false
    }
  }, [data])

  // Each letter searches again; a search that a newer letter replaced stops.
  useEffect(() => {
    keepSearch(vaultKey, query, kind)
    if (listOf.current !== `${query}\n${kind}`) {
      listOf.current = `${query}\n${kind}`
      setShown(STEP)
      keepPlace(STEP, 0)
    }
    if (rows === null || query.trim() === '') return setFound(null)
    let live = true
    void findRows(rows, query, kind, uiSlicer(), () => live).then((next) => {
      if (live && next !== null) setFound(next)
    })
    return () => {
      live = false
    }
  }, [rows, query, kind, vaultKey])

  const empty = query.trim() === ''
  const tree = empty && kind !== 'cards'
  const list = useMemo(() => (rows !== null && empty && kind === 'cards' ? emptyBoxRows(rows, kind) : null), [rows, empty, kind])
  const results = empty ? list : found

  // YAZ-5211: the list's scroll place is kept as the person scrolls, and given back when the tab shows again.
  useEffect(() => keepPlace(shown), [shown])
  const placed = useRef(false)
  useLayoutEffect(() => {
    const scroller = section.current?.closest('.screen')
    if (scroller == null || placed.current || (results === null && !(tree && data !== null))) return
    placed.current = true
    scroller.scrollTop = held.scroll
  }, [results, held.scroll, tree, data])
  useEffect(() => {
    const scroller = section.current?.closest('.screen')
    if (scroller == null) return
    const keep = () => keepPlace(null, scroller.scrollTop)
    scroller.addEventListener('scroll', keep, { passive: true })
    return () => scroller.removeEventListener('scroll', keep)
  }, [])

  const TYPES: [PhoneType, string][] = [
    ['all', 'All types'],
    ['pages', unit('Pages')],
    ...(cards ? [['cards', 'Cards'] as [PhoneType, string]] : []),
  ]

  return (
    <section className="search" aria-label="Search" ref={section}>
      <div className="search__field">
      <input
        ref={input}
        type="search"
        name="search"
        className="search__box"
        aria-label={unit('Search cards and pages')}
        placeholder={unit('Search cards and pages')}
        value={query}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            leave()
          }
        }}
      />
      {query !== '' && (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={leave}>
          <span aria-hidden>✕</span>
        </button>
      )}
      </div>
      <div className="search__bar">
        <button type="button" className="pill" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {TYPES.find(([value]) => value === kind)?.[1]} ▾
        </button>
      </div>
      {menu && (
        <div className="sheet search__menu" role="menu" aria-label="Type">
          {TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === kind}
              className="row row__button"
              onClick={() => {
                setType(value)
                setMenu(false)
              }}
            >
              <span className="row__main">{label}</span>
              {value === kind && <span className="row__side">✓</span>}
            </button>
          ))}
        </div>
      )}
      {notice !== null && (
        <p className="search__notice" role="status">
          {notice}
        </p>
      )}
      {data !== null && data.records.length === 0 && <p className="muted">{unit('No pages yet. They come with the next sync.')}</p>}
      {results !== null && !empty && results.length === 0 && <p className="muted">{`Nothing matches "${query.trim()}".`}</p>}
      {tree && data !== null && data.records.length > 0 && (
        <Suspense fallback={null}>
          <SearchTree data={data} cards={cards} shown={shown} more={<ShowMore onMore={() => setShown((n) => n + STEP * 2)} />} />
        </Suspense>
      )}
      {!tree && results !== null && results.length > 0 && (
        <>
          <Suspense fallback={null}>
            <ResultList rows={results.slice(0, shown)} cards={empty} />
          </Suspense>
          {results.length > shown && <ShowMore onMore={() => setShown((n) => n + STEP * 2)} />}
        </>
      )}
    </section>
  )
}

/** "Show more": a tap, or the end of the list coming into view. */
function ShowMore({ onMore }: { onMore: () => void }) {
  const el = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const button = el.current
    if (button === null || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: '400px 0px' })
    seen.observe(button)
    return () => seen.disconnect()
  }, [onMore])
  return (
    <button type="button" ref={el} className="btn btn--wide search__more" onClick={onMore}>
      Show more
    </button>
  )
}
