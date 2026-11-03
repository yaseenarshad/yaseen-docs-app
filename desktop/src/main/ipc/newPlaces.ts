import { CONTRACT } from '@shared/ipc'
import { getNewPlaces, setNewPlaces, subscribeNewPlaces } from '../newPlaces'
import { requireAbsPath } from '../fs/fsUtils'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the change; renderers filter by their own vaults and re-read (the `favorites:changed` posture). */
const broadcast = (change: { root: string }): void => broadcastAll(CONTRACT.newPlaces.onChanged.channel, change)

/** The `newPlaces.*` half of `window.yaseenDocs` (YAZ-4252 D3): icons' three calls over `.yaseendocs/new-places.json`. */
export function registerNewPlacesIpc(store: Store): void {
  handle(CONTRACT.newPlaces.get, async (root: unknown) => getNewPlaces(requireAbsPath(root, 'root')))
  handle(CONTRACT.newPlaces.set, async (root: unknown, places: unknown) => setNewPlaces(requireAbsPath(root, 'root'), places))
  syncPerRoot(store, (root) => subscribeNewPlaces(root, broadcast))
}
