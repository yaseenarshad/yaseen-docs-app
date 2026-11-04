import { join } from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { PIXABAY_SECRET } from '@shared/types'
import type { GitSyncManager } from '../git/manager'
import type { Secrets } from '../secrets'
import type { SettingsFolder } from '../settingsFolder'
import type { LspPool } from '../lsp/pool'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { copyLibrary, followLibraryMoves } from '../library/copyLibrary'
import { resolveLibraryFolder } from '../library/folder'
import { registerBoardIpc } from './board'
import { registerComponentsIpc } from './components'
import { registerDialogIpc } from './dialog'
import { handle } from './envelope'
import { registerFavoritesIpc } from './favorites'
import { registerIconsIpc } from './icons'
import { registerNewPlacesIpc } from './newPlaces'
import { registerFocusIpc } from './focus'
import { registerFsIpc } from './fs'
import { registerGithubIpc } from './github'
import { registerHomeIpc } from './home'
import { registerLspIpc } from './lsp'
import { registerMediaLibraryIpc } from './mediaLibrary'
import { registerMediaStudioIpc } from './mediaStudio'
import { registerPropertiesIpc } from './properties'
import { registerSecretsIpc } from './secrets'
import { registerShareIpc, type ShareIpcPlaces } from './share'
import { registerSoundIpc } from './sound'
import { registerStateIpc } from './state'
import { registerPictureFoldersIpc, rememberPick } from './pictureFolders'
import { registerStorageIpc } from './storage'
import { registerVaultConfigIpc } from './vaultConfig'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/**
 * Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads.
 *
 * Returns the GitHub sync manager (YAZ-1081, 2C) — the one registration with triggers no renderer
 * can send (window focus, OS wake, the last flush before quit), which `main/index.ts` owns — and the
 * language helpers' pool, whose PIDs the memory meter reads (YAZ-3737 D1).
 *
 * `places` is passed in rather than read from `app`, so every module under `main/` stays Electron-free
 * and testable against a temp dir. `userData` (YAZ-3038, YAZ-3040) is the default root of the canvas
 * panel's library folder and where `secrets.json`, `sharing.json` and `media-cache/` live; the rest
 * (`ShareIpcPlaces`, YAZ-3040) is where the share viewer's files are. `settingsFolder` (YAZ-3276) is the
 * one `followSettingsFolder` of `main/index.ts`: the Settings row asks it whether the folder is missing.
 */
export type IpcPlaces = ShareIpcPlaces & {
  userData: string
  /** This Mac's ID (`vaultIndex/mint.ts`): the library's media file of this Mac is `media-<macId>.json` (YAZ-4364). */
  macId: () => Promise<string>
  /** `app.getAppPath()`: a dev build's language helpers are in `node_modules` from there upward (YAZ-3454, YAZ-3500). */
  appPath?: string
}

export function registerIpc(store: Store, windows: WindowManagerIpc, places: IpcPlaces, settingsFolder: Pick<SettingsFolder, 'missing' | 'hasOtherMacs' | 'settled'>): { sync: GitSyncManager; secrets: Secrets; lsp: LspPool } {
  const { userData } = places
  registerFsIpc(store, windows)
  // The folder window's pick of an outside pictures folder is what lets the app write there (YAZ-3943 demo round 3).
  // Settings' pick is approved at once; the cog's waits here until its move is confirmed (YAZ-4074 6A item 3).
  const pickedPictureFolders = new Set<string>()
  registerBoardIpc(store, windows, userData, pickedPictureFolders)
  registerDialogIpc(undefined, (folder) => store.approvePictureFolder(folder), (folder) => rememberPick(pickedPictureFolders, folder))
  registerWatchIpc()
  registerStateIpc(store, settingsFolder)
  registerVaultConfigIpc(store)
  registerFavoritesIpc(store)
  registerIconsIpc(store)
  registerNewPlacesIpc(store)
  registerFocusIpc(store)
  registerPropertiesIpc(store)
  registerWindowIpc(store, windows)
  registerStorageIpc(store)
  registerPictureFoldersIpc(store, pickedPictureFolders)
  registerSoundIpc()
  registerHomeIpc()
  // The code tabs' language helpers (YAZ-3454, YAZ-3455): the quit sequence stops them (`stopAllLanguageServers`).
  // They run only while Settings › Code › "Jump across files" is on, and are a download in `<userData>/lsp`
  // (YAZ-3500). A dev build also takes the `node_modules` copies, unless YASEEN_DOCS_LSP_DOWNLOAD_ONLY=1
  // (the hidden e2e spec of the box; a dev run that shows the download as a packaged app does).
  const lsp = registerLspIpc(
    { lspRoot: join(userData, 'lsp'), devCopies: !places.isPackaged && process.env.YASEEN_DOCS_LSP_DOWNLOAD_ONLY !== '1', appPath: places.appPath ?? '' },
    { on: () => store.get().settings.codeLanguageHelpers, subscribe: (listener) => store.onChange((state) => listener(state.settings.codeLanguageHelpers)) },
  )
  // THE one secrets instance (YAZ-3028): `secrets.set`/`has` for the renderer, `read` for main's own callers.
  // It is threaded into the Image Studio's providers (a Pixabay request is built without the key ever leaving
  // main; YAZ-3038) and into sharing (the Cloudflare token and the upload password; YAZ-3040).
  // A new Pixabay key starts the favorites' backfill (YAZ-4363): the Pixabay copies waited for it.
  const secrets = registerSecretsIpc(userData, (name) => {
    if (name === PIXABAY_SECRET) void library.copies.backfill()
  })
  // The canvas panel (YAZ-3038; Draw's 🔒 YAZ-1775 D4 / D5): the library folder every vault shares, its media
  // and component stores, the favorites' own copies (YAZ-4363), and the Image Studio, which asks the copies first.
  // The folder is the setting, else `<settings folder>/library`, else `<userData>/library` (YAZ-4364).
  handle(CONTRACT.drawing.libraryFolder, async () => resolveLibraryFolder(store.get().settings.libraryFolder, userData, store.get().settingsFolder))
  const components = registerComponentsIpc(store, userData)
  const library = registerMediaLibraryIpc(store, userData, { macId: places.macId, hasPixabayKey: () => secrets.has(PIXABAY_SECRET), readComponent: (slug) => components.read({ slug }) })
  // The store also carries the icon packs' folder setting (YAZ-4359).
  registerMediaStudioIpc(userData, secrets, globalThis.fetch, store, library.copies)
  // A library that moves (YAZ-4364): after the stores re-pointed, the old folder copies and merges into the new one.
  followLibraryMoves(store, userData, {
    copy: (from) => copyLibrary(from, { media: library.media, components, copies: library.copies }),
    notice: (message) => windows.appNotice(message),
  })
  registerShareIpc(userData, secrets, places)
  // The Draw import (YAZ-3044 A5) merges Draw's secrets through this same instance.
  return { sync: registerGithubIpc(store), secrets, lsp }
}
