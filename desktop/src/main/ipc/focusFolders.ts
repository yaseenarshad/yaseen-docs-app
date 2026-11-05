import { CONTRACT } from '@shared/ipc'
import type { ListScope } from '@shared/types'
import { getFocusFolders, setFocusFolders, subscribeFocusFolders } from '../focusFolders'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireScope } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

const broadcast = (change: { root: string; scope: ListScope }): void => broadcastAll(CONTRACT.focusFolders.onChanged.channel, change)

/** The `focusFolders.*` half of `window.yaseenDocs` (YAZ-4460): a vault's focus folders, kept in the vault. */
export function registerFocusFoldersIpc(store: Store): void {
  handle(CONTRACT.focusFolders.get, async (root: unknown, scope: unknown) => getFocusFolders(requireAbsPath(root, 'root'), requireScope(scope)))
  handle(CONTRACT.focusFolders.set, async (root: unknown, scope: unknown, folders: unknown) => {
    if (!Array.isArray(folders)) throw new BridgeFailure('BAD_REQUEST', "'folders' must be an array")
    await setFocusFolders(requireAbsPath(root, 'root'), requireScope(scope), folders)
  })
  syncPerRoot(store, (root) => subscribeFocusFolders(root, broadcast))
}
