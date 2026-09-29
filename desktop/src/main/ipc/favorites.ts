import type { AppState } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { getFavorites, setFavorites, subscribeFavorites } from '../favorites'
import { requireAbsPath } from '../fs/fsUtils'
import { strArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** Main's own favorites subscription per open-vault root; dropped when the last window on that root goes. */
const subs = new Map<string, () => void>()

/** Every live window gets the change; renderers filter by their own root and re-read (the `vaultConfig:changed` posture). */
const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.favorites.onChanged.channel, change)

/** The open-vault roots are `AppState.windows` (null = Welcome); one `subscribeFavorites` each, no more. */
function syncSubscriptions(state: AppState): void {
  const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
  for (const [root, off] of subs) {
    if (!roots.has(root)) {
      off()
      subs.delete(root)
    }
  }
  for (const root of roots) {
    if (!subs.has(root)) subs.set(root, subscribeFavorites(root, broadcast))
  }
}

/** The `favorites.*` half of `window.yaseenDocs` (YAZ-1766 6A). */
export function registerFavoritesIpc(store: Store): void {
  handle(CONTRACT.favorites.get, async (root: unknown) => getFavorites(requireAbsPath(root, 'root')))
  handle(CONTRACT.favorites.set, async (root: unknown, paths: unknown) => {
    const r = requireAbsPath(root, 'root')
    await setFavorites(r, strArray(paths, 'paths'))
  })
  store.onChange(syncSubscriptions)
  syncSubscriptions(store.get())
}
