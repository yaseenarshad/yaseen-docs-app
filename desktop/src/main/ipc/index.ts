import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { registerDialogIpc } from './dialog'
import { registerFsIpc } from './fs'
import { registerRegistryIpc } from './registry'
import { registerStateIpc } from './state'
import { registerVaultConfigIpc } from './vaultConfig'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/** Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads. */
export function registerIpc(store: Store, windows: WindowManagerIpc): void {
  registerFsIpc()
  registerDialogIpc()
  registerWatchIpc()
  registerStateIpc(store)
  registerVaultConfigIpc(store)
  registerRegistryIpc(store)
  registerWindowIpc(store, windows)
}
