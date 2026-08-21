import { BrowserWindow } from 'electron'
import type { AppState, FolderState } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { isSettings, type Store } from '../store'
import { handle } from './envelope'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The patch crosses IPC from a sandboxed renderer: only `expanded` / `lastFile`, each type-checked. */
function requireFolderPatch(raw: unknown): Partial<Pick<FolderState, 'expanded' | 'lastFile'>> {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
  const patch: Partial<Pick<FolderState, 'expanded' | 'lastFile'>> = {}
  if (raw.expanded !== undefined) {
    if (!isStringArray(raw.expanded)) throw new BridgeFailure('BAD_REQUEST', "'expanded' must be a string array")
    patch.expanded = raw.expanded
  }
  if (raw.lastFile !== undefined) {
    if (raw.lastFile !== null && typeof raw.lastFile !== 'string') throw new BridgeFailure('BAD_REQUEST', "'lastFile' must be a string or null")
    patch.lastFile = raw.lastFile
  }
  return patch
}

/** Every live window gets the new state (`state.onChange` in the renderer), whichever window changed it. */
function broadcast(state: AppState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(CH.stateChanged, state)
  }
}

/** The `state.*` half of `window.yaseenDocs` over the main-owned store (GRO-2159). */
export function registerStateIpc(store: Store): void {
  handle(CH.stateGet, async () => store.get())
  handle(CH.stateSetSettings, async (settings: unknown) => {
    if (!isSettings(settings)) throw new BridgeFailure('BAD_REQUEST', "'settings' must be a complete SettingsState")
    store.setSettings(settings)
  })
  handle(CH.stateSetSidebarCollapsed, async (collapsed: unknown) => {
    if (typeof collapsed !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'collapsed' must be a boolean")
    store.setSidebarCollapsed(collapsed)
  })
  handle(CH.statePushRecent, async (path: unknown) => {
    store.pushRecent(requireAbsPath(path, 'path'))
  })
  handle(CH.stateSetFolder, async (root: unknown, patch: unknown) => {
    store.setFolder(requireAbsPath(root, 'root'), requireFolderPatch(patch))
  })
  handle(CH.stateSetFolds, async (root: unknown, file: unknown, keys: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    if (!isStringArray(keys)) throw new BridgeFailure('BAD_REQUEST', "'keys' must be a string array")
    store.setFolds(r, f, keys)
  })
  store.onChange(broadcast)
}
