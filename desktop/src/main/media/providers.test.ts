/**
 * The providers (🔒 YAZ-1775 D4, YAZ-1818), with `fetch` injected — there is not one real request in this
 * file and not one global stubbed. The Worker's own integration tests are carried over
 * (exhaustion, de-duplication, retry-from-position, the 415 and the 413) and joined by the three
 * things only this port has: the key that lives in main, the disk cache that replaces
 * `caches.default`, and the typed failures a bridge has to carry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaSearchResponse, StudioItem } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import type { MediaCache } from './cache'
import { decodeCursor } from './curation'
import { createMediaProviders, PROVIDER_BUSY, type MediaProviders } from './providers'

/** The disk cache's contract, in a Map — `cache.test.ts` owns the disk half. */
function memoryCache(): MediaCache & { store: Map<string, unknown>; reads: string[] } {
  const store = new Map<string, unknown>()
  const reads: string[] = []
  return {
    store,
    reads,
    async read<T>(key: string) {
      reads.push(key)
      return (store.has(key) ? (structuredClone(store.get(key)) as T) : null)
    },
    async write(key, value) {
      store.set(key, structuredClone(value))
    },
    async sweep() {
      return 0
    },
  }
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })

const iconifyPayload = (icons: string[], extra: Record<string, unknown> = {}) => ({
  icons,
  collections: Object.fromEntries(icons.map((id) => [id.split(':')[0], { name: id.split(':')[0] }])),
  ...extra,
})

/** Iconify's two byte doors: a set's data for the tile pictures, a finished SVG for an import (and a rotated icon). */
const iconifyBytes = (input: RequestInfo | URL) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('.json')) {
    const names = url.searchParams.get('icons')!.split(',')
    return json({ prefix: 'noto', width: 128, height: 128, icons: Object.fromEntries(names.map((n) => [n, n === 'turned' ? { body: '<g/>', rotate: 1 } : { body: `<path d="${n}"/>` }])) })
  }
  return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
}

let cache: ReturnType<typeof memoryCache>
beforeEach(() => {
  cache = memoryCache()
})

function build(fetchImpl: typeof globalThis.fetch, key: string | null = 'secret'): MediaProviders {
  return createMediaProviders({ fetch: fetchImpl, readPixabayKey: async () => key, cache })
}

const code = async (run: Promise<unknown>): Promise<string> => run.then(
  () => 'RESOLVED',
  (err: unknown) => (err instanceof BridgeFailure ? err.code : `not a BridgeFailure: ${String(err)}`),
)

describe('the query guard', () => {
  it('refuses a query under two characters, before any provider is touched', async () => {
    const fetchMock = vi.fn()
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)
    await expect(code(providers.search({ q: 'a', source: 'all' }))).resolves.toBe('BAD_REQUEST')
    await expect(code(providers.search({ q: '   ', source: 'all' }))).resolves.toBe('BAD_REQUEST')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a cursor that was minted for another query', async () => {
    const fetchMock = vi.fn(async () => json(iconifyPayload(['noto:rocket'], { total: 1 })))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    const first = await providers.search({ q: 'rocket', source: 'iconify' })
    const cursor = first.nextCursor ?? 'x'
    await expect(code(providers.search({ q: 'other', source: 'iconify', cursor }))).resolves.toBe('BAD_REQUEST')
  })
})

describe('the Pixabay key, which never leaves main (🔒 YAZ-1775 D4)', () => {
  it('skips the provider entirely and says pixabayAvailable: false — no error, no warning', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('iconify.design')
      return json(iconifyPayload(['fluent-emoji-flat:rocket'], { total: 1 }))
    })
    const response = await build(fetchMock as unknown as typeof globalThis.fetch, null).search({ q: 'rocket', source: 'all' })
    expect(response.pixabayAvailable).toBe(false)
    expect(response.warnings).toEqual([])
    expect(response.items.every(({ provider }) => provider === 'iconify')).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('answers an explicit pixabay search with nothing at all, and no next page', async () => {
    const fetchMock = vi.fn()
    const response = await build(fetchMock as unknown as typeof globalThis.fetch, null).search({ q: 'rocket', source: 'pixabay' })
    expect(response).toMatchObject({ items: [], nextCursor: null, pixabayAvailable: false, warnings: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('puts the key in the provider URL and nowhere in the answer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.iconify.design') return json(iconifyPayload(['noto:rocket'], { total: 1 }))
      return json({ hits: [{ id: 1, type: 'vector', previewURL: 'https://x/p.png', tags: 'rocket' }], totalHits: 1 })
    })
    const response = await build(fetchMock as unknown as typeof globalThis.fetch, 'SUPER-SECRET').search({ q: 'rocket', source: 'all' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('SUPER-SECRET'))).toBe(true)
    expect(JSON.stringify(response)).not.toContain('SUPER-SECRET')
  })
})

describe('search over both providers', () => {
  it('runs only the requested provider and returns an opaque cursor while there is more', async () => {
    const fetchMock = vi.fn(async () => json(iconifyPayload(['fluent-color:rocket-24'], { total: 100, start: 0, limit: 64 })))
    const response = await build(fetchMock as unknown as typeof globalThis.fetch, null).search({ q: 'rocket', source: 'iconify' })
    expect(response.items.every(({ provider }) => provider === 'iconify')).toBe(true)
    expect(response.nextCursor).not.toBeNull()
    // Opaque, but it must really carry the next window: it decodes for THIS query and source,
    // and has advanced past the icon this page returned. (`not.toBe('2')` could never fail.)
    const decoded = decodeCursor(response.nextCursor, 'rocket', 'iconify')
    expect(decoded.query).toBe('rocket')
    expect(decoded.iconify.colorStart).toBeGreaterThan(0)
  })

  it('exhausts both providers independently without skipping or repeating a result', async () => {
    const colorIcons = ['fluent-emoji-flat:rocket', 'openmoji:rocket']
    const generalIcons = Array.from({ length: 20 }, (_, index) => `lucide:rocket-${index + 1}`)
    const vectors = Array.from({ length: 5 }, (_, index) => ({ id: 100 + index, type: 'vector/svg', tags: `vector rocket ${index + 1}`, previewURL: `https://x/v-${index}.png` }))
    const illustrations = Array.from({ length: 5 }, (_, index) => ({ id: 200 + index, type: 'illustration', tags: `illustrated rocket ${index + 1}`, previewURL: `https://x/i-${index}.png` }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.iconify.design') {
        const icons = url.searchParams.has('prefixes') ? colorIcons : generalIcons
        const start = Number(url.searchParams.get('start') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? icons.length)
        return json(iconifyPayload(icons.slice(start, start + limit), { total: icons.length, start, limit }))
      }
      const items = url.searchParams.get('image_type') === 'vector' ? vectors : illustrations
      const page = Number(url.searchParams.get('page') ?? 1)
      const perPage = Number(url.searchParams.get('per_page') ?? 4)
      return json({ hits: items.slice((page - 1) * perPage, (page - 1) * perPage + perPage), totalHits: items.length })
    })
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)

    const seen: StudioItem[] = []
    let cursor: string | null = null
    do {
      const page: MediaSearchResponse = await providers.search({ q: 'rocket', source: 'all', cursor })
      expect(page.items.length).toBeLessThanOrEqual(18)
      seen.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)

    const expected = new Set([
      ...[...colorIcons, ...generalIcons].map((id) => `iconify:${id}`),
      ...[...vectors, ...illustrations].map(({ id }) => `pixabay:${id}`),
    ])
    expect(seen.slice(0, 4).map(({ provider }) => provider)).toEqual(['iconify', 'iconify', 'iconify', 'pixabay'])
    expect(new Set(seen.map(({ itemKey }) => itemKey))).toEqual(expected)
    expect(seen).toHaveLength(expected.size)
  })

  it('does not repeat a Pixabay asset that both streams serve', async () => {
    const vectors = Array.from({ length: 5 }, (_, index) => ({ id: 100 + index, type: 'vector/svg', tags: `vector ${index}`, previewURL: `https://x/v-${index}.png` }))
    const illustrations = [{ ...vectors[0], type: 'illustration', tags: 'duplicate' }, ...Array.from({ length: 4 }, (_, index) => ({ id: 200 + index, type: 'illustration', tags: `illo ${index}`, previewURL: `https://x/i-${index}.png` }))]
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.iconify.design') {
        const icons = url.searchParams.has('prefixes') ? [] : Array.from({ length: 40 }, (_, i) => `lucide:rocket-${i + 1}`)
        const start = Number(url.searchParams.get('start') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? 40)
        return json(iconifyPayload(icons.slice(start, start + limit), { total: icons.length, start, limit }))
      }
      const items = url.searchParams.get('image_type') === 'vector' ? vectors : illustrations
      const page = Number(url.searchParams.get('page') ?? 1)
      const perPage = Number(url.searchParams.get('per_page') ?? 4)
      return json({ hits: items.slice((page - 1) * perPage, (page - 1) * perPage + perPage), totalHits: items.length })
    })
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)

    const pixabayKeys: string[] = []
    let cursor: string | null = null
    do {
      const page: MediaSearchResponse = await providers.search({ q: 'rocket', source: 'all', cursor })
      pixabayKeys.push(...page.items.filter(({ provider }) => provider === 'pixabay').map(({ itemKey }) => itemKey))
      cursor = page.nextCursor
    } while (cursor)

    expect(pixabayKeys).toHaveLength(9)
    expect(new Set(pixabayKeys).size).toBe(9)
  })
})

describe('when a provider is having a bad day', () => {
  it('warns instead of failing, and retries it from its unchanged position on the next page', async () => {
    const icons = Array.from({ length: 20 }, (_, index) => `lucide:recovery-${index + 1}`)
    const vectors = Array.from({ length: 8 }, (_, index) => ({ id: 300 + index, type: 'vector/svg', tags: `recovered ${index}`, previewURL: `https://x/r-${index}.png` }))
    let pixabayFailures = 1
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.iconify.design') {
        const available = url.searchParams.has('prefixes') ? [] : icons
        const start = Number(url.searchParams.get('start') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? available.length)
        return json(iconifyPayload(available.slice(start, start + limit), { total: available.length, start, limit }))
      }
      if (pixabayFailures > 0) {
        pixabayFailures--
        return json({ error: 'nope' }, { status: 500 })
      }
      const available = url.searchParams.get('image_type') === 'vector' ? vectors : []
      const page = Number(url.searchParams.get('page') ?? 1)
      const perPage = Number(url.searchParams.get('per_page') ?? 4)
      return json({ hits: available.slice((page - 1) * perPage, (page - 1) * perPage + perPage), totalHits: available.length })
    })
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)

    const itemKeys: string[] = []
    const warningCounts: number[] = []
    let cursor: string | null = null
    do {
      const page: MediaSearchResponse = await providers.search({ q: 'recovery', source: 'all', cursor })
      itemKeys.push(...page.items.map(({ itemKey }) => itemKey))
      warningCounts.push(page.warnings.length)
      cursor = page.nextCursor
    } while (cursor)

    expect(warningCounts[0]).toBe(1)
    expect(warningCounts.slice(1)).toEqual(expect.arrayContaining([0]))
    expect(new Set(itemKeys)).toEqual(new Set([...icons.map((id) => `iconify:${id}`), ...vectors.map(({ id }) => `pixabay:${id}`)]))
    expect(itemKeys).toHaveLength(new Set(itemKeys).size)
  })

  it('fails the whole call as PROVIDER_FAILED only when every requested provider did', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'down' }, { status: 503 }))
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).search({ q: 'rocket', source: 'all' }))).resolves.toBe('PROVIDER_FAILED')
  })

  it('asks once more after a 429, waiting what Retry-After names (YAZ-4157 demo 6E)', async () => {
    vi.useFakeTimers()
    try {
      let refused = false
      const fetchMock = vi.fn(async () => {
        if (refused) return json(iconifyPayload(['noto:rocket'], { total: 1 }))
        refused = true
        return json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } })
      })
      const page = build(fetchMock as unknown as typeof globalThis.fetch).search({ q: 'rocket', source: 'iconify' })
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await page).items.map(({ itemKey }) => itemKey)).toEqual(['iconify:noto:rocket'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 429 that stays is a plain "busy" message, not a status code', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => new Response('busy', { status: 429 }))
      const preview = build(fetchMock as unknown as typeof globalThis.fetch).preview({ provider: 'iconify', id: 'noto:rocket' })
      const settled = preview.then(() => 'RESOLVED', (err: unknown) => (err as Error).message)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await settled).toBe(PROVIDER_BUSY)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is OFFLINE, not PROVIDER_FAILED, when the machine never reached the provider', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).search({ q: 'rocket', source: 'iconify' }))).resolves.toBe('OFFLINE')
  })
})

describe('the 24 h disk cache (🔒 YAZ-1775 D4)', () => {
  it('serves an identical second search without one network call', async () => {
    const fetchMock = vi.fn(async () => json(iconifyPayload(['noto:money-bag'], { total: 1 })))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    const first = await providers.search({ q: 'money bag', source: 'all' })
    const calls = fetchMock.mock.calls.length
    const second = await providers.search({ q: 'money bag', source: 'all' })
    expect(second).toEqual(first)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('does not serve an Iconify-only page once a key has been added', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.iconify.design') return json(iconifyPayload(['noto:money-bag'], { total: 1 }))
      return json({ hits: [{ id: 7, type: 'vector', previewURL: 'https://x/p.png', tags: 'money' }], totalHits: 1 })
    })
    let key: string | null = null
    const providers = createMediaProviders({ fetch: fetchMock as unknown as typeof globalThis.fetch, readPixabayKey: async () => key, cache })
    const before = await providers.search({ q: 'money bag', source: 'all' })
    expect(before.pixabayAvailable).toBe(false)
    key = 'secret'
    const after = await providers.search({ q: 'money bag', source: 'all' })
    expect(after.pixabayAvailable).toBe(true)
    expect(after.items.some(({ provider }) => provider === 'pixabay')).toBe(true)
  })

  it('caches a preview and re-serves it, but NEVER caches an import (🔒 YAZ-1775 D4)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => iconifyBytes(input))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)

    const first = await providers.preview({ provider: 'iconify', id: 'noto:money-bag' })
    expect(first.mimeType).toBe('image/svg+xml')
    expect(first.dataURL.startsWith('data:image/svg+xml;base64,')).toBe(true)
    await providers.preview({ provider: 'iconify', id: 'noto:money-bag' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await providers.import({ provider: 'iconify', id: 'noto:money-bag' })
    await providers.import({ provider: 'iconify', id: 'noto:money-bag' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect([...cache.store.keys()].some((key) => key.includes('import'))).toBe(false)
  })

  it('still shows a cached preview with no network at all — the offline half of the rule', async () => {
    const online = build(vi.fn(async (input: RequestInfo | URL) => iconifyBytes(input)) as unknown as typeof globalThis.fetch, null)
    await online.preview({ provider: 'iconify', id: 'noto:money-bag' })
    const offline = build(
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch,
      null,
    )
    await expect(offline.preview({ provider: 'iconify', id: 'noto:money-bag' })).resolves.toMatchObject({ mimeType: 'image/svg+xml' })
    // And one that was never cached is a plain OFFLINE, which the renderer draws as a placeholder.
    await expect(code(offline.preview({ provider: 'iconify', id: 'noto:rocket' }))).resolves.toBe('OFFLINE')
  })

  it('serves a favorited Pixabay preview from the cache even with no key', async () => {
    const withKey = build(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('pixabay.com/api') ? json({ hits: [{ id: 101, type: 'vector', previewURL: 'https://cdn.test/p.png', tags: 'money' }] }) : new Response('PNG', { headers: { 'Content-Type': 'image/png' } }),
      ) as unknown as typeof globalThis.fetch,
      'secret',
    )
    await withKey.preview({ provider: 'pixabay', id: '101' })
    const withoutKey = build(vi.fn() as unknown as typeof globalThis.fetch, null)
    await expect(withoutKey.preview({ provider: 'pixabay', id: '101' })).resolves.toMatchObject({ mimeType: 'image/png' })
  })
})

describe('fewer requests per page (YAZ-4157 demo 6G)', () => {
  it('the Iconify tiles of one set are ONE request, and the picture is the set`s data built as an SVG', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => iconifyBytes(input))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    const [rocket, bag] = await Promise.all([providers.preview({ provider: 'iconify', id: 'noto:rocket' }), providers.preview({ provider: 'iconify', id: 'noto:money-bag' })])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.iconify.design/noto.json?icons=rocket%2Cmoney-bag'])
    expect(Buffer.from(rocket.dataURL.split(',')[1], 'base64').toString()).toContain('<path d="rocket"/>')
    expect(bag.mimeType).toBe('image/svg+xml')
  })

  it('an icon the set data cannot build is fetched as its own finished SVG', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => iconifyBytes(input))
    await build(fetchMock as unknown as typeof globalThis.fetch, null).preview({ provider: 'iconify', id: 'noto:turned' })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.iconify.design/noto.json?icons=turned', 'https://api.iconify.design/noto/turned.svg'])
  })

  it('a search page from the disk does not write its records again (polish, audit 8)', async () => {
    const hit = { id: 101, type: 'vector', previewURL: 'https://cdn.test/p.png', tags: 'money' }
    const fetchMock = vi.fn(async () => json({ hits: [hit], totalHits: 1 }))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)
    const writes = vi.spyOn(cache, 'write')
    await providers.search({ q: 'money', source: 'pixabay' })
    const recordWrites = () => writes.mock.calls.filter(([key]) => String(key).startsWith('pixabay/item/')).length
    const afterFresh = recordWrites()
    expect(afterFresh).toBeGreaterThan(0)
    // Forget the whole search answer, so the second search reads its PAGES from the disk.
    for (const key of [...cache.store.keys()]) if (!key.startsWith('pixabay/')) cache.store.delete(key)
    await providers.search({ q: 'money', source: 'pixabay' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(recordWrites()).toBe(afterFresh)
  })

  it('a search does not wait for its Pixabay record writes (checker round 2)', async () => {
    const hit = { id: 101, type: 'vector', previewURL: 'https://cdn.test/p.png', tags: 'money' }
    const providers = build(vi.fn(async () => json({ hits: [hit], totalHits: 1 })) as unknown as typeof globalThis.fetch)
    const write = cache.write.bind(cache)
    // A record write that never ends: the search must answer anyway.
    vi.spyOn(cache, 'write').mockImplementation((key, value) => (String(key).startsWith('pixabay/item/') ? new Promise(() => undefined) : write(key, value)))
    const page = await Promise.race([providers.search({ q: 'money', source: 'pixabay' }), new Promise((resolve) => setTimeout(() => resolve('timed out'), 1000))])
    expect(page).not.toBe('timed out')
  })

  it('a Pixabay tile reads the record its search page brought: no API call per tile', async () => {
    const hit = { id: 101, type: 'vector', previewURL: 'https://cdn.test/p.png', tags: 'money' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('pixabay.com/api') ? json({ hits: [hit], totalHits: 1 }) : new Response('PNG', { headers: { 'Content-Type': 'image/png' } }),
    )
    const providers = build(fetchMock as unknown as typeof globalThis.fetch)
    await providers.search({ q: 'money', source: 'pixabay' })
    const searchCalls = fetchMock.mock.calls.length
    await providers.preview({ provider: 'pixabay', id: '101' })
    expect(fetchMock.mock.calls.slice(searchCalls).map(([url]) => String(url))).toEqual(['https://cdn.test/p.png'])
  })
})

describe('Excalidraw`s public libraries (YAZ-4157 demo 6K)', () => {
  const index = [{ name: 'Tools', source: 'pixelass/tools.excalidrawlib', itemNames: ['Nail', 'Hammer'] }]
  const file = { type: 'excalidrawlib', version: 2, libraryItems: [{ name: 'Nail', elements: [{ id: 'n' }] }, { name: 'Hammer', elements: [{ id: 'h' }] }] }
  const libraries = () => vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('libraries.json') ? json(index) : json(file)))

  it('the index is asked once a day; two items of one library are ONE library file', async () => {
    const fetchMock = libraries()
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    expect((await providers.drawingIndex()).items.map((i) => i.title)).toEqual(['Nail', 'Hammer'])
    await providers.drawingIndex()
    expect(await providers.drawing({ id: 'pixelass/tools.excalidrawlib#1' })).toEqual({ elements: [{ id: 'h' }] })
    expect(await providers.drawing({ id: 'pixelass/tools.excalidrawlib#0' })).toEqual({ elements: [{ id: 'n' }] })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://libraries.excalidraw.com/libraries.json', 'https://libraries.excalidraw.com/libraries/pixelass/tools.excalidrawlib'])
  })

  it('tiles that ask at the same time share ONE read of the library file and the index (polish, audit 6)', async () => {
    const fetchMock = libraries()
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    await Promise.all(Array.from({ length: 8 }, (_, i) => providers.drawing({ id: `pixelass/tools.excalidrawlib#${i % 2}` })))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const reads = cache.reads.length
    await providers.drawing({ id: 'pixelass/tools.excalidrawlib#1' })
    // From memory: no disk read either.
    expect(cache.reads.length).toBe(reads)
  })

  it('an item whose elements pass 750 KB is TOO_LARGE; so is a library file over its limit (polish, audit 7)', async () => {
    const big = { type: 'excalidrawlib', version: 2, libraryItems: [{ name: 'Nail', elements: [{ id: 'n', text: 'x'.repeat(800_000) }] }, { name: 'Hammer', elements: [] }] }
    const fetchBig = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('libraries.json') ? json(index) : json(big)))
    await expect(code(build(fetchBig as unknown as typeof globalThis.fetch, null).drawing({ id: 'pixelass/tools.excalidrawlib#0' }))).resolves.toBe('TOO_LARGE')
    cache = memoryCache()
    const fetchHuge = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('libraries.json') ? json(index) : json(file, { headers: { 'Content-Length': String(17 * 1024 * 1024) } })))
    await expect(code(build(fetchHuge as unknown as typeof globalThis.fetch, null).drawing({ id: 'pixelass/tools.excalidrawlib#0' }))).resolves.toBe('TOO_LARGE')
  })

  it('an index that cannot be had does not fail an item whose library file is at hand (checker round 1)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('libraries.json') ? json({ error: 'down' }, { status: 503 }) : json(file)))
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    expect(await providers.drawing({ id: 'pixelass/tools.excalidrawlib#1' })).toEqual({ elements: [{ id: 'h' }] })
  })

  it('a bad id is BAD_REQUEST and asks nothing; an item gone from its library is NOT_FOUND', async () => {
    const fetchMock = libraries()
    const providers = build(fetchMock as unknown as typeof globalThis.fetch, null)
    await expect(code(providers.drawing({ id: '../secrets.json#0' }))).resolves.toBe('BAD_REQUEST')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(code(providers.drawing({ id: 'pixelass/tools.excalidrawlib#7' }))).resolves.toBe('NOT_FOUND')
  })
})

describe('the bytes, and the guards 🔒 YAZ-1775 D4 put on them', () => {
  const record = { hits: [{ id: 101, type: 'vector/svg', tags: 'money bag', previewURL: 'https://cdn.test/p.png', largeImageURL: 'https://cdn.test/big.png', user: 'Alex', imageWidth: 800, imageHeight: 600 }] }

  it('refuses an id that does not belong to the provider', async () => {
    const providers = build(vi.fn() as unknown as typeof globalThis.fetch)
    await expect(code(providers.import({ provider: 'iconify', id: 'https://evil.test' }))).resolves.toBe('BAD_REQUEST')
    await expect(code(providers.import({ provider: 'pixabay', id: 'not-a-number' }))).resolves.toBe('BAD_REQUEST')
  })

  it('is UNSUPPORTED_TYPE when the provider answers with something that is not an image', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(record))
      .mockResolvedValueOnce(new Response('not an image', { headers: { 'Content-Type': 'text/plain' } }))
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).import({ provider: 'pixabay', id: '101' }))).resolves.toBe('UNSUPPORTED_TYPE')
  })

  it('is TOO_LARGE on a Content-Length past 20 MB', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(record))
      .mockResolvedValueOnce(new Response('image', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(21 * 1024 * 1024) } }))
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).import({ provider: 'pixabay', id: '101' }))).resolves.toBe('TOO_LARGE')
  })

  it('is TOO_LARGE on bytes past 20 MB even when the header lied', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(record))
      .mockResolvedValueOnce(new Response(Buffer.alloc(20 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).import({ provider: 'pixabay', id: '101' }))).resolves.toBe('TOO_LARGE')
  })

  it('imports the full-size URL, not the preview, and answers with the item the provider describes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).includes('pixabay.com/api') ? json(record) : new Response('PNG', { headers: { 'Content-Type': 'image/png' } })))
    const result = await build(fetchMock as unknown as typeof globalThis.fetch).import({ provider: 'pixabay', id: '101' })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://cdn.test/big.png')
    expect(result.item).toMatchObject({ itemKey: 'pixabay:101', title: 'Money Bag', creator: 'Alex', width: 800, height: 600 })
    expect(result.dataURL.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('is NOT_FOUND when Pixabay no longer has the record', async () => {
    const fetchMock = vi.fn(async () => json({ hits: [] }))
    await expect(code(build(fetchMock as unknown as typeof globalThis.fetch).import({ provider: 'pixabay', id: '101' }))).resolves.toBe('NOT_FOUND')
  })

  it('is PROVIDER_FAILED for a Pixabay import with no key at all', async () => {
    await expect(code(build(vi.fn() as unknown as typeof globalThis.fetch, null).import({ provider: 'pixabay', id: '101' }))).resolves.toBe('PROVIDER_FAILED')
  })
})
