/**
 * The card pill (YAZ-5030): the DOM a link to a card draws, in the page (`wikilinkPlugin.ts`) and in a card's own
 * drawing (`renderCard`, `cardRender.ts`). Its own file, with no editor import (YAZ-5067, decision 3 of YAZ-5055): the
 * card drawing and the review screen load without the editor's link plugin, so the phone app can draw a card.
 * `WIKILINK_CLASS` lives here for the same reason; `wikilinkPlugin.ts` gives it out as before. The pill's look is
 * `wikilink.css`, imported here too, so a card drawn with no editor still has it.
 */
import './wikilink.css'

export const WIKILINK_CLASS = 'wikilink'

/** The class of a card link's pill (YAZ-5030): its card icon, and the ID after the title. */
export const WIKILINK_CARD_CLASS = 'wikilink--card'
export const WIKILINK_CARD_ID_CLASS = 'wikilink__card-id'

/**
 * The DOM a card link draws (YAZ-5030): the card's title and, small and grey after it, its ID, in ONE pill with the card
 * icon on its `::before` (`wikilink.css`). The look of an ID link's title (`titleSpan`, `wikilinkPlugin.ts`), so a card
 * pill sits among them.
 */
export function cardPillSpan(title: string, id: string): HTMLElement {
  const span = document.createElement('span')
  span.className = `${WIKILINK_CLASS} ${WIKILINK_CARD_CLASS}`
  span.spellcheck = false
  const idSpan = document.createElement('span')
  idSpan.className = WIKILINK_CARD_ID_CLASS
  idSpan.textContent = id
  span.append(title, idSpan)
  return span
}
