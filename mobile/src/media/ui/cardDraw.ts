import { cardLook } from '@client/editor/card/cardLook'
import { CARD_AUDIO_ATTR } from '@client/editor/card/cardMedia'
import { CARD_SRC_ATTR, renderCard, type CardShow } from '@client/editor/card/cardRender'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { urlOf } from '@client/editor/card/localOnly'
import type { WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { makeAssetResolver } from '@shared/assetLookup'
import { vaultMediaPath, vaultMediaUrl } from './vaultMedia'

/**
 * A CARD ON THE PHONE (YAZ-5242): the ONE drawing of a card's text for every phone screen: Review (`PhoneCard`), the card
 * view, a page's own card and an embedded card (`drawCard`). Before, Review drew with its own copy of this code, which
 * gave a source that is not a vault file back AS IT WAS, so the browser fetched it. Now:
 *  - The text goes through the phone's one allow list (`renderCard` with `onlyLocalMedia()`: `localOnly.ts`).
 *  - A picture's or a sound's source becomes a vault file (`mediaPath`, the Mac's asset rule) or a calm line. A source that
 *    is not a vault file NEVER becomes an address: the app's own bytes (`urlOf` says `own`) are the only exception.
 *  - The pictures and sounds then get their bytes from 3D's media (`watchMedia`) as they come near the screen.
 */
onlyLocalMedia()

/** The address `cardLook` gives a source that is no vault file: a mark (a `#…` reference), never fetched. */
const MISSING_PREFIX = '#vault-missing:'

const resolvers = new WeakMap<readonly string[], (target: string, from?: string) => string | null>()

/** The vault path a picture or sound `src` written in `holder` names, by the Mac's asset rule (2B), or null. */
export function mediaPath(files: readonly string[], holder: string, src: string): string | null {
  // Only a reference relative to the page names a vault file (`urlOf`: as the browser reads it).
  if (urlOf(src).kind !== 'path' || src.trim().startsWith('#')) return null
  let resolve = resolvers.get(files)
  if (resolve === undefined) resolvers.set(files, (resolve = makeAssetResolver(files)))
  const clean = src.replace(/[\t\n\r]/g, '').trim()
  const fromRoot = clean.startsWith('/')
  const target = clean
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    .join('/')
  return resolve(target, fromRoot ? undefined : holder.slice(0, Math.max(0, holder.lastIndexOf('/'))))
}

const nameOf = (src: string) => {
  const bare = src.split(/[?#]/)[0]
  return bare.slice(bare.lastIndexOf('/') + 1) || src
}

function calm(text: string): HTMLElement {
  const line = document.createElement('span')
  line.className = 'page-media page-media--missing'
  line.textContent = text
  return line
}

/** `text` drawn read only, as the Mac draws a card (`renderCard`, `cardLook`), with local media only. */
export function drawLocalCard(text: string, show: CardShow, place: { links: WikilinkResolveSource; files: readonly string[]; holder: string }): HTMLElement {
  const { links, files, holder } = place
  const look = cardLook(links, undefined, {
    // `cardLook` reads the holder's folder from an absolute path under `root`: the phone's root is '' and its paths have no `/`.
    root: '',
    pagePath: `/${holder}`,
    src: (_root, _dir, src) => {
      if (urlOf(src).kind === 'own') return src
      const path = mediaPath(files, holder, src)
      return path === null ? `${MISSING_PREFIX}${encodeURIComponent(src)}` : vaultMediaUrl(path)
    },
  })
  const el = renderCard(text, show, look)
  for (const img of el.querySelectorAll<HTMLImageElement>('img')) {
    const mark = img.getAttribute(CARD_SRC_ATTR)
    img.removeAttribute(CARD_SRC_ATTR)
    if (mark === null) {
      // No mark: an address that the allow list kept, so the app's own bytes; anything else goes.
      if (urlOf(img.getAttribute('src') ?? '').kind !== 'own') img.replaceWith(calm(`Missing picture · ${img.alt || 'picture'}`))
      continue
    }
    const path = vaultMediaPath(mark)
    if (path !== null) img.dataset.vaultSrc = path
    else img.replaceWith(calm(`Missing picture · ${nameOf(mark.startsWith(MISSING_PREFIX) ? decodeURIComponent(mark.slice(MISSING_PREFIX.length)) : mark)}`))
  }
  // A sound's player plays its address at the first tap: only a vault file (its bytes come from 3D) or the app's own bytes.
  for (const player of el.querySelectorAll<HTMLElement>(`.card__audio[${CARD_AUDIO_ATTR}]`)) {
    const url = player.getAttribute(CARD_AUDIO_ATTR) ?? ''
    if (vaultMediaPath(url) !== null || urlOf(url).kind === 'own') continue
    const written = url.startsWith(MISSING_PREFIX) ? decodeURIComponent(url.slice(MISSING_PREFIX.length)) : url
    player.replaceWith(calm(`Missing sound · ${nameOf(written)}`))
  }
  // A link opens only the web (Safari), mail, or a part of the card; any other address is text (YAZ-5243).
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const { kind, href } = urlOf(a.getAttribute('href') ?? '')
    if (kind === 'web') {
      a.setAttribute('href', href)
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    } else if (kind !== 'mail' && !(kind === 'path' && a.getAttribute('href')!.trim().startsWith('#'))) a.removeAttribute('href')
  }
  return el
}
