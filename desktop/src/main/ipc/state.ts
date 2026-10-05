import type { FolderPatch } from '@shared/types'
import { isRecord } from '@shared/guards'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import { isSettings, type Store } from '../store'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** The patch crosses IPC from a sandboxed renderer: only `expanded` / `lastFile` / `name`, each type-checked. */
function requireFolderPatch(raw: unknown): FolderPatch {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
  const patch: FolderPatch = {}
  if (raw.expanded !== undefined) patch.expanded = requireStringArray(raw.expanded, 'expanded')
  if (raw.lastFile !== undefined) {
    if (raw.lastFile !== null && typeof raw.lastFile !== 'string') throw new BridgeFailure('BAD_REQUEST', "'lastFile' must be a string or null")
    patch.lastFile = raw.lastFile
  }
  // The vault's display name (YAZ-1974 D3): the store trims and caps it.
  if (raw.name !== undefined) {
    if (raw.name !== null && typeof raw.name !== 'string') throw new BridgeFailure('BAD_REQUEST', "'name' must be a string or null")
    patch.name = raw.name
  }
  return patch
}

/** The `state.*` half of `window.yaseenDocs` over the main-owned store (GRO-2159). */
export function registerStateIpc(store: Store): void {
  handle(CONTRACT.state.get, async () => store.get())
  handle(CONTRACT.state.setSettings, async (settings: unknown) => {
    if (!isSettings(settings)) throw new BridgeFailure('BAD_REQUEST', "'settings' must be a complete SettingsState")
    store.setSettings(settings)
  })
  handle(CONTRACT.state.setSidebarWidth, async (width: unknown) => {
    if (typeof width !== 'number' || !Number.isFinite(width)) throw new BridgeFailure('BAD_REQUEST', "'width' must be a finite number")
    store.setSidebarWidth(width)
  })
  handle(CONTRACT.state.pushRecent, async (path: unknown) => {
    store.pushRecent(requireAbsPath(path, 'path'))
  })
  handle(CONTRACT.state.removeRecent, async (path: unknown) => {
    store.removeRecent(requireAbsPath(path, 'path'))
  })
  handle(CONTRACT.state.setFolder, async (root: unknown, patch: unknown) => {
    store.setFolder(requireAbsPath(root, 'root'), requireFolderPatch(patch))
  })
  handle(CONTRACT.state.setFolds, async (root: unknown, file: unknown, keys: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    store.setFolds(r, f, requireStringArray(keys, 'keys'))
  })
  handle(CONTRACT.state.setBaseGroups, async (root: unknown, key: unknown, collapsed: unknown) => {
    const r = requireAbsPath(root, 'root')
    if (typeof key !== 'string' || key === '') throw new BridgeFailure('BAD_REQUEST', "'key' must be a non-empty string")
    store.setBaseGroups(r, key, requireStringArray(collapsed, 'collapsed'))
  })
  // Every live window gets the new state (`state.onChange` in the renderer), whichever window changed it.
  store.onChange((state) => broadcastAll(CONTRACT.state.onChange.channel, state))
}
