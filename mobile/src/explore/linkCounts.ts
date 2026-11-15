import { linkPath } from '@client/editor/wikilink/linkResolve'
import type { VaultData } from '../search/vaultData'
import { cardOf, resolveSourceOf } from '../page/pageLook'
import type { SheetRoute } from './sheets'

/**
 * The foot of a sheet (YAZ-5472, as Mochi shows it): "N Backlinks · N References". From the vault's index on the phone
 * (each file's `links` and `embeds`), resolved as the reader resolves a link (`linkPath`, `cardOf`):
 *  - BACKLINKS: the other files with a link to this page, or to this card (by its ID; a card file's page path too);
 *  - REFERENCES: the files and cards this page (or this card's text) links to.
 * The map of every link is built once for each version of the vault's data, after the sheet has slid up.
 */

/** Where a link goes: a page's path, or `path#ID` for a card. */
const keyOf = (path: string, id?: string) => (id === undefined ? path : `${path}#${id.toLowerCase()}`)

function targetOf(data: VaultData, inner: string): string | null {
  const card = cardOf(data, inner)
  if (card !== null) return keyOf(card.path, card.id)
  return linkPath(inner, resolveSourceOf(data), undefined)
}

const maps = new WeakMap<VaultData, Map<string, Set<string>>>()

/** Each link's target, with the files that link to it. */
function backlinkMap(data: VaultData): Map<string, Set<string>> {
  let map = maps.get(data)
  if (map !== undefined) return map
  map = new Map()
  for (const record of data.records)
    for (const inner of [...record.links, ...record.embeds]) {
      const to = targetOf(data, inner)
      if (to === null) continue
      let from = map.get(to)
      if (from === undefined) map.set(to, (from = new Set()))
      from.add(record.path)
    }
  maps.set(data, map)
  return map
}

/** The `[[…]]` and `![[…]]` of a card's text, as the index keeps them (no `|alias`, no `#heading`). */
export function linksInText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const inner = m[1].split('|')[0].trim()
    if (inner !== '') out.push(inner)
  }
  return out
}

export interface LinkCounts {
  backlinks: number
  references: number
}

/** The counts of `route`; `cardText`: the card's text, for a card (its references). */
export function linkCounts(data: VaultData, route: SheetRoute, cardText?: string): LinkCounts {
  const map = backlinkMap(data)
  const self = route.path
  const record = data.byPath[self]
  const from = new Set<string>()
  const add = (key: string) => map.get(key)?.forEach((p) => p !== self && from.add(p))
  if (route.kind === 'page') add(self)
  else {
    add(keyOf(self, route.id))
    if (record?.kind === 'card') add(self)
  }
  const inners = route.kind === 'card' && record?.kind !== 'card' ? linksInText(cardText ?? '') : [...(record?.links ?? []), ...(record?.embeds ?? [])]
  const to = new Set<string>()
  const own = route.kind === 'card' ? keyOf(self, route.id) : self
  for (const inner of inners) {
    const target = targetOf(data, inner)
    if (target !== null && target !== self && target !== own) to.add(target)
  }
  return { backlinks: from.size, references: to.size }
}

/** "1 Backlink · 3 References". */
export const countWords = ({ backlinks, references }: LinkCounts): string =>
  `${backlinks} ${backlinks === 1 ? 'Backlink' : 'Backlinks'} · ${references} ${references === 1 ? 'Reference' : 'References'}`
