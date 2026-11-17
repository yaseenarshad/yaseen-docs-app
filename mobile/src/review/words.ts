import type { CardRating } from '@shared/cardLine'
import { answerLabel } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { CardOp } from '../answers/ops'
import { lostRows } from '../status/dot'

/**
 * The words of the Review tab that the Mac's shared files do not hold (the Mac's are in `cardWords.ts`,
 * `cardInboxChip.tsx` and `cardFilters.tsx`, and the phone uses those). The mockup (version 9) is the spec.
 */

/** The hint line: "Tap anywhere · 3 left" while parts hide, "Did you remember it?" once all show. */
export const hintText = (left: number): string => (left > 0 ? `Tap anywhere · ${left} left` : 'Did you remember it?')

/** How long "↶ Undo" stays in the hint line after an answer or an action (round 5). It stays in ⋯. */
export const UNDO_SHOWN_MS = 4000

/** Round 12, item 9: the amber line. "1 answer could not be saved". */
export const lostTitle = (n: number): string => `${n} answer${n === 1 ? '' : 's'} could not be saved`

/** What a lost action was, in the ONE word table of the dot and the Review tab (`status/dot.ts`). */
export function lostAction(op: CardOp, _s?: ReviewSettings): string {
  return lostRows([{ seq: 0, op, path: '', title: '', lostAt: 0 }])[0].answer
}

/** Round 15, item 3: a card file that is not valid (no card, two or more, text outside the card). */
export const NEEDS_FIX = 'This card file needs a fix on the Mac.'
