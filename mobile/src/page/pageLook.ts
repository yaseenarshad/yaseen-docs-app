import { isAudioRef, isBoardRef } from '@client/editor/card/cardMedia'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { cardLinkTitle, createWikilinkResolveSource, linkCard, linkPageName, linkPath, linkSplit, linksAsShown, missingId, type MutableWikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { pathInfo, pillParts, pillsNeedInfo } from '@client/editor/wikilink/linkPillLook'
import { makeAssetResolver } from '@shared/assetLookup'
import { NO_LINK_PILLS } from '@shared/linkPills'
import type { CardLink } from '@shared/cardLinks'
import { fileKind } from '@shared/fileKind'
import { makeResolver } from '@shared/linkResolver'
import { vaultPageId } from '@shared/pageId'
import { isDiagramPicture } from '../drawing/drawingBox'
import { drawLocalCard } from '../media/ui/cardDraw'
import { folderLinkOf } from './folderLink'
import type { VaultData } from '../search/vaultData'
import type { EmbedShow, LinkShow, PageLook } from './pageRender'
// The Mac's card look (sides, hidden words, tables in a card), then the phone's reader.
import '@client/editor/card/card.css'
import '../media/mediaLine.css'
import './reader.css'

/**
 * THE VAULT'S LOOK-UPS FOR A PAGE OR A CARD ON THE PHONE (YAZ-5079): the Mac's own rules, over the phone's index.
 *  - A `[[link]]` resolves with the Mac's resolver (`makeResolver`, `shared/linkResolver.ts`) in the Mac's resolve source
 *    (`createWikilinkResolveSource`, `linkResolve.ts`): a page's ID, path, title, file name, alias; a card's ID
 *    (`linkCard`); and it shows the Mac's text (`linksAsShown`: a title for an ID, the words after `|`).
 *  - A picture, a sound or a file a link names resolves with the Mac's asset rule over the vault's file list
 *    (`makeAssetResolver`, `shared/assetLookup.ts`, 2B): the page's folder first, then the root, then the shortest path.
 *  - A card is drawn by the Mac's `renderCard` with the Mac's `cardLook` (its pills and links as the page's).
 *
 * Paths are the phone's: in the repo, with no leading `/` (`folder/name.md`).
 */

/** The resolve source of one snapshot of the vault's data, kept while the data stays (one per `version`). */
// The reader draws cards with local media only (YAZ-5209), also when it is the first to draw one (`main.tsx` sets it too).
onlyLocalMedia()

const sources = new WeakMap<VaultData, MutableWikilinkResolveSource>()
export function resolveSourceOf(data: VaultData): MutableWikilinkResolveSource {
  let source = sources.get(data)
  if (source === undefined) {
    const made = createWikilinkResolveSource()
    const files = data.records.map((record) => ({ record }))
    const resolve = makeResolver(files, undefined, { letters: data.letters, folders: data.folders })
    made.update((target) => resolve(target)?.record.path ?? null, data.records, data.folders, data.ids, data.letters)
    source = made
    sources.set(data, source)
  }
  return source
}

const assetResolvers = new WeakMap<VaultData, (target: string, from?: string) => string | null>()
function assetsOf(data: VaultData) {
  let resolve = assetResolvers.get(data)
  if (resolve === undefined) {
    resolve = makeAssetResolver(data.files)
    assetResolvers.set(data, resolve)
  }
  return resolve
}

/** The folder of a vault path ('' at the root). */
export const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** A Markdown address as the Mac's `imageSrc` reads it: each part decoded once; a leading `/` is the vault's root. */
function srcTarget(src: string): { target: string; fromRoot: boolean } {
  const fromRoot = src.startsWith('/')
  const parts = src
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  return { target: parts.join('/'), fromRoot }
}

/** Where a picture, a sound or a file named in `holder` lands in the vault, or null. */
function assetPath(data: VaultData, holder: string, src: string): string | null {
  if (src === '' || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  const { target, fromRoot } = srcTarget(src)
  return assetsOf(data)(target, fromRoot ? undefined : folderOf(holder))
}

/** A card's text drawn read only: the phone's ONE card drawing (`drawLocalCard`, shared with Review). */
export function drawCard(data: VaultData, holder: string, text: string): HTMLElement {
  return drawLocalCard(text, {}, { links: resolveSourceOf(data), files: data.files, holder })
}

/**
 * What a card's head says for a card with no title (YAZ-5308: the Mac's `UNTITLED_CARD`, `cardTitle.ts`). A link, a
 * search row, an embed's "Embedded from" and a VoiceOver label say the card's ID instead.
 */
export const UNTITLED_CARD = 'Untitled card'

/** The title an embedded card's head names (the Mac's `embedName`): a card file's card title (its ID with none), else the title of its page. */
export function embedName(data: VaultData, card: CardLink): string {
  const record = data.byPath[card.path]
  if (record?.kind === 'card') return card.title === '' ? card.id : card.title
  return record?.title ?? card.path
}

/** The card an `![[ID]]` or `[[ID]]` names, or null. */
export const cardOf = (data: VaultData, inner: string): CardLink | null => linkCard(inner, resolveSourceOf(data))

/** The look-ups of a page at `holder` (its path), for `renderPage`. */
export function pageLook(data: VaultData, holder: string): PageLook {
  const source = resolveSourceOf(data)
  const asset = (src: string) => assetPath(data, holder, src)
  return {
    link(inner): LinkShow {
      const card = inner.includes('|') ? null : linkCard(inner, source)
      if (card !== null) return { label: cardLinkTitle(card), open: { kind: 'card', path: card.path, id: card.id } }
      const label = linksAsShown(`[[${inner}]]`, source)
      // YAZ-5455: a `#heading` goes with the page (`[[Page#Goals]]`); alone (`[[#Goals]]`) it is this page's heading.
      const heading = linkSplit(inner, source).hash.replace(/^#/, '')
      const page = linkPageName(inner, source)
      if (page === '' && heading !== '') return { label, open: { kind: 'heading', heading } }
      const path = linkPath(inner, source, undefined)
      // The vault's pill format (YAZ-5455): the ends the Mac's page draws, with no file icon (the phone has none).
      const ends = (resolved: string | null) =>
        source.pills === NO_LINK_PILLS ? undefined : pillParts(source.pills, { info: resolved !== null && pillsNeedInfo(source.pills) ? pathInfo(data.records, data.folders).get(resolved) : undefined, otherVault: null }, source.vault, false)
      if (path !== null) return { label, open: { kind: 'page', path, ...(heading !== '' && { heading }) }, ends: ends(path) }
      // YAZ-5550: no page holds the name, but a folder does (the Mac's rule, `folderLink.ts`): its folder's page.
      const folder = page === '' ? null : folderLinkOf(data)(page)
      if (folder !== null) return { label, open: { kind: 'folder', path: folder }, ends: ends(null) }
      // A link to a file of the vault that is no page (a PDF, a picture): by the asset rule.
      const file = page === '' ? null : assetsOf(data)(page, folderOf(holder))
      if (file !== null) return { label, open: fileKind(file) === 'markdown' ? { kind: 'page', path: file, ...(heading !== '' && { heading }) } : { kind: 'file', path: file } }
      const id = missingId(inner, source)
      return { label, open: null, missing: id === undefined ? `Missing page · ${page}` : `Missing page · ${id}`, ends: ends(null) }
    },
    embed(inner): EmbedShow {
      const page = linkPageName(inner, source)
      const card = linkCard(inner, source)
      if (card !== null) return { kind: 'card', id: card.id }
      const file = assetsOf(data)(page.split('|')[0].trim(), folderOf(holder))
      // YAZ-5440: a drawing names its file, which the reader draws; a `.drawio.svg` is a picture already.
      if (isBoardRef(inner)) return { kind: 'drawing', name: page.slice(page.lastIndexOf('/') + 1), path: file }
      if (file !== null && isDiagramPicture(file)) return { kind: 'picture', path: file, alt: page.slice(page.lastIndexOf('/') + 1) }
      if (file !== null && isAudioRef(file)) return { kind: 'sound', path: file }
      if (file !== null && fileKind(file) === 'image') return { kind: 'picture', path: file, alt: page.slice(page.lastIndexOf('/') + 1) }
      if (file !== null && fileKind(file) !== 'markdown') return { kind: 'file', path: file, name: file.slice(file.lastIndexOf('/') + 1) }
      // An ID of this vault that names nothing: "Missing card · ID", as the Mac's embed box says it.
      const id = data.ids ? vaultPageId(page, data.letters) : undefined
      if (id !== undefined && source.resolve?.(page) == null) return { kind: 'missing-card', id }
      return { kind: 'text', text: `![[${inner}]]` }
    },
    asset,
    card: (text) => drawCard(data, holder, text),
  }
}
