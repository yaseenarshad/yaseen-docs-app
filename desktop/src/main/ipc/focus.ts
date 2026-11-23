import { CONTRACT } from '@shared/ipc'
import type { ListScope } from '@shared/types'
import { getFocus, setFocus, subscribeFocus } from '../focus'
import { requireAbsPath } from '../fs/fsUtils'
import { requireScope, requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own vaults and re-read (the `favorites:changed` posture). */
const broadcast = (change: { root: string; scope: ListScope }): void => broadcastAll(CONTRACT.focus.onChanged.channel, change)

/** The `focus.*` half of `window.yaseenDocs` (YAZ-2702): a vault's focus list, kept in the vault. */
export function registerFocusIpc(store: Store): void {
  handle(CONTRACT.focus.get, async (root: unknown, scope: unknown) => getFocus(requireAbsPath(root, 'root'), requireScope(scope)))
  handle(CONTRACT.focus.set, async (root: unknown, paths: unknown, scope: unknown) => {
    const r = requireAbsPath(root, 'root')
    await setFocus(r, requireStringArray(paths, 'paths'), requireScope(scope))
  })
  syncPerRoot(store, (root) => subscribeFocus(root, broadcast))
}
