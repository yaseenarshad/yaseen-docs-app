import type { VaultConfigChange } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { LEGACY_SECTION_MAP, readVaultSection, VAULT_SETTINGS_FILE, type LegacySettingsFile } from '@shared/vaultSettings'
import { BridgeFailure } from '../fs/fsUtils'
import type { Store } from '../store'
import { readConfigDetailed, subscribeConfig, writeConfig } from '../vaultConfig'
import { readUnifiedVaultSettings } from '../vaultSettings'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own root (same posture as `state:changed`). */
const broadcast = (change: VaultConfigChange): void => broadcastAll(CONTRACT.vaultConfig.onChange.channel, change)

/** The `vaultConfig.*` half of `window.yaseenDocs` (Desktop J, GRO-2188; unified settings YAZ-6546). */
export function registerVaultConfigIpc(store: Store, isReadOnlyRoot?: (root: string) => boolean): void {
  handle(CONTRACT.vaultConfig.read, async (root, name) => {
    if (name === VAULT_SETTINGS_FILE) {
      return readUnifiedVaultSettings(root, store, isReadOnlyRoot?.(root) === true ? { readOnly: true } : undefined)
    }
    const res = await readConfigDetailed(root, name)
    if (res.state === 'malformed') throw new BridgeFailure('INVALID_CONFIG', `${name} is not valid JSON`, { path: res.file })
    if (res.state === 'ok') return res.value
    if (Object.hasOwn(LEGACY_SECTION_MAP, name)) {
      const unified = await readConfigDetailed(root, VAULT_SETTINGS_FILE)
      if (unified.state === 'ok') return readVaultSection(unified.value, LEGACY_SECTION_MAP[name as LegacySettingsFile])
    }
    return null
  })
  handle(CONTRACT.vaultConfig.write, writeConfig)
  syncPerRoot(store, (root) => subscribeConfig(root, broadcast))
}
