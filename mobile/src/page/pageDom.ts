import { CARD_LINK_ATTR } from '@client/editor/card/cardRender'
import { linkPath, linkSplit } from '@client/editor/wikilink/linkResolve'
import { cardInContent, type CardAtPage } from '@client/review/cardRead'
import { openLink, type LinkDoor, type LinkTarget } from './openLink'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'
import { headMarks, titleBand, type CardMarks } from '../media/ui/cardHead'
import { cardOf, drawCard, embedName, resolveSourceOf } from './pageLook'
import { boardKindOf } from '../drawing/boardFiles'

/**
 * What a drawn page or card does once it is on screen: its pictures and sounds get their bytes
 * (`watchMedia`, `media/ui/vaultMedia.ts`), its embedded cards are read and drawn in place (`fillCardEmbeds`, round 15 item 1), and a tap on a link opens what it
 * names (`onPageTap`). Every element here is made by the app; the page's text reaches the screen only through
 * `renderPage` or `renderCard`, which clean it first.
 */

/**
 * Each `![[ID]]` box of `root` with its card, read from the stored file (round 15, item 1), drawn as the Mac's embed
 * (`cardEmbed.ts`): the head `↗ Embedded from "<name>" · ID` (· "Archived"), whose first part opens the card
 * alone; under it the card's title band (off its card line; none for a card with no title); then the card, drawn by
 * `renderCard`. No Edit card and no ⋯ in stage one.
 */
/** Each filled embed's card as its file reads it (its strip's reviews and properties, `cardStrip/pageStrips.tsx`). */
export const embedReads = new WeakMap<HTMLElement, CardAtPage>()

export async function fillCardEmbeds(root: ParentNode, data: VaultData, store: VaultStore, door: LinkDoor, live: () => boolean = () => true): Promise<void> {
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
    from.addEventListener('click', () => openLink(door, { kind: 'card', path: card.path, id: card.id }))
    const head = document.createElement('div')
    head.className = 'card__head card-embed__head'
    const dot = document.createElement('span')
    dot.className = 'card-embed__dot'
    dot.textContent = '·'
    // The marks (YAZ-5915) from the index until the file is read, then off the card line.
    const drawHead = (rec: Omit<CardMarks, 'id' | 'title'> | undefined) => head.replaceChildren(from, dot, ...headMarks({ ...rec, id: card.id, title: '' }, data.review))
    drawHead(data.byPath[card.path]?.cards?.[card.index])
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
        embedReads.set(box, read)
        drawHead(read)
        box.classList.toggle('card--off', read.off)
        body.replaceChildren(drawCard(data, card.path, read.text))
      }),
    )
  }
  await Promise.all(jobs)
}

/**
 * What a tap on the page asks for: open a page (at a heading) or a card; a file; land on a heading of this
 * page; `none`: a link to a missing page, which does nothing (it shows plain and dim). null: not the app's (a web link).
 */
export type Tap = { kind: 'go'; target: LinkTarget } | { kind: 'file'; path: string } | { kind: 'heading'; heading: string } | { kind: 'none' } | null

/** What a tap at `target` (in a drawn page or card) opens. A web link: null (the browser opens Safari). */
export function tapOf(target: EventTarget | null, data: VaultData): Tap {
  const el = target instanceof Element ? target.closest('a, [data-card-link]') : null
  if (el === null) return null
  if (el instanceof HTMLAnchorElement && el.target === '_blank') return null
  const open = (el as HTMLElement).dataset.open
  const path = (el as HTMLElement).dataset.path
  const heading = (el as HTMLElement).dataset.heading
  if (open === 'heading') return heading === undefined ? { kind: 'none' } : { kind: 'heading', heading }
  if (open === 'page' && path !== undefined) return { kind: 'go', target: { kind: 'page', path, ...(heading !== undefined && { heading }) } }
  if (open === 'card' && path !== undefined) return { kind: 'go', target: { kind: 'card', path, id: (el as HTMLElement).dataset.card ?? '' } }
  // A link to a folder opens its folder's page, through the one door.
  if (open === 'folder' && path !== undefined) return { kind: 'go', target: { kind: 'folder', path } }
  // A link to a drawing file opens the drawing (its own view, or a sheet), through the one door.
  if (open === 'file' && path !== undefined) return boardKindOf(path) !== null ? { kind: 'go', target: { kind: 'drawing', path } } : { kind: 'file', path }
  if (el.classList.contains('wikilink--unresolved') || el.classList.contains('page-pill--missing')) return { kind: 'none' }
  // A pill in a card (`renderCard`): its link, as the card's page reads it.
  const inner = el.getAttribute(CARD_LINK_ATTR)
  if (inner !== null) {
    const card = cardOf(data, inner)
    if (card !== null) return { kind: 'go', target: { kind: 'card', path: card.path, id: card.id } }
    const source = resolveSourceOf(data)
    const part = linkSplit(inner, source).hash.replace(/^#/, '')
    const page = linkPath(inner, source, undefined)
    if (page !== null) return { kind: 'go', target: { kind: 'page', path: page, ...(part !== '' && { heading: part }) } }
    return { kind: 'none' }
  }
  return null
}
