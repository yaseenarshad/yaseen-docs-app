/**
 * THE TITLE BAND (YAZ-5308 A3, Yaseen: "Yes, this is approved"): a card's title sits in a shaded band under the card's
 * top bar, bold, and a long title wraps. ONE look everywhere a card shows (`.card-band`, `card.css`): a card in a page
 * (`cardTitle.ts`), an embed, Edit card (`cardEditor.ts`), Explore's card, the Inbox and its Preview (`CardBand`,
 * `review/cardParts.tsx`). Only Edit card adds the small "TITLE" label. A card file's tab has its big page title, so
 * its card has no band.
 *
 * No React here: Edit card's Title field builds its band without loading the title component.
 */

/** What a card with no title says in Edit card's Title field, in grey. */
export const UNTITLED_CARD = 'Untitled card'

/** The band's small label, in Edit card only (drawn in capitals). */
export const CARD_BAND_LABEL = 'Title'

/** The title band around `content`; `label`: with the small "TITLE" label (Edit card). */
export function cardBand(content: HTMLElement, label = false): HTMLElement {
  const band = document.createElement('div')
  band.className = 'card-band'
  if (label) {
    const word = document.createElement('span')
    word.className = 'card-band__label'
    word.textContent = CARD_BAND_LABEL
    band.append(word)
  }
  band.append(content)
  return band
}
