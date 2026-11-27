/**
 * Single-window activation and focus helper for macOS Vault and Workspace launchers (YAZ-6595 D1/D2).
 *
 * Keeps Electron-free types so every branch (visible, hidden, Dock-minimized, Cmd+H hidden app,
 * rapid double-trigger dedupe, fallback timeout, and closed cleanup) is unit-tested under vitest.
 */

/** Fallback timeout while waiting for macOS Dock deminiaturization to emit `restore`. */
export const RESTORE_FOCUS_FALLBACK_MS = 800

export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  show(): void
  hide(): void
  restore(): void
  moveTop(): void
  focus(): void
  once(event: 'restore' | 'closed', listener: () => void): unknown
  off(event: 'restore' | 'closed', listener: () => void): unknown
}

export interface FocusSingleWindowOptions {
  isMac: boolean
  isAppHidden?: () => boolean
  showApp?: () => void
  stealAppFocus?: () => void
  siblingWindows?: () => readonly FocusableWindow[]
  onSiblingHidden?: (sibling: FocusableWindow) => void
  onTargetShown?: (target: FocusableWindow) => void
  restoreFallbackMs?: number
}

/** Tracks any in-flight macOS Dock restore waiter per window so rapid triggers never stack listeners. */
const pendingRestoreCancels = new WeakMap<FocusableWindow, () => void>()

/**
 * Raises and focuses only `target` without pulling unrelated sibling windows forward.
 *
 * - On macOS when the whole app is hidden (`Cmd+H`), hides non-minimized siblings and calls
 *   `showApp` BEFORE any `restore()` so deminiaturization cannot unhide siblings early, then
 *   notifies `onSiblingHidden` / `onTargetShown` so `WindowManager.hiddenWins` stays in sync.
 * - On macOS with a minimized target, waits for `restore` (deduped per window via WeakMap, with
 *   a fallback timer and `closed` cleanup) before ordering `target` forward.
 */
export function focusSingleWindow(target: FocusableWindow, opts: FocusSingleWindowOptions): void {
  if (target.isDestroyed()) return

  // Cancel any prior pending restore waiter for this window before starting a new focus pass.
  pendingRestoreCancels.get(target)?.()

  const unhideAppForTarget = (): boolean => {
    const wasHidden = opts.isMac && opts.isAppHidden?.() === true
    if (wasHidden) {
      for (const sibling of opts.siblingWindows?.() ?? []) {
        if (sibling !== target && !sibling.isDestroyed() && !sibling.isMinimized()) {
          sibling.hide()
          opts.onSiblingHidden?.(sibling)
        }
      }
      opts.showApp?.()
    }
    return wasHidden
  }

  const raiseNow = (wasHidden: boolean): void => {
    if (target.isDestroyed()) return
    if (!target.isVisible()) target.show()
    opts.onTargetShown?.(target)
    target.moveTop()
    target.focus()
    if (wasHidden) opts.stealAppFocus?.()
  }

  if (!target.isMinimized()) {
    const wasHidden = unhideAppForTarget()
    raiseNow(wasHidden)
    return
  }

  if (!opts.isMac) {
    target.restore()
    raiseNow(false)
    return
  }

  // Hide siblings and unhide the app BEFORE `restore()` so macOS does not unhide siblings during deminiaturization.
  const wasHidden = unhideAppForTarget()

  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = (): void => {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    if (pendingRestoreCancels.get(target) === cleanup) pendingRestoreCancels.delete(target)
    target.off('restore', onRestore)
    target.off('closed', onClosed)
  }
  const onRestore = (): void => {
    if (settled) return
    cleanup()
    raiseNow(wasHidden)
  }
  const onClosed = (): void => {
    cleanup()
  }

  pendingRestoreCancels.set(target, cleanup)
  target.once('restore', onRestore)
  target.once('closed', onClosed)
  target.restore()
  if (!settled) {
    timer = setTimeout(onRestore, opts.restoreFallbackMs ?? RESTORE_FOCUS_FALLBACK_MS)
    timer.unref?.()
  }
}
