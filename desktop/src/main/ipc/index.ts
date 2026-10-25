import { CONTRACT } from '@shared/ipc'
import type { GitSyncManager } from '../git/manager'
import type { Secrets } from '../secrets'
import type { SettingsFolder } from '../settingsFolder'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { resolveLibraryFolder } from '../library/folder'
import { registerBoardIpc } from './board'
import { registerComponentsIpc } from './components'
import { registerDialogIpc } from './dialog'
import { handle } from './envelope'
import { registerFavoritesIpc } from './favorites'
import { registerFocusIpc } from './focus'
import { registerFsIpc } from './fs'
import { registerGithubIpc } from './github'
import { registerMediaLibraryIpc } from './mediaLibrary'
import { registerMediaStudioIpc } from './mediaStudio'
import { registerPropertiesIpc } from './properties'
import { registerSecretsIpc } from './secrets'
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
 * `places` is passed in rather than read from `app`, so every module under `main/` stays Electron-free
 * and testable against a temp dir. `userData` (YAZ-3038, YAZ-3040) is the default root of the canvas
 * panel's library folder and where `secrets.json`, `sharing.json` and `media-cache/` live; the rest
 * (`ShareIpcPlaces`, YAZ-3040) is where the share viewer's files are. `settingsFolder` (YAZ-3276) is the
 * one `followSettingsFolder` of `main/index.ts`: the Settings row asks it whether the folder is missing.
 */
export type IpcPlaces = ShareIpcPlaces & { userData: string }

export function registerIpc(store: Store, windows: WindowManagerIpc, places: IpcPlaces, settingsFolder: Pick<SettingsFolder, 'missing' | 'hasOtherMacs'>): { sync: GitSyncManager; secrets: Secrets } {
  const { userData } = places
  registerFsIpc(store, windows)
  registerBoardIpc(store, windows, userData)
  registerDialogIpc()
  registerWatchIpc()
  registerStateIpc(store, settingsFolder)
  registerVaultConfigIpc(store)
  registerFavoritesIpc(store)
  registerFocusIpc(store)
  registerPropertiesIpc(store)
  registerWindowIpc(store, windows)
  registerStorageIpc()
  // THE one secrets instance (YAZ-3028): `secrets.set`/`has` for the renderer, `read` for main's own callers.
  // It is threaded into the Image Studio's providers (a Pixabay request is built without the key ever leaving
  // main; YAZ-3038) and into sharing (the Cloudflare token and the upload password; YAZ-3040).
  const secrets = registerSecretsIpc(userData)
  // The canvas panel (YAZ-3038; Draw's 🔒 YAZ-1775 D4 / D5): the library folder every vault shares, its media
  // and component stores, and the Image Studio.
  handle(CONTRACT.drawing.libraryFolder, async () => resolveLibraryFolder(store.get().settings.libraryFolder, userData))
  registerMediaLibraryIpc(store, userData)
  registerComponentsIpc(store, userData)
  registerMediaStudioIpc(userData, secrets)
  registerShareIpc(userData, secrets, places)
  // The Draw import (YAZ-3044 A5) merges Draw's secrets through this same instance.
  return { sync: registerGithubIpc(store), secrets }
}
