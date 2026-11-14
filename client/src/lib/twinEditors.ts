/**
 * Copies of one file in one window hear each other's saves at once (YAZ-2940 D4, S23).
 *
 * A duplicated tab puts two or more editors on one path. Without this, a copy hears its twin's
 * save only through the disk watcher, up to a debounce later: type in one copy, switch, type in
 * the other within that window, and the second save hits the conflict bar.
 *
 * `useAutosave` announces every successful write with the mtime it got back; every editor of that
 * path (the writer included) answers through the same `onDiskChange` the watcher drives. The
 * writer skips itself by the echo check (`mtime === c.mtime` after `c.settled()`): the announce
 * runs INSIDE the save, so the writer's in-flight save settles only after its mtime is updated.
 * A clean twin reloads as a diff (folds, caret and scroll stay); a dirty twin shows the conflict
 * bar. The watcher event for the same write then matches the twin's new mtime and is skipped.
 *
 * Module-scoped, i.e. PER RENDERER: two windows on one page still sync through the watcher (YAZ-2942).
 */

type TwinSaveListener = (mtime: number) => void

const listeners = new Map<string, Set<TwinSaveListener>>()

/** Hear every save of `path` in this window; returns the unsubscribe. */
export function onTwinSave(path: string, listener: TwinSaveListener): () => void {
  let set = listeners.get(path)
  if (set === undefined) listeners.set(path, (set = new Set()))
  set.add(listener)
  return () => {
    const current = listeners.get(path)
    if (current === undefined) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(path)
  }
}

/** A save of `path` landed on disk with `mtime`: tell every editor of that path. O(copies of the path). */
export function announceTwinSave(path: string, mtime: number): void {
  const set = listeners.get(path)
  if (set === undefined) return
  for (const listener of [...set]) listener(mtime)
}

/** The paths with an app write of `announcedWrite` in flight, and how many. */
const writing = new Map<string, number>()
/** The mtime the last `announcedWrite` of each path got: the watcher's event of that write carries it. */
const announced = new Map<string, number>()

/**
 * An app write to a page that is no typing of its editor (YAZ-4946: an Inbox answer, a review delete, the card window's
 * ⋯): the open editors of `path` take the new bytes QUIETLY, as a twin's save — out of the undo history, with no
 * "outside changes" bar, no glow and no entry in the change list. While the write runs the editors ignore the watcher
 * for `path`, and after it the watcher's event that carries the write's mtime (`isAnnouncedWrite`): that event cannot
 * land as an outside change, whichever comes first.
 */
export async function announcedWrite<T extends { mtime: number }>(path: string, write: () => Promise<T>): Promise<T> {
  writing.set(path, (writing.get(path) ?? 0) + 1)
  try {
    const landed = await write()
    announced.delete(path)
    announced.set(path, landed.mtime)
    // One mtime for each path written: never more entries than the pages the app wrote this way.
    if (announced.size > 500) announced.delete(announced.keys().next().value!)
    announceTwinSave(path, landed.mtime)
    return landed
  } finally {
    const left = (writing.get(path) ?? 1) - 1
    if (left === 0) writing.delete(path)
    else writing.set(path, left)
  }
}

/** Is the watcher's change of `path` at `mtime` an `announcedWrite` (one in flight, or the last one's mtime)? */
export const isAnnouncedWrite = (path: string, mtime: number): boolean => writing.has(path) || announced.get(path) === mtime

/** Test hook. */
export function _resetTwinEditors(): void {
  listeners.clear()
  writing.clear()
  announced.clear()
}
