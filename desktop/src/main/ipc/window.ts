import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { WindowEntry, WindowIdentity } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { isRecord, normalizeTabs, type Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { handle, handleWithEvent } from './envelope'

/** `root` / `file` in the patch: absent (untouched), null, or an absolute path. */
function optionalPath(raw: Record<string, unknown>, key: 'root' | 'file'): string | null | undefined {
  const v = raw[key]
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${key}' must be a string or null`)
  return requireAbsPath(v, key)
}

/** `tabs` in the patch (GRO-2232): absent (untouched), or absolute paths only — one bad element rejects the whole call. */
function optionalTabs(raw: Record<string, unknown>): string[] | undefined {
  const v = raw.tabs
  if (v === undefined) return undefined
  if (!Array.isArray(v)) throw new BridgeFailure('BAD_REQUEST', `'tabs' must be an array of absolute paths`)
  return v.map((t, i) => requireAbsPath(t, `tabs[${i}]`))
}

/** `sidebarCollapsed`: absent (untouched), or a boolean. */
function optionalSidebarCollapsed(raw: Record<string, unknown>): boolean | undefined {
  const v = raw.sidebarCollapsed
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'sidebarCollapsed' must be a boolean")
  return v
}

/**
 * The `window.*` half of `window.yaseenDocs`. The caller is resolved through the window lookup
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
    const { id, root, file, tabs, sidebarCollapsed } = entryFor(e)
    return { id, root, file, tabs, sidebarCollapsed }
  })

  handleWithEvent(CH.windowSetIdentity, async (e, patch: unknown) => {
    if (!isRecord(patch)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
    const root = optionalPath(patch, 'root')
    const file = optionalPath(patch, 'file')
    const tabs = optionalTabs(patch)
    const sidebarCollapsed = optionalSidebarCollapsed(patch)
    const entry = entryFor(e)
    // The tabs invariant holds on the entry AS WRITTEN (GRO-2232): the loader's repair rule,
    // applied to whichever of `file` / `tabs` the patch left untouched.
    const nextFile = file !== undefined ? file : entry.file
    store.upsertWindow({
      ...entry,
      ...(root !== undefined ? { root } : {}),
      ...(sidebarCollapsed !== undefined ? { sidebarCollapsed } : {}),
      file: nextFile,
      tabs: normalizeTabs(tabs ?? entry.tabs, nextFile),
    })
  })

  // `window:close-self` (GRO-2232): the REAL close on the caller's own window, so the
  // close/flush handshake in windows.ts runs — never a destroy. Resolved via the window lookup
  // only (no state lookup): a window mid-close can still ask.
  handleWithEvent(CH.windowCloseSelf, async (e) => {
    const id = windows.idFor(e.sender)
    if (id === undefined) throw new BridgeFailure('BAD_REQUEST', 'sender is not a registered window')
    windows.closeWindow(id)
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
