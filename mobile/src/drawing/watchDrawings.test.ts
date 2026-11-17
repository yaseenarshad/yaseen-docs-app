// @vitest-environment jsdom
/**
 * YAZ-5440: the drawings of an open page. The real drawing chunk and the real store: a drawing becomes a picture in
 * memory, and NOTHING is written anywhere (Yaseen: "the pictures never get saved"). The calm lines: no engine and no
 * signal, no signal for the file, a broken file.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DRAWING_FILES } from '../dev/drawingVault'
import { READER_ID, writeVaultFiles } from '../dev/readerVault'
import { storedMedia } from '../media/ui/vaultMedia'
import { memoryBackend, openVaultStore, type VaultStore } from '../store'
import { drawingBox } from './drawingBox'
import { storeFirst } from './useDrawings'
import { watchDrawings, type DrawingDeps } from './watchDrawings'

const urls = new Map<string, Blob>()
let revoked: string[] = []
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (t: string) => ({ width: t.length * 6 }) })) as never
  ;(globalThis as Record<string, unknown>).FontFace = class {
    constructor(readonly family: string) {}
    load() {
      return Promise.resolve(this)
    }
  }
  let n = 0
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:test/${++n}`
    urls.set(url, blob)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (url: string) => void revoked.push(url)
})
afterEach(() => {
  document.body.replaceChildren()
  revoked = []
  vi.restoreAllMocks()
})

const until = async (done: () => boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10))
}

/** A page with one drawing box. */
function page(path: string): { root: HTMLElement; box: HTMLElement } {
  const root = document.createElement('div')
  const box = drawingBox(path, path)!
  root.append(box)
  document.body.append(root)
  return { root, box }
}

/** Every write door of the store, counted (reads are free). */
function countWrites(store: VaultStore): string[] {
  const writes: string[] = []
  for (const key of Object.keys(store) as Array<keyof VaultStore>) {
    const fn = store[key]
    if (typeof fn !== 'function' || /^(read|list|get|has|state|checkpoint|usage|vaults)/i.test(key)) continue
    ;(store as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => (writes.push(String(key)), (fn as (...a: unknown[]) => unknown).apply(store, args))
  }
  return writes
}

describe('the drawings of a page on the phone (YAZ-5440)', () => {
  it('draws the picture with the real engine from the store, in memory only: nothing is written to any storage', async () => {
    const store = await openVaultStore(memoryBackend())
    await writeVaultFiles(store, DRAWING_FILES)
    const writes = countWrites(store)
    // The count sees the store's write doors (a check of the check).
    await store.markViewed(READER_ID, 'garden.excalidraw')
    expect(writes).toEqual(['markViewed'])
    writes.length = 0
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const idb = vi.fn()
    const cacheOpen = vi.fn()
    vi.stubGlobal('indexedDB', { open: idb, deleteDatabase: idb })
    vi.stubGlobal('caches', { open: cacheOpen, delete: cacheOpen, keys: async () => [] })
    const media = storedMedia(store, READER_ID)
    const show = vi.spyOn(media, 'show')

    const { root, box } = page('garden.excalidraw')
    const watch = watchDrawings(root, { read: storeFirst(store, READER_ID, media), files: () => Object.keys(DRAWING_FILES) })
    await until(() => box.querySelector('img') !== null)
    const img = box.querySelector('img')!
    expect(img.className).toBe('page-drawing__img')
    expect(img.alt).toBe('Drawing · garden.excalidraw')
    const svg = await urls.get(img.src)!.text()
    expect(svg).toContain('Tomatoes')
    expect(svg).toContain('data:image/png;base64,')
    expect(box.classList.contains('page-drawing--wait')).toBe(false)

    // Nothing saved: no store write, no localStorage or sessionStorage, no IndexedDB, no Cache Storage. The file was
    // on the phone, so the media layer was not asked.
    expect(writes).toEqual([])
    expect(setItem).not.toHaveBeenCalled()
    expect(idb).not.toHaveBeenCalled()
    expect(cacheOpen).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()

    // The page closes: the picture's memory goes with it.
    watch.stop()
    expect(revoked).toEqual([img.src])
    vi.unstubAllGlobals()
  }, 60_000)

  it('a tap opens the picture full screen; ✕ closes it', async () => {
    const store = await openVaultStore(memoryBackend())
    await writeVaultFiles(store, DRAWING_FILES)
    const { root, box } = page('garden.excalidraw')
    const watch = watchDrawings(root, { read: storeFirst(store, READER_ID, storedMedia(store, READER_ID)), files: () => Object.keys(DRAWING_FILES) })
    await until(() => box.querySelector('img') !== null)
    box.querySelector('img')!.click()
    const view = document.querySelector('.drawing-view')!
    expect(view.getAttribute('role')).toBe('dialog')
    expect(view.querySelector<HTMLImageElement>('.drawing-view__pane img')!.src).toBe(box.querySelector('img')!.src)
    view.querySelector<HTMLButtonElement>('.drawing-view__close')!.click()
    expect(document.querySelector('.drawing-view')).toBeNull()
    watch.stop()
  }, 60_000)

  it('calm lines: no engine and no signal → "Open it on the Mac", then the picture when the signal returns', async () => {
    const online = new EventTarget()
    let engineHere = false
    const load: DrawingDeps['load'] = async () => {
      if (!engineHere) throw new TypeError('Failed to fetch dynamically imported module')
      return { drawPicture: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 10, height: 10, ms: 1 }) }
    }
    const { root, box } = page('garden.excalidraw')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new Uint8Array() }), files: () => [], load, online })
    await until(() => box.textContent === 'Drawing · garden.excalidraw · Open it on the Mac')
    expect(box.textContent).toBe('Drawing · garden.excalidraw · Open it on the Mac')
    engineHere = true
    online.dispatchEvent(new Event('online'))
    await until(() => box.querySelector('img') !== null)
    expect(box.querySelector('img')).not.toBeNull()
    watch.stop()
  })

  it('calm lines: the file needs a connection; a broken file; an empty drawing; never a crash', async () => {
    const lines: Record<string, string> = {}
    const cases: Record<string, Awaited<ReturnType<DrawingDeps['read']>>> = {
      'away.excalidraw': { why: 'offline' },
      'broken.excalidraw': { bytes: new TextEncoder().encode('{ not json') },
      'empty.excalidraw': { bytes: new TextEncoder().encode('{"type":"excalidraw","elements":[]}') },
    }
    const root = document.createElement('div')
    for (const path of Object.keys(cases)) root.append(drawingBox(path, path)!)
    document.body.append(root)
    const watch = watchDrawings(root, { read: async (path) => cases[path], files: () => [] })
    await until(() => [...root.children].every((b) => !b.classList.contains('page-drawing--wait')))
    for (const b of root.children) lines[(b as HTMLElement).dataset.vaultDrawing!] = b.textContent ?? ''
    expect(lines).toEqual({
      'away.excalidraw': 'Drawing · away.excalidraw · Needs a connection',
      'broken.excalidraw': "Drawing · broken.excalidraw · Can't show this drawing",
      'empty.excalidraw': 'Drawing · empty.excalidraw · Empty drawing',
    })
    watch.stop()
  }, 60_000)
})
