import type { FriendsPort } from '../../app/friendsPort'
import type { TokenStore, VaultStore } from '../../store'
import type { SyncEngine } from '../../sync/engine'
import type { FriendsService, FriendsServices } from './service'

/**
 * Friends for `main.tsx` (YAZ-5085): 4A's `FriendsPort` and the screens' service, loaded as a chunk of their own. The
 * friends logic (4E1, 4E2, the marks) and the screens are not in the first load; the chunk loads when the app starts
 * (it must know whether to open on Friends, decision 21), in parallel with the rest.
 */
export function lazyFriends(store: VaultStore, tokens: TokenStore, engine: Promise<SyncEngine>): FriendsServices {
  let made: Promise<FriendsService & { port: FriendsPort; stop(): Promise<void> }> | null = null
  const load = () => (made ??= import('./service').then((m) => m.createFriendsService({ store, tokens, engine })))
  return {
    hasFriends: async () => (await load()).port.hasFriends(),
    settings: async () => (await load()).port.settings(),
    saveSettings: async (s) => (await load()).port.saveSettings(s),
    service: () => load(),
    stop: async () => {
      if (made !== null) await (await made).stop()
    },
  }
}

/** The screens' service when the app has one (tests with 4A's plain port have none: the tab shows its empty state). */
export function serviceOf(port: FriendsPort): (() => Promise<FriendsService>) | null {
  const s = (port as Partial<FriendsServices>).service
  return typeof s === 'function' ? s.bind(port) : null
}
