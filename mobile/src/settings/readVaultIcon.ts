import type { VaultLauncherBadge } from '@shared/types'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { sanitizeVaultLauncherPreset, VAULT_ICON_FILE } from '@shared/vaultIcon'
import { readVaultSettingsDoc, type VaultSettingsReader } from './readVaultSettings'

/**
 * MOBILE SYNCED VAULT ICON READER (YAZ-6560).
 *
 * Reads `<vault>/.yaseendocs/settings.json` (`launcher`) and optional `<vault>/.yaseendocs/vault-icon.png`
 * directly from the phone's `VaultStore`. Intentionally imports only lightweight `@shared/vaultIcon`
 * so Mobile's first-load JS stays well under `FIRST_LOAD_JS_MAX` (`bundleWalls.test.ts`).
 */
export const VAULT_ICON_PATH = `${VAULT_CONFIG_DIR}/${VAULT_ICON_FILE}`

const MAX_VAULT_ICON_BYTES = 2 * 1024 * 1024
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export type MobileVaultIcon =
  | { kind: 'badge'; badge: VaultLauncherBadge }
  | { kind: 'image'; src: string }

function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length || bytes.length > MAX_VAULT_ICON_BYTES) return false
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false
  }
  return true
}

function pngBytesToDataUrl(bytes: Uint8Array): string | null {
  if (!isPngBytes(bytes)) return null
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/** Read a vault's synced launcher icon (badge recipe or custom `.yaseendocs/vault-icon.png`), or `null`. */
export async function readVaultIcon(store: VaultSettingsReader, vault: string): Promise<MobileVaultIcon | null> {
  const doc = await readVaultSettingsDoc(store, vault)
  if (doc === null) return null
  const preset = sanitizeVaultLauncherPreset(doc.launcher)
  if (preset === null) return null
  if (preset.badge !== undefined) {
    return { kind: 'badge', badge: preset.badge }
  }
  if (preset.iconFile === VAULT_ICON_FILE) {
    try {
      const file = await store.read(vault, VAULT_ICON_PATH)
      if (file === null || !(file.content instanceof Uint8Array)) return null
      const src = pngBytesToDataUrl(file.content)
      return src === null ? null : { kind: 'image', src }
    } catch {
      return null
    }
  }
  return null
}
