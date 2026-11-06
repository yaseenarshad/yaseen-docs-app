import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY, boardFoldArrowsOf, boardHoverOutlineOf, hoverLinksOff, parseBoardMetaBlock, serializeBoard } from '@shared/drawingAssets'
import { DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR } from '@shared/diagramFile'
import { DIAGRAM_READ_ONLY_ATTR, isDiagramReadOnly, isDrawingReadOnly } from '@shared/readOnly'
import { setBoardFoldArrows } from './boardFoldArrows'
import { setBoardHoverLinks } from './boardHoverLinks'
import { setBoardHoverOutline } from './boardHoverOutline'
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
  it('on writes the key and its change time (YAZ-3943 1E) in the block, atomically, and answers the new mtime; off removes the key and keeps the time', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    const { ino } = await stat(file)
    const on = await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(isDrawingReadOnly(JSON.parse(written) as Record<string, unknown>)).toBe(true)
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, readonly: true, switched: { readonly: expect.any(Number) } })
    const after = await stat(file)
    expect(on).toEqual({ path: file, mtime: after.mtimeMs, size: after.size })
    // A rename over the old file (tmp + rename), never a write in place; no tmp left behind.
    expect(after.ino).not.toBe(ino)
    expect((await readdir(root)).filter((n) => n.includes('.tmp-'))).toEqual([])
    await setBoardReadOnly({ root, path: 'Sketch.excalidraw', on: false, expectedMtime: on.mtime })
    const off = await readFile(file, 'utf8')
    expect(parseBoardMetaBlock(off)).toEqual({ createdAt: 1000, updatedAt: 2000, switched: { readonly: expect.any(Number) } })
    const { [BOARD_META_KEY]: _block, ...rest } = JSON.parse(off) as Record<string, unknown>
    const { [BOARD_META_KEY]: _was, ...before } = JSON.parse(SCENE) as Record<string, unknown>
    expect(rest).toEqual(before)
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
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toEqual({ createdAt: mtime, updatedAt: mtime, readonly: true, switched: { readonly: expect.any(Number) } })
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
    expect((await failure(setBoardReadOnly({ root, path: '', on: true, expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, on: true, expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardReadOnly({ root, path: 'image.drawio.svg', on: true, expectedMtime: mtime }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })
})

/** `board:set-hover-links` (YAZ-3943 demo 2): the cog's "Link preview on hover", the same rules as Read only. */
describe('board:set-hover-links on a drawing', () => {
  it('off writes `"hoverLinks": false` and its change time; on removes the key and keeps the time; the same value again writes nothing; a stale mtime is CONFLICT', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    expect((await setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: mtime })).mtime).toBe(mtime)
    const off = await setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: false, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, hoverLinks: false, switched: { hoverLinks: expect.any(Number) } })
    expect(hoverLinksOff(parseBoardMetaBlock(written))).toBe(true)
    expect((await failure(setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: mtime }))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(written)
    await setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: true, expectedMtime: off.mtime })
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toEqual({ createdAt: 1000, updatedAt: 2000, switched: { hoverLinks: expect.any(Number) } })
  })

  it('refuses a bad request and a diagram, and writes nothing', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    await seed('Flow.drawio', DIAGRAM)
    expect((await failure(setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: 'no', expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardHoverLinks({ root, path: 'Sketch.excalidraw', on: false }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardHoverLinks({ root, path: 'Flow.drawio', on: false, expectedMtime: mtime }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })
})

/** `board:set-fold-arrows` (YAZ-4277 D5): the cog's "Fold arrows", the same rules as Read only. */
describe('board:set-fold-arrows on a drawing', () => {
  it('a mode writes `"foldArrows"` and its change time; `app` removes the key and keeps the time; the same value again writes nothing; a stale mtime is CONFLICT', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    expect((await setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'app', expectedMtime: mtime })).mtime).toBe(mtime)
    const always = await setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'always', expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, foldArrows: 'always', switched: { foldArrows: expect.any(Number) } })
    expect(boardFoldArrowsOf(parseBoardMetaBlock(written))).toBe('always')
    expect((await setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'always', expectedMtime: always.mtime })).mtime).toBe(always.mtime)
    expect((await failure(setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'hover', expectedMtime: mtime }))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(written)
    const hover = await setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'hover', expectedMtime: always.mtime })
    expect(boardFoldArrowsOf(parseBoardMetaBlock(await readFile(file, 'utf8')))).toBe('hover')
    await setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'app', expectedMtime: hover.mtime })
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toEqual({ createdAt: 1000, updatedAt: 2000, switched: { foldArrows: expect.any(Number) } })
  })

  it("YAZ-4401 2E: `off` is a board's own mode: it writes `\"foldArrows\": \"off\"`, reads back as off, and leaves the elements' folds as they are", async () => {
    const folded = `${JSON.stringify({ type: 'excalidraw', version: 2, yaseendraw: { createdAt: 1000, updatedAt: 2000 }, elements: [{ id: 't', type: 'text', foldedLines: [0, 3] }], appState: {}, files: {} })}\n`
    const { file, mtime } = await seed('Folded.excalidraw', folded)
    const off = await setBoardFoldArrows({ root, path: 'Folded.excalidraw', value: 'off', expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, foldArrows: 'off', switched: { foldArrows: expect.any(Number) } })
    expect(boardFoldArrowsOf(parseBoardMetaBlock(written))).toBe('off')
    expect((JSON.parse(written) as { elements: unknown[] }).elements).toEqual([{ id: 't', type: 'text', foldedLines: [0, 3] }])
    // the same value again writes nothing
    expect((await setBoardFoldArrows({ root, path: 'Folded.excalidraw', value: 'off', expectedMtime: off.mtime })).mtime).toBe(off.mtime)
  })

  it("YAZ-4401 2E: a bad value's message names all four choices", async () => {
    const { mtime } = await seed('Sketch.excalidraw', SCENE)
    const bad = await failure(setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'never', expectedMtime: mtime }))
    expect(bad.code).toBe('BAD_REQUEST')
    expect(bad.message).toBe("'value' must be 'app', 'hover', 'always' or 'off'")
  })

  it('refuses a bad request and a diagram, and writes nothing', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    await seed('Flow.drawio', DIAGRAM)
    expect((await failure(setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'sometimes', expectedMtime: mtime }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardFoldArrows({ root, path: 'Sketch.excalidraw', value: 'hover' }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardFoldArrows({ root, path: 'Flow.drawio', value: 'hover', expectedMtime: mtime }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file, 'utf8')).toBe(SCENE)
  })
})

/** `board:set-hover-outline` (YAZ-4469 4B): the cog's "Hover outline", the rules of Fold arrows. */
describe('board:set-hover-outline on a drawing', () => {
  it('refuses a bad value; a stale mtime is CONFLICT; the same value writes nothing; a write changes only the `hoverOutline` key and its time', async () => {
    const { file, mtime } = await seed('Sketch.excalidraw', SCENE)
    for (const value of ['on', 1, null, undefined]) {
      const bad = await failure(setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value, expectedMtime: mtime }))
      expect(bad.code, String(value)).toBe('BAD_REQUEST')
      expect(bad.message).toBe("'value' must be 'app', true or false")
    }
    expect((await failure(setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: false }))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: false, expectedMtime: mtime - 1 }))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(SCENE)
    // App on a board with no key: nothing to write
    expect((await setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: 'app', expectedMtime: mtime })).mtime).toBe(mtime)

    const off = await setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: false, expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    expect(parseBoardMetaBlock(written)).toEqual({ createdAt: 1000, updatedAt: 2000, hoverOutline: false, switched: { hoverOutline: expect.any(Number) } })
    expect(boardHoverOutlineOf(parseBoardMetaBlock(written))).toBe(false)
    const { [BOARD_META_KEY]: _block, ...rest } = JSON.parse(written) as Record<string, unknown>
    const { [BOARD_META_KEY]: _was, ...before } = JSON.parse(SCENE) as Record<string, unknown>
    expect(rest).toEqual(before)
    expect((await setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: false, expectedMtime: off.mtime })).mtime).toBe(off.mtime)
    expect(await readFile(file, 'utf8')).toBe(written)

    const on = await setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: true, expectedMtime: off.mtime })
    expect(boardHoverOutlineOf(parseBoardMetaBlock(await readFile(file, 'utf8')))).toBe(true)
    await setBoardHoverOutline({ root, path: 'Sketch.excalidraw', value: 'app', expectedMtime: on.mtime })
    expect(parseBoardMetaBlock(await readFile(file, 'utf8'))).toEqual({ createdAt: 1000, updatedAt: 2000, switched: { hoverOutline: expect.any(Number) } })
  })
})
