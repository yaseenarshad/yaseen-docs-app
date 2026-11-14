import { splitFrontmatter } from './frontmatter'
import { closesFence, fenceOf } from './fences'
import { canonicalPageId, isNumberId } from './pageId'
import { cardTitle } from './cardText'
import { inLineEnds, withLf } from './lineEnds'

/**
 * PAGE CARDS (YAZ-4946, YAZ-4959 D3): a card is a ```` ```card ```` fence in a Markdown page, and its ONE card line
 * right under the closing fence:
 *
 *   ```card
 *   What is the capital of {{France}}?
 *   ---
 *   Paris
 *   ```
 *   <!-- card: WIKI-512, 2026-11-12T14:05Z good, 2026-11-20T09:00Z again -->
 *
 * The line holds the card's ID (the vault's counter, D2), then each review: a UTC time to the minute and the FSRS
 * rating (`again | hard | good | easy`, D5), and how long the answer took when that is known (YAZ-5033: whole active
 * seconds, `2026-11-12T14:05Z good 13s`; an older review has none). `off` takes the card out of review. `next` puts it at the top of the Inbox
 * (YAZ-4999 D3, "Up next"): its first answer removes it, in the same write. `notitle` hides the card's title (its
 * first line, `cardTitle`) on the Inbox's front (YAZ-5030, "Title on the front: Hide"); absent, the title shows, as on
 * every card before it. A card takes its ID when it is
 * made (`/card` asks the vault's door, `yaseendocs card add` too); one that has none (an agent's text, a paste) gets
 * it from the index's sweep (YAZ-4960). The due date is never written: `cardSchedule.ts` replays the reviews.
 *
 * The reader is tolerant, as `<!-- code: … -->` is (`client/src/editor/code/codeComment.ts`): a part it does not know
 * is KEPT as its text, in its place, and written back; an empty part is skipped. The ONE copy of these rules: the
 * index (main), the command (`yaseendocs`) and the editor and the Inbox (client) all read and write through here.
 * Pure: no fs, no React.
 */

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
export type CardPart = { kind: 'id'; id: string } | { kind: 'review'; review: CardReview } | { kind: 'off' } | { kind: 'next' } | { kind: 'notitle' } | { kind: 'other'; text: string }

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
const cardRecordOf = (line: CardLine, text: string): CardRecord => {
  const title = cardTitle(text)
  return { id: cardIdOf(line), off: isCardOff(line), next: isCardNext(line), reviews: cardReviewsOf(line), ...(title !== '' && { title }), ...(isCardNoTitle(line) && { notitle: true as const }) }
}

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
 * The "Fix later" mark (YAZ-5097; round 10, addition 3 of YAZ-5055): the word `fix` on the card line. The phone writes
 * it (YAZ-5073). Until YAZ-5097 gives it a part kind of its own, it is the unknown part `fix`, which every build of the
 * app keeps as its text, in its place (the older-app rule, addition 17). YAZ-5097 changes these two functions only.
 */
export const CARD_FIX = 'fix'
export const isCardFix = (line: CardLine): boolean => line.parts.some((p) => p.kind === 'other' && p.text === CARD_FIX)

/** Fix later on or off: `fix` goes after the ID and any `off` / `next` / `notitle` right after it, or first; off removes every `fix`. */
export function withCardFix(line: CardLine, on: boolean): CardLine {
  if (isCardFix(line) === on) return line
  if (!on) return { parts: line.parts.filter((p) => !(p.kind === 'other' && p.text === CARD_FIX)) }
  let i = line.parts.findIndex((p) => p.kind === 'id') + 1
  while (line.parts[i]?.kind === 'off' || line.parts[i]?.kind === 'next' || line.parts[i]?.kind === 'notitle') i++
  return { parts: [...line.parts.slice(0, i), { kind: 'other', text: CARD_FIX }, ...line.parts.slice(i)] }
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

/** One card as the no-drop rule reads it: its line and its text (the lines between its fences). */
export interface CardSide {
  line: CardLine
  text: string
}

/** What `settleCardCopy` decided: the keeper's line (null: no keeper was given), the copy's line, and whether the copy's history emptied. */
export interface CardCopySettled {
  keeper: CardLine | null
  copy: CardLine
  emptied: boolean
}

/**
 * THE NO-DROP RULE (YAZ-4998, from Yaseen's decision on YAZ-4948): no step empties a card's history, or drops a review,
 * unless each review it holds is already on the card that keeps the ID, or is written onto that card in the SAME step.
 * The ONE copy of the rule: the editor's copy rule (`cardCopies`, one transaction) and the sweep (`giveCardIds`,
 * the keeper written first) both settle each copy here, and write both lines it returns.
 *
 * `copy` gives up its ID because `keeper` holds it (the caller gives the copy a new ID; this rule reads only reviews):
 * - no keeper (null: the card that keeps the ID is not in this document): the copy keeps its history;
 * - another text: the copy keeps its history and the keeper is unchanged — each card keeps its own reviews, as two cards
 *   of their own (the decision on YAZ-4993, kept by Yaseen on YAZ-4998);
 * - the same text: the keeper takes each review of the copy that it lacks (`withCardReviews`: each review one time, in
 *   time order; of the same review with and without seconds, the one with them, YAZ-5033), and only then does the
 *   copy's history empty. The emptied copy also loses its `next` (YAZ-4999 D3):
 *   it is a new card now, not the one put at the top of the Inbox. The keeper keeps its own `next`, and takes none.
 * Nothing to add: the keeper's line is the same object, so a caller writes nothing for it.
 */
export function settleCardCopy(keeper: CardSide | null, copy: CardSide): CardCopySettled {
  if (keeper === null || keeper.text !== copy.text) return { keeper: keeper?.line ?? null, copy: copy.line, emptied: false }
  const union = withCardReviews(keeper.line, cardReviewsOf(copy.line))
  const has = new Set(cardReviewsOf(union).map(cardReviewKey))
  // The rule's own check: never empty a history whose reviews the keeper does not hold now.
  if (!cardReviewsOf(copy.line).every((r) => has.has(cardReviewKey(r)))) return { keeper: keeper.line, copy: copy.line, emptied: false }
  return { keeper: union, copy: withCardNext(withoutCardReviews(copy.line), false), emptied: true }
}

// ---------- cards in a page ----------

/**
 * A fence that opens a card: three or more backticks or tildes, then the language `card` and nothing else. The `\r` of
 * a Windows line end (YAZ-5146) may end it: a reader splits on `\n` alone.
 */
const CARD_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*card[ \t]*\r?$/
/** A cheap first look: no page without a card fence pays for the line walk. */
const ANY_CARD_FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*card[ \t]*\r?$/m

/** Is `line` the opening fence of a card? (The line numbers read the card line as its block's comment.) */
export const isCardFence = (line: string): boolean => CARD_FENCE_RE.test(line)

/** One card of a page, by line number (0-based, in the text it was found in). */
export interface CardBlock {
  /** The opening fence's line. */
  open: number
  /** The closing fence's line. */
  close: number
  /** The card line's line (`close + 1`), or null when the card has none yet. */
  lineAt: number | null
  /** The indent of the opening fence: the card line is written with it. */
  indent: string
  /** The card's text: the lines between the fences, without the fence's indent. */
  text: string
  /** What its card line holds (`EMPTY_CARD_LINE` when it has none). */
  line: CardLine
}

/**
 * Every card in `text` (a page's body, or the whole file), in page order. A code block of any other language is
 * skipped whole, so a ```` ```card ```` written inside a ```` ```markdown ```` block is no card. A page with Windows
 * line ends (`\r\n`, YAZ-5146) has the same cards at the same line numbers, and each card's `text` has `\n` alone, so
 * the rest of the app reads the same text for both kinds of page.
 */
export function findCards(text: string): CardBlock[] {
  if (!ANY_CARD_FENCE_RE.test(text)) return []
  const lines = text.split('\n')
  const cards: CardBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceOf(lines[i])
    if (fence === null) continue
    const card = CARD_FENCE_RE.exec(lines[i])
    let close = i + 1
    while (close < lines.length && !closesFence(lines[close], fence)) close++
    // A card fence that is never closed is no card yet: its line would land inside the block.
    if (card !== null && close < lines.length) {
      const indent = card[1]
      const from = i + 1
      const to = close
      const next = close + 1 < lines.length ? parseCardLine(lines[close + 1]) : null
      cards.push({
        open: i,
        close,
        lineAt: next === null ? null : close + 1,
        indent,
        // Built when asked: the sweep and the command read only the line; the index reads the title too (YAZ-5030).
        get text() {
          return lines
            .slice(from, to)
            .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
            .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
            .join('\n')
        },
        line: next ?? EMPTY_CARD_LINE,
      })
    }
    i = close
  }
  return cards
}

/** What the index keeps of a page's cards (D4, YAZ-5030 its title): one entry per card, in page order. */
export const cardRecords = (text: string): CardRecord[] => findCards(text).map((c) => cardRecordOf(c.line, c.text))

/**
 * `text` with the card line of each card `change` names rewritten: `change` gets each card in page order and returns
 * the new line, or undefined to leave that card as it is. A card that had no line gets one right under its fence;
 * a line that empties is removed. The ONE writer of card lines in a page: the sweep, the command and the Inbox.
 */
function rewriteCardLines(text: string, change: (card: CardBlock, index: number) => CardLine | undefined): string {
  const cards = findCards(text)
  if (cards.length === 0) return text
  const lines = text.split('\n')
  // Back to front, so each card's line numbers stay right while the ones after it change.
  for (let n = cards.length - 1; n >= 0; n--) {
    const card = cards[n]
    const next = change(card, n)
    if (next === undefined) continue
    const formatted = formatCardLine(next)
    const written = formatted === null ? [] : [card.indent + formatted]
    if (card.lineAt !== null) lines.splice(card.lineAt, 1, ...written)
    else lines.splice(card.close + 1, 0, ...written)
  }
  return lines.join('\n')
}

/**
 * The Markdown of one new card: its fence, its text and its card line (none for an empty line). The fence is one
 * backtick longer than the longest backtick fence in the text, so the text can never close the card.
 */
export function cardBlock(text: string, line: CardLine): string {
  const longest = Math.max(2, ...[...text.matchAll(/^[ \t]*(`{3,})/gm)].map((m) => m[1].length))
  const fence = '`'.repeat(longest + 1)
  const formatted = formatCardLine(line)
  return `${fence}card\n${text.replace(/\n+$/, '')}\n${fence}${formatted === null ? '' : `\n${formatted}`}`
}

/** The cards of a whole page (a Markdown file's text): those of its body, as the index reads them (`cardRecords` of the body). */
export const pageCards = (content: string): CardBlock[] => findCards(splitFrontmatter(content).body)

/**
 * `rewriteCardLines` over a whole page: its properties block is never read for cards, and is kept byte for byte. It
 * writes the page's own line end (YAZ-5146, `inLineEnds`): `change` gets the cards of the page read with `\n`.
 */
export function rewritePageCards(content: string, change: (card: CardBlock, index: number) => CardLine | undefined): string {
  return inLineEnds(content, (page) => {
    const { frontmatter, body } = splitFrontmatter(page)
    const next = rewriteCardLines(body, change)
    return next === body ? page : frontmatter + next
  })
}

/** Thrown when a page holds no card with the ID asked for: the card was deleted, or the page changed under the caller. */
export class CardNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no card ${id} on this page`)
    this.name = 'CardNotFoundError'
  }
}

/**
 * The page `content` with the TEXT of one card replaced by `text` (YAZ-5003: Edit card in the card window): card `id`
 * (the one at `index` when it holds `id`, else the first), or with no ID the card at `index`. The fence, its indent and
 * the card line stay; the fence grows when the new text holds a fence as long, so the text can never close the card.
 * The same text writes nothing new. The page keeps its own line end (YAZ-5146). Throws `CardNotFoundError`.
 */
export function changeCardText(content: string, id: string | null, text: string, index = -1): string {
  return inLineEnds(content, (page) => changedCardText(page, id, text, index))
}

function changedCardText(content: string, id: string | null, text: string, index: number): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const cards = findCards(body)
  const at = id === null ? index : cards[index] !== undefined && cardIdOf(cards[index].line) === id ? index : cards.findIndex((card) => cardIdOf(card.line) === id)
  const card = cards[at]
  if (card === undefined) throw new CardNotFoundError(id ?? `#${index + 1}`)
  const wanted = withLf(text).replace(/\n+$/, '')
  if (card.text === wanted) return content
  const lines = body.split('\n')
  const open = /^[ \t]*(`{3,}|~{3,})/.exec(lines[card.open])![1]
  const longest = Math.max(0, ...[...wanted.matchAll(/^[ \t]*(`{3,}|~{3,})/gm)].filter((m) => m[1][0] === open[0]).map((m) => m[1].length))
  const fence = longest >= open.length ? open[0].repeat(longest + 1) : open
  const head = fence === open ? lines[card.open] : lines[card.open].replace(open, fence)
  const tail = fence === open ? lines[card.close] : card.indent + fence
  lines.splice(card.open, card.close - card.open + 1, head, ...wanted.split('\n').map((l) => (l === '' ? '' : card.indent + l)), tail)
  return frontmatter + lines.join('\n')
}

/**
 * The page `content` with the card line of card `id` changed by `change` — for the Inbox, the card window and the ⋯
 * menu: `transformFile(path, (c) => changeCard(c, 'WIKI-512', (l) => withCardReview(l, { at: cardTime(Date.now()), rating: 'good' })))`.
 * Throws `CardNotFoundError` when no card holds `id`. Two cards with one ID (a copy the sweep has not met): the one at
 * `index` when it holds `id` (the card window of the second card), else the first.
 */
export function changeCard(content: string, id: string, change: (line: CardLine) => CardLine, index?: number): string {
  const cards = pageCards(content)
  const at = index !== undefined && cards[index] !== undefined && cardIdOf(cards[index].line) === id ? index : cards.findIndex((card) => cardIdOf(card.line) === id)
  if (at === -1) throw new CardNotFoundError(id)
  return rewritePageCards(content, (card, n) => (n === at ? change(card.line) : undefined))
}
