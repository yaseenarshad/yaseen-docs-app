import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { isRecord } from '@shared/guards'
import {
  cleanVaultLauncher,
  cleanVaultName,
  type VaultLauncherBadge,
  type VaultLauncherInfo,
  type VaultLauncherStatus,
  type VaultLauncherTarget,
} from '@shared/types'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import type { Store } from '../store'
import { handle } from './envelope'

/** Maximum decoded PNG size for a vault launcher icon (2 MiB). */
export const MAX_LAUNCHER_ICON_BYTES = 2 * 1024 * 1024

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const VALID_TARGETS = new Set<string>(['normal', 'inbox', 'today'])
const VALID_BADGE_KINDS = new Set<string>(['emoji', 'letters', 'material'])
const DATA_URL_PREFIX = /^data:image\/png;base64,/i

export interface VaultLauncherInstallParams {
  root: string
  name: string
  png: Buffer
  iconPath: string
  target?: VaultLauncherTarget
  previousAppPath?: string
}

/** Platform backend plugged into `registerVaultLauncherIpc` (macOS `.app` bundle builder, or stub off macOS). */
export interface VaultLauncherBackend {
  readonly supported: boolean
  install(params: VaultLauncherInstallParams): Promise<{ appPath: string }>
  remove(appPath: string, root: string): Promise<void>
  reveal(appPath: string): Promise<void> | void
  launch(appPath: string): Promise<void> | void
  exists(path: string): boolean
}

/** Deterministic cached icon path under `<userData>/vault-icons/<sha256(root).slice(0,16)>.png`. */
export function vaultLauncherIconPath(userData: string, root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(userData, 'vault-icons', `${hash}.png`)
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

function parseOptionalBadge(raw: unknown): VaultLauncherBadge | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    throw new BridgeFailure('BAD_REQUEST', "'badge' must be an object")
  }
  const kind = raw.kind
  const value = typeof raw.value === 'string' ? raw.value.trim() : ''
  const color = raw.color
  if (typeof kind !== 'string' || !VALID_BADGE_KINDS.has(kind)) {
    throw new BridgeFailure('BAD_REQUEST', "'badge.kind' must be 'emoji', 'letters', or 'material'")
  }
  if (value.length === 0 || value.length > 64) {
    throw new BridgeFailure('BAD_REQUEST', "'badge.value' must be a non-empty string")
  }
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new BridgeFailure('BAD_REQUEST', "'badge.color' must be a #rrggbb hex colour")
  }
  return { kind: kind as VaultLauncherBadge['kind'], value, color }
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
 * Registers `vault-launcher:*` IPC handlers (YAZ-5967, YAZ-6374).
 *
 * Persists `FolderState.launcher` in `store`, caches 512x512 PNGs under `<userData>/vault-icons/`,
 * and invokes `onIconChanged(iconPath)` after create/remove so the Dock icon controller can evict its cache.
 */
export function registerVaultLauncherIpc(
  store: Store,
  userData: string,
  backend: VaultLauncherBackend,
  onIconChanged?: (iconPath: string) => void,
): void {
  handle(CONTRACT.vaultLauncher.status, async (rawRoot: unknown): Promise<VaultLauncherStatus> => {
    const root = requireAbsPath(rawRoot, 'root')
    const launcher = store.get().folders[root]?.launcher ?? null
    const exists = launcher !== null && backend.exists(launcher.appPath)
    const iconDataUrl = launcher !== null ? await readIconDataUrl(launcher.iconPath) : null
    return {
      supported: backend.supported,
      launcher,
      exists,
      iconDataUrl,
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
    const name = cleanVaultName(rawReq.name)
    if (name === null) {
      throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
    }
    const png = decodeLauncherPng(rawReq.pngBase64)
    const target = parseOptionalTarget(rawReq.target)
    const badge = parseOptionalBadge(rawReq.badge)

    const iconPath = vaultLauncherIconPath(userData, root)
    await atomicWriteBuffer(iconPath, png)

    const previousAppPath = store.get().folders[root]?.launcher?.appPath
    const { appPath } = await backend.install({
      root,
      name,
      png,
      iconPath,
      target,
      previousAppPath,
    })

    const launcher: VaultLauncherInfo | null = cleanVaultLauncher({
      name,
      appPath,
      iconPath,
      ...(target !== undefined ? { target } : {}),
      ...(badge !== undefined ? { badge } : {}),
    })
    if (launcher === null) {
      throw new BridgeFailure('IO_ERROR', 'Installed launcher metadata was invalid')
    }

    store.setFolder(root, { launcher })
    onIconChanged?.(iconPath)

    return {
      supported: backend.supported,
      launcher,
      exists: backend.exists(appPath),
      iconDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    }
  })

  handle(CONTRACT.vaultLauncher.remove, async (rawRoot: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const launcher = store.get().folders[root]?.launcher ?? null
    if (launcher === null) return

    if (backend.exists(launcher.appPath)) {
      await backend.remove(launcher.appPath, root)
    }
    await rm(launcher.iconPath, { force: true }).catch(() => undefined)
    store.setFolder(root, { launcher: null })
    onIconChanged?.(launcher.iconPath)
  })

  handle(CONTRACT.vaultLauncher.reveal, async (rawRoot: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const launcher = store.get().folders[root]?.launcher ?? null
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Vault launcher app not found', { path: launcher?.appPath })
    }
    await backend.reveal(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.test, async (rawRoot: unknown): Promise<void> => {
    const root = requireAbsPath(rawRoot, 'root')
    const launcher = store.get().folders[root]?.launcher ?? null
    if (launcher === null || !backend.exists(launcher.appPath)) {
      throw new BridgeFailure('NOT_FOUND', 'Vault launcher app not found', { path: launcher?.appPath })
    }
    await backend.launch(launcher.appPath)
  })

  handle(CONTRACT.vaultLauncher.icons, async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {}
    const entries = Object.entries(store.get().folders)
    await Promise.all(
      entries.map(async ([root, folder]) => {
        const launcher = folder.launcher
        if (launcher === undefined) return
        if (!backend.exists(launcher.appPath)) return
        const dataUrl = await readIconDataUrl(launcher.iconPath)
        if (dataUrl !== null) out[root] = dataUrl
      }),
    )
    return out
  })
}
