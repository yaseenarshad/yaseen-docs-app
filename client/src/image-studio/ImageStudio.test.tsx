/**
 * The Add tab (YAZ-4157; before it, YAZ-1818's Images tab and YAZ-1819's Components tab). The bridge is stubbed at
 * the client `api` seam, like every other test in this repo, and the engine's element package at
 * `loadExcalidrawElement` — so what is pinned here is the TAB's behaviour: one field over everything, the sections and
 * the chips, what one add teaches the library, what it never asks for (a stored `previewUrl`), what it hides with no
 * key, and what still works with no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type ComponentItem, type MediaLibraryFile, type StoredMediaItem, type StudioItem, type UsedMediaItem } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    media: { favorites: vi.fn(), recent: vi.fn(), used: vi.fn(), onChanged: vi.fn(), search: vi.fn(), preview: vi.fn(), import: vi.fn(), drawingIndex: vi.fn(), drawing: vi.fn() },
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
vi.mock('../lib/storage', () => ({ storage: { getSettings: vi.fn(), subscribe: vi.fn() } }))

import { api, BridgeRequestError } from '../api'
import { loadExcalidrawElement } from '../drawings/engine'
import { storage } from '../lib/storage'
import { clearPreviewMemo, ImageStudio, type ImageStudioProps } from './ImageStudio'
import { imageStudioSession, OFFLINE_NOTICE, resetImageStudioSession, SEARCH_PAUSE_MS } from './imageStudioSession'
import type { SmartShapeApi } from './shapes'

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
const libraryOf = (over: Partial<MediaLibraryFile> = {}): MediaLibraryFile => ({ version: 1, favorites: [], recent: [], used: [], ...over })
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
const chipButton = (host: HTMLElement, label: string) => [...host.querySelectorAll('.image-studio__chips button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
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

  it('Show all picks the chip that shows the rest; Recent, which has no chip, opens in place', async () => {
    library = libraryOf({ recent: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => stored(icon(n))) })
    const { host } = await mount()
    await click(section(host, 'Shapes')!.querySelector('.image-studio__show-all'))
    expect(chipButton(host, 'Shapes')?.getAttribute('aria-pressed')).toBe('true')
    expect(tileNames(section(host, 'Shapes')).length).toBeGreaterThan(4)
    await click(chipButton(host, 'All'))
    await click(section(host, 'Recent')!.querySelector('.image-studio__show-all'))
    expect(tileNames(section(host, 'Recent'))).toHaveLength(6)
    expect(section(host, 'Recent')!.querySelector('.image-studio__show-all')?.textContent).toBe('Show less')
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
    await click(chipButton(host, 'Shapes'))
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
    expect(media.search).toHaveBeenCalledWith({ q: 'money', source: 'all', cursor: null })
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

describe('the chips (D8)', () => {
  it('Icons asks Iconify alone and shows only icons of yours; Shapes asks the web nothing', async () => {
    library = libraryOf({ favorites: [stored(icon('star icon'))] })
    const { host } = await mount()
    await click(chipButton(host, 'Icons'))
    await search(host, 'star')
    expect(media.search).toHaveBeenLastCalledWith({ q: 'star', source: 'iconify', cursor: null })
    expect(tileNames(section(host, 'Best matches'))).toEqual(['star icon'])
    media.search.mockClear()
    await click(chipButton(host, 'Shapes'))
    expect(media.search).not.toHaveBeenCalled()
    expect(tileNames(section(host, 'Best matches'))).toEqual(['Star'])
    expect(section(host, 'From the web')).toBeNull()
  })

  it('offers Photos only when a Pixabay key is set, and follows the search answer when the key changes', async () => {
    const { host } = await mount()
    expect(chipButton(host, 'Photos')).toBeUndefined()
    media.search.mockResolvedValue({ items: [], nextCursor: null, pixabayAvailable: true, warnings: [] })
    await search(host)
    expect(chipButton(host, 'Photos')).toBeDefined()
  })

  it('Icons and Photos with an empty field ask you to type', async () => {
    const { host } = await mount()
    await click(chipButton(host, 'Icons'))
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
    await click(chipButton(host, 'Shapes'))
    await click(chipButton(host, 'All'))
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
    await click(chipButton(host, 'Favorites'))
    expect(media.preview).toHaveBeenCalledTimes(301)
    await click(chipButton(host, 'Shapes'))
    await click(chipButton(host, 'Favorites'))
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

describe('the star and the ⋯ menu (D5, D10)', () => {
  it('the star adds the whole item, and removes it by key on a second press', async () => {
    library = libraryOf({ recent: [stored()] })
    const { host } = await mount()
    await click(byLabel(host, 'Add money bag to favorites'))
    expect(media.favorites).toHaveBeenCalledWith({ op: 'add', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag' }) })
    await click(section(host, 'Recent')!.querySelector('[aria-label="Remove money bag from favorites"]'))
    expect(media.favorites).toHaveBeenLastCalledWith({ op: 'remove', itemKey: 'iconify:noto:money-bag' })
  })

  it('Add a word… saves the word, starting from the text in the field', async () => {
    library = libraryOf({ favorites: [stored()] })
    media.used.mockImplementation(async (req) => (req.op === 'add-word' ? libraryOf({ ...library, used: [usedRow({ words: [req.word.trim().toLowerCase()] })] }) : library))
    const { host } = await mount()
    await rightClick(host, 'money bag')
    await click(byText(host, 'Add a word…'))
    const input = byLabel(host, 'A word for money bag') as HTMLInputElement
    await type(input, 'Cash')
    await act(async () => input.form!.requestSubmit())
    await settle()
    expect(media.used).toHaveBeenCalledWith({ op: 'add-word', item: expect.objectContaining({ itemKey: 'iconify:noto:money-bag' }), word: 'Cash' })
    expect(host.querySelector('.image-studio__line')?.textContent).toContain('now comes first for “cash”')
    await type(field(host), 'cash')
    expect(tileNames(section(host, 'Best matches'))).toEqual(['money bag'])
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
    expect(document.activeElement?.textContent).toBe('Add a word…')
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

  it('the board`s right-click "Save to library…" opens the name form for the selection (demo 6L)', async () => {
    imageStudioSession.set({ saveRequested: true })
    const { host } = await mount({ hasSelection: true })
    await settle(5)
    expect(byLabel(host, 'Component name')).not.toBeNull()
    expect(imageStudioSession.getState().saveRequested).toBe(false)
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

  it('imports a file from the Components ⋯; a file that is not a component is a passive notice and nothing is saved', async () => {
    const { host } = await mount()
    await click(chipButton(host, 'Components'))
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

  it('a favorite component shows its live name, and one that was deleted is not shown at all', async () => {
    const fav = (slug: string, title: string) => stored({ itemKey: `component:${slug}`, provider: 'component', providerId: slug, kind: 'component', title })
    library = libraryOf({ favorites: [fav('pricing-card', 'Old name'), fav('gone', 'Gone')] })
    components.list.mockResolvedValue([component({ name: 'New name' })])
    const { host } = await mount()
    expect(tileNames(section(host, 'Favorites'))).toEqual(['New name'])
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
    await click(chipButton(first.host, 'Icons'))
    await search(first.host, 'star')
    act(() => root?.unmount())
    media.search.mockClear()
    const { host } = await mount()
    expect(chipButton(host, 'Icons')?.getAttribute('aria-pressed')).toBe('true')
    expect(field(host).value).toBe('star')
    expect(tileNames(section(host, 'From the web'))).toEqual(['star'])
    expect(media.search).not.toHaveBeenCalled()
  })
})
