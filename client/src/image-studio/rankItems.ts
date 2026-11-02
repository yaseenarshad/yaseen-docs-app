/**
 * THE ADD TAB'S ONE RANKING (YAZ-4157 D4): every local item — favorites, recent, components, shapes — is ordered here
 * and nowhere else. The match itself is the app's one matcher (`matchTier`, `links/completion.ts`), so a typed text
 * finds the same things it finds in ⌘K and the `[[` picker; this file only adds what the library learned.
 *
 * AN ITEM ANSWERS TO SEVERAL NAMES: its title, its aliases (a shape's id, kind, direction and alias words), the words
 * the user taught it, and all of those run together — so "rounded box" still finds the rounded rectangle when "rounded"
 * is in its title and "box" in an alias. Its best name sets its tier.
 *
 * THE ORDER, best first: a word the user taught it that IS the text (the Emoji app's "learned" pick), then the match
 * tier, then more uses, then the newer use. Input order breaks the last tie, so an empty text keeps it.
 *
 * Cost: one `matchTier` per name — about 6,000 for the 1,600 items a full library holds, well under 2 ms per key.
 */
import type { StudioItem, UsedMediaItem } from '@shared/types'
import { matchTier, readNeedle } from '../links/completion'

export function rankItems(
  items: readonly StudioItem[],
  used: ReadonlyMap<string, UsedMediaItem>,
  query: string,
  aliases: (item: StudioItem) => readonly string[],
): StudioItem[] {
  const needle = readNeedle(query)
  if (needle.text === '') return [...items]
  const ranked: { item: StudioItem; taught: number; tier: number; count: number; last: number; at: number }[] = []
  items.forEach((item, at) => {
    const row = used.get(item.itemKey)
    const words = row?.words ?? []
    const names = [item.title, ...aliases(item), ...words]
    let tier = matchTier({ name: names.join(' ') }, needle)
    for (const name of names) {
      const t = matchTier({ name }, needle)
      if (t !== -1 && (tier === -1 || t < tier)) tier = t
    }
    if (tier === -1) return
    ranked.push({ item, taught: words.includes(needle.text) ? 0 : 1, tier, count: row?.count ?? 0, last: row?.updatedAt ?? 0, at })
  })
  ranked.sort((a, b) => a.taught - b.taught || a.tier - b.tier || b.count - a.count || b.last - a.last || a.at - b.at)
  return ranked.map(({ item }) => item)
}
