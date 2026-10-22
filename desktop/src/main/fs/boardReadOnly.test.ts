import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY, parseBoardMetaBlock, serializeBoard } from '@shared/drawingAssets'
import { DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR } from '@shared/diagramFile'
import { DIAGRAM_READ_ONLY_ATTR, isDiagramReadOnly, isDrawingReadOnly } from '@shared/readOnly'
import { setBoardReadOnly } from './boardReadOnly'
import { loadDiagram, saveDiagram } from './diagram'
import { loadDrawing, saveDrawing } from './drawing'
import { failure } from './testFixture'

/**
 * `board:set-read-only` (YAZ-3076 D1) against a real temp vault: one key in the file, an atomic
 * write, refused when the file moved on (S13), nothing written for the same value (S11), and the
 * switch kept by the board's own save door afterwards.
 */
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yaz-3076-readonly-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

async function seed(rel: string, body: string): Promise<{ file: string; mtime: number }> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return { file, mtime: (await stat(file)).mtimeMs }
}

const SCENE = serializeBoard({ [BOARD_META_KEY]: { createdAt: 1000, updatedAt: 2000 }, type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [{ id: 'a', type: 'rectangle' }], appState: {}, files: {} })
const PAGE = '<diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram>'
const DIAGRAM = `<mxfile ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000" host="app">${PAGE}</mxfile>\n`

describe('board:set-read-only on a drawing', () => {
  it('on writes the key in the block, atomically, and answers the new mtime; off gives back the same bytes', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    const { ino } = await stat(file)
    const on = await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(isDrawingReadOnly(JSON.parse(written) as Record<string, unknown>)).toBe(true)
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, readonly: true })
    const after = await stat(file)
    expect(on).toEqual({ path: file, mtime: after.mtimeMs, size: after.size })
    // A rename over the old file (tmp + rename), never a write in place; no tmp left behind.
    expect(after.ino).not.toBe(ino)
    expect((await readdir(root)).filter((n) => n.includes('.tmp-'))).toEqual([])
    await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: false, expectedMtime: on.mtime })
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })

  it('S11: the same value again writes nothing; the mtime does not move', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    const res = await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: false, expectedMtime: mtime })
    expect(res.mtime).toBe(mtime)
    expect((await stat(file)).mtimeMs).toBe(mtime)
  })

  it('S13: a file that changed on disk is refused with CONFLICT and its mtime, and NOTHING is written', async () => {
    const { file } = await seed('Sketch.excalidraw', SCENE)
    const err = await failure(setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: 1 }))
    expect(err.code).toBe('CONFLICT')
    expect(err.mtime).toBe((await stat(file)).mtimeMs)
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })

  it('the board’s next save keeps the switch: the engine never sends the block back', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    const on = await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: mtime })
    const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [], appState: {}, files: {} })
    await saveDrawing({ root, path: 'Sketch.excalidraw', json, expectedMtime: on.mtime, newFiles: [] })
    expect(isDrawingReadOnly(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>)).toBe(true)
    // And the load answers it, for the tab that reads the switch off the scene.
    expect((await loadDrawing({ root, path: 'Sketch.excalidraw' })).json).toContain('"readonly": true')
  })

  it('a drawing with no block (written elsewhere) gets one dated by its file, which the save door then keeps', async () => {
    const { file, mtime } = await seed('Plain.excalidraw', JSON.stringify({ type: 'excalidraw', elements: [] }))
    const on = await setBoardReadOnly({ root, path: 'Plain.excalidraw', on: true, expectedMtime: mtime })
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toEqual({ createdAt: mtime, updatedAt: mtime, readonly: true })
    await saveDrawing({ root, path: 'Plain.excalidraw', json: '{"elements":[]}', expectedMtime: on.mtime, newFiles: [] })
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toMatchObject({ createdAt: mtime, readonly: true })
  })

  it('a file that is not a scene is refused with IO_ERROR and left alone', async () => {
    const { file, mtime } = await seed('Broken.excalidraw', 'not json')
    expect((await failure(setBoardReadOnly({ root, path: 'Broken.excalidraw', on: true, expectedMtime: mtime }))).code).toBe('IO_ERROR')
    expect(await readFile(file, 'utf8')).toBe('not json')
  })
})

describe('board:set-read-only on a diagram', () => {
  it('on writes the attribute on <mxfile>; off gives back the same bytes', async () => {
    const { file, mtime } = await seed('Flow.drawio', DIAGRAM)
    const on = await setBoardReadOnly({ root, path: 'Flow.drawio', on: true, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(written).toBe(DIAGRAM.replace('host="app"', `host="app" ${DIAGRAM_READ_ONLY_ATTR}="1"`))
    expect((await loadDiagram({ root, path: 'Flow.drawio' })).mtime).toBe(on.mtime)
    await setBoardReadOnly({ root, path: 'Flow.drawio', on: false, expectedMtime: on.mtime })
    expect(await readFile(file, 'utf8')).toBe(DIAGRAM)
  })

  it('S7: a bare <mxGraphModel> is wrapped, then marked', async () => {
    const { file, mtime } = await seed('Bare.drawio', '<mxGraphModel><root><mxCell id="0" /></root></mxGraphModel>\n')
    await setBoardReadOnly({ root, path: 'Bare.drawio', on: true, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(written.startsWith(`<mxfile ${DIAGRAM_READ_ONLY_ATTR}="1"><diagram`)).toBe(true)
    expect(isDiagramReadOnly(written)).toBe(true)
    expect((await loadDiagram({ root, path: 'Bare.drawio' })).xml).toBe(written)
  })

  it('S13: CONFLICT on a stale mtime, and nothing is written', async () => {
    const { file } = await seed('Flow.drawio', DIAGRAM)
    expect((await failure(setBoardReadOnly({ root, path: 'Flow.drawio', on: true, expectedMtime: 1 }))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(DIAGRAM)
  })

  it('a file draw.io could not open is refused with IO_ERROR and left alone', async () => {
    const { file, mtime } = await seed('Cut.drawio', '<mxfile><diagram id="a">')
    expect((await failure(setBoardReadOnly({ root, path: 'Cut.drawio', on: true, expectedMtime: mtime }))).code).toBe('IO_ERROR')
    expect(await readFile(file, 'utf8')).toBe('<mxfile><diagram id="a">')
  })

  it('an EDITABLE diagram’s save never brings an attribute back', async () => {
    const { file, mtime } = await seed('Flow.drawio', DIAGRAM)
    await saveDiagram({ root, path: 'Flow.drawio', xml: `<mxfile host="drawio">${PAGE}</mxfile>`, expectedMtime: mtime })
    expect(isDiagramReadOnly(await readFile(file, 'utf8'))).toBe(false)
  })
})

describe('board:set-read-only refuses a bad request before touching the disk', () => {
  it('a non-boolean `on`, a missing or non-number `expectedMtime`, a path that is no board, or a path out of the vault', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    await seed('Note.md', '# hi\n')
    expect((await failure(setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: 'yes', expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: '1' }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, path: 'Note.md', on: true, expectedMtime: mtime }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(setBoardReadOnly({ root, path: '../x.excalidraw', on: true, expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, path: 'missing.drawio', on: true, expectedMtime: mtime }))).code).toBe('NOT_FOUND')
    expect((await failure(setBoardReadOnly(null))).code).toBe('BAD_REQUEST')
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })
})
