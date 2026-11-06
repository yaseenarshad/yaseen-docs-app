import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_FOLDER_ITEMS, VAULT_CONFIG_DIR, type FocusFolder } from '@shared/types'
import { foldersFile, getFocusFolders, setFocusFolders } from './focusFolders'
import { removePath, renamePath } from './focus'
import { _actAs, _resetMint } from './vaultIndex/mint'

/** The focus folders of a vault (YAZ-4460 F1, F2): two scopes, one file for each Mac, the repair of a rename. Real tmp vaults. */
const A = 'aaaaaaaaaaaa'
let base: string
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-focus-folders-'))
})
afterEach(async () => {
  _resetMint()
  await rm(base, { recursive: true, force: true })
})

async function makeVault(name: string): Promise<string> {
  const root = path.join(base, name)
  await mkdir(path.join(root, 'Projects'), { recursive: true })
  await writeFile(path.join(root, 'Projects', 'p.md'), '# p\n')
  const appData = path.join(base, `app-data-${A}`)
  await mkdir(appData, { recursive: true })
  await writeFile(path.join(appData, 'mac.json'), JSON.stringify({ id: A }))
  _actAs(root, appData)
  return root
}
const folder = (over: Partial<FocusFolder> = {}): FocusFolder => ({ id: 'f1', name: 'Client work', created: 1, at: 1, items: [{ vault: 'Notes', path: 'Projects/p.md' }, { vault: 'Work', path: 'Clients' }], ...over })

describe('focus folders in the vault (YAZ-4460)', () => {
  it('each scope reads and writes only its own file; items of other vaults and tombstones are kept as given; a bad entry is dropped', async () => {
    const root = await makeVault('Notes')
    expect(await getFocusFolders(root, 'workspace')).toEqual([])
    await setFocusFolders(root, 'workspace', [folder(), folder({ id: 'gone', deleted: true, at: Date.now() }), { id: 7 }])
    expect(await readdir(path.join(root, VAULT_CONFIG_DIR))).toEqual([foldersFile(A, 'workspace')])
    expect((await getFocusFolders(root, 'workspace')).map((f) => [f.id, f.items.length, f.deleted ?? false])).toEqual([['f1', 2, false], ['gone', 2, true]])
    expect(await getFocusFolders(root, 'vault')).toEqual([])
  })

  it('a rename and a delete in the vault repair its own items, with a new `at`; the other vaults\' items stay', async () => {
    const root = await makeVault('Notes')
    await setFocusFolders(root, 'workspace', [folder()])
    await renamePath([root], path.join(root, 'Projects'), path.join(root, 'Work 2'))
    const [moved] = await getFocusFolders(root, 'workspace')
    expect(moved.items).toEqual([{ vault: 'Notes', path: 'Work 2/p.md' }, { vault: 'Work', path: 'Clients' }])
    expect(moved.at).toBeGreaterThan(1)
    await removePath([root], path.join(root, 'Work 2', 'p.md'))
    expect((await getFocusFolders(root, 'workspace'))[0].items).toEqual([{ vault: 'Work', path: 'Clients' }])
  })

  it(`YAZ-4479: a folder keeps ${MAX_FOLDER_ITEMS} items at most, on a write and on a read`, async () => {
    const root = await makeVault('Notes')
    const items = Array.from({ length: MAX_FOLDER_ITEMS + 10 }, (_, i) => ({ vault: 'Notes', path: `n${i}.md` }))
    await setFocusFolders(root, 'vault', [folder({ items })])
    expect((await getFocusFolders(root, 'vault'))[0].items).toHaveLength(MAX_FOLDER_ITEMS)
  })

  it('YAZ-4470 2: the file records its vault\'s folder name; a vault renamed on disk heals its items on the next read, with a new `at`, and writes the file', async () => {
    const root = await makeVault('Notes')
    await setFocusFolders(root, 'workspace', [folder()])
    const file = path.join(root, VAULT_CONFIG_DIR, foldersFile(A, 'workspace'))
    expect(JSON.parse(await readFile(file, 'utf8')).self).toBe('Notes')
    // The folder is renamed in Finder: Notes → Notes 2. Its file still names the items by the old name.
    const renamed = path.join(base, 'Notes 2')
    await rename(root, renamed)
    _actAs(renamed, path.join(base, `app-data-${A}`))
    const [healed] = await getFocusFolders(renamed, 'workspace')
    expect(healed.items).toEqual([{ vault: 'Notes 2', path: 'Projects/p.md' }, { vault: 'Work', path: 'Clients' }])
    expect(healed.at).toBeGreaterThan(1)
    const onDisk = JSON.parse(await readFile(path.join(renamed, VAULT_CONFIG_DIR, foldersFile(A, 'workspace')), 'utf8'))
    expect(onDisk.self).toBe('Notes 2')
    expect(onDisk.folders[0].items[0]).toEqual({ vault: 'Notes 2', path: 'Projects/p.md' })
    // A file from before YAZ-4470 has no name: it is read as it is, and gets one at its next write.
    expect(await getFocusFolders(renamed, 'vault')).toEqual([])
  })
})
