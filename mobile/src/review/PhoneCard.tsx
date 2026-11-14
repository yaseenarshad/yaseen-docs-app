import { useEffect, useRef, useSyncExternalStore } from 'react'
import { CARD_MEDIA, CARD_OPENS } from '@client/editor/card/cardMedia'
import { CARD_LINK_ATTR, type CardShow } from '@client/editor/card/cardRender'
import { linkCard, linkPath, type WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
// `cardRender.ts` draws the card but brings no styles (YAZ-5153): the phone loads the Mac's card, table and card-screen
// styles itself, so a table, a pill, a hidden word and a sound look as on the Mac.
import '@client/editor/card/card.css'
import '@client/editor/table/table.css'
import '@client/review/cardScreens.css'
import { drawLocalCard, mediaPath } from '../media/ui/cardDraw'
import { guardLink } from '../media/ui/safeLinks'
import { watchMedia, type VaultMedia } from '../media/ui/vaultMedia'

/** Where a tap on a pill goes: a card alone, or a page (4C's read-only views). */
export type CardLinkOpen = { kind: 'card'; path: string; id: string } | { kind: 'page'; path: string; at?: string }

// The asset rule moved to the ONE card drawing of the phone (YAZ-5242); the name stays here too.
export { mediaPath }

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
    // The phone's ONE card drawing (YAZ-5242): the same as the card view's and the page's, local media only.
    const drawn = drawLocalCard(text, { sides, shown }, { links, files, holder })
    el.replaceChildren(drawn)
  }, [text, holder, sides, shown, links, snapshot, files])

  const onClick = (event: React.MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null || target.closest(CARD_MEDIA) !== null) return
    // A link in the card's text: the web opens Safari, the app's window stays (YAZ-5243).
    if (target.closest('a') !== null && guardLink(event)) return void event.stopPropagation()
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
