/**
 * THE REVIEW FLOW TESTER (YAZ-5708, Yaseen: "I think an AI needs to run some tests to get all the fucking things
 * done"): every Review filter and flow, played by script on a made-up vault, on the Mac (`reviewFlow.test.tsx`: the
 * review hook with the shared screen pieces, `SessionCount`, `SessionBar`, `DoneScreen`) and on the phone
 * (`mobile/src/review/reviewFlow.test.tsx`: the real Review screen on the fake GitHub, read from its DOM). The
 * scenarios and the checks are this one file; each app gives a `FlowDriver`.
 *
 * After EVERY step the tester checks the screen against its own model of the rules (`FlowModel`, written from the
 * consolidated Review rules on YAZ-5655 and Mochi's findings YAZ-5671 1–21 and YAZ-5703 E1–E6, never from the code):
 *  - the numbers: done and total of the open filter (total = done + the cards left, each once: the cards at the
 *    start + 1 per miss waiting, + 1 per new card learned on All cards; All cards carries today's earlier work), done ≤
 *    total;
 *  - the bar: grey = done ÷ total, red = (done + misses waiting) ÷ total; full when nothing is left;
 *  - the red ✕: the open filter's misses waiting (YAZ-5681), hidden at 0 and in Due today's missed pass;
 *  - the menu counts: what is left in each list;
 *  - the card on show: one the rules still have today (never a card done for today: no card twice, except a miss in
 *    its re-check, a new card after ✕, or a learned new card's one same-day review), its chip (New / Due) and "Again";
 *  - the stops of Due today (the % screen, Mochi's words and numbers) exactly when the rules make them, and none on
 *    All cards or New cards; the finish screens' Today line.
 * Each scenario then checks its own end screens, in Mochi's order and words. Made-up cards only.
 */
import type { CardRating } from '@shared/cardLine'
import type { AllCardsOrder, DueTodayOrder } from '@shared/reviews'
import type { CardFilter } from './useCardReview'

// ─── The vault ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A card of a made-up vault: `due` known and due (two ✓ long ago), `new` never answered, `learned` a new card learned
 * earlier today (one ✓ this morning: its same-day review waits), `old` a long Mochi-like history with misses (due),
 * `short` known with review times without seconds (`…T05:24Z good`, YAZ-5673; due), `later` known and not due today,
 * `next` known, due and marked Up next.
 */
export type FlowKind = 'due' | 'new' | 'learned' | 'old' | 'short' | 'later' | 'next'

export interface FlowVault {
  files: Record<string, string>
  /** `.yaseendocs/review.json`. */
  review: Record<string, unknown>
  cards: { id: string; kind: FlowKind; path: string }[]
  now: number
}

const DAY = 86_400_000
/** The card's ID in the vault (a number ID, `FD-1`) for its short name in the scenarios (`D1`), and back. */
export const realId = (short: string): string => `F${short[0]}-${short.slice(1)}`
export const shortId = (id: string): string => id.replace(/^F([A-Z])-(\d+)$/, '$1$2')
const iso = (t: number) => new Date(t).toISOString()

/** The card line after its ID, for `kind`; `i` spreads the due dates (card 0 the most overdue). */
function lineOf(kind: FlowKind, i: number, now: number): string {
  // Each card one day more overdue than the one after it: Due today In order is the cards' order.
  const back = (days: number) => iso(now - (days + 30 - i) * DAY)
  switch (kind) {
    case 'due':
      return `, ${back(60)} good, ${back(50)} good`
    case 'next':
      return `, ${back(60)} good, ${back(50)} good, next`
    case 'new':
      return ''
    case 'learned': {
      const morning = new Date(now)
      morning.setHours(8, i, 0, 0)
      return `, ${iso(morning.getTime())} good 6s`
    }
    case 'old':
      // A Mochi-like history: many months, a lapse, minutes-only times; the last review long ago.
      return `, 2025-03-02T05:24Z good, 2025-03-09T06:10Z good, 2025-04-20T07:00Z again, 2025-04-21T07:30Z good, 2025-06-01T08:00Z good, ${back(200).slice(0, 16)}Z good`
    case 'short':
      return `, ${back(80).slice(0, 16)}Z good, ${back(70).slice(0, 16)}Z good`
    case 'later':
      return `, ${iso(now - 2 * DAY)} good, ${iso(now - DAY)} easy`
  }
}

/**
 * A vault of `spec` (`[kind, how many]`, in order), with `review` settings; cards are named by kind: D1 (due), N1
 * (new), L1 (learned), O1 (old), S1 (short), X1 (later), U1 (Up next). `split` puts every second page in a folder.
 */
export function flowVault(spec: readonly [FlowKind, number][], now: number, review: Record<string, unknown> = {}): FlowVault {
  const letter: Record<FlowKind, string> = { due: 'D', new: 'N', learned: 'L', old: 'O', short: 'S', later: 'X', next: 'U' }
  const cards: FlowVault['cards'] = []
  const blocks: string[] = []
  let i = 0
  for (const [kind, n] of spec)
    for (let k = 1; k <= n; k++, i++) {
      const id = `${letter[kind]}${k}`
      cards.push({ id, kind, path: 'cards.md' })
      blocks.push(`\`\`\`card\nQuestion ${id}?\n---\nAnswer {{${id}}}\n\`\`\`\n<!-- card: ${realId(id)}${lineOf(kind, i, now)} -->`)
    }
  const files = { '.yaseendocs/review.json': JSON.stringify({ fuzz: false, newPerDay: null, dueTodayOrder: 'in-order', ...review }), 'cards.md': `---\ntitle: Cards\n---\n\n# Cards\n\n${blocks.join('\n\n')}\n` }
  return { files, review, cards, now }
}

// ─── What each app shows ─────────────────────────────────────────────────────────────────────────────────────────

/** The screen of the Review, as read from the app: the same for the Mac and the phone. */
export interface FlowView {
  filter: CardFilter
  /** The card on show: its ID, its chip (New card or Due) and whether it wears "Again". */
  card: { id: string; isNew: boolean; again: boolean } | null
  /** The cards menu's counts: what is left in each list; null when the app did not read them this step. */
  menu: Record<CardFilter, number> | null
  /** The top right: the red ✕ K (0 when hidden), "done / total"; null when the app hides it (nothing to count). */
  count: { misses: number; done: number; total: number } | null
  /** The bar's fills, in % of its width. */
  bar: { grey: number; red: number }
  /** A finish screen or Due today's stop, in place of the card. */
  screen: { title: string; lines: string[]; buttons: string[]; today: string } | null
}

/** The classes of a finish screen (`DoneLook`): the Mac's and the phone's. */
export interface FlowLook {
  title: string
  line: string
  today: string
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const firstClass = (c: string) => `.${c.split(' ').filter(Boolean).at(-1)}`

/** The top right, the bar and the finish screen, from the shared pieces both apps draw (`SessionCount`, `SessionBar`, `DoneScreen`). */
export function readShared(root: Element, look: FlowLook, screenBox: Element | null): Pick<FlowView, 'count' | 'bar' | 'screen'> {
  const label = root.querySelector('.session-count')?.getAttribute('aria-label') ?? null
  const m = label === null ? null : /^(?:(\d+) missed, )?(\d+) of (\d+) done$/.exec(label)
  if (label !== null && m === null) throw new Error(`The count's label is not "K missed, d of t done": ${label}`)
  const width = (sel: string) => {
    const w = root.querySelector<HTMLElement>(sel)?.style.width ?? ''
    if (!w.endsWith('%')) throw new Error(`The bar's ${sel} has no % width: "${w}"`)
    return Number(w.slice(0, -1))
  }
  let screen: FlowView['screen'] = null
  if (screenBox !== null) {
    // The % screen's title, else the finish screen's (`DoneCheer` wraps it).
    const title = text(screenBox.querySelector(firstClass(look.title)))
    screen = {
      title,
      lines: [...screenBox.querySelectorAll(firstClass(look.line))].map(text),
      buttons: [...screenBox.querySelectorAll('button')].map(text).filter((t) => t !== ''),
      today: text(screenBox.querySelector(firstClass(look.today))),
    }
  }
  return {
    count: m === null ? null : { misses: m[1] === undefined ? 0 : Number(m[1]), done: Number(m[2]), total: Number(m[3]) },
    bar: { grey: width('.session-bar__grey'), red: width('.session-bar__red') },
    screen,
  }
}

/** One app under test. Every action is what a person does there, and settles before it returns. */
export interface FlowDriver {
  readonly name: 'mac' | 'phone'
  view(): Promise<FlowView>
  /** Answers the card on show (its buttons shown first, as a person does). */
  answer(rating: CardRating): Promise<void>
  /** Undo (the app's own Undo: ⌘Z on the Mac, the hint line's on the phone). */
  undo(): Promise<void>
  /** Picks a filter in the cards menu. */
  filter(filter: CardFilter): Promise<void>
  /** Clicks the finish screen's button whose words start with `words` ("Review missed cards", "Learn new cards"). */
  press(words: string): Promise<void>
  /** Closes the Review and opens it again (the Inbox tab closed, the phone app opened again). */
  reopen(): Promise<void>
  /** ⚙ › Add today: `n` more cards of `kind`, with its ask answered "Add" (YAZ-5690, YAZ-5697). */
  add(kind: 'new' | 'next', n: number): Promise<void>
  /** ⚙ › Order (YAZ-5707). */
  order(order: { all: AllCardsOrder } | { due: DueTodayOrder }): Promise<void>
  /** The other device answers card `id` and its sync lands (rule 34). */
  elsewhere(id: string, rating: CardRating): Promise<void>
  /** The clock moves to `time` (ms) and the app sees it (the midnight timer, or the window back in front). */
  clock(time: number): Promise<void>
  stop(): void
}

// ─── The model: the rules, written down ─────────────────────────────────────────────────────────────────────────

type List = 'due' | 'new' | 'next'

interface MCard {
  id: string
  list: List
  /** wait: not answered (this session); missed: a ✕ waits for its re-check; learned: a new card's same-day review waits. */
  st: 'wait' | 'missed' | 'learned' | 'done'
  /** The last answer was ✕ (the chip "Again"). */
  again: boolean
  /** It had a ✓ before today (the Today line's "reviews"). */
  knownBefore: boolean
  /** All cards' done: its learning (first ✓) and its review (first answer as a due card) today, each once. */
  all: Set<'learn' | 'review'>
  /** This session's done per filter (each filter counts only its own kind of answer). */
  sess: Set<'due' | 'new' | 'next'>
  /** Answered in this session (the % counts a due card's FIRST answer of the session). */
  answered: boolean
  /** Back in this session after an answer (a repeat): learned here, or a ✕ here. */
  repeat: boolean
  /** Learned in this session: its review waits after Due today's pass (it is in no pass). */
  fromNew: boolean
  /** Answered today (the Today line). */
  today: CardRating[]
}

type Stop = { kind: 'missed'; percent: number; missed: number } | { kind: 'done'; missedPass: boolean } | null

export class FlowModel {
  cards = new Map<string, MCard>()
  stage: 'first' | 'missed' | 'over' = 'first'
  stop: Stop = null
  filter: CardFilter = 'all'
  firsts: CardRating[] = []
  private undoStack: string[] = []

  constructor(vault: FlowVault, newPerDay: number | null) {
    let newLeft = newPerDay ?? Infinity
    for (const c of vault.cards) {
      if (c.kind === 'later') continue
      if (c.kind === 'new' && newLeft-- <= 0) continue
      const base = { id: c.id, again: false, sess: new Set<'due' | 'new' | 'next'>(), answered: false, repeat: false, fromNew: false, today: [] as CardRating[] }
      if (c.kind === 'new') this.cards.set(c.id, { ...base, list: 'new', st: 'wait', knownBefore: false, all: new Set() })
      else if (c.kind === 'learned') this.cards.set(c.id, { ...base, list: 'due', st: 'wait', knownBefore: false, all: new Set(['learn']), today: ['good'] })
      else this.cards.set(c.id, { ...base, list: c.kind === 'next' ? 'next' : 'due', st: 'wait', knownBefore: true, all: new Set() })
    }
  }

  private matches = (c: MCard, f: CardFilter) => c.st !== 'done' && (f === 'all' || c.list === f)
  left(f: CardFilter): number {
    return [...this.cards.values()].filter((c) => this.matches(c, f)).length
  }
  done(f: CardFilter): number {
    let n = 0
    for (const c of this.cards.values()) n += f === 'all' ? c.all.size : c.sess.has(f) ? 1 : 0
    return n
  }
  waiting(f: CardFilter): number {
    return [...this.cards.values()].filter((c) => this.matches(c, f) && c.st === 'missed').length
  }
  /** The red ✕ (rule 14, YAZ-5681): the open filter's misses waiting; hidden at 0 and in Due today's missed pass. */
  misses(): number {
    if (this.filter === 'due' && this.stage === 'missed' && this.stop === null) return 0
    return this.waiting(this.filter)
  }
  /** The Today line (YAZ-5684): new cards learned today, and due cards answered today. */
  todayLine(): string {
    const cards = [...this.cards.values()].filter((c) => c.today.length > 0)
    const learned = cards.filter((c) => !c.knownBefore && c.today.some((r) => r !== 'again')).length
    const reviews = cards.filter((c) => c.knownBefore).length
    return learned + reviews === 0 ? '' : `Today: ${learned} learned · ${reviews} review${reviews === 1 ? '' : 's'}`
  }
  card(id: string): MCard {
    const c = this.cards.get(id)
    if (c === undefined) throw new Error(`The app showed ${id}, a card the rules do not have today`)
    return c
  }

  private snapshot(): string {
    const cards = [...this.cards.values()].map((c) => ({ ...c, all: [...c.all], sess: [...c.sess] }))
    return JSON.stringify({ cards, stage: this.stage, stop: this.stop, filter: this.filter, firsts: this.firsts })
  }
  private restore(s: string): void {
    const o = JSON.parse(s) as { cards: (Omit<MCard, 'all' | 'sess'> & { all: MCard['all'] extends Set<infer T> ? T[] : never; sess: ('due' | 'new' | 'next')[] })[]; stage: FlowModel['stage']; stop: Stop; filter: CardFilter; firsts: CardRating[] }
    this.cards = new Map(o.cards.map((c) => [c.id, { ...c, all: new Set(c.all), sess: new Set(c.sess) }]))
    this.stage = o.stage
    this.stop = o.stop
    this.filter = o.filter
    this.firsts = o.firsts
  }

  /** The rules of one answer (rules 6–10, 15, 18; Mochi findings 3–7, 11, 15, E5). */
  answer(id: string, rating: CardRating): void {
    this.undoStack.push(this.snapshot())
    const c = this.card(id)
    const wasList = c.list
    const ok = rating !== 'again'
    c.today.push(rating)
    if (c.list === 'new' || (c.list === 'next' && !c.knownBefore && c.all.size === 0)) {
      // A new card (an Up next one too): ✕ moves nothing (rule 8); its first ✓ is done +1 and joins today's reviews (rule 9).
      c.again = !ok
      c.repeat = true
      if (ok) {
        c.all.add('learn')
        c.sess.add(wasList === 'next' ? 'next' : 'new')
        c.list = 'due'
        c.st = 'learned'
        c.fromNew = true
      } else c.list = 'new'
    } else {
      // A due card: its first answer is done +1 (rule 15); ✕ → Review missed cards (rule 7), ✓ done for today (rule 6).
      if (!c.answered && !c.fromNew) this.firsts.push(rating)
      c.all.add('review')
      c.sess.add(wasList === 'next' ? 'next' : 'due')
      c.again = !ok
      if (ok) c.st = 'done'
      else {
        c.st = 'missed'
        c.repeat = true
        if (wasList === 'next') c.list = 'due'
      }
    }
    c.answered = true
    this.stop = this.filter === 'due' && wasList === 'due' ? this.dueStop() : null
  }

  /** Due today's stops (rules 20–21; Mochi findings 7–10): the first pass done with a miss: the % screen; all done: the finish. */
  private dueStop(): Stop {
    if (this.stage === 'over') return null
    // The pass is every card of Due today, a learned card's same-day review too (Mochi: "Review cards 4" is one run);
    // it is done when only misses wait.
    const pass = [...this.cards.values()].filter((c) => c.st !== 'done' && c.list === 'due')
    if (pass.some((c) => c.st !== 'missed')) return null
    const missed = [...this.cards.values()].filter((c) => c.st === 'missed' && c.list === 'due' && c.answered).length
    if (this.stage === 'first' && missed > 0 && this.firsts.includes('again')) {
      this.stage = 'missed'
      const remembered = this.firsts.filter((r) => r !== 'again').length
      return { kind: 'missed', percent: Math.min(99, Math.round((100 * remembered) / this.firsts.length)), missed }
    }
    if (pass.length > 0) return null
    const missedPass = this.stage === 'missed'
    this.stage = 'over'
    return { kind: 'done', missedPass: missedPass || this.firsts.includes('again') }
  }

  undo(): void {
    const s = this.undoStack.pop()
    if (s === undefined) throw new Error('Nothing to undo in the model')
    this.restore(s)
    this.stop = null
  }
  setFilter(f: CardFilter): void {
    this.filter = f
    this.stop = null
  }
  goOn(): void {
    this.stop = null
  }
  /** The Review closed and opened again (rule 12, E5): today's work carries on All cards; a session starts afresh. */
  reopen(): void {
    for (const c of this.cards.values()) {
      if (c.st === 'done') {
        // Out of the run: done for today, so it counts no more (YAZ-5707: the run carries its own cards' work).
        c.all.clear()
        c.sess.clear()
        continue
      }
      c.sess.clear()
      c.answered = false
      c.fromNew = false
      // A miss waiting stays a miss waiting (rules 7, 18: it is let go by its ✓ in the re-check).
      c.repeat = c.st === 'missed'
      if (c.st === 'learned') c.st = 'wait'
    }
    this.undoStack = []
    this.stage = 'first'
    this.stop = null
    this.filter = 'all'
    this.firsts = []
  }
  /** The other device answered card `id` (rule 34, YAZ-5622): done for today there leaves; a ✕ keeps it due; a new card begun is due. */
  elsewhere(id: string, rating: CardRating): void {
    this.undoStack = []
    const c = this.cards.get(id)
    if (c === undefined) return
    c.today.push(rating)
    if (c.list === 'new') {
      if (rating !== 'again') {
        c.list = 'due'
        c.fromNew = true
      }
    } else if (rating !== 'again' && c.st !== 'missed') c.st = 'done'
  }
  /** Past local midnight (rule 35): a new day for the Today line; a card answered yesterday is known now. */
  newDay(): void {
    for (const c of this.cards.values()) {
      c.knownBefore ||= c.today.some((r) => r !== 'again')
      c.today = []
    }
  }
  /** Cards added today (⚙ › Add today): new cards at the end of New cards. */
  added(ids: readonly string[], list: List): void {
    this.undoStack.push(this.snapshot())
    for (const id of ids) this.cards.set(id, { id, list, st: 'wait', again: false, knownBefore: list !== 'new', all: new Set(), sess: new Set(), answered: false, repeat: false, fromNew: false, today: [] })
  }
}

// ─── The tester: a driver, the model, and the checks after every step ─────────────────────────────────────────

export class FlowTester {
  readonly log: string[] = []
  /** Every screen in place of the card, in order (its title): Mochi's order. */
  readonly screens: string[] = []
  /** The cards shown in order (their first view after each step). */
  readonly shown: string[] = []
  /** The top right after each step ("✕ 1 · 9 / 11"). */
  readonly tops: string[] = []
  last: FlowView | null = null

  constructor(
    readonly d: FlowDriver,
    readonly m: FlowModel,
  ) {}

  private fail(rule: string, detail: unknown): never {
    throw new Error(`YAZ-5708 ${this.d.name}: ${rule}\n${JSON.stringify(detail)}\nsteps:\n${this.log.slice(-30).join('\n')}`)
  }

  /** The checks after every step. */
  async check(step: string): Promise<FlowView> {
    const v = await this.d.view()
    if (v.card !== null) v.card = { ...v.card, id: shortId(v.card.id) }
    const m = this.m
    const f = m.filter
    const model = { filter: f, done: m.done(f), total: m.done(f) + m.left(f), waiting: m.waiting(f), misses: m.misses(), menu: { all: m.left('all'), due: m.left('due'), new: m.left('new'), next: m.left('next') }, stop: m.stop }
    this.log.push(`${step} | ${v.card === null ? `[${v.screen?.title}]` : `${v.card.id}${v.card.isNew ? '*' : ''}${v.card.again ? '↺' : ''}`} ${v.count === null ? '–' : `${v.count.misses > 0 ? `✕${v.count.misses} ` : ''}${v.count.done}/${v.count.total}`} grey ${Math.round(v.bar.grey)} red ${Math.round(v.bar.red)} menu ${v.menu === null ? '–' : `${v.menu.all}/${v.menu.due}/${v.menu.new}/${v.menu.next}`} · model ${model.misses > 0 ? `✕${model.misses} ` : ''}${model.done}/${model.total} ${model.menu.all}/${model.menu.due}/${model.menu.new}/${model.menu.next}`)
    if (v.filter !== f) this.fail('the filter is the one picked', { app: v.filter, model: f })
    // The menu counts are what is left (Mochi findings 4–6).
    for (const k of ['all', 'due', 'new', 'next'] as const) if (v.menu !== null && v.menu[k] !== model.menu[k]) this.fail(`the menu's ${k} count is what is left`, { app: v.menu, model: model.menu })
    // The numbers (rules 15–18). The app may hide the count only while nothing is counted.
    if (v.count === null) {
      if (model.total > 0) this.fail('the count shows while there is something to count', { model })
    } else {
      if (v.count.done !== model.done || v.count.total !== model.total) this.fail('done / total as the rules count them (rules 15–18)', { app: v.count, model })
      if (v.count.done > v.count.total) this.fail('done ≤ total', v.count)
      if (v.count.misses !== model.misses) this.fail('the red ✕ is the open filter`s misses waiting, hidden in the missed pass (rule 14, 17)', { app: v.count.misses, model: model.misses })
    }
    // The bar (rule 19, Mochi finding 14): grey = done ÷ total, red = (done + waiting) ÷ total.
    const pct = (n: number) => (model.total <= 0 ? 0 : Math.min(100, (100 * n) / model.total))
    if (Math.abs(v.bar.grey - pct(model.done)) > 0.01 || Math.abs(v.bar.red - pct(model.done + model.waiting)) > 0.01) this.fail('the bar: grey = done ÷ total, red = (done + misses) ÷ total', { app: v.bar, want: { grey: pct(model.done), red: pct(model.done + model.waiting) } })
    if (v.card === null && m.left(f) === 0 && model.total > 0 && v.bar.grey < 100) this.fail('the bar is full when nothing is left', v.bar)
    // The card on show: one the rules still have today, of the open filter, with its chip and "Again".
    if (v.card !== null) {
      if (model.stop !== null) this.fail('a stop of Due today shows in place of the card', { stop: model.stop, card: v.card })
      const c = m.card(v.card.id)
      if (c.st === 'done') this.fail('no card twice: a card done for today never shows again', { id: c.id })
      if (f !== 'all' && c.list !== f) this.fail('the card on show is of the open filter', { id: c.id, list: c.list, filter: f })
      if (v.card.isNew !== (c.list === 'new' || (c.list === 'next' && !c.knownBefore && c.all.size === 0))) this.fail('the chip says New for a new card, Due for the others', { card: v.card, list: c.list })
      if (v.card.again !== c.again) this.fail('"Again" on a card back after ✕ only', { card: v.card, again: c.again })
      if (this.shown.at(-1) !== v.card.id) this.shown.push(v.card.id)
    } else {
      if (v.screen === null) this.fail('something shows: a card or a screen', v)
      if (this.screens.at(-1) !== v.screen!.title) this.screens.push(v.screen!.title)
      // Due today's stops exactly when the rules make them; never on All cards or New cards (rule 12, E5).
      const stop = model.stop
      const pctScreen = /^You remembered \d+% of cards\.$/.test(v.screen!.title)
      if (pctScreen !== (stop?.kind === 'missed')) this.fail('the % screen shows exactly at the end of Due today`s first pass with a miss (rule 20)', { screen: v.screen, stop })
      if (stop?.kind === 'missed') {
        if (v.screen!.title !== `You remembered ${stop.percent}% of cards.`) this.fail('the % counts each due card`s first answer (rule 20)', { screen: v.screen!.title, stop })
        if (v.screen!.lines[0] !== "Now let's review the cards you missed again." || v.screen!.buttons.join('|') !== `Review missed cards ${stop.missed}`) this.fail('the % screen: Mochi`s words and ONE button, Review missed cards K (rule 20)', v.screen)
      } else if (stop?.kind === 'done') {
        const want = stop.missedPass ? 'Finished reviewing missed cards.' : 'Finished reviewing.'
        if (v.screen!.title !== want) this.fail('Due today done: Mochi`s words (rule 21)', { screen: v.screen!.title, want })
      } else if (m.left(f) > 0) this.fail('no screen while the filter has cards left and no stop is due (All cards never stops: rule 12)', { screen: v.screen, left: m.left(f) })
      // The time after the counts ("· 4 min") is not the rules' (it always shows there, YAZ-5665).
      if (v.screen!.today.replace(/ · \d+ (?:s|min)$/, '') !== m.todayLine()) this.fail('the finish screen`s Today line (rule 25)', { app: v.screen!.today, model: m.todayLine() })
    }
    this.last = v
    this.tops.push(this.top())
    return v
  }

  private async act(step: string, run: () => Promise<void>, model: () => void): Promise<FlowView> {
    await run()
    model()
    return this.check(step)
  }

  start(): Promise<FlowView> {
    return this.check('start')
  }
  /** Answers the card on show. */
  async answer(rating: CardRating, expect?: string): Promise<FlowView> {
    const id = this.last?.card?.id
    if (id === undefined) this.fail('an answer with no card on show', this.last)
    if (expect !== undefined && id !== expect) this.fail(`the card on show is ${expect}`, { shown: id })
    return this.act(`${rating === 'again' ? '✕' : '✓'} ${id}`, () => this.d.answer(rating), () => this.m.answer(id!, rating))
  }
  /** Answers cards until the filter's screen shows: `rate` picks each answer. */
  async answerAll(rate: (id: string, n: number) => CardRating, most = 200): Promise<FlowView> {
    let v = this.last!
    for (let n = 0; v.card !== null; n++) {
      if (n >= most) this.fail('the run never ends', { shown: this.shown.slice(-20) })
      v = await this.answer(rate(v.card.id, n))
    }
    return v
  }
  undo(): Promise<FlowView> {
    return this.act('undo', () => this.d.undo(), () => this.m.undo())
  }
  filter(f: CardFilter): Promise<FlowView> {
    return this.act(`filter ${f}`, () => this.d.filter(f), () => this.m.setFilter(f))
  }
  /** A finish screen's button: Review missed cards (goes on), Learn new cards (→ New cards), Review cards (→ Due today). */
  press(words: 'Review missed cards' | 'Learn new cards' | 'Review cards'): Promise<FlowView> {
    const v = this.last
    if (v?.screen === null || v === null || !v.screen.buttons.some((b) => b.startsWith(words))) this.fail(`the screen has "${words}"`, v?.screen)
    return this.act(`press ${words}`, () => this.d.press(words), () => (words === 'Review missed cards' ? this.m.goOn() : this.m.setFilter(words === 'Learn new cards' ? 'new' : 'due')))
  }
  reopen(): Promise<FlowView> {
    return this.act('reopen', () => this.d.reopen(), () => this.m.reopen())
  }
  add(kind: 'new' | 'next', ids: readonly string[]): Promise<FlowView> {
    return this.act(`add ${ids.length} ${kind}`, () => this.d.add(kind, ids.length), () => this.m.added(ids, kind))
  }
  order(o: { all: AllCardsOrder } | { due: DueTodayOrder }): Promise<FlowView> {
    return this.act(`order ${JSON.stringify(o)}`, () => this.d.order(o), () => undefined)
  }
  elsewhere(id: string, rating: CardRating): Promise<FlowView> {
    return this.act(`elsewhere ${rating} ${id}`, () => this.d.elsewhere(realId(id), rating), () => this.m.elsewhere(id, rating))
  }
  clock(time: number): Promise<FlowView> {
    const day = new Date().toDateString()
    return this.act(`clock ${new Date(time).toString().slice(16, 24)}`, () => this.d.clock(time), () => (new Date(time).toDateString() !== day ? this.m.newDay() : undefined))
  }
  /** "✕ K · done / total" of the top right now, as a short string ("✕ 1 · 9 / 11"). */
  top(): string {
    const c = this.last?.count
    return c === null || c === undefined ? '–' : `${c.misses > 0 ? `✕ ${c.misses} · ` : ''}${c.done} / ${c.total}`
  }
  /** The kind of each card shown, in order: D (due), N (new), L, … by ID letter. */
  kinds(): string {
    return this.shown.map((id) => id[0]).join('')
  }
}

// ─── The scenarios: each on the Mac and the phone ────────────────────────────────────────────────────────────

export interface FlowScenario {
  name: string
  vault: (now: number) => FlowVault
  run: (t: FlowTester, now: number) => Promise<void>
}

/** A failed expectation of a scenario (the tester's log comes with it). */
/** JSON with each object's keys sorted: `{ all, due }` and `{ due, all }` are the same. */
const sorted = (x: unknown): string => JSON.stringify(x, (_, v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v))

function want(t: FlowTester, what: string, got: unknown, wanted: unknown): void {
  if (sorted(got) !== sorted(wanted)) throw new Error(`YAZ-5708 ${t.d.name}: ${what}\n got:  ${JSON.stringify(got)}\n want: ${JSON.stringify(wanted)}\nsteps:\n${t.log.slice(-30).join('\n')}`)
}

const miss = (ids: readonly string[]) => (id: string) => (ids.includes(id) ? 'again' : 'good')
/** ✕ only the first time a card shows. */
const missOnce = (ids: readonly string[]) => {
  const seen = new Set<string>()
  return (id: string): CardRating => {
    const first = !seen.has(id)
    seen.add(id)
    return first && ids.includes(id) ? 'again' : 'good'
  }
}

export const FLOW_SCENARIOS: FlowScenario[] = [
  {
    name: 'Due today with misses: the % stop, Review missed cards, then Learn new cards and Inbox complete (In order)',
    vault: (now) => flowVault([['due', 5], ['new', 2]], now),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answerAll(missOnce(['D2', 'D4']))
      want(t, 'the first pass in order, then the % screen', [t.shown.join(' '), t.screens.at(-1), t.top()], ['D1 D2 D3 D4 D5', 'You remembered 60% of cards.', '✕ 2 · 5 / 7'])
      await t.press('Review missed cards')
      want(t, 'the missed pass: ✕ hidden, done stays (Mochi finding 9)', t.top(), '5 / 7')
      await t.answer('again', 'D2')
      want(t, 'a ✕ in the missed pass moves nothing (rule 18)', t.top(), '5 / 7')
      await t.answerAll(() => 'good')
      want(t, 'the missed pass ends: Mochi`s words, Learn new cards 2', [t.screens.at(-1), t.last!.screen!.lines[0], t.last!.screen!.buttons[0]], ['Finished reviewing missed cards.', 'How about learning some new cards?', 'Learn new cards 2'])
      await t.press('Learn new cards')
      await t.answerAll(missOnce(['N1']))
      want(t, 'new cards done: Finished learning cards · Review cards 2', [t.screens.at(-1), t.last!.screen!.buttons[0]], ['Finished learning cards.', 'Review cards 2'])
      await t.press('Review cards')
      await t.answerAll(() => 'good')
      want(t, 'the learned cards reviewed: Inbox complete.', t.screens.at(-1), 'Inbox complete.')
      want(t, 'the screens in Mochi`s order', t.screens, ['You remembered 60% of cards.', 'Finished reviewing missed cards.', 'Finished learning cards.', 'Inbox complete.'])
    },
  },
  {
    name: 'Due today Shuffle (the default, Mochi E6): the same numbers and stops in a random order',
    vault: (now) => flowVault([['due', 6]], now, { dueTodayOrder: 'shuffle' }),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answerAll(missOnce(['D1']))
      want(t, 'six cards, each once, then the % screen', [new Set(t.shown).size, t.screens.at(-1)], [6, 'You remembered 83% of cards.'])
      await t.press('Review missed cards')
      await t.answerAll(() => 'good')
      want(t, 'then Finished reviewing missed cards (no new cards: Inbox complete follows on its own)', t.screens.at(-1), 'Finished reviewing missed cards.')
    },
  },
  {
    name: 'Due today with no miss: no % screen, "Finished reviewing." then Learn new cards',
    vault: (now) => flowVault([['due', 3], ['new', 1]], now),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answerAll(() => 'good')
      want(t, 'Finished reviewing. · Learn new cards 1', [t.screens, t.last!.screen!.buttons[0]], [['Finished reviewing.'], 'Learn new cards 1'])
    },
  },
  {
    name: 'All cards, Due first: one run, never stops; learned cards` same-day reviews, then the misses at the end, then Inbox complete',
    vault: (now) => flowVault([['due', 4], ['new', 3]], now),
    async run(t) {
      await t.start()
      want(t, 'the start: 7 cards', t.top(), '0 / 7')
      await t.answerAll(missOnce(['D2', 'N1']))
      want(t, 'due first, then new; the learned reviews; the missed card last', t.shown.join(' '), 'D1 D2 D3 D4 N1 N2 N3 N1 N2 N3 N1 D2')
      want(t, 'one screen only, the bar full', [t.screens, t.top(), t.last!.bar], [['Inbox complete.'], '10 / 10', { grey: 100, red: 100 }])
    },
  },
  {
    name: 'All cards, Shuffle: due and new mixed, the same rules, and E5`s run (2 learned earlier: 2 / 7 … ✕ 1 · 9 / 11 … 10 / 10)',
    vault: (now) => flowVault([['learned', 2], ['new', 3]], now, { allCardsOrder: 'shuffle' }),
    async run(t) {
      await t.start()
      want(t, 'E5: the two learned earlier count as done (2 / 7)', [t.top(), t.last!.menu], ['2 / 7', { all: 5, due: 2, new: 3, next: 0 }])
      // E5's answers by card: N1 ✕ ✓, its review ✕, its re-check ✓; N2 ✕ ✓ ✓; N3 ✓ ✓; L1 ✓; L2 ✓.
      const plan: Record<string, CardRating[]> = { N1: ['again', 'good', 'again', 'good'], N2: ['again', 'good', 'good'], N3: ['good', 'good'], L1: ['good'], L2: ['good'] }
      await t.answerAll((id) => {
        const r = plan[id].shift()
        if (r === undefined) throw new Error(`${id} shown once more than E5`)
        return r
      })
      const peak = Math.max(...t.tops.map((x) => Number(/\/ (\d+)$/.exec(x)?.[1] ?? 0)))
      want(t, 'E5: each card as often as in Mochi, the total up to 11, ✕ 1 once, 10 / 10 and Inbox complete', [Object.values(plan).every((l) => l.length === 0), peak, t.tops.some((x) => x.startsWith('✕ 1 · ')), t.top(), t.screens], [true, 11, true, '10 / 10', ['Inbox complete.']])
    },
  },
  {
    name: 'New cards: Forgot moves nothing and comes back; Remembered joins today`s reviews; Finished learning cards',
    vault: (now) => flowVault([['due', 1], ['new', 3]], now),
    async run(t) {
      await t.start()
      await t.filter('new')
      want(t, 'New cards 0 / 3', t.top(), '0 / 3')
      await t.answer('again', 'N1')
      want(t, 'Forgot on a new card: nothing moves (Mochi finding 3)', [t.top(), t.last!.menu?.new], ['0 / 3', 3])
      await t.answer('good', 'N2')
      want(t, 'Remembered: 1 / 3, New −1, Due today +1 (finding 4)', [t.top(), t.last!.menu], ['1 / 3', { all: 4, due: 2, new: 2, next: 0 }])
      await t.answerAll(() => 'good')
      want(t, 'N1 back after its ✕; then Finished learning cards · Review cards 4', [t.shown.slice(1).join(' '), t.screens.at(-1), t.last!.screen!.buttons[0]], ['N1 N2 N3 N1', 'Finished learning cards.', 'Review cards 4'])
      await t.press('Review cards')
      await t.answerAll(missOnce(['N3']))
      // One Due today pass of D1 and the three learned cards (Mochi's "Review cards 4"), N3's re-check, then its end
      // (no % screen: a learned card's review is no first answer, and D1 was right).
      want(t, 'Review cards 4 is one Due today pass', [[...new Set(t.shown.slice(-5))].sort().join(' '), t.screens.slice(-2)], ['D1 N1 N2 N3', ['Finished learning cards.', 'Finished reviewing.']])
    },
  },
  {
    name: 'Filter switches mid-run: each filter keeps its numbers; the ✕ follows the open filter',
    vault: (now) => flowVault([['due', 4], ['new', 3]], now),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answer('again', 'D1')
      await t.answer('good', 'D2')
      await t.filter('new')
      want(t, 'New cards: no ✕ (YAZ-5681)', t.top(), '0 / 3')
      await t.answer('good', 'N1')
      await t.filter('all')
      want(t, 'All cards: its own numbers, ✕ 1', t.top(), '✕ 1 · 3 / 9')
      await t.filter('due')
      want(t, 'Due today again: its numbers survived', t.top(), '✕ 1 · 2 / 6')
      await t.answerAll(() => 'good')
      await t.press('Review missed cards')
      await t.filter('all')
      want(t, 'All cards during Due today`s missed pass: its ✕ shows', t.top(), '✕ 1 · 6 / 9')
      await t.answerAll(() => 'good')
      want(t, 'Inbox complete on All cards', t.screens.at(-1), 'Inbox complete.')
    },
  },
  {
    name: 'Due today finished, then All cards and New cards: the red ✕ shows there again (YAZ-4965 a, YAZ-5681)',
    vault: (now) => flowVault([['due', 2], ['new', 2]], now),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answerAll(missOnce(['D1']))
      await t.press('Review missed cards')
      await t.answerAll(() => 'good')
      await t.press('Learn new cards')
      await t.answer('good', 'N1')
      await t.filter('all')
      await t.answer('good', 'N2')
      // N1's same-day review, missed on All cards: a miss waiting there.
      await t.answer('again', 'N1')
      want(t, 'All cards after Due today finished: ✕ 1', t.top(), '✕ 1 · 5 / 7')
      await t.answerAll(() => 'good')
    },
  },
  {
    name: 'Undo at every kind of step: due ✓, due ✕, new ✕, new ✓, the % stop, the missed pass, a learned card`s review',
    vault: (now) => flowVault([['due', 3], ['new', 2]], now),
    async run(t) {
      await t.start()
      await t.filter('due')
      await t.answer('good', 'D1')
      await t.undo()
      want(t, 'Undo of a ✓: D1 again, 0 / 3', [t.last!.card?.id, t.top()], ['D1', '0 / 3'])
      await t.answer('again', 'D1')
      await t.undo()
      await t.answer('again', 'D1')
      await t.answer('good', 'D2')
      await t.answer('good', 'D3')
      want(t, 'the % screen', t.screens.at(-1), 'You remembered 67% of cards.')
      await t.undo()
      want(t, 'Undo on the % screen: D3 again, no screen', [t.last!.card?.id, t.top()], ['D3', '✕ 1 · 2 / 4'])
      await t.answer('good', 'D3')
      await t.press('Review missed cards')
      await t.answer('good', 'D1')
      await t.undo()
      want(t, 'Undo in the missed pass: D1 again, the total back (rule 18)', [t.last!.card?.id, t.top()], ['D1', '3 / 4'])
      await t.answer('good', 'D1')
      await t.press('Learn new cards')
      await t.answer('again', 'N1')
      await t.undo()
      await t.answer('good', 'N1')
      await t.undo()
      want(t, 'Undo of a new card`s ✓: back to New, Due today −1', [t.last!.card?.id, t.last!.menu], ['N1', { all: 2, due: 0, new: 2, next: 0 }])
      await t.answerAll(() => 'good')
      await t.press('Review cards')
      await t.answer('again')
      await t.undo()
      await t.answerAll(() => 'good')
    },
  },
  {
    name: 'Add today (⚙, with its ask) mid-run and from the finish screen; Up next and its Add today',
    vault: (now) => flowVault([['next', 1], ['due', 1], ['new', 4]], now, { newPerDay: 1 }),
    async run(t) {
      await t.start()
      want(t, 'Up next first; New cards a day 1', [t.last!.menu, t.last!.card?.id], [{ all: 3, due: 1, new: 1, next: 1 }, 'U1'])
      await t.add('new', ['N2', 'N3'])
      want(t, 'two more new cards today', t.last!.menu, { all: 5, due: 1, new: 3, next: 1 })
      await t.answerAll(() => 'good')
      want(t, 'Inbox complete; one new card waits', t.screens.at(-1), 'Inbox complete.')
    },
  },
  {
    name: 'The Inbox closed and opened again mid-run: All cards carries today`s work, a miss waiting stays a miss',
    vault: (now) => flowVault([['due', 3], ['new', 2]], now),
    async run(t) {
      await t.start()
      await t.answer('again', 'D1')
      await t.answer('good', 'D2')
      await t.reopen()
      // The run carries its own cards' work (YAZ-5707): D1's miss (1); D2 is done for today and out of the run.
      want(t, 'opened again: the miss still waits, ✕ 1', t.top(), '✕ 1 · 1 / 5')
      await t.answerAll(() => 'good')
      want(t, 'the run ends full; D1 counted once', [t.top(), t.screens.at(-1)], ['6 / 6', 'Inbox complete.'])
    },
  },
  {
    name: 'A card from the other device joins or leaves the open session (rule 34, YAZ-5622)',
    vault: (now) => flowVault([['due', 4], ['new', 2]], now),
    async run(t) {
      await t.start()
      await t.answer('good', 'D1')
      await t.elsewhere('D3', 'good')
      await t.elsewhere('N2', 'good')
      await t.elsewhere('D4', 'again')
      await t.answerAll(() => 'good')
      want(t, 'D3 never shows here; Inbox complete', [t.shown.includes('D3'), t.screens.at(-1)], [false, 'Inbox complete.'])
    },
  },
  {
    name: 'Old Mochi-like histories and times without seconds: due, counted and answered as any card',
    vault: (now) => flowVault([['old', 2], ['short', 2], ['later', 1], ['new', 1]], now),
    async run(t) {
      await t.start()
      want(t, 'four due, one new, the later card not today', t.last!.menu, { all: 5, due: 4, new: 1, next: 0 })
      await t.filter('due')
      await t.answerAll(missOnce(['O1']))
      await t.press('Review missed cards')
      await t.answerAll(() => 'good')
      await t.press('Learn new cards')
      await t.answerAll(() => 'good')
    },
  },
  {
    name: 'Midnight during a run: the run goes on; opened again, the new day',
    vault: (now) => flowVault([['due', 3], ['new', 1]], now),
    async run(t, now) {
      const late = new Date(now)
      late.setHours(23, 58, 0, 0)
      await t.start()
      await t.clock(late.getTime())
      await t.answer('good', 'D1')
      await t.answer('again', 'D2')
      const after = new Date(late)
      after.setHours(24, 1, 0, 0)
      await t.clock(after.getTime())
      await t.answer('good', 'D3')
      want(t, 'the run goes on past midnight', t.top(), '✕ 1 · 3 / 5')
      await t.answerAll(() => 'good')
      want(t, 'the finish screen counts the new day only', t.last!.screen!.today.startsWith('Today: 1 learned · 2 reviews'), true)
    },
  },
]
