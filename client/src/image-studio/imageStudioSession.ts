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
 * disk cache answers a query it has seen, so a pause on an old query costs no network either.
 */
import type { ComponentItem, MediaSearchSource, StoredMediaItem, StudioItem, UsedMediaItem } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createStore } from '../lib/store'
import type { SmartShapeApi } from './shapes'

/** The chips (YAZ-4157 D8): what the tab shows. Icons are Iconify's, Photos are Pixabay's. */
export type StudioChip = 'all' | 'favorites' | 'components' | 'shapes' | 'icons' | 'photos'
export const STUDIO_CHIPS: readonly StudioChip[] = ['all', 'favorites', 'components', 'shapes', 'icons', 'photos']

/** Which providers a chip asks; null is a chip that never reaches the web. */
export const chipSource = (chip: StudioChip): MediaSearchSource | null =>
  chip === 'all' ? 'all' : chip === 'icons' ? 'iconify' : chip === 'photos' ? 'pixabay' : null

/** How long typing must pause before the web is asked (YAZ-4157 D3). */
export const SEARCH_PAUSE_MS = 400

/** What the web half says when the machine could not reach a provider (🔒 YAZ-1775 D4's offline half). */
export const OFFLINE_NOTICE = "You're offline. Your favorites, components and shapes still work."

export interface StudioSession {
  chip: StudioChip
  query: string
  /** The query the web results on screen belong to, which the field may have moved on from. */
  searchedQuery: string
  results: StudioItem[]
  cursor: string | null
  warnings: string[]
  isSearching: boolean
  offline: boolean
  pageError: string | null
  error: string | null
  pixabayAvailable: boolean
  /** The library, kept (not just re-listed) so the rows exist on the first paint after a reopen and the scroll can land. */
  favorites: StoredMediaItem[]
  recent: StoredMediaItem[]
  used: UsedMediaItem[]
  components: ComponentItem[]
  /** The Recent section shows every row (it has no chip of its own to show them with). */
  recentOpen: boolean
  smart: SmartShapeApi | null
}

const EMPTY: StudioSession = {
  chip: 'all',
  query: '',
  searchedQuery: '',
  results: [],
  cursor: null,
  warnings: [],
  isSearching: false,
  offline: false,
  pageError: null,
  error: null,
  pixabayAvailable: true,
  favorites: [],
  recent: [],
  used: [],
  components: [],
  recentOpen: false,
  smart: null,
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
  for (const chip of STUDIO_CHIPS) scrollTops[chip] = 0
  imageStudioSession.set(EMPTY)
}

const dedupeItems = (items: StudioItem[]) => [...new Map(items.map((item) => [item.itemKey, item])).values()]

export const getErrorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback)

/** Fewer letters than this is no web search: the providers answer two letters with noise. */
const MIN_QUERY = 2

/**
 * One page. `append` is the infinite scroll's next page and keeps what is on screen; a fresh
 * search clears everything, including the cursors already asked for — which is what stops the
 * observer from re-firing the page it just loaded. A chip that never reaches the web asks nothing.
 */
export async function runSearch({ append = false, retry = false }: { append?: boolean; retry?: boolean } = {}) {
  const { set, getState } = imageStudioSession
  const state = getState()
  const source = chipSource(state.chip)
  const askedQuery = append ? state.searchedQuery : state.query.trim()
  if (source === null || askedQuery.length < MIN_QUERY) return
  const requestedCursor = append ? state.cursor : null
  if (append && (requestedCursor === null || state.isSearching || (!retry && requestedCursors.has(requestedCursor)))) return
  const requestId = append ? searchRequestId : ++searchRequestId
  if (requestedCursor !== null) {
    requestedCursors.add(requestedCursor)
    set({ isSearching: true, pageError: null })
  } else {
    requestedCursors.clear()
    set({ isSearching: true, error: null, pageError: null, offline: false, results: [], cursor: null, warnings: [], searchedQuery: askedQuery })
  }
  try {
    const response = await api.media.search({ q: askedQuery, source, cursor: requestedCursor })
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
 * What the field does on each key (YAZ-4157 D3): keep the text, and ask the web after a pause. Text too short for the
 * web drops the old results at once — they belong to a query the field no longer holds.
 */
export function typeQuery(query: string) {
  clearTimeout(pauseTimer)
  const { set, getState } = imageStudioSession
  set({ query, error: null })
  if (query.trim().length < MIN_QUERY) {
    searchRequestId++
    requestedCursors.clear()
    set({ results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, pageError: null, offline: false })
    return
  }
  if (query.trim() === getState().searchedQuery) return
  pauseTimer = setTimeout(() => void runSearch(), SEARCH_PAUSE_MS)
}

/** Enter: ask now, not after the pause. */
export function searchNow() {
  clearTimeout(pauseTimer)
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
  set({ results: [], cursor: null, warnings: [], searchedQuery: '', isSearching: false, pageError: null })
  void runSearch()
}
