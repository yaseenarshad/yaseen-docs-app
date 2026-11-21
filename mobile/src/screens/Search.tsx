import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchCandidate } from '@client/search/searchCandidates'
import type { Scope } from '../search/lists'
import { useApp } from '../app/AppState'
import { buildRows, findRows, typeTest, type PhoneType } from '../search/searchRun'
import { keepPlace, keepSearch, searchStateOf, takeSearchNotice } from '../search/searchState'
import { useVaultData, type VaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import '../search/search.css'
import { recordsWithBoards } from '../drawing/boardFiles'

/** The tree: its own chunk, loaded when the box is empty. */
const SearchTree = lazy(() => import('../search/SearchTree'))
/** The results in the tree: the same chunk (the first load stays under its ceiling). */
const ResultTree = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.ResultTree })))
/** The filter bar: Type and the vault's lists, the same chunk. */
const SearchBar = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.SearchBar })))
/** Collapse all / Expand all in the box, the same chunk. */
const FoldButton = lazy(() => import('../search/SearchTree').then((m) => ({ default: m.FoldButton })))

/** Rows drawn at first, and added at each "Show more" (5,000 pages are not drawn at once). */
const STEP = 100

/**
 * THE SEARCH TAB (4C; decisions 10 and 21, round 15 item 2). One box: cards and pages in one list, by title,
 * alias and ID, as the Mac's search finds them (`searchRun.ts`). The list changes with each letter, from the phone's own
 * index, so it works with no signal. The Type filter: All types, Pages, Cards, Drawings, Diagrams, any mix
 * (Cards only while the vault's Review is on). A tap on a page opens it read only; a tap on a card opens the card alone
 * (round 12, item 10). The words follow the vault's word for "page" (`unit`).
 *
 * The box empty shows the Mac's sidebar tree (`SearchTree`): folders that open and close, pages and card
 * files, with the Mac's icons and order (Cards: the cards, each with the card icon). A result row has the same icons
 * (a page, a card file, a card in a page) in place of the word "page".
 * The ✕ at the right of the box (and Escape) clears the text and leaves the search: the keyboard goes away
 * and the tree shows again.
 * With text, the results stand in that tree, as on the Mac's Search tab (`ResultTree`, `foundTree.ts`).
 * A list filter (Favorites, `SearchBar`) cuts the rows to that list before the search, so the text finds only in it.
 * With an empty box, the ✕'s place holds the Mac's Collapse all / Expand all (`folds.tsx`).
 * A Type on shows its rows in that same result tree, with text or not, in a list too (Favorites + Cards):
 * the parents of each row open, so the folder it sits in shows. The fold button folds that tree.
 */
/**
 * YAZ-5596 (13): the search rows of the last vault data, and the last search's result, kept for the next mount of
 * Search (a tab switch, a return to the app): no rebuild and no search again while the data (a new object when the
 * index, the commit or the settings change), the list, the query and the Type are the same.
 */
let builtRows: { data: VaultData; rows: SearchCandidate[] } | null = null
let lastFound: { pool: readonly SearchCandidate[]; query: string; kind: string; found: SearchCandidate[] } | null = null
const rowsFor = (data: VaultData | null) => (data !== null && builtRows?.data === data ? builtRows.rows : null)
const foundFor = (pool: readonly SearchCandidate[] | null, query: string, kind: PhoneType) => (pool !== null && lastFound !== null && lastFound.pool === pool && lastFound.query === query && lastFound.kind === kind.join('+') ? lastFound.found : null)

export function Search() {
  const app = useApp()
  const { unit, vaultKey } = app
  const data = useVaultData()
  const held = searchStateOf(vaultKey)
  const [query, setQuery] = useState(held.query)
  const [type, setType] = useState<PhoneType>(held.type)
  const [scope, setScope] = useState<Scope | null>(null)
  const [rows, setRows] = useState<SearchCandidate[] | null>(() => rowsFor(data))
  const [found, setFound] = useState<SearchCandidate[] | null>(() => foundFor(rowsFor(data), held.query, held.type))
  const [shown, setShown] = useState(held.shown ?? STEP)
  /** The query and Type the rows shown are for: a new one starts the list again at its top. */
  const listOf = useRef(`${held.query}\n${held.type.join('+')}`)
  const section = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  /** Clear the box and leave the search (the keyboard goes away). */
  const leave = () => {
    setQuery('')
    input.current?.blur()
  }
  const [notice] = useState(() => takeSearchNotice())
  const cards = data?.review.enabled ?? false
  // Cards is a choice only while Review is on, as on the Mac.
  const kind: PhoneType = useMemo(() => (cards || !type.includes('cards') ? type : type.filter((k) => k !== 'cards')), [type, cards])
  const pool = useMemo(() => (rows !== null && scope !== null ? rows.filter((r) => scope.has(r.page ?? r.path)) : rows), [rows, scope])

  // The rows, built again when the index changes (R4: a new page is in search after the pass that brings it).
  useEffect(() => {
    if (data === null) return
    const kept = rowsFor(data)
    if (kept !== null) return setRows(kept)
    let live = true
    void buildRows({ records: recordsWithBoards(data), letters: data.letters, cards: data.review.enabled }, uiSlicer(), () => live).then((built) => {
      if (built !== null) builtRows = { data, rows: built }
      if (live && built !== null) setRows(built)
    })
    return () => {
      live = false
    }
  }, [data])

  // Each letter searches again; a search that a newer letter replaced stops.
  useEffect(() => {
    keepSearch(vaultKey, query, kind)
    if (listOf.current !== `${query}\n${kind.join('+')}`) {
      listOf.current = `${query}\n${kind.join('+')}`
      setShown(STEP)
      keepPlace(STEP, 0)
    }
    if (pool === null || query.trim() === '') return setFound(null)
    const kept = foundFor(pool, query, kind)
    if (kept !== null) return setFound(kept)
    let live = true
    void findRows(pool, query, kind, uiSlicer(), () => live).then((next) => {
      if (next !== null) lastFound = { pool, query, kind: kind.join('+'), found: next }
      if (live && next !== null) setFound(next)
    })
    return () => {
      live = false
    }
  }, [pool, query, kind, vaultKey])

  const empty = query.trim() === ''
  // N5 (sweep1): a vault with its whole copy on the phone and no page is empty (the Mac's "No pages here."); only before
  // its first sync do the pages come with the next one.
  const synced = app.sync.vault === vaultKey && app.sync.ready
  const tree = empty && kind.length === 0
  // A Type with no text: every row of its types, drawn in the result tree as a search's.
  const typed = useMemo(() => {
    const keep = typeTest(kind)
    return pool !== null && empty && keep !== undefined ? pool.filter(keep) : null
  }, [pool, empty, kind])
  const results = empty ? typed : found

  // The list's scroll place is kept as the person scrolls, and given back when the tab shows again.
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
  // Show in Search (YAZ-5714): a row past "Show more" draws the rows down to it.
  const reach = useCallback((rows: number) => setShown((n) => Math.max(n, rows + STEP)), [])

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
        (tree || typed !== null) &&
        data !== null &&
        data.records.length > 0 && (
          <Suspense fallback={null}>
            <FoldButton data={data} scope={scope} {...(typed !== null && { found: { rows: typed, type: kind } })} />
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
      {data !== null && data.records.length === 0 && <p className="muted">{unit(synced ? 'No pages here.' : 'No pages yet. They come with the next sync.')}</p>}
      {tree && data !== null && data.records.length > 0 && (
        <Suspense fallback={null}>
          <SearchTree data={data} cards={cards} shown={shown} onMore={more} onReach={reach} scope={scope} />
        </Suspense>
      )}
      {results !== null && data !== null && data.records.length > 0 && (
        <Suspense fallback={null}>
          <ResultTree data={data} rows={results} query={empty ? '' : query} type={kind} shown={shown} onMore={more} scope={scope} />
        </Suspense>
      )}
    </section>
  )
}
