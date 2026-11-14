/**
 * CHAPTER 6, "Your card base is your knowledge base" (YAZ-5121). One picture runs through it: the card base, and a head
 * in profile with the same map inside. Around it: the internet that never ends, a page distilled to two cards,
 * digestion (food in, the useful part kept), Craik & Lockhart's depth of processing (a paper moment), someone else's
 * cards that stay grey, capture first and make later, sixty cards waiting, and the card you have been looking forward
 * to. The fractions are where the words land in the real voice (`marks` in `script.ts`, read with `cue`).
 */
import type { CSSProperties } from 'react'
import type { SceneProps } from '../scene'
import { AppWindow, CardView, Fit, Layer, Paper, Cite, SidebarPreview, Stage, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, useBeat, type Beat } from './kit'
import { HeadProfile, type HeadDot } from './kit/HeadProfile'
import { PAPERS } from './papers'
import type { ChapterScenes } from './registry'
import './knowledgeBase.css'

/** Part of a text, typed so far (reduced motion: all of it once it starts). */
const typed = (b: Beat, text: string, p: number): string => (b.reduced ? (p > 0 ? text : '') : text.slice(0, Math.round(text.length * clamp(p))))

/**
 * THE MAP: 24 cards in four topics, as points in 0..1. The card base draws them as small cards; the head draws the same
 * points as dots, so the two match.
 */
const TOPICS = [
  { name: 'Health', cx: 0.27, cy: 0.3 },
  { name: 'Money', cx: 0.73, cy: 0.27 },
  { name: 'Words', cx: 0.28, cy: 0.74 },
  { name: 'Science', cx: 0.72, cy: 0.73 },
]
const OFFSETS = [
  [0, 0],
  [-0.13, -0.09],
  [0.12, -0.1],
  [-0.15, 0.08],
  [0.14, 0.09],
  [0.0, 0.15],
] as const
const MAP = TOPICS.flatMap((t, ti) => OFFSETS.map(([dx, dy], k) => ({ x: t.cx + dx, y: t.cy + dy, topic: ti, hub: k === 0 })))
/** The order the cards come in: one per topic in turn, so the base fills evenly. */
const ORDER = MAP.map((_, i) => i).sort((a, b) => (a % 6) * 4 + Math.floor(a / 6) - ((b % 6) * 4 + Math.floor(b / 6)))
const rank = (i: number): number => ORDER.indexOf(i)

/** The card base as a picture: small cards on the map; `links` joins each topic's cards to its first (what you know compounds). */
function BaseMap({ beat, show, links = 0, tone, glow = 0, label = 'Your card base', style }: { beat: Beat; show: (i: number) => number; links?: number; tone?: (i: number) => 'accent' | 'grey'; glow?: number; label?: string; style?: CSSProperties }) {
  return (
    <div className="kb-base" style={style} role="img" aria-label={label}>
      <svg className="kb-base__links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {links > 0 &&
          MAP.map((m, i) => {
            if (m.hub) return null
            const hub = MAP[m.topic * 6]
            const p = clamp(links * 1.4 - (i % 6) * 0.08)
            if (p <= 0) return null
            const q = beat.reduced ? 1 : ease.out(p)
            return <line key={i} x1={hub.x * 100} y1={hub.y * 100} x2={lerp(hub.x, m.x, q) * 100} y2={lerp(hub.y, m.y, q) * 100} opacity={beat.reduced ? p : 1} />
          })}
      </svg>
      {MAP.map((m, i) => {
        const p = show(i)
        if (p <= 0) return null
        const t = tone?.(i) ?? 'accent'
        return <span key={i} className={`kb-tile kb-tile--${t}${m.hub ? ' kb-tile--hub' : ''}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, ...pop(beat, p, 0.4), boxShadow: glow > 0 && t === 'accent' ? `0 0 ${(12 * glow).toFixed(1)}px color-mix(in srgb, var(--accent) 60%, transparent)` : undefined }} />
      })}
    </div>
  )
}

/** The same map, as dots in a head. */
const headDots = (show: (i: number) => number, tone?: (i: number) => HeadDot['tone'], ring?: (i: number) => number): HeadDot[] => MAP.map((m, i) => ({ x: m.x, y: m.y, p: show(i), tone: tone?.(i) ?? 'accent', ring: ring?.(i) }))

/** c6-01 and c6-02, one span: the cards add up and join (compounding); a question; then the card base and a head that match. */
function BaseAndHead(props: SceneProps) {
  const b = useBeat(props)
  const first = props.clip.id === 'c6-01'
  if (first) {
    const compounds = cue(b, 0, 0.441)
    const question = cue(b, 1, 0.698)
    // Eight cards come one by one, then the rest come fast: what you know compounds.
    const show = (i: number): number => {
      const r = rank(i)
      return r < 8 ? since(b, 0.03 + r * 0.035, 0.4) : since(b, compounds + (r - 8) * 0.012, 0.35)
    }
    const ask = since(b, question - 0.02, 0.6)
    return (
      <Stage beat={b} label="Your cards add up, and they join: what you know compounds. What should go into them?">
        <Layer>
          <BaseMap beat={b} show={show} links={since(b, compounds + 0.04, 1.4)} style={{ opacity: lerp(1, 0.35, ask), width: 'min(70cqw, 70cqh, 24em)' }} />
        </Layer>
        <Layer style={{ opacity: ask }}>
          <div className="kb-ask" style={pop(b, ask, 0.7)}>
            ?
          </div>
        </Layer>
      </Stage>
    )
  }
  const match = cue(b, 0, 0.294)
  const picture = cue(b, 1, 0.675)
  const eq = since(b, match - 0.04, 0.5)
  const dot = (i: number): number => since(b, match + rank(i) * 0.012, 0.4)
  const lit = since(b, picture, 0.8)
  return (
    <Stage beat={b} label="Your card base is your knowledge base: the same map, in a head">
      <Layer>
        <div className="kit-row kb-match">
          <div className="kb-match__side">
            <BaseMap beat={b} show={() => 1} links={1} glow={lit} />
            <Words size="label">Card base</Words>
          </div>
          <span className="kb-eq" style={pop(b, eq)} aria-hidden="true">
            =
          </span>
          <div className="kb-match__side" style={rise(b, since(b, 0.02, 0.6))}>
            <HeadProfile beat={b} p={since(b, 0.02, 1.1)} dots={headDots(dot, undefined, () => showFor(lit, since(b, picture + 0.15, 0.6)))} glow={lit} label="A head in profile, with the same map inside" />
            <Words size="label" style={rise(b, eq)}>
              Knowledge base
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** Fake web pages for the endless scroll: a title bar and grey lines. */
const WEB = Array.from({ length: 9 }, (_, i) => ({ lines: [92, 70 + ((i * 13) % 25), 84, 55 + ((i * 7) % 30)], wide: i % 3 === 1 }))

/** c6-03: an endless scroll of web pages pours past; a tiny card base under it. There is always more. */
function Internet(props: SceneProps) {
  const b = useBeat(props)
  const copy = cue(b, 0, 0.229)
  const more = cue(b, 1, 0.637)
  // The scroll: a pure function of the time; it speeds up on "always more". Reduced motion: it stands still.
  const speed = 46
  const extra = Math.max(0, b.t - more * b.length) * 110
  const offset = b.reduced ? 0 : (b.t * speed + extra) % (WEB.length * 64)
  const tryIt = showFor(since(b, copy, 0.5), since(b, copy + 0.24, 0.5))
  return (
    <Stage beat={b} label="The internet never ends; your card base is small. The goal is not to copy it in">
      <Layer place="fill" style={{ padding: 0 }}>
        <div className="kb-web" style={{ opacity: since(b, 0, 0.6) }} aria-hidden="true">
          <div className="kb-web__strip" style={{ transform: `translateY(${(-offset).toFixed(1)}px)` }}>
            {[...WEB, ...WEB, ...WEB].map((page, i) => (
              <div key={i} className={`kb-web__page${page.wide ? ' kb-web__page--wide' : ''}`}>
                <i className="kb-web__bar" />
                {page.lines.map((w, k) => (
                  <i key={k} style={{ width: `${w}%` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Layer>
      <Layer place="bottom">
        <div className="kb-tiny" style={rise(b, since(b, 0.08, 0.6))}>
          <BaseMap beat={b} show={() => 1} />
          <span className="kb-tiny__cross" style={{ opacity: tryIt }} aria-hidden="true">
            ✕
          </span>
        </div>
        <Words size="page" style={rise(b, since(b, 0.12, 0.6))}>
          Your card base
        </Words>
      </Layer>
    </Stage>
  )
}

const SLEEP_PAGE = 'Most adults need seven to nine hours of sleep. Each short night adds to a sleep debt. One long lie-in does not pay it back; a few regular nights do. Short sleep dulls focus first, then mood, then memory. Naps help a little, late caffeine hurts more than you think, and a dark, cool room helps.'
const DISTILLED = [
  { title: 'Sleep debt', text: 'Each short night adds to a {{sleep debt}}, and one long lie-in does not pay it back.' },
  { title: 'Paying back sleep', text: 'How do you pay back a sleep debt?\n---\nA few regular nights, not one long lie-in.' },
]

/** c6-04: a page of text boils down to two short cards: one in your words, one in another format (a question). */
function Distil(props: SceneProps) {
  const b = useBeat(props)
  const distil = cue(b, 0, 0.141)
  const words = cue(b, 1, 0.598)
  const formats = cue(b, 2, 0.762)
  const boil = between(b, distil, words - 0.05)
  const lines = SLEEP_PAGE.split(/(?<=[.;]) /)
  return (
    <Stage beat={b} label="A web page of text, distilled into two short cards, in your own words and your own formats">
      <Layer>
        <div className="kit-row">
          <div className="kb-page" style={{ ...rise(b, since(b, 0, 0.6)), opacity: lerp(1, 0.45, boil) }}>
            {lines.map((line, i) => {
              const keep = i === 1 || i === 2
              const gone = keep ? 0 : clamp(boil * 1.6 - i * 0.06)
              return (
                <span key={i} className={`kb-page__line${keep ? ' is-kept' : ''}`} style={{ opacity: 1 - gone * 0.85, backgroundSize: keep ? `${(moved(b, boil) * 100).toFixed(1)}% 100%` : undefined }}>
                  {line}{' '}
                </span>
              )
            })}
          </div>
          <div className="kb-distilled">
            {DISTILLED.map((card, i) => {
              const p = since(b, i === 0 ? words - 0.04 : formats - 0.03, 0.6)
              return (
                <div key={card.title} style={rise(b, p, 14)}>
                  <CardView beat={b} chrome="plain" title={card.title} text={card.text} shown={0} sides={1} className="kit-cardview--small" />
                  <span className="kit-chip" style={pop(b, since(b, p > 0 ? (i === 0 ? words : formats) : 1, 0.5))}>
                    {i === 0 ? 'Your words' : 'Your format'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** Bits of what you take in, for the digestion picture. */
const BITS = ['a podcast', 'a chapter', 'a talk', 'an article', 'a class', 'a chat']

/**
 * The digestion picture, kept simple: bits go in at the top of a round vessel and turn slowly in it; one useful part
 * comes out as a card; the rest passes. `in`, `churn`, `keep`, `pass` are 0..1.
 */
function Digester({ beat, into, churn, keep, pass, known }: { beat: Beat; into: number; churn: number; keep: number; pass: number; known?: number }) {
  const turn = beat.reduced ? 0 : beat.t * 38 * (0.4 + churn)
  return (
    <div className="kb-digest" aria-hidden="true">
      <svg className="kb-digest__svg" viewBox="-120 -120 240 240">
        <circle className="kb-digest__vessel" r={86} />
        <g transform={`rotate(${turn.toFixed(2)})`} opacity={0.3 + 0.7 * clamp(churn)}>
          {[0, 1, 2].map((k) => (
            <path key={k} className="kb-digest__swirl" d="M 0 -58 A 58 58 0 0 1 50 -29" transform={`rotate(${k * 120})`} />
          ))}
          {[0, 1, 2].map((k) => (
            <path key={`i${k}`} className="kb-digest__swirl kb-digest__swirl--in" d="M 0 -30 A 30 30 0 0 1 26 -15" transform={`rotate(${k * 120 + 60})`} />
          ))}
        </g>
        {known !== undefined && (
          <g transform="translate(0 0)">
            <circle className="kb-known__track" r={100} />
            <circle className="kb-known__fill" r={100} pathLength={1} strokeDasharray={`${(0.62 * clamp(known)).toFixed(4)} 1`} transform="rotate(-90)" />
          </g>
        )}
      </svg>
      {BITS.map((bit, i) => {
        // Each bit falls in from above, then turns with the vessel, then (the rest) passes out to the right.
        const p = clamp(into * 1.6 - i * 0.12)
        if (p <= 0) return null
        const fall = moved(beat, p, ease.out)
        const a = ((i * 60 + turn) * Math.PI) / 180
        const inside = { x: Math.cos(a) * 52, y: Math.sin(a) * 44 }
        const out = moved(beat, clamp(pass * 1.4 - i * 0.07))
        const x = lerp(lerp((i - 2.5) * 30, inside.x, fall), 170, out)
        const y = lerp(lerp(-170, inside.y, fall), 40 + i * 6, out)
        return (
          <span key={bit} className="kb-bit" style={{ left: `calc(50% + ${x.toFixed(1)}px)`, top: `calc(50% + ${y.toFixed(1)}px)`, opacity: clamp(p * 3) * (1 - clamp(pass * 1.2 - i * 0.05)) * lerp(1, 0.6, clamp(churn)) }}>
            {bit}
          </span>
        )
      })}
      <span className="kb-kept" style={{ ...pop(beat, keep, 0.3), transform: `translate(-50%, ${beat.reduced ? 0 : lerp(-40, 0, ease.out(clamp(keep))).toFixed(1)}px)${beat.reduced ? '' : ` scale(${lerp(0.4, 1, ease.back(clamp(keep))).toFixed(3)})`}` }}>
        <i />
        <b />
        <i />
      </span>
    </div>
  )
}

/** c6-05, c6-06 and c6-07, one span: digestion. Bits in; you need not know it fully; you digest it first; then you can say it simply. */
function Digestion(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c6-07') {
    const think = cue(b, 0, 0.302)
    const simply = cue(b, 1, 0.764)
    const swirl = between(b, think, simply)
    const say = since(b, simply - 0.03, 0.7)
    const turn = b.reduced ? 0 : b.t * 90
    const thoughts: HeadDot[] = Array.from({ length: 7 }, (_, k) => {
      const a = ((k * (360 / 7) + turn) * Math.PI) / 180
      const r = lerp(0.28, 0.06, moved(b, say))
      return { x: 0.52 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r * 0.9, p: since(b, think - 0.05 + k * 0.02, 0.4) * (1 - say * 0.7), tone: 'fg' }
    })
    return (
      <Stage beat={b} label="To digest is to think it through, until you can say it simply">
        <Layer>
          <div className="kit-row kb-say">
            <HeadProfile beat={b} p={since(b, 0, 0.9)} dots={[...thoughts, { x: 0.52, y: 0.5, p: say, tone: 'accent', ring: say }]} glow={swirl * 0.6 + say * 0.4} />
            <div className="kb-bubble" style={rise(b, say, 12)}>
              {typed(b, 'Sleep you miss adds up.', since(b, simply, 1.1))}
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  const first = id === 'c6-05'
  const into = first ? since(b, cue(b, 0, 0.137) - 0.05, 2.2) : 1
  const churn = first ? between(b, 0.2, 0.5) * 0.5 : 0.5 + 0.5 * since(b, cue(b, 0, 0.427) - 0.1, 0.8)
  const keep = first ? since(b, cue(b, 2, 0.848) - 0.04, 0.7) : 1
  const pass = first ? 0 : since(b, cue(b, 0, 0.427) + 0.12, 1.2)
  const known = first ? since(b, cue(b, 1, 0.492), 1.2) : 1
  return (
    <Stage beat={b} label={first ? 'Digestion: what you take in turns over; you do not have to know it fully before you make its card' : 'You digest it first: the useful part is kept, the rest passes'}>
      <Layer>
        <Fit>
          <Digester beat={b} into={into} churn={churn} keep={keep} pass={pass} known={first ? known : undefined} />
          <div className="kit-tags">
            {first && (
              <span className="kit-chip" style={pop(b, since(b, cue(b, 1, 0.492), 0.5))}>
                Known: not fully
              </span>
            )}
            {!first && (
              <span className="kit-chip" style={pop(b, since(b, cue(b, 0, 0.427), 0.5))}>
                Digested
              </span>
            )}
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

const LEVELS = [
  { label: 'How it looks', kept: 0.22 },
  { label: 'How it sounds', kept: 0.45 },
  { label: 'What it means', kept: 0.95 },
]

/** c6-08: Craik & Lockhart 1972 (a paper moment); many later papers cite it; then the depths: the deeper, the longer kept. */
function Depth(props: SceneProps) {
  const b = useBeat(props)
  const depth = cue(b, 0, 0.157)
  const cited = cue(b, 1, 0.403)
  const more = cue(b, 2, 0.643)
  const longer = cue(b, 3, 0.868)
  const cites = showFor(since(b, cited - 0.01, 0.4), since(b, more - 0.04, 0.4))
  const levels = since(b, more - 0.03, 0.6)
  const probe = moved(b, between(b, more, longer - 0.02))
  return (
    <Stage beat={b} label="Craik and Lockhart, 1972: depth of processing. The more you think about meaning, the longer you keep it">
      <Layer>
        <Paper beat={b} paper={PAPERS.craikLockhart} at={{ in: 0, highlight: depth + 0.03, out: more - 0.05 }} />
      </Layer>
      <Layer style={{ opacity: cites }} className="kb-cites-layer">
        <div className="kb-cites" aria-hidden="true">
          {Array.from({ length: 22 }, (_, i) => {
            const a = (i / 22) * Math.PI * 2
            const r = 34 + (i % 3) * 7
            const p = since(b, cited + i * 0.006, 0.5)
            return <i key={i} style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r * 0.8}%`, ...pop(b, p, 0.3) }} />
          })}
        </div>
      </Layer>
      <Layer place="bottom" style={{ opacity: cites }}>
        <span className="kit-chip" style={pop(b, since(b, cited + 0.02, 0.5), 0.8)}>
          Cited by paper after paper
        </span>
      </Layer>
      <Layer style={{ opacity: levels }}>
        <div className="kb-depth">
          {LEVELS.map((level, i) => {
            const reached = probe * 3 - i
            const bar = since(b, longer - 0.02 + i * 0.015, 0.8)
            return (
              <div key={level.label} className={`kb-depth__level kb-depth__level--${i}`} style={{ opacity: lerp(0.45, 1, clamp(reached)) }}>
                <span className="kb-depth__label">{level.label}</span>
                <span className="kb-depth__track">
                  <i style={{ width: `${(level.kept * moved(b, bar, ease.out) * 100).toFixed(1)}%` }} />
                </span>
              </div>
            )
          })}
          <span className="kb-depth__probe" style={{ top: `${lerp(4, 82, probe).toFixed(1)}%`, opacity: clamp(levels * 2) }} aria-hidden="true">
            ▼
          </span>
          <div className="kb-depth__axis">
            <span>Shallow</span>
            <span style={{ opacity: since(b, longer, 0.5) }}>Kept longer →</span>
            <span>Deep</span>
          </div>
        </div>
        <Cite beat={b} paper={PAPERS.craikLockhart} p={since(b, more + 0.02, 0.6)} />
      </Layer>
    </Stage>
  )
}

/** c6-09: someone else's deck is copied in; its cards stay grey; it jumps over the thinking. */
function Borrowed(props: SceneProps) {
  const b = useBeat(props)
  const copying = cue(b, 0, 0.103)
  const skips = cue(b, 1, 0.618)
  const deck = since(b, copying - 0.03, 0.7)
  const unpack = between(b, copying + 0.12, copying + 0.36)
  const own = new Set(MAP.map((_, i) => i).filter((i) => i % 2 === 0))
  const show = (i: number): number => (own.has(i) ? 1 : clamp(unpack * 2.2 - rank(i) * 0.06))
  const jump = since(b, skips - 0.04, 0.9)
  return (
    <Stage beat={b} label="Someone else's cards, copied in, stay grey: they skip the thinking that makes you learn">
      <Layer>
        <div className="kit-row kb-borrow">
          <div className="kb-match__side">
            <BaseMap beat={b} show={show} tone={(i) => (own.has(i) ? 'accent' : 'grey')} label="Your card base, with copied cards in grey" />
            <Words size="label">Your card base</Words>
          </div>
          <div className="kb-deck" style={{ ...rise(b, deck, 16), opacity: clamp(deck * 2) * lerp(1, 0.5, unpack) }}>
            {[0, 1, 2, 3].map((k) => (
              <span key={k} className="kb-deck__card" style={{ transform: `translate(${k * 4}px, ${k * -4}px) rotate(${(k - 1.5) * 2}deg)` }} />
            ))}
            <Words size="page">Someone else’s deck</Words>
          </div>
        </div>
        <svg className="kb-skip" viewBox="0 0 300 90" aria-label="The copy jumps over the thinking" style={{ opacity: clamp(jump * 2) }}>
          <circle className="kb-skip__think" cx={150} cy={64} r={20} />
          <text className="kit-svg-label" x={150} y={68} textAnchor="middle" fontSize={11}>
            thinking
          </text>
          <path className="kb-skip__arc" d="M 30 70 C 80 -10, 220 -10, 270 70" pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - moved(b, jump)).toFixed(4)} />
          <text className="kit-svg-label" x={30} y={86} textAnchor="middle" fontSize={11}>
            deck
          </text>
          <text className="kit-svg-label" x={270} y={86} textAnchor="middle" fontSize={11}>
            your base
          </text>
        </svg>
      </Layer>
    </Stage>
  )
}

const CAPTURE = 'Sleep debt adds up. A lie-in does not pay it back.'

/** c6-10, c6-11 and c6-12, one span: write it down somewhere; a rushed card made on the spot (poor, piles up, a chore); then later, at a quiet desk, the clean card. */
function CaptureLater(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const phone = (line: number, dim = 0) => (
    <div className="kb-phone" style={{ opacity: lerp(1, 0.55, dim) }} aria-label="A quick line on a phone">
      <span className="kb-phone__time">9:41</span>
      <span className="kb-phone__head">Quick capture</span>
      <span className="kb-phone__line">
        {typed(b, CAPTURE, line)}
        {line > 0 && line < 1 && !b.reduced && <span className="kit-caret" />}
      </span>
    </div>
  )
  if (id === 'c6-10') {
    const write = cue(b, 0, 0.574)
    const talk = showFor(since(b, 0.1, 0.5), since(b, write, 0.6))
    return (
      <Stage beat={b} label="When you hear something worth keeping, write it down somewhere">
        <Layer>
          <div className="kit-row">
            <div className="kb-talk" style={{ opacity: talk }} aria-hidden="true">
              {[0, 1, 2].map((k) => (
                <i key={k} style={{ transform: b.reduced ? undefined : `scale(${(1 + 0.08 * Math.sin(b.t * 6 + k)).toFixed(3)})`, opacity: 1 - k * 0.25 }} />
              ))}
            </div>
            <div style={rise(b, since(b, 0.05, 0.6), 16)}>{phone(since(b, write, 1.6))}</div>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c6-11') {
    const rushed = cue(b, 0, 0.336)
    const pile = cue(b, 1, 0.632)
    const chore = cue(b, 2, 0.809)
    const card = since(b, 0.05, 0.4)
    const mark = since(b, rushed + 0.12, 0.5)
    const heap = between(b, pile, chore)
    const shake = b.reduced ? 0 : Math.sin(b.t * 31) * 1.6 * (1 - clamp(mark))
    const due = Math.round(lerp(3, 214, b.reduced ? (since(b, chore, 1) > 0 ? 1 : 0) : ease.inOut(since(b, chore - 0.02, 1.2))))
    return (
      <Stage beat={b} label="A card made in the moment is rushed and poor; such cards pile up, and review becomes a chore">
        <Layer>
          <div className="kit-row">
            <div className="kb-heap">
              {Array.from({ length: 9 }, (_, k) => {
                const p = k === 0 ? card : since(b, pile + k * 0.025, 0.4)
                const rot = ((k * 37) % 23) - 11
                return (
                  <span key={k} className="kb-messy" style={{ ...pop(b, p, 0.6), transform: `${pop(b, p, 0.6).transform ?? ''} translate(${k === 0 ? shake : ((k * 29) % 40) - 20}px, ${k === 0 ? 0 : -k * 7 + ((k * 13) % 9)}px) rotate(${k === 0 ? -4 : rot}deg)`, zIndex: k }}>
                    {k === 0 ? 'sleep thing?? debt.. cant repay' : ''}
                    {k === 0 && (
                      <span className="kb-messy__mark" style={pop(b, mark, 1.6)}>
                        ✕
                      </span>
                    )}
                  </span>
                )
              })}
              <Words size="page" style={{ opacity: clamp(card * 2) * (1 - heap) }}>
                Made on the spot
              </Words>
            </div>
            <div style={rise(b, since(b, chore - 0.04, 0.6), 12)}>
              <AppWindow style={{ width: 'min(34cqw, 12em)', height: 'min(36cqh, 9em)' }} label="The Inbox, with a pile of cards due" sidebar={<SidebarPreview inbox={due} inboxGlow={since(b, chore, 0.6) * 0.6} rows={[{ name: 'Cards', kind: 'folder', open: true }]} />} />
              <Words size="page" tone="danger">
                Review: a chore
              </Words>
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  const when = cue(b, 0, 0.231)
  const capture = cue(b, 1, 0.607)
  const make = cue(b, 2, 0.801)
  const card = since(b, when + 0.12, 0.8)
  return (
    <Stage beat={b} label="Later, with time to sit and think, the quick line becomes a clean card. Capture first, make later">
      <Layer place="top">
        <Words size="kicker" style={rise(b, since(b, when - 0.05, 0.6))}>
          Later, at your desk
        </Words>
      </Layer>
      <Layer>
        <div className="kit-row kb-later">
          <div className="kb-later__side">
            {phone(1, card)}
            <span className="kit-chip" style={pop(b, since(b, capture, 0.5))}>
              1 · Capture first
            </span>
          </div>
          <span className="kb-arrow" style={{ opacity: clamp(card * 2) }} aria-hidden="true">
            →
          </span>
          <div className="kb-later__side" style={rise(b, card, 14)}>
            <CardView beat={b} title="Sleep debt" text={DISTILLED[0].text} shown={0} sides={1} className="kit-cardview--small" />
            <span className="kit-chip" style={pop(b, since(b, make, 0.5))}>
              2 · Make later
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c6-13 and c6-14, one span: sixty new cards wait, ten a day, so a new card takes about a week; then it comes, and it is a friend. */
function TheWait(props: SceneProps) {
  const b = useBeat(props)
  if (props.clip.id === 'c6-13') {
    const ten = cue(b, 0, 0.05)
    const sixty = cue(b, 1, 0.316)
    const week = cue(b, 2, 0.766)
    const fill = between(b, ten, sixty + 0.08)
    // Seven days tick from after "sixty" to "week"; each day takes ten cards from the front.
    const days = b.reduced ? (b.progress >= week ? 6 : b.progress >= sixty + 0.1 ? 3 : 0) : lerp(0, 6, between(b, sixty + 0.1, week))
    const day = Math.floor(days)
    return (
      <Stage beat={b} label="Ten new cards a day, sixty waiting: a new card takes about a week to reach you">
        <Layer>
          <div className="kb-queue">
            <p className="kb-queue__line" style={rise(b, since(b, 0, 0.6))}>
              <b>New cards</b> · <span>{Math.round(lerp(0, 60, b.reduced ? (fill > 0 ? 1 : 0) : fill))} waiting</span> · <span className="kb-queue__rate" style={{ opacity: since(b, ten, 0.5) }}>10 a day</span>
            </p>
            <div className="kb-queue__grid" aria-hidden="true">
              {Array.from({ length: 60 }, (_, i) => {
                const on = clamp(fill * 60 - i)
                const gone = clamp(days - Math.floor(i / 10) - 0.5) * (i === 59 ? 0 : 1)
                const yours = i === 59
                return <i key={i} className={yours ? 'is-yours' : undefined} style={{ opacity: on * (1 - gone * 0.85), boxShadow: yours && b.progress >= week ? '0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent)' : undefined }} />
              })}
            </div>
            <div className="kb-week" style={{ opacity: since(b, sixty + 0.06, 0.5) }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, k) => (
                <span key={d} className={k <= day ? 'is-past' : undefined} data-today={k === day ? 'true' : undefined}>
                  {d}
                </span>
              ))}
            </div>
            <span className="kit-chip" style={pop(b, since(b, week, 0.5))}>
              Your card: about a week
            </span>
          </div>
        </Layer>
      </Stage>
    )
  }
  const made = cue(b, 0, 0.373)
  const digested = cue(b, 1, 0.516)
  const forward = cue(b, 2, 0.785)
  const glow = since(b, forward, 0.9)
  return (
    <Stage beat={b} label="When the card comes, it is no surprise: you made it, you digested it, you have been looking forward to it">
      <Layer>
        <Fit>
          <div className="kb-arrive" style={{ ...rise(b, since(b, 0, 0.8), 20), boxShadow: glow > 0 ? `0 0 ${(40 * glow).toFixed(1)}px color-mix(in srgb, var(--accent) ${(35 * glow).toFixed(0)}%, transparent)` : undefined }}>
            <CardView beat={b} title="Sleep debt" text={DISTILLED[0].text} state="New card" shown={0} sides={1} />
          </div>
          <div className="kit-tags">
            <span className="kit-chip" style={pop(b, since(b, made, 0.5))}>
              You made it
            </span>
            <span className="kit-chip" style={pop(b, since(b, digested, 0.5))}>
              You digested it
            </span>
            <span className="kit-chip" style={pop(b, since(b, forward, 0.5))}>
              ♥ Looking forward to it
            </span>
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c6-15 and c6-16, one span: the picture of your card base in your head, each card put there by you; then make it yours. */
function MentalMap(props: SceneProps) {
  const b = useBeat(props)
  if (props.clip.id === 'c6-15') {
    const picture = cue(b, 0, 0.134)
    const each = cue(b, 1, 0.698)
    // Each card lights in the base, then its dot lands in the head: one by one, faster towards "each card there".
    const at = (i: number): number => lerp(picture + 0.06, each + 0.08, Math.pow(rank(i) / (MAP.length - 1), 0.8))
    return (
      <Stage beat={b} label="You carry a picture of your card base in your head, because you put each card there">
        <Layer>
          <div className="kit-row kb-match">
            <div className="kb-match__side" style={rise(b, since(b, picture - 0.05, 0.8))}>
              <HeadProfile beat={b} p={since(b, picture - 0.05, 1)} dots={headDots((i) => since(b, at(i) + 0.03, 0.4), undefined, (i) => showFor(since(b, at(i) + 0.03, 0.2), since(b, at(i) + 0.1, 0.4)))} glow={since(b, each + 0.1, 0.8) * 0.6} />
            </div>
            <div className="kb-match__side">
              <BaseMap beat={b} show={() => 1} tone={(i) => (b.progress >= at(i) ? 'accent' : 'grey')} />
              <Words size="page">Each card, put there by you</Words>
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  const yours = cue(b, 1, 0.317)
  const next = cue(b, 2, 0.499)
  const out = since(b, next - 0.02, 0.6)
  const glad = since(b, 0.8, 0.6)
  return (
    <Stage beat={b} label="Your card base is your knowledge base: make it yours. Next: a card you will be glad to see again">
      <Layer style={{ opacity: 1 - out }}>
        <div className="kit-row kb-match">
          <div className="kb-match__side">
            <BaseMap beat={b} show={() => 1} links={1} glow={since(b, yours, 0.6)} />
          </div>
          <span className="kb-eq" aria-hidden="true">
            =
          </span>
          <div className="kb-match__side">
            <HeadProfile beat={b} dots={headDots(() => 1)} glow={since(b, yours, 0.6)} />
          </div>
        </div>
        <Words size="title" tone="accent" style={rise(b, since(b, yours, 0.6))}>
          Make it yours
        </Words>
      </Layer>
      <Layer style={{ opacity: out }}>
        <div className="kit-row">
          <span className="kb-messy kb-messy--still" style={{ opacity: lerp(1, 0.45, glad) }}>
            sleep thing?? debt.. cant repay
          </span>
          <div className="kit-sizes__card" style={rise(b, out, 12)}>
            <CardView beat={b} title="Sleep debt" text={DISTILLED[0].text} shown={0} sides={1} className="kit-cardview--small" />
            <span className="kit-check" style={pop(b, glad)}>
              ✓
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

export const KNOWLEDGE_BASE_SCENES: ChapterScenes = {
  chapter: 'knowledge-base',
  entries: [
    { clips: ['c6-01', 'c6-02'], scene: BaseAndHead },
    { clips: ['c6-03'], scene: Internet },
    { clips: ['c6-04'], scene: Distil },
    { clips: ['c6-05', 'c6-06', 'c6-07'], scene: Digestion },
    { clips: ['c6-08'], scene: Depth },
    { clips: ['c6-09'], scene: Borrowed },
    { clips: ['c6-10', 'c6-11', 'c6-12'], scene: CaptureLater },
    { clips: ['c6-13', 'c6-14'], scene: TheWait },
    { clips: ['c6-15', 'c6-16'], scene: MentalMap },
  ],
}
