import { CONTRACT } from '@shared/ipc'
import type { GitSyncManager } from '../git/manager'
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
import { registerStateIpc } from './state'
import { registerVaultConfigIpc } from './vaultConfig'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/**
 * Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads.
 *
 * Returns the GitHub sync manager (YAZ-1081, 2C) — the one registration with triggers no renderer
 * can send (window focus, OS wake, the last flush before quit), which `main/index.ts` owns.
 *
 * `userData` is passed in rather than read from `app` (YAZ-3038): it is the default root of the canvas
 * panel's library folder and where `secrets.json` and `media-cache/` live, and every module that
 * touches it stays Electron-free and testable against a temp dir.
 */
export function registerIpc(store: Store, windows: WindowManagerIpc, userData: string): GitSyncManager {
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
  // The canvas panel (YAZ-3038; Draw's 🔒 YAZ-1775 D4 / D5): the library folder every vault shares, its media
  // and component stores, and the Image Studio. The secrets instance is THREADED into the studio's
  // providers: that is how a Pixabay request is built without the key ever leaving main.
  handle(CONTRACT.drawing.libraryFolder, async () => resolveLibraryFolder(store.get().settings.libraryFolder, userData))
  registerMediaLibraryIpc(store, userData)
  registerComponentsIpc(store, userData)
  registerMediaStudioIpc(userData, registerSecretsIpc(userData))
  return registerGithubIpc(store)
}
