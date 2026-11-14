import { CARD_LINK_ATTR } from '@client/editor/card/cardRender'
import { linkPath } from '@client/editor/wikilink/linkResolve'
import { cardInContent } from '@client/review/cardRead'
import type { NavAction } from '../app/nav'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'
import type { FileShow, PageMedia } from './media'
import { cardOf, drawCard, embedName, resolveSourceOf } from './pageLook'

/**
 * What a drawn page or card does once it is on screen (YAZ-5079): its pictures and sounds get their bytes (`fillMedia`),
 * its embedded cards are read and drawn in place (`fillCardEmbeds`, round 15 item 1), and a tap on a link opens what it
 * names (`onPageTap`). Every element here is made by the app; the page's text reaches the screen only through
 * `renderPage` or `renderCard`, which clean it first.
 */

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The calm line for a file the phone cannot show now (N3: "needs a connection"; the text still shows). */
export function missingWords(kind: 'Picture' | 'Sound' | 'File', path: string, show: Extract<FileShow, { status: 'missing' }>): string {
  if (show.why === 'offline') return `${kind} · ${nameOf(path)} · Needs a connection`
  if (show.why === 'gone' || show.why === 'not-in-vault') return `Missing ${kind.toLowerCase()} · ${nameOf(path)}`
  if (show.why === 'slowed') return `${kind} · ${nameOf(path)} · Try again soon`
  return `${kind} · ${nameOf(path)} · Can't show it now`
}

function line(text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'page-media page-media--missing'
  el.textContent = text
  return el
}

/** Each picture and sound of `root` gets its bytes, or a calm line. `live()` false: the page changed; stop. */
export async function fillMedia(root: ParentNode, media: PageMedia, live: () => boolean = () => true): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-vault-src]')) {
    const path = img.dataset.vaultSrc!
    // Asked for once: a second `fillMedia` of the same page passes it by.
    delete img.dataset.vaultSrc
    jobs.push(
      media.show(path).then((show) => {
        if (!live()) return
        if (show.status === 'ready') img.src = show.url
        else img.replaceWith(line(missingWords('Picture', path, show)))
      }),
    )
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-vault-sound]')) {
    const path = box.dataset.vaultSound!
    delete box.dataset.vaultSound
    jobs.push(
      media.show(path).then((show) => {
        if (!live()) return
        if (show.status !== 'ready') return void box.replaceWith(line(missingWords('Sound', path, show)))
        const audio = document.createElement('audio')
        audio.controls = true
        audio.preload = 'none'
        audio.src = show.url
        box.replaceChildren(audio)
      }),
    )
  }
  await Promise.all(jobs)
}

/**
 * Each `![[ID]]` box of `root` with its card, read from the stored file (round 15, item 1): the head "Embedded from
 * "<title>" · ID" opens the card alone; the card is drawn by `renderCard`. No Edit card and no ⋯ in stage one.
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
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'card-embed__from'
    head.textContent = `Embedded from "${embedName(data, card)}" · ${card.id}`
    head.addEventListener('click', () => go({ type: 'open', route: { kind: 'card', path: card.path, id: card.id } }))
    const body = document.createElement('div')
    body.className = 'card__body card-embed__body'
    box.className = 'card card-embed'
    box.replaceChildren(head, body)
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
        if (read.off) {
          const state = document.createElement('span')
          state.className = 'card-embed__state'
          state.textContent = 'Archived'
          head.append(' ', state)
        }
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

/** Types the iPhone's own viewer shows (round 12, items 11 and 12). Any other: "Can't open on the phone yet". */
const VIEWABLE = /^(application\/pdf|image\/|audio\/|video\/|text\/)/

/**
 * Opens a vault file in the iPhone's own viewer (a PDF: round 12, item 11), or says why it cannot (item 12). Returns
 * the words to show, or null when the viewer opened.
 */
export async function openFile(media: PageMedia, path: string, open: (url: string) => boolean = (url) => window.open(url, '_blank') !== null): Promise<string | null> {
  const show = await media.show(path)
  if (show.status !== 'ready') return missingWords('File', path, show)
  if (!VIEWABLE.test(show.type) || !open(show.url)) return `${nameOf(path)} · Can't open on the phone yet`
  return null
}
