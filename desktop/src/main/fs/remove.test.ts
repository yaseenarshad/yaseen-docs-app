/**
 * In-app delete (GRO-2272 `A1-`, GRO-2277). The load-bearing test in this file is
 * "a trashItem failure leaves the file ON DISK": the LOCKED ruling is `shell.trashItem`
 * only, never `fs.rm`, and no permanent-delete fallback — a failed trash must refuse
 * loudly rather than destroy the file the user asked to be able to recover.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shell } from 'electron'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))
// The home folder, and so `~/.Trash`, is a temp folder (YAZ-3268): no test reads or fills the real Trash.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => home.dir }
})

import { removeEntry } from './remove'
import { trashFolderOf } from './trash'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  home.dir = await mkdtemp(path.join(tmpdir(), 'yd-home-'))
  await mkdir(path.join(home.dir, '.Trash'))
})
afterAll(async () => {
  await cleanup()
  await rm(home.dir, { recursive: true, force: true })
})

const trashItem = vi.mocked(shell.trashItem)
/** The real thing moves the entry away; the mock must too, or "is it gone?" proves nothing. */
const trashResolves = () => trashItem.mockImplementation(async () => undefined)

// Block body, NOT `() => trashItem.mockReset()`: mockReset returns the mock itself, and
// vitest treats a value returned from a hook as a TEARDOWN callback — so the concise form
// calls the (throwing) mock after every test and fails it with a rejection the test body
// already handled correctly.
beforeEach(() => {
  trashItem.mockReset()
})

const exists = async (p: string) => stat(p).then(() => true, () => false)

describe('removeEntry (GRO-2272 A1)', () => {
  it('moves a markdown file to the Trash and reports kind file', async () => {
    trashResolves()
    const p = path.join(root, 'b.md')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: null })
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('moves a non-vault file to the Trash — no extension gate beyond what the tree shows', async () => {
    trashResolves()
    const p = path.join(root, 'notes.txt')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: null })
  })

  it('moves a FOLDER to the Trash and reports kind dir', async () => {
    trashResolves()
    const p = path.join(root, 'Zeta')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'dir', trashed: null })
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('a trashItem failure is IO_ERROR and LEAVES THE FILE ON DISK (no fs.rm fallback, ever)', async () => {
    // Lazy throw, not mockRejectedValue: the latter builds the rejected promise at SETUP
    // time, which vitest reports as an unhandled rejection before the call ever happens.
    trashItem.mockImplementation(async () => {
      throw new Error('no Trash on this volume')
    })
    const p = path.join(root, 'A.md')
    const err = await failure(removeEntry({ path: p }))
    expect(err.code).toBe('IO_ERROR')
    expect(err.path).toBe(p)
    // The whole point: a failed trash must never escalate to destroying the file.
    expect(await exists(p)).toBe(true)
  })

  it('NOT_FOUND for a missing path, and nothing is trashed', async () => {
    trashResolves()
    expect((await failure(removeEntry({ path: path.join(root, 'nope.md') }))).code).toBe('NOT_FOUND')
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('refuses everything the tree hides — dot-entries AND node_modules — never deletable from a UI that never showed them', async () => {
    trashResolves()
    for (const p of [path.join(root, '.obsidian'), path.join(root, '.yaseendocs'), path.join(root, '.hidden.md'), path.join(root, 'node_modules')]) {
      const err = await failure(removeEntry({ path: p }))
      expect(err.code).toBe('BAD_REQUEST')
      expect(await exists(p)).toBe(true)
    }
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('deletes a folder whose contents are not vault files — the tree shows every folder, so every folder is deletable', async () => {
    trashResolves()
    const p = path.join(root, 'assets-only')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'dir', trashed: null })
  })

  it('rejects a missing or relative path argument before touching the disk', async () => {
    trashResolves()
    expect((await failure(removeEntry({}))).code).toBe('BAD_REQUEST')
    expect((await failure(removeEntry({ path: 'relative/x.md' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(removeEntry(null))).code).toBe('BAD_REQUEST')
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('surfaces a permission error as FORBIDDEN through the shared fsCall mapping', async () => {
    trashItem.mockImplementation(async () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    const p = path.join(root, 'Empty')
    expect((await failure(removeEntry({ path: p }))).code).toBe('FORBIDDEN')
  })

  it('deletes a nested file inside a folder without touching the folder', async () => {
    trashResolves()
    await mkdir(path.join(root, 'Nest'), { recursive: true })
    await writeFile(path.join(root, 'Nest', 'n.md'), 'n')
    const p = path.join(root, 'Nest', 'n.md')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: null })
    expect(await exists(path.join(root, 'Nest'))).toBe(true)
  })
})

/**
 * Where the item went (YAZ-3268 D16): main notes its `ino` and `dev` before `shell.trashItem`, then
 * finds the entry with both in the Trash of its disk. The mock MOVES the item into the temp Trash,
 * as the real one does, under its own name or under a new one.
 */
describe('removeEntry finds the trashed entry by its file ID (YAZ-3268 D16)', () => {
  const trash = () => path.join(home.dir, '.Trash')
  const trashAs = (name: (p: string) => string) => trashItem.mockImplementation(async (p: string) => rename(p, path.join(trash(), name(p))))
  /** The name macOS gives a clash (the guided test on YAZ-3268): `Twin.md 01-30-05-828.md`, the local time of the move. */
  const clash = (p: string) => {
    const d = new Date()
    const two = (n: number) => String(n).padStart(2, '0')
    const ext = path.extname(p)
    return `${path.basename(p)} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}${ext}`
  }
  let given = ''
  const trashAsClash = () => trashAs((from) => (given = clash(from)))

  it('under its own name: `trashed` is the entry in `~/.Trash`', async () => {
    const p = path.join(root, 'Gone.md')
    await writeFile(p, 'gone')
    trashAs((from) => path.basename(from))
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: path.join(trash(), 'Gone.md') })
  })

  it('under a new name (the Trash held one of that name): found by `ino`, never by name — the old entry of that name is not it', async () => {
    await writeFile(path.join(trash(), 'Twin.md'), 'an older delete')
    const p = path.join(root, 'Twin.md')
    await writeFile(p, 'twin')
    trashAsClash()
    expect((await removeEntry({ path: p })).trashed).toBe(path.join(trash(), given))
  })

  it('a folder is found the same way', async () => {
    await mkdir(path.join(trash(), 'GoneDir'), { recursive: true })
    const p = path.join(root, 'GoneDir')
    await mkdir(path.join(p, 'inner'), { recursive: true })
    trashAsClash()
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'dir', trashed: path.join(trash(), given) })
  })

  it('under a name of no shape it knows: `trashed` is null (no Undo), the Trash is never listed, and the delete stands (D16b, YAZ-3270)', async () => {
    const p = path.join(root, 'Odd.md')
    await writeFile(p, 'odd')
    trashAs(() => 'Odd 10.21.33.md')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: null })
    expect(await exists(path.join(trash(), 'Odd 10.21.33.md'))).toBe(true)
  })

  it('not in the Trash (another place took it): `trashed` is null, and the delete still stands (S61)', async () => {
    const p = path.join(root, 'Elsewhere.md')
    await writeFile(p, 'x')
    const away = await mkdtemp(path.join(tmpdir(), 'yd-away-'))
    trashItem.mockImplementation(async (from: string) => rename(from, path.join(away, 'Elsewhere.md')))
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file', trashed: null })
    expect(await exists(p)).toBe(false)
    await rm(away, { recursive: true, force: true })
  })

  it('the Trash of another disk is `<mount>/.Trashes/<uid>`: the mount is the last folder up with the same `dev`, whatever its depth', async () => {
    const devs: Record<string, number> = { '/': 1, '/Volumes': 1, '/Volumes/Stick': 7, '/Volumes/Stick/Work': 7, '/Volumes/Stick/Work/Deep': 7 }
    const fakeStat = async (p: string) => {
      if (devs[p] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { dev: devs[p] }
    }
    expect(await trashFolderOf('/Volumes/Stick/Work/Deep/Plan.md', 7, fakeStat)).toBe(path.join('/Volumes/Stick', '.Trashes', String(process.getuid!())))
    expect(await trashFolderOf('/Volumes/Stick/Plan.md', 7, fakeStat)).toBe(path.join('/Volumes/Stick', '.Trashes', String(process.getuid!())))
    // The disk of the home folder: `~/.Trash`, wherever on that disk the item was.
    expect(await trashFolderOf(path.join(root, 'A.md'), (await stat(root)).dev)).toBe(trash())
  })
})
