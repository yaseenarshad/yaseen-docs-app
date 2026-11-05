/**
 * THE ADD TAB'S SESSION (🔒 YAZ-1990 D1, D2; YAZ-4157): what the tab was doing — its chip, its query, the web results
 * and the scroll — held at module scope, because closing the canvas panel UNMOUNTS the tab. One per window (each
 * window is its own renderer), shared by that window's drawing tabs; an app restart starts empty (🔒 D0).
 *
 * THE SEARCH LIVES HERE TOO, not in the component: its request id and the cursors it already asked
 * for must outlive a mount, or a page still in flight from before a close could overwrite a newer
 * search. A page that lands after the panel closed still lands; a stale one never does.
 *
 * TYPING SEARCHES THE WEB ON A PAUSE (YAZ-4157 D3): your own items re-rank on every key in the component, which costs
 * nothing; the providers are asked only `SEARCH_PAUSE_MS` after the last key, and Enter asks at once. Main's 24 h
 * disk cache answers a query it has seen, so a pause on an old query costs no network either. `waiting` is true for the
 * pause, so the tab can say the web is coming from the first key (YAZ-4157 demo).
 */
import type { ComponentItem, MediaSearchSource, StoredMediaItem, StudioItem, UsedMediaItem } from '@shared/types'
import { DEFAULT_MEDIA_FILTERS, type IconPackInfo, type MediaFilters } from '@shared/iconPacks'
import { api, BridgeRequestError } from '../api'
import { createStore } from '../lib/store'
import type { SmartShapeApi } from './shapes'

/**
 * What the tab shows (YAZ-4157 D8): once a row of chips, now the Filter menu's first section, "Show" (YAZ-4348 demo:
 * "yes move the chips to filter"). Icons are Iconify's, Photos are Pixabay's. The code keeps the word "chip".
 */
export type StudioChip = 'all' | 'favorites' | 'components' | 'shapes' | 'icons' | 'photos'
export const STUDIO_CHIPS: readonly StudioChip[] = ['all', 'favorites', 'components', 'shapes', 'icons', 'photos']
export const STUDIO_CHIP_LABELS: Record<StudioChip, string> = { all: 'All', favorites: 'Favorites', components: 'Components', shapes: 'Shapes', icons: 'Icons', photos: 'Photos' }

/** Which providers a chip asks; null is a chip that never reaches the web. */
export const chipSource = (chip: StudioChip): MediaSearchSource | null =>
  chip === 'all' ? 'all' : chip === 'icons' ? 'iconify' : chip === 'photos' ? 'pixabay' : null

/** How long typing must pause before the web is asked (YAZ-4157 D3). */
export const SEARCH_PAUSE_MS = 400

/** What the web half says when the machine could not reach a provider (🔒 YAZ-1775 D4's offline half). */
export const OFFLINE_NOTICE = "You're offline. Your favorites, components and shapes still work."
/** The same line with every icon pack on the Mac (YAZ-4359, extra 17): icon search works offline too. */
export const OFFLINE_WITH_PACKS_NOTICE = "You're offline. Icon search still works from your downloaded packs, and so do your favorites, components and shapes."

/**
 * The pack page (YAZ-4361): one pack in the Add panel, with its own search field. `query` empty = every icon of it.
 * `info` is what the panel knew when it opened (from Iconify's list or the Mac's packs); null until it is known.
 */
export interface PackPage {
  prefix: string
  info: IconPackInfo | null
  query: string
}

export interface StudioSession {
  chip: StudioChip
  query: string
  /** The query the web results on screen belong to, which the field may have moved on from. */
  searchedQuery: string
  results: StudioItem[]
  cursor: string | null
  warnings: string[]
  isSearching: boolean
  /** The pause is running: a web search is coming for the text in the field. */
  waiting: boolean
  offline: boolean
  pageError: string | null
  error: string | null
  pixabayAvailable: boolean
  /** The library, kept (not just re-listed) so the rows exist on the first paint after a reopen and the scroll can land. */
  favorites: StoredMediaItem[]
  recent: StoredMediaItem[]
  used: UsedMediaItem[]
  components: ComponentItem[]
  /** Every named item of Excalidraw's public libraries (demo 6K), asked once a window; null until it is here. */
  drawings: StudioItem[] | null
  /** The Recent section shows every row (it has no chip of its own to show them with). */
  recentOpen: boolean
  smart: SmartShapeApi | null
  /** The Filter menu's choices (YAZ-4360): a copy of `SettingsState.mediaFilters`, sent with each web search. */
  filters: MediaFilters
  /** The pack page, when it is open (YAZ-4361); the search above it waits underneath, as it was. */
  pack: PackPage | null
}

const EMPTY: StudioSession = {
  chip: 'all',
  query: '',
  searchedQuery: '',
  results: [],
  cursor: null,
  warnings: [],
  isSearching: false,
  waiting: false,
  offline: false,
  pageError: null,
  error: null,
  pixabayAvailable: true,
  favorites: [],
  recent: [],
  used: [],
  components: [],
  drawings: null,
  recentOpen: false,
  smart: null,
  filters: DEFAULT_MEDIA_FILTERS,
  pack: null,
}

export const imageStudioSession = createStore<StudioSession>(EMPTY)

/** Where each chip's list was left (🔒 YAZ-1990 D3). Written on every scroll and never rendered, so it stays out of the store. */
export const scrollTops: Record<StudioChip, number> = { all: 0, favorites: 0, components: 0, shapes: 0, icons: 0, photos: 0 }

let searchRequestId = 0
/** The cursors already asked for this search; a page is never requested twice. */
const requestedCursors = new Set<string>()
export const wasRequested = (cursor: string) => requestedCursors.has(cursor)
let pauseTimer: ReturnType<typeof setTimeout> | undefined

/** A test starts from an empty session, the way `clearPreviewMemo` gives it empty tiles. */
export function resetImageStudioSession() {
  clearTimeout(pauseTimer)
  searchRequestId++
  requestedCursors.clear()
  underPack = null
  for (const chip of STUDIO_CHIPS) scrollTops[chip] = 0
  imageStudioSession.set(EMPTY)
}

const dedupeItems = (items: StudioItem[]) => [...new Map(items.map((item) => [item.itemKey, item])).values()]

export const getErrorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback)

/** Fewer letters than this is no web search: the providers answer two letters with noise. */
export const MIN_QUERY = 2
/**
 * Fewer letters than this is no web search ON A PAUSE (YAZ-4157 demo 6E): each search costs the providers about twenty
 * requests with its tile pictures, and a two-letter stop on the way to a word is the one most often thrown away. Enter
 * still searches two letters.
 */
const MIN_PAUSE_QUERY = 3

/**
 * One page. `append` is the infinite scroll's next page and keeps what is on screen; a fresh
 * search clears everything, including the cursors already asked for — which is what stops the
 * observer from re-firing the page it just loaded. A chip that never reaches the web asks nothing.
 */
export async function runSearch({ append = false, retry = false }: { append?: boolean; retry?: boolean } = {}) {
  const { set, getState } = imageStudioSession
  const state = getState()
  // The pack page asks Iconify for its one pack: every icon with an empty field, else its own search (YAZ-4361).
  const pack = state.pack
  const source = pack !== null ? 'iconify' : chipSource(state.chip)
  const askedQuery = append ? state.searchedQuery : pack !== null ? pack.query.trim() : state.query.trim()
  if (source === null || (pack === null && askedQuery.length < MIN_QUERY) || (pack !== null && askedQuery.length === 1)) return
  const filters = pack !== null ? { ...DEFAULT_MEDIA_FILTERS, packs: [pack.prefix] } : state.filters
  const requestedCursor = append ? state.cursor : null
  if (append && (requestedCursor === null || state.isSearching || (!retry && requestedCursors.has(requestedCursor)))) return
  const requestId = append ? searchRequestId : ++searchRequestId
  if (requestedCursor !== null) {
    requestedCursors.add(requestedCursor)
    set({ isSearching: true, pageError: null })
  } else {
    requestedCursors.clear()
    set({ isSearching: true, waiting: false, error: null, pageError: null, offline: false, results: [], cursor: null, warnings: [], searchedQuery: askedQuery })
  }
  try {
    const response = await api.media.search({ q: askedQuery, source, cursor: requestedCursor, filters })
    if (requestId !== searchRequestId) return
    const results = dedupeItems(append ? [...getState().results, ...response.items] : response.items)
    set({ results, cursor: response.nextCursor, warnings: response.warnings, pixabayAvailable: response.pixabayAvailable, offline: false })
  } catch (cause) {
    if (requestId !== searchRequestId) return
    const isOffline = cause instanceof BridgeRequestError && cause.code === 'OFFLINE'
    const message = getErrorMessage(cause, 'Image search failed')
    if (isOffline) set({ offline: true })
    if (append) set({ pageError: isOffline ? OFFLINE_NOTICE : message })
    else if (!isOffline) set({ error: message })
  } finally {
    if (requestId === searchRequestId) set({ isSearching: false })
  }
}

/**
 * What the field does on each key (YAZ-4157 D3): keep the text, and ask the web after a pause. Text too short for a
 * pause search (`MIN_PAUSE_QUERY`) drops the old results at once — they belong to a query the field no longer holds.
 */
export function typeQuery(query: string) {
  clearTimeout(pauseTimer)
  const { set, getState } = imageStudioSession
  set({ query, error: null, waiting: false })
  if (query.trim().length < MIN_PAUSE_QUERY) {
    searchRequestId++
    requestedCursors.clear()
    set({ results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, pageError: null, offline: false })
    return
  }
  if (query.trim() === getState().searchedQuery || chipSource(getState().chip) === null) return
  set({ waiting: true })
  pauseTimer = setTimeout(() => void runSearch(), SEARCH_PAUSE_MS)
}

/** Enter: ask now, not after the pause. */
export function searchNow() {
  clearTimeout(pauseTimer)
  imageStudioSession.set({ waiting: false })
  void runSearch()
}

/** A chip changes what the web is asked too, so a query on screen is asked again under it. */
export function pickChip(chip: StudioChip) {
  const { set, getState } = imageStudioSession
  if (getState().chip === chip) return
  set({ chip })
  clearTimeout(pauseTimer)
  searchRequestId++
  requestedCursors.clear()
  set({ results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, waiting: false, pageError: null })
  void runSearch()
}

/**
 * A choice in the Filter menu (YAZ-4360): kept, remembered in the settings by the caller, and asked AT ONCE — a click is
 * no typing, so there is no pause. With the packs on the Mac the answer is instant (round 3 decision 4).
 */
export function setFilters(filters: MediaFilters) {
  const { set, getState } = imageStudioSession
  if (JSON.stringify(getState().filters) === JSON.stringify(filters)) return
  set({ filters })
  if (getState().pack !== null) return
  clearTimeout(pauseTimer)
  searchRequestId++
  requestedCursors.clear()
  set({ results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, waiting: false, pageError: null })
  void runSearch()
}

/** The Filter menu's "Clear filters": Show goes back to All and the filters off, with ONE search for both. */
export function clearShowAndFilters() {
  const { chip, filters } = imageStudioSession.getState()
  const filtersOff = JSON.stringify(filters) === JSON.stringify(DEFAULT_MEDIA_FILTERS)
  if (filtersOff) return pickChip('all')
  // setFilters asks the web, under Show = All.
  if (chip !== 'all') imageStudioSession.set({ chip: 'all' })
  setFilters(DEFAULT_MEDIA_FILTERS)
}

/** What the search under a pack page was, so Back puts it back as it was, with no new request (YAZ-4361). */
type Underneath = Pick<StudioSession, 'query' | 'searchedQuery' | 'results' | 'cursor' | 'warnings' | 'offline' | 'pageError'> & { asked: string[] }
let underPack: Underneath | null = null

/** "More from this pack" (YAZ-4361): the pack page opens on every icon of `prefix`. */
export function openPack(prefix: string, info: IconPackInfo | null) {
  const { set, getState } = imageStudioSession
  const state = getState()
  clearTimeout(pauseTimer)
  if (state.pack === null) {
    underPack = { query: state.query, searchedQuery: state.searchedQuery, results: state.results, cursor: state.cursor, warnings: state.warnings, offline: state.offline, pageError: state.pageError, asked: [...requestedCursors] }
  }
  searchRequestId++
  requestedCursors.clear()
  set({ pack: { prefix, info, query: '' }, results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, waiting: false, pageError: null, error: null, offline: false })
  void runSearch()
}

/** The pack page learnt its pack's facts after it opened. */
export function setPackInfo(info: IconPackInfo) {
  const { set, getState } = imageStudioSession
  const pack = getState().pack
  if (pack !== null && pack.prefix === info.prefix) set({ pack: { ...pack, info } })
}

/** The pack page's own field: every icon when empty, a search in the pack from two letters, after the same pause. */
export function typePackQuery(query: string) {
  const { set, getState } = imageStudioSession
  const pack = getState().pack
  if (pack === null) return
  clearTimeout(pauseTimer)
  set({ pack: { ...pack, query }, waiting: false })
  const trimmed = query.trim()
  if (trimmed.length === 1 || trimmed === getState().searchedQuery) return
  searchRequestId++
  requestedCursors.clear()
  set({ results: [], cursor: null, searchedQuery: '', pageError: null, waiting: trimmed !== '' })
  if (trimmed === '') void runSearch()
  else pauseTimer = setTimeout(() => void runSearch(), SEARCH_PAUSE_MS)
}

/** Back: the search under the pack page, as it was — its results, its next page, its scroll (the caller's). */
export function closePack() {
  const { set } = imageStudioSession
  clearTimeout(pauseTimer)
  searchRequestId++
  requestedCursors.clear()
  const under = underPack
  underPack = null
  if (under === null) {
    set({ pack: null, results: [], cursor: null, searchedQuery: '', isSearching: false, waiting: false })
    return
  }
  for (const cursor of under.asked) requestedCursors.add(cursor)
  const { asked: _asked, ...rest } = under
  set({ ...rest, pack: null, isSearching: false, waiting: false, error: null })
}
