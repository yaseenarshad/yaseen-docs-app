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
