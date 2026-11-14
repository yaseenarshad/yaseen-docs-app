/**
 * CHAPTER 9, "Four steps: capture, create, review, improve" (YAZ-5121, YAZ-5328). The whole system at a glance: four
 * icons. Capture happens all day, in one place of your choice (a phone, a meeting, a walk; then the three places side by
 * side). Create is a quiet sit-down with the capture list: the agent drafts, you read and say yes, and that is chewing.
 * Review is the daily step in the app. Then what the research says about trusting the schedule (Kornell 2009; Karpicke
 * & Roediger 2008), improving inside the review, a couple of minutes a day, and the four steps with their times. The
 * storyboard is the comment above each clip in `script.ts`; the cues are `marks` there, set from the real voice's word
 * times, read with `cue()`.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { SceneProps } from '../scene'
import { MANY_TITLES, MUSCLE, PROTEIN_BRANCH, SLEEP_DEBT } from './cards'
import { PAPERS } from './papers'
import { Answers, AppWindow, CardView, Cite, Fit, Layer, MiniCard, Paper, SidebarPreview, Stage, Tally, Timeline, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, typedText, useBeat, type Beat, HabitGlyph, Habits, AgentChat, Crowd, GuessBars, ClockArc, Gauge, Head, Web, type WebEdge, type WebNode } from './kit'
import type { ChapterScenes } from './registry'
import './habits.css'

/** c9-01 and c9-02, one span: step back from the cards; the four steps, each on its word. */
function FourSteps(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  // c9-01: the cards so far, and the camera steps back from them.
  const back = id === 'c9-01' ? moved(b, between(b, 0.1, 0.95)) : 1
  const cardsOut = id === 'c9-01' ? 0 : since(b, 0, 0.5)
  // c9-02: each step on its word.
  const show = id === 'c9-01' ? [0, 0, 0, 0] : [0, 1, 2, 3].map((i) => since(b, cue(b, i, [0.317, 0.461, 0.67, 0.778][i]) - 0.02, 0.45))
  return (
    <Stage beat={b} label={id === 'c9-01' ? 'The whole system, from a step back' : 'Four steps: capture, create, review, improve'}>
      {cardsOut < 1 && (
        <Layer style={{ opacity: 1 - cardsOut }}>
          <div className="later-zoom" style={{ transform: b.reduced ? undefined : `scale(${lerp(1.35, 0.85, back).toFixed(3)})`, opacity: lerp(1, 0.55, back) }}>
            <div className="kit-many">
              {MANY_TITLES.slice(0, 9).map((title, i) => (
                <MiniCard key={title} title={title} style={pop(b, since(b, i * 0.03, 0.4), 0.8)} />
              ))}
            </div>
          </div>
        </Layer>
      )}
      <Layer>
        <Habits beat={b} show={show} lit={id === 'c9-02' ? show.map((s, i) => (i === 3 ? s : showFor(s, show[i + 1]))) : []} />
      </Layer>
    </Stage>
  )
}

/** What the person captures over one day: where they are, and the line they write down. Made up, in the course's world. */
const CAPTURES = [
  { where: 'On your phone', what: 'a podcast', line: 'Sleep you miss adds up', icon: 'phone' },
  { where: 'In a meeting', what: 'a talk', line: 'Carbs are the quickest energy', icon: 'meeting' },
  { where: 'On a walk', what: 'a thought', line: 'Why does muscle need protein?', icon: 'walk' },
] as const

/** A small drawing of where you are: a phone, two people talking, footsteps. */
function PlaceIcon({ kind }: { kind: 'phone' | 'meeting' | 'walk' }) {
  return (
    <svg className="later-place-icon" viewBox="0 0 32 32" aria-hidden="true">
      {kind === 'phone' && (
        <>
          <rect x={9} y={3} width={14} height={26} rx={3} />
          <path d="M14 25H18" />
        </>
      )}
      {kind === 'meeting' && (
        <>
          <circle cx={10} cy={11} r={4} />
          <circle cx={22} cy={11} r={4} />
          <path d="M3 27C3 21 6 18 10 18S17 21 17 27M15 27C15 21 18 18 22 18S29 21 29 27" />
        </>
      )}
      {kind === 'walk' && (
        <>
          <path d="M9 20C6 20 5 16 6 12S10 6 12 9 12 20 9 20ZM8 24H11" />
          <path d="M22 14C19 14 18 10 19 6S23 1 25 3 25 14 22 14ZM21 18H24" />
        </>
      )}
    </svg>
  )
}

/** The one place the lines land: a short list, each line with its tick when it has become a card. */
function CaptureList({ beat, lines, ticks = [], title = 'Capture list', glow = 0 }: { beat: Beat; lines: readonly number[]; ticks?: readonly number[]; title?: string; glow?: number }) {
  return (
    <div className="later-capture" style={{ boxShadow: glow > 0 ? `0 0 0 ${(3 * clamp(glow)).toFixed(2)}px var(--accent-soft), var(--kit-shadow)` : undefined }}>
      <p className="later-capture__title">
        <HabitGlyph habit="capture" size={18} /> {title}
      </p>
      <ul className="later-capture__list">
        {CAPTURES.map((c, i) => {
          const p = clamp(lines[i] ?? 0)
          if (p <= 0) return <li key={c.line} className="later-capture__empty" aria-hidden="true" />
          const t = clamp(ticks[i] ?? 0)
          return (
            <li key={c.line} style={{ opacity: lerp(1, 0.5, t) }}>
              <span>{typedText(beat, c.line, p)}</span>
              {t > 0 && (
                <span className="later-capture__tick" style={pop(beat, t, 0.5)}>
                  ✓
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The three capture places of c9-13, each with the same lines. A pure drawing: `p` brings it in. */
function CapturePlace({ beat, kind, p, lines }: { beat: Beat; kind: 'phone' | 'dump' | 'channel'; p: number; lines: number }) {
  const label = kind === 'phone' ? 'On your phone' : kind === 'dump' ? 'A brain dump' : 'A chat channel just for you'
  const body: ReactNode = CAPTURES.map((c, i) => {
    const q = clamp(lines * 3 - i)
    if (q <= 0) return null
    return (
      <li key={c.line} style={rise(beat, q, 4)}>
        {kind === 'channel' && <span className="later-places__who">you</span>}
        {c.line}
      </li>
    )
  })
  return (
    <div className={`later-places__item later-places__item--${kind}`} style={rise(beat, p, 12)}>
      <div className="later-places__frame">
        <p className="later-places__head">{kind === 'phone' ? 'Today' : kind === 'dump' ? 'Brain dump' : '# just-me'}</p>
        <ul className="later-places__lines">{body}</ul>
      </div>
      <span className="later-places__label">{label}</span>
    </div>
  )
}

/**
 * c9-12 and c9-13, one span. c9-12: a day runs; wherever you are (a phone, a meeting, a walk), the line worth keeping is
 * written down in one place. c9-13: three places to capture, side by side, each with the same lines; "One place".
 */
function CaptureAllDay(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c9-13') {
    const phone = since(b, cue(b, 0, 0.019), 0.6)
    const dump = since(b, cue(b, 1, 0.199), 0.6)
    const channel = since(b, cue(b, 2, 0.323), 0.6)
    const same = since(b, 0.6, 0.5)
    const one = since(b, cue(b, 3, 0.845), 0.6)
    return (
      <Stage beat={b} label="A phone, a brain dump, a chat channel just for you: it does not matter where, as long as you have one place">
        <Layer>
          <div className="later-places">
            <CapturePlace beat={b} kind="phone" p={phone} lines={since(b, cue(b, 0, 0.019) + 0.04, 1)} />
            <span className="later-places__or" style={{ opacity: same }} aria-hidden="true">
              or
            </span>
            <CapturePlace beat={b} kind="dump" p={dump} lines={since(b, cue(b, 1, 0.199) + 0.04, 1)} />
            <span className="later-places__or" style={{ opacity: same }} aria-hidden="true">
              or
            </span>
            <CapturePlace beat={b} kind="channel" p={channel} lines={since(b, cue(b, 2, 0.323) + 0.04, 1)} />
          </div>
          <Words size="title" tone={one > 0.5 ? 'accent' : undefined} style={rise(b, one)}>
            One place.
          </Words>
        </Layer>
      </Stage>
    )
  }
  const allDay = cue(b, 0, 0.164)
  const worth = cue(b, 1, 0.637)
  const write = cue(b, 2, 0.782)
  const sun = between(b, 0.04, worth)
  const sources = CAPTURES.map((_, i) => since(b, lerp(allDay, worth - 0.12, i / 2), 0.5))
  const glow = since(b, worth, 0.4)
  const lines = CAPTURES.map((_, i) => since(b, write - 0.03 + i * 0.05, 0.8))
  return (
    <Stage beat={b} label="Capture happens all day, wherever you are: when something is worth keeping, write it down in one place">
      <Layer place="top">
        <div className="later-day" style={rise(b, since(b, 0, 0.5), 6)}>
          <span className="later-day__end">Morning</span>
          <span className="later-day__track">
            <i className="later-day__sun" style={{ left: `${(moved(b, sun, ease.linear) * 100).toFixed(2)}%` }} />
          </span>
          <span className="later-day__end">Evening</span>
        </div>
      </Layer>
      <Layer>
        <div className="kit-row later-captureday">
          <ul className="later-sources">
            {CAPTURES.map((c, i) => (
              <li key={c.where} className="later-source" style={rise(b, sources[i], 10)} data-lit={glow > 0.5 && lines[i] < 1 ? 'true' : undefined}>
                <PlaceIcon kind={c.icon} />
                <span className="later-source__text">
                  <span className="later-source__where">{c.where}</span>
                  <span className="later-source__line">“{c.line}”</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="later-arrow" style={{ opacity: since(b, write - 0.06, 0.4) }} aria-hidden="true">
            →
          </span>
          <div style={rise(b, since(b, allDay, 0.6), 10)}>
            <CaptureList beat={b} lines={lines} glow={showFor(since(b, write, 0.4), since(b, 0.97, 0.3))} title="One place" />
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** The quiet desk: a lamp, a book, a mug; `lamp` lights it; `dots` are the thought rising. A drawing. */
function Desk({ beat, lamp, dots, style }: { beat: Beat; lamp: number; dots: number; style?: CSSProperties }) {
  return (
    <svg className="later-desk" viewBox="0 0 420 220" aria-hidden="true" style={style}>
      <ellipse className="later-desk__light" cx={300} cy={150} rx={lerp(30, 150, ease.out(lamp))} ry={lerp(10, 60, ease.out(lamp))} opacity={0.5 * lamp} />
      <line className="later-desk__top" x1={30} y1={170} x2={390} y2={170} />
      <path className="later-desk__lamp" d="M330 170 V96 L300 70" />
      <path className="later-desk__shade" d="M276 58 L320 52 L312 82 L284 86 Z" />
      <rect className="later-desk__book" x={150} y={150} width={110} height={20} rx={3} />
      <line className="later-desk__line" x1={160} y1={157} x2={240} y2={157} />
      <line className="later-desk__line" x1={160} y1={163} x2={220} y2={163} />
      <path className="later-desk__mug" d="M70 132 H104 V166 Q104 170 100 170 H74 Q70 170 70 166 Z M104 140 Q118 142 116 152 Q114 160 104 160" />
      {[0, 1, 2].map((i) => {
        const p = clamp(dots * 3 - i)
        return <circle key={i} className="later-desk__thought" cx={205 + i * 16} cy={lerp(140, 104 - i * 14, beat.reduced ? 1 : ease.out(p))} r={4 + i * 2.5} opacity={clamp(p * 2)} />
      })}
    </svg>
  )
}

/** The cards that the capture list becomes (c9-14), in the order of its lines. */
const MADE = [SLEEP_DEBT.title, 'Carbs', MUSCLE.title]

/**
 * c9-14, c9-15 and c9-09, one span: Create. c9-14: a quiet desk; the capture list on one side, cards forming on the
 * other. c9-15: the agent drafts a card from a captured line; you read it, and a Yes saves it: that is chewing. c9-09:
 * the Create step lights; time set aside; the lamp comes on: a quiet moment.
 */
function CreateQuietly(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c9-15') {
    const chew = cue(b, 0, 0.151)
    const agent = cue(b, 1, 0.325)
    const approve = cue(b, 2, 0.731)
    return (
      <Stage beat={b} label="This is where you chew: your agent drafts each card, and you read and approve it">
        <Layer place="top">
          <Words size="display" tone="accent" style={pop(b, since(b, chew - 0.03, 0.5), 0.8)}>
            Chew
          </Words>
        </Layer>
        <Layer style={{ paddingTop: '12%' }}>
          <div className="kit-row later-create">
            <div className="later-create__chat" style={rise(b, since(b, 0.02, 0.6), 10)}>
              <AgentChat
                beat={b}
                lines={[
                  { who: 'you', text: 'Draft a card from my capture list: “Sleep you miss adds up”.', p: between(b, 0.04, agent) },
                  {
                    who: 'agent',
                    text: 'Here is a draft. Read it, and say yes or ask for a change.',
                    p: since(b, agent, 0.5),
                    ask: { title: 'Each hour of sleep you miss adds to your sleep debt.', reason: 'Back: one short hour a night for a week is seven hours.', read: between(b, agent + 0.08, approve - 0.02), answer: 'yes', answerP: since(b, approve, 0.4), yes: 'Yes, save it', skip: 'Change it' },
                  },
                ]}
              />
            </div>
            <div className="later-made" style={rise(b, since(b, approve + 0.04, 0.6), 10)}>
              <MiniCard title={SLEEP_DEBT.title} style={pop(b, since(b, approve + 0.06, 0.5), 0.6)} />
              <span className="kit-chip" style={pop(b, since(b, approve + 0.1, 0.5))}>
                Saved
              </span>
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c9-09') {
    const thought = cue(b, 0, 0.567)
    const quiet = cue(b, 1, 0.808)
    return (
      <Stage beat={b} label="Create is the one you set time aside for: chewing takes thought, so give it a quiet moment">
        <Layer place="top">
          <Habits beat={b} show={[1, 1, 1, 1]} lit={[0, since(b, 0, 0.6), 0, 0]} size="small" pages={[undefined, 'Time set aside']} pageP={[0, since(b, 0.12, 0.5)]} />
        </Layer>
        <Layer style={{ paddingTop: '14%' }}>
          <Desk beat={b} lamp={since(b, quiet - 0.1, 1.2)} dots={since(b, thought, 1.6) * (1 - since(b, 0.97, 0.3))} />
          <Words size="title" style={rise(b, since(b, quiet, 0.6))}>
            A quiet moment
          </Words>
        </Layer>
      </Stage>
    )
  }
  // c9-14
  const list = cue(b, 0, 0.433)
  const cards = cue(b, 1, 0.782)
  const turn = (i: number) => since(b, lerp(0.62, cards, i / 2), 0.6)
  return (
    <Stage beat={b} label="Create: sit down with your capture list, and turn it into cards">
      <Layer place="bottom" style={{ opacity: since(b, 0, 0.8) * 0.55 }}>
        <Desk beat={b} lamp={1} dots={0} style={{ maxHeight: '34cqh' }} />
      </Layer>
      <Layer place="top">
        <Habits beat={b} show={[1, 1, 1, 1]} lit={[0, since(b, 0, 0.6), 0, 0]} size="small" />
      </Layer>
      <Layer>
        <div className="kit-row later-create">
          <div style={rise(b, since(b, list - 0.12, 0.6), 10)}>
            <CaptureList beat={b} lines={[1, 1, 1]} ticks={[0, 1, 2].map(turn)} glow={showFor(since(b, list, 0.4), since(b, cards, 0.5))} />
          </div>
          <span className="later-arrow" style={{ opacity: since(b, 0.58, 0.4) }} aria-hidden="true">
            →
          </span>
          <div className="later-made">
            {MADE.map((title, i) => (
              <MiniCard key={title} title={title} style={pop(b, turn(i), 0.6)} />
            ))}
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c9-03: Review lights; a sunrise; the Inbox opens, and the app picks the cards. */
function DailyReview(props: SceneProps) {
  const b = useBeat(props)
  const daily = since(b, cue(b, 0, 0.142), 1.2)
  const inbox = since(b, cue(b, 1, 0.568), 0.6)
  const picks = cue(b, 2, 0.775)
  const up = moved(b, since(b, cue(b, 1, 0.568) - 0.05, 0.6))
  return (
    <Stage beat={b} label="Review is the daily step, here in the app: open the Inbox, and the app picks the cards">
      <Layer place="bottom" style={{ opacity: daily * (1 - inbox * 0.7) }}>
        <svg className="later-sun" viewBox="0 0 400 120" aria-hidden="true">
          <circle className="later-sun__disc" cx={200} cy={lerp(150, 92, b.reduced ? 1 : ease.out(daily))} r={46} />
          <line className="later-sun__horizon" x1={20} y1={118} x2={380} y2={118} />
        </svg>
      </Layer>
      <Layer style={{ transform: b.reduced ? undefined : `translateY(${lerp(0, -30, up).toFixed(2)}cqh)`, opacity: b.reduced ? 1 - inbox * 0.8 : 1 }}>
        <Habits beat={b} show={[1, 1, 1, 1]} lit={[0, 0, since(b, 0, 0.6), 0]} pages={[undefined, undefined, 'Every day']} pageP={[0, 0, since(b, cue(b, 0, 0.142), 0.5)]} />
      </Layer>
      {inbox > 0 && (
        <Layer style={{ opacity: inbox, paddingTop: '20%' }}>
          <AppWindow
            sidebar={<SidebarPreview inbox={12} inboxGlow={showFor(since(b, cue(b, 1, 0.568), 0.5), since(b, picks + 0.12, 0.6))} rows={[{ name: 'Course Cards', kind: 'folder' }, { name: 'Projects', kind: 'folder' }]} />}
            style={{ height: 'min(48cqh, 16em)' }}
            label="The Inbox: the app picks the cards that are due"
          >
            <div className="later-picks">
              {[SLEEP_DEBT.title, 'Protein', 'candid'].map((title, i) => (
                <div key={title} className="later-picks__card" style={rise(b, since(b, picks + i * 0.06, 0.5), 18)}>
                  <MiniCard title={title} />
                  <span className="kit-chip">Due today</span>
                </div>
              ))}
            </div>
          </AppWindow>
        </Layer>
      )}
    </Stage>
  )
}

/** c9-04: the schedule's dates stretch out, and feel slow; then a gut feeling against what the memory really kept. */
function TrustSchedule(props: SceneProps) {
  const b = useBeat(props)
  const slow = cue(b, 0, 0.21)
  const gut = cue(b, 1, 0.52)
  const judge = cue(b, 2, 0.66)
  const stops = [
    { day: 2, label: '2 days' },
    { day: 11, label: '11 days' },
    { day: 46, label: '46 days' },
    { day: 163, label: '163 days' },
  ]
  const line = showFor(since(b, 0, 0.5), since(b, gut - 0.04, 0.5))
  const thought = since(b, gut, 0.6)
  return (
    <Stage beat={b} label="Trust the schedule, even when it feels slow: your gut is a poor judge of your own memory">
      <Layer style={{ opacity: line }}>
        <Words size="kicker">The schedule, for a card you remember</Words>
        <Timeline beat={b} stops={stops} land={stops.map((_, i) => since(b, 0.05 + i * 0.05, 0.6))} draw={since(b, 0, 0.9)} />
        <span className="kit-chip" style={pop(b, since(b, slow + 0.05, 0.5))}>
          Feels slow
        </span>
      </Layer>
      <Layer style={{ opacity: thought }}>
        <div className="kit-row">
          <div className="later-gut">
            <Head beat={b} p={thought} />
            <span className="later-bubble" style={pop(b, since(b, gut + 0.04, 0.5), 0.7)}>
              I’m sure that worked.
            </span>
          </div>
          <Gauge beat={b} p={thought} value={0.12} from={0.88} swing={since(b, judge, 1)} label="What you kept, a week later" />
        </div>
      </Layer>
    </Stage>
  )
}

/** c9-05: Kornell 2009 on the page; ten people: spacing won for nine; seven were sure it had lost. */
function SureItLost(props: SceneProps) {
  const b = useBeat(props)
  const crowdAt = cue(b, 0, 0.16)
  const nine = cue(b, 1, 0.31)
  const seven = cue(b, 2, 0.57)
  return (
    <Stage beat={b} label="In one experiment, spacing won for nine people of ten; seven of ten were sure it had lost">
      <Layer>
        <Paper beat={b} paper={PAPERS.kornell} at={{ in: 0, highlight: 0.03, lift: crowdAt + 0.02, out: crowdAt + 0.08 }} />
      </Layer>
      <Layer>
        <Crowd beat={b} appear={between(b, crowdAt, crowdAt + 0.14)} won={9} wonP={since(b, nine, 0.9)} wonText="Spacing won" wonTextP={since(b, nine + 0.04, 0.5)} doubt={7} doubtP={since(b, seven, 1.1)} doubtText="I think it lost" />
      </Layer>
      <Layer place="bottom">
        <Cite beat={b} paper={PAPERS.kornell} p={since(b, crowdAt + 0.06, 0.6)} />
      </Layer>
    </Stage>
  )
}

/** c9-11: the Science paper again; everyone guessed about half; the real bars: 80% and a third. Nobody saw it coming. */
function GuessedHalf(props: SceneProps) {
  const b = useBeat(props)
  const guessed = cue(b, 0, 0.14)
  const lift = cue(b, 1, 0.42)
  const eighty = cue(b, 2, 0.51)
  const third = cue(b, 3, 0.7)
  const nobody = cue(b, 4, 0.82)
  return (
    <Stage beat={b} label="Everyone guessed they would remember about half; some kept 80 percent, some kept a third">
      <Layer>
        <Paper beat={b} paper={PAPERS.karpickeGuesses} at={{ in: 0, highlight: guessed, lift, out: lift + 0.06 }} />
      </Layer>
      <Layer style={{ opacity: since(b, lift, 0.5) }}>
        <GuessBars
          beat={b}
          guess={50}
          guessLabel="Everyone guessed: about half"
          guessP={since(b, lift, 0.9)}
          bars={[
            { label: 'Kept recalling', value: 80, text: '80%', p: since(b, eighty, 1) },
            { label: 'Stopped recalling', value: 34, text: 'a third', p: since(b, third, 1) },
          ]}
          missP={since(b, nobody, 0.7)}
        />
        <Words size="title" tone="accent" style={rise(b, since(b, nobody + 0.02, 0.6))}>
          Nobody saw it coming.
        </Words>
      </Layer>
      <Layer place="bottom" style={{ opacity: since(b, lift, 0.5) }}>
        <Cite beat={b} paper={PAPERS.karpickeGuesses} p={1} />
      </Layer>
    </Stage>
  )
}

/** c9-06 and c9-07, one span: improving happens inside the review; a card is not clear, one needs a link; send the fix, keep going. */
function ImproveWhileReviewing(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const first = id === 'c9-06'
  const steps = first ? showFor(since(b, 0, 0.6), since(b, 0.44, 0.5)) : 0
  const inside = first ? since(b, cue(b, 0, 0.54), 0.6) : 1
  // c9-07: the first card is not clear; the next needs a link; the fix goes to the agent; the review goes on.
  const unclear = id === 'c9-07' ? since(b, 0.02, 0.5) : 0
  const second = id === 'c9-07' && b.progress >= cue(b, 0, 0.15) + 0.1
  const swap = id === 'c9-07' ? since(b, cue(b, 0, 0.15) + 0.06, 0.5) : 0
  const needsLink = id === 'c9-07' ? since(b, cue(b, 1, 0.39) - 0.04, 0.5) : 0
  const chat = id === 'c9-07' ? since(b, cue(b, 2, 0.55) - 0.03, 0.7) : 0
  const sent = id === 'c9-07' ? since(b, cue(b, 3, 0.69), 0.5) : 0
  const goOn = id === 'c9-07' ? since(b, cue(b, 4, 0.85), 0.5) : 0
  const card = second ? PROTEIN_BRANCH : SLEEP_DEBT
  return (
    <Stage beat={b} label={first ? 'Improving needs no time of its own: it happens while you review' : 'Not clear, needs a link: send the fix to your agent, and keep going'}>
      <Layer place="top" style={{ opacity: steps }}>
        <Habits beat={b} show={[1, 1, 1, 1]} lit={[0, 0, since(b, 0.05, 0.5), since(b, 0.05, 0.5)]} size="small" />
      </Layer>
      <Layer style={{ opacity: first ? since(b, 0.2, 0.6) : 1 }}>
        <div className="kit-row later-tend">
          <div className="later-tend__card" style={{ opacity: second ? clamp(swap * 2) * (1 - goOn * 0.6) : 1 - clamp(swap * 3) }}>
            <Fit>
              <CardView beat={b} title={card.title} id={card.id} text={card.text} sides={1} state="Due today" />
              <Answers beat={b} forgot={1} remembered={1} chosen={goOn > 0.3 ? 'remembered' : null} />
            </Fit>
            {inside > 0 && (
              <span className="later-tend__shears" style={pop(b, inside, 0.6)} aria-hidden="true">
                <HabitGlyph habit="improve" size={30} />
              </span>
            )}
            {unclear > 0 && !second && (
              <span className="later-bubble later-bubble--card" style={pop(b, unclear, 0.7)}>
                Not clear
              </span>
            )}
            {needsLink > 0 && second && (
              <span className="later-bubble later-bubble--card" style={pop(b, needsLink, 0.7)}>
                Needs a link
              </span>
            )}
          </div>
          <div className="later-tend__chat" style={{ maxWidth: `${(b.reduced ? (chat > 0 ? 1 : 0) : ease.out(chat)) * 30}em`, opacity: chat }}>
            <AgentChat
              beat={b}
              lines={[
                { who: 'you', text: 'The Protein card needs a link to How muscle grows. And make the Sleep debt clue clearer.', p: between(b, cue(b, 2, 0.55), cue(b, 3, 0.69)) },
                { who: 'agent', text: 'On it. I will show you each change before it lands.', p: sent },
              ]}
            />
          </div>
        </div>
      </Layer>
      {goOn > 0 && (
        <Layer place="bottom">
          <span className="kit-chip" style={pop(b, goOn)}>
            Next card
          </span>
        </Layer>
      )}
    </Stage>
  )
}

/** c9-08: a large card base; improving on a clock face: a couple of minutes a day. */
function Minutes(props: SceneProps) {
  const b = useBeat(props)
  const large = cue(b, 0, 0.09)
  const improving = cue(b, 1, 0.35)
  const mins = cue(b, 2, 0.6)
  const clock = since(b, improving - 0.05, 0.6)
  return (
    <Stage beat={b} label="Even with a large card base, improving takes a couple of minutes a day">
      <Layer style={{ opacity: lerp(1, 0.16, clock) * since(b, large, 0.5) }}>
        <Tally beat={b} count={600} fill={between(b, large, large + 0.18)} columns={40} />
        <Words size="kicker">A large card base</Words>
      </Layer>
      <Layer style={{ opacity: clock }}>
        <ClockArc beat={b} p={clock} arcs={[{ from: 0, to: 2, p: since(b, improving, 0.9), tone: 'soft' }]} label="A couple of minutes" labelP={since(b, mins, 0.5)} />
        <div className="later-legend" style={rise(b, since(b, improving, 0.5))}>
          <span>
            <i className="later-legend__key later-legend__key--soft" /> Improving
          </span>
          <span style={{ opacity: since(b, mins + 0.08, 0.5) }}>a day</span>
        </div>
      </Layer>
    </Stage>
  )
}

const TWO: { nodes: WebNode[]; edges: WebEdge[] } = {
  nodes: [
    { id: 'a', x: 190, y: 170, label: 'Protein', kind: 'card' },
    { id: 'b', x: 410, y: 170, label: 'How muscle grows', kind: 'card' },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'link' }],
}

/** c9-10: the four steps with their times, each on its word; then two cards, and a line drawn between them. */
function StepsAndTimes(props: SceneProps) {
  const b = useBeat(props)
  const at = [0, cue(b, 0, 0.14), cue(b, 1, 0.33), cue(b, 2, 0.477)]
  const next = cue(b, 3, 0.673)
  const out = since(b, next, 0.6)
  const on = at.map((a) => since(b, a, 0.4))
  return (
    <Stage beat={b} label="Capture all day, create with time set aside, review every day, improve as you review. Next: two cards and a line between them">
      <Layer style={{ opacity: 1 - out * 0.85, transform: b.reduced ? undefined : `translateY(${lerp(0, -26, moved(b, out)).toFixed(2)}cqh) scale(${lerp(1, 0.6, moved(b, out)).toFixed(3)})` }}>
        <Habits beat={b} show={[1, 1, 1, 1]} lit={on.map((p, i) => (i === 3 ? showFor(p, out) : showFor(p, on[i + 1])))} pages={['All day', 'Time set aside', 'Every day', 'As you review']} pageP={on} />
      </Layer>
      <Layer style={{ opacity: out, paddingTop: '18%' }}>
        <Web beat={b} nodes={TWO.nodes} edges={TWO.edges} show={{ a: since(b, next + 0.02, 0.5), b: since(b, next + 0.06, 0.5), 'a>b': since(b, next + 0.16, 0.9) }} />
      </Layer>
    </Stage>
  )
}

export const HABITS_SCENES: ChapterScenes = {
  chapter: 'habits',
  entries: [
    { clips: ['c9-01', 'c9-02'], scene: FourSteps },
    { clips: ['c9-12', 'c9-13'], scene: CaptureAllDay },
    { clips: ['c9-14', 'c9-15', 'c9-09'], scene: CreateQuietly },
    { clips: ['c9-03'], scene: DailyReview },
    { clips: ['c9-04'], scene: TrustSchedule },
    { clips: ['c9-05'], scene: SureItLost },
    { clips: ['c9-11'], scene: GuessedHalf },
    { clips: ['c9-06', 'c9-07'], scene: ImproveWhileReviewing },
    { clips: ['c9-08'], scene: Minutes },
    { clips: ['c9-10'], scene: StepsAndTimes },
  ],
}
