import { useSyncExternalStore } from 'react'
import { api } from '../api'

/**
 * Two sets of window ids main keeps in memory and pushes to every window (YAZ-3343 D23): the windows the
 * tab board made that are still HIDDEN, and the windows MINIMIZED in the Dock. Each is read once, then followed by its
 * push. The board tags their frames. Tiny stores of their own, so a push renders the board alone.
 */
function windowSet(read: () => Promise<string[]>, follow: (take: (ids: string[]) => void) => () => void) {
  let ids: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  let started = false
  const subscribe = (listener: () => void): (() => void) => {
    if (!started) {
      started = true
      const take = (next: readonly string[]): void => {
        ids = new Set(next)
        listeners.forEach((l) => l())
      }
      follow(take)
      read().then(take, () => undefined)
    }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return () => useSyncExternalStore(subscribe, () => ids)
}

export const useHiddenWindows = windowSet(
  () => api.window.hiddenWindows(),
  (take) => api.window.onHiddenWindows(take),
)
export const useMinimizedWindows = windowSet(
  () => api.window.minimizedWindows(),
  (take) => api.window.onMinimizedWindows(take),
)
