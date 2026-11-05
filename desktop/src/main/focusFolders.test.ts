import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR, type FocusFolder } from '@shared/types'
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
})
