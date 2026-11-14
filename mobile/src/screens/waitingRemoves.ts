import { PHONE, type VaultStore } from '../store'

/**
 * YAZ-5362: the erase ask's count of the friends removes that wait. It reads two phone-state keys directly. It does
 * NOT import the friends code (`friends/removeQueue.ts`, `friends/list.ts`): that brings the friends list code
 * (`@shared/friendsList`, `@shared/friendGists`) into the app's first load (+38 kB), only to count.
 *
 * The contract with the friends code (`waitingRemoves.test.ts` holds it):
 * - the queue (`REMOVE_QUEUE`, YAZ-5236): an array, one item for each remove whose first write did not go;
 * - YAZ-5361: the removes that wait in the list on GitHub (`WAITING_REMOVES` of `friends/list.ts`): a number, the saga
 *   state of the list as the phone last read it ("Removing…"). The two never hold the same remove.
 */
export const REMOVE_QUEUE_KEY = 'friendsRemoveQueue'
export const WAITING_REMOVES_KEY = 'friendsWaitingRemoves'

export async function waitingRemoves(store: VaultStore): Promise<number> {
  const queue = await store.getState<unknown>(PHONE, REMOVE_QUEUE_KEY).catch(() => undefined)
  const inList = await store.getState<unknown>(PHONE, WAITING_REMOVES_KEY).catch(() => undefined)
  return (Array.isArray(queue) ? queue.length : 0) + (typeof inList === 'number' && Number.isInteger(inList) && inList > 0 ? inList : 0)
}
