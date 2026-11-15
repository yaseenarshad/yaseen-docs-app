import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TABLE_LOOK_FILE } from '@shared/tableLook'
import { DEFAULT_SETTINGS, VAULT_CONFIG_DIR, type SettingsState } from '@shared/types'
import { TABLE_LOOK_MOVE, tableLookPart } from './tableLookMove'

/** YAZ-5487: the app's table look moves once into each vault's table-look.json (the vault settings rules). Real tmp vaults. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})
async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-table-look-'))
  roots.push(root)
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, TABLE_LOOK_FILE)
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
const APP: SettingsState = { ...DEFAULT_SETTINGS, tableRowBand: 'calendar', tableHeaderRow: { ...DEFAULT_SETTINGS.tableHeaderRow, color: 'teal' }, tableDayStart: 360, tableTimeFormat: 'HH:mm' }
const MOVED = { version: 1, look: { headerRow: { color: 'teal' }, rowBand: 'calendar' }, newTables: { timeFormat: 'HH:mm', dayStart: 360 } }
const run = (list: string[], s: SettingsState = APP, m = marks(), canSeed = async () => true) => TABLE_LOOK_MOVE.run(list, s, m, canSeed)

describe('YAZ-5487: the table look moves once into each vault', () => {
  it('the part: only what differs from the defaults; nothing for the defaults', () => {
    expect(tableLookPart(DEFAULT_SETTINGS)).toBeNull()
    expect(tableLookPart(APP)).toEqual(MOVED)
    // The habits stay this Mac's: they move nothing.
    expect(tableLookPart({ ...DEFAULT_SETTINGS, tableBandRows: 'mouse', tableNowButton: false, tableCellNotePinned: false })).toBeNull()
  })

  it('absent: EACH vault of the window gets the app\'s look', async () => {
    const a = await makeVault()
    const b = await makeVault()
    await run([a, b])
    for (const root of [a, b]) expect(await onDisk(root)).toEqual(MOVED)
  })

  it('present (any of its keys), malformed, the default, not a folder, before the first pull, and once per vault', async () => {
    const own = await makeVault()
    await seed(own, JSON.stringify({ version: 1, look: { rowBand: 'off' } }))
    await run([own])
    expect(await onDisk(own)).toEqual({ version: 1, look: { rowBand: 'off' } })
    // A file of a later build with none of its keys: the look is added beside them.
    const later = await makeVault()
    await seed(later, JSON.stringify({ version: 1, future: true }))
    await run([later])
    expect(await onDisk(later)).toMatchObject({ future: true, look: { rowBand: 'calendar' } })
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
