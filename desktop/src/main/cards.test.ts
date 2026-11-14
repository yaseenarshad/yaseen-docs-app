import { describe, expect, it } from 'vitest'
import {
  CardNotFoundError,
  EMPTY_CARD_LINE,
  cardRecords,
  cardTime,
  changeCard,
  findCards,
  formatCardLine,
  parseCardLine,
  rewritePageCards,
  withCardId,
  withCardOff,
  withCardNext,
  isCardNext,
  cardNextIndex,
  cardReviewIndex,
  withCardReview,
  withCardReviewAt,
  withoutCardReview,
  withoutCardReviews,
  type CardReview,
} from '@shared/cardLine'
import { CARD_LEARNING_STEPS, CARD_RELEARNING_STEPS, CARD_STEP, addStep, answerLabel, answerRatings, cardHistory, cardPlan, cardQueue, cardState, isCardDue, pageCardCounts, previewAnswers, recallChance } from '@shared/cardSchedule'
import { FSRS, Rating, createEmptyCard, generatorParameters } from 'ts-fsrs'
import { cardPieces, cardSides, cardTitle, hiddenCount, markHidden } from '@shared/cardText'
import { DEFAULT_CARD_WEIGHTS, DEFAULT_REVIEW_SETTINGS, sanitizeReviewSettings } from '@shared/reviews'

/** Cards' shared core (YAZ-4959): the card line, the card text, the FSRS schedule and the settings. */

const DAY = 86_400_000

describe('the card line (D3)', () => {
  it('round-trips byte for byte with unknown parts kept in place, and each change touches only its own part', () => {
    const text = '<!-- card: WIKI-512, mochi hneK1PH8, 2026-11-12T14:05Z good, later-thing, 2026-11-20T09:00Z again -->'
    const line = parseCardLine(text)!
    expect(formatCardLine(line)).toBe(text)
    expect(parseCardLine(`  ${text}  `)).toEqual(line)
    expect(line.parts.map((p) => p.kind)).toEqual(['id', 'other', 'review', 'other', 'review'])

    const reviewed = withCardReview(line, { at: '2026-12-01T08:00Z', rating: 'hard' })
    expect(formatCardLine(reviewed)).toBe('<!-- card: WIKI-512, mochi hneK1PH8, 2026-11-12T14:05Z good, later-thing, 2026-11-20T09:00Z again, 2026-12-01T08:00Z hard -->')
    expect(formatCardLine(withoutCardReview(reviewed, '2026-11-12T14:05Z'))).toBe('<!-- card: WIKI-512, mochi hneK1PH8, later-thing, 2026-11-20T09:00Z again, 2026-12-01T08:00Z hard -->')
    expect(withoutCardReview(line, '1999-01-01T00:00Z')).toBe(line)
    expect(formatCardLine(withCardOff(line, true))).toBe('<!-- card: WIKI-512, off, mochi hneK1PH8, 2026-11-12T14:05Z good, later-thing, 2026-11-20T09:00Z again -->')
    expect(formatCardLine(withCardOff(withCardOff(line, true), false))).toBe(text)
    expect(formatCardLine(withoutCardReviews(line))).toBe('<!-- card: WIKI-512, mochi hneK1PH8, later-thing -->')
    expect(formatCardLine(withCardId(line, 'WIKI-900'))).toBe(text.replace('WIKI-512', 'WIKI-900'))

    // The undo of a delete (YAZ-4964): the review goes back to its own place, so the line is the same bytes again.
    const mixed = '<!-- card: WIKI-7, off, 2026-09-01T08:00Z good, mochi x1, 2026-10-02T09:30Z hard, 2026-08-03T10:00Z again -->'
    for (const at of ['2026-09-01T08:00Z', '2026-10-02T09:30Z', '2026-08-03T10:00Z']) {
      const before = parseCardLine(mixed)!
      const index = cardReviewIndex(before, at)
      const review = before.parts.flatMap((p) => (p.kind === 'review' && p.review.at === at ? [p.review] : []))[0]
      expect(formatCardLine(withCardReviewAt(withoutCardReview(before, at), review, index))).toBe(mixed)
    }
    expect(cardReviewIndex(line, '1999-01-01T00:00Z')).toBe(-1)
    expect(formatCardLine(withCardReviewAt(parseCardLine('<!-- card: WIKI-7 -->')!, { at: '2026-09-01T08:00Z', rating: 'good' }, 9))).toBe('<!-- card: WIKI-7, 2026-09-01T08:00Z good -->')

    // A card with no ID: the first part is a review, and the sweep's ID goes in front.
    const bare = parseCardLine('<!--card:2026-11-12T14:05Z good,,-->')!
    expect(formatCardLine(withCardId(bare, 'WIKI-1'))).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z good -->')
    expect(formatCardLine({ parts: [] })).toBeNull()
    // A bad time or rating is kept as text, never read as a review; the second ID-like part is kept too.
    expect(parseCardLine('<!-- card: wiki-3, 2026-13-45T99:99Z good, 2026-11-12T14:05Z meh, WIKI-4 -->')!.parts).toEqual([
      { kind: 'id', id: 'WIKI-3' },
      { kind: 'other', text: '2026-13-45T99:99Z good' },
      { kind: 'other', text: '2026-11-12T14:05Z meh' },
      { kind: 'other', text: 'WIKI-4' },
    ])
    for (const notOurs of ['<!-- code: width 300 -->', '<!-- cards: WIKI-1 -->', '<!-- card: a --> b -->', 'card: WIKI-1']) expect(parseCardLine(notOurs)).toBeNull()
    expect(cardTime(Date.UTC(2026, 10, 12, 14, 5, 59))).toBe('2026-11-12T14:05Z')
  })

  it('finds the cards of a page and rewrites only their lines: a line added under a bare fence, one emptied away, an indent kept', () => {
    const page = [
      '# Pages',
      '',
      '```card',
      'One',
      '```',
      '<!-- card: WIKI-1, 2026-11-12T14:05Z good -->',
      '',
      '- item',
      '  ```card',
      '  Two {{word}}',
      '  ---',
      '  Back',
      '  ```',
      '',
      '````md',
      '```card',
      'not a card: inside another block',
      '```',
      '````',
      '',
      '~~~card',
      'Never closed',
    ].join('\n')
    const cards = findCards(page)
    expect(cards.map((c) => [c.open, c.close, c.lineAt, c.indent, c.text])).toEqual([
      [2, 4, 5, '', 'One'],
      [8, 12, null, '  ', 'Two {{word}}\n---\nBack'],
    ])
    expect(cardRecords(page)).toEqual([
      { id: 'WIKI-1', off: false, next: false, reviews: [{ at: '2026-11-12T14:05Z', rating: 'good' }], title: 'One' },
      { id: null, off: false, next: false, reviews: [], title: 'Two word' },
    ])
    const given = rewritePageCards(page, (card, i) => (i === 1 ? withCardId(card.line, 'WIKI-2') : undefined))
    expect(given).toBe(page.replace('  Back\n  ```\n', '  Back\n  ```\n  <!-- card: WIKI-2 -->\n'))
    expect(rewritePageCards(given, (card, i) => (i === 1 ? withCardId(card.line, 'WIKI-2') : undefined))).toBe(given)
    // The Inbox's write: one review on the card named by ID; an empty line goes.
    const at = '2026-11-20T09:00Z'
    expect(changeCard(given, 'WIKI-2', (l) => withCardReview(l, { at, rating: 'again' }))).toContain(`  <!-- card: WIKI-2, ${at} again -->`)
    expect(changeCard(page, 'WIKI-1', () => ({ parts: [] }))).toBe(page.replace('<!-- card: WIKI-1, 2026-11-12T14:05Z good -->\n', ''))
    expect(() => changeCard(page, 'WIKI-9', (l) => l)).toThrow(CardNotFoundError)
    expect(findCards('no cards here\n```js\nx\n```\n')).toEqual([])
  })
})

describe('the card text (D10, D19, idea 3)', () => {
  it('splits sides on a lone ---, reads {{1::word}} as {{word}}, and titles the card with its first plain line', () => {
    const text = '\n## The **capital** of {{1::France}}\n\nis [[Paris|the city]].\n---\n```\n---\n```\nParis, {{c2::on the Seine}}\n'
    expect(cardSides(text)).toEqual(['## The **capital** of {{1::France}}\n\nis [[Paris|the city]].', '```\n---\n```\nParis, {{c2::on the Seine}}'])
    expect(cardPieces('A {{1::b}} c {{d e}}')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'hidden', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'hidden', text: 'd e' },
    ])
    expect(markHidden('{{1::Paris}} and {{Rome}}', (word, n) => `${n}:${word}`)).toBe('0:Paris and 1:Rome')
    expect(cardTitle(text)).toBe('The capital of France')
    expect(cardTitle('- [x] *Read* `x` [the doc](http://a.b) and ![img](a.png)')).toBe('Read x the doc and img')
    expect(cardTitle('')).toBe('')
  })
})

describe('code in a card is literal (the one fence walk, `shared/fences.ts`)', () => {
  it('a {{word}} in a code span or a code block of the card hides nothing; a --- there splits nothing', () => {
    const side = 'Run `echo {{a}}` or {{b}}\n```sh\necho "{{hello}}"\n---\n```\nthen {{c}}'
    expect(cardSides(side)).toEqual([side])
    expect(cardPieces(side).filter((p) => p.kind === 'hidden').map((p) => p.text)).toEqual(['b', 'c'])
    expect(hiddenCount(side)).toBe(2)
    expect(markHidden(side, (w) => `[${w}]`)).toBe(side.replace('{{b}}', '[b]').replace('{{c}}', '[c]'))
    expect(cardTitle('`{{x}}` first')).toBe('{{x}} first')
  })
})

describe('the schedule (D5): FSRS 5.4.2 replay', () => {
  const log: CardReview[] = [
    { at: '2026-01-01T09:00Z', rating: 'good' },
    { at: '2026-01-04T09:00Z', rating: 'good' },
    { at: '2026-01-20T09:00Z', rating: 'again' },
    { at: '2026-01-21T10:30Z', rating: 'good' },
  ]

  it('the same log gives the same due date every time, also with fuzz on, and the order on the line does not matter', () => {
    const fuzzed = { ...DEFAULT_REVIEW_SETTINGS }
    expect(fuzzed.fuzz).toBe(true)
    const first = cardState(log, fuzzed)
    for (let i = 0; i < 5; i++) expect(cardState(log, { ...DEFAULT_REVIEW_SETTINGS })).toEqual(first)
    expect(cardState([...log].reverse(), fuzzed)).toEqual(first)
    expect(first).toMatchObject({ isNew: false, lastReview: '2026-01-21T10:30Z', lapses: 1 })
    expect(first.due).toBe(Date.parse('2026-01-21T10:30Z') + first.interval * DAY)
    // Fuzz moves the date only within its range: off, the same log may land on another day, but near.
    const plain = cardState(log, { ...DEFAULT_REVIEW_SETTINGS, fuzz: false })
    expect(Math.abs(plain.interval - first.interval)).toBeLessThanOrEqual(Math.max(2, Math.ceil(plain.interval * 0.15)))
    // Same-day steps (YAZ-5020): the first Remembered of a new card and a Forgot are steps (0 days, back in this
    // session); a Remembered at the end of the steps gives days.
    const rows = cardHistory(log, fuzzed)
    expect(rows.map((r) => r.inSteps)).toEqual([true, false, true, false])
    expect(rows[0].interval).toBe(0)
    expect(rows[2].interval).toBe(0)
    expect(rows[1].interval).toBeGreaterThanOrEqual(1)
    expect(rows[3].interval).toBeGreaterThanOrEqual(1)
    expect(rows.map((r) => r.elapsed)).toEqual([0, 3, 16, 1])
  })

  it('two-button and four-button logs both schedule; a longer wait for easy than for hard; the preview is what the replay gives', () => {
    const four = { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 as const }
    expect(answerRatings(DEFAULT_REVIEW_SETTINGS)).toEqual(['again', 'good'])
    expect(answerRatings(four)).toEqual(['again', 'hard', 'good', 'easy'])
    expect(answerRatings(DEFAULT_REVIEW_SETTINGS).map((r) => answerLabel(r, DEFAULT_REVIEW_SETTINGS))).toEqual(['Forgot', 'Remembered'])
    const mixed: CardReview[] = [...log, { at: '2026-02-10T09:00Z', rating: 'easy' }, { at: '2026-03-30T09:00Z', rating: 'hard' }]
    expect(cardState(mixed, four).due).toBeGreaterThan(Date.parse('2026-03-30T09:00Z'))
    const now = Date.parse('2026-04-30T12:34:56Z')
    const answers = previewAnswers(mixed, four, now)
    expect(answers.map((a) => a.review)).toEqual(['again', 'hard', 'good', 'easy'].map((rating) => ({ at: '2026-04-30T12:34Z', rating })))
    expect(answers[3].interval).toBeGreaterThan(answers[1].interval)
    for (const a of answers) expect(cardState([...mixed, a.review], four).due).toBe(a.due)
    const chance = recallChance(mixed, four, now)!
    expect(chance).toBeGreaterThan(0)
    expect(chance).toBeLessThan(1)
    expect(recallChance([], four, now)).toBeNull()
    expect(cardState([], four)).toEqual({ isNew: true, due: null, interval: 0, lastReview: null, lapses: 0, inSteps: false })
  })

  it('the queue: due cards most overdue first, then new cards up to what newPerDay leaves today; off, ID-less and other folders left out', () => {
    const now = new Date(2026, 5, 15, 12, 0).getTime()
    const at = (ms: number): string => cardTime(ms)
    const s = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 2 }
    const records = [
      { path: '/v/a.md', folder: '', cards: [{ id: 'V-1', off: false, next: false, reviews: [{ at: at(now - 400 * DAY), rating: 'good' as const }] }, { id: 'V-2', off: false, next: false, reviews: [] }] },
      { path: '/v/sub/b.md', folder: 'sub', cards: [{ id: 'V-3', off: false, next: false, reviews: [] }, { id: 'V-4', off: true, next: false, reviews: [] }, { id: null, off: false, next: false, reviews: [] }, { id: 'V-5', off: false, next: false, reviews: [] }] },
      // Started today: it counts against newPerDay, and it is due again (YAZ-5020: a new card needs a second Remembered).
      { path: '/v/c.md', folder: '', cards: [{ id: 'V-6', off: false, next: false, reviews: [{ at: at(now - 60_000), rating: 'good' as const }] }] },
    ]
    const queue = cardQueue(records, s, now)
    expect(queue.map((q) => [q.id, q.isNew])).toEqual([['V-1', false], ['V-6', false], ['V-2', true]])
    expect(isCardDue(queue[0].due, now)).toBe(true)
    expect(cardQueue(records, s, now, 'sub').map((q) => q.id)).toEqual(['V-3'])
    expect(cardQueue(records, { ...s, newPerDay: 10 }, now, 'sub').map((q) => [q.id, q.index])).toEqual([['V-3', 0], ['V-5', 3]])
    expect(cardQueue(records, { ...s, enabled: false }, now)).toEqual([])
    // Two cards with one ID on a page (a copy before the sweep settles it): the Inbox shows the first one once.
    const twice = [{ path: '/v/d.md', folder: '', cards: [{ id: 'V-7', off: false, next: false, reviews: [] }, { id: 'V-7', off: false, next: false, reviews: [] }] }]
    expect(cardQueue(twice, s, now).map((q) => [q.id, q.index])).toEqual([['V-7', 0]])
  })

  it('YAZ-4999: the order — up next first (outside the limit, due now; off wins), then due, then new by ID age; an empty limit takes every new card', () => {
    const now = new Date(2026, 5, 15, 12, 0).getTime()
    const at = (ms: number): string => cardTime(ms)
    const card = (id: string, over: { off?: boolean; next?: boolean; reviews?: CardReview[] } = {}) => ({ id, off: false, next: false, reviews: [] as CardReview[], ...over })
    const learned: CardReview[] = [{ at: at(now - 3 * DAY), rating: 'good' }, { at: at(now - 3 * DAY + 60_000), rating: 'good' }] // due in days: not due today
    const overdue: CardReview[] = [{ at: at(now - 400 * DAY), rating: 'good' }]
    const records = [
      // Page order is not the order: the ID number is (D2). V-9 is the oldest new card, though last in path order.
      { path: '/v/a.md', folder: '', cards: [card('WI-30'), card('WI-12'), card('WI-20', { reviews: overdue })] },
      { path: '/v/b.md', folder: '', cards: [card('WI-25', { next: true, reviews: learned }), card('WI-40', { next: true }), card('WI-50', { next: true, off: true }), card('BUS-1')] },
      { path: '/v/c.md', folder: '', cards: [card('WI-9'), card('WI-11', { next: true })] },
    ]
    const ids = (s: Parameters<typeof cardQueue>[1], letters?: readonly string[]) => cardQueue(records, s, now, '', undefined, letters).map((q) => (q.next ? `${q.id}*` : q.id))
    const s = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 2 }
    const table: [string, Parameters<typeof cardQueue>[1], string[]][] = [
      // Up next by ID (V-11, V-25 not due yet, V-40 new; V-50 is off), then the overdue card, then 2 new cards, oldest first.
      ['limit 2, oldest', s, ['WI-11*', 'WI-25*', 'WI-40*', 'WI-20', 'BUS-1', 'WI-9']],
      ['limit 2, newest', { ...s, newOrder: 'newest' }, ['WI-11*', 'WI-25*', 'WI-40*', 'WI-20', 'WI-30', 'WI-12']],
      ['limit 0: up next still shows', { ...s, newPerDay: 0 }, ['WI-11*', 'WI-25*', 'WI-40*', 'WI-20']],
      ['no limit (an empty box)', { ...s, newPerDay: null }, ['WI-11*', 'WI-25*', 'WI-40*', 'WI-20', 'BUS-1', 'WI-9', 'WI-12', 'WI-30']],
    ]
    for (const [name, settings, want] of table) expect(ids(settings), name).toEqual(want)
    // The vault's letters known: an ID of other letters (a paste the sweep has not renumbered) sorts last, either order.
    expect(ids({ ...s, newPerDay: null }, ['WI'])).toEqual(['WI-11*', 'WI-25*', 'WI-40*', 'WI-20', 'WI-9', 'WI-12', 'WI-30', 'BUS-1'])
    expect(ids({ ...s, newPerDay: null, newOrder: 'newest' }, ['WI'])).toEqual(['WI-11*', 'WI-25*', 'WI-40*', 'WI-20', 'WI-30', 'WI-12', 'WI-9', 'BUS-1'])
    // An up-next card that is not due is due now; the Inbox count is the queue's length, up next included.
    const q = cardQueue(records, s, now)
    expect(q.filter((c) => c.next).every((c) => c.due <= now && isCardDue(c.due, now))).toBe(true)
    expect(q).toHaveLength(6)
  })

  it('YAZ-5028, changed by YAZ-5042 Decision 1: Up next a day — only that many marked cards first, less the ones taken today; the others keep the mark and wait for another day, unless due anyway', () => {
    const now = new Date(2026, 5, 15, 12, 0).getTime()
    const at = (ms: number): string => cardTime(ms)
    const card = (id: string, over: { next?: boolean; reviews?: CardReview[] } = {}) => ({ id, off: false, next: false, reviews: [] as CardReview[], ...over })
    const learned: CardReview[] = [{ at: at(now - 3 * DAY), rating: 'good' }, { at: at(now - 3 * DAY + 60_000), rating: 'good' }] // not due today
    const overdue = (days: number): CardReview[] => [{ at: at(now - days * DAY), rating: 'good' }]
    // Five marked: WI-1, WI-3, WI-5 new; WI-2 overdue; WI-4 not due. Not marked: WI-6 more overdue, WI-7 and WI-8 new.
    const records = [
      { path: '/v/a.md', folder: '', cards: [card('WI-1', { next: true }), card('WI-2', { next: true, reviews: overdue(100) }), card('WI-3', { next: true })] },
      { path: '/v/b.md', folder: '', cards: [card('WI-4', { next: true, reviews: learned }), card('WI-5', { next: true }), card('WI-6', { reviews: overdue(400) }), card('WI-7'), card('WI-8')] },
    ]
    const s = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 1 }
    const ids = (upNextPerDay: number | null, taken: readonly string[] = []) => cardQueue(records, { ...s, upNextPerDay }, now, '', undefined, undefined, taken).map((q) => (q.next ? `${q.id}*` : q.id))
    // Limit 2 (YAZ-5028 Decision, "so it kinda works like new?"): today's Up next is WI-1 and WI-2, first. YAZ-5042
    // Decision 1 ("yes extra up next should wait for another day"): the others keep the mark in the file and wait for
    // another day — WI-4 (not due) and WI-3, WI-5 (new) are not in today's queue. The one new card a day is WI-7.
    expect(ids(2)).toEqual(['WI-1*', 'WI-2*', 'WI-6', 'WI-7'])
    // Empty (no limit, the default): all five first, all five Up next.
    expect(ids(null)).toEqual(['WI-1*', 'WI-2*', 'WI-3*', 'WI-4*', 'WI-5*', 'WI-6', 'WI-7'])
    expect(DEFAULT_REVIEW_SETTINGS.upNextPerDay).toBeNull()
    // One taken today (an answer took WI-0's mark off): one place left. WI-2 is past the number but due anyway: it
    // comes today, by its due date after WI-6, not as Up next. Two taken, or a limit of 0: none first.
    expect(ids(2, ['WI-0'])).toEqual(['WI-1*', 'WI-6', 'WI-2', 'WI-7'])
    expect(ids(2, ['WI-0', 'WI-00'])).toEqual(ids(0))
    expect(ids(0)).toEqual(['WI-6', 'WI-2', 'WI-7'])
    // A taken ID still marked (the index has not caught up with the answer) holds its own place: nothing moves.
    expect(ids(2, ['WI-1'])).toEqual(ids(2))
    // The count of cards that wait (YAZ-5042): the marked cards past today's number.
    const more = (upNextPerDay: number | null) => cardPlan(records, { ...s, upNextPerDay }, now).more
    expect([more(null).next, more(2).next, more(0).next]).toEqual([0, 3, 5])
    // The places are the vault's: a folder's Inbox shows its own of the vault's first two (b.md has none of them).
    const vault = [{ ...records[0], folder: 'a' }, { ...records[1], folder: 'b' }]
    expect(cardQueue(vault, { ...s, upNextPerDay: 2 }, now, 'b').filter((q) => q.next)).toEqual([])
    expect(cardQueue(vault, { ...s, upNextPerDay: 2 }, now, 'a').filter((q) => q.next).map((q) => q.id)).toEqual(['WI-1', 'WI-2'])
  })

  it('YAZ-5028 Decision: with Up next a day = 2 and 3 marked, today\'s Up next is 2 (the menu row and its cards); empty, all 3', () => {
    const now = new Date(2026, 5, 15, 12, 0).getTime()
    const card = (id: string, over: { next?: boolean } = {}) => ({ id, off: false, next: false, reviews: [] as CardReview[], ...over })
    const records = [{ path: '/v/a.md', folder: '', cards: [card('UP-1', { next: true }), card('UP-2', { next: true }), card('UP-3', { next: true }), card('UP-4')] }]
    const upNext = (upNextPerDay: number | null) => cardQueue(records, { ...DEFAULT_REVIEW_SETTINGS, upNextPerDay }, now).filter((q) => q.next).map((q) => q.id)
    expect(upNext(2)).toEqual(['UP-1', 'UP-2'])
    expect(upNext(null)).toEqual(['UP-1', 'UP-2', 'UP-3'])
  })

  describe('YAZ-5042: more cards for today, past the Settings number', () => {
    const now = new Date(2026, 5, 15, 12, 0).getTime()
    const at = (ms: number): string => cardTime(ms)
    const card = (id: string, over: { next?: boolean; reviews?: CardReview[] } = {}) => ({ id, off: false, next: false, reviews: [] as CardReview[], ...over })
    // 15 new cards (NW-1..15), 5 marked new cards (UP-1..5), one due card.
    const fresh = Array.from({ length: 15 }, (_, i) => card(`NW-${i + 1}`))
    const marked = Array.from({ length: 5 }, (_, i) => card(`UP-${i + 1}`, { next: true }))
    const records = [{ path: '/v/a.md', folder: '', cards: [...fresh, ...marked, card('DU-1', { reviews: [{ at: at(now - 40 * DAY), rating: 'good' }] })] }]
    const s = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: 4, upNextPerDay: 2 }
    const kinds = (q: readonly { id: string; next: boolean; isNew: boolean }[]) => ({ next: q.filter((c) => c.next).length, new: q.filter((c) => c.isNew && !c.next).length, all: q.length })

    it('the queue with an added number: the Settings number plus today\'s added number; the count of cards that wait goes down', () => {
      const plan = (added?: { newCards: number; upNext: number }) => cardPlan(records, s, now, '', undefined, undefined, [], added)
      expect(kinds(plan().queue)).toEqual({ next: 2, new: 4, all: 7 })
      expect(plan().more).toEqual({ new: 11, next: 3 })
      expect(kinds(plan({ newCards: 4, upNext: 0 }).queue)).toEqual({ next: 2, new: 8, all: 11 })
      expect(plan({ newCards: 4, upNext: 0 }).more).toEqual({ new: 7, next: 3 })
      expect(kinds(plan({ newCards: 0, upNext: 2 }).queue)).toEqual({ next: 4, new: 4, all: 9 })
      expect(plan({ newCards: 0, upNext: 2 }).more).toEqual({ new: 11, next: 1 })
      // The added cards come in the queue's own order: the next new cards by ID, the next marked cards by ID.
      expect(plan({ newCards: 4, upNext: 2 }).queue.map((c) => c.id)).toEqual(['UP-1', 'UP-2', 'UP-3', 'UP-4', 'DU-1', 'NW-1', 'NW-2', 'NW-3', 'NW-4', 'NW-5', 'NW-6', 'NW-7', 'NW-8'])
      // Past every card: nothing waits, and no card shows twice.
      expect(plan({ newCards: 99, upNext: 99 }).more).toEqual({ new: 0, next: 0 })
      expect(kinds(plan({ newCards: 99, upNext: 99 }).queue)).toEqual({ next: 5, new: 15, all: 21 })
      // `cardQueue` is the plan's queue.
      expect(cardQueue(records, s, now, '', undefined, undefined, [], { newCards: 4, upNext: 0 })).toEqual(plan({ newCards: 4, upNext: 0 }).queue)
    })

    it('the add step: one more day of the Settings number; 10 when it is 0; none with no limit', () => {
      expect([addStep(4), addStep(2), addStep(0), addStep(null)]).toEqual([4, 2, 10, null])
    })

    it('`grow`: how much the added number must grow so that n more cards come — also when today used more than its number', () => {
      // 6 new cards begun today (each one review): the limit 4 is used past its end, so 0 new cards come.
      const begun = Array.from({ length: 6 }, (_, i) => card(`BG-${i + 1}`, { reviews: [{ at: at(now - 60 * 60_000), rating: 'good' }, { at: at(now - 59 * 60_000), rating: 'good' }] }))
      const vault = [...records, { path: '/v/b.md', folder: '', cards: begun }]
      const plan = cardPlan(vault, s, now)
      expect(kinds(plan.queue).new).toBe(0)
      // 4 more need 6: 2 to make up the day's overuse, then 4.
      expect(plan.grow('new', 4)).toBe(6)
      expect(kinds(cardPlan(vault, s, now, '', undefined, undefined, [], { newCards: 6, upNext: 0 }).queue).new).toBe(4)
      // Up next: one place taken today by an answer (UP-0); the 2 places hold one card now; 2 more need 2.
      const taken = cardPlan(records, s, now, '', undefined, undefined, ['UP-0'])
      expect(kinds(taken.queue).next).toBe(1)
      expect(taken.grow('next', 2)).toBe(2)
      expect(kinds(cardPlan(records, s, now, '', undefined, undefined, ['UP-0'], { newCards: 0, upNext: 2 }).queue).next).toBe(3)
      // With no limit nothing waits, and nothing grows.
      const open = cardPlan(records, { ...s, newPerDay: null, upNextPerDay: null }, now)
      expect([open.more, open.grow('new', 4), open.grow('next', 2)]).toEqual([{ new: 0, next: 0 }, 0, 0])
    })

    it('setting 0: no card of that kind today, every one waits; an add brings them', () => {
      const zero = { ...s, newPerDay: 0, upNextPerDay: 0 }
      const plan = cardPlan(records, zero, now)
      expect(kinds(plan.queue)).toEqual({ next: 0, new: 0, all: 1 })
      expect(plan.more).toEqual({ new: 15, next: 5 })
      expect(kinds(cardPlan(records, zero, now, '', undefined, undefined, [], { newCards: 10, upNext: 5 }).queue)).toEqual({ next: 5, new: 10, all: 16 })
    })

    it('folder or page review: counts that scope\'s cards; the add uses the vault\'s number and brings that scope\'s cards', () => {
      // a/: NW-1..15 and DU-1; b/: UP-1..5 and NB-1..3. The vault's marked cards are all in b/.
      const vault = [
        { path: '/v/a/x.md', folder: 'a', cards: [...fresh, card('DU-1', { reviews: [{ at: at(now - 40 * DAY), rating: 'good' }] })] },
        { path: '/v/b/y.md', folder: 'b', cards: [...marked, card('NB-1'), card('NB-2'), card('NB-3')] },
      ]
      expect(cardPlan(vault, s, now, 'a').more).toEqual({ new: 11, next: 0 })
      expect(cardPlan(vault, s, now, 'b').more).toEqual({ new: 0, next: 3 })
      expect(cardPlan(vault, s, now, '', '/v/b/y.md').more).toEqual({ new: 0, next: 3 })
      // Page review of b/y.md: Up next 2 more by the vault's number.
      const page = (added?: { newCards: number; upNext: number }) => cardPlan(vault, s, now, '', '/v/b/y.md', undefined, [], added)
      expect(page().grow('next', 2)).toBe(2)
      expect(kinds(page({ newCards: 0, upNext: 2 }).queue).next).toBe(4)
      // The vault's places go first to the vault's first marked cards: in a/, with marked cards past them in b/, an
      // add of 1 for a/ grows past b/'s cards (UP-3..5) to reach a/'s first waiting one.
      const mixed = [{ ...vault[0], cards: [...vault[0].cards, card('UP-9', { next: true })] }, vault[1]]
      const a = cardPlan(mixed, s, now, 'a')
      expect(a.more.next).toBe(1)
      expect(a.grow('next', 1)).toBe(4)
      expect(cardPlan(mixed, s, now, 'a', undefined, undefined, [], { newCards: 0, upNext: 4 }).queue.filter((c) => c.next).map((c) => c.id)).toEqual(['UP-9'])
    })
  })

  it('YAZ-4999: `next` reads, writes and goes back to its place byte for byte', () => {
    const text = '<!-- card: WIKI-512, next, 2026-11-12T14:05Z good -->'
    const line = parseCardLine(text)!
    expect([isCardNext(line), cardNextIndex(line), formatCardLine(line)]).toEqual([true, 1, text])
    expect(cardRecords(`\`\`\`card\nQ\n\`\`\`\n${text}`)).toEqual([{ id: 'WIKI-512', off: false, next: true, reviews: [{ at: '2026-11-12T14:05Z', rating: 'good' }], title: 'Q' }])
    const plain = parseCardLine('<!-- card: WIKI-512, off, 2026-11-12T14:05Z good -->')!
    expect(formatCardLine(withCardNext(plain, true))).toBe('<!-- card: WIKI-512, off, next, 2026-11-12T14:05Z good -->')
    expect(formatCardLine(withCardNext(EMPTY_CARD_LINE, true))).toBe('<!-- card: next -->')
    expect(withCardNext(line, true)).toBe(line)
    expect(formatCardLine(withCardNext(line, false))).toBe('<!-- card: WIKI-512, 2026-11-12T14:05Z good -->')
    // The undo of an answer: back at the place it had.
    const odd = parseCardLine('<!-- card: WIKI-512, 2026-11-12T14:05Z good, next, kept -->')!
    expect(formatCardLine(withCardNext(withCardNext(odd, false), true, cardNextIndex(odd)))).toBe(formatCardLine(odd))
  })
})

describe('YAZ-5020: same-day steps — cards come back in the same session (Yaseen\'s 21 weights, retention 0.9, no fuzz)', () => {
  const s = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
  const t0 = new Date(2026, 5, 15, 9, 0).getTime()
  /** A log of answers, each `[minutes after t0, rating]`, as the line holds them (to the minute). */
  const log = (...answers: [number, CardReview['rating']][]): CardReview[] => answers.map(([m, rating]) => ({ at: cardTime(t0 + m * 60_000), rating }))
  const steps = (l: CardReview[]) => cardHistory(l, s).map((r) => r.inSteps)
  const lastWait = (l: CardReview[]) => cardHistory(l, s).at(-1)!.interval
  /** The old days-only mode (D5, `enable_short_term: false`), for the trap: the same log through ts-fsrs. */
  const daysOnly = (l: CardReview[]): number => {
    const f = new FSRS(generatorParameters({ w: s.weights, request_retention: s.retention, maximum_interval: s.maxDays, enable_fuzz: false, enable_short_term: false }))
    let card = createEmptyCard(new Date(Date.parse(l[0].at)))
    for (const r of l) card = f.next(card, new Date(Date.parse(r.at)), r.rating === 'again' ? Rating.Again : Rating.Good).card
    return card.scheduled_days
  }
  const D = 1440

  it('the step is one minute, the smallest ts-fsrs takes: two for a new card, one after a Forgot', () => {
    expect(CARD_STEP).toBe('1m')
    expect(CARD_LEARNING_STEPS).toEqual(['1m', '1m'])
    expect(CARD_RELEARNING_STEPS).toEqual(['1m'])
    expect(s.weights).toEqual([...DEFAULT_CARD_WEIGHTS])
    expect(s.weights).toHaveLength(21)
  })

  it('new → Remembered → Remembered: the first is a step (back in this session), the second leaves with 4 days; also both in one minute', () => {
    const rr = log([0, 'good'], [1, 'good'])
    expect(steps(rr)).toEqual([true, false])
    expect(cardHistory(rr, s).map((r) => r.interval)).toEqual([0, 4])
    const same = log([0, 'good'], [0, 'good'])
    expect(same[0].at).toBe(same[1].at)
    expect(steps(same)).toEqual([true, false])
    expect(lastWait(same)).toBe(4)
  })

  it('the trap: new → Forgot → Remembered → Remembered leaves with 1 day — days-only mode gives 3 for Forgot → Remembered', () => {
    const frr = log([0, 'again'], [1, 'good'], [2, 'good'])
    // Each Forgot starts the count again: the first Remembered after it is still a step.
    expect(steps(frr)).toEqual([true, true, false])
    expect(lastWait(frr)).toBe(1)
    expect(daysOnly(log([0, 'again'], [10, 'good']))).toBe(3)
  })

  it('new → Remembered → Forgot → Remembered → Remembered leaves after the second Remembered that follows the Forgot', () => {
    const l = log([0, 'good'], [1, 'again'], [2, 'good'], [3, 'good'])
    expect(steps(l)).toEqual([true, true, true, false])
    expect(lastWait(l)).toBe(1)
    expect(cardState(l, s).lapses).toBe(0) // a Forgot in the learning steps is not a lapse
  })

  it('known → Forgot → Remembered: one Remembered leaves the steps, a lapse, days again — shorter than days-only mode', () => {
    const known: [number, CardReview['rating']][] = [[0, 'good'], [1, 'good'], [3 * D, 'good'], [15 * D, 'good'], [55 * D, 'good']]
    expect(cardHistory(log(...known), s).at(-1)!.interval).toBeGreaterThan(30)
    const fr = log(...known, [95 * D, 'again'], [95 * D + 1, 'good'])
    expect(steps(fr).slice(-2)).toEqual([true, false])
    expect(cardState(fr, s)).toMatchObject({ lapses: 1, inSteps: false, interval: 6 })
    expect(lastWait(fr)).toBeLessThan(daysOnly(log(...known, [95 * D, 'again'], [95 * D + 10, 'good'])))
  })

  it('the replay stays deterministic: the same log gives the same state; two answers in one minute replay in line order', () => {
    const l = log([0, 'good'], [1, 'again'], [1, 'good'])
    expect(cardState(l, { ...s })).toEqual(cardState(l, { ...s }))
    expect(steps(l)).toEqual([true, true, true])
    expect(steps(log([0, 'good'], [1, 'good'], [1, 'again']))).toEqual([true, false, true])
  })

  it('a card in its steps is due now (whatever its minute, also past midnight); the queue and the page count show it; the hover says so', () => {
    expect(isCardDue(t0 + 2 * DAY, t0, true)).toBe(true)
    expect(isCardDue(t0 + 2 * DAY, t0)).toBe(false)
    // Answered one second before midnight: its step ends after midnight, it is still due tonight.
    const late = new Date(2026, 5, 15, 23, 59).getTime()
    const lateLog: CardReview[] = [{ at: cardTime(late), rating: 'again' }]
    expect(cardState(lateLog, s).due).toBeGreaterThanOrEqual(new Date(2026, 5, 16).getTime())
    const page = { path: '/v/a.md', folder: '', cards: [{ id: 'V-1', off: false, next: false, reviews: lateLog }, { id: 'V-2', off: false, next: false, reviews: log([0, 'good'], [1, 'good']) }] }
    expect(cardQueue([page], s, late).map((q) => q.id)).toEqual(['V-1'])
    expect(pageCardCounts(page, s, late).due).toBe(1)
    // Reopened in the same minute: a new card answered once is due again (its second Remembered).
    const once = { path: '/v/b.md', folder: '', cards: [{ id: 'V-3', off: false, next: false, reviews: log([0, 'good']) }] }
    expect(cardQueue([once], s, t0).map((q) => [q.id, q.isNew])).toEqual([['V-3', false]])
    // The buttons of a new card: both keep it in the steps; of a learning card at its last step, Remembered leaves.
    expect(previewAnswers([], s, t0).map((a) => [a.review.rating, a.inSteps, a.interval])).toEqual([['again', true, 0], ['good', true, 0]])
    expect(previewAnswers(log([0, 'good']), s, t0 + 60_000).map((a) => [a.inSteps, a.interval])).toEqual([[true, 0], [false, 4]])
  })
})

describe('the settings (D14)', () => {
  it('defaults to two buttons, 90%, 365 days, 10 new a day, fuzz on and the Mochi weights; each bad field falls back alone', () => {
    expect(sanitizeReviewSettings(undefined)).toEqual({ enabled: true, buttons: 2, retention: 0.9, maxDays: 365, newPerDay: 10, upNextPerDay: null, newOrder: 'oldest', fuzz: true, pauseAfter: 60, timeSoFar: 'hidden', weights: [...DEFAULT_CARD_WEIGHTS] })
    expect(DEFAULT_CARD_WEIGHTS).toHaveLength(21)
    const weights = Array.from({ length: 19 }, (_, i) => i / 10)
    expect(sanitizeReviewSettings({ enabled: false, buttons: 4, retention: 0.85, maxDays: 30, newPerDay: 0, fuzz: false, weights, algorithm: 'upkeep', baseDays: 3 })).toEqual({
      enabled: false,
      buttons: 4,
      retention: 0.85,
      maxDays: 30,
      newPerDay: 0,
      upNextPerDay: null,
      newOrder: 'oldest',
      fuzz: false,
      pauseAfter: 60,
      timeSoFar: 'hidden',
      weights,
    })
    // YAZ-5130: Time so far is hidden, shown or off; anything else is the default, hidden.
    expect(['shown', 'off', 'hidden', 'Shown', true, undefined].map((timeSoFar) => sanitizeReviewSettings({ timeSoFar }).timeSoFar)).toEqual(['shown', 'off', 'hidden', 'hidden', 'hidden', 'hidden'])
    expect(sanitizeReviewSettings({ enabled: 'yes', buttons: 3, retention: 1.5, maxDays: 0.5, newPerDay: -1, newOrder: 'random', fuzz: 1, weights: [1, 2, 3] })).toEqual(sanitizeReviewSettings(null))
    // YAZ-4999 D1, D2: an emptied box is `null`, no limit — a missing field (no file) keeps 10; the order is oldest or newest.
    expect([sanitizeReviewSettings({ newPerDay: null }).newPerDay, sanitizeReviewSettings({}).newPerDay, sanitizeReviewSettings({ newPerDay: '' }).newPerDay]).toEqual([null, 10, 10])
    // YAZ-5028: Up next a day the same way, but a missing field is no limit.
    expect([sanitizeReviewSettings({ upNextPerDay: 3 }).upNextPerDay, sanitizeReviewSettings({ upNextPerDay: null }).upNextPerDay, sanitizeReviewSettings({}).upNextPerDay, sanitizeReviewSettings({ upNextPerDay: -1 }).upNextPerDay, sanitizeReviewSettings({ upNextPerDay: 1.5 }).upNextPerDay]).toEqual([3, null, null, null, null])
    expect([sanitizeReviewSettings({ newOrder: 'newest' }).newOrder, sanitizeReviewSettings({ newOrder: 'NEWEST' }).newOrder]).toEqual(['newest', 'oldest'])
    // YAZ-5033: "Pause the timer after" is one of its four choices, in seconds; anything else is the default, 60 s.
    expect([30, 60, 120, 300, 45, '60', 0, -30, null, 60.5].map((pauseAfter) => sanitizeReviewSettings({ pauseAfter }).pauseAfter)).toEqual([30, 60, 120, 300, 60, 60, 60, 60, 60, 60])
    expect(sanitizeReviewSettings({}).pauseAfter).toBe(60)
    expect(sanitizeReviewSettings({ weights: [...DEFAULT_CARD_WEIGHTS.slice(0, 20), Number.NaN] }).weights).toEqual([...DEFAULT_CARD_WEIGHTS])
  })
})

describe('YAZ-5037: "Review this page" and "Review this folder" include the cards their pages embed, each card one time', () => {
  const now = new Date(2026, 10, 13, 12, 0).getTime()
  const card = (id: string) => ({ id, off: false, next: false, reviews: [] as CardReview[] })
  const s = { ...DEFAULT_REVIEW_SETTINGS, newPerDay: null }
  // geo/europe.md holds GEO-1 and embeds GEO-140 (a card file) and GEO-2 (its own card); pages/plan.md embeds GEO-140
  // and GEO-7 (a card in another folder's page); GEO-140 is a card file in cards/; other/x.md holds GEO-7 and GEO-8.
  const records = [
    { path: '/v/cards/capital-of-france-geo-140.md', folder: 'cards', kind: 'card' as const, cards: [card('GEO-140')], embeds: [] },
    { path: '/v/geo/europe.md', folder: 'geo', cards: [card('GEO-1'), card('GEO-2')], embeds: ['GEO-140', 'geo-2', 'Some page'] },
    { path: '/v/pages/plan.md', folder: 'pages', embeds: ['GEO-140', 'GEO-7'] },
    { path: '/v/pages/deep/more.md', folder: 'pages/deep', embeds: ['geo-140|its title', 'GEO-404'] },
    { path: '/v/other/x.md', folder: 'other', cards: [card('GEO-7'), card('GEO-8')], embeds: [] },
  ]
  const ids = (folder: string, page?: string) => cardQueue(records, s, now, folder, page, ['GEO']).map((c) => c.id)

  it('a page: its own cards, then the cards it embeds (by ID, any case); a card on the page and embedded there is one', () => {
    expect(ids('', '/v/geo/europe.md').sort()).toEqual(['GEO-1', 'GEO-140', 'GEO-2'])
    // A page with no card of its own that embeds two: both, from where they live, new cards by ID number.
    expect(cardQueue(records, s, now, '', '/v/pages/plan.md', ['GEO'])).toEqual([
      expect.objectContaining({ id: 'GEO-7', path: '/v/other/x.md', index: 0 }),
      expect.objectContaining({ id: 'GEO-140', path: '/v/cards/capital-of-france-geo-140.md', index: 0 }),
    ])
  })

  it('a folder: its pages\' cards and every card they embed, a card embedded on 3 pages one time; an ID no card has adds nothing', () => {
    expect(ids('pages').sort()).toEqual(['GEO-140', 'GEO-7'])
    expect(ids('geo').sort()).toEqual(['GEO-1', 'GEO-140', 'GEO-2'])
    expect(ids('pages/deep')).toEqual(['GEO-140'])
  })

  it('the vault and its counts do not change: every card one time; the new-card limit is the vault\'s', () => {
    expect(ids('').sort()).toEqual(['GEO-1', 'GEO-140', 'GEO-2', 'GEO-7', 'GEO-8'])
    const limited = { ...s, newPerDay: 1 }
    // A card begun today elsewhere uses the vault's one new card: the page review of plan.md gets none of its embeds.
    const begun = [...records, { path: '/v/z.md', folder: '', cards: [{ ...card('GEO-9'), reviews: [{ at: cardTime(now - 60_000), rating: 'good' as const }] }] }]
    expect(cardQueue(begun, limited, now, '', '/v/pages/plan.md', ['GEO'])).toEqual([])
    expect(cardPlan(records, limited, now, '', '/v/pages/plan.md', ['GEO']).more.new).toBe(1)
  })

  it('an archived card stays out, embedded or not', () => {
    const off = records.map((r) => (r.path === '/v/other/x.md' ? { ...r, cards: [{ ...card('GEO-7'), off: true }, card('GEO-8')] } : r))
    expect(cardQueue(off, s, now, '', '/v/pages/plan.md', ['GEO']).map((c) => c.id)).toEqual(['GEO-140'])
  })
})
