import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { NEW_PLACES_FILE } from '@shared/newPlaces'
import { failure } from './fs/testFixture'
import { getNewPlaces, setNewPlaces } from './newPlaces'

/** The New… box's place shortcuts in the vault (YAZ-4252 D3): real tmp vaults, as favorites.test. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-new-places-'))
  roots.push(root)
  await mkdir(path.join(root, 'Notes', 'Daily'), { recursive: true })
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, NEW_PLACES_FILE)

describe('new-places.json (YAZ-4252 D3)', () => {
  it('reads three empty places with no file, and creates none', async () => {
    const root = await makeVault()
    expect(await getNewPlaces(root)).toEqual([null, null, null])
    await expect(readFile(file(root), 'utf8')).rejects.toThrow()
  })

  it('saves vault-relative paths ("" for the vault) and reads them back absolute', async () => {
    const root = await makeVault()
    await setNewPlaces(root, [path.join(root, 'Notes', 'Daily'), null, root])
    expect(JSON.parse(await readFile(file(root), 'utf8'))).toEqual({ version: 1, places: ['Notes/Daily', null, ''] })
    expect(await getNewPlaces(root)).toEqual([path.join(root, 'Notes', 'Daily'), null, root])
  })

  it('refuses a place outside the vault and a wrong count; a malformed file reads empty and is never written', async () => {
    const root = await makeVault()
    expect(await failure(setNewPlaces(root, ['/elsewhere', null, null]))).toMatchObject({ code: 'BAD_REQUEST' })
    expect(await failure(setNewPlaces(root, [null]))).toMatchObject({ code: 'BAD_REQUEST' })
    await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(file(root), '{ nope')
    expect(await getNewPlaces(root)).toEqual([null, null, null])
    expect(await failure(setNewPlaces(root, [null, null, null]))).toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await readFile(file(root), 'utf8')).toBe('{ nope')
  })
})
