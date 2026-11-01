import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { setBoardPictures, TOO_BIG_INSIDE } from './boardPictures'
import { loadDrawing, saveDrawing } from './drawing'
import { failure } from './testFixture'

// The 50 MB rule at a size a test can write: the rule, not the number, is what is checked here.
vi.mock('@shared/drawingAssets', async (importOriginal) => ({ ...(await importOriginal<typeof import('@shared/drawingAssets')>()), PICTURES_INSIDE_MAX_BYTES: 4096 }))

/**
 * YAZ-3943 D5: a board keeps its pictures INSIDE by default (this reverses 🔒 YAZ-1775 D3). Main does
 * the embed on the save from the small scene the renderer sends; `"pictures": "assets"` in the block
 * keeps the old shape; the cog's switch (`board:set-pictures`) moves them either way.
 */

const b64 = (text: string) => Buffer.from(text).toString('base64')
const png = (text: string) => `data:image/png;base64,${b64(text)}`
const imageEl = (fileId: string, over: Record<string, unknown> = {}) => ({ id: `el-${fileId}`, type: 'image', fileId, ...over })

/** The scene the renderer sends: the engine's writer, `files: {}` always. */
const sent = (elements: unknown[]) => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`
/** A board on disk, block first. */
const board = (block: Record<string, unknown> | null, elements: unknown[], files: Record<string, unknown> = {}) =>
  `${JSON.stringify({ ...(block === null ? {} : { [BOARD_META_KEY]: block }), type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files }, null, 2)}\n`
const OUT = { createdAt: 1, updatedAt: 2, pictures: 'assets' }

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pictures-inside-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

async function seed(rel: string, body: string): Promise<string> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return file
}
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
const assets = async () => (await readdir(path.join(root, 'assets')).catch(() => [] as string[])).sort()

describe('YAZ-3943 D5 — a save keeps the pictures inside the board', () => {
  it('a new picture goes inside, engine-shaped; nothing lands in assets/', async () => {
    const file = await seed('Board.excalidraw', board(null, []))
    const before = Date.now()
    const res = await saveDrawing({ root, path: 'Board.excalidraw', json: sent([imageEl('aaa')]), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    expect(res.persisted).toEqual(['aaa'])
    expect(res.movedOut).toBeUndefined()
    const { files } = await read(file)
    expect(files).toEqual({ aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: expect.any(Number) } })
    expect(files.aaa.created).toBeGreaterThanOrEqual(before)
    expect(await assets()).toEqual([])
  })

  it('a later save of the small scene keeps the pictures — `created` and all, so only `updatedAt` moves', async () => {
    const file = await seed('Board.excalidraw', board({ createdAt: 1, updatedAt: 2 }, [imageEl('aaa')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 7 } }))
    const res = await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), newFiles: [] })
    expect(res.persisted).toEqual(['aaa'])
    const after = await read(file)
    expect(after.files).toEqual({ aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 7 } })
    expect(after[BOARD_META_KEY].createdAt).toBe(1)
  })

  it('a deleted picture leaves the file (a deleted element, or one gone), and its assets/ copy stays', async () => {
    await seed('assets/ccc.png', 'C')
    const file = await seed('Board.excalidraw', board(null, [imageEl('aaa'), imageEl('bbb')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 1 }, bbb: { mimeType: 'image/png', id: 'bbb', dataURL: png('B'), created: 1 } }))
    await saveDrawing({ root, path: file, json: sent([imageEl('aaa', { isDeleted: true })]), newFiles: [] })
    expect((await read(file)).files).toEqual({})
    expect(await assets()).toEqual(['ccc.png'])
  })

  it('an OLD board (`files: {}`, its pictures in assets/) takes them inside on its next save; the assets/ copies stay', async () => {
    await seed('assets/aaa.png', 'A')
    const file = await seed('Old.excalidraw', board(null, [imageEl('aaa')]))
    const loaded = await loadDrawing({ root, path: file })
    expect(loaded.stored).toEqual(['aaa'])
    await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), expectedMtime: loaded.mtime, newFiles: [] })
    expect((await read(file)).files.aaa).toMatchObject({ mimeType: 'image/png', id: 'aaa', dataURL: png('A') })
    expect(await assets()).toEqual(['aaa.png'])
  })

  it('a picture found nowhere saves without it, as before: the placeholder', async () => {
    const file = await seed('Board.excalidraw', board(null, []))
    await saveDrawing({ root, path: file, json: sent([imageEl('gone')]), newFiles: [] })
    expect((await read(file)).files).toEqual({})
  })

  it('a load calls every picture of an "inside" board stored, so the renderer never ships one back', async () => {
    const file = await seed('Board.excalidraw', board(null, [imageEl('aaa')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 1 } }))
    const res = await loadDrawing({ root, path: file })
    expect(res.files.aaa).toEqual({ mimeType: 'image/png', dataURL: png('A') })
    expect(res.stored).toEqual(['aaa'])
    expect(JSON.parse(res.json).files).toEqual({}) // the bytes cross once, in `files`
  })

  it('a "pictures out" save writes `files: {}` and lands the pictures, as 🔒 YAZ-1775 D3 did', async () => {
    const file = await seed('Board.excalidraw', board(OUT, []))
    const res = await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    expect(res.persisted).toEqual(['aaa'])
    const after = await read(file)
    expect(after.files).toEqual({})
    expect(after[BOARD_META_KEY]).toMatchObject({ createdAt: 1, pictures: 'assets' })
    expect(await assets()).toEqual(['aaa.png'])
  })

  it('the 50 MB rule: a save that would pass the line moves the pictures out, sets the flag and says so', async () => {
    const file = await seed('Board.excalidraw', board({ createdAt: 1, updatedAt: 2 }, [imageEl('small')], { small: { mimeType: 'image/png', id: 'small', dataURL: png('S'), created: 1 } }))
    const big = 'x'.repeat(5000)
    const res = await saveDrawing({ root, path: file, json: sent([imageEl('small'), imageEl('big')]), newFiles: [{ fileId: 'big', mimeType: 'image/png', dataURL: png(big) }] })
    expect(res.movedOut).toBe(true)
    expect(res.persisted).toEqual(['big', 'small'])
    const after = await read(file)
    expect(after.files).toEqual({})
    expect(after[BOARD_META_KEY]).toMatchObject({ createdAt: 1, pictures: 'assets' })
    expect(await assets()).toEqual(['big.png', 'small.png'])
    expect(await readFile(path.join(root, 'assets', 'big.png'), 'utf8')).toBe(big)
  })

  it('a refused save (CONFLICT) writes nothing', async () => {
    const body = board(null, [])
    const file = await seed('Board.excalidraw', body)
    const err = await failure(saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), expectedMtime: 1, newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] }))
    expect(err.code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(body)
  })
})

describe('YAZ-3943 D5 — board:set-pictures, the cog\'s "Move pictures out" / "Keep pictures inside"', () => {
  it('out lands the pictures and writes the lean file with the flag; inside takes them back and removes it — a round trip', async () => {
    const body = board({ createdAt: 1, updatedAt: 2 }, [imageEl('aaa')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 5 } })
    const file = await seed('Board.excalidraw', body)
    const out = await setBoardPictures({ root, path: file, out: true, expectedMtime: (await stat(file)).mtimeMs })
    expect(out.mtime).toBe((await stat(file)).mtimeMs)
    const lean = await read(file)
    expect(lean[BOARD_META_KEY]).toEqual({ createdAt: 1, updatedAt: 2, pictures: 'assets' })
    expect(lean.files).toEqual({})
    expect(await assets()).toEqual(['aaa.png'])

    await setBoardPictures({ root, path: file, out: false, expectedMtime: out.mtime })
    const back = await read(file)
    expect(back[BOARD_META_KEY]).toEqual({ createdAt: 1, updatedAt: 2 })
    expect(back.files.aaa).toMatchObject({ mimeType: 'image/png', id: 'aaa', dataURL: png('A') })
    expect(await assets()).toEqual(['aaa.png']) // nothing is deleted from assets/
  })

  it('the same state again writes nothing and answers the mtime unmoved', async () => {
    const file = await seed('Board.excalidraw', board(OUT, [imageEl('aaa')]))
    const mtime = (await stat(file)).mtimeMs
    expect((await setBoardPictures({ root, path: file, out: true, expectedMtime: mtime })).mtime).toBe(mtime)
  })

  it('is atomic: a CONFLICT and a store that cannot be written both leave the board byte-identical, with no tmp file', async () => {
    const body = board(null, [imageEl('aaa')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 5 } })
    const file = await seed('Board.excalidraw', body)
    const mtime = (await stat(file)).mtimeMs
    expect((await failure(setBoardPictures({ root, path: file, out: true, expectedMtime: mtime - 1 }))).code).toBe('CONFLICT')
    await writeFile(path.join(root, 'assets'), 'a file where the folder should be')
    await failure(setBoardPictures({ root, path: file, out: true, expectedMtime: mtime }))
    expect(await readFile(file, 'utf8')).toBe(body)
    expect((await readdir(root)).sort()).toEqual(['Board.excalidraw', 'assets'])
  })

  it('keep inside refuses a board that would pass the 50 MB line, and writes nothing', async () => {
    await seed('assets/big.png', 'x'.repeat(5000))
    const body = board(OUT, [imageEl('big')])
    const file = await seed('Board.excalidraw', body)
    const err = await failure(setBoardPictures({ root, path: file, out: false, expectedMtime: (await stat(file)).mtimeMs }))
    expect(err.code).toBe('TOO_LARGE')
    expect(err.message).toBe(TOO_BIG_INSIDE)
    expect(await readFile(file, 'utf8')).toBe(body)
  })

  it('refuses a malformed request', async () => {
    const file = await seed('Board.excalidraw', board(null, []))
    expect((await failure(setBoardPictures({ root, path: file, out: 'yes', expectedMtime: 1 } as never))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardPictures({ root, path: file, out: true } as never))).code).toBe('BAD_REQUEST')
    expect((await failure(setBoardPictures({ root, path: 'Board.drawio', out: true, expectedMtime: 1 }))).code).toBe('UNSUPPORTED_EXTENSION')
  })
})
