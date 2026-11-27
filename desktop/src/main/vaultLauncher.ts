/**
 * macOS Vault App launcher builder and pure-TS `.icns` encoder (YAZ-5967, YAZ-6373).
 *
 * Each vault can install a lightweight `.app` bundle into `/Applications/<Name>.app` (or
 * `~/Applications/<Name>.app` when `/Applications` is not writable). The bundle wraps our
 * compiled Swift helper (`desktop/build/bin/vault-launcher`), an `Info.plist` with
 * `LSUIElement: true` and `YaseenDocsVaultURL`, and an `AppIcon.icns` generated directly
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

/** Current launcher bundle version written to `CFBundleVersion` (YAZ-6605). */
export const LAUNCHER_BUNDLE_VERSION = 2

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
  /** Path to the compiled `vault-launcher` binary (`vaultLauncherBinaryPath(...)`). */
  binaryPath: string
}

export interface InstallVaultLauncherResult {
  appPath: string
  name: string
  bundleId: string
  vaultUrl: string
}

export interface VaultLauncherDeps {
  /** Candidate Applications directories in preference order. Defaults to `['/Applications', '~/Applications']`. */
  appDirs?: readonly string[]
  /** Move a bundle to the macOS Trash (in main, `shell.trashItem`). */
  trashItem: (path: string) => Promise<void>
  /** Run an external command (`codesign`, `lsregister`). Defaults to `child_process.execFile`. */
  execFile?: (file: string, args: readonly string[]) => Promise<void>
  /** Check whether a directory is writable. Defaults to `fs.access(dir, W_OK)`. */
  isWritable?: (dir: string) => Promise<boolean>
  /** Platform override for case-insensitive path checks (defaults to `process.platform`). */
  platform?: NodeJS.Platform
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

/** Where the helper binary lives: `Resources/bin` in the packaged app, `desktop/build/bin` in a checkout. */
export function vaultLauncherBinaryPath({ isPackaged, resourcesPath, mainDir }: { isPackaged: boolean; resourcesPath: string; mainDir: string }): string {
  return isPackaged ? join(resourcesPath, 'bin', 'vault-launcher') : resolve(mainDir, '..', '..', 'build', 'bin', 'vault-launcher')
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

/** Build XML `Contents/Info.plist` for a Vault App launcher bundle. */
export function buildLauncherPlist(fields: { name: string; bundleId: string; vaultUrl: string; vaultPath: string }): string {
  const entries: Array<[string, string | boolean]> = [
    ['CFBundleDevelopmentRegion', 'en'],
    ['CFBundleDisplayName', fields.name],
    ['CFBundleExecutable', 'vault-launcher'],
    ['CFBundleIconFile', 'AppIcon'],
    ['CFBundleIdentifier', fields.bundleId],
    ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', fields.name],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', '1.0'],
    ['CFBundleVersion', String(LAUNCHER_BUNDLE_VERSION)],
    ['LSMinimumSystemVersion', '12.0'],
    ['LSUIElement', true],
    ['YaseenDocsVaultURL', fields.vaultUrl],
    ['YaseenDocsVaultPath', fields.vaultPath],
  ]
  const body = entries
    .map(([key, value]) =>
      typeof value === 'boolean'
        ? `  <key>${escapeXml(key)}</key>\n  <${value ? 'true' : 'false'}/>`
        : `  <key>${escapeXml(key)}</key>\n  <string>${escapeXml(value)}</string>`,
    )
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
 * Read `CFBundleIdentifier`, `YaseenDocsVaultPath`, `YaseenDocsVaultURL`, and `CFBundleVersion`
 * from an `.app`'s `Contents/Info.plist`. Returns `null` if the plist cannot be read (e.g. missing bundle).
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
  candidates: readonly string[] = ['/Applications', join(homedir(), 'Applications')],
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

    const plistXml = buildLauncherPlist({ name, bundleId, vaultUrl, vaultPath: normalizedVaultPath })
    await writeFile(join(contentsDir, 'Info.plist'), plistXml, 'utf8')

    const destBinary = join(macOsDir, 'vault-launcher')
    await copyFile(opts.binaryPath, destBinary)
    await chmod(destBinary, 0o755)

    await writeFile(join(resourcesDir, 'AppIcon.icns'), icns)

    await exec('codesign', ['--force', '--sign', '-', tmpApp])
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
  appDirs: readonly string[] = ['/Applications', join(homedir(), 'Applications')],
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

function updatePlistBundleVersion(xml: string, version: number): string {
  const re = /(<key>CFBundleVersion<\/key>\s*<string>)[\s\S]*?(<\/string>)/
  if (re.test(xml)) {
    return xml.replace(re, `$1${version}$2`)
  }
  const closeIdx = xml.lastIndexOf('</dict>')
  if (closeIdx === -1) {
    throw new Error('Malformed Info.plist: missing </dict>')
  }
  const insertion = `  <key>CFBundleVersion</key>\n  <string>${version}</string>\n`
  return `${xml.slice(0, closeIdx)}${insertion}${xml.slice(closeIdx)}`
}

/**
 * Scan installed Yaseen Docs `.app` launchers and atomically upgrade any bundle whose
 * `CFBundleVersion` is below `LAUNCHER_BUNDLE_VERSION` (YAZ-6605, YAZ-6606).
 *
 * - Returns `[]` immediately if `binaryPath` does not exist (safe for dev runs without a built helper).
 * - Preserves each bundle's `AppIcon.icns`, display name, bundle identifier, vault URL, and vault path.
 * - Stages a full sibling temp `.app` bundle, ad-hoc signs it FIRST, then swaps atomically so the
 *   installed bundle is never left unsigned or partially upgraded on crash or `codesign` failure.
 */
export async function refreshOutdatedLaunchers(
  binaryPath: string,
  deps?: Pick<VaultLauncherDeps, 'appDirs' | 'execFile'>,
): Promise<string[]> {
  if (!(await pathExists(binaryPath))) return []
  const installed = await scanInstalledLaunchers(deps?.appDirs)
  const exec = deps?.execFile ?? defaultExecFile
  const upgraded: string[] = []

  for (const item of installed) {
    if ((item.info.bundleVersion ?? 0) >= LAUNCHER_BUNDLE_VERSION) continue

    const dir = dirname(item.appPath)
    const tmpApp = join(dir, `.yaseen-launcher-upgrade-${randomUUID()}.app`)
    const tmpContents = join(tmpApp, 'Contents')
    const tmpMacOs = join(tmpContents, 'MacOS')
    const tmpResources = join(tmpContents, 'Resources')

    try {
      const origPlist = await readFile(join(item.appPath, 'Contents', 'Info.plist'), 'utf8')
      const nextPlist = updatePlistBundleVersion(origPlist, LAUNCHER_BUNDLE_VERSION)

      await mkdir(tmpMacOs, { recursive: true })
      await mkdir(tmpResources, { recursive: true })
      await writeFile(join(tmpContents, 'Info.plist'), nextPlist, 'utf8')

      const destBin = join(tmpMacOs, 'vault-launcher')
      await copyFile(binaryPath, destBin)
      await chmod(destBin, 0o755)

      const origIcon = join(item.appPath, 'Contents', 'Resources', 'AppIcon.icns')
      if (await pathExists(origIcon)) {
        await copyFile(origIcon, join(tmpResources, 'AppIcon.icns'))
      }

      await exec('codesign', ['--force', '--sign', '-', tmpApp])
      await atomicSwapBundle(tmpApp, item.appPath, dir)
      const now = new Date()
      await utimes(item.appPath, now, now).catch(() => {})
      upgraded.push(item.appPath)
    } catch (err) {
      await rm(tmpApp, { recursive: true, force: true }).catch(() => {})
      console.warn(`[vaultLauncher] failed to refresh "${item.appPath}": ${String(err)}`)
    }
  }

  return upgraded
}
