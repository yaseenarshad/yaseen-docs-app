/**
 * ONE TILE PER ICON, ITS COPIES ON REQUEST (YAZ-4157 demo 6J). Iconify answers a word with the same icon from many
 * sets — "nail polish" from Noto, OpenMoji, Twemoji, Fluent and Icon Park, then in five skin tones — and it matches
 * inside words ("snail", "thumbnails"). On the first page for "nail" that left no room for a nail.
 *
 * So the web results are grouped: icons whose names are the same once the style and skin-tone endings are taken off
 * are ONE tile, the first of them (the provider's own order), and the rest are its variants, shown when asked for.
 * An icon whose name has no word that starts with a word of the search is left out. Pixabay items pass as they are.
 */
import type { StudioItem } from '@shared/types'

/** A tile of the web results and the copies it stands for. */
export interface ResultGroup {
  head: StudioItem
  variants: StudioItem[]
}

/** Endings that make a style or a skin tone of the same icon, not a different one. Taken off again and again. */
const VARIANT_ENDING =
  /-(?:light|medium-light|medium|medium-dark|dark|skin-tone|tone\d|outline|outlined|fill|filled|solid|bold|thin|regular|duotone|twotone|two-tone|sharp|round|rounded|line|linear|flat|bulk|broken|duocolor|alt|\d{1,2})$/

/** The name an icon is grouped by: its name in the set, without the endings above. */
export function iconGroupKey(name: string): string {
  let key = name.toLowerCase()
  for (let next = key.replace(VARIANT_ENDING, ''); next !== key && next !== ''; next = key.replace(VARIANT_ENDING, '')) key = next
  return key
}

/** The words of the search, as an icon name's words are matched against them. */
const searchWords = (query: string) => query.toLowerCase().split(/[\s-]+/).filter((word) => word.length > 0)

/** An icon name some word of which starts with a word of the search: "nails" for "nail", never "snail". */
export function namesTheSearch(name: string, query: string): boolean {
  const words = searchWords(query)
  if (words.length === 0) return true
  const parts = name.toLowerCase().split('-')
  return words.some((word) => parts.some((part) => part.startsWith(word)))
}

export function groupResults(items: readonly StudioItem[], query: string): ResultGroup[] {
  const groups: ResultGroup[] = []
  const byKey = new Map<string, ResultGroup>()
  for (const item of items) {
    if (item.provider !== 'iconify') {
      groups.push({ head: item, variants: [] })
      continue
    }
    const name = item.providerId.slice(item.providerId.indexOf(':') + 1)
    if (!namesTheSearch(name, query)) continue
    const key = iconGroupKey(name)
    const group = byKey.get(key)
    if (group !== undefined) group.variants.push(item)
    else {
      const fresh = { head: item, variants: [] }
      byKey.set(key, fresh)
      groups.push(fresh)
    }
  }
  return groups
}
