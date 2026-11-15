// @vitest-environment jsdom
/**
 * YAZ-5533: a plain draw.io diagram in a page, through the page's drawing code (`watchDrawings`). draw.io's viewer runs
 * in a frame, which jsdom does not load, so its answer is played here; the diagram chunk's figure is the real one. The
 * proofs: NOTHING is saved (as YAZ-5440); the first time with no signal, the calm line, then the picture when the
 * signal comes back; a shape library still to come, its line and a redraw online; the page picker; dark mode.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DIAGRAM_FILES } from '../../dev/diagramVault'
import { READER_ID, writeVaultFiles } from '../../dev/readerVault'
import { storedMedia } from '../../media/ui/vaultMedia'
import { memoryBackend, openVaultStore, type VaultStore } from '../../store'
import { drawingBox } from '../drawingBox'
import { storeFirst } from '../useDrawings'
import { watchDrawings, type DrawingDeps } from '../watchDrawings'
import type { DiagramDrawn, DiagramInput } from './drawDiagram'
import { diagramFigure } from './figure'

const urls = new Map<string, Blob>()
let revoked: string[] = []
beforeAll(() => {
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
  vi.unstubAllGlobals()
})

const until = async (done: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 5))
}

function page(path: string): { root: HTMLElement; box: HTMLElement } {
  const root = document.createElement('div')
  const box = drawingBox(path, path.slice(path.lastIndexOf('/') + 1))!
  root.append(box)
  document.body.append(root)
  return { root, box }
}

const svgOf = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text>${label}</text></svg>`
const PAGES = [{ id: 'p1', name: 'Overview' }, { id: 'p2', name: 'Details' }, { id: 'p3', name: 'Empty-ish' }]

/** draw.io's viewer, played: each call noted; its answer from `answer`. */
function viewer(answer: (input: DiagramInput) => Promise<DiagramDrawn | 'empty'> | DiagramDrawn | 'empty') {
  const calls: DiagramInput[] = []
  const loadDiagram: DrawingDeps['loadDiagram'] = async () => ({ diagramFigure, drawDiagram: async (input) => (calls.push(input), answer(input)) })
  return { calls, loadDiagram }
}

function countWrites(store: VaultStore): string[] {
  const writes: string[] = []
  for (const key of Object.keys(store) as Array<keyof VaultStore>) {
    const fn = store[key]
    if (typeof fn !== 'function' || /^(read|list|get|has|state|checkpoint|usage|vaults)/i.test(key)) continue
    ;(store as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => (writes.push(String(key)), (fn as (...a: unknown[]) => unknown).apply(store, args))
  }
  return writes
}

class Unavailable extends Error {
  override name = 'DiagramUnavailable'
}

describe('a plain draw.io diagram in a page (YAZ-5533)', () => {
  it('draws from the store, in memory only: NOTHING is written to any storage; the picture goes with the page', async () => {
    const store = await openVaultStore(memoryBackend())
    await writeVaultFiles(store, DIAGRAM_FILES)
    const writes = countWrites(store)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const idb = vi.fn()
    const cacheOpen = vi.fn()
    vi.stubGlobal('indexedDB', { open: idb, deleteDatabase: idb })
    vi.stubGlobal('caches', { open: cacheOpen, delete: cacheOpen, keys: async () => [] })
    const media = storedMedia(store, READER_ID)
    const show = vi.spyOn(media, 'show')
    const { calls, loadDiagram } = viewer(() => ({ svg: svgOf('Start'), width: 400, height: 200, pages: [{ id: 'flow1', name: 'Sign-up flow' }], page: 'flow1', missing: [] }))
    const { root, box } = page('Drawings/flowchart.drawio')
    const watch = watchDrawings(root, { read: storeFirst(store, READER_ID, media), files: () => [], loadDiagram, dark: { matches: false, addEventListener() {}, removeEventListener() {} } })
    await until(() => box.querySelector('img') !== null)
    const img = box.querySelector('img')!
    expect(img.alt).toBe('Diagram · flowchart.drawio')
    expect(await urls.get(img.src)!.text()).toContain('Start')
    // The viewer got the file's own text, light, the first page.
    expect(calls).toEqual([{ text: new TextDecoder().decode(DIAGRAM_FILES['Drawings/flowchart.drawio'] as Uint8Array), theme: 'light', page: null }])
    expect(box.querySelector('.page-drawing__pages')).toBeNull()
    expect(writes).toEqual([])
    expect(setItem).not.toHaveBeenCalled()
    expect(idb).not.toHaveBeenCalled()
    expect(cacheOpen).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
    watch.stop()
    expect(revoked).toEqual([img.src])
  })

  it('the first time with no signal: "Diagrams need the internet the first time; then they work offline", then the picture online', async () => {
    const online = new EventTarget()
    let signal = false
    const { loadDiagram } = viewer(() => {
      if (!signal) throw new Unavailable('the diagram viewer did not start')
      return { svg: svgOf('ok'), width: 400, height: 200, pages: [], page: null, missing: [] }
    })
    const { root, box } = page('flow.drawio')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new TextEncoder().encode('<mxfile/>') }), files: () => [], loadDiagram, online, isOnline: () => signal })
    await until(() => !box.classList.contains('page-drawing--wait'))
    expect(box.textContent).toBe('Diagram · flow.drawio · Diagrams need the internet the first time; then they work offline')
    signal = true
    online.dispatchEvent(new Event('online'))
    await until(() => box.querySelector('img') !== null)
    expect(box.querySelector('img')).not.toBeNull()
    watch.stop()
  })

  it('the diagram chunk itself not on the phone, no signal: the same line, never a crash', async () => {
    const { root, box } = page('flow.drawio')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new Uint8Array() }), files: () => [], loadDiagram: async () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), isOnline: () => false })
    await until(() => !box.classList.contains('page-drawing--wait'))
    expect(box.textContent).toBe('Diagram · flow.drawio · Diagrams need the internet the first time; then they work offline')
    watch.stop()
  })

  it('a shape library still to come (no signal): the picture with its placeholder boxes and a line; drawn again online', async () => {
    const online = new EventTarget()
    let missing = ['aws4.xml']
    const { calls, loadDiagram } = viewer(() => ({ svg: svgOf(missing.length > 0 ? 'placeholder' : 'aws'), width: 400, height: 200, pages: [], page: null, missing }))
    const { root, box } = page('aws.drawio')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new TextEncoder().encode('<mxfile/>') }), files: () => [], loadDiagram, online })
    await until(() => box.querySelector('img') !== null)
    expect(box.querySelector('.page-drawing__note')?.textContent).toBe("Some shapes in this diagram download the first time you're online.")
    missing = []
    online.dispatchEvent(new Event('online'))
    await until(() => calls.length === 2 && box.querySelector('.page-drawing__note') === null)
    expect(await urls.get(box.querySelector('img')!.src)!.text()).toContain('aws')
    watch.stop()
  })

  it('a diagram of several pages: a page picker; a pick draws that page, and full screen names it', async () => {
    const { calls, loadDiagram } = viewer((input) => ({ svg: svgOf(input.page ?? 'p1'), width: 400, height: 200, pages: PAGES, page: input.page ?? 'p1', missing: [] }))
    const { root, box } = page('multipage.drawio')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new TextEncoder().encode('<mxfile/>') }), files: () => [], loadDiagram })
    await until(() => box.querySelector('select') !== null)
    const select = box.querySelector('select')!
    expect([...select.options].map((o) => o.textContent)).toEqual(['1. Overview', '2. Details', '3. Empty-ish'])
    expect(select.value).toBe('p1')
    select.value = 'p2'
    select.dispatchEvent(new Event('change'))
    await until(() => box.querySelector('img')?.alt === 'Diagram · multipage.drawio · Details')
    expect(calls.map((c) => c.page)).toEqual([null, 'p2'])
    expect(box.querySelector('select')!.value).toBe('p2')
    box.querySelector('img')!.click()
    expect(document.querySelector('.drawing-view')?.getAttribute('aria-label')).toBe('Drawing · multipage.drawio · Details')
    document.querySelector<HTMLButtonElement>('.drawing-view__close')!.click()
    watch.stop()
  })

  it('dark mode as the Mac: the iPhone turns dark, the shown diagram is drawn again dark, on the page it shows', async () => {
    let listener: (() => void) | null = null
    const dark = { matches: false, addEventListener: (_: 'change', fn: () => void) => void (listener = fn), removeEventListener() {} }
    const { calls, loadDiagram } = viewer((input) => ({ svg: svgOf(input.theme), width: 400, height: 200, pages: PAGES, page: input.page ?? 'p1', missing: [] }))
    const { root, box } = page('multipage.drawio')
    const watch = watchDrawings(root, { read: async () => ({ bytes: new TextEncoder().encode('<mxfile/>') }), files: () => [], loadDiagram, dark })
    await until(() => box.querySelector('img') !== null)
    dark.matches = true
    listener!()
    await until(() => calls.length === 2)
    expect(calls.map((c) => [c.theme, c.page])).toEqual([['light', null], ['dark', 'p1']])
    watch.stop()
  })

  it("calm lines: needs a connection; missing; a broken file (\"Can't show this diagram\"); an empty diagram", async () => {
    const cases: Record<string, Awaited<ReturnType<DrawingDeps['read']>>> = {
      'away.drawio': { why: 'offline' },
      'gone.drawio': { why: 'gone' },
      'broken.drawio': { bytes: new TextEncoder().encode('not xml') },
      'empty.drawio': { bytes: new TextEncoder().encode('<mxfile><diagram id="d"/></mxfile>') },
    }
    const { loadDiagram } = viewer((input) => {
      if (input.text === 'not xml') throw new Error('not a draw.io diagram')
      return 'empty'
    })
    const root = document.createElement('div')
    for (const path of Object.keys(cases)) root.append(drawingBox(path, path)!)
    document.body.append(root)
    const watch = watchDrawings(root, { read: async (path) => cases[path], files: () => [], loadDiagram })
    await until(() => [...root.children].every((b) => !b.classList.contains('page-drawing--wait')))
    expect(Object.fromEntries([...root.children].map((b) => [(b as HTMLElement).dataset.vaultDrawing, b.textContent]))).toEqual({
      'away.drawio': 'Diagram · away.drawio · Needs a connection',
      'gone.drawio': 'Missing diagram · gone.drawio',
      'broken.drawio': "Diagram · broken.drawio · Can't show this diagram",
      'empty.drawio': 'Diagram · empty.drawio · Empty diagram',
    })
    watch.stop()
  })
})
