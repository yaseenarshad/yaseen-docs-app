/**
 * The card pill (YAZ-5030, YAZ-5792): the DOM a link to a card draws, in the page (`wikilinkPlugin.ts`), in a card's own
 * drawing (`renderCard`, `cardRender.ts`) and on the phone's page (`pageRender.ts`). Its own file, with no editor import
 * (YAZ-5067, decision 3 of YAZ-5055): the card drawing and the review screen load without the editor's link plugin, so
 * the phone app can draw a card. `WIKILINK_CLASS` lives here for the same reason; `wikilinkPlugin.ts` gives it out as
 * before. The pill's look is `wikilink.css`, imported here too, so a card drawn with no editor still has it.
 *
 * A card link follows the vault's link format (YAZ-5792, Settings › Link pills, `linkPillLook.ts`), as a page link does:
 * the format's pieces before and after the card's title (`pillParts`), with the card's own facts — `{id}` and `{number}`
 * its ID, `{folder}` and `{path}` the folder of the page that holds it — and the card icon where `{icon}` stands. There is
 * no other card pill: with the default format a card link is its icon and its title.
 */
import './wikilink.css'
import type { CardLink } from '@shared/cardLinks'
import { headKey, headSpan, pathInfo, pillParts, pillsNeedInfo, tailKey, tailSpan, type PillEnd } from './linkPillLook'
import type { WikilinkResolveSource } from './linkResolve'

export const WIKILINK_CLASS = 'wikilink'

/** The class of a card link's title when the card icon stands on it (`{icon}{name}`): the icon on its `::before`. */
export const WIKILINK_CARD_CLASS = 'wikilink--card'

/**
 * The element that holds a pill's pieces — the head, the name, the tail — and draws nothing itself (`display: contents`,
 * `wikilink.css`), so the pieces sit side by side and `wikilink.css`'s sibling rules join them into one box. It is the one
 * element a click finds (`closest`) and a redraw replaces.
 */
export const WIKILINK_GROUP_CLASS = 'wikilink-group'

/** The card icon as a piece of a pill's head or tail (`{icon}` away from `{name}`): its own rule in `wikilink.css`. */
const CARD_ICON = { class: 'card-icon' }

/** What the vault's format puts before a pill's name and after it (`pillParts`); each null when it puts nothing. */
export interface PillEnds {
  head: PillEnd | null
  tail: PillEnd | null
}

/** A key of a pill's ends, for a decoration that must draw again when they change. */
export const endsKey = (ends: PillEnds): string => `${ends.head === null ? '' : headKey(ends.head)}|${ends.tail === null ? '' : tailKey(ends.tail)}`

/**
 * The ends a link to `card` gains under the vault's format (YAZ-5792). The card's facts, not its page's: `{id}` and
 * `{number}` are the card's ID; `{folder}` and `{path}` the folder of the page that holds it (`pathInfo`, built once per
 * index snapshot, and only when the format shows one of them). A card is in this vault and always has its icon.
 */
export function cardPillEnds(source: Pick<WikilinkResolveSource, 'pills' | 'vault' | 'records' | 'folders'>, card: CardLink): PillEnds {
  const info = pillsNeedInfo(source.pills) ? { id: card.id, folder: pathInfo(source.records, source.folders).get(card.path)?.folder ?? '' } : undefined
  return pillParts(source.pills, { info, otherVault: null }, source.vault, true)
}

/**
 * A pill's pieces in order: the head, `name`, the tail. `cls` is the pill's classes for the ends (`wikilink`, and
 * `wikilink--unresolved` for a missing page), never the icon's; `icon` is the icon piece's attributes.
 */
export function pillPieces(ends: PillEnds, name: HTMLElement, cls: string, icon?: Record<string, string>): HTMLElement[] {
  const pieces = [name]
  if (ends.head !== null) pieces.unshift(headSpan(cls, ends.head, icon))
  if (ends.tail !== null) pieces.push(tailSpan(cls, ends.tail, icon))
  return pieces
}

/**
 * The DOM a card link draws (YAZ-5792): the card's title between the format's ends, in a group. The card icon stands on
 * the title when the format puts `{icon}` right before `{name}` (`iconOnName`, `pillIconPlace` 'name'); else it is a
 * piece of an end, or nowhere.
 */
export function cardPill(title: string, ends: PillEnds, iconOnName: boolean): HTMLElement {
  const name = document.createElement('span')
  name.className = iconOnName ? `${WIKILINK_CLASS} ${WIKILINK_CARD_CLASS}` : WIKILINK_CLASS
  name.spellcheck = false
  name.textContent = title
  const group = document.createElement('span')
  group.className = WIKILINK_GROUP_CLASS
  // A target of the course's guided tour (YAZ-5123): a click on a card pill.
  group.dataset.tour = 'card-link-pill'
  group.append(...pillPieces(ends, name, WIKILINK_CLASS, CARD_ICON))
  return group
}
