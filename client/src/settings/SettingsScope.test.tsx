/**
 * Tests for the Top-of-Settings Scope Switcher (YAZ-6546, YAZ-6556):
 * - Hidden with 0 vaults open
 * - Single-vault segmented pill (`Global defaults` | `This vault (<name>)`)
 * - Multi-vault segmented pill (`Global defaults` | `This workspace (<name>)` | `Vault: <Select>`)
 * - Override dot + 1-click Reset + Reset all in Vault and Workspace modes
 * - "Overridden in <name>" note in Global defaults mode
 * - Global / Per-vault badges on non-applicable rows (never hidden from search!)
 * - Legacy per-vault sections targeting the selected vault in Vault mode
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_LINK_CLICK } from '@shared/linkClick'
import { DEFAULT_SHOW_IDS } from '@shared/showIds'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { DEFAULT_UNIT_WORD, PAGE_WORD, SAME_WORD } from '@shared/unitWord'
import { DEFAULT_SETTINGS, DEFAULT_SIDEBAR_TABS, type SettingsState } from '@shared/types'
import type { VaultOverrideKey, VaultSettingsOverrides, WorkspaceChromeOverrides } from '@shared/vaultSettings'
import { NO_TEXT_FORMATTING } from './useTextFormatting'
import { NO_NEW_PLACES } from './useVaultNewPlaces'
import { buildScopedSettings, type SettingsScopeCtx, type SettingsScopeMode, type SettingsScopeVault } from './settingsScope'
import type { SettingDef, SettingsGroup, SettingsSection, SettingsSectionId } from './registry'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function makeScopeVault(rootPath: string, name: string, overrides: VaultSettingsOverrides = {}): SettingsScopeVault {
  return {
    root: rootPath,
    name,
    vaultSettings: {
      doc: Object.keys(overrides).length > 0 ? { version: 1, ...overrides } : null,
      overrides,
      ready: true,
      malformed: false,
      setOverrides: vi.fn(async () => undefined),
      setSection: vi.fn(async () => undefined),
      resetAll: vi.fn(async () => undefined),
    },
    review: { settings: DEFAULT_REVIEW_SETTINGS, save: vi.fn(), ready: true },
    linkClick: { settings: DEFAULT_LINK_CLICK, save: vi.fn(), isExplore: () => true },
    showIds: { settings: DEFAULT_SHOW_IDS, save: vi.fn(), inSearch: () => 'number', inTitle: () => true },
    unitWord: { settings: DEFAULT_UNIT_WORD, word: PAGE_WORD, unit: SAME_WORD, save: vi.fn() },
    hasCards: false,
    readOnlyVault: {
      settings: { on: false },
      save: vi.fn(),
      locked: false,
      fileActionsAllowed: () => true,
      unlock: vi.fn(),
      lock: vi.fn(),
      unlockedUntil: null,
      beforeLock: () => () => undefined,
    },
    ids: undefined,
    sync: { status: { root: rootPath, state: 'off' }, setEnabled: vi.fn() },
    textFormatting: { formatting: NO_TEXT_FORMATTING, save: vi.fn() },
    cardLook: { look: null, save: vi.fn() },
    tableLook: { look: null, settings: null, save: vi.fn() },
    folderPages: { file: null, vault: null, save: vi.fn() },
    linkPills: { pills: NO_LINK_PILLS, save: vi.fn() },
    dailyPages: { file: null, save: vi.fn() },
    iconLook: { rules: [], colors: {}, save: vi.fn() },
    newPlaces: { value: NO_NEW_PLACES, save: vi.fn() },
  }
}

function mountScoped(opts: {
  globalSettings?: SettingsState
  vaults?: SettingsScopeVault[]
  wsOverrides?: WorkspaceChromeOverrides
  wsName?: string
  initialPage?: SettingsSectionId
  initialScope?: SettingsScopeMode
  initialSettingId?: string
}) {
  const globalSettings = opts.globalSettings ?? { ...DEFAULT_SETTINGS }
  const vaults = opts.vaults ?? []
  const onChangeGlobal = vi.fn()
  const onChange = vi.fn()
  const wsSetOverrides = vi.fn()
  const wsResetAll = vi.fn()
  const scope: SettingsScopeCtx | undefined =
    vaults.length === 0
      ? undefined
      : {
          vaults,
          activeVaultRoot: vaults[0].root,
          workspace:
            vaults.length >= 2
              ? {
                  key: 'ws:test',
                  name: opts.wsName ?? 'Work',
                  overrides: opts.wsOverrides ?? {},
                  setOverrides: wsSetOverrides,
                  resetAll: wsResetAll,
                }
              : undefined,
          globalSettings,
          onChangeGlobal,
        }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <SettingsDialog
        ctx={{ settings: globalSettings, onChange, review: vaults[0]?.review, scope }}
        onClose={vi.fn()}
        initialPage={opts.initialPage}
        initialScope={opts.initialScope}
        initialSettingId={opts.initialSettingId}
      />,
    )
  })
  return { el: container, onChange, onChangeGlobal, wsSetOverrides, wsResetAll, vaults }
}

const clickNav = (el: HTMLElement, title: string) => {
  const btn = [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === title)
  act(() => btn?.click())
}

const clickScopeTab = (el: HTMLElement, textIncludes: string) => {
  const btn = [...el.querySelectorAll<HTMLButtonElement>('.settings-scope__tab, .settings-scope__vault-btn')].find((b) =>
    b.textContent?.includes(textIncludes),
  )
  act(() => btn?.click())
}

describe('SettingsDialog scope switcher (YAZ-6546, YAZ-6556)', () => {
  it('hides the scope bar when 0 vaults are open', () => {
    const { el } = mountScoped({ vaults: [] })
    expect(el.querySelector('.settings-scope-bar')).toBeNull()
  })

  it('single-vault window shows Global defaults | This vault (<name>), writes sparse vault overrides, and supports 1-click Reset', () => {
    const vault = makeScopeVault('/v', 'Personal', { contentWidth: 'medium' })
    const { el, onChangeGlobal } = mountScoped({ vaults: [vault] })

    const bar = el.querySelector('.settings-scope-bar')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('Global defaults')
    expect(bar?.textContent).toContain('This vault (Personal)')

    // Global defaults mode shows "Overridden in Personal" on Content width
    clickNav(el, 'Appearance')
    const widthRow = el.querySelector('[data-setting="contentWidth"]')
    expect(widthRow?.querySelector('.setting__scope-note')?.textContent).toBe('Overridden in Personal')

    // Switch to This vault mode
    clickScopeTab(el, 'This vault')
    const vaultWidthRow = el.querySelector('[data-setting="contentWidth"]')!
    expect(vaultWidthRow.querySelector('.setting__override-dot')).not.toBeNull()
    const resetBtn = vaultWidthRow.querySelector<HTMLButtonElement>('.setting__reset')
    expect(resetBtn).not.toBeNull()

    // Global-only row (Theme) stays visible with "Global" badge
    const themeRow = el.querySelector('[data-setting="theme"]')
    expect(themeRow?.querySelector('.setting__scope-badge')?.textContent).toBe('Global')

    // Clicking Content position writes sparsely to vault.vaultSettings.setOverrides (not global)
    const posRow = el.querySelector('[data-setting="contentPosition"]')!
    const leftBtn = [...posRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Left')
    act(() => leftBtn?.click())
    expect(vault.vaultSettings.setOverrides).toHaveBeenCalledWith({ contentPosition: 'left' })
    expect(onChangeGlobal).not.toHaveBeenCalled()

    // Clicking 1-click Reset unsets contentWidth from vault settings.json
    act(() => resetBtn?.click())
    expect(vault.vaultSettings.setOverrides).toHaveBeenCalledWith({}, ['contentWidth' satisfies VaultOverrideKey])

    // Clicking Reset all calls vault.vaultSettings.resetAll
    const resetAllBtn = el.querySelector<HTMLButtonElement>('.settings-scope__reset-all')
    expect(resetAllBtn?.textContent).toBe('Reset all (1)')
    act(() => resetAllBtn?.click())
    expect(vault.vaultSettings.resetAll).toHaveBeenCalledTimes(1)
  })

  it('multi-vault window shows Global defaults | This workspace (<name>) | Vault selector and routes chrome vs per-vault writes', () => {
    const v1 = makeScopeVault('/v1', 'Notes', { contentWidth: 'full' })
    const v2 = makeScopeVault('/v2', 'Work', { contentWidth: 'medium' })
    const { el, wsSetOverrides, wsResetAll } = mountScoped({
      vaults: [v1, v2],
      wsName: 'Daily Focus',
      wsOverrides: { tabWidth: 'wide' },
    })

    const bar = el.querySelector('.settings-scope-bar')!
    expect(bar.textContent).toContain('Global defaults')
    expect(bar.textContent).toContain('This workspace (Daily Focus)')
    expect(bar.querySelector<HTMLSelectElement>('.settings-scope__select')).not.toBeNull()

    // Global defaults mode hints "Overridden in Daily Focus" for workspace chrome key tabWidth
    clickNav(el, 'Appearance')
    expect(el.querySelector('[data-setting="tabWidth"] .setting__scope-note')?.textContent).toBe('Overridden in Daily Focus')

    // Switch to This workspace mode
    clickScopeTab(el, 'This workspace')
    const tabWidthRow = el.querySelector('[data-setting="tabWidth"]')!
    expect(tabWidthRow.querySelector('.setting__override-dot')).not.toBeNull()
    expect(el.querySelector('[data-setting="contentWidth"] .setting__scope-badge')?.textContent).toBe('Per-vault')
    expect(el.querySelector('[data-setting="theme"] .setting__scope-badge')?.textContent).toBe('Global')

    // Changing inactiveTabWidth writes to workspace chrome overrides
    const inactiveRow = el.querySelector('[data-setting="inactiveTabWidth"]')!
    const compactBtn = [...inactiveRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Compact')
    act(() => compactBtn?.click())
    expect(wsSetOverrides).toHaveBeenCalledWith({ inactiveTabWidth: 'compact' })

    // Reset all in workspace mode calls wsResetAll
    act(() => el.querySelector<HTMLButtonElement>('.settings-scope__reset-all')?.click())
    expect(wsResetAll).toHaveBeenCalledTimes(1)

    // Picking second vault from Vault dropdown switches to Vault mode targeting v2
    const select = el.querySelector<HTMLSelectElement>('.settings-scope__select')!
    act(() => {
      select.value = '/v2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.querySelector('.settings-scope-bar')?.getAttribute('data-scope-mode')).toBe('vault')
    expect(el.querySelector('[data-setting="contentWidth"] .setting__override-dot')).not.toBeNull()
    const posRow = el.querySelector('[data-setting="contentPosition"]')!
    const leftBtn = [...posRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Left')
    act(() => leftBtn?.click())
    expect(v2.vaultSettings.setOverrides).toHaveBeenCalledWith({ contentPosition: 'left' })
    expect(v1.vaultSettings.setOverrides).not.toHaveBeenCalled()
  })

  it('editing a global setting in Workspace mode never leaks workspace/vault overrides into Global defaults', () => {
    const v1 = makeScopeVault('/v1', 'Notes', { contentWidth: 'full' })
    const v2 = makeScopeVault('/v2', 'Work', {})
    const { el, onChangeGlobal } = mountScoped({
      vaults: [v1, v2],
      wsName: 'Daily Focus',
      wsOverrides: { tabWidth: 'wide' },
    })

    clickNav(el, 'Appearance')
    clickScopeTab(el, 'This workspace')
    const themeRow = el.querySelector('[data-setting="theme"]')!
    const darkBtn = [...themeRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Dark')
    act(() => darkBtn?.click())
    expect(onChangeGlobal).toHaveBeenCalledTimes(1)
    const saved = onChangeGlobal.mock.calls[0][0] as SettingsState
    expect(saved.theme).toBe('dark')
    // Must keep Global defaults for tabWidth and contentWidth (never leaking workspace/vault overrides)
    expect(saved.tabWidth).toBe(DEFAULT_SETTINGS.tabWidth)
    expect(saved.contentWidth).toBe(DEFAULT_SETTINGS.contentWidth)
  })

  it('YAZ-6597: cardTips shows Global badge while all 6 Inbox rows are vault-only in Vault and Workspace modes', () => {
    const v1 = makeScopeVault('/v1', 'Notes', {})
    const v2 = makeScopeVault('/v2', 'Work', {})
    const { el, onChangeGlobal } = mountScoped({ vaults: [v1, v2], wsName: 'Daily Focus' })

    clickNav(el, 'Cards')
    clickScopeTab(el, 'This workspace')
    expect(el.querySelector('[data-setting="cardTips"] .setting__scope-badge')?.textContent).toBe('Global')
    for (const id of ['spaceBehavior', 'cardLocation', 'focusHidesSidebar', 'inboxOpenAt', 'loopArrows', 'timeSoFar']) {
      expect(el.querySelector(`[data-setting="${id}"] .setting__scope-badge`)?.textContent, id).toBe('Per-vault')
    }

    // Switch to Vault mode targeting v1
    const select = el.querySelector<HTMLSelectElement>('.settings-scope__select')!
    act(() => {
      select.value = '/v1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.querySelector('[data-setting="cardTips"] .setting__scope-badge')?.textContent).toBe('Global')
    for (const id of ['spaceBehavior', 'cardLocation', 'focusHidesSidebar', 'inboxOpenAt', 'loopArrows', 'timeSoFar']) {
      const rowEl = el.querySelector(`[data-setting="${id}"]`)
      expect(rowEl, id).not.toBeNull()
      expect(rowEl?.querySelector('.setting__scope-badge'), id).toBeNull()
      expect(rowEl?.querySelector('.setting__override-dot'), id).toBeNull()
    }

    // Changing Spacebar during review in Vault mode writes through v1.review.save (never global or vaultSettings overrides)
    const spaceRow = el.querySelector('[data-setting="spaceBehavior"]')!
    const jumpBtn = [...spaceRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Jump to next hidden word')
    act(() => jumpBtn?.click())
    expect(v1.review.save).toHaveBeenCalledWith({ ...DEFAULT_REVIEW_SETTINGS, spaceBehavior: 'jump' })
    expect(v1.vaultSettings.setOverrides).not.toHaveBeenCalled()
    expect(onChangeGlobal).not.toHaveBeenCalled()
  })

  it('multi-vault Vault view chrome rows show workspace-wins warning and Edit workspace jumps to workspace scope (YAZ-6593)', () => {
    const v1 = makeScopeVault('/v1', 'Notes', { tabWidth: 'compact', contentWidth: 'medium' })
    const v2 = makeScopeVault('/v2', 'Work', {})
    const { el } = mountScoped({
      vaults: [v1, v2],
      wsName: 'Daily Focus',
      wsOverrides: { tabWidth: 'wide' },
      initialPage: 'appearance',
      initialScope: 'vault',
    })

    expect(el.querySelector('.settings-scope-bar')?.getAttribute('data-scope-mode')).toBe('vault')

    // Chrome row in Vault mode shows workspace-wins warning + Edit workspace jump button
    const tabWidthRow = el.querySelector('[data-setting="tabWidth"]')!
    const warn = tabWidthRow.querySelector('.setting__scope-warn')
    expect(warn).not.toBeNull()
    expect(warn?.textContent).toContain('Used when opened alone · This window uses Daily Focus.')
    const jumpBtn = warn?.querySelector<HTMLButtonElement>('.setting__scope-jump')
    expect(jumpBtn?.textContent).toBe('Edit workspace')

    // Non-chrome per-vault row has NO workspace-wins warning
    expect(el.querySelector('[data-setting="contentWidth"] .setting__scope-warn')).toBeNull()

    // Sidebar chrome rows also show workspace-wins warning
    clickNav(el, 'Sidebar')
    expect(el.querySelector('[data-setting="sidebarRowHeight"] .setting__scope-warn')?.textContent).toContain(
      'Used when opened alone · This window uses Daily Focus.',
    )

    // Clicking Edit workspace jumps to workspace scope
    const sidebarJump = el.querySelector<HTMLButtonElement>('[data-setting="sidebarRowHeight"] .setting__scope-jump')
    act(() => sidebarJump?.click())
    expect(el.querySelector('.settings-scope-bar')?.getAttribute('data-scope-mode')).toBe('workspace')
    expect(el.querySelector('[data-setting="sidebarRowHeight"] .setting__scope-warn')).toBeNull()
  })

  it('single-vault Vault view never shows workspace-wins warning on chrome rows (YAZ-6593)', () => {
    const vault = makeScopeVault('/v', 'Personal', { tabWidth: 'compact' })
    const { el } = mountScoped({ vaults: [vault], initialPage: 'appearance', initialScope: 'vault' })
    expect(el.querySelector('[data-setting="tabWidth"] .setting__scope-warn')).toBeNull()
  })

  it('sidebarTabs is Vault/Workspace-only: never emits overridden, onReset, or overriddenIn, and is excluded from overrideCount (YAZ-6593)', () => {
    const customTabs = { ...DEFAULT_SIDEBAR_TABS, hidden: ['search' as const] }
    const v1 = makeScopeVault('/v1', 'Notes', { sidebarTabs: customTabs })
    const v2 = makeScopeVault('/v2', 'Work', { sidebarTabs: customTabs, contentWidth: 'full' })
    const sidebarTabsItem: SettingDef = { id: 'sidebarTabs', label: 'Tab row', render: () => null }
    const dummySection: SettingsSection = { id: 'sidebar', title: 'Sidebar', groups: [] }
    const dummyGroup: SettingsGroup = { items: [sidebarTabsItem] }
    const scope: SettingsScopeCtx = {
      vaults: [v1, v2],
      activeVaultRoot: v1.root,
      workspace: {
        key: 'ws-name:daily focus',
        name: 'Daily Focus',
        overrides: { sidebarTabs: customTabs },
        setOverrides: vi.fn(),
        resetAll: vi.fn(),
      },
      globalSettings: { ...DEFAULT_SETTINGS },
      onChangeGlobal: vi.fn(),
    }
    const baseCtx = { settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), scope }

    // Global mode: no overriddenIn note
    const globalScoped = buildScopedSettings(baseCtx, 'global', v1.root)
    expect(globalScoped.rowMeta(sidebarTabsItem, dummySection, dummyGroup)).toEqual({})

    // Workspace mode: no overridden/onReset and excluded from overrideCount
    const wsScoped = buildScopedSettings(baseCtx, 'workspace', v1.root)
    expect(wsScoped.rowMeta(sidebarTabsItem, dummySection, dummyGroup)).toEqual({})
    expect(wsScoped.overrideCount).toBe(0)
    expect(wsScoped.onResetAll).toBeUndefined()

    // Multi-vault Vault mode: still emits workspaceWinsName, but no overridden/onReset and excluded from overrideCount
    const vaultScoped = buildScopedSettings(baseCtx, 'vault', v1.root)
    expect(vaultScoped.rowMeta(sidebarTabsItem, dummySection, dummyGroup)).toEqual({ workspaceWinsName: 'Daily Focus' })
    expect(vaultScoped.overrideCount).toBe(0)
    expect(vaultScoped.onResetAll).toBeUndefined()

    // Vault v2 has sidebarTabs + contentWidth: overrideCount counts only contentWidth (1)
    const v2Scoped = buildScopedSettings(baseCtx, 'vault', v2.root)
    expect(v2Scoped.overrideCount).toBe(1)
    expect(v2Scoped.onResetAll).toBeDefined()

    // Single-vault Vault mode: empty meta (no workspaceWinsName, no overridden/onReset)
    const singleScope: SettingsScopeCtx = { ...scope, vaults: [v1], workspace: undefined }
    const singleVaultScoped = buildScopedSettings({ ...baseCtx, scope: singleScope }, 'vault', v1.root)
    expect(singleVaultScoped.rowMeta(sidebarTabsItem, dummySection, dummyGroup)).toEqual({})
    expect(singleVaultScoped.overrideCount).toBe(0)
  })

  it('SettingsDialog respects initialScope and scrolls initialSettingId into view on mount (YAZ-6593)', () => {
    const v1 = makeScopeVault('/v1', 'Notes', {})
    const v2 = makeScopeVault('/v2', 'Work', {})
    const scrollSpy = vi.fn()
    const origScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollSpy
    try {
      const { el } = mountScoped({
        vaults: [v1, v2],
        wsName: 'Daily Focus',
        initialPage: 'sidebar',
        initialScope: 'workspace',
        initialSettingId: 'sidebarRowHeight',
      })
      expect(el.querySelector('.settings-scope-bar')?.getAttribute('data-scope-mode')).toBe('workspace')
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollSpy.mock.instances[0]).toBe(el.querySelector('[data-setting="sidebarRowHeight"]'))
    } finally {
      Element.prototype.scrollIntoView = origScroll
    }
  })
})
