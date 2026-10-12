import { CONTRACT } from '@shared/ipc'
import { getFocus, setFocus, subscribeFocus } from '../focus'
import { requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own vaults and re-read (the `favorites:changed` posture). */
const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.focus.onChanged.channel, change)

/** The `focus.*` half of `window.yaseenDocs` (YAZ-2702): a vault's focus list, kept in the vault. */
export function registerFocusIpc(store: Store): void {
  handle(CONTRACT.focus.get, async (root: unknown) => getFocus(requireAbsPath(root, 'root')))
  handle(CONTRACT.focus.set, async (root: unknown, paths: unknown) => {
    const r = requireAbsPath(root, 'root')
    await setFocus(r, requireStringArray(paths, 'paths'))
  })
  syncPerRoot(store, (root) => subscribeFocus(root, broadcast))
}
