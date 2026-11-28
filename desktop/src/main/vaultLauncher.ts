/**
 * macOS Vault App shim builder and pure-TS `.icns` encoder (YAZ-5967, YAZ-6373, YAZ-6624).
 *
 * Each vault can install a lightweight `.app` bundle into `/Applications/<Name>.app` (or
 * `~/Applications/<Name>.app` when `/Applications` is not writable). The bundle wraps
 * Electron's `app_shim_loader` helper, an `Info.plist` declaring the host bundle and
 * `YaseenDocsVaultURL` / `YaseenDocsVaultPath`, and an `AppIcon.icns` generated directly
 * from a 512×512 PNG buffer with zero external dependencies.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileLink, type LinkOpenTarget } from '@shared/links'
import { stripSlash } from '@shared/types'

const execFileAsync = promisify(nodeExecFile)

/** Bundle identifier prefix owned by Yaseen Docs vault launchers (used by collision & remove guards). */
export const LAUNCHER_BUNDLE_ID_PREFIX = 'com.yasinarshad.yaseendocs.launcher.'

/** Electron App Shim loader executable filename inside `Contents/MacOS/`. */
export const APP_SHIM_EXECUTABLE = 'app_shim_loader'

/** Default macOS host bundle identifier written to `ElectronAppShimHostBundleIdentifier`. */
export const APP_SHIM_HOST_BUNDLE_ID = 'com.yasinarshad.yaseendocs'

/** CLI flag passed by macOS App Shims when launching the host app headlessly. */
export const APP_SHIM_HOST_ARG = '--app-shim-host'

/** Default macOS host bundle path written to `ElectronAppShimHostPath`. */
const DEFAULT_APP_SHIM_HOST_PATH = '/Applications/Yaseen Docs.app'

/** Current launcher bundle version written to `CFBundleVersion` (YAZ-6605, YAZ-6624). */
export const LAUNCHER_BUNDLE_VERSION = 3

/** Path to macOS LaunchServices registration helper. */
export const LSREGISTER_PATH = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/** Maximum sanitized bundle name length (without `.app`). */
export const MAX_BUNDLE_NAME_LENGTH = 80

/** Standard 8-byte PNG signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface InstallVaultLauncherOptions {
  /** Display / bundle name (without `.app`). Sanitized before use. */
  name: string
  /** Absolute path to the vault folder (or stable identifier such as `workspace:<id>` for collision/remove guards). */
  vaultPath: string
  /** Optional deep-link URL to write as `YaseenDocsVaultURL` (overrides `fileLink(vaultPath, openTarget)`). */
  vaultUrl?: string
  /** 512×512 PNG buffer encoded into `Contents/Resources/AppIcon.icns`. */
  iconPng: Buffer
  /** Optional target view when opening the vault (`'inbox'` or `'today'`). */
  openTarget?: LinkOpenTarget
  /** Previous `.app` path when updating or renaming an existing launcher for this vault. */
  previousAppPath?: string | null
  /** Path to Electron's `app_shim_loader` helper (`appShimLoaderPath(process.execPath)`). */
  binaryPath: string
  /** Optional host `.app` bundle path for `ElectronAppShimHostPath` (defaults to `/Applications/Yaseen Docs.app`). */
  hostBundlePath?: string
  /** Optional host bundle ID for `ElectronAppShimHostBundleIdentifier` (defaults to `APP_SHIM_HOST_BUNDLE_ID`). */
  hostBundleId?: string
  /** Optional Electron App Shim server name for `ElectronAppShimServerName` (omitted when undefined/empty). */
  serverName?: string
}

export interface InstallVaultLauncherResult {
  appPath: string
  name: string
  bundleId: string
  vaultUrl: string
}

export interface VaultLauncherDeps {
  /** Candidate Applications directories in preference order. Defaults to `resolveLauncherAppDirs()`. */
  appDirs?: readonly string[]
  /** Move a bundle to the macOS Trash (in main, `shell.trashItem`). */
  trashItem: (path: string) => Promise<void>
  /** Run an external command (`codesign`, `lsregister`). Defaults to `child_process.execFile`. */
  execFile?: (file: string, args: readonly string[]) => Promise<void>
  /** Check whether a directory is writable. Defaults to `fs.access(dir, W_OK)`. */
  isWritable?: (dir: string) => Promise<boolean>
  /** Platform override for case-insensitive path checks (defaults to `process.platform`). */
  platform?: NodeJS.Platform
  /** Optional codesign identity passed to `codesign --force --sign <identity>`. Defaults to `'-'` (ad-hoc). */
  signIdentity?: string
}

export interface RefreshOutdatedLaunchersDeps extends Pick<VaultLauncherDeps, 'appDirs' | 'execFile' | 'signIdentity'> {
  /** Optional host `.app` bundle path to write as `ElectronAppShimHostPath` (also triggers refresh when host moved). */
  hostBundlePath?: string
  /** Optional host bundle ID for `ElectronAppShimHostBundleIdentifier`. */
  hostBundleId?: string
  /** Optional Electron App Shim server name for `ElectronAppShimServerName`. */
  serverName?: string
}

export interface ScannedLauncher {
  appPath: string
  name: string
  info: LauncherPlistInfo
}

export interface LauncherPlistInfo {
  bundleId: string | null
  vaultPath: string | null
  vaultUrl: string | null
  bundleVersion: number | null
  displayName?: string | null
  hostPath?: string | null
  hostBundleId?: string | null
  serverName?: string | null
}

/**
 * Pure-TS `.icns` encoder (0 dependencies): wraps a 512×512 PNG buffer in a valid Apple
 * `icns` container with a single `ic09` (512×512 PNG) chunk.
 */
export function encodeIcnsFromPng(png: Buffer): Buffer {
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('encodeIcnsFromPng: input must be a valid PNG buffer')
  }
  const chunkSize = 8 + png.length
  const totalSize = 8 + chunkSize
  const out = Buffer.allocUnsafe(totalSize)
  // File header: 'icns' + total file length (big-endian uint32).
  out.write('icns', 0, 'ascii')
  out.writeUInt32BE(totalSize, 4)
  // Icon chunk header: 'ic09' (512×512 PNG) + chunk length including its 8-byte header.
  out.write('ic09', 8, 'ascii')
  out.writeUInt32BE(chunkSize, 12)
  png.copy(out, 16)
  return out
}

/**
 * Path to Electron's `app_shim_loader` helper inside the running host `.app` bundle.
 * On macOS, `execPath` is `<App>.app/Contents/MacOS/<Binary>` for both packaged `Yaseen Docs.app` and dev `Electron.app`.
 */
export function appShimLoaderPath(execPath: string): string {
  return resolve(dirname(execPath), '..', 'Frameworks', 'Electron Framework.framework', 'Helpers', APP_SHIM_EXECUTABLE)
}

/** Root `.app` bundle path derived from `process.execPath` (`<App>.app/Contents/MacOS/<Binary>` -> `<App>.app`). */
export function hostBundlePathFromExecPath(execPath: string): string {
  return resolve(dirname(execPath), '..', '..')
}

/**
 * Resolve candidate Applications directories for installing and scanning Vault App shims.
 * Honors `YASEEN_DOCS_APP_SHIM_DIRS` (colon-separated) for isolated demo/test runs.
 */
export function resolveLauncherAppDirs(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const raw = env.YASEEN_DOCS_APP_SHIM_DIRS
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const dirs = raw
      .split(':')
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0)
    if (dirs.length > 0) return dirs
  }
  return ['/Applications', join(homedir(), 'Applications')]
}

/**
 * Sanitize a launcher `.app` bundle name: removes `/` and `:` and control characters,
 * strips trailing `.app` suffix, removes leading `.` characters, collapses whitespace,
 * enforces length `<= 80`, and rejects empty results.
 */
export function sanitizeBundleName(raw: string): string {
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f/:]+/g, ' ')
    .trim()
    .replace(/\.app$/i, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BUNDLE_NAME_LENGTH)
    .trim()
    .replace(/^\.+/, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error('Launcher name cannot be empty')
  }
  return cleaned
}

/** Deterministic `CFBundleIdentifier` under `com.yasinarshad.yaseendocs.launcher.<slug>`. */
export function launcherBundleId(vaultPath: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const hash = createHash('sha256').update(stripSlash(vaultPath)).digest('hex').slice(0, 8)
  return `${LAUNCHER_BUNDLE_ID_PREFIX}${slug.length > 0 ? `${slug}-` : ''}${hash}`
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const unescapeXml = (value: string): string =>
  value.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')

export interface BuildLauncherPlistFields {
  name: string
  bundleId: string
  vaultUrl: string
  vaultPath: string
  hostBundlePath?: string
  hostBundleId?: string
  serverName?: string
}

type PlistEntryValue = string | boolean | readonly string[]

/** Build XML `Contents/Info.plist` for a v3 Electron App Shim Vault App bundle. */
export function buildLauncherPlist(fields: BuildLauncherPlistFields): string {
  const hostBundlePath = fields.hostBundlePath && fields.hostBundlePath.length > 0 ? fields.hostBundlePath : DEFAULT_APP_SHIM_HOST_PATH
  const hostBundleId = fields.hostBundleId && fields.hostBundleId.length > 0 ? fields.hostBundleId : APP_SHIM_HOST_BUNDLE_ID
  const entries: Array<[string, PlistEntryValue]> = [
    ['CFBundleDevelopmentRegion', 'en'],
    ['CFBundleDisplayName', fields.name],
    ['CFBundleExecutable', APP_SHIM_EXECUTABLE],
    ['CFBundleIconFile', 'AppIcon'],
    ['CFBundleIdentifier', fields.bundleId],
    ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', fields.name],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', '1.0'],
    ['CFBundleVersion', String(LAUNCHER_BUNDLE_VERSION)],
    ['LSMinimumSystemVersion', '12.0'],
    ['NSHighResolutionCapable', true],
    ['ElectronAppShimHostPath', hostBundlePath],
    ['ElectronAppShimHostBundleIdentifier', hostBundleId],
    ['ElectronAppShimHostArguments', [APP_SHIM_HOST_ARG]],
  ]
  if (fields.serverName !== undefined && fields.serverName.length > 0) {
    entries.push(['ElectronAppShimServerName', fields.serverName])
  }
  entries.push(['YaseenDocsVaultURL', fields.vaultUrl], ['YaseenDocsVaultPath', fields.vaultPath])
  const body = entries
    .map(([key, value]) => {
      if (typeof value === 'boolean') {
        return `  <key>${escapeXml(key)}</key>\n  <${value ? 'true' : 'false'}/>`
      }
      if (typeof value === 'string') {
        return `  <key>${escapeXml(key)}</key>\n  <string>${escapeXml(value)}</string>`
      }
      const items = value.map((item) => `    <string>${escapeXml(item)}</string>`).join('\n')
      return `  <key>${escapeXml(key)}</key>\n  <array>\n${items}\n  </array>`
    })
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    body,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

function readPlistString(xml: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<key>${escapedKey}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(xml)
  return match === null ? null : unescapeXml(match[1])
}

/**
 * Read Yaseen Docs launcher & Electron App Shim metadata from an `.app`'s `Contents/Info.plist`.
 * Returns `null` if the plist cannot be read (e.g. missing bundle).
 * Non-XML (binary) plists parse with `null` fields, so guards fail closed on third-party apps.
 */
export async function readLauncherPlist(appPath: string): Promise<LauncherPlistInfo | null> {
  try {
    const xml = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    const rawVersion = readPlistString(xml, 'CFBundleVersion')
    return {
      bundleId: readPlistString(xml, 'CFBundleIdentifier'),
      vaultPath: readPlistString(xml, 'YaseenDocsVaultPath'),
      vaultUrl: readPlistString(xml, 'YaseenDocsVaultURL'),
      bundleVersion: rawVersion !== null && /^\d+$/.test(rawVersion) ? Number(rawVersion) : null,
      displayName: readPlistString(xml, 'CFBundleDisplayName') ?? readPlistString(xml, 'CFBundleName'),
      hostPath: readPlistString(xml, 'ElectronAppShimHostPath'),
      hostBundleId: readPlistString(xml, 'ElectronAppShimHostBundleIdentifier'),
      serverName: readPlistString(xml, 'ElectronAppShimServerName'),
    }
  } catch {
    return null
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function defaultIsWritable(dir: string): Promise<boolean> {
  try {
    await access(dir, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

async function defaultExecFile(file: string, args: readonly string[]): Promise<void> {
  await execFileAsync(file, [...args])
}

/** Pick the first writable Applications directory, creating `~/Applications` (or fallback dirs) if needed. */
export async function pickApplicationsDir(
  candidates: readonly string[] = resolveLauncherAppDirs(),
  isWritable: (dir: string) => Promise<boolean> = defaultIsWritable,
): Promise<string> {
  for (const dir of candidates) {
    if (!(await pathExists(dir))) {
      // Never try to create `/Applications` itself, only user-level directories like `~/Applications`.
      if (dir === '/Applications') continue
      try {
        await mkdir(dir, { recursive: true })
      } catch {
        continue
      }
    }
    if (await isWritable(dir)) return dir
  }
  throw new Error(`No writable Applications folder found (checked: ${candidates.join(', ')})`)
}

export function isOwnLauncher(info: LauncherPlistInfo | null): info is LauncherPlistInfo {
  return info !== null && info.bundleId !== null && info.bundleId.startsWith(LAUNCHER_BUNDLE_ID_PREFIX)
}

function isLauncherForVault(info: LauncherPlistInfo | null, normalizedVaultPath: string): boolean {
  return isOwnLauncher(info) && info.vaultPath !== null && stripSlash(info.vaultPath) === normalizedVaultPath
}

async function isSameAppPath(a: string, b: string, platform: NodeJS.Platform): Promise<boolean> {
  if (a === b) return true
  if (platform === 'darwin' && a.toLowerCase() === b.toLowerCase()) return true
  try {
    const [statA, statB] = await Promise.all([stat(a), stat(b)])
    return statA.dev === statB.dev && statA.ino === statB.ino
  } catch {
    return false
  }
}

/**
 * Atomically build, ad-hoc sign, and install a macOS `.app` launcher for a vault.
 *
 * - Picks `/Applications` or falls back to `~/Applications`.
 * - Refuses to overwrite an existing `.app` unless it is our launcher for this vault (or matches `previousAppPath`).
 * - Stages in a sibling temp bundle, signs with `codesign --force --sign -`, and swaps atomically.
 * - Touches mtime and runs `lsregister -f` (best-effort) so Finder/Spotlight/Alfred refresh the icon.
 * - Trashes `previousAppPath` after a rename if it belongs to this vault.
 */
export async function installVaultLauncher(opts: InstallVaultLauncherOptions, deps: VaultLauncherDeps): Promise<InstallVaultLauncherResult> {
  const name = sanitizeBundleName(opts.name)
  const normalizedVaultPath = stripSlash(opts.vaultPath)
  const vaultUrl = opts.vaultUrl ?? fileLink(normalizedVaultPath, opts.openTarget === undefined ? undefined : { open: opts.openTarget })
  const bundleId = launcherBundleId(normalizedVaultPath, name)
  const icns = encodeIcnsFromPng(opts.iconPng)

  const exec = deps.execFile ?? defaultExecFile
  const identity = deps.signIdentity && deps.signIdentity.length > 0 ? deps.signIdentity : '-'
  const dir = await pickApplicationsDir(deps.appDirs, deps.isWritable)
  const target = join(dir, `${name}.app`)
  const previousResolved = opts.previousAppPath != null && opts.previousAppPath.length > 0 ? resolve(opts.previousAppPath) : null
  const targetResolved = resolve(target)

  // Collision guard: never overwrite a third-party app or another vault's launcher.
  const targetExists = await pathExists(target)
  if (targetExists) {
    const existing = await readLauncherPlist(target)
    const ownsTarget = isOwnLauncher(existing) && (isLauncherForVault(existing, normalizedVaultPath) || previousResolved === targetResolved)
    if (!ownsTarget) {
      throw new Error(`Cannot overwrite "${target}": an app with that name already exists and is not this vault's launcher.`)
    }
  }

  // Stage in a sibling temp directory so rename into `target` is atomic on the same filesystem.
  const tmpApp = join(dir, `.yaseen-launcher-tmp-${randomUUID()}.app`)
  const contentsDir = join(tmpApp, 'Contents')
  const macOsDir = join(contentsDir, 'MacOS')
  const resourcesDir = join(contentsDir, 'Resources')

  try {
    await mkdir(macOsDir, { recursive: true })
    await mkdir(resourcesDir, { recursive: true })

    const plistXml = buildLauncherPlist({
      name,
      bundleId,
      vaultUrl,
      vaultPath: normalizedVaultPath,
      hostBundlePath: opts.hostBundlePath,
      hostBundleId: opts.hostBundleId,
      serverName: opts.serverName,
    })
    await writeFile(join(contentsDir, 'Info.plist'), plistXml, 'utf8')

    const destBinary = join(macOsDir, APP_SHIM_EXECUTABLE)
    await copyFile(opts.binaryPath, destBinary)
    await chmod(destBinary, 0o755)

    await writeFile(join(resourcesDir, 'AppIcon.icns'), icns)

    await exec('codesign', ['--force', '--sign', identity, tmpApp])
    await atomicSwapBundle(tmpApp, target, dir)
  } catch (err) {
    await rm(tmpApp, { recursive: true, force: true }).catch(() => {})
    throw err
  }

  // Touch mtime and re-register with LaunchServices (best-effort) to bust icon caches.
  const now = new Date()
  await utimes(target, now, now).catch(() => {})
  await exec(LSREGISTER_PATH, ['-f', target]).catch(() => {})

  // Rename cleanup: move the old `.app` to Trash if it differs from the new path and belongs to this vault.
  // Never trash on a case-only rename on macOS APFS (or when both paths resolve to the same file).
  const platform = deps.platform ?? process.platform
  if (
    previousResolved !== null &&
    !(await isSameAppPath(previousResolved, targetResolved, platform)) &&
    (await pathExists(previousResolved))
  ) {
    const oldInfo = await readLauncherPlist(previousResolved)
    if (isLauncherForVault(oldInfo, normalizedVaultPath)) {
      await deps.trashItem(previousResolved)
    }
  }

  return { appPath: target, name, bundleId, vaultUrl }
}

/**
 * Scan `/Applications` and `~/Applications` (or provided directories) for `.app` bundles
 * whose `CFBundleIdentifier` belongs to Yaseen Docs launchers (`LAUNCHER_BUNDLE_ID_PREFIX`).
 */
export async function scanInstalledLaunchers(
  appDirs: readonly string[] = resolveLauncherAppDirs(),
): Promise<ScannedLauncher[]> {
  const results: ScannedLauncher[] = []
  const seen = new Set<string>()
  for (const dir of appDirs) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    const appEntries = entries.filter((entry) => /\.app$/i.test(entry) && !entry.startsWith('.'))
    const scanned = await Promise.all(
      appEntries.map(async (entry): Promise<ScannedLauncher | null> => {
        const appPath = join(dir, entry)
        const info = await readLauncherPlist(appPath)
        if (!isOwnLauncher(info)) return null
        return { appPath, name: entry.replace(/\.app$/i, ''), info }
      }),
    )
    for (const item of scanned) {
      if (item === null) continue
      const key = process.platform === 'darwin' ? resolve(item.appPath).toLowerCase() : resolve(item.appPath)
      if (seen.has(key)) continue
      seen.add(key)
      results.push(item)
    }
  }
  return results
}

/**
 * Remove an orphaned Yaseen Docs `.app` launcher by moving it to the macOS Trash.
 * Fails closed: refuses any bundle whose `CFBundleIdentifier` does not match `LAUNCHER_BUNDLE_ID_PREFIX`.
 * Returns `false` if the bundle is already gone, `true` when trashed.
 */
export async function removeOrphanLauncher(
  appPath: string,
  deps: Pick<VaultLauncherDeps, 'trashItem'>,
): Promise<boolean> {
  if (!(await pathExists(appPath))) return false
  const info = await readLauncherPlist(appPath)
  if (!isOwnLauncher(info)) {
    throw new Error(`Refusing to remove "${appPath}": it is not a Yaseen Docs launcher.`)
  }
  await deps.trashItem(appPath)
  return true
}

/**
 * Remove a vault's `.app` launcher by moving it to the macOS Trash.
 * Verifies the bundle's `CFBundleIdentifier` prefix (and vault path if present) before trashing.
 * Returns `false` if the bundle is already gone, `true` when trashed.
 */
export async function removeVaultLauncher(
  appPath: string,
  vaultPath: string,
  deps: Pick<VaultLauncherDeps, 'trashItem'>,
): Promise<boolean> {
  if (!(await pathExists(appPath))) return false
  const info = await readLauncherPlist(appPath)
  const normalizedVaultPath = stripSlash(vaultPath)
  if (!isOwnLauncher(info) || (info.vaultPath !== null && stripSlash(info.vaultPath) !== normalizedVaultPath)) {
    throw new Error(`Refusing to remove "${appPath}": it is not a Yaseen Docs launcher for this vault.`)
  }
  await deps.trashItem(appPath)
  return true
}

async function atomicSwapBundle(tmpApp: string, target: string, dir: string): Promise<void> {
  if (await pathExists(target)) {
    const backup = join(dir, `.yaseen-launcher-bak-${randomUUID()}.app`)
    await rename(target, backup)
    try {
      await rename(tmpApp, target)
    } catch (err) {
      await rename(backup, target).catch(() => {})
      throw err
    }
    await rm(backup, { recursive: true, force: true }).catch(() => {})
  } else {
    await rename(tmpApp, target)
  }
}

/**
 * Scan installed Yaseen Docs `.app` launchers and atomically upgrade any bundle whose
 * `CFBundleVersion` is below `LAUNCHER_BUNDLE_VERSION` (v1/v2 -> v3 App Shim) or whose
 * `ElectronAppShimHostPath` drifted from `deps.hostBundlePath` for the same server name
 * (YAZ-6605, YAZ-6606, YAZ-6624).
 *
 * - Returns `[]` immediately if `binaryPath` does not exist.
 * - Preserves each bundle's `AppIcon.icns`, display name, bundle identifier, vault URL, and vault path.
 * - Skips bundles with missing/malformed `bundleId`, `vaultUrl`, or `vaultPath` with a warning.
 * - Stages a full sibling temp `.app` bundle with `app_shim_loader` and fresh v3 `Info.plist`,
 *   signs it FIRST, swaps atomically, touches mtime, and runs `lsregister -f` best-effort.
 */
export async function refreshOutdatedLaunchers(
  binaryPath: string,
  deps?: RefreshOutdatedLaunchersDeps,
): Promise<string[]> {
  if (!(await pathExists(binaryPath))) return []
  const installed = await scanInstalledLaunchers(deps?.appDirs)
  const exec = deps?.execFile ?? defaultExecFile
  const identity = deps?.signIdentity && deps.signIdentity.length > 0 ? deps.signIdentity : '-'
  const targetHostPath = deps?.hostBundlePath && deps.hostBundlePath.length > 0 ? deps.hostBundlePath : undefined
  const targetServerName = deps?.serverName && deps.serverName.length > 0 ? deps.serverName : null
  const upgraded: string[] = []

  for (const item of installed) {
    const isOutdatedVersion = (item.info.bundleVersion ?? 0) < LAUNCHER_BUNDLE_VERSION
    const isStaleHostPath =
      targetHostPath !== undefined &&
      (item.info.serverName ?? null) === targetServerName &&
      item.info.hostPath !== targetHostPath
    if (!isOutdatedVersion && !isStaleHostPath) continue

    const { bundleId, vaultUrl, vaultPath } = item.info
    if (
      bundleId === null ||
      bundleId.length === 0 ||
      vaultUrl === null ||
      !/^yaseendocs:\/\//i.test(vaultUrl) ||
      vaultPath === null ||
      vaultPath.trim().length === 0
    ) {
      console.warn(`[vaultLauncher] skipping refresh for "${item.appPath}": missing or malformed Info.plist metadata`)
      continue
    }

    const displayName = item.info.displayName && item.info.displayName.length > 0 ? item.info.displayName : item.name
    const dir = dirname(item.appPath)
    const tmpApp = join(dir, `.yaseen-launcher-upgrade-${randomUUID()}.app`)
    const tmpContents = join(tmpApp, 'Contents')
    const tmpMacOs = join(tmpContents, 'MacOS')
    const tmpResources = join(tmpContents, 'Resources')

    try {
      const nextPlist = buildLauncherPlist({
        name: displayName,
        bundleId,
        vaultUrl,
        vaultPath,
        hostBundlePath: targetHostPath ?? item.info.hostPath ?? undefined,
        hostBundleId: deps?.hostBundleId ?? item.info.hostBundleId ?? undefined,
        serverName: targetServerName ?? item.info.serverName ?? undefined,
      })

      await mkdir(tmpMacOs, { recursive: true })
      await mkdir(tmpResources, { recursive: true })
      await writeFile(join(tmpContents, 'Info.plist'), nextPlist, 'utf8')

      const destBin = join(tmpMacOs, APP_SHIM_EXECUTABLE)
      await copyFile(binaryPath, destBin)
      await chmod(destBin, 0o755)

      const origIcon = join(item.appPath, 'Contents', 'Resources', 'AppIcon.icns')
      if (await pathExists(origIcon)) {
        await copyFile(origIcon, join(tmpResources, 'AppIcon.icns'))
      }

      await exec('codesign', ['--force', '--sign', identity, tmpApp])
      await atomicSwapBundle(tmpApp, item.appPath, dir)
      const now = new Date()
      await utimes(item.appPath, now, now).catch(() => {})
      await exec(LSREGISTER_PATH, ['-f', item.appPath]).catch(() => {})
      upgraded.push(item.appPath)
    } catch (err) {
      await rm(tmpApp, { recursive: true, force: true }).catch(() => {})
      console.warn(`[vaultLauncher] failed to refresh "${item.appPath}": ${String(err)}`)
    }
  }

  return upgraded
}
