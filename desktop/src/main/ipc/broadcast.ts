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

/**
 * Main's own `subscribe(root)` per open-vault root — the roots of `AppState.windows` (null =
 * Welcome), one subscription each — dropped when the last window on that root goes (YAZ-2201:
 * config, favorites and properties each kept their own copy of this).
 */
export function syncPerRoot(store: Store, subscribe: (root: string) => () => void): void {
  const subs = new Map<string, () => void>()
  const sync = (state: AppState): void => {
    const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
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
