import { CONTRACT } from '@shared/ipc'
import { isFilesSort } from '@shared/filesOrder'
import { getFilesOrder, setFilesSort, setFolderOrder, subscribeFilesOrder } from '../filesOrder'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.filesOrder.onChanged.channel, change)

/** The `filesOrder.*` half of `window.yaseenDocs` (YAZ-5916): the Files tab's Manual order, kept in the vault. */
export function registerFilesOrderIpc(store: Store): void {
  handle(CONTRACT.filesOrder.get, async (root: unknown) => getFilesOrder(requireAbsPath(root, 'root')))
  handle(CONTRACT.filesOrder.setFolder, async (root: unknown, dir: unknown, names: unknown) => setFolderOrder(requireAbsPath(root, 'root'), requireAbsPath(dir, 'dir'), requireStringArray(names, 'names')))
  handle(CONTRACT.filesOrder.setSort, async (root: unknown, sort: unknown) => {
    if (!isFilesSort(sort)) throw new BridgeFailure('BAD_REQUEST', "'sort' must be { by: manual | name | updated, reverse }")
    await setFilesSort(requireAbsPath(root, 'root'), sort)
  })
  syncPerRoot(store, (root) => subscribeFilesOrder(root, broadcast))
}
