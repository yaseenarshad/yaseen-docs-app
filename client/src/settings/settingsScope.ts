/**
 * Settings Dialog scope switcher model & context derivation (YAZ-6546, YAZ-6556).
 *
 * Supports:
 * - Single-vault windows: `Global defaults` | `This vault (<vaultName>)`
 * - Multi-vault windows:  `Global defaults` | `This workspace (<wsName>)` | `Vault: <Select>`
 * - Zero-vault windows:   no scope bar (global only).
 */
import { appCardLook, cardLookSettings } from '@shared/cardLook'
import { dailyPagesOfSettings, sameDailyPages, withDailyPages, type DailyPagesSettings } from '@shared/dailyPagesFile'
import { folderPagesFor as folderPagesOver } from '@shared/folderPages'
import { newPlacesOfSettings, vaultNewPlacesFields } from '@shared/newPlaces'
import { appTableLook } from '@shared/tableLook'
import { sanitizeSpacing, spacingOf, type PageSpacing } from '@shared/textFormatting'
import { DEFAULT_SETTINGS, type FolderPagesSettings, type SettingsState, type SidebarIconColors } from '@shared/types'
import type { IconRule } from '@shared/vaultIcons'
import {
  VAULT_CHROME_KEYS,
  VAULT_OVERRIDE_KEYS,
  isVaultChromeKey,
  isVaultOverrideKey,
  resolveVaultSettings,
  type VaultChromeKey,
  type VaultOverrideKey,
  type WorkspaceChromeOverrides,
} from '@shared/vaultSettings'
import type { LinkClickState } from '../explore/linkClick'
import type { VaultStorageState } from '../hooks/useVaultStorage'
import type { CardLookState } from '../review/useCardLook'
import type { ReviewSettingsState } from '../review/useReviewSettings'
import type { ShowIdsState } from '../search/showIds'
import type { ReadOnlyVaultState } from '../vault/readOnlyVault'
import type { UnitWordState } from '../vault/unitWord'
import { diffSettingsKeys } from './effectiveSettings'
import type { SettingDef, SettingsCtx, SettingsGroup, SettingsSection } from './registry'
import type { SettingsSyncCtx } from './SyncVaultControl'
import type { DailyPagesState } from './useDailyPages'
import type { FolderPagesFileState } from './useFolderPagesFile'
import type { LinkPillsState } from './useLinkPills'
import type { TableLookState } from './useTableLook'
import type { TextFormattingState } from './useTextFormatting'
import type { VaultNewPlacesState } from './useVaultNewPlaces'
import type { VaultSettingsState } from './useVaultSettings'

export type SettingsScopeMode = 'global' | 'vault' | 'workspace'

export interface SettingsScopeVault {
  root: string
  name: string
  vaultSettings: VaultSettingsState
  review: ReviewSettingsState
  linkClick: LinkClickState
  showIds: ShowIdsState
  unitWord: UnitWordState
  hasCards: boolean
  readOnlyVault: ReadOnlyVaultState
  ids: SettingsCtx['ids']
  sync: SettingsSyncCtx
  textFormatting: TextFormattingState
  cardLook: CardLookState
  tableLook: TableLookState
  folderPages: FolderPagesFileState
  linkPills: LinkPillsState
  dailyPages: DailyPagesState
  iconLook: { rules: readonly IconRule[]; colors: SidebarIconColors; save: (look: { rules?: IconRule[]; colors?: SidebarIconColors }) => void }
  newPlaces: VaultNewPlacesState
  storage?: VaultStorageState
  vaultLauncher?: SettingsCtx['vaultLauncher']
}

export interface SettingsScopeWorkspace {
  key: string
  name: string
  overrides: WorkspaceChromeOverrides
  setOverrides: (patch: Partial<WorkspaceChromeOverrides>, unset?: readonly VaultChromeKey[]) => void
  resetAll: () => void
}

export interface SettingsScopeCtx {
  vaults: readonly SettingsScopeVault[]
  activeVaultRoot: string
  workspace?: SettingsScopeWorkspace
  globalSettings: SettingsState
  onChangeGlobal: (next: SettingsState) => void
  saveDailyFor?: (next: DailyPagesSettings, vaultRoot: string) => void
}

export interface SettingRowScopeMeta {
  overridden?: boolean
  onReset?: () => void
  overriddenIn?: string
  scopeBadge?: 'Global' | 'Per-vault'
}

export interface ScopedSettingsResult {
  ctx: SettingsCtx
  rowMeta: (item: SettingDef, section: SettingsSection, group: SettingsGroup) => SettingRowScopeMeta
  overrideCount: number
  onResetAll?: () => void
  activeVault: SettingsScopeVault | null
}

const LEGACY_VAULT_ROW_IDS = new Set([
  'textFormatting',
  'spacingVault',
  'lineSpacing',
  'blockGap',
  'pageBulletIndent',
  'pageBulletGap',
  'pageSpacingPreview',
  'sidebarIconRules',
  'iconColoursVault',
  'iconRulesVault',
  'newPageLocation',
  'newBoardFolder',
  'dailyPages',
  'dailyPageFolder',
  'dailyPageFormat',
  'dailyPageDayFolder',
  'dailyPageOpens',
  'dailyPageTemplate',
  'vaultLauncher',
  'cardLookVault',
  'tableLookVault',
  'folderPagesVault',
])

const GLOBAL_ONLY_CARD_IDS = new Set(['githubToken', 'friendsSend', 'cardCourse'])
const GLOBAL_ONLY_FOLDER_PAGE_IDS = new Set(['hoverPreviewIn.folderViews', 'hoverPreviewIn.folderLinks'])

export function overrideKeyOf(item: SettingDef): VaultOverrideKey | undefined {
  if (item.overrideKey !== undefined) return item.overrideKey
  return isVaultOverrideKey(item.id) ? item.id : undefined
}

function isLegacyVaultRow(item: SettingDef, section: SettingsSection, group: SettingsGroup): boolean {
  if (section.vault === true || group.vault === true) return true
  if (section.id === 'tables') return true
  if (section.id === 'folderPages') return !GLOBAL_ONLY_FOLDER_PAGE_IDS.has(item.id)
  if (section.id === 'cards') return !GLOBAL_ONLY_CARD_IDS.has(item.id) && item.id !== 'cardSkillInSidebar'
  if (item.id.startsWith('sidebarIconColors.')) return true
  return LEGACY_VAULT_ROW_IDS.has(item.id)
}

function withVaultContext(given: SettingsCtx, scope: SettingsScopeCtx, vault: SettingsScopeVault): SettingsCtx {
  const { globalSettings } = scope
  const appTable = appTableLook(globalSettings)
  const vaultChoices = scope.vaults.map((v) => ({ root: v.root, name: v.name }))
  const noopChoose = () => undefined
  const vaultDaily = vault.dailyPages.file ?? dailyPagesOfSettings(globalSettings)
  const baseEffective = resolveVaultSettings(globalSettings, vault.vaultSettings.overrides)
  const effectiveSettings = withDailyPages(vaultNewPlacesFields(baseEffective, vault.newPlaces.value), vaultDaily)

  const onChange = (next: SettingsState) => {
    const overridePatch = diffSettingsKeys(effectiveSettings, next, VAULT_OVERRIDE_KEYS)
    if (Object.keys(overridePatch).length > 0) {
      void vault.vaultSettings.setOverrides(overridePatch)
    }

    const nextDaily = dailyPagesOfSettings(next)
    if (!sameDailyPages(nextDaily, dailyPagesOfSettings(effectiveSettings))) {
      if (scope.saveDailyFor !== undefined) scope.saveDailyFor(nextDaily, vault.root)
      else vault.dailyPages.save(nextDaily)
    }

    const nextPlaces = newPlacesOfSettings(next)
    if (JSON.stringify(nextPlaces) !== JSON.stringify(newPlacesOfSettings(effectiveSettings))) {
      vault.newPlaces.save(nextPlaces)
    }

    const overrideSet = new Set<string>(VAULT_OVERRIDE_KEYS)
    const dailyKeys = new Set(['dailyPages', 'dailyPageFolder', 'dailyPageFormat', 'dailyPageDayFolder', 'dailyPageOpens'])
    const placeKeys = new Set(['newPageLocation', 'newPageFolder', 'newBoardFolder', 'newBoardPictures', 'newBoardPicturesFolder', 'commentsHint'])
    const globalPatch: Record<string, unknown> = {}
    for (const k of Object.keys(next) as (keyof SettingsState)[]) {
      if (overrideSet.has(k) || dailyKeys.has(k) || placeKeys.has(k)) continue
      if (effectiveSettings[k] !== next[k] && JSON.stringify(effectiveSettings[k]) !== JSON.stringify(next[k])) {
        globalPatch[k] = next[k]
      }
    }
    if (Object.keys(globalPatch).length > 0) {
      scope.onChangeGlobal({ ...globalSettings, ...globalPatch })
    }
  }

  return {
    ...given,
    settings: effectiveSettings,
    onChange,
    sync: vault.sync,
    review: vault.review,
    linkClick: vault.linkClick,
    showIds: vault.showIds,
    linkPills: vault.linkPills,
    unitWord: vault.unitWord,
    hasCards: vault.hasCards,
    readOnlyVault: vault.readOnlyVault,
    ids: vault.ids,
    vaultName: scope.vaults.length > 1 ? vault.name : undefined,
    dailyPagesVault: scope.vaults.length > 1 ? vault.name : undefined,
    storage: vault.storage ?? given.storage,
    vaultLauncher: vault.vaultLauncher ?? given.vaultLauncher,
    textFormatting: {
      vaults: scope.vaults.map((v) => ({ root: v.root, name: v.name, state: v.textFormatting })),
      activeRoot: vault.root,
    },
    pageSpacing: {
      vaults: vaultChoices,
      root: vault.root,
      choose: given.pageSpacing?.choose ?? noopChoose,
      value:
        vault.textFormatting.formatting.spacing !== undefined
          ? spacingOf(vault.textFormatting.formatting.spacing)
          : {
              line: globalSettings.lineSpacing,
              blockGap: globalSettings.blockGap,
              bulletIndent: globalSettings.pageBulletIndent ?? DEFAULT_SETTINGS.pageBulletIndent,
              bulletGap: globalSettings.pageBulletGap ?? DEFAULT_SETTINGS.pageBulletGap,
            },
      save: (next: Required<PageSpacing>) => vault.textFormatting.save({ ...vault.textFormatting.formatting, spacing: sanitizeSpacing(next) ?? {} }),
    },
    cardLook: {
      vaults: vaultChoices,
      root: vault.root,
      choose: given.cardLook?.choose ?? noopChoose,
      value: vault.cardLook.look === null ? appCardLook(globalSettings) : cardLookSettings(vault.cardLook.look),
      save: vault.cardLook.save,
    },
    tableLook: {
      vaults: vaultChoices,
      root: vault.root,
      choose: given.tableLook?.choose ?? noopChoose,
      value: vault.tableLook.settings ?? appTable,
      save: vault.tableLook.save,
    },
    folderPages: {
      vaults: vaultChoices,
      root: vault.root,
      choose: given.folderPages?.choose ?? noopChoose,
      value: vault.folderPages.vault === null ? globalSettings.folderPages : folderPagesOver(globalSettings.folderPages, vault.folderPages.vault),
      save: (next: Partial<FolderPagesSettings>) => vault.folderPages.save(next),
    },
    iconLook: {
      vaults: vaultChoices,
      root: vault.root,
      choose: given.iconLook?.choose ?? noopChoose,
      rules: vault.iconLook.rules,
      colors: vault.iconLook.colors,
      save: vault.iconLook.save,
    },
  }
}

export function buildScopedSettings(
  given: SettingsCtx,
  mode: SettingsScopeMode,
  selectedVaultRoot: string | null,
): ScopedSettingsResult {
  const scope = given.scope
  if (scope === undefined || scope.vaults.length === 0) {
    return { ctx: given, rowMeta: () => ({}), overrideCount: 0, activeVault: null }
  }

  const activeVault = scope.vaults.find((v) => v.root === (selectedVaultRoot ?? scope.activeVaultRoot)) ?? scope.vaults[0]
  const ws = scope.workspace

  if (mode === 'vault') {
    const ctx = withVaultContext(given, scope, activeVault)
    const overrides = activeVault.vaultSettings.overrides
    const overrideCount = Object.keys(overrides).length
    return {
      ctx,
      activeVault,
      overrideCount,
      onResetAll: overrideCount > 0 ? () => void activeVault.vaultSettings.resetAll() : undefined,
      rowMeta: (item, section, group) => {
        const key = overrideKeyOf(item)
        if (key !== undefined) {
          const overridden = Object.hasOwn(overrides, key) && overrides[key] !== undefined
          return overridden
            ? { overridden: true, onReset: () => void activeVault.vaultSettings.setOverrides({}, [key]) }
            : {}
        }
        if (isLegacyVaultRow(item, section, group)) return {}
        return { scopeBadge: 'Global' }
      },
    }
  }

  if (mode === 'workspace' && ws !== undefined) {
    const wsEffective = resolveVaultSettings(scope.globalSettings, null, ws.overrides)
    const wsSettings = withDailyPages(vaultNewPlacesFields(wsEffective, activeVault.newPlaces.value), dailyPagesOfSettings(given.settings))
    const onChange = (next: SettingsState) => {
      const chromePatch = diffSettingsKeys(wsSettings, next, VAULT_CHROME_KEYS)
      if (Object.keys(chromePatch).length > 0) ws.setOverrides(chromePatch)

      const nextDaily = dailyPagesOfSettings(next)
      if (!sameDailyPages(nextDaily, dailyPagesOfSettings(wsSettings))) {
        if (scope.saveDailyFor !== undefined) scope.saveDailyFor(nextDaily, activeVault.root)
        else activeVault.dailyPages.save(nextDaily)
      }
      const nextPlaces = newPlacesOfSettings(next)
      if (JSON.stringify(nextPlaces) !== JSON.stringify(newPlacesOfSettings(wsSettings))) {
        activeVault.newPlaces.save(nextPlaces)
      }

      const chromeSet = new Set<string>(VAULT_CHROME_KEYS)
      const dailyKeys = new Set(['dailyPages', 'dailyPageFolder', 'dailyPageFormat', 'dailyPageDayFolder', 'dailyPageOpens'])
      const placeKeys = new Set(['newPageLocation', 'newPageFolder', 'newBoardFolder', 'newBoardPictures', 'newBoardPicturesFolder', 'commentsHint'])
      const rest: Record<string, unknown> = {}
      for (const k of Object.keys(next) as (keyof SettingsState)[]) {
        if (chromeSet.has(k) || dailyKeys.has(k) || placeKeys.has(k)) continue
        if (wsSettings[k] !== next[k] && JSON.stringify(wsSettings[k]) !== JSON.stringify(next[k])) rest[k] = next[k]
      }
      if (Object.keys(rest).length > 0) scope.onChangeGlobal({ ...scope.globalSettings, ...rest })
    }
    const overrideCount = Object.keys(ws.overrides).length
    return {
      ctx: { ...given, settings: wsSettings, onChange },
      activeVault,
      overrideCount,
      onResetAll: overrideCount > 0 ? ws.resetAll : undefined,
      rowMeta: (item, section, group) => {
        const key = overrideKeyOf(item)
        if (key !== undefined) {
          if (isVaultChromeKey(key)) {
            const overridden = Object.hasOwn(ws.overrides, key) && ws.overrides[key] !== undefined
            return overridden ? { overridden: true, onReset: () => ws.setOverrides({}, [key]) } : {}
          }
          return { scopeBadge: 'Per-vault' }
        }
        if (isLegacyVaultRow(item, section, group)) return { scopeBadge: 'Per-vault' }
        if (item.id === 'workspaceLauncher') return {}
        return { scopeBadge: 'Global' }
      },
    }
  }

  // Global defaults mode
  const globalShown = withDailyPages(
    vaultNewPlacesFields(scope.globalSettings, activeVault.newPlaces.value),
    dailyPagesOfSettings(given.settings),
  )
  const onChangeGlobalMode = (next: SettingsState) => {
    const nextDaily = dailyPagesOfSettings(next)
    const nextPlaces = newPlacesOfSettings(next)
    if (
      !sameDailyPages(nextDaily, dailyPagesOfSettings(globalShown)) ||
      JSON.stringify(nextPlaces) !== JSON.stringify(newPlacesOfSettings(globalShown))
    ) {
      given.onChange(next)
      return
    }
    const appNext = withDailyPages(
      vaultNewPlacesFields(next, newPlacesOfSettings(scope.globalSettings)),
      dailyPagesOfSettings(scope.globalSettings),
    )
    scope.onChangeGlobal(appNext)
  }

  return {
    ctx: { ...given, settings: globalShown, onChange: onChangeGlobalMode },
    activeVault,
    overrideCount: 0,
    rowMeta: (item) => {
      const key = overrideKeyOf(item)
      if (key === undefined) return {}
      if (ws !== undefined && isVaultChromeKey(key) && Object.hasOwn(ws.overrides, key) && ws.overrides[key] !== undefined) {
        return { overriddenIn: ws.name }
      }
      if (Object.hasOwn(activeVault.vaultSettings.overrides, key) && activeVault.vaultSettings.overrides[key] !== undefined) {
        return { overriddenIn: activeVault.name }
      }
      const other = scope.vaults.find((v) => v.root !== activeVault.root && Object.hasOwn(v.vaultSettings.overrides, key) && v.vaultSettings.overrides[key] !== undefined)
      if (other !== undefined) return { overriddenIn: other.name }
      return {}
    },
  }
}
