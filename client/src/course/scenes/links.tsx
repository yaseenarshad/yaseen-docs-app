/**
 * CHAPTER 10, "Links: how cards connect" (YAZ-5121): the idea that changes how you organise. Folders (one thing, one
 * place; "where does this go?"); all cards in one open place; the mind as a web where light spreads along the links
 * (Collins & Loftus 1975, on the page); a new idea that fits stays lit; two trees and the link a folder cannot show;
 * the protein card in Food and the muscle card in Exercise, the folders shut, a link across them; THE BIG FRAME:
 * "Folders ask: where does this go? Links ask: what does this connect to?"; the agent finds links and you approve each
 * one (handmade); the reason beside a link; by hand: `[[`, the list, the pill, Linked mentions; a hub; a base, not a
 * pile. The cues are `marks` in `script.ts`, from the real voice's word times.
 */
import { useUnit } from '../../vault/unitWord'
import type { SceneProps } from '../scene'
import { PAPERS } from './papers'
import { MUSCLE, PROTEIN_BRANCH, UMBRELLA, sampleId } from './cards'
import { EditCard, AppWindow, Caret, CardView, Cite, Fit, Keys, Layer, Paper, Pointer, SidebarPreview, Stage, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, typedText, useBeat, type Beat, Habits, Web, scatterWeb, type WebEdge, type WebNode, Folder, cardTop, AgentChat, CardPill, LinkPicker, LinkedMentions, Garden, type PlantSpec, Head } from './kit'
import type { ChapterScenes } from './registry'
import './later.css'

/** The two cards the chapter joins, as two nodes and a link. */
const PAIR: { nodes: WebNode[]; edges: WebEdge[] } = {
  nodes: [
    { id: 'a', x: 180, y: 170, label: 'Protein', kind: 'card' },
    { id: 'b', x: 420, y: 170, label: 'How muscle grows', kind: 'card' },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'link' }],
}

/** c10-01: the three habits step back; two cards, and a thin line drawn between them; why that beats folders. */
function Connect(props: SceneProps) {
  const b = useBeat(props)
  const how = cue(b, 0, 0.57)
  const beats = cue(b, 1, 0.86)
  const out = since(b, how - 0.06, 0.6)
  return (
    <Stage beat={b} label="Make, review, tend; now, how cards connect, and why that beats folders">
      <Layer style={{ opacity: 1 - out }}>
        <Habits beat={b} show={[1, 1, 1]} lit={[since(b, 0.16, 0.4), since(b, 0.27, 0.4), since(b, 0.36, 0.4)]} />
      </Layer>
      <Layer style={{ opacity: out }}>
        <Web beat={b} nodes={PAIR.nodes} edges={PAIR.edges} show={{ a: since(b, how - 0.04, 0.5), b: since(b, how, 0.5), 'a>b': since(b, how + 0.06, 1) }} />
        <Words size="label" tone="muted" style={rise(b, since(b, beats, 0.5))}>
          Links, not folders
        </Words>
      </Layer>
    </Stage>
  )
}

const FOLDERS = [
  { x: 40, label: 'Food' },
  { x: 220, label: 'Work' },
  { x: 400, label: 'Books' },
] as const

/** c10-02, c10-03 and c10-04, one span: one thing in one folder; "where does this go?"; then every card in one open box. */
function OnePlace(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const files = id === 'c10-02' ? cue(b, 0, 0.24) : 0
  const drop = id === 'c10-02' ? since(b, files, 0.9) : 1
  const shut = id === 'c10-02' ? since(b, files + 0.14, 0.5) : 1
  const rule = id === 'c10-02' ? since(b, cue(b, 1, 0.7), 0.6) : id === 'c10-03' ? 1 - since(b, 0, 0.5) : 0
  // c10-03: a new card hovers from folder to folder.
  const hover = id === 'c10-03' ? since(b, 0.05, 0.6) : 0
  const sway = b.reduced ? 0 : Math.sin(b.t * 1.7) * 150
  const ask = id === 'c10-03' ? since(b, cue(b, 1, 0.61) - 0.05, 0.6) : 0
  // c10-04: the folders go; one open box, and the cards all fall in.
  const box = id === 'c10-04' ? since(b, 0.02, 0.6) : 0
  const folders = id === 'c10-04' ? 1 - since(b, 0, 0.5) : 1
  const fall = id === 'c10-04' ? cue(b, 0, 0.32) : 1
  const atMost = id === 'c10-04' ? since(b, cue(b, 1, 0.65), 0.6) : 0
  const pile = Array.from({ length: 9 }, (_, i) => ({ p: since(b, fall - 0.12 + i * 0.035, 0.6), dx: ((i * 37) % 9) / 4 - 1, tilt: ((i * 53) % 21) - 10 }))
  return (
    <Stage beat={b} label={id === 'c10-02' ? 'Files and folders: one thing, one place' : id === 'c10-03' ? 'A new card over three folders: where does this go?' : 'Cards can all live in one place, or one folder at most'}>
      <Layer style={{ paddingBottom: '8%' }}>
        <svg className="kit-folders" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {FOLDERS.map((f, i) => (
            <Folder key={f.label} beat={b} x={f.x} y={150} label={f.label} p={(id === 'c10-02' ? since(b, i * 0.06, 0.5) : 1) * folders} card={i === 1 ? 'Meeting minutes' : undefined} cardIn={i === 1 ? drop : 0} shut={i === 1 ? shut : 0} />
          ))}
          {hover > 0 && (
            <g transform={`translate(${(300 + sway * (1 - ask * 0.8) - 54).toFixed(2)} ${(40 + (b.reduced ? 0 : Math.sin(b.t * 3.1) * 5)).toFixed(2)})`} opacity={clamp(hover * 2)}>
              <rect className="kit-folder__card later-hover-card" width={108} height={66} rx={6} />
              <text className="kit-folder__card-title" x={54} y={17} textAnchor="middle">
                New card
              </text>
              <line className="kit-folder__card-line" x1={14} y1={32} x2={94} y2={32} />
              <line className="kit-folder__card-line" x1={14} y1={44} x2={74} y2={44} />
              <text className="later-qmark" x={54} y={-12} textAnchor="middle" opacity={ask}>
                ?
              </text>
            </g>
          )}
          {box > 0 && <Folder beat={b} x={300 - 80 * 1.5} y={70} scale={1.5} label="Cards" p={box} pile={pile} />}
        </svg>
      </Layer>
      <Layer place="bottom">
        {id === 'c10-02' && (
          <Words size="title" style={rise(b, rule)}>
            One thing, one place.
          </Words>
        )}
        {id === 'c10-03' && (
          <Words size="title" tone="accent" style={rise(b, ask)}>
            Where does this go?
          </Words>
        )}
        {id === 'c10-04' && (
          <span className="kit-chip" style={pop(b, atMost)}>
            One place, or one folder at most
          </span>
        )}
      </Layer>
    </Stage>
  )
}

/** c10-05: a line from one card to another, "a link points to another card"; the protein card and its umbrella. */
function LinkHolds(props: SceneProps) {
  const b = useBeat(props)
  const what = cue(b, 0, 0.16)
  const protein = cue(b, 1, 0.57)
  const umbrella = cue(b, 2, 0.84)
  const named = since(b, protein - 0.04, 0.5)
  const nodes: WebNode[] = [
    { id: 'u', x: 300, y: 80, label: named > 0 ? 'Protein, carbs and fat' : undefined, kind: named > 0 ? 'hub' : 'card' },
    { id: 'p', x: 300, y: 250, label: named > 0 ? 'Protein' : undefined, kind: 'card' },
  ]
  return (
    <Stage beat={b} label="A link points to another card: the protein card, linked to its umbrella">
      <Layer>
        <Web beat={b} nodes={nodes} edges={[{ from: 'p', to: 'u', kind: 'link' }]} show={{ u: since(b, 0, 0.5), p: since(b, 0.04, 0.5), 'p>u': since(b, 0.08, 0.9) }} lit={{ u: since(b, umbrella, 0.6), p: showFor(since(b, protein, 0.5), since(b, umbrella, 0.5)) }} />
      </Layer>
      <Layer place="bottom">
        <span className="kit-chip" style={pop(b, showFor(since(b, what, 0.5), since(b, protein - 0.06, 0.4)))}>
          Link: points to another card
        </span>
      </Layer>
    </Stage>
  )
}

/** The mind's web: ideas inside the head (the profile's view), and a larger one for the paper's moment. */
const HEAD_WEB: { nodes: WebNode[]; edges: WebEdge[] } = {
  nodes: [
    { id: 'm0', x: 300, y: 150 },
    { id: 'm1', x: 250, y: 120 },
    { id: 'm2', x: 350, y: 110 },
    { id: 'm3', x: 260, y: 200 },
    { id: 'm4', x: 340, y: 200 },
    { id: 'm5', x: 380, y: 160 },
    { id: 'm6', x: 230, y: 165 },
    { id: 'm7', x: 300, y: 95 },
  ],
  edges: [
    { from: 'm0', to: 'm1' },
    { from: 'm0', to: 'm2' },
    { from: 'm0', to: 'm4' },
    { from: 'm1', to: 'm6' },
    { from: 'm1', to: 'm7' },
    { from: 'm2', to: 'm5' },
    { from: 'm3', to: 'm6' },
    { from: 'm4', to: 'm5' },
    { from: 'm3', to: 'm4' },
    { from: 'm2', to: 'm7' },
  ],
}
const BIG_WEB: { nodes: WebNode[]; edges: WebEdge[] } = {
  nodes: [
    { id: 'w0', x: 300, y: 170, label: 'bread' },
    { id: 'w1', x: 190, y: 110, label: 'butter' },
    { id: 'w2', x: 410, y: 105, label: 'bakery' },
    { id: 'w3', x: 200, y: 245, label: 'toast' },
    { id: 'w4', x: 400, y: 250, label: 'wheat' },
    { id: 'w5', x: 90, y: 160, label: 'milk' },
    { id: 'w6', x: 520, y: 175, label: 'smell' },
    { id: 'w7', x: 120, y: 290, label: 'breakfast' },
    { id: 'w8', x: 500, y: 300, label: 'field' },
    { id: 'w9', x: 290, y: 50, label: 'oven' },
  ],
  edges: [
    { from: 'w0', to: 'w1' },
    { from: 'w0', to: 'w2' },
    { from: 'w0', to: 'w3' },
    { from: 'w0', to: 'w4' },
    { from: 'w1', to: 'w5' },
    { from: 'w2', to: 'w6' },
    { from: 'w3', to: 'w7' },
    { from: 'w4', to: 'w8' },
    { from: 'w2', to: 'w9' },
    { from: 'w1', to: 'w3' },
  ],
}

/** c10-06, c10-07 and c10-08, one span: the mind is not folders but a web; the paper; light spreads; a new idea that fits stays lit. */
function MindWeb(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  // c10-06: boxes in the head, struck out; then dots and lines; one idea calls up another.
  const boxes = id === 'c10-06' ? showFor(since(b, 0.04, 0.5), since(b, cue(b, 0, 0.21) + 0.12, 0.5)) : 0
  const assoc = id === 'c10-06' ? cue(b, 1, 0.57) : 0
  const head = id === 'c10-06' ? since(b, 0, 0.6) : 0
  const callsUp = id === 'c10-06' ? since(b, cue(b, 2, 0.7), 0.4) : 0
  const another = id === 'c10-06' ? since(b, cue(b, 3, 0.78), 0.5) : 0
  // c10-07: the paper; then the web; think of one, and the light spreads.
  const lift = cue(b, 0, 0.14) + 0.28
  const big = id === 'c10-07' ? since(b, lift, 0.6) : id === 'c10-08' ? 1 : 0
  const thinkOf = id === 'c10-07' ? since(b, cue(b, 1, 0.49), 0.4) : id === 'c10-08' ? 1 : 0
  const spread = id === 'c10-07' ? between(b, cue(b, 2, 0.62), 0.95) : 0
  // c10-08: two new ideas: one fits beside known ones and stays lit; one has nothing to hold on to and fades.
  const newFacts = id === 'c10-08' ? cue(b, 0, 0.22) : 2
  const fits = id === 'c10-08' ? cue(b, 1, 0.65) : 2
  const arrive = since(b, newFacts, 0.8)
  const nodes: WebNode[] = [...BIG_WEB.nodes, { id: 'n1', x: lerp(590, 520, moved(b, arrive)), y: lerp(10, 50, moved(b, arrive)), label: 'sourdough' }, { id: 'n2', x: lerp(40, 560, moved(b, arrive)), y: lerp(330, 40, moved(b, arrive)), label: 'a lone fact' }]
  const edges: WebEdge[] = [...BIG_WEB.edges, { from: 'n1', to: 'w2' }, { from: 'n1', to: 'w6' }]
  const show: Record<string, number> = { n1: arrive, n2: arrive * (1 - since(b, fits + 0.05, 1)), 'n1>w2': since(b, fits, 0.6), 'n1>w6': since(b, fits + 0.04, 0.6) }
  const dim = id === 'c10-08' ? lerp(1, 0.6, since(b, newFacts - 0.05, 0.5)) : 1
  return (
    <Stage beat={b} label={id === 'c10-06' ? 'Your mind works by association: one idea calls up another' : id === 'c10-07' ? 'Memory as a web of linked ideas: think of one, and the ones linked to it light up' : 'A new fact that fits with what you know is remembered better'}>
      {id === 'c10-06' && (
        <>
          <Layer>
            <Head beat={b} p={head} className="kit-head--large">
              <g opacity={boxes}>
                {[0, 1, 2, 3].map((i) => (
                  <rect key={i} className="later-headbox" x={240 + (i % 2) * 64} y={100 + Math.floor(i / 2) * 56} width={52} height={40} rx={4} />
                ))}
                <line className="later-strike" x1={230} y1={210} x2={370} y2={92} opacity={since(b, cue(b, 0, 0.21), 0.4)} />
              </g>
            </Head>
          </Layer>
          <Layer>
            <Web beat={b} nodes={HEAD_WEB.nodes} edges={HEAD_WEB.edges} all={between(b, assoc - 0.04, assoc + 0.12)} lit={{ m0: callsUp, m2: another, m5: since(b, cue(b, 3, 0.78) + 0.08, 0.5) }} />
          </Layer>
        </>
      )}
      {id === 'c10-07' && (
        <Layer>
          <Paper beat={b} paper={PAPERS.collinsLoftus} at={{ in: 0, highlight: cue(b, 0, 0.14), lift, out: lift + 0.06 }} />
        </Layer>
      )}
      {big > 0 && (
        <Layer style={{ opacity: big * dim }}>
          <Web beat={b} nodes={BIG_WEB.nodes} edges={BIG_WEB.edges} all={big} source="w0" spread={spread} lit={id === 'c10-08' ? { w2: since(b, fits, 0.4), w6: since(b, fits + 0.04, 0.4) } : { w0: thinkOf }} />
        </Layer>
      )}
      {id === 'c10-08' && (
        <Layer>
          <Web beat={b} nodes={nodes} edges={edges} show={show} all={0} lit={{ n1: since(b, fits + 0.06, 0.6) }} />
        </Layer>
      )}
      <Layer place="bottom">
        {id === 'c10-07' && <Cite beat={b} paper={PAPERS.collinsLoftus} p={since(b, lift, 0.6)} />}
        {id === 'c10-08' && <Cite beat={b} paper={PAPERS.vanKesteren} p={since(b, 0.05, 0.6)} />}
      </Layer>
    </Stage>
  )
}

/** The two trees: Food (chapter 7's) on the left, Exercise on the right. */
const TREES: { nodes: WebNode[]; edges: WebEdge[] } = {
  nodes: [
    { id: 'food', x: 150, y: 60, label: 'Protein, carbs and fat', kind: 'card' },
    { id: 'protein', x: 210, y: 170, label: 'Protein', kind: 'card' },
    { id: 'carbs', x: 95, y: 170, label: 'Carbs', kind: 'card' },
    { id: 'fibre', x: 95, y: 270, label: 'Fibre', kind: 'card' },
    { id: 'gym', x: 450, y: 60, label: 'Strength training', kind: 'card' },
    { id: 'muscle', x: 410, y: 170, label: 'How muscle grows', kind: 'card' },
    { id: 'rest', x: 520, y: 270, label: 'Rest days', kind: 'card' },
  ],
  edges: [
    { from: 'food', to: 'protein' },
    { from: 'food', to: 'carbs' },
    { from: 'carbs', to: 'fibre' },
    { from: 'gym', to: 'muscle' },
    { from: 'gym', to: 'rest' },
  ],
}

/** A flexed arm with a weight; protein blocks travel into the muscle (c10-11). `lift` 0..1, `blocks` 0..1. */
function Arm({ beat, lift, blocks }: { beat: Beat; lift: number; blocks: number }) {
  const l = beat.reduced ? (lift > 0 ? 1 : 0) : ease.inOut(clamp(lift))
  const angle = lerp(10, -62, l)
  const ex = 330
  const ey = 210
  const r = (angle * Math.PI) / 180
  const hx = ex + Math.cos(r) * 120
  const hy = ey + Math.sin(r) * 120
  return (
    <svg className="later-arm" viewBox="0 0 600 340" aria-hidden="true">
      <path className="later-arm__limb" d={`M210 120 L${ex} ${ey}`} />
      <ellipse className="later-arm__bicep" cx={272} cy={lerp(160, 150, l)} rx={lerp(34, 44, l)} ry={lerp(16, 26, l)} transform={`rotate(36 272 160)`} />
      <path className="later-arm__limb" d={`M${ex} ${ey} L${hx.toFixed(1)} ${hy.toFixed(1)}`} />
      <g transform={`translate(${hx.toFixed(1)} ${hy.toFixed(1)}) rotate(${(angle + 90).toFixed(1)})`}>
        <rect className="later-arm__weight" x={-34} y={-6} width={68} height={12} rx={4} />
        <rect className="later-arm__plate" x={-44} y={-18} width={14} height={36} rx={3} />
        <rect className="later-arm__plate" x={30} y={-18} width={14} height={36} rx={3} />
      </g>
      <text className="kit-svg-label kit-svg-label--accent" x={70} y={90} textAnchor="middle" opacity={clamp(blocks * 4)}>
        Protein
      </text>
      {[0, 1, 2, 3, 4].map((i) => {
        const p = beat.reduced ? (blocks > 0 ? 1 : 0) : clamp(blocks * 2.2 - i * 0.28)
        if (p <= 0 || p >= 1) return null
        const x = lerp(70, 272, ease.inOut(p))
        const y = lerp(105, 155, ease.inOut(p)) - Math.sin(p * Math.PI) * 40
        return <rect key={i} className="later-arm__block" x={x - 6} y={y - 6} width={12} height={12} rx={2} opacity={clamp((1 - p) * 4)} />
      })}
    </svg>
  )
}

/** c10-23, c10-09, c10-10, c10-11 and c10-12, one span: two trees and a link across them; the protein card in Food; the
 * muscle card in Exercise; muscle is built from protein; the folders keep them apart, a link joins them. */
function AcrossTrees(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const at = (clip: string) => id === clip
  // c10-23: the trees grow; a dotted line wants to cross; folders close round each tree and the line stops.
  const trees = at('c10-23') ? 1 : 0
  const across = at('c10-23') ? since(b, cue(b, 1, 0.48), 1.1) : 0
  const walls = at('c10-23') ? since(b, cue(b, 2, 0.75), 0.6) : 0
  const treeShow: Record<string, number> = {}
  TREES.nodes.forEach((n, i) => (treeShow[n.id] = since(b, 0.02 + i * 0.035, 0.5)))
  TREES.edges.forEach((e, i) => (treeShow[`${e.from}>${e.to}`] = since(b, 0.06 + i * 0.04, 0.6)))
  treeShow['protein>muscle'] = across * lerp(1, 0.55, walls)
  // c10-09 to c10-12: two folders.
  const folders = at('c10-09') ? since(b, 0, 0.5) : at('c10-10') || at('c10-11') || at('c10-12') ? 1 : 0
  const proteinIn = at('c10-09') ? since(b, cue(b, 0, 0.4), 0.9) : at('c10-10') || at('c10-11') || at('c10-12') ? 1 : 0
  const muscleIn = at('c10-10') ? since(b, cue(b, 0, 0.28), 0.9) : at('c10-11') || at('c10-12') ? 1 : 0
  const food = at('c10-09') ? showFor(since(b, cue(b, 2, 0.84), 0.4), 0) : 0
  const exercise = at('c10-10') ? since(b, cue(b, 1, 0.82), 0.4) : 0
  const shut = at('c10-12') ? since(b, cue(b, 0, 0.22) - 0.1, 0.6) : at('c10-09') ? since(b, 0.7, 0.5) : at('c10-10') ? 1 : 0
  const shutB = at('c10-10') ? since(b, cue(b, 0, 0.28) + 0.12, 0.5) : at('c10-12') ? 1 : 0
  const apart = at('c10-12') ? showFor(since(b, cue(b, 1, 0.48), 0.4), since(b, cue(b, 2, 0.74), 0.4)) : 0
  const join = at('c10-12') ? since(b, cue(b, 2, 0.74), 1) : 0
  const arm = at('c10-11') ? since(b, 0, 0.5) : 0
  const A = { x: 70, y: 150 }
  const B = { x: 370, y: 150 }
  const [ax, ay] = cardTop(A)
  const [bx, by] = cardTop(B)
  const j = b.reduced ? (join > 0 ? 1 : 0) : ease.inOut(join)
  return (
    <Stage beat={b} label={at('c10-23') ? 'Ideas connect across trees, and a folder cannot show that' : at('c10-11') ? 'Your body builds muscle out of protein' : at('c10-12') ? 'The folders keep the two cards apart; a link joins them' : 'The protein card in Food; the muscle card in Exercise'}>
      {trees > 0 && (
        <Layer>
          <Web beat={b} nodes={TREES.nodes} edges={[...TREES.edges, { from: 'protein', to: 'muscle', kind: 'link' }]} show={treeShow} lit={{ protein: across, muscle: across * (1 - walls) }} />
          <svg className="kit-web later-walls" viewBox="0 0 600 340" aria-hidden="true" style={{ opacity: walls }}>
            <rect className="later-wall" x={20} y={20} width={250} height={300} rx={16} />
            <rect className="later-wall" x={330} y={20} width={250} height={300} rx={16} />
          </svg>
        </Layer>
      )}
      {folders > 0 && (
        <Layer style={{ opacity: folders * (1 - arm * 0.85), paddingBottom: '6%' }}>
          <svg className="kit-folders" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <Folder beat={b} x={A.x} y={A.y} label="Food" card="Protein" cardIn={proteinIn} shut={shut} glow={food} />
            <Folder beat={b} x={B.x} y={B.y} label="Exercise" card="How muscle grows" cardIn={muscleIn} shut={shutB} glow={exercise} dim={at('c10-09') ? 0.5 : 0} />
            {apart > 0 && (
              <g opacity={apart}>
                <line className="later-apart" x1={300} y1={130} x2={300} y2={300} />
              </g>
            )}
            {join > 0 && <path className="later-join" d={`M${ax} ${ay} C${ax + 60} ${ay - 120 * j} ${bx - 60} ${by - 120 * j} ${lerp(ax, bx, j)} ${lerp(ay, by, j)}`} />}
          </svg>
        </Layer>
      )}
      {arm > 0 && (
        <Layer style={{ opacity: arm }}>
          <Arm beat={b} lift={since(b, cue(b, 0, 0.44), 1.2)} blocks={since(b, cue(b, 1, 0.59), 1.6)} />
        </Layer>
      )}
      <Layer place="bottom">
        {at('c10-12') && (
          <span className="kit-chip" style={pop(b, since(b, cue(b, 2, 0.74) + 0.06, 0.5))}>
            A link joins them
          </span>
        )}
      </Layer>
    </Stage>
  )
}

/** c10-13: THE BIG FRAME. "Folders ask: where does this go?" against "Links ask: what does this connect to?" */
function TwoQuestions(props: SceneProps) {
  const b = useBeat(props)
  const where = cue(b, 0, 0.22)
  const links = cue(b, 1, 0.47)
  const what = cue(b, 2, 0.67)
  const left = since(b, 0, 0.6)
  const right = since(b, links - 0.03, 0.6)
  const leftDim = lerp(1, 0.38, since(b, links, 0.6))
  const mini: WebNode[] = [
    { id: 'c', x: 300, y: 170, kind: 'dot' },
    { id: 'a', x: 200, y: 100, kind: 'dot' },
    { id: 'b', x: 410, y: 95, kind: 'dot' },
    { id: 'd', x: 190, y: 250, kind: 'dot' },
    { id: 'e', x: 420, y: 255, kind: 'dot' },
  ]
  const miniEdges: WebEdge[] = ['a', 'b', 'd', 'e'].map((n) => ({ from: 'c', to: n, kind: 'link' }))
  return (
    <Stage beat={b} label="Folders ask: where does this go? Links ask: what does this connect to?" className="later-big">
      <Layer>
        <div className="later-questions">
          <div className="later-q" style={{ ...rise(b, left, 14), opacity: clamp(left) * leftDim }}>
            <svg className="later-q__art" viewBox="160 -10 330 180" aria-hidden="true">
              <Folder beat={b} x={245} y={10} label="" scale={1} />
            </svg>
            <Words size="kicker">Folders ask</Words>
            <Words size="display" style={{ opacity: since(b, where - 0.04, 0.5) }}>
              Where does this go?
            </Words>
          </div>
          <div className="later-q later-q--links" style={rise(b, right, 14)}>
            <div className="later-q__art">
              <Web beat={b} nodes={mini} edges={miniEdges} source="c" spread={between(b, what, what + 0.2)} lit={{ c: since(b, links, 0.5) }} />
            </div>
            <Words size="kicker">Links ask</Words>
            <Words size="display" tone={since(b, what, 0.3) > 0.5 ? 'accent' : undefined} style={{ opacity: since(b, links + 0.08, 0.5) }}>
              What does this connect to?
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c10-14: one card links to a card file, to a card inside a page, and to a page. */
function AnyTarget(props: SceneProps) {
  const unit = useUnit()
  const b = useBeat(props)
  const anyCard = cue(b, 0, 0.23)
  const wherever = cue(b, 1, 0.4)
  const page = cue(b, 2, 0.72)
  const targets = [
    { x: 110, y: 80, p: since(b, anyCard, 0.6), kind: 'file' as const, label: 'A card file' },
    { x: 490, y: 80, p: since(b, wherever, 0.6), kind: 'inpage' as const, label: unit('A card in a page') },
    { x: 300, y: 285, p: since(b, page, 0.6), kind: 'page' as const, label: unit('A page') },
  ]
  return (
    <Stage beat={b} label={unit('A card can link to any card, wherever it lives, and to any page')}>
      <Layer>
        <svg className="kit-web" viewBox="0 0 600 340" aria-hidden="true">
          {targets.map((t) => (
            <line key={t.label} className="kit-web__edge kit-web__edge--link" x1={300} y1={160} x2={lerp(300, t.x, b.reduced ? 1 : ease.out(t.p))} y2={lerp(160, t.y, b.reduced ? 1 : ease.out(t.p))} opacity={b.reduced ? t.p : 1} />
          ))}
          <g transform="translate(300 160)" opacity={since(b, 0, 0.5)}>
            <rect className="kit-web__card kit-web__card--hub" x={-56} y={-22} width={112} height={44} rx={8} />
            <text className="kit-svg-label" y={5} textAnchor="middle">
              Protein
            </text>
          </g>
          {targets.map((t) => (
            <g key={t.label} transform={`translate(${t.x} ${t.y}) scale(${b.reduced ? 1 : ease.back(t.p).toFixed(3)})`} opacity={clamp(t.p * 2)}>
              {t.kind === 'file' && (
                <>
                  <rect className="kit-web__card" x={-46} y={-28} width={92} height={56} rx={7} />
                  <text className="kit-svg-page" y={-6} textAnchor="middle">
                    How muscle
                  </text>
                  <text className="kit-svg-page" y={10} textAnchor="middle">
                    grows
                  </text>
                </>
              )}
              {t.kind === 'inpage' && (
                <>
                  <path className="later-page" d="M-50 -40 H30 L50 -20 V40 H-50 Z" />
                  <line className="kit-folder__card-line" x1={-38} y1={-26} x2={20} y2={-26} />
                  <rect className="kit-web__card" x={-38} y={-14} width={76} height={40} rx={5} />
                  <text className="kit-svg-page" y={10} textAnchor="middle">
                    Calories
                  </text>
                </>
              )}
              {t.kind === 'page' && (
                <>
                  <path className="later-page" d="M-40 -34 H24 L40 -18 V34 H-40 Z" />
                  <line className="kit-folder__card-line" x1={-28} y1={-18} x2={16} y2={-18} />
                  <line className="kit-folder__card-line" x1={-28} y1={-4} x2={26} y2={-4} />
                  <line className="kit-folder__card-line" x1={-28} y1={10} x2={8} y2={10} />
                </>
              )}
              <text className="kit-svg-label" y={t.kind === 'page' ? 54 : -48} textAnchor="middle">
                {t.label}
              </text>
            </g>
          ))}
        </svg>
      </Layer>
    </Stage>
  )
}

/** c10-26, c10-27 and c10-24, one span: ask your agent for the connections; it shows each one, you read and approve; the reason beside the link. */
function AgentLinks(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const ask = id === 'c10-26' ? between(b, cue(b, 0, 0.34) - 0.05, cue(b, 1, 0.57) + 0.2) : 1
  const found = id === 'c10-26' ? since(b, 0.85, 0.5) : 1
  const shows = id === 'c10-27' ? since(b, cue(b, 1, 0.3) - 0.04, 0.5) : id === 'c10-24' ? 1 : 0
  const read = id === 'c10-27' ? since(b, cue(b, 2, 0.71) - 0.03, 1) : id === 'c10-24' ? 1 : 0
  const yes = id === 'c10-27' ? since(b, cue(b, 3, 0.82), 0.4) : id === 'c10-24' ? 1 : 0
  const handmade = id === 'c10-27' ? since(b, cue(b, 0, 0.07), 0.5) : 0
  const card = id === 'c10-24' ? since(b, 0, 0.6) : 0
  const reason = id === 'c10-24' ? since(b, cue(b, 2, 0.64), 0.5) : 0
  return (
    <Stage beat={b} label={id === 'c10-26' ? 'Ask your agent to find the connections' : id === 'c10-27' ? 'Handmade: the agent shows each link in the chat; you read it and approve it' : 'Beside each link, a few words on why the two connect'}>
      <Layer style={{ opacity: 1 - card }}>
        <AgentChat
          beat={b}
          lines={[
            { who: 'you', text: 'Find cards in my card base that connect. Show me each link and why, and wait for my yes.', p: ask },
            {
              who: 'agent',
              text: 'These two cards connect: Protein and How muscle grows. Add the link?',
              p: found,
              ask: shows > 0 ? { title: '[[How muscle grows]] on Protein', reason: 'muscle is built from protein', read, answer: 'yes', answerP: yes, yes: 'Yes, add it' } : undefined,
            },
          ]}
        />
        <span className="kit-chip later-handmade" style={pop(b, handmade)}>
          Handmade
        </span>
      </Layer>
      <Layer style={{ opacity: card }}>
        <Fit>
          <CardView beat={b} title={PROTEIN_BRANCH.title} id={PROTEIN_BRANCH.id} text={PROTEIN_BRANCH.text} links={PROTEIN_BRANCH.links} chrome="block" shown={1} lit={[0, 0, 0, since(b, cue(b, 0, 0.11), 0.5)]} dim={since(b, cue(b, 0, 0.11), 0.5)} />
          <span className="kit-chip" style={pop(b, reason)}>
            The reason: muscle is built from protein
          </span>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** The rows of the `[[` list for "mus": pages first, then cards. */
const PICKER = [
  { label: 'Muscle groups', kind: 'page' as const },
  { label: 'How muscle grows', kind: 'card' as const },
  { label: 'Muscle cramps', kind: 'card' as const },
]

/** c10-15, c10-16, c10-17 and c10-18, one span: Edit card, `[[` and "mus"; the list, the card row; the pill; click it, Linked mentions. */
function ByHand(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const at = (clip: string) => id === clip
  const editAt = cue(b, 0, 0.2)
  const editing = (at('c10-15') && b.progress >= editAt + 0.03) || at('c10-16') || at('c10-17')
  const brackets = at('c10-15') ? since(b, cue(b, 1, 0.46), 0.25) : 1
  const letters = at('c10-15') ? since(b, cue(b, 2, 0.7), 0.6) : 1
  const list = at('c10-16') ? showFor(since(b, cue(b, 0, 0.07) - 0.04, 0.3), since(b, cue(b, 2, 0.7) + 0.04, 0.3)) : 0
  const rowActive = at('c10-16') ? since(b, cue(b, 1, 0.5), 0.4) : 0
  const raw = at('c10-16') && b.progress >= cue(b, 2, 0.7) + 0.04
  const pill = at('c10-17') ? since(b, cue(b, 0, 0.21) - 0.06, 0.4) : at('c10-18') ? 1 : 0
  const opened = at('c10-18') ? since(b, cue(b, 1, 0.27), 0.6) : 0
  const mentions = at('c10-18') ? since(b, cue(b, 2, 0.55), 0.6) : 0
  const pointer = at('c10-15')
    ? { from: [86, 86] as const, to: [76, 14] as const, move: between(b, 0.02, editAt - 0.02), click: since(b, editAt - 0.02, 0.4), show: 1 - since(b, editAt + 0.1, 0.4) }
    : at('c10-16')
    ? { from: [70, 80] as const, to: [52, 62] as const, move: between(b, cue(b, 1, 0.5) - 0.15, cue(b, 1, 0.5) + 0.05), click: since(b, cue(b, 2, 0.7), 0.4), show: 1 }
    : at('c10-18')
    ? { from: [60, 80] as const, to: [40, 60] as const, move: between(b, 0, cue(b, 0, 0.07)), click: since(b, cue(b, 0, 0.07), 0.4), show: 1 - since(b, cue(b, 1, 0.27), 0.4) }
    : { from: [0, 0] as const, to: [0, 0] as const, move: 0, show: 0 }
  const typed = `${typedText(b, '[[', brackets)}${brackets >= 1 ? typedText(b, 'mus', letters) : ''}`
  return (
    <Stage beat={b} label={at('c10-15') ? 'Edit the card; type two square brackets and a few letters' : at('c10-16') ? 'A list shows what matches: click the row with the card icon' : at('c10-17') ? "The link becomes a pill: the other card's title, its ID small beside it" : 'Click the pill: that card opens; under it, Linked mentions'}>
      <Layer>
        <AppWindow sidebar={<SidebarPreview inbox={4} rows={[{ name: 'Course Cards', kind: 'folder', open: true }, { name: 'Protein', kind: 'card', depth: 1, active: opened < 0.5 }, { name: 'How muscle grows', kind: 'card', depth: 1, active: opened >= 0.5 }]} />} label="The app: a card, in Edit card">
          <div className="kit-app__tabbar">
            <span className="kit-app__tabname">{opened >= 0.5 ? MUSCLE.title : PROTEIN_BRANCH.title}</span>
          </div>
          <div className="kit-app__tab later-byhand">
            {opened < 0.5 &&
              (editing ? (
                <EditCard id={PROTEIN_BRANCH.id} title={PROTEIN_BRANCH.title} keys={0} style={{ opacity: 1 - opened * 2 }}>
                    <p>
                      Your body builds and repairs itself with <span className="card__cloze">protein</span>.
                    </p>
                    <div className="card__side-break" />
                    <p>
                      <b>CONNECTIONS</b>
                      <br />
                      <CardPill title={UMBRELLA.title} id={UMBRELLA.id} /> <i className="later-reason">its umbrella</i>
                      <br />
                      {pill > 0 ? (
                        <span style={{ opacity: clamp(pill * 2) }}>
                          <CardPill title={MUSCLE.title} id={MUSCLE.id} glow={showFor(since(b, cue(b, 0, 0.21), 0.4), since(b, 0.9, 0.3))} part={{ title: showFor(since(b, cue(b, 1, 0.41), 0.3), since(b, cue(b, 2, 0.66), 0.3)), id: since(b, cue(b, 2, 0.66), 0.3) }} />
                        </span>
                      ) : raw || (at('c10-17') && pill <= 0) ? (
                        <span className="later-raw">[[{MUSCLE.id}]]</span>
                      ) : (
                        <span className="later-raw">{typed}</span>
                      )}
                      <Caret />
                    </p>
                    <LinkPicker beat={b} p={list} rows={PICKER.map((r) => ({ ...r, active: r.kind === 'card' && r.label === MUSCLE.title ? rowActive : 0 }))} />
                </EditCard>
              ) : (
                <div style={{ opacity: at('c10-18') ? 1 - opened : 1 }}>
                  {at('c10-18') ? (
                    <div className="card kit-editcard">
                      <div className="card__head">
                        <span className="card__id">{PROTEIN_BRANCH.id}</span>
                        <span className="card__edit">Edit card</span>
                        <span className="card__more">⋯</span>
                      </div>
                      <div className="kit-editcard__text">
                        <p>
                          <b>CONNECTIONS</b>
                          <br />
                          <CardPill title={UMBRELLA.title} id={UMBRELLA.id} /> <i className="later-reason">its umbrella</i>
                          <br />
                          <CardPill title={MUSCLE.title} id={MUSCLE.id} glow={since(b, 0, 0.3) * (1 - opened)} />
                        </p>
                      </div>
                    </div>
                  ) : (
                    <CardView beat={b} title={PROTEIN_BRANCH.title} id={PROTEIN_BRANCH.id} text={PROTEIN_BRANCH.early} links={PROTEIN_BRANCH.links} chrome="block" shown={1} />
                  )}
                </div>
              ))}
            {opened > 0 && (
              <div className="later-window" style={rise(b, opened, 12)}>
                <CardView beat={b} title={MUSCLE.title} id={MUSCLE.id} text={MUSCLE.text} chrome="block" shown={1} />
                <LinkedMentions beat={b} count={1} rows={[{ label: 'Protein', kind: 'card', p: mentions }]} p={mentions} glow={since(b, cue(b, 2, 0.55) + 0.05, 0.5)} />
              </div>
            )}
          </div>
          <Pointer beat={b} from={pointer.from} to={pointer.to} move={pointer.move} click={pointer.click} show={pointer.show} />
        </AppWindow>
      </Layer>
    </Stage>
  )
}

/** c10-25: a card with many links coming in, "Linked mentions (12)": it glows as a hub, like chapter 2's. */
function Hubs(props: SceneProps) {
  const b = useBeat(props)
  const many = cue(b, 0, 0.23)
  const hubs = cue(b, 1, 0.55)
  const labels = ['Sleep debt', 'Recovery', 'Eggs', 'How muscle grows', 'Calories', 'Rest days']
  const nodes: WebNode[] = [{ id: 'hub', x: 300, y: 170, label: 'Protein', kind: 'hub' }]
  const edges: WebEdge[] = []
  const show: Record<string, number> = { hub: since(b, 0, 0.5) }
  for (let i = 0; i < 12; i++) {
    const a = (-90 + i * 30) * (Math.PI / 180)
    const labelled = i % 2 === 0
    const node: WebNode = { id: `i${i}`, x: 300 + Math.cos(a) * (labelled ? 230 : 190), y: 170 + Math.sin(a) * (labelled ? 135 : 112), label: labelled ? labels[i / 2] : undefined, kind: labelled ? 'card' : 'dot' }
    nodes.push(node)
    edges.push({ from: node.id, to: 'hub', kind: 'link' })
    const p = since(b, many - 0.12 + i * 0.03, 0.5)
    show[node.id] = p
    show[`${node.id}>hub`] = since(b, many - 0.08 + i * 0.03, 0.6)
  }
  const count = b.reduced ? (b.progress >= many ? 12 : 1) : Math.round(12 * between(b, many - 0.08, many + 0.28))
  return (
    <Stage beat={b} label="Some cards end up with many links pointing to them: your hubs">
      <Layer>
        <Web beat={b} nodes={nodes} edges={edges} show={show} lit={{ hub: since(b, hubs, 0.8) }} />
      </Layer>
      <Layer place="bottom">
        <span className="kit-chip" style={pop(b, since(b, many, 0.5))}>
          Linked mentions ({Math.max(1, count)})
        </span>
      </Layer>
    </Stage>
  )
}

/** c10-19: in Edit card, the caret after the pill; Backspace; the pill goes, like a word. */
function RemoveLink(props: SceneProps) {
  const b = useBeat(props)
  const edit = cue(b, 0, 0.26)
  const del = cue(b, 1, 0.53)
  const word = cue(b, 2, 0.7)
  const gone = since(b, del + 0.03, 0.4)
  return (
    <Stage beat={b} label="To remove a link, edit the card and delete the pill like a word">
      <Layer>
        <EditCard id={PROTEIN_BRANCH.id} title={PROTEIN_BRANCH.title} done={since(b, edit, 0.3)} keys={0} className="later-remove" style={rise(b, since(b, 0, 0.6))}>
            <p>
              <b>CONNECTIONS</b>
              <br />
              <CardPill title={UMBRELLA.title} id={UMBRELLA.id} /> <i className="later-reason">its umbrella</i>
              <br />
              {gone < 1 && (
                <span style={{ opacity: 1 - gone, display: 'inline-block', transform: b.reduced ? undefined : `scale(${lerp(1, 0.6, gone).toFixed(3)})`, transformOrigin: 'right center' }}>
                  <CardPill title="Muscle cramps" id={sampleId('Muscle cramps')} glow={showFor(since(b, del - 0.1, 0.3), gone)} />
                </span>
              )}
              {since(b, edit, 0.3) > 0 && <Caret />}
            </p>
        </EditCard>
        <Keys p={since(b, del - 0.06, 0.4)} items={[{ keys: '⌫', label: 'Backspace' }]} />
        <span className="kit-chip" style={pop(b, since(b, word, 0.5))}>
          Like a word
        </span>
      </Layer>
    </Stage>
  )
}

/** c10-20: a loose pile of cards; lines join them one by one, into one connected web: a base, not a pile. */
const PILE = scatterWeb(16, { seed: 11, links: 2 })
function BaseNotPile(props: SceneProps) {
  const b = useBeat(props)
  const links = cue(b, 0, 0.52)
  const base = cue(b, 1, 0.72)
  const pile = cue(b, 2, 0.83)
  const show: Record<string, number> = {}
  PILE.nodes.forEach((n, i) => (show[n.id] = since(b, i * 0.02, 0.5)))
  PILE.edges.forEach((e, i) => (show[`${e.from}>${e.to}`] = since(b, links - 0.1 + (i / PILE.edges.length) * 0.32, 0.5)))
  const nodes = PILE.nodes.map((n) => ({ ...n, kind: 'card' as const, label: undefined }))
  return (
    <Stage beat={b} label="Your card base is your knowledge base. Links make it a base, not a pile">
      <Layer place="top">
        <Words size="kicker" style={rise(b, since(b, 0.05, 0.5))}>
          Your card base is your knowledge base
        </Words>
      </Layer>
      <Layer>
        <Web beat={b} nodes={nodes} edges={PILE.edges.map((e) => ({ ...e, kind: 'link' }))} show={show} source="n0" spread={between(b, base, base + 0.18)} />
      </Layer>
      <Layer place="bottom">
        <Words size="title" tone="accent" style={rise(b, since(b, pile, 0.5))}>
          A base, not a pile.
        </Words>
      </Layer>
    </Stage>
  )
}

/** c10-21: "Try it in the app", and Next chapter. */
function TryLinks(props: SceneProps) {
  const b = useBeat(props)
  const glow = showFor(since(b, cue(b, 0, 0.59), 0.4), since(b, 0.95, 0.4))
  return (
    <Stage beat={b} label="Try it in the app: link two of your Course Cards">
      <Layer>
        <Web beat={b} nodes={PAIR.nodes.map((n, i) => ({ ...n, label: i === 0 ? 'Your first card' : 'Another card' }))} edges={PAIR.edges} show={{ a: since(b, 0, 0.5), b: since(b, 0.05, 0.5), 'a>b': since(b, 0.2, 0.9) }} />
        <div className="kit-try" style={pop(b, since(b, 0.3, 0.6), 0.85)}>
          <span className="course__btn course__btn--try" style={{ boxShadow: `0 0 0 ${(4 * glow).toFixed(2)}px var(--accent-soft)` }}>
            Try it in the app
          </span>
          <span className="course__btn">Next chapter</span>
        </div>
      </Layer>
    </Stage>
  )
}

const SPROUTS: readonly PlantSpec[] = [
  { x: 190, h: 120, branches: [{ at: 0.5, dir: -1, len: 40, up: 22 }, { at: 0.75, dir: 1, len: 36, up: 16 }] },
  { x: 410, h: 140, branches: [{ at: 0.45, dir: 1, len: 44, up: 20 }, { at: 0.7, dir: -1, len: 38, up: 18 }] },
]

/** c10-22: the two cards and their link; not where it goes; then a small garden starts to grow. */
function NotWhere(props: SceneProps) {
  const b = useBeat(props)
  const notWhere = cue(b, 0, 0.31)
  const next = cue(b, 1, 0.6)
  const out = since(b, next, 0.6)
  return (
    <Stage beat={b} label="Ask what a card connects to, not where it goes. Next: how to keep your tree alive">
      <Layer style={{ opacity: 1 - out }}>
        <svg className="kit-folders later-ghost" viewBox="0 0 600 340" aria-hidden="true" style={{ opacity: showFor(since(b, 0.05, 0.4), since(b, notWhere, 0.6)) * 0.5 }}>
          <Folder beat={b} x={220} y={110} label="?" />
        </svg>
      </Layer>
      <Layer style={{ opacity: 1 - out }}>
        <Web beat={b} nodes={PAIR.nodes} edges={PAIR.edges} show={{ a: 1, b: 1, 'a>b': since(b, 0, 0.8) }} lit={{ a: since(b, 0.1, 0.5), b: since(b, 0.16, 0.5) }} />
      </Layer>
      <Layer style={{ opacity: out }}>
        <Garden beat={b} plants={SPROUTS} grow={[since(b, next + 0.04, 1.4), since(b, next + 0.1, 1.4)]} ground={since(b, next, 0.8)} links={[{ a: [0, 1], b: [1, 1], p: since(b, next + 0.25, 0.8) }]} />
      </Layer>
    </Stage>
  )
}

export const LINKS_SCENES: ChapterScenes = {
  chapter: 'links',
  entries: [
    { clips: ['c10-01'], scene: Connect },
    { clips: ['c10-02', 'c10-03', 'c10-04'], scene: OnePlace },
    { clips: ['c10-05'], scene: LinkHolds },
    { clips: ['c10-06', 'c10-07', 'c10-08'], scene: MindWeb },
    { clips: ['c10-23', 'c10-09', 'c10-10', 'c10-11', 'c10-12'], scene: AcrossTrees },
    { clips: ['c10-13'], scene: TwoQuestions },
    { clips: ['c10-14'], scene: AnyTarget },
    { clips: ['c10-26', 'c10-27', 'c10-24'], scene: AgentLinks },
    { clips: ['c10-15', 'c10-16', 'c10-17', 'c10-18'], scene: ByHand },
    { clips: ['c10-25'], scene: Hubs },
    { clips: ['c10-19'], scene: RemoveLink },
    { clips: ['c10-20'], scene: BaseNotPile },
    { clips: ['c10-21'], scene: TryLinks },
    { clips: ['c10-22'], scene: NotWhere },
  ],
}
