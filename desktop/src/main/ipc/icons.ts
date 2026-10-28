import { CONTRACT } from '@shared/ipc'
import { getIcons, setIcons, subscribeIcons } from '../icons'
import { requireAbsPath } from '../fs/fsUtils'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own vaults and re-read (the `favorites:changed` posture). */
const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.icons.onChanged.channel, change)

/** The `icons.*` half of `window.yaseenDocs` (YAZ-3440 D8): favorites' three calls over `.yaseendocs/icons.json`. */
export function registerIconsIpc(store: Store): void {
  handle(CONTRACT.icons.get, async (root: unknown) => getIcons(requireAbsPath(root, 'root')))
  handle(CONTRACT.icons.set, async (root: unknown, icons: unknown) => setIcons(requireAbsPath(root, 'root'), icons))
  syncPerRoot(store, (root) => subscribeIcons(root, broadcast))
}
