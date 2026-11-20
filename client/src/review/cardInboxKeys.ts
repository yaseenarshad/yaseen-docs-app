/**
 * The Inbox's keys (YAZ-4962, D18; YAZ-5996, D7), in ONE place: the handler (`CardInbox.tsx`) and the hint row read
 * this list. The answer keys read `shared/keys/review.ts` with the user's `settings.hotkeys` overrides (two-button
 * defaults: Remembered = 1, Forgot = 2; four-button defaults: Again = 1, Hard = 2, Good = 3, Easy = 4); the rest
 * stay built in.
 */
import type { CardRating } from '@shared/cardLine'
import { fromKeyEvent, sameKey, toDisplay, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'
import { keyRow, keysOf } from '@shared/keys'

/** What a key press is in the Inbox, or null when it is not one of its keys. */
export type CardInboxKey =
  | { kind: 'step' }
  | { kind: 'answer'; rating: CardRating }
  | { kind: 'undo' }
  | { kind: 'open' }
  | { kind: 'tab' }
  | { kind: 'edit' }
  | { kind: 'close' }
  | { kind: 'move'; delta: -1 | 1 }
  | { kind: 'play' }
  | { kind: 'focus' }

const TWO_BUTTON_ROWS: Partial<Record<CardRating, string>> = {
  good: 'review.remembered',
  again: 'review.forgot',
}
const FOUR_BUTTON_ROWS: Record<CardRating, string> = {
  again: 'review.again',
  hard: 'review.hard',
  good: 'review.good',
  easy: 'review.easy',
}

function reviewAnswerRowId(rating: CardRating, buttons: 2 | 4): string | null {
  return (buttons === 2 ? TWO_BUTTON_ROWS[rating] : FOUR_BUTTON_ROWS[rating]) ?? null
}

/** The active accelerator(s) for each answer rating in `buttons` mode (2 or 4). */
export function reviewAnswerKeys(buttons: 2 | 4, overrides?: HotkeyOverrides): Array<{ rating: CardRating; keys: readonly string[] }> {
  const ratings: readonly CardRating[] = buttons === 2 ? ['good', 'again'] : ['again', 'hard', 'good', 'easy']
  return ratings.map((rating) => {
    const id = reviewAnswerRowId(rating, buttons)
    const row = id === null ? undefined : keyRow(id)
    return { rating, keys: row === undefined ? [] : keysOf(row, overrides) }
  })
}

/** The answer rating matched by a key press in `buttons` mode, or null. */
export function matchReviewAnswerKey(event: KeyPress, buttons: 2 | 4, overrides?: HotkeyOverrides): CardRating | null {
  const pressed = fromKeyEvent(event)
  if (pressed === null) return null
  for (const { rating, keys } of reviewAnswerKeys(buttons, overrides)) {
    if (keys.some((k) => sameKey(k, pressed))) return rating
  }
  return null
}

/** The live key badge for an answer button (`toDisplay`, or `''` when cleared). */
export function reviewAnswerKeyLabel(rating: CardRating, buttons: 2 | 4, overrides?: HotkeyOverrides): string {
  const id = reviewAnswerRowId(rating, buttons)
  const row = id === null ? undefined : keyRow(id)
  const key = row === undefined ? undefined : keysOf(row, overrides)[0]
  return key === undefined ? '' : toDisplay(key)
}

/** The key's meaning: Esc, answer keys (by Settings › Hotkeys › Review), Space, ⌘Z, O, ⌘↵, E, ← →, P, F. ⌃ stands for ⌘ off a Mac. */
export function cardInboxKey(event: KeyPress, buttons: 2 | 4 = 2, overrides?: HotkeyOverrides): CardInboxKey | null {
  const mod = event.metaKey || event.ctrlKey
  if (!mod && !event.altKey && !event.shiftKey && event.key === 'Escape') return { kind: 'close' }
  const rating = matchReviewAnswerKey(event, buttons, overrides)
  if (rating !== null) return { kind: 'answer', rating }
  if (event.altKey) return null
  if (mod) {
    if (event.shiftKey) return null
    if (event.key.toLowerCase() === 'z') return { kind: 'undo' }
    if (event.key === 'Enter') return { kind: 'tab' }
    return null
  }
  if (event.shiftKey) return null
  if (event.key === ' ') return { kind: 'step' }
  if (event.key === 'o' || event.key === 'O') return { kind: 'open' }
  if (event.key === 'e' || event.key === 'E') return { kind: 'edit' }
  if (event.key === 'p' || event.key === 'P') return { kind: 'play' }
  if (event.key === 'f' || event.key === 'F') return { kind: 'focus' }
  if (event.key === 'ArrowLeft') return { kind: 'move', delta: -1 }
  if (event.key === 'ArrowRight') return { kind: 'move', delta: 1 }
  return null
}

/** What the hint row knows of the moment: a key shows only while it does something (silence is the default). */
export interface CardInboxMoment {
  /** A card shows (not the done screen). */
  card: boolean
  /** The card is a card FILE (YAZ-5037): O opens its tab. */
  cardFile?: boolean
  /** Space has no more to show (the answer buttons show from the start, YAZ-5010). */
  answering: boolean
  canUndo: boolean
  /** ← or → has a card to go to (YAZ-5004). */
  moves?: boolean
  /** A side that shows has a sound (YAZ-5014): P plays or stops it. */
  audio?: boolean
  /** The next Space shows the next SIDE, not a hidden word (YAZ-5048): the hint says "Next side". */
  nextSide?: boolean
  /** The line above the row shows its own Undo (the last answer, an add, Archive card): YAZ-5694. */
  lineUndo?: boolean
}

/**
 * The hint row (D18): each key once, quiet, in the order a review uses them, and only while it does something. The
 * answer digits are on the buttons, so the row does not say them again. No Esc (YAZ-5011): the Inbox is a tab, and
 * closes as one (its ✕, ⌘W).
 */
export const cardInboxHints = ({ card, cardFile = false, answering, canUndo, moves = false, audio = false, nextSide = false, lineUndo = false }: CardInboxMoment): { keys: string; label: string }[] => [
  // What Space does next (YAZ-5048, Yaseen: "no way to know there is another side"): a word, or the next side.
  ...(card && !answering ? [{ keys: 'Space', label: nextSide ? 'Next side' : 'Show' }] : []),
  ...(card && audio ? [{ keys: 'P', label: 'Play' }] : []),
  ...(card && moves ? [{ keys: '← →', label: 'Other cards' }] : []),
  // YAZ-5694: on a finish screen the row would say only Undo, under the line's own "Undo ⌘Z": once is enough. With a
  // card the row is the keys' list, Undo among them.
  ...(canUndo && (card || !lineUndo) ? [{ keys: '⌘Z', label: 'Undo' }] : []),
  // O opens what Explore opens (YAZ-5145): a card file's card, "Open card"; a card in a page, its page.
  ...(card ? [{ keys: 'O', label: cardFile ? 'Open card' : 'Open page' }] : []),
  // E edits in Explore (YAZ-5145), as Explore's own E: in a read-only vault it asks "Allow edits?" first.
  ...(card ? [{ keys: 'E', label: 'Edit card' }] : []),
  // Short (YAZ-5024): the row is one line.
  ...(card ? [{ keys: '⌘↵', label: 'New tab' }] : []),
]
