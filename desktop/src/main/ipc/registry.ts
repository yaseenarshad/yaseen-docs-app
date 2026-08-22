import { BrowserWindow } from 'electron'
import type { AppState, RegistryResponse } from '@shared/types'
import { CH } from '../../channels'
import { getRegistry, removeProperty, removeType, setProperty, setType, subscribeRegistry } from '../registry'
import type { Store } from '../store'
import { handle } from './envelope'

/** Main's own registry subscription per open-vault root; dropped when the last window on that root goes. */
const subs = new Map<string, () => void>()

/** Every live window gets the fresh registry; renderers filter by their own root (the `state:changed` posture). */
function broadcast(registry: RegistryResponse): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(CH.registryChanged, { root: registry.root, registry })
  }
}

/** The open-vault roots are `AppState.windows` (null = Welcome); one `subscribeRegistry` each, no more. */
function syncSubscriptions(state: AppState): void {
  const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
  for (const [root, off] of subs) {
    if (!roots.has(root)) {
      off()
      subs.delete(root)
    }
  }
  for (const root of roots) {
    if (!subs.has(root)) subs.set(root, subscribeRegistry(root, broadcast))
  }
}

/** The `registry.*` half of `window.yaseenDocs` (Bible A, GRO-2201). */
export function registerRegistryIpc(store: Store): void {
  handle(CH.registryGet, getRegistry)
  handle(CH.registrySetType, setType)
  handle(CH.registryRemoveType, removeType)
  handle(CH.registrySetProperty, setProperty)
  handle(CH.registryRemoveProperty, removeProperty)
  store.onChange(syncSubscriptions)
  syncSubscriptions(store.get())
}
