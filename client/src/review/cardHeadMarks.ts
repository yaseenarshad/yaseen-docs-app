/**
 * ONE HEAD FOR EVERY CARD (YAZ-5915 Q1, YAZ-5913 Q2): the quiet marks after a card's ID, in this order —
 *  1. its review state: "Archived", else (Review on) "New", "Due today", "Due in 3 days", "Due 2 days ago";
 *  2. (Review on) its title rule: "Title after first click", or with no choice of its own "Title always (default)";
 *  3. "To fix".
 * A card page (`CardFileView.tsx`), a card in a page (`cardBlockView.ts`), an embed (`cardEmbed.ts`) and the phone
 * (`mobile/src/media/ui/cardHead.ts`) all draw these marks from here, so the four heads say the same words. No React,
 * no HTML: the words and their classes (`.card__state`, grey and quiet, `card.css`).
 */
import type { CardReview } from '@shared/cardLine'
import { cardTitleMark, type CardTitleAt } from '@shared/cardTitleAt'
import type { ReviewSettings } from '@shared/reviews'
import { cardFacts, cardNextReview } from './cardWords'

/** What the head knows of a card: its card line's marks and reviews. */
export interface CardHeadCard {
  off?: boolean
  fix?: boolean
  notitle?: boolean
  titleAt?: CardTitleAt | null
  reviews?: readonly CardReview[]
}

export interface CardHeadMark {
  kind: 'state' | 'title' | 'fix'
  text: string
  className: string
}

/** The review state in words (the card page's, YAZ-5032): "New", "Due today", "Due in 3 days", "Due 2 days ago". */
export function cardReviewState(reviews: readonly CardReview[], settings: ReviewSettings, now = Date.now()): string {
  const facts = cardFacts(reviews, settings, now)
  if (facts === null) return 'New'
  return `Due ${cardNextReview(facts.due, facts.comesBack, now).when}`
}

/** The head's marks for `card`; `settings`: the vault's review settings (Review off or unknown: only Archived and To fix). */
export function cardHeadMarks(card: CardHeadCard, settings: ReviewSettings | undefined, now = Date.now()): CardHeadMark[] {
  const review = settings?.enabled === true ? settings : undefined
  const out: CardHeadMark[] = []
  if (card.off === true) out.push({ kind: 'state', text: 'Archived', className: 'card__state card__review-state' })
  else if (review !== undefined) out.push({ kind: 'state', text: cardReviewState(card.reviews ?? [], review, now), className: 'card__state card__review-state' })
  if (review !== undefined) {
    const choice = card.notitle === true ? 'never' : (card.titleAt ?? 'default')
    out.push({ kind: 'title', text: cardTitleMark(choice, review.titleAt), className: `card__state card__title-mark${choice === 'never' ? ' card__notitle' : ''}` })
  }
  if (card.fix === true) out.push({ kind: 'fix', text: 'To fix', className: 'card__state card__fix' })
  return out
}

/** The marks as elements (the Mac's DOM heads and the phone's): one `span` each, every word by `textContent`. */
export function cardHeadMarkEls(card: CardHeadCard, settings: ReviewSettings | undefined, now = Date.now()): HTMLElement[] {
  return cardHeadMarks(card, settings, now).map((mark) => {
    const el = document.createElement('span')
    el.className = mark.className
    el.textContent = mark.text
    return el
  })
}

/** Ask every card head on the screen to draw its marks again (the vault's review settings changed). */
export const CARD_HEADS_REDRAW = 'mdapp:card-heads-redraw'
export const redrawCardHeads = (): void => void window.dispatchEvent(new Event(CARD_HEADS_REDRAW))
