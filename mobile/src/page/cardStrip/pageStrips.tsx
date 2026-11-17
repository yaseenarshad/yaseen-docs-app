import { createRoot, type Root } from 'react-dom/client'
import { cardInContent, type CardAtPage } from '@client/review/cardRead'
import type { VaultData } from '../../search/vaultData'
import type { LinkDoor } from '../openLink'
import { embedReads } from '../pageDom'
import { CardStrip } from './CardStrip'

/**
 * THE STRIP ON A PAGE'S CARDS: the Mac puts its one strip under every card in a page and every card embed
 * (`cardBlockView.ts`, `cardEmbed.ts`: "Reviews" and "Properties", closed until asked for), so the phone does too. The
 * page is drawn without React (`renderPage`), so each card gets a small React root of its own after its text, in a
 * `display: contents` host (`.card__reviews`), as the Mac's `reviewsStrip.ts` mounts it. This file is its own lazy
 * chunk: a page with no card, or Review off, never loads it.
 *
 * Returns the unmount of every root it made.
 */
export function mountPageStrips(root: ParentNode, data: VaultData, door: LinkDoor, page: { path: string; text: string }): () => void {
  const roots: Root[] = []
  const mount = (box: HTMLElement, card: CardAtPage) => {
    const body = box.querySelector(':scope > .card__body')
    if (body === null) return
    const host = document.createElement('div')
    host.className = 'card__reviews'
    // A tap in the strip is the strip's: never a link tap of the page around it.
    host.addEventListener('click', (e) => e.stopPropagation())
    body.after(host)
    const r = createRoot(host)
    r.render(<CardStrip reviews={card.reviews} settings={data.review} properties={card.properties ?? {}} data={data} door={door} />)
    roots.push(r)
  }
  root.querySelectorAll<HTMLElement>('.card.page-card').forEach((box, i) => {
    const card = cardInContent(page.path, page.text, box.dataset.cardId ?? null, i)
    if (card !== null) mount(box, card)
  })
  for (const box of root.querySelectorAll<HTMLElement>('.card.card-embed')) {
    const card = embedReads.get(box)
    if (card !== undefined) mount(box, card)
  }
  // Later, never inside React's own commit (an effect's cleanup): React warns of a root unmounted while it renders.
  return () => void setTimeout(() => roots.forEach((r) => r.unmount()))
}
