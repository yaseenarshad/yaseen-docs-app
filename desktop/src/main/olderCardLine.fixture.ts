/**
 * A FROZEN COPY of the card line rules of the builds from BEFORE YAZ-5308 (YAZ-5309, point 6: "the phone never writes
 * what an older Mac cannot read"). It is `shared/cardLine.ts` at `753a57dfe` (the phone branch tip before the merge:
 * the Mac's rules of `cfc97ff6a` plus the `fix` part), lines 33 to 268 — the parser, the writer and the line writers —
 * word for word, with only the imports and the first-line title record taken out. It has no `title` part: a newer
 * line's `title "…"` is read here as the older builds read it. Never import it outside a test.
 */
import { canonicalPageId, isNumberId } from '@shared/pageId'

export type CardRating = 'again' | 'hard' | 'good' | 'easy'

/** One review on a card line. */
export interface CardReview {
  /** UTC to the minute, `2026-11-12T14:05Z`: it sorts as a string. */
  at: string
  rating: CardRating
  /**
   * How long the answer took, in whole seconds of activity (YAZ-5033: the Inbox's timer, idle time never counts), 0 to
   * `CARD_SECONDS_MAX`; absent for a review made before it, or by anything that did not time it. FSRS never reads it.
   */
  seconds?: number
}

/** The longest time a review part holds: one day, in seconds (YAZ-5033). */
export const CARD_SECONDS_MAX = 86400

/** One part of a card line, in the order the line holds them. */
export type CardPart = { kind: 'id'; id: string } | { kind: 'review'; review: CardReview } | { kind: 'off' } | { kind: 'next' } | { kind: 'notitle' } | { kind: 'fix' } | { kind: 'other'; text: string }

/** What a card line holds. `parts` keeps every part in place; the getters below read it. */
export interface CardLine {
  parts: CardPart[]
}

/**
 * What the index keeps of each card (`IndexRecord.cards`, D4), in page order: no card text but its title (YAZ-5030:
 * what a link to the card shows, and what the `[[` picker finds it by).
 */
export interface CardRecord {
  /** The card's ID as the line holds it (canonical form, `WIKI-512`); null before the sweep gives one. */
  id: string | null
  /** The card is archived (the line's `off` part, YAZ-5046): out of review, its history kept. */
  off: boolean
  /** The card is up next (the line's `next` part, YAZ-4999 D3): the Inbox shows it first. */
  next: boolean
  /** The reviews, in the order the line holds them. */
  reviews: CardReview[]
  /** The card's title (`cardTitle`: its first line, as plain text); absent for an empty card. */
  title?: string
  /** The title is hidden on the Inbox's front (the line's `notitle` part, YAZ-5030); absent: it shows. */
  notitle?: true
  /** The card is marked "Fix later" (the line's `fix`, YAZ-5097): the To fix list; absent: no mark. */
  fix?: true
}

/** `<!-- card: … -->` on one line, any spaces inside the delimiters. */
const LINE_RE = /^<!--[ \t]*card:[ \t]*(.*?)[ \t]*-->$/
/**
 * A review part: a real UTC minute (month, day, hour and minute in range) and an FSRS rating, then the answer's
 * seconds when known (YAZ-5033): ` <n>s`, a whole number in its one written form (no leading zero, no sign), at most
 * `CARD_SECONDS_MAX`. Any other ending (`13.5s`, `013s`, `90000s`) makes the part unknown: kept as its text.
 */
const REVIEW_RE = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\dZ)[ \t]+(again|hard|good|easy)(?:[ \t]+(0|[1-9]\d{0,4})s)?$/

/** A review time as the line writes it: UTC, to the minute (`2026-11-12T14:05Z`). */
export const cardTime = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`

/** The card line `value` holds (one line, trimmed or not), or null when it is no card line. */
export function parseCardLine(value: string): CardLine | null {
  const body = LINE_RE.exec(value.trim())?.[1]
  if (body === undefined || body.includes('-->')) return null
  const parts: CardPart[] = []
  let id = false
  for (const text of body.split(/[ \t]*,[ \t]*/)) {
    if (text === '') continue
    const review = REVIEW_RE.exec(text)
    const seconds = review?.[3] === undefined ? undefined : Number(review[3])
    if (review !== null && (seconds === undefined || seconds <= CARD_SECONDS_MAX))
      parts.push({ kind: 'review', review: seconds === undefined ? { at: review[1], rating: review[2] as CardRating } : { at: review[1], rating: review[2] as CardRating, seconds } })
    else if (text === 'off') parts.push({ kind: 'off' })
    else if (text === 'next') parts.push({ kind: 'next' })
    else if (text === 'notitle') parts.push({ kind: 'notitle' })
    else if (text === 'fix') parts.push({ kind: 'fix' })
    else if (!id && isNumberId(text)) {
      id = true
      parts.push({ kind: 'id', id: canonicalPageId(text) })
    } else parts.push({ kind: 'other', text })
  }
  return { parts }
}

/** Is `n` seconds a review part can hold (YAZ-5033): a whole number, 0 to `CARD_SECONDS_MAX`? */
export const isCardSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= CARD_SECONDS_MAX

/** A review part as the line writes it: `2026-11-12T14:05Z good`, and ` 13s` only when its seconds are known (YAZ-5033). */
export const formatCardReview = (r: CardReview): string => (isCardSeconds(r.seconds) ? `${r.at} ${r.rating} ${r.seconds}s` : `${r.at} ${r.rating}`)

/**
 * The key of a review: its time and its rating (YAZ-4993: each review ONE time). Its seconds are no part of it
 * (YAZ-5033): two copies of one review, one timed and one not, are the same review.
 */
export const cardReviewKey = (r: CardReview): string => `${r.at} ${r.rating}`

/** The card line for `line`, or null when it holds no part (a card with no ID and no review writes no line). */
export function formatCardLine(line: CardLine): string | null {
  const parts = line.parts.map((p) => (p.kind === 'id' ? p.id : p.kind === 'review' ? formatCardReview(p.review) : p.kind === 'other' ? p.text : p.kind))
  return parts.length === 0 ? null : `<!-- card: ${parts.join(', ')} -->`
}

export const EMPTY_CARD_LINE: CardLine = { parts: [] }

export const cardIdOf = (line: CardLine): string | null => line.parts.find((p) => p.kind === 'id')?.id ?? null
export const isCardOff = (line: CardLine): boolean => line.parts.some((p) => p.kind === 'off')
/** The line with no ID part (a copy before its new ID); every other part stays. */
export const withoutCardId = (line: CardLine): CardLine => ({ parts: line.parts.filter((p) => p.kind !== 'id') })
export const cardReviewsOf = (line: CardLine): CardReview[] => line.parts.flatMap((p) => (p.kind === 'review' ? [p.review] : []))
/** Is the card up next (YAZ-4999 D3)? */
export const isCardNext = (line: CardLine): boolean => line.parts.some((p) => p.kind === 'next')
/** Is the card's title hidden on the Inbox's front (YAZ-5030)? */
export const isCardNoTitle = (line: CardLine): boolean => line.parts.some((p) => p.kind === 'notitle')
/** The line with `id` as its ID: the ID part changes in place, or comes first. */
export function withCardId(line: CardLine, id: string): CardLine {
  const at = line.parts.findIndex((p) => p.kind === 'id')
  const part: CardPart = { kind: 'id', id }
  return { parts: at === -1 ? [part, ...line.parts] : line.parts.map((p, i) => (i === at ? part : p)) }
}

/** The card archived or not (the ⋯ menu's "Archive card", YAZ-5046; the line's `off`): `off` goes right after the ID, or first. */
export function withCardOff(line: CardLine, off: boolean): CardLine {
  if (isCardOff(line) === off) return line
  if (!off) return { parts: line.parts.filter((p) => p.kind !== 'off') }
  const at = line.parts.findIndex((p) => p.kind === 'id') + 1
  return { parts: [...line.parts.slice(0, at), { kind: 'off' }, ...line.parts.slice(at)] }
}

/**
 * Up next on or off for the card (YAZ-4999 D3, the ⋯ menu's "Put at top of Inbox"): `next` goes right after the ID
 * (and after an `off` there), or first; off removes every `next`. `at` puts it back at that part place instead: the
 * undo of an answer that removed it (`cardNextIndex` gave the place), so the line comes back byte for byte.
 */
export function withCardNext(line: CardLine, on: boolean, at?: number): CardLine {
  if (isCardNext(line) === on) return line
  if (!on) return { parts: line.parts.filter((p) => p.kind !== 'next') }
  let i = line.parts.findIndex((p) => p.kind === 'id') + 1
  if (line.parts[i]?.kind === 'off') i++
  if (at !== undefined) i = Math.max(0, Math.min(at, line.parts.length))
  return { parts: [...line.parts.slice(0, i), { kind: 'next' }, ...line.parts.slice(i)] }
}

/**
 * The title hidden on the Inbox's front or shown (YAZ-5030, the ⋯ menu's "Title on the front"): `notitle` goes after
 * the ID and any `off` / `next` right after it, or first; Show removes every `notitle`.
 */
export function withCardNoTitle(line: CardLine, hide: boolean): CardLine {
  if (isCardNoTitle(line) === hide) return line
  if (!hide) return { parts: line.parts.filter((p) => p.kind !== 'notitle') }
  let i = line.parts.findIndex((p) => p.kind === 'id') + 1
  while (line.parts[i]?.kind === 'off' || line.parts[i]?.kind === 'next') i++
  return { parts: [...line.parts.slice(0, i), { kind: 'notitle' }, ...line.parts.slice(i)] }
}

/**
 * The "Fix later" mark (YAZ-5097; round 10, addition 3 of YAZ-5055): the word `fix` on the card line, its own part kind
 * as `off`, `next` and `notitle` are. The phone writes it (YAZ-5073, the `fix` action), the Mac's ⋯ menus too; the
 * To fix list reads it off the index (`CardRecord.fix`). An older build reads it as the unknown part `fix` and keeps it
 * as its text, in its place (the older-app rule, addition 17): the bytes on disk are the same for both.
 */
export const CARD_FIX = 'fix'
export const isCardFix = (line: CardLine): boolean => line.parts.some((p) => p.kind === 'fix')

/** Fix later on or off: `fix` goes after the ID and any `off` / `next` / `notitle` right after it, or first; off removes every `fix`. */
export function withCardFix(line: CardLine, on: boolean): CardLine {
  if (isCardFix(line) === on) return line
  if (!on) return { parts: line.parts.filter((p) => p.kind !== 'fix') }
  let i = line.parts.findIndex((p) => p.kind === 'id') + 1
  while (line.parts[i]?.kind === 'off' || line.parts[i]?.kind === 'next' || line.parts[i]?.kind === 'notitle') i++
  return { parts: [...line.parts.slice(0, i), { kind: 'fix' }, ...line.parts.slice(i)] }
}

/** The place among the line's parts of its `next` part, or -1 when the card is not up next. */
export const cardNextIndex = (line: CardLine): number => line.parts.findIndex((p) => p.kind === 'next')

/** One more review: right after the last review part, else at the end. */
export function withCardReview(line: CardLine, review: CardReview): CardLine {
  const last = line.parts.map((p) => p.kind === 'review').lastIndexOf(true)
  const at = last === -1 ? line.parts.length : last + 1
  return { parts: [...line.parts.slice(0, at), { kind: 'review', review }, ...line.parts.slice(at)] }
}

/** Without the review made at `at` (the last one, should two share a minute). An unknown `at` changes nothing. */
export function withoutCardReview(line: CardLine, at: string): CardLine {
  const i = line.parts.map((p) => p.kind === 'review' && p.review.at === at).lastIndexOf(true)
  return i === -1 ? line : { parts: line.parts.filter((_, j) => j !== i) }
}

/**
 * The line with each review of `add` that it does not hold yet (a review is its time and its rating, `cardReviewKey`;
 * each one ONE time), and its reviews in time order (YAZ-4993: the card that keeps an ID takes the union of its copies'
 * histories). The reviews fill the line's review places in time order, the new ones after the last of them (else at the
 * end); the ID, `off` and unknown parts stay where they are. A review the line holds with no seconds takes them from
 * the same review in `add` (YAZ-5033: the timed copy is kept); a review with seconds keeps its own. Nothing new to add
 * and no seconds to take: the same line.
 */
export function withCardReviews(line: CardLine, add: readonly CardReview[]): CardLine {
  const timed = new Map<string, CardReview>()
  for (const r of add) if (isCardSeconds(r.seconds) && !timed.has(cardReviewKey(r))) timed.set(cardReviewKey(r), r)
  let upgraded = false
  const held = cardReviewsOf(line).map((r) => {
    const better = isCardSeconds(r.seconds) ? undefined : timed.get(cardReviewKey(r))
    if (better === undefined) return r
    upgraded = true
    return { ...r, seconds: better.seconds }
  })
  const seen = new Set(held.map(cardReviewKey))
  // Of two new copies of one review, the timed one (YAZ-5033).
  const fresh = add.filter((r) => !seen.has(cardReviewKey(r)) && (seen.add(cardReviewKey(r)), true)).map((r) => timed.get(cardReviewKey(r)) ?? r)
  if (fresh.length === 0 && !upgraded) return line
  const all = [...held, ...fresh].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  let n = 0
  const parts: CardPart[] = line.parts.map((p) => (p.kind === 'review' ? { kind: 'review', review: all[n++] } : p))
  const last = parts.map((p) => p.kind === 'review').lastIndexOf(true)
  const at = last === -1 ? parts.length : last + 1
  return { parts: [...parts.slice(0, at), ...all.slice(n).map((review): CardPart => ({ kind: 'review', review })), ...parts.slice(at)] }
}

/** The place among the line's parts of the review `withoutCardReview(line, at)` removes, or -1 when no review is at `at`. */
export const cardReviewIndex = (line: CardLine, at: string): number => line.parts.map((p) => p.kind === 'review' && p.review.at === at).lastIndexOf(true)

/**
 * `review` put back at part `index`: the undo of a delete (YAZ-4964). `index` is the place `cardReviewIndex` gave
 * before the delete, so the line comes back byte for byte — with its ID, `off` and any unknown part where they were.
 * An `index` past the end (the line lost parts since) puts the review last.
 */
export function withCardReviewAt(line: CardLine, review: CardReview, index: number): CardLine {
  const at = Math.max(0, Math.min(index, line.parts.length))
  return { parts: [...line.parts.slice(0, at), { kind: 'review', review }, ...line.parts.slice(at)] }
}

/** No reviews: the ⋯ menu's "Reset history", and the history of a copy. Every other part stays. */
export const withoutCardReviews = (line: CardLine): CardLine => ({ parts: line.parts.filter((p) => p.kind !== 'review') })
