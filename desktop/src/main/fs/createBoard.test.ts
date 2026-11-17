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

  it('YAZ-3943 demo 2 and round 3: "New boards keep pictures" — "In the assets folder" is born pictures out; "In a folder you pick" names the folder (none chosen yet: assets); a diagram ignores it', async () => {
    const blockOf = async (name: string, pictures: 'inside' | 'assets' | 'folder', folder?: string) => {
      const file = path.join(root, name)
      await createBoard({ root, path: file }, pictures, folder)
      return parseBoardMetaBlock(await readFile(file, 'utf8')) as Record<string, unknown>
    }
    expect(await blockOf('Inside.excalidraw', 'inside', 'pics')).not.toHaveProperty('pictures')
    const assets = await blockOf('Assets.excalidraw', 'assets', 'pics')
    expect(assets).toMatchObject({ pictures: 'assets', switched: { pictures: assets.createdAt } })
    expect(assets).not.toHaveProperty('picturesFolder')
    expect(await blockOf('Folder.excalidraw', 'folder', 'Board pictures')).toMatchObject({ pictures: 'assets', picturesFolder: 'Board pictures' })
    expect(await blockOf('Outside.excalidraw', 'folder', '/Users/me/Pictures')).toMatchObject({ picturesFolder: '/Users/me/Pictures' })
    for (const unset of ['', '../x']) expect(await blockOf(`Unset${unset.length}.excalidraw`, 'folder', unset)).not.toHaveProperty('picturesFolder')
    // A new "pictures out" board opens as one: an empty canvas.
    expect((await loadDrawing({ root, path: path.join(root, 'Folder.excalidraw') })).files).toEqual({})
    await createBoard({ root, path: path.join(root, 'Flow.drawio') }, 'folder', 'pics')
    expect(await readFile(path.join(root, 'Flow.drawio'), 'utf8')).not.toContain('pics')
  })

  it('never writes over an existing file: ALREADY_EXISTS, and the old bytes stay', async () => {
    const file = path.join(root, 'Taken.excalidraw')
    await writeFile(file, 'mine')
    expect((await failure(createBoard({ root, path: file }))).code).toBe('ALREADY_EXISTS')
    expect(await readFile(file, 'utf8')).toBe('mine')
  })

  it('refuses a page, a path outside the vault and a missing parent, and leaves nothing behind', async () => {
    expect((await failure(createBoard({ root, path: path.join(root, 'Page.md') }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(createBoard({ root, path: path.join(path.dirname(root), 'Out.excalidraw') }))).code).toBe('BAD_REQUEST')
    expect((await failure(createBoard({ root, path: 'Rel.drawio' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(createBoard({ root, path: path.join(root, 'Gone', 'X.drawio') }))).code).toBe('NOT_FOUND')
    await mkdir(path.join(root, 'Kept'))
    expect((await readdir(root)).sort()).toEqual(['Kept'])
  })
})
