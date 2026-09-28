import type { TreeResponse } from '@shared/types'
import { api } from '../api'

/**
 * The window's ONE tree feed per root (YAZ-2191). The sidebar, its active-file probe and the
 * view-only catalog all read `fs:tree`; each used to fetch its own copy, four walks in the first
 * 400 ms of a window and one per consumer per watcher burst. Now:
 *   - calls made in the same TURN (one synchronous run of the event loop — a React commit's
 *     effects, one watcher event's fan-out) share one request;
 *   - a call while an older request is on the wire joins the ONE request queued behind it, never
 *     the running one, so every answer still post-dates its call (main's `fs/tree.ts` rule);
 *   - every answer reaches every `onTree` listener of that root, in request order, so whoever
 *     asked, everyone holds the newest tree.
 */
type Outcome = PromiseSettledResult<TreeResponse>

interface Feed {
  listeners: Set<(outcome: Outcome) => void>
  onWire: Promise<TreeResponse> | null
  queued: Promise<TreeResponse> | null
  /** The turn the latest request was sent in. */
  sentTurn: number
}

const feeds = new Map<string, Feed>()

let turnId = 1
let turnEnding = false

/** Id of the current synchronous run; it moves on at the next microtask checkpoint. */
export function currentTurn(): number {
  if (!turnEnding) {
    turnEnding = true
    queueMicrotask(() => {
      turnId++
      turnEnding = false
    })
  }
  return turnId
}

function feedOf(root: string): Feed {
  let feed = feeds.get(root)
  if (feed === undefined) feeds.set(root, (feed = { listeners: new Set(), onWire: null, queued: null, sentTurn: 0 }))
  return feed
}

function send(root: string, feed: Feed): Promise<TreeResponse> {
  const request = api.tree(root)
  feed.onWire = request
  feed.sentTurn = currentTurn()
  const settle = (outcome: Outcome) => {
    if (feed.onWire === request) feed.onWire = null
    for (const listener of [...feed.listeners]) listener(outcome)
  }
  request.then(
    (value) => settle({ status: 'fulfilled', value }),
    (reason: unknown) => settle({ status: 'rejected', reason }),
  )
  return request
}

/** A tree of `root` that post-dates this call; see the module comment for how calls share. */
export function fetchTree(root: string): Promise<TreeResponse> {
  const feed = feedOf(root)
  if (feed.onWire === null) return send(root, feed)
  if (feed.sentTurn === currentTurn()) return feed.onWire
  const again = () => {
    feed.queued = null
    return send(root, feed)
  }
  return (feed.queued ??= feed.onWire.then(again, again))
}

/** Every answer for `root`, whoever asked for it; returns the unsubscribe. */
export function onTree(root: string, listener: (outcome: Outcome) => void): () => void {
  const feed = feedOf(root)
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

/** Whether a request for `root` was sent in `turn` or later: its answer covers anything seen by then. */
export function treeSentSince(root: string, turn: number): boolean {
  return feedOf(root).sentTurn >= turn
}
