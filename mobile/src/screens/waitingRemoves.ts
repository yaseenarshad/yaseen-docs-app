import { PHONE, type VaultStore } from '../store'

/**
 * YAZ-5362: the erase ask's count of the friends removes that wait on the phone. It reads the queue's state key
 * directly. It does NOT import `friends/removeQueue.ts`: that file brings the friends list code (`@shared/friendsList`,
 * `@shared/friendGists`) into the app's first load (+38 kB), only to count one array.
 *
 * The contract with the friends code (`waitingRemoves.test.ts` holds it): the queue is an array, stored under
 * `REMOVE_QUEUE` in the phone-wide state (`PHONE`), one item for each waiting remove.
 */
export const REMOVE_QUEUE_KEY = 'friendsRemoveQueue'

export async function waitingRemoves(store: VaultStore): Promise<number> {
  const queue = await store.getState<unknown>(PHONE, REMOVE_QUEUE_KEY).catch(() => undefined)
  return Array.isArray(queue) ? queue.length : 0
}
