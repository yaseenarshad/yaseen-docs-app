/**
 * The favorites' own copies (YAZ-4363): save, find and delete on a temp library folder; a failed copy is tried again
 * by the next backfill; Pixabay waits for a key; and an add uses the copy with the network gone. `fetch` is a stub:
 * there is not one real request here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LIBRARY_FAVORITES_DIR, type MediaBytesRequest, type MediaImportResponse, type StoredMediaItem } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import type { MediaCache } from '../media/cache'
import { createMediaProviders } from '../media/providers'
import { copyExtension, createFavoriteCopies, favoriteCopyHash, type CopyFetchers, type FavoriteCopies } from './favoriteCopies'

const icon = (name: string): StoredMediaItem => ({ itemKey: `iconify:mdi:${name}`, provider: 'iconify', providerId: `mdi:${name}`, kind: 'icon', title: name, updatedAt: 1 })
const photo = (id: string): StoredMediaItem => ({ itemKey: `pixabay:${id}`, provider: 'pixabay', providerId: id, kind: 'photo', title: `photo ${id}`, updatedAt: 1 })
const shape: StoredMediaItem = { itemKey: 'shape:star', provider: 'shape', providerId: 'star', kind: 'shape', title: 'Star', updatedAt: 1 }

const svg = (name: string): MediaImportResponse => ({ mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from(`<svg id="${name}"/>`).toString('base64')}`, item: icon(name) })
const jpg: MediaImportResponse = { mimeType: 'image/jpeg', dataURL: `data:image/jpeg;base64,${Buffer.from('JPEG').toString('base64')}`, item: photo('7') }

let dir: string
let library: string
let favorites: StoredMediaItem[]
let removed: string[]
let hasKey: boolean
let copies: FavoriteCopies
let fetchOriginal: ReturnType<typeof vi.fn<(req: MediaBytesRequest) => Promise<MediaImportResponse>>>
let fetchDrawing: ReturnType<typeof vi.fn<(id: string) => Promise<readonly unknown[]>>>
let fetchers: CopyFetchers
let componentFiles: Map<string, string>
const waits: number[] = []

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-fav-copies-'))
  library = path.join(dir, 'library')
  favorites = []
  removed = []
  hasKey = true
  waits.length = 0
  fetchOriginal = vi.fn(async (req: MediaBytesRequest) => (req.provider === 'pixabay' ? jpg : svg(req.id.split(':')[1])))
  fetchDrawing = vi.fn(async (id: string) => [{ id: `drawn-${id}`, type: 'line' }])
  fetchers = { picture: fetchOriginal, drawing: fetchDrawing }
  componentFiles = new Map()
  copies = createFavoriteCopies(library, {
    favorites: async () => favorites,
    removedKeys: async () => removed,
    hasPixabayKey: async () => hasKey,
    readComponent: async (slug) => {
      const file = componentFiles.get(slug)
      if (file === undefined) throw new BridgeFailure('NOT_FOUND', 'no such component')
      return file
    },
    wait: async (ms) => void waits.push(ms),
  })
})
afterEach(async () => {
  await copies.close()
  await rm(dir, { recursive: true, force: true })
})

const copyDir = () => path.join(library, LIBRARY_FAVORITES_DIR)
const files = async () => (await readdir(copyDir()).catch(() => [] as string[])).sort()

describe('favorite copies (YAZ-4363)', () => {
  it('saves one copy per Iconify or Pixabay favorite, named by sha1(itemKey), one each second; finds it; a removal deletes it', async () => {
    favorites = [icon('home'), photo('7'), shape]
    await copies.start(fetchers)

    expect(await files()).toEqual([`${favoriteCopyHash('iconify:mdi:home')}.svg`, `${favoriteCopyHash('pixabay:7')}.jpg`].sort())
    // The first at once, then one each second; a shape has no bytes and gets no copy.
    expect(waits).toEqual([1000])
    expect(fetchOriginal.mock.calls.map(([req]) => req)).toEqual([
      { provider: 'iconify', id: 'mdi:home' },
      { provider: 'pixabay', id: '7' },
    ])
    expect(await readFile(path.join(copyDir(), `${favoriteCopyHash('iconify:mdi:home')}.svg`), 'utf8')).toBe('<svg id="home"/>')

    const found = await copies.import({ provider: 'iconify', id: 'mdi:home' })
    expect(found?.dataURL).toBe(svg('home').dataURL)
    // The favorite's own row, without the library's stamp.
    expect(found?.item).toEqual({ itemKey: 'iconify:mdi:home', provider: 'iconify', providerId: 'mdi:home', kind: 'icon', title: 'home' })
    expect((await copies.preview({ provider: 'pixabay', id: '7' }))?.mimeType).toBe('image/jpeg')
    // The shape waits for the Add panel, which alone can build it (YAZ-4370).
    expect(await copies.status()).toEqual({ favorites: 3, saved: 2, saving: 0, waitingForKey: 0, waitingForPanel: 1, failed: 0, bytes: '<svg id="home"/>'.length + 4 })

    // A second pass has nothing to do.
    await copies.backfill()
    expect(fetchOriginal).toHaveBeenCalledTimes(2)

    favorites = [photo('7'), shape]
    await copies.remove('iconify:mdi:home')
    expect(await files()).toEqual([`${favoriteCopyHash('pixabay:7')}.jpg`])
    expect(await copies.preview({ provider: 'iconify', id: 'mdi:home' })).toBeNull()
  })

  it('a pass removes the copy of a favorite that left without its removal here (another Mac); a copy with no page stays (YAZ-4366)', async () => {
    favorites = [icon('a'), icon('b')]
    await copies.start(fetchers)
    expect(await files()).toHaveLength(2)
    // Mac B removed "b": its merge took the favorite off here, but this Mac never ran `remove`, so the copy stayed.
    favorites = [icon('a')]
    removed = ['iconify:mdi:b']
    // A copy that came before its favorite (a sync, a move): no removal names it, so it stays.
    const early = `${favoriteCopyHash('iconify:mdi:early')}.svg`
    await writeFile(path.join(copyDir(), early), '<svg id="early"/>')
    await copies.backfill()
    expect(await files()).toEqual([`${favoriteCopyHash('iconify:mdi:a')}.svg`, early].sort())
    expect((await copies.status()).bytes).toBe('<svg id="a"/>'.length + '<svg id="early"/>'.length)
    // A favorite added again after its removal keeps its copy.
    favorites = [icon('a'), icon('b')]
    await copies.backfill()
    expect(await files()).toContain(`${favoriteCopyHash('iconify:mdi:b')}.svg`)
  })

  it('a failed copy is tried again by the next backfill; no network stops the pass', async () => {
    favorites = [icon('a'), icon('b')]
    fetchOriginal.mockRejectedValueOnce(new BridgeFailure('PROVIDER_FAILED', 'provider returned 500'))
    await copies.start(fetchers)
    expect(await files()).toEqual([`${favoriteCopyHash('iconify:mdi:b')}.svg`])
    expect(await copies.status()).toMatchObject({ saved: 1, failed: 1, saving: 0 })

    await copies.backfill()
    expect(await files()).toHaveLength(2)
    expect(await copies.status()).toMatchObject({ saved: 2, failed: 0, saving: 0 })

    // Offline: the first failure stops the pass; nothing else is asked.
    favorites = [icon('a'), icon('b'), icon('c'), icon('d')]
    fetchOriginal.mockClear().mockRejectedValue(new BridgeFailure('OFFLINE', 'could not reach api.iconify.design'))
    await copies.backfill()
    expect(fetchOriginal).toHaveBeenCalledTimes(1)
    expect(await copies.status()).toMatchObject({ saved: 2, saving: 2 })
  })

  it('a Pixabay copy waits until a key exists', async () => {
    favorites = [photo('7'), icon('home')]
    hasKey = false
    await copies.start(fetchers)
    expect(fetchOriginal.mock.calls.map(([req]) => req.provider)).toEqual(['iconify'])
    expect(await copies.status()).toMatchObject({ saved: 1, waitingForKey: 1, saving: 0 })

    hasKey = true
    await copies.backfill()
    expect(await copies.status()).toMatchObject({ saved: 2, waitingForKey: 0, saving: 0 })
  })

  it('a favorite removed while its picture is on the way gets no copy', async () => {
    favorites = [icon('home')]
    fetchOriginal.mockImplementationOnce(async () => {
      favorites = []
      return svg('home')
    })
    await copies.start(fetchers)
    expect(await files()).toEqual([])
  })

  it('an add uses the copy with the network gone: the providers ask the copy first', async () => {
    favorites = [icon('home')]
    await copies.start(fetchers)
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const cache: MediaCache = { read: async () => null, write: async () => undefined, sweep: async () => 0 }
    const providers = createMediaProviders({ fetch: offline as unknown as typeof globalThis.fetch, readPixabayKey: async () => null, cache, favoriteCopy: copies })

    const added = await providers.import({ provider: 'iconify', id: 'mdi:home' })
    expect(added.dataURL).toBe(svg('home').dataURL)
    expect(added.item.itemKey).toBe('iconify:mdi:home')
    expect((await providers.preview({ provider: 'iconify', id: 'mdi:home' })).dataURL).toBe(svg('home').dataURL)
    expect(offline).not.toHaveBeenCalled()
    // No copy: the network as before, which is offline here.
    await expect(providers.import({ provider: 'iconify', id: 'mdi:away' })).rejects.toMatchObject({ code: 'OFFLINE' })
  })

  it('every kind keeps a copy (YAZ-4370): a library item and a component by main, a shape by the Add panel; the copy outlives its source', async () => {
    const drawn: StoredMediaItem = { itemKey: 'excalidraw:lib#3', provider: 'excalidraw', providerId: 'lib#3', kind: 'drawing', title: 'Hammer', updatedAt: 1 }
    const card: StoredMediaItem = { itemKey: 'component:card', provider: 'component', providerId: 'card', kind: 'component', title: 'Card', updatedAt: 1 }
    const cardFile = `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'i', type: 'image', fileId: 'f1' }], files: { f1: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AQID' } } })}\n`
    componentFiles.set('card', cardFile)
    favorites = [icon('home'), photo('7'), drawn, card, shape]
    await copies.start(fetchers)

    // Five kinds, five copies once the panel saved the shape.
    expect(fetchDrawing).toHaveBeenCalledExactlyOnceWith('lib#3')
    expect(JSON.parse((await copies.readElements(drawn.itemKey))!).elements).toEqual([{ id: 'drawn-lib#3', type: 'line' }])
    // The component's own file, image bytes inside.
    expect(await copies.readElements(card.itemKey)).toBe(cardFile)
    expect(await copies.missingForPanel()).toEqual(['shape:star'])
    const star = `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 's', type: 'line' }], files: {} })}\n`
    expect(await copies.saveElements('shape:star', star)).toBe(true)
    expect(await copies.missingForPanel()).toEqual([])
    expect(await files()).toHaveLength(5)
    expect((await files()).filter((n) => n.endsWith('.excalidraw'))).toEqual([drawn, card, shape].map((f) => `${favoriteCopyHash(f.itemKey)}.excalidraw`).sort())
    expect(await copies.status()).toMatchObject({ favorites: 5, saved: 5, saving: 0, waitingForPanel: 0, failed: 0 })

    // The first copy stays; a picture lookup never answers an elements copy.
    expect(await copies.saveElements('shape:star', star.replace('"s"', '"t"'))).toBe(false)
    expect(await copies.readElements('shape:star')).toBe(star)
    expect(await copies.preview({ provider: 'iconify', id: 'x' })).toBeNull()

    // The sources go: the copies stay and still answer.
    componentFiles.clear()
    fetchDrawing.mockRejectedValue(new BridgeFailure('NOT_FOUND', 'that item is no longer in its library'))
    await copies.backfill()
    expect(await copies.readElements(card.itemKey)).toBe(cardFile)
    expect(await copies.readElements(drawn.itemKey)).not.toBeNull()
  })

  it('a shape copy is kept only for a favorite, and only a fragment that inserts; a component that is gone is "could not be saved"', async () => {
    favorites = [{ itemKey: 'component:gone', provider: 'component', providerId: 'gone', kind: 'component', title: 'Gone', updatedAt: 1 }]
    await copies.start(fetchers)
    expect(await copies.status()).toMatchObject({ saved: 0, failed: 1 })
    expect(await copies.saveElements('shape:star', `${JSON.stringify({ elements: [{ id: 's', type: 'line' }] })}`)).toBe(false)
    await expect(copies.saveElements('component:gone', '{"elements": []}')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('names the extension from the picture type', () => {
    expect(['image/svg+xml', 'image/jpeg', 'image/png', 'image/webp', 'text/html'].map(copyExtension)).toEqual(['svg', 'jpg', 'png', 'webp', null])
  })
})
