/**
 * BOARD PICTURES (YAZ-4825): one picture per key however many windows ask, 24 kept with their blob URLs revoked as
 * they leave, the key's parts, the watcher stream (one subscription per root, only the paths windows show), frames.
 * The draw.io renderer is a stand-in here; `tools/yaseenRender.test.mjs` runs the real page (the page fallback), and
 * `boardPictures.engine.test.ts` the real drawing export.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchEvent } from '@shared/types'

const bridge = vi.hoisted(() => ({ watchers: new Map<string, (ev: WatchEvent) => void>(), offs: [] as string[] }))

vi.mock('../../api', async (importOriginal) => ({
  BridgeRequestError: (await importOriginal<typeof import('../../api')>()).BridgeRequestError,
  api: {
    boardHead: vi.fn(async (path: string) => ({ path, mtime: 100, size: 1, meta: null })),
    diagram: { load: vi.fn(async ({ path }: { path: string }) => ({ path, xml: `<mxfile>${path}</mxfile>`, mtime: 100, size: 1 })) },
    drawing: { load: vi.fn() },
    watch: vi.fn((root: string, listener: (ev: WatchEvent) => void) => {
      bridge.watchers.set(root, listener)
      return () => {
        bridge.offs.push(root)
        bridge.watchers.delete(root)
      }
    }),
  },
}))
vi.mock('../../diagrams/renderDiagram', () => ({
  // The SVG text itself (A20): the frame's `svgText` answer, which goes into the blob as it is.
  renderDiagramPage: vi.fn(async (xml: string, page: string | null) => ({
    picture: `<svg xmlns="http://www.w3.org/2000/svg">${xml}</svg>`,
    page: page === 'p1' ? 'p1' : 'p0', // the renderer's own fallback: a gone id draws the first page
    pages: [
      { id: 'p0', name: 'One' },
      { id: 'p1', name: 'Two' },
    ],
    bounds: { x: -10, y: -10, width: 300, height: 200 },
  })),
}))

import { api, BridgeRequestError } from '../../api'
import { renderDiagramPage } from '../../diagrams/renderDiagram'
import { absolutePath, clearPictures, currentKey, dropPicturesExcept, framesOf, loadPicture, peekPicture, PICTURE_LIMIT, PICTURE_MAX_BYTES, pictureKey, watchBoard, watchCounts, type BoardPicture } from './boardPictures'
import { embedPictureStats } from './pictureStats'

/** A settled picture, or the test fails with what came instead. */
async function picture(ref: { root: string; path: string }, page: string | null = null): Promise<BoardPicture> {
  const got = await loadPicture(ref, page)
  if (typeof got === 'string') throw new Error(`no picture: ${got}`)
  return got
}

let serial = 0
const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  serial = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:${++serial}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
})

afterEach(() => {
  clearPictures()
  created.length = 0
  revoked.length = 0
  bridge.offs.length = 0
  vi.clearAllMocks()
})

describe('board pictures', () => {
  it('one picture per key for many windows: one load, one draw, one blob URL', async () => {
    const ref = { root: '/v', path: 'A.drawio' }
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => loadPicture(ref, null)))
    expect(new Set(all).size).toBe(1)
    expect(api.diagram.load).toHaveBeenCalledTimes(1)
    expect(renderDiagramPage).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
    expect(all[0]).toMatchObject({ url: 'blob:1', page: 'p0', bounds: { x: -10, y: -10, width: 300, height: 200 } })
    // The SVG text went into the blob, not the data URL.
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/svg+xml')
    expect(await blob.text()).toContain('<mxfile>/v/A.drawio</mxfile>')
    expect(peekPicture((all[0] as BoardPicture).key)).toBe(all[0])
  })

  it(`keeps ${PICTURE_LIMIT}: the least recently seen leaves first, its blob URL revoked; the Memory page counts them`, async () => {
    for (let i = 0; i <= PICTURE_LIMIT; i++) await loadPicture({ root: '/v', path: `B${i}.drawio` }, null)
    expect(revoked).toEqual(['blob:1'])
    expect(embedPictureStats().count).toBe(PICTURE_LIMIT)
    expect(embedPictureStats().bytes).toBeGreaterThan(0)
    clearPictures()
    expect(revoked).toHaveLength(PICTURE_LIMIT + 1)
    expect(embedPictureStats()).toEqual({ count: 0, bytes: 0 })
  })

  it('the key carries root, path, mtime, theme, dark colours and a diagram`s page; a drawing`s page is never in it', () => {
    expect(pictureKey('/v', '/v/x.drawio', 5, 'dark', 'keep', 'p1')).toBe('/v\n/v/x.drawio\n5\ndark\nkeep\np1')
    expect(pictureKey('/v', '/v/x.excalidraw', 5, 'light', 'adapt', 'p1')).toBe('/v\n/v/x.excalidraw\n5\nlight\nadapt\n')
    expect(absolutePath('/v/', 'a/b.drawio')).toBe('/v/a/b.drawio')
    expect(absolutePath('/v', '/w/b.drawio')).toBe('/w/b.drawio')
  })

  it('a page that is gone draws the first page; another page is its own picture', async () => {
    const ref = { root: '/v', path: 'P.drawio' }
    expect((await picture(ref, 'gone')).page).toBe('p0')
    expect((await picture(ref, 'p1')).page).toBe('p1')
    expect(renderDiagramPage).toHaveBeenCalledTimes(2)
  })

  it('A4: a file that is not there is `missing`; one that will not read or draw is `broken`; each is asked again next time', async () => {
    vi.mocked(api.boardHead).mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'no such board'))
    expect(await loadPicture({ root: '/v', path: 'Gone.drawio' }, null)).toBe('missing')
    expect(await loadPicture({ root: '/v', path: 'Gone.drawio' }, null)).toMatchObject({ url: 'blob:1' })
    vi.mocked(api.boardHead).mockRejectedValueOnce(new BridgeRequestError('FORBIDDEN', 'no access'))
    expect(await loadPicture({ root: '/v', path: 'Locked.drawio' }, null)).toBe('broken')
    vi.mocked(renderDiagramPage).mockRejectedValueOnce(new Error('diagram picture timed out'))
    expect(await loadPicture({ root: '/v', path: 'Slow.drawio' }, null)).toBe('broken')
    expect(await loadPicture({ root: '/v', path: 'Slow.drawio' }, null)).toMatchObject({ page: 'p0' })
  })

  it('A5: the sleep`s sweep drops each picture not in the kept set, its blob URL revoked; the kept one stays', async () => {
    const kept = await picture({ root: '/v', path: 'Kept.drawio' })
    const gone = await picture({ root: '/v', path: 'Gone.drawio' })
    dropPicturesExcept(new Set([kept.key]))
    expect(revoked).toEqual([gone.url])
    expect(peekPicture(gone.key)).toBeUndefined()
    expect(peekPicture(kept.key)).toBe(kept)
    expect(embedPictureStats().count).toBe(1)
  })

  it('a byte limit too: 64 MB of SVG text, counted by the SVG text, not by the blob URL (the cache`s `sizeOf`, previewCache.test.ts)', () => {
    expect(PICTURE_MAX_BYTES).toBe(64 * 1024 * 1024)
  })

  it('the watcher: one subscription per root; a change of a shown path moves its key; every other path is ignored; the last window ends it', async () => {
    const heard: WatchEvent[] = []
    const a = watchBoard('/v', 'A.drawio', 'A.drawio', (ev) => heard.push(ev))
    const b = watchBoard('/v', 'A.drawio', 'A.drawio', () => undefined)
    const missing = watchBoard('/v', null, 'Lost.drawio', (ev) => heard.push(ev))
    expect(api.watch).toHaveBeenCalledTimes(1)
    expect(watchCounts()).toEqual({ roots: 1, paths: 1, names: 1 })
    await loadPicture({ root: '/v', path: 'A.drawio' }, null)
    const before = currentKey({ root: '/v', path: 'A.drawio' }, null)
    const emit = bridge.watchers.get('/v')!
    emit({ type: 'change', path: '/v/Other.drawio', mtime: 7 })
    expect(heard).toEqual([])
    emit({ type: 'change', path: '/v/A.drawio', mtime: 200 })
    expect(heard).toEqual([{ type: 'change', path: '/v/A.drawio', mtime: 200 }])
    expect(currentKey({ root: '/v', path: 'A.drawio' }, null)).not.toBe(before)
    // A missing board's file added back under its name.
    emit({ type: 'add', path: '/v/sub/lost.drawio', mtime: 3 })
    expect(heard).toHaveLength(2)
    a()
    missing()
    expect(bridge.offs).toEqual([])
    b()
    expect(bridge.offs).toEqual(['/v'])
    expect(watchCounts()).toEqual({ roots: 0, paths: 0, names: 0 })
  })

  it('frames (item 1): every frame and AI frame, with its name or the engine`s default', () => {
    const frames = framesOf([
      { id: 'r', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      { id: 'f', type: 'frame', x: 10, y: 20, width: 300, height: 200, name: 'Top' },
      { id: 'g', type: 'frame', x: 0, y: 0, width: 5, height: 5, name: null },
      { id: 'm', type: 'magicframe', x: 1, y: 2, width: 3, height: 4 },
    ])
    expect(frames).toEqual([
      { id: 'f', name: 'Top', x: 10, y: 20, width: 300, height: 200 },
      { id: 'g', name: 'Frame', x: 0, y: 0, width: 5, height: 5 },
      { id: 'm', name: 'AI Frame', x: 1, y: 2, width: 3, height: 4 },
    ])
  })
})

describe('the lazy chunk', () => {
  it('no @excalidraw import is reachable from types.ts; only loadBoardWindow() loads the window module', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'client/src/editor/embed')
    const types = readFileSync(join(dir, 'types.ts'), 'utf8')
    // Every static import of the contract is type-only; the one value import is the dynamic one.
    expect([...types.matchAll(/^import (?!type )/gm)]).toEqual([])
    expect([...types.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1])).toEqual(['./boardWindow'])
    // No other file of the app imports the window module or its pictures statically.
    const files: string[] = []
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
      }
    }
    walk(join(process.cwd(), 'client/src'))
    const importers = files.filter((f) => /from '[./]*(?:embed\/)?(?:boardWindow|boardPictures)'/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(dir.length + 1))
    expect(importers.sort()).toEqual(['boardWindow.ts'])
  })
})
