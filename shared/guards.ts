/**
 * The type guards every parser in the app shares (YAZ-2201): written once, so "a plain object"
 * cannot mean one thing in the state file and another in a view schema.
 */

/** A plain JSON object. `typeof [] === 'object'`, so the array check is part of the question. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** An array of strings only. */
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** A real number: not NaN, not Infinity, and not a numeric string (ported with the board doors, YAZ-3028). */
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Normalise a stored LIST the same way everywhere (`media.json`'s two lists, `components.json`'s
 * items; ported from Draw by YAZ-3038): drop the rows that do not survive `normalize`, keep the FIRST
 * of any repeated key, and stop at `cap`. A bad row costs its own row and nothing else — one hand
 * edit must not cost the whole file — and the cap is enforced on READ too, so a hand edit cannot grow the list either.
 */
export function cleanList<T>(raw: unknown, normalize: (row: unknown) => T | null, keyOf: (item: T) => string, cap = Infinity): T[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of raw) {
    const item = normalize(row)
    if (item === null || seen.has(keyOf(item))) continue
    seen.add(keyOf(item))
    out.push(item)
    if (out.length === cap) break
  }
  return out
}
