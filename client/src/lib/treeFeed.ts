/**
 * The window's ONE tree feed per root (YAZ-2191). The sidebar, its active-file probe and the
 * view-only catalog all read `fs:tree`; each used to fetch its own copy, four walks in the first
 * 400 ms of a window and one per consumer per watcher burst. Now:
 *   - calls made in the same TURN (one synchronous run of the event loop — a React commit's
 *     effects, one watcher event's fan-out) share one request;
 *   - a call while an older request is on the wire joins the ONE request queued behind it, never
 *     the running one, so every answer still post-dates its call (main's `fs/tree.ts` rule);
 *   - every answer reaches every `onTree` listener of that root, in request order, so whoever
 *     asked, everyone holds the newest tree;
 *   - a request on the wire longer than `STALE_FLIGHT_MS` is bypassed: the call sends its own, and
 *     should the hung one ever answer, that older answer is dropped.
 */
import { STALE_FLIGHT_MS, type TreeResponse } from '@shared/types'
import { api } from '../api'

type Outcome = PromiseSettledResult<TreeResponse>

interface Feed {
  listeners: Set<(outcome: Outcome) => void>
  onWire: Promise<TreeResponse> | null
  queued: Promise<TreeResponse> | null
  /** The turn the latest request was sent in, and when. */
  sentTurn: number
  sentAt: number
  /** Numbers each request; only answers newer than the last one delivered reach the listeners. */
  sent: number
  delivered: number
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
  if (feed === undefined) feeds.set(root, (feed = { listeners: new Set(), onWire: null, queued: null, sentTurn: 0, sentAt: 0, sent: 0, delivered: 0 }))
  return feed
}

function send(root: string, feed: Feed): Promise<TreeResponse> {
  const request = api.tree(root)
  const seq = ++feed.sent
  feed.onWire = request
  feed.sentTurn = currentTurn()
  feed.sentAt = Date.now()
  const settle = (outcome: Outcome) => {
    if (feed.onWire === request) feed.onWire = null
    if (seq < feed.delivered) return // a bypassed request answering late: never over a newer answer
    feed.delivered = seq
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
  if (Date.now() - feed.sentAt > STALE_FLIGHT_MS) {
    feed.queued = null // the hung request's queue stays with it; later calls queue behind this one
    return send(root, feed)
  }
  if (feed.sentTurn === currentTurn()) return feed.onWire
  if (feed.queued !== null) return feed.queued
  const queued: Promise<TreeResponse> = feed.onWire.then(again, again)
  function again(): Promise<TreeResponse> {
    if (feed.queued === queued) feed.queued = null
    return send(root, feed)
  }
  return (feed.queued = queued)
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
