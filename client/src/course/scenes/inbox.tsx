/**
 * CHAPTER 3, "The Inbox, each day" (YAZ-5121): the daily habit. The storyboard is the comment above each clip in
 * `script.ts`; the cues land on the real voice's words (`marks`, from `timestamps/<clip>.json`). The Inbox is a copy of
 * the app's own (`kit/InboxView.tsx`) on made-up cards; the research moment is the journal Science, 15 February
 * 2008 (Karpicke & Roediger): the issue, the paper, one highlighted line, then 80% against 36% for about the same work.
 */
import type { SceneProps } from '../scene'
import { useUnit } from '../../vault/unitWord'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { InboxIcon } from '../../views/view/icons'
import { PAPERS } from './papers'
import { CANBERRA, CANDID, MOON, PROTEIN, sampleId } from './cards'
import { draftTitle } from './makeCard'
import {
  AppWindow,
  Bars,
  Calendar,
  CardView,
  Cite,
  Fit,
  Gears,
  InboxView,
  JournalCover,
  Layer,
  MenuPreview,
  MiniCard,
  PageText,
  PageView,
  Paper,
  Pointer,
  SidebarPreview,
  Stage,
  TryChip,
  Timeline,
  Words,
  between,
  clamp,
  cue,
  ease,
  lerp,
  moved,
  pop,
  rise,
  showFor,
  since,
  useBeat,
  type Beat,
  type SidebarRow,
} from './kit'
import type { ChapterScenes } from './registry'
import './inbox.css'

/** The card the person made in chapter 2, as "Use this example" makes it. */
const FIRST_FRONT = 'Your body builds and repairs with {{protein}}.'
const FIRST = { title: draftTitle(FIRST_FRONT), id: 'DEMO-10', text: `${FIRST_FRONT}\n---\nAn egg is mostly protein and fat.` }


const PLACE = ['My vault', 'Course Cards']

/** The Inbox's four cards today, in order. */
const TODAY = [
  { title: MOON.title, id: MOON.id },
  { title: CANBERRA.title, id: CANBERRA.id },
  { title: CANDID.title, id: CANDID.id },
  { title: PROTEIN.title, id: PROTEIN.id },
]

/** "✓ Remembered · The Moon's orbit (DEMO-6) · back in 9 days": the app's answer line (`answerLine`). */
const answerLine = (mark: '✓' | '✕', word: string, card: { title: string; id: string }, back: string): string => `${mark} ${word} · ${card.title} (${card.id}) · back ${back}`

const SIDEBAR: SidebarRow[] = [
  { name: 'Course Cards', kind: 'folder', open: true },
  { name: FIRST.title, kind: 'card', depth: 1 },
  { name: 'Projects', kind: 'folder' },
  { name: 'Reading list', kind: 'page' },
]

/** A big keycap on the stage, pressed at `press` (0..1 of its press). */
function BigKey({ beat, label, p, press = 0 }: { beat: Beat; label: string; p: number; press?: number }) {
  const down = press > 0 && press < 1 ? Math.sin(clamp(press) * Math.PI) : 0
  return (
    <span className="kit-bigkey" style={{ opacity: clamp(p), transform: beat.reduced ? undefined : `translateY(${(down * 3).toFixed(2)}px)`, boxShadow: down > 0 ? '0 0 0 3px var(--accent-soft)' : undefined }}>
      {label}
    </span>
  )
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A week as a strip of days: each day lit (0..1), the one ringed `today`, a day `missed`, small cards on days. */
function WeekStrip({ beat, lit = [], today = -1, missed = -1, cards = {}, labels = WEEK }: { beat: Beat; lit?: readonly number[]; today?: number; missed?: number; cards?: Readonly<Record<number, number>>; labels?: readonly string[] }) {
  return (
    <div className="kit-week">
      {labels.map((d, i) => {
        const l = clamp(lit[i] ?? 0)
        const c = clamp(cards[i] ?? 0)
        return (
          <span key={d} className={`kit-week__day${i === today ? ' is-today' : ''}${i === missed ? ' is-missed' : ''}`} style={l > 0 ? { background: `color-mix(in srgb, var(--accent) ${(l * 18).toFixed(1)}%, var(--bg))`, borderColor: `color-mix(in srgb, var(--accent) ${(l * 100).toFixed(0)}%, var(--border))` } : undefined}>
            <b>{d}</b>
            <i className="kit-week__card" style={{ opacity: c, transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(c)) * -10).toFixed(2)}px)` }} />
          </span>
        )
      })}
    </div>
  )
}

/** c3-01: your first card; then the week, day by day: the habit that brings it back. */
function Habit(props: SceneProps) {
  const b = useBeat(props)
  const daily = cue(b, 0, 0.6)
  const back = cue(b, 1, 0.771)
  const lit = WEEK.map((_, i) => since(b, daily + i * 0.04, 0.35))
  const loop = since(b, back, 0.8)
  return (
    <Stage beat={b} label="Your first card, and the week: each day, the Inbox brings it back">
      <Layer>
        <div className="kit-habit">
          <div style={rise(b, since(b, 0, 0.7), 14)}>
            <CardView beat={b} title={FIRST.title} text={FIRST.text} sides={1} chrome="block" id={FIRST.id} className="kit-cardview--small" lit={[showFor(since(b, 0.05, 0.5), since(b, daily, 0.5))]} />
          </div>
          <div style={{ opacity: since(b, daily - 0.04, 0.4) }}>
            <WeekStrip beat={b} lit={lit} cards={Object.fromEntries(WEEK.map((_, i) => [i, since(b, back + i * 0.025, 0.4)]))} />
            <svg className="kit-habit__loop" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
              <path d="M290 4 C 290 26, 10 26, 10 4" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - moved(b, loop)} />
              <path d="M4 10 L10 3 L16 10" opacity={clamp(loop * 3 - 2)} />
            </svg>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-02: cards on many days of a month: which, and when? */
function WhichWhen(props: SceneProps) {
  const b = useBeat(props)
  const days = [2, 3, 5, 8, 9, 11, 13, 16, 17, 19, 22, 24, 26, 29]
  const when = cue(b, 0, 0.705)
  return (
    <Stage beat={b} label="Many cards, on many days: which one, and when?">
      <Layer style={{ opacity: 1 - 0.55 * since(b, when + 0.1, 0.6) }}>
        <Calendar beat={b} today={13} chips={days.map((day, i) => ({ day, p: since(b, 0.05 + i * 0.03, 0.4) }))} draw={since(b, 0, 0.5)} />
      </Layer>
      <Layer>
        <span className="kit-ask" style={pop(b, since(b, when, 0.5), 0.5)}>
          ?
        </span>
      </Layer>
    </Stage>
  )
}

/** c3-03 and c3-04, one span: the app keeps the dates; you open the Inbox; its row in the sidebar, and its number. */
function InboxRow(props: SceneProps) {
  const b = useBeat(props)
  const first = props.clip.id === 'c3-03'
  const open = first ? cue(b, 0, 0.636) : 0
  const daily = first ? cue(b, 1, 0.802) : 0
  const number = first ? 2 : cue(b, 0, 0.439)
  const due = first ? 2 : cue(b, 1, 0.798)
  const rowGlow = first ? since(b, open, 0.4) : 1 - 0.4 * since(b, number, 0.4)
  const cal = first ? showFor(since(b, 0, 0.6), since(b, 0.42, 0.5)) : 0
  const zoom = first ? 0 : since(b, number - 0.05, 0.5)
  const ring = first ? 0 : since(b, number, 0.6)
  return (
    <Stage beat={b} label={first ? 'The app keeps the dates; you open the Inbox each day' : 'The Inbox is in the sidebar; the number beside it is how many cards are due'}>
      <Layer>
        <AppWindow sidebar={<SidebarPreview inbox={4} inboxGlow={rowGlow} rows={SIDEBAR} />} label="The app's sidebar, with the Inbox row on top">
          <div className="kit-app__tabbar">
            <span className="kit-app__tabname">{first ? FIRST.title : 'Inbox'}</span>
          </div>
          <div className="kit-inboxrow__main">
            <div className="kit-inboxrow__cal" style={{ opacity: cal }}>
              <Calendar beat={b} today={13} chips={[4, 9, 13, 18, 23, 27].map((day, i) => ({ day, p: since(b, 0.04 + i * 0.03, 0.4) }))} />
              <Words size="page">The app keeps the dates.</Words>
            </div>
            {first && (
              <span className="kit-chip kit-inboxrow__daily" style={pop(b, since(b, daily, 0.5))}>
                Every day
              </span>
            )}
            {!first && (
              <div className="kit-inboxrow__zoom" style={{ opacity: zoom, transform: b.reduced ? undefined : `scale(${lerp(0.85, 1, ease.out(zoom)).toFixed(4)})` }}>
                <span className="sidebar__inbox kit-inboxrow__row">
                  <InboxIcon className="sidebar__inbox-icon" />
                  <span className="sidebar__inbox-name">Inbox</span>
                  <span className="tree__count sidebar__inbox-count" style={{ boxShadow: ring > 0 ? `0 0 0 ${(3 * ring).toFixed(2)}px var(--accent)` : undefined }}>
                    4
                  </span>
                </span>
                <div className="kit-inboxrow__due">
                  {[0, 1, 2, 3].map((i) => (
                    <MiniCard key={i} title={TODAY[i].title} style={{ ...pop(b, since(b, due - 0.04 + i * 0.03, 0.4), 0.7), fontSize: '0.8em' }} />
                  ))}
                </div>
                <Words size="label" style={rise(b, since(b, due, 0.5))}>
                  4 cards due now
                </Words>
              </div>
            )}
          </div>
          {first && <Pointer beat={b} from={[60, 80]} to={[16, 6]} move={between(b, open - 0.12, open)} click={since(b, open, 0.4)} show={since(b, open - 0.15, 0.3)} />}
        </AppWindow>
      </Layer>
    </Stage>
  )
}

/** c3-05: the Inbox, one card at a time; look at it, and try to recall what is hidden. */
function OneAtATime(props: SceneProps) {
  const b = useBeat(props)
  const one = cue(b, 0, 0.182)
  const recall = cue(b, 1, 0.752)
  const stack = 1 - since(b, one, 0.6)
  return (
    <Stage beat={b} label="The Inbox shows one card at a time: look, and try to recall what is hidden">
      <Layer>
        <Fit min={0.75}>
          <div className="kit-onecard" style={rise(b, since(b, 0, 0.6), 12)}>
            {[1, 2, 3].map((i) => (
              <span key={i} className="kit-onecard__under" style={{ opacity: stack * 0.9, transform: b.reduced ? undefined : `translate(${(i * 8 * stack).toFixed(1)}px, ${(i * 7 * stack).toFixed(1)}px)` }} />
            ))}
            <InboxView
              beat={b}
              card={{ title: MOON.title, text: MOON.text, id: MOON.id, sides: 1, state: 'Due today', blanks: since(b, 0.485, 0.5) * (0.6 + 0.4 * Math.abs(Math.sin(Math.max(0, b.t - recall * b.length) * 3))), lit: [0, 0] }}
              position={1}
              total={4}
              place={PLACE}
              glowKey={{ Show: since(b, recall, 0.5) }}
            />
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c3-06, c3-07 and c3-23, one span: recall is what makes it stick; the journal Science; then 80% against 36%. */
function Retrieval(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const paper = PAPERS.karpicke2008
  if (id === 'c3-06') {
    const issue = { journal: paper.journal, year: paper.year }
    const journal = cue(b, 0, 0.613)
    const test = cue(b, 1, 0.801)
    // The words stay until the cover comes, so the stage is never empty on "what makes it stick".
    const words = showFor(since(b, 0, 0.6), since(b, journal - 0.06, 0.35))
    return (
      <Stage beat={b} label="Trying to recall is what makes it stick. A study in the journal Science, 2008, put it to the test">
        <Layer style={{ opacity: words }}>
          <Words size="title">
            Trying to <span className="kit-tone--accent">recall</span>
            <br />
            is what makes it stick.
          </Words>
        </Layer>
        <Layer>
          <div className="kit-issue">
            <JournalCover beat={b} issue={issue} p={since(b, journal - 0.04, 0.8)} out={since(b, journal + 0.06, 0.6)} />
            <div className="kit-issue__paper">
              <Paper beat={b} paper={paper} at={{ in: journal + 0.06, highlight: test - 0.02 }} />
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  const second = id === 'c3-07'
  const bars = second ? undefined : [0, 0]
  const cite = second ? since(b, 0, 0.5) : 1
  const week = second ? since(b, 0.34, 0.5) : 1
  const work = second ? 0 : since(b, cue(b, 0, 0.181), 0.6)
  const double = second ? 0 : since(b, cue(b, 1, 0.617), 0.6)
  return (
    <Stage beat={b} label={second ? 'One week later: those who kept testing themselves remembered 80 percent; those who kept re-reading, 36 percent' : 'About the same amount of work: 237 and 243 rounds. More than double the memory'}>
      {second && (
        <Layer style={{ opacity: 1 - since(b, 0, 0.5) }}>
          <Paper beat={b} paper={paper} at={{ in: -1, highlight: -1, lift: 0 }} />
        </Layer>
      )}
      <Layer place="top">
        <div className="kit-retrieval__head">
          <Cite beat={b} paper={paper} p={cite} />
          <Words size="kicker" style={{ opacity: week }}>
            One week later
          </Words>
        </div>
      </Layer>
      <Layer style={{ paddingTop: '12%' }}>
        <div className="kit-retrieval">
          <Bars
            beat={b}
            at={bars}
            seconds={bars === undefined ? 1.1 : 0}
            bars={[
              { label: 'Kept testing themselves', value: 80, tone: 'accent' },
              { label: 'Kept re-reading, no testing', value: 36, tone: 'muted' },
            ]}
          />
          <div className="kit-retrieval__work" style={{ opacity: work }}>
            <span>237 rounds</span>
            <b>≈</b>
            <span>243 rounds</span>
          </div>
          <span className="kit-chip kit-retrieval__double" style={pop(b, double, 0.6)}>
            More than double the memory
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-08 to c3-11, one span: Space shows the hidden words and the back; Forgot or Remembered; the hover; the keys. */
function Answering(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  let shown = 2
  let sides = 2
  let bigKey: { label: string; p: number; press: number } | null = null
  let forgot = {}
  let remembered = {}
  let hover: { on: 'forgot' | 'remembered'; text: string; p: number } | undefined
  let cursor: { on: 'forgot' | 'remembered'; move: number; click?: number; show?: number } | undefined
  let last: { rating: 'again' | 'good'; text: string; p: number; undo?: number } | undefined
  let card = MOON
  let cardId = MOON.id
  let position = 1
  let answered: boolean[] = []
  let glowKey: Record<string, number> = {}
  let canUndo = false
  if (id === 'c3-08') {
    const space = cue(b, 0, 0.062)
    const one = cue(b, 1, 0.477)
    const backAt = cue(b, 2, 0.777)
    const presses = [space + 0.08, one, backAt]
    shown = b.progress >= presses[1] ? 2 : b.progress >= presses[0] ? 1 : 0
    sides = b.progress >= presses[2] ? 2 : 1
    const pressNow = presses.reduce((acc, at) => Math.max(acc, showFor(since(b, at - 0.02, 0.15), since(b, at + 0.02, 0.15))), 0)
    bigKey = { label: 'Space', p: since(b, space - 0.03, 0.3), press: pressNow }
    glowKey = { Show: since(b, space, 0.3), 'Next side': since(b, one, 0.3) }
  } else if (id === 'c3-09') {
    forgot = { press: showFor(since(b, cue(b, 0, 0.14), 0.3), since(b, cue(b, 0, 0.14) + 0.1, 0.4)) }
    remembered = { press: showFor(since(b, cue(b, 1, 0.336), 0.3), since(b, cue(b, 1, 0.336) + 0.12, 0.4)) }
  } else if (id === 'c3-10') {
    const at = cue(b, 0, 0.291)
    const when = cue(b, 1, 0.54)
    cursor = { on: 'remembered', move: between(b, 0.08, at), show: since(b, 0.04, 0.3) }
    hover = { on: 'remembered', text: 'Remembered · 9 days', p: since(b, when - 0.08, 0.35) }
  } else {
    const one = cue(b, 0, 0.155)
    const two = cue(b, 1, 0.371)
    const cmdZ = cue(b, 2, 0.629)
    const takes = cue(b, 3, 0.774)
    const answer = two + 0.08
    const answeredNow = b.progress >= answer && b.progress < takes
    forgot = { key: showFor(since(b, one, 0.3), since(b, one + 0.12, 0.4)) }
    remembered = { key: showFor(since(b, two, 0.3), since(b, answer + 0.04, 0.4)), press: showFor(since(b, answer - 0.02, 0.2), since(b, answer + 0.03, 0.3)) }
    if (answeredNow) {
      card = { ...CANBERRA, id: TODAY[1].id }
      cardId = TODAY[1].id
      position = 2
      answered = [false]
      canUndo = true
    }
    last = { rating: 'good', text: answerLine('✓', 'Remembered', TODAY[0], 'in 9 days'), p: answeredNow ? since(b, answer, 0.3) : 0, undo: since(b, cmdZ, 0.3) }
    glowKey = { Undo: answeredNow ? since(b, cmdZ, 0.3) : 0 }
    const key = b.progress < two - 0.02 ? '1' : b.progress < cmdZ - 0.03 ? '2' : '⌘Z'
    const pressAt = key === '1' ? one : key === '2' ? answer : takes - 0.03
    bigKey = { label: key === '⌘Z' ? 'Cmd + Z' : key, p: since(b, one - 0.04, 0.3), press: showFor(since(b, pressAt - 0.02, 0.15), since(b, pressAt + 0.02, 0.15)) }
    shown = card === MOON ? 2 : 0
    sides = card === MOON ? 2 : 1
  }
  return (
    <Stage beat={b} label="The Inbox: Space shows the hidden words and the back; then Forgot or Remembered, with the 1 and 2 keys">
      <Layer>
        <Fit min={0.72} focus={1}>
          <InboxView
            beat={b}
            card={{ title: card.title, text: card.text, id: cardId, shown, sides, state: 'Due today' }}
            position={position}
            total={4}
            answered={answered}
            place={PLACE}
            forgot={forgot}
            remembered={remembered}
            hover={hover}
            cursor={cursor}
            last={last}
            keys={{ nextSide: shown === 2 && sides === 1, canUndo, answering: card === MOON && shown === 2 && sides === 2 }}
            glowKey={glowKey}
          />
        </Fit>
      </Layer>
      {bigKey !== null && (
        <Layer place="bottom" className="kit-layer--right">
          <BigKey beat={b} label={bigKey.label} p={bigKey.p} press={bigKey.press} />
        </Layer>
      )}
    </Stage>
  )
}

/** c3-12 and c3-13, one span: under the card, its calendar; Forgot moves its day closer. */
function Sooner(props: SceneProps) {
  const b = useBeat(props)
  const forgotClip = props.clip.id === 'c3-13'
  const moves = forgotClip ? 1 : since(b, cue(b, 0, 0.442), 0.7)
  const pressed = forgotClip ? since(b, cue(b, 0, 0.122), 0.3) : 0
  const sooner = forgotClip ? since(b, cue(b, 1, 0.455), 0.7) : 0
  return (
    <Stage beat={b} label={forgotClip ? 'Forgot: the card comes back sooner' : 'From your answer, the app moves the card on its calendar'}>
      <Layer>
        <div className="kit-row">
          <div className="kit-sooner__card">
            <MiniCard title={MOON.title} style={{ fontSize: '1.05em' }} />
            <div className="kit-sooner__answers">
              <span className="kit-answer-chip" data-rating="again" style={{ boxShadow: pressed > 0 ? `0 0 0 ${(2.5 * pressed).toFixed(2)}px var(--danger)` : undefined }}>
                ✕ Forgot
              </span>
              <span className="kit-answer-chip" data-rating="good">
                ✓ Remembered
              </span>
            </div>
          </div>
          <div className="kit-sooner__cal">
            <Calendar
              beat={b}
              today={13}
              glowToday={0.4}
              chips={[
                { day: 22, p: moves * (1 - sooner) },
                { day: 14, p: sooner },
              ]}
            />
            <span className="kit-chip" style={{ ...pop(b, sooner), alignSelf: 'center' }}>
              Back sooner: tomorrow
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-14: a card you forgot goes to the end of today's line, and comes round again until you remember it. */
function Queue(props: SceneProps) {
  const b = useBeat(props)
  const forgot = cue(b, 0, 0.283)
  const until = cue(b, 1, 0.713)
  const toEnd = moved(b, between(b, forgot + 0.08, forgot + 0.3))
  // Then the other three are answered, one by one, and the forgotten card comes to the front.
  const done = [0, 1, 2].map((i) => moved(b, between(b, until - 0.25 + i * 0.09, until - 0.17 + i * 0.09)))
  const gone = (n: number): number => done.slice(0, n).reduce((sum, d) => sum + d, 0)
  // The line: Moon first; after the Forgot, the others move up and Moon goes last; then each answered card leaves.
  const slots = (i: number): number => (i === 0 ? lerp(0, 3, toEnd) - gone(3) : i - toEnd - gone(i - 1))
  const titles = TODAY.map((c) => c.title)
  const check = since(b, until + 0.15, 0.5)
  return (
    <Stage beat={b} label="A card you forgot comes back later in the same review, until you remember it">
      <Layer>
        <div className="kit-queue">
          <span className="kit-queue__now">Now</span>
          {titles.map((title, i) => {
            const slot = slots(i)
            const left = i > 0 ? done[i - 1] : 0
            return (
              <span key={title} className="kit-queue__item" style={{ left: `${(6 + slot * 23).toFixed(2)}%`, opacity: 1 - left, transform: b.reduced ? undefined : `translateY(${(left * -24 + (i === 0 ? Math.sin(toEnd * Math.PI) * -22 : 0)).toFixed(2)}px)` }}>
                <MiniCard title={title} />
                {i === 0 && (
                  <span className="kit-queue__mark" data-rating={check > 0 ? 'good' : 'again'} style={pop(b, check > 0 ? check : since(b, forgot, 0.4))}>
                    {check > 0 ? '✓' : '✕'}
                  </span>
                )}
                {i > 0 && (
                  <span className="kit-queue__mark" data-rating="good" style={pop(b, left * 2)}>
                    ✓
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </Layer>
      <Layer place="bottom">
        <Words size="label" style={rise(b, since(b, until, 0.5))}>
          Again, until you remember it.
        </Words>
      </Layer>
    </Stage>
  )
}

/** c3-15: Remembered: the card waits longer, and the wait grows each time. */
function Longer(props: SceneProps) {
  const b = useBeat(props)
  const lands = [cue(b, 0, 0.276), cue(b, 1, 0.605), cue(b, 2, 0.776)]
  return (
    <Stage beat={b} label="Remembered: the card waits longer; each time you remember it, the wait grows">
      <Layer place="top" style={{ paddingTop: '10%' }}>
        <span className="kit-answer-chip" data-rating="good" style={{ ...pop(b, since(b, 0.06, 0.4)), fontSize: '1.1em' }}>
          ✓ Remembered
        </span>
      </Layer>
      <Layer style={{ paddingTop: '8%' }}>
        <Timeline
          beat={b}
          draw={since(b, 0.05, 0.8)}
          stops={[
            { day: 2, label: '2 days' },
            { day: 11, label: '11 days' },
            { day: 46, label: '6 weeks' },
          ]}
          land={lands.map((l) => since(b, l, 0.6))}
        />
      </Layer>
    </Stage>
  )
}

/** c3-16: a new card needs two Remembered in a row; then it leaves for a day or more. */
function TwoInARow(props: SceneProps) {
  const b = useBeat(props)
  const two = cue(b, 0, 0.227)
  const row = cue(b, 1, 0.352)
  const leaves = cue(b, 2, 0.63)
  const go = moved(b, between(b, leaves, leaves + 0.18))
  const land = since(b, leaves + 0.14, 0.4)
  return (
    <Stage beat={b} label="A new card needs two Remembered in a row, then it leaves for a day or more">
      <Layer>
        <div className="kit-tworow">
          <div className="kit-tworow__card" style={{ opacity: 1 - go * 0.9, transform: b.reduced ? undefined : `translateX(${(go * 40).toFixed(1)}%) scale(${lerp(1, 0.6, go).toFixed(3)})` }}>
            <CardView beat={b} title={FIRST.title} text={FIRST.text} sides={1} state="New card" id={FIRST.id} className="kit-cardview--small" />
            <div className="kit-tworow__checks">
              <span className="kit-answer-chip" data-rating="good" style={pop(b, since(b, two, 0.4))}>
                ✓ Remembered
              </span>
              <span className="kit-answer-chip" data-rating="good" style={pop(b, since(b, row - 0.04, 0.4))}>
                ✓ Remembered
              </span>
            </div>
          </div>
          <WeekStrip beat={b} today={2} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} lit={[0, 0, 0, land, 0]} cards={{ 3: land }} />
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-17: you never set a date: the answers go in, the dates come out. */
function Dates(props: SceneProps) {
  const b = useBeat(props)
  const noDate = cue(b, 0, 0.183)
  const answers = cue(b, 1, 0.766)
  const marks = ['✓', '✓', '✕', '✓', '✓', '✕', '✓']
  const days = [3, 8, 14, 15, 21, 25, 28]
  return (
    <Stage beat={b} label="You never set a date: the app works out each date from your answers">
      <Layer place="top" style={{ paddingTop: '5%' }}>
        <div className="kit-dates__field" style={{ ...rise(b, since(b, 0, 0.4)), opacity: since(b, 0, 0.4) * (1 - 0.6 * since(b, noDate + 0.12, 0.5)) }}>
          <span>Due date</span>
          <span className="kit-dates__box">
            <s style={{ opacity: since(b, noDate, 0.3) }}>Set a date…</s>
          </span>
        </div>
      </Layer>
      <Layer>
        <div className="kit-row kit-dates">
          <div className="kit-dates__answers">
            {marks.map((m, i) => (
              <span key={i} className="kit-answer-chip" data-rating={m === '✓' ? 'good' : 'again'} style={pop(b, since(b, 0.36 + i * 0.03, 0.3))}>
                {m}
              </span>
            ))}
          </div>
          <div className="kit-dates__gears">
            <Gears beat={b} p={since(b, 0.38, 0.5)} />
          </div>
          <div className="kit-dates__cal">
            <Calendar beat={b} today={13} chips={days.map((day, i) => ({ day, p: since(b, 0.5 + i * 0.035, 0.4) }))} glowToday={since(b, answers, 0.5)} />
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-18: missed a day? The due cards wait in the Inbox until you come back. */
function Missed(props: SceneProps) {
  const b = useBeat(props)
  const day = cue(b, 0, 0.069)
  const inbox = cue(b, 1, 0.664)
  const skip = since(b, day, 0.6)
  const count = Math.round(lerp(4, 7, between(b, 0.36, 0.56)))
  return (
    <Stage beat={b} label="Missed a day? That is fine: the cards that are due wait in the Inbox">
      <Layer>
        <div className="kit-row">
          <WeekStrip beat={b} today={b.progress >= day + 0.1 ? 4 : 2} missed={skip > 0.5 ? 3 : -1} labels={WEEK.slice(0, 6)} lit={[0, 0, 0, 0, since(b, day + 0.1, 0.4), 0]} />
          <div className="kit-missed__inbox" style={rise(b, since(b, 0.32, 0.5))}>
            <SidebarPreview inbox={count} inboxGlow={since(b, inbox, 0.4)} rows={[]} />
            <Words size="page">The due cards wait here.</Words>
          </div>
        </div>
      </Layer>
      <Layer place="top" style={{ paddingTop: '7%' }}>
        <span className="kit-chip" style={pop(b, since(b, 0.2, 0.5))}>
          That’s fine.
        </span>
      </Layer>
    </Stage>
  )
}

/** c3-19: at most ten new cards a day: Settings › Cards › Daily limits › New cards a day. */
function NewPerDay(props: SceneProps) {
  const b = useBeat(props)
  const ten = cue(b, 0, 0.399)
  const number = cue(b, 1, 0.776)
  const n = DEFAULT_REVIEW_SETTINGS.newPerDay ?? 10
  return (
    <Stage beat={b} label={`The Inbox brings at most ${n} new cards a day; Settings › Cards › New cards a day`}>
      <Layer place="top" style={{ paddingTop: '6%' }}>
        <div className="kit-ten">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className="kit-ten__card" style={pop(b, since(b, ten - 0.06 + i * 0.012, 0.3), 0.5)} />
          ))}
        </div>
      </Layer>
      <Layer style={{ paddingTop: '14%' }}>
        <div className="kit-settings" style={rise(b, since(b, 0.5, 0.6))}>
          <p className="kit-settings__path">Settings › Cards</p>
          <p className="kit-settings__group">Daily limits</p>
          <div className="kit-settings__row">
            <span className="kit-settings__label">
              <b>New cards a day</b>
              <span>How many new cards the Inbox shows each day. Empty means no limit.</span>
            </span>
            <span className="kit-settings__value">
              <span className="settings__input settings__input--number kit-settings__box" style={{ boxShadow: `0 0 0 ${(2.5 * showFor(since(b, number, 0.4), since(b, 0.97, 0.3))).toFixed(2)}px var(--accent)` }}>
                {n}
              </span>{' '}
              cards
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c3-20: the last card; then "Inbox complete." */
function Complete(props: SceneProps) {
  const b = useBeat(props)
  const left = cue(b, 0, 0.157)
  const complete = cue(b, 1, 0.451)
  const answer = Math.max(0.05, left - 0.08)
  const after = b.progress >= answer + 0.04
  return (
    <Stage beat={b} label="When nothing is left, the Inbox says Inbox complete">
      <Layer>
        <Fit min={0.72}>
          <InboxView
            beat={b}
            card={{ title: PROTEIN.title, text: `${FIRST_FRONT}\n---\nAn egg is mostly protein and fat.`, id: TODAY[3].id, shown: 1, sides: 2, state: 'Due today' }}
            position={4}
            total={4}
            answered={after ? [false, true, false, false] : [false, true, false]}
            place={PLACE}
            remembered={{ press: showFor(since(b, answer - 0.02, 0.2), since(b, answer + 0.04, 0.3)) }}
            last={{ rating: 'good', text: answerLine('✓', 'Remembered', TODAY[3], 'in 9 days'), p: after ? since(b, answer + 0.04, 0.3) : 0 }}
            done={since(b, complete - 0.06, 0.6)}
          />
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c3-21: "Try it in the app": behind it, what the steps do (right-click Course Cards, Review this folder). */
function TryIt(props: SceneProps) {
  const b = useBeat(props)
  const tryAt = cue(b, 0, 0.649)
  return (
    <Stage beat={b} label="Try it in the app: answer your own card in the real Inbox">
      <Layer style={{ opacity: since(b, 0, 0.6) }}>
        <AppWindow sidebar={<SidebarPreview inbox={1} rows={SIDEBAR.map((r) => (r.name === 'Course Cards' ? { ...r, glow: showFor(since(b, 0.1, 0.4), since(b, 0.55, 0.4)) } : r))} />}>
          <MenuPreview beat={b} x={2} y={30} p={showFor(since(b, 0.15, 0.4), since(b, 0.55, 0.4))} items={[{ label: 'New card' }, { label: 'Review this folder', active: since(b, 0.3, 0.3), rule: true }, { label: 'Rename' }]} />
        </AppWindow>
      </Layer>
      {/* The app behind "Try it in the app", stepped back by a veil: its parts still cover each other as in the app. */}
      <Layer place="fill" style={{ padding: 0, opacity: since(b, 0, 0.6) }}>
        <div className="kit-veil" />
      </Layer>
      <Layer>
        <TryChip beat={b} p={since(b, 0.04, 0.6)} glow={showFor(since(b, tryAt - 0.04, 0.4), since(b, 0.97, 0.4))} beside={<span className="course__btn">Next chapter</span>} />
      </Layer>
    </Stage>
  )
}

/** c3-22: a few minutes a day, the algorithm does the rest; next, a card right inside a page. */
function Next(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const algo = cue(b, 0, 0.221)
  const next = cue(b, 1, 0.483)
  const inside = cue(b, 2, 0.809)
  const first = 1 - since(b, next - 0.03, 0.5)
  const page = since(b, next, 0.6)
  const card = since(b, inside - 0.06, 0.7)
  const sweep = between(b, 0, algo + 0.05)
  return (
    <Stage beat={b} label={unit('A few minutes a day, and the algorithm does the rest. Next: cards inside your pages')}>
      <Layer style={{ opacity: first }}>
        <div className="kit-row">
          <svg className="kit-clock" viewBox="-50 -50 100 100" aria-hidden="true" style={rise(b, since(b, 0, 0.5))}>
            <circle r={44} className="kit-clock__face" />
            <path className="kit-clock__slice" d={slice(sweep * 0.1)} />
            <line x1={0} y1={0} x2={0} y2={-34} className="kit-clock__hand" transform={`rotate(${(sweep * 36).toFixed(2)})`} />
            <circle r={3} className="kit-clock__pin" />
          </svg>
          <div className="kit-next__gears">
            <Gears beat={b} p={since(b, algo, 0.5)} />
          </div>
        </div>
        <Words size="label" style={{ opacity: since(b, 0.05, 0.4) }}>
          A few minutes a day
        </Words>
      </Layer>
      <Layer style={{ opacity: page }}>
        <div className="kit-next__page" style={rise(b, page, 14)}>
          <PageView title="Light and colour">
            <PageText beat={b}>White light is a mix of every colour. A prism splits it, because each colour bends by a different amount.</PageText>
            <div className="kit-next__slot" style={{ height: `${(lerp(0.4, 1, b.reduced ? (card > 0 ? 1 : 0) : ease.out(card)) * 4.6).toFixed(2)}em` }}>
              <div style={{ opacity: card, transform: b.reduced ? undefined : `translateY(${((1 - ease.out(card)) * -12).toFixed(2)}px)` }}>
                <CardView beat={b} text={'White light is a mix of {{every colour}}.'} chrome="block" id={sampleId('White light')} className="kit-cardview--small" />
              </div>
            </div>
            <PageText beat={b}>The sky looks blue because air scatters blue light more than red light.</PageText>
          </PageView>
        </div>
      </Layer>
    </Stage>
  )
}

/** A pie slice of a clock face, `f` of a full turn, from 12 o'clock. */
function slice(f: number): string {
  const a = clamp(f) * Math.PI * 2
  if (a <= 0) return ''
  const x = Math.sin(a) * 44
  const y = -Math.cos(a) * 44
  return `M0 0 L0 -44 A44 44 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`
}

export const INBOX_SCENES: ChapterScenes = {
  chapter: 'inbox',
  entries: [
    { clips: ['c3-01'], scene: Habit },
    { clips: ['c3-02'], scene: WhichWhen },
    { clips: ['c3-03', 'c3-04'], scene: InboxRow },
    { clips: ['c3-05'], scene: OneAtATime },
    { clips: ['c3-06', 'c3-07', 'c3-23'], scene: Retrieval },
    { clips: ['c3-08', 'c3-09', 'c3-10', 'c3-11'], scene: Answering },
    { clips: ['c3-12', 'c3-13'], scene: Sooner },
    { clips: ['c3-14'], scene: Queue },
    { clips: ['c3-15'], scene: Longer },
    { clips: ['c3-16'], scene: TwoInARow },
    { clips: ['c3-17'], scene: Dates },
    { clips: ['c3-18'], scene: Missed },
    { clips: ['c3-19'], scene: NewPerDay },
    { clips: ['c3-20'], scene: Complete },
    { clips: ['c3-21'], scene: TryIt },
    { clips: ['c3-22'], scene: Next },
  ],
}
