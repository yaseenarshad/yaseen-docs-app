import { BrowserWindow } from 'electron'
import type { AppState } from '@shared/types'
import type { Store } from '../store'

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

/** The open-vault roots of `AppState.windows` (null = Welcome), unique. */
export function rootsOf(state: AppState): string[] {
  return [...new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))]
}

/**
 * Main's own `subscribe(root)` per open-vault root, one each, dropped when the last window on that
 * root goes (YAZ-2201 6B; vaultConfig, favorites and properties).
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
