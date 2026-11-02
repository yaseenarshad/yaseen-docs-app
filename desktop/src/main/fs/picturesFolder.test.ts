import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY, isValidPicturesFolder, picturesFolderOf } from '@shared/drawingAssets'
import { FOLDER_NOT_CHOSEN, setBoardPictures } from './boardPictures'
import { loadDrawing, saveDrawing } from './drawing'
import { blockedPicturesFolder, landingFolder } from './picturesFolders'
import { shrinkVault } from './shrink'
import { failure } from './testFixture'

// The real rules; the spy lets one test count the calls (YAZ-4071 nit).
vi.mock('./picturesFolders', async (actual) => {
  const mod = await actual<typeof import('./picturesFolders')>()
  return { ...mod, landingFolder: vi.fn(mod.landingFolder) }
})

/**
 * A pictures folder for each board (YAZ-3943 demo round 3): a "pictures out" board may name its own folder
 * (`picturesFolder` in the `yaseendraw` block), vault-relative or absolute outside the vault. A read looks in
 * the folder first, then in `assets/`; a write lands in the folder — but an OUTSIDE folder only once the user
 * picked it (the approved list), else in `assets/`. A move copies; no picture file is ever deleted.
 */

const b64 = (text: string) => Buffer.from(text).toString('base64')
const png = (text: string) => `data:image/png;base64,${b64(text)}`
const imageEl = (fileId: string) => ({ id: `el-${fileId}`, type: 'image', fileId })
const sent = (elements: unknown[]) => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`
const board = (block: Record<string, unknown> | null, elements: unknown[], files: Record<string, unknown> = {}) =>
  `${JSON.stringify({ ...(block === null ? {} : { [BOARD_META_KEY]: block }), type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files }, null, 2)}\n`
const out = (folder?: string) => ({ createdAt: 1, updatedAt: 2, pictures: 'assets', ...(folder === undefined ? {} : { picturesFolder: folder }) })

let root: string
/** A folder OUTSIDE the vault, absolute: a temp folder, which is never a blocked one. */
let outside: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pictures-folder-'))
  outside = await mkdtemp(path.join(tmpdir(), 'pictures-outside-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function seed(rel: string, body: string, base = root): Promise<string> {
  const file = path.join(base, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return file
}
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
const list = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort()
const mtimeOf = async (file: string) => (await stat(file)).mtimeMs

describe('drawing:load — the board\'s folder first, then assets/', () => {
  it('a picture in both is read from the folder; one only in assets/ (stored before the switch) still shows; the folder may be outside the vault', async () => {
    await seed('Board pictures/aaa.png', 'from the folder')
    await seed('assets/aaa.png', 'from assets')
    await seed('assets/bbb.png', 'only in assets')
    const file = await seed('Board.excalidraw', board(out('Board pictures'), [imageEl('aaa'), imageEl('bbb'), imageEl('gone')]))
    const loaded = await loadDrawing({ root, path: file })
    expect(loaded.files).toEqual({ aaa: { mimeType: 'image/png', dataURL: png('from the folder') }, bbb: { mimeType: 'image/png', dataURL: png('only in assets') } })
    expect(loaded.stored).toEqual(['aaa', 'bbb'])

    // Reads are not limited to approved folders: a block may name any folder to read from.
    await seed('ccc.png', 'outside', outside)
    const far = await seed('Far.excalidraw', board(out(outside), [imageEl('ccc')]))
    expect((await loadDrawing({ root, path: far })).files).toEqual({ ccc: { mimeType: 'image/png', dataURL: png('outside') } })
  })

  it('a block whose folder is not valid (a dot folder, `..`) reads as no folder: assets/ only', async () => {
    await seed('.git/aaa.png', 'hidden')
    await seed('assets/aaa.png', 'assets')
    const file = await seed('Board.excalidraw', board(out('.git'), [imageEl('aaa')]))
    expect((await loadDrawing({ root, path: file })).files.aaa?.dataURL).toBe(png('assets'))
  })
})

describe('drawing:save — new pictures land in the board\'s folder', () => {
  it('a folder in the vault is made on the way; assets/ gets nothing', async () => {
    const file = await seed('Board.excalidraw', board(out('Projects/Alpha/pictures'), []))
    const res = await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    expect(res.persisted).toEqual(['aaa'])
    expect(await list(path.join(root, 'Projects/Alpha/pictures'))).toEqual(['aaa.png'])
    expect(await list(path.join(root, 'assets'))).toEqual([])
    expect((await read(file)).files).toEqual({})
  })

  it('an outside folder the user never picked gets nothing: the picture lands in assets/, and the next open still finds it', async () => {
    const file = await seed('Board.excalidraw', board(out(outside), []))
    await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    expect(await list(outside)).toEqual([])
    expect(await list(path.join(root, 'assets'))).toEqual(['aaa.png'])
    expect((await loadDrawing({ root, path: file })).files.aaa?.dataURL).toBe(png('A'))

    // Once picked (on the approved list), the same board's next picture lands there.
    await saveDrawing({ root, path: file, json: sent([imageEl('aaa'), imageEl('bbb')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'bbb', mimeType: 'image/png', dataURL: png('B') }] }, [outside])
    expect(await list(outside)).toEqual(['bbb.png'])
  })

  it('YAZ-4071 7G: a save with a new picture still saves while the approved outside folder is on a drive that is not plugged in: the picture lands in assets/', async () => {
    const gone = `/Volumes/yaz-4071-unplugged-${process.pid}/pics`
    const file = await seed('Board.excalidraw', board(out(gone), []))
    const res = await saveDrawing({ root, path: file, json: sent([imageEl('bbb')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'bbb', mimeType: 'image/png', dataURL: png('B') }] }, [gone])
    expect(res.persisted).toEqual(['bbb'])
    expect(await list(path.join(root, 'assets'))).toEqual(['bbb.png'])
    expect((await loadDrawing({ root, path: file })).files.bbb?.dataURL).toBe(png('B'))
  })

  it('YAZ-4071 nit: an autosave with no new picture asks no `realpath` (`landingFolder` is not called); one with a new picture does', async () => {
    const file = await seed('Board.excalidraw', board(out(outside), []))
    vi.mocked(landingFolder).mockClear()
    await saveDrawing({ root, path: file, json: sent([]), expectedMtime: await mtimeOf(file), newFiles: [] }, [outside])
    expect(landingFolder).not.toHaveBeenCalled()
    await saveDrawing({ root, path: file, json: sent([imageEl('aaa')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] }, [outside])
    expect(landingFolder).toHaveBeenCalledTimes(1)
    expect(await list(outside)).toEqual(['aaa.png'])
  })

  it('YAZ-4071 7G: an approved outside folder that was deleted is not made again: the picture lands in assets/', async () => {
    const deleted = path.join(outside, 'deleted')
    const file = await seed('Board.excalidraw', board(out(deleted), []))
    await saveDrawing({ root, path: file, json: sent([imageEl('bbb')]), expectedMtime: await mtimeOf(file), newFiles: [{ fileId: 'bbb', mimeType: 'image/png', dataURL: png('B') }] }, [deleted])
    expect(await list(outside)).toEqual([])
    expect(await list(path.join(root, 'assets'))).toEqual(['bbb.png'])
  })
})

describe('board:set-pictures — a move copies, never deletes', () => {
  it('into a folder: every picture the board uses is copied there, from the file and from assets/; the block names the folder; nothing is deleted', async () => {
    await seed('assets/bbb.png', 'B')
    const file = await seed('Board.excalidraw', board({ createdAt: 1, updatedAt: 2 }, [imageEl('aaa'), imageEl('bbb')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 5 } }))
    const moved = await setBoardPictures({ root, path: file, out: true, folder: 'Board pictures', expectedMtime: await mtimeOf(file) })
    const after = await read(file)
    expect(after[BOARD_META_KEY]).toEqual({ createdAt: 1, updatedAt: 2, pictures: 'assets', picturesFolder: 'Board pictures', switched: { pictures: expect.any(Number) } })
    expect(after.files).toEqual({})
    expect(await list(path.join(root, 'Board pictures'))).toEqual(['aaa.png', 'bbb.png'])
    expect(await list(path.join(root, 'assets'))).toEqual(['bbb.png'])

    // A switch to another folder copies again; the old copies stay. "Move to the assets folder" clears the key.
    const again = await setBoardPictures({ root, path: file, out: true, folder: 'Other', expectedMtime: moved.mtime })
    expect(await list(path.join(root, 'Other'))).toEqual(['aaa.png', 'bbb.png'])
    expect(await list(path.join(root, 'Board pictures'))).toEqual(['aaa.png', 'bbb.png'])
    const toAssets = await setBoardPictures({ root, path: file, out: true, expectedMtime: again.mtime })
    expect((await read(file))[BOARD_META_KEY]).not.toHaveProperty('picturesFolder')
    expect(await list(path.join(root, 'assets'))).toEqual(['aaa.png', 'bbb.png'])

    // "Keep pictures inside" from a folder board reads them from the folder, and keeps every copy.
    await writeFile(file, board(out('Other'), [imageEl('aaa')]))
    await setBoardPictures({ root, path: file, out: false, expectedMtime: await mtimeOf(file) })
    expect((await read(file)).files.aaa).toMatchObject({ id: 'aaa', dataURL: png('A') })
    expect((await read(file))[BOARD_META_KEY]).not.toHaveProperty('picturesFolder')
    expect(await list(path.join(root, 'Other'))).toEqual(['aaa.png', 'bbb.png'])
    expect(toAssets.mtime).toBeGreaterThan(0)
  })

  it('refuses an outside folder that is not approved, and a folder that is not valid, writing nothing; an approved outside folder takes the pictures', async () => {
    const body = board(null, [imageEl('aaa')], { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: png('A'), created: 5 } })
    const file = await seed('Board.excalidraw', body)
    const mtime = await mtimeOf(file)
    const refused = await failure(setBoardPictures({ root, path: file, out: true, folder: outside, expectedMtime: mtime }))
    expect(refused).toMatchObject({ code: 'BAD_REQUEST', message: FOLDER_NOT_CHOSEN })
    for (const folder of ['../elsewhere', '.git', 'a/node_modules', '', 7]) {
      expect((await failure(setBoardPictures({ root, path: file, out: true, folder, expectedMtime: mtime } as never))).code).toBe('BAD_REQUEST')
    }
    expect(await readFile(file, 'utf8')).toBe(body)
    expect(await list(outside)).toEqual([])

    await setBoardPictures({ root, path: file, out: true, folder: outside, expectedMtime: mtime }, [outside])
    expect(await list(outside)).toEqual(['aaa.png'])
    expect((await read(file))[BOARD_META_KEY].picturesFolder).toBe(outside)
  })
})

describe('Settings › Storage › "Move pictures out" (shrink) and a board\'s folder', () => {
  it('a board naming a vault folder lands its pictures there and keeps the folder; an unapproved outside folder lands them in assets/', async () => {
    const files = { aaa: { mimeType: 'image/png', dataURL: png('A') } }
    const inVault = await seed('In.excalidraw', board({ createdAt: 1, updatedAt: 1, picturesFolder: 'pics' }, [imageEl('aaa')], files))
    await seed('Far.excalidraw', board({ createdAt: 1, updatedAt: 1, picturesFolder: outside }, [imageEl('bbb')], { bbb: { mimeType: 'image/png', dataURL: png('B') } }))
    const result = await shrinkVault(root)
    expect(result.shrunk).toBe(2)
    expect(await list(path.join(root, 'pics'))).toEqual(['aaa.png'])
    expect((await read(inVault))[BOARD_META_KEY]).toMatchObject({ pictures: 'assets', picturesFolder: 'pics' })
    expect(await list(outside)).toEqual([])
    expect(await list(path.join(root, 'assets'))).toEqual(['bbb.png'])
  })

  it('an approved outside folder takes them', async () => {
    await seed('Far.excalidraw', board({ createdAt: 1, updatedAt: 1, picturesFolder: outside }, [imageEl('bbb')], { bbb: { mimeType: 'image/png', dataURL: png('B') } }))
    await shrinkVault(root, { approved: [outside] })
    expect(await list(outside)).toEqual(['bbb.png'])
    expect(await list(path.join(root, 'assets'))).toEqual([])
  })
})

describe('the folder rules', () => {
  it('isValidPicturesFolder: a vault-relative `/` path or an absolute one; never the root, a dot segment, `..`, an empty segment or node_modules', () => {
    for (const ok of ['pics', 'Projects/Alpha/pictures', 'Board pictures', '/Users/me/Pictures/Boards']) expect(isValidPicturesFolder(ok)).toBe(true)
    for (const bad of ['', '/', '.', '..', '../x', 'a/../b', 'a//b', 'a/', '.git', 'a/.hidden', 'node_modules', 'a/node_modules/b', '/Users/me/.ssh', ' ', 'a\0b', 7, null, undefined]) {
      expect(isValidPicturesFolder(bad)).toBe(false)
    }
  })

  it('blockedPicturesFolder: the temp folder is allowed (the demo vault lives there); `/`, the home folder, ~/Library and the system folders are refused, with everything under them', () => {
    const home = '/Users/me'
    const tmp = '/var/folders/xy/T'
    for (const ok of [`${tmp}/vault/pics`, `/private${tmp}/pics`, '/tmp/pics', `${home}/Documents/Pictures`, `${home}/Pictures`, '/Volumes/Disk/pics', `${home}/Libraryish`]) {
      expect(blockedPicturesFolder(ok, home, tmp)).toBe(false)
    }
    for (const no of ['/', home, `${home}/Library`, `${home}/Library/Caches/x`, '/System', '/System/Library', '/Library/Fonts', '/Applications/X', '/usr/local/pics', '/etc', '/private/var/db', '/var/log', '/opt/x', '/bin', '/sbin']) {
      expect(blockedPicturesFolder(no, home, tmp)).toBe(true)
    }
    // The real temp folder, with the Mac's own defaults.
    expect(blockedPicturesFolder(outside)).toBe(false)
  })

  it('YAZ-4074 6A item 15: `picturesFolder: "assets"` is the default, not a folder of its own: it reads as none, and a move to it writes none', async () => {
    expect(picturesFolderOf({ picturesFolder: 'assets' })).toBeNull()
    expect(picturesFolderOf({ picturesFolder: 'assets/boards' })).toBe('assets/boards')
    await seed('assets/aaa.png', 'A')
    const file = await seed('Board.excalidraw', board(out(), [imageEl('aaa')]))
    await setBoardPictures({ root, path: file, out: true, folder: 'assets', expectedMtime: (await stat(file)).mtimeMs })
    expect((await read(file))[BOARD_META_KEY].picturesFolder).toBeUndefined()
    expect(isValidPicturesFolder('assets')).toBe(true)
  })

  it('landingFolder: a vault folder and an approved outside folder as they are; an unapproved outside folder is null (assets/)', async () => {
    expect(await landingFolder(root, null, [])).toBeNull()
    expect(await landingFolder(root, 'pics', [])).toBe('pics')
    expect(await landingFolder(root, outside, [])).toBeNull()
    expect(await landingFolder(root, outside, [outside])).toBe(outside)
    // YAZ-4071 7G: an approved outside folder that is not there now (its drive is not plugged in, or it was deleted) is null.
    expect(await landingFolder(root, '/Users/me/pics', ['/Users/me/pics'])).toBeNull()
    expect(await landingFolder(root, '/Volumes/yaz-4071-unplugged/pics', ['/Volumes/yaz-4071-unplugged/pics'])).toBeNull()
  })

  it('YAZ-4074 6A item 4: landingFolder compares real places — a vault folder that is a symbolic link out of the vault is an outside folder', async () => {
    await symlink(outside, path.join(root, 'Linked'))
    expect(await landingFolder(root, 'Linked', [])).toBeNull()
    expect(await landingFolder(root, 'Linked/deeper', [])).toBeNull()
    expect(await landingFolder(root, 'Linked', [outside])).toBe('Linked')
    // A link inside the vault to a vault folder stays a vault folder.
    await mkdir(path.join(root, 'Real'))
    await symlink(path.join(root, 'Real'), path.join(root, 'Alias'))
    expect(await landingFolder(root, 'Alias', [])).toBe('Alias')
    // An approved folder and a link to it are one place; a link the block names lands only when its target is approved.
    const link = path.join(root, '..', `${path.basename(outside)}-link`)
    await symlink(outside, link)
    try {
      expect(await landingFolder(root, link, [outside])).toBe(link)
      expect(await landingFolder(root, link, [])).toBeNull()
    } finally {
      await rm(link)
    }
  })

  it('YAZ-4074 6A item 4: a save to a vault folder that links out of the vault writes nothing there until the folder is approved', async () => {
    await symlink(outside, path.join(root, 'Linked'))
    await seed('Board.excalidraw', board(out('Linked'), []))
    await saveDrawing({ root, path: 'Board.excalidraw', json: sent([imageEl('aaa')]), newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    expect(await readdir(outside)).toEqual([])
    expect(await readdir(path.join(root, 'assets'))).toEqual(['aaa.png'])
  })
})
