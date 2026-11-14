/**
 * CHAPTER 5, "Why it is worth it" (YAZ-5121): the lift. Compounding, like interest; five cards a day; one card's path,
 * where the time line stretches as the gaps grow (2 days, 11 days, about 6 weeks, about 5 months: the app's own
 * scheduler with its defaults, `script.ts` c5-13), until the card settles into the outline of a person as a steady
 * light; Niklas Luhmann's slips and books; Ryan Holiday's index cards; the meeting, the language, the subject.
 * Cues land on the real voice's words (`marks` in `script.ts`).
 */
import type { CSSProperties } from 'react'
import type { SceneProps } from '../scene'
import { COURSE } from '../script'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { MANY_TITLES } from './cards'
import {
  BigNumber,
  Counter,
  Layer,
  MiniCard,
  Silhouette,
  Stage,
  Tally,
  Tree,
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
  type TreeEdge,
  type TreeNode,
} from './kit'
import type { ChapterScenes } from './registry'
import './compound.css'

/** c5-01: the four chapters so far, each with its tick; then this one. */
function SoFar(props: SceneProps) {
  const b = useBeat(props)
  const ticks = [0.02, cue(b, 0, 0.069), cue(b, 1, 0.201), cue(b, 2, 0.318)]
  const why = cue(b, 3, 0.733)
  return (
    <Stage beat={b} label="Four chapters done: why, make, review, place. Now: why it is worth it">
      <Layer>
        <ol className="kit-chapters kit-sofar">
          {COURSE.slice(0, 5).map((ch, i) => {
            const tick = i < 4 ? since(b, ticks[i], 0.4) : 0
            const now = i === 4 ? since(b, why - 0.04, 0.5) : 0
            return (
              <li key={ch.id} style={{ ...rise(b, since(b, i * 0.03, 0.4), 6), background: now > 0 ? `color-mix(in srgb, var(--accent-soft) ${(now * 100).toFixed(0)}%, transparent)` : undefined, opacity: i === 4 ? clamp(0.35 + now) : 1 }}>
                <b>{i + 1}</b>
                <span>{ch.title}</span>
                <span className="kit-sofar__tick" style={pop(b, tick, 0.4)}>
                  ✓
                </span>
              </li>
            )
          })}
        </ol>
      </Layer>
    </Stage>
  )
}

/** c5-02: it compounds: each year's bar is last year's, plus what grew on it, like interest. */
function Interest(props: SceneProps) {
  const b = useBeat(props)
  const start = cue(b, 0, 0.218)
  const grow = cue(b, 1, 0.621)
  const interest = cue(b, 2, 0.833)
  const n = 10
  const values = Array.from({ length: n }, (_, k) => Math.pow(1.32, k))
  const max = values[n - 1]
  const W = 520
  const H = 220
  const bw = W / n - 10
  return (
    <Stage beat={b} label="To compound is to grow on itself, like interest: each bar is the last one, plus what grew on it">
      <Layer style={{ paddingTop: '6%' }}>
        <svg className="kit-interest" viewBox={`-10 -30 ${W + 20} ${H + 60}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <line className="kit-ax" x1={0} y1={H} x2={W} y2={H} opacity={since(b, 0.05, 0.5)} />
          {values.map((v, k) => {
            const p = since(b, lerp(start, grow + 0.08, k / (n - 1)), 0.5)
            const h = (v / max) * H * moved(b, p, ease.out)
            const base = k === 0 ? 0 : (values[k - 1] / max) * H * moved(b, p, ease.out)
            const x = k * (W / n) + 5
            const glow = showFor(since(b, interest, 0.4), 0) * (k === n - 1 ? 1 : 0)
            return (
              <g key={k} opacity={clamp(p * 3)}>
                <rect className="kit-interest__base" x={x} y={H - base} width={bw} height={base} rx={3} />
                <rect className="kit-interest__grow" x={x} y={H - h} width={bw} height={Math.max(0, h - base)} rx={3} style={glow > 0 ? { filter: `drop-shadow(0 0 ${(6 * glow).toFixed(1)}px var(--accent))` } : undefined} />
              </g>
            )
          })}
        </svg>
      </Layer>
      <Layer place="top" style={{ paddingTop: '4%' }}>
        <div className="kit-interest__key" style={{ opacity: since(b, start, 0.5) }}>
          <span>
            <i className="kit-interest__swatch" /> What you had
          </span>
          <span style={{ opacity: since(b, grow - 0.1, 0.5) }}>
            <i className="kit-interest__swatch kit-interest__swatch--grow" /> What grew on it
          </span>
        </div>
      </Layer>
      <Layer place="bottom">
        <span className="kit-chip" style={pop(b, since(b, interest, 0.5))}>
          Like interest
        </span>
      </Layer>
    </Stage>
  )
}

/** c5-03: one card; the next one hooks onto it; then more. */
const HOOK_NODES: TreeNode[] = [
  { id: 'a', x: 150, y: 170, label: 'Protein', kind: 'branch' },
  { id: 'b', x: 300, y: 110, label: 'Calories', kind: 'branch' },
  { id: 'c', x: 450, y: 170, label: 'Food labels', kind: 'branch' },
  { id: 'd', x: 300, y: 250, label: 'Energy', kind: 'branch' },
]
const HOOK_EDGES: TreeEdge[] = [
  { from: 'a', to: 'b', kind: 'branch' },
  { from: 'b', to: 'c', kind: 'branch' },
  { from: 'a', to: 'd', kind: 'branch' },
  { from: 'd', to: 'c', kind: 'link' },
]

function Hooks(props: SceneProps) {
  const b = useBeat(props)
  const next = cue(b, 0, 0.421)
  const hold = cue(b, 1, 0.679)
  return (
    <Stage beat={b} label="Each thing you keep gives the next thing something to hold on to">
      <Layer>
        <Tree
          beat={b}
          nodes={HOOK_NODES}
          edges={HOOK_EDGES}
          show={{
            a: since(b, 0, 0.6),
            b: since(b, next - 0.04, 0.5),
            'a>b': since(b, hold - 0.06, 0.6),
            c: since(b, hold + 0.1, 0.5),
            'b>c': since(b, hold + 0.14, 0.5),
            d: since(b, hold + 0.18, 0.5),
            'a>d': since(b, hold + 0.2, 0.5),
            'd>c': since(b, hold + 0.26, 0.5),
          }}
        />
      </Layer>
    </Stage>
  )
}

/** c5-04: five cards a day; the days of a year fill in; 1,825. */
function FiveADay(props: SceneProps) {
  const b = useBeat(props)
  const five = cue(b, 0, 0.112)
  const year = cue(b, 1, 0.346)
  const total = cue(b, 2, 0.534)
  const days = between(b, year, total + 0.05)
  const big = since(b, total, 1.2)
  return (
    <Stage beat={b} label="Five cards a day: in a year, 1,825 small things you still know">
      <Layer place="top" style={{ paddingTop: '5%' }}>
        <div className="kit-five" style={{ opacity: 1 - 0.5 * since(b, total, 0.5) }}>
          {MANY_TITLES.slice(0, 5).map((title, i) => (
            <MiniCard key={title} title={title} style={pop(b, since(b, five - 0.03 + i * 0.03, 0.4), 0.6)} />
          ))}
          <Words size="label" style={{ opacity: since(b, five + 0.1, 0.4) }}>
            a day
          </Words>
        </div>
      </Layer>
      <Layer style={{ paddingTop: '10%', opacity: 1 - 0.75 * since(b, total, 0.6) }}>
        <div className="kit-five__year">
          <Tally beat={b} count={365} fill={days} columns={37} />
          <Words size="page" style={{ opacity: since(b, year, 0.4) }}>
            One year: <Counter beat={b} p={days} to={365} /> days
          </Words>
        </div>
      </Layer>
      <Layer style={{ paddingTop: '10%' }}>
        <BigNumber beat={b} p={big} value={1825} label="small things you still know" />
      </Layer>
    </Stage>
  )
}

/** c5-05: the pile of cards grows tall; the day's review stays small. */
function Pile(props: SceneProps) {
  const b = useBeat(props)
  const daily = cue(b, 0, 0.469)
  const grows = cue(b, 1, 0.773)
  const months = between(b, 0.04, 0.92)
  const month = Math.max(1, Math.ceil(months * 12))
  const pile = Math.round(lerp(2, 36, months))
  const today = [4, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6][month - 1]
  const lineAt = (i: number): CSSProperties => ({ bottom: `${(i * 2.4).toFixed(2)}%` })
  return (
    <Stage beat={b} label="Known cards come back less often, so the daily review stays small as the pile grows">
      <Layer>
        <div className="kit-pile">
          <div className="kit-pile__col" style={{ boxShadow: `0 0 0 ${(2.5 * showFor(since(b, grows, 0.4), 0)).toFixed(2)}px var(--accent-soft)` }}>
            <div className="kit-pile__stack">
              {Array.from({ length: pile }, (_, i) => (
                <i key={i} style={lineAt(i)} />
              ))}
            </div>
            <Words size="label">All your cards</Words>
          </div>
          <div className="kit-pile__col kit-pile__col--today" style={{ boxShadow: `0 0 0 ${(2.5 * showFor(since(b, daily, 0.4), since(b, grows, 0.4))).toFixed(2)}px var(--accent)` }}>
            <div className="kit-pile__stack">
              {Array.from({ length: today }, (_, i) => (
                <i key={i} style={lineAt(i)} />
              ))}
            </div>
            <Words size="label">Today’s review</Words>
          </div>
        </div>
        <Words size="kicker">Month {month}</Words>
      </Layer>
    </Stage>
  )
}

/** One card's path: the days it comes back on when it is remembered each time (the app's defaults; `script.ts` c5-13). */
const REVIEW_DAYS = [0, 2, 13, 59, 222]
const GAPS = ['2 days', '11 days', 'about 6 weeks', 'about 5 months']
/** The days the line shows while each hop is drawn: it stretches as the gaps grow. */
const SPANS = [3, 16, 70, 250]
const TICKS: readonly [number, string][] = [
  [7, '1 week'],
  [30, '1 month'],
  [61, '2 months'],
  [182, '6 months'],
  [365, '1 year'],
]
const AX = { l: 40, r: 560, y: 200 }

/** A point on a hop's arc at `t` (a quadratic curve from day `a` to day `c`, `h` high). */
function arcAt(xa: number, xc: number, h: number, t: number): [number, number] {
  const xm = (xa + xc) / 2
  // The control point is twice as high as the arc's top.
  const ym = AX.y - h * 2
  const u = 1 - t
  return [u * u * xa + 2 * u * t * xm + t * t * xc, u * u * AX.y + 2 * u * t * ym + t * t * AX.y]
}

/** The line of one card's path, at a moment: each hop's draw (0..1), the span in days, what is lit. */
function Path({ beat, draws, span, here = 0, away = 0, opacity = 1 }: { beat: Beat; draws: readonly number[]; span: number; here?: number; away?: number; opacity?: number }) {
  const x = (day: number): number => AX.l + ((AX.r - AX.l) * day) / span
  let cardAt: [number, number] = [x(0), AX.y]
  const hops = draws.map((d, i) => {
    const xa = x(REVIEW_DAYS[i])
    const xc = x(REVIEW_DAYS[i + 1])
    const h = Math.min(120, Math.max(14, (xc - xa) * 0.42))
    const q = beat.reduced ? (d > 0 ? 1 : 0) : ease.inOut(clamp(d))
    if (d > 0) cardAt = arcAt(xa, xc, h, q)
    const labelOpacity = clamp(d * 2 - 0.6) * clamp((xc - xa - 26) / 40)
    const last = i === draws.length - 1
    return (
      <g key={i}>
        <path className={`kit-path__arc${last && away > 0 ? ' is-away' : ''}`} d={`M${xa.toFixed(2)} ${AX.y} Q${((xa + xc) / 2).toFixed(2)} ${(AX.y - h * 2).toFixed(2)} ${xc.toFixed(2)} ${AX.y}`} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - q} opacity={d > 0 ? 1 : 0} />
        <circle className="kit-dot" cx={xc} cy={AX.y} r={4.5} opacity={q >= 1 ? 1 : 0} />
        <text className="kit-svg-label kit-path__gap" x={(xa + xc) / 2} y={AX.y - h - 10} textAnchor="middle" opacity={labelOpacity}>
          {last && away > 0 ? (away > 0.5 ? '5 months away' : GAPS[i]) : GAPS[i]}
        </text>
      </g>
    )
  })
  const youX = x(60)
  return (
    <svg className="kit-path" viewBox="0 0 600 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ opacity }}>
      <line className="kit-ax" x1={AX.l} y1={AX.y} x2={AX.r} y2={AX.y} />
      {TICKS.map(([day, label]) => {
        const tx = x(day)
        const room = clamp((tx - AX.l - 30) / 50) * clamp((AX.r + 10 - tx) / 20)
        return (
          <g key={label} opacity={room * 0.9}>
            <line className="kit-grid" x1={tx} y1={AX.y - 4} x2={tx} y2={AX.y + 4} />
            <text className="kit-svg-page" x={tx} y={AX.y + 22} textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}
      <circle className="kit-dot" cx={x(0)} cy={AX.y} r={5} />
      <text className="kit-svg-label" x={x(0)} y={AX.y + 22} textAnchor="middle">
        Today
      </text>
      {hops}
      {here > 0 && (
        <g opacity={clamp(here * 2)}>
          <line className="kit-path__here" x1={youX} y1={AX.y + 8} x2={youX} y2={30} />
          <text className="kit-svg-label kit-svg-label--accent" x={youX + 6} y={42}>
            2 months in
          </text>
        </g>
      )}
      <rect className="kit-path__card" x={cardAt[0] - 9} y={cardAt[1] - 6} width={18} height={12} rx={2.5} />
    </svg>
  )
}

/** c5-13, c5-14 and c5-15, one span: one card's path, the line stretching; months away; then part of who you are. */
function Journey(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c5-13') {
    const lands = [cue(b, 0, 0.359), cue(b, 1, 0.516), cue(b, 2, 0.691), cue(b, 3, 0.875)]
    const draws = lands.map((l) => since(b, l - 0.06, 0.9))
    let logSpan = Math.log(SPANS[0])
    for (let k = 1; k < SPANS.length; k++) logSpan = lerp(logSpan, Math.log(SPANS[k]), moved(b, between(b, lands[k] - 0.12, lands[k] + 0.02)))
    return (
      <Stage beat={b} label="One card you keep remembering comes back after 2 days, then 11, then about 6 weeks, then about 5 months">
        <Layer style={{ opacity: since(b, 0, 0.5) }}>
          <Path beat={b} draws={draws} span={Math.exp(logSpan)} />
        </Layer>
        <Layer place="top" style={{ paddingTop: '5%' }}>
          <span className="kit-answer-chip" data-rating="good" style={pop(b, since(b, 0.1, 0.4))}>
            ✓ Remembered, each time
          </span>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c5-14') {
    const months = cue(b, 0, 0.203)
    const away = cue(b, 1, 0.719)
    const span = Math.exp(lerp(Math.log(SPANS[3]), Math.log(400), moved(b, between(b, 0.02, months + 0.1))))
    return (
      <Stage beat={b} label="A couple of months in, that card is already months away">
        <Layer>
          <Path beat={b} draws={[1, 1, 1, 1]} span={span} here={since(b, months, 0.5)} away={since(b, away - 0.04, 0.6)} />
        </Layer>
      </Stage>
    )
  }
  // c5-15: the line goes; the card becomes a small steady light inside the outline of a person.
  const know = cue(b, 0, 0.478)
  const who = cue(b, 1, 0.724)
  const fade = since(b, 0, 0.9)
  return (
    <Stage beat={b} label="It is part of what you know. It is part of who you are">
      <Layer style={{ opacity: 1 - fade }}>
        <Path beat={b} draws={[1, 1, 1, 1]} span={400} opacity={0.8} />
      </Layer>
      <Layer>
        <div className="kit-who">
          <Silhouette beat={b} draw={between(b, 0.12, know)} arrive={between(b, know - 0.16, know + 0.04)} warm={since(b, who, 1.4)} others={between(b, who + 0.04, 1)} from={[150, 380]} />
        </div>
      </Layer>
      <Layer place="bottom">
        <div className="kit-who__words">
          <Words size="label" style={{ opacity: showFor(since(b, know, 0.5), since(b, who - 0.04, 0.4)) }}>
            Part of what you know
          </Words>
          <Words size="label" tone="accent" style={{ opacity: since(b, who, 0.6) }}>
            Part of who you are
          </Words>
        </div>
      </Layer>
    </Stage>
  )
}

/** c5-06: Niklas Luhmann's wooden boxes of paper slips: 1951 to 1996; about 90,000. */
function Luhmann(props: SceneProps) {
  const b = useBeat(props)
  const name = cue(b, 0, 0.125)
  const years = cue(b, 1, 0.474)
  const slips = cue(b, 2, 0.782)
  const rows = 4
  const cols = 6
  const fill = between(b, 0.08, slips + 0.05)
  return (
    <Stage beat={b} label="Niklas Luhmann kept a box of paper slips from 1951 to 1996: about 90,000 of them">
      <Layer>
        <div className="kit-row kit-luhmann">
          <svg className="kit-cabinet" viewBox="0 0 300 220" aria-hidden="true" style={rise(b, since(b, 0, 0.7), 14)}>
            <rect className="kit-cabinet__body" x={4} y={4} width={292} height={212} rx={6} />
            {Array.from({ length: rows * cols }, (_, i) => {
              const c = i % cols
              const r = Math.floor(i / cols)
              const p = clamp(fill * rows * cols - i)
              const x = 14 + c * 47
              const y = 16 + r * 50
              return (
                <g key={i}>
                  <rect className="kit-cabinet__drawer" x={x} y={y} width={41} height={42} rx={3} />
                  <rect className="kit-cabinet__handle" x={x + 14} y={y + 26} width={13} height={4} rx={2} />
                  <g opacity={p}>
                    {[0, 1, 2, 3, 4].map((k) => (
                      <rect key={k} className="kit-cabinet__slip" x={x + 5 + k * 6.5} y={y + 4 - (k % 2) * 2} width={5} height={14} rx={0.6} />
                    ))}
                  </g>
                </g>
              )
            })}
          </svg>
          <div className="kit-luhmann__facts">
            <Words size="title" style={rise(b, since(b, name, 0.5))}>
              Niklas Luhmann
            </Words>
            <Words size="label" tone="muted" style={rise(b, since(b, years, 0.5))}>
              1951 to 1996
            </Words>
            <div className="kit-luhmann__count" style={rise(b, since(b, slips - 0.06, 0.5))}>
              <span className="kit-luhmann__number">
                <Counter beat={b} p={since(b, slips - 0.06, 1.1)} to={90000} />
              </span>
              <Words size="label">paper slips</Words>
            </div>
            <Words size="page" style={{ opacity: since(b, slips + 0.08, 0.6) }}>
              Niklas Luhmann-Archiv, Bielefeld University
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** The 40 books among the 600 publications: every 15th spine. */
const isBook = (i: number): boolean => i % 15 === 7

/** c5-07: a shelf fills: nearly 600 publications; among them, more than 40 books light up. */
function Books(props: SceneProps) {
  const b = useBeat(props)
  const six = cue(b, 0, 0.161)
  const forty = cue(b, 1, 0.733)
  const fill = between(b, six - 0.08, six + 0.32)
  const lit = since(b, forty, 0.8)
  const perRow = 100
  return (
    <Stage beat={b} label="He wrote nearly 600 publications, among them more than 40 books">
      <Layer style={{ paddingBottom: '14%' }}>
        <svg className="kit-shelf" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <line key={r} className="kit-shelf__board" x1={0} y1={r * 50 + 46} x2={600} y2={r * 50 + 46} />
          ))}
          {Array.from({ length: 600 }, (_, i) => {
            const r = Math.floor(i / perRow)
            const c = i % perRow
            const on = i < Math.round(fill * 600)
            if (!on) return null
            const book = isBook(i) && lit > 0
            const h = book ? 40 : 26 + ((i * 37) % 11)
            return <rect key={i} className={book ? 'kit-shelf__book' : 'kit-shelf__spine'} x={c * 6 + 0.5} y={r * 50 + 46 - h} width={book ? 5.4 : 4.6} height={h} opacity={book ? 0.4 + 0.6 * lit : 1} />
          })}
        </svg>
      </Layer>
      <Layer place="bottom">
        <div className="kit-books__count">
          <span style={{ opacity: since(b, six - 0.06, 0.4) }}>
            <b>
              <Counter beat={b} p={fill} to={600} />
            </b>{' '}
            publications
          </span>
          <span style={{ opacity: lit }}>
            <b className="kit-tone--accent">40+</b> books
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c5-08: Ryan Holiday's long boxes of index cards, twenty years; the value came from all of them added up. */
function Holiday(props: SceneProps) {
  const b = useBeat(props)
  const name = cue(b, 0, 0.062)
  const tens = cue(b, 1, 0.213)
  const twenty = cue(b, 2, 0.441)
  const added = cue(b, 3, 0.898)
  const fill = between(b, tens - 0.05, twenty + 0.1)
  const join = since(b, added - 0.2, 1.4)
  const boxes = [0, 1, 2]
  const per = 90
  const links: [number, number, number, number][] = [
    [0, 12, 1, 70],
    [1, 20, 2, 44],
    [0, 60, 2, 80],
    [2, 10, 1, 52],
    [0, 33, 1, 8],
    [1, 85, 2, 66],
  ]
  const cardX = (box: number, k: number): [number, number] => [30 + (k / per) * 500, 40 + box * 70]
  return (
    <Stage beat={b} label="Ryan Holiday has kept tens of thousands of index cards over twenty years; the value came from all of them added up">
      <Layer place="top" style={{ paddingTop: '4%' }}>
        <div className="kit-holiday__head">
          <Words size="title" style={rise(b, since(b, name, 0.5))}>
            Ryan Holiday
          </Words>
          <Words size="label" tone="muted" style={{ opacity: since(b, twenty, 0.4) }}>
            <Counter beat={b} p={since(b, twenty, 1)} to={20} /> years of index cards
          </Words>
        </div>
      </Layer>
      <Layer style={{ paddingTop: '14%' }}>
        <svg className="kit-boxes" viewBox="0 0 560 230" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {boxes.map((box) => (
            <g key={box}>
              <rect className="kit-boxes__box" x={20} y={18 + box * 70} width={520} height={48} rx={5} />
              {Array.from({ length: per }, (_, k) => {
                const p = clamp(fill * per * 1.2 - k * 1.2 + box * 6 - 6)
                if (p <= 0) return null
                const [x] = cardX(box, k)
                return <line key={k} className="kit-boxes__card" x1={x} y1={60 + box * 70} x2={x} y2={26 + box * 70 + (k % 3) * 2} opacity={p} />
              })}
            </g>
          ))}
          {links.map(([ba, ka, bb, kb], i) => {
            const [x1, y1] = cardX(ba, ka)
            const [x2, y2] = cardX(bb, kb)
            const p = clamp(join * 1.6 - i * 0.12)
            return <path key={i} className="kit-boxes__link" d={`M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 - 30} ${x2} ${y2}`} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - (b.reduced ? (p > 0 ? 1 : 0) : ease.out(p))} opacity={p > 0 ? 1 : 0} />
          })}
        </svg>
      </Layer>
      <Layer place="bottom">
        <span className="kit-chip" style={pop(b, since(b, added - 0.1, 0.5))}>
          All of them, added up
        </span>
      </Layer>
    </Stage>
  )
}

const FRENCH: readonly [string, string][] = [
  ['Je l’ai', 'I have … it'],
  ['déjà', 'already'],
  ['lu', 'read'],
  ['deux fois.', 'twice.'],
]
const CYCLE = ['Rain', 'River', 'Sea', 'Cloud']

/** c5-09 and c5-10, one span: not books: the meeting where the fact is there; the language you keep; the subject that comes clear. */
function Life(props: SceneProps) {
  const b = useBeat(props)
  const first = props.clip.id === 'c5-09'
  const meeting = first ? cue(b, 0, 0.493) : -1
  const fact = first ? cue(b, 1, 0.644) : -1
  const lang = first ? 2 : cue(b, 0, 0.084)
  const subject = first ? 2 : cue(b, 1, 0.464)
  const clear = first ? 2 : cue(b, 2, 0.676)
  const meet = first ? since(b, meeting - 0.05, 0.6) : 1
  const factP = first ? since(b, fact, 0.5) : 1
  const books = first ? showFor(since(b, 0, 0.4), since(b, 0.3, 0.5)) : 0
  const blur = first ? 1 : 1 - since(b, clear, 1)
  return (
    <Stage beat={b} label="The meeting where the right fact is there; the language you keep; the subject you finally understand">
      <Layer style={{ opacity: books }}>
        <Words size="title" tone="muted">
          No books needed.
        </Words>
      </Layer>
      <Layer>
        <div className="kit-life">
          <div className="kit-life__panel" style={{ ...pop(b, meet, 0.85), opacity: clamp(meet) * (first ? 1 : 0.55 + 0.45 * (1 - since(b, lang, 0.5))) }}>
            <svg viewBox="0 0 160 120" aria-hidden="true" className="kit-life__art">
              <ellipse className="kit-life__table" cx={80} cy={70} rx={46} ry={22} />
              {[
                [32, 46],
                [80, 36],
                [128, 46],
                [44, 98],
                [116, 98],
              ].map(([x, y], i) => (
                <circle key={i} className={i === 3 ? 'kit-life__you' : 'kit-life__person'} cx={x} cy={y} r={8} />
              ))}
              <g opacity={factP} transform={`translate(44 ${lerp(84, 70, b.reduced ? 1 : ease.out(factP))})`}>
                <rect className="kit-life__card" x={-18} y={-30} width={36} height={22} rx={3} />
                <line className="kit-life__cardline" x1={-12} y1={-23} x2={12} y2={-23} />
                <line className="kit-life__cardline" x1={-12} y1={-16} x2={4} y2={-16} />
              </g>
            </svg>
            <span className="kit-life__name">The meeting</span>
          </div>
          <div className="kit-life__panel" style={{ ...pop(b, since(b, lang, 0.5), 0.85), opacity: clamp(since(b, lang, 0.5)) * (first ? 0 : 1 - 0.45 * since(b, subject, 0.5)) }}>
            <div className="kit-life__french">
              {FRENCH.map(([fr, en], i) => (
                <span key={fr} className="kit-life__word">
                  <b>{fr}</b>
                  <i style={{ opacity: since(b, lang + 0.06 + i * 0.04, 0.4) }}>{en}</i>
                </span>
              ))}
            </div>
            <span className="kit-life__name">The language</span>
          </div>
          <div className="kit-life__panel" style={{ ...pop(b, since(b, subject, 0.5), 0.85), opacity: first ? 0 : since(b, subject, 0.5) }}>
            <svg viewBox="0 0 160 120" aria-hidden="true" className="kit-life__art" style={{ filter: b.reduced ? undefined : `blur(${(blur * 3.5).toFixed(2)}px)`, opacity: b.reduced ? lerp(0.45, 1, 1 - blur) : 1 }}>
              <circle className="kit-life__cycle" cx={80} cy={60} r={38} />
              {CYCLE.map((name, i) => {
                const a = (-90 + i * 90) * (Math.PI / 180)
                const x = 80 + Math.cos(a) * 38
                const y = 60 + Math.sin(a) * 38
                return (
                  <g key={name}>
                    <circle className="kit-life__node" cx={x} cy={y} r={6} />
                    <text className="kit-svg-page" x={x + (i === 1 ? 10 : i === 3 ? -10 : 0)} y={y + (i === 0 ? -11 : i === 2 ? 19 : 4)} textAnchor={i === 1 ? 'start' : i === 3 ? 'end' : 'middle'}>
                      {name}
                    </text>
                  </g>
                )
              })}
            </svg>
            <span className="kit-life__name">The subject</span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** The titles of the card base's wall (made up): the course's sample titles, then a few more. */
const BASE = [...MANY_TITLES, 'Supply and demand', 'The water cycle', 'Ser and estar', 'Kepler’s laws', 'Inflation', 'Photosynthesis, the light part', 'Habit loops', 'The Pythagorean theorem', 'Opportunity cost, again', 'Osmosis', 'Present perfect', 'Gross margin']

/** c5-11: the card base, now large, glows: a record of what you know; and because you review it, you still know it. */
function CardBase(props: SceneProps) {
  const b = useBeat(props)
  const base = cue(b, 0, 0.179)
  const still = cue(b, 1, 0.856)
  const ripple = since(b, still - 0.04, 1.3)
  const cols = 6
  return (
    <Stage beat={b} label="Your card base: a record of what you know; because you review it, you still know it">
      <Layer>
        <div className="kit-base2">
          {BASE.slice(0, 24).map((title, i) => {
            const c = i % cols
            const r = Math.floor(i / cols)
            const d = Math.hypot(c - 2.5, r - 1.5) / 3.2
            const g = showFor(clamp(ripple * 2.2 - d), clamp(ripple * 2.2 - d - 0.6))
            return <MiniCard key={title} title={title} style={{ ...pop(b, since(b, 0.02 + i * 0.012, 0.4), 0.7), boxShadow: g > 0 ? `0 0 0 ${(2 * g).toFixed(2)}px var(--accent), 0 0 ${(14 * g).toFixed(1)}px color-mix(in srgb, var(--accent) 45%, transparent)` : undefined }} />
          })}
        </div>
        <span className="kit-base2__label" style={pop(b, since(b, base, 0.5), 0.8)}>
          Your card base
        </span>
      </Layer>
    </Stage>
  )
}

/** c5-12: small cards, every day, add up; one of them, in a hand: yours. */
function Yours(props: SceneProps) {
  const b = useBeat(props)
  const add = cue(b, 0, 0.323)
  const yours = cue(b, 1, 0.669)
  const stack = between(b, 0.02, add + 0.05)
  const lift = since(b, yours - 0.1, 0.9)
  const l = moved(b, lift)
  const n = 14
  return (
    <Stage beat={b} label="Small cards, every day, add up; but only if they are truly yours">
      <Layer>
        <div className="kit-yours">
          <div className="kit-yours__pile" style={{ opacity: 1 - 0.6 * l }}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="kit-yours__card" style={{ bottom: `${i * 6}%`, opacity: clamp(stack * n - i), transform: `rotate(${(((i * 37) % 9) - 4) * 0.8}deg)` }} />
            ))}
          </div>
          <div className="kit-yours__held" style={{ opacity: clamp(lift * 2) }}>
            <span className="kit-yours__one" style={{ transform: b.reduced ? undefined : `translateY(${lerp(30, 0, l).toFixed(2)}px)` }}>
              <i />
              <i style={{ width: '60%' }} />
            </span>
            <svg className="kit-hand" viewBox="0 0 200 90" aria-hidden="true">
              <path d="M20 30 C 26 70, 60 84, 100 84 C 140 84, 172 70, 180 30" />
              <path d="M180 30 C 184 22, 192 24, 190 34 C 186 52, 176 64, 164 70" />
              <path d="M20 30 C 16 18, 4 22, 8 34 C 12 48, 22 58, 34 64" />
            </svg>
            <span className="kit-chip" style={pop(b, since(b, yours, 0.5))}>
              Yours
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** The facts the scenes use, from the app's own defaults (a test holds them to `shared/reviews.ts`). */
export const COMPOUND_FACTS = { reviewDays: REVIEW_DAYS, maxDays: DEFAULT_REVIEW_SETTINGS.maxDays }

export const COMPOUND_SCENES: ChapterScenes = {
  chapter: 'compound',
  entries: [
    { clips: ['c5-01'], scene: SoFar },
    { clips: ['c5-02'], scene: Interest },
    { clips: ['c5-03'], scene: Hooks },
    { clips: ['c5-04'], scene: FiveADay },
    { clips: ['c5-05'], scene: Pile },
    { clips: ['c5-13', 'c5-14', 'c5-15'], scene: Journey },
    { clips: ['c5-06'], scene: Luhmann },
    { clips: ['c5-07'], scene: Books },
    { clips: ['c5-08'], scene: Holiday },
    { clips: ['c5-09', 'c5-10'], scene: Life },
    { clips: ['c5-11'], scene: CardBase },
    { clips: ['c5-12'], scene: Yours },
  ],
}
