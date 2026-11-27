import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_SIDEBAR_TABS, type SettingsState } from './types'
import {
  VAULT_CHROME_KEYS,
  VAULT_OVERRIDE_KEYS,
  VAULT_OWNED_CHROME_KEYS,
  VAULT_SETTINGS_VERSION,
  extractVaultOverrides,
  extractWorkspaceChrome,
  isVaultChromeKey,
  isVaultOverrideKey,
  isVaultOwnedChromeKey,
  isVaultSettingsDocEmpty,
  mergeLegacyFilesIntoDoc,
  patchVaultSettingsDoc,
  readVaultSection,
  readWorkspaceChrome,
  resolveVaultSettings,
  withMobileSettingInVaultSettings,
  workspaceSettingsKey,
} from './vaultSettings'

describe('shared/vaultSettings (YAZ-6546)', () => {
  it('registers all 37 per-vault override keys (13 chrome + 2 nav + 13 outline + 9 layout) without duplicates', () => {
    expect(VAULT_CHROME_KEYS).toHaveLength(13)
    expect(VAULT_OVERRIDE_KEYS).toHaveLength(37)
    expect(new Set(VAULT_OVERRIDE_KEYS).size).toBe(37)
    expect(isVaultChromeKey('sidebarTabs')).toBe(true)
    expect(isVaultChromeKey('tabWidth')).toBe(true)
    expect(isVaultChromeKey('bulletThreading')).toBe(false)
    expect(isVaultOverrideKey('bulletThreading')).toBe(true)
    expect(isVaultOverrideKey('webLinks')).toBe(true)
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
    // Vault A's sidebarTabs is ignored in multi-vault mode and NEVER inherits Global (YAZ-6593)
    expect(multi.sidebarTabs).toEqual(DEFAULT_SIDEBAR_TABS)
  })

  it('YAZ-6593: sidebarTabs is Vault/Workspace-only and never inherits non-default global.sidebarTabs', () => {
    expect(VAULT_OWNED_CHROME_KEYS).toEqual(['sidebarTabs'])
    expect(isVaultOwnedChromeKey('sidebarTabs')).toBe(true)
    expect(isVaultOwnedChromeKey('rowDates')).toBe(false)

    const globalWithCustomTabs: SettingsState = {
      ...DEFAULT_SETTINGS,
      sidebarTabs: {
        order: ['files', 'favorites', 'search', 'recents', 'focus', 'sessions'],
        hidden: ['sessions'],
        hiddenButtons: ['more'],
      },
    }
    // Unset single vault ignores global.sidebarTabs and starts at DEFAULT_SIDEBAR_TABS
    expect(resolveVaultSettings(globalWithCustomTabs, {}).sidebarTabs).toEqual(DEFAULT_SIDEBAR_TABS)
    // Unset multi-vault workspace ignores global.sidebarTabs and starts at DEFAULT_SIDEBAR_TABS
    expect(resolveVaultSettings(globalWithCustomTabs, {}, {}).sidebarTabs).toEqual(DEFAULT_SIDEBAR_TABS)
  })

  it('builds deterministic portable workspace keys for named VaultSets, unnamed IDs, and ad-hoc multi-vault roots', () => {
    expect(workspaceSettingsKey(['/b', '/a'], 'set-123', ' All Folders ')).toBe('ws-name:all folders')
    expect(workspaceSettingsKey(['/b', '/a'], 'set-123')).toBe('ws:set-123')
    expect(workspaceSettingsKey(['/b/', '/a'], null)).toBe('roots:/a\0/b')
    expect(workspaceSettingsKey(['/a', '/b'])).toBe('roots:/a\0/b')

    // Portable read falls back to legacy ws:<id> until upgraded, preferring ws-name:<name> when present
    const legacyOnly = { 'ws:set-123': { tabWidth: 'wide' } }
    expect(readWorkspaceChrome(legacyOnly, ['/a', '/b'], 'set-123', 'All Folders')).toEqual({ tabWidth: 'wide' })
    const both = { 'ws:set-123': { tabWidth: 'wide' }, 'ws-name:all folders': { tabWidth: 'compact' } }
    expect(readWorkspaceChrome(both, ['/a', '/b'], 'set-123', 'All Folders')).toEqual({ tabWidth: 'compact' })
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

    // Unknown nested keys inside `mobile` are preserved across writes
    const nestedStart = JSON.stringify({ version: 1, mobile: { version: 1, futureMobileFlag: 'keep-me' } }, null, 2)
    const nestedNext = JSON.parse(withMobileSettingInVaultSettings(nestedStart, 'folding', false)) as Record<string, unknown>
    expect(nestedNext.mobile).toEqual({ version: 1, folding: false, futureMobileFlag: 'keep-me' })
  })

  it('sanitizes partial or hand-edited nested overrides (sidebarTabs, rowDates) without crashing', () => {
    const extracted = extractVaultOverrides({
      version: 1,
      sidebarTabs: { order: ['files', 'favorites'], hidden: ['files', 'recents'] },
      rowDates: { files: true },
      goTo: 'bad-not-an-object',
    })
    expect(extracted.sidebarTabs).toEqual({
      order: ['files', 'favorites', 'search', 'focus', 'sessions', 'recents'],
      hidden: ['recents'],
      hiddenButtons: [],
    })
    expect(extracted.rowDates).toEqual({ files: true, focus: false, favorites: false, search: true })
    expect(extracted.goTo).toBeUndefined()
  })
})
