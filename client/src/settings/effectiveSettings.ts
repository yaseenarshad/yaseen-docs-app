/**
 * Effective settings resolution for single-vault and multi-vault windows (YAZ-6546, YAZ-6555).
 *
 * - Single-vault window (`roots.length === 1`):
 *   - Chrome settings = `resolveVaultSettings(global, singleVaultOverrides)` (+ legacy `folders[root].rowDates` fallback).
 *   - Page settings = `resolveVaultSettings(global, scopeOf(path).vaultSettings.overrides)`.
 *   - Chrome writes go to `<vault>/.yaseendocs/settings.json` (or in-memory `sessionOverrides` when read-only).
 * - Multi-vault window (`roots.length >= 2`):
 *   - Chrome settings = `resolveVaultSettings(global, null, wsChrome)` where `wsChrome` comes from
 *     `global.workspaceSettings[workspaceSettingsKey(roots, matchedVaultSetId)]`. Chrome NEVER flips on tab switches.
 *   - Page settings = `resolveVaultSettings(global, scopeOf(path).vaultSettings.overrides, wsChrome)` so page/outline/layout/nav
 *     settings always come from that page's own vault.
 *   - Chrome writes update `global.workspaceSettings[wsKey]` (syncs across Macs via Settings folder).
 */
import type { CSSProperties } from 'react'
import type { NewPageDrawing, RowDates, SettingsState } from '@shared/types'
import {
  VAULT_CHROME_KEYS,
  extractWorkspaceChrome,
  legacyWorkspaceSettingsKey,
  readWorkspaceChrome,
  resolveVaultSettings,
  workspaceSettingsKey,
  type VaultChromeKey,
  type VaultSettingsOverrides,
  type WorkspaceChromeOverrides,
} from '@shared/vaultSettings'
import { webLinkVars } from '@shared/webLinks'
import { contentWidthVars, tablePositionVars } from '../lib/contentWidth'
import { storage } from '../lib/storage'
import { inlineCodeVars } from './inlineCodeStyle'

export interface ResolvedWindowChrome {
  settings: SettingsState
  isMultiVault: boolean
  wsKey: string | null
  legacyWsKey: string | null
  chromeOverrides: WorkspaceChromeOverrides
}

export function resolveWindowChrome(
  global: SettingsState,
  roots: readonly string[],
  matchedVaultSetId: string | null,
  singleVaultOverrides: VaultSettingsOverrides | null,
  legacyRowDates?: RowDates | null,
  matchedVaultSetName?: string | null,
): ResolvedWindowChrome {
  if (roots.length === 0) {
    return { settings: global, isMultiVault: false, wsKey: null, legacyWsKey: null, chromeOverrides: {} }
  }
  if (roots.length === 1) {
    const chromeOverrides = extractWorkspaceChrome(singleVaultOverrides)
    let settings = resolveVaultSettings(global, singleVaultOverrides)
    if (singleVaultOverrides?.rowDates === undefined && legacyRowDates !== undefined && legacyRowDates !== null) {
      settings = { ...settings, rowDates: legacyRowDates }
    }
    return { settings, isMultiVault: false, wsKey: null, legacyWsKey: null, chromeOverrides }
  }
  const wsKey = workspaceSettingsKey(roots, matchedVaultSetId, matchedVaultSetName)
  const rawLegacy = legacyWorkspaceSettingsKey(matchedVaultSetId)
  const legacyWsKey = rawLegacy !== null && rawLegacy !== wsKey ? rawLegacy : null
  const chromeOverrides = readWorkspaceChrome(global.workspaceSettings, roots, matchedVaultSetId, matchedVaultSetName)
  let settings = resolveVaultSettings(global, null, chromeOverrides)
  if (chromeOverrides.rowDates === undefined && legacyRowDates !== undefined && legacyRowDates !== null) {
    settings = { ...settings, rowDates: legacyRowDates }
  }
  return { settings, isMultiVault: true, wsKey, legacyWsKey, chromeOverrides }
}

export function resolvePageSettings(
  global: SettingsState,
  pageVaultOverrides: VaultSettingsOverrides | null,
  isMultiVault: boolean,
  wsChrome?: WorkspaceChromeOverrides | null,
): SettingsState {
  return resolveVaultSettings(global, pageVaultOverrides, isMultiVault ? (wsChrome ?? {}) : null)
}

/**
 * Sparsely patch `SettingsState.workspaceSettings[wsKey]`, deleting `wsKey` when no chrome keys remain.
 * When `legacyWsKey` (`ws:<uuid>`) is provided, migrates any existing entries from `legacyWsKey` into `wsKey`
 * and removes `legacyWsKey` so there is never a stale duplicate (YAZ-6593).
 */
export function patchWorkspaceChrome(
  global: SettingsState,
  wsKey: string,
  patch: Partial<WorkspaceChromeOverrides>,
  unset: readonly VaultChromeKey[] = [],
  legacyWsKey?: string | null,
): SettingsState {
  const rawCurrent = global.workspaceSettings?.[wsKey]
  const existing =
    rawCurrent !== undefined
      ? extractWorkspaceChrome(rawCurrent)
      : legacyWsKey !== undefined && legacyWsKey !== null
        ? extractWorkspaceChrome(global.workspaceSettings?.[legacyWsKey])
        : {}
  const nextEntry: Record<string, unknown> = { ...existing }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete nextEntry[k]
    else nextEntry[k] = v
  }
  for (const k of unset) delete nextEntry[k]

  const nextMap: Record<string, Record<string, unknown>> = { ...global.workspaceSettings }
  if (legacyWsKey !== undefined && legacyWsKey !== null && legacyWsKey !== wsKey) delete nextMap[legacyWsKey]
  if (Object.keys(nextEntry).length === 0) delete nextMap[wsKey]
  else nextMap[wsKey] = nextEntry
  return { ...global, workspaceSettings: nextMap }
}

/** Return only the keys in `keys` whose value differs between `before` and `after`. */
export function diffSettingsKeys<K extends keyof SettingsState>(
  before: SettingsState,
  after: SettingsState,
  keys: readonly K[],
): Partial<Pick<SettingsState, K>> {
  const diff: Record<string, unknown> = {}
  for (const k of keys) {
    const prev = before[k]
    const next = after[k]
    if (prev !== next && JSON.stringify(prev) !== JSON.stringify(next)) diff[k] = next
  }
  return diff as Partial<Pick<SettingsState, K>>
}

/** Partition a SettingsState diff from Sidebar into chrome keys vs non-chrome global keys. */
export function splitChromeDiff(
  before: SettingsState,
  after: SettingsState,
): { chrome: Partial<WorkspaceChromeOverrides>; other: Partial<SettingsState> } {
  const chrome = diffSettingsKeys(before, after, VAULT_CHROME_KEYS)
  const chromeSet = new Set<string>(VAULT_CHROME_KEYS)
  const other: Record<string, unknown> = {}
  for (const key of Object.keys(after) as (keyof SettingsState)[]) {
    if (chromeSet.has(key)) continue
    if (before[key] !== after[key] && JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      other[key] = after[key]
    }
  }
  return { chrome, other: other as Partial<SettingsState> }
}

const PAGE_CSS_KEYS = [
  'contentWidth',
  'contentPosition',
  'drawingPosition',
  'imagePosition',
  'threadWidth',
  'threadColor',
  'sectionStep',
  'codeBlockWidth',
  'inlineCodeStyle',
  'webLinks',
  'guideLineDarkness',
] as const

export const NO_PAGE_OVERRIDE_VARS: CSSProperties = Object.freeze({})

/**
 * Per-page CSS custom properties for vaults that override layout/outline/code settings, so two pages from
 * two different vaults mounted side-by-side (e.g. main pane + right panel) each render with their own vault's rules.
 */
export function pageOverrideVars(pageSettings: SettingsState, overrides: VaultSettingsOverrides): CSSProperties {
  if (!PAGE_CSS_KEYS.some((k) => Object.hasOwn(overrides, k))) return NO_PAGE_OVERRIDE_VARS
  return {
    ...(overrides.contentWidth !== undefined || overrides.contentPosition !== undefined ? contentWidthVars(pageSettings) : {}),
    ...(overrides.drawingPosition !== undefined || overrides.imagePosition !== undefined ? tablePositionVars(pageSettings) : {}),
    ...(overrides.threadWidth !== undefined ? { '--thread-width': `${pageSettings.threadWidth}px` } : {}),
    ...(Object.hasOwn(overrides, 'threadColor') ? { '--thread-color': pageSettings.threadColor ?? 'initial' } : {}),
    ...(overrides.sectionStep !== undefined ? { '--section-step-setting': pageSettings.sectionStep } : {}),
    ...(Object.hasOwn(overrides, 'codeBlockWidth') ? { '--code-block-width': pageSettings.codeBlockWidth != null ? `${pageSettings.codeBlockWidth}px` : 'initial' } : {}),
    ...(overrides.inlineCodeStyle !== undefined ? inlineCodeVars(pageSettings.inlineCodeStyle) : {}),
    ...(overrides.webLinks !== undefined ? webLinkVars(pageSettings.webLinks, { resetDefaults: true }) : {}),
    ...(overrides.guideLineDarkness !== undefined
      ? {
          '--guide-line-darkness': `${pageSettings.guideLineDarkness}%`,
          '--guide-line-darkness-hover': `${Math.min(100, pageSettings.guideLineDarkness + 20)}%`,
        }
      : {}),
  } as CSSProperties
}

// ---- Lightweight per-vault runtime lookups for non-React / zero-prop-churn call sites (Editor.tsx, ExploreSearch.tsx) ----

const vaultNewPageDrawings = new Map<string, NewPageDrawing>()
let windowSearchInline: boolean | null = null

export function setVaultNewPageDrawing(root: string, value: NewPageDrawing | undefined): void {
  if (value === undefined) vaultNewPageDrawings.delete(root)
  else vaultNewPageDrawings.set(root, value)
}

export function newPageDrawingOf(root: string | null | undefined): NewPageDrawing {
  if (root !== null && root !== undefined) {
    const override = vaultNewPageDrawings.get(root)
    if (override !== undefined) return override
  }
  return storage.getSettings()?.newPageDrawing ?? 'inline'
}

export function setWindowSearchIncludeInline(value: boolean | null): void {
  windowSearchInline = value
}

export function windowSearchIncludeInline(): boolean {
  if (windowSearchInline !== null) return windowSearchInline
  return storage.getSettings()?.searchIncludeInline !== false
}
