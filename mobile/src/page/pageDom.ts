import { CARD_LINK_ATTR } from '@client/editor/card/cardRender'
import { linkPath } from '@client/editor/wikilink/linkResolve'
import { cardInContent } from '@client/review/cardRead'
import type { NavAction } from '../app/nav'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'
import { headMarks, titleBand } from '../media/ui/cardHead'
import { cardOf, drawCard, embedName, resolveSourceOf } from './pageLook'

/**
 * What a drawn page or card does once it is on screen (YAZ-5079): its pictures and sounds get their bytes
 * (`watchMedia`, `media/ui/vaultMedia.ts`), its embedded cards are read and drawn in place (`fillCardEmbeds`, round 15 item 1), and a tap on a link opens what it
 * names (`onPageTap`). Every element here is made by the app; the page's text reaches the screen only through
 * `renderPage` or `renderCard`, which clean it first.
 */

/**
 * Each `![[ID]]` box of `root` with its card, read from the stored file (round 15, item 1), drawn as the Mac's embed
 * (`cardEmbed.ts`, YAZ-5437): the head `↗ Embedded from "<name>" · ID` (· "Archived"), whose first part opens the card
 * alone; under it the card's title band (off its card line; none for a card with no title); then the card, drawn by
 * `renderCard`. No Edit card and no ⋯ in stage one.
 */
export async function fillCardEmbeds(root: ParentNode, data: VaultData, store: VaultStore, go: (action: NavAction) => void, live: () => boolean = () => true): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const box of root.querySelectorAll<HTMLElement>('[data-card-embed]')) {
    const card = cardOf(data, box.dataset.cardEmbed!)
    if (card === null) {
      box.className = 'card-embed card-embed--missing'
      box.textContent = `Missing card · ${box.dataset.cardEmbed}`
      continue
    }
    const from = document.createElement('button')
    from.type = 'button'
    from.className = 'card-embed__from'
    from.setAttribute('aria-label', `Embedded from "${embedName(data, card)}"`)
    const arrow = document.createElement('span')
    arrow.className = 'card-embed__arrow'
    arrow.setAttribute('aria-hidden', 'true')
    arrow.textContent = '↗'
    from.append(arrow, `Embedded from "${embedName(data, card)}"`)
    from.addEventListener('click', () => go({ type: 'open', route: { kind: 'card', path: card.path, id: card.id } }))
    const head = document.createElement('div')
    head.className = 'card__head card-embed__head'
    const dot = document.createElement('span')
    dot.className = 'card-embed__dot'
    dot.textContent = '·'
    const drawHead = (off: boolean) => head.replaceChildren(from, dot, ...headMarks({ id: card.id, title: '', off }))
    drawHead(data.byPath[card.path]?.cards?.[card.index]?.off === true)
    const body = document.createElement('div')
    body.className = 'card__body card-embed__body'
    // From the index until the file is read (the Mac's `drawTitle`), then off the card line.
    let band = titleBand(card.title)
    box.className = 'card card-embed'
    box.replaceChildren(...[head, band, body].filter((el): el is HTMLElement => el !== null))
    jobs.push(
      store.read(data.vault, card.path).then((file) => {
        if (!live()) return
        const text = file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
        const read = text === null ? null : cardInContent(card.path, text, card.id, card.index)
        if (read === null) {
          box.className = 'card-embed card-embed--missing'
          box.textContent = `Missing card · ${card.id}`
          return
        }
        // The file holds the card's title now (the index may be a pass behind).
        if (read.title !== card.title) {
          const next = titleBand(read.title)
          if (band !== null) band.replaceWith(...(next === null ? [] : [next]))
          else if (next !== null) head.after(next)
          band = next
        }
        drawHead(read.off)
        box.classList.toggle('card--off', read.off)
        body.replaceChildren(drawCard(data, card.path, read.text))
      }),
    )
  }
  await Promise.all(jobs)
}

/** What a tap on the page asks for. */
export type Tap = { kind: 'go'; action: NavAction } | { kind: 'file'; path: string } | { kind: 'missing'; text: string } | null

/** What a tap at `target` (in a drawn page or card) opens. A web link: null (the browser opens Safari). */
export function tapOf(target: EventTarget | null, data: VaultData): Tap {
  const el = target instanceof Element ? target.closest('a, [data-card-link]') : null
  if (el === null) return null
  if (el instanceof HTMLAnchorElement && el.target === '_blank') return null
  const open = (el as HTMLElement).dataset.open
  const path = (el as HTMLElement).dataset.path
  if (open === 'page' && path !== undefined) return { kind: 'go', action: { type: 'open', route: { kind: 'page', path } } }
  if (open === 'card' && path !== undefined) return { kind: 'go', action: { type: 'open', route: { kind: 'card', path, id: (el as HTMLElement).dataset.card ?? '' } } }
  if (open === 'file' && path !== undefined) return { kind: 'file', path }
  if (el.classList.contains('wikilink--unresolved')) return { kind: 'missing', text: `${el.getAttribute('aria-label') ?? el.textContent ?? ''}. It is not in the vault.` }
  // A pill in a card (`renderCard`): its link, as the card's page reads it.
  const inner = el.getAttribute(CARD_LINK_ATTR)
  if (inner !== null) {
    const card = cardOf(data, inner)
    if (card !== null) return { kind: 'go', action: { type: 'open', route: { kind: 'card', path: card.path, id: card.id } } }
    const page = linkPath(inner, resolveSourceOf(data), undefined)
    if (page !== null) return { kind: 'go', action: { type: 'open', route: { kind: 'page', path: page } } }
    return { kind: 'missing', text: `${el.textContent ?? inner}. It is not in the vault.` }
  }
  return null
}
