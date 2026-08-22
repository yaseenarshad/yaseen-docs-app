import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { WindowEntry, WindowIdentity } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { isRecord, type Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { handle, handleWithEvent } from './envelope'

/** `root` / `file` in the patch: absent (untouched), null, or an absolute path. */
function optionalPath(raw: Record<string, unknown>, key: 'root' | 'file'): string | null | undefined {
  const v = raw[key]
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${key}' must be a string or null`)
  return requireAbsPath(v, key)
}

/**
 * The `window.*` half of `window.yaseenDocs`. The caller is resolved through the registry
 * (`webContents.id` → window id) and answered from `AppState.windows`. `open` / `duplicate`
 * are D6 plumbing into the window manager (GRO-2160; the gestures land in D-), and
 * `app:flushed` is the renderer's half of the close/quit flush handshake.
 */
export function registerWindowIpc(store: Store, windows: WindowManagerIpc): void {
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

  handle(CH.windowOpen, async (opts: unknown) => {
    if (!isRecord(opts)) throw new BridgeFailure('BAD_REQUEST', 'options must be an object')
    windows.openWindow({ root: optionalPath(opts, 'root') ?? null, file: optionalPath(opts, 'file') ?? null })
  })

  handleWithEvent(CH.windowDuplicate, async (e) => {
    windows.duplicateWindow(entryFor(e))
  })

  // The renderer's ack in the flush handshake (fire-and-forget send, so no envelope).
  ipcMain.on(CH.appFlushed, (e) => windows.handleFlushed(e.sender))
}
