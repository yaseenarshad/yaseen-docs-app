/**
 * Single-window activation and focus helper for macOS Vault and Workspace launchers (YAZ-6595 D1/D2).
 *
 * Keeps Electron-free types so every branch (visible, hidden, Dock-minimized, Cmd+H hidden app,
 * fallback timeout, and closed cleanup) is unit-tested under vitest with fakes.
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
  restoreFallbackMs?: number
}

/**
 * Raises and focuses only `target` without pulling unrelated sibling windows forward.
 *
 * - On macOS with a minimized target, waits for `restore` (with a fallback timer and `closed` cleanup)
 *   before ordering `target` to the front so focus is not dropped mid-animation.
 * - On macOS when the whole app is hidden (`Cmd+H`), hides non-minimized siblings before calling
 *   `showApp`, then shows/raises/focuses `target` and steals app focus so only `target` surfaces.
 */
export function focusSingleWindow(target: FocusableWindow, opts: FocusSingleWindowOptions): void {
  if (target.isDestroyed()) return

  const raiseNow = (): void => {
    if (target.isDestroyed()) return
    const wasHidden = opts.isMac && opts.isAppHidden?.() === true
    if (wasHidden) {
      for (const sibling of opts.siblingWindows?.() ?? []) {
        if (sibling !== target && !sibling.isDestroyed() && !sibling.isMinimized()) {
          sibling.hide()
        }
      }
      opts.showApp?.()
    }
    if (!target.isVisible()) target.show()
    target.moveTop()
    target.focus()
    if (wasHidden) opts.stealAppFocus?.()
  }

  if (!target.isMinimized()) {
    raiseNow()
    return
  }

  if (!opts.isMac) {
    target.restore()
    raiseNow()
    return
  }

  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (shouldRaise: boolean): void => {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    target.off('restore', onRestore)
    target.off('closed', onClosed)
    if (shouldRaise) raiseNow()
  }
  const onRestore = (): void => finish(true)
  const onClosed = (): void => finish(false)

  target.once('restore', onRestore)
  target.once('closed', onClosed)
  target.restore()
  if (!settled) {
    timer = setTimeout(onRestore, opts.restoreFallbackMs ?? RESTORE_FOCUS_FALLBACK_MS)
    timer.unref?.()
  }
}
