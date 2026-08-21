import type { IpcMainInvokeEvent } from 'electron'
import type { WindowEntry, WindowIdentity } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import type { Store } from '../store'
import type { WindowRegistry } from '../windows'
import { handle, handleWithEvent } from './envelope'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `root` / `file` in the patch: absent (untouched), null, or an absolute path. */
function optionalPath(raw: Record<string, unknown>, key: 'root' | 'file'): string | null | undefined {
  const v = raw[key]
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${key}' must be a string or null`)
  return requireAbsPath(v, key)
}

/**
 * The `window.*` half of `window.yaseenDocs` (GRO-2159: identity only). The caller is resolved
 * through the registry (`webContents.id` → window id) and answered from `AppState.windows`.
 * `open` / `duplicate` stay registered so the preload's promise rejects cleanly until
 * GRO-2160 / GRO-2167 implement them.
 */
export function registerWindowIpc(store: Store, windows: WindowRegistry): void {
  const entryFor = (e: IpcMainInvokeEvent): WindowEntry => {
    const id = windows.idFor(e.sender)
    if (id === undefined) throw new BridgeFailure('BAD_REQUEST', 'sender is not a registered window')
    const entry = store.get().windows.find((w) => w.id === id)
    if (entry === undefined) throw new BridgeFailure('NOT_FOUND', `window ${id} is not in the app state`)
    return entry
  }

  handleWithEvent(CH.windowIdentity, async (e): Promise<WindowIdentity> => {
    const { id, root, file } = entryFor(e)
    return { id, root, file }
  })

  handleWithEvent(CH.windowSetIdentity, async (e, patch: unknown) => {
    if (!isRecord(patch)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
    const root = optionalPath(patch, 'root')
    const file = optionalPath(patch, 'file')
    const entry = entryFor(e)
    store.upsertWindow({
      ...entry,
      ...(root !== undefined ? { root } : {}),
      ...(file !== undefined ? { file } : {}),
    })
  })

  const notYet = async (): Promise<never> => {
    throw new BridgeFailure('IO_ERROR', 'not implemented until GRO-2160/2167')
  }
  handle(CH.windowOpen, notYet)
  handle(CH.windowDuplicate, notYet)
}
