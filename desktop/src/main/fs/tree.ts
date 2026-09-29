import { STALE_FLIGHT_MS, type TreeResponse } from '@shared/types'
import { buildTree, fsCall, requireAbsPath, requireDir } from './fsUtils'

/**
 * ONE walk per root at a time (YAZ-2191). A caller arriving mid-walk joins the single
 * trailing walk that starts when the current one ends — never the running one, whose snapshot may
 * predate the change behind the call — so every answer still post-dates its request, while a storm
 * of N watcher events (git pull, Finder copy, bulk rename) costs two walks instead of N concurrent
 * ones, and a save is never queued behind hundreds of them. A walk hung past `STALE_FLIGHT_MS` is
 * bypassed, not waited on: the caller walks on its own, as every call did before coalescing.
 */
interface Flight {
  walk: Promise<TreeResponse>
  startedAt: number
  /** The one walk queued behind `walk`, shared by every caller that arrived during it. */
  next?: Promise<TreeResponse>
}
const flights = new Map<string, Flight>()

/** `window.yaseenDocs.tree(root)`: recursive vault tree of `root` (see `buildTree`). */
export async function tree(root: string): Promise<TreeResponse> {
  const dir = requireAbsPath(root, 'root')
  const flight = flights.get(dir)
  if (flight === undefined || Date.now() - flight.startedAt > STALE_FLIGHT_MS) return walkOnce(dir)
  // A flight bypassed meanwhile runs its trailing walk unregistered: it must not replace the live one.
  const next = () => (flights.get(dir) === flight ? walkOnce(dir) : walk(dir))
  return (flight.next ??= flight.walk.then(next, next))
}

function walkOnce(dir: string): Promise<TreeResponse> {
  const flight: Flight = { walk: walk(dir), startedAt: Date.now() }
  flights.set(dir, flight)
  const done = () => {
    if (flights.get(dir) === flight && flight.next === undefined) flights.delete(dir)
  }
  void flight.walk.then(done, done)
  return flight.walk
}

async function walk(dir: string): Promise<TreeResponse> {
  await requireDir(dir)
  return { root: dir, tree: await fsCall(dir, () => buildTree(dir)), generatedAt: Date.now() }
}
