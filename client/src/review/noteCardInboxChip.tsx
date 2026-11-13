/**
 * The card's state chip (YAZ-5018, as Mochi's), right above the Inbox card (YAZ-5027): "New card" with a dashed circle for a
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

/** The glyph of each answer in words: ✕ / ✓, or ↺ ~ ✓ ⇈ with four buttons. */
const ANSWER_MARK: Record<CardRating, [string, string]> = { again: ['✕', '↺'], hard: ['~', '~'], good: ['✓', '✓'], easy: ['✓', '⇈'] }

/** The most of a card's title the answer line shows (YAZ-5030): a longer one ends in "…", so "back in …" stays in sight. */
export const ANSWER_TITLE_MAX = 40

/** `title` cut to `max` characters, "…" last when it was longer. */
export const shortTitle = (title: string, max = ANSWER_TITLE_MAX): string => ([...title].length <= max ? title : `${[...title].slice(0, max - 1).join('').trimEnd()}…`)

/**
 * The last answer's line (YAZ-5025 round 2), in the button hover's words: "✓ Remembered · DEMO-51 · back in 9 days",
 * "✕ Forgot · DEMO-51 · back later today"; four buttons use their own names ("⇈ Easy · … · back in 20 days"). The card
 * is named by its TITLE with the ID after it (YAZ-5030): "✓ Remembered · Spanish verb 3 (DEMO-51) · back in 9 days" —
 * also a title hidden in review (the answer is given); a long title ends in "…" (`shortTitle`). No title: the ID alone.
 */
export function answerLine(rating: CardRating, id: string, interval: number, inSteps: boolean, s: ReviewSettings, title = ''): string {
  const mark = ANSWER_MARK[rating][s.buttons === 4 ? 1 : 0]
  // `noteCardWait`'s words (the hover's): "later today" in the same-day steps, "today", else the days.
  const back = inSteps ? 'later today' : interval === 0 ? 'today' : `in ${dayCount(interval)}`
  const name = title.trim() === '' ? id : `${shortTitle(title.trim())} (${id})`
  return `${mark} ${answerLabel(rating, s)} · ${name} · back ${back}`
}
