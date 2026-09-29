import { CONTRACT } from '@shared/ipc'
import { getFavorites, setFavorites, subscribeFavorites } from '../favorites'
import { requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own root and re-read (the `vaultConfig:changed` posture). */
const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.favorites.onChanged.channel, change)

/** The `favorites.*` half of `window.yaseenDocs` (YAZ-1766 6A). */
export function registerFavoritesIpc(store: Store): void {
  handle(CONTRACT.favorites.get, async (root: unknown) => getFavorites(requireAbsPath(root, 'root')))
  handle(CONTRACT.favorites.set, async (root: unknown, paths: unknown) => {
    const r = requireAbsPath(root, 'root')
    await setFavorites(r, requireStringArray(paths, 'paths'))
  })
  syncPerRoot(store, (root) => subscribeFavorites(root, broadcast))
}
