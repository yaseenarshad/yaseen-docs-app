/**
 * A page card's ⋯ (YAZ-5504): at the RIGHT of the card's head (its ID and marks, over its title band; YAZ-5437), it
 * opens the card actions for THAT card (`pageCardMenu.tsx`). 44 pt to tap, quiet: a grey ⋯ drawn by CSS, so the head's
 * words (and find in page) stay the card's own. No React: the page is drawn with the DOM (`pageRender.ts`).
 */
export const CARD_MORE_ATTR = 'data-card-more'

export function cardMoreButton(id: string, title: string): HTMLElement {
  const box = document.createElement('span')
  box.className = 'card__more-box'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'card__more'
  button.setAttribute(CARD_MORE_ATTR, id)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-label', `Card actions: ${title.trim() === '' ? id : title}`)
  box.append(button)
  return box
}
