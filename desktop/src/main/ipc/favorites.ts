import { CONTRACT } from '@shared/ipc'
import type { ListScope } from '@shared/types'
import { getFavorites, setFavorites, subscribeFavorites } from '../favorites'
import { requireAbsPath } from '../fs/fsUtils'
import { requireScope, requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own root and re-read (the `vaultConfig:changed` posture). */
const broadcast = (change: { root: string; scope: ListScope }): void => broadcastAll(CONTRACT.favorites.onChanged.channel, change)

/** The `favorites.*` half of `window.yaseenDocs` (YAZ-1766 6A). */
export function registerFavoritesIpc(store: Store): void {
  handle(CONTRACT.favorites.get, async (root: unknown, scope: unknown) => getFavorites(requireAbsPath(root, 'root'), requireScope(scope)))
  handle(CONTRACT.favorites.set, async (root: unknown, paths: unknown, scope: unknown) => {
    const r = requireAbsPath(root, 'root')
    await setFavorites(r, requireStringArray(paths, 'paths'), requireScope(scope))
  })
  syncPerRoot(store, (root) => subscribeFavorites(root, broadcast))
}
