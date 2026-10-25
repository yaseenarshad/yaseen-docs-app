/**
 * The put-back of an undone delete (YAZ-3268 D16): an entry of the Trash goes back to its old place.
 * Plain node, temp folders: the home folder, and so `~/.Trash`, is a temp folder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => home.dir }
})

import { putBack } from './trash'
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
})
