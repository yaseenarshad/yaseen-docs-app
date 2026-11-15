import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchCandidate } from '@client/search/searchCandidates'
import type { Scope } from '../search/lists'
import { useApp } from '../app/AppState'
import { buildRows, emptyBoxRows, findRows, type PhoneType } from '../search/searchRun'
import { keepPlace, keepSearch, searchStateOf, takeSearchNotice } from '../search/searchState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import '../search/search.css'

/** The tree (YAZ-5438): its own chunk, loaded when the box is empty. */
const SearchTree = lazy(() => import('../search/SearchTree'))
/** The cards of Cards (an empty box), and the results in the tree (YAZ-5447): the same chunk (the first load stays under its ceiling, YAZ-5377). */
const ResultList = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.ResultList })))
const ResultTree = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.ResultTree })))
/** The filter bar: Type and the vault's lists (YAZ-5452), the same chunk. */
const SearchBar = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.SearchBar })))
/** Collapse all / Expand all in the box (YAZ-5474), the same chunk. */
const FoldButton = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.FoldButton })))

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
 * YAZ-5447: with text, the results stand in that tree, as on the Mac's Search tab (`ResultTree`, `foundTree.ts`).
 * YAZ-5452: a list filter (Favorites, `SearchBar`) cuts the rows to that list before the search, so the text finds only in it.
 * YAZ-5474: with an empty box, the ✕'s place holds the Mac's Collapse all / Expand all (`folds.tsx`).
 */
export function Search() {
  const app = useApp()
  const { unit, vaultKey } = app
  const data = useVaultData()
  const held = searchStateOf(vaultKey)
  const [query, setQuery] = useState(held.query)
  const [type, setType] = useState<PhoneType>(held.type)
  const [scope, setScope] = useState<Scope | null>(null)
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
  const pool = useMemo(() => (rows !== null && scope !== null ? rows.filter((r) => scope.has(r.page ?? r.path)) : rows), [rows, scope])

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
    if (pool === null || query.trim() === '') return setFound(null)
    let live = true
    void findRows(pool, query, kind, uiSlicer(), () => live).then((next) => {
      if (live && next !== null) setFound(next)
    })
    return () => {
      live = false
    }
  }, [pool, query, kind, vaultKey])

  const empty = query.trim() === ''
  const tree = empty && kind !== 'cards'
  const list = useMemo(() => (pool !== null && empty && kind === 'cards' ? emptyBoxRows(pool, kind) : null), [pool, empty, kind])
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

  const more = () => setShown((n) => n + STEP * 2)

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
      {query !== '' ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={leave}>
          <span aria-hidden>✕</span>
        </button>
      ) : (
        tree &&
        data !== null &&
        data.records.length > 0 && (
          <Suspense fallback={null}>
            <FoldButton data={data} scope={scope} />
          </Suspense>
        )
      )}
      </div>
      <Suspense fallback={<div className="search__bar" />}>
        <SearchBar data={data} kind={kind} cards={cards} onType={setType} onScope={setScope} />
      </Suspense>
      {notice !== null && (
        <p className="search__notice" role="status">
          {notice}
        </p>
      )}
      {data !== null && data.records.length === 0 && <p className="muted">{unit('No pages yet. They come with the next sync.')}</p>}
      {tree && data !== null && data.records.length > 0 && (
        <Suspense fallback={null}>
          <SearchTree data={data} cards={cards} shown={shown} onMore={more} scope={scope} />
        </Suspense>
      )}
      {!empty && found !== null && data !== null && (
        <Suspense fallback={null}>
          <ResultTree data={data} rows={found} query={query} type={kind} shown={shown} onMore={more} scope={scope} />
        </Suspense>
      )}
      {list !== null && (
        <Suspense fallback={null}>
          <ResultList rows={list} shown={shown} onMore={more} />
        </Suspense>
      )}
    </section>
  )
}
