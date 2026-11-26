import { describe, expect, it, vi } from 'vitest'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { LEGACY_SECTION_KEYS, VAULT_SETTINGS_FILE, readVaultSection } from '@shared/vaultSettings'
import { readUnitWord } from '../app/unitWord'
import { readVaultTabs } from '../app/vaultTabs'
import { dailyPagesOf } from '../daily/today'
import { loadFolderPages } from '../folders/folderPagesFile'
import { readCardLook } from '../media/ui/cardDraw'
import { loadVaultLook } from '../page/vaultLook'
import { loadVaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore } from '../store'
import { VAULT_SETTINGS_PATH, readVaultSectionOrLegacy, readVaultSettingsDoc, sectionFromDoc } from './readVaultSettings'

const V = 'yaseen/vault@main'

describe('readVaultSettings: unified .yaseendocs/settings.json with legacy fallback (YAZ-6557)', () => {
  it('stays aligned with @shared/vaultSettings path and section extraction across all 12 sections', () => {
    expect(VAULT_SETTINGS_PATH).toBe(`${VAULT_CONFIG_DIR}/${VAULT_SETTINGS_FILE}`)
    const doc: Record<string, unknown> = { version: 1 }
    for (const key of LEGACY_SECTION_KEYS) doc[key] = { marker: key }
    for (const key of LEGACY_SECTION_KEYS) {
      expect(sectionFromDoc(doc, key)).toEqual(readVaultSection(doc, key))
      expect(sectionFromDoc(null, key)).toBe(readVaultSection(null, key))
      expect(sectionFromDoc({ [key]: 'not-an-object' }, key)).toBe(readVaultSection({ [key]: 'not-an-object' }, key))
    }
  })

  it('consolidated vault: loadVaultLook makes ONE single store.read() call instead of 5-7 reads', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.write(
      V,
      VAULT_SETTINGS_PATH,
      JSON.stringify({
        version: 1,
        linkPills: { version: 2, format: '{name} · {id}' },
        textFormatting: { version: 2, text: { size: 19 }, line: { darkness: 25, thickness: 2, pattern: 'dashed' } },
        linkClick: { click: 'explore' },
        cardLook: { version: 1, textSize: 21 },
        tableLook: { version: 1, look: { nowMark: 'both', nextShade: true } },
      }),
    )
    const data = await loadVaultData(store, V, 'vault')
    const readSpy = vi.spyOn(store, 'read')

    const look = await loadVaultLook(store, data)

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledWith(V, VAULT_SETTINGS_PATH)
    expect(look.pills.format).toBe('{name} · {id}')
    expect(look.click).toBe('explore')
    expect(look.style['--text-size']).toBe('19px')
    expect(look.style['--card-text-size']).toBe('21px')
    expect(look.table?.tableNowMark).toBe('both')
    expect(look.table?.tableNextShade).toBe(true)
  })

  it('unmigrated vault: lossless fallback to legacy .yaseendocs/*.json files when settings.json is absent', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.write(V, '.yaseendocs/link-pills.json', JSON.stringify({ version: 2, format: '{name} ({id})' }))
    await store.write(V, '.yaseendocs/text-formatting.json', JSON.stringify({ version: 2, text: { size: 18 } }))
    await store.write(V, '.yaseendocs/link-click.json', JSON.stringify({ click: 'explore' }))
    await store.write(V, '.yaseendocs/card-look.json', JSON.stringify({ version: 1, textSize: 20 }))
    await store.write(V, '.yaseendocs/table-look.json', JSON.stringify({ version: 1, look: { nextShade: true } }))
    await store.write(V, '.yaseendocs/unit-word.json', JSON.stringify({ unit: 'doc' }))
    await store.write(V, '.yaseendocs/daily-pages.json', JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }))
    await store.write(V, '.yaseendocs/folder-pages.json', JSON.stringify({ version: 1, folderCounts: true }))
    await store.write(V, '.yaseendocs/review.json', JSON.stringify({ enabled: false }))

    const data = await loadVaultData(store, V, 'vault')
    const look = await loadVaultLook(store, data)
    expect(look.pills.format).toBe('{name} ({id})')
    expect(look.click).toBe('explore')
    expect(look.style['--text-size']).toBe('18px')
    expect(look.style['--card-text-size']).toBe('20px')
    expect(look.table?.tableNextShade).toBe(true)
    expect(data.review.enabled).toBe(false)
    expect((await readUnitWord(store, V))('Open page')).toBe('Open doc')
    expect((await dailyPagesOf(store, V))?.folder).toBe('Daily')
    expect((await loadFolderPages(store, data)).folderCounts).toBe(true)
  })

  it('partial migration & malformed settings.json: settings.json sections win while absent sections fall back to legacy', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.write(
      V,
      VAULT_SETTINGS_PATH,
      JSON.stringify({
        version: 1,
        unitWord: { unit: 'note' },
        review: { enabled: false },
        dailyPages: { enabled: true, folder: 'Journal', format: 'YYYY-MM-DD', dayFolder: false },
      }),
    )
    // Legacy files present with different values; settings.json must win for present sections, legacy used for absent ones.
    await store.write(V, '.yaseendocs/unit-word.json', JSON.stringify({ unit: 'doc' }))
    await store.write(V, '.yaseendocs/card-look.json', JSON.stringify({ version: 1, textSize: 22 }))
    await store.write(V, '.yaseendocs/ids.json', JSON.stringify({ enabled: true }))

    expect((await readUnitWord(store, V))('Open page')).toBe('Open note')
    expect((await dailyPagesOf(store, V))?.folder).toBe('Journal')
    expect(await readVaultTabs(store, V)).toEqual({ review: false, daily: true })
    expect((await readCardLook(store, V))['--card-text-size']).toBe('22px')

    // Malformed settings.json falls back cleanly to legacy files.
    await store.write(V, VAULT_SETTINGS_PATH, '{ broken json')
    expect(await readVaultSettingsDoc(store, V)).toBeNull()
    expect(await readVaultSectionOrLegacy(store, V, 'unitWord', 'unit-word.json')).toEqual({ unit: 'doc' })
  })
})
