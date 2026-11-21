import {
  cardIdOf,
  cardReviewKey,
  cardReviewsOf,
  cardTitleAtOf,
  cardTitleChoiceOf,
  formatCardLine,
  isCardFix,
  isCardNext,
  isCardNoTitle,
  isCardOff,
  pageCards,
  withCardFix,
  withCardNext,
  withCardNoTitle,
  withCardOff,
  withCardReview,
  withCardTitleChoice,
  withoutCardReview,
  type CardLine,
  type CardPart,
  type CardRating,
  type CardReview,
  type CardTitleChoice,
} from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { lineEndOf } from '@shared/lineEnds'
import { spliceCardLine } from './splice'

/**
 * One thing the person did on the phone, kept until GitHub has it (decision 2 of YAZ-5055). It is applied by card ID to
 * the NEWEST text of the file that holds the card, so it can go on any version of the page and never clashes.
 */
export type CardOp =
  /**
   * An answer. Its time is to the millisecond (YAZ-5642, `cardTime`), so no other review has it: the send stays
   * idempotent, the review goes on only while the line does not hold it. Whether a resend landed is settled by the
   * action's own commit (`WaitingAnswer.commit`, `send.ts`).
   */
  | { kind: 'review'; id: string; review: CardReview }
  /**
   * Undo of a sent answer: names ONE review by its full time and its rating (YAZ-5642: that one review). It removes
   * it while the line holds it; else it is gone already and it changes nothing, so a re-send after a lost reply
   * removes nothing more.
   */
  | { kind: 'unreview'; id: string; at: string; rating: CardRating }
  | { kind: 'off'; id: string; on: boolean } // archive, unarchive
  /**
   * Up next. `at`: the part place to put `next` back at, from `cardNextIndex` before the answer that took it
   * off; the Undo of a SENT answer gives it, as the Mac's Undo does. So `next` goes back where it was, in any order of
   * the line. Absent (Up next from the ⋯ menu, or a list stored before YAZ-5409): the writer's place.
   */
  | { kind: 'next'; id: string; on: boolean; at?: number }
  | { kind: 'fix'; id: string; on: boolean } // Fix later (round 10)
  /**
   * Title on the front: `on` hides the title on the review front (the line's `notitle`), off shows it again.
   * The Mac's own change (`withCardNoTitle`): the word goes after the ID, the title and any `off` / `next`; Show takes it out.
   */
  | { kind: 'notitle'; id: string; on: boolean }
  /**
   * Title in review › (YAZ-5696 on the phone, YAZ-5697 round 2): when the title shows in Review — the Mac's own change
   * (`withCardTitleChoice`: `notitle`, or `title-once` / `title-front` / `title-side2`, or none for the default). A change
   * of `notitle` alone stays a `notitle` action, as before.
   */
  | { kind: 'title'; id: string; choice: CardTitleChoice }

/**
 * A new review goes at its TIME among the line's reviews: before the first review made later, else right
 * after the last review. A new answer is the newest, so it goes where the Mac writes it (`withCardReview`); an older
 * one goes in time order, as the Mac's merge (`withCardReviews`) keeps them. The place depends only on the reviews,
 * never on the order in which one list added them.
 */
function withReviewInTime(line: CardLine, review: CardReview): CardLine {
  const later = line.parts.findIndex((p) => p.kind === 'review' && p.review.at > review.at)
  return later === -1 ? withCardReview(line, review) : { parts: [...line.parts.slice(0, later), { kind: 'review', review }, ...line.parts.slice(later)] }
}

/**
 * One action on one card line, with the shared card logic (`shared/cardLine.ts`). Each kind is IDEMPOTENT: an action
 * that the line already holds changes nothing. So a send that reached GitHub, but whose answer the phone never got,
 * writes the review ONE time when it is sent again (a review is its time and its rating: `cardReviewKey`).
 */
export function applyOp(line: CardLine, op: CardOp): CardLine {
  switch (op.kind) {
    case 'review': {
      const key = cardReviewKey(op.review)
      return cardReviewsOf(line).some((r) => cardReviewKey(r) === key) ? line : withReviewInTime(line, op.review)
    }
    case 'unreview': {
      // The review at `at` WITH this rating (YAZ-5642: one review). Gone already: no change. A list stored before the
      // rating was named (no `rating`) takes the review at `at`.
      if ((op as { rating?: CardRating }).rating === undefined) return withoutCardReview(line, op.at)
      const key = cardReviewKey({ at: op.at, rating: op.rating })
      const i = line.parts.findIndex((p) => p.kind === 'review' && cardReviewKey(p.review) === key)
      return i === -1 ? line : { parts: line.parts.filter((_, j) => j !== i) }
    }
    case 'off':
      return withCardOff(line, op.on)
    case 'next':
      return withCardNext(line, op.on, op.on ? op.at : undefined)
    case 'fix':
      return withCardFix(line, op.on)
    case 'notitle':
      return withCardNoTitle(line, op.on)
    case 'title':
      return withCardTitleChoice(line, op.choice)
  }
}

type ReviewPart = Extract<CardPart, { kind: 'review' }>
const sameReview = (a: CardReview, b: CardReview) => a.at === b.at && a.rating === b.rating && a.seconds === b.seconds

/**
 * One card's actions, in their order (`applyOp` each). YAZ-5520: a review that one list takes out and puts back (an
 * unreview, then a review of the same time and rating) goes back at ITS place, not at the end: a review taken out
 * stays in the line as a gap until the end of the list, and a review of its name fills the gap (the last one taken
 * out) before it takes a new place. So the list applied to its own result changes nothing: before, it took the review
 * out and wrote it again after the last review (or after a mark the list put after it), and a second run moved it.
 * The same line when nothing changed.
 */
export function applyCardOps(line: CardLine, ops: readonly CardOp[]): CardLine {
  let parts = line.parts
  const gone = new Set<CardPart>()
  const live = (): CardLine => (gone.size === 0 ? { parts } : { parts: parts.filter((p) => !gone.has(p)) })
  for (const op of ops) {
    if (op.kind === 'review') {
      const key = cardReviewKey(op.review)
      const gap = [...gone].reverse().find((p): p is ReviewPart => p.kind === 'review' && cardReviewKey(p.review) === key)
      const held = live().parts.some((p) => p.kind === 'review' && cardReviewKey(p.review) === key)
      if (gap === undefined || held) {
        const now = live()
        const after = applyOp(now, op)
        if (after !== now) parts = withGaps(parts, gone, after.parts)
        continue
      }
      gone.delete(gap)
      if (!sameReview(gap.review, op.review)) parts = parts.map((p) => (p === gap ? { kind: 'review', review: op.review } : p))
      continue
    }
    const now = live()
    const after = applyOp(now, op)
    if (after === now) continue
    const kept = new Set(after.parts)
    const removed = now.parts.filter((p) => !kept.has(p))
    // An unreview takes ONE review out: it stays as a gap. Any other change (a mark) is written around the gaps.
    if (op.kind === 'unreview' && removed.length === 1 && after.parts.length === now.parts.length - 1) gone.add(removed[0])
    else parts = withGaps(parts, gone, after.parts)
  }
  if (parts === line.parts && gone.size === 0) return line
  return live()
}

/** `after` (the live parts, changed) with each gap of `parts` put back right after the part it followed (or first). */
function withGaps(parts: readonly CardPart[], gone: ReadonlySet<CardPart>, after: CardPart[]): CardPart[] {
  if (gone.size === 0) return after
  const kept = new Set(after)
  const follows = new Map<CardPart | null, CardPart[]>()
  let anchor: CardPart | null = null
  for (const p of parts) {
    if (gone.has(p)) follows.set(anchor, [...(follows.get(anchor) ?? []), p])
    else if (kept.has(p)) anchor = p
  }
  return [...(follows.get(null) ?? []), ...after.flatMap((p) => [p, ...(follows.get(p) ?? [])])]
}

/**
 * Pure: `ops` applied, in their order, to a page's text (a page, or a card file: its properties stay byte for byte).
 * A card is found as `changeCard` finds it: the first card of the body whose line holds the ID (`pageCards`); the page
 * is read ONE time and written ONE time (each line spliced, YAZ-5409; each line keeps its own line end). An action whose card
 * this text does not hold (deleted, moved away, or only embedded here with `![[ID]]`) comes back in `lost`; it is
 * never dropped silently. No change at all gives back the same string.
 */
export function applyOps(content: string, ops: readonly CardOp[]): { content: string; lost: CardOp[] } {
  if (ops.length === 0) return { content, lost: [] }
  const cards = pageCards(content)
  const at = new Map<string, number>()
  cards.forEach((card, n) => {
    const id = cardIdOf(card.line)
    if (id !== null && !at.has(id.toLowerCase())) at.set(id.toLowerCase(), n)
  })
  // A mark (archive, Up next, Fix later, title on the front) SETS a value, so only the last action of each
  // mark for a card counts. Off then on of a mark the line holds changes no byte, and the list applied to its own
  // result changes nothing (a mark taken out and put back would go to the writer's place, which can differ).
  const lastMark = new Map<string, CardOp>()
  for (const op of ops) if (op.kind !== 'review' && op.kind !== 'unreview') lastMark.set(`${op.id.toLowerCase()}\n${op.kind}`, op)
  const byCard = new Map<number, CardOp[]>()
  const lost: CardOp[] = []
  for (const op of ops) {
    const n = at.get(op.id.toLowerCase())
    if (n === undefined) {
      lost.push(op)
      continue
    }
    if (op.kind !== 'review' && op.kind !== 'unreview' && lastMark.get(`${op.id.toLowerCase()}\n${op.kind}`) !== op) continue
    byCard.set(n, [...(byCard.get(n) ?? []), op])
  }
  const lines = new Map<number, CardLine>([...byCard].map(([n, list]) => [n, applyCardOps(cards[n].line, list)]))
  const changed = [...lines].filter(([n, line]) => line !== cards[n].line)
  if (changed.length === 0) return { content, lost }
  // Each changed line is SPLICED (`spliceCardLine`): the parts the actions kept keep their bytes and places.
  // On the RAW text, back to front, so each line keeps its OWN line end: a page that mixes `\n` and
  // `\r\n` (pasted from Windows) changes only its card lines, and each card line keeps the end it had.
  const { frontmatter, body } = splitFrontmatter(content)
  const rows = body.split('\n')
  for (const [n, line] of changed.sort((a, b) => b[0] - a[0])) {
    const card = cards[n]
    if (card.lineAt !== null) {
      const raw = rows[card.lineAt]
      const cr = raw.endsWith('\r') ? '\r' : ''
      const written = spliceCardLine(raw.slice(0, raw.length - cr.length), card.line, line)
      rows.splice(card.lineAt, 1, ...(written === null ? [] : [written + cr]))
    } else {
      // A card with no line yet (no ID, so no action names it today): the new line takes its fence's line end.
      const written = formatCardLine(line)
      if (written === null) continue
      const fence = rows[card.close]
      const cr = fence.endsWith('\r') || (card.close === rows.length - 1 && lineEndOf(content) === '\r\n') ? '\r' : ''
      if (card.close === rows.length - 1 && cr !== '' && !fence.endsWith('\r')) rows[card.close] = fence + cr
      rows.splice(card.close + 1, 0, card.indent + written + (card.close + 1 < rows.length ? cr : ''))
    }
  }
  const out = frontmatter + rows.join('\n')
  return { content: out, lost }
}

/** A line change the phone cannot send as actions (stage one sends answers and marks only). */
export class UnsentChangeError extends Error {
  constructor(readonly id: string) {
    super(`The phone cannot send this change of card ${id}`)
    this.name = 'UnsentChangeError'
  }
}

/**
 * A change of card `id`'s line (the review host's `changeCardLine`, the ⋯ menu) as actions: each mark that changed,
 * then each review taken out, then each review added. Applied to `before`, they give `after`'s marks and reviews.
 * The title on the front (`notitle`) is a mark too since YAZ-5503; so is the title's choice (`title-…`, YAZ-5696). Any other change (the title, YAZ-5308; a property,
 * YAZ-5349; an ID, an unknown part) cannot be sent: it throws `UnsentChangeError`, so nothing is half saved.
 */
export function opsBetween(id: string, before: CardLine, after: CardLine): CardOp[] {
  const rest = (line: CardLine) =>
    line.parts
      .filter((p) => p.kind !== 'review' && p.kind !== 'off' && p.kind !== 'next' && p.kind !== 'fix' && p.kind !== 'notitle' && p.kind !== 'titleat')
      .map((p) =>
        p.kind === 'id' ? `id:${p.id}` : p.kind === 'title' ? `title:${p.title}` : p.kind === 'property' ? `property:${JSON.stringify([p.name, p.value])}` : p.kind === 'other' ? `other:${p.text}` : (p as { kind: string }).kind,
      )
      .join(',')
  if (rest(before) !== rest(after)) throw new UnsentChangeError(id)
  const ops: CardOp[] = []
  if (isCardOff(before) !== isCardOff(after)) ops.push({ kind: 'off', id, on: isCardOff(after) })
  if (isCardNext(before) !== isCardNext(after)) ops.push({ kind: 'next', id, on: isCardNext(after) })
  if (isCardFix(before) !== isCardFix(after)) ops.push({ kind: 'fix', id, on: isCardFix(after) })
  // The title's choice (YAZ-5696): `notitle` alone stays its own action; a change of `title-…` is one Title in review action.
  if (cardTitleAtOf(before) !== cardTitleAtOf(after)) ops.push({ kind: 'title', id, choice: cardTitleChoiceOf(after) })
  else if (isCardNoTitle(before) !== isCardNoTitle(after)) ops.push({ kind: 'notitle', id, on: isCardNoTitle(after) })
  // Reviews by name (YAZ-5642: a full time and a rating is one review): the ones taken out, then the ones added.
  const was = new Map(cardReviewsOf(before).map((r) => [cardReviewKey(r), r]))
  const now = new Map(cardReviewsOf(after).map((r) => [cardReviewKey(r), r]))
  for (const [key, r] of was) if (!now.has(key)) ops.push({ kind: 'unreview', id, at: r.at, rating: r.rating })
  for (const [key, r] of now) if (!was.has(key)) ops.push({ kind: 'review', id, review: r })
  return ops
}
