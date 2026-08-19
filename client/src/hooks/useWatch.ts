import { useEffect, useMemo, useRef } from 'react'
import type { WatchEvent } from '@shared/types'

export type WatchListener = (ev: WatchEvent) => void

export interface WatchSource {
  subscribe: (listener: WatchListener) => () => void
}

const EVENT_TYPES: WatchEvent['type'][] = ['ready', 'add', 'change', 'unlink', 'addDir', 'unlinkDir', 'error']

/**
 * One EventSource on `/api/watch?root=` per root; fans events out to subscribers.
 * EventSource reconnects by itself; every (re)connect yields a `ready` event, which
 * subscribers use to refetch state they may have missed.
 */
export function useWatch(root: string | null): WatchSource {
  const listeners = useRef(new Set<WatchListener>())
  const source = useMemo<WatchSource>(
    () => ({
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => {
          listeners.current.delete(listener)
        }
      },
    }),
    [],
  )
  useEffect(() => {
    if (root === null) return
    const es = new EventSource(`/api/watch?root=${encodeURIComponent(root)}`)
    const onMessage = (e: MessageEvent<string>) => {
      const ev = JSON.parse(e.data) as WatchEvent
      listeners.current.forEach((l) => l(ev))
    }
    EVENT_TYPES.forEach((t) => es.addEventListener(t, onMessage))
    return () => es.close()
  }, [root])
  return source
}
