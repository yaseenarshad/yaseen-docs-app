import type { PropertiesResponse } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { getProperties, removeProperty, setProperty, subscribeProperties } from '../properties'
import type { Store } from '../store'
import { broadcastAll, syncPerRoot } from './broadcast'
import { handle } from './envelope'

/** Every live window gets the fresh declarations; renderers filter by their own root (the `state:changed` posture). */
const broadcast = (properties: PropertiesResponse): void => broadcastAll(CONTRACT.properties.onChange.channel, { root: properties.root, properties })

/** The `properties.*` half of `window.yaseenDocs` (YAZ-835). */
export function registerPropertiesIpc(store: Store): void {
  handle(CONTRACT.properties.get, getProperties)
  handle(CONTRACT.properties.setProperty, setProperty)
  handle(CONTRACT.properties.removeProperty, removeProperty)
  syncPerRoot(store, (root) => subscribeProperties(root, broadcast))
}
