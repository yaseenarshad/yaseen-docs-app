import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cardLook } from '@client/editor/card/cardLook'
import { CARD_AUDIO_ATTR, CARD_MEDIA, CARD_OPENS, stopCardAudio } from '@client/editor/card/cardMedia'
import { CARD_LINK_ATTR, renderCard, type CardShow } from '@client/editor/card/cardRender'
import { linkCard, linkPath, type WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
// `cardRender.ts` draws the card but brings no styles (YAZ-5153): the phone loads the Mac's card, table and card-screen
// styles itself, so a table, a pill, a hidden word and a sound look as on the Mac.
import '@client/editor/card/card.css'
import '@client/editor/table/table.css'
import '@client/review/cardScreens.css'
import type { CardMedia, CardMediaShow } from './link'
import { mediaWords } from './words'

/** Where a tap on a pill goes: a card alone, or a page (4C's read-only views). */
export type CardLinkOpen = { kind: 'card'; path: string; id: string } | { kind: 'page'; path: string }

/**
 * The URL a picture or a sound has while its bytes are not here yet: a `data:` URL, so nothing is fetched and the page's
 * CSP (decision 8) allows it. The card swaps each one for a calm line before it shows.
 */
const WAIT = 'data:,notecards-media-'
const keyOf = (holder: string, src: string) => `${holder}\n${src}`
const EMPTY: ReadonlyMap<string, CardMediaShow> = new Map()

/**
 * THE CARD on the phone: the Mac's own drawing (`renderCard`, `cardLook`; decision 3, no second renderer), read only,
 * drawn again when the text or the step changes, never on each render (as the Mac's `CardBody`, which is desktop-only).
 *
 *  - Pictures and sounds come from 3D (`media.showLink`) as object URLs, resolved from `holder`, the file that HOLDS the
 *    card. Until a URL is here, and when there is none (no signal, round 12: N3), a calm line stands in its place; the
 *    text shows. A sound plays from the tap on its own button (`play()` inside the tap, proof 1D).
 *  - A pill opens its card or its page (`onOpen`). A link to an address opens as the browser opens it.
 *  - A board embed shows its text (the phone draws no board in stage one).
 */
export function PhoneCard({ text, holder, show, links, media, onOpen }: { text: string; holder: string; show: CardShow; links: WikilinkResolveSource; media: CardMedia | undefined; onOpen: (to: CardLinkOpen) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [shows, setShows] = useState(EMPTY)
  const asked = useRef(new Set<string>())
  // The pills follow the index: a new snapshot draws the card again.
  const snapshot = useSyncExternalStore(links.subscribe, () => links.records)
  const { sides, shown } = show

  useEffect(() => {
    const el = box.current
    if (el === null) return
    const wanted: string[] = []
    const look = cardLook(links, undefined, {
      root: '',
      pagePath: holder,
      src: (_root, _dir, src) => {
        const got = shows.get(keyOf(holder, src))
        if (got?.status === 'ready') return got.url
        wanted.push(src)
        return `${WAIT}${encodeURIComponent(src)}`
      },
    })
    const drawn = renderCard(text, { sides, shown }, look)
    const why = (src: string): string | null => {
      const got = shows.get(keyOf(holder, src))
      return media === undefined ? 'no-media' : got?.status === 'missing' ? got.why : null
    }
    for (const img of drawn.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? ''
      if (src.startsWith(WAIT)) img.replaceWith(mediaLine('picture', why(decodeURIComponent(src.slice(WAIT.length)))))
    }
    for (const player of drawn.querySelectorAll<HTMLElement>(`[${CARD_AUDIO_ATTR}]`)) {
      const src = player.getAttribute(CARD_AUDIO_ATTR) ?? ''
      if (src.startsWith(WAIT)) player.replaceWith(mediaLine('sound', why(decodeURIComponent(src.slice(WAIT.length)))))
    }
    el.replaceChildren(drawn)
    if (media === undefined) return
    for (const src of wanted) {
      const key = keyOf(holder, src)
      if (asked.current.has(key)) continue
      asked.current.add(key)
      void media.showLink(src, holder).then((got) => setShows((m) => new Map(m).set(key, got)))
    }
  }, [text, holder, sides, shown, links, snapshot, shows, media])

  // The card's sound never outlives it: the next card stops it.
  useEffect(() => stopCardAudio, [holder, text])

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

/** The calm line in a picture's or a sound's place. Waiting for its bytes: an empty line of the same height. */
function mediaLine(kind: 'picture' | 'sound', why: string | null): HTMLElement {
  const line = document.createElement('span')
  line.className = 'phone-card__media'
  line.dataset.media = why ?? 'waiting'
  line.textContent = why === null ? '' : mediaWords(kind, why)
  if (why === null) line.setAttribute('aria-busy', 'true')
  return line
}
