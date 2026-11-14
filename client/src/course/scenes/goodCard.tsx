/**
 * CHAPTER 7, "What makes a good card" (YAZ-5121): the craft. The wall of text and the bare line; the short version on
 * the front, the details on the back; THE TREE (the course's central picture with chapter 2's hub): the umbrella card,
 * the protein card that outgrows it and becomes a branch, smaller branches, a tree that grows with understanding; the
 * question card and the sentence card; cloze deletion, "hidden words"; the DNS cards and the pick (WAITS: c7-08 calls
 * `done()` once); the three rules; the report card of ten ways to learn (Dunlosky et al. 2013, a paper moment);
 * naming; formats. The fractions are where the words land in the real voice (`marks` in `script.ts`, read with `cue`).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUnit } from '../../vault/unitWord'
import type { SceneProps } from '../scene'
import { PROTEIN, PROTEIN_BRANCH, PROTEIN_LINES, UMBRELLA } from './cards'
import { AppWindow, CardView, Fit, IndexCard, Layer, Paper, SidebarPreview, Stage, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, useBeat, type Beat } from './kit'
import { AgentTerminal } from './kit/AgentTerminal'
import { ReportCard } from './kit/ReportCard'
import { TreeCards, type TreeCardLook } from './kit/TreeCards'
import type { TreeEdge, TreeNode } from './kit/Tree'
import { PAPERS, TEN_WAYS } from './papers'
import type { ChapterScenes } from './registry'
import './goodCard.css'

const typed = (b: Beat, text: string, p: number): string => (b.reduced ? (p > 0 ? text : '') : text.slice(0, Math.round(text.length * clamp(p))))

/** The wall: a whole page about food, pasted into one card. */
const WALL = [
  'Food is mostly made of three things: protein, carbs and fat.',
  'Protein builds and repairs the body, and it is made of amino acids.',
  'Carbs are the quickest energy; fibre is a carb the body does not digest.',
  'Fat is slow energy, stored for later, and it helps the body take in some vitamins.',
  'An egg is mostly protein and fat; bread is mostly carbs.',
  'Each gram of protein or carbs holds about 4 calories; a gram of fat about 9.',
  'Most foods mix all three, in different amounts.',
  'Labels list each one per serving, in grams.',
]
/** The sentence of the wall that is its short version. */
const SHORT = 0

const LINKS = PROTEIN_BRANCH.links

/** THE TREE: the umbrella at its root, three branches, and smaller branches from those. */
const NODES: TreeNode[] = [
  { id: 'u', x: 300, y: 296, label: 'Protein, carbs and fat' },
  { id: 'p', x: 112, y: 186, label: 'Protein' },
  { id: 'c', x: 300, y: 176, label: 'Carbs' },
  { id: 'f', x: 488, y: 186, label: 'Fat' },
  { id: 'a', x: 64, y: 62, label: 'Amino acids' },
  { id: 'fi', x: 236, y: 56, label: 'Fibre' },
  { id: 's', x: 364, y: 56, label: 'Sugar' },
  { id: 'o', x: 536, y: 62, label: 'Omega-3' },
]
const EDGES: TreeEdge[] = [
  { from: 'u', to: 'p', kind: 'branch' },
  { from: 'u', to: 'c', kind: 'branch' },
  { from: 'u', to: 'f', kind: 'branch' },
  { from: 'p', to: 'a', kind: 'branch' },
  { from: 'c', to: 'fi', kind: 'branch' },
  { from: 'c', to: 's', kind: 'branch' },
  { from: 'f', to: 'o', kind: 'branch' },
]
const PARENT: Record<string, string> = Object.fromEntries(EDGES.map((e) => [e.to, e.from]))
/** The tree with each card at its own progress; a card's branch grows with it. */
function treeShow(at: Record<string, number>): Record<string, number> {
  const show: Record<string, number> = { ...at }
  for (const [id, p] of Object.entries(at)) if (PARENT[id] !== undefined) show[`${PARENT[id]}>${id}`] = p
  return show
}

/** c7-01: the digested idea, and an empty card beside it, waiting to be made well. */
function Begin(props: SceneProps) {
  const b = useBeat(props)
  const here = cue(b, 0, 0.499)
  const good = since(b, 0.84, 0.7)
  return (
    <Stage beat={b} label="A digested idea, and an empty card to make well">
      <Layer>
        <div className="kit-row">
          <div className="gc-idea" style={pop(b, since(b, 0.02, 0.7))}>
            <span className="gc-idea__core" />
            <Words size="page">Digested</Words>
          </div>
          <span className="gc-arrow" style={{ opacity: since(b, here - 0.05, 0.5) }} aria-hidden="true">
            →
          </span>
          <div className="kit-blank-card gc-empty" style={{ ...rise(b, since(b, here, 0.6), 14), boxShadow: good > 0 ? `0 0 0 ${(2 * good).toFixed(2)}px var(--accent), 0 0 ${(26 * good).toFixed(1)}px color-mix(in srgb, var(--accent) 40%, transparent)` : undefined }}>
            <Words size="label" tone="muted">
              A good card
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c7-02, c7-03 and c7-20, one span: a whole page pasted into one card (it bulges; nothing sticks); the wall of text; then the bare line. */
function WallAndLine(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c7-20') {
    const line = since(b, cue(b, 0, 0.043), 0.6)
    const words = cue(b, 1, 0.585)
    const understand = cue(b, 2, 0.744)
    return (
      <Stage beat={b} label="The other extreme: a single bare line, and an empty back. You recall the words, not the idea">
        <Layer>
          <div className="gc-bare" style={rise(b, line, 14)}>
            <CardView beat={b} title="Protein" text={'Protein: {{builds muscle}}\n---\n '} shown={b.progress >= words ? 1 : 0} />
            <span className="gc-bare__q" style={pop(b, since(b, understand, 0.6))} aria-hidden="true">
              ?
            </span>
          </div>
          <div className="kit-tags">
            <span className="kit-chip" style={pop(b, since(b, words, 0.5))}>
              The words: recalled
            </span>
            <span className="kit-chip gc-chip--bad" style={pop(b, since(b, understand, 0.5))}>
              The idea: not understood
            </span>
          </div>
        </Layer>
      </Stage>
    )
  }
  const first = id === 'c7-02'
  const pour = first ? between(b, cue(b, 0, 0.23) - 0.1, cue(b, 1, 0.494)) : 1
  const bulge = first ? since(b, cue(b, 1, 0.494) - 0.04, 0.7) : 1
  const nothing = first ? since(b, cue(b, 2, 0.774), 1) : 0
  const recallAll = first ? 0 : since(b, cue(b, 1, 0.479), 0.8)
  const fade = first ? nothing : since(b, cue(b, 2, 0.827), 0.9)
  const wobble = b.reduced ? 0 : Math.sin(b.t * 2.4) * 0.012 * bulge
  return (
    <Stage beat={b} label={first ? 'A whole page of text pasted into one card: it bulges, and nothing sticks' : 'A wall of text is not a card: it asks you to recall everything at once'}>
      <Layer>
        <div className="gc-wall" style={{ transform: b.reduced ? undefined : `scale(${(1 + 0.05 * moved(b, bulge, ease.back) + wobble).toFixed(4)}, ${(1 + 0.09 * moved(b, bulge, ease.back) - wobble).toFixed(4)})` }}>
          <div className="gc-wall__head">
            <span className="card__id">K7Q2</span>
            <span>Food</span>
          </div>
          {WALL.map((line, i) => {
            const p = clamp(pour * WALL.length - i)
            const flash = recallAll > 0 ? showFor(clamp(recallAll * 3 - i * 0.2), clamp(recallAll * 2 - 0.6)) : 0
            return (
              <p key={i} className="gc-wall__line" style={{ opacity: p * lerp(1, 0.18, clamp(fade * 1.5 - i * 0.05)), backgroundColor: flash > 0 ? `color-mix(in srgb, var(--accent) ${(flash * 22).toFixed(0)}%, transparent)` : undefined }}>
                {line}
              </p>
            )
          })}
          {!first && (
            <span className="gc-wall__q" style={pop(b, since(b, cue(b, 0, 0.036), 0.6))} aria-hidden="true">
              ?
            </span>
          )}
        </div>
        {first && (
          <Words size="label" tone="muted" style={{ opacity: nothing }}>
            Nothing sticks.
          </Words>
        )}
      </Layer>
    </Stage>
  )
}

/** c7-04, c7-21 and c7-22, one span: one sentence of the wall is its short version; it goes on the front, hidden part and all; the rest sorts into sections on the back; then a quick review. */
function ShortVersion(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c7-04') {
    const ask = since(b, cue(b, 0, 0.29), 0.6)
    const lit = since(b, cue(b, 1, 0.656), 0.9)
    return (
      <Stage beat={b} label="Before you make a card, ask: what is the short version of this idea?">
        <Layer>
          <div className="gc-wall gc-wall--flat">
            {WALL.map((line, i) => (
              <p key={i} className={`gc-wall__line${i === SHORT ? ' gc-wall__line--short' : ''}`} style={{ opacity: i === SHORT ? 1 : lerp(1, 0.35, lit), backgroundSize: i === SHORT ? `${(moved(b, lit) * 100).toFixed(1)}% 100%` : undefined }}>
                {line}
              </p>
            ))}
          </div>
          <span className="kit-chip" style={pop(b, ask)}>
            The short version?
          </span>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-21') {
    const key = cue(b, 0, 0.287)
    const details = cue(b, 1, 0.524)
    const sections = cue(b, 2, 0.824)
    const g = (k: number): number => since(b, details + k * 0.06, 0.6)
    return (
      <Stage beat={b} label="The short version goes on the front, with the key part hidden. The details go on the back, in sections">
        <Layer>
          <Fit>
            <div style={rise(b, since(b, 0, 0.6), 14)}>
              <CardView
                beat={b}
                title={PROTEIN.title}
                text={PROTEIN.text}
                links={PROTEIN.links}
                shown={0}
                grow={[since(b, 0, 0.6), since(b, 0.1, 0.6), g(0), g(1), g(2), g(3)]}
                lit={[0, 0, 0, showFor(since(b, sections, 0.4), 1) * 0.6, showFor(since(b, sections + 0.03, 0.4), 1) * 0.6, showFor(since(b, sections + 0.06, 0.4), 1) * 0.6]}
                blanks={since(b, key, 0.6)}
              />
            </div>
            <div className="kit-tags">
              <span className="kit-chip" style={pop(b, since(b, 0.05, 0.5))}>
                Front: the short version
              </span>
              <span className="kit-chip" style={pop(b, since(b, details, 0.5))}>
                Back: the details, in sections
              </span>
            </div>
          </Fit>
        </Layer>
      </Stage>
    )
  }
  const fill = cue(b, 0, 0.333)
  const back = cue(b, 1, 0.621)
  const shown = b.progress >= fill ? PROTEIN.hidden : 0
  const parts = (k: number): number => since(b, back + k * 0.05, 0.5)
  return (
    <Stage beat={b} label="A review is quick: fill in the front, then the back gives you the details again">
      <Layer>
        <Fit>
          <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} links={PROTEIN.links} shown={shown} state="Due today" sides={b.progress >= back - 0.04 ? undefined : 1} grow={b.progress >= back - 0.04 ? [undefined, undefined, parts(0), parts(1), parts(2), parts(3)] : undefined} blanks={showFor(since(b, 0.1, 0.4), since(b, fill, 0.3))} />
        </Fit>
      </Layer>
    </Stage>
  )
}

/** The umbrella, drawn over a card: a canopy that opens (`open`) and covers a whole topic. */
function Umbrella({ beat, open }: { beat: Beat; open: number }) {
  const o = beat.reduced ? (open > 0 ? 1 : 0) : ease.back(clamp(open))
  const sx = lerp(0.15, 1, o)
  const scallops = 'M -150 0 Q -150 -110 0 -112 Q 150 -110 150 0 Q 125 -16 100 0 Q 75 -16 50 0 Q 25 -16 0 0 Q -25 -16 -50 0 Q -75 -16 -100 0 Q -125 -16 -150 0 Z'
  return (
    <svg className="gc-umbrella" viewBox="-170 -130 340 150" aria-hidden="true" style={{ opacity: clamp(open * 3) }}>
      <g transform={`scale(${sx.toFixed(4)} 1)`}>
        <path className="gc-umbrella__canopy" d={scallops} />
        {[-100, -50, 0, 50, 100].map((x) => (
          <path key={x} className="gc-umbrella__rib" d={`M 0 -112 Q ${x * 0.8} -60 ${x} 0`} />
        ))}
      </g>
      <line className="gc-umbrella__stick" x1={0} y1={-112} x2={0} y2={20} />
    </svg>
  )
}

/** The tree's looks over the whole span: which cards are made (`at`), which glow. */
function Grove({ beat, at, cards, children }: { beat: Beat; at: Record<string, number>; cards?: Record<string, TreeCardLook>; children?: ReactNode }) {
  return (
    <TreeCards beat={beat} nodes={NODES} edges={EDGES} show={treeShow(at)} cards={{ u: { tone: 'root' }, ...cards }}>
      {children}
    </TreeCards>
  )
}

/**
 * c7-05, c7-06, c7-07, c7-18, c7-23 and c7-19, one span: THE TREE. An umbrella over one card; the light card; protein
 * piles up on its back until it outgrows it and lifts off into its own card; the two link, and protein becomes a
 * branch; more branches, then smaller ones: each card a node; the tree grows with understanding, so start light.
 */
function GrowingTree(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c7-05') {
    const start = cue(b, 0, 0.394)
    const umbrella = cue(b, 1, 0.479)
    const whole = cue(b, 2, 0.845)
    return (
      <Stage beat={b} label="How cards grow: start with an umbrella, one card that covers a whole topic">
        <Layer>
          <div className="gc-umbrella-wrap">
            <Umbrella beat={b} open={since(b, umbrella - 0.03, 0.9)} />
            <span className="kit-treecard kit-treecard--root gc-umbrella-card" style={pop(b, since(b, start - 0.06, 0.6))}>
              Protein, carbs and fat
            </span>
            <span className="gc-umbrella__under">
              {['protein', 'carbs', 'fat'].map((w, i) => (
                <span key={w} style={rise(b, since(b, whole - 0.04 + i * 0.03, 0.5), 6)}>
                  {w}
                </span>
              ))}
            </span>
          </div>
          <span className="kit-chip" style={pop(b, since(b, umbrella, 0.5))}>
            The umbrella card
          </span>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-06' || id === 'c7-07') {
    const six = id === 'c7-06'
    const outgrows = six ? 1 : cue(b, 1, 0.346)
    const own = six ? 1 : cue(b, 2, 0.655)
    // c7-07: protein's lines pile onto the back, one by one, until they spill; then they lift off into a card of their own.
    const piled = six ? 0 : Math.round(lerp(0, PROTEIN_LINES.length, b.reduced ? (b.progress >= cue(b, 0, 0.198) ? 1 : 0) : between(b, cue(b, 0, 0.198), outgrows + 0.1)))
    const spill = six ? 0 : since(b, outgrows, 0.6)
    const lift = six ? 0 : since(b, own - 0.03, 0.9)
    const extra = piled === 0 || lift >= 1 ? '' : `\n\n${PROTEIN_LINES.slice(0, piled).join('\n\n')}`
    return (
      <Stage beat={b} label={six ? 'Protein, carbs and fat: one light card is enough to start' : 'Protein outgrows the umbrella card, and gets a card of its own'}>
        <Layer>
          <div className="kit-row gc-outgrow">
            <div className="gc-outgrow__card" data-spill={spill > 0 && lift < 1 ? 'true' : undefined} style={{ ...rise(b, six ? since(b, 0, 0.7) : 1, 14), width: six ? 'min(70cqw, 24em)' : undefined }}>
              <CardView beat={b} title={UMBRELLA.title} text={UMBRELLA.light + extra} shown={1} lit={six ? [0, since(b, cue(b, 0, 0.193), 0.5) * 0.7, 0, 0] : [0, since(b, cue(b, 0, 0.198), 0.5) * (1 - lift), 0, 0]} className="kit-cardview--small" />
              {six && (
                <span className="kit-chip" style={pop(b, since(b, cue(b, 1, 0.612), 0.5))}>
                  Light: three short lines
                </span>
              )}
              {!six && (
                <span className="kit-chip gc-chip--bad" style={{ ...pop(b, spill), opacity: clamp(spill * 2) * (1 - lift) }}>
                  Too much for one card
                </span>
              )}
            </div>
            {!six && (
              <div style={{ ...rise(b, lift, 24), transform: b.reduced ? undefined : `translate(${lerp(-60, 0, moved(b, lift, ease.out)).toFixed(1)}px, ${lerp(-30, 0, moved(b, lift, ease.out)).toFixed(1)}px)` }}>
                <CardView beat={b} title={PROTEIN_BRANCH.title} text={PROTEIN_BRANCH.early} links={LINKS} shown={2} id={PROTEIN_BRANCH.id} className="kit-cardview--small" state="New card" />
              </div>
            )}
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-18') {
    const link = cue(b, 0, 0.075)
    const umbrella = cue(b, 1, 0.325)
    const branch = cue(b, 2, 0.811)
    const line = since(b, link, 0.9)
    const toTree = since(b, branch - 0.08, 0.7)
    return (
      <Stage beat={b} label="The two cards link to each other: the umbrella stays the overview, and protein becomes a branch">
        <Layer style={{ opacity: 1 - toTree }}>
          <div className="kit-row gc-linked">
            <CardView beat={b} title={UMBRELLA.title} text={UMBRELLA.linked} links={LINKS} shown={1} className="kit-cardview--small" lit={[0, line, 0, 0]} dim={since(b, umbrella, 0.6) * 0.5} />
            <span className="gc-link" aria-hidden="true">
              <i style={{ transform: `scaleX(${moved(b, line, ease.out).toFixed(3)})` }} />
            </span>
            <CardView beat={b} title={PROTEIN_BRANCH.title} text={PROTEIN_BRANCH.early} links={LINKS} shown={2} id={PROTEIN_BRANCH.id} className="kit-cardview--small" lit={[0, 0, 0, line]} />
          </div>
          <span className="kit-chip" style={pop(b, since(b, umbrella, 0.5))}>
            The umbrella: the overview
          </span>
        </Layer>
        <Layer style={{ opacity: toTree }}>
          <Grove beat={b} at={{ u: toTree, p: since(b, branch - 0.02, 0.8) }} cards={{ p: { glow: showFor(since(b, branch, 0.4), since(b, branch + 0.12, 0.6)) } }} />
          <span className="kit-chip" style={pop(b, since(b, branch, 0.5))}>
            Protein: a branch
          </span>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-23') {
    const tree = cue(b, 0, 0.114)
    const branches = cue(b, 1, 0.346)
    const smaller = cue(b, 2, 0.411)
    const node = cue(b, 3, 0.723)
    const at = {
      u: 1,
      p: 1,
      c: since(b, tree, 0.8),
      f: since(b, tree + 0.05, 0.8),
      a: since(b, smaller, 0.7),
      fi: since(b, smaller + 0.04, 0.7),
      s: since(b, smaller + 0.08, 0.7),
      o: since(b, smaller + 0.12, 0.7),
    }
    const pulse = (k: number): number => showFor(since(b, node + k * 0.02, 0.3), since(b, node + 0.1 + k * 0.02, 0.5))
    const cards: Record<string, TreeCardLook> = {}
    NODES.forEach((n, k) => (cards[n.id] = { glow: n.id === 'c' ? since(b, node, 0.5) : pulse(k) * 0.7 }))
    cards.c = { glow: since(b, node, 0.5) }
    for (const k of ['p', 'c', 'f']) cards[k] = { ...cards[k], glow: Math.max(cards[k].glow ?? 0, showFor(since(b, branches, 0.3), since(b, smaller, 0.4)) * 0.8) }
    return (
      <Stage beat={b} label="Over time, a tree: the umbrella, its branches, smaller branches. Each card is a node, a point where branches meet">
        <Layer>
          <Grove beat={b} at={at} cards={cards} />
          <p className="gc-node" style={rise(b, since(b, node + 0.05, 0.6))}>
            <b>Node</b>: a point where branches meet
          </p>
        </Layer>
      </Stage>
    )
  }
  // c7-19: the tree grows as a calendar runs; then back to day one: two cards, and the rest only a dashed outline.
  const grows = cue(b, 0, 0.064)
  const start = cue(b, 1, 0.418)
  const whole = cue(b, 2, 0.755)
  const run = between(b, grows, start - 0.06)
  const back = since(b, start - 0.04, 0.6)
  const order = ['u', 'p', 'c', 'f', 'a', 'fi', 's', 'o']
  const STEPS = ['Day 1', 'Week 3', 'Month 2', 'Month 6', 'Year 1']
  const at: Record<string, number> = {}
  const cards: Record<string, TreeCardLook> = {}
  order.forEach((nid, k) => {
    const grown = k < 2 ? 1 : clamp(run * 7 - (k - 1))
    at[nid] = back > 0 ? (k < 2 ? 1 : Math.max(grown * (1 - back), since(b, whole - 0.04 + k * 0.01, 0.6))) : grown
    if (k >= 2 && back >= 1) cards[nid] = { tone: 'ghost' }
  })
  const step = back > 0 ? 0 : Math.min(STEPS.length - 1, Math.floor(run * STEPS.length))
  return (
    <Stage beat={b} label="The tree grows as your understanding grows. Start light: two cards on day one are enough">
      <Layer>
        <div className="gc-calendar" aria-hidden="true">
          {STEPS.map((s, k) => (
            <span key={s} data-now={k === step ? 'true' : undefined} className={k < step ? 'is-past' : undefined}>
              {s}
            </span>
          ))}
        </div>
        <Grove beat={b} at={at} cards={cards} />
        <span className="kit-chip" style={pop(b, since(b, start, 0.5))}>
          Day one: start light
        </span>
      </Layer>
    </Stage>
  )
}

const DNS_FRONT = 'DNS stands for {{Domain Name System}}.'
const DNS_FULL = {
  title: 'DNS',
  text: 'When you type a website’s name, {{DNS}} finds the number your computer needs.\n\nDNS stands for {{Domain Name System}}.\n---\nComputers find each other by numbers; DNS turns a name into that number.\n\n***\n\n**EXAMPLE**\nYou type a shop’s name; DNS looks up its number; the page loads.',
}

/** A paper flashcard that turns over: the question on one side, the answer on the other. */
function Flashcard({ beat, flip, front, back, check = 0 }: { beat: Beat; flip: number; front: string; back: string; check?: number }) {
  const f = clamp(flip)
  const angle = beat.reduced ? 0 : f < 0.5 ? ease.inOut(f * 2) * 90 : (1 - ease.inOut((f - 0.5) * 2)) * -90
  return (
    <div className="gc-flash" style={{ transform: angle === 0 ? undefined : `perspective(900px) rotateY(${angle.toFixed(2)}deg)`, opacity: beat.reduced && f > 0 && f < 1 ? Math.abs(1 - f * 2) * 0.8 + 0.2 : undefined }}>
      <IndexCard lines={[f >= 0.5 ? back : front]} />
      <span className="kit-check" style={pop(beat, check)}>
        ✓
      </span>
    </div>
  )
}

/** c7-24 to c7-28, one span: the front itself. The question card; the sentence card; "cloze deletion", the app's "hidden words"; "DNS stands for ___"; an example on the front. */
function TheFront(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c7-24') {
    const most = cue(b, 0, 0.311)
    const answer = cue(b, 2, 0.783)
    return (
      <Stage beat={b} label="Most people think a card is a question on one side, and the answer on the other">
        <Layer>
          <div style={pop(b, since(b, most - 0.1, 0.7), 0.7)}>
            <Flashcard beat={b} flip={since(b, answer - 0.06, 0.8)} front="What does DNS stand for?" back="Domain Name System" />
          </div>
          <div className="kit-tags">
            <span className="kit-chip" style={pop(b, since(b, cue(b, 1, 0.583), 0.5))}>
              Side 1: a question
            </span>
            <span className="kit-chip" style={pop(b, since(b, answer, 0.5))}>
              Side 2: the answer
            </span>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-25') {
    const question = cue(b, 0, 0.125)
    const write = cue(b, 1, 0.424)
    const hide = cue(b, 2, 0.761)
    return (
      <Stage beat={b} label="You can ask a question, or write the idea as a sentence and hide the key part">
        <Layer>
          <div className="kit-row gc-two">
            <div className="gc-two__side">
              <Flashcard beat={b} flip={0} front="What does DNS stand for?" back="" check={since(b, question + 0.05, 0.5)} />
              <Words size="page">A question</Words>
            </div>
            <span className="gc-or" style={{ opacity: since(b, write - 0.1, 0.4) }}>
              or
            </span>
            <div className="gc-two__side kit-sizes__card" style={rise(b, since(b, write - 0.02, 0.6), 14)}>
              <CardView beat={b} chrome="plain" text={DNS_FRONT} blanks={since(b, hide, 0.6)} />
              <span className="kit-check" style={pop(b, since(b, hide + 0.06, 0.5))}>
                ✓
              </span>
              <Words size="page">A sentence, key part hidden</Words>
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-26') {
    const cloze = cue(b, 0, 0.27)
    const hidden = cue(b, 1, 0.773)
    const swap = since(b, hidden - 0.25, 0.6)
    return (
      <Stage beat={b} label="Memory scientists call that cloze deletion. In this app: hidden words">
        <Layer>
          <div className="gc-name-it">
            <span className="gc-name-it__label gc-name-it__label--science" style={{ ...rise(b, since(b, cloze - 0.02, 0.6), 8), opacity: clamp(since(b, cloze - 0.02, 0.6)) * lerp(1, 0.3, swap) }}>
              <small>Memory scientists</small>cloze deletion
            </span>
            <span className="gc-name-it__label" style={rise(b, since(b, hidden - 0.02, 0.6), 8)}>
              <small>In this app</small>hidden words
            </span>
            <div style={rise(b, since(b, 0, 0.6), 12)}>
              <CardView beat={b} chrome="plain" text={DNS_FRONT} blanks={Math.max(since(b, cloze, 0.5), since(b, hidden, 0.5))} />
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-27') {
    const blank = cue(b, 0, 0.28)
    const fill = cue(b, 1, 0.542)
    const make = cue(b, 2, 0.665)
    const review = cue(b, 3, 0.822)
    const fillP = since(b, fill - 0.04, 0.9)
    return (
      <Stage beat={b} label="DNS stands for, then a blank: you jump in and fill it. Faster to make, faster to review">
        <Layer>
          <p className="gc-jump">
            <span>{typed(b, 'DNS stands for', since(b, 0, 0.9))}</span>{' '}
            <span className="gc-jump__blank" style={{ ...pop(b, since(b, blank - 0.03, 0.5), 0.6), borderBottomColor: fillP > 0 ? 'var(--accent)' : undefined }}>
              {fillP > 0 ? typed(b, 'Domain Name System', fillP) : ' '}
            </span>
          </p>
          <div className="kit-tags">
            <span className="kit-chip" style={pop(b, since(b, make, 0.5))}>
              ⚡ Faster to make
            </span>
            <span className="kit-chip" style={pop(b, since(b, review, 0.5))}>
              ⚡ Faster to review
            </span>
          </div>
        </Layer>
      </Stage>
    )
  }
  // c7-28: the DNS card grows an example line on its front; an agent offers one.
  const example = since(b, cue(b, 0, 0.027), 0.9)
  const agent = cue(b, 1, 0.479)
  const term = since(b, agent - 0.03, 0.6)
  return (
    <Stage beat={b} label="An example on the front helps too; with your agent, one is easy to get">
      <Layer>
        <div className="kit-row gc-example">
          <div className="gc-example__card">
            <CardView beat={b} title={DNS_FULL.title} text={DNS_FULL.text} id="D2NS" shown={0} sides={1} grow={[example, undefined]} lit={[showFor(example, since(b, agent + 0.2, 0.6)), 0]} />
          </div>
          <div style={rise(b, term, 14)}>
            <AgentTerminal
              beat={b}
              className="gc-term"
              lines={[
                { text: 'Give this card an example line.', p: since(b, agent, 0.8), kind: 'in' },
                { text: 'When you type a website’s name, DNS finds the number your computer needs.', p: since(b, agent + 0.12, 1.2), kind: 'out' },
              ]}
            />
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const CARD_A = '{{DNS}} stands for {{Domain Name System}}.'
const CARD_B = DNS_FRONT

/** c7-08, c7-09 and c7-10, one span: the pick (WAITS: c7-08 holds until the person picks; `done()` once); why B; rule one. */
function PickACard(props: SceneProps) {
  const b = useBeat(props)
  const { clip, done, waits } = props
  const id = clip.id
  const [pick, setPick] = useState<'a' | 'b' | null>(null)
  const doneFor = useRef(new Set<string>())
  const finish = (clipId: string): void => {
    if (doneFor.current.has(clipId)) return
    doneFor.current.add(clipId)
    done()
  }
  useEffect(() => {
    // The layer holds a waiting clip each time it starts: a clip entered again gets its own `done`.
    doneFor.current.delete(id)
    if (waits && id === 'c7-08' && pick !== null) finish(id)
    // Only on a new clip.
  }, [id])
  const choose = (which: 'a' | 'b'): void => {
    if (pick === null) setPick(which)
    if (id === 'c7-08') finish('c7-08')
  }

  if (id === 'c7-10') {
    const rule = cue(b, 0, 0.075)
    const hide = cue(b, 1, 0.236)
    const front = cue(b, 2, 0.58)
    return (
      <Stage beat={b} label="Rule one: hide the answer, not the clue. The front must still make sense with the blank in it">
        <Layer>
          <Words size="kicker" style={rise(b, since(b, rule - 0.05, 0.5))}>
            Rule 1
          </Words>
          <Words size="title" style={rise(b, since(b, hide, 0.6))}>
            Hide the answer, not the clue.
          </Words>
          <div className="gc-pick__one" style={rise(b, since(b, 0.05, 0.6), 12)}>
            <CardView beat={b} text={CARD_B} title="DNS" id="D2NS" state="Due today" lit={[since(b, front, 0.6)]} blanks={since(b, front + 0.08, 0.6)} />
          </div>
          <div className="kit-tags">
            <span className="kit-chip" style={pop(b, since(b, front, 0.5))}>
              The clue: in view
            </span>
            <span className="kit-chip" style={pop(b, since(b, front + 0.1, 0.5))}>
              The answer: hidden
            </span>
          </div>
        </Layer>
      </Stage>
    )
  }
  const why = id === 'c7-09'
  const second = cue(b, 0, 0.036)
  const hides = cue(b, 1, 0.348)
  const noClue = cue(b, 2, 0.702)
  const okB = why ? since(b, second, 0.5) : 0
  const badA = why ? since(b, hides, 0.6) : 0
  const prompt = why ? 0 : since(b, cue(b, 0, 0.488), 0.6)
  const card = (which: 'a' | 'b') => {
    const text = which === 'a' ? CARD_A : CARD_B
    const chosen = pick === which
    const body = (
      <>
        <span className="gc-pick__letter">{which.toUpperCase()}</span>
        <CardView beat={b} chrome="plain" text={text} blanks={which === 'a' ? badA : showFor(okB, 1) * 0.6} />
        {why && which === 'b' && (
          <span className="kit-check" style={pop(b, okB)}>
            ✓
          </span>
        )}
        {why && which === 'a' && (
          <span className="kit-check gc-cross" style={pop(b, since(b, noClue, 0.5))}>
            ✕
          </span>
        )}
      </>
    )
    return why ? (
      <div className={`gc-pick__card${chosen ? ' is-chosen' : ''}`} data-bad={which === 'a' && badA > 0 ? 'true' : undefined} style={{ opacity: which === 'a' ? lerp(1, 0.6, since(b, noClue, 0.6)) : 1 }}>
        {body}
      </div>
    ) : (
      <button type="button" className={`kit-tap gc-pick__card${chosen ? ' is-chosen' : ''}`} aria-pressed={chosen} aria-label={`Card ${which.toUpperCase()}: ${text.replace(/\{\{|\}\}/g, '')}`} onClick={() => choose(which)}>
        {body}
      </button>
    )
  }
  return (
    <Stage beat={b} label={why ? 'The second card: the first hides everything that matters, so there is no clue to recall from' : 'Your turn: which of these two cards is better?'}>
      <Layer>
        <div className="kit-row gc-pick" style={rise(b, since(b, 0, 0.6), 12)}>
          {card('a')}
          {card('b')}
        </div>
        <div className="kit-tags">
          {!why && (
            <span className="kit-quiet-line" style={{ opacity: pick === null ? prompt : 0 }}>
              Tap the better card.
            </span>
          )}
          {!why && pick !== null && (
            <span className="kit-chip" style={pop(b, 1)}>
              You picked {pick.toUpperCase()}
            </span>
          )}
          {why && (
            <span className="kit-chip gc-chip--bad" style={pop(b, since(b, noClue, 0.5))}>
              A: no clue left
            </span>
          )}
          {why && pick !== null && (
            <span className="kit-quiet-line" style={{ opacity: since(b, 0.1, 0.5) }}>
              {pick === 'b' ? 'You picked B. Right.' : 'You picked A. Look again at its front.'}
            </span>
          )}
        </div>
      </Layer>
    </Stage>
  )
}

/** c7-11 and c7-29, one span: reading is not recalling; the 2013 review (a paper moment); its report card of ten ways to learn; then the top two, and a card on both. */
function ReportCardScene(props: SceneProps) {
  const b = useBeat(props)
  const first = props.clip.id === 'c7-11'
  const recalling = cue(b, 0, 0.125)
  const researchers = cue(b, 1, 0.266)
  const ten = cue(b, 2, 0.386)
  const reread = cue(b, 3, 0.652)
  const top = cue(b, 0, 0.156)
  const testing = cue(b, 1, 0.292)
  const spacing = cue(b, 2, 0.463)
  const both = cue(b, 3, 0.735)
  const intro = first ? showFor(since(b, 0, 0.5), since(b, researchers - 0.04, 0.4)) : 0
  const sheet = first ? since(b, ten + 0.1, 0.7) : 1
  const rows = TEN_WAYS.map((row, i) => {
    const p = first ? since(b, ten + 0.12 + i * 0.012, 0.4) : 1
    const stamp = first ? since(b, ten + 0.18 + i * 0.014, 0.4) : 1
    let lit = 0
    let dim = 0
    if (first) {
      const low = row.key === 'reread' || row.key === 'highlight'
      lit = low ? since(b, reread, 0.5) : 0
      dim = low ? 0 : since(b, reread, 0.5) * 0.8
    } else {
      const high = row.key === 'test' || row.key === 'space'
      dim = high ? 0 : since(b, top, 0.6)
      lit = row.key === 'test' ? since(b, testing, 0.5) : row.key === 'space' ? since(b, spacing, 0.5) : 0
    }
    return { label: row.label, grade: row.grade, p, stamp, lit, dim }
  })
  const card = first ? 0 : since(b, both - 0.02, 0.7)
  return (
    <Stage beat={b} label={first ? 'Researchers graded ten common ways to learn; re-reading and highlighting got the lowest grade' : 'Only two got the top grade: testing yourself and spacing it out. A card does both'}>
      {first && (
        <Layer style={{ opacity: intro }}>
          <p className="gc-not">
            <span>Reading</span>
            <b style={pop(b, since(b, recalling, 0.5))}>≠</b>
            <span style={rise(b, since(b, recalling, 0.5))}>Recalling</span>
          </p>
        </Layer>
      )}
      {first && (
        <Layer>
          <Paper beat={b} paper={PAPERS.dunlosky} at={{ in: researchers - 0.03, highlight: ten - 0.02, lift: ten + 0.08, out: ten + 0.14 }} />
        </Layer>
      )}
      <Layer style={{ opacity: clamp(sheet * 2) }}>
        <Fit>
          <ReportCard beat={b} p={sheet} title="Report card" sub="Ten ways to learn · 2013" rows={rows}>
            <div className="gc-report-card" style={{ ...pop(b, card, 0.5), opacity: clamp(card * 2) }} aria-label="A card: testing yourself and spacing it out">
              <span className="kit-mini__title">A card</span>
              <span>✓ Tests you</span>
              <span>✓ Spaced out</span>
            </div>
          </ReportCard>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** A card with a mark beside it: a tick, a cross, or a question mark. */
function Marked({ beat, text, mark, p, m, shown = 0, label }: { beat: Beat; text: string; mark: '✓' | '✕' | '?'; p: number; m: number; shown?: number; label?: string }) {
  return (
    <div className="gc-two__side kit-sizes__card" style={rise(beat, p, 12)}>
      <CardView beat={beat} chrome="plain" text={text} shown={shown} blanks={mark === '✓' ? 0 : m * 0.8} />
      <span className={`kit-check${mark === '✓' ? '' : ' gc-cross'}`} style={pop(beat, m)}>
        {mark}
      </span>
      {label !== undefined && <Words size="page">{label}</Words>}
    </div>
  )
}

/** c7-12, c7-13 and c7-14, one span: rule two (enough in view to point to one answer); rule three (a phrase, not scattered words); the same meaning in other words counts. */
function Rules(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  if (id === 'c7-12') {
    const point = cue(b, 1, 0.336)
    const blank = cue(b, 2, 0.581)
    const guesses = ['The solar system?', 'A railway?', 'Your nerves?']
    return (
      <Stage beat={b} label="Rule two: leave enough in view to point to one answer. A blank that could be many things teaches nothing">
        <Layer place="top">
          <Words size="kicker" style={rise(b, since(b, 0, 0.5))}>
            Rule 2
          </Words>
          <Words size="title" style={rise(b, since(b, 0.08, 0.6))}>
            Point to one answer.
          </Words>
        </Layer>
        <Layer>
          <div className="kit-row gc-two gc-rules">
            <Marked beat={b} text={DNS_FRONT} mark="✓" p={since(b, 0.17, 0.6)} m={since(b, point + 0.04, 0.5)} label="One answer fits" />
            <div className="gc-guess">
              <Marked beat={b} text="{{It}} is a system." mark="?" p={since(b, blank - 0.03, 0.6)} m={since(b, 0.9, 0.5)} label="Many answers fit" />
              {guesses.map((g, k) => (
                <span key={g} className="gc-guess__word" style={{ ...pop(b, since(b, blank + 0.08 + k * 0.06, 0.5), 0.6), top: `${-1.6 - k * 1.7}em`, left: `${10 + k * 26}%` }}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        </Layer>
      </Stage>
    )
  }
  if (id === 'c7-13') {
    const phrase = cue(b, 1, 0.306)
    const few = cue(b, 2, 0.665)
    return (
      <Stage beat={b} label="Rule three: hide a phrase that means something, not a few scattered words">
        <Layer place="top">
          <Words size="kicker" style={rise(b, since(b, 0, 0.5))}>
            Rule 3
          </Words>
          <Words size="title" style={rise(b, since(b, 0.12, 0.6))}>
            Hide a phrase that means something.
          </Words>
        </Layer>
        <Layer>
          <div className="kit-row gc-two gc-rules">
            <Marked beat={b} text="Carbs give your body {{quick energy}}." mark="✓" p={since(b, phrase - 0.04, 0.6)} m={since(b, phrase + 0.08, 0.5)} label="One phrase" />
            <Marked beat={b} text="{{Carbs}} give {{your}} body quick {{energy}}." mark="✕" p={since(b, few - 0.06, 0.6)} m={since(b, few + 0.1, 0.5)} label="Scattered words" />
          </div>
        </Layer>
      </Stage>
    )
  }
  const same = cue(b, 0, 0.217)
  const counts = cue(b, 1, 0.403)
  const exact = cue(b, 2, 0.534)
  const quotes = cue(b, 3, 0.791)
  const out = since(b, exact - 0.03, 0.5)
  return (
    <Stage beat={b} label="The same meaning in other words counts; exact words matter only for quotes and commands">
      <Layer style={{ opacity: 1 - out }}>
        <div className="gc-check">
          <CardView beat={b} chrome="plain" text="Carbs give your body {{quick energy}}." shown={1} />
          <div className="gc-check__row" style={rise(b, since(b, same - 0.08, 0.6))}>
            <span className="gc-check__who">You said</span>
            <span className="gc-check__said">{typed(b, 'fast fuel', since(b, same - 0.05, 0.8))}</span>
            <span className="kit-chip" style={pop(b, since(b, counts, 0.5))}>
              ✓ Same meaning: counts
            </span>
          </div>
        </div>
      </Layer>
      <Layer style={{ opacity: out }}>
        <Words size="kicker">Exact words, only for</Words>
        <div className="kit-row gc-exact">
          <div className="gc-exact__item" style={rise(b, since(b, quotes - 0.08, 0.6))}>
            <span className="gc-exact__quote">“Know thyself.”</span>
            <Words size="page">A quote</Words>
          </div>
          <div className="gc-exact__item" style={rise(b, since(b, quotes, 0.6))}>
            <code className="gc-exact__cmd">git commit -m</code>
            <Words size="page">A command</Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const SLEEP = 'Each short night adds to a {{sleep debt}}, and one long lie-in does not pay it back.'

/** c7-15: the title changes from where it was found to the name of the idea. */
function Naming(props: SceneProps) {
  const b = useBeat(props)
  const idea = cue(b, 0, 0.363)
  const not = cue(b, 1, 0.598)
  const strike = since(b, 0.16, 0.5)
  const retype = since(b, 0.3, 0.9)
  const title = retype > 0 ? typed(b, 'Sleep debt', retype) : 'From the podcast, part 3'
  return (
    <Stage beat={b} label="Name each card after the idea, not after where you found it">
      <Layer>
        <div className="gc-naming" style={rise(b, since(b, 0, 0.6), 12)}>
          <div className="card gc-naming__card">
            <div className="card__head">
              <span className="card__id">S3DB</span>
              <span className={`kit-cardview__title gc-naming__title${retype > 0 ? ' is-idea' : ''}`} style={retype > 0 ? undefined : { textDecorationLine: strike > 0 ? 'line-through' : 'none', textDecorationColor: 'var(--danger)', opacity: lerp(1, 0.5, strike) }}>
                {title}
                {retype > 0 && retype < 1 && !b.reduced && <span className="kit-caret" />}
              </span>
            </div>
            <CardView beat={b} chrome="plain" text={SLEEP} />
          </div>
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, idea, 0.5))}>
            ✓ The idea
          </span>
          <span className="kit-chip gc-chip--bad" style={pop(b, since(b, not, 0.5))}>
            ✕ Where you found it
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

const FORMATS = [
  { kind: 'A word', text: 'Honest and direct, even when it is hard to hear: {{candid}}.', file: 'vocabulary' },
  { kind: 'A person', text: '{{Hermann Ebbinghaus}} measured forgetting on himself, in the 1880s.', file: 'person' },
  { kind: 'A process', text: 'Dough rises because {{yeast}} makes gas, and the gluten traps it.', file: 'procedure' },
  { kind: 'A quote', text: '“{{Know thyself}}” was carved at the temple at Delphi.', file: 'quote' },
]

/** c7-16: four small cards in four formats, each on its word; then the card skill's formats folder, with a page for each. */
function Formats(props: SceneProps) {
  const unit = useUnit()
  const b = useBeat(props)
  const at = [0, 1, 2, 3].map((k) => cue(b, k, [0.304, 0.391, 0.477, 0.581][k]))
  const skill = cue(b, 4, 0.755)
  const side = since(b, skill - 0.05, 0.7)
  return (
    <Stage beat={b} label={unit('Different things need different formats: a word, a person, a process, a quote. Each has a short page in the card skill')}>
      <Layer>
        <div className="kit-row gc-formats">
          <div className="gc-formats__grid">
            {FORMATS.map((f, k) => (
              <div key={f.kind} className="gc-formats__card" style={pop(b, since(b, at[k] - 0.02, 0.5), 0.7)}>
                <span className="kit-chip">{f.kind}</span>
                <CardView beat={b} chrome="plain" text={f.text} className="kit-cardview--small" />
              </div>
            ))}
          </div>
          <div style={rise(b, side, 14)}>
            <AppWindow
              style={{ width: 'min(40cqw, 16em)', height: 'min(56cqh, 14em)' }}
              label={unit("The card skill's formats folder, with a page for each format")}
              sidebar={
            <SidebarPreview
              rows={[
                { name: 'Card skill', kind: 'folder', open: true },
                { name: 'formats', kind: 'folder', open: true, depth: 1 },
                ...FORMATS.map((f, k) => ({ name: f.file, kind: 'page' as const, depth: 2, glow: showFor(since(b, skill + k * 0.04, 0.3), since(b, skill + 0.12 + k * 0.04, 0.5)) })),
              ]}
            />
              }
            />
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c7-17: the chapter in three pictures (front, back, tree); then the agent's window: a tool that can help, and hurt. */
function Recap(props: SceneProps) {
  const b = useBeat(props)
  const front = cue(b, 0, 0.117)
  const back = cue(b, 1, 0.302)
  const tree = cue(b, 2, 0.411)
  const tool = cue(b, 3, 0.729)
  const out = since(b, tool - 0.08, 0.6)
  const hurt = since(b, 0.9, 0.5)
  return (
    <Stage beat={b} label="The short version on the front, the details on the back, a tree that grows. Next: a tool that can help, and hurt">
      <Layer style={{ opacity: 1 - out }}>
        <div className="kit-row gc-recap">
          <div style={rise(b, since(b, front - 0.05, 0.6), 12)}>
            <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} links={PROTEIN.links} sides={b.progress >= back ? undefined : 1} shown={b.progress >= back ? PROTEIN.hidden : 0} grow={b.progress >= back ? [undefined, undefined, since(b, back, 0.6), 0, 0, 0] : undefined} className="kit-cardview--small" />
          </div>
          <div className="gc-recap__tree" style={{ opacity: since(b, tree - 0.02, 0.6) }}>
            <Grove beat={b} at={{ u: 1, p: since(b, tree, 0.5), c: since(b, tree + 0.03, 0.5), f: since(b, tree + 0.06, 0.5), a: since(b, tree + 0.09, 0.5), fi: since(b, tree + 0.11, 0.5), s: since(b, tree + 0.13, 0.5), o: since(b, tree + 0.15, 0.5) }} />
          </div>
        </div>
      </Layer>
      <Layer style={{ opacity: out }}>
        <AgentTerminal beat={b} lines={[{ text: 'Make cards from this page.', p: since(b, tool + 0.04, 1), kind: 'in' }, { text: 'Writing 40 cards…', p: since(b, 0.88, 0.6), kind: 'warn' }]} style={{ boxShadow: hurt > 0 ? `0 0 0 2px color-mix(in srgb, var(--danger) ${(hurt * 70).toFixed(0)}%, transparent)` : undefined }} />
      </Layer>
    </Stage>
  )
}

export const GOOD_CARD_SCENES: ChapterScenes = {
  chapter: 'good-card',
  entries: [
    { clips: ['c7-01'], scene: Begin },
    { clips: ['c7-02', 'c7-03', 'c7-20'], scene: WallAndLine },
    { clips: ['c7-04', 'c7-21', 'c7-22'], scene: ShortVersion },
    { clips: ['c7-05', 'c7-06', 'c7-07', 'c7-18', 'c7-23', 'c7-19'], scene: GrowingTree },
    { clips: ['c7-24', 'c7-25', 'c7-26', 'c7-27', 'c7-28'], scene: TheFront },
    { clips: ['c7-08', 'c7-09', 'c7-10'], scene: PickACard },
    { clips: ['c7-11', 'c7-29'], scene: ReportCardScene },
    { clips: ['c7-12', 'c7-13', 'c7-14'], scene: Rules },
    { clips: ['c7-15'], scene: Naming },
    { clips: ['c7-16'], scene: Formats },
    { clips: ['c7-17'], scene: Recap },
  ],
}
