/**
 * The put-back of an undone delete (YAZ-3268 D16): an entry of the Trash goes back to its old place.
 * Plain node, temp folders: the home folder, and so `~/.Trash`, is a temp folder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => home.dir }
})
// `readdir` as a spy (YAZ-3270): the look for a trashed entry must never list the Trash.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, readdir: vi.fn(real.readdir) }
})

import { findTrashed, putBack } from './trash'
import { failure } from './testFixture'

let vault: string
let trash: string
beforeAll(async () => {
  home.dir = await mkdtemp(path.join(tmpdir(), 'yd-home-'))
  trash = path.join(home.dir, '.Trash')
  vault = path.join(home.dir, 'vault')
  await mkdir(trash)
  await mkdir(path.join(vault, 'Plans'), { recursive: true })
})
afterAll(() => rm(home.dir, { recursive: true, force: true }))

const exists = async (p: string) => stat(p).then(() => true, () => false)

describe('putBack (YAZ-3268 D16)', () => {
  it('moves the entry from the Trash back to its old place, also under a name the Trash gave it (S58)', async () => {
    const trashed = path.join(trash, 'Plan 10.21.33.md')
    await writeFile(trashed, 'the plan')
    const to = path.join(vault, 'Plans', 'Plan.md')
    expect(await putBack({ trashed, path: to })).toEqual({ path: to, kind: 'file' })
    expect(await readFile(to, 'utf8')).toBe('the plan')
    expect(await exists(trashed)).toBe(false)
  })

  it('a folder goes back with what is inside it', async () => {
    const trashed = path.join(trash, 'Notes')
    await mkdir(path.join(trashed, 'inner'), { recursive: true })
    await writeFile(path.join(trashed, 'inner', 'n.md'), 'n')
    const to = path.join(vault, 'Notes')
    expect(await putBack({ trashed, path: to })).toEqual({ path: to, kind: 'dir' })
    expect(await readFile(path.join(to, 'inner', 'n.md'), 'utf8')).toBe('n')
  })

  it('never overwrites: a new file with the old name fails ALREADY_EXISTS, and both stay as they are (S60)', async () => {
    const trashed = path.join(trash, 'Taken.md')
    await writeFile(trashed, 'old')
    const to = path.join(vault, 'Taken.md')
    await writeFile(to, 'new')
    expect((await failure(putBack({ trashed, path: to }))).code).toBe('ALREADY_EXISTS')
    expect(await readFile(to, 'utf8')).toBe('new')
    expect(await readFile(trashed, 'utf8')).toBe('old')
  })

  it('an entry no longer in the Trash fails NOT_FOUND on the Trash path (S59)', async () => {
    const trashed = path.join(trash, 'Emptied.md')
    const err = await failure(putBack({ trashed, path: path.join(vault, 'Emptied.md') }))
    expect([err.code, err.path]).toEqual(['NOT_FOUND', trashed])
  })

  it('the old folder must still be there, as `fs:rename` asks: NOT_FOUND on that folder, and the entry stays in the Trash', async () => {
    const trashed = path.join(trash, 'Orphan.md')
    await writeFile(trashed, 'o')
    const err = await failure(putBack({ trashed, path: path.join(vault, 'Gone', 'Orphan.md') }))
    expect([err.code, err.path]).toEqual(['NOT_FOUND', path.join(vault, 'Gone')])
    expect(await exists(trashed)).toBe(true)
  })

  it('moves only an entry directly in a Trash: any other path is BAD_REQUEST, and nothing moves', async () => {
    const outside = path.join(vault, 'Plans', 'Keep.md')
    await writeFile(outside, 'k')
    for (const trashed of [outside, path.join(trash, 'sub', 'x.md'), 'relative.md']) {
      const err = await failure(putBack({ trashed, path: path.join(vault, 'Moved.md') }))
      expect(['BAD_REQUEST', 'NOT_ABSOLUTE']).toContain(err.code)
    }
    expect(await exists(outside)).toBe(true)
    expect(await exists(path.join(vault, 'Moved.md'))).toBe(false)
  })

  it('never overwrites a broken link with the old name: ALREADY_EXISTS, and the link and the entry stay (YAZ-3271, S60)', async () => {
    const trashed = path.join(trash, 'L.md')
    await writeFile(trashed, 'the deleted note')
    const to = path.join(vault, 'L.md')
    await symlink(path.join(vault, 'nowhere.md'), to)
    const err = await failure(putBack({ trashed, path: to }))
    expect([err.code, err.path]).toEqual(['ALREADY_EXISTS', to])
    expect((await lstat(to)).isSymbolicLink()).toBe(true)
    expect(await readFile(trashed, 'utf8')).toBe('the deleted note')
  })

  it('moves only an entry of the Trash of the old place\'s disk: a `.Trashes/<uid>` folder anywhere else is BAD_REQUEST, and nothing moves (YAZ-3268 nit 1)', async () => {
    const fake = path.join(home.dir, 'other', '.Trashes', String(process.getuid?.() ?? 0))
    await mkdir(fake, { recursive: true })
    const trashed = path.join(fake, 'secret.md')
    await writeFile(trashed, 's')
    const to = path.join(vault, 'secret.md')
    expect((await failure(putBack({ trashed, path: to }))).code).toBe('BAD_REQUEST')
    expect(await exists(trashed)).toBe(true)
    expect(await exists(to)).toBe(false)
  })
})

describe('findTrashed never lists the Trash (YAZ-3270, D16b)', () => {
  it('a big Trash: the own name and the clash names miss, so the answer is null, with no `readdir` and no look at each entry', async () => {
    const big = path.join(home.dir, 'BigTrash')
    await mkdir(big)
    await Promise.all(Array.from({ length: 2_000 }, (_, i) => writeFile(path.join(big, `n${i}.md`), '')))
    // The entry of this delete, under a name that is neither its own nor a clash name of this time.
    const odd = path.join(big, 'Plan 10.21.33.md')
    await writeFile(odd, 'this delete')
    const { ino, dev } = await stat(odd)
    vi.mocked(readdir).mockClear()
    const t = Date.now()
    expect(await findTrashed(big, 'Plan.md', ino, dev, t + 20, t)).toBeNull()
    expect(readdir).not.toHaveBeenCalled()
  })
})

describe('findTrashed when the Trash renamed the entry and cannot be listed (YAZ-3268 D16, guided test)', () => {
  /** The Trash as macOS keeps it without Full Disk Access: an entry is reached by its exact name, the folder cannot be listed. */
  const unlistable = async <T>(run: () => Promise<T>): Promise<T> => {
    await chmod(trash, 0o333)
    try {
      return await run()
    } finally {
      await chmod(trash, 0o755)
    }
  }
  /** "Plan.md 01-30-05-828.md": the name, a space, the local time to the millisecond, the extension (seen on Yasin's Mac). */
  const stamp = (t: number) => {
    const d = new Date(t)
    const two = (n: number) => String(n).padStart(2, '0')
    return `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`
  }

  it('finds it by the name the Trash gives a clash, and confirms it by its file ID, with no listing of the Trash', async () => {
    const t = Date.now()
    await writeFile(path.join(trash, 'Plan.md'), 'an older Plan')
    const renamed = path.join(trash, `Plan.md ${stamp(t + 37)}.md`)
    await writeFile(renamed, 'this delete')
    const { ino, dev } = await stat(renamed)
    expect(await unlistable(() => findTrashed(trash, 'Plan.md', ino, dev, t + 120, t))).toBe(renamed)
  })

  it('a name of that shape with another file ID is not it: null, and no Undo is offered (S61)', async () => {
    const t = Date.now()
    await writeFile(path.join(trash, `Todo.md ${stamp(t + 5)}.md`), 'someone else')
    expect(await unlistable(() => findTrashed(trash, 'Todo.md', 1, 1, t + 50, t))).toBeNull()
  })
})
