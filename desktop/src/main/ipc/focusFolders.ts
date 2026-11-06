import { CONTRACT } from '@shared/ipc'
import type { ListScope } from '@shared/types'
import { getFocusFolders, setFocusFolders, subscribeFocusFolders } from '../focusFolders'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireScope } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** The `focusFolders.*` and `favoriteFolders.*` halves of `window.yaseenDocs` (YAZ-4460): a vault's folders of each tab, kept in the vault. */
export function registerFocusFoldersIpc(store: Store): void {
  for (const [kind, door] of [['focus', CONTRACT.focusFolders], ['favorites', CONTRACT.favoriteFolders]] as const) {
    const broadcast = (change: { root: string; scope: ListScope }): void => broadcastAll(door.onChanged.channel, change)
    handle(door.get, async (root: unknown, scope: unknown) => getFocusFolders(requireAbsPath(root, 'root'), requireScope(scope), kind))
    handle(door.set, async (root: unknown, scope: unknown, folders: unknown) => {
      if (!Array.isArray(folders)) throw new BridgeFailure('BAD_REQUEST', "'folders' must be an array")
      await setFocusFolders(requireAbsPath(root, 'root'), requireScope(scope), folders, kind)
    })
    syncPerRoot(store, (root) => subscribeFocusFolders(root, broadcast, kind))
  }
}
