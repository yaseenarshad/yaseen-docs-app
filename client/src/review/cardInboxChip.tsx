/**
 * The card's state chip (YAZ-5018, as Mochi's), right above the Inbox card (YAZ-5027): "New card" with a dashed circle for a
 * card never reviewed; "Due today", or "Due · 3 days ago" for a card past its day, with a clock.
 */
import type { ReactNode } from 'react'
import type { CardRating } from '@shared/cardLine'
import { answerLabel, dayCount, type DueCard } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import { AgainIcon, ClockIcon, EasyIcon, ForgotIcon, HardIcon, NewIcon, RememberedIcon } from './cardInboxIcons'

const DAY = 86_400_000

/** The chip's words: whole calendar days late, so a card due last night at 23:00 is "1 day ago" this morning. */
export function cardStateText(card: Pick<DueCard, 'isNew' | 'due'>, now: number): string {
  if (card.isNew) return 'New card'
  const late = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(card.due).setHours(0, 0, 0, 0)) / DAY)
  return late <= 0 ? 'Due today' : `Due · ${dayCount(late)} ago`
}

export function CardStateChip({ card, now = Date.now() }: { card: Pick<DueCard, 'isNew' | 'due'>; now?: number }) {
  return (
    <span className="card-inbox__state" data-state={card.isNew ? 'new' : 'due'}>
      {card.isNew ? <NewIcon size={12} /> : <ClockIcon size={12} />}
      {cardStateText(card, now)}
    </span>
  )
}

/**
 * The "Again" label beside the state chip (YAZ-5594 on the phone, YAZ-5626 on the Mac): the card is back because a
 * Forgot (✕) left it in its steps (`repeat` and `forgot`, YAZ-5020); it comes back until you remember it. A new card
 * back for its second ✓ (YAZ-5610) wears none (YAZ-5626, Yaseen). One rule and one text for both.
 */
export const showsAgain = (card: { repeat?: boolean; forgot?: boolean }): boolean => card.repeat === true && card.forgot === true
export const AGAIN_LABEL = 'Again'
export const AGAIN_TITLE = 'You forgot it: it comes back until you remember it'

export function CardAgainChip() {
  return (
    <span className="card-inbox__again" title={AGAIN_TITLE}>
      {AGAIN_LABEL}
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

/** The last answer's line in its parts: "✓", "Remembered", the card's name, "in 9 days". */
export interface AnswerWords {
  mark: string
  label: string
  name: string
  back: string
}

/**
 * The last answer's line (YAZ-5025 round 2), in the button hover's words: "✓ Remembered · DEMO-51 · back in 9 days",
 * "✕ Forgot · DEMO-51 · back later today"; four buttons use their own names ("⇈ Easy · … · back in 20 days"). The card
 * is named by its TITLE alone (YAZ-5030, YAZ-5433: no ID): "✓ Remembered · Spanish verb 3 · back in 9 days"; a long
 * title ends in "…" (`shortTitle`). No title, or a title hidden in review (the caller's `reviewTitleOf`, YAZ-5695): the ID alone.
 */
export function answerWords(rating: CardRating, id: string, interval: number, inSteps: boolean, s: ReviewSettings, title = ''): AnswerWords {
  const mark = ANSWER_MARK[rating][s.buttons === 4 ? 1 : 0]
  // `cardWait`'s words (the hover's): "later today" in the same-day steps, "today", else the days.
  const back = inSteps ? 'later today' : interval === 0 ? 'today' : `in ${dayCount(interval)}`
  // YAZ-5433 (Yaseen: "we can probably just have the title"): the title alone; a card with no title, its ID (its only name).
  const name = title.trim() === '' ? id : shortTitle(title.trim())
  return { mark, label: answerLabel(rating, s), name, back }
}

/** The line as one string: "✓ Remembered · DEMO-51 · back in 9 days". */
export function answerLine(rating: CardRating, id: string, interval: number, inSteps: boolean, s: ReviewSettings, title = ''): string {
  const w = answerWords(rating, id, interval, inSteps, s, title)
  return `${w.mark} ${w.label} · ${w.name} · back ${w.back}`
}

/**
 * The last answer's line on screen, ONE piece for the Mac's Inbox and the phone's Review (YAZ-5693): the mark (its
 * answer's colour, by the line's `data-rating`), the words with the card's name in a part of its own (it gives way with
 * "…" first, so "back in …" stays), then the Undo the screen gives (the Mac's "Undo ⌘Z", the phone's touch-sized one).
 * `base` names the parts: `${base}-mark`, `${base}-text`, `${base}-name`.
 */
export function AnswerLine({ words, base, undo }: { words: AnswerWords; base: string; undo: ReactNode }) {
  return (
    <>
      <span className={`${base}-mark`}>{words.mark}</span>
      <span className={`${base}-text`}>
        {` ${words.label} · `}
        <span className={`${base}-name`}>{words.name}</span>
        {` · back ${words.back}${undo === null ? '' : ' · '}`}
      </span>
      {undo}
    </>
  )
}
