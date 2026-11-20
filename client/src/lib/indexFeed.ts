/**
 * The window's ONE index feed per root (YAZ-6027, mirroring `treeFeed.ts`): `WikilinkIndexBridge` (`useIndex`)
 * and search (`useSearchCandidates`) both read `fs:index`. Sharing one feed means:
 *   - calls in the same synchronous turn share one IPC call;
 *   - a call while a request is on the wire joins the single trailing request behind it;
 *   - every fulfilled answer reaches every `onIndex` listener of that root, so search never needs a duplicate
 *     parallel fetch when `useIndex` already refreshed the vault;
 *   - when the last listener unsubscribes, the feed entry is dropped on a microtask (no retained snapshots or test leaks).
 */
import { STALE_FLIGHT_MS, type IndexResponse } from '@shared/types'
import { api } from '../api'
import { currentTurn } from './treeFeed'

type Outcome = PromiseSettledResult<IndexResponse>

interface Feed {
  listeners: Set<(outcome: Outcome) => void>
  latest: IndexResponse | null
  onWire: Promise<IndexResponse> | null
  sentTurn: number
  sentAt: number
  sent: number
  delivered: number
}

const feeds = new Map<string, Feed>()

function feedOf(root: string): Feed {
  let feed = feeds.get(root)
  if (feed === undefined) feeds.set(root, (feed = { listeners: new Set(), latest: null, onWire: null, sentTurn: 0, sentAt: 0, sent: 0, delivered: 0 }))
  return feed
}

function send(root: string, feed: Feed): Promise<IndexResponse> {
  const request = api.index(root)
  const seq = ++feed.sent
  feed.onWire = request
  feed.sentTurn = currentTurn()
  feed.sentAt = Date.now()
  const settle = (outcome: Outcome) => {
    if (feed.onWire === request) feed.onWire = null
    if (seq < feed.delivered) return
    feed.delivered = seq
    if (outcome.status === 'fulfilled') feed.latest = outcome.value
    for (const listener of [...feed.listeners]) listener(outcome)
  }
  request.then(
    (value) => settle({ status: 'fulfilled', value }),
    (reason: unknown) => settle({ status: 'rejected', reason }),
  )
  return request
}

/** An index of `root` that post-dates this call; shares one request across callers in the same synchronous turn unless `fresh` is set, while allowing newer calls to overtake slow earlier requests (YAZ-2191, YAZ-6027). */
export function fetchIndex(root: string, fresh = false): Promise<IndexResponse> {
  const feed = feedOf(root)
  if (!fresh && feed.onWire !== null && feed.sentTurn === currentTurn() && Date.now() - feed.sentAt <= STALE_FLIGHT_MS) {
    return feed.onWire
  }
  return send(root, feed)
}

/** Subscribes to every index answer for `root`; drops the feed once the last listener leaves. */
export function onIndex(root: string, listener: (outcome: Outcome) => void): () => void {
  const feed = feedOf(root)
  feed.listeners.add(listener)
  return () => {
    feed.listeners.delete(listener)
    if (feed.listeners.size > 0) return
    queueMicrotask(() => {
      if (feed.listeners.size === 0 && feeds.get(root) === feed) feeds.delete(root)
    })
  }
}

/** The newest index snapshot `onIndex` has delivered for `root`, or null before the first answer. */
export function latestIndex(root: string): IndexResponse | null {
  return feeds.get(root)?.latest ?? null
}

/** True when at least one listener is actively keeping `root`'s feed alive. */
export function hasIndexListeners(root: string): boolean {
  return (feeds.get(root)?.listeners.size ?? 0) > 0
}
