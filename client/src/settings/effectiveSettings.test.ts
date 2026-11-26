import { describe, expect, it } from 'vitest'
import { DEFAULT_ROW_DATES, DEFAULT_SETTINGS, type RowDates, type SettingsState } from '@shared/types'
import { workspaceSettingsKey } from '@shared/vaultSettings'
import {
  NO_PAGE_OVERRIDE_VARS,
  newPageDrawingOf,
  pageOverrideVars,
  patchWorkspaceChrome,
  resolvePageSettings,
  resolveWindowChrome,
  setVaultNewPageDrawing,
  setWindowSearchIncludeInline,
  splitChromeDiff,
  windowSearchIncludeInline,
} from './effectiveSettings'

describe('effectiveSettings (YAZ-6546, YAZ-6555)', () => {
  it('returns global settings unchanged when 0 vaults are open', () => {
    const res = resolveWindowChrome(DEFAULT_SETTINGS, [], null, null)
    expect(res.settings).toBe(DEFAULT_SETTINGS)
    expect(res.isMultiVault).toBe(false)
    expect(res.wsKey).toBeNull()
    expect(res.chromeOverrides).toEqual({})
  })

  it('single-vault window resolves vault chrome overrides over global with legacy rowDates fallback', () => {
    const legacyDates: RowDates = { ...DEFAULT_ROW_DATES, files: true }
    const withLegacy = resolveWindowChrome(DEFAULT_SETTINGS, ['/v'], null, { tabWidth: 'wide' }, legacyDates)
    expect(withLegacy.isMultiVault).toBe(false)
    expect(withLegacy.settings.tabWidth).toBe('wide')
    expect(withLegacy.settings.rowDates).toEqual(legacyDates)

    // Explicit settings.json rowDates wins over legacy FolderState.rowDates
    const explicitDates: RowDates = { ...DEFAULT_ROW_DATES, search: false }
    const withExplicit = resolveWindowChrome(DEFAULT_SETTINGS, ['/v'], null, { rowDates: explicitDates }, legacyDates)
    expect(withExplicit.settings.rowDates).toEqual(explicitDates)
  })

  it('multi-vault window resolves chrome from workspaceSettings[wsKey] and ignores per-vault chrome', () => {
    const wsKey = workspaceSettingsKey(['/v', '/w'], 'set-work')
    const global: SettingsState = {
      ...DEFAULT_SETTINGS,
      workspaceSettings: {
        [wsKey]: { tabWidth: 'compact', sidebarRowHeight: 24 },
      },
    }
    const chrome = resolveWindowChrome(global, ['/v', '/w'], 'set-work', { tabWidth: 'wide' })
    expect(chrome.isMultiVault).toBe(true)
    expect(chrome.wsKey).toBe('ws:set-work')
    expect(chrome.settings.tabWidth).toBe('compact')
    expect(chrome.settings.sidebarRowHeight).toBe(24)

    // Switching tabs across vaults keeps workspace chrome while page settings follow each page's vault
    const pageA = resolvePageSettings(global, { tabWidth: 'wide', contentWidth: 'full' }, true, chrome.chromeOverrides)
    const pageB = resolvePageSettings(global, { tabWidth: 'medium', contentWidth: 'narrow' }, true, chrome.chromeOverrides)
    expect(pageA.tabWidth).toBe('compact')
    expect(pageB.tabWidth).toBe('compact')
    expect(pageA.contentWidth).toBe('full')
    expect(pageB.contentWidth).toBe('narrow')
  })

  it('patchWorkspaceChrome sparsely updates and removes empty workspace entries', () => {
    const wsKey = 'ws:set-1'
    const afterSet = patchWorkspaceChrome(DEFAULT_SETTINGS, wsKey, { tabWidth: 'wide', sidebarLines: 'always' })
    expect(afterSet.workspaceSettings[wsKey]).toEqual({ tabWidth: 'wide', sidebarLines: 'always' })

    const afterUnsetOne = patchWorkspaceChrome(afterSet, wsKey, {}, ['tabWidth'])
    expect(afterUnsetOne.workspaceSettings[wsKey]).toEqual({ sidebarLines: 'always' })

    const afterUnsetAll = patchWorkspaceChrome(afterUnsetOne, wsKey, {}, ['sidebarLines'])
    expect(afterUnsetAll.workspaceSettings[wsKey]).toBeUndefined()
  })

  it('splitChromeDiff separates chrome keys from non-chrome global keys', () => {
    const next: SettingsState = {
      ...DEFAULT_SETTINGS,
      tabWidth: 'wide',
      sidebarRowHeight: 24,
      confirmDelete: false,
    }
    const { chrome, other } = splitChromeDiff(DEFAULT_SETTINGS, next)
    expect(chrome).toEqual({ tabWidth: 'wide', sidebarRowHeight: 24 })
    expect(other).toEqual({ confirmDelete: false })
  })

  it('pageOverrideVars returns NO_PAGE_OVERRIDE_VARS when no visual page keys are overridden', () => {
    expect(pageOverrideVars(DEFAULT_SETTINGS, {})).toBe(NO_PAGE_OVERRIDE_VARS)
    expect(pageOverrideVars(DEFAULT_SETTINGS, { goTo: { kind: 'tab', tab: 'favorites' } })).toBe(NO_PAGE_OVERRIDE_VARS)

    const custom: SettingsState = { ...DEFAULT_SETTINGS, contentWidth: 'full', threadWidth: 3, codeBlockWidth: 720 }
    const vars = pageOverrideVars(custom, { contentWidth: 'full', threadWidth: 3, codeBlockWidth: 720 })
    expect(vars).toMatchObject({
      '--thread-width': '3px',
      '--code-block-width': '720px',
    })

    // Side-by-side null overrides emit `initial` so a vault overriding Global's color/width back to null resets it
    const resetNull = pageOverrideVars(
      { ...DEFAULT_SETTINGS, threadColor: null, codeBlockWidth: null },
      { threadColor: null, codeBlockWidth: null },
    )
    expect(resetNull).toMatchObject({
      '--thread-color': 'initial',
      '--code-block-width': 'initial',
    })
  })

  it('runtime helpers track per-vault newPageDrawing and window searchIncludeInline', () => {
    setVaultNewPageDrawing('/v', 'file')
    expect(newPageDrawingOf('/v')).toBe('file')
    setVaultNewPageDrawing('/v', undefined)
    expect(newPageDrawingOf('/v')).toBe('inline')

    setWindowSearchIncludeInline(false)
    expect(windowSearchIncludeInline()).toBe(false)
    setWindowSearchIncludeInline(null)
    expect(windowSearchIncludeInline()).toBe(true)
  })
})
