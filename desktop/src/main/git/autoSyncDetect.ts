import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { AddToAutoSyncResult, AutoSyncStatus } from '@shared/types'

/**
 * Read-only detection of the separate GitHub AutoSync Mac app (YAZ-6190, D3).
 *
 * GitHub AutoSync reads `config.json` once at startup and never watches it, so Docs App
 * NEVER writes `config.json` directly. Instead, Docs App checks whether AutoSync is installed,
 * whether this vault is already in its `folders` list, and whether AutoSync's `Info.plist`
 * declares the `github-autosync://` URL scheme for safe 1-click folder add.
 */

export const AUTOSYNC_SCHEME = 'github-autosync'

export interface AutoSyncDetectOpts {
  platform?: NodeJS.Platform
  appCandidates?: readonly string[]
  configPath?: string
}

function defaultAppCandidates(): string[] {
  return ['/Applications/GitHub AutoSync.app', path.join(homedir(), 'Applications', 'GitHub AutoSync.app')]
}

function defaultConfigPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'GitHub AutoSync', 'config.json')
  if (platform === 'win32') return path.join(process.env.APPDATA ?? homedir(), 'GitHub AutoSync', 'config.json')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'GitHub AutoSync', 'config.json')
}

async function normalizeDir(p: string): Promise<string> {
  const resolved = path.resolve(p)
  return realpath(resolved).catch(() => resolved)
}

async function findInstalledApp(candidates: readonly string[]): Promise<string | null> {
  for (const appPath of candidates) {
    const st = await stat(appPath).catch(() => null)
    if (st !== null) return appPath
  }
  return null
}

async function plistSupportsScheme(appPath: string): Promise<boolean> {
  const plist = await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8').catch(() => null)
  return plist !== null && plist.includes(`<string>${AUTOSYNC_SCHEME}</string>`)
}

interface AutoSyncConfigShape {
  paused?: unknown
  folders?: unknown
}

export async function detectAutoSync(vaultRoot: string, opts: AutoSyncDetectOpts = {}): Promise<AutoSyncStatus> {
  const platform = opts.platform ?? process.platform
  const candidates = opts.appCandidates ?? (platform === 'darwin' ? defaultAppCandidates() : [])
  const configFile = opts.configPath ?? defaultConfigPath(platform)

  const [appPath, rawConfig] = await Promise.all([findInstalledApp(candidates), readFile(configFile, 'utf8').catch(() => null)])
  const installed = appPath !== null || rawConfig !== null
  if (!installed) return { installed: false, vaultSynced: false, supportsDeepLink: false }

  const supportsDeepLink = appPath !== null ? await plistSupportsScheme(appPath) : false

  let vaultSynced = false
  if (rawConfig !== null) {
    try {
      const parsed = JSON.parse(rawConfig) as AutoSyncConfigShape | null
      if (parsed !== null && typeof parsed === 'object' && parsed.paused !== true && Array.isArray(parsed.folders)) {
        const target = await normalizeDir(vaultRoot)
        for (const f of parsed.folders) {
          if (f === null || typeof f !== 'object') continue
          const entry = f as { path?: unknown; enabled?: unknown }
          if (typeof entry.path !== 'string' || entry.enabled === false) continue
          if ((await normalizeDir(entry.path)) === target) {
            vaultSynced = true
            break
          }
        }
      }
    } catch {
      // Malformed config.json: treat as not synced, never throw.
    }
  }

  return { installed, vaultSynced, supportsDeepLink }
}

export function autoSyncAddUrl(vaultRoot: string): string {
  return `${AUTOSYNC_SCHEME}://add?path=${encodeURIComponent(vaultRoot)}`
}

export async function addFolderToAutoSync(
  vaultRoot: string,
  deps: { openExternal: (url: string) => Promise<void> | void; openPath: (appPath: string) => Promise<string> | string } & AutoSyncDetectOpts,
): Promise<AddToAutoSyncResult> {
  const platform = deps.platform ?? process.platform
  const candidates = deps.appCandidates ?? (platform === 'darwin' ? defaultAppCandidates() : [])
  const status = await detectAutoSync(vaultRoot, deps)
  if (!status.installed) return { ok: false, method: 'not-installed' }
  if (status.supportsDeepLink) {
    await deps.openExternal(autoSyncAddUrl(vaultRoot))
    return { ok: true, method: 'deep-link' }
  }
  const appPath = await findInstalledApp(candidates)
  if (appPath === null) return { ok: false, method: 'not-installed' }
  const err = await deps.openPath(appPath)
  return { ok: err === '', method: 'opened-app' }
}

export async function openAutoSyncApp(deps: { openPath: (appPath: string) => Promise<string> | string } & AutoSyncDetectOpts): Promise<boolean> {
  const platform = deps.platform ?? process.platform
  const candidates = deps.appCandidates ?? (platform === 'darwin' ? defaultAppCandidates() : [])
  const appPath = await findInstalledApp(candidates)
  if (appPath === null) return false
  return (await deps.openPath(appPath)) === ''
}
