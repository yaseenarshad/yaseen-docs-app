import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { getFilesOrder, removePath, renamePath, setFilesSort, setFolderOrder } from './filesOrder'
import { _actAs, _resetMint } from './vaultIndex/mint'

/**
 * The Files tab's Manual order (YAZ-5916 D1, Q3): one file for each Mac, `.yaseendocs/files-order.<mac id>.json`, the
 * newest valid one is the order; a rename keeps the item's place, a move puts it last in its new folder. Real tmp
 * vaults; a "Mac" is an app data folder with a known ID (focus.test's idiom).
 */
const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
let base: string
let root: string
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-order-'))
  root = path.join(base, 'vault')
  await mkdir(path.join(root, 'Projects'), { recursive: true })
})
afterEach(async () => {
  _resetMint()
  await rm(base, { recursive: true, force: true })
})
async function actAs(id: string): Promise<void> {
  const appData = path.join(base, `app-data-${id}`)
  await mkdir(appData, { recursive: true })
  await writeFile(path.join(appData, 'mac.json'), JSON.stringify({ id }))
  _actAs(root, appData)
}
const fileOf = async (id: string) => JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, `files-order.${id}.json`), 'utf8')) as Record<string, unknown>

describe('files-order.<mac id>.json', () => {
  it('a read creates nothing; a write is this Mac\'s file only, vault-relative, and the newest file is the order', async () => {
    await actAs(A)
    expect(await getFilesOrder(root)).toEqual({ sort: { by: 'name', reverse: false }, folders: {} })
    await expect(readdir(path.join(root, VAULT_CONFIG_DIR))).rejects.toThrow()
    await setFolderOrder(root, path.join(root, 'Projects'), ['b.md', 'a.md'])
    await setFolderOrder(root, root, ['Projects', 'top.md'])
    expect(await fileOf(A)).toEqual(expect.objectContaining({ version: 1, at: expect.any(String), folders: { Projects: ['b.md', 'a.md'], '': ['Projects', 'top.md'] } }))
    // Another Mac writes later: its file is the order, and Mac A's file stays as it was.
    await actAs(B)
    await setFolderOrder(root, path.join(root, 'Projects'), ['a.md', 'b.md'])
    expect(await getFilesOrder(root)).toEqual({ sort: { by: 'manual', reverse: false }, folders: { [path.join(root, 'Projects')]: ['a.md', 'b.md'], [root]: ['Projects', 'top.md'] } })
    expect((await fileOf(A)).folders).toEqual({ Projects: ['b.md', 'a.md'], '': ['Projects', 'top.md'] })
    await expect(setFolderOrder(root, base, ['x'])).rejects.toThrow()
  })

  it('the Mac\'s Files sort is in the file for the phone (Q4), written at each change; the same value writes nothing', async () => {
    await actAs(A)
    await setFilesSort(root, { by: 'name', reverse: false })
    await expect(readdir(path.join(root, VAULT_CONFIG_DIR))).rejects.toThrow()
    await setFilesSort(root, { by: 'manual', reverse: false })
    expect((await getFilesOrder(root)).sort).toEqual({ by: 'manual', reverse: false })
    const first = await fileOf(A)
    expect(first).toEqual(expect.objectContaining({ sort: 'manual', reverse: false }))
    await setFilesSort(root, { by: 'manual', reverse: false })
    expect((await fileOf(A)).at).toBe(first.at)
    await setFilesSort(root, { by: 'updated', reverse: true })
    expect(await fileOf(A)).toEqual(expect.objectContaining({ sort: 'updated', reverse: true }))
    expect((await fileOf(A)).at).not.toBe(first.at)
  })

  it('a rename keeps the item\'s place; a move puts it last in its new folder; a folder\'s order follows it; a delete leaves', async () => {
    await actAs(A)
    await setFolderOrder(root, root, ['c.md', 'Projects', 'a.md'])
    await setFolderOrder(root, path.join(root, 'Projects'), ['x.md', 'y.md'])
    await renamePath([root], path.join(root, 'c.md'), path.join(root, 'see.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['see.md', 'Projects', 'a.md'], Projects: ['x.md', 'y.md'] })
    await renamePath([root], path.join(root, 'see.md'), path.join(root, 'Projects', 'see.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['Projects', 'a.md'], Projects: ['x.md', 'y.md', 'see.md'] })
    await renamePath([root], path.join(root, 'Projects'), path.join(root, 'Work'))
    expect((await fileOf(A)).folders).toEqual({ '': ['Work', 'a.md'], Work: ['x.md', 'y.md', 'see.md'] })
    await removePath([root], path.join(root, 'Work'))
    expect((await fileOf(A)).folders).toEqual({ '': ['a.md'] })
  })
})

/** Checker tests for PR #278 (YAZ-5916, YAZ-5917): the repairs that a ⌘ move, its undo and another Mac's file need. */
describe('checker: files-order repairs', () => {
  it('a move into another vault takes the item out of its old vault\'s order; a move into a folder with no order writes no list for that folder', async () => {
    await actAs(A)
    const other = path.join(base, 'other')
    await mkdir(other, { recursive: true })
    await setFolderOrder(root, root, ['c.md', 'Projects', 'a.md'])
    await renamePath([root, other], path.join(root, 'c.md'), path.join(other, 'c.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['Projects', 'a.md'] })
    await renamePath([root, other], path.join(root, 'a.md'), path.join(root, 'Projects', 'a.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['Projects'] })
  })

  it('a write on this Mac starts from the newest file of any Mac: the other Mac\'s folders stay, and the sort becomes Manual', async () => {
    await actAs(B)
    await setFolderOrder(root, path.join(root, 'Projects'), ['y.md', 'x.md'])
    await setFilesSort(root, { by: 'updated', reverse: true })
    await actAs(A)
    await setFolderOrder(root, root, ['Projects', 'top.md'])
    expect(await fileOf(A)).toEqual(expect.objectContaining({ sort: 'manual', reverse: false, folders: { Projects: ['y.md', 'x.md'], '': ['Projects', 'top.md'] } }))
    expect(Date.parse((await fileOf(A)).at as string)).toBeGreaterThan(Date.parse((await fileOf(B)).at as string))
  })

  // BUG YAZ-5935: a ⌘-drag into a folder is a move on disk, and its Undo is the move back (YAZ-5917). The move takes the
  // item out of its folder's order, and the move back puts it LAST: the Undo does not give the item its old place.
  it('a move into a folder and the move back (its Undo) give the item its old place (YAZ-5935)', async () => {
    await actAs(A)
    await setFolderOrder(root, root, ['c.md', 'Projects', 'a.md'])
    await renamePath([root], path.join(root, 'c.md'), path.join(root, 'Projects', 'c.md'))
    await renamePath([root], path.join(root, 'Projects', 'c.md'), path.join(root, 'c.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['c.md', 'Projects', 'a.md'] })
  })

  it('the move back takes the old place after a Redo too, after the name before it; a rename at the new place forgets the place (YAZ-5935)', async () => {
    await actAs(A)
    await setFolderOrder(root, root, ['a.md', 'c.md', 'Projects', 'z.md'])
    const top = path.join(root, 'c.md')
    const inside = path.join(root, 'Projects', 'c.md')
    // ⌘-drag, Undo, Redo, Undo.
    await renamePath([root], top, inside)
    await renamePath([root], inside, top)
    expect((await fileOf(A)).folders).toEqual({ '': ['a.md', 'c.md', 'Projects', 'z.md'] })
    await renamePath([root], top, inside)
    await renamePath([root], inside, top)
    expect((await fileOf(A)).folders).toEqual({ '': ['a.md', 'c.md', 'Projects', 'z.md'] })
    // The list changed while the item was away: it lands after the name that stood before it.
    await renamePath([root], top, inside)
    await setFolderOrder(root, root, ['Projects', 'z.md', 'a.md'])
    await renamePath([root], inside, top)
    expect((await fileOf(A)).folders).toEqual({ '': ['Projects', 'z.md', 'a.md', 'c.md'] })
    await setFolderOrder(root, root, ['c.md', 'Projects', 'z.md', 'a.md'])
    // A rename in the new folder forgets the place: that move out is a plain move, last.
    await renamePath([root], top, inside)
    await renamePath([root], inside, path.join(root, 'Projects', 'see.md'))
    await renamePath([root], path.join(root, 'Projects', 'see.md'), path.join(root, 'see.md'))
    expect((await fileOf(A)).folders).toEqual({ '': ['Projects', 'z.md', 'a.md', 'see.md'] })
  })
})

