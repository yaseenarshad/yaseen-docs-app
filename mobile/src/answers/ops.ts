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
  type CardReview,
} from '@shared/cardLine'

/**
 * One thing the person did on the phone, kept until GitHub has it (decision 2 of YAZ-5055). It is applied by card ID to
 * the NEWEST text of the file that holds the card, so it can go on any version of the page and never clashes.
 */
export type CardOp =
  /**
   * An answer. `nth` (YAZ-5078): this is the person's nth review of the same time and rating on the line (the review
   * time is to the minute, so a new card that comes back at once gets two in one minute, as the Mac writes them).
   * Absent: the first. The send stays idempotent: the review goes on only while the line holds fewer than `nth`.
   */
  | { kind: 'review'; id: string; review: CardReview; nth?: number }
  | { kind: 'unreview'; id: string; at: string } // undo of a sent answer
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
      const held = cardReviewsOf(line).filter((r) => cardReviewKey(r) === key).length
      return held >= (op.nth ?? 1) ? line : withCardReview(line, op.review)
    }
    case 'unreview':
      return withoutCardReview(line, op.at)
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
  for (const r of was) if (!keys.has(cardReviewKey(r))) ops.push({ kind: 'unreview', id, at: r.at })
  for (const r of now) if (!had.has(cardReviewKey(r))) ops.push({ kind: 'review', id, review: r })
  return ops
}
