/**
 * One key, capitals ignored (YAZ-4769, option B): property and column keys that differ only by letter case, or by
 * spaces at either end, are THE SAME key everywhere in the app — `Dessert Column` on Recipes and `dessert column` on
 * Desserts are one column, and a page's `dessert column` is that column's value. A file keeps whatever spelling it
 * has: the app folds only to compare (`keyFold`). A write under one spelling removes the page's other spellings of the
 * key in the same file write (`setOneSpelling`), so stray spellings go as pages are edited. Nothing is migrated.
 *
 * The app's own keys (`reservedKeys`: `id`, `title`, `in`, …) keep their exact spelling: a caller passes them as
 * `keep`, and no fold ever removes or renames one.
 */
import { folderValues, setFolderValue } from './folderValues'
import { parseFrontmatter, renameFrontmatterKey, setFrontmatterIn, splitFrontmatter } from './frontmatter'

/** The form two keys are compared in: `Dessert Column`, ` dessert column ` and `DESSERT COLUMN` are one key. */
export const keyFold = (key: string): string => key.trim().toLowerCase()

/** Are `a` and `b` the same key? */
export const sameKey = (a: string, b: string): boolean => a === b || keyFold(a) === keyFold(b)

/** The key of `keys` that is `key`: its exact spelling first, else the first that folds the same; undefined when none. */
export function findKey(keys: Iterable<string>, key: string): string | undefined {
  const fold = keyFold(key)
  let found: string | undefined
  for (const k of keys) {
    if (k === key) return k
    if (found === undefined && keyFold(k) === fold) found = k
  }
  return found
}

/** The spelling `properties` holds `key` under (exact first), or undefined when it holds none. */
export function heldKey(properties: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return Object.hasOwn(properties, key) ? key : findKey(Object.keys(properties), key)
}

/** `properties`' value for `key`, under whichever spelling it holds it (exact first). */
export function foldedValue(properties: Readonly<Record<string, unknown>>, key: string): unknown {
  const held = heldKey(properties, key)
  return held === undefined ? undefined : properties[held]
}

/** The OTHER spellings of `key` in `properties`: every key that folds the same but is not `key`, less `keep`. */
export function otherSpellings(properties: Readonly<Record<string, unknown>>, key: string, keep?: ReadonlySet<string>): string[] {
  const fold = keyFold(key)
  return Object.keys(properties).filter((k) => k !== key && !keep?.has(k) && keyFold(k) === fold)
}

/** A map of spellings by fold, the first spelling of each key winning: what `respell` reads. */
export function spellings(keys: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const key of keys) {
    const fold = keyFold(key)
    if (!out.has(fold)) out.set(fold, key)
  }
  return out
}

/**
 * A page's values with each key that is one of `spell`'s keys under that key's spelling (a page's columns): a page's
 * `dessert column` reads as the page's `Dessert Column`. When a page holds two spellings, the column's own wins, else
 * the first; the other stays in the file and is not shown. `skip` (the app's keys) is never moved. The same object
 * when nothing moves, so a memoized row stays the same row.
 */
export function respell(properties: Record<string, unknown>, spell: ReadonlyMap<string, string>, skip?: ReadonlySet<string>): Record<string, unknown> {
  if (spell.size === 0) return properties
  let out: Record<string, unknown> | null = null
  for (const key of Object.keys(properties)) {
    if (skip?.has(key)) continue
    const column = spell.get(keyFold(key))
    if (column === undefined || column === key) continue
    out ??= { ...properties }
    if (!Object.hasOwn(out, column)) out[column] = properties[key]
    delete out[key]
  }
  return out ?? properties
}

/**
 * Set (or delete, `value === undefined`) ONE key of a whole file's frontmatter under ONE spelling: `key`'s. Any other
 * spelling of it at the top level goes in the same change — the first is renamed to `key` in place (its line, its
 * comment), the rest are removed — so the page holds the key once. `keep` (the app's keys) is never touched.
 */
export function setOneSpelling(content: string, key: string, value: unknown, keep?: ReadonlySet<string>): string {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const others = error === undefined ? otherSpellings(properties, key, keep) : []
  if (others.length === 0) return setFrontmatterIn(content, [key], value)
  let next = content
  let rest = others
  if (value !== undefined && !Object.hasOwn(properties, key)) {
    next = renameFrontmatterKey(next, [], others[0], key)
    rest = others.slice(1)
  }
  for (const other of rest) next = setFrontmatterIn(next, [other], undefined)
  return setFrontmatterIn(next, [key], value)
}

/**
 * The same for ONE folder's block of `in` (a separate column, YAZ-4713 C3): `key` is set first, then the block's other
 * spellings of it go, so the block is never emptied on the way.
 */
export function setFolderValueOneSpelling(content: string, folderId: string, key: string, value: unknown): string {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const others = error === undefined ? otherSpellings(folderValues(properties, folderId), key) : []
  return others.reduce((next, other) => setFolderValue(next, folderId, other, undefined), setFolderValue(content, folderId, key, value))
}
