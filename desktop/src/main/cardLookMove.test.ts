import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CARD_LOOK_FILE } from '@shared/cardLook'
import { DEFAULT_SETTINGS, VAULT_CONFIG_DIR, type SettingsState } from '@shared/types'
import { CARD_LOOK_MOVE, cardLookPart } from './cardLookMove'

/** YAZ-5484: the app's card look moves once into each vault's card-look.json (the vault settings rules). Real tmp vaults. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})
async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-card-look-'))
  roots.push(root)
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, CARD_LOOK_FILE)
const unifiedFile = (root: string) => path.join(root, VAULT_CONFIG_DIR, 'settings.json')
const onDisk = async (root: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file(root), 'utf8'))
  } catch {
    return (JSON.parse(await readFile(unifiedFile(root), 'utf8')) as { cardLook?: unknown }).cardLook
  }
}
const seed = async (root: string, content: string) => {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), content)
}
const exists = (p: string) => stat(p).then(() => true, () => false)
const marks = () => {
  const seen = new Set<string>()
  return { seededConfig: (r: string, n: string) => seen.has(`${r}|${n}`), markSeededConfig: (r: string, n: string) => void seen.add(`${r}|${n}`) }
}
const APP: SettingsState = { ...DEFAULT_SETTINGS, shownHiddenWords: 'box', markNextHidden: false, cardTextSize: 18, cardSpacing: 'custom', cardLineSpacing: 2 }
const run = (list: string[], s: SettingsState = APP, m = marks(), canSeed = async () => true) => CARD_LOOK_MOVE.run(list, s, m, canSeed)

describe('YAZ-5484: the card look moves once into each vault', () => {
  it('the part: only what differs from the defaults; nothing for the defaults', () => {
    expect(cardLookPart(DEFAULT_SETTINGS)).toBeNull()
    expect(cardLookPart(APP)).toEqual({ version: 1, hiddenWords: 'box', markNext: false, textSize: 18, spacing: 'custom', custom: { line: 2 } })
  })

  it('absent: EACH vault of the window gets the app\'s look', async () => {
    const a = await makeVault()
    const b = await makeVault()
    await run([a, b])
    for (const root of [a, b]) expect(await onDisk(root)).toEqual({ version: 1, hiddenWords: 'box', markNext: false, textSize: 18, spacing: 'custom', custom: { line: 2 } })
  })

  it('present (any of its keys), malformed, the default, not a folder, before the first pull, and once per vault', async () => {
    const own = await makeVault()
    await seed(own, JSON.stringify({ version: 1, hiddenWords: 'underline' }))
    await run([own])
    expect(await onDisk(own)).toEqual({ version: 1, hiddenWords: 'underline' })
    // A file of a later build with none of its keys: the look is added beside them.
    const later = await makeVault()
    await seed(later, JSON.stringify({ version: 1, future: true }))
    await run([later])
    expect(await onDisk(later)).toMatchObject({ future: true, hiddenWords: 'box' })
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
    expect(await exists(unifiedFile(plain))).toBe(false)
    await run([plain], APP, m)
    expect(await exists(unifiedFile(plain))).toBe(true)
    await rm(unifiedFile(plain))
    await run([plain], APP, m)
    expect(await exists(unifiedFile(plain))).toBe(false)
  })
})
