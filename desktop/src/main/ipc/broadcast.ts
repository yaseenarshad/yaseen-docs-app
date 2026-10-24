import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AppState } from '@shared/types'
import type { Store } from '../store'
import type { WindowManager } from '../windows'

/**
 * Sends `channel` (+ payload) to every live window, whichever window — or main itself —
 * caused the change. Renderers filter by their own root where that matters (the
 * `state:changed` / `vaultConfig:changed` posture).
 */
export function broadcastAll(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(channel, ...args)
  }
}

/** The vaults the window that sent `e` shows (YAZ-2602 D1); none for Welcome or an unknown sender. */
export function senderRoots(store: Pick<Store, 'get'>, windows: Pick<WindowManager, 'idFor'>, e: IpcMainInvokeEvent): readonly string[] {
  return store.get().windows.find((w) => w.id === windows.idFor(e.sender))?.roots ?? []
}

/**
 * A save door that logs its file in the save log once the save is on disk (YAZ-3235 D1): a save that
 * throws (a `CONFLICT`, a bad request) logs nothing, and neither does one that `logs` says no to (a
 * quiet tidy-up write). The vault is the caller's, as `rootOfPath` finds it.
 */
export function loggedSave<A extends unknown[], R extends { path: string }>(store: Pick<Store, 'get' | 'addEdit'>, windows: Pick<WindowManager, 'idFor'>, save: (...args: A) => Promise<R>, logs: (...args: A) => boolean = () => true) {
  return async (e: IpcMainInvokeEvent, ...args: A): Promise<R> => {
    const saved = await save(...args)
    if (logs(...args)) store.addEdit(senderRoots(store, windows, e), saved.path)
    return saved
  }
}

/** Every vault of every window in `AppState.windows` (Welcome has none), unique (YAZ-2602 D6). */
export function rootsOf(state: AppState): string[] {
  return [...new Set(state.windows.flatMap((w) => w.roots))]
}

/**
 * Main's own `subscribe(root)` per open-vault root, one each, dropped when the last window on that
 * root goes (YAZ-2201 6B; vaultConfig, favorites, focus and properties).
 */
export function syncPerRoot(store: Store, subscribe: (root: string) => () => void): void {
  const subs = new Map<string, () => void>()
  const sync = (state: AppState): void => {
    const roots = new Set(rootsOf(state))
    for (const [root, off] of subs) {
      if (!roots.has(root)) {
        off()
        subs.delete(root)
      }
    }
    for (const root of roots) if (!subs.has(root)) subs.set(root, subscribe(root))
  }
  store.onChange(sync)
  sync(store.get())
}
