import { cardIdOf, cardReviewKey, cardReviewsOf, formatCardLine, pageCards, rewritePageCards, withCardReviews, type CardBlock, type CardLine, type CardPart } from './cardLine'

/**
 * THE CARD RULE OF SYNC (YAZ-5089, decision 5 on YAZ-5055). A card line is ONE line, so one card answered on two Macs
 * is one line changed two ways: git stops, and sync keeps both pages (a conflict copy). This rule runs BEFORE the
 * page's line merge. Each card that BOTH sides changed (by ID) takes, on both sides, the same new line:
 *  - the reviews: the union of both sides' reviews, each one ONE time, in time order (`withCardReviews`: of one review
 *    with and without seconds, the timed one);
 *  - the marks (`off`, `next`, `notitle`, and each part this app does not know yet, such as `fix`): a three-way result
 *    against the base. A mark that one side changed takes that change; a mark both sides left alone stays as it was.
 *  - the ID and the order of the parts: theirs (it is already everywhere else); a mark that only mine adds goes after
 *    the part it follows in mine.
 * So the two card lines are now the same, and git's line merge sees no clash there. What the rule never does:
 *  - touch a card that only ONE side changed: git's merge takes that side's line, and a review that side removed (an
 *    undo, Reset history) stays removed;
 *  - touch a card that one side does not hold (a convert moved it to a card file, YAZ-5037; a delete): the line merge
 *    runs as before, and a clash keeps both, with the YAZ-5056 rule for the copy's IDs;
 *  - unite two cards with one ID that the base does not know and whose texts differ (two Macs gave one number to two
 *    new cards): they are two cards, and the sweep settles them;
 *  - read an ID that two cards share on one side (a copy the sweep has not met yet).
 * The text of each card and every other line stay as each side has them, byte for byte, with the page's own line end
 * (`rewritePageCards`). A card file (`kind: card`) is a page with one card: its properties stay byte for byte.
 *
 * GitHub AutoSync holds a COPY of this rule (`github-autosync/shared/cardMerge.ts`, YAZ-5090). Pure: no fs.
 */
export function uniteCardLines(base: string | null, theirs: string, mine: string): [string, string] {
  const t = byId(pageCards(theirs))
  const m = byId(pageCards(mine))
  if (t.size === 0 || m.size === 0) return [theirs, mine]
  const b = base === null ? new Map<string, CardBlock>() : byId(pageCards(base))
  const united = new Map<string, CardLine>()
  for (const [id, their] of t) {
    const my = m.get(id)
    if (my === undefined || same(their.line, my.line)) continue
    const was = b.get(id)
    if (was !== undefined && (same(their.line, was.line) || same(my.line, was.line))) continue // one side only: git's
    if (was === undefined && their.text !== my.text) continue // two new cards that took one ID
    united.set(id, uniteLine(was?.line ?? null, their.line, my.line))
  }
  if (united.size === 0) return [theirs, mine]
  const write = (content: string) => rewritePageCards(content, (card) => united.get(cardIdOf(card.line) ?? ''))
  return [write(theirs), write(mine)]
}

/** The cards of a page by ID; an ID that two cards share is left out (it is no one card yet). */
function byId(cards: readonly CardBlock[]): Map<string, CardBlock> {
  const out = new Map<string, CardBlock>()
  const twice = new Set<string>()
  for (const card of cards) {
    const id = cardIdOf(card.line)
    if (id === null) continue
    if (out.has(id)) twice.add(id)
    else out.set(id, card)
  }
  for (const id of twice) out.delete(id)
  return out
}

const same = (a: CardLine, b: CardLine): boolean => formatCardLine(a) === formatCardLine(b)

/** What a part is, for the three-way result: the ID, one review (its time and rating), or one mark by its text. */
const keyOf = (p: CardPart): string =>
  p.kind === 'id' ? 'id' : p.kind === 'review' ? `review ${cardReviewKey(p.review)}` : p.kind === 'other' ? `mark ${p.text}` : `mark ${p.kind}`

const marksOf = (line: CardLine | null): Set<string> => new Set((line?.parts ?? []).map(keyOf).filter((k) => k.startsWith('mark ')))

/** One card's line from both sides: the union of the reviews, a three-way result for each mark. */
function uniteLine(base: CardLine | null, theirs: CardLine, mine: CardLine): CardLine {
  const [b, t, m] = [marksOf(base), marksOf(theirs), marksOf(mine)]
  // A mark both sides agree on stays as they have it; else the side that changed it from the base wins.
  const keep = (k: string): boolean => (t.has(k) === m.has(k) ? t.has(k) : t.has(k) === b.has(k) ? m.has(k) : t.has(k))
  let parts = withCardReviews(theirs, cardReviewsOf(mine)).parts.filter((p) => !keyOf(p).startsWith('mark ') || keep(keyOf(p)))
  // A mark only mine has goes after the part it follows in mine (`next` after the ID, `fix` after the reviews), else first.
  for (let i = 0; i < mine.parts.length; i++) {
    const part = mine.parts[i]
    const k = keyOf(part)
    if (!k.startsWith('mark ') || t.has(k) || !keep(k)) continue
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const before = parts.findIndex((p) => keyOf(p) === keyOf(mine.parts[j]))
      if (before !== -1) {
        at = before + 1
        break
      }
    }
    // The app's own marks keep its order: `off`, then `next`, then `notitle` (`withCardNext`, `withCardNoTitle`).
    while (rank(parts[at]) > 0 && rank(parts[at]) < rank(part)) at++
    parts = [...parts.slice(0, at), part, ...parts.slice(at)]
  }
  return { parts }
}

const rank = (p: CardPart | undefined): number => (p?.kind === 'off' ? 1 : p?.kind === 'next' ? 2 : p?.kind === 'notitle' ? 3 : 0)
