import { isTocSource, type FolderPatch } from '@shared/types'
import { isRecord } from '@shared/guards'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import type { SettingsFolder } from '../settingsFolder'
import { isSettings, type Store } from '../store'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** The patch crosses IPC from a sandboxed renderer: only `expanded` / `lastFile` / `name` / `key`, each type-checked. */
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
  // The vault's number (YAZ-2555 D2): the store keeps a whole number 1–9 and gives each number to one vault.
  if (raw.key !== undefined) {
    if (raw.key !== null && typeof raw.key !== 'number') throw new BridgeFailure('BAD_REQUEST', "'key' must be a number or null")
    patch.key = raw.key
  }
  return patch
}

/** The `state.*` half of `window.yaseenDocs` over the main-owned store (GRO-2159). */
export function registerStateIpc(store: Store, settingsFolder: Pick<SettingsFolder, 'missing' | 'hasOtherMacs' | 'settled'>): void {
  handle(CONTRACT.state.get, async () => store.get())
  handle(CONTRACT.state.setSettings, async (settings: unknown) => {
    if (!isSettings(settings)) throw new BridgeFailure('BAD_REQUEST', "'settings' must be a complete SettingsState")
    store.setSettings(settings)
  })
  handle(CONTRACT.state.settingsFolder, async () => ({ folder: store.get().settingsFolder, missing: settingsFolder.missing() }))
  // YAZ-3276 D6: a folder with another Mac's file wins (0 is older than every file); an empty folder takes
  // this Mac's settings (now is newer than none). Null keeps the settings and never deletes this Mac's file.
  handle(CONTRACT.state.setSettingsFolder, async (folder: unknown) => {
    const next = folder === null ? null : requireAbsPath(folder, 'folder')
    if (next === store.get().settingsFolder) return
    store.setSettingsFolder(next, next !== null && (await settingsFolder.hasOtherMacs(next)) ? 0 : Date.now())
    // The row asks `state.settingsFolder` right after this answers: wait for the new folder's first read,
    // so `missing` is that folder's, not the old one's (YAZ-3297). At most 2 s: a network folder that hangs
    // must not hang the door; the row then shows what is known, and the next open shows the rest.
    await Promise.race([settingsFolder.settled(), new Promise((done) => setTimeout(done, 2000))])
  })
  handle(CONTRACT.state.setSidebarWidth, async (width: unknown) => {
    if (typeof width !== 'number' || !Number.isFinite(width)) throw new BridgeFailure('BAD_REQUEST', "'width' must be a finite number")
    store.setSidebarWidth(width)
  })
  // The two orders across vaults take the same arguments by the same rule (YAZ-2631 D1; focus: YAZ-2702 Decision 3).
  for (const order of ['setFavoritesOrder', 'setFocusOrder'] as const) {
    handle(CONTRACT.state[order], async (roots: unknown, paths: unknown) => {
      store[order](requireStringArray(roots, 'roots').map((root) => requireAbsPath(root, 'root')), requireStringArray(paths, 'paths').map((path) => requireAbsPath(path, 'path')))
    })
  }
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
  handle(CONTRACT.state.setTocSource, async (root: unknown, file: unknown, source: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    // `null` is Auto. Any other word — `auto` itself among them — is no source.
    if (source !== null && !isTocSource(source)) throw new BridgeFailure('BAD_REQUEST', "'source' must be 'headings', 'bullets' or null")
    store.setTocSource(r, f, source)
  })
  handle(CONTRACT.state.setSectionIndent, async (root: unknown, file: unknown, on: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    // Off is `false`, a value that is stored. There is no `null` here: nothing un-sets a note's switch.
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    store.setSectionIndent(r, f, on)
  })
  handle(CONTRACT.state.setTocSwitch, async (root: unknown, file: unknown, on: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    store.setTocSwitch(r, f, on)
  })
  handle(CONTRACT.state.setBaseGroups, async (root: unknown, key: unknown, collapsed: unknown) => {
    const r = requireAbsPath(root, 'root')
    if (typeof key !== 'string' || key === '') throw new BridgeFailure('BAD_REQUEST', "'key' must be a non-empty string")
    store.setBaseGroups(r, key, requireStringArray(collapsed, 'collapsed'))
  })
  // Every live window gets the new state (`state.onChange` in the renderer), whichever window changed it.
  store.onChange((state) => broadcastAll(CONTRACT.state.onChange.channel, state))
}
