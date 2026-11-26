import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from './types'
import {
  VAULT_CHROME_KEYS,
  VAULT_OVERRIDE_KEYS,
  VAULT_SETTINGS_VERSION,
  extractVaultOverrides,
  extractWorkspaceChrome,
  isVaultChromeKey,
  isVaultOverrideKey,
  isVaultSettingsDocEmpty,
  mergeLegacyFilesIntoDoc,
  patchVaultSettingsDoc,
  readVaultSection,
  resolveVaultSettings,
  withMobileSettingInVaultSettings,
  workspaceSettingsKey,
} from './vaultSettings'

describe('shared/vaultSettings (YAZ-6546)', () => {
  it('registers all 36 per-vault override keys (13 chrome + 2 nav + 13 outline + 8 layout) without duplicates', () => {
    expect(VAULT_CHROME_KEYS).toHaveLength(13)
    expect(VAULT_OVERRIDE_KEYS).toHaveLength(36)
    expect(new Set(VAULT_OVERRIDE_KEYS).size).toBe(36)
    expect(isVaultChromeKey('sidebarTabs')).toBe(true)
    expect(isVaultChromeKey('tabWidth')).toBe(true)
    expect(isVaultChromeKey('bulletThreading')).toBe(false)
    expect(isVaultOverrideKey('bulletThreading')).toBe(true)
    expect(isVaultOverrideKey('theme')).toBe(false)
  })

  it('resolves single-vault overrides and multi-vault workspace chrome without flipping chrome on tab switch', () => {
    const global = DEFAULT_SETTINGS
    const vaultA = {
      sidebarTabs: {
        order: ['files', 'search', 'favorites', 'focus', 'sessions', 'recents'] as SettingsState['sidebarTabs']['order'],
        hidden: ['favorites', 'focus', 'sessions', 'recents'] as SettingsState['sidebarTabs']['hidden'],
        hiddenButtons: [] as SettingsState['sidebarTabs']['hiddenButtons'],
      },
      bulletThreading: true,
      contentWidth: 'full' as const,
      tabWidth: 'wide' as const,
    }
    // Single-vault window: vault overrides BOTH page and chrome keys
    const single = resolveVaultSettings(global, vaultA)
    expect(single.bulletThreading).toBe(true)
    expect(single.contentWidth).toBe('full')
    expect(single.tabWidth).toBe('wide')
    expect(single.sidebarTabs.hidden).toEqual(['favorites', 'focus', 'sessions', 'recents'])
    expect(single.theme).toBe(global.theme)

    // Multi-vault window: workspace chrome wins over vaultA's chrome, while vaultA's page settings still apply!
    const wsChrome = { tabWidth: 'compact' as const }
    const multi = resolveVaultSettings(global, vaultA, wsChrome)
    expect(multi.bulletThreading).toBe(true)
    expect(multi.contentWidth).toBe('full')
    expect(multi.tabWidth).toBe('compact')
    // Vault A's sidebarTabs is ignored in multi-vault mode (inherits Global when workspace didn't override it)
    expect(multi.sidebarTabs).toEqual(global.sidebarTabs)
  })

  it('builds deterministic workspace keys for saved VaultSets and ad-hoc multi-vault roots', () => {
    expect(workspaceSettingsKey(['/b', '/a'], 'set-123')).toBe('ws:set-123')
    expect(workspaceSettingsKey(['/b/', '/a'], null)).toBe('roots:/a\0/b')
    expect(workspaceSettingsKey(['/a', '/b'])).toBe('roots:/a\0/b')
  })

  it('patches sparse docs, removes unset keys, and preserves unknown forward-compat keys', () => {
    const initial = { version: 1, futureFlag: 42, bulletThreading: true }
    const updated = patchVaultSettingsDoc(initial, { contentWidth: 'wide' }, ['bulletThreading'])
    expect(updated).toEqual({ version: VAULT_SETTINGS_VERSION, futureFlag: 42, contentWidth: 'wide' })
    expect(extractVaultOverrides(updated)).toEqual({ contentWidth: 'wide' })
    expect(extractWorkspaceChrome({ tabWidth: 'wide', bulletThreading: true })).toEqual({ tabWidth: 'wide' })
    expect(isVaultSettingsDocEmpty({ version: 1 })).toBe(true)
    expect(isVaultSettingsDocEmpty(updated)).toBe(false)
  })

  it('merges legacy files and legacy rowDates without overwriting existing settings.json sections', () => {
    const existing = { version: 1, textFormatting: { version: 2, text: { size: 18 } } }
    const { doc, migratedFiles, migratedRowDates } = mergeLegacyFilesIntoDoc(
      existing,
      {
        'text-formatting.json': { version: 2, text: { size: 14 } },
        'review.json': { enabled: true, buttons: 2 },
        'show-ids.json': { search: 'number', tabs: 'full' },
      },
      { files: true, focus: false, favorites: false, search: true, recents: false },
    )
    expect(migratedFiles).toEqual(['text-formatting.json', 'show-ids.json', 'review.json'])
    expect(migratedRowDates).toBe(true)
    // Existing textFormatting wins; new sections & rowDates are added
    expect(readVaultSection(doc, 'textFormatting')).toEqual({ version: 2, text: { size: 18 } })
    expect(readVaultSection(doc, 'review')).toEqual({ enabled: true, buttons: 2 })
    expect(readVaultSection(doc, 'showIds')).toEqual({ search: 'number', tabs: 'full' })
    expect(doc.rowDates).toEqual({ files: true, focus: false, favorites: false, search: true, recents: false })
  })

  it('updates mobile settings inside settings.json while preserving all other keys', () => {
    const start = JSON.stringify({ version: 1, bulletThreading: true, customFuture: 'keep' }, null, 2)
    const nextText = withMobileSettingInVaultSettings(start, 'stickyHeadings', false)
    const parsed = JSON.parse(nextText) as Record<string, unknown>
    expect(parsed.bulletThreading).toBe(true)
    expect(parsed.customFuture).toBe('keep')
    expect(parsed.mobile).toEqual({ version: 1, stickyHeadings: false })

    // Setting back to default removes the mobile section cleanly
    const backText = withMobileSettingInVaultSettings(nextText, 'stickyHeadings', true)
    const back = JSON.parse(backText) as Record<string, unknown>
    expect(back.mobile).toBeUndefined()
    expect(back.bulletThreading).toBe(true)
  })
})
