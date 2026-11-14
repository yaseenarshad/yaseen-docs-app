import { useEffect, useState, useSyncExternalStore } from 'react'
import { FRIENDS_POLL_MS } from '@shared/friendSend'
import { useApp } from '../../app/AppState'
import { serviceOf } from './lazy'
import type { Board, FriendsService } from './service'

/**
 * The board of one service, shared by the tab and "You vs" (one read for both). While a screen shows it, it is read
 * again each `FRIENDS_POLL_MS` (decision 21; an unchanged friend is two free 304s). One read runs at a time.
 */
interface BoardSnapshot {
  board: Board | null
  /** Read time (ms) of `board`. */
  at: number
  reading: boolean
}
class BoardStore {
  snapshot: BoardSnapshot = { board: null, at: 0, reading: false }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private run: Promise<void> | null = null
  constructor(
    private readonly service: FriendsService,
    private readonly now: () => number,
  ) {}
  private set(patch: Partial<BoardSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const l of [...this.listeners]) l()
  }
  refresh = (): Promise<void> => {
    if (this.run !== null) return this.run
    this.set({ reading: true })
    this.run = this.service
      .board()
      .then((board) => this.set({ board, at: this.now(), reading: false }))
      .catch(() => this.set({ board: { kind: 'failed' }, at: this.now(), reading: false }))
      .finally(() => (this.run = null))
    return this.run
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.refresh()
      this.timer = setInterval(() => void this.refresh(), FRIENDS_POLL_MS)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== null) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }
  get = () => this.snapshot
}
const stores = new WeakMap<FriendsService, BoardStore>()
const EMPTY: BoardSnapshot = { board: null, at: 0, reading: false }
const noop = () => () => undefined

/** The screens' service, once its chunk loaded; null with 4A's plain port (tests of other screens). */
export function useService(): { service: FriendsService | null; ready: boolean } {
  const { services } = useApp()
  const [state, setState] = useState<{ service: FriendsService | null; ready: boolean }>({ service: null, ready: false })
  useEffect(() => {
    const get = serviceOf(services.friends)
    if (get === null) {
      setState({ service: null, ready: true })
      return
    }
    let live = true
    void get().then((service) => live && setState({ service, ready: true }))
    return () => {
      live = false
    }
  }, [services.friends])
  return state
}

export function useBoard(service: FriendsService | null): BoardSnapshot & { refresh(): Promise<void> } {
  const { services } = useApp()
  const now = services.now ?? Date.now
  let store: BoardStore | null = null
  if (service !== null) {
    store = stores.get(service) ?? new BoardStore(service, now)
    stores.set(service, store)
  }
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.get ?? (() => EMPTY))
  return { ...snapshot, refresh: store?.refresh ?? (async () => undefined) }
}

/** The clock of the screens (the app's, so tests and fixtures can fix it). */
export function useNow(): number {
  const { services } = useApp()
  return (services.now ?? Date.now)()
}
