/**
 * UNIFIED PER-VAULT SETTINGS LOADER & LOSSLESS AUTO-MIGRATOR (YAZ-6546).
 *
 * Reads `<root>/.yaseendocs/settings.json` and, when any of the 12 retired `.yaseendocs/*.json` settings files or a
 * legacy local `store.folders[root].rowDates` override exists, merges them losslessly into `settings.json` (existing
 * keys in `settings.json` ALWAYS win):
 * - Writable vault: writes `<root>/.yaseendocs/settings.json` atomically via `writeConfig`, then unlinks ONLY the
 *   legacy `.json` files that parsed cleanly and were merged (malformed legacy files are left untouched on disk).
 * - Read-only vault (`opts.readOnly === true` or `<root>/.yaseendocs/read-only.json` `{ on: true }`): returns the
 *   merged in-memory `VaultSettingsDoc` without writing or unlinking anything on disk.
 * - Clean vault (no `settings.json`, no legacy files, no legacy `rowDates`): returns `null` and never creates
 *   `.yaseendocs/`.
 *
 * Electron-free and async-only (no `fs.*Sync`): shared by `ipc/vaultConfig.ts` and post-install migration scripts.
 */
import { readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/guards'
import { stripSlash, VAULT_CONFIG_DIR, type RowDates } from '@shared/types'
import {
  LEGACY_SETTINGS_FILES,
  mergeLegacyFilesIntoDoc,
  VAULT_SETTINGS_DOC_KEYS,
  VAULT_SETTINGS_FILE,
  type LegacySettingsFile,
  type VaultSettingsDoc,
} from '@shared/vaultSettings'
import { BridgeFailure, requireAbsPath } from './fs/fsUtils'
import type { Store } from './store'
import { readConfigDetailed, withConfigLock, writeConfigUnlocked } from './vaultConfig'

const READ_ONLY_FILE = 'read-only.json'
const ROW_DATES_MIGRATED_MARK = `${VAULT_SETTINGS_FILE}#rowDates`

export interface ConsolidateVaultSettingsResult {
  doc: VaultSettingsDoc | null
  migratedFiles: LegacySettingsFile[]
  migratedRowDates: boolean
  wrote: boolean
  readOnly: boolean
}

/**
 * Pure/reusable helper that reads `<root>/.yaseendocs/settings.json`, detects any of the 12 legacy settings files
 * (and optional `legacyRowDates`), merges them (existing `settings.json` keys ALWAYS win), and — unless read-only —
 * writes `settings.json` atomically and unlinks only the successfully migrated legacy files.
 */
export async function consolidateVaultSettingsOnDisk(
  root: string,
  legacyRowDates?: RowDates | null,
  opts?: { readOnly?: boolean },
): Promise<ConsolidateVaultSettingsResult> {
  const r = requireAbsPath(root, 'root')
  return withConfigLock(r, VAULT_SETTINGS_FILE, async () => {
    const existing = await readConfigDetailed(r, VAULT_SETTINGS_FILE)
    if (existing.state === 'malformed') {
      throw new BridgeFailure('INVALID_CONFIG', `${VAULT_SETTINGS_FILE} is not valid JSON`, { path: existing.file })
    }
    if (existing.state === 'ok' && !isRecord(existing.value)) {
      throw new BridgeFailure('INVALID_CONFIG', `${VAULT_SETTINGS_FILE} must be a JSON object`, {
        path: path.join(r, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE),
      })
    }
    const currentDoc: Record<string, unknown> | null = existing.state === 'ok' ? (existing.value as Record<string, unknown>) : null

    const dir = path.join(r, VAULT_CONFIG_DIR)
    let dirEntries: string[]
    try {
      dirEntries = await readdir(dir)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') dirEntries = []
      else throw err
    }

    const entrySet = new Set(dirEntries)
    const presentLegacy = LEGACY_SETTINGS_FILES.filter((f) => entrySet.has(f))
    const needsRowDates =
      legacyRowDates !== undefined &&
      legacyRowDates !== null &&
      (currentDoc === null || !Object.hasOwn(currentDoc, 'rowDates') || currentDoc.rowDates === undefined)

    if (currentDoc === null && presentLegacy.length === 0 && !needsRowDates) {
      return { doc: null, migratedFiles: [], migratedRowDates: false, wrote: false, readOnly: opts?.readOnly === true }
    }
    if (presentLegacy.length === 0 && !needsRowDates) {
      return {
        doc: currentDoc as unknown as VaultSettingsDoc,
        migratedFiles: [],
        migratedRowDates: false,
        wrote: false,
        readOnly: opts?.readOnly === true,
      }
    }

    // Check vault read-only flag: explicit option OR `<root>/.yaseendocs/read-only.json` `{ on: true }`.
    let readOnly = opts?.readOnly === true
    if (!readOnly && entrySet.has(READ_ONLY_FILE)) {
      const ro = await readConfigDetailed(r, READ_ONLY_FILE)
      if (ro.state === 'ok' && isRecord(ro.value) && ro.value.on === true) readOnly = true
    }

    const legacyFiles: Partial<Record<LegacySettingsFile, unknown>> = {}
    for (const file of presentLegacy) {
      const res = await readConfigDetailed(r, file)
      if (res.state === 'malformed') {
        console.warn(`[vaultSettings] skipping malformed legacy file ${res.file} during migration: ${res.error}`)
        continue
      }
      if (res.state === 'ok' && isRecord(res.value)) {
        legacyFiles[file] = res.value
      }
    }

    const { doc, migratedFiles, migratedRowDates } = mergeLegacyFilesIntoDoc(
      currentDoc,
      legacyFiles,
      needsRowDates ? legacyRowDates : null,
    )

    // Nothing actually migrated (e.g. only malformed legacy files existed): do not write an empty settings.json.
    if (migratedFiles.length === 0 && !migratedRowDates) {
      return {
        doc: currentDoc as unknown as VaultSettingsDoc | null,
        migratedFiles: [],
        migratedRowDates: false,
        wrote: false,
        readOnly,
      }
    }

    if (readOnly) {
      return { doc, migratedFiles, migratedRowDates, wrote: false, readOnly: true }
    }

    await writeConfigUnlocked(r, VAULT_SETTINGS_FILE, doc, VAULT_SETTINGS_DOC_KEYS)
    await Promise.all(
      migratedFiles.map((file) =>
        unlink(path.join(dir, file)).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') console.warn(`[vaultSettings] could not remove migrated legacy file ${file}: ${String(err)}`)
        }),
      ),
    )

    return { doc, migratedFiles, migratedRowDates, wrote: true, readOnly: false }
  })
}

export type UnifiedVaultSettingsStore = Pick<Store, 'get' | 'setFolder'> & Partial<Pick<Store, 'seededConfig' | 'markSeededConfig'>>

/**
 * Unified `<vault>/.yaseendocs/settings.json` loader used by `ipc/vaultConfig.ts` (YAZ-6546).
 * Transparently migrates legacy `.yaseendocs/*.json` settings files and legacy `store.folders[root].rowDates`
 * on writable vaults, or returns the merged view in memory on read-only vaults without touching disk.
 */
export async function readUnifiedVaultSettings(
  root: string,
  store?: UnifiedVaultSettingsStore,
  opts?: { readOnly?: boolean },
): Promise<VaultSettingsDoc | null> {
  const r = requireAbsPath(root, 'root')
  const canonical = stripSlash(r)
  const alreadyMigratedRowDates =
    store?.seededConfig?.(r, ROW_DATES_MIGRATED_MARK) === true ||
    store?.seededConfig?.(canonical, ROW_DATES_MIGRATED_MARK) === true
  const legacyRowDates = alreadyMigratedRowDates
    ? null
    : (store?.get().folders[r]?.rowDates ?? store?.get().folders[canonical]?.rowDates ?? null)
  const result = await consolidateVaultSettingsOnDisk(r, legacyRowDates, opts)
  if (result.migratedRowDates && result.wrote) {
    store?.markSeededConfig?.(canonical, ROW_DATES_MIGRATED_MARK)
  }
  return result.doc
}
