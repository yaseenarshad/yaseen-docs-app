/**
 * A VAULT SETTINGS FILE NEVER STOPS A VAULT'S SYNC (YAZ-5483, vault settings row 0, scoping section 6).
 *
 * Two pure helpers for the flat settings files of `<vault>/.yaseendocs/` (`text-formatting.json`, `link-pills.json`,
 * `link-click.json`, `show-ids.json`, `review.json`, `new-places.json`, `daily-pages.json`, and every such file to come):
 *
 * - `mergeConfigFile`: AutoSync's three-way merge of one such file, KEY BY KEY (the `mergeIconsFile` idiom, made generic).
 *   A key only one side changed takes that side's value (a delete is a change). A key both sides changed to the same
 *   value takes it. A key both sides changed to two plain objects merges inside them by the same rule. A key both sides
 *   changed to two different values takes the REMOTE's (the AutoSync rule: the remote is already on every other
 *   machine) and is named in `clashes`, so the caller logs it. A side that is not valid JSON, or not a JSON object, is
 *   dropped and the valid side is kept whole; with neither valid, the remote's text stays. So it never fails.
 *
 * - `keepUnknownKeys`: what a writer puts in a settings file. Every writer rewrites the file from its own clean value,
 *   so a Mac on an older build used to erase the keys a newer build added. Now each top-level key of the file on disk
 *   that the writer does not know stays as it is; a key it knows is the writer's (absent means "the default").
 */
import { isRecord } from './guards'

export interface ConfigMerge {
  /** The merged file's text, pretty-printed as the vault-config door writes it. */
  text: string
  /** Each key both sides changed to two different values (dotted inside an object); the remote's value was kept. */
  clashes: string[]
  /** The side that was not a JSON object and was dropped, if one was. */
  dropped: 'theirs' | 'mine' | 'both' | null
}

const parseObject = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** The same JSON value: key order inside objects does not count, array order does. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a).filter((k) => a[k] !== undefined)
  return keys.length === Object.keys(b).filter((k) => b[k] !== undefined).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}

function mergeRecords(base: Record<string, unknown>, theirs: Record<string, unknown>, mine: Record<string, unknown>, at: string, clashes: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // The remote's key order first, then the keys only this Mac has: the file reads like the remote's with ours added.
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])) {
    const [was, their, my] = [base[key], theirs[key], mine[key]]
    let pick: unknown
    if (same(my, was)) pick = their
    else if (same(their, was) || same(their, my)) pick = my
    else if (isRecord(their) && isRecord(my)) pick = mergeRecords(isRecord(was) ? was : {}, their, my, `${at}${key}.`, clashes)
    else {
      pick = their
      clashes.push(`${at}${key}`)
    }
    if (pick !== undefined) out[key] = pick
  }
  return out
}

/** `base` is null when the file is new on both sides (two Macs seeding it at once). */
export function mergeConfigFile(base: string | null, theirs: string, mine: string): ConfigMerge {
  const [t, m] = [parseObject(theirs), parseObject(mine)]
  if (t === null && m === null) return { text: theirs, clashes: [], dropped: 'both' }
  if (t === null) return { text: mine, clashes: [], dropped: 'theirs' }
  if (m === null) return { text: theirs, clashes: [], dropped: 'mine' }
  const clashes: string[] = []
  const merged = mergeRecords(parseObject(base) ?? {}, t, m, '', clashes)
  return { text: `${JSON.stringify(merged, null, 2)}\n`, clashes, dropped: null }
}

/**
 * `value` with every top-level key of `onDisk` that is not in `known` (and not in `value`) carried over. A file on
 * disk that is not a JSON object (absent, malformed) carries nothing. `value` that is not an object is returned as is.
 */
export function keepUnknownKeys(onDisk: unknown, value: unknown, known: readonly string[]): unknown {
  if (!isRecord(value) || !isRecord(onDisk)) return value
  const kept = Object.entries(onDisk).filter(([key]) => !known.includes(key) && !Object.hasOwn(value, key))
  return kept.length === 0 ? value : { ...value, ...Object.fromEntries(kept) }
}
