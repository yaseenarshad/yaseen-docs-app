/**
 * LINKS TO A PAGE CARD (YAZ-5030, D7 of YAZ-4948 brought in): `[[WIKI-512]]` names the CARD whose card line holds the
 * ID `WIKI-512`. IDs come from one vault counter for pages, boards and cards (D2), so an ID is one thing's. The file
 * keeps `[[WIKI-512]]`: the ID never changes, so a move or a rename of the card's page touches no such link.
 *
 * Read off the index alone (`IndexRecord.cards`: each card's ID, place and title): no page is read. A target is read
 * as the page resolver reads an ID (`targetKey`, `idKey`): any case, the `|words` and a `#part` off, and an ID with
 * letters the vault had before as the same number. Two cards with one ID (a copy the sweep has not met yet): the first
 * in path order, then in page order. Pure: no DOM, no Node.
 */
import { idKey, targetKey } from './linkResolver'
import type { IndexRecord } from './types'

/** The card a link names: its ID, its page, its place among the page's cards, and its title. */
export interface CardLink {
  id: string
  /** The page the card is on (its absolute path, as the index names it). */
  path: string
  /** The card's place among the page's cards (`pageCards` order, 0 first). */
  index: number
  /** The card's title (its card line's, `cardTitleOf`), '' for a card with none. */
  title: string
  /** The title is hidden on the Inbox's front (`notitle`). */
  notitle: boolean
  /** The card is a card file's (YAZ-5037, `IndexRecord.kind`): `path` is the card's own file, not a page it is on. */
  file?: true
}

/** Link target → the card it names, or null: no card holds that ID. */
export type CardResolve = (target: string) => CardLink | null

/** What a card look-up reads of a record: its path and its cards. */
type CardHolder = { path: string; kind?: IndexRecord['kind']; cards?: readonly NonNullable<IndexRecord['cards']>[number][] }

/** Every card with an ID in `records`, by its ID in lowercase (and as the current letters read it, `idKey`). */
export function cardsById(records: readonly CardHolder[], letters?: readonly string[]): Map<string, CardLink> {
  const byId = new Map<string, CardLink>()
  for (const r of records) {
    if (r.cards === undefined) continue
    r.cards.forEach((card, index) => {
      if (card.id === null) return
      const link: CardLink = { id: card.id, path: r.path, index, title: card.title ?? '', notitle: card.notitle === true, ...(r.kind === 'card' && { file: true as const }) }
      const key = card.id.toLowerCase()
      if (!byId.has(key)) byId.set(key, link)
      const current = idKey(key, letters)
      if (!byId.has(current)) byId.set(current, link)
    })
  }
  return byId
}

/** The card resolver of one index snapshot: a target that is a card's ID → that card. */
export function makeCardResolver(records: readonly CardHolder[], letters?: readonly string[]): CardResolve {
  const byId = cardsById(records, letters)
  if (byId.size === 0) return () => null
  return (target) => {
    const key = targetKey(target)
    if (key === '') return null
    return byId.get(idKey(key, letters)) ?? byId.get(key) ?? null
  }
}

/**
 * The cards a page embeds (YAZ-5037: `![[GEO-140]]` shows the card, wherever it lives): each `embeds` target the card
 * resolver reads as a card, in order, each card one time. A board, a page and an ID no card has are none.
 */
export function embeddedCards(embeds: readonly string[], resolveCard: CardResolve): CardLink[] {
  const out = new Map<string, CardLink>()
  for (const target of embeds) {
    const card = resolveCard(target)
    if (card !== null && !out.has(card.id.toLowerCase())) out.set(card.id.toLowerCase(), card)
  }
  return [...out.values()]
}

/**
 * The pages that link to card `id` (YAZ-5030: the card window's "Linked mentions"), in records order: each record one
 * of whose links the card resolver reads as that card. The card's own page counts when it links to the card.
 */
export function cardBacklinks(records: readonly IndexRecord[], id: string, resolveCard: CardResolve): IndexRecord[] {
  const wanted = id.toLowerCase()
  return records.filter((r) => r.links.some((target) => resolveCard(target)?.id.toLowerCase() === wanted))
}

/**
 * The pages that EMBED card `id` (YAZ-5037: a card file tab's "Embedded in"), in records order: each record one of
 * whose `![[…]]` targets the card resolver reads as that card. A link to the card is a mention, not an embed.
 */
export function cardEmbedders(records: readonly IndexRecord[], id: string, resolveCard: CardResolve): IndexRecord[] {
  const wanted = id.toLowerCase()
  return records.filter((r) => r.embeds.some((target) => resolveCard(target)?.id.toLowerCase() === wanted))
}
