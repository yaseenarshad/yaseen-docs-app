/**
 * Single-window activation and focus helper for macOS Vault and Workspace launchers (YAZ-6595 D1/D2).
 *
 * Keeps Electron-free types so every branch (visible, hidden, Dock-minimized, Cmd+H hidden app,
 * rapid double-trigger dedupe, fallback timeout, and closed cleanup) is unit-tested under vitest.
 */

/** Fallback timeout while waiting for macOS Dock deminiaturization to emit `restore`. */
export const RESTORE_FOCUS_FALLBACK_MS = 800

/** Short delay after `app.focus({ steal: true })` to reclaim focus if macOS activated a cross-display sibling. */
export const POST_ACTIVATE_REFOCUS_MS = 60

export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  isFocused?(): boolean
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
  postActivateRefocusMs?: number
}

/** Tracks any in-flight macOS Dock restore waiter per window so rapid triggers never stack listeners. */
const pendingRestoreCancels = new WeakMap<FocusableWindow, () => void>()

/** Tracks the latest post-activation cross-display refocus timer across all windows so a newer target cancels any older one. */
let cancelPendingRefocus: (() => void) | undefined

/**
 * Raises and focuses only `target` without pulling unrelated sibling windows forward.
 *
 * - On macOS, orders `target` key (`moveTop()` + `focus()`) BEFORE calling `stealAppFocus()`
 *   (`app.focus({ steal: true })`, which activates without `NSApplicationActivateAllWindows`),
 *   so macOS activates the app and brings only `target` forward with real keyboard focus.
 * - If macOS cross-display activation briefly focuses a sibling on the previously active display,
 *   a single short post-activation check re-focuses `target` if it is not yet focused.
 * - On macOS when the whole app is hidden (`Cmd+H`), hides non-minimized siblings and calls
 *   `showApp` BEFORE any `restore()` so deminiaturization cannot unhide siblings early, then
 *   notifies `onSiblingHidden` / `onTargetShown` so `WindowManager.hiddenWins` stays in sync.
 * - On macOS with a minimized target, waits for `restore` (deduped per window via WeakMap, with
 *   a fallback timer and `closed` cleanup) before ordering `target` forward and activating.
 */
export function focusSingleWindow(target: FocusableWindow, opts: FocusSingleWindowOptions): void {
  if (target.isDestroyed()) return

  // Cancel any older post-activation refocus (for any window) and any prior restore waiter for this target.
  cancelPendingRefocus?.()
  pendingRestoreCancels.get(target)?.()

  const unhideAppForTarget = (): void => {
    if (opts.isMac && opts.isAppHidden?.() === true) {
      for (const sibling of opts.siblingWindows?.() ?? []) {
        if (sibling !== target && !sibling.isDestroyed() && !sibling.isMinimized()) {
          sibling.hide()
          opts.onSiblingHidden?.(sibling)
        }
      }
      opts.showApp?.()
    }
  }

  const schedulePostActivateRefocus = (): void => {
    if (target.isFocused === undefined) return
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (cancelPendingRefocus === cleanup) cancelPendingRefocus = undefined
      target.off('closed', cleanup)
    }
    cancelPendingRefocus = cleanup
    target.once('closed', cleanup)
    timer = setTimeout(() => {
      if (settled) return
      cleanup()
      if (!target.isDestroyed() && !target.isFocused?.()) {
        target.moveTop()
        target.focus()
      }
    }, opts.postActivateRefocusMs ?? POST_ACTIVATE_REFOCUS_MS)
    timer.unref?.()
  }

  const raiseNow = (): void => {
    if (target.isDestroyed()) return
    if (!target.isVisible()) target.show()
    opts.onTargetShown?.(target)
    target.moveTop()
    target.focus()
    if (!opts.isMac) return
    opts.stealAppFocus?.()
    schedulePostActivateRefocus()
  }

  if (!target.isMinimized()) {
    unhideAppForTarget()
    raiseNow()
    return
  }

  if (!opts.isMac) {
    target.restore()
    raiseNow()
    return
  }

  // Hide siblings and unhide the app BEFORE `restore()` so macOS does not unhide siblings during deminiaturization.
  unhideAppForTarget()

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
    raiseNow()
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
