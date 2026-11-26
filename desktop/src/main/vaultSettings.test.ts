import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DAILY_PAGES_FILE } from '@shared/dailyPagesFile'
import { NEW_PLACES_FILE } from '@shared/newPlaces'
import { REVIEW_SETTINGS_FILE } from '@shared/reviews'
import { TEXT_FORMATTING_FILE } from '@shared/textFormatting'
import { UNIT_WORD_FILE } from '@shared/unitWord'
import { VAULT_CONFIG_DIR, type RowDates } from '@shared/types'
import { LEGACY_SECTION_MAP, LEGACY_SETTINGS_FILES, VAULT_SETTINGS_FILE, VAULT_SETTINGS_VERSION } from '@shared/vaultSettings'
import { BridgeFailure } from './fs/fsUtils'
import { createStore } from './store'
import { consolidateVaultSettingsOnDisk, readUnifiedVaultSettings } from './vaultSettings'
import { readVaultSettingsFile } from './vaultSettingsRead'

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeTempDir(prefix = 'yd-vault-settings-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function putConfig(root: string, name: string, value: unknown): Promise<void> {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  await mkdir(dir, { recursive: true })
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(path.join(dir, name), text, 'utf8')
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

describe('readUnifiedVaultSettings & consolidateVaultSettingsOnDisk (YAZ-6546)', () => {
  it('returns null on a clean vault without creating .yaseendocs/', async () => {
    const root = await makeTempDir()
    expect(await readUnifiedVaultSettings(root)).toBeNull()
    expect(await exists(path.join(root, VAULT_CONFIG_DIR))).toBe(false)
  })

  it('returns existing settings.json directly when no legacy files or legacy rowDates exist', async () => {
    const root = await makeTempDir()
    const doc = { version: 1, contentWidth: 'full', review: { version: 1, enabled: false } }
    await putConfig(root, VAULT_SETTINGS_FILE, doc)
    expect(await readUnifiedVaultSettings(root)).toEqual(doc)
  })

  it('throws BridgeFailure INVALID_CONFIG when settings.json is malformed JSON or not an object', async () => {
    const root = await makeTempDir()
    await putConfig(root, VAULT_SETTINGS_FILE, '{ "version": 1,')
    await expect(readUnifiedVaultSettings(root)).rejects.toSatisfy(
      (err: unknown) => err instanceof BridgeFailure && err.code === 'INVALID_CONFIG',
    )

    const root2 = await makeTempDir()
    await putConfig(root2, VAULT_SETTINGS_FILE, '[1, 2, 3]')
    await expect(readUnifiedVaultSettings(root2)).rejects.toSatisfy(
      (err: unknown) => err instanceof BridgeFailure && err.code === 'INVALID_CONFIG',
    )
  })

  it('migrates all 12 legacy settings files into unified settings.json atomically and unlinks them', async () => {
    const root = await makeTempDir()
    for (const file of LEGACY_SETTINGS_FILES) {
      await putConfig(root, file, { version: 1, marker: file })
    }
    // Non-settings files in .yaseendocs/ (like icons.json, ids.json) must stay untouched.
    await putConfig(root, 'icons.json', { version: 1, rules: [] })
    await putConfig(root, 'ids.json', { version: 1, letters: ['A'] })

    const doc = await readUnifiedVaultSettings(root)
    expect(doc).not.toBeNull()
    expect(doc?.version).toBe(VAULT_SETTINGS_VERSION)
    for (const file of LEGACY_SETTINGS_FILES) {
      const section = LEGACY_SECTION_MAP[file]
      expect(doc?.[section]).toEqual({ version: 1, marker: file })
      expect(await exists(path.join(root, VAULT_CONFIG_DIR, file))).toBe(false)
    }

    // settings.json written on disk, and non-settings files preserved.
    const onDisk = JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE), 'utf8')) as unknown
    expect(onDisk).toEqual(doc)
    expect(await readdir(path.join(root, VAULT_CONFIG_DIR))).toEqual(['icons.json', 'ids.json', 'settings.json'])
  })

  it('preserves existing keys in settings.json over legacy files while still cleaning up migrated legacy files', async () => {
    const root = await makeTempDir()
    await putConfig(root, VAULT_SETTINGS_FILE, {
      version: 1,
      contentWidth: 'wide',
      review: { version: 1, enabled: false, newPerDay: 5 },
      futureKey: 'kept',
    })
    await putConfig(root, REVIEW_SETTINGS_FILE, { version: 1, enabled: true, newPerDay: 20 })
    await putConfig(root, UNIT_WORD_FILE, { version: 1, word: 'note' })

    const doc = await readUnifiedVaultSettings(root)
    expect(doc).toEqual({
      version: 1,
      contentWidth: 'wide',
      review: { version: 1, enabled: false, newPerDay: 5 },
      unitWord: { version: 1, word: 'note' },
      futureKey: 'kept',
    })
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE))).toBe(false)
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, UNIT_WORD_FILE))).toBe(false)
  })

  it('migrates legacy store.folders[root].rowDates once and does not overwrite or resurrect after reset', async () => {
    const base = await makeTempDir()
    const vault = path.join(base, 'vault')
    await mkdir(vault, { recursive: true })
    const store = createStore(path.join(base, 'state.json'))
    const rowDates: RowDates = { files: true, focus: false, favorites: true, search: false }
    store.setFolder(vault, { rowDates })

    const first = await readUnifiedVaultSettings(vault, store)
    expect(first).toEqual({ version: 1, rowDates })
    expect(JSON.parse(await readFile(path.join(vault, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE), 'utf8'))).toEqual({
      version: 1,
      rowDates,
    })

    // User resets rowDates (removes it from settings.json): must not resurrect from store.folders[vault].rowDates.
    await putConfig(vault, VAULT_SETTINGS_FILE, { version: 1 })
    const second = await readUnifiedVaultSettings(vault, store)
    expect(second).toEqual({ version: 1 })
    await store.flush()
  })

  it('does not write or unlink when opts.readOnly is true, returning merged doc in memory', async () => {
    const base = await makeTempDir()
    const vault = path.join(base, 'vault')
    await mkdir(vault, { recursive: true })
    const store = createStore(path.join(base, 'state.json'))
    const rowDates: RowDates = { files: true, focus: true, favorites: false, search: false }
    store.setFolder(vault, { rowDates })
    await putConfig(vault, DAILY_PAGES_FILE, { version: 1, enabled: true, folder: 'Daily' })

    const doc = await readUnifiedVaultSettings(vault, store, { readOnly: true })
    expect(doc).toEqual({
      version: 1,
      rowDates,
      dailyPages: { version: 1, enabled: true, folder: 'Daily' },
    })
    expect(await exists(path.join(vault, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE))).toBe(false)
    expect(await exists(path.join(vault, VAULT_CONFIG_DIR, DAILY_PAGES_FILE))).toBe(true)
    await store.flush()
  })

  it('does not write or unlink when .yaseendocs/read-only.json has { on: true }', async () => {
    const root = await makeTempDir()
    await putConfig(root, 'read-only.json', { on: true })
    await putConfig(root, TEXT_FORMATTING_FILE, { version: 2, spacing: { line: 1.8 } })

    const res = await consolidateVaultSettingsOnDisk(root)
    expect(res.readOnly).toBe(true)
    expect(res.wrote).toBe(false)
    expect(res.doc).toEqual({ version: 1, textFormatting: { version: 2, spacing: { line: 1.8 } } })
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE))).toBe(false)
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE))).toBe(true)
  })

  it('skips malformed legacy files without deleting them while still migrating valid siblings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = await makeTempDir()
    await putConfig(root, REVIEW_SETTINGS_FILE, '{ broken json')
    await putConfig(root, NEW_PLACES_FILE, { version: 1, places: ['Notes', null, null] })

    const res = await consolidateVaultSettingsOnDisk(root)
    expect(res.wrote).toBe(true)
    expect(res.migratedFiles).toEqual([NEW_PLACES_FILE])
    expect(res.doc).toEqual({ version: 1, newPlaces: { version: 1, places: ['Notes', null, null] } })
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, NEW_PLACES_FILE))).toBe(false)
    expect(await readFile(path.join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE), 'utf8')).toBe('{ broken json')
    expect(warn).toHaveBeenCalled()
  })

  it('does not write an empty settings.json when only a malformed legacy file exists', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = await makeTempDir()
    await putConfig(root, REVIEW_SETTINGS_FILE, '{ broken')

    const res = await consolidateVaultSettingsOnDisk(root)
    expect(res.doc).toBeNull()
    expect(res.wrote).toBe(false)
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE))).toBe(false)
    expect(await exists(path.join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE))).toBe(true)
  })
})

describe('readVaultSettingsFile unified-first lookup (YAZ-6546)', () => {
  it('reads nested section from settings.json first and falls back to legacy file when absent', async () => {
    const root = await makeTempDir()
    expect(await readVaultSettingsFile(root, DAILY_PAGES_FILE)).toBeUndefined()

    // Legacy file alone works
    await putConfig(root, DAILY_PAGES_FILE, { version: 1, enabled: true, folder: 'OldDaily' })
    expect(await readVaultSettingsFile(root, DAILY_PAGES_FILE)).toEqual({ version: 1, enabled: true, folder: 'OldDaily' })

    // Unified settings.json without dailyPages still falls back to legacy daily-pages.json
    await putConfig(root, VAULT_SETTINGS_FILE, { version: 1, review: { version: 1, enabled: false } })
    expect(await readVaultSettingsFile(root, DAILY_PAGES_FILE)).toEqual({ version: 1, enabled: true, folder: 'OldDaily' })
    expect(await readVaultSettingsFile(root, REVIEW_SETTINGS_FILE)).toEqual({ version: 1, enabled: false })

    // Unified settings.json WITH dailyPages takes precedence over legacy daily-pages.json
    await putConfig(root, VAULT_SETTINGS_FILE, {
      version: 1,
      dailyPages: { version: 1, enabled: true, folder: 'UnifiedDaily' },
    })
    expect(await readVaultSettingsFile(root, DAILY_PAGES_FILE)).toEqual({
      version: 1,
      enabled: true,
      folder: 'UnifiedDaily',
    })
  })
})
