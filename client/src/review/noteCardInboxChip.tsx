/**
 * The card's state chip (YAZ-5018, as Mochi's), first in the Inbox card's head: "New card" with a dashed circle for a
 * card never reviewed; "Due today", or "Due · 3 days ago" for a card past its day, with a clock.
 */
import type { CardRating } from '@shared/cardLine'
import { answerLabel, dayCount, type DueCard } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import { AgainIcon, ClockIcon, EasyIcon, ForgotIcon, HardIcon, NewIcon, RememberedIcon } from './noteCardInboxIcons'

const DAY = 86_400_000

/** The chip's words: whole calendar days late, so a card due last night at 23:00 is "1 day ago" this morning. */
export function noteCardStateText(card: Pick<DueCard, 'isNew' | 'due'>, now: number): string {
  if (card.isNew) return 'New card'
  const late = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(card.due).setHours(0, 0, 0, 0)) / DAY)
  return late <= 0 ? 'Due today' : `Due · ${dayCount(late)} ago`
}

export function NoteCardStateChip({ card, now = Date.now() }: { card: Pick<DueCard, 'isNew' | 'due'>; now?: number }) {
  return (
    <span className="note-card-inbox__state" data-state={card.isNew ? 'new' : 'due'}>
      {card.isNew ? <NewIcon size={12} /> : <ClockIcon size={12} />}
      {noteCardStateText(card, now)}
    </span>
  )
}

/** Each answer button's glyph: ✕ / ✓ with two buttons; ↺ ~ ✓ ⇈ with four (YAZ-5018). */
export function answerIcon(rating: CardRating, buttons: 2 | 4) {
  if (rating === 'again') return buttons === 4 ? <AgainIcon /> : <ForgotIcon />
  if (rating === 'hard') return <HardIcon />
  if (rating === 'easy') return <EasyIcon />
  return <RememberedIcon />
}

/** The glyph of each answer in words (the toast is text): ✕ / ✓, or ↺ ~ ✓ ⇈ with four buttons. */
const ANSWER_MARK: Record<CardRating, [string, string]> = { again: ['✕', '↺'], hard: ['~', '~'], good: ['✓', '✓'], easy: ['✓', '⇈'] }

/**
 * The answer's toast (YAZ-5025), in the button hover's words: "✓ Remembered · back in 9 days", "✕ Forgot · back later
 * today"; four buttons use their own names ("⇈ Easy · back in 20 days").
 */
export function answerToast(rating: CardRating, interval: number, s: ReviewSettings): string {
  const mark = ANSWER_MARK[rating][s.buttons === 4 ? 1 : 0]
  return `${mark} ${answerLabel(rating, s)} · back ${interval === 0 ? 'later today' : `in ${dayCount(interval)}`}`
}
