import type { GistsApi, IndexHandle } from '@shared/friendGists'
import { pointersOf } from '@shared/friendGists'
import { removeMany, type ListOptions, type RemoveResult } from '@shared/friendsList'
import type { GistBudget } from '@shared/friendSend'
import { PHONE, type VaultStore } from '../store'

/**
 * YAZ-5236: removes that GitHub refused BEFORE their first write (its own "rate limit", or no connection). The list
 * cannot hold them yet, so the phone keeps them (phone-only state) until the sender or the rows run them, in order, as
 * ONE re-key. A restart keeps them. Until then the row shows "Removing…".
 */
export const REMOVE_QUEUE = 'friendsRemoveQueue'

export interface QueuedRemove {
  /** My pointer for the friend, the group, or the shared link. */
  mine: string
  /** More of my gists to delete with it ("Delete group": the group file). */
  drop?: string[]
  at: number
}

export async function loadQueue(store: VaultStore): Promise<QueuedRemove[]> {
  const q = await store.getState<QueuedRemove[]>(PHONE, REMOVE_QUEUE)
  return Array.isArray(q) ? q : []
}

/** Adds a remove to the queue (once). `store` is the phone-wide session of the action (YAZ-5195). */
export async function enqueueRemove(store: VaultStore, item: QueuedRemove): Promise<void> {
  const q = await loadQueue(store)
  if (q.some((x) => x.mine === item.mine)) return
  await store.setState(PHONE, REMOVE_QUEUE, [...q, item])
}

/**
 * Runs the queue as one `removeMany`. The queue is cleared once the list holds the remove (its first write went), or
 * when none of its pointers is in the list any more. Null: the queue is empty.
 */
export async function drainQueue(api: GistsApi, handle: IndexHandle, store: VaultStore, budget: GistBudget, opts: ListOptions): Promise<RemoveResult | null> {
  const q = await loadQueue(store)
  if (q.length === 0) return null
  const result = await removeMany(api, handle, q.map((x) => x.mine), budget, opts, { drop: q.flatMap((x) => x.drop ?? []) })
  const listed = pointersOf(result.handle.index)
  if (q.every((x) => !listed.includes(x.mine))) await store.removeState(PHONE, REMOVE_QUEUE)
  return result
}

/** YAZ-5275: takes a waiting remove back (the person added the same friend again before it ran). */
export async function dequeueRemove(store: VaultStore, mine: string): Promise<void> {
  const q = await loadQueue(store)
  if (!q.some((x) => x.mine === mine)) return
  const rest = q.filter((x) => x.mine !== mine)
  if (rest.length === 0) await store.removeState(PHONE, REMOVE_QUEUE)
  else await store.setState(PHONE, REMOVE_QUEUE, rest)
}

/** The pointers that wait in the queue (for the "Removing…" rows). */
export const queuedMines = async (store: VaultStore): Promise<Set<string>> => new Set((await loadQueue(store)).map((x) => x.mine))
