/**
 * THE IMAGE STUDIO'S PROVIDERS, IN THE MAIN PROCESS (🔒 YAZ-1775 D4, YAZ-1818). The half of
 * `worker/imageStudio.ts` that TALKS: the two-phase Iconify walk, the alternating Pixabay pages,
 * the refill pass, and the image proxy that turns a provider's bytes into something a sandboxed
 * renderer can draw. `curation.ts` holds every decision it makes; `cache.ts` holds what it keeps.
 *
 * WHY MAIN AND NOT THE RENDERER (🔒 YAZ-1775 D4): the Pixabay key. It is stored by main and read HERE
 * (`secrets.read`), so it never crosses the bridge, never lands in a devtools console and never
 * reaches a crash dump. The renderer learns exactly one thing about it — `pixabayAvailable` — and
 * when it is false the provider is simply skipped: no error, no empty section, no mention of keys.
 *
 * `fetch` COMES IN AS AN ARGUMENT. Electron's main process has Node's global `fetch`, and
 * production passes it; the tests pass their own, which is why there is not one network call in
 * this module's test file and not one `vi.stubGlobal` either.
 *
 * FAILURE IS TYPED, AND THE TWO KINDS ARE DIFFERENT. A `fetch` that THROWS means the machine
 * never reached the provider → `OFFLINE`, which the Search view renders as a passive "You're
 * offline" while Shapes, Favorites and Recent carry on. A provider that ANSWERS and refuses →
 * `PROVIDER_FAILED`. Bytes that are not an image → `UNSUPPORTED_TYPE` (the Worker's 415); past
 * `MAX_IMPORT_BYTES` → `TOO_LARGE` (its 413), checked on the header AND on what actually arrived,
 * because `Content-Length` is a claim.
 *
 * ONE PROVIDER FAILING IS NOT THE REQUEST FAILING. In `all`, a dead Pixabay still answers with
 * the icons plus a warning, and its cursor is untouched — so the next page retries it from where
 * it was, which is the behaviour the Worker's own test pins. Only when EVERY requested provider
 * failed does the call itself reject.
 */
import type { MediaBytesRequest, MediaDrawingIndexResponse, MediaDrawingRequest, MediaDrawingResponse, MediaImportResponse, MediaPreviewResponse, MediaSearchRequest, MediaSearchResponse, StudioItem } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import type { MediaCache } from './cache'
import { CACHE_TTL_MS, pixabayItemCacheKey, pixabayPageCacheKey, previewCacheKey, searchCacheKey } from './cachePolicy'
import { indexItems, libraryItemElements, LIBRARIES_INDEX_URL, LIBRARIES_ORIGIN, MAX_DRAWING_ELEMENTS_BYTES, MAX_INDEX_BYTES, MAX_LIBRARY_FILE_BYTES, MAX_LIBRARY_FILES_IN_MEMORY, parseDrawingId } from './excalidrawLibraries'
import { activeFilterCount, isIconPrefix, type IconPackInfo, type MediaFilters } from '@shared/iconPacks'
import type { IconPacks } from './iconPacks'
import { rankLocalMatches } from './iconPackSearch'
import { createIconifyBatcher, type IconifySetData } from './iconifyBatch'
import {
  allowedPrefixes,
  decodeCursor,
  filtersNeedPackFacts,
  matchesStyle,
  encodeCursor,
  hasMorePages,
  ICONIFY_API,
  ICONIFY_COLOR_BATCH_LIMIT,
  iconifyAnswerCapped,
  iconifyHasMore,
  iconifyItemFromId,
  iconifySearchUrl,
  iconifySetsBySize,
  initialCursor,
  iconifySvgUrl,
  interleaveResults,
  isColorCollection,
  MAX_IMPORT_BYTES,
  nextPixabayType,
  normalizeIconifyResults,
  normalizePixabayResults,
  oppositePixabayType,
  PIXABAY_API,
  PIXABAY_PAGE_SIZE,
  pixabaySearchUrl,
  providerLimits,
  providersFor,
  SEARCH_LIMIT,
  COLOR_COLLECTION_PRIORITY,
  finiteNumber,
  MAX_COLLECTIONS_BYTES,
  MAX_PASS_LOOKUPS,
  type AnyProviderSearchResult,
  type IconifyCollection,
  type IconifyCursor,
  type IconifySearchPayload,
  type PixabayCursor,
  type PixabayHit,
  type PixabayImageType,
  type ProviderSearchResult,
  type SearchCursor,
  type SearchProvider,
} from './curation'

/** The identity the Worker sent; providers rate-limit anonymous traffic harder. */
const USER_AGENT = 'Yaseen Docs Image Studio'

/** The longest wait a "too many requests" answer (429) gets before its one retry (YAZ-4157 demo 6E). */
const MAX_RETRY_WAIT_MS = 2000
/** What a provider that is still refusing after the retry says: its raw status means nothing to the user. */
export const PROVIDER_BUSY = 'The image service is busy. Try again in a minute.'
const providerFailed = (status: number) => new BridgeFailure('PROVIDER_FAILED', status === 429 ? PROVIDER_BUSY : `provider returned ${status}`)

/** The shortest query the studio will run — the Worker's own floor. */
export const MIN_QUERY_LENGTH = 2
/** And its ceiling; a query longer than this is cut, not refused. */
export const MAX_QUERY_LENGTH = 120

export interface MediaProvidersDeps {
  /** Node's global `fetch` in production; a stub in tests. */
  fetch: typeof globalThis.fetch
  /** `secrets.read(PIXABAY_SECRET)` — null when no key is stored or it cannot be decrypted here. */
  readPixabayKey: () => Promise<string | null>
  cache: MediaCache
  /** The downloaded icon packs (YAZ-4359, `iconPacks.ts`); absent = streaming only, as before them. */
  packs?: LocalIconPacks
  /**
   * A favorite's own copy (YAZ-4363, `library/favoriteCopies.ts`), asked FIRST by `preview` and `import`, so a
   * favorite shows and adds with no network and no key. Null = no copy; a copy that cannot be read is no copy.
   */
  favoriteCopy?: {
    preview(req: MediaBytesRequest): Promise<MediaPreviewResponse | null>
    import(req: MediaBytesRequest): Promise<MediaImportResponse | null>
  }
}

/** What the providers read of the downloaded packs. */
export type LocalIconPacks = Pick<IconPacks, 'searchReady' | 'has' | 'packs' | 'info' | 'names' | 'svg'>

export interface MediaProviders {
  search(req: MediaSearchRequest): Promise<MediaSearchResponse>
  preview(req: MediaBytesRequest): Promise<MediaPreviewResponse>
  import(req: MediaBytesRequest): Promise<MediaImportResponse>
  drawingIndex(): Promise<MediaDrawingIndexResponse>
  drawing(req: MediaDrawingRequest): Promise<MediaDrawingResponse>
  /** Every pack the Add panel can name (Filter › Packs, the pack page, YAZ-4360 / YAZ-4361): the Mac's when it has them, else Iconify's list. */
  packList(): Promise<IconPackInfo[]>
}

/** The filters' part of an Iconify search (YAZ-4360): the allowed packs (null = every pack) and the test each icon passes. */
interface IconifyScope {
  allowed: ReadonlySet<string> | null
  keep: (item: StudioItem) => boolean
}

const prefixOf = (item: StudioItem) => item.providerId.slice(0, item.providerId.indexOf(':'))

/** What a provider's failure looks like to the search loop: which one, and why. */
type ProviderFailure = { provider: SearchProvider; error: BridgeFailure }

/** Pixabay offline while the icons come from the Mac (YAZ-4359, extra 17). */
export const LOCAL_OFFLINE_WARNING = "You're offline. Icons still come from your downloaded packs; Pixabay graphics need the internet."

const warningFor = (provider: SearchProvider) => (provider === 'iconify' ? 'Icons are temporarily unavailable.' : 'Pixabay graphics are temporarily unavailable.')

export function createMediaProviders({ fetch, readPixabayKey, cache, packs, favoriteCopy }: MediaProvidersDeps): MediaProviders {
  /** The favorite copy step (YAZ-4363): its answer, or null when there is no copy or it failed. */
  const fromCopy = <T,>(read: ((req: MediaBytesRequest) => Promise<T | null>) | undefined, req: MediaBytesRequest): Promise<T | null> =>
    read === undefined ? Promise.resolve(null) : read(req).catch(() => null)

  /**
   * A request that never got an answer is OFFLINE; one that got a bad answer is the provider's fault. A 429 is asked
   * once more, after the wait its `Retry-After` names (1 s when it names none, 2 s at most): typing searches on a pause
   * (YAZ-4157 D3), and a burst of searches and tile pictures can pass a provider's rate limit for a moment.
   */
  async function request(url: string): Promise<Response> {
    const once = async () => {
      try {
        return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
      } catch {
        throw new BridgeFailure('OFFLINE', `could not reach ${new URL(url).host}`)
      }
    }
    const first = await once()
    if (first.status !== 429) return first
    // The refused answer's body is never read: let it go before the second request.
    await first.body?.cancel().catch(() => undefined)
    const seconds = Number(first.headers.get('Retry-After'))
    await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_RETRY_WAIT_MS, (seconds > 0 ? seconds : 1) * 1000)))
    return once()
  }

  /** `maxBytes` bounds an answer whose size the app does not control (a library file): checked before it is parsed. */
  async function fetchJson<T>(url: string, maxBytes = Infinity): Promise<T> {
    const response = await request(url)
    if (!response.ok) throw providerFailed(response.status)
    if (Number(response.headers.get('Content-Length') ?? 0) > maxBytes) throw new BridgeFailure('TOO_LARGE', 'the provider answered with more than this app reads')
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new BridgeFailure('TOO_LARGE', 'the provider answered with more than this app reads')
    try {
      return JSON.parse(text) as T
    } catch {
      throw new BridgeFailure('PROVIDER_FAILED', 'provider answered with something that is not JSON')
    }
  }

  /**
   * The Worker's `cachedJsonFetch`: the disk first, the network second, the disk again after. `onFresh` runs only for
   * an answer from the network, never for one from the disk.
   */
  async function cachedJson<T>(key: string, url: string, { maxBytes, onFresh }: { maxBytes?: number; onFresh?: (payload: T) => Promise<unknown> } = {}): Promise<T> {
    const hit = await cache.read<T>(key)
    if (hit !== null) return hit
    const payload = await fetchJson<T>(url, maxBytes)
    await cache.write(key, payload)
    // Not waited for (checker round 1): the answer does not depend on it, and a write that fails only costs a later read.
    if (onFresh) void onFresh(payload).catch(() => undefined)
    return payload
  }

  // ---------- Excalidraw's public libraries ----------

  /**
   * In memory too (polish, audit 6): a tile picture used to read and parse the 200 KB index and its whole library file
   * from the disk each time. The index is parsed once for each 24 h, and the last few library files are kept. Each is
   * ONE promise, so the tiles that ask at the same time share one read; a failure is forgotten, so the next ask retries.
   */
  let drawingIndexMemo: { at: number; items: Promise<StudioItem[]> } | null = null
  const libraryMemo = new Map<string, { at: number; file: Promise<unknown> }>()
  const fresh = (at: number) => Date.now() - at < CACHE_TTL_MS

  function drawingItems(): Promise<StudioItem[]> {
    if (drawingIndexMemo !== null && fresh(drawingIndexMemo.at)) return drawingIndexMemo.items
    const items = cachedJson<unknown>('excalidraw/index', LIBRARIES_INDEX_URL, { maxBytes: MAX_INDEX_BYTES }).then(indexItems)
    const memo = { at: Date.now(), items }
    drawingIndexMemo = memo
    items.catch(() => {
      if (drawingIndexMemo === memo) drawingIndexMemo = null
    })
    return items
  }

  function libraryFile(source: string): Promise<unknown> {
    const known = libraryMemo.get(source)
    libraryMemo.delete(source)
    if (known !== undefined && fresh(known.at)) {
      libraryMemo.set(source, known)
      return known.file
    }
    const memo = { at: Date.now(), file: cachedJson<unknown>(`excalidraw/library/${source}`, `${LIBRARIES_ORIGIN}/libraries/${source}`, { maxBytes: MAX_LIBRARY_FILE_BYTES }) }
    libraryMemo.set(source, memo)
    // The least recently asked goes first.
    for (const oldest of libraryMemo.keys()) {
      if (libraryMemo.size <= MAX_LIBRARY_FILES_IN_MEMORY) break
      libraryMemo.delete(oldest)
    }
    memo.file.catch(() => {
      if (libraryMemo.get(source) === memo) libraryMemo.delete(source)
    })
    return memo.file
  }

  // ---------- Iconify ----------

  /** The tile pictures, one request per icon set (YAZ-4157 demo 6G, `iconifyBatch.ts`). */
  const iconifyBatch = createIconifyBatcher((prefix, names) => {
    const url = new URL(`${ICONIFY_API}/${encodeURIComponent(prefix)}.json`)
    url.searchParams.set('icons', names.join(','))
    return fetchJson<IconifySetData>(url.toString())
  })

  /**
   * Iconify's pack list (`/collections`, about 110 KB): the order of the pack passes (YAZ-4358) and what a filter reads
   * (YAZ-4360). Through the 24 h disk cache, and parsed once for each 24 h; a failure is forgotten, so the next ask retries.
   */
  let collectionsMemo: { at: number; value: Promise<Record<string, IconifyCollection>> } | null = null
  function iconifyCollections(): Promise<Record<string, IconifyCollection>> {
    if (collectionsMemo !== null && fresh(collectionsMemo.at)) return collectionsMemo.value
    const value = cachedJson<Record<string, IconifyCollection>>('iconify/collections', `${ICONIFY_API}/collections`, { maxBytes: MAX_COLLECTIONS_BYTES }).then((raw) =>
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {},
    )
    const memo = { at: Date.now(), value }
    collectionsMemo = memo
    value.catch(() => {
      if (collectionsMemo === memo) collectionsMemo = null
    })
    return value
  }

  /**
   * ONE pass's whole answer (YAZ-4358): Iconify answers at most its window of 128 for one query, all in one request, so
   * the answer is kept 24 h and every later page of the same pass slices it with no request.
   */
  async function iconifyPass(query: string, scope: { prefixes?: readonly string[]; prefix?: string }): Promise<{ items: StudioItem[]; capped: boolean }> {
    const url = iconifySearchUrl(query, scope)
    const payload = await cachedJson<IconifySearchPayload>(`iconify/search${url.search}`, url.toString())
    return { items: normalizeIconifyResults(payload), capped: iconifyAnswerCapped(payload) }
  }

  /**
   * The colour pass, then the general pass with the colour sets filtered out — the reason a query answers with emoji
   * and flat icons before it answers with another wall of Material glyphs. Then (YAZ-4358), when a first pass was cut
   * at Iconify's window, one pass for each pack, biggest first, skipping what the first two showed (each pack pass is cut
   * at 128 too, so streaming gives up to 128 matches a pack; the downloaded packs give every match). A page takes at most
   * 6 colour icons first; once the general pass has no more, the colour pass fills the page (YAZ-4384). At most
   * `MAX_PASS_LOOKUPS` answers are looked up for one page. `scope` is the filters' part (YAZ-4360): the allowed packs
   * (null = every pack) and the test each icon passes.
   */
  async function searchIconify(query: string, currentCursor: IconifyCursor, limit: number, scope: IconifyScope): Promise<ProviderSearchResult<'iconify'>> {
    const cursor = { ...currentCursor }
    const items: StudioItem[] = []
    const allowedIn = (prefixes: readonly string[]) => (scope.allowed === null ? [...prefixes] : prefixes.filter((prefix) => scope.allowed!.has(prefix)))
    const colorPrefixes = allowedIn(COLOR_COLLECTION_PRIORITY)
    const generalScope = scope.allowed === null ? {} : { prefixes: [...scope.allowed] }
    let lookups = 0
    /** The colour pass's answer, once this page looked it up. */
    let colorPass: { items: StudioItem[] } | null = null
    /** Up to `want` more colour icons from where the cursor is. */
    const takeColor = (want: number) => {
      if (colorPass === null) return
      let at = cursor.colorStart
      for (let got = 0; at < colorPass.items.length && got < want; at++) {
        if (!scope.keep(colorPass.items[at])) continue
        items.push(colorPass.items[at])
        got++
      }
      cursor.colorStart = at
      cursor.colorExhausted = at >= colorPass.items.length
    }

    if (!cursor.colorExhausted && limit > 0) {
      if (colorPrefixes.length === 0) cursor.colorExhausted = true
      else {
        colorPass = await iconifyPass(query, { prefixes: colorPrefixes })
        lookups++
        takeColor(Math.min(ICONIFY_COLOR_BATCH_LIMIT, limit))
      }
    }

    if (items.length < limit && !cursor.generalExhausted) {
      if (scope.allowed !== null && scope.allowed.size === 0) cursor.generalExhausted = true
      else {
        const pass = await iconifyPass(query, generalScope)
        lookups++
        let at = cursor.generalStart
        for (; at < pass.items.length && items.length < limit; at++) {
          const item = pass.items[at]
          if (!isColorCollection(prefixOf(item)) && scope.keep(item)) items.push(item)
        }
        cursor.generalStart = at
        cursor.generalExhausted = at >= pass.items.length
      }
    }

    // The general pass has no more for this page (spent, or it skips the colour packs, as in a search inside `noto`): the
    // colour pass fills the page from the answer it already has, so a page is not 6 icons (YAZ-4384). No request.
    if (items.length < limit && cursor.generalExhausted) takeColor(limit - items.length)

    // The pack passes start once both first passes are spent, so a page never mixes their order.
    if (items.length < limit && cursor.colorExhausted && cursor.generalExhausted && !cursor.setsExhausted) {
      // What the first passes showed, read back from the cache (no request): a pack pass skips it.
      const firsts = await Promise.all([colorPrefixes.length > 0 ? iconifyPass(query, { prefixes: colorPrefixes }) : null, scope.allowed?.size === 0 ? null : iconifyPass(query, generalScope)])
      const capped = firsts.some((pass) => pass?.capped === true)
      // One allowed pack: the general pass WAS its pass.
      if (!capped || scope.allowed?.size === 1) cursor.setsExhausted = true
      else {
        const shown = new Set<string>()
        for (const item of firsts[0]?.items ?? []) shown.add(item.itemKey)
        for (const item of firsts[1]?.items ?? []) if (!isColorCollection(prefixOf(item))) shown.add(item.itemKey)
        const sets = iconifySetsBySize(await iconifyCollections(), scope.allowed)
        while (items.length < limit && cursor.setIndex < sets.length && lookups < MAX_PASS_LOOKUPS) {
          const pass = await iconifyPass(query, { prefix: sets[cursor.setIndex] })
          lookups++
          let at = cursor.setStart
          for (; at < pass.items.length && items.length < limit; at++) {
            const item = pass.items[at]
            if (!shown.has(item.itemKey) && scope.keep(item)) items.push(item)
          }
          if (at >= pass.items.length) {
            cursor.setIndex++
            cursor.setStart = 0
          } else cursor.setStart = at
        }
        if (cursor.setIndex >= sets.length) cursor.setsExhausted = true
      }
    }

    return { items: items.slice(0, limit), cursor, hasMore: iconifyHasMore(cursor) }
  }

  /**
   * The filters as an Iconify scope (YAZ-4360): the allowed packs, from the pack facts only when a filter reads them
   * (Packs alone asks nothing), and the style test on each icon name.
   */
  async function scopeFor(filters: MediaFilters | undefined, local: boolean): Promise<IconifyScope> {
    const style = filters?.style ?? 'any'
    const keep = style === 'any' || style === 'emoji' ? () => true : (item: StudioItem) => matchesStyle(item.providerId, style)
    // With the packs on the Mac, the facts are theirs: a filter change asks the network nothing (round 3 decision 4).
    const facts = !filtersNeedPackFacts(filters) ? {} : local && packs !== undefined ? Object.fromEntries(packs.packs().map((info) => [info.prefix, info])) : await iconifyCollections()
    return { allowed: allowedPrefixes(facts, filters), keep }
  }

  // ---------- The downloaded packs (YAZ-4359) and the pack page (YAZ-4361) ----------

  /** A pack's facts as the payload `normalizeIconifyResults` reads, so a local item reads like a streamed one. */
  const collectionOf = (info: IconPackInfo | null | undefined): IconifyCollection | undefined =>
    info == null ? undefined : { name: info.name, category: info.category, license: info.license, palette: info.palette }
  const localItems = (ids: readonly string[]): StudioItem[] =>
    normalizeIconifyResults({ icons: [...ids], collections: Object.fromEntries([...new Set(ids.map((id) => id.slice(0, id.indexOf(':'))))].flatMap((prefix) => {
      const collection = collectionOf(packs?.info(prefix))
      return collection === undefined ? [] : [[prefix, collection]]
    })) })

  /**
   * The last few local searches' ranked matches, with no filter: the next page is a slice, and a filter change only
   * filters the kept list — a click in the Filter menu costs milliseconds, not another walk over every name.
   */
  const localMatches = new Map<string, Promise<string[]>>()
  const MAX_LOCAL_SEARCHES = 4
  async function rankedLocally(query: string, filters: MediaFilters | undefined, scope: IconifyScope): Promise<string[]> {
    let ranked = localMatches.get(query)
    if (ranked === undefined) {
      const value = (packs as LocalIconPacks).names().then((byPack) => rankLocalMatches([...byPack], query, null, () => true))
      ranked = value
      localMatches.set(query, value)
      for (const oldest of localMatches.keys()) {
        if (localMatches.size <= MAX_LOCAL_SEARCHES) break
        localMatches.delete(oldest)
      }
      value.catch(() => localMatches.delete(query))
    }
    const ids = await ranked
    if (filters === undefined || activeFilterCount(filters) === 0) return ids
    return ids.filter((id) => (scope.allowed === null || scope.allowed.has(id.slice(0, id.indexOf(':')))) && scope.keep({ providerId: id } as StudioItem))
  }

  /** One page of a list of ids, from `generalStart`; the other passes are spent. */
  function pageOf(ids: readonly string[], currentCursor: IconifyCursor, limit: number, local: boolean, make: (ids: readonly string[]) => StudioItem[]): ProviderSearchResult<'iconify'> {
    const start = currentCursor.generalStart
    const end = Math.min(ids.length, start + limit)
    const cursor: IconifyCursor = { ...currentCursor, colorExhausted: true, setsExhausted: true, generalStart: end, generalExhausted: end >= ids.length, local }
    return { items: make(ids.slice(start, end)), cursor, hasMore: iconifyHasMore(cursor) }
  }

  /** The pack page with an empty search (YAZ-4361): every visible icon of one pack, from the Mac or Iconify's `/collection`. */
  async function browsePack(prefix: string, cursor: IconifyCursor, limit: number, local: boolean): Promise<ProviderSearchResult<'iconify'>> {
    if (local && packs !== undefined) {
      const names = (await packs.names()).get(prefix) ?? []
      return pageOf(names.map((name) => `${prefix}:${name}`), cursor, limit, true, localItems)
    }
    const url = new URL(`${ICONIFY_API}/collection`)
    url.searchParams.set('prefix', prefix)
    const [listed, collections] = await Promise.all([
      cachedJson<{ uncategorized?: unknown; categories?: unknown; hidden?: unknown }>(`iconify/collection/${prefix}`, url.toString(), { maxBytes: MAX_COLLECTIONS_BYTES }),
      iconifyCollections().catch(() => ({}) as Record<string, IconifyCollection>),
    ])
    const hidden = new Set(Array.isArray(listed.hidden) ? listed.hidden : [])
    const categories = typeof listed.categories === 'object' && listed.categories !== null ? Object.values(listed.categories as Record<string, unknown>) : []
    const names = [...new Set([...categories, listed.uncategorized].flatMap((list) => (Array.isArray(list) ? list : [])).filter((name): name is string => typeof name === 'string' && !hidden.has(name)))]
    const info = collections[prefix]
    return pageOf(names.map((name) => `${prefix}:${name}`), cursor, limit, false, (ids) => normalizeIconifyResults({ icons: [...ids], collections: info === undefined ? {} : { [prefix]: info } }))
  }

  // ---------- Pixabay ----------

  async function fetchPixabayPage(query: string, imageType: PixabayImageType, page: number, key: string) {
    const url = pixabaySearchUrl(query, page, imageType, key, PIXABAY_PAGE_SIZE)
    // Each hit is also the record a tile picture and an import read (`pixabayRecord`), so neither asks the API for it
    // again (YAZ-4157 demo 6G): one request per tile used to count against Pixabay's 100 a minute. Written for a page
    // fresh from the network only, so a record never outlives its page's 24 h (polish, audit 8).
    const payload = await cachedJson<{ hits?: PixabayHit[]; totalHits?: number }>(pixabayPageCacheKey(query, imageType, page, PIXABAY_PAGE_SIZE), url.toString(), {
      onFresh: (fresh) => Promise.all((fresh.hits ?? []).map((hit) => cache.write(pixabayItemCacheKey(String(hit.id)), { hits: [hit] }))),
    })
    const hits = payload.hits ?? []
    const totalHits = finiteNumber(payload.totalHits)
    return { hits, hasMore: totalHits !== undefined ? page * PIXABAY_PAGE_SIZE < totalHits : hits.length === PIXABAY_PAGE_SIZE }
  }

  /**
   * Vector and illustration in turn, four at a time, skipping ids the cursor has already shown —
   * the two streams overlap, and the same graphic appearing twice in one scroll is the bug that
   * `seenIds` exists for.
   */
  async function searchPixabay(query: string, currentCursor: PixabayCursor, limit: number, key: string): Promise<ProviderSearchResult<'pixabay'>> {
    const cursor = { ...currentCursor, seenIds: [...currentCursor.seenIds] }
    const items: StudioItem[] = []
    const seenIds = new Set(cursor.seenIds)
    const maxRequests = Math.ceil(limit / PIXABAY_PAGE_SIZE) + 2
    let requests = 0
    while (items.length + PIXABAY_PAGE_SIZE <= limit && requests < maxRequests) {
      const imageType = nextPixabayType(cursor)
      if (imageType === null) break
      const pageKey = `${imageType}Page` as const
      const exhaustedKey = `${imageType}Exhausted` as const
      const payload = await fetchPixabayPage(query, imageType, cursor[pageKey], key)
      cursor[pageKey]++
      cursor[exhaustedKey] = !payload.hasMore
      cursor.nextType = oppositePixabayType(imageType)
      for (const item of normalizePixabayResults(payload)) {
        if (seenIds.has(item.providerId)) continue
        seenIds.add(item.providerId)
        items.push(item)
      }
      requests++
    }
    cursor.seenIds = [...seenIds]
    return { items, cursor, hasMore: !cursor.vectorExhausted || !cursor.illustrationExhausted }
  }

  // ---------- The federated search ----------

  async function searchUncached(query: string, req: MediaSearchRequest, key: string | null): Promise<MediaSearchResponse> {
    const pixabayAvailable = key !== null
    // A cursor is renderer input. One that does not decode, or was minted for another query, is a
    // bad REQUEST — never a provider failure and never an empty page that silently starts over.
    const cursor = ((): SearchCursor => {
      try {
        return decodeCursor(req.cursor, query, req.source)
      } catch {
        throw new BridgeFailure('BAD_REQUEST', 'invalid search cursor')
      }
    })()
    // No key is not a failure and not a warning: the provider is simply not there (🔒 YAZ-1775 D4). Marking
    // it exhausted keeps `nextCursor` honest — there is no further Pixabay page to ask for.
    if (!pixabayAvailable) {
      cursor.pixabay.vectorExhausted = true
      cursor.pixabay.illustrationExhausted = true
    }
    // An active filter is about icons (YAZ-4360): Colors, Style, Packs and License mean nothing for a Pixabay graphic,
    // so a filtered search shows icons only, and the Pixabay half has no further page either.
    const filtered = req.filters !== undefined && activeFilterCount(req.filters) > 0
    if (filtered) {
      cursor.pixabay.vectorExhausted = true
      cursor.pixabay.illustrationExhausted = true
    }
    // The pack page with no search (YAZ-4361): one pack's every icon, no Pixabay.
    const browse = query === '' ? (req.filters?.packs[0] ?? null) : null
    if (browse !== null) {
      cursor.pixabay.vectorExhausted = true
      cursor.pixabay.illustrationExhausted = true
    }
    const providers = providersFor(browse !== null ? 'iconify' : req.source).filter((provider) => provider !== 'pixabay' || (pixabayAvailable && !filtered))
    const limits = filtered ? { ...providerLimits(req.source), iconify: SEARCH_LIMIT } : providerLimits(req.source)
    // The downloaded packs answer when every pack is here (YAZ-4359). A cursor from before they came goes on streaming;
    // a local cursor whose packs went away streams from the start.
    const ready = packs?.searchReady() === true
    if (cursor.iconify.local && !ready) cursor.iconify = initialCursor(query, req.source).iconify
    const local = ready && (!req.cursor || cursor.iconify.local)
    const iconifyScope = await scopeFor(req.filters, local)
    const searchLocally = async (limit: number): Promise<ProviderSearchResult<'iconify'>> =>
      pageOf(await rankedLocally(query, req.filters, iconifyScope), cursor.iconify, limit, true, localItems)
    const runProvider = (provider: SearchProvider, limit: number): Promise<AnyProviderSearchResult> =>
      provider === 'pixabay'
        ? searchPixabay(query, cursor.pixabay, limit, key as string)
        : browse !== null
          ? browsePack(browse, cursor.iconify, limit, local)
          : local
            ? searchLocally(limit)
            : searchIconify(query, cursor.iconify, limit, iconifyScope)

    const resultsByProvider = new Map<SearchProvider, StudioItem[]>()
    const succeeded = new Set<SearchProvider>()
    const failures: ProviderFailure[] = []
    const warnings: string[] = []

    /** Merge a provider's page in, de-duplicated, and advance ITS half of the cursor. */
    const appendResult = (provider: SearchProvider, result: AnyProviderSearchResult) => {
      const current = resultsByProvider.get(provider) ?? []
      const itemKeys = new Set(current.map(({ itemKey }) => itemKey))
      resultsByProvider.set(provider, [
        ...current,
        ...result.items.filter(({ itemKey }) => {
          if (itemKeys.has(itemKey)) return false
          itemKeys.add(itemKey)
          return true
        }),
      ])
      if (provider === 'iconify') cursor.iconify = result.cursor as IconifyCursor
      else cursor.pixabay = result.cursor as PixabayCursor
    }

    /** A provider that answered and failed: one warning, cursor untouched, so the next page retries it. */
    const warn = (provider: SearchProvider, error: BridgeFailure) => {
      if (!failures.some((failure) => failure.provider === provider)) {
        failures.push({ provider, error })
        // Extra 17: offline with the packs on the Mac, the icons still come; only Pixabay needs the internet.
        warnings.push(local && provider === 'pixabay' && error.code === 'OFFLINE' ? LOCAL_OFFLINE_WARNING : warningFor(provider))
      }
    }

    const settled = await Promise.allSettled(providers.map((provider) => runProvider(provider, limits[provider])))
    settled.forEach((result, index) => {
      const provider = providers[index]
      if (result.status === 'fulfilled') {
        succeeded.add(provider)
        appendResult(provider, result.value)
      } else {
        warn(provider, asBridgeFailure(result.reason))
      }
    })

    if (providers.length > 0 && succeeded.size === 0) throw failures[0].error

    // The refill: `all` wants eighteen. Whatever the split left short, ask the providers that DID
    // answer for again — which is how one thin provider still fills the page.
    if (req.source === 'all') {
      for (const provider of providers) {
        const resultCount = [...resultsByProvider.values()].reduce((total, items) => total + items.length, 0)
        const remaining = SEARCH_LIMIT - resultCount
        if (remaining <= 0 || !succeeded.has(provider)) continue
        try {
          appendResult(provider, await runProvider(provider, remaining))
        } catch (cause) {
          warn(provider, asBridgeFailure(cause))
        }
      }
    }

    const items =
      req.source === 'all' ? interleaveResults(resultsByProvider.get('iconify') ?? [], resultsByProvider.get('pixabay') ?? []) : (resultsByProvider.get(req.source) ?? [])
    const more = providers.length > 0 && hasMorePages(cursor, req.source)
    return { items, nextCursor: more ? encodeCursor(cursor) : null, pixabayAvailable, warnings }
  }

  // ---------- The bytes ----------

  /** An Iconify icon whose pack is on the Mac: its SVG built from the pack, and the item with the pack's facts (YAZ-4359). */
  async function localIcon(req: MediaBytesRequest): Promise<{ image: MediaPreviewResponse; item: StudioItem } | null> {
    if (packs === undefined || req.provider !== 'iconify' || iconifySvgUrl(req.id) === null || !packs.has(req.id.slice(0, req.id.indexOf(':')))) return null
    const svg = await packs.svg(req.id)
    const [item] = svg === null ? [] : localItems([req.id])
    if (svg === null || item === undefined) return null
    return { image: { mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }, item }
  }

  async function pixabayRecord(id: string, key: string | null): Promise<PixabayHit> {
    if (key === null) throw new BridgeFailure('PROVIDER_FAILED', 'Pixabay needs an API key')
    if (!/^\d+$/.test(id)) throw new BridgeFailure('BAD_REQUEST', "'id' is not a Pixabay id")
    const url = new URL(PIXABAY_API)
    url.searchParams.set('key', key)
    url.searchParams.set('id', id)
    const payload = await cachedJson<{ hits?: PixabayHit[] }>(pixabayItemCacheKey(id), url.toString())
    const hit = payload.hits?.find((candidate) => String(candidate.id) === id)
    if (hit === undefined) throw new BridgeFailure('NOT_FOUND', 'that image is no longer on Pixabay')
    return hit
  }

  /** Where the bytes live: Iconify serves the SVG by name, Pixabay only after its record is read. */
  async function sourceUrl(req: MediaBytesRequest, wantPreview: boolean, key: string | null): Promise<{ url: string; item: StudioItem }> {
    if (req.provider === 'iconify') {
      const url = iconifySvgUrl(req.id)
      const item = iconifyItemFromId(req.id)
      if (url === null || item === null) throw new BridgeFailure('BAD_REQUEST', "'id' is not an Iconify icon")
      return { url, item }
    }
    const record = await pixabayRecord(req.id, key)
    const source = wantPreview ? record.previewURL : (record.vectorURL ?? record.largeImageURL ?? record.webformatURL)
    if (typeof source !== 'string' || !source.startsWith('https://')) throw new BridgeFailure('PROVIDER_FAILED', 'Pixabay gave no usable image URL')
    const [item] = normalizePixabayResults({ hits: [record] })
    if (item === undefined) throw new BridgeFailure('PROVIDER_FAILED', 'Pixabay answered with something that is not a graphic')
    return { url: source, item }
  }

  /** Fetch one picture and hand it back as a dataURL, with the type and size guards 🔒 YAZ-1775 D4 names. */
  async function fetchImage(url: string): Promise<MediaPreviewResponse> {
    const response = await request(url)
    if (!response.ok) throw providerFailed(response.status)
    const mimeType = response.headers.get('Content-Type')?.split(';')[0].trim() ?? ''
    if (!mimeType.startsWith('image/')) throw new BridgeFailure('UNSUPPORTED_TYPE', 'the provider answered with something that is not an image')
    const claimed = Number(response.headers.get('Content-Length') ?? 0)
    if (claimed > MAX_IMPORT_BYTES) throw new BridgeFailure('TOO_LARGE', 'that image is over the 20 MB import limit')
    const bytes = Buffer.from(await response.arrayBuffer())
    // `Content-Length` is a claim, not a fact — the bytes that actually arrived are what count.
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new BridgeFailure('TOO_LARGE', 'that image is over the 20 MB import limit')
    return { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
  }

  return {
    async search(req) {
      const query = req.q.trim().slice(0, MAX_QUERY_LENGTH)
      // An empty search of ONE pack is the pack page's every icon (YAZ-4361); any other search needs two letters.
      const browsing = query === '' && req.filters?.packs.length === 1
      if (query.length < MIN_QUERY_LENGTH && !browsing) throw new BridgeFailure('BAD_REQUEST', 'enter at least two characters')
      // The packs on the Mac answer at once and change with an update: no disk cache for their answers (YAZ-4359).
      if (packs?.searchReady() === true) return searchUncached(query, { ...req, q: query }, await readPixabayKey())
      const key = await readPixabayKey()
      const cacheKey = searchCacheKey(query, req.source, req.cursor, key !== null, req.filters)
      const hit = await cache.read<MediaSearchResponse>(cacheKey)
      if (hit !== null) return hit
      const response = await searchUncached(query, { ...req, q: query }, key)
      // A page that is only half the providers' work is still cached: the cursor it carries names
      // the position the failed provider is still at, so replaying it retries exactly as the live
      // call would have. Which is what makes a second identical search free (🔒 YAZ-1775 D4's 24 h).
      await cache.write(cacheKey, response)
      return response
    },

    async preview(req) {
      // A favorite's own copy first (YAZ-4363), then a downloaded pack draws its own tile (YAZ-4359): no network.
      const copy = await fromCopy(favoriteCopy?.preview, req)
      if (copy !== null) return copy
      const fromPack = await localIcon(req)
      if (fromPack !== null) return fromPack.image
      const cacheKey = previewCacheKey(req.provider, req.id)
      const hit = await cache.read<MediaPreviewResponse>(cacheKey)
      // The cache first, always: it is what keeps a favorited tile visible with no network and,
      // for Pixabay, with no key (🔒 YAZ-1775 D4's offline half).
      if (hit !== null) return hit
      const built = req.provider === 'iconify' && iconifySvgUrl(req.id) !== null ? await iconifyBatch.svg(req.id) : null
      // An icon the set data cannot build (rotated, flipped, gone) is the one finished SVG, on its own.
      const image = built !== null ? { mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from(built).toString('base64')}` } : await fetchImage((await sourceUrl(req, true, await readPixabayKey())).url)
      await cache.write(cacheKey, image)
      return image
    },

    async import(req) {
      const copy = await fromCopy(favoriteCopy?.import, req)
      if (copy !== null) return copy
      // NEVER cached (🔒 YAZ-1775 D4): these bytes are on their way to `assets/`, which content-addresses
      // and de-duplicates them already (🔒 YAZ-1775 D3).
      const fromPack = await localIcon(req)
      if (fromPack !== null) return { ...fromPack.image, item: fromPack.item }
      const { url, item } = await sourceUrl(req, false, await readPixabayKey())
      return { ...(await fetchImage(url)), item }
    },

    async packList() {
      if (packs !== undefined && packs.packs().length > 0) return packs.packs()
      const collections = await iconifyCollections()
      return Object.entries(collections).flatMap(([prefix, c]): IconPackInfo[] =>
        c.hidden || !isIconPrefix(prefix)
          ? []
          : [
              {
                prefix,
                name: c.name ?? prefix,
                total: finiteNumber(c.total) ?? 0,
                license: { title: c.license?.title ?? c.license?.spdx ?? 'Open source', ...(c.license?.spdx ? { spdx: c.license.spdx } : {}), ...(c.license?.url ? { url: c.license.url } : {}) },
                ...(c.category ? { category: c.category } : {}),
                palette: c.palette === true,
              },
            ],
      )
    },

    // Excalidraw's public libraries (YAZ-4157 demo 6K, `excalidrawLibraries.ts`): the index and the library files
    // through the same 24 h disk cache. Elements are not an `assets/` file, so caching them is no import rule's concern.
    async drawingIndex() {
      return { items: await drawingItems() }
    },

    async drawing(req) {
      const id = parseDrawingId(req.id)
      if (id === null) throw new BridgeFailure('BAD_REQUEST', "'id' is not an Excalidraw library item")
      // The index only checks the item's name, so an index that cannot be had (offline, past its 24 h) does not fail an
      // item whose library file is still at hand (checker round 1).
      const [named, file] = await Promise.all([
        drawingItems().then((items) => items.find((item) => item.providerId === req.id), () => undefined),
        libraryFile(id.source),
      ])
      const elements = libraryItemElements(file, id.index, named?.title ?? null)
      if (elements === null) throw new BridgeFailure('NOT_FOUND', 'that item is no longer in its library')
      if (JSON.stringify(elements).length > MAX_DRAWING_ELEMENTS_BYTES) throw new BridgeFailure('TOO_LARGE', 'that library item is too large to add')
      return { elements }
    },
  }
}

/** Anything a provider call rejected with, as the typed failure the bridge carries. */
function asBridgeFailure(cause: unknown): BridgeFailure {
  if (cause instanceof BridgeFailure) return cause
  return new BridgeFailure('PROVIDER_FAILED', cause instanceof Error ? cause.message : String(cause))
}
