import type { FriendsPort } from '../../app/friendsPort'
import { PHONE, type TokenStore, type VaultStore } from '../../store'
import type { SyncEngine } from '../../sync/engine'
import type { FriendsService, FriendsServices } from './service'

/**
 * Friends for `main.tsx`: 4A's `FriendsPort` and the screens' service, loaded as a chunk of their own. The
 * friends logic (4E1, 4E2, the marks) and the screens are not in the first load; the chunk loads when the app starts
 * (it must know whether to open on Friends, decision 21), in parallel with the rest.
 */
/**
 * The phone-only fact "there is a friend or a group" that 4E2's list keeps (`friendsHas`, in `list.ts`). The
 * first screen reads it from the store, with no friends chunk (`start.test.tsx` checks that the list writes it).
 */
export const HAS_FRIENDS_STATE = 'friendsHas'
/** With no fact yet (a new phone of a person with friends), the opening waits this long for the list behind the splash. */
export const HAS_FRIENDS_WAIT_MS = 1500

type Made = FriendsService & { port: FriendsPort; stop(): Promise<void>; list?: { rows(): Promise<unknown> } }

export function lazyFriends(
  store: VaultStore,
  tokens: TokenStore,
  engine: Promise<SyncEngine>,
  options: { load?: () => Promise<Made>; waitMs?: number } = {},
): FriendsServices {
  let made: Promise<Made> | null = null
  const load = () => (made ??= options.load?.() ?? import('./service').then((m) => m.createFriendsService({ store, tokens, engine })))
  return {
    async hasFriends() {
      if (typeof globalThis.location?.search === 'string' && new URLSearchParams(globalThis.location.search).get('friendsDemo') === '1') {
        return true
      }
      const fact = await store.getState<boolean>(PHONE, HAS_FRIENDS_STATE)
      if (typeof fact === 'boolean') return fact
      // No fact yet: read the list once (it writes the fact), for a short time at most; else Review (decision 21).
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<'late'>((r) => (timer = setTimeout(() => r('late'), options.waitMs ?? HAS_FRIENDS_WAIT_MS)))
      const read = load().then(async (s) => {
        if ('list' in s && s.list) await s.list.rows()
        else await s.board()
        return s.port.hasFriends()
      })
      const answer = await Promise.race([read.catch(() => false), late])
      clearTimeout(timer)
      return answer === true
    },
    settings: async () => (await load()).port.settings(),
    saveSettings: async (s) => (await load()).port.saveSettings(s),
    deleteMe: async () => {
      const s = await load()
      if (s.port.deleteMe) return s.port.deleteMe()
      if (s.deleteMe) return s.deleteMe()
      return { ok: false, error: 'unsupported' }
    },
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
