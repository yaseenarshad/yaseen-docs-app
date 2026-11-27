/**
 * UNIFIED PER-VAULT SETTINGS (`<vault>/.yaseendocs/settings.json`, YAZ-6546).
 *
 * One sparse JSON file per vault holding ONLY keys overridden from the user's Global defaults (`SettingsState`),
 * plus the 12 consolidated legacy settings sections (`textFormatting`, `tableLook`, `cardLook`, `linkPills`,
 * `linkClick`, `dailyPages`, `folderPages`, `newPlaces`, `showIds`, `review`, `unitWord`, `mobile`).
 *
 * Omitted keys inherit Global defaults live. Multi-vault windows resolve window/sidebar/tab chrome from
 * `SettingsState.workspaceSettings[key]` (so chrome never flips on tab switches), while page-level settings always
 * resolve from each page's own vault.
 *
 * Pure: no React, no Electron, no fs — shared by Desktop main, Desktop renderer, CLI, and Mobile.
 */
import { CARD_LOOK_FILE } from './cardLook'
import { keepUnknownKeys } from './configMerge'
import { DAILY_PAGES_FILE } from './dailyPagesFile'
import { FOLDER_PAGES_FILE } from './folderPages'
import { isRecord } from './guards'
import { LINK_CLICK_FILE } from './linkClick'
import { LINK_PILLS_FILE } from './linkPills'
import { MOBILE_SETTINGS_FILE, MOBILE_SETTINGS_KEYS, mobileSettingsValue, sanitizeMobileSettings, type MobileSettingKey } from './mobileSettings'
import { NEW_PLACES_FILE } from './newPlaces'
import { REVIEW_SETTINGS_FILE } from './reviews'
import { SHOW_IDS_FILE } from './showIds'
import { TABLE_LOOK_FILE } from './tableLook'
import { TEXT_FORMATTING_FILE } from './textFormatting'
import { UNIT_WORD_FILE } from './unitWord'
import { sanitizeVaultLauncherPreset, type VaultLauncherPreset } from './vaultIcon'
import { sanitizeWebLinks } from './webLinks'
import {
  DEFAULT_ROW_DATES,
  DEFAULT_SIDEBAR_TABS,
  SIDEBAR_BUTTONS,
  SIDEBAR_TABS,
  type RowDates,
  type SettingsState,
  type SidebarButton,
  type SidebarTab,
  type SidebarTabsPrefs,
} from './types'

export const VAULT_SETTINGS_FILE = 'settings.json'
export const VAULT_SETTINGS_VERSION = 1

/**
 * Window / Sidebar / Tab-bar chrome keys (13 keys):
 * - Single-vault window: read & written in `<vault>/.yaseendocs/settings.json`.
 * - Multi-vault window: read & written in `SettingsState.workspaceSettings[workspaceKey]` so switching tabs across
 *   vaults never causes sidebar tabs, sort order, or tab widths to jump around.
 */
export const VAULT_CHROME_KEYS = [
  'sidebarTabs',
  'sidebarSort',
  'searchSort',
  'rowDates',
  'tabWidth',
  'inactiveTabWidth',
  'sidebarLines',
  'sidebarLineStyle',
  'sidebarThreadColor',
  'sidebarRowHeight',
  'sidebarStickyLevels',
  'cardSkillInSidebar',
  'searchIncludeInline',
] as const

/** Vault-level navigation & launch defaults (2 keys). */
export const VAULT_NAV_KEYS = ['goTo', 'vaultOpensOn'] as const

/** Outline, guide-line, folding, section-indent, and TOC defaults (13 keys). */
export const VAULT_OUTLINE_KEYS = [
  'bulletThreading',
  'threadWidth',
  'threadColor',
  'guideLinesOnByDefault',
  'guideLinesShow',
  'guideLineDarkness',
  'foldingOnByDefault',
  'sectionStep',
  'sectionLines',
  'tocOnByDefault',
  'tableOfContents',
  'tableOfContentsWidth',
  'tocLines',
] as const

/** Page, embed, and new-item layout defaults (9 keys). */
export const VAULT_LAYOUT_KEYS = [
  'contentWidth',
  'contentPosition',
  'drawingPosition',
  'imagePosition',
  'codeBlockWidth',
  'inlineCodeStyle',
  'webLinks',
  'newPageTitleTemplate',
  'newPageDrawing',
] as const

/** All 37 newly per-vault `SettingsState` override keys (Bundles A + B + C). */
export const VAULT_OVERRIDE_KEYS = [
  ...VAULT_CHROME_KEYS,
  ...VAULT_NAV_KEYS,
  ...VAULT_OUTLINE_KEYS,
  ...VAULT_LAYOUT_KEYS,
] as const

export type VaultChromeKey = (typeof VAULT_CHROME_KEYS)[number]
export type VaultOverrideKey = (typeof VAULT_OVERRIDE_KEYS)[number]
export type VaultSettingsOverrides = Partial<Pick<SettingsState, VaultOverrideKey>>
export type WorkspaceChromeOverrides = Partial<Pick<SettingsState, VaultChromeKey>>

/** Consolidated legacy `.yaseendocs/*.json` settings sections nested inside `settings.json`. */
export const LEGACY_SECTION_MAP = {
  [TEXT_FORMATTING_FILE]: 'textFormatting',
  [TABLE_LOOK_FILE]: 'tableLook',
  [CARD_LOOK_FILE]: 'cardLook',
  [LINK_PILLS_FILE]: 'linkPills',
  [LINK_CLICK_FILE]: 'linkClick',
  [DAILY_PAGES_FILE]: 'dailyPages',
  [FOLDER_PAGES_FILE]: 'folderPages',
  [NEW_PLACES_FILE]: 'newPlaces',
  [SHOW_IDS_FILE]: 'showIds',
  [REVIEW_SETTINGS_FILE]: 'review',
  [UNIT_WORD_FILE]: 'unitWord',
  [MOBILE_SETTINGS_FILE]: 'mobile',
} as const

export type LegacySettingsFile = keyof typeof LEGACY_SECTION_MAP
export type LegacySectionKey = (typeof LEGACY_SECTION_MAP)[LegacySettingsFile]

export const LEGACY_SETTINGS_FILES: readonly LegacySettingsFile[] = /*#__PURE__*/ Object.keys(LEGACY_SECTION_MAP) as LegacySettingsFile[]
export const LEGACY_SECTION_KEYS: readonly LegacySectionKey[] = /*#__PURE__*/ Object.values(LEGACY_SECTION_MAP) as LegacySectionKey[]

/** Maps a legacy section key back to its old `.yaseendocs/` filename (for read fallback / migration). */
export const SECTION_TO_LEGACY_FILE: Readonly<Record<LegacySectionKey, LegacySettingsFile>> = /*#__PURE__*/ Object.fromEntries(
  Object.entries(LEGACY_SECTION_MAP).map(([file, section]) => [section, file]),
) as Record<LegacySectionKey, LegacySettingsFile>

/**
 * The canonical shape of `<vault>/.yaseendocs/settings.json`.
 * All fields other than `version` are optional (sparse).
 */
export interface VaultSettingsDoc extends VaultSettingsOverrides {
  version: number
  /** Portable synced vault launcher & icon preset (YAZ-6560). */
  launcher?: VaultLauncherPreset
  textFormatting?: Record<string, unknown>
  tableLook?: Record<string, unknown>
  cardLook?: Record<string, unknown>
  linkPills?: Record<string, unknown>
  linkClick?: Record<string, unknown>
  dailyPages?: Record<string, unknown>
  folderPages?: Record<string, unknown>
  newPlaces?: Record<string, unknown>
  showIds?: Record<string, unknown>
  review?: Record<string, unknown>
  unitWord?: Record<string, unknown>
  mobile?: Record<string, unknown>
}

export const VAULT_SETTINGS_DOC_KEYS: readonly string[] = [
  'version',
  'launcher',
  ...VAULT_OVERRIDE_KEYS,
  ...LEGACY_SECTION_KEYS,
]

/**
 * Chrome keys that live ONLY on Vault and Workspace — never inherited from Global defaults (YAZ-6593).
 * Unset vaults/workspaces start from their built-in app default (`DEFAULT_SIDEBAR_TABS`).
 */
export const VAULT_OWNED_CHROME_KEYS = ['sidebarTabs'] as const
export type VaultOwnedChromeKey = (typeof VAULT_OWNED_CHROME_KEYS)[number]

/** Chrome keys that inherit from Global defaults (cleared by Workspace "Reset all", preserving Vault/Workspace-owned `sidebarTabs`). */
export const GLOBAL_INHERITING_CHROME_KEYS: readonly VaultChromeKey[] = /*#__PURE__*/ VAULT_CHROME_KEYS.filter(
  (k) => !(VAULT_OWNED_CHROME_KEYS as readonly string[]).includes(k),
)

/** Override keys that inherit from Global defaults (cleared by Vault "Reset all", preserving Vault/Workspace-owned `sidebarTabs`). */
export const GLOBAL_INHERITING_OVERRIDE_KEYS: readonly VaultOverrideKey[] = /*#__PURE__*/ VAULT_OVERRIDE_KEYS.filter(
  (k) => !(VAULT_OWNED_CHROME_KEYS as readonly string[]).includes(k),
)

const CHROME_KEY_SET: ReadonlySet<string> = /*#__PURE__*/ new Set(VAULT_CHROME_KEYS)
const OVERRIDE_KEY_SET: ReadonlySet<string> = /*#__PURE__*/ new Set(VAULT_OVERRIDE_KEYS)
const LEGACY_SECTION_SET: ReadonlySet<string> = /*#__PURE__*/ new Set(LEGACY_SECTION_KEYS)
const VAULT_OWNED_CHROME_SET: ReadonlySet<string> = /*#__PURE__*/ new Set(VAULT_OWNED_CHROME_KEYS)

export const isVaultChromeKey = (key: string): key is VaultChromeKey => CHROME_KEY_SET.has(key)
export const isVaultOverrideKey = (key: string): key is VaultOverrideKey => OVERRIDE_KEY_SET.has(key)
export const isLegacySectionKey = (key: string): key is LegacySectionKey => LEGACY_SECTION_SET.has(key)
export const isVaultOwnedChromeKey = (key: string): key is VaultOwnedChromeKey => VAULT_OWNED_CHROME_SET.has(key)

/** Legacy UUID-based workspace key (`ws:<vaultSetId>`) kept for backward-compatible reads and migration. */
export function legacyWorkspaceSettingsKey(vaultSetId?: string | null): string | null {
  if (vaultSetId !== undefined && vaultSetId !== null && vaultSetId.trim() !== '') return `ws:${vaultSetId}`
  return null
}

/**
 * Stable key for `SettingsState.workspaceSettings`:
 * - Saved workspace with a name (YAZ-6593): `ws-name:<normalized lowercase name>` so chrome syncs across Macs
 *   even when each Mac has a different local `VaultSet.id`.
 * - Saved workspace without a name: `ws:<id>`
 * - Ad-hoc multi-vault window: `roots:<sorted canonical roots joined by \0>`
 */
export function workspaceSettingsKey(roots: readonly string[], vaultSetId?: string | null, vaultSetName?: string | null): string {
  const cleanedName = vaultSetName?.trim().toLowerCase() ?? ''
  if (cleanedName.length > 0) return `ws-name:${cleanedName}`
  const legacy = legacyWorkspaceSettingsKey(vaultSetId)
  if (legacy !== null) return legacy
  const norm = [...new Set(roots.map((r) => r.replace(/\/+$/, '')))].sort()
  return `roots:${norm.join('\0')}`
}

/**
 * Read workspace chrome overrides from `SettingsState.workspaceSettings`, checking the canonical portable key
 * (`ws-name:<name>`) first and falling back to the legacy UUID key (`ws:<vaultSetId>`) when upgrading (YAZ-6593).
 */
export function readWorkspaceChrome(
  workspaceSettings: Record<string, Record<string, unknown>> | undefined,
  roots: readonly string[],
  vaultSetId?: string | null,
  vaultSetName?: string | null,
): WorkspaceChromeOverrides {
  if (!isRecord(workspaceSettings)) return {}
  const key = workspaceSettingsKey(roots, vaultSetId, vaultSetName)
  const direct = extractWorkspaceChrome(workspaceSettings[key])
  if (Object.keys(direct).length > 0) return direct
  const legacy = legacyWorkspaceSettingsKey(vaultSetId)
  if (legacy !== null && legacy !== key) return extractWorkspaceChrome(workspaceSettings[legacy])
  return {}
}

/** Repair a hand-edited or partial `sidebarTabs` object so missing arrays never crash `.join()` in the sidebar. */
function sanitizeSidebarTabsOverride(raw: unknown): SidebarTabsPrefs | undefined {
  if (!isRecord(raw)) return undefined
  const seen = new Set<SidebarTab>()
  const order: SidebarTab[] = []
  if (Array.isArray(raw.order)) {
    for (const item of raw.order) {
      if (SIDEBAR_TABS.includes(item as SidebarTab) && !seen.has(item as SidebarTab)) {
        seen.add(item as SidebarTab)
        order.push(item as SidebarTab)
      }
    }
  }
  for (const tab of SIDEBAR_TABS) if (!seen.has(tab)) order.push(tab)
  const hiddenSet = new Set<SidebarTab>()
  const hidden: SidebarTab[] = []
  if (Array.isArray(raw.hidden)) {
    for (const item of raw.hidden) {
      if (item !== 'files' && SIDEBAR_TABS.includes(item as SidebarTab) && !hiddenSet.has(item as SidebarTab)) {
        hiddenSet.add(item as SidebarTab)
        hidden.push(item as SidebarTab)
      }
    }
  }
  const btnSet = new Set<SidebarButton>()
  const hiddenButtons: SidebarButton[] = []
  if (Array.isArray(raw.hiddenButtons)) {
    for (const item of raw.hiddenButtons) {
      if (SIDEBAR_BUTTONS.includes(item as SidebarButton) && !btnSet.has(item as SidebarButton)) {
        btnSet.add(item as SidebarButton)
        hiddenButtons.push(item as SidebarButton)
      }
    }
  }
  return { order, hidden, hiddenButtons }
}

/** Repair a partial `rowDates` object so every required boolean slot is present. */
function sanitizeRowDatesOverride(raw: unknown): RowDates | undefined {
  if (!isRecord(raw)) return undefined
  return {
    files: typeof raw.files === 'boolean' ? raw.files : DEFAULT_ROW_DATES.files,
    focus: typeof raw.focus === 'boolean' ? raw.focus : DEFAULT_ROW_DATES.focus,
    favorites: typeof raw.favorites === 'boolean' ? raw.favorites : DEFAULT_ROW_DATES.favorites,
    search: typeof raw.search === 'boolean' ? raw.search : DEFAULT_ROW_DATES.search,
    ...(typeof raw.recents === 'boolean' ? { recents: raw.recents } : {}),
  }
}

function sanitizeOverrideEntry(key: VaultOverrideKey, value: unknown): unknown {
  if (key === 'sidebarTabs') return sanitizeSidebarTabsOverride(value)
  if (key === 'rowDates') return sanitizeRowDatesOverride(value)
  if (key === 'webLinks') return isRecord(value) ? sanitizeWebLinks(value) : undefined
  if (key === 'sidebarSort' || key === 'searchSort' || key === 'goTo' || key === 'inlineCodeStyle') {
    return isRecord(value) ? value : undefined
  }
  return value
}

/** Extract only the known sparse `SettingsState` override keys from a parsed `settings.json` object. */
export function extractVaultOverrides(raw: unknown): VaultSettingsOverrides {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of VAULT_OVERRIDE_KEYS) {
    if (!Object.hasOwn(raw, key) || raw[key] === undefined) continue
    const clean = sanitizeOverrideEntry(key, raw[key])
    if (clean !== undefined) out[key] = clean
  }
  return out as VaultSettingsOverrides
}

/** Extract only the known sparse chrome override keys from a workspace overrides record. */
export function extractWorkspaceChrome(raw: unknown): WorkspaceChromeOverrides {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of VAULT_CHROME_KEYS) {
    if (!Object.hasOwn(raw, key) || raw[key] === undefined) continue
    const clean = sanitizeOverrideEntry(key, raw[key])
    if (clean !== undefined) out[key] = clean
  }
  return out as WorkspaceChromeOverrides
}

/**
 * Read a nested legacy section (`textFormatting`, `tableLook`, `review`, etc.) from a unified `settings.json` object,
 * or `null` when absent / not an object.
 */
export function readVaultSection(raw: unknown, section: LegacySectionKey): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const val = raw[section]
  return isRecord(val) ? val : null
}

/** Read and validate the portable `launcher` preset from a unified `settings.json` object, or `null` when absent/invalid. */
export function readVaultLauncherPreset(raw: unknown): VaultLauncherPreset | null {
  if (!isRecord(raw)) return null
  return sanitizeVaultLauncherPreset(raw.launcher)
}

/**
 * Resolve effective `SettingsState` from Global defaults + optional per-vault overrides + optional workspace chrome.
 *
 * - Single-vault window (`workspace == null`): lays all present `vault` overrides over `global`.
 * - Multi-vault window (`workspace != null`): lays non-chrome `vault` overrides (page/outline/layout/nav) over `global`,
 *   and lays `workspace` chrome overrides over `global` so switching tabs never flips sidebar/tab-bar chrome.
 * - Vault/Workspace-only chrome keys (`sidebarTabs`, YAZ-6593): NEVER inherit from `global.sidebarTabs`; unset
 *   vaults/workspaces start cleanly from `DEFAULT_SIDEBAR_TABS`.
 */
export function resolveVaultSettings(
  global: SettingsState,
  vault?: VaultSettingsOverrides | null,
  workspace?: WorkspaceChromeOverrides | null,
): SettingsState {
  const hasVault = vault !== undefined && vault !== null && Object.keys(vault).length > 0
  const hasWorkspace = workspace !== undefined && workspace !== null && Object.keys(workspace).length > 0
  const ownTabs = workspace !== undefined && workspace !== null ? workspace.sidebarTabs : vault?.sidebarTabs
  const resolvedTabs = ownTabs ?? DEFAULT_SIDEBAR_TABS
  const tabsMatchGlobal = global.sidebarTabs === resolvedTabs
  if (!hasVault && !hasWorkspace && tabsMatchGlobal) return global
  const out: Record<string, unknown> = { ...global, sidebarTabs: resolvedTabs }
  if (hasVault) {
    for (const key of VAULT_OVERRIDE_KEYS) {
      if (key === 'sidebarTabs') continue
      if (workspace !== undefined && workspace !== null && isVaultChromeKey(key)) continue
      const v = vault[key]
      if (v !== undefined) out[key] = v
    }
  }
  if (hasWorkspace) {
    for (const key of VAULT_CHROME_KEYS) {
      if (key === 'sidebarTabs') continue
      const v = workspace[key]
      if (v !== undefined) out[key] = v
    }
  }
  return out as unknown as SettingsState
}

/**
 * Apply a sparse patch to a `VaultSettingsDoc` (setting keys in `patch` or deleting keys whose value is `undefined`
 * or listed in `unset`). Preserves unknown top-level keys for forward compatibility.
 */
export function patchVaultSettingsDoc(
  current: unknown,
  patch: Record<string, unknown>,
  unset: readonly string[] = [],
): VaultSettingsDoc {
  const base: Record<string, unknown> = isRecord(current) ? { ...current } : {}
  const version = typeof base.version === 'number' && base.version > VAULT_SETTINGS_VERSION ? base.version : VAULT_SETTINGS_VERSION
  const out: Record<string, unknown> = { version, ...base }
  out.version = version
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'version') continue
    if (v === undefined) delete out[k]
    else out[k] = v
  }
  for (const k of unset) {
    if (k !== 'version') delete out[k]
  }
  return out as unknown as VaultSettingsDoc
}

/** True when a `VaultSettingsDoc` has no overrides and no nested sections (only `version`). */
export function isVaultSettingsDocEmpty(raw: unknown): boolean {
  if (!isRecord(raw)) return true
  return Object.keys(raw).every((k) => k === 'version' || raw[k] === undefined)
}

/**
 * Merge any discovered legacy `.yaseendocs/*.json` files (and optional legacy `folders[root].rowDates`) into an
 * existing (or new) `VaultSettingsDoc`. Existing keys in `current` ALWAYS win (never overwritten by legacy files).
 */
export function mergeLegacyFilesIntoDoc(
  current: unknown,
  legacyFiles: Partial<Record<LegacySettingsFile, unknown>>,
  legacyRowDates?: RowDates | null,
): { doc: VaultSettingsDoc; migratedFiles: LegacySettingsFile[]; migratedRowDates: boolean } {
  const base: Record<string, unknown> = isRecord(current) ? { ...current } : { version: VAULT_SETTINGS_VERSION }
  if (typeof base.version !== 'number' || base.version < VAULT_SETTINGS_VERSION) base.version = VAULT_SETTINGS_VERSION
  const migratedFiles: LegacySettingsFile[] = []
  let migratedRowDates = false

  for (const file of LEGACY_SETTINGS_FILES) {
    const raw = legacyFiles[file]
    if (!isRecord(raw)) continue
    const section = LEGACY_SECTION_MAP[file]
    if (!Object.hasOwn(base, section) || base[section] === undefined) {
      base[section] = { ...raw }
    }
    migratedFiles.push(file)
  }

  if (legacyRowDates !== undefined && legacyRowDates !== null && (!Object.hasOwn(base, 'rowDates') || base.rowDates === undefined)) {
    base.rowDates = { ...legacyRowDates }
    migratedRowDates = true
  }

  return { doc: base as unknown as VaultSettingsDoc, migratedFiles, migratedRowDates }
}

/**
 * Update a single mobile boolean setting inside `<vault>/.yaseendocs/settings.json` (YAZ-6546), preserving every
 * other key and section of `settings.json` (the `withMobileSetting` contract applied to the unified file).
 */
export function withMobileSettingInVaultSettings(text: string | null, key: MobileSettingKey, on: boolean): string {
  let raw: unknown = undefined
  if (text !== null && text.trim() !== '') {
    raw = JSON.parse(text)
    if (!isRecord(raw)) throw new Error(`${VAULT_SETTINGS_FILE} is not a JSON object`)
  }
  const existingMobile = readVaultSection(raw, 'mobile')
  const nextMobile = keepUnknownKeys(
    existingMobile,
    mobileSettingsValue({ ...sanitizeMobileSettings(existingMobile), [key]: on }),
    MOBILE_SETTINGS_KEYS,
  ) as Record<string, unknown>
  const hasNonDefault = Object.keys(nextMobile).some((k) => k !== 'version')
  const patched = patchVaultSettingsDoc(raw, hasNonDefault ? { mobile: nextMobile } : {}, hasNonDefault ? [] : ['mobile'])
  const merged = keepUnknownKeys(raw, patched, VAULT_SETTINGS_DOC_KEYS) as Record<string, unknown>
  const order = isRecord(raw) ? Object.keys(raw).filter((k) => Object.hasOwn(merged, k)) : []
  const out: Record<string, unknown> = {}
  for (const k of [...order, ...Object.keys(merged)]) if (!Object.hasOwn(out, k)) out[k] = merged[k]
  return `${JSON.stringify(out, null, 2)}\n`
}
