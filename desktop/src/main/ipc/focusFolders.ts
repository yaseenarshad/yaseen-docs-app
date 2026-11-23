import { CONTRACT } from '@shared/ipc'
import type { ListScope } from '@shared/types'
import { getFocusFolders, setFocusFolders, subscribeFocusFolders } from '../focusFolders'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireScope } from '../fs/validate'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/** The `focusFolders.*` and `favoriteFolders.*` halves of `window.yaseenDocs` (YAZ-4460): a vault's folders of each tab, kept in the vault. */
export function registerFocusFoldersIpc(store: Store, windows?: Pick<WindowManagerIpc, 'idFor' | 'isReadOnly'>): void {
  for (const [kind, door] of [['focus', CONTRACT.focusFolders], ['favorites', CONTRACT.favoriteFolders]] as const) {
    const broadcast = (change: { root: string; scope: ListScope }): void => broadcastAll(door.onChanged.channel, change)
    handleWithEvent(door.get, async (e, root: unknown, scope: unknown) => {
      const id = windows?.idFor?.(e.sender)
      const readOnly = id !== undefined && windows?.isReadOnly?.(id) === true
      return getFocusFolders(requireAbsPath(root, 'root'), requireScope(scope), kind, readOnly ? { readOnly: true } : undefined)
    })
    handle(door.set, async (root: unknown, scope: unknown, folders: unknown) => {
      if (!Array.isArray(folders)) throw new BridgeFailure('BAD_REQUEST', "'folders' must be an array")
      await setFocusFolders(requireAbsPath(root, 'root'), requireScope(scope), folders, kind)
    })
    syncPerRoot(store, (root) => subscribeFocusFolders(root, broadcast, kind))
  }
}
