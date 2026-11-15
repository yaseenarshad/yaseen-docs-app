// YAZ-5620 (review audit items 4 and 23): the card rule of sync keeps every review of one minute. Two ✕ on a card that
// comes straight back are two reviews; the same review seen from both sides is one; Undo after the merge finds its copy.
import { describe, expect, it } from 'vitest'
import { uniteCardLines } from '@shared/cardMerge'
import { cardReviewsOf, formatCardReview, pageCards, settleCardCopy, withCardReviews, withoutCardReview, type CardLine } from '@shared/cardLine'
import { cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

const pg = (line: string) => `# P\n\n\`\`\`card\nQ {{a}}\n\`\`\`\n<!-- card: ${line} -->\n`
const lineOf = (text: string): CardLine => pageCards(text)[0].line
const reviews = (text: string) => cardReviewsOf(lineOf(text)).map(formatCardReview)

const OLD = '2026-10-01T08:00Z good'
const X1 = '2026-11-15T15:39Z again 4s'
const X2 = '2026-11-15T15:39Z again 3s'
const OK = '2026-11-15T15:39Z good 2s'

describe('YAZ-5620 same-minute reviews in the merge', () => {
  it('two ✕ in one minute on one side, a title change on the other: both ✕ stay, on both sides', () => {
    const base = pg(`AU-1, ${OLD}`)
    const mine = pg(`AU-1, ${OLD}, ${X1}, ${X2}, 2026-11-15T15:40Z good 2s`)
    const theirs = pg(`AU-1, title "Renamed", ${OLD}`)
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(reviews(t)).toEqual([OLD, X1, X2, '2026-11-15T15:40Z good 2s'])
  })

  it('the same two ✕ of one minute on both sides: two (not one, not four), and the schedule of the side that made them', () => {
    const base = pg(`AU-1, ${OLD}`)
    const G = '2026-11-15T15:40Z good 2s'
    const mine = pg(`AU-1, ${OLD}, ${X1}, ${X2}, ${G}`)
    const theirs = pg(`AU-1, ${OLD}, ${X1}, ${X2}, ${G}, fix`)
    const [t] = uniteCardLines(base, theirs, mine)
    expect(reviews(t)).toEqual([OLD, X1, X2, G])
    const state = (text: string) => cardState(cardReviewsOf(lineOf(text)), DEFAULT_REVIEW_SETTINGS)
    expect(state(t)).toEqual(state(mine))
  })

  it('✕ then ✓ ✓ in the same minute (a card in its steps): all three stay, in their order', () => {
    const base = pg(`AU-1, ${OLD}`)
    const OK2 = '2026-11-15T15:39Z good 5s'
    const mine = pg(`AU-1, ${OLD}, ${X1}, ${OK}, ${OK2}`)
    const theirs = pg(`AU-1, next, ${OLD}`)
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(reviews(t)).toEqual([OLD, X1, OK, OK2])
  })

  it('the same review seen from both sides is kept one time (and a copy with no seconds takes them)', () => {
    const base = pg(`AU-1, ${OLD}`)
    const [t] = uniteCardLines(base, pg(`AU-1, ${OLD}, ${X1}`), pg(`AU-1, fix, ${OLD}, ${X1}`))
    expect(reviews(t)).toEqual([OLD, X1])
    const [u] = uniteCardLines(base, pg(`AU-1, ${OLD}, 2026-11-15T15:39Z again`), pg(`AU-1, fix, ${OLD}, ${X1}`))
    expect(reviews(u)).toEqual([OLD, X1])
  })

  it('withCardReviews and the copy rule count copies: two ✕ of one minute from the copy stay two', () => {
    const keeper = lineOf(pg(`AU-1, ${OLD}`))
    const copy = lineOf(pg(`AU-2, ${OLD}, ${X1}, ${X2}`))
    expect(cardReviewsOf(withCardReviews(keeper, cardReviewsOf(copy))).map(formatCardReview)).toEqual([OLD, X1, X2])
    const settled = settleCardCopy({ line: keeper, text: 'Q' }, { line: copy, text: 'Q' })
    expect(settled.emptied).toBe(true)
    expect(cardReviewsOf(settled.keeper!).map(formatCardReview)).toEqual([OLD, X1, X2])
  })

  it('an undo on one side of the second ✕ stays undone; the other side kept both as they were', () => {
    const base = pg(`AU-1, ${OLD}, ${X1}, ${X2}`)
    const theirs = pg(`AU-1, ${OLD}, ${X1}`)
    const mine = pg(`AU-1, fix, ${OLD}, ${X1}, ${X2}`)
    const [t] = uniteCardLines(base, theirs, mine)
    expect(reviews(t)).toEqual([OLD, X1])
  })

  it('Undo after the merge: the Mac takes back the second ✕, and only it', () => {
    const [t] = uniteCardLines(pg(`AU-1, ${OLD}`), pg(`AU-1, fix, ${OLD}`), pg(`AU-1, ${OLD}, ${X1}, ${X2}`))
    // The Mac's undo (`undoCardAnswer`): the last review at that minute.
    expect(cardReviewsOf(withoutCardReview(lineOf(t), '2026-11-15T15:39Z')).map(formatCardReview)).toEqual([OLD, X1])
  })
})
