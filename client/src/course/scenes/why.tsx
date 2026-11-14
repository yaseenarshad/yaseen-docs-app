/**
 * CHAPTER 1, "Why you forget, and the fix" (YAZ-5121): the hook. The storyboard is the comment above each clip in
 * `script.ts`; the fractions here are where the words land in the real voice (`timestamps/<clip>.json`, George), so a
 * picture lands on its word. Each scene is a pure drawing of its beat (`kit/beat.ts`).
 */
import type { SceneProps } from '../scene'
import { COURSE } from '../script'
import { PAPERS } from './papers'
import { COURSE_MINUTES } from '../courseFacts'
import { CANBERRA, MANY_TITLES } from './cards'
import {
  Answers,
  AppWindow,
  BigNumber,
  BrainCells,
  Calendar,
  CardView,
  Cite,
  Curve,
  Fit,
  Gears,
  IndexCard,
  Layer,
  Medal,
  MiniCard,
  Orb,
  Paper,
  Ridge,
  SAMPLE_REVIEWS,
  SidebarPreview,
  Stage,
  TryChip,
  Tally,
  Words,
  between,
  clamp,
  cue,
  dayAt,
  ease,
  lerp,
  memory,
  moved,
  pathOf,
  pop,
  rise,
  showFor,
  since,
  useBeat,
  xOf,
  yOf,
  type Axis,
  type Beat,
  type Review,
} from './kit'
import type { ChapterScenes } from './registry'

const WEEK: Axis = { days: 7 }
const DAY_TICKS = [1, 2, 3, 4, 5, 6, 7]

/** c1-01: a fact glows; a week passes on the curve, and the fact fades with it. */
function Forget(props: SceneProps) {
  const b = useBeat(props)
  const axes = between(b, 0.1, 0.3)
  const week = cue(b, 0, 0.389)
  const cursor = 7 * moved(b, between(b, week, 0.92), ease.inOut)
  const kept = (memory(cursor, 1.6) - 0.2) / 0.8
  const factIn = since(b, 0, 0.7)
  return (
    <Stage beat={b} label="A fact you learn today, and the forgetting curve over one week">
      <Layer place="top" style={{ paddingTop: '6%' }}>
        <span
          className="kit-fact"
          style={{
            ...rise(b, factIn),
            opacity: clamp(factIn) * lerp(0.18, 1, kept),
            filter: b.reduced ? undefined : `blur(${((1 - kept) * 2.4).toFixed(2)}px)`,
          }}
        >
          The capital of Australia is Canberra.
        </span>
      </Layer>
      <Layer style={{ paddingTop: '16%' }}>
        <Curve
          beat={b}
          axis={WEEK}
          axes={axes}
          cursor={cursor}
          ticks={DAY_TICKS.map((d) => ({
            day: d,
            label: String(d),
            p: between(b, week + (d - 1) * 0.07, week + 0.06 + (d - 1) * 0.07),
          }))}
          pages={[
            {
              day: 6.6,
              r: memory(7, 1.6) + 0.09,
              text: 'about a quarter left',
              p: between(b, cue(b, 1, 0.757) + 0.04, 0.92),
              tone: 'strong',
              anchor: 'end',
            },
          ]}
        />
      </Layer>
    </Stage>
  )
}

const SYLLABLES = ['DAX', 'BOK', 'YAT', 'ZUP', 'KEF', 'MIB', 'LOZ', 'TAV', 'WUJ', 'GIP', 'RUF', 'NEX']
/** The syllables that stay after a day (the rest fade: most of the work is gone). */
const KEPT = new Set([1, 6, 10])

/** c1-02: Ebbinghaus's notebook of nonsense syllables, 1885; a day later most are gone; learning again took ⅔. */
function Notebook(props: SceneProps) {
  const b = useBeat(props)
  const book = since(b, 0, 0.8)
  const dayLater = since(b, cue(b, 0, 0.378), 0.6)
  const gone = between(b, cue(b, 1, 0.546), cue(b, 1, 0.546) + 0.13)
  const thirds = cue(b, 2, 0.816)
  const bars = since(b, thirds - 0.1, 0.5)
  const again = since(b, thirds - 0.02, 1.2)
  return (
    <Stage beat={b} label="Ebbinghaus's notebook, 1885: a list of nonsense syllables; a day later most were gone, and relearning took two thirds of the time">
      <Layer>
        <div className="kit-row">
          <div className="kit-notebook" style={rise(b, book, 14)}>
            <p className="kit-notebook__head">
              <span>H. Ebbinghaus</span>
              <span>1885</span>
            </p>
            <div className="kit-notebook__grid">
              {SYLLABLES.map((s, i) => (
                <span
                  key={s}
                  style={{
                    opacity: between(b, 0.03 + i * 0.022, 0.07 + i * 0.022) * (KEPT.has(i) ? 1 : lerp(1, 0.12, gone)),
                  }}
                  className={!KEPT.has(i) && gone > 0.5 ? 'is-gone' : undefined}
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="kit-notebook__day" style={rise(b, dayLater, 6)}>
              One day later
            </p>
          </div>
          <div className="kit-relearn" style={rise(b, bars, 10)}>
            <p className="kit-relearn__row">
              <span>To learn the list</span>
              <span className="kit-relearn__track">
                <i
                  style={{
                    width: `${(100 * moved(b, since(b, thirds - 0.1, 0.8), ease.out)).toFixed(1)}%`,
                  }}
                />
              </span>
            </p>
            <p className="kit-relearn__row">
              <span>To learn it again</span>
              <span className="kit-relearn__track">
                <i
                  className="is-accent"
                  style={{
                    width: `${(66.7 * moved(b, again, ease.out)).toFixed(1)}%`,
                  }}
                />
              </span>
            </p>
            <Words size="title" tone="accent" style={rise(b, since(b, thirds + 0.03, 0.6))}>
              ⅔ of the time
            </Words>
          </div>
        </div>
      </Layer>
      <Layer place="bottom">
        <Cite beat={b} paper={PAPERS.ebbinghaus} p={since(b, 0.12, 0.6)} />
      </Layer>
    </Stage>
  )
}

/** Ebbinghaus's own savings, as days and the share kept (Murre & Dros 2015, Table 3), drawn as dots. */
const OLD_POINTS: readonly (readonly [number, number])[] = [
  [0.014, 0.582],
  [0.042, 0.442],
  [0.375, 0.358],
  [1, 0.337],
  [2, 0.278],
  [6, 0.254],
  [31, 0.211],
]
/** The new curve, drawn as a line close to the old dots (a drawing, not the paper's figure). */
const NEW_POINTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.014, 0.6],
  [0.042, 0.47],
  [0.375, 0.37],
  [1, 0.32],
  [2, 0.29],
  [6, 0.25],
  [31, 0.2],
]
const MONTH_WARP: Axis = { days: 31, warp: 0.3 }

/** c1-22: the 2015 paper slides in, its line is highlighted; then its curve lands on the 1885 dots. */
function Replication(props: SceneProps) {
  const b = useBeat(props)
  const later = cue(b, 1, 0.503)
  const sameAt = cue(b, 2, 0.819)
  const chart = since(b, later + 0.02, 0.6)
  const dots = between(b, later, later + 0.12)
  const draw = moved(b, between(b, later + 0.1, sameAt), ease.inOut)
  const same = since(b, sameAt - 0.01, 0.7)
  return (
    <Stage beat={b} label="The 2015 replication: the same forgetting curve as in 1885">
      <Layer>
        <Paper beat={b} paper={PAPERS.murreDros} at={{ in: 0.03, highlight: cue(b, 0, 0.267) - 0.03, lift: later, out: later + 0.06 }} />
      </Layer>
      <Layer style={{ opacity: chart }}>
        <Curve beat={b} axis={MONTH_WARP} axes={1} cursor={0} today={false} dots={{ points: OLD_POINTS, p: dots }} yLabel="How much was kept" xLabel="Time since learning">
          <path className="kit-curve-line" d={pathOf(NEW_POINTS.map(([d, r]) => [xOf(MONTH_WARP, d), yOf(r)] as [number, number]))} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
          {same > 0 && <path className="kit-curve-glow" d={pathOf(NEW_POINTS.map(([d, r]) => [xOf(MONTH_WARP, d), yOf(r)] as [number, number]))} opacity={0.3 * Math.sin(Math.PI * clamp(same))} />}
          <g opacity={dots}>
            <circle className="kit-dot-old" cx={392} cy={70} r={5} />
            <text className="kit-svg-label" x={404} y={75}>
              1885, Ebbinghaus
            </text>
          </g>
          <g opacity={between(b, later + 0.16, later + 0.26)}>
            <line className="kit-curve-line" x1={384} y1={98} x2={400} y2={98} />
            <text className="kit-svg-label kit-svg-label--accent" x={404} y={103}>
              2015, the same test again
            </text>
          </g>
          <text className="kit-svg-label kit-svg-label--accent" x={(392 + 560) / 2} y={140} textAnchor="middle" opacity={same}>
            The same curve
          </text>
        </Curve>
      </Layer>
    </Stage>
  )
}

/** c1-03 and s2b, one span: a review lifts the curve, it falls slower; then the gaps grow, a day, a week, a month. */
function Reviews(props: SceneProps) {
  const b = useBeat(props)
  const second = props.clip.id === 's2b'
  let cursor: number
  let axis: Axis = WEEK
  const jumps = [0, 0, 0, 0]
  let ghost = 1
  let stretch = 0
  if (!second) {
    const rewind = between(b, 0, 0.12)
    cursor = 7 * (1 - moved(b, rewind))
    const fall = between(b, 0.14, 0.42)
    if (fall > 0) cursor = moved(b, fall)
    jumps[0] = moved(b, since(b, 0.44, 0.25), ease.out)
    const slow = between(b, 0.52, 0.97)
    if (slow > 0) cursor = 1 + moved(b, slow, ease.out)
    ghost = rewind
  } else {
    const m = b.marks.length === 3 ? b.marks : [0.431, 0.608, 0.786]
    stretch = moved(b, between(b, 0.04, 0.36))
    axis = { days: lerp(7, 45, stretch), warp: lerp(1, 0.55, stretch) }
    jumps[0] = 1
    jumps[1] = moved(b, since(b, m[0], 0.22), ease.out)
    jumps[2] = moved(b, since(b, m[1], 0.22), ease.out)
    jumps[3] = moved(b, since(b, m[2], 0.22), ease.out)
    cursor = 2
    const a1 = between(b, m[0] + 0.04, m[1] - 0.005)
    const a2 = between(b, m[1] + 0.04, m[2] - 0.005)
    const a3 = between(b, m[2] + 0.04, 1)
    if (a1 > 0) cursor = lerp(2, 9, moved(b, a1))
    if (a2 > 0) cursor = lerp(9, 39, moved(b, a2))
    if (a3 > 0) cursor = lerp(39, 45, moved(b, a3, ease.out))
    ghost = 1 - stretch
  }
  const reviews: Review[] = SAMPLE_REVIEWS.map((r, i) => (i === 0 && second ? { ...r, label: undefined } : r))
  const ticks = [
    ...DAY_TICKS.map((d) => ({
      day: d,
      label: String(d),
      p: d >= 2 && d <= 6 ? 1 - stretch : 1,
    })),
    { day: 14, label: '14', p: stretch },
    { day: 30, label: '30', p: stretch },
  ]
  return (
    <Stage beat={b} label="A review lifts the curve, and each gap after it grows">
      <Layer>
        <Curve beat={b} axis={axis} axes={1} cursor={cursor} reviews={reviews} jumps={jumps} ghost={ghost} ticks={ticks} />
      </Layer>
    </Stage>
  )
}

/** c1-04 and c1-05, one span: a fragile memory grows stable; then each review pushes it down into long-term memory. */
function Consolidation(props: SceneProps) {
  const b = useBeat(props)
  const second = props.clip.id === 'c1-05'
  const stable = second ? 1 : moved(b, between(b, 0.32, 0.62), ease.inOut)
  const word = second ? 1 - since(b, 0, 0.5) : since(b, 0.76, 0.7)
  const bands = second ? since(b, 0, 0.7) : 0
  // c1-05: the orb goes to the top band, then three reviews push it down a band's step each.
  const pushes = [cue(b, 0, 0.161), cue(b, 1, 0.475), cue(b, 2, 0.704)].map((at) => moved(b, since(b, at, 0.55), ease.out))
  const depth = second ? lerp(0, -22, moved(b, between(b, 0, 0.12))) + pushes.reduce((sum, p) => sum + p * 17, 0) : 0
  const ring = pushes.map((p, i) => (second && p > 0 && p < 1 ? i : -1)).filter((i) => i >= 0)
  const glow = second ? (ring.length > 0 ? 1 : since(b, 0.76, 0.6)) : 0
  return (
    <Stage beat={b} label={second ? 'Each review pushes the memory from short-term into long-term memory' : 'A new memory: fragile at first, then stable'}>
      <Layer place="fill" style={{ opacity: bands, padding: 0 }}>
        <div className="kit-bands">
          <div className="kit-bands__band">
            <span>Short-term</span>
          </div>
          <div
            className="kit-bands__band kit-bands__band--deep"
            style={{
              boxShadow: `inset 0 0 0 ${(2 * since(b, 0.76, 0.5)).toFixed(2)}px var(--accent)`,
            }}
          >
            <span>Long-term</span>
          </div>
        </div>
      </Layer>
      <Layer
        style={{
          transform: b.reduced ? undefined : `translateY(${depth.toFixed(2)}%)`,
          top: b.reduced && second ? `${(depth * 0.9).toFixed(1)}%` : undefined,
        }}
      >
        <Orb beat={b} stable={stable} glow={glow} size={second ? 0.8 : 1} />
        {!second && (
          <div className="kit-orb-words">
            <Words
              size="label"
              tone="muted"
              style={{
                opacity: showFor(since(b, 0.17, 0.5), since(b, 0.52, 0.4)),
              }}
            >
              Fragile
            </Words>
            <Words
              size="label"
              tone="accent"
              style={{
                opacity: showFor(since(b, 0.54, 0.5), since(b, 0.74, 0.4)),
              }}
            >
              Stable
            </Words>
          </div>
        )}
      </Layer>
      <Layer place="bottom">
        <Words size="title" style={rise(b, word)}>
          Consolidation
        </Words>
      </Layer>
    </Stage>
  )
}

/** c1-18 and c1-19, one span: two brain cells; spaced pulses switch on the memory genes; then the Nobel Prize. */
function Cells(props: SceneProps) {
  const b = useBeat(props)
  const nobel = props.clip.id === 'c1-19'
  const hard = nobel ? 0 : showFor(since(b, 0, 0.5), since(b, 0.2, 0.4))
  const draw = nobel ? 1 : since(b, 0.22, 0.9)
  const pulseAt = [cue(b, 1, 0.515), cue(b, 2, 0.633) - 0.01, cue(b, 3, 0.73) - 0.01]
  const pulses = nobel ? [] : pulseAt.map((at) => since(b, at, 0.55))
  const switches = nobel ? [1] : pulseAt.map((at) => since(b, at + 0.55 / b.length, 0.5))
  const strength = nobel ? 1 : switches.reduce((s, p) => s + p / 3, 0)
  const medal = nobel ? since(b, cue(b, 0, 0.641), 0.9) : 0
  const away = nobel ? moved(b, since(b, 0.55, 0.8)) : 0
  return (
    <Stage beat={b} label={nobel ? 'A Nobel Prize for how brain cells store a memory, 2000' : 'Two brain cells: each spaced pulse switches on the genes for long-term memory'}>
      <Layer>
        <Words size="display" style={rise(b, hard)}>
          Hard science.
        </Words>
      </Layer>
      <Layer
        style={{
          opacity: draw * lerp(1, 0.18, away),
          transform: b.reduced ? undefined : `scale(${lerp(1, 0.8, away).toFixed(3)})`,
        }}
      >
        <BrainCells beat={b} draw={draw} pulses={pulses} strength={strength} switches={switches} labels={nobel ? 1 : since(b, 0.4, 0.6)} />
      </Layer>
      {nobel && (
        <Layer>
          <Medal beat={b} p={medal} shine={since(b, 0.8, 1.1)} year="2000" />
          <div style={rise(b, since(b, 0.74, 0.6))}>
            <Words size="title">Nobel Prize</Words>
            <Words size="page">Physiology or Medicine · how brain cells store memory</Words>
          </div>
        </Layer>
      )}
      {!nobel && (
        <Layer place="bottom">
          <Cite beat={b} paper={PAPERS.naqib} p={since(b, 0.3, 0.6)} />
        </Layer>
      )}
    </Stage>
  )
}

/** c1-06: a century of tests; the review of 317 experiments; 317 lifts out; the wall of experiments, and spacing won. */
function Experiments(props: SceneProps) {
  const b = useBeat(props)
  const century = showFor(since(b, 0, 0.6), since(b, 0.34, 0.4))
  const review = cue(b, 0, 0.382)
  const n317 = cue(b, 1, 0.547)
  const wonAt = cue(b, 2, 0.842)
  const big = since(b, n317, 0.9)
  const up = moved(b, since(b, n317 + 0.11, 0.7))
  const wall = since(b, n317 + 0.11, 0.4)
  const fill = between(b, n317 + 0.11, wonAt)
  const won = since(b, wonAt, 0.7)
  return (
    <Stage beat={b} label="One review of 317 experiments: spacing won">
      <Layer>
        <div style={rise(b, century)}>
          <Words size="kicker">More than a century of tests</Words>
          <Words size="display" style={{ fontVariantNumeric: 'tabular-nums' }}>
            1885 → {Math.round(lerp(1885, 2026, b.reduced ? 1 : ease.out(between(b, 0.04, 0.26))))}
          </Words>
        </div>
      </Layer>
      <Layer>
        <Paper beat={b} paper={PAPERS.cepeda2006} at={{ in: review - 0.01, highlight: review + 0.05, lift: n317 - 0.01, out: n317 + 0.09 }} />
      </Layer>
      <Layer
        place="top"
        style={{
          transform: b.reduced ? undefined : `translateY(${lerp(30, 0, up).toFixed(2)}%) scale(${lerp(1, 0.55, up).toFixed(3)})`,
          paddingTop: '2%',
        }}
      >
        <BigNumber beat={b} p={big} value={317} label="experiments" />
      </Layer>
      <Layer style={{ opacity: wall, paddingTop: '22%' }}>
        <Tally beat={b} count={317} fill={fill} win={won} columns={29} />
        <Words size="title" tone="accent" style={rise(b, won)}>
          Spacing won.
        </Words>
      </Layer>
    </Stage>
  )
}

/** c1-20: the best moment to review: the 2008 study of more than 1,350 people, then its ridge. */
function BestMoment(props: SceneProps) {
  const b = useBeat(props)
  const title = showFor(since(b, 0.02, 0.6), since(b, 0.29, 0.4))
  const study = cue(b, 0, 0.335)
  const n1300 = cue(b, 1, 0.428)
  const people = showFor(since(b, n1300 - 0.01, 0.9), since(b, n1300 + 0.13, 0.5))
  const ridge = since(b, n1300 + 0.13, 0.5)
  return (
    <Stage beat={b} label="Too early or too late, and you keep less: the best moment to review is in the middle">
      <Layer>
        <Words size="display" style={rise(b, title)}>
          The best moment
        </Words>
      </Layer>
      <Layer>
        <Paper beat={b} paper={PAPERS.cepeda2008} at={{ in: study - 0.035, highlight: study + 0.015, lift: n1300 - 0.008, out: n1300 + 0.13 }} />
      </Layer>
      <Layer style={{ opacity: people }}>
        <BigNumber beat={b} p={since(b, n1300 - 0.01, 0.9)} value={1350} text="1,350+" label="people" />
      </Layer>
      <Layer style={{ opacity: ridge }}>
        <Ridge beat={b} draw={between(b, n1300 + 0.13, n1300 + 0.27)} early={since(b, cue(b, 2, 0.677), 0.6)} late={since(b, cue(b, 3, 0.774), 0.6)} peak={since(b, cue(b, 4, 0.871) - 0.01, 0.7)} />
      </Layer>
    </Stage>
  )
}

const THINGS = ['a word', 'a fact', 'a name', 'an idea', 'a date', 'a rule']
const THING_AT: readonly [number, number][] = [
  [-30, -26],
  [26, -30],
  [-36, 6],
  [34, 4],
  [-20, 30],
  [22, 28],
]

/** c1-07, c1-08 and c1-09, one span: things you learn; on a card (paper); the app's real card; many cards. */
function TheCard(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  // c1-07: the things drift in, then gather into the paper index card ("on a card").
  const things = id === 'c1-07' ? since(b, 0.12, 0.8) : 0
  const gather = id === 'c1-07' ? moved(b, between(b, 0.6, 0.76)) : 1
  const drift = b.reduced ? 0 : Math.sin(b.t * 0.9)
  const paper = id === 'c1-07' ? since(b, 0.76, 0.6) : id === 'c1-08' ? 1 - since(b, 0, 0.5) : 0
  // c1-08: the real card, its word shown, then hidden.
  const real = id === 'c1-08' ? since(b, 0.08, 0.6) : id === 'c1-09' ? 1 - since(b, 0, 0.6) : 0
  const hidden = id === 'c1-08' && b.progress >= 0.6
  // c1-09: many cards.
  const many = id === 'c1-09' ? between(b, 0.1, 0.62) : 0
  return (
    <Stage beat={b} label={id === 'c1-07' ? 'Each thing you learn goes on a card' : id === 'c1-08' ? 'A card: one idea, with part of it hidden' : 'Many cards, one for each thing you want to keep'}>
      {id === 'c1-07' && (
        <Layer>
          {THINGS.map((thing, i) => (
            <span
              key={thing}
              className="kit-float"
              style={{
                opacity: clamp(things * 2 - i * 0.15) * (1 - gather),
                transform: `translate(${lerp(THING_AT[i][0], 0, gather) * (b.reduced ? 1 : 1)}cqw, ${lerp(THING_AT[i][1] + drift * (i % 2 === 0 ? 1.4 : -1.4), 0, gather)}cqh)`,
              }}
            >
              {thing}
            </span>
          ))}
        </Layer>
      )}
      <Layer>
        <IndexCard style={pop(b, paper, 0.7)} />
      </Layer>
      <Layer style={{ opacity: real }}>
        <CardView beat={b} title={CANBERRA.title} text={CANBERRA.text} sides={1} shown={hidden ? 0 : 1} blanks={hidden ? 1 - since(b, 0.8, 0.8) : 0} />
      </Layer>
      {id === 'c1-09' && (
        <Layer>
          <div className="kit-many">
            {MANY_TITLES.slice(0, 9).map((title, i) => (
              <MiniCard key={title} title={title} style={pop(b, clamp(many * 9 - i), 0.5)} />
            ))}
          </div>
        </Layer>
      )}
    </Stage>
  )
}

/** The card the model follows in c1-16 to c1-17: it reaches the 90% line on day 9. */
const NINE = dayAt(0.9, 1) // days at stability 1
const S9 = 9 / NINE
const TWO_WEEKS: Axis = { days: 14 }
const CLOSE = 0.8

/** c1-16, c1-12, c1-17 and c1-21, one span: the algorithm, FSRS, the odds day by day, the moment for each card. */
function Model(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const gears = id === 'c1-16' ? since(b, 0.09, 0.8) : id === 'c1-12' ? 1 - since(b, 0.1, 0.6) : 0
  // The curve: drawn in c1-16, dims under FSRS in c1-12, walks day by day in c1-17.
  let cursor = 0
  if (id === 'c1-16') cursor = 9 * moved(b, between(b, 0.25, 0.45))
  else if (id === 'c1-12') cursor = 9
  else if (id === 'c1-17') cursor = lerp(0.001, 9, moved(b, between(b, 0.17, 0.72), ease.linear))
  const curveOn = id === 'c1-16' ? since(b, 0.22, 0.6) : id === 'c1-12' ? lerp(1, 0.25, since(b, 0.15, 0.6)) : id === 'c1-17' ? 1 : 0
  const predict = id === 'c1-16' ? since(b, 0.45, 0.7) : 0
  const named = id === 'c1-16' ? since(b, 0.74, 0.8) : 0
  const fsrs = id === 'c1-12' ? since(b, 0.2, 0.7) : id === 'c1-17' ? 1 - since(b, 0, 0.5) : 0
  const readout = id === 'c1-12' ? since(b, 0.57, 0.6) : 0
  const line = id === 'c1-17' ? since(b, 0.58, 0.8) : id === 'c1-16' ? predict : 0
  const back = id === 'c1-17' ? since(b, 0.82, 0.7) : 0
  const day = Math.floor(cursor)
  const odds = Math.round(memory(cursor, S9) * 100)
  const xNine = xOf(TWO_WEEKS, 9)
  const yNine = yOf(0.9, CLOSE)
  return (
    <Stage beat={b} label={id === 'c1-21' ? 'The algorithm finds the moment for each card' : 'The algorithm follows each card, and brings it back when the odds drop to about 90%'}>
      <Layer place="top" style={{ alignItems: 'flex-end', opacity: gears }}>
        <Gears beat={b} p={gears} />
      </Layer>
      {id !== 'c1-21' && (
        <Layer style={{ opacity: curveOn }}>
          <Curve
            beat={b}
            axis={TWO_WEEKS}
            axes={1}
            cursor={cursor}
            s0={S9}
            lo={CLOSE}
            line90={line}
            yLabel="Chance you remember"
            pages={[
              {
                day: Math.max(1.6, cursor),
                r: Math.min(0.99, memory(cursor, S9) + 0.03),
                text: `Day ${day} · ${odds}%`,
                p: id === 'c1-17' ? between(b, 0.17, 0.24) * (1 - back) : 0,
                tone: 'accent',
                anchor: 'middle',
              },
              {
                day: 9,
                r: 0.84,
                text: 'Comes back: day 9',
                p: back,
                tone: 'accent',
              },
            ]}
          >
            {predict > 0 && (
              <g opacity={predict}>
                <line className="kit-line90" x1={xNine} y1={yNine} x2={xNine} y2={yOf(CLOSE, CLOSE)} />
                <rect className="kit-cal__chip" x={xNine - 22} y={yOf(CLOSE, CLOSE) - 46} width={44} height={36} rx={6} />
                <text className="kit-svg-label kit-svg-label--accent" x={xNine} y={yOf(CLOSE, CLOSE) - 22} textAnchor="middle">
                  21
                </text>
              </g>
            )}
            {back > 0 && (
              <rect
                className="kit-cal__chip"
                x={xNine - 16}
                y={yNine - 11}
                width={32}
                height={22}
                rx={4}
                transform={b.reduced ? undefined : `rotate(${(-6 * (1 - ease.out(back))).toFixed(2)} ${xNine} ${yNine})`}
                opacity={clamp(back * 2)}
              />
            )}
          </Curve>
        </Layer>
      )}
      <Layer place="bottom">
        <Words size="title" style={rise(b, named)}>
          Spaced repetition algorithm
        </Words>
      </Layer>
      <Layer>
        <div style={pop(b, fsrs, 0.7)}>
          <Words size="display" tone="accent">
            FSRS
          </Words>
        </div>
        <div className="kit-readout" style={rise(b, readout)}>
          <span>
            Stability <b>{(11.2 * clamp(readout * 1.2)).toFixed(1)} days</b>
          </span>
          <span>
            Difficulty <b>{(5.1 * clamp(readout * 1.2)).toFixed(1)}</b>
          </span>
          <span>
            Chance you remember <b>{Math.round(lerp(100, 94, clamp(readout)))}%</b>
          </span>
        </div>
      </Layer>
      {id === 'c1-21' && <Moments b={b} />}
    </Stage>
  )
}

/** c1-21: three cards, three curves, three moments where each meets the 90% line. */
function Moments({ b }: { b: Beat }) {
  const cards = [
    { s: 3 / NINE, day: 3, name: 'A hard card', at: 0.13 },
    { s: 9 / NINE, day: 9, name: 'A medium card', at: 0.31 },
    { s: 22 / NINE, day: 22, name: 'An easy card', at: 0.49 },
  ]
  const axis: Axis = { days: 26 }
  return (
    <Layer>
      <Curve beat={b} axis={axis} axes={since(b, 0, 0.5)} cursor={0} lo={CLOSE} line90={1} yLabel="Chance you remember">
        {cards.map((c) => {
          const p = since(b, c.at, 0.9)
          const pts: [number, number][] = []
          for (let d = 0; d <= Math.min(26, c.day * 1.25); d += 0.25) pts.push([xOf(axis, d), yOf(memory(d, c.s), CLOSE)])
          const x = xOf(axis, c.day)
          const y = yOf(0.9, CLOSE)
          return (
            <g key={c.name} opacity={clamp(p * 2)}>
              <path className="kit-curve-line" d={pathOf(pts)} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - moved(b, p)} style={{ strokeWidth: 2.2 }} />
              <circle className="kit-dot" cx={x} cy={y} r={6 * (b.reduced ? 1 : ease.back(since(b, c.at + 0.5 / b.length, 0.5)))} />
              <text className="kit-svg-label" x={x} y={y + 26} textAnchor="middle" opacity={since(b, c.at + 0.6 / b.length, 0.4)}>
                Day {c.day}
              </text>
            </g>
          )
        })}
      </Curve>
      <Words size="label" tone="accent" style={rise(b, since(b, 0.69, 0.7))}>
        Fitted to your own answers
      </Words>
    </Layer>
  )
}

/** c1-10 and c1-11, one span: each card on its own date; today's card comes up; recall, check, answer. */
function Due(props: SceneProps) {
  const b = useBeat(props)
  const second = props.clip.id === 'c1-11'
  const cal = second ? 1 - since(b, 0, 0.5) : since(b, 0, 0.7)
  const chips = [3, 6, 9, 13, 17, 20, 24, 27].map((day, i) => ({
    day,
    p: second ? 1 : since(b, 0.24 + i * 0.025, 0.5),
  }))
  const card = second ? since(b, 0, 0.6) : since(b, 0.74, 0.6)
  const shown = second && b.progress >= cue(b, 0, 0.38) ? 1 : 0
  return (
    <Stage beat={b} label={second ? 'Recall the hidden part, check, then answer Forgot or Remembered' : 'A calendar for every card; on its day, the card comes up'}>
      <Layer style={{ opacity: cal * (second ? 1 : 1 - card * 0.85) }}>
        <Calendar beat={b} today={13} chips={chips} glowToday={second ? 1 : since(b, 0.47, 0.6)} dim={second ? 1 : since(b, 0.5, 0.6)} />
      </Layer>
      <Layer style={{ opacity: card }}>
        <Fit>
          <CardView
            beat={b}
            title={CANBERRA.title}
            text={CANBERRA.text}
            sides={shown === 1 ? 2 : 1}
            shown={shown}
            state="Due today"
            blanks={second ? showFor(since(b, 0.12, 0.4), since(b, 0.34, 0.2)) : 0}
            footer={second ? <Answers beat={b} forgot={since(b, cue(b, 1, 0.674), 0.4)} remembered={since(b, cue(b, 2, 0.788), 0.4)} /> : undefined}
          />
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c1-13: the course's minutes (`COURSE_MINUTES`, the voice's length); the twelve chapters light up. */
function Chapters(props: SceneProps) {
  const b = useBeat(props)
  const twelve = cue(b, 1, 0.582)
  const up = moved(b, since(b, twelve - 0.08, 0.6))
  return (
    <Stage beat={b} label={`About ${COURSE_MINUTES} minutes, in 12 short chapters`}>
      <Layer
        place="top"
        style={{
          transform: b.reduced ? undefined : `translateY(${lerp(28, 0, up).toFixed(2)}%) scale(${lerp(1, 0.5, up).toFixed(3)})`,
        }}
      >
        <BigNumber beat={b} p={since(b, cue(b, 0, 0.266) - 0.02, 0.8)} value={COURSE_MINUTES} label="minutes" />
      </Layer>
      <Layer style={{ paddingTop: '20%', opacity: since(b, 0.52, 0.5) }}>
        <ol className="kit-chapters">
          {COURSE.map((ch, i) => (
            <li
              key={ch.id}
              style={{
                ...rise(b, since(b, twelve - 0.02 + i * 0.022, 0.4), 6),
                background: i === 0 ? 'var(--accent-soft)' : undefined,
              }}
            >
              <b>{i + 1}</b>
              <span>{ch.title}</span>
            </li>
          ))}
        </ol>
      </Layer>
    </Stage>
  )
}

/** c1-14: "Try it in the app": the course's own button, the real app behind it; always your choice. */
function TryIt(props: SceneProps) {
  const b = useBeat(props)
  return (
    <Stage beat={b} label="Try it in the app: optional, always your choice">
      <Layer style={{ opacity: since(b, 0.38, 0.7) * 0.55 }}>
        <AppWindow
          sidebar={
            <SidebarPreview
              inbox={4}
              rows={[
                { name: 'Course Cards', kind: 'folder' },
                { name: 'Projects', kind: 'folder' },
                { name: 'Reading list', kind: 'page' },
              ]}
            />
          }
        />
      </Layer>
      <Layer>
        <TryChip
          beat={b}
          p={since(b, 0.2, 0.6)}
          beside={
            <span className="kit-chip" style={pop(b, since(b, 0.78, 0.5), 0.6)}>
              Optional
            </span>
          }
        />
      </Layer>
    </Stage>
  )
}

/** c1-15: the curve you forget on; the reviews beat it; then the paper card, alone, for what comes next. */
function Recap(props: SceneProps) {
  const b = useBeat(props)
  const axis: Axis = { days: 45, warp: 0.55 }
  const fall = moved(b, between(b, 0.02, 0.2))
  const beat = since(b, 0.28, 1.6)
  const jumps = [0, 1, 2, 3].map((i) => moved(b, clamp(beat * 4 - i), ease.out))
  const cursor = beat > 0 ? lerp(1, 45, moved(b, beat)) : 45 * fall
  const out = since(b, 0.52, 0.6)
  return (
    <Stage beat={b} label="You forget on a curve; reviews beat it. Next: a card">
      <Layer style={{ opacity: 1 - out }}>
        <Curve beat={b} axis={axis} axes={1} cursor={cursor} reviews={beat > 0 ? SAMPLE_REVIEWS.map((r, i) => (i < 2 ? { ...r, label: undefined } : r)) : []} jumps={jumps} ghost={beat > 0 ? 1 : 0} />
      </Layer>
      <Layer>
        <IndexCard style={pop(b, since(b, 0.6, 0.8), 0.7)} />
      </Layer>
    </Stage>
  )
}

export const WHY_SCENES: ChapterScenes = {
  chapter: 'why',
  entries: [
    { clips: ['c1-01'], scene: Forget },
    { clips: ['c1-02'], scene: Notebook },
    { clips: ['c1-22'], scene: Replication },
    { clips: ['c1-03', 's2b'], scene: Reviews },
    { clips: ['c1-04', 'c1-05'], scene: Consolidation },
    { clips: ['c1-18', 'c1-19'], scene: Cells },
    { clips: ['c1-06'], scene: Experiments },
    { clips: ['c1-20'], scene: BestMoment },
    { clips: ['c1-07', 'c1-08', 'c1-09'], scene: TheCard },
    { clips: ['c1-16', 'c1-12', 'c1-17', 'c1-21'], scene: Model },
    { clips: ['c1-10', 'c1-11'], scene: Due },
    { clips: ['c1-13'], scene: Chapters },
    { clips: ['c1-14'], scene: TryIt },
    { clips: ['c1-15'], scene: Recap },
  ],
}
