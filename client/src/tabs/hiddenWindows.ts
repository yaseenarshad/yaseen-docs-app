import { useSyncExternalStore } from 'react'
import { api } from '../api'

/**
 * Two sets of window ids main keeps in memory and pushes to every window (YAZ-3343 D23): the windows the
 * tab board made that are still HIDDEN, and the windows MINIMIZED in the Dock. Each is read once, then followed by its
 * push. The board tags their frames. Tiny stores of their own, so a push renders only what reads them: the board
 * reads the set; App reads only whether ITS window is in it (tab sleep, YAZ-3737 S10), so a push about another window
 * renders no App.
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
  const useIds = (): ReadonlySet<string> => useSyncExternalStore(subscribe, () => ids)
  const useHas = (id: string): boolean => useSyncExternalStore(subscribe, () => ids.has(id))
  return [useIds, useHas] as const
}

export const [useHiddenWindows, useWindowHidden] = windowSet(
  () => api.window.hiddenWindows(),
  (take) => api.window.onHiddenWindows(take),
)
export const [useMinimizedWindows, useWindowMinimized] = windowSet(
  () => api.window.minimizedWindows(),
  (take) => api.window.onMinimizedWindows(take),
)
