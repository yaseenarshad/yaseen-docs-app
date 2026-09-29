import type { VaultConfigChange } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import type { Store } from '../store'
import { readConfig, subscribeConfig, writeConfig } from '../vaultConfig'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own root (same posture as `state:changed`). */
const broadcast = (change: VaultConfigChange): void => broadcastAll(CONTRACT.vaultConfig.onChange.channel, change)

/** The `vaultConfig.*` half of `window.yaseenDocs` (Desktop J, GRO-2188). */
export function registerVaultConfigIpc(store: Store): void {
  handle(CONTRACT.vaultConfig.read, readConfig)
  handle(CONTRACT.vaultConfig.write, writeConfig)
  syncPerRoot(store, (root) => subscribeConfig(root, broadcast))
}
