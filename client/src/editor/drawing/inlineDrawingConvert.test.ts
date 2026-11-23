/**
 * Unit tests for `inlineDrawingConvert.ts` (YAZ-5040 / YAZ-6121):
 * `inlineEmbedText`, `moveInlineDrawingToFile`, `putDrawingBackIntoPage`, and `drawingEmbeddersCount`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrawingFileEntry, DrawingNewFile, IndexRecord } from '@shared/types'

const state = vi.hoisted(() => ({
  files: new Map<string, { content: string; mtime: number }>(),
  boards: new Map<string, { json: string; files: Record<string, DrawingFileEntry>; stored: string[]; mtime: number }>(),
  clock: 10,
  writes: [] as Array<{ path: string; quiet?: boolean; expectedMtime?: number }>,
  createdBoards: [] as string[],
  savedBoards: [] as Array<{ root: string; path: string; json: string; newFiles: DrawingNewFile[] }>,
  landedAssets: [] as Array<{ root: string; newFiles: DrawingNewFile[] }>,
  deleted: [] as string[],
  existingBoards: new Set<string>(),
  refuseWrite: new Map<string, string>(),
  refuseSave: false,
  refuseDelete: false,
}))

vi.mock('../../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api')>()
  const fail = (code: string, path: string) => new real.BridgeRequestError(code as 'CONFLICT', `${code} ${path}`)
  return {
    ...real,
    api: {
      ...real.api,
      createDir: vi.fn(async ({ path }: { path: string }) => ({ path })),
      createBoard: vi.fn(async ({ path }: { root: string; path: string }) => {
        if (state.existingBoards.has(path)) throw fail('ALREADY_EXISTS', path)
        state.existingBoards.add(path)
        state.createdBoards.push(path)
        return { path, mtime: ++state.clock, size: 2 }
      }),
      readFile: vi.fn(async (path: string) => {
        const f = state.files.get(path)
        if (f === undefined) throw fail('NOT_FOUND', path)
        return { path, content: f.content, mtime: f.mtime, size: f.content.length }
      }),
      writeFile: vi.fn(async (req: { path: string; content: string; expectedMtime?: number; quiet?: boolean }) => {
        state.writes.push({ path: req.path, quiet: req.quiet, expectedMtime: req.expectedMtime })
        const code = state.refuseWrite.get(req.path)
        if (code !== undefined) {
          state.refuseWrite.delete(req.path)
          throw fail(code, req.path)
        }
        const f = state.files.get(req.path)
        if (f !== undefined && req.expectedMtime !== undefined && f.mtime !== req.expectedMtime) throw fail('CONFLICT', req.path)
        const mtime = ++state.clock
        state.files.set(req.path, { content: req.content, mtime })
        return { path: req.path, mtime, size: req.content.length }
      }),
      drawing: {
        ...real.api.drawing,
        load: vi.fn(async ({ root, path }: { root: string; path: string }) => {
          const abs = path.startsWith('/') ? path : `${root}/${path}`
          const b = state.boards.get(abs)
          if (b === undefined) throw fail('NOT_FOUND', abs)
          return { path: abs, json: b.json, mtime: b.mtime, size: b.json.length, files: b.files, stored: b.stored }
        }),
        save: vi.fn(async (req: { root: string; path: string; json: string; newFiles: DrawingNewFile[] }) => {
          if (state.refuseSave) throw fail('IO_ERROR', req.path)
          state.savedBoards.push(req)
          const mtime = ++state.clock
          state.boards.set(req.path, { json: req.json, files: {}, stored: [], mtime })
          return { path: req.path, mtime, size: req.json.length, persisted: [] }
        }),
        landAssets: vi.fn(async (req: { root: string; newFiles: DrawingNewFile[] }) => {
          state.landedAssets.push(req)
          return { persisted: req.newFiles.map((f) => f.fileId) }
        }),
      },
      file: {
        ...real.api.file,
        delete: vi.fn(async ({ path }: { path: string }) => {
          if (state.refuseDelete) throw fail('FORBIDDEN', path)
          state.deleted.push(path)
          state.existingBoards.delete(path)
          state.boards.delete(path)
          return { path, kind: 'file', trashed: null }
        }),
      },
    },
  }
})

import { setNewBoardFolderOf } from '../../drawings/createDrawing'
import { createWikilinkResolveSource } from '../wikilink/linkResolve'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import {
  DrawingConvertStopped,
  drawingConvertFailure,
  drawingEmbeddersCount,
  inlineEmbedText,
  moveInlineDrawingToFile,
  putDrawingBackIntoPage,
} from './inlineDrawingConvert'

const SCENE_JSON = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'yaseen-docs',
  elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
  appState: {},
  files: {},
})

const ROOT = '/v'
const PAGE = '/v/notes/Plan.md'
const BOARD = '/v/notes/Plan drawing.excalidraw'

const putPage = (path: string, content: string) => state.files.set(path, { content, mtime: ++state.clock })
const putBoard = (path: string, json: string, files: Record<string, DrawingFileEntry> = {}, stored: string[] = Object.keys(files)) => {
  state.boards.set(path, { json, files, stored, mtime: ++state.clock })
  state.existingBoards.add(path)
}

function makeRecord(path: string, embeds: string[], links: string[] = []): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.md$/, '')
  return {
    path,
    name,
    basename,
    title: basename,
    folder: path.slice(0, path.lastIndexOf('/')),
    ext: 'md',
    size: 10,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases: [],
    tags: [],
    links,
    embeds,
  }
}

beforeEach(() => {
  state.files.clear()
  state.boards.clear()
  state.writes.length = 0
  state.createdBoards.length = 0
  state.savedBoards.length = 0
  state.landedAssets.length = 0
  state.deleted.length = 0
  state.existingBoards.clear()
  state.refuseWrite.clear()
  state.refuseSave = false
  state.refuseDelete = false
  setNewBoardFolderOf(() => 'page')
})

describe('inlineEmbedText', () => {
  it('formats embed with parsed size, view, and lock from drawingLine', () => {
    expect(inlineEmbedText('Plan drawing.excalidraw', '<!-- drawing: 640x360 view=10,-20,0.8 locked -->')).toBe(
      '![[Plan drawing.excalidraw|640x360 view=10,-20,0.8 locked]]',
    )
    expect(inlineEmbedText('notes/Plan drawing.excalidraw', '<!-- drawing: 500x300 -->')).toBe(
      '![[notes/Plan drawing.excalidraw|500x300]]',
    )
  })

  it('defaults to locked when drawingLine is null or invalid', () => {
    expect(inlineEmbedText('Plan drawing.excalidraw', null)).toBe('![[Plan drawing.excalidraw|locked]]')
    expect(inlineEmbedText('Plan drawing.excalidraw', '')).toBe('![[Plan drawing.excalidraw|locked]]')
    expect(inlineEmbedText('Plan drawing.excalidraw', '<!-- not a drawing line -->')).toBe('![[Plan drawing.excalidraw|locked]]')
  })
})

describe('moveInlineDrawingToFile', () => {
  it('creates board in page folder, saves scene, and returns bare name when unique', async () => {
    const res = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      sceneJson: SCENE_JSON,
      nameTaken: () => false,
    })
    expect(res).toEqual({ target: 'Plan drawing.excalidraw', boardPath: BOARD })
    expect(state.createdBoards).toEqual([BOARD])
    expect(state.savedBoards).toEqual([{ root: ROOT, path: BOARD, json: SCENE_JSON, newFiles: [] }])
  })

  it('returns vault-relative target when name is taken or nameTaken is omitted', async () => {
    const taken = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      sceneJson: SCENE_JSON,
      nameTaken: () => true,
    })
    expect(taken).toEqual({ target: 'notes/Plan drawing.excalidraw', boardPath: BOARD })

    const omitted = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      sceneJson: SCENE_JSON,
    })
    expect(omitted).toEqual({ target: 'notes/Plan drawing 2.excalidraw', boardPath: '/v/notes/Plan drawing 2.excalidraw' })
  })

  it('respects newBoardFolder = assets and still resolves exact boardPath', async () => {
    setNewBoardFolderOf(() => 'assets')
    const res = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      sceneJson: SCENE_JSON,
      nameTaken: () => false,
    })
    expect(res).toEqual({
      target: 'Plan drawing.excalidraw',
      boardPath: '/v/assets/drawings/Plan drawing.excalidraw',
    })
    expect(state.savedBoards[0]?.path).toBe('/v/assets/drawings/Plan drawing.excalidraw')
  })

  it('uses sanitized drawingTitle as filename (with retry on ALREADY_EXISTS) when non-empty', async () => {
    const first = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      drawingTitle: 'Auth/Flow: v1',
      sceneJson: SCENE_JSON,
      nameTaken: () => false,
    })
    expect(first).toEqual({
      target: 'Auth-Flow- v1.excalidraw',
      boardPath: '/v/notes/Auth-Flow- v1.excalidraw',
    })

    const second = await moveInlineDrawingToFile({
      root: ROOT,
      pagePath: PAGE,
      title: 'Plan',
      drawingTitle: 'Auth/Flow: v1',
      sceneJson: SCENE_JSON,
      nameTaken: () => false,
    })
    expect(second).toEqual({
      target: 'Auth-Flow- v1 2.excalidraw',
      boardPath: '/v/notes/Auth-Flow- v1 2.excalidraw',
    })
  })

  it('trashes the newly created empty board when api.drawing.save fails', async () => {
    state.refuseSave = true
    await expect(
      moveInlineDrawingToFile({
        root: ROOT,
        pagePath: PAGE,
        title: 'Plan',
        sceneJson: SCENE_JSON,
        nameTaken: () => false,
      }),
    ).rejects.toThrow()
    expect(state.deleted).toEqual([BOARD])
  })
})

describe('putDrawingBackIntoPage', () => {
  it('loads board, replaces lone embed with compact inline block at its indent (preserving board name as title), and trashes board', async () => {
    putPage(PAGE, '# Plan\n\n- Item\n  ![[Plan drawing.excalidraw|640x360 locked]]\n\nEnd.\n')
    putBoard(BOARD, JSON.stringify({ ...JSON.parse(SCENE_JSON), files: {} }, null, 2))

    await putDrawingBackIntoPage({
      root: ROOT,
      pagePath: PAGE,
      boardPath: BOARD,
      inner: 'Plan drawing.excalidraw|640x360 locked',
      nth: 0,
      optionsText: '640x360 locked',
    })

    expect(state.landedAssets).toEqual([])
    expect(state.files.get(PAGE)?.content).toBe(
      `# Plan\n\n- Item\n  \`\`\`excalidraw\n  ${SCENE_JSON}\n  \`\`\`\n  <!-- drawing: title "Plan drawing", 640x360 locked -->\n\nEnd.\n`,
    )
    expect(state.writes).toEqual([{ path: PAGE, quiet: true, expectedMtime: expect.any(Number) }])
    expect(state.deleted).toEqual([BOARD])
  })

  it('lands embedded image files into vault assets before writing the page and trashing the board', async () => {
    const img: DrawingFileEntry = { mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' }
    putPage(PAGE, '![[Plan drawing.excalidraw]]\n')
    putBoard(BOARD, SCENE_JSON, { img1: img }, ['img1'])

    await putDrawingBackIntoPage({
      root: ROOT,
      pagePath: PAGE,
      boardPath: BOARD,
      inner: 'Plan drawing.excalidraw',
      nth: 0,
      optionsText: null,
    })

    expect(state.landedAssets).toEqual([
      { root: ROOT, newFiles: [{ fileId: 'img1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' }] },
    ])
    expect(state.deleted).toEqual([BOARD])
  })

  it('replaces the nth occurrence when the same lone embed appears multiple times', async () => {
    putPage(PAGE, '![[Plan drawing.excalidraw]]\n\nMiddle\n\n![[Plan drawing.excalidraw]]\n')
    putBoard(BOARD, SCENE_JSON)

    await putDrawingBackIntoPage({
      root: ROOT,
      pagePath: PAGE,
      boardPath: BOARD,
      inner: 'Plan drawing.excalidraw',
      nth: 1,
      optionsText: null,
    })

    expect(state.files.get(PAGE)?.content).toBe(
      `![[Plan drawing.excalidraw]]\n\nMiddle\n\n\`\`\`excalidraw\n${SCENE_JSON}\n\`\`\`\n<!-- drawing: title "Plan drawing" -->\n`,
    )
  })

  it('stops on readonly page without writing or trashing', async () => {
    putPage(PAGE, '---\nreadonly: true\n---\n![[Plan drawing.excalidraw]]\n')
    putBoard(BOARD, SCENE_JSON)

    await expect(
      putDrawingBackIntoPage({
        root: ROOT,
        pagePath: PAGE,
        boardPath: BOARD,
        inner: 'Plan drawing.excalidraw',
        nth: 0,
        optionsText: null,
      }),
    ).rejects.toBeInstanceOf(DrawingConvertStopped)
    expect(state.writes).toEqual([])
    expect(state.deleted).toEqual([])
  })

  it('restores the page if trashing the standalone board fails', async () => {
    const original = 'Above\n\n![[Plan drawing.excalidraw|locked]]\n'
    putPage(PAGE, original)
    putBoard(BOARD, SCENE_JSON)
    state.refuseDelete = true

    const err = await putDrawingBackIntoPage({
      root: ROOT,
      pagePath: PAGE,
      boardPath: BOARD,
      inner: 'Plan drawing.excalidraw|locked',
      nth: 0,
      optionsText: 'locked',
    }).catch((e: unknown) => e)

    expect(drawingConvertFailure(err)).toBe('the disk refused the change. Nothing changed.')
    expect(state.files.get(PAGE)?.content).toBe(original)
  })

  it('does not trash the board when compare-and-set write hits CONFLICT', async () => {
    putPage(PAGE, '![[Plan drawing.excalidraw]]\n')
    putBoard(BOARD, SCENE_JSON)
    state.refuseWrite.set(PAGE, 'CONFLICT')

    const err = await putDrawingBackIntoPage({
      root: ROOT,
      pagePath: PAGE,
      boardPath: BOARD,
      inner: 'Plan drawing.excalidraw',
      nth: 0,
      optionsText: null,
    }).catch((e: unknown) => e)

    expect(drawingConvertFailure(err)).toBe('the file changed on disk. Nothing changed; try again.')
    expect(state.deleted).toEqual([])
  })
})

describe('drawingEmbeddersCount', () => {
  it('returns 0 when wikilinks is undefined', () => {
    expect(drawingEmbeddersCount(undefined, BOARD, PAGE)).toBe(0)
  })

  it('counts other pages embedding the board via viewOnly resolver and ID resolver, excluding current page', () => {
    const wikilinks = createWikilinkResolveSource()
    const records: IndexRecord[] = [
      makeRecord(PAGE, ['Plan drawing.excalidraw']),
      makeRecord('/v/other/One.md', ['Plan drawing.excalidraw|640x360']),
      makeRecord('/v/other/Two.md', ['EMB-40']),
      makeRecord('/v/other/LinkOnly.md', [], ['Plan drawing.excalidraw']),
      makeRecord('/v/other/OtherBoard.md', ['Other.excalidraw']),
    ]
    wikilinks.update((t) => (t === 'EMB-40' ? BOARD : null), records, [], true, ['EMB'])

    const viewOnly: ViewOnlyLinkSource = {
      ready: true,
      catalog: null,
      targets: [],
      resolve: (t) => (t === 'Plan drawing.excalidraw' ? BOARD : t === 'Other.excalidraw' ? '/v/Other.excalidraw' : null),
      subscribe: () => () => {},
    }

    expect(drawingEmbeddersCount(wikilinks, BOARD, PAGE, viewOnly)).toBe(2)
  })

  it('falls back to path suffix matching when viewOnly is omitted', () => {
    const wikilinks = createWikilinkResolveSource()
    const records: IndexRecord[] = [
      makeRecord(PAGE, ['Plan drawing.excalidraw']),
      makeRecord('/v/other/One.md', ['Plan drawing.excalidraw|locked']),
      makeRecord('/v/other/Two.md', ['notes/Plan drawing.excalidraw']),
      makeRecord('/v/other/Three.md', ['Other.excalidraw']),
    ]
    wikilinks.update(() => null, records)

    expect(drawingEmbeddersCount(wikilinks, BOARD, PAGE)).toBe(2)
  })
})
