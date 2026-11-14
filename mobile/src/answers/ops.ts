import {
  cardIdOf,
  cardReviewKey,
  cardReviewsOf,
  isCardFix,
  isCardNext,
  isCardOff,
  pageCards,
  rewritePageCards,
  withCardFix,
  withCardNext,
  withCardOff,
  withCardReview,
  withoutCardReview,
  type CardLine,
  type CardRating,
  type CardReview,
} from '@shared/cardLine'

/**
 * One thing the person did on the phone, kept until GitHub has it (decision 2 of YAZ-5055). It is applied by card ID to
 * the NEWEST text of the file that holds the card, so it can go on any version of the page and never clashes.
 */
export type CardOp =
  | { kind: 'review'; id: string; review: CardReview } // an answer
  | { kind: 'unreview'; id: string; at: string; rating: CardRating } // undo of a sent answer: names ONE review (YAZ-5181)
  | { kind: 'off'; id: string; on: boolean } // archive, unarchive
  | { kind: 'next'; id: string; on: boolean } // Up next
  | { kind: 'fix'; id: string; on: boolean } // Fix later (round 10, YAZ-5097)

/**
 * One action on one card line, with the shared card logic (`shared/cardLine.ts`). Each kind is IDEMPOTENT: an action
 * that the line already holds changes nothing. So a send that reached GitHub, but whose answer the phone never got,
 * writes the review ONE time when it is sent again (a review is its time and its rating: `cardReviewKey`).
 */
export function applyOp(line: CardLine, op: CardOp): CardLine {
  switch (op.kind) {
    case 'review': {
      const key = cardReviewKey(op.review)
      return cardReviewsOf(line).some((r) => cardReviewKey(r) === key) ? line : withCardReview(line, op.review)
    }
    case 'unreview': {
      // YAZ-5181: the review at `at` WITH this rating, the last one (as `withoutCardReview` picks). Gone already: no
      // change, so an `unreview` sent again never takes a second review of the same minute. A list stored before the
      // rating was named (no `rating`) keeps the old reading.
      if ((op as { rating?: CardRating }).rating === undefined) return withoutCardReview(line, op.at)
      const key = cardReviewKey({ at: op.at, rating: op.rating })
      const i = line.parts.map((p) => p.kind === 'review' && cardReviewKey(p.review) === key).lastIndexOf(true)
      return i === -1 ? line : { parts: line.parts.filter((_, j) => j !== i) }
    }
    case 'off':
      return withCardOff(line, op.on)
    case 'next':
      return withCardNext(line, op.on)
    case 'fix':
      return withCardFix(line, op.on)
  }
}

/**
 * Pure: `ops` applied, in their order, to a page's text (a page, or a card file: its properties stay byte for byte).
 * A card is found as `changeCard` finds it: the first card of the body whose line holds the ID (`pageCards`); the page
 * is read ONE time and written ONE time (`rewritePageCards`, which keeps the page's line end). An action whose card
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
  const lines = new Map<number, CardLine>()
  const lost: CardOp[] = []
  for (const op of ops) {
    const n = at.get(op.id.toLowerCase())
    if (n === undefined) {
      lost.push(op)
      continue
    }
    lines.set(n, applyOp(lines.get(n) ?? cards[n].line, op))
  }
  const changed = [...lines].filter(([n, line]) => line !== cards[n].line)
  if (changed.length === 0) return { content, lost }
  const next = new Map(changed)
  return { content: rewritePageCards(content, (_card, n) => next.get(n)), lost }
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
 * Any other change (the title on the front, an ID, an unknown part other than `fix`) cannot be sent: it throws
 * `UnsentChangeError`, so nothing is half saved.
 */
export function opsBetween(id: string, before: CardLine, after: CardLine): CardOp[] {
  const rest = (line: CardLine) =>
    line.parts
      .filter((p) => p.kind !== 'review' && p.kind !== 'off' && p.kind !== 'next' && !(p.kind === 'other' && p.text === 'fix'))
      .map((p) => (p.kind === 'id' ? `id:${p.id}` : p.kind === 'other' ? `other:${p.text}` : p.kind))
      .join(',')
  if (rest(before) !== rest(after)) throw new UnsentChangeError(id)
  const ops: CardOp[] = []
  if (isCardOff(before) !== isCardOff(after)) ops.push({ kind: 'off', id, on: isCardOff(after) })
  if (isCardNext(before) !== isCardNext(after)) ops.push({ kind: 'next', id, on: isCardNext(after) })
  if (isCardFix(before) !== isCardFix(after)) ops.push({ kind: 'fix', id, on: isCardFix(after) })
  const was = cardReviewsOf(before)
  const now = cardReviewsOf(after)
  const keys = new Set(now.map(cardReviewKey))
  const had = new Set(was.map(cardReviewKey))
  for (const r of was) if (!keys.has(cardReviewKey(r))) ops.push({ kind: 'unreview', id, at: r.at, rating: r.rating })
  for (const r of now) if (!had.has(cardReviewKey(r))) ops.push({ kind: 'review', id, review: r })
  return ops
}
