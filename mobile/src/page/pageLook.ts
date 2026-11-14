import { cardLook } from '@client/editor/card/cardLook'
import { isAudioRef, isBoardRef } from '@client/editor/card/cardMedia'
import { renderCard } from '@client/editor/card/cardRender'
import { cardLinkTitle, createWikilinkResolveSource, linkCard, linkPageName, linkPath, linksAsShown, missingId, type WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { makeAssetResolver } from '@shared/assetLookup'
import type { CardLink } from '@shared/cardLinks'
import { fileKind } from '@shared/fileKind'
import { makeResolver } from '@shared/linkResolver'
import { vaultPageId } from '@shared/pageId'
import type { VaultData } from '../search/vaultData'
import type { EmbedShow, LinkShow, PageLook } from './pageRender'
// The Mac's card look (sides, hidden words, tables in a card), then the phone's reader.
import '@client/editor/card/card.css'
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
const sources = new WeakMap<VaultData, WikilinkResolveSource>()
export function resolveSourceOf(data: VaultData): WikilinkResolveSource {
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
export function assetPath(data: VaultData, holder: string, src: string): string | null {
  if (src === '' || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  const { target, fromRoot } = srcTarget(src)
  return assetsOf(data)(target, fromRoot ? undefined : folderOf(holder))
}

/**
 * The address a card's picture or sound gets from `cardLook`: a `data:` text that names the vault file, so the browser
 * fetches nothing (the page's CSP allows `data:`). The page view puts the stored bytes in its place (`fillMedia`).
 */
export const VAULT_MEDIA_PREFIX = 'data:text/plain,vault-media:'
export const vaultMediaPath = (src: string): string | null => (src.startsWith(VAULT_MEDIA_PREFIX) ? decodeURIComponent(src.slice(VAULT_MEDIA_PREFIX.length)) : null)

/** A card's text drawn read only, as the Mac draws it (`renderCard`), its pictures marked for `fillMedia`. */
export function drawCard(data: VaultData, holder: string, text: string): HTMLElement {
  const source = resolveSourceOf(data)
  const look = cardLook(source, undefined, {
    // `cardLook` reads the holder's folder from an absolute path under `root`: the phone's root is '' and its paths have no `/`.
    root: '',
    pagePath: `/${holder}`,
    src: (_root, dir, src) => {
      const path = assetPath(data, dir === '' ? 'x' : `${dir}/x`, src)
      return path === null ? src : `${VAULT_MEDIA_PREFIX}${encodeURIComponent(path)}`
    },
  })
  const el = renderCard(text, {}, look)
  // A picture of the card: no address at all until its bytes come (`fillMedia`); one not in the vault: the Mac's
  // stock `<img>` of the text as written would fetch from this site, so it is a calm line instead.
  for (const img of el.querySelectorAll<HTMLImageElement>('img')) {
    const src = img.getAttribute('src') ?? ''
    const path = vaultMediaPath(src)
    if (path !== null) {
      img.removeAttribute('src')
      img.dataset.vaultSrc = path
    } else if (!/^(data|blob):/i.test(src)) {
      const line = document.createElement('span')
      line.className = 'page-media page-media--missing'
      line.textContent = `Missing picture · ${src}`
      img.replaceWith(line)
    }
  }
  return el
}

/** The title an embedded card's head names (the Mac's `embedName`): a card file's card title, else the title of its page. */
export function embedName(data: VaultData, card: CardLink): string {
  const record = data.byPath[card.path]
  if (record?.kind === 'card') return card.title === '' ? 'Untitled card' : card.title
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
      const path = linkPath(inner, source, undefined)
      if (path !== null) return { label, open: { kind: 'page', path } }
      const page = linkPageName(inner, source)
      // A link to a file of the vault that is no page (a PDF, a picture): by the asset rule.
      const file = page === '' ? null : assetsOf(data)(page, folderOf(holder))
      if (file !== null) return { label, open: fileKind(file) === 'markdown' ? { kind: 'page', path: file } : { kind: 'file', path: file } }
      const id = missingId(inner, source)
      return { label, open: null, missing: id === undefined ? `Missing page · ${page}` : `Missing page · ${id}` }
    },
    embed(inner): EmbedShow {
      const page = linkPageName(inner, source)
      const card = linkCard(inner, source)
      if (card !== null) return { kind: 'card', id: card.id }
      if (isBoardRef(inner)) return { kind: 'drawing', name: page.slice(page.lastIndexOf('/') + 1) }
      const file = assetsOf(data)(page.split('|')[0].trim(), folderOf(holder))
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
