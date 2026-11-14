/**
 * How a `[[link]]` resolves (Links A, GRO-2190; YAZ-5030 for cards), with no editor (YAZ-5153, 2A1 of YAZ-5055): the
 * resolve source an app hands its editors and screens, the page-name strip, a card link's card, the path a link opens,
 * whether it is found, and the text it shows. Pure: no ProseMirror, no Milkdown. The editor's link plugin
 * (`wikilinkPlugin.ts`) draws with these, and gives out the same names; the review screen and the phone read them here.
 */
import { makeCardResolver, type CardLink, type CardResolve } from '@shared/cardLinks'
import { isBoardTarget } from '@shared/embedOptions'
import { splitLink, type LinkParts } from '@shared/linkParts'
import { WIKILINK_RE } from '@shared/linkRewrite'
import { isPageId, isNumberId, vaultPageId } from '@shared/pageId'
import { NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import type { IndexRecord } from '@shared/types'
import { fileLabel, pageLabel, pathTitles, type PathTitles } from '../../lib/pathTitles'
import { boardEmbedName, boardEmbedTarget, isIdTarget } from '../drawing/boardEmbedText'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/**
 * How a resolved link looks (YAZ-3609 D13): the attributes that draw the icon its file has in the sidebar on
 * the `::before` of the span that shows the link's text (`fileIconDecoration`). Absent → no icon.
 */
export interface LinkLook {
  icon: (path: string, folder: boolean) => Record<string, string>
}

/** Link target → resolved absolute path — a page's file, else a folder's directory (YAZ-2290 D10) — or null when nothing matches. */
export type ResolveLink = (target: string) => string | null

/**
 * The names of the window's vaults whose ID letters are `letters` (in capitals), read live (YAZ-3905 S23): an
 * unresolved `[[INL-4]]` names the vault it came from. Absent, or [] → no vault.
 */
export type VaultsOfLetters = (letters: string) => readonly string[]

/** How the latest resolver reaches the plugin; see `createWikilinkResolveSource`. */
export interface WikilinkResolveSource {
  /** null until the vault index first loads — every link renders as resolved meanwhile. */
  readonly resolve: ResolveLink | null
  /**
   * The index snapshot `resolve` was built from — `[]` until the first index lands. The
   * decorations never read it; the backlinks section does (Links D, GRO-2193), and pairing it
   * with the resolver in ONE object is what guarantees the two can never come from different
   * snapshots.
   */
  readonly records: readonly IndexRecord[]
  /** The same snapshot's folder settings records (YAZ-2290 D8) — never among `records`. */
  readonly folders: readonly IndexRecord[]
  /** Does the snapshot's vault give its pages IDs (YAZ-2523 🔒 V5)? false until the first index lands. */
  readonly ids: boolean
  /**
   * The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5), the current ones first; none where
   * it does not use IDs. `vaultPageId` reads a link target with them: other `LETTERS-NUMBER` text is a name (R6).
   */
  readonly letters: readonly string[]
  /**
   * The vault's link pills look (YAZ-4924, `.yaseendocs/link-pills.json`): what text a pill gains at its ends
   * (`linkPillLook.ts` `pillParts`). `NO_LINK_PILLS` until the vault's file is read, and for a vault that changed nothing.
   * The look's colours and shape are CSS variables on the vault's layers, not read here.
   */
  readonly pills: LinkPills
  /** What the app calls the vault (the sidebar's name), for a look that names it on every pill; null while unknown. */
  readonly vault: string | null
  /** Wakes subscribed editors (decoration recompute) whenever `resolve` is swapped, or the look changes. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkResolveSource extends WikilinkResolveSource {
  /**
   * Swap in a fresh resolver + its snapshot (index refetch) and notify every subscriber.
   * `records` omitted = no snapshot in play (decoration-only mounts): backlinks have nothing
   * to list, which is exactly right — the resolver alone cannot say who links where.
   * `null` forgets the vault (a change of root): no index has landed for the new one yet.
   */
  update(resolve: ResolveLink | null, records?: readonly IndexRecord[], folders?: readonly IndexRecord[], ids?: boolean, letters?: readonly string[]): void
  /** The vault's look and name (YAZ-4924), and every subscriber is woken: each editor draws its pills again. Nothing happens when both are as they were. */
  setLook(pills: LinkPills, vault: string | null): void
}

const NO_RECORDS: readonly IndexRecord[] = []
const NO_LETTERS: readonly string[] = []

export function createWikilinkResolveSource(): MutableWikilinkResolveSource {
  let current: ResolveLink | null = null
  let snapshot: readonly IndexRecord[] = NO_RECORDS
  let settings: readonly IndexRecord[] = NO_RECORDS
  let usesIds = false
  let idLetters = NO_LETTERS
  let look: LinkPills = NO_LINK_PILLS
  let vaultName: string | null = null
  const listeners = new Set<() => void>()
  return {
    get pills() {
      return look
    },
    get vault() {
      return vaultName
    },
    setLook(pills, vault) {
      if (pills === look && vault === vaultName) return
      look = pills
      vaultName = vault
      listeners.forEach((l) => l())
    },
    get resolve() {
      return current
    },
    get records() {
      return snapshot
    },
    get folders() {
      return settings
    },
    get ids() {
      return usesIds
    },
    get letters() {
      return idLetters
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(resolve, records = NO_RECORDS, folders = NO_RECORDS, ids = false, letters = NO_LETTERS) {
      current = resolve
      snapshot = records
      settings = folders
      usesIds = ids
      idLetters = letters
      listeners.forEach((l) => l())
    },
  }
}

// The wiki link pattern is the shared rewrite's (YAZ-2677): the editor and the rewrite read one shape.
export { WIKILINK_RE }

/**
 * The parts of a raw `[[inner]]` with the vault's pages known (`source`, YAZ-4935 round 2): words that only LOOK like
 * an ID (`[[Covid pages|COVID-19]]`) leave the left side the page when it resolves; the right side is the page only
 * when the left does not. No `source`, or no index yet: the shape decides (`splitLink`).
 */
export function linkSplit(inner: string, source?: { resolve: ResolveLink | null }): LinkParts {
  const resolve = source?.resolve ?? null
  return splitLink(inner, resolve === null ? undefined : (page) => resolve(page) !== null)
}

/**
 * The page-name half of a raw `[[inner]]` text: the `|words` (on either side, `splitLink`, YAZ-4935)
 * and `#heading` / `#^block` stripped, trimmed. '' for the same-file `[[#h]]` form. The ONE strip
 * shared by the decorations below, click navigation and create-on-click (`wikilinkClick.ts` /
 * `createFromLink.ts`, Links C). With `source`, the left side wins when it resolves (`linkSplit`).
 */
export function linkPageName(inner: string, source?: { resolve: ResolveLink | null }): string {
  return linkSplit(inner, source).page
}

/** One card resolver per index snapshot and letters (YAZ-5030): every editor's decorations read the same one. */
const cardResolvers = new WeakMap<readonly IndexRecord[], { letters: readonly string[]; resolve: CardResolve }>()

/** The card resolver of `source`'s snapshot, or null: a vault with no IDs (it has no cards, D8), or no index yet. */
export function cardResolverOf(source: Pick<WikilinkResolveSource, 'records' | 'ids' | 'letters' | 'resolve'>): CardResolve | null {
  if (!source.ids || source.resolve === null) return null
  const held = cardResolvers.get(source.records)
  if (held !== undefined && held.letters === source.letters) return held.resolve
  const resolve = makeCardResolver(source.records, source.letters)
  cardResolvers.set(source.records, { letters: source.letters, resolve })
  return resolve
}

/**
 * The PAGE CARD a raw `[[inner]]` names (YAZ-5030, D7): its page part is a card's ID (`[[WIKI-512]]`, any case, the
 * vault's letters of before too), or null — a page, a name, a vault with no IDs, and any link before the index loads.
 */
export function linkCard(inner: string, source: WikilinkResolveSource): CardLink | null {
  const resolve = cardResolverOf(source)
  if (resolve === null) return null
  const page = linkPageName(inner, source)
  return page === '' ? null : resolve(page)
}

/** What a card link shows for its card (YAZ-5030): the title, or "Card" for a card with no text yet. */
export const cardLinkTitle = (card: CardLink): string => (card.title === '' ? 'Card' : card.title)

/**
 * The title an id link shows (YAZ-2293): `target` is a page's id and `resolve` finds the page →
 * its title, by `titles` (YAZ-2420 🔒 D14). undefined for a name, for an id no page has, and before
 * the index has loaded — all of which show the target as written. The ONE answer shared by the
 * decorations, the backlinks snippets and the right-click menu (`wikilinkMenu.ts`).
 *
 * The target is tested by its SHAPE, old or number (YAZ-2677): the vault is not known here. So a
 * name that reads like a number ID and finds a page by that name (R6, S26) shows that page's title.
 */
export function idLinkTitle(target: string, resolve: ResolveLink | null, titles: PathTitles): string | undefined {
  const path = resolve !== null && isPageId(target) ? resolve(target) : null
  return path === null ? undefined : pageLabel(path, false, titles)
}

/** An unpiped ID link that shows its page's title (YAZ-3744 D1). */
export function showsTitle(inner: string, source: WikilinkResolveSource): boolean {
  return !inner.includes('|') && idLinkTitle(linkPageName(inner), source.resolve, pathTitles(source.records, source.folders)) !== undefined
}

/**
 * A `[[link]]` that collapses to a pill, and so is one unit (YAZ-3935, point 3 of YAZ-3879: D1 extended to every
 * link): the caret steps over it (`idLinkCaret.ts`), and only "Edit link" opens its raw text. A link with nothing to
 * show (`[[Page|]]`, `[[#]]`) stays raw text (FN12). A title only adds text, so the check needs no index: one string scan.
 */
export const isLinkUnit = (inner: string): boolean => linkDisplayText(inner) !== ''

/**
 * The ID of THIS vault that a link's page part is, as the app writes it (YAZ-2677 R2), or undefined: a vault with no IDs
 * (YAZ-2523 🔒 V5), a name, and other `LETTERS-NUMBER` text (R6). `[[yas-466]]` is "YAS-466".
 */
export function linkPageId(page: string, { ids, letters }: Pick<WikilinkResolveSource, 'ids' | 'letters'>): string | undefined {
  return ids ? vaultPageId(page, letters) : undefined
}

/** "AR v2 plan (YAS-466)" (YAZ-3744 S8): the one text of an ID link's name and ID, for a plain-text copy and "Copy name and ID". */
export const nameAndId = (title: string, id: string): string => `${title} (${id})`

/**
 * The ID of THIS vault a link names whose page is gone (YAZ-3905 S10), as the app writes it, or undefined: a found
 * link, a name, a vault that does not use IDs, and any link before the index loads (nothing is known yet).
 */
export function missingId(inner: string, source: WikilinkResolveSource): string | undefined {
  if (!source.ids || source.resolve === null) return undefined
  const page = linkPageName(inner, source)
  const id = vaultPageId(page, source.letters)
  return id !== undefined && source.resolve(page) === null ? id : undefined
}

/**
 * An unresolved `[[LETTERS-NUMBER]]` whose letters are another vault's of the window (YAZ-3905 S23): the ID as
 * written, and the one vault it names, or null when two or more have those letters ("another vault"). Null for
 * the rest: this vault's letters win (then it is this vault's ID), a found link, and before the index loads.
 */
export function otherVaultId(inner: string, source: WikilinkResolveSource, vaultsOf: VaultsOfLetters | undefined): { id: string; vault: string | null } | null {
  const page = linkPageName(inner, source)
  if (vaultsOf === undefined || source.resolve === null || !isNumberId(page) || vaultPageId(page, source.letters) !== undefined || source.resolve(page) !== null) return null
  const names = vaultsOf(page.slice(0, page.indexOf('-')).toUpperCase())
  return names.length === 0 ? null : { id: page, vault: names.length === 1 ? names[0]! : null }
}

/**
 * The hidden ends of a link's page part (YAZ-3778 D2, D3): the folders before its name, and an extension the
 * sidebar hides (`fileLabel`: a page's, a drawing's, a diagram's). `[0, 0]` when nothing would be left.
 */
export function pageTrim(page: string): [lead: number, trail: number] {
  const lead = page.lastIndexOf('/') + 1
  const name = page.slice(lead)
  const bare = fileLabel(name)
  return bare.trim() === '' ? [0, 0] : [lead, name.length - bare.length]
}

/**
 * The DISPLAY text the collapsed decorations show for a raw `[[inner]]` match: the words on the
 * other side of the `|` when piped (`splitLink`, YAZ-4935: `[[WIKI-1|words]]` and `[[words|WIKI-1]]`
 * both show "words"), else the non-empty `#`-split parts joined with the ` > ` separator
 * the CSS draws between segments — the page part replaced by `titleOf`'s answer when it has one
 * (an id link's title, `idLinkTitle`), else, when `named` says the page is found, by its name
 * (`pageTrim`, YAZ-3778 D2, D3; a dead link keeps its text, S12). '' means NOTHING would be
 * visible (`[[Page|]]`, `[[|]]`, `[[#]]`) — such a match stays raw (FN12, GRO-2197; see
 * `decorate`). Exported for the backlinks snippets (FN9, GRO-2197), which must read exactly as
 * the editor renders: one mapping, never a second regex.
 */
export function linkDisplayText(inner: string, titleOf?: (target: string) => string | undefined, named?: (page: string) => boolean, source?: { resolve: ResolveLink | null }): string {
  const { words } = linkSplit(inner, source)
  if (words !== null) return words
  const parts = inner.split('#')
  const page = parts[0]
  const [lead, trail] = named?.(page.trim()) === true ? pageTrim(page) : [0, 0]
  parts[0] = titleOf?.(page.trim()) ?? page.slice(lead, page.length - trail)
  return parts.filter((part) => part.length > 0).join(' > ')
}

/**
 * `text` with each `[[link]]` as the page shows it (YAZ-3744 D6): a crumb, a tab's label, a TOC row, a plain-text
 * copy. A board embed (`![[x.drawio|640x360 …]]`, YAZ-4827 item 16) is its name, as its window's name pill shows it; other
 * embeds and links with nothing to show stay as written. `withId` adds an ID link's ID after its title
 * (YAZ-3744 S8): "AR v2 plan (YAS-466)", for a copy that leaves the app.
 */
export function linksAsShown(text: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, withId = false): string {
  if (!text.includes('[[')) return text
  const titles = pathTitles(source.records, source.folders)
  const cards = cardResolverOf(source)
  const titleOf = (target: string) => {
    // A card's ID shows the card's title (YAZ-5030), with its ID for a copy that leaves the app.
    const card = cards?.(target) ?? null
    if (card !== null) return withId ? nameAndId(cardLinkTitle(card), card.id) : cardLinkTitle(card)
    const title = idLinkTitle(target, source.resolve, titles)
    const id = withId ? linkPageId(target, source) : undefined
    return title === undefined || id === undefined ? title : nameAndId(title, id)
  }
  // An id embed (YAZ-4920) is a board when the id resolves to one; it copies as the board's name.
  const isBoard = (target: string) => {
    const path = linkPath(target, source, viewOnly)
    return path !== null && isBoardTarget(path)
  }
  return text.replace(WIKILINK_RE, (raw, bang: string, inner: string) => {
    if (bang !== '!') return linkDisplayText(inner, titleOf, () => linkIsResolved(inner, source, viewOnly), source) || raw
    if (boardEmbedTarget(inner, isBoard) === null) return raw
    const page = splitLink(inner).page
    return boardEmbedName(isIdTarget(page) ? linkPath(inner, source, viewOnly) ?? inner : inner)
  })
}

/** The file or folder a `[[link]]` opens, or null: unresolved, a heading of a view-only file, or no index yet. The link menu's place rows (YAZ-3740). */
export function linkPath(inner: string, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined): string | null {
  const view = viewOnly === undefined ? null : viewOnlyLinkTarget(inner)
  return view !== null ? (view.hasSubtarget ? null : viewOnly?.resolve?.(view.page) ?? null) : source.resolve?.(linkPageName(inner, source)) ?? null
}

/** Whether a link counts as found: what it opens is there, or nothing is known yet (no index, `[[#heading]]`). The rule `linkDisplayText`'s `named` takes. */
export function linkIsResolved(inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): boolean {
  const viewSource = viewOnly
  const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
  if (viewTarget !== null && viewSource !== undefined) {
    if (viewTarget.hasSubtarget) return false
    return viewSource.resolve === null || viewSource.resolve(viewTarget.page) !== null
  }
  const target = linkPageName(inner, source)
  return source.resolve === null || target === '' || source.resolve(target) !== null
}
