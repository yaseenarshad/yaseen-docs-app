// A board's ID (YAZ-3943 4C): the vault's door gives it on the board's first save in a vault that gives IDs, the
// index reads it off the head, a move keeps it, and a copy made in the app leaves it behind.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { IDS_FILE, pageIdNumber } from '@shared/pageId'
import { copyEntry } from '../fs/copy'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { makeFirstMac, removeVault, sleep } from '../fs/testFixture'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { _evictAll, getIndex, indexBoard, indexMoved, onBoardIds } from './index'
import { doorOf } from './mint'

let root: string
let heard: string[]
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-board-ids-'))
  heard = []
  onBoardIds((r) => heard.push(r))
})
afterEach(async () => {
  onBoardIds(undefined)
  _evictAll()
  await removeVault(root)
})

const at = (...p: string[]) => path.join(root, ...p)
const read = (rel: string) => readFile(at(rel), 'utf8')
const blockOf = async (rel: string) => (JSON.parse(await read(rel)) as Record<string, Record<string, unknown>>)[BOARD_META_KEY]
const scene = (elements: unknown[] = []) => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`
/** A board as main writes it: the block first, holding `id`. */
const boardWith = (id: string) => `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 2, id }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`
async function seed(rel: string, body: string): Promise<void> {
  await mkdir(path.dirname(at(rel)), { recursive: true })
  await writeFile(at(rel), body)
}
/** A vault that gives IDs with the letters DEM, this Mac its first Mac. */
async function idVault(): Promise<void> {
  await writeConfig(root, IDS_FILE, { enabled: true, letters: 'DEM' })
  await makeFirstMac(root)
}
const until = async (pred: () => Promise<boolean>, ms = 5000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await sleep(25)
  }
}
/** The index built and its watcher listening. */
const opened = async (): Promise<void> => {
  const ready = new Promise<void>((resolve) => {
    const off = subscribe(root, (ev) => {
      if (ev.type !== 'ready') return
      queueMicrotask(() => off())
      resolve()
    })
  })
  await getIndex(root)
  await ready
}
const boards = async () => (await getIndex(root)).boards

describe('a board gets its ID on its first save', () => {
  it('in a vault that gives IDs: opening writes nothing, the first save gives the next number, the next save keeps it, and a page made after it takes the number after', async () => {
    await idVault()
    await seed('Boards/Plan.excalidraw', scene())
    const before = await read('Boards/Plan.excalidraw')
    await loadDrawing({ root, path: 'Boards/Plan.excalidraw' })
    expect(await read('Boards/Plan.excalidraw')).toBe(before)

    const first = await saveDrawing({ root, path: 'Boards/Plan.excalidraw', json: scene([{ id: 'a' }]), newFiles: [] })
    expect(first.id).toBe('DEM-1')
    expect(await blockOf('Boards/Plan.excalidraw')).toEqual({ createdAt: expect.any(Number), updatedAt: expect.any(Number), id: 'DEM-1' })
    const second = await saveDrawing({ root, path: 'Boards/Plan.excalidraw', json: scene([{ id: 'b' }]), newFiles: [] })
    expect(second.id).toBeUndefined()
    expect((await blockOf('Boards/Plan.excalidraw')).id).toBe('DEM-1')
    // One door for pages and boards: the numbers never meet (the index gave the folder its `.folder.md` meanwhile).
    const [next] = await (await doorOf(root))!.mint(1)
    expect(pageIdNumber(next)).toBeGreaterThan(1)
  })

  it("an ID of another vault, or another tool's, is written over; a save the guard refuses gives no number", async () => {
    await idVault()
    await seed('Copied.excalidraw', boardWith('OTH-4'))
    expect((await saveDrawing({ root, path: 'Copied.excalidraw', json: scene(), newFiles: [] })).id).toBe('DEM-1')
    expect((await blockOf('Copied.excalidraw')).id).toBe('DEM-1')
    await seed('Fresh.excalidraw', scene())
    await expect(saveDrawing({ root, path: 'Fresh.excalidraw', json: scene(), expectedMtime: 1, newFiles: [] })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await read('Fresh.excalidraw')).toBe(scene())
    expect((await saveDrawing({ root, path: 'Fresh.excalidraw', json: scene(), newFiles: [] })).id).toBe('DEM-2')
  })

  it('in a vault that has not said yes, or said no: no ID, and the block holds only its dates', async () => {
    await seed('Plan.excalidraw', scene())
    expect((await saveDrawing({ root, path: 'Plan.excalidraw', json: scene(), newFiles: [] })).id).toBeUndefined()
    await writeConfig(root, IDS_FILE, { enabled: false, letters: 'DEM' })
    expect((await saveDrawing({ root, path: 'Plan.excalidraw', json: scene(), newFiles: [] })).id).toBeUndefined()
    expect(Object.keys(await blockOf('Plan.excalidraw'))).toEqual(['createdAt', 'updatedAt'])
  })
})

describe('the index reads a board\'s ID off its head', () => {
  it('hands it out with the current letters; a rename in the app keeps it at the new path at once; the windows hear of each change', async () => {
    await idVault()
    await seed('Boards/Plan.excalidraw', boardWith('dem-7'))
    await seed('Boards/No id.excalidraw', scene())
    await seed('Boards/Other vault.excalidraw', boardWith('OTH-3'))
    await seed('page.md', 'body\n')
    await opened()
    expect(await boards()).toEqual([{ path: at('Boards/Plan.excalidraw'), id: 'DEM-7' }])
    expect((await getIndex(root)).records.map((r) => r.path)).toEqual([at('page.md')])

    heard.length = 0
    await rename(at('Boards/Plan.excalidraw'), at('Boards/Renamed.excalidraw'))
    await indexMoved(at('Boards/Plan.excalidraw'), at('Boards/Renamed.excalidraw'), 'file')
    expect(await boards()).toEqual([{ path: at('Boards/Renamed.excalidraw'), id: 'DEM-7' }])
    expect(heard).toEqual([root])
    // A folder that moves takes its boards along.
    await rename(at('Boards'), at('Moved'))
    await indexMoved(at('Boards'), at('Moved'), 'dir')
    expect(await boards()).toEqual([{ path: at('Moved/Renamed.excalidraw'), id: 'DEM-7' }])
  })

  it('YAZ-4071 7I: the IDs a board held before a two-Mac merge (`formerIds`) go out with it, with the current letters', async () => {
    await idVault()
    await seed('Plan.excalidraw', `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 2, id: 'DEM-5', formerIds: ['dem-9', 'OTH-3'] }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`)
    await opened()
    expect(await boards()).toEqual([{ path: at('Plan.excalidraw'), id: 'DEM-5', was: ['DEM-9'] }])
    // A merge that lands later: the watcher reads the head again, and the windows hear of it.
    heard.length = 0
    await seed('Plan.excalidraw', `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 3, id: 'DEM-5', formerIds: ['DEM-12', 'DEM-9'] }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`)
    await until(async () => (await boards())?.[0]?.was?.length === 2)
    expect(await boards()).toEqual([{ path: at('Plan.excalidraw'), id: 'DEM-5', was: ['DEM-12', 'DEM-9'] }])
    expect(heard).toContain(root)
  })

  it('a board that arrives with an ID, takes one, or goes: the watcher reads its head, and the windows hear of it', async () => {
    await idVault()
    await opened()
    heard.length = 0
    await seed('Late.excalidraw', boardWith('DEM-9'))
    await until(async () => (await boards())?.length === 1)
    expect(await boards()).toEqual([{ path: at('Late.excalidraw'), id: 'DEM-9' }])
    expect(heard).toContain(root)
    heard.length = 0
    await rm(at('Late.excalidraw'))
    await until(async () => (await boards())?.length === 0)
    expect(heard).toContain(root)

    // A save that gave an ID tells the index before the watcher's echo (`ipc/board.ts`).
    await seed('Plan.excalidraw', scene())
    heard.length = 0
    indexBoard(at('Plan.excalidraw'), 'DEM-12')
    expect(await boards()).toEqual([{ path: at('Plan.excalidraw'), id: 'DEM-12' }])
    expect(heard).toEqual([root])
  })

  it('a vault that does not give IDs hands no board out', async () => {
    await seed('Plan.excalidraw', boardWith('DEM-7'))
    await opened()
    expect(await boards()).toBeUndefined()
  })
})

describe('YAZ-4129 6B3: a Finder copy of a board', () => {
  it('gets a new ID on its next save; opening writes nothing, and links to the ID still open the first board', async () => {
    await idVault()
    await seed('Boards/Plan.excalidraw', boardWith('DEM-7'))
    await opened()
    expect(await boards()).toEqual([{ path: at('Boards/Plan.excalidraw'), id: 'DEM-7' }])
    // Finder copies the bytes, the block and its ID included
    heard = []
    await copyFile(at('Boards/Plan.excalidraw'), at('Boards/Plan copy.excalidraw'))
    await until(async () => heard.length > 0)
    // one ID, one board: the first one keeps it, so `[[DEM-7]]` opens it
    expect(await boards()).toEqual([{ path: at('Boards/Plan.excalidraw'), id: 'DEM-7' }])
    const before = await read('Boards/Plan copy.excalidraw')
    await loadDrawing({ root, path: 'Boards/Plan copy.excalidraw' })
    expect(await read('Boards/Plan copy.excalidraw')).toBe(before)
    const copy = await saveDrawing({ root, path: 'Boards/Plan copy.excalidraw', json: scene(), newFiles: [] })
    expect(copy.id).toMatch(/^DEM-\d+$/)
    expect(copy.id).not.toBe('DEM-7')
    expect((await blockOf('Boards/Plan copy.excalidraw')).id).toBe(copy.id)
    // the save door tells the index at once (`ipc/board.ts`)
    indexBoard(copy.path, copy.id!)
    // the first board's own save keeps its ID
    expect((await saveDrawing({ root, path: 'Boards/Plan.excalidraw', json: scene(), newFiles: [] })).id).toBeUndefined()
    expect((await blockOf('Boards/Plan.excalidraw')).id).toBe('DEM-7')
    expect((await boards())?.map((b) => b.id).sort()).toEqual([copy.id, 'DEM-7'].sort())
  })

  it('the board with the oldest createdAt keeps the ID, wherever it is', async () => {
    await idVault()
    const born = (id: string, createdAt: number) => `${JSON.stringify({ [BOARD_META_KEY]: { createdAt, updatedAt: createdAt, id }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`
    await seed('A newer.excalidraw', born('DEM-3', 500))
    await seed('Z older.excalidraw', born('DEM-3', 100))
    await opened()
    expect(await boards()).toEqual([{ path: at('Z older.excalidraw'), id: 'DEM-3' }])
    expect((await saveDrawing({ root, path: 'Z older.excalidraw', json: scene(), newFiles: [] })).id).toBeUndefined()
    expect((await saveDrawing({ root, path: 'A newer.excalidraw', json: scene(), newFiles: [] })).id).toMatch(/^DEM-\d+$/)
  })
})

describe('a copy of a board made in the app', () => {
  it('leaves the ID behind (the original keeps it, so its links stay its own), alone and inside a copied folder; it takes its own on its first save', async () => {
    await idVault()
    await seed('Boards/Plan.excalidraw', boardWith('DEM-7').replace('"id": "DEM-7"', '"id": "DEM-7",\n    "formerIds": ["DEM-9"]'))
    const door = await doorOf(root)
    const alone = await copyEntry(at('Boards/Plan.excalidraw'), at('Boards'), door)
    expect(alone.to).toBe(at('Boards/Plan copy.excalidraw'))
    expect(await blockOf('Boards/Plan copy.excalidraw')).toEqual({ createdAt: 1, updatedAt: 2 })
    expect((await blockOf('Boards/Plan.excalidraw')).id).toBe('DEM-7')
    const folder = await copyEntry(at('Boards'), root, door)
    expect((await blockOf(`${path.basename(folder.to)}/Plan.excalidraw`)).id).toBeUndefined()
    expect((await saveDrawing({ root, path: 'Boards/Plan copy.excalidraw', json: scene(), newFiles: [] })).id).toMatch(/^DEM-\d+$/)
  })

  it('in a vault that does not give IDs: the same bytes', async () => {
    await seed('Plan.excalidraw', boardWith('DEM-7'))
    await copyEntry(at('Plan.excalidraw'), root, null)
    expect(await read('Plan copy.excalidraw')).toBe(boardWith('DEM-7'))
  })
})
