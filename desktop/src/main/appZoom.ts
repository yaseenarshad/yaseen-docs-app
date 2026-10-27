import type { SettingsState } from '@shared/types'
import type { Store } from './store'

/**
 * The App size in the main process (YAZ-3432): `settings.appZoom` is the Chromium page zoom of EVERY window, a Files
 * window too. Chromium keeps a zoom per origin, and a Files window has an origin of its own (YAZ-3357), so index.ts
 * sets each `webContents`: at its creation, on each load, and here on every change. Electron-free (like theme.ts)
 * so it unit-tests without a browser.
 */

/** The Chromium zoom factor for the settings (1 = 100%). The store keeps `appZoom` on `APP_ZOOM_STEPS`. */
export function appZoomFactor(settings: SettingsState): number {
  return settings.appZoom / 100
}

/**
 * Calls `apply` with the new factor and the one before it each time the App size changes, never on other writes.
 * Windows load it themselves; the one before lets a Files window keep its page width (YAZ-3441).
 */
export function subscribeAppZoom(store: Store, apply: (factor: number, before: number) => void): () => void {
  let last = appZoomFactor(store.get().settings)
  return store.onChange((state) => {
    const next = appZoomFactor(state.settings)
    if (next === last) return
    const before = last
    last = next
    apply(next, before)
  })
}
