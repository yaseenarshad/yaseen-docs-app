/**
 * THE SEARCH OVER DOWNLOADED ICON PACKS (YAZ-4359, round 2 decision 5). Pure: the names come in, the matches go out.
 * `iconPacks.ts` loads the names; `providers.ts` pages the matches.
 *
 * A NAME MATCHES when every word of the search starts a part of it ("arrow left" finds `arrow-left-bold`, never
 * `sparrow`) — the rule `groupResults` already shows tiles by, so nothing local is left out on screen.
 *
 * THE ORDER: the name that IS the search, then names that start with it, then the rest; a shorter name first; then the
 * pack order the caller gives (the colour sets first, then the biggest packs, as streaming shows them). Look-alikes
 * across packs end up side by side, and `groupResults` folds them behind "+N" as it does for streaming.
 */

/** The most matches one search keeps: "arrow" has about 7,700 today. */
export const MAX_LOCAL_MATCHES = 20_000

/** The words of a search, as an icon name's parts are matched against them. */
export const searchWords = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[\s\-_:]+/)
    .filter((word) => word.length > 0)

/**
 * The matching `prefix:name` ids of `packs` (in the caller's pack order), best first. `allowed` (null = every pack) and
 * `keep` are the filters (YAZ-4360). At most `MAX_LOCAL_MATCHES`.
 */
export function rankLocalMatches(
  packs: readonly (readonly [prefix: string, names: readonly string[]])[],
  query: string,
  allowed: ReadonlySet<string> | null,
  keep: (providerId: string) => boolean,
): string[] {
  const words = searchWords(query)
  if (words.length === 0) return []
  const joined = words.join('-')
  // The longest word is the rarest: the cheap `includes` test on it drops most names before any split.
  const probe = words.reduce((a, b) => (b.length > a.length ? b : a))
  const found: { id: string; tier: number; length: number; order: number }[] = []
  let order = 0
  for (const [prefix, names] of packs) {
    if (allowed !== null && !allowed.has(prefix)) continue
    for (const name of names) {
      order++
      if (!name.includes(probe)) continue
      const parts = name.split('-')
      if (!words.every((word) => parts.some((part) => part.startsWith(word)))) continue
      const id = `${prefix}:${name}`
      if (!keep(id)) continue
      found.push({ id, tier: name === joined ? 0 : name.startsWith(joined) ? 1 : 2, length: name.length, order })
    }
  }
  found.sort((a, b) => a.tier - b.tier || a.length - b.length || a.order - b.order)
  return found.slice(0, MAX_LOCAL_MATCHES).map(({ id }) => id)
}
