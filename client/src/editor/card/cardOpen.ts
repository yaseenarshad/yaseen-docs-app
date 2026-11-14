/**
 * The doors to ONE card from anywhere in the window (YAZ-4962 D13; YAZ-5030 card links):
 *
 *  - THE CARD WINDOW: `CARD_OPEN` (`mdapp:card-open`, detail `CardOpenRequest`), ONE bubbling DOM event;
 *    App listens on the document and opens the Explore card layer. A page's card sends it from its editor (⋯ › Open card,
 *    ⌘↵); a card link's click sends it from where it was clicked (`openCardWindow`).
 *  - LANDING ON A CARD in a page that opens (⌘-click on a card link: its page in a tab, scrolled to the card):
 *    `landOnCard` asks it before the page opens; the page's card of that ID takes it as its view is made
 *    (`takeCardLanding`, `cardBlockView.ts`) and scrolls itself into view once it shows (a background tab: when it comes
 *    to the front). One card takes it, once; an ask no card takes in a few minutes is dropped.
 *
 * No React, no editor state: the editor's link follower, the card screens and the card view all reach it.
 */

import type { CardReview } from '@shared/cardLine'

/** The open hook (D13): sent from an editor's `.ProseMirror` or a card screen, it bubbles. App listens and opens the card window. */
export const CARD_OPEN = 'mdapp:card-open'
export interface CardOpenRequest {
  /** The page's absolute path, or null in a preview that does not know it. */
  path: string | null
  /** The card's ID, or null before it has one. */
  cardId: string | null
  /** The card's place among the page's cards (`pageCards` order, 0 first): finds a card with no ID yet. */
  index: number
}

/** The card window for the card `id` at `index` of `path` (YAZ-5030: a card link's click), sent from `from` (the document by default). */
export function openCardWindow(path: string, id: string, index: number, from: EventTarget = document): void {
  const detail: CardOpenRequest = { path, cardId: id, index }
  from.dispatchEvent(new CustomEvent<CardOpenRequest>(CARD_OPEN, { bubbles: true, detail }))
}

/**
 * PREVIEW A CARD (YAZ-5152): `CARD_PREVIEW` (`mdapp:card-preview`, detail `CardPreviewRequest`), ONE bubbling DOM event
 * from wherever the card shows — a page's card (⋯ › Preview, P, Edit card's Preview), a card file's tab, the card window,
 * an embed. App listens on the document and shows the card as the Inbox shows it (`CardPreview`). It carries the text
 * on show, so Edit card's Preview shows what is typed, saved or not.
 */
export const CARD_PREVIEW = 'mdapp:card-preview'
export interface CardPreviewRequest {
  /** The card's file: its images and links resolve against it. */
  path: string
  /** The card's ID, or null before it has one. */
  id: string | null
  /** The card's text, its title line included. */
  text: string
  /** "Title on the front: Hide" (YAZ-5030). */
  notitle: boolean
  /** Its reviews, for the Reviews strip on the last side. */
  reviews: readonly CardReview[]
}

/** Shows `card` as the Inbox shows it, sent from `from`. */
export function previewCard(from: EventTarget, card: CardPreviewRequest): void {
  from.dispatchEvent(new CustomEvent<CardPreviewRequest>(CARD_PREVIEW, { bubbles: true, detail: card }))
}

/** How long an ask to land waits for its card's view: a page opened in a background tab may be made only when it shows. */
const LANDING_MS = 5 * 60 * 1000
const landings = new Map<string, number>()
const landingKey = (path: string, id: string): string => `${path}\n${id.toLowerCase()}`

/** The next view of card `id` of `path` scrolls itself into view once it shows (a card link's ⌘-click, YAZ-5030). */
export function landOnCard(path: string, id: string, now = Date.now()): void {
  for (const [key, at] of landings) if (now - at > LANDING_MS) landings.delete(key)
  landings.set(landingKey(path, id), now)
}

/** Is a landing asked for card `id` of `path`? Taken: the next view asks in vain. */
export function takeCardLanding(path: string | null, id: string | null, now = Date.now()): boolean {
  if (path === null || id === null || landings.size === 0) return false
  const key = landingKey(path, id)
  const at = landings.get(key)
  if (at === undefined) return false
  landings.delete(key)
  return now - at <= LANDING_MS
}

/**
 * Scrolls `el` to the middle of its scroller once it shows: at once when it does, else when it first gets a size (its
 * tab comes to the front). A card that never shows gives up after the landing's wait.
 */
export function scrollIntoViewWhenShown(el: HTMLElement): void {
  const land = () => el.scrollIntoView({ block: 'center' })
  const shows = () => el.isConnected && el.getClientRects().length > 0
  if (typeof ResizeObserver === 'undefined') {
    requestAnimationFrame(() => shows() && land())
    return
  }
  const observer = new ResizeObserver(() => {
    if (!shows()) return
    observer.disconnect()
    clearTimeout(timer)
    // A frame later: the page's own scroll on show (its tab's place) comes first.
    requestAnimationFrame(land)
  })
  const timer = setTimeout(() => observer.disconnect(), LANDING_MS)
  observer.observe(el)
}
