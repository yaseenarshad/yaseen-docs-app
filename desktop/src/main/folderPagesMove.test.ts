import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FOLDER_PAGES_FILE } from '@shared/folderPages'
import { DEFAULT_SETTINGS, VAULT_CONFIG_DIR, type SettingsState } from '@shared/types'
import { FOLDER_PAGES_MOVE, folderPagesPart } from './folderPagesMove'

/** YAZ-5489: the app's folder page defaults move once into each vault's folder-pages.json (the vault settings rules). Real tmp vaults. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})
async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-folder-pages-'))
  roots.push(root)
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, FOLDER_PAGES_FILE)
const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))
const seed = async (root: string, content: string) => {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), content)
}
const exists = (p: string) => stat(p).then(() => true, () => false)
const marks = () => {
  const seen = new Set<string>()
  return { seededConfig: (r: string, n: string) => seen.has(`${r}|${n}`), markSeededConfig: (r: string, n: string) => void seen.add(`${r}|${n}`) }
}
const APP: SettingsState = { ...DEFAULT_SETTINGS, folderPages: { ...DEFAULT_SETTINGS.folderPages, rowHeight: 'tall', subfolders: 'rows', weekLineColor: 'blue light', weekStartsOn: 'monday', askBeforeDelete: false } }
const MOVED = { version: 1, rowHeight: 'tall', subfolders: 'rows', weekLineColor: 'blue light' }
const run = (list: string[], s: SettingsState = APP, m = marks(), canSeed = async () => true) => FOLDER_PAGES_MOVE.run(list, s, m, canSeed)

describe('YAZ-5489: the folder page defaults move once into each vault', () => {
  it('the part: only what differs from the defaults; nothing for the defaults', () => {
    expect(folderPagesPart(DEFAULT_SETTINGS)).toBeNull()
    expect(folderPagesPart(APP)).toEqual(MOVED)
    // The personal parts stay this Mac's: they move nothing.
    expect(folderPagesPart({ ...DEFAULT_SETTINGS, folderPages: { ...DEFAULT_SETTINGS.folderPages, weekStartsOn: 'monday', rowBand: false, keepWindowPinned: false, askBeforeDelete: false } })).toBeNull()
  })

  it('absent: EACH vault of the window gets the app\'s look', async () => {
    const a = await makeVault()
    const b = await makeVault()
    await run([a, b])
    for (const root of [a, b]) expect(await onDisk(root)).toEqual(MOVED)
  })

  it('present (any of its keys), malformed, the default, not a folder, before the first pull, and once per vault', async () => {
    const own = await makeVault()
    await seed(own, JSON.stringify({ version: 1, rowNumbers: false }))
    await run([own])
    expect(await onDisk(own)).toEqual({ version: 1, rowNumbers: false })
    // A file of a later build with none of its keys: the look is added beside them.
    const later = await makeVault()
    await seed(later, JSON.stringify({ version: 1, future: true }))
    await run([later])
    expect(await onDisk(later)).toMatchObject({ future: true, rowHeight: 'tall' })
    const bad = await makeVault()
    await seed(bad, '{ nope')
    await run([bad])
    expect(await readFile(file(bad), 'utf8')).toBe('{ nope')
    const plain = await makeVault()
    await run([plain], DEFAULT_SETTINGS)
    expect(await exists(file(plain))).toBe(false)
    const gone = path.join(plain, 'not-here')
    await run([gone])
    expect(await exists(gone)).toBe(false)
    const m = marks()
    await run([plain], APP, m, async () => false)
    expect(await exists(file(plain))).toBe(false)
    await run([plain], APP, m)
    expect(await exists(file(plain))).toBe(true)
    await rm(file(plain))
    await run([plain], APP, m)
    expect(await exists(file(plain))).toBe(false)
  })
})
