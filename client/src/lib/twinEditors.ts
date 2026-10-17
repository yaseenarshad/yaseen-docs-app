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
 * Module-scoped, i.e. PER RENDERER: two windows on one note still sync through the watcher (YAZ-2942).
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

/** Test hook. */
export function _resetTwinEditors(): void {
  listeners.clear()
}
