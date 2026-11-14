import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cardLook } from '@client/editor/card/cardLook'
import { CARD_MEDIA, CARD_OPENS } from '@client/editor/card/cardMedia'
import { CARD_LINK_ATTR, renderCard, type CardShow } from '@client/editor/card/cardRender'
import { linkCard, linkPath, type WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
// `cardRender.ts` draws the card but brings no styles (YAZ-5153): the phone loads the Mac's card, table and card-screen
// styles itself, so a table, a pill, a hidden word and a sound look as on the Mac.
import '@client/editor/card/card.css'
import '@client/editor/table/table.css'
import '@client/review/cardScreens.css'
import { makeAssetResolver } from '@shared/assetLookup'
import { vaultMediaPath, vaultMediaUrl, watchMedia, type VaultMedia } from '../media/ui/vaultMedia'

/** Where a tap on a pill goes: a card alone, or a page (4C's read-only views). */
export type CardLinkOpen = { kind: 'card'; path: string; id: string } | { kind: 'page'; path: string; at?: string }

const resolvers = new WeakMap<readonly string[], (target: string, from?: string) => string | null>()
/** The vault path a picture or sound `src` written in `holder` names, by the Mac's asset rule (2B), or null. */
export function mediaPath(files: readonly string[], holder: string, src: string): string | null {
  if (src === '' || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  let resolve = resolvers.get(files)
  if (resolve === undefined) resolvers.set(files, (resolve = makeAssetResolver(files)))
  const fromRoot = src.startsWith('/')
  const target = src
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

/**
 * THE CARD on the phone: the Mac's own drawing (`renderCard`, `cardLook`; decision 3, no second renderer), read only,
 * drawn again when the text or the step changes, never on each render (as the Mac's `CardBody`, which is desktop-only).
 *
 *  - Pictures and sounds: the ONE way of 4C and 3D (`watchMedia`, `media/ui/vaultMedia.ts`). A picture is drawn with
 *    no address and gets its bytes from 3D when it comes near the screen; with no signal, the calm line ("Needs a
 *    connection"), the text shows. A sound plays from the tap on its own button (`play()` in the tap, proof 1D); the
 *    sound stops when the card goes. The path resolves from `holder`, the file that HOLDS the card (2B's asset rule).
 *  - A pill opens its card or its page (`onOpen`). A link to an address opens as the browser opens it.
 *  - A board embed shows its text (the phone draws no board in stage one).
 */
export function PhoneCard({ text, holder, show, links, files, media, retry, onOpen }: { text: string; holder: string; show: CardShow; links: WikilinkResolveSource; files: readonly string[]; media: VaultMedia; retry?: (fn: () => void) => () => void; onOpen: (to: CardLinkOpen) => void }) {
  const box = useRef<HTMLDivElement>(null)
  // The pills follow the index: a new snapshot draws the card again.
  const snapshot = useSyncExternalStore(links.subscribe, () => links.records)
  const { sides, shown } = show

  // One watch for the life of the card: each drawing's new pictures are watched too; the card's sound stops at the end.
  useEffect(() => {
    const el = box.current
    if (el === null) return
    const watch = watchMedia(el, media)
    const off = retry?.(() => watch.retry())
    return () => {
      off?.()
      watch.stop()
    }
  }, [media, holder, text, retry])

  useEffect(() => {
    const el = box.current
    if (el === null) return
    const look = cardLook(links, undefined, {
      root: '',
      pagePath: `/${holder}`,
      src: (_root, _dir, src) => {
        const path = mediaPath(files, holder, src)
        return path === null ? src : vaultMediaUrl(path)
      },
    })
    const drawn = renderCard(text, { sides, shown }, look)
    // A picture has no address until its bytes come; one that is not in the vault is a calm line (as 4C's card).
    for (const img of drawn.querySelectorAll<HTMLImageElement>('img')) {
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
    el.replaceChildren(drawn)
  }, [text, holder, sides, shown, links, snapshot, files])

  const onClick = (event: React.MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null || target.closest(CARD_MEDIA) !== null) return
    const pill = target.closest<HTMLElement>(CARD_OPENS)
    const inner = pill?.getAttribute(CARD_LINK_ATTR)
    if (pill === null || inner === null || inner === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const card = linkCard(inner, links)
    if (card !== null) return onOpen({ kind: 'card', path: card.path, id: card.id })
    const path = linkPath(inner, links, undefined)
    if (path !== null) onOpen({ kind: 'page', path })
  }

  return <div ref={box} className="phone-card__body" onClick={onClick} />
}
