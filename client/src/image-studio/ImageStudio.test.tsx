/**
 * The Add tab (YAZ-4157; before it, YAZ-1818's Images tab and YAZ-1819's Components tab). The bridge is stubbed at
 * the client `api` seam, like every other test in this repo, and the engine's element package at
 * `loadExcalidrawElement` — so what is pinned here is the TAB's behaviour: one field over everything, the sections and
 * the chips, what one add teaches the library, what it never asks for (a stored `previewUrl`), what it hides with no
 * key, and what still works with no network.
 */
import { DEFAULT_MEDIA_FILTERS } from '@shared/iconPacks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IconPacksStatus } from '@shared/iconPacks'
import { DEFAULT_SETTINGS, type ComponentItem, type MediaLibraryFile, type StoredMediaItem, type StudioItem, type UsedMediaItem } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    media: { favorites: vi.fn(), recent: vi.fn(), used: vi.fn(), onChanged: vi.fn(), search: vi.fn(), preview: vi.fn(), import: vi.fn(), drawingIndex: vi.fn(), drawing: vi.fn(), packs: vi.fn(), onPacksProgress: vi.fn(), packList: vi.fn(), favoriteElements: vi.fn(), saveFavoriteElements: vi.fn(), favoritesForPanel: vi.fn() },
    components: { list: vi.fn(), save: vi.fn(), read: vi.fn(), rename: vi.fn(), delete: vi.fn(), preview: vi.fn(), onChanged: vi.fn() },
    dialog: { openDrawing: vi.fn() },
    secrets: { has: vi.fn(), set: vi.fn() },
    shell: { openLink: vi.fn() },
  },
}))
vi.mock('../drawings/engine', () => ({ loadExcalidrawElement: vi.fn() }))
vi.mock('../components-library/pastedImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components-library/pastedImage')>()),
  // jsdom draws no pictures; `pastedImage.test.ts` tests the real one.
  captureImageFile: vi.fn(async () => ({ elements: [{ id: 'img-1', type: 'image', fileId: 'f1' }], files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AQID' } } })),
}))
vi.mock('../lib/storage', () => ({ storage: { getSettings: vi.fn(), subscribe: vi.fn(), patchSettings: vi.fn() } }))

import { api, BridgeRequestError } from '../api'
import { loadExcalidrawElement } from '../drawings/engine'
import { storage } from '../lib/storage'
import { clearPreviewMemo, ImageStudio, READ_ONLY_NOTICE, type ImageStudioProps } from './ImageStudio'
import { imageStudioSession, OFFLINE_NOTICE, OFFLINE_WITH_PACKS_NOTICE, resetImageStudioSession, SEARCH_PAUSE_MS } from './imageStudioSession'
import type { SmartShapeApi } from './shapes'
import { resetIconPacks } from './useIconPacks'

const media = vi.mocked(api.media)
const components = vi.mocked(api.components)
const dialog = vi.mocked(api.dialog)
const secrets = vi.mocked(api.secrets)
const loadElement = vi.mocked(loadExcalidrawElement)
const store = vi.mocked(storage)

const item = (over: Partial<StudioItem> = {}): StudioItem => ({ itemKey: 'iconify:noto:money-bag', provider: 'iconify', providerId: 'noto:money-bag', kind: 'icon', title: 'money bag', ...over })
const stored = (over: Partial<StudioItem & { updatedAt: number }> = {}): StoredMediaItem => ({ ...item(), updatedAt: 1, ...over })
const usedRow = (over: Partial<UsedMediaItem> = {}): UsedMediaItem => ({ ...stored(), count: 1, words: [], ...over })
const icon = (name: string, set = 'set') => item({ itemKey: `iconify:${set}:${name}`, providerId: `${set}:${name}`, title: name.replace(/-/g, ' ') })
const component = (over: Partial<ComponentItem> = {}): ComponentItem => ({ slug: 'pricing-card', name: 'Pricing card', elementCount: 2, createdAt: 1, updatedAt: 1, ...over })
const libraryOf = (over: Partial<MediaLibraryFile> = {}): MediaLibraryFile => ({ version: 1, favorites: [], recent: [], used: [], removed: {}, ...over })
const rect = (id: string) => ({ id, type: 'rectangle' })

const smart: SmartShapeApi = {
  SMART_SHAPE_DEFINITIONS: [
    { id: 'arrow-right', title: 'Arrow right', kind: 'filled-arrow', width: 200, height: 100, closed: true, roundness: null, defaults: {}, handles: ['shaft'] },
  ] as unknown as SmartShapeApi['SMART_SHAPE_DEFINITIONS'],
  generateSmartShapePoints: () =>
    [
      [0, 0],
      [200, 50],
      [0, 100],
    ] as unknown as ReturnType<SmartShapeApi['generateSmartShapePoints']>,
  createSmartShapeMetadata: (id) => ({ version: 1, id, kind: 'filled-arrow', parameters: {} }),
}
/** The element package answers both the Smart Shapes (the catalog) and a capture (Save selection). */
const elementPackage = {
  ...smart,
  getSelectedElements: vi.fn(() => [rect('a'), rect('b')]),
  deepCopyElement: vi.fn((el: unknown) => ({ ...(el as object) })),
}

const engine = {
  convertToExcalidrawElements: (skeletons: unknown[]) => skeletons.map((s, i) => ({ ...(s as object), id: `new-${i}` })),
  CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY' },
  restoreElements: vi.fn((elements: unknown) => elements),
  exportToBlob: vi.fn(async () => new Blob([new Uint8Array(8)], { type: 'image/png' })),
} as unknown as ImageStudioProps['engine']

function fakeCanvas() {
  const updateScene = vi.fn()
  const insertImages = vi.fn(async () => undefined)
  const insertElements = vi.fn()
  return {
    updateScene,
    insertImages,
    insertElements,
    api: {
      getAppState: () => ({ width: 800, height: 600, zoom: { value: 1 }, scrollX: 0, scrollY: 0, selectedElementIds: { a: true }, theme: 'light' }),
      getSceneElementsIncludingDeleted: () => [],
      getSceneElements: () => [rect('a'), rect('b')],
      getFiles: () => ({}),
      addFiles: vi.fn(),
      insertElements,
      updateScene,
      insertImages,
    } as unknown as ImageStudioProps['excalidrawAPI'],
  }
}

/** The icon packs as main reports them (YAZ-4359): none on the Mac unless a test says otherwise. */
const packsStatus = (over: Partial<IconPacksStatus> = {}): IconPacksStatus => ({ state: 'none', folder: '/u/icon-packs', version: null, packs: 0, total: 281, bytes: 0, totalBytes: 135 * 1024 * 1024, checkedAt: null, message: null, failed: false, ...over })
let packsListener: ((status: IconPacksStatus) => void) | null = null

let root: Root | null = null
let container: HTMLElement | null = null
let library = libraryOf()

beforeEach(() => {
  clearPreviewMemo()
  resetImageStudioSession()
  library = libraryOf()
  media.favorites.mockReset().mockImplementation(async (req) => {
    library = req.op === 'add' ? { ...library, favorites: [{ ...req.item, updatedAt: 2 }, ...library.favorites] } : req.op === 'remove' ? { ...library, favorites: library.favorites.filter((f) => f.itemKey !== req.itemKey) } : library
    return library.favorites
  })
  media.used.mockReset().mockImplementation(async () => library)
  media.onChanged.mockReset().mockReturnValue(() => {})
  media.search.mockReset().mockResolvedValue({ items: [], nextCursor: null, pixabayAvailable: false, warnings: [] })
  media.preview.mockReset().mockResolvedValue({ mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PREVIEW' })
  media.drawingIndex.mockReset().mockResolvedValue({ items: [] })
  media.drawing.mockReset().mockResolvedValue({ elements: [{ id: 'line-1', type: 'line', isDeleted: false }] })
  media.favoriteElements.mockReset().mockResolvedValue(null)
  media.saveFavoriteElements.mockReset().mockResolvedValue(true)
  media.favoritesForPanel.mockReset().mockResolvedValue([])
  media.import.mockReset().mockResolvedValue({ mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa('<svg/>')}`, item: item({ width: 48, height: 48 }) })
  components.list.mockReset().mockResolvedValue([])
  components.save.mockReset().mockResolvedValue(component({ slug: 'new-one', name: 'New one' }))
  components.read.mockReset().mockResolvedValue({ fragmentJson: JSON.stringify({ elements: [rect('a')], files: {} }) })
  components.rename.mockReset().mockImplementation(async ({ slug, name }) => component({ slug, name }))
  components.delete.mockReset().mockResolvedValue(undefined)
  components.preview.mockReset().mockResolvedValue('data:image/png;base64,COMPONENT')
  components.onChanged.mockReset().mockReturnValue(() => undefined)
  dialog.openDrawing.mockReset().mockResolvedValue({ cancelled: true })
  secrets.has.mockReset().mockResolvedValue(false)
  loadElement.mockReset().mockResolvedValue(elementPackage as unknown as Awaited<ReturnType<typeof loadExcalidrawElement>>)
  store.getSettings.mockReset().mockReturnValue(DEFAULT_SETTINGS)
  store.subscribe.mockReset().mockReturnValue(() => undefined)
  store.patchSettings.mockReset()
  resetIconPacks()
  media.packs.mockReset().mockResolvedValue(packsStatus())
  media.onPacksProgress.mockReset().mockImplementation((listener) => {
    packsListener = listener as (status: IconPacksStatus) => void
    return () => undefined
  })
  media.packList.mockReset().mockResolvedValue([])
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

async function mount(props: Partial<ImageStudioProps> = {}) {
  const canvas = fakeCanvas()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<ImageStudio engine={engine} excalidrawAPI={canvas.api} hasSelection={false} {...props} />)
  })
  await settle()
  return { canvas, host: container }
}

/** Flush tasks: a preview goes through `FileReader`, which settles on a task rather than a microtask. */
const settle = async (turns = 3) => {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')]
const byText = (host: HTMLElement, text: string) => buttons(host).find((button) => button.textContent?.trim() === text)
const byLabel = (host: HTMLElement, label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const field = (host: HTMLElement) => byLabel(host, 'Search shapes, icons, and components') as HTMLInputElement
/** A choice of Filter › Show (the old chips, YAZ-4348 demo): opens the menu when it is closed. */
const showOption = async (host: HTMLElement, label: string) => {
  if (host.querySelector('.image-studio__filter-menu') === null) await click(host.querySelector('.image-studio__filter-button'))
  return [...host.querySelectorAll('.image-studio__filter-menu [aria-label="Show"] button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
}
const section = (host: HTMLElement, title: string) => host.querySelector<HTMLElement>(`section[aria-label="${title}"]`)
const tileNames = (host: HTMLElement | null) => [...(host?.querySelectorAll('.image-studio__name') ?? [])].map((n) => n.textContent)
const click = async (element: Element | null | undefined) => {
  await act(async () => {
    ;(element as HTMLElement).click()
  })
  await settle(2)
}
/** A right-click on the tile of `title` (D10, demo 6B): the tile menu's door. Returns whether the event was allowed. */
const rightClick = async (host: HTMLElement, title: string) => {
  let allowed = true
  await act(async () => {
    allowed = byLabel(host, `Add ${title}`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  })
  await settle(2)
  return allowed
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const key = async (target: Element, k: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}
/** Type a query and press Enter, so the web is asked now. */
async function search(host: HTMLElement, query = 'money bag') {
  await type(field(host), query)
  await key(field(host), 'Enter')
  await settle()
}

describe('the empty field: Favorites, Recent, Components, Shapes (D7)', () => {
  it('lists the whole library in one read on mount, and the components', async () => {
    await mount()
    expect(media.used).toHaveBeenCalledWith({ op: 'list' })
    expect(components.list).toHaveBeenCalled()
  })

  it('shows each section one row of four, with Show all only past four; an empty section is not shown', async () => {
    library = libraryOf({ favorites: ['a', 'b', 'c', 'd', 'e'].map((n) => stored(icon(n))), recent: [stored(icon('r'))] })
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    expect(tileNames(section(host, 'Favorites'))).toEqual(['a', 'b', 'c', 'd'])
    expect(section(host, 'Favorites')?.querySelector('.image-studio__show-all')?.textContent).toBe('Show all')
    expect(tileNames(section(host, 'Recent'))).toEqual(['r'])
    expect(section(host, 'Recent')?.querySelector('.image-studio__show-all')).toBeNull()
    expect(tileNames(section(host, 'Components'))).toEqual(['Pricing card'])
    expect(tileNames(section(host, 'Shapes'))).toHaveLength(4)
    library = libraryOf()
    components.list.mockResolvedValue([])
    resetImageStudioSession()
    act(() => root?.unmount())
    const again = await mount()
    expect(section(again.host, 'Favorites')).toBeNull()
    expect(section(again.host, 'Components')).toBeNull()
  })

  it('Show all picks the Show choice that shows the rest; Recent, which has no chip, opens in place', async () => {
    library = libraryOf({ recent: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => stored(icon(n))) })
    const { host } = await mount()
    await click(section(host, 'Shapes')!.querySelector('.image-studio__show-all'))
    expect((await showOption(host, 'Shapes'))?.getAttribute('aria-checked')).toBe('true')
    expect(tileNames(section(host, 'Shapes')).length).toBeGreaterThan(4)
    await click(await showOption(host, 'All'))
    await click(section(host, 'Recent')!.querySelector('.image-studio__show-all'))
    expect(tileNames(section(host, 'Recent'))).toHaveLength(6)
    expect(section(host, 'Recent')!.querySelector('.image-studio__show-all')?.textContent).toBe('Show less')
  })

  it('the Filter menu stays open after a Show pick, so several picks are one trip (YAZ-4348 demo round 2)', async () => {
    const { host } = await mount()
    await click(await showOption(host, 'Shapes'))
    expect(host.querySelector('.image-studio__filter-menu')).not.toBeNull()
    await click([...host.querySelectorAll('.image-studio__filter-menu [aria-label="Colors"] button')].find((b) => b.textContent === 'One color'))
    expect(host.querySelector('.image-studio__filter-menu')).not.toBeNull()
    expect((await showOption(host, 'Shapes'))?.getAttribute('aria-checked')).toBe('true')
  })

  it('re-lists the library on media:changed and the components on components:changed', async () => {
    let fireMedia = () => {}
    let fireComponents = () => {}
    media.onChanged.mockImplementation((listener) => ((fireMedia = listener), () => {}))
    components.onChanged.mockImplementation((listener) => ((fireComponents = listener), () => {}))
    const { host } = await mount()
    library = libraryOf({ favorites: [stored()] })
    components.list.mockResolvedValue([component()])
    await act(async () => {
      fireMedia()
      fireComponents()
    })
    await settle()
    expect(tileNames(section(host, 'Favorites'))).toEqual(['money bag'])
    expect(tileNames(section(host, 'Components'))).toEqual(['Pricing card'])
  })

  it('shows the basic shapes at once and the Smart Shapes when the package lands', async () => {
    let land: (value: never) => void = () => {}
    loadElement.mockReturnValue(new Promise((resolve) => (land = resolve)))
    const { host } = await mount()
    await click(await showOption(host, 'Shapes'))
    const before = tileNames(section(host, 'Shapes')).length
    await act(async () => land(elementPackage as never))
    expect(tileNames(section(host, 'Shapes'))).toHaveLength(before + 1)
  })
})

describe('typing: Best matches, then From the web (D3, D4, D7)', () => {
  it('ranks your own items first, with no web result twice', async () => {
    library = libraryOf({ favorites: [stored(icon('rocket'))] })
    components.list.mockResolvedValue([component({ slug: 'rocket-ship', name: 'Rocket ship' })])
    media.search.mockResolvedValue({ items: [icon('rocket'), icon('rocket launch')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host } = await mount()
    await search(host, 'rocket')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['rocket', 'Rocket ship'])
    expect(tileNames(section(host, 'From the web'))).toEqual(['rocket launch'])
  })

  it('a word you taught an item puts it first (the Emoji app`s learned pick)', async () => {
    library = libraryOf({ favorites: [stored(icon('rocket'))], used: [usedRow({ ...icon('launch pad'), words: ['rocket'] })] })
    const { host } = await mount()
    await type(field(host), 'rocket')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['launch pad', 'rocket'])
  })

  it('finds a shape by its alias, through the same ranking', async () => {
    const { host } = await mount()
    await type(field(host), 'decision')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['Diamond'])
  })

  it('a typed text that matches nothing of yours, too short for a pause search, still says something (All chip) (6Q)', async () => {
    const { host } = await mount()
    await type(field(host), 'zq')
    await settle()
    expect(host.querySelector('.image-studio__list')!.textContent?.trim()).not.toBe('')
  })

  it('one typed letter that matches nothing does not say Press Enter: Enter needs 2 letters (6S)', async () => {
    const { host } = await mount()
    await type(field(host), 'z')
    await settle()
    expect(host.querySelector('.image-studio__list')!.textContent).toContain('Nothing of yours matches “z”.')
    expect(host.querySelector('.image-studio__list')!.textContent).not.toContain('Press Enter to search the web')
  })

  it(`asks the web ${SEARCH_PAUSE_MS} ms after the last key; your items need no wait`, async () => {
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    vi.useFakeTimers()
    await type(field(host), 'mon')
    await type(field(host), 'money')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['money bag'])
    expect(media.search).not.toHaveBeenCalled()
    // The pause is not a blank: the web half says it is coming from the first key.
    expect(section(host, 'From the web')?.textContent).toContain('Searching the web…')
    await act(async () => vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS))
    expect(media.search).toHaveBeenCalledTimes(1)
    expect(media.search).toHaveBeenCalledWith({ q: 'money', source: 'all', cursor: null, filters: DEFAULT_MEDIA_FILTERS })
  })

  it('says which query found nothing on the web', async () => {
    const { host } = await mount()
    await search(host, 'zzqx')
    expect(section(host, 'From the web')?.textContent).toContain('No graphics match “zzqx”')
  })

  it('is a passive offline line, not an error, when the machine cannot reach a provider (🔒 YAZ-1775 D4)', async () => {
    library = libraryOf({ favorites: [stored()] })
    media.search.mockRejectedValue(new BridgeRequestError('OFFLINE', 'no network'))
    const { host } = await mount()
    await search(host, 'money')
    expect(section(host, 'From the web')?.textContent).toContain(OFFLINE_NOTICE)
    expect(host.querySelector('.image-studio__error')).toBeNull()
    expect(tileNames(section(host, 'Best matches'))).toEqual(['money bag'])
  })

  it('shows a real error for a real failure', async () => {
    media.search.mockRejectedValue(new Error('Iconify said 500'))
    const { host } = await mount()
    await search(host)
    expect(host.querySelector('.image-studio__error')?.textContent).toBe('Iconify said 500')
  })

  it('shows a provider warning when one of the two was having a bad day', async () => {
    media.search.mockResolvedValue({ items: [item()], nextCursor: null, pixabayAvailable: true, warnings: ['Pixabay is slow.'] })
    const { host } = await mount()
    await search(host)
    expect(host.querySelector('.image-studio__warning')?.textContent).toBe('Pixabay is slow.')
  })
})

describe('Filter › Show, the old chips (D8; moved into the Filter menu in the YAZ-4348 demo)', () => {
  it('Icons asks Iconify alone and shows only icons of yours; Shapes asks the web nothing', async () => {
    library = libraryOf({ favorites: [stored(icon('star icon'))] })
    const { host } = await mount()
    await click(await showOption(host, 'Icons'))
    await search(host, 'star')
    expect(media.search).toHaveBeenLastCalledWith({ q: 'star', source: 'iconify', cursor: null, filters: DEFAULT_MEDIA_FILTERS })
    expect(tileNames(section(host, 'Best matches'))).toEqual(['star icon'])
    media.search.mockClear()
    await click(await showOption(host, 'Shapes'))
    expect(media.search).not.toHaveBeenCalled()
    expect(tileNames(section(host, 'Best matches'))).toEqual(['Star'])
    expect(section(host, 'From the web')).toBeNull()
  })

  it('offers Photos only when a Pixabay key is set, and follows the search answer when the key changes', async () => {
    const { host } = await mount()
    expect(await showOption(host, 'Photos')).toBeUndefined()
    media.search.mockResolvedValue({ items: [], nextCursor: null, pixabayAvailable: true, warnings: [] })
    await search(host)
    expect(await showOption(host, 'Photos')).toBeDefined()
  })

  it('Icons and Photos with an empty field ask you to type', async () => {
    const { host } = await mount()
    await click(await showOption(host, 'Icons'))
    expect(host.querySelector('.image-studio__state')?.textContent).toBe('Type to search icons.')
  })
})

describe('previews', () => {
  it('asks media:preview by provider and id, and NEVER uses a stored previewUrl', async () => {
    library = libraryOf({ favorites: [stored({ previewUrl: '/api/image-studio/preview/iconify/noto%3Amoney-bag' })] })
    const { host } = await mount()
    expect(media.preview).toHaveBeenCalledWith({ provider: 'iconify', id: 'noto:money-bag' })
    expect(host.querySelector('.image-studio__preview img')?.getAttribute('src')).toBe('data:image/svg+xml;base64,PREVIEW')
    expect(host.innerHTML).not.toContain('/api/image-studio/preview')
  })

  it('draws a placeholder rather than an error when the preview cannot be had, and the tile still adds', async () => {
    media.preview.mockRejectedValue(new BridgeRequestError('OFFLINE', 'could not reach api.iconify.design'))
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    expect(section(host, 'Favorites')?.querySelector('.image-studio__placeholder')).not.toBeNull()
    expect(host.querySelector('.image-studio__error')).toBeNull()
    expect((byLabel(host, 'Add money bag') as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks for one preview once, however often its tile re-mounts', async () => {
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    await click(await showOption(host, 'Shapes'))
    await click(await showOption(host, 'All'))
    expect(media.preview).toHaveBeenCalledTimes(1)
  })

  it('draws a component from components:preview', async () => {
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    expect(components.preview).toHaveBeenCalledWith({ slug: 'pricing-card' })
    expect(section(host, 'Components')?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,COMPONENT')
  })

  it('keeps at most 300 tile pictures: past that the least recently seen goes (YAZ-2073 5J)', async () => {
    library = libraryOf({ favorites: Array.from({ length: 301 }, (_, i) => stored(icon(`i${i}`))) })
    const { host } = await mount()
    await click(await showOption(host, 'Favorites'))
    expect(media.preview).toHaveBeenCalledTimes(301)
    await click(await showOption(host, 'Shapes'))
    await click(await showOption(host, 'Favorites'))
    expect(media.preview).toHaveBeenCalledTimes(302)
    expect(media.preview).toHaveBeenLastCalledWith({ provider: 'iconify', id: 'set:i0' })
  })
})

describe('the infinite scroll of the web results', () => {
  /** jsdom has a no-op IntersectionObserver (`test-setup.ts`); this one hands back its callback. */
  function captureObserver() {
    const observed: Element[] = []
    let fire: () => void = () => {}
    class Capturing {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
        fire = () => this.callback([{ isIntersecting: true }])
      }
      observe(element: Element) {
        observed.push(element)
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    const original = globalThis.IntersectionObserver
    ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = Capturing
    return { observed, fire: () => fire(), restore: () => ((globalThis as unknown as Record<string, unknown>).IntersectionObserver = original) }
  }

  it('watches a sentinel while there is a next page, loads it once, and never asks a cursor twice', async () => {
    const observer = captureObserver()
    try {
      media.search.mockResolvedValueOnce({ items: [item()], nextCursor: 'PAGE2', pixabayAvailable: false, warnings: [] })
      media.search.mockResolvedValue({ items: [icon('money-coin')], nextCursor: null, pixabayAvailable: false, warnings: [] })
      const { host } = await mount()
      await search(host)
      expect(observer.observed).toHaveLength(1)
      await act(async () => observer.fire())
      await act(async () => observer.fire())
      await settle()
      expect(media.search.mock.calls.filter(([req]) => req.cursor === 'PAGE2')).toHaveLength(1)
      expect(tileNames(section(host, 'From the web'))).toEqual(['money bag', 'money coin'])
      expect(host.querySelector('.image-studio__search-sentinel')).toBeNull()
    } finally {
      observer.restore()
    }
  })
})

describe('one tile per icon, its copies on request (demo 6J)', () => {
  it('the same icon from other sets and in other styles is ONE tile with +N; +N shows them; a word inside a name is no match', async () => {
    media.search.mockResolvedValue({
      items: [icon('nail-polish', 'noto'), icon('nail-polish', 'twemoji'), icon('nail-polish-medium-dark', 'fluent-emoji-flat'), icon('snail', 'noto'), icon('hammer-and-nail', 'pinhead')],
      nextCursor: null,
      pixabayAvailable: false,
      warnings: [],
    })
    const { host } = await mount()
    await search(host, 'nail')
    const web = () => section(host, 'From the web')!
    expect(tileNames(web())).toEqual(['nail polish', 'hammer and nail'])
    const more = byLabel(host, 'Show 2 more like nail polish')!
    expect(more.textContent).toBe('+2')
    await click(more)
    expect(tileNames(byLabel(host, 'More like nail polish'))).toEqual(['nail polish', 'nail polish medium dark'])
    await click(byLabel(host, 'Hide 2 more like nail polish'))
    expect(byLabel(host, 'More like nail polish')).toBeNull()
  })

  const nails = () =>
    media.search.mockResolvedValue({
      items: [icon('nail-polish', 'noto'), icon('nail-polish', 'twemoji'), icon('nail-polish-medium-dark', 'fluent-emoji-flat'), icon('hammer-and-nail', 'pinhead')],
      nextCursor: null,
      pixabayAvailable: false,
      warnings: [],
    })

  it('a right-click on a tile inside an open group opens its menu, and the group stays open (YAZ-4348 demo round 2)', async () => {
    nails()
    const { host } = await mount()
    await search(host, 'nail')
    await click(byLabel(host, 'Show 2 more like nail polish'))
    const inGroup = byLabel(host, 'More like nail polish')!.querySelector<HTMLElement>('[aria-label="Add nail polish medium dark"]')!
    await act(async () => {
      inGroup.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    })
    await settle(2)
    expect(byLabel(host, 'More like nail polish')).not.toBeNull()
    expect(byLabel(host, 'More like nail polish')!.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('Filter › Similar icons › Show each one shows every icon as its own tile, and is kept in the settings (YAZ-4348 demo round 2)', async () => {
    nails()
    const filterButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.image-studio__filter-button')!
    const option = (host: HTMLElement, group: string, text: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(`.image-studio__filter-menu [aria-label="${group}"] button`)].find((b) => b.textContent === text)
    const { host } = await mount()
    await search(host, 'nail')
    expect(tileNames(section(host, 'From the web'))).toEqual(['nail polish', 'hammer and nail'])
    await click(filterButton(host))
    await click(option(host, 'Similar icons', 'Show each one'))
    expect(tileNames(section(host, 'From the web'))).toEqual(['nail polish', 'nail polish', 'nail polish medium dark', 'hammer and nail'])
    expect(byLabel(host, 'Show 2 more like nail polish')).toBeNull()
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaGroupSimilar: false })
    // A view choice, not a filter: no badge, and Clear filters keeps it
    expect(filterButton(host)?.getAttribute('aria-label')).toBe('Filter')
  })
})

describe('Excalidraw`s public libraries: the Hand-drawn section (demo 6K)', () => {
  const drawing = (index: number, title: string): StudioItem => ({
    itemKey: `excalidraw:pixelass/tools.excalidrawlib#${index}`,
    provider: 'excalidraw',
    providerId: `pixelass/tools.excalidrawlib#${index}`,
    kind: 'drawing',
    title,
    collectionName: 'Tools',
  })

  it('ranks the library items as you type, with no web request per key; the library name finds its items', async () => {
    media.drawingIndex.mockResolvedValue({ items: [drawing(0, 'Nail'), drawing(1, 'Hammer'), drawing(2, 'Saw')] })
    const { host } = await mount()
    vi.useFakeTimers()
    await type(field(host), 'hammer')
    expect(tileNames(section(host, 'Hand-drawn'))).toEqual(['Hammer'])
    expect(media.search).not.toHaveBeenCalled()
    await type(field(host), 'tools')
    expect(tileNames(section(host, 'Hand-drawn'))).toEqual(['Nail', 'Hammer', 'Saw'])
    expect(media.drawingIndex).toHaveBeenCalledTimes(1)
  })

  it('adding one puts its elements on the board like a component, and records the use', async () => {
    media.drawingIndex.mockResolvedValue({ items: [drawing(1, 'Hammer')] })
    const { host, canvas } = await mount()
    await type(field(host), 'hammer')
    await click(section(host, 'Hand-drawn')!.querySelector('[aria-label="Add Hammer"]'))
    expect(media.drawing).toHaveBeenCalledWith({ id: 'pixelass/tools.excalidrawlib#1' })
    expect(canvas.insertElements).toHaveBeenCalled()
    expect(media.import).not.toHaveBeenCalled()
    expect(media.used).toHaveBeenCalledWith({ op: 'record', item: expect.objectContaining({ itemKey: 'excalidraw:pixelass/tools.excalidrawlib#1' }), query: 'hammer' })
    expect(byLabel(host, 'Add Hammer')!.title).toBe('Hammer — Excalidraw library · Tools')
  })
})

describe('adding to the board, and what it teaches (D1, D9)', () => {
  it('puts a shape on the canvas with no import and no network, and records the use', async () => {
    const { host, canvas } = await mount()
    await click(byLabel(host, 'Add Rectangle'))
    expect(canvas.updateScene).toHaveBeenCalled()
    expect(media.import).not.toHaveBeenCalled()
    expect(media.used).toHaveBeenCalledWith({ op: 'record', item: expect.objectContaining({ itemKey: 'shape:rectangle' }), query: '' })
  })

  it('imports an image, hands it to the engine as a File, and records it with the search as its word', async () => {
    media.search.mockResolvedValue({ items: [item({ collectionName: 'Noto Emoji' })], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host, canvas } = await mount()
    await search(host, 'money')
    await click(section(host, 'From the web')!.querySelector('[aria-label="Add money bag"]'))
    expect(media.import).toHaveBeenCalledWith({ provider: 'iconify', id: 'noto:money-bag' })
    expect(canvas.insertImages).toHaveBeenCalledWith([expect.any(File)], undefined, undefined, expect.anything())
    expect(media.used).toHaveBeenCalledWith({ op: 'record', item: expect.objectContaining({ collectionName: 'Noto Emoji', width: 48 }), query: 'money' })
  })

  it('inserts a component through the engine`s own insert door', async () => {
    components.list.mockResolvedValue([component()])
    const { host, canvas } = await mount()
    await click(byLabel(host, 'Add Pricing card'))
    expect(components.read).toHaveBeenCalledWith({ slug: 'pricing-card' })
    expect(canvas.insertElements).toHaveBeenCalled()
    expect(media.used).toHaveBeenCalledWith({ op: 'record', item: expect.objectContaining({ itemKey: 'component:pricing-card', provider: 'component' }), query: '' })
  })

  it('reports a failed add without leaving the tile stuck on Adding…', async () => {
    media.import.mockRejectedValue(new Error('Iconify is down'))
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    await click(byLabel(host, 'Add money bag'))
    expect(host.querySelector('.image-studio__error')?.textContent).toBe('Iconify is down')
    expect(host.querySelector('.image-studio__adding')).toBeNull()
  })

  it('the third add makes it a favorite: one quiet line, and Undo takes it back out', async () => {
    media.used.mockImplementation(async (req) => {
      if (req.op === 'record') library = libraryOf({ favorites: [{ ...req.item, updatedAt: 3 }], recent: [{ ...req.item, updatedAt: 3 }], used: [{ ...req.item, updatedAt: 3, count: 3, words: [] }] })
      return library
    })
    const { host } = await mount()
    await click(byLabel(host, 'Add Rectangle'))
    expect(host.querySelector('.image-studio__line')?.textContent).toContain('Rectangle is now a favorite. You added it 3 times.')
    expect(tileNames(section(host, 'Favorites'))).toEqual(['Rectangle'])
    await click(byText(host, 'Undo'))
    expect(media.favorites).toHaveBeenLastCalledWith({ op: 'remove', itemKey: 'shape:rectangle' })
    expect(section(host, 'Favorites')).toBeNull()
    expect(host.querySelector('.image-studio__line')).toBeNull()
  })

  it('an add that does not make a favorite says nothing', async () => {
    const { host } = await mount()
    await click(byLabel(host, 'Add Rectangle'))
    expect(host.querySelector('.image-studio__line')).toBeNull()
  })
})

describe('the star and the right-click menu (D5, D10, demo 6B)', () => {
  it('the star adds the whole item, and removes it by key on a second press', async () => {
    library = libraryOf({ recent: [stored()] })
    const { host } = await mount()
    await click(byLabel(host, 'Add money bag to favorites'))
    expect(media.favorites).toHaveBeenCalledWith({ op: 'add', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag' }) })
    await click(section(host, 'Recent')!.querySelector('[aria-label="Remove money bag from favorites"]'))
    expect(media.favorites).toHaveBeenLastCalledWith({ op: 'remove', itemKey: 'iconify:noto:money-bag' })
  })

  it('Search words… saves a typed word', async () => {
    library = libraryOf({ favorites: [stored()] })
    media.used.mockImplementation(async (req) => (req.op === 'add-word' ? libraryOf({ ...library, used: [usedRow({ words: [req.word.trim().toLowerCase()] })] }) : library))
    const { host } = await mount()
    await rightClick(host, 'money bag')
    await click(byText(host, 'Search words…'))
    const input = byLabel(host, 'A word for money bag') as HTMLInputElement
    await type(input, 'Cash')
    await act(async () => input.form!.requestSubmit())
    await settle()
    expect(media.used).toHaveBeenCalledWith({ op: 'add-word', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag' }), word: 'Cash' })
    // The row stays open with the new chip, the field empty for the next word, and no line above the list (YAZ-4348 demo round 2)
    expect([...host.querySelectorAll('.image-studio__word-chip')].map((c) => c.firstChild?.textContent)).toEqual(['money bag', 'cash'])
    expect((byLabel(host, 'A word for money bag') as HTMLInputElement).value).toBe('')
    expect(host.querySelector('.image-studio__line')).toBeNull()
    // The tile whose row is open is ringed
    expect(byLabel(host, 'Add money bag')!.closest('.image-studio__card')?.classList.contains('is-editing')).toBe(true)
    await type(field(host), 'cash')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['money bag'])
  })

  it('Search words… lists every word that finds it, starts empty, and offers the search as a one-click word (YAZ-4348 demo round 2)', async () => {
    library = libraryOf({ favorites: [stored()], used: [usedRow({ words: ['cash'] })] })
    media.used.mockImplementation(async (req) => (req.op === 'add-word' ? libraryOf({ ...library, used: [usedRow({ words: [req.word, 'cash'] })] }) : library))
    const { host } = await mount()
    await type(field(host), 'money')
    await rightClick(host, 'money bag')
    await click(byText(host, 'Search words…'))
    const chips = () => [...host.querySelectorAll('.image-studio__word-chip')].map((c) => c.firstChild?.textContent)
    expect(chips()).toEqual(['money bag', 'cash'])
    expect((byLabel(host, 'A word for money bag') as HTMLInputElement).value).toBe('')
    // "money" is in its name already: no offer
    expect(host.querySelector('.image-studio__word-offer')).toBeNull()
    // "mon" finds it, but is no word of it: one click adds it
    await type(field(host), 'mon')
    await rightClick(host, 'money bag')
    await click(byText(host, 'Search words…'))
    expect((byLabel(host, 'A word for money bag') as HTMLInputElement).value).toBe('')
    await click(byText(host, '+ mon'))
    expect(media.used).toHaveBeenCalledWith({ op: 'add-word', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag' }), word: 'mon' })
  })

  it('the × on a word chip removes that word; the name has no × (YAZ-4348 demo round 2)', async () => {
    library = libraryOf({ favorites: [stored()], used: [usedRow({ words: ['cash', 'loot'] })] })
    media.used.mockImplementation(async (req) => (req.op === 'remove-word' ? libraryOf({ ...library, used: [usedRow({ words: ['loot'] })] }) : library))
    const { host } = await mount()
    await rightClick(host, 'money bag')
    await click(byText(host, 'Search words…'))
    expect(host.querySelector('.image-studio__word-chip.is-name button')).toBeNull()
    await click(byLabel(host, 'Remove the word “cash”'))
    expect(media.used).toHaveBeenCalledWith({ op: 'remove-word', itemKey: 'iconify:noto:money-bag', word: 'cash' })
    expect([...host.querySelectorAll('.image-studio__word-chip')].map((c) => c.firstChild?.textContent)).toEqual(['money bag', 'loot'])
  })

  it('a media item`s menu has no Rename or Delete; a component`s has both', async () => {
    library = libraryOf({ favorites: [stored()] })
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    await rightClick(host, 'money bag')
    expect(byText(host, 'Rename')).toBeUndefined()
    await rightClick(host, 'Pricing card')
    expect(byText(host, 'Rename')).toBeDefined()
    expect(byText(host, 'Delete')).toBeDefined()
  })
})

describe('the tile menu (D10, demo 6B)', () => {
  it('opens on a right-click instead of the app`s own menu, and Escape closes it back to the tile', async () => {
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    expect(byLabel(host, 'More for money bag')).toBeNull()
    expect(await rightClick(host, 'money bag')).toBe(false)
    const menu = byLabel(host, 'Actions for money bag')!
    // An Iconify icon's menu leads with its pack (YAZ-4361).
    expect(document.activeElement?.textContent).toBe('More from this pack')
    await key(menu, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Search words…')
    await key(menu, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Remove from favorites')
    await key(menu, 'Escape')
    expect(byLabel(host, 'Actions for money bag')).toBeNull()
    expect(document.activeElement).toBe(byLabel(host, 'Add money bag'))
  })

  it('an item in two sections opens ONE menu: on the tile that was right-clicked (demo 6B)', async () => {
    library = libraryOf({ favorites: [stored({ itemKey: 'component:pricing-card', provider: 'component', providerId: 'pricing-card', kind: 'component', title: 'Pricing card' })] })
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    expect(section(host, 'Favorites')!.querySelector('[aria-label="Add Pricing card"]')).not.toBeNull()
    expect(section(host, 'Components')!.querySelector('[aria-label="Add Pricing card"]')).not.toBeNull()
    await act(async () => {
      section(host, 'Components')!.querySelector('[aria-label="Add Pricing card"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(host.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(section(host, 'Components')!.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('says where the item comes from, and opens its page on the provider in the browser (demo 6H)', async () => {
    library = libraryOf({ favorites: [stored({ collectionName: 'Noto Emoji', sourceUrl: 'https://icon-sets.iconify.design/noto/money-bag/' })] })
    const { host } = await mount()
    expect(byLabel(host, 'Add money bag')!.title).toBe('money bag — Iconify · Noto Emoji')
    await rightClick(host, 'money bag')
    expect(host.querySelector('.image-studio__menu-source')?.textContent).toBe('From Iconify · Noto Emoji')
    await click(byText(host, 'Open on Iconify ↗'))
    expect(api.shell.openLink).toHaveBeenCalledWith({ href: 'https://icon-sets.iconify.design/noto/money-bag/' })
    expect(byLabel(host, 'Actions for money bag')).toBeNull()
  })

  it('Search Google Images opens the field`s text in the browser; with no text it is off (demo 6I)', async () => {
    const { host } = await mount()
    const google = byText(host, 'Search Google Images ↗') as HTMLButtonElement
    expect(google.disabled).toBe(true)
    await type(field(host), 'hammer and nail')
    await click(google)
    expect(api.shell.openLink).toHaveBeenCalledWith({ href: 'https://www.google.com/search?tbm=isch&q=hammer%20and%20nail' })
  })

  it('opens from the keyboard with Shift+F10, and a click outside it closes it', async () => {
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    await act(async () => {
      byLabel(host, 'Add money bag')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(byLabel(host, 'Actions for money bag')).not.toBeNull()
    await act(async () => {
      field(host).dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(byLabel(host, 'Actions for money bag')).toBeNull()
  })
})

describe('two old favorites bugs, checked in today`s panel (YAZ-4365: YAZ-286, YAZ-302)', () => {
  it('YAZ-286: the star of a Recent tile favorites the row as the library holds it; the board gets nothing', async () => {
    library = libraryOf({ recent: [stored({ updatedAt: 7 })] })
    const { host, canvas } = await mount()
    await click(section(host, 'Recent')!.querySelector('[aria-label="Add money bag to favorites"]'))
    // The row goes as it is, `updatedAt` too: main's validator drops it (`ipc/mediaLibrary.test.ts`).
    expect(media.favorites).toHaveBeenCalledExactlyOnceWith({ op: 'add', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag', updatedAt: 7 }) })
    expect(section(host, 'Recent')!.querySelector('[aria-label="Remove money bag from favorites"]')).not.toBeNull()
    expect(tileNames(section(host, 'Favorites'))).toEqual(['money bag'])
    expect(media.import).not.toHaveBeenCalled()
    expect(canvas.insertImages).not.toHaveBeenCalled()
  })

  it('YAZ-302: a tile menu opened near the bottom of the list moves up, so none of it is cut off', async () => {
    library = libraryOf({ favorites: [stored()] })
    const { host } = await mount()
    // The list shows 0–400 px; the tile is at 300–380; the menu is 180 px tall and starts `top` below the tile's top.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = (top: number, bottom: number, left = 0, right = 300) => ({ top, bottom, left, right, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) })
      if (this.classList.contains('image-studio__list')) return box(0, 400)
      if (this.classList.contains('image-studio__card')) return box(300, 380, 0, 100)
      if (this.classList.contains('image-studio__menu')) {
        const top = 300 + parseFloat(this.style.top || '0')
        return box(top, top + 180, 10, 160)
      }
      return box(0, 0, 0, 0)
    })
    await act(async () => {
      byLabel(host, 'Add money bag')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 390 }))
    })
    await settle(2)
    const menu = byLabel(host, 'Actions for money bag')!
    const box = menu.getBoundingClientRect()
    rect.mockRestore()
    expect(box.bottom).toBeLessThanOrEqual(400)
    expect(box.top).toBeGreaterThanOrEqual(0)
  })

  it('YAZ-302: "Remove from favorites" on a Favorites tile moves the focus to the tile that takes its place, not to the page', async () => {
    const other = stored({ itemKey: 'iconify:noto:rocket', providerId: 'noto:rocket', title: 'rocket' })
    library = libraryOf({ favorites: [stored(), other] })
    const { host } = await mount()
    await rightClick(host, 'money bag')
    await click(byText(host, 'Remove from favorites'))
    expect(tileNames(section(host, 'Favorites'))).toEqual(['rocket'])
    expect(document.activeElement).toBe(section(host, 'Favorites')!.querySelector('[aria-label="Add rocket"]'))
    // The star does the same.
    ;(section(host, 'Favorites')!.querySelector('[aria-label="Remove rocket from favorites"]') as HTMLElement).focus()
    await click(section(host, 'Favorites')!.querySelector('[aria-label="Remove rocket from favorites"]'))
    expect(document.activeElement).toBe(field(host))
  })
})

describe('components in the Add tab (D2, D6)', () => {
  it('Save selection shows only with a selection; it captures, asks a name, and saves the fragment and a PNG', async () => {
    const without = await mount()
    expect(byText(without.host, 'Save selection')).toBeUndefined()
    act(() => root?.unmount())
    const { host } = await mount({ hasSelection: true })
    await click(byText(host, 'Save selection'))
    await type(byLabel(host, 'Component name') as HTMLInputElement, 'Hero')
    await click(byText(host, 'Save 2 elements'))
    await settle(10)
    expect(components.save).toHaveBeenCalledWith({ name: 'Hero', fragmentJson: expect.any(String), previewPng: expect.any(String) })
    expect(byLabel(host, 'Component name')).toBeNull()
    expect(tileNames(section(host, 'Components'))).toEqual(['New one'])
  })

  it('the save step is one lit card with a picture of what it saves; the rest of the tab is greyed and inert; Escape cancels (demo 6O)', async () => {
    const { host } = await mount({ hasSelection: true })
    expect(host.querySelector('.image-studio__rest')?.hasAttribute('inert')).toBe(false)
    await click(byText(host, 'Save selection'))
    await settle(5)
    const form = byLabel(host, 'Save to your library')!
    expect(form.querySelector('h3')?.textContent).toBe('Save to your library')
    expect(form.querySelector('.image-studio__naming-preview img')).not.toBeNull()
    const rest = host.querySelector('.image-studio__rest')!
    expect(rest.hasAttribute('inert')).toBe(true)
    expect(rest.classList.contains('is-dimmed')).toBe(true)
    expect(host.querySelector('.image-studio__search')?.hasAttribute('inert')).toBe(true)
    await key(byLabel(host, 'Component name')!, 'Escape')
    expect(byLabel(host, 'Save to your library')).toBeNull()
    expect(host.querySelector('.image-studio__rest')?.hasAttribute('inert')).toBe(false)
  })

  it('the board`s right-click "Save to library…" opens the name form for the selection, and the request is taken once (demo 6L)', async () => {
    const onSaveRequestTaken = vi.fn()
    const { host } = await mount({ hasSelection: true, saveRequestPending: true, onSaveRequestTaken })
    await settle(5)
    expect(byLabel(host, 'Component name')).not.toBeNull()
    expect(onSaveRequestTaken).toHaveBeenCalledTimes(1)
  })

  it('on a read-only board an add puts nothing on it and counts no use (audit Must 2)', async () => {
    const { host, canvas } = await mount({ readOnly: true })
    await click(byLabel(host, 'Add Rectangle'))
    expect(canvas.updateScene).not.toHaveBeenCalled()
    expect(media.used).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'record' }))
    expect(host.querySelector('.image-studio__notice')?.textContent).toBe(READ_ONLY_NOTICE)
  })

  it('⌘V with a picture on the clipboard opens the name form for it, named after its file; a text paste stays a text paste (demo 6M)', async () => {
    const { host } = await mount()
    const paste = (target: Element, files: File[]) => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { files, items: [], types: files.length > 0 ? ['Files'] : ['text/plain'], getData: () => '' } })
      act(() => void target.dispatchEvent(event))
      return event
    }
    const textPaste = paste(field(host), [])
    expect(textPaste.defaultPrevented).toBe(false)
    expect(byLabel(host, 'Component name')).toBeNull()
    const picturePaste = paste(field(host), [new File(['x'], 'hammer-and-nail.png', { type: 'image/png' })])
    expect(picturePaste.defaultPrevented).toBe(true)
    await settle(5)
    const name = byLabel(host, 'Component name') as HTMLInputElement
    expect(name.value).toBe('hammer and nail')
    await type(name, 'Hammer and nail')
    await click(byText(host, 'Save 1 element'))
    await settle(10)
    expect(components.save).toHaveBeenCalledWith({ name: 'Hammer and nail', fragmentJson: expect.stringContaining('"dataURL": "data:image/png;base64,AQID"'), previewPng: expect.any(String) })
  })

  it('a paste of TEXT into the search field stays a text paste even when the clipboard also holds a picture (6P)', async () => {
    const { host } = await mount()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [new File(['x'], 'image.png', { type: 'image/png' })], items: [], types: ['text/plain', 'text/html', 'Files'], getData: (t: string) => (t === 'text/plain' ? 'rocket' : '') },
    })
    act(() => void field(host).dispatchEvent(event))
    await settle(5)
    expect(event.defaultPrevented).toBe(false)
    expect(byLabel(host, 'Component name')).toBeNull()
  })

  it('a picture file copied in Finder (its name as text/plain too) and pasted into the search field still opens the save step (6R)', async () => {
    const { host } = await mount()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [new File(['x'], 'hammer-and-nail.png', { type: 'image/png' })], items: [], types: ['text/plain', 'Files'], getData: (t: string) => (t === 'text/plain' ? 'hammer-and-nail.png' : '') },
    })
    act(() => void field(host).dispatchEvent(event))
    await settle(5)
    expect(event.defaultPrevented).toBe(true)
    expect(byLabel(host, 'Component name')).not.toBeNull()
  })

  it('a picture file dropped on the tab opens the name form for it, and the board under the panel never gets it (demo 6M)', async () => {
    const { host } = await mount()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'red_banner.png', { type: 'image/png' })], items: [], types: ['Files'] } })
    const boardHeard = vi.fn()
    document.body.addEventListener('drop', boardHeard)
    act(() => void host.querySelector('.image-studio')!.dispatchEvent(drop))
    await settle(5)
    document.body.removeEventListener('drop', boardHeard)
    expect(drop.defaultPrevented).toBe(true)
    expect(boardHeard).not.toHaveBeenCalled()
    expect((byLabel(host, 'Component name') as HTMLInputElement).value).toBe('red banner')
  })

  it('imports a file from the Components ⋯; a file that is not a component is a passive notice and nothing is saved', async () => {
    const { host } = await mount()
    await click(await showOption(host, 'Components'))
    expect(host.querySelector('.image-studio__state')?.textContent).toContain('No saved components yet')
    dialog.openDrawing.mockResolvedValue({ name: 'broken.excalidraw', content: 'not json' } as never)
    await click(byLabel(host, 'More for Components'))
    await click(byText(host, 'Import a file…'))
    await settle(5)
    expect(components.save).not.toHaveBeenCalled()
    expect(host.querySelector('.image-studio__notice')).not.toBeNull()
    expect(host.querySelector('.image-studio__error')).toBeNull()
  })

  it('rename is a field under the tile, and the tile shows what the STORE answered', async () => {
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    await rightClick(host, 'Pricing card')
    await click(byText(host, 'Rename'))
    const input = byLabel(host, 'Rename Pricing card') as HTMLInputElement
    await type(input, 'Price table')
    await act(async () => input.form!.requestSubmit())
    await settle()
    expect(components.rename).toHaveBeenCalledWith({ slug: 'pricing-card', name: 'Price table' })
    expect(tileNames(section(host, 'Components'))).toEqual(['Price table'])
  })

  it('delete ASKS first while 🔒 confirmDelete is on; with it off it deletes straight away', async () => {
    components.list.mockResolvedValue([component()])
    const { host } = await mount()
    await rightClick(host, 'Pricing card')
    await click(byText(host, 'Delete'))
    expect(byLabel(host, 'Delete Pricing card?')).not.toBeNull()
    expect(components.delete).not.toHaveBeenCalled()
    await click(byLabel(host, 'Delete Pricing card?')!.querySelector('.is-danger'))
    expect(components.delete).toHaveBeenCalledWith({ slug: 'pricing-card' })
    expect(section(host, 'Components')).toBeNull()

    act(() => root?.unmount())
    resetImageStudioSession()
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, confirmDelete: false })
    const again = await mount()
    await rightClick(again.host, 'Pricing card')
    await click(byText(again.host, 'Delete'))
    expect(byLabel(again.host, 'Delete Pricing card?')).toBeNull()
    expect(components.delete).toHaveBeenCalledTimes(2)
  })

  it('a favorite component shows its live name; one that was deleted stays in Favorites by its stored name (YAZ-4370), and nowhere else', async () => {
    const fav = (slug: string, title: string) => stored({ itemKey: `component:${slug}`, provider: 'component', providerId: slug, kind: 'component', title })
    library = libraryOf({ favorites: [fav('pricing-card', 'Old name'), fav('gone', 'Gone')], recent: [fav('gone', 'Gone')] })
    components.list.mockResolvedValue([component({ name: 'New name' })])
    const { host } = await mount()
    expect(tileNames(section(host, 'Favorites'))).toEqual(['New name', 'Gone'])
    expect(tileNames(section(host, 'Recent'))).toEqual([])
  })
})

describe('every favorite keeps a copy (YAZ-4370)', () => {
  const fragment = (id: string) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id, type: 'line' }], files: {} })

  it('an add of a favorite library item, shape or component uses its copy first, also when the source is gone', async () => {
    const drawn = stored({ itemKey: 'excalidraw:lib#3', provider: 'excalidraw', providerId: 'lib#3', kind: 'drawing', title: 'Hammer' })
    const renamed = stored({ itemKey: 'shape:old-star', provider: 'shape', providerId: 'old-star', kind: 'shape', title: 'Old star' })
    const deleted = stored({ itemKey: 'component:gone', provider: 'component', providerId: 'gone', kind: 'component', title: 'Gone card' })
    library = libraryOf({ favorites: [drawn, renamed, deleted] })
    media.favoriteElements.mockImplementation(async (itemKey) => fragment(`copy-of-${itemKey}`))
    media.drawing.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'that item is no longer in its library'))
    const { host, canvas } = await mount()
    for (const title of ['Hammer', 'Old star', 'Gone card']) await click(section(host, 'Favorites')!.querySelector(`[aria-label="Add ${title}"]`))
    expect(media.favoriteElements.mock.calls.filter(([key]) => key !== undefined).map(([key]) => key)).toEqual(expect.arrayContaining([drawn.itemKey, renamed.itemKey, deleted.itemKey]))
    expect(canvas.insertElements.mock.calls.map(([elements]) => (elements as { id: string }[])[0].id)).toEqual([`copy-of-${drawn.itemKey}`, `copy-of-${renamed.itemKey}`, `copy-of-${deleted.itemKey}`])
    expect(components.read).not.toHaveBeenCalled()
    expect(host.querySelector('.image-studio__error')).toBeNull()
  })

  it('with no copy, an add works as before; a tile that is not a favorite never asks for one', async () => {
    library = libraryOf({ favorites: [stored({ itemKey: 'shape:rectangle', provider: 'shape', providerId: 'rectangle', kind: 'shape', title: 'Rectangle' })] })
    const { host, canvas } = await mount()
    await click(section(host, 'Favorites')!.querySelector('[aria-label="Add Rectangle"]'))
    expect(canvas.updateScene).toHaveBeenCalled()
    media.favoriteElements.mockClear()
    await click(section(host, 'Shapes')!.querySelector('[aria-label="Add Rounded rectangle"]'))
    expect(media.favoriteElements).not.toHaveBeenCalled()
  })

  it('the panel saves the copy of each shape favorite that main asks for, built by the engine', async () => {
    library = libraryOf({ favorites: [stored({ itemKey: 'shape:rectangle', provider: 'shape', providerId: 'rectangle', kind: 'shape', title: 'Rectangle' })] })
    media.favoritesForPanel.mockResolvedValue(['shape:rectangle', 'shape:not-in-the-catalog'])
    await mount()
    await settle()
    expect(media.saveFavoriteElements).toHaveBeenCalledOnce()
    const [{ itemKey, fragmentJson }] = media.saveFavoriteElements.mock.calls[0]
    expect(itemKey).toBe('shape:rectangle')
    expect(JSON.parse(fragmentJson).elements).toEqual([expect.objectContaining({ id: 'new-0', type: 'rectangle' })])
  })
})

describe('keys (D7)', () => {
  it('ArrowDown from the field goes to the first tile; arrows walk the tiles; ArrowUp from the first row goes back', async () => {
    const { host } = await mount()
    await key(field(host), 'ArrowDown')
    expect(document.activeElement).toBe(byLabel(host, 'Add Rectangle'))
    await key(document.activeElement!, 'ArrowRight')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Add Rounded rectangle')
    await key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(field(host))
  })

  it('⌘F (the focus request) focuses the field with the kept query selected, and takes the request once', async () => {
    imageStudioSession.set({ query: 'tree' })
    const onSearchFocused = vi.fn()
    const { host } = await mount({ searchFocusPending: true, onSearchFocused })
    expect(document.activeElement).toBe(field(host))
    expect([field(host).selectionStart, field(host).selectionEnd]).toEqual([0, 4])
    expect(onSearchFocused).toHaveBeenCalledTimes(1)
  })
})

describe('closing and reopening the panel (🔒 YAZ-1990)', () => {
  it('comes back with the chip, the query and the results it had', async () => {
    media.search.mockResolvedValue({ items: [icon('star')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const first = await mount()
    await click(await showOption(first.host, 'Icons'))
    await search(first.host, 'star')
    act(() => root?.unmount())
    media.search.mockClear()
    const { host } = await mount()
    expect((await showOption(host, 'Icons'))?.getAttribute('aria-checked')).toBe('true')
    expect(field(host).value).toBe('star')
    expect(tileNames(section(host, 'From the web'))).toEqual(['star'])
    expect(media.search).not.toHaveBeenCalled()
  })
})

describe('the Filter button and menu (YAZ-4360)', () => {
  const filterButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.image-studio__filter-button')!
  const option = (host: HTMLElement, group: string, text: string) =>
    [...(host.querySelector(`.image-studio__filter-menu [aria-label="${group}"]`)?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text) as HTMLButtonElement

  it('sits right of the field; a pick searches again AT ONCE with the filters, and is remembered in the settings', async () => {
    media.search.mockResolvedValue({ items: [icon('arrow')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host } = await mount()
    expect(field(host).nextElementSibling?.querySelector('.image-studio__filter-button')).not.toBeNull()
    await search(host, 'arrow')
    media.search.mockClear()
    await click(filterButton(host))
    await click(option(host, 'Colors', 'One color'))
    expect(media.search).toHaveBeenCalledTimes(1)
    expect(media.search).toHaveBeenCalledWith({ q: 'arrow', source: 'all', cursor: null, filters: { ...DEFAULT_MEDIA_FILTERS, colors: 'one' } })
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaFilters: { ...DEFAULT_MEDIA_FILTERS, colors: 'one' } })
    expect(option(host, 'Colors', 'One color').getAttribute('aria-checked')).toBe('true')
  })

  it('a filter change from another window (the settings sync) searches again, so the results match the badge (YAZ-4384)', async () => {
    media.search.mockResolvedValue({ items: [icon('arrow')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host } = await mount()
    await search(host, 'arrow')
    media.search.mockClear()
    const listener = () => store.subscribe.mock.calls.forEach(([fn]) => (fn as () => void)())
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaFilters: { ...DEFAULT_MEDIA_FILTERS, colors: 'one' } })
    await act(async () => listener())
    expect(media.search).toHaveBeenCalledTimes(1)
    expect(media.search).toHaveBeenCalledWith({ q: 'arrow', source: 'all', cursor: null, filters: { ...DEFAULT_MEDIA_FILTERS, colors: 'one' } })
    expect(filterButton(host).querySelector('.image-studio__filter-badge')?.textContent).toBe('1')
    // The same filters again (any other settings change) asks nothing.
    await act(async () => listener())
    expect(media.search).toHaveBeenCalledTimes(1)
  })

  it('counts the filters that are on in a badge, and Clear filters turns them all off', async () => {
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaFilters: { colors: 'many', style: 'outline', packs: [], license: 'business' } })
    const { host } = await mount()
    expect(filterButton(host).querySelector('.image-studio__filter-badge')?.textContent).toBe('3')
    expect(filterButton(host).getAttribute('aria-label')).toBe('Filter, 3 on')
    await click(filterButton(host))
    await click(byText(host, 'Clear filters'))
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaFilters: DEFAULT_MEDIA_FILTERS })
    expect(filterButton(host).querySelector('.image-studio__filter-badge')).toBeNull()
    expect(byText(host, 'Clear filters')?.disabled).toBe(true)
  })

  it('Show is the first section and the panel has no chips row; the badge counts Show when it is not All, and Clear filters puts it back to All', async () => {
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaFilters: { ...DEFAULT_MEDIA_FILTERS, colors: 'one' } })
    const { host } = await mount()
    expect(host.querySelector('.image-studio__chips')).toBeNull()
    expect(filterButton(host).getAttribute('aria-label')).toBe('Filter, 1 on')
    await click(filterButton(host))
    const groups = [...host.querySelectorAll('.image-studio__filter-menu [role="group"]')].map((g) => g.getAttribute('aria-label'))
    expect(groups[0]).toBe('Show')
    expect([...host.querySelectorAll('.image-studio__filter-menu [aria-label="Show"] button')].map((b) => b.textContent)).toEqual(['All', 'Favorites', 'Components', 'Shapes', 'Icons'])
    expect(option(host, 'Show', 'All').getAttribute('aria-checked')).toBe('true')
    await click(option(host, 'Show', 'Shapes'))
    expect(imageStudioSession.getState().chip).toBe('shapes')
    expect(section(host, 'Shapes')).not.toBeNull()
    expect(filterButton(host).getAttribute('aria-label')).toBe('Filter, 2 on')
    await click(byText(host, 'Clear filters'))
    expect(imageStudioSession.getState().chip).toBe('all')
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaFilters: DEFAULT_MEDIA_FILTERS })
    expect(filterButton(host).querySelector('.image-studio__filter-badge')).toBeNull()
  })

  it('Clear filters with a query asks the web once, under All and no filters', async () => {
    media.search.mockResolvedValue({ items: [icon('arrow')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaFilters: { ...DEFAULT_MEDIA_FILTERS, style: 'filled' } })
    const { host } = await mount()
    await click(await showOption(host, 'Icons'))
    await search(host, 'arrow')
    media.search.mockClear()
    await click(byText(host, 'Clear filters'))
    expect(media.search).toHaveBeenCalledTimes(1)
    expect(media.search).toHaveBeenCalledWith({ q: 'arrow', source: 'all', cursor: null, filters: DEFAULT_MEDIA_FILTERS })
  })

  it('the arrow keys walk from Show into the filters', async () => {
    const { host } = await mount()
    await click(filterButton(host))
    expect(document.activeElement).toBe(option(host, 'Show', 'All'))
    await key(host.querySelector('.image-studio__filter-menu')!, 'ArrowDown')
    expect(document.activeElement).toBe(option(host, 'Show', 'Favorites'))
    await key(host.querySelector('.image-studio__filter-menu')!, 'ArrowUp')
    await key(host.querySelector('.image-studio__filter-menu')!, 'ArrowUp')
    // Up from All wraps to the last item that is on (Clear filters is off with nothing on): Similar icons' last choice.
    expect(document.activeElement?.textContent).toBe('Show each one')
  })

  it('Esc closes the menu back to its button; a click outside closes it too', async () => {
    const { host } = await mount()
    await click(filterButton(host))
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio')
    await key(host.querySelector('.image-studio__filter-menu')!, 'Escape')
    expect(host.querySelector('.image-studio__filter-menu')).toBeNull()
    expect(document.activeElement).toBe(filterButton(host))
    await click(filterButton(host))
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(host.querySelector('.image-studio__filter-menu')).toBeNull()
  })

  it('Choose packs… lists the pinned packs first, and a pick adds the pack to the filter', async () => {
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaPinnedPacks: ['tabler'] })
    const pack = (prefix: string, name: string) => ({ prefix, name, total: 10, license: { title: 'MIT' }, palette: false })
    media.packList.mockResolvedValue([pack('mdi', 'Material Design'), pack('tabler', 'Tabler'), pack('akar', 'Akar')])
    const { host } = await mount()
    await click(filterButton(host))
    await click(byText(host, 'Choose packs…'))
    const rows = [...host.querySelectorAll('.image-studio__filter-pack-name')].map((n) => n.textContent)
    expect(rows).toEqual(['Tabler', 'Akar', 'Material Design'])
    await click(host.querySelector('[role="menuitemcheckbox"][title^="Akar"]'))
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaFilters: { ...DEFAULT_MEDIA_FILTERS, packs: ['akar'] } })
  })
})

describe('Download all icon packs (YAZ-4359)', () => {
  it('offers the download at the bottom of the icon results, asks first, and starts only on Download', async () => {
    media.search.mockResolvedValue({ items: [icon('arrow')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host } = await mount()
    await search(host, 'arrow')
    const line = byLabel(host, 'Icon packs')!
    expect(section(host, 'From the web')?.lastElementChild).toBe(line)
    expect(line.textContent).toContain('Want every icon, also offline?')
    await click(byText(host, 'Download all icon packs'))
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('All 281 free icon packs from Iconify come to this Mac: about 135 MB.')
    expect(media.packs).not.toHaveBeenCalledWith({ op: 'download' })
    await click(byText(document.body, 'Download'))
    expect(media.packs).toHaveBeenCalledWith({ op: 'download' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the progress in the same place with Cancel; a stop then offers Download the rest; with every pack the line is gone', async () => {
    media.search.mockResolvedValue({ items: [icon('arrow')], nextCursor: null, pixabayAvailable: false, warnings: [] })
    const { host } = await mount()
    await search(host, 'arrow')
    await act(async () => packsListener?.(packsStatus({ state: 'downloading', packs: 37, bytes: 17 * 1024 * 1024 })))
    expect(byLabel(host, 'Icon packs')?.textContent).toContain('Downloading icon packs: 37 of 281 (17 MB of 135 MB)')
    await click(byText(host, 'Cancel'))
    expect(media.packs).toHaveBeenCalledWith({ op: 'stop' })
    await act(async () => packsListener?.(packsStatus({ state: 'partial', packs: 37 })))
    expect(byLabel(host, 'Icon packs')?.textContent).toContain('37 of 281 icon packs are on this Mac.')
    media.packs.mockClear()
    await click(byText(host, 'Download the rest'))
    // The rest needs no new confirm: the user said yes already.
    expect(media.packs).toHaveBeenCalledWith({ op: 'download' })
    await act(async () => packsListener?.(packsStatus({ state: 'complete', packs: 281 })))
    expect(byLabel(host, 'Icon packs')).toBeNull()
  })

  it('offline with every pack on the Mac, the line says icon search still works (extra 17)', async () => {
    media.packs.mockResolvedValue(packsStatus({ state: 'complete', packs: 281 }))
    media.search.mockRejectedValue(new BridgeRequestError('OFFLINE', 'no network'))
    secrets.has.mockResolvedValue(true)
    const { host } = await mount()
    await click(await showOption(host, 'Photos'))
    await search(host, 'arrow')
    expect(host.textContent).toContain(OFFLINE_WITH_PACKS_NOTICE)
  })
})

describe('More from this pack (YAZ-4361)', () => {
  const tabler = { prefix: 'tabler', name: 'Tabler Icons', total: 5900, license: { title: 'MIT' }, palette: false }

  async function openTablerPack() {
    media.packList.mockResolvedValue([tabler])
    media.search.mockImplementation(async (req) =>
      req.filters?.packs[0] === 'tabler'
        ? { items: req.q === '' ? [icon('arrow-up', 'tabler'), icon('star', 'tabler')] : [icon('arrow-up', 'tabler')], nextCursor: null, pixabayAvailable: false, warnings: [] }
        : { items: [icon('arrow-up', 'tabler'), icon('arrow', 'mdi')], nextCursor: 'MORE', pixabayAvailable: false, warnings: [] },
    )
    const mounted = await mount()
    await search(mounted.host, 'arrow')
    await rightClick(mounted.host, 'arrow up')
    await click(byText(mounted.host, 'More from this pack'))
    await settle()
    return mounted
  }

  it('the tile menu opens the right pack: its name, count and license, and every icon of it', async () => {
    const { host } = await openTablerPack()
    expect(media.search).toHaveBeenLastCalledWith({ q: '', source: 'iconify', cursor: null, filters: { ...DEFAULT_MEDIA_FILTERS, packs: ['tabler'] } })
    const page = byLabel(host, 'Pack: Tabler Icons')!
    expect(page.textContent).toContain('5,900 icons · MIT')
    expect(tileNames(page)).toEqual(['arrow up', 'star'])
    expect(document.activeElement?.textContent).toBe('‹ Back')
    // The main field and the chips wait underneath.
    expect(host.querySelector('.image-studio__search')?.hasAttribute('hidden')).toBe(true)
  })

  it('its own search asks only that pack', async () => {
    const { host } = await openTablerPack()
    vi.useFakeTimers()
    await type(byLabel(host, 'Search Tabler Icons') as HTMLInputElement, 'arrow')
    await act(async () => vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS))
    expect(media.search).toHaveBeenLastCalledWith({ q: 'arrow', source: 'iconify', cursor: null, filters: { ...DEFAULT_MEDIA_FILTERS, packs: ['tabler'] } })
    expect(tileNames(byLabel(host, 'Pack: Tabler Icons'))).toEqual(['arrow up'])
  })

  it('Back returns to the same search, results and next page, with no new request', async () => {
    const { host } = await openTablerPack()
    const asked = media.search.mock.calls.length
    await click(byText(host, '‹ Back'))
    expect(media.search.mock.calls.length).toBe(asked)
    expect(field(host).value).toBe('arrow')
    expect(tileNames(section(host, 'From the web'))).toEqual(['arrow up', 'arrow'])
    expect(imageStudioSession.getState()).toMatchObject({ pack: null, cursor: 'MORE', searchedQuery: 'arrow' })
  })

  it('Pin pack saves the pin in the settings, and a second press takes it off', async () => {
    const { host } = await openTablerPack()
    await click(byText(host, 'Pin pack'))
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaPinnedPacks: ['tabler'] })
    expect(byText(host, 'Pinned')?.getAttribute('aria-pressed')).toBe('true')
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, mediaPinnedPacks: ['tabler'] })
    await click(byText(host, 'Pinned'))
    expect(store.patchSettings).toHaveBeenLastCalledWith({ mediaPinnedPacks: [] })
  })
})

describe('the credit reminder (YAZ-4360, extra 16)', () => {
  it('a CC-BY icon says that it needs a credit when it is added', async () => {
    media.search.mockResolvedValue({ items: [item({ collectionName: 'Font Awesome', licenseName: 'CC BY 4.0' })], nextCursor: null, pixabayAvailable: false, warnings: [] })
    media.import.mockResolvedValue({ mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa('<svg/>')}`, item: item() })
    const { host } = await mount()
    await search(host)
    await click(byLabel(host, 'Add money bag'))
    expect(host.querySelector('.image-studio__line')?.textContent).toBe('Credit needed: Font Awesome is CC BY 4.0. Name its author where you publish this board.')
  })
})
