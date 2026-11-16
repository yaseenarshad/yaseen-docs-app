/**
 * YAZ-5614 (checker b of the YAZ-5611 review audit): random sessions, with the rules that must ALWAYS hold checked
 * after every tap. One checker for both apps: the Mac's test (`sessionRules.fuzz.test.tsx`, the hook with the
 * in-memory host) and the phone's (`mobile/src/review/sessionRules.fuzz.test.tsx`, the hook with the phone's real host
 * and answer list) give it a `FuzzDriver`; the vaults, the taps and the rules are the same. Made-up data only.
 *
 * The rules (YAZ-5611 spec 8, 11–14, 18, 19, 22 and Yaseen's rule from Mochi, YAZ-5610):
 *  1. Every answer is saved ONE time: each card's reviews in the files are its first reviews plus the answers the
 *     hook said it wrote (`answer` → true), less the answers Undo took back. A refused answer (a stop on show, a
 *     second tap while the first writes) writes nothing.
 *  2. Review dates only move forward: a card's reviews are in time order, a new review is never before the card's
 *     last one nor after now, and the due date it gives is never before the review.
 *  3. Counts never grow from an answer or from a card shown again: All cards, New cards, Up next and the Inbox
 *     row's count never go up; Due today goes up by one only for a new card's first Remembered (New one less);
 *     "N / M" keeps M (same filter). ← →, the filter, the clock in the day and a stop's button change no count.
 *  4. The numbers agree: Due today + New cards = All cards; the bar's whole is M; the bar's done part plus the
 *     cards left under the filter is M; 1 ≤ N ≤ M while a card shows; the stop "Review missed cards K" comes only
 *     after a Forgot (K ≥ 1, never 100%).
 *  5. Undo of an answer puts the counts back as they were before that answer.
 *  6. Archive takes the card on show out of the session (All cards one less, unless its Up next place brings the next
 *     marked card in).
 *  7. Closed and opened again the same day, the Inbox has the same cards left (All cards).
 */
import { act } from 'react'
import { vi } from 'vitest'
import { cardIdOf, cardReviewsOf, pageCards, type CardRating, type CardReview } from '@shared/cardLine'
import { answerRatings, cardDueAt, type CardAnswer, type DueCard } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { CardFilter, CardReviewApi } from './useCardReview'

/** One app under test: the hook as it runs there, its files as its host reads them, and its index. */
export interface FuzzDriver {
  review(): CardReviewApi
  /** Lets the writes land and the index catch up, as the app does between two taps. */
  settle(): Promise<void>
  /** Every page of the vault now, as the host reads it (path → text). */
  files(): Promise<Record<string, string>>
  records(): readonly IndexRecord[]
  /** The vault's queue now, with this device's day numbers (Up next places taken, Add more). */
  plan(): readonly DueCard[]
  settings: ReviewSettings
  /** The phone: sends the waiting answers now (a signal comes back). Absent on the Mac, which writes the files. */
  send?(): Promise<void>
}

/** A small seeded random (mulberry32): a failing seed runs the same taps again. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000

/** A made-up vault for `seed`: pages of cards of every kind (vault-relative paths) and its `review.json`. */
export function randomVault(seed: number, now: number): { files: Record<string, string>; review: Record<string, unknown> } {
  const rnd = seeded(seed * 7919 + 13)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
  const iso = (t: number) => new Date(t).toISOString()
  // Each card's reviews in time order: one random shift (under an hour) for the whole card.
  let shift = 0
  const ago = (days: number, hours = 0) => iso(now - days * DAY - hours * 3_600_000 - shift)
  const kinds = [
    () => '', // new
    () => '', // new
    () => `, ${ago(40 + Math.floor(rnd() * 40))} good, ${ago(10 + Math.floor(rnd() * 20))} good`, // known, maybe due
    () => `, ${ago(30)} good, ${ago(12)} hard, ${ago(3)} good`,
    () => `, ${ago(5 + Math.floor(rnd() * 5))} again`, // still in its steps
    () => `, ${ago(9)} easy`,
    () => `, ${ago(0, 2)} good`, // begun today
    () => `, ${ago(0, 3)} again, ${ago(0, 2)} good`,
    () => `, ${ago(1, 1)} good, ${ago(1)} good`, // answered yesterday
  ]
  const files: Record<string, string> = {}
  const pages = 2 + Math.floor(rnd() * 3)
  let n = 0
  for (let p = 0; p < pages; p++) {
    const folder = pick(['lang', 'lang/verbs', 'science', ''])
    const cards: string[] = []
    const count = 2 + Math.floor(rnd() * 7)
    for (let c = 0; c < count; c++) {
      n++
      const id = `FZ-${n}`
      shift = Math.floor(rnd() * 50) * 60_000
      let line = `${id}${pick(kinds)()}`
      const extra = rnd()
      if (extra < 0.12) line += ', next'
      else if (extra < 0.17) line += ', off'
      else if (extra < 0.22) line += ', fix'
      cards.push(`\`\`\`card\nQuestion ${n}?\n---\nAnswer {{${n}}}\n\`\`\`\n<!-- card: ${line} -->`)
    }
    const title = `Page ${p + 1}`
    files[`${folder === '' ? '' : `${folder}/`}page-${p + 1}.md`] = `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
  }
  const review = {
    newPerDay: pick([null, 0, 2, 3, 5, 20]),
    upNextPerDay: pick([null, null, 1, 2]),
    buttons: pick([2, 2, 4]),
    fuzz: rnd() < 0.5,
    newOrder: pick(['oldest', 'newest', 'random']),
  }
  return { files, review }
}

interface Snap {
  counts: Record<CardFilter, number>
  total: number
  position: number
  filter: CardFilter
  dueCount: number
  card: { id: string; isNew: boolean; next: boolean; repeat: boolean } | null
  end: string | null
  /** The stop's numbers (YAZ-5043): the % and the missed cards waiting. */
  stop: { percent: number; missed: number } | null
  progress: { done: number; size: number }
}

const snap = (r: CardReviewApi): Snap | null => {
  const s = r.session
  if (s === null) return null
  return {
    counts: { ...s.counts },
    total: s.total,
    position: s.position,
    filter: s.filter,
    dueCount: r.dueCount,
    card: s.card === null ? null : { id: s.card.id, isNew: s.card.isNew, next: s.card.next, repeat: s.card.repeat === true },
    end: s.end?.kind ?? null,
    stop: s.end === null ? null : { percent: s.end.percent, missed: s.end.missed },
    progress: { done: s.progress.done, size: s.progress.size },
  }
}

const reviewKey = (r: CardReview): string => `${r.at} ${r.rating}${r.seconds === undefined ? '' : ` ${r.seconds}s`}`

/** Each card's reviews in the files, by card ID. */
export function reviewsById(files: Record<string, string>): Map<string, CardReview[]> {
  const out = new Map<string, CardReview[]>()
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue
    for (const c of pageCards(content)) {
      const id = cardIdOf(c.line)
      if (id !== null) out.set(id, cardReviewsOf(c.line))
    }
  }
  return out
}

type Tap = 'send' | 'answer' | 'double' | 'undo' | 'undo2' | 'back' | 'next' | 'filter' | 'clock' | 'archive' | 'add-new' | 'add-next' | 'reset' | 'mark' | 'unmark' | 'goOn' | 'reopen' | 'showWait'

const TAPS: [Tap, number][] = [
  ['answer', 46],
  ['double', 4],
  ['showWait', 5],
  ['undo', 8],
  ['undo2', 2],
  ['back', 4],
  ['next', 5],
  ['filter', 5],
  ['clock', 4],
  ['archive', 2],
  ['add-new', 3],
  ['add-next', 2],
  ['reset', 2],
  ['mark', 2],
  ['unmark', 2],
  ['reopen', 3],
  ['send', 3],
]

export interface FuzzResult {
  taps: number
  answers: number
  undone: number
}

/**
 * Runs `taps` random taps on `driver` (a session of the vault is started first) and checks the rules after each one.
 * Throws with the seed and the last taps when a rule breaks.
 */
export async function fuzzSession(driver: FuzzDriver, seed: number, taps: number, now: number): Promise<FuzzResult> {
  const rnd = seeded(seed)
  const weight = TAPS.reduce((a, [, w]) => a + w, 0)
  const pickTap = (): Tap => {
    let x = rnd() * weight
    for (const [t, w] of TAPS) if ((x -= w) < 0) return t
    return 'answer'
  }
  const ratings = answerRatings(driver.settings)
  const log: string[] = []
  const fail = (rule: string, detail: unknown): never => {
    throw new Error(`YAZ-5614 rule broken (seed ${seed}): ${rule}\n${JSON.stringify(detail)}\nlast taps:\n${log.slice(-25).join('\n')}`)
  }
  const r = () => driver.review()
  const step = async (run: () => unknown) => {
    await act(async () => void (await run()))
    await driver.settle()
  }

  // Each card's reviews at the start, and the answers written since (rule 1).
  const first = reviewsById(await driver.files())
  const ledger = new Map<string, CardReview[]>()
  /** This session's answers not taken back, in order: what Undo may take back. */
  let stack: { id: string; review: CardReview; before: Snap; clean: boolean }[] = []
  let answers = 0
  let undone = 0
  /** Cards on show when a tap took them out of today's plan (a mark off, YAZ-5031; a Reset, YAZ-5042): they stay. */
  const kept = new Set<string>()
  /**
   * A mark set or taken off, or an Archive card, in this session: it changes today's plan (a new card marked Up next
   * or archived frees a New cards place) and the open session does not take the card that comes in (open item 2 of
   * the YAZ-5614 result): rule 7 waits.
   */
  let planChanged = false
  let resetUnderStop = false

  const checkFiles = async () => {
    const now = reviewsById(await driver.files())
    for (const [id, had] of first) {
      const want = [...had, ...(ledger.get(id) ?? [])].map(reviewKey)
      const got = (now.get(id) ?? []).map(reviewKey)
      if (want.join('|') !== got.join('|')) fail('1. every answer is saved one time', { id, want, got })
      // Rule 2: in time order, and the due date never before the last review.
      const list = now.get(id) ?? []
      for (let i = 1; i < list.length; i++) if (list[i].at < list[i - 1].at) fail('2. reviews in time order', { id, list })
      const last = list.at(-1)
      if (last !== undefined && (ledger.get(id) ?? []).length > 0) {
        const due = cardDueAt(list, driver.settings)
        if (!(due >= Date.parse(last.at))) fail('2. the due date is never before the review', { id, due: new Date(due).toISOString(), last })
      }
    }
  }
  const checkNumbers = (s: Snap | null, tap: string) => {
    if (s === null) return
    const { counts, total, position, filter, progress } = s
    if (counts.due + counts.new !== counts.all) fail('4. Due today + New cards = All cards', { tap, counts })
    if (counts.next > counts.all || Object.values(counts).some((c) => c < 0)) fail('4. counts in range', { tap, counts })
    if (progress.size !== total) fail('4. the bar`s whole is M', { tap, progress, total })
    if (progress.done + counts[filter] !== total) fail('4. done + left = M', { tap, progress, counts, filter, total })
    if (s.card !== null && s.end === null && (position < 1 || position > total)) fail('4. 1 ≤ N ≤ M', { tap, position, total })
    // The % stop of Due today (spec 15): only after a miss, so never 100% and always one missed card or more.
    if (s.end === 'missed' && (s.stop === null || s.stop.missed < 1 || s.stop.percent >= 100)) fail('4. "Review missed cards" only after a Forgot', { tap, stop: s.stop })
  }
  /** Rule 3: nothing grew. `due` may grow by `dueGrows`; `sameTotal`: M stays (same filter). */
  const noGrowth = (a: Snap | null, b: Snap | null, tap: string, dueGrows = 0, rowMayGrow = false) => {
    if (a === null || b === null) return
    const grew = (k: CardFilter, by = 0) => b.counts[k] > a.counts[k] + by
    if (grew('all') || grew('new') || grew('next') || grew('due', dueGrows)) fail('3. counts never grow', { tap, before: a.counts, after: b.counts })
    if (b.dueCount > a.dueCount + (rowMayGrow ? 1 : 0)) fail('3. the Inbox row`s count never grows', { tap, before: a.dueCount, after: b.dueCount })
    if (a.filter === b.filter && b.total > a.total) fail('3. "N / M" keeps M', { tap, before: `${a.position}/${a.total}`, after: `${b.position}/${b.total}` })
  }
  const same = (a: Snap | null, b: Snap | null, tap: string) => {
    if (a === null || b === null) return
    if (JSON.stringify(a.counts) !== JSON.stringify(b.counts) || a.dueCount !== b.dueCount) fail('3. this tap changes no count', { tap, before: [a.counts, a.dueCount], after: [b.counts, b.dueCount] })
  }

  vi.setSystemTime(now)
  await step(() => r().start())
  log.push(`start ${JSON.stringify(snap(r()))}`)
  checkNumbers(snap(r()), 'start')
  let clock = now
  let done = 0
  for (let i = 0; i < taps; i++, done++) {
    // A person takes a few seconds per card; the clock never passes midnight.
    clock += 2_000 + Math.floor(rnd() * 20_000)
    vi.setSystemTime(clock)
    const s0 = r().session
    if (s0 === null) break
    // A stop of Due today on show: most often its one button, as a person does.
    let tap: Tap = s0.end !== null && rnd() < 0.8 ? 'goOn' : pickTap()
    if (s0.card === null && s0.end === null && (tap === 'answer' || tap === 'double')) tap = rnd() < 0.5 ? 'add-new' : 'reopen'
    const before = snap(r())
    const card = before?.card ?? null
    let line = `${i} ${tap}${card === null ? '' : ` @${card.id}${card.isNew ? '*' : ''}${card.repeat ? '↺' : ''}`}`
    switch (tap) {
      case 'answer':
      case 'double':
      case 'showWait': {
        const rating: CardRating = pick(rnd, ratings)
        let shown: CardAnswer | undefined
        await step(() => {
          shown = r().showAnswers()?.find((a) => a.review.rating === rating)
        })
        const fixed = shown?.review
        if (tap === 'showWait') {
          // The buttons showed, then the person waits before the tap (D13: the time is when they showed).
          clock += 30_000 + Math.floor(rnd() * 300_000)
          vi.setSystemTime(clock)
        }
        const seconds = 1 + Math.floor(rnd() * 30)
        const files0 = reviewsById(await driver.files())
        let results: boolean[] = []
        await step(async () => {
          results = tap === 'double' ? await Promise.all([r().answer(rating, seconds), r().answer(rating, seconds)]) : [await r().answer(rating, seconds)]
        })
        const wrote = results.filter(Boolean).length
        line += ` ${rating} → ${results.join(',')}`
        if (wrote > 1) fail('1. a second tap while the first writes writes nothing', { results })
        if (wrote === 1) {
          if (card === null || fixed === undefined) fail('1. an answer with no card or no buttons', { card, fixed })
          const review = { ...fixed!, seconds }
          const prior = files0.get(card!.id)?.at(-1)
          if (prior !== undefined && review.at <= prior.at) fail('2. a new review is after the card`s last one (never the same time: a time names one review)', { prior, review })
          if (Date.parse(review.at) > Date.now()) fail('2. a review is never after now', { review })
          ledger.set(card!.id, [...(ledger.get(card!.id) ?? []), review])
          // Open item 1: the new card it pushed out does not come back with its Undo.
          stack.push({ id: card!.id, review, before: before!, clean: !planChanged && !(card!.isNew && card!.next && driver.settings.newPerDay !== null) })
          answers++
          const after = snap(r())
          // A card kept on show after its mark went off (or held after a mark change, open item 4) is not in the Inbox
          // row's count: its answer may bring it in.
          noGrowth(before, after, line, card!.isNew && rating !== 'again' ? 1 : 0, kept.has(card!.id) || planChanged)
          // An answer that leaves the card in its steps (a Forgot, a new card's first Remembered) keeps it in the session.
          // OPEN ITEM 1 (YAZ-5614 result, for Yaseen): the first answer to a NEW card of Up next takes a New cards place
          // too, so the last new card of today may leave the session with it (All cards one less): allowed here until
          // Yaseen picks the rule; the `it.fails` "open item 1" in `sessionRules.fuzz.test.tsx` shows it.
          // The same for a new card kept on show past today's new cards (its mark went off on show, YAZ-5031).
          const pushedOut = card!.isNew && (card!.next || kept.has(card!.id)) && driver.settings.newPerDay !== null ? 1 : 0
          // Its Undo does not bring the pushed-out card back; a reopen does (rule 7 waits).
          if (pushedOut === 1) {
            planChanged = true
            dirty(stack)
          }
          // A card kept on show while not due leaves once it is not on show (`settle`): it may go with this answer.
          const keptAway = [...kept].filter((id) => id !== card!.id).length
          if (shown!.inSteps && after !== null && before !== null && after.counts.all < before.counts.all - pushedOut - keptAway) fail('3. a card still in its steps stays in the session (All cards the same)', { line, before: before.counts, after: after.counts, end: after.end, plan: driver.plan().map((c) => c.id), reviews: ledger.get(card!.id), shown })
        } else same(before, snap(r()), line)
        break
      }
      case 'undo':
      case 'undo2': {
        const files0 = reviewsById(await driver.files())
        await step(() => (tap === 'undo2' ? Promise.all([r().undo(), r().undo()]) : r().undo()))
        const files1 = reviewsById(await driver.files())
        const changed = [...files1].filter(([id, list]) => (files0.get(id) ?? []).map(reviewKey).join('|') !== list.map(reviewKey).join('|'))
        if (changed.length > 1) fail('1. one Undo takes back one answer', { changed: changed.map(([id]) => id) })
        if (changed.length === 1) {
          const top = stack.pop()
          const [id] = changed[0]
          if (top === undefined || top.id !== id) fail('1. Undo takes back the LAST answer', { id, top })
          const mine = ledger.get(id)!
          if (reviewKey(mine.at(-1)!) !== reviewKey(top!.review)) fail('1. Undo takes back the last answer`s review', { mine, top })
          ledger.set(id, mine.slice(0, -1))
          undone++
          line += ` → took back ${id}`
          const after = snap(r())
          // Rule 5: the counts as they were before that answer (nothing but ← →, the filter or the clock since).
          if (top!.clean && after !== null && JSON.stringify(after.counts) !== JSON.stringify(top!.before.counts)) fail('5. Undo puts the counts back', { before: top!.before.counts, after: after.counts })
        }
        break
      }
      case 'back':
      case 'next':
        await step(() => r().move(tap === 'back' ? -1 : 1))
        same(before, snap(r()), line)
        if (before !== null && snap(r())!.total !== before.total) fail('3. ← → keep M', { line, before: before.total, after: snap(r())!.total })
        break
      case 'filter': {
        const f = pick(rnd, ['all', 'due', 'new', 'next'] as const)
        line += ` ${f}`
        await step(() => r().setFilter(f))
        same(before, snap(r()), line)
        break
      }
      case 'clock':
        clock += 60_000 + Math.floor(rnd() * 20 * 60_000)
        vi.setSystemTime(clock)
        await step(() => undefined)
        same(before, snap(r()), line)
        break
      case 'send':
        // Sent answers are GitHub's: their Undo is an `unreview` (the phone), never a second copy.
        if (driver.send !== undefined) await step(() => driver.send!())
        same(before, snap(r()), line)
        break
      case 'goOn':
        await step(() => r().goOn())
        if (resetUnderStop && r().session?.card != null) kept.add(r().session!.card!.id)
        resetUnderStop = false
        same(before, snap(r()), line)
        break
      case 'archive': {
        const ok = card !== null && before?.end === null
        await step(() => r().turnOff())
        const after = snap(r())
        // Out of the session; an Up next card's place may go to the next marked card (it joins, YAZ-5031).
        const freesPlace = card?.next === true && driver.settings.upNextPerDay !== null ? 1 : 0
        if (ok && after !== null && before !== null && (after.counts.all > before.counts.all - 1 + freesPlace || after.card?.id === card!.id)) fail('6. Archive takes the card on show out', { line, before: before.counts, after: after.counts })
        planChanged = true
        dirty(stack)
        break
      }
      case 'add-new':
      case 'add-next':
        await step(() => r().addCards(tap === 'add-new' ? 'new' : 'next'))
        dirty(stack)
        break
      case 'reset':
        if (card !== null) kept.add(card.id)
        await step(() => r().resetCards(rnd() < 0.5 ? 'new' : 'next'))
        // The card on show stays though Reset took it out of today: a reopen leaves it out (rule 7 waits).
        planChanged = true
        // Open item 3: a Reset on a stop of Due today keeps the card waiting under the stop as if it were on show.
        if (before?.end != null) resetUnderStop = true
        dirty(stack)
        break
      case 'mark':
      case 'unmark':
        if (card !== null) {
          const path = r().session?.card?.path
          if (path !== undefined) await step(() => r().setNext(path, card.id, tap === 'mark'))
          if (tap === 'unmark') kept.add(card.id)
          planChanged = true
        }
        dirty(stack)
        break
      case 'reopen': {
        await step(() => r().close())
        await step(() => r().start())
        const after = snap(r())
        line += ` → ${after?.counts.all}`
        // Rule 7: the same cards left, the same day.
        if (!planChanged && before !== null && after !== null && after.counts.all !== before.counts.all) fail('7. opened again, the same cards are left', { line, before: before.counts, after: after.counts })
        stack = []
        planChanged = false
        break
      }
    }
    log.push(`${line} | ${JSON.stringify(snap(r()))}`)
    checkNumbers(snap(r()), line)
    await checkFiles()
    // Rule 3 also for the Inbox: a card on show is one the plan of the vault has today (never an off card, never twice).
    const shownCard = r().session?.card
    // Not after a mark change in this session: the Up next places then follow the marks (YAZ-5028), open item 4.
    if (shownCard != null && r().session?.end === null && !planChanged) {
      const plan = driver.plan()
      const found = plan.filter((c) => c.id === shownCard.id)
      if (found.length !== 1 && shownCard.repeat !== true && !kept.has(shownCard.id)) fail('3. the card on show is in today`s plan, one time', { id: shownCard.id, found: found.length, line })
    }
  }
  return { taps: done, answers, undone }
}

/** Anything but ← →, the filter, the clock and a stop's button since an answer: its undo may bring other counts. */
function dirty(stack: { clean: boolean }[]): void {
  for (const s of stack) s.clean = false
}

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]
}
