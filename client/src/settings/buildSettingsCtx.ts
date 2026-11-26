/**
 * Assembles the `SettingsCtx` passed from `App.tsx` to `SettingsDialog` (YAZ-6546, YAZ-6556),
 * including the `scope` payload for the top-of-Settings Global / Vault / Workspace switcher.
 *
 * Extracted from `App.tsx` to keep `App.tsx` well under its architectural line-count ratchet.
 */
import { appCardLook, cardLookSettings } from '@shared/cardLook'
import { folderPagesFor as folderPagesOver, type FolderPagesVault } from '@shared/folderPages'
import { appTableLook } from '@shared/tableLook'
import { sanitizeSpacing, spacingOf, type PageSpacing } from '@shared/textFormatting'
import { DEFAULT_SETTINGS, type FolderPagesSettings, type SettingsState } from '@shared/types'
import type { DailyPagesSettings } from '@shared/dailyPagesFile'
import type { VaultChromeKey, WorkspaceChromeOverrides } from '@shared/vaultSettings'
import type { VaultStorageState } from '../hooks/useVaultStorage'
import type { IconLook, VaultIconsHere } from '../sidebar/useVaultIcons'
import { workspaceLauncherCtx } from '../hooks/useVaultLauncherIcons'
import { basename } from '../lib/paths'
import { storage } from '../lib/storage'
import type { SharingState } from '../share/useSharing'
import type { PlaceVault } from '../sidebar/PlacePicker'
import type { VaultScope } from '../vault/useVaultScope'
import type { SettingsCtx } from './registry'
import type { SettingsScopeVault, SettingsScopeWorkspace } from './settingsScope'

export interface BuildSettingsCtxInput {
  roots: readonly string[]
  vaults: readonly VaultScope[]
  active: VaultScope
  appSettings: SettingsState
  settings: SettingsState
  onChange: (next: SettingsState) => void
  onChangeGlobal: (next: SettingsState) => void
  matchedWorkspaceName: string | null
  wsKey: string | null
  wsChromeOverrides: WorkspaceChromeOverrides
  onWriteWorkspaceChrome: (patch: Partial<WorkspaceChromeOverrides>, unset?: readonly VaultChromeKey[]) => void
  onResetWorkspaceChrome: () => void
  dailyHereRoot: string | null
  saveDaily: (next: DailyPagesSettings, vault?: string) => void
  openDailyTemplate: () => void
  openCourse: () => void
  pickDailyFolder: (folder: string, vault: string) => void
  vaultStorage: VaultStorageState
  sharing: SharingState
  vaultIcons: VaultIconsHere
  placeVaults: readonly PlaceVault[]
  refreshLauncherIcons: () => void
  pickers: {
    spacingRoot: string | null
    setSpacingRoot: (root: string | null) => void
    cardLookRoot: string | null
    setCardLookRoot: (root: string | null) => void
    tableLookRoot: string | null
    setTableLookRoot: (root: string | null) => void
    folderPagesRoot: string | null
    setFolderPagesRoot: (root: string | null) => void
    iconLookRoot: string | null
    setIconLookRoot: (root: string | null) => void
  }
}

const vaultLauncherFor = (vault: VaultScope, refreshLauncherIcons: () => void): SettingsCtx['vaultLauncher'] =>
  vault.root !== null && /Mac/i.test(navigator.platform) && typeof window.yaseenDocs?.vaultLauncher?.status === 'function'
    ? { root: vault.root, defaultName: vault.name ?? basename(vault.root), onChanged: refreshLauncherIcons }
    : undefined

export function buildSettingsDialogCtx(input: BuildSettingsCtxInput): SettingsCtx {
  const {
    roots,
    vaults,
    active,
    appSettings,
    settings,
    onChange,
    onChangeGlobal,
    matchedWorkspaceName,
    wsKey,
    wsChromeOverrides,
    onWriteWorkspaceChrome,
    onResetWorkspaceChrome,
    dailyHereRoot,
    saveDaily,
    openDailyTemplate,
    openCourse,
    pickDailyFolder,
    vaultStorage,
    sharing,
    vaultIcons,
    placeVaults,
    refreshLauncherIcons,
    pickers,
  } = input
  const root = roots[0] ?? null
  const appTable = appTableLook(appSettings)
  const scopeOfPicked = (picked: string | null): VaultScope => (picked !== null && roots.includes(picked) ? vaults[roots.indexOf(picked)] : null) ?? active

  const spacingScope = scopeOfPicked(pickers.spacingRoot)
  const settingsPageSpacing =
    root === null || spacingScope.root === null
      ? undefined
      : {
          vaults: placeVaults,
          root: spacingScope.root,
          choose: pickers.setSpacingRoot,
          value:
            spacingScope.textFormatting.formatting.spacing !== undefined
              ? spacingOf(spacingScope.textFormatting.formatting.spacing)
              : {
                  line: appSettings.lineSpacing,
                  blockGap: appSettings.blockGap,
                  bulletIndent: appSettings.pageBulletIndent ?? DEFAULT_SETTINGS.pageBulletIndent,
                  bulletGap: appSettings.pageBulletGap ?? DEFAULT_SETTINGS.pageBulletGap,
                },
          save: (next: Required<PageSpacing>) => spacingScope.textFormatting.save({ ...spacingScope.textFormatting.formatting, spacing: sanitizeSpacing(next) ?? {} }),
        }

  const cardLookScope = scopeOfPicked(pickers.cardLookRoot)
  const settingsCardLook =
    root === null || cardLookScope.root === null
      ? undefined
      : {
          vaults: placeVaults,
          root: cardLookScope.root,
          choose: pickers.setCardLookRoot,
          value: cardLookScope.cardLook.look === null ? appCardLook(appSettings) : cardLookSettings(cardLookScope.cardLook.look),
          save: cardLookScope.cardLook.save,
        }

  const tableLookScope = scopeOfPicked(pickers.tableLookRoot)
  const settingsTableLook =
    root === null || tableLookScope.root === null
      ? undefined
      : {
          vaults: placeVaults,
          root: tableLookScope.root,
          choose: pickers.setTableLookRoot,
          value: tableLookScope.tableLook.settings ?? appTable,
          save: tableLookScope.tableLook.save,
        }

  const folderPagesScope = scopeOfPicked(pickers.folderPagesRoot)
  const settingsFolderPages =
    root === null || folderPagesScope.root === null
      ? undefined
      : {
          vaults: placeVaults,
          root: folderPagesScope.root,
          choose: pickers.setFolderPagesRoot,
          value: folderPagesScope.folderPages.vault === null ? appSettings.folderPages : folderPagesOver(appSettings.folderPages, folderPagesScope.folderPages.vault as FolderPagesVault),
          save: (next: Partial<FolderPagesSettings>) => folderPagesScope.folderPages.save(next),
        }

  const iconLookRoot = pickers.iconLookRoot !== null && roots.includes(pickers.iconLookRoot) ? pickers.iconLookRoot : active.root
  const iconLookOwn = vaultIcons.lookOf(iconLookRoot)
  const settingsIconLook =
    root === null || iconLookRoot === null
      ? undefined
      : {
          vaults: placeVaults,
          root: iconLookRoot,
          choose: pickers.setIconLookRoot,
          rules: iconLookOwn.rules ?? appSettings.sidebarIconRules,
          colors: iconLookOwn.colors ?? appSettings.sidebarIconColors,
          save: (look: IconLook) => vaultIcons.saveLook(iconLookRoot, look),
        }

  const settingsTextFormatting =
    root === null
      ? undefined
      : {
          vaults: vaults.map((vault, i) => ({ root: roots[i], name: vault.name ?? storage.vaultName(roots[i]), state: vault.textFormatting })),
          activeRoot: active.root ?? roots[0],
        }

  const scopeVaults: SettingsScopeVault[] = vaults
    .map((vault, i): SettingsScopeVault | null => {
      const vRoot = roots[i]
      if (vRoot === undefined || vault === undefined) return null
      const ownIcons = vaultIcons.lookOf(vRoot)
      return {
        root: vRoot,
        name: vault.name ?? storage.vaultName(vRoot),
        vaultSettings: vault.vaultSettings,
        review: vault.reviewSettings,
        linkClick: vault.linkClick,
        showIds: vault.showIds,
        unitWord: vault.unit,
        hasCards: vault.wikilinks.records.some((r) => (r.cards?.length ?? 0) > 0),
        readOnlyVault: vault.readOnlyVault,
        ids: vault.ids,
        sync: {
          status: vault.sync.status,
          setEnabled: vault.sync.setEnabled,
          autoSync: vault.sync.autoSync,
          addToAutoSync: vault.sync.addToAutoSync,
          openAutoSync: vault.sync.openAutoSync,
          refreshAutoSync: vault.sync.refreshAutoSync,
        },
        textFormatting: vault.textFormatting,
        cardLook: vault.cardLook,
        tableLook: vault.tableLook,
        folderPages: vault.folderPages,
        linkPills: vault.linkPills,
        dailyPages: vault.dailyPages,
        iconLook: {
          rules: ownIcons.rules ?? appSettings.sidebarIconRules,
          colors: ownIcons.colors ?? appSettings.sidebarIconColors,
          save: (look: IconLook) => vaultIcons.saveLook(vRoot, look),
        },
        newPlaces: vault.newPlaces,
        storage: vRoot === active.root ? vaultStorage : undefined,
        vaultLauncher: vaultLauncherFor(vault, refreshLauncherIcons),
      }
    })
    .filter((v): v is SettingsScopeVault => v !== null)

  const workspaceScope: SettingsScopeWorkspace | undefined =
    roots.length >= 2 && wsKey !== null
      ? {
          key: wsKey,
          name: matchedWorkspaceName ?? 'Workspace',
          overrides: wsChromeOverrides,
          setOverrides: onWriteWorkspaceChrome,
          resetAll: onResetWorkspaceChrome,
        }
      : undefined

  return {
    openDailyTemplate: root === null ? undefined : openDailyTemplate,
    openCourse,
    pickDailyFolder: root === null ? undefined : pickDailyFolder,
    dailyPagesVault: roots.length > 1 ? (vaults[roots.indexOf(dailyHereRoot ?? active.root ?? '')]?.name ?? undefined) : undefined,
    settings,
    onChange,
    sync: {
      status: active.sync.status,
      setEnabled: active.sync.setEnabled,
      autoSync: active.sync.autoSync,
      addToAutoSync: active.sync.addToAutoSync,
      openAutoSync: active.sync.openAutoSync,
      refreshAutoSync: active.sync.refreshAutoSync,
    },
    review: root === null ? undefined : active.reviewSettings,
    linkClick: root === null ? undefined : active.linkClick,
    readOnlyVault: root === null ? undefined : active.readOnlyVault,
    showIds: root === null ? undefined : active.showIds,
    linkPills: root === null ? undefined : active.linkPills,
    unitWord: root === null ? undefined : active.unit,
    hasCards: root !== null && active.wikilinks.records.some((r) => (r.cards?.length ?? 0) > 0),
    ids: active.ids,
    vaultName: roots.length > 1 ? (active.name ?? undefined) : undefined,
    storage: active.root === null ? undefined : vaultStorage,
    sharing,
    textFormatting: settingsTextFormatting,
    pageSpacing: settingsPageSpacing,
    iconLook: settingsIconLook,
    cardLook: settingsCardLook,
    tableLook: settingsTableLook,
    folderPages: settingsFolderPages,
    places: root === null ? undefined : placeVaults,
    vaultLauncher: vaultLauncherFor(active, refreshLauncherIcons),
    workspaceLauncher: workspaceLauncherCtx(roots, refreshLauncherIcons),
    scope:
      scopeVaults.length === 0
        ? undefined
        : {
            vaults: scopeVaults,
            activeVaultRoot: active.root ?? scopeVaults[0].root,
            workspace: workspaceScope,
            globalSettings: appSettings,
            onChangeGlobal,
            saveDailyFor: (next, vaultRoot) => saveDaily(next, vaultRoot),
          },
  }
}
