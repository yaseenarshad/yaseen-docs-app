import { cardIdOf, cardReviewKey, cardReviewsOf, cardTitleOf, formatCardLine, formatCardReview, pageCards, rewritePageCards, withCardReviews, type CardBlock, type CardLine, type CardPart } from './cardLine'
import { keyFold } from './propertyKeys'

/**
 * THE CARD RULE OF SYNC (YAZ-5089, decision 5 on YAZ-5055). A card line is ONE line, so one card answered on two Macs
 * is one line changed two ways: git stops, and sync keeps both pages (a conflict copy). This rule runs BEFORE the
 * page's line merge. Each card that BOTH sides changed (by ID) takes, on both sides, the same new line:
 *  - the reviews: the union of both sides' reviews (but a review in the base that one side removed and the other left
 *    as it was stays removed, YAZ-5155), each one ONE time, in time order (`withCardReviews`: of one review
 *    with and without seconds, the timed one);
 *  - the marks (`off`, `next`, `notitle`, `fix`, and each part this app does not know yet): a three-way result
 *    against the base. A mark that one side changed takes that change; a mark both sides left alone stays as it was.
 *  - the title (YAZ-5308: the `title` part, YAZ-5309): a three-way result against the base, as a mark's, by its text. A
 *    title one side changed (a rename on the Mac, while the phone answers) takes that change; both sides changed it,
 *    each to a new title: theirs. A title neither side changed keeps its bytes;
 *  - each property (YAZ-5349: `tags "a" "b"`, by its name in any capitals): a three-way result against the base, as the
 *    title's, by its text. A property one side set, changed, renamed or removed takes that change (a property changed
 *    on the Mac while the phone answers); both sides changed it, each in its own way: theirs. One neither side changed
 *    keeps its bytes;
 *  - the ID and the order of the parts: theirs (it is already everywhere else); a mark that only mine adds goes after
 *    the part it follows in mine, and a property only mine sets goes after theirs' last property.
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

/**
 * What a part is, for the three-way result: the ID, the title (`uniteTitle`), one property by its name (`uniteProperties`),
 * one review (its time and rating), or one mark by its text.
 */
const keyOf = (p: CardPart): string =>
  p.kind === 'id'
    ? 'id'
    : p.kind === 'title'
      ? 'title'
      : p.kind === 'property'
        ? `property ${keyFold(p.name)}`
        : p.kind === 'review'
          ? `review ${cardReviewKey(p.review)}`
          : p.kind === 'other'
            ? `mark ${p.text}`
            : `mark ${p.kind}`

const marksOf = (line: CardLine | null): Set<string> => new Set((line?.parts ?? []).map(keyOf).filter((k) => k.startsWith('mark ')))

/** One card's line from both sides: the union of the reviews, a three-way result for each mark. */
function uniteLine(base: CardLine | null, theirs: CardLine, mine: CardLine): CardLine {
  const [b, t, m] = [marksOf(base), marksOf(theirs), marksOf(mine)]
  // A mark both sides agree on stays as they have it; else the side that changed it from the base wins.
  const keep = (k: string): boolean => (t.has(k) === m.has(k) ? t.has(k) : t.has(k) === b.has(k) ? m.has(k) : t.has(k))
  const gone = removedReviews(base, theirs, mine)
  let parts = withCardReviews(theirs, cardReviewsOf(mine)).parts.filter((p) =>
    p.kind === 'review' ? !gone.has(cardReviewKey(p.review)) : !keyOf(p).startsWith('mark ') || keep(keyOf(p)),
  )
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
    // The app's own marks go after the head (the ID, the title and the properties, YAZ-5349) and keep its order: `off`,
    // then `next`, then `notitle`, then `fix` (`withCardOff`, `withCardNext`, `withCardNoTitle`, `withCardFix`).
    if (rank(part) > 0) while (parts[at]?.kind === 'title' || parts[at]?.kind === 'property') at++
    while (rank(parts[at]) > 0 && rank(parts[at]) < rank(part)) at++
    parts = [...parts.slice(0, at), part, ...parts.slice(at)]
  }
  return uniteProperties(base, theirs, mine, uniteTitle(base, theirs, mine, { parts }))
}

/** A line's properties by name (`keyFold`; the first of two spellings, as `cardPropertiesOf` reads them), each with its part. */
function propertiesOf(line: CardLine | null): Map<string, CardPart> {
  const out = new Map<string, CardPart>()
  for (const p of line?.parts ?? []) if (p.kind === 'property' && !out.has(keyFold(p.name))) out.set(keyFold(p.name), p)
  return out
}

/** A part's text as the line writes it (its own bytes when it keeps them). */
const textOf = (p: CardPart | undefined): string | undefined => (p === undefined ? undefined : (formatCardLine({ parts: [p] }) ?? undefined))

/**
 * Each property three ways (YAZ-5349), by its name and its text: the side that changed it from the base (set, a new
 * value, removed) wins; both changed it, each in its own way: theirs. With no base, theirs; a property only mine holds
 * is kept. `line` holds theirs' properties; mine's part takes its place, or comes after the line's last property (else
 * after the ID and the title), and one mine removed goes. A rename is a remove and a set: the new name lands where the
 * old one was when theirs left that place alone.
 */
function uniteProperties(base: CardLine | null, theirs: CardLine, mine: CardLine, line: CardLine): CardLine {
  const [b, t, m] = [propertiesOf(base), propertiesOf(theirs), propertiesOf(mine)]
  const mineWins = (k: string): boolean => {
    const [bv, tv, mv] = [textOf(b.get(k)), textOf(t.get(k)), textOf(m.get(k))]
    if (tv === mv) return false
    if (base === null) return tv === undefined
    return tv === bv
  }
  const keys = [...new Set([...t.keys(), ...m.keys()])].filter(mineWins)
  if (keys.length === 0) return line
  let parts = line.parts
  // Removes first, keeping the place of each (a rename puts its new name there).
  const freed: number[] = []
  for (const k of keys) {
    if (m.has(k) || !t.has(k)) continue
    const at = parts.findIndex((p) => keyOf(p) === `property ${k}`)
    freed.push(at)
    parts = parts.filter((p) => keyOf(p) !== `property ${k}`)
  }
  for (const k of keys) {
    const own = m.get(k)
    if (own === undefined) continue
    const at = parts.findIndex((p) => keyOf(p) === `property ${k}`)
    if (at !== -1) {
      parts = parts.flatMap((p, i) => (i === at ? [own] : keyOf(p) === `property ${k}` ? [] : [p]))
      continue
    }
    // A new name: where mine has it after another property of the line, after that one; else where a removed one was; else after the last property, else after the ID and the title.
    const mineAt = mine.parts.indexOf(own)
    let place = -1
    for (let j = mineAt - 1; j >= 0 && place === -1; j--) {
      const prev = mine.parts[j]
      if (prev.kind !== 'property' && prev.kind !== 'title' && prev.kind !== 'id') break
      const found = parts.findIndex((p) => keyOf(p) === keyOf(prev))
      if (found !== -1) place = found + 1
    }
    if (place === -1 && freed.length > 0) place = Math.min(freed.shift()!, parts.length)
    if (place === -1) {
      const last = parts.map((p) => p.kind === 'property').lastIndexOf(true)
      place = last !== -1 ? last + 1 : parts.findIndex((p) => p.kind === 'id') + 1
      while (parts[place]?.kind === 'title') place++
    }
    parts = [...parts.slice(0, place), own, ...parts.slice(place)]
  }
  return { parts }
}

/**
 * The title three ways (YAZ-5309), by its text (`cardTitleOf`): the side that changed it from the base wins; both
 * changed it, each to a new one: theirs. `line` holds theirs' title part; mine's part (its own bytes) takes its place,
 * or comes right after the ID when theirs has none; a title mine removed goes.
 */
function uniteTitle(base: CardLine | null, theirs: CardLine, mine: CardLine, line: CardLine): CardLine {
  const [b, t, m] = [base === null ? null : cardTitleOf(base), cardTitleOf(theirs), cardTitleOf(mine)]
  if (t === m || m === b) return line
  if (t !== b && b !== null) return line
  // Mine changed the title, and theirs did not (or the base is not known: then the two differ, and mine is kept only when theirs has none).
  if (b === null && t !== '') return line
  const own = mine.parts.find((p) => p.kind === 'title')
  const at = line.parts.findIndex((p) => p.kind === 'title')
  const rest = line.parts.filter((p) => p.kind !== 'title')
  if (own === undefined) return { parts: rest }
  if (at !== -1) return { parts: line.parts.flatMap((p, i): CardPart[] => (i === at ? [own] : p.kind === 'title' ? [] : [p])) }
  const after = rest.findIndex((p) => p.kind === 'id') + 1
  return { parts: [...rest.slice(0, after), own, ...rest.slice(after)] }
}

/**
 * YAZ-5155: the reviews that stay removed. A review in the base that one side removed (an undo, "Remove review", Reset
 * history) and the other side left as it was (the same seconds, or removed too) stays removed. A review the other side
 * changed (it took its seconds) stays: a change wins over a remove, so no review is lost by accident. With no base
 * line for the card, nothing stays removed: the union.
 */
function removedReviews(base: CardLine | null, theirs: CardLine, mine: CardLine): Set<string> {
  const gone = new Set<string>()
  if (base === null) return gone
  const byKey = (line: CardLine) => new Map(cardReviewsOf(line).map((r) => [cardReviewKey(r), formatCardReview(r)]))
  const [t, m] = [byKey(theirs), byKey(mine)]
  for (const r of cardReviewsOf(base)) {
    const k = cardReviewKey(r)
    const was = formatCardReview(r)
    const [inT, inM] = [t.get(k), m.get(k)]
    if ((inT === undefined && (inM === undefined || inM === was)) || (inM === undefined && inT === was)) gone.add(k)
  }
  return gone
}

const rank = (p: CardPart | undefined): number => (p?.kind === 'off' ? 1 : p?.kind === 'next' ? 2 : p?.kind === 'notitle' ? 3 : p?.kind === 'fix' ? 4 : 0)
