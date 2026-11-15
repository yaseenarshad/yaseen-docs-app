import { isRecord } from './guards'

/**
 * WHAT A WRITER PUTS IN A VAULT SETTINGS FILE (YAZ-5483 row 0's rule, here for `table-look.json`, YAZ-5487). Every
 * writer rewrites the file from its own clean value, so a Mac on an older build would erase the keys a newer build
 * added. Each top-level key of the file on disk that the writer does not know stays as it is; a key it knows is the
 * writer's (absent means "the default").
 *
 * `value` with every top-level key of `onDisk` that is not in `known` (and not in `value`) carried over. A file on
 * disk that is not a JSON object (absent, malformed) carries nothing. `value` that is not an object is returned as is.
 */
export function keepUnknownKeys(onDisk: unknown, value: unknown, known: readonly string[]): unknown {
  if (!isRecord(value) || !isRecord(onDisk)) return value
  const kept = Object.entries(onDisk).filter(([key]) => !known.includes(key) && !Object.hasOwn(value, key))
  return kept.length === 0 ? value : { ...value, ...Object.fromEntries(kept) }
}
