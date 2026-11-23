import { listMemory, type ListMemory } from '@shared/friendListStore'
import { PHONE, type VaultStore } from '../store'

/**
 * This phone's own tag in the friends list (phone-only state, made once). A remove's step that this phone
 * began before a stop (the intent of a new numbers generation) is known as its own after a restart, so it goes on at
 * once instead of waiting for the lease of another device. Random: it names no person and no device.
 */
const DEVICE = 'friendsDevice'

export async function deviceTag(store: VaultStore): Promise<string> {
  const kept = await store.getState<string>(PHONE, DEVICE)
  if (typeof kept === 'string' && /^p[0-9a-z]{6,20}$/.test(kept)) return kept
  const made = `p${Math.floor(Math.random() * 36 ** 8).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`
  await store.setState(PHONE, DEVICE, made)
  return made
}

/**
 * The newest friends list this phone wrote or read, in each vault repo (`ListMemory` of
 * `shared/friendListStore.ts`): only the repo name with a write count and a time. A read of GitHub that is OLDER than it
 * (a read replica that lags) is never trusted, so a remove never says "done" from an old list. Kept in the phone's own
 * state, so a restart keeps it; one copy for each store in memory, so the list and the sender share it.
 */
const SEEN = 'friendsListSeen'
const seen = new WeakMap<object, ReturnType<typeof listMemory>>()

export async function listSeen(store: VaultStore): Promise<ListMemory> {
  const had = seen.get(store)
  if (had !== undefined) return had
  const saved = await store.getState<unknown>(PHONE, SEEN)
  const made = seen.get(store) ?? listMemory(saved)
  seen.set(store, made)
  return made
}

/** Stores the memory (`session`: the phone-wide session of the action, so nothing is stored after an erase). */
export async function keepListSeen(store: VaultStore, session: VaultStore): Promise<void> {
  const m = seen.get(store)
  if (m !== undefined) await session.setState(PHONE, SEEN, m.dump())
}
