import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY, parseBoardMetaBlock } from '@shared/drawingAssets'
import { diagramDocumentError, parseDiagramMetaAttrs } from '@shared/diagramFile'
import { createBoard } from './createBoard'
import { loadDiagram } from './diagram'
import { loadDrawing } from './drawing'
import { failure } from './testFixture'

/**
 * `fs:create-board` (YAZ-3028 D9) on a real temp vault: a board is born with main's empty content
 * and its dates, opens through its own load door at once, and is never written over.
 */
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yaz-3028-create-board-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('fs:create-board', () => {
  it('a drawing is born as the empty Docs scene with its dates first, and opens as an empty canvas', async () => {
    const file = path.join(root, 'Sketch.excalidraw')
    const res = await createBoard({ root, path: file })
    expect(res.path).toBe(file)
    const text = await readFile(file, 'utf8')
    const scene = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(scene)[0]).toBe(BOARD_META_KEY)
    expect(scene).toMatchObject({ type: 'excalidraw', source: 'yaseen-docs', elements: [], files: {} })
    const block = parseBoardMetaBlock(text)
    expect(block?.createdAt).toBe(block?.updatedAt)
    const opened = await loadDrawing({ root, path: file })
    expect(opened.mtime).toBe(res.mtime)
    expect(opened.files).toEqual({})
  })

  it('a diagram is born as the empty draw.io page with its two dates on <mxfile>, and opens', async () => {
    const file = path.join(root, 'Flow.drawio')
    await createBoard({ root, path: file })
    const xml = await readFile(file, 'utf8')
    expect(diagramDocumentError(xml)).toBeNull()
    expect(parseDiagramMetaAttrs(xml)).not.toBeNull()
    expect((await loadDiagram({ root, path: file })).xml).toBe(xml)
  })

  it('never writes over an existing file: ALREADY_EXISTS, and the old bytes stay', async () => {
    const file = path.join(root, 'Taken.excalidraw')
    await writeFile(file, 'mine')
    expect((await failure(createBoard({ root, path: file }))).code).toBe('ALREADY_EXISTS')
    expect(await readFile(file, 'utf8')).toBe('mine')
  })

  it('refuses a note, a path outside the vault and a missing parent, and leaves nothing behind', async () => {
    expect((await failure(createBoard({ root, path: path.join(root, 'Note.md') }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(createBoard({ root, path: path.join(path.dirname(root), 'Out.excalidraw') }))).code).toBe('BAD_REQUEST')
    expect((await failure(createBoard({ root, path: 'Rel.drawio' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(createBoard({ root, path: path.join(root, 'Gone', 'X.drawio') }))).code).toBe('NOT_FOUND')
    await mkdir(path.join(root, 'Kept'))
    expect((await readdir(root)).sort()).toEqual(['Kept'])
  })
})
