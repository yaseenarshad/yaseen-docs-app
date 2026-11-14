/**
 * What the board host needs of a CARD EMBED before its box is there (YAZ-5037): which card an embed or a link names
 * (`embedCard`), the doors and the host the box gets, and the one load of the box's chunk (`loadCardEmbed`,
 * `cardEmbed.ts`). Small and eager: the host's check, the link menu and the paste chip ask it on every page.
 */
import type { CardLink } from '@shared/cardLinks'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { IndexRecord } from '@shared/types'
import type { LinkFollow } from '../wikilink/wikilinkClick'
import { linkCard, linkPath, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import type { CardEditor } from './cardEditor'
import type { CardLook } from './cardRender'

/** What the editor gives its card embeds (`createCrepe`): the page card's own doors. Absent on the host → no card embeds. */
export interface CardEmbedDoors {
  /** The card's look: its pills, and its images by ITS page's folder (`path`), not the embedding page's. */
  look: (path: string) => CardLook
  /**
   * Edit card (YAZ-5026): the card editor mounted in `root` with `text` (`mountCardEditor`, Done is `done`), and the page
   * card's key row to go under it. Absent: no Edit card. A door, not an import: the card editor's module reaches the
   * page's marks, which reach this host.
   */
  /** `title`: the card's, for Edit card's Title field (YAZ-5164 part 3); `fileCard`: a card file's, its title read only here. */
  edit?: (root: HTMLElement, text: string, title: string, done: () => void, fileCard: boolean) => { editor: CardEditor; keys: HTMLElement }
  /** The editor's one link follower: the name's click and the card's pills. */
  follow?: LinkFollow
  hotkeys?: () => HotkeyOverrides | undefined
  /** A Markdown link's open in the card. Absent → nothing. */
  openHref?: (href: string) => void
  onNotice?: (message: string) => void
  /** The vault's card review (YAZ-5105 round 4): the Reviews strip under a card with reviews. Absent (a hover preview): none. */
  reviews?: import('./cardBlockView').CardReviewDoorApi
  /** "Put back into this page" (YAZ-5037 phase 5): the page's convert door (`CardConvertDoor.putBack`). Absent → not offered. */
  putBack?: (card: { id: string; path: string }, inner: string, nth: number) => void
}

/** What the host gives one box. */
export interface CardEmbedHost {
  /** The embed's target as the text holds it (`GEO-140`, no options). */
  target: string
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
  doors: CardEmbedDoors
  /** Is the page editable now (Edit card, Show as link)? */
  editable: () => boolean
  /** The whole embed selected, as a press on a board's window does. */
  select: () => void
  /** The embed's text replaced by `text` (Show as link), found again in the current doc. */
  replace: (text: string) => void
  /** Where the ⋯ menu opens (the editor's parent). */
  menuParent: () => HTMLElement
  /**
   * Where the embed stands, for "Put back into this page": its text between the brackets and its place among the embeds
   * of that text that stand alone on their line (`embedLine` reads the file the same way). Null when it shares its line
   * (words around it, the first line of a list item, a quote, a table cell): a card block cannot go there.
   */
  place: () => { inner: string; nth: number } | null
}

/** One box. */
export interface CardEmbedHandle {
  /** The box's root, the host's widget holds it. */
  readonly dom: HTMLElement
  /** The index changed: the card found again, the head drawn again, the card read again when its file has a new version. */
  refresh: () => void
  /** The host's selection covers the whole embed. */
  setSelected: (on: boolean) => void
  /** Folded on a bullet, or in a table cell: the head alone. */
  setFolded: (on: boolean) => void
  /** The open card editor (tests): null while the card is not edited. */
  readonly cardEditor: CardEditor | null
  destroy: () => void
}

const byRecords = new WeakMap<readonly IndexRecord[], Map<string, IndexRecord>>()
/** The record at `path` in a snapshot: one map per snapshot, made the first time an embed asks. */
export function recordAt(records: readonly IndexRecord[], path: string): IndexRecord | undefined {
  let map = byRecords.get(records)
  if (map === undefined) byRecords.set(records, (map = new Map(records.map((r) => [r.path, r]))))
  return map.get(path)
}

/**
 * The card an embed (or a link) names (YAZ-5037): a card's ID (`linkCard`, any case), or the link of a card file
 * (`kind: card`), whose one card it is. Null for anything else: a page, a board, a name no file has, a vault with no IDs.
 */
export function embedCard(target: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): CardLink | null {
  const card = linkCard(target, source)
  if (card !== null) return card
  if (!source.ids) return null
  const path = linkPath(target, source, viewOnly)
  const record = path === null ? undefined : recordAt(source.records, path)
  const first = record?.kind === 'card' ? record.cards?.[0] : undefined
  return first === undefined || first.id === null ? null : { id: first.id, path: record!.path, index: 0, title: first.title ?? '', notitle: first.notitle === true }
}

/** The box's module (`cardEmbed.ts`): one load for every page; a load that fails is asked again by the next box. */
let loading: Promise<typeof import('./cardEmbed')> | null = null
export function loadCardEmbed(): Promise<typeof import('./cardEmbed')> {
  loading ??= import('./cardEmbed').catch((err: unknown) => {
    loading = null
    throw err
  })
  return loading
}
