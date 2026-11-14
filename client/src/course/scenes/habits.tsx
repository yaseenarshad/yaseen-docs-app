/**
 * CHAPTER 9, "Three habits: make, review, tend" (YAZ-5121). The whole system at a glance: three icons, then what the
 * research says about trusting the schedule (Kornell 2009: the people and their wrong guess; Karpicke & Roediger 2008:
 * the guess line against the real bars), then tending inside the review, a couple of minutes of tending, and making
 * with time set aside. The storyboard is the comment above each clip in `script.ts`; the cues are `marks` there, set
 * from the real voice's word times, read with `cue()`.
 */
import type { SceneProps } from '../scene'
import { MANY_TITLES, PROTEIN_BRANCH, SLEEP_DEBT } from './cards'
import { PAPERS } from './papers'
import { Answers, AppWindow, CardView, Cite, Fit, Layer, MiniCard, Paper, SidebarPreview, Stage, Tally, Timeline, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, useBeat, HabitGlyph, Habits, AgentChat, Crowd, GuessBars, ClockArc, Gauge, Head, Web, type WebEdge, type WebNode } from './kit'
import type { ChapterScenes } from './registry'
import './habits.css'

/** c9-01, c9-02 and c9-03, one span: step back from the cards; the three habits; reviewing is the daily one. */
function ThreeHabits(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  // c9-01: the cards so far, and the camera steps back from them.
  const back = id === 'c9-01' ? moved(b, between(b, 0.1, 0.95)) : 1
  const cardsOut = id === 'c9-01' ? 0 : since(b, 0, 0.5)
  // c9-02: each habit on its word; "fixing and improving" under Tend.
  const show = id === 'c9-01' ? [0, 0, 0] : id === 'c9-02' ? [since(b, cue(b, 0, 0.19), 0.5), since(b, cue(b, 1, 0.3), 0.5), since(b, cue(b, 2, 0.45), 0.5)] : [1, 1, 1]
  const tendLit = id === 'c9-02' ? showFor(since(b, cue(b, 3, 0.61), 0.4), 0) : 0
  // c9-03: Review lights; a sunrise; the Inbox opens and the app picks the cards.
  const daily = id === 'c9-03' ? since(b, cue(b, 0, 0.2), 1.2) : 0
  const inbox = id === 'c9-03' ? since(b, cue(b, 1, 0.48), 0.6) : 0
  const picks = id === 'c9-03' ? cue(b, 2, 0.73) : 2
  const up = id === 'c9-03' ? moved(b, since(b, cue(b, 1, 0.48) - 0.05, 0.6)) : 0
  return (
    <Stage beat={b} label={id === 'c9-01' ? 'The whole system, from a step back' : id === 'c9-02' ? 'Three habits: make, review, tend' : 'Reviewing is the daily habit: open the Inbox, and the app picks the cards'}>
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
      {id === 'c9-03' && (
        <Layer place="bottom" style={{ opacity: daily * (1 - inbox * 0.7) }}>
          <svg className="later-sun" viewBox="0 0 400 120" aria-hidden="true">
            <circle className="later-sun__disc" cx={200} cy={lerp(150, 92, b.reduced ? 1 : ease.out(daily))} r={46} />
            <line className="later-sun__horizon" x1={20} y1={118} x2={380} y2={118} />
          </svg>
        </Layer>
      )}
      <Layer style={{ transform: b.reduced ? undefined : `translateY(${lerp(0, -30, up).toFixed(2)}cqh) scale(${lerp(1, 0.85, up).toFixed(3)})` }}>
        <Habits beat={b} show={show} lit={id === 'c9-03' ? [0, since(b, 0, 0.6), 0] : [0, 0, tendLit]} pages={id === 'c9-02' ? [undefined, undefined, 'fixing and improving'] : undefined} pageP={[0, 0, tendLit]} />
      </Layer>
      {id === 'c9-03' && inbox > 0 && (
        <Layer style={{ opacity: inbox, paddingTop: '20%' }}>
          <AppWindow
            sidebar={<SidebarPreview inbox={12} inboxGlow={showFor(since(b, cue(b, 1, 0.48), 0.5), since(b, picks + 0.12, 0.6))} rows={[{ name: 'Course Cards', kind: 'folder' }, { name: 'Projects', kind: 'folder' }]} />}
            style={{ height: 'min(48cqh, 16em)' }}
            label="The Inbox: the app picks the cards that are due"
          >
            <div className="later-picks">
              {['Sleep debt adds up', 'Protein', 'candid'].map((title, i) => (
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

/** c9-06 and c9-07, one span: tending happens inside the review; a card is not clear, one needs a link; send the fix, keep going. */
function TendWhileReviewing(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const first = id === 'c9-06'
  const shears = first ? showFor(since(b, 0, 0.6), since(b, 0.44, 0.5)) : 0
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
    <Stage beat={b} label={first ? 'Tending needs no time of its own: it happens while you review' : 'Not clear, needs a link: send the fix to your agent, and keep going'}>
      <Layer place="top" style={{ opacity: shears }}>
        <Habits beat={b} show={[1, 1, 1]} lit={[0, 0, since(b, 0.05, 0.5)]} size="small" />
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
                <HabitGlyph habit="tend" size={30} />
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

/** c9-08: a large card base; tending on a clock face: a couple of minutes a day. */
function Minutes(props: SceneProps) {
  const b = useBeat(props)
  const large = cue(b, 0, 0.09)
  const tending = cue(b, 1, 0.35)
  const mins = cue(b, 2, 0.6)
  const clock = since(b, tending - 0.05, 0.6)
  return (
    <Stage beat={b} label="Even with a large card base, tending takes a couple of minutes a day">
      <Layer style={{ opacity: lerp(1, 0.16, clock) * since(b, large, 0.5) }}>
        <Tally beat={b} count={600} fill={between(b, large, large + 0.18)} columns={40} />
        <Words size="kicker">A large card base</Words>
      </Layer>
      <Layer style={{ opacity: clock }}>
        <ClockArc
          beat={b}
          p={clock}
          arcs={[{ from: 0, to: 2, p: since(b, tending, 0.9), tone: 'soft' }]}
          label="A couple of minutes"
          labelP={since(b, mins, 0.5)}
        />
        <div className="later-legend" style={rise(b, since(b, tending, 0.5))}>
          <span>
            <i className="later-legend__key later-legend__key--soft" /> Tending
          </span>
          <span style={{ opacity: since(b, mins + 0.08, 0.5) }}>a day</span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c9-09: the pen lights; a quiet desk, a lamp; digesting takes thought. */
function QuietDesk(props: SceneProps) {
  const b = useBeat(props)
  const thought = cue(b, 0, 0.43)
  const quiet = cue(b, 1, 0.84)
  const lamp = since(b, quiet - 0.1, 1.2)
  const dots = since(b, thought, 1.6)
  return (
    <Stage beat={b} label="Making is the one you set time aside for: a quiet moment to digest">
      <Layer place="top">
        <Habits beat={b} show={[1, 1, 1]} lit={[since(b, 0, 0.6), 0, 0]} size="small" pages={['time set aside']} pageP={[since(b, 0.2, 0.5)]} />
      </Layer>
      <Layer style={{ paddingTop: '14%' }}>
        <svg className="later-desk" viewBox="0 0 420 220" aria-hidden="true" style={{ opacity: since(b, 0.1, 0.8) }}>
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
            return <circle key={i} className="later-desk__thought" cx={205 + i * 16} cy={lerp(140, 104 - i * 14, b.reduced ? 1 : ease.out(p))} r={4 + i * 2.5} opacity={clamp(p * 2) * (1 - since(b, 0.97, 0.3))} />
          })}
        </svg>
        <Words size="title" style={rise(b, since(b, quiet, 0.6))}>
          A quiet moment
        </Words>
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

/** c9-10: the three habits with their times; then two cards, and a line drawn between them. */
function HabitsAndTimes(props: SceneProps) {
  const b = useBeat(props)
  const review = cue(b, 0, 0.24)
  const tend = cue(b, 1, 0.39)
  const next = cue(b, 2, 0.59)
  const out = since(b, next, 0.6)
  return (
    <Stage beat={b} label="Make with time set aside, review every day, tend as you review. Next: two cards and a line between them">
      <Layer style={{ opacity: 1 - out * 0.85, transform: b.reduced ? undefined : `translateY(${lerp(0, -26, moved(b, out)).toFixed(2)}cqh) scale(${lerp(1, 0.6, moved(b, out)).toFixed(3)})` }}>
        <Habits beat={b} show={[1, 1, 1]} lit={[since(b, 0, 0.5) * (1 - since(b, review, 0.4)), showFor(since(b, review, 0.4), since(b, tend, 0.4)), showFor(since(b, tend, 0.4), out)]} pages={['Time set aside', 'Every day', 'As you review']} pageP={[since(b, 0.02, 0.5), since(b, review, 0.5), since(b, tend, 0.5)]} />
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
    { clips: ['c9-01', 'c9-02', 'c9-03'], scene: ThreeHabits },
    { clips: ['c9-04'], scene: TrustSchedule },
    { clips: ['c9-05'], scene: SureItLost },
    { clips: ['c9-11'], scene: GuessedHalf },
    { clips: ['c9-06', 'c9-07'], scene: TendWhileReviewing },
    { clips: ['c9-08'], scene: Minutes },
    { clips: ['c9-09'], scene: QuietDesk },
    { clips: ['c9-10'], scene: HabitsAndTimes },
  ],
}
