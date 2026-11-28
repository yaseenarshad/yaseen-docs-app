import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { isRecord } from '@shared/guards'
import { workspaceLink } from '@shared/links'
import {
  cleanVaultAppSidebarStart,
  cleanVaultLauncher,
  cleanVaultName,
  vaultLaunchersOf,
  VAULT_CONFIG_DIR,
  type FolderState,
  type LauncherListItem,
  type VaultAppSidebarStart,
  type VaultAppSummary,
  type VaultLauncherBadge,
  type VaultLauncherInfo,
  type VaultLauncherStatus,
  type VaultLauncherTarget,
} from '@shared/types'
import {
  MAX_SYNCED_VAULT_APPS,
  renderBadgeSvgDataUrl,
  sanitizeVaultAppsList,
  sanitizeVaultLauncherBadge,
  sanitizeVaultLauncherPreset,
  VAULT_ICON_FILE,
  vaultIconFileFor,
  workspaceLauncherKey,
  type VaultLauncherPreset,
} from '@shared/vaultIcon'
import { VAULT_SETTINGS_FILE, VAULT_SETTINGS_VERSION } from '@shared/vaultSettings'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import type { Store } from '../store'
import { readConfigDetailed, withConfigLock, writeConfigUnlocked } from '../vaultConfig'
import { isOwnLauncher, readLauncherPlist, scanInstalledLaunchers, type ScannedLauncher } from '../vaultLauncher'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** Maximum decoded PNG size for a vault launcher icon (2 MiB). */
export const MAX_LAUNCHER_ICON_BYTES = 2 * 1024 * 1024

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const VALID_TARGETS = new Set<string>(['normal', 'inbox', 'today'])
const DATA_URL_PREFIX = /^data:image\/png;base64,/i
const READ_ONLY_FILE = 'read-only.json'
const LAUNCHER_SETTINGS_KEYS = ['version', 'launcher', 'vaultApps'] as const

export interface VaultLauncherInstallParams {
  root: string
  vaultUrl?: string
  appId?: string
  name: string
  png: Buffer
  iconPath: string
  target?: VaultLauncherTarget
  previousAppPath?: string
}

/** Platform backend plugged into `registerVaultLauncherIpc` (macOS `.app` bundle builder, or stub off macOS). */
export interface VaultLauncherBackend {
  readonly supported: boolean
  install(params: VaultLauncherInstallParams): Promise<{ appPath: string; name?: string }>
  remove(appPath: string, root: string): Promise<void>
  reveal(appPath: string): Promise<void> | void
  launch(appPath: string): Promise<void> | void
  exists(path: string): boolean
  /** Optional scan override (defaults to `scanInstalledLaunchers()` when `supported`). */
  scan?: () => Promise<ScannedLauncher[]>
  /** Optional orphan removal override (defaults to plist verification + `remove`). */
  removeOrphan?: (appPath: string) => Promise<void>
}

/** Deterministic cached icon path under `<userData>/vault-icons/<sha256(root).slice(0,16)>[-<appId>].png` (YAZ-6681). */
export function vaultLauncherIconPath(userData: string, root: string, appId?: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16)
  const cleanId = appId?.trim()
  const suffix = cleanId && cleanId !== 'default' ? `-${cleanId}` : ''
  return join(userData, 'vault-icons', `${hash}${suffix}.png`)
}

/** Deterministic cached icon path under `<userData>/vault-icons/ws-<sha256(id).slice(0,16)>.png`. */
export function workspaceLauncherIconPath(userData: string, workspaceId: string): string {
  const hash = createHash('sha256').update(workspaceId).digest('hex').slice(0, 16)
  return join(userData, 'vault-icons', `ws-${hash}.png`)
}

const workspaceVaultPath = (workspaceId: string): string => `workspace:${workspaceId}`

function requireWorkspaceId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new BridgeFailure('BAD_REQUEST', "'workspaceId' must be a non-empty string")
  }
  return raw.trim()
}

/** Decodes and validates a base64 PNG payload (max 2 MiB decoded, valid 8-byte PNG signature). */
function decodeLauncherPng(raw: unknown): Buffer {
  if (typeof raw !== 'string') {
    throw new BridgeFailure('BAD_REQUEST', "'pngBase64' must be a base64 string")
  }
  const stripped = raw.trim().replace(DATA_URL_PREFIX, '')
  if (stripped.length === 0) {
    throw new BridgeFailure('BAD_REQUEST', "'pngBase64' must not be empty")
  }
  // Quick upper-bound check before allocating the decoded buffer.
  const maxEncoded = Math.ceil((MAX_LAUNCHER_ICON_BYTES * 4) / 3) + 16
  if (stripped.length > maxEncoded) {
    throw new BridgeFailure('TOO_LARGE', 'Launcher icon exceeds the 2 MB limit')
  }
  const buf = Buffer.from(stripped, 'base64')
  if (buf.length > MAX_LAUNCHER_ICON_BYTES) {
    throw new BridgeFailure('TOO_LARGE', 'Launcher icon exceeds the 2 MB limit')
  }
  if (buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new BridgeFailure('UNSUPPORTED_TYPE', 'Launcher icon must be a valid PNG image')
  }
  return buf
}

function parseOptionalTarget(raw: unknown): VaultLauncherTarget | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !VALID_TARGETS.has(raw)) {
    throw new BridgeFailure('BAD_REQUEST', "'target' must be 'normal', 'inbox', or 'today'")
  }
  return raw as VaultLauncherTarget
}

const APP_ID_RE = /^[a-z0-9_-]{1,64}$/i

function parseOptionalAppId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    throw new BridgeFailure('BAD_REQUEST', "'appId' must be a string")
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (!APP_ID_RE.test(trimmed)) {
    throw new BridgeFailure('BAD_REQUEST', "'appId' contains invalid characters")
  }
  return trimmed
}

function parseOptionalSidebarStart(raw: unknown): VaultAppSidebarStart | undefined {
  if (raw === undefined || raw === null) return undefined
  const clean = cleanVaultAppSidebarStart(raw)
  if (clean === null) {
    throw new BridgeFailure('BAD_REQUEST', "'sidebarStart' must be a valid VaultAppSidebarStart")
  }
  return clean
}

function findVaultLauncher(folder: FolderState | undefined, appId?: string): VaultLauncherInfo | null {
  const list = vaultLaunchersOf(folder)
  if (list.length === 0) return null
  if (appId !== undefined) {
    return list.find((l) => (l.id ?? 'default') === appId) ?? null
  }
  return list.find((l) => (l.id ?? 'default') === 'default') ?? list[0]
}

function generateVaultAppId(existing: readonly VaultLauncherInfo[]): string {
  const taken = new Set(existing.map((l) => l.id ?? 'default'))
  for (let i = 0; i < 16; i++) {
    const candidate = randomBytes(4).toString('hex')
    if (!taken.has(candidate)) return candidate
  }
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function parseOptionalBadge(raw: unknown): VaultLauncherBadge | undefined {
  if (raw === undefined) return undefined
  const clean = sanitizeVaultLauncherBadge(raw)
  if (clean === undefined) {
    throw new BridgeFailure('BAD_REQUEST', "'badge' must be a valid badge object with kind, value, and #rrggbb color")
  }
  return clean
}

async function isExistingDirectory(dir: string): Promise<boolean> {
  return stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

async function isReadOnlyVaultOnDisk(root: string): Promise<boolean> {
  const ro = await readConfigDetailed(root, READ_ONLY_FILE)
  return ro.state === 'ok' && isRecord(ro.value) && ro.value.on === true
}

async function isVaultWritableForSync(root: string, isReadOnlyRoot: (root: string) => boolean): Promise<boolean> {
  if (isReadOnlyRoot(root)) return false
  if (!(await isExistingDirectory(root))) return false
  if (await isReadOnlyVaultOnDisk(root)) return false
  return true
}

/** Read one synced preset's preview icon (badge SVG or `.yaseendocs/<iconFile>` PNG). */
async function resolveSyncedPresetIcon(root: string, preset: VaultLauncherPreset): Promise<string | null> {
  if (preset.badge !== undefined) {
    return renderBadgeSvgDataUrl(preset.badge)
  }
  if (preset.iconFile !== undefined) {
    try {
      const iconFilePath = join(root, VAULT_CONFIG_DIR, preset.iconFile)
      const info = await stat(iconFilePath)
      if (!info.isFile() || info.size < PNG_MAGIC.length || info.size > MAX_LAUNCHER_ICON_BYTES) {
        return null
      }
      const buf = await readFile(iconFilePath)
      if (buf.length > MAX_LAUNCHER_ICON_BYTES || buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        return null
      }
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }
  return null
}

/**
 * Read all synced Vault App presets + preview icons from `<root>/.yaseendocs/settings.json` (`vaultApps`,
 * falling back to legacy single `launcher` so older vaults and Mobile stay 100% compatible, YAZ-6743).
 */
async function readSyncedVaultApps(root: string): Promise<Array<{ preset: VaultLauncherPreset; iconDataUrl: string }>> {
  let res: Awaited<ReturnType<typeof readConfigDetailed>>
  try {
    res = await readConfigDetailed(root, VAULT_SETTINGS_FILE)
  } catch {
    return []
  }
  if (res.state !== 'ok' || !isRecord(res.value)) return []
  let presets = sanitizeVaultAppsList(res.value.vaultApps)
  if (presets.length === 0) {
    const legacy = sanitizeVaultLauncherPreset(res.value.launcher)
    if (legacy !== null) presets = [legacy]
  }
  const out: Array<{ preset: VaultLauncherPreset; iconDataUrl: string }> = []
  for (const preset of presets) {
    const iconDataUrl = await resolveSyncedPresetIcon(root, preset)
    if (iconDataUrl !== null) out.push({ preset, iconDataUrl })
  }
  return out
}

/** Read the primary synced vault launcher preset + preview icon (used by icon fallbacks). */
async function readSyncedVaultLauncher(root: string): Promise<{ synced: VaultLauncherPreset; syncedIconDataUrl: string } | null> {
  const all = await readSyncedVaultApps(root)
  const first = all[0]
  return first !== undefined ? { synced: first.preset, syncedIconDataUrl: first.iconDataUrl } : null
}

/** Strip machine-local `folderRoot` from a single-vault Start View so it travels cleanly across Macs. */
function portableVaultSidebarStart(start: VaultAppSidebarStart | undefined): VaultAppSidebarStart | undefined {
  if (start === undefined) return undefined
  const { folderRoot: _omit, ...rest } = start
  return rest
}

/** Upsert one portable Vault App preset into `<root>/.yaseendocs/settings.json` (`vaultApps` + mirrored primary `launcher`, YAZ-6743). */
async function upsertSyncedVaultApp(
  root: string,
  preset: VaultLauncherPreset,
  customPng: Buffer | null,
  isReadOnlyRoot: (root: string) => boolean,
): Promise<void> {
  if (!(await isVaultWritableForSync(root, isReadOnlyRoot))) return
  await withConfigLock(root, VAULT_SETTINGS_FILE, async () => {
    const onDisk = await readConfigDetailed(root, VAULT_SETTINGS_FILE)
    if (onDisk.state === 'malformed' || (onDisk.state === 'ok' && !isRecord(onDisk.value))) {
      console.warn(`[vaultLauncher] skipping synced launcher write in ${root}: ${VAULT_SETTINGS_FILE} is malformed or not a JSON object`)
      return
    }
    const existingVersion =
      onDisk.state === 'ok' && isRecord(onDisk.value) && typeof onDisk.value.version === 'number' && Number.isFinite(onDisk.value.version)
        ? Math.max(VAULT_SETTINGS_VERSION, onDisk.value.version)
        : VAULT_SETTINGS_VERSION
    let existing = onDisk.state === 'ok' && isRecord(onDisk.value) ? sanitizeVaultAppsList(onDisk.value.vaultApps) : []
    if (existing.length === 0 && onDisk.state === 'ok' && isRecord(onDisk.value)) {
      const legacy = sanitizeVaultLauncherPreset(onDisk.value.launcher)
      if (legacy !== null) existing = [legacy]
    }
    const targetKey = preset.id ?? 'default'
    const { id: _rawId, ...restPreset } = preset
    const normalized: VaultLauncherPreset = targetKey === 'default' ? restPreset : { id: targetKey, ...restPreset }
    const idx = existing.findIndex((p) => (p.id ?? 'default') === targetKey)
    const nextList = idx >= 0
      ? existing.map((p, i) => (i === idx ? normalized : p))
      : targetKey === 'default'
        ? [normalized, ...existing]
        : [...existing, normalized]
    const trimmed = nextList.slice(0, MAX_SYNCED_VAULT_APPS)
    const primary = trimmed.find((p) => (p.id ?? 'default') === 'default') ?? trimmed[0]
    const needsArray = trimmed.length >= 2 || (trimmed.length === 1 && trimmed[0]!.id !== undefined)
    await writeConfigUnlocked(
      root,
      VAULT_SETTINGS_FILE,
      {
        version: existingVersion,
        ...(primary !== undefined ? { launcher: primary } : {}),
        ...(needsArray ? { vaultApps: trimmed } : {}),
      },
      LAUNCHER_SETTINGS_KEYS,
    )
    const expectedIconFile = vaultIconFileFor(targetKey)
    const iconFilePath = join(root, VAULT_CONFIG_DIR, expectedIconFile)
    if (customPng !== null && preset.iconFile === expectedIconFile) {
      await atomicWriteBuffer(iconFilePath, customPng)
    } else {
      await rm(iconFilePath, { force: true }).catch(() => undefined)
    }
  })
}

/** Remove one synced Vault App preset (when `appId` is given) or all synced presets from `<root>/.yaseendocs/settings.json`. */
async function clearSyncedVaultApp(root: string, appId: string | undefined, isReadOnlyRoot: (root: string) => boolean): Promise<void> {
  if (isReadOnlyRoot(root) || (await isReadOnlyVaultOnDisk(root))) {
    throw new BridgeFailure('FORBIDDEN', 'Cannot clear synced launcher icon in a read-only vault')
  }
  if (!(await isExistingDirectory(root))) return
  await withConfigLock(root, VAULT_SETTINGS_FILE, async () => {
    const onDisk = await readConfigDetailed(root, VAULT_SETTINGS_FILE)
    const existingVersion =
      onDisk.state === 'ok' && isRecord(onDisk.value) && typeof onDisk.value.version === 'number' && Number.isFinite(onDisk.value.version)
        ? Math.max(VAULT_SETTINGS_VERSION, onDisk.value.version)
        : VAULT_SETTINGS_VERSION
    if (appId !== undefined) {
      if (onDisk.state !== 'ok' || !isRecord(onDisk.value)) return
      let existing = sanitizeVaultAppsList(onDisk.value.vaultApps)
      if (existing.length === 0) {
        const legacy = sanitizeVaultLauncherPreset(onDisk.value.launcher)
        if (legacy !== null) existing = [legacy]
      }
      const removed = existing.find((p) => (p.id ?? 'default') === appId)
      const remaining = existing.filter((p) => (p.id ?? 'default') !== appId)
      const primary = remaining.find((p) => (p.id ?? 'default') === 'default') ?? remaining[0]
      const needsArray = remaining.length >= 2 || (remaining.length === 1 && remaining[0]!.id !== undefined)
      await writeConfigUnlocked(
        root,
        VAULT_SETTINGS_FILE,
        {
          version: existingVersion,
          ...(primary !== undefined ? { launcher: primary } : {}),
          ...(needsArray ? { vaultApps: remaining } : {}),
        },
        LAUNCHER_SETTINGS_KEYS,
      )
      const iconToRemove = removed?.iconFile ?? vaultIconFileFor(appId)
      const stillReferenced = remaining.some((p) => p.iconFile === iconToRemove)
      if (!stillReferenced) {
        await rm(join(root, VAULT_CONFIG_DIR, iconToRemove), { force: true }).catch(() => undefined)
      }
      return
    }
    const existingAll = onDisk.state === 'ok' && isRecord(onDisk.value) ? sanitizeVaultAppsList(onDisk.value.vaultApps) : []
    if (onDisk.state === 'ok' && isRecord(onDisk.value) && (Object.hasOwn(onDisk.value, 'launcher') || Object.hasOwn(onDisk.value, 'vaultApps'))) {
      await writeConfigUnlocked(root, VAULT_SETTINGS_FILE, { version: existingVersion }, LAUNCHER_SETTINGS_KEYS)
    }
    await rm(join(root, VAULT_CONFIG_DIR, VAULT_ICON_FILE), { force: true }).catch(() => undefined)
    for (const p of existingAll) {
      if (p.iconFile !== undefined) {
        await rm(join(root, VAULT_CONFIG_DIR, p.iconFile), { force: true }).catch(() => undefined)
      }
    }
  })
}

function readSyncedWorkspaceLauncher(store: Store, workspaceName: string): { synced: VaultLauncherPreset; syncedIconDataUrl: string } | null {
  const key = workspaceLauncherKey(workspaceName)
  if (key.length === 0) return null
  const launchers = store.get().settings.workspaceLaunchers
  if (!Object.hasOwn(launchers, key)) return null
  const preset = launchers[key]
  if (preset === undefined || preset.badge === undefined) return null
  return { synced: preset, syncedIconDataUrl: renderBadgeSvgDataUrl(preset.badge) }
}

async function atomicWriteBuffer(filePath: string, data: Buffer): Promise<void> {
  const dir = join(filePath, '..')
  await mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp-${randomUUID()}`
  try {
    await writeFile(tmp, data)
    await rename(tmp, filePath)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

async function readIconDataUrl(iconPath: string): Promise<string | null> {
  try {
    const buf = await readFile(iconPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** Fallback stub backend when no platform backend is wired (e.g. Windows/Linux or before bundle wiring). */
export function createUnsupportedVaultLauncherBackend(): VaultLauncherBackend {
  return {
    supported: false,
    install: async () => {
      throw new BridgeFailure('BAD_REQUEST', 'Vault launchers are only supported on macOS')
    },
    remove: async () => undefined,
    reveal: () => undefined,
    launch: () => undefined,
    exists: () => false,
  }
}

/**
 * Best-effort cleanup of a workspace's `.app` bundle and cached icon PNG when the workspace is removed
 * (`window:remove-set`, YAZ-6447 D3). Never throws so workspace deletion always succeeds.
 */
export async function cleanupWorkspaceLauncher(
  store: Store,
  backend: VaultLauncherBackend,
  workspaceId: string,
  onChanged: () => void = () => broadcastAll(CONTRACT.vaultLauncher.onChanged.channel),
): Promise<void> {
  const launcher = store.get().vaultSets.find((s) => s.id === workspaceId)?.launcher
  if (launcher === undefined) return
  if (backend.exists(launcher.appPath)) {
    await backend.remove(launcher.appPath, workspaceVaultPath(workspaceId)).catch(() => undefined)
  }
  await rm(launcher.iconPath, { force: true }).catch(() => undefined)
  onChanged()
}

/**
 * Registers `vault-launcher:*` IPC handlers (YAZ-5967, YAZ-6374, YAZ-6447).
 *
 * Persists `FolderState.launcher` in `store`, caches 512x512 PNGs under `<userData>/vault-icons/`,
 * and broadcasts `vault-launcher:changed` to keep icons in sync across all windows.
 */
export function registerVaultLauncherIpc(
  store: Store,
  userData: string,
  backend: VaultLauncherBackend,
  onChanged: () => void = () => broadcastAll(CONTRACT.vaultLauncher.onChanged.channel),
  isReadOnlyRoot: (root: string) => boolean = () => false,
): void {
  const buildLaunchersStatusList = async (folder: FolderState | undefined) => {
    const list = vaultLaunchersOf(folder)
    return Promise.all(
      list.map(async (entry) => ({
        launcher: entry,
        exists: backend.exists(entry.appPath),
        iconDataUrl: await readIconDataUrl(entry.iconPath),
      })),
    )
  }

  handle(CONTRACT.vaultLauncher.status, async (rawRoot: unknown, rawAppId?: unknown): Promise<VaultLauncherStatus> => {
    const root = requireAbsPath(rawRoot, 'root')
    const appId = parseOptionalAppId(rawAppId)
    const folder = store.get().folders[root]
    const all = await buildLaunchersStatusList(folder)
    const match =
      appId !== undefined
        ? (all.find((item) => (item.launcher.id ?? 'default') === appId) ?? null)
        : (all.find((item) => (item.launcher.id ?? 'default') === 'default') ?? all[0] ?? null)
    const syncedApps = await readSyncedVaultApps(root)
    const firstSynced = syncedApps[0] ?? null
    return {
      supported: backend.supported,
      launcher: match?.launcher ?? null,
      exists: match?.exists ?? false,
      iconDataUrl: match?.iconDataUrl ?? null,
      ...(all.length > 0 ? { launchers: all } : {}),
      ...(firstSynced !== null ? { synced: firstSynced.preset, syncedIconDataUrl: firstSynced.iconDataUrl } : {}),
      ...(syncedApps.length > 0 ? { syncedApps } : {}),
    }
  })

  handle(CONTRACT.vaultLauncher.create, async (rawReq: unknown): Promise<VaultLauncherStatus> => {
    if (!backend.supported) {
      throw new BridgeFailure('BAD_REQUEST', 'Vault launchers are only supported on macOS')
    }
    if (!isRecord(rawReq)) {
      throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
    }
    const root = requireAbsPath(rawReq.root, 'root')
    const requestedAppId = parseOptionalAppId(rawReq.appId)
    const name = cleanVaultName(rawReq.name)
    if (name === null) {
      throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
    }
    const png = decodeLauncherPng(rawReq.pngBase64)
    const target = parseOptionalTarget(rawReq.target)
    const badge = parseOptionalBadge(rawReq.badge)
    const sidebarStart = parseOptionalSidebarStart(rawReq.sidebarStart)

    const existingList = vaultLaunchersOf(store.get().folders[root])
    const existing =
      requestedAppId !== undefined
        ? existingList.find((l) => (l.id ?? 'default') === requestedAppId)
        : undefined
    const appId = requestedAppId ?? (existingList.length === 0 ? 'default' : generateVaultAppId(existingList))

    const iconPath = vaultLauncherIconPath(userData, root, appId)
    const previousAppPath = existing?.appPath
    const installed = await backend.install({
      root,
      appId,
      name,
      png,
      iconPath,
      target,
      previousAppPath,
    })
    // Write the cached icon PNG only after install succeeds so a failed install never overwrites an existing icon.
    await atomicWriteBuffer(iconPath, png)

    const installedName = installed.name !== undefined ? (cleanVaultName(installed.name) ?? name) : name
    const launcher: VaultLauncherInfo | null = cleanVaultLauncher({
      id: appId,
      name: installedName,
      appPath: installed.appPath,
      iconPath,
      ...(target !== undefined ? { target } : {}),
      ...(badge !== undefined ? { badge } : {}),
      ...(sidebarStart !== undefined ? { sidebarStart } : {}),
      ...(existing?.lastBounds !== undefined ? { lastBounds: existing.lastBounds } : {}),
    })
    if (launcher === null) {
      throw new BridgeFailure('IO_ERROR', 'Installed launcher metadata was invalid')
    }

    store.upsertVaultLauncher(root, launcher)

    // Best-effort sync of every Vault App preset (name, icon, target, and portable Start View) into `<root>/.yaseendocs/settings.json` (YAZ-6743).
    const portableStart = portableVaultSidebarStart(sidebarStart)
    const preset: VaultLauncherPreset = {
      ...(appId !== 'default' ? { id: appId } : {}),
      name: installedName,
      ...(target !== undefined ? { target } : {}),
      ...(badge !== undefined ? { badge } : { iconFile: vaultIconFileFor(appId) }),
      ...(portableStart !== undefined ? { sidebarStart: portableStart } : {}),
    }
    try {
      await upsertSyncedVaultApp(root, preset, badge === undefined ? png : null, isReadOnlyRoot)
    } catch (err) {
      console.warn(`[vaultLauncher] failed to persist synced launcher preset in ${root}: ${String(err)}`)
    }

    onChanged()

    const all = await buildLaunchersStatusList(store.get().folders[root])
    const syncedApps = await readSyncedVaultApps(root)
    const firstSynced = syncedApps[0] ?? null
    return {
      supported: backend.supported,
      launcher,
      exists: backend.exists(installed.appPath),
      iconDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      launchers: all,
      ...(firstSynced !== null ? { synced: firstSynced.preset, syncedIconDataUrl: firstSynced.iconDataUrl } : {}),
      ...(syncedApps.length > 0 ? { syncedApps } : {}),
    }
  })

  handle(CONTRACT.vaultLauncher.remove, async (rawRoot: unknown, rawAppId?: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const appId = parseOptionalAppId(rawAppId)
    const launcher = findVaultLauncher(store.get().folders[root], appId)
    if (launcher === null) return

    if (backend.exists(launcher.appPath)) {
      await backend.remove(launcher.appPath, root)
    }
    await rm(launcher.iconPath, { force: true }).catch(() => undefined)
    store.removeVaultLauncher(root, launcher.id ?? 'default')
    onChanged()
  })

  handle(CONTRACT.vaultLauncher.clearSynced, async (rawRoot: unknown, rawAppId?: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const appId = parseOptionalAppId(rawAppId)
    await clearSyncedVaultApp(root, appId, isReadOnlyRoot)
    onChanged()
  })

  handle(CONTRACT.vaultLauncher.reveal, async (rawRoot: unknown, rawAppId?: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const appId = parseOptionalAppId(rawAppId)
    const launcher = findVaultLauncher(store.get().folders[root], appId)
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Vault launcher app not found', { path: launcher?.appPath })
    }
    await backend.reveal(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.test, async (rawRoot: unknown, rawAppId?: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const appId = parseOptionalAppId(rawAppId)
    const launcher = findVaultLauncher(store.get().folders[root], appId)
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Vault launcher app not found', { path: launcher?.appPath })
    }
    await backend.launch(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.icons, async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {}
    const state = store.get()
    const knownRoots = new Set<string>(Object.keys(state.folders))
    for (const r of state.recents) knownRoots.add(r.path)
    for (const w of state.windows) {
      for (const r of w.roots) knownRoots.add(r)
    }
    await Promise.all(
      [...knownRoots].map(async (root) => {
        const launchers = vaultLaunchersOf(state.folders[root])
        if (launchers.length > 0) {
          for (const launcher of launchers) {
            if (!backend.exists(launcher.appPath)) continue
            const dataUrl = await readIconDataUrl(launcher.iconPath)
            if (dataUrl !== null) {
              out[root] = dataUrl
              return
            }
          }
          return
        }
        // Fallback to synced vault icon (badge SVG or `.yaseendocs/vault-icon.png`) when no local `.app` is installed.
        const syncedRes = await readSyncedVaultLauncher(root)
        if (syncedRes !== null) out[root] = syncedRes.syncedIconDataUrl
      }),
    )
    return out
  })

  handle(CONTRACT.vaultLauncher.vaultApps, async (): Promise<Record<string, VaultAppSummary[]>> => {
    const state = store.get()
    const out: Record<string, VaultAppSummary[]> = {}
    for (const [root, folder] of Object.entries(state.folders)) {
      const list = vaultLaunchersOf(folder)
      if (list.length === 0) continue
      out[root] = list.map((l) => ({
        id: l.id ?? 'default',
        name: l.name,
        ...(l.target !== undefined ? { target: l.target } : {}),
        ...(l.sidebarStart !== undefined ? { sidebarStart: l.sidebarStart } : {}),
      }))
    }
    return out
  })

  handle(CONTRACT.vaultLauncher.workspaceStatus, async (rawId: unknown): Promise<VaultLauncherStatus> => {
    const workspaceId = requireWorkspaceId(rawId)
    const set = store.get().vaultSets.find((s) => s.id === workspaceId)
    const launcher = set?.launcher ?? null
    const exists = launcher !== null && backend.exists(launcher.appPath)
    const iconDataUrl = launcher !== null ? await readIconDataUrl(launcher.iconPath) : null
    const syncedRes = set !== undefined ? readSyncedWorkspaceLauncher(store, set.name) : null
    return {
      supported: backend.supported,
      launcher,
      exists,
      iconDataUrl,
      ...(syncedRes !== null ? { synced: syncedRes.synced, syncedIconDataUrl: syncedRes.syncedIconDataUrl } : {}),
    }
  })

  handle(CONTRACT.vaultLauncher.createWorkspace, async (rawReq: unknown): Promise<VaultLauncherStatus> => {
    if (!backend.supported) {
      throw new BridgeFailure('BAD_REQUEST', 'Vault launchers are only supported on macOS')
    }
    if (!isRecord(rawReq)) {
      throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
    }
    const workspaceId = requireWorkspaceId(rawReq.workspaceId)
    const set = store.get().vaultSets.find((s) => s.id === workspaceId)
    if (set === undefined) {
      throw new BridgeFailure('NOT_FOUND', 'Workspace not found')
    }
    const name = cleanVaultName(rawReq.name)
    if (name === null) {
      throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
    }
    const png = decodeLauncherPng(rawReq.pngBase64)
    const badge = parseOptionalBadge(rawReq.badge)
    const sidebarStart = parseOptionalSidebarStart(rawReq.sidebarStart)

    const iconPath = workspaceLauncherIconPath(userData, workspaceId)
    const previousAppPath = set.launcher?.appPath
    const installed = await backend.install({
      root: workspaceVaultPath(workspaceId),
      vaultUrl: workspaceLink(workspaceId),
      name,
      png,
      iconPath,
      previousAppPath,
    })
    await atomicWriteBuffer(iconPath, png)

    const installedName = installed.name !== undefined ? (cleanVaultName(installed.name) ?? name) : name
    const launcher: VaultLauncherInfo | null = cleanVaultLauncher({
      name: installedName,
      appPath: installed.appPath,
      iconPath,
      ...(badge !== undefined ? { badge } : {}),
      ...(sidebarStart !== undefined ? { sidebarStart } : {}),
    })
    if (launcher === null) {
      throw new BridgeFailure('IO_ERROR', 'Installed launcher metadata was invalid')
    }

    store.setVaultSetLauncher(workspaceId, launcher)

    // Sync badge-based workspace launcher presets via SettingsState.workspaceLaunchers (travels across Macs).
    const wsKey = workspaceLauncherKey(set.name)
    if (wsKey.length > 0) {
      const currentSettings = store.get().settings
      const nextLaunchers = { ...currentSettings.workspaceLaunchers }
      if (badge !== undefined) {
        nextLaunchers[wsKey] = {
          name: installedName,
          badge,
          ...(sidebarStart !== undefined ? { sidebarStart } : {}),
        }
        store.setSettings({ ...currentSettings, workspaceLaunchers: nextLaunchers })
      } else if (Object.hasOwn(nextLaunchers, wsKey)) {
        delete nextLaunchers[wsKey]
        store.setSettings({ ...currentSettings, workspaceLaunchers: nextLaunchers })
      }
    }

    onChanged()

    return {
      supported: backend.supported,
      launcher,
      exists: backend.exists(installed.appPath),
      iconDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    }
  })

  handle(CONTRACT.vaultLauncher.removeWorkspace, async (rawId: unknown): Promise<void> => {
    const workspaceId = requireWorkspaceId(rawId)
    const launcher = store.get().vaultSets.find((s) => s.id === workspaceId)?.launcher ?? null
    if (launcher === null) return

    if (backend.exists(launcher.appPath)) {
      await backend.remove(launcher.appPath, workspaceVaultPath(workspaceId))
    }
    await rm(launcher.iconPath, { force: true }).catch(() => undefined)
    store.setVaultSetLauncher(workspaceId, null)
    onChanged()
  })

  handle(CONTRACT.vaultLauncher.clearSyncedWorkspace, async (rawId: unknown): Promise<void> => {
    const workspaceId = requireWorkspaceId(rawId)
    const set = store.get().vaultSets.find((s) => s.id === workspaceId)
    if (set === undefined) return
    const wsKey = workspaceLauncherKey(set.name)
    const currentSettings = store.get().settings
    if (!Object.hasOwn(currentSettings.workspaceLaunchers, wsKey)) return
    const nextLaunchers = { ...currentSettings.workspaceLaunchers }
    delete nextLaunchers[wsKey]
    store.setSettings({ ...currentSettings, workspaceLaunchers: nextLaunchers })
    onChanged()
  })

  handle(CONTRACT.vaultLauncher.revealWorkspace, async (rawId: unknown): Promise<void> => {
    const workspaceId = requireWorkspaceId(rawId)
    const launcher = store.get().vaultSets.find((s) => s.id === workspaceId)?.launcher ?? null
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Workspace launcher app not found', { path: launcher?.appPath })
    }
    await backend.reveal(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.testWorkspace, async (rawId: unknown): Promise<void> => {
    const workspaceId = requireWorkspaceId(rawId)
    const launcher = store.get().vaultSets.find((s) => s.id === workspaceId)?.launcher ?? null
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Workspace launcher app not found', { path: launcher?.appPath })
    }
    await backend.launch(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.workspaceIcons, async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {}
    const sets = store.get().vaultSets
    await Promise.all(
      sets.map(async (set) => {
        const launcher = set.launcher
        if (launcher !== undefined) {
          if (!backend.exists(launcher.appPath)) return
          const dataUrl = await readIconDataUrl(launcher.iconPath)
          if (dataUrl !== null) out[set.id] = dataUrl
          return
        }
        // Fallback to synced workspace badge SVG when no local `.app` is installed on this Mac.
        const syncedRes = readSyncedWorkspaceLauncher(store, set.name)
        if (syncedRes !== null) out[set.id] = syncedRes.syncedIconDataUrl
      }),
    )
    return out
  })

  const normalizeAppKey = (appPath: string): string =>
    process.platform === 'darwin' ? resolve(appPath).toLowerCase() : resolve(appPath)

  handle(CONTRACT.vaultLauncher.listAll, async (): Promise<LauncherListItem[]> => {
    if (!backend.supported) return []
    const state = store.get()
    const registeredPaths = new Set<string>()
    const items: LauncherListItem[] = []

    const vaultPairs: Array<{ root: string; folder: FolderState; launcher: VaultLauncherInfo }> = []
    for (const [root, folder] of Object.entries(state.folders)) {
      for (const launcher of vaultLaunchersOf(folder)) {
        registeredPaths.add(normalizeAppKey(launcher.appPath))
        vaultPairs.push({ root, folder, launcher })
      }
    }
    const vaultItems = await Promise.all(
      vaultPairs.map(async ({ root, folder, launcher }): Promise<LauncherListItem> => {
        const iconDataUrl = await readIconDataUrl(launcher.iconPath)
        return {
          kind: 'vault',
          id: root,
          appId: launcher.id ?? 'default',
          name: launcher.name,
          appPath: launcher.appPath,
          exists: backend.exists(launcher.appPath),
          iconDataUrl,
          targetName: folder.name ?? basename(root),
          ...(launcher.target !== undefined ? { target: launcher.target } : {}),
          ...(launcher.sidebarStart !== undefined ? { sidebarStart: launcher.sidebarStart } : {}),
        }
      }),
    )
    items.push(...vaultItems)

    const workspaceSets = state.vaultSets.filter((set) => set.launcher !== undefined)
    const workspaceItems = await Promise.all(
      workspaceSets.map(async (set): Promise<LauncherListItem> => {
        const launcher = set.launcher!
        registeredPaths.add(normalizeAppKey(launcher.appPath))
        const iconDataUrl = await readIconDataUrl(launcher.iconPath)
        return {
          kind: 'workspace',
          id: set.id,
          name: launcher.name,
          appPath: launcher.appPath,
          exists: backend.exists(launcher.appPath),
          iconDataUrl,
          targetName: set.name,
          ...(launcher.sidebarStart !== undefined ? { sidebarStart: launcher.sidebarStart } : {}),
        }
      }),
    )
    items.push(...workspaceItems)

    const scanned = backend.scan ? await backend.scan() : await scanInstalledLaunchers()
    for (const entry of scanned) {
      const key = normalizeAppKey(entry.appPath)
      if (registeredPaths.has(key)) continue
      registeredPaths.add(key)
      items.push({
        kind: 'orphan',
        id: entry.appPath,
        name: entry.name,
        appPath: entry.appPath,
        exists: true,
        iconDataUrl: null,
        targetName: entry.info.vaultPath ?? 'Unknown target',
        ...(entry.info.vaultPath !== null ? { vaultPath: entry.info.vaultPath } : {}),
      })
    }

    return items
  })

  handle(CONTRACT.vaultLauncher.removeOrphan, async (rawAppPath: unknown): Promise<void> => {
    if (!backend.supported) {
      throw new BridgeFailure('BAD_REQUEST', 'Vault launchers are only supported on macOS')
    }
    const appPath = requireAbsPath(rawAppPath, 'appPath')
    if (backend.removeOrphan) {
      await backend.removeOrphan(appPath)
    } else {
      const present = await stat(appPath).then(
        () => true,
        () => false,
      )
      if (present) {
        const info = await readLauncherPlist(appPath)
        if (!isOwnLauncher(info)) {
          throw new BridgeFailure('BAD_REQUEST', `Refusing to remove "${appPath}": it is not a Yaseen Docs launcher.`)
        }
        await backend.remove(appPath, info.vaultPath ?? '')
      }
    }
    onChanged()
  })
}
