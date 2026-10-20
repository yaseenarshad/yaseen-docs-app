import { join } from 'node:path'
import type { GitSyncManager } from '../git/manager'
import { createSecrets, SECRETS_FILE } from '../secrets'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { registerBoardIpc } from './board'
import { registerDialogIpc } from './dialog'
import { registerFavoritesIpc } from './favorites'
import { registerFocusIpc } from './focus'
import { registerFsIpc } from './fs'
import { registerGithubIpc } from './github'
import { registerPropertiesIpc } from './properties'
import { registerShareIpc, type ShareIpcPlaces } from './share'
import { registerStateIpc } from './state'
import { registerStorageIpc } from './storage'
import { registerVaultConfigIpc } from './vaultConfig'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/**
 * Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads.
 *
 * Returns the GitHub sync manager (YAZ-1081, 2C) — the one registration with triggers no renderer
 * can send (window focus, OS wake, the last flush before quit), which `main/index.ts` owns.
 *
 * `share` (YAZ-3040) carries `userData` — where `secrets.json` and `sharing.json` live — and where
 * the share viewer's files are, passed in rather than read from `app` so every module under
 * `main/` stays Electron-free and testable.
 */
export function registerIpc(store: Store, windows: WindowManagerIpc, share: ShareIpcPlaces & { userData: string }): GitSyncManager {
  registerFsIpc(store, windows)
  registerBoardIpc()
  registerDialogIpc()
  registerWatchIpc()
  registerStateIpc(store)
  registerVaultConfigIpc(store)
  registerFavoritesIpc(store)
  registerFocusIpc(store)
  registerPropertiesIpc(store)
  registerWindowIpc(store, windows)
  registerStorageIpc()
  // YAZ-3040: sharing reads the Cloudflare token and the upload password from the secrets door — main only.
  registerShareIpc(share.userData, createSecrets(join(share.userData, SECRETS_FILE)), share)
  return registerGithubIpc(store)
}
