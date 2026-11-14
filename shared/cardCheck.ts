/**
 * Card check (YAZ-5059 decision 9, suggestions 15 and 16; YAZ-5115, YAZ-5116): the sure mistakes in a card's text. Only
 * checks with few false alarms belong here; length is not one (a card is not split because it is long). It reads the
 * card as the Inbox does (`cardText.ts`): `{{a … {{b}}` is one hidden word, and code — a code block, a code span — is
 * never checked. A title in `{{ }}` is legal text (YAZ-5135). Pure: no DOM, no Node.
 */
import { maskCode } from './fences'
import { cardPieces, cardSides, cardTitle } from './cardText'

/** The kinds of fault, in the order a card's faults are listed. */
export const CARD_FAULT_KINDS = ['unclosed', 'empty-hidden', 'nothing-to-recall', 'no-title', 'title-placeholder', 'hidden-subject'] as const

/** One sure mistake in a card. `side` is 0 for the front. */
export interface CardFault {
  kind: (typeof CARD_FAULT_KINDS)[number]
  side: number
  text: string
}

/** What a person reads for each kind (the table of YAZ-5115). */
export const CARD_FAULT_TEXT: Record<CardFault['kind'], string> = {
  unclosed: 'A {{ has no closing }}, so nothing is hidden.',
  'empty-hidden': 'A hidden word is empty.',
  'nothing-to-recall': 'Nothing is hidden, and the card has no back.',
  'no-title': 'The card has no title.',
  'title-placeholder': 'The title is still "Title".',
  'hidden-subject': 'The question hides its own subject.',
}

/** The placeholder title a new card starts with (`/card`, New card). */
const PLACEHOLDER_TITLE = 'Title'

/** A question that hides its own subject: "What does {{NASA}} stand for", "What does {{ephemeral}} mean". Kept narrow. */
const HIDDEN_SUBJECT_RE = /\bwhat[ \t]+does[ \t]+\{\{(?:(?!\}\})[^\n])*\}\}[ \t]+(?:stand[ \t]+for|mean)\b/i

/** Pure: the sure mistakes of a card's text, by kind (`CARD_FAULT_KINDS` order) then side; [] when it has none. */
export function checkCard(text: string): CardFault[] {
  // Code is masked first, length-preserving: a `{{` or a question in code is the code's own text.
  const sides = cardSides(text).map((side) => cardPieces(maskCode(side)))
  const found = new Map<CardFault['kind'], number[]>()
  const add = (kind: CardFault['kind'], side: number): void => {
    const at = found.get(kind) ?? []
    if (!at.includes(side)) found.set(kind, [...at, side])
  }
  sides.forEach((pieces, side) => {
    if (pieces.some((p) => p.kind === 'text' && p.text.includes('{{'))) add('unclosed', side)
    if (pieces.some((p) => p.kind === 'hidden' && p.text.trim() === '')) add('empty-hidden', side)
    const masked = pieces.map((p) => (p.kind === 'hidden' ? `{{${p.text}}}` : p.text)).join('')
    if (HIDDEN_SUBJECT_RE.test(masked)) add('hidden-subject', side)
  })
  if (sides.length === 1 && !sides[0].some((p) => p.kind === 'hidden')) add('nothing-to-recall', 0)
  const title = cardTitle(text)
  if (title === '') add('no-title', 0)
  else if (title === PLACEHOLDER_TITLE) add('title-placeholder', 0)
  return CARD_FAULT_KINDS.flatMap((kind) => (found.get(kind) ?? []).map((side) => ({ kind, side, text: CARD_FAULT_TEXT[kind] })))
}
