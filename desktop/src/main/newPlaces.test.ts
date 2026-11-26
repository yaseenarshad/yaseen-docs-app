import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { NEW_PLACES_FILE } from '@shared/newPlaces'
import { failure } from './fs/testFixture'
import { NEW_PLACES_MOVE, getNewPlaces, setNewPlaces } from './newPlaces'
import { vaultNewPlacesSettings } from './vaultSettingsRead'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

/** The New… box's place shortcuts in the vault (YAZ-4252 D3): real tmp vaults, as favorites.test. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-new-places-'))
  roots.push(root)
  await mkdir(path.join(root, 'Pages', 'Daily'), { recursive: true })
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, NEW_PLACES_FILE)
const unifiedFile = (root: string) => path.join(root, VAULT_CONFIG_DIR, 'settings.json')
const readSection = async (root: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file(root), 'utf8'))
  } catch {
    return (JSON.parse(await readFile(unifiedFile(root), 'utf8')) as { newPlaces?: unknown }).newPlaces
  }
}

describe('new-places.json (YAZ-4252 D3)', () => {
  it('reads three empty places with no file, and creates none', async () => {
    const root = await makeVault()
    expect(await getNewPlaces(root)).toEqual([null, null, null])
    await expect(readFile(file(root), 'utf8')).rejects.toThrow()
  })

  it('saves vault-relative paths ("" for the vault) into unified settings.json on clean vaults and reads them back absolute', async () => {
    const root = await makeVault()
    await setNewPlaces(root, [path.join(root, 'Pages', 'Daily'), null, root])
    expect(await readSection(root)).toEqual({ version: 1, places: ['Pages/Daily', null, ''] })
    await expect(readFile(file(root), 'utf8')).rejects.toThrow()
    expect(await getNewPlaces(root)).toEqual([path.join(root, 'Pages', 'Daily'), null, root])
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

  it('YAZ-5483: a save keeps a key of a later build (an older Mac never erases it)', async () => {
    const root = await makeVault()
    await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(file(root), JSON.stringify({ version: 1, places: [null, null, null], drawings: 'Boards', comments: { hint: true } }))
    await setNewPlaces(root, [path.join(root, 'Pages'), null, null])
    expect(JSON.parse(await readFile(file(root), 'utf8'))).toEqual({ version: 1, places: ['Pages', null, null], drawings: 'Boards', comments: { hint: true } })
  })
})

describe('YAZ-5486: where new things go move once into each vault; a folder only where the vault has it', () => {
  const marks = () => {
    const seen = new Set<string>()
    return { seededConfig: (r: string, n: string) => seen.has(`${r}|${n}`), markSeededConfig: (r: string, n: string) => void seen.add(`${r}|${n}`) }
  }
  const APP = { ...DEFAULT_SETTINGS, newPageLocation: 'folder' as const, newPageFolder: 'Pages/Daily', newBoardFolder: 'assets' as const }
  const read = async (root: string) => readSection(root)
  const run = (roots: string[], s: SettingsState = APP, m = marks()) => NEW_PLACES_MOVE.run(roots, s, m, async () => true)

  it('absent: a file with the three empty shortcuts (an older build reads it); the folder only in the vault that holds it', async () => {
    const holds = await makeVault()
    const other = await mkdtemp(path.join(tmpdir(), 'yd-new-places-'))
    roots.push(other)
    await run([holds, other])
    expect(await read(holds)).toEqual({ version: 1, places: [null, null, null], newPage: { location: 'folder', folder: 'Pages/Daily' }, newBoard: { folder: 'assets' } })
    // The other vault does not hold Pages/Daily: no newPage there (it is never made), the board place still moves.
    expect(await read(other)).toEqual({ version: 1, places: [null, null, null], newBoard: { folder: 'assets' } })
    expect(await getNewPlaces(other)).toEqual([null, null, null])
  })

  it('present: the shortcuts stay; a file with the key, or malformed, is left; the default moves nothing; once per vault', async () => {
    const root = await makeVault()
    await mkdir(path.dirname(file(root)), { recursive: true })
    await writeFile(file(root), JSON.stringify({ version: 1, places: ['Pages', null, null] }))
    await run([root])
    expect(await read(root)).toMatchObject({ places: ['Pages', null, null], newPage: { location: 'folder' } })
    const own = await makeVault()
    await mkdir(path.dirname(file(own)), { recursive: true })
    await writeFile(file(own), JSON.stringify({ version: 1, places: [null, null, null], newPage: {}, newBoard: {} }))
    await run([own])
    expect(await read(own)).toEqual({ version: 1, places: [null, null, null], newPage: {}, newBoard: {} })
    const bad = await makeVault()
    await mkdir(path.dirname(file(bad)), { recursive: true })
    await writeFile(file(bad), '{ nope')
    await run([bad])
    expect(await readFile(file(bad), 'utf8')).toBe('{ nope')
    const plain = await makeVault()
    await run([plain], DEFAULT_SETTINGS)
    await expect(readFile(file(plain), 'utf8')).rejects.toThrow()
    const m = marks()
    await run([plain], APP, m)
    await rm(unifiedFile(plain))
    await run([plain], APP, m)
    await expect(readFile(unifiedFile(plain), 'utf8')).rejects.toThrow()
  })

  it('YAZ-5490: the comment hint moves only when it is off; each vault', async () => {
    const a = await makeVault()
    const b = await makeVault()
    await run([a, b], { ...DEFAULT_SETTINGS, commentsHint: false })
    for (const root of [a, b]) expect(await read(root)).toEqual({ version: 1, places: [null, null, null], commentsHint: false })
    const on = await makeVault()
    await run([on], DEFAULT_SETTINGS)
    await expect(readFile(file(on), 'utf8')).rejects.toThrow()
  })

  it('a root that is not a folder now is skipped', async () => {
    const gone = path.join(tmpdir(), `yd-gone-${Date.now()}`)
    await run([gone])
    await expect(readFile(file(gone), 'utf8')).rejects.toThrow()
  })

  it('the shortcuts\' writer keeps the keys; main reads the vault\'s values (a board\'s pictures place)', async () => {
    const root = await makeVault()
    await mkdir(path.dirname(file(root)), { recursive: true })
    await writeFile(file(root), JSON.stringify({ version: 1, places: [null, null, null], newBoard: { pictures: 'assets' } }))
    await setNewPlaces(root, [path.join(root, 'Pages'), null, null])
    expect(await read(root)).toMatchObject({ newBoard: { pictures: 'assets' } })
    expect((await vaultNewPlacesSettings(root, DEFAULT_SETTINGS)).newBoardPictures).toBe('assets')
    expect((await vaultNewPlacesSettings(await makeVault(), DEFAULT_SETTINGS)).newBoardPictures).toBe(DEFAULT_SETTINGS.newBoardPictures)
  })
})
