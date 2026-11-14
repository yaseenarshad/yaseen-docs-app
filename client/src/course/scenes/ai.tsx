/**
 * CHAPTER 8, "Make cards with your AI, without vibe writing" (YAZ-5121): the power tool and its danger. Cards are plain
 * Markdown files (the real file, from the app's own writer); an agent reads and writes files; the app has no AI and
 * sends nothing. THE WARNING: the screen goes quiet for "Do not vibe write your cards."; the flood of grey cards; the
 * Inbox goes dark; two paths; Ryan Holiday's line. Then the hands-on step with the person's own agent (YAZ-5327: it
 * drafts the cards in the chat; the person reads each one and says yes; only approved cards are saved): the real
 * `AgentStepPanel` (YAZ-5124) with the parts of each clip, and `done()` on the event each clip waits for (`text`,
 * `copied`, `arrived`; and `read`, `made` on the clips that show them). `text` comes from a paste or "Use the example",
 * never from typing (YAZ-5270). The scene writes no file: the host does.
 */
import { useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { cardFileContent, cardFileName } from '@shared/cardFileFormat'
import type { SceneProps } from '../scene'
import { AgentStepPanel, type AgentStepEvent, type AgentStepPart } from '../AgentStepPanel'
import { NO_CARDS_YET } from '../prompt'
import { EXAMPLE_CARDS } from '../courseCards'
import { CARD_SKILL_MENU } from '../../sidebar/menuSections'
import { AppWindow, CardView, cardSkillMenuItems, Layer, MenuPreview, MiniCard, Pointer, SidebarPreview, Stage, Tally, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, useBeat, type Beat, AgentTerminal, type TermLine, Head, QuoteCard, Habits } from './kit'
import { QUOTES } from './papers'
import { sampleId } from './cards'
import type { ChapterScenes } from './registry'
import './ai.css'

const SLEEP_TITLE = 'Sleep debt'
const SLEEP_TEXT = 'Each short night adds to a {{sleep debt}}, and one long lie-in does not pay it back.\n---\nSleep you miss adds up over the week.'
/** The real card file, as the app writes it (`cardFileContent`, the writer of New card). */
const SLEEP_FILE = cardFileContent(SLEEP_TITLE, SLEEP_TEXT, { parts: [{ kind: 'id', id: sampleId(SLEEP_TITLE) }] })
const SLEEP_FILE_NAME = cardFileName(SLEEP_TITLE, sampleId(SLEEP_TITLE))

/** The app beside the agent: a small window with the Inbox and Course Cards. */
const appSidebar = (inbox: number, extra: { glow?: number } = {}) => <SidebarPreview inbox={inbox} rows={[{ name: 'Course Cards', kind: 'folder', open: true, glow: extra.glow }, { name: SLEEP_TITLE, kind: 'card', depth: 1 }, { name: 'Projects', kind: 'folder' }]} />

/** c8-01: the agent's window next to the app; it makes cards fast; that is the danger. */
function ToolAndApp(props: SceneProps) {
  const b = useBeat(props)
  const tool = cue(b, 1, 0.468)
  const danger = cue(b, 2, 0.853)
  const burst = between(b, tool, danger)
  const made = Math.round(lerp(0, 40, b.reduced ? (burst > 0 ? 1 : 0) : burst))
  const lines: TermLine[] = [{ text: 'Make cards from this chapter.', p: since(b, tool - 0.1, 0.8), kind: 'in' }]
  for (let k = Math.max(1, made - 3); k <= made; k++) lines.push({ text: `Wrote card-${String(k).padStart(2, '0')}.md`, p: 1, kind: 'file' })
  const warn = since(b, danger, 0.6)
  return (
    <Stage beat={b} label="Your agent next to the app: a tool that makes cards fast, and why that is a danger">
      <Layer>
        <div className="kit-row ai-pair">
          <div style={rise(b, since(b, 0, 0.7), 14)}>
            <AgentTerminal beat={b} lines={lines} className="ai-term" style={{ boxShadow: warn > 0 ? `0 0 0 2px color-mix(in srgb, var(--danger) ${(warn * 80).toFixed(0)}%, transparent)` : undefined }} />
          </div>
          <div style={rise(b, since(b, 0.08, 0.7), 14)}>
            <AppWindow sidebar={appSidebar(made)} label="The app, with the Inbox and Course Cards" />
          </div>
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, cue(b, 0, 0.219), 0.5))}>
            A good card starts with chewing
          </span>
          <span className="kit-chip ai-chip--bad" style={pop(b, warn)}>
            ⚠ Fast is the danger
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** The marks of a card file: the properties' fences, the card's fence, the side line, the hidden words' braces. */
const MARK = /(\{\{|\}\}|^---$|^```card$|^```$|<!-- card: [A-Z0-9]+ -->)/m

/** c8-02: a card file opens as plain text; the word Markdown; the few light marks light up. */
function PlainFile(props: SceneProps) {
  const b = useBeat(props)
  const markdown = cue(b, 0, 0.465)
  const marks = since(b, cue(b, 1, 0.85) - 0.06, 0.6)
  const open = since(b, 0.15, 0.7)
  const lines = SLEEP_FILE.replace(/\n$/, '').split('\n')
  return (
    <Stage beat={b} label="Each card is a plain Markdown file: plain text, with a few light marks">
      <Layer>
        <div className="ai-file" style={rise(b, open, 14)}>
          <div className="ai-file__head">
            <span className="ai-file__icon" aria-hidden="true" />
            {SLEEP_FILE_NAME}
          </div>
          <pre className="ai-file__text">
            {lines.map((line, i) => (
              <span key={i} className="ai-file__line" style={{ opacity: clamp(open * lines.length * 1.5 - i) }}>
                {line.split(MARK).map((part, k) =>
                  MARK.test(part) ? (
                    <mark key={k} style={{ backgroundColor: marks > 0 ? `color-mix(in srgb, var(--accent) ${(marks * 30).toFixed(0)}%, transparent)` : 'transparent', color: marks > 0 ? 'var(--accent)' : undefined }}>
                      {part}
                    </mark>
                  ) : (
                    <span key={k}>{part}</span>
                  ),
                )}
                {'\n'}
              </span>
            ))}
          </pre>
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, markdown, 0.5))}>
            Markdown: plain text
          </span>
          <span className="kit-chip" style={pop(b, marks)}>
            A few light marks
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c8-03: the agent's window reads a card file and writes one; any agent that can do that works. */
function AgentReads(props: SceneProps) {
  const b = useBeat(props)
  const read = cue(b, 0, 0.308)
  const write = cue(b, 1, 0.372)
  const any = cue(b, 2, 0.659)
  const others = since(b, any - 0.02, 0.7)
  return (
    <Stage beat={b} label="An agent is an AI tool that can read and write files on your computer; any agent like that works">
      <Layer>
        <div className="ai-stack">
          {[2, 1].map((k) => (
            <div key={k} className="ai-stack__ghost" style={{ opacity: clamp(others * 2) * (0.5 - k * 0.12), transform: b.reduced ? `translate(${k * 14}px, ${-k * 14}px)` : `translate(${(k * 14 * moved(b, others, ease.out)).toFixed(1)}px, ${(-k * 14 * moved(b, others, ease.out)).toFixed(1)}px)` }}>
              <AgentTerminal beat={b} lines={[]} caret={false} title="an agent" />
            </div>
          ))}
          <div className="ai-stack__front" style={rise(b, since(b, 0, 0.6), 14)}>
            <AgentTerminal
              beat={b}
              lines={[
                { text: 'Read my card on sleep, and add an example.', p: since(b, 0.02, 1), kind: 'in' },
                { text: `Read ${SLEEP_FILE_NAME}`, p: since(b, read, 0.5), kind: 'file' },
                { text: `Wrote ${SLEEP_FILE_NAME}`, p: since(b, write + 0.05, 0.5), kind: 'file' },
              ]}
            />
          </div>
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, read, 0.5))}>
            Reads files
          </span>
          <span className="kit-chip" style={pop(b, since(b, write, 0.5))}>
            Writes files
          </span>
          <span className="kit-chip" style={pop(b, others)}>
            Any agent like that
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c8-04: the app, with no AI inside; a cloud with a line through it: nothing is sent; your own agent beside it. */
function NoCloud(props: SceneProps) {
  const b = useBeat(props)
  const noAi = cue(b, 0, 0.123)
  const sends = cue(b, 1, 0.395)
  const own = cue(b, 2, 0.679)
  const cross = since(b, sends + 0.04, 0.6)
  const agent = since(b, own - 0.02, 0.7)
  return (
    <Stage beat={b} label="The app has no AI inside and sends nothing anywhere; you use your own agent">
      <Layer>
        <div className="kit-row ai-pair">
          <div className="ai-nocloud" style={rise(b, since(b, 0, 0.6), 12)}>
            <svg className="ai-cloud" viewBox="0 0 120 80" aria-hidden="true" style={{ opacity: since(b, sends - 0.05, 0.5) }}>
              <path className="ai-cloud__shape" d="M30 66 C12 66 8 46 22 40 C20 24 40 16 50 26 C56 10 82 10 86 30 C102 28 110 44 100 54 C104 64 94 66 88 66 Z" />
              <line className="ai-cloud__cross" x1={14} y1={74} x2={lerp(14, 108, moved(b, cross))} y2={lerp(74, 8, moved(b, cross))} />
            </svg>
            <span className="ai-arrow ai-arrow--up" style={{ opacity: since(b, sends - 0.05, 0.5) * (1 - cross * 0.6) }} aria-hidden="true">
              ↑
            </span>
            <AppWindow sidebar={appSidebar(4)} label="The app" />
            <span className="kit-chip" style={pop(b, since(b, noAi, 0.5))}>
              No AI inside
            </span>
          </div>
          <div className="ai-own" style={rise(b, agent, 14)}>
            <AgentTerminal beat={b} lines={[{ text: 'Your own agent, on your computer.', p: since(b, own, 1), kind: 'out' }]} className="ai-term" title="your agent" />
            <span className="kit-chip" style={pop(b, since(b, own + 0.05, 0.5))}>
              Yours
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const WARNING = ['Do', 'not', 'vibe', 'write', 'your', 'cards.']
const WARNING_AT = [0.377, 0.428, 0.51, 0.622, 0.673, 0.846]

/** c8-05: the screen goes quiet; one line, each word on its word: "Do not vibe write your cards." */
function Warning(props: SceneProps) {
  const b = useBeat(props)
  const under = since(b, cue(b, 5, 0.846) + 0.06, 0.8)
  return (
    <Stage beat={b} label="Do not vibe write your cards." className="ai-quiet">
      <Layer>
        <Words size="kicker" style={{ opacity: showFor(since(b, 0.08, 0.8), since(b, 0.32, 0.6)) }}>
          The warning
        </Words>
        <p className="ai-warning">
          {WARNING.map((w, i) => {
            const p = since(b, cue(b, i, WARNING_AT[i]) - 0.02, 0.35)
            const vibe = i === 2 || i === 3
            return (
              <span key={w} className={vibe ? 'ai-warning__vibe' : undefined} style={{ opacity: clamp(p * 1.4), filter: b.reduced ? undefined : `blur(${((1 - clamp(p)) * 6).toFixed(2)}px)` }}>
                {w}
                {vibe && <i style={{ transform: `scaleX(${moved(b, under, ease.out).toFixed(3)})` }} />}
              </span>
            )
          })}
        </p>
      </Layer>
    </Stage>
  )
}

/** A wall of small cards, popping in fast: what an agent pours out. Grey: nobody read them. */
function Pour({ beat, p, count = 24 }: { beat: Beat; p: number; count?: number }) {
  return (
    <div className="ai-pour" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const q = clamp(p * count - i)
        return <MiniCard key={i} title={`Card ${i + 1}`} style={{ ...pop(beat, q, 0.5), filter: 'grayscale(1)', opacity: clamp(q * 2) * 0.85 }} />
      })}
    </div>
  )
}

/** c8-06 and c8-07, one span: an agent pours out cards nobody reads; the card base floods with grey; the head fills with static; the Inbox goes dark. */
function Flood(props: SceneProps) {
  const b = useBeat(props)
  if (props.clip.id === 'c8-06') {
    const pour = since(b, cue(b, 0, 0.475) - 0.1, 2.4)
    const never = since(b, cue(b, 1, 0.709), 0.6)
    const n = b.reduced ? (pour > 0 ? 24 : 0) : Math.round(24 * pour)
    return (
      <Stage beat={b} label="Vibe writing: an AI pours out cards you never thought through, and nobody reads them">
        <Layer>
          <div className="kit-row ai-pair">
            <AgentTerminal beat={b} className="ai-term" lines={[{ text: 'Make cards from everything I saved.', p: since(b, 0, 1), kind: 'in' }, { text: `Wrote ${n} cards…`, p: pour > 0 ? 1 : 0, kind: 'warn' }]} />
            <Pour beat={b} p={pour} />
          </div>
          <span className="kit-chip ai-chip--bad" style={pop(b, never)}>
            Read: 0 of {n}
          </span>
        </Layer>
      </Stage>
    )
  }
  const ruin = cue(b, 0, 0.213)
  const knowledge = cue(b, 1, 0.516)
  const worthless = cue(b, 2, 0.853)
  const flood = between(b, ruin - 0.05, worthless)
  const dark = since(b, worthless - 0.03, 0.9)
  const due = Math.round(lerp(12, 1950, b.reduced ? (flood > 0 ? 1 : 0) : ease.inOut(flood)))
  return (
    <Stage beat={b} label="The card base floods with grey cards; the knowledge base fills with static; the Inbox goes dark">
      <Layer place="fill" style={{ padding: 0, opacity: 0.55 }}>
        <div className="ai-flood">
          <Tally beat={b} count={360} fill={flood} columns={30} />
        </div>
      </Layer>
      <Layer>
        <div className="kit-row ai-pair">
          <div className="ai-darken" style={rise(b, since(b, knowledge - 0.05, 0.6), 12)}>
            <Head beat={b} noise={between(b, knowledge, worthless)} dots={Array.from({ length: 10 }, (_, i) => ({ x: 0.2 + (i % 4) * 0.2, y: 0.25 + Math.floor(i / 4) * 0.25, p: 1, tone: 'accent' as const }))} />
            <Words size="label">Your knowledge base</Words>
          </div>
          <div className="ai-darken">
            <div style={{ opacity: lerp(1, 0.4, dark), filter: dark > 0 ? `grayscale(${dark.toFixed(2)}) brightness(${lerp(1, 0.55, dark).toFixed(2)})` : undefined }}>
              <AppWindow sidebar={<SidebarPreview inbox={due} rows={[{ name: 'Course Cards', kind: 'folder', open: true }, { name: 'Card 1912', kind: 'card', depth: 1 }, { name: 'Card 1913', kind: 'card', depth: 1 }]} />} label="The Inbox, with almost two thousand cards due" />
            </div>
            <Words size="label" tone="danger" style={rise(b, dark)}>
              Worthless
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c8-08: two paths from one fork: "Vibe write" leads down; "Chew, then create" leads up, and compounds. */
function TwoPaths(props: SceneProps) {
  const b = useBeat(props)
  const fail = since(b, cue(b, 0, 0.233) - 0.04, 1.2)
  const up = since(b, cue(b, 1, 0.775) - 0.12, 1.4)
  return (
    <Stage beat={b} label="Two paths: vibe write and the system fails; chew, then create, and what you know compounds">
      <Layer>
        <svg className="ai-paths" viewBox="0 0 400 240" role="img" aria-label="Vibe write leads down; chew, then create leads up">
          <circle className="ai-paths__fork" cx={40} cy={120} r={7} opacity={since(b, 0, 0.5)} />
          <path className="ai-paths__down" d="M 40 120 C 140 120, 200 150, 360 220" pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - moved(b, fail, ease.out)).toFixed(4)} />
          <path className="ai-paths__up" d="M 40 120 C 160 120, 260 110, 360 20" pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - moved(b, up, ease.inOut)).toFixed(4)} />
          <text className="kit-svg-label ai-paths__label--down" x={360} y={240} textAnchor="end" opacity={clamp(fail * 2)}>
            Vibe write
          </text>
          <text className="kit-svg-label kit-svg-label--accent" x={330} y={14} textAnchor="end" opacity={clamp(up * 2)}>
            Chew, then create
          </text>
        </svg>
      </Layer>
    </Stage>
  )
}

/** c8-09: Ryan Holiday's line, in quotes, swept as the voice says it; then a hand writes slowly. */
function Holiday(props: SceneProps) {
  const b = useBeat(props)
  const q = QUOTES.holiday
  const say = cue(b, 0, 0.32)
  const thinking = cue(b, 1, 0.691)
  const pen = since(b, thinking - 0.03, 1.6)
  return (
    <Stage beat={b} label={`${q.by}: “${q.line}” The thinking is where you learn`}>
      <Layer>
        <QuoteCard beat={b} text={q.line} by={q.by} where={q.where} p={since(b, 0, 0.8)} sweep={since(b, say, 1.4)} />
        <svg className="ai-hand" viewBox="0 0 200 40" aria-hidden="true" style={{ opacity: clamp(pen * 3) }}>
          <path className="ai-hand__ink" d="M 6 26 C 18 6, 26 34, 38 18 S 56 8, 64 24 S 84 30, 92 14 S 112 10, 120 26 S 140 30, 150 16 S 170 12, 180 24" pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - moved(b, pen, ease.linear)).toFixed(4)} />
        </svg>
      </Layer>
    </Stage>
  )
}

/** c8-10: the right way: ideas you have chewed on go in; the agent drafts the cards in the chat; you read each one there. */
function RightWay(props: SceneProps) {
  const b = useBeat(props)
  const bring = cue(b, 0, 0.168)
  const drafts = cue(b, 1, 0.543)
  const read = cue(b, 2, 0.819)
  const station = (p: number): CSSProperties => rise(b, p, 12)
  return (
    <Stage beat={b} label="The right way: bring ideas you have chewed on; your agent drafts the cards in the chat; you read each one there">
      <Layer>
        <div className="ai-flow">
          <div className="ai-flow__station" style={station(since(b, bring, 0.6))}>
            <span className="ai-flow__orbs" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <Words size="page">Chewed on by you</Words>
          </div>
          <span className="ai-flow__arrow" style={{ opacity: since(b, drafts - 0.06, 0.5) }} aria-hidden="true">
            →
          </span>
          <div className="ai-flow__station" style={station(since(b, drafts - 0.04, 0.6))}>
            <AgentTerminal beat={b} className="ai-term ai-term--mini" caret={false} title="the chat" lines={[{ text: 'Draft 1 of 3…', p: since(b, drafts, 0.8), kind: 'out' }]} />
            <Words size="page">Drafted in the chat</Words>
          </div>
          <span className="ai-flow__arrow" style={{ opacity: since(b, read - 0.1, 0.5) }} aria-hidden="true">
            →
          </span>
          <div className="ai-flow__station" style={station(since(b, read - 0.08, 0.6))}>
            <span className="ai-flow__cards">
              {[0, 1, 2].map((k) => (
                <span key={k} className="ai-flow__card">
                  <span className="ai-flow__tick" style={pop(b, since(b, read + k * 0.04, 0.4))}>
                    ✓
                  </span>
                </span>
              ))}
            </span>
            <Words size="page">Read by you, there</Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** The event each clip of the AI step waits for (or, for c8-15 and c8-16, shows), and the parts it shows. */
const STEP_EVENT: Readonly<Record<string, AgentStepEvent>> = { 'c8-11': 'text', 'c8-12': 'copied', 'c8-13': 'arrived', 'c8-15': 'read', 'c8-16': 'made' }
const STEP_PARTS: Readonly<Record<string, readonly AgentStepPart[]>> = {
  'c8-11': ['text'],
  'c8-12': ['prompt'],
  'c8-13': ['cards'],
  'c8-20': ['cards'],
  'c8-14': ['cards'],
  'c8-15': ['cards'],
  'c8-16': ['skip'],
}
/**
 * The parts a clip shows now (YAZ-5270): until the prompt is copied, the clips after `c8-11` that use the agent show the
 * text box and the prompt first, so the person can still change the text (Next moves on with or without it).
 */
function partsOf(id: string, copied: boolean): readonly AgentStepPart[] {
  const parts = STEP_PARTS[id] ?? ['text']
  if (copied || id === 'c8-11' || id === 'c8-16') return parts
  return [...new Set<AgentStepPart>(['text', 'prompt', ...parts])]
}

/** The example's first card (`EXAMPLE_CARDS`): what the agent drafts in the chat. */
const BREAD = EXAMPLE_CARDS[0].title
/** What chewing is in the AI step (c8-15). */
const CHEWING = ['Read the drafts', 'Think about them', 'Say yes'] as const

const STEP_KICKER: Readonly<Record<string, string>> = {
  'c8-11': 'Step 1 · Something you have chewed on',
  'c8-12': 'Step 2 · Copy the prompt',
  'c8-13': 'Step 3 · Read the drafts in the chat',
  'c8-20': 'Step 3 · Only what you approve is saved',
  'c8-14': 'Step 3 · Waiting for your agent',
  'c8-15': 'Step 4 · That is chewing',
  'c8-16': 'No agent?',
}

/**
 * c8-11 to c8-16, one span: the hands-on step with the person's own agent, in the real `AgentStepPanel`. The panel is
 * mounted again for each clip (its key), so a step done before tells its event at once and the clip goes on; each clip
 * calls `done()` once each time it is entered, on its own event only. The host writes; the scene writes nothing.
 */
function AgentStep(props: SceneProps) {
  const b = useBeat(props)
  const { clip, done, host } = props
  const id = clip.id
  const doneFor = useRef(new Set<string>())
  const entered = useRef<string | null>(null)
  if (entered.current !== id) {
    // A clip entered again (Back, then Next) gets its own `done`. Reset during render, before the panel's mount tells.
    entered.current = id
    doneFor.current.delete(id)
  }
  const onStep = (event: AgentStepEvent): void => {
    if (STEP_EVENT[id] !== event || doneFor.current.has(id)) return
    doneFor.current.add(id)
    done()
  }
  const state = useSyncExternalStore(host.agentStep.subscribe, host.agentStep.state)
  const quietDemo = id === 'c8-14' && !state.quiet && state.cards.length === 0
  return (
    <Stage beat={b} label={STEP_KICKER[id] ?? 'Make cards with your agent'}>
      <Layer className="ai-step-layer">
        <div className="ai-step" style={id === 'c8-11' ? rise(b, since(b, 0, 0.5), 10) : undefined}>
          <Words size="kicker">{STEP_KICKER[id]}</Words>
          {id === 'c8-12' && (
            <div className="kit-tags">
              <span className="kit-chip" style={pop(b, since(b, cue(b, 1, 0.481) - 0.06, 0.5))}>
                Reads the card skill
              </span>
              <span className="kit-chip" style={pop(b, since(b, 0.675, 0.5))}>
                3 cards
              </span>
              <span className="kit-chip" style={pop(b, since(b, cue(b, 2, 0.818), 0.5))}>
                Drafts in the chat
              </span>
            </div>
          )}
          {id === 'c8-13' && (
            <AgentTerminal
              beat={b}
              className="ai-term ai-term--wide"
              title="your agent's chat"
              lines={[
                { text: 'Paste the prompt here', p: since(b, cue(b, 0, 0.149) - 0.05, 0.8), kind: 'in' },
                { text: `Draft 1 · ${BREAD}: “Bread rises because yeast eats the sugars…”`, p: since(b, cue(b, 1, 0.401), 0.6), kind: 'out' },
                { text: 'Make the clue a little shorter.', p: since(b, 0.66, 0.6), kind: 'in' },
                { text: 'Draft 1, changed. Save it?', p: since(b, 0.76, 0.5), kind: 'out' },
                { text: 'Yes, save it', p: since(b, cue(b, 2, 0.841), 0.5), kind: 'in' },
              ]}
            />
          )}
          {id === 'c8-20' && (
            <>
              <AgentTerminal
                beat={b}
                className="ai-term ai-term--wide"
                title="your agent's chat"
                caret={false}
                lines={[
                  { text: 'Yes, save it', p: 1, kind: 'in' },
                  { text: `Wrote ${BREAD}.md`, p: since(b, cue(b, 0, 0.221), 0.5), kind: 'file' },
                  { text: 'Draft 2 · A slow rise tastes better', p: since(b, cue(b, 0, 0.221) + 0.08, 0.5), kind: 'out' },
                  { text: 'Not this one.', p: since(b, cue(b, 1, 0.392), 0.5), kind: 'in' },
                  { text: 'Draft 2 is not saved.', p: since(b, cue(b, 1, 0.392) + 0.08, 0.5), kind: 'dim' },
                ]}
              />
              <span className="kit-chip" style={pop(b, since(b, cue(b, 2, 0.726) - 0.2, 0.5))}>
                ↓ Saved cards show up here
              </span>
            </>
          )}
          {quietDemo && (
            <div className="ai-minute" style={rise(b, since(b, 0.05, 0.6))}>
              <svg viewBox="-22 -22 44 44" aria-hidden="true">
                <circle className="ai-minute__track" r={18} />
                <circle className="ai-minute__fill" r={18} pathLength={1} strokeDasharray={`${moved(b, between(b, 0.05, cue(b, 0, 0.428)), ease.linear).toFixed(4)} 1`} transform="rotate(-90)" />
              </svg>
              <span>
                <b>1 minute</b>, no card?
                <span className="kit-quiet-line" style={{ display: 'block', textAlign: 'left', opacity: since(b, cue(b, 1, 0.571), 0.5) }}>
                  {NO_CARDS_YET}
                </span>
              </span>
            </div>
          )}
          {id === 'c8-15' && (
            <>
              <Words size="title" tone={since(b, cue(b, 3, 0.86), 0.3) > 0.5 ? undefined : 'accent'} style={pop(b, since(b, cue(b, 0, 0.08), 0.6), 0.8)}>
                Handmade
              </Words>
              <div className="kit-tags">
                {CHEWING.map((part, k) => (
                  <span key={part} className="kit-chip" style={pop(b, since(b, [cue(b, 1, 0.279), 0.45, cue(b, 2, 0.657)][k], 0.4))}>
                    ✓ {part}
                  </span>
                ))}
              </div>
              <Words size="title" tone="accent" style={rise(b, since(b, cue(b, 3, 0.86), 0.5))}>
                That is chewing.
              </Words>
            </>
          )}
          <div className="ai-panel">
            <AgentStepPanel key={id} host={host} parts={partsOf(id, state.copiedAt !== null)} onStep={onStep} onGoOn={props.next} />
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const DRAFT = 'Sleep debt is the cumulative deficit of {{sleep}} accrued over consecutive nights.'
const YOURS = 'Each short night adds to a {{sleep debt}}, and one long lie-in does not pay it back.'

/** c8-17: you read a draft, rewrite a line in your own words, and delete a card you do not want. */
function YouDecide(props: SceneProps) {
  const b = useBeat(props)
  const decide = cue(b, 0, 0.343)
  const keep = cue(b, 1, 0.487)
  const words = cue(b, 2, 0.787)
  const del = since(b, keep, 0.8)
  const rewrite = since(b, words - 0.06, 0.6)
  return (
    <Stage beat={b} label="Your agent drafts fast, but you decide: keep only what you want to recall, in your own words">
      <Layer>
        <div className="kit-row ai-decide">
          <div className="ai-decide__card" style={rise(b, since(b, 0, 0.6), 12)}>
            <span className="kit-chip" style={{ opacity: 1 - rewrite }}>
              Draft by your agent
            </span>
            <CardView beat={b} chrome="block" title={SLEEP_TITLE} text={rewrite > 0.5 ? YOURS : DRAFT} id={sampleId(SLEEP_TITLE)} editing={b.progress >= decide && b.progress < words + 0.1} lit={[showFor(since(b, decide, 0.4), 1) * (rewrite > 0.5 ? 1 : 0.5)]} />
            <span className="kit-chip" style={pop(b, rewrite)}>
              ✓ In your words
            </span>
          </div>
          <div className="ai-decide__card ai-decide__card--gone" style={{ ...rise(b, since(b, 0.05, 0.6), 12), opacity: clamp(since(b, 0.05, 0.6)) * (1 - del * 0.85), transform: b.reduced ? undefined : `translateY(${(moved(b, del) * 40).toFixed(1)}px) rotate(${(moved(b, del) * 8).toFixed(2)}deg)` }}>
            <CardView beat={b} chrome="block" title="Sleep trivia" text="The podcast host’s dog is called {{Biscuit}}." id={sampleId('Sleep trivia')} />
            <span className="kit-chip ai-chip--bad" style={pop(b, del)}>
              ✕ Deleted: not worth recalling
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c8-18: the pointer right-clicks the card skill in the sidebar and chooses "Copy prompt for your agent". */
function RightClick(props: SceneProps) {
  const b = useBeat(props)
  const right = cue(b, 0, 0.272)
  const choose = cue(b, 1, 0.617)
  const menu = since(b, right, 0.3)
  const toItem = between(b, right + 0.12, choose - 0.02)
  const copied = since(b, choose + 0.04, 0.5)
  const atRow: [number, number] = [16, 27]
  const atItem: [number, number] = [32, 49]
  return (
    <Stage beat={b} label="Right-click the card skill, and choose Copy prompt for your agent">
      <Layer>
        <div className="ai-rc" style={rise(b, since(b, 0, 0.6), 12)}>
          <AppWindow
            style={{ width: 'min(78cqw, 28em)', height: 'min(62cqh, 17em)' }}
            label="The sidebar, with the card skill's right-click menu"
            sidebar={
              <SidebarPreview
                inbox={4}
                rows={[
                  { name: 'Card skill', kind: 'folder', glow: showFor(since(b, right - 0.1, 0.4), since(b, choose + 0.1, 0.6)) },
                  { name: 'Course Cards', kind: 'folder' },
                  { name: 'Projects', kind: 'folder' },
                ]}
              />
            }
          >
            <MenuPreview
              beat={b}
              x={18}
              y={28}
              p={menu * (1 - since(b, choose + 0.08, 0.3))}
              items={cardSkillMenuItems('My vault', { [CARD_SKILL_MENU.prompt]: since(b, choose - 0.06, 0.3) })}
            />
            <span className="ai-copied" style={pop(b, copied)}>
              Copied
            </span>
          </AppWindow>
          <Pointer beat={b} from={b.progress < right + 0.1 ? [80, 85] : atRow} to={b.progress < right + 0.1 ? atRow : atItem} move={b.progress < right + 0.1 ? between(b, 0.04, right - 0.02) : toItem} click={b.progress < right + 0.1 ? since(b, right, 0.5) : since(b, choose, 0.5)} />
        </div>
      </Layer>
    </Stage>
  )
}

/** c8-19: the loop (you chew, the agent drafts, you decide); then the four steps: capture, create, review, improve. */
function Loop(props: SceneProps) {
  const b = useBeat(props)
  const decide = cue(b, 0, 0.128)
  const drafts = cue(b, 1, 0.405)
  const habits = cue(b, 2, 0.681)
  const out = since(b, 0.53, 0.6)
  const turn = b.reduced ? 0 : b.t * 24
  const node = (label: string, angle: number, p: number, small = false) => {
    const a = (angle * Math.PI) / 180
    return (
      <span className={`ai-loop__node${small ? ' ai-loop__node--small' : ''}`} style={{ left: `${50 + Math.cos(a) * 34}%`, top: `${50 + Math.sin(a) * 34}%`, ...pop(b, p, 0.6) }}>
        {label}
      </span>
    )
  }
  return (
    <Stage beat={b} label="You chew and decide; your agent only drafts. Next: four steps, capture, create, review, improve">
      <Layer style={{ opacity: 1 - out }}>
        <div className="ai-loop">
          <svg viewBox="-60 -60 120 120" aria-hidden="true">
            <circle className="ai-loop__ring" r={34} strokeDasharray="6 5" transform={`rotate(${turn.toFixed(1)})`} />
          </svg>
          {node('You chew', -90, since(b, 0.02, 0.5))}
          {node('Your agent drafts', 30, since(b, drafts - 0.12, 0.5), true)}
          {node('You decide', 150, since(b, decide, 0.5))}
        </div>
      </Layer>
      <Layer style={{ opacity: out }}>
        <Habits beat={b} show={[0, 1, 2, 3].map((k) => since(b, habits + k * 0.04, 0.5))} />
      </Layer>
    </Stage>
  )
}

export const AI_SCENES: ChapterScenes = {
  chapter: 'ai',
  entries: [
    { clips: ['c8-01'], scene: ToolAndApp },
    { clips: ['c8-02'], scene: PlainFile },
    { clips: ['c8-03'], scene: AgentReads },
    { clips: ['c8-04'], scene: NoCloud },
    { clips: ['c8-05'], scene: Warning },
    { clips: ['c8-06', 'c8-07'], scene: Flood },
    { clips: ['c8-08'], scene: TwoPaths },
    { clips: ['c8-09'], scene: Holiday },
    { clips: ['c8-10'], scene: RightWay },
    { clips: ['c8-11', 'c8-12', 'c8-13', 'c8-20', 'c8-14', 'c8-15', 'c8-16'], scene: AgentStep },
    { clips: ['c8-17'], scene: YouDecide },
    { clips: ['c8-18'], scene: RightClick },
    { clips: ['c8-19'], scene: Loop },
  ],
}
