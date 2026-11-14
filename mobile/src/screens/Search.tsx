import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchCandidate } from '@client/search/searchCandidates'
import { useApp } from '../app/AppState'
import type { Route } from '../app/nav'
import { buildRows, emptyBoxRows, findRows, type PhoneType } from '../search/searchRun'
import { keepPlace, keepSearch, searchStateOf, takeSearchNotice } from '../search/searchState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import '../search/search.css'

/** Rows drawn at first, and added at each "Show more" (5,000 pages are not drawn at once). */
const STEP = 100

/**
 * THE SEARCH TAB (YAZ-5079, 4C; decisions 10 and 21, round 15 item 2). One box: cards and pages in one list, by title,
 * alias and ID, as the Mac's search finds them (`searchRun.ts`). The list changes with each letter, from the phone's own
 * index, so it works with no signal. The box empty: the list of pages (there is no Pages tab). The Type filter: All
 * types, Pages, Cards (Cards only while the vault's Review is on). A tap on a page opens it read only; a tap on a card
 * opens the card alone (round 12, item 10). The words follow the vault's word for "page" (`unit`).
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
  const list = useMemo(() => (rows !== null && empty ? emptyBoxRows(rows, kind) : null), [rows, empty, kind])
  const results = empty ? list : found

  // YAZ-5211: the list's scroll place is kept as the person scrolls, and given back when the tab shows again.
  useEffect(() => keepPlace(shown), [shown])
  const placed = useRef(false)
  useLayoutEffect(() => {
    const scroller = section.current?.closest('.screen')
    if (scroller == null || placed.current || results === null) return
    placed.current = true
    scroller.scrollTop = held.scroll
  }, [results, held.scroll])
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
      <input
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
      />
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
      {results !== null && results.length > 0 && (
        <>
          {empty && <h2 className="section">{kind === 'cards' ? 'Cards' : unit('Pages')}</h2>}
          <ul className="rows search__rows" aria-label={empty ? (kind === 'cards' ? 'Cards' : unit('Pages')) : 'Results'}>
            {results.slice(0, shown).map((row) => (
              <li key={`${row.path}\n${row.label}`}>
                <ResultRow row={row} />
              </li>
            ))}
          </ul>
          {results.length > shown && <ShowMore onMore={() => setShown((n) => n + STEP * 2)} />}
        </>
      )}
    </section>
  )
}

/** Where a row opens: a page read only; a card alone (a card file's card, or a card in its page). */
function routeOf(row: SearchCandidate): Route {
  if (row.card === true) return { kind: 'card', path: row.page ?? row.path, id: row.id ?? '' }
  return { kind: 'page', path: row.path }
}

function ResultRow({ row }: { row: SearchCandidate }) {
  const app = useApp()
  const side = row.card === true ? (row.id === undefined ? 'card' : `card · ${row.id}`) : app.unit('page')
  return (
    <button type="button" className="row row__button" onClick={() => app.go({ type: 'open', route: routeOf(row) })}>
      <span className="row__main">{row.label}</span>
      <span className="row__side">{side}</span>
    </button>
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
