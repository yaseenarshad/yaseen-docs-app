/**
 * The Add tab's session (YAZ-1990, YAZ-4157): the search without React. What is pinned here is what makes
 * it safe to outlive the panel — a page is never asked for twice, and a response that lands after a
 * newer search started (even one started by a later mount) is dropped — and the pause before the web is asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaSearchResponse, StudioItem } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { media: { search: vi.fn() } },
}))

import { api, BridgeRequestError } from '../api'
import { imageStudioSession, OFFLINE_NOTICE, pickChip, resetImageStudioSession, runSearch, scrollTops, SEARCH_PAUSE_MS, searchNow, typeQuery, wasRequested } from './imageStudioSession'

const search = vi.mocked(api.media.search)
const state = () => imageStudioSession.getState()

const item = (key: string): StudioItem => ({ itemKey: `iconify:${key}`, provider: 'iconify', providerId: key, kind: 'icon', title: key })
const page = (keys: string[], nextCursor: string | null = null): MediaSearchResponse => ({ items: keys.map(item), nextCursor, pixabayAvailable: true, warnings: [] })

/** A search response the test releases by hand, to order two requests' answers. */
function deferred() {
  let resolve: (value: MediaSearchResponse) => void = () => {}
  const promise = new Promise<MediaSearchResponse>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  resetImageStudioSession()
  search.mockReset().mockResolvedValue(page([]))
})

describe('a fresh search', () => {
  it('asks with the trimmed query and the chip`s source, and keeps what comes back', async () => {
    imageStudioSession.set({ query: '  mountain ', chip: 'icons' })
    search.mockResolvedValue(page(['a', 'b'], 'PAGE2'))
    await runSearch()
    expect(search).toHaveBeenCalledWith({ q: 'mountain', source: 'iconify', cursor: null })
    expect(state()).toMatchObject({ searchedQuery: 'mountain', cursor: 'PAGE2', isSearching: false })
    expect(state().results.map(({ title }) => title)).toEqual(['a', 'b'])
  })

  it('a one-character query, or a chip that never reaches the web, asks nothing and says nothing', async () => {
    imageStudioSession.set({ query: 'a' })
    await runSearch()
    imageStudioSession.set({ query: 'mountain', chip: 'shapes' })
    await runSearch()
    expect(search).not.toHaveBeenCalled()
    expect(state().error).toBeNull()
  })

  it('asks every provider under All, and Pixabay alone under Photos', async () => {
    imageStudioSession.set({ query: 'tree' })
    await runSearch()
    pickChip('photos')
    await Promise.resolve()
    expect(search.mock.calls.map(([req]) => req.source)).toEqual(['all', 'pixabay'])
  })

  it('is a passive offline state, not an error, when no provider can be reached', async () => {
    imageStudioSession.set({ query: 'mountain' })
    search.mockRejectedValue(new BridgeRequestError('OFFLINE', 'no network'))
    await runSearch()
    expect(state()).toMatchObject({ offline: true, error: null, isSearching: false })
  })
})

describe('the next page', () => {
  it('appends without duplicates and is never asked for twice', async () => {
    imageStudioSession.set({ query: 'mountain' })
    search.mockResolvedValueOnce(page(['a'], 'PAGE2')).mockResolvedValue(page(['a', 'b'], 'PAGE2'))
    await runSearch()
    await runSearch({ append: true })
    await runSearch({ append: true })
    expect(search.mock.calls.filter(([req]) => req.cursor === 'PAGE2')).toHaveLength(1)
    expect(wasRequested('PAGE2')).toBe(true)
    expect(state().results.map(({ title }) => title)).toEqual(['a', 'b'])
  })

  it('asks again only when retried, and says so when it fails offline', async () => {
    imageStudioSession.set({ query: 'mountain' })
    search.mockResolvedValueOnce(page(['a'], 'PAGE2')).mockRejectedValueOnce(new BridgeRequestError('OFFLINE', 'no network'))
    await runSearch()
    await runSearch({ append: true })
    expect(state().pageError).toBe(OFFLINE_NOTICE)
    search.mockResolvedValue(page(['b']))
    await runSearch({ append: true, retry: true })
    expect(state()).toMatchObject({ pageError: null, cursor: null })
    expect(state().results.map(({ title }) => title)).toEqual(['a', 'b'])
  })
})

describe('outliving the panel', () => {
  it('drops an older search that answers after a newer one', async () => {
    const slow = deferred()
    search.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page(['river']))
    imageStudioSession.set({ query: 'mountain' })
    const first = runSearch()
    imageStudioSession.set({ query: 'river' })
    await runSearch()
    slow.resolve(page(['mountain']))
    await first
    expect(state().searchedQuery).toBe('river')
    expect(state().results.map(({ title }) => title)).toEqual(['river'])
    expect(state().isSearching).toBe(false)
  })

  it('a reset forgets everything, including an answer still on its way', async () => {
    const slow = deferred()
    search.mockReturnValueOnce(slow.promise)
    imageStudioSession.set({ query: 'mountain', chip: 'icons' })
    scrollTops.icons = 400
    const pending = runSearch()
    resetImageStudioSession()
    slow.resolve(page(['mountain']))
    await pending
    expect(state()).toMatchObject({ chip: 'all', query: '', results: [], isSearching: false })
    expect(scrollTops.icons).toBe(0)
  })
})

describe('typing (YAZ-4157 D3): the web is asked on a pause, Enter asks at once', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it(`asks once, ${SEARCH_PAUSE_MS} ms after the last key, with the last text`, async () => {
    for (const text of ['ro', 'roc', 'rocket']) {
      typeQuery(text)
      await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS - 50)
    }
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith({ q: 'rocket', source: 'all', cursor: null })
  })

  it('a pause on two letters asks nothing and drops the old results; Enter on them still asks (demo 6E, polish)', async () => {
    search.mockResolvedValueOnce(page(['rocket']))
    typeQuery('rocket')
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    expect(state().results).not.toEqual([])
    search.mockClear()
    typeQuery('ro')
    expect(state()).toMatchObject({ results: [], searchedQuery: '' })
    expect(state().waiting).toBe(false)
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS * 2)
    expect(search).not.toHaveBeenCalled()
    searchNow()
    expect(search).toHaveBeenCalledWith({ q: 'ro', source: 'all', cursor: null })
  })

  it('is `waiting` for the pause only: from the key until the search starts', async () => {
    typeQuery('rocket')
    expect(state().waiting).toBe(true)
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    expect(state().waiting).toBe(false)
    typeQuery('rocketship')
    typeQuery('r')
    expect(state().waiting).toBe(false)
    typeQuery('rocketship')
    searchNow()
    expect(state().waiting).toBe(false)
  })

  it('Enter asks now, and the pause after it asks nothing again', async () => {
    typeQuery('rocket')
    searchNow()
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS * 2)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('the same text again is not asked again', async () => {
    typeQuery('rocket')
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    typeQuery('rocket ')
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('text too short for the web drops the old results at once, and an answer still on its way', async () => {
    const slow = deferred()
    search.mockReturnValueOnce(slow.promise)
    typeQuery('rocket')
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    typeQuery('r')
    slow.resolve(page(['rocket']))
    await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS)
    expect(state()).toMatchObject({ query: 'r', results: [], searchedQuery: '', isSearching: false })
  })
})
