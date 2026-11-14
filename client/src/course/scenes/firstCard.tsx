/**
 * CHAPTER 2, "The card: the hub of an idea" (YAZ-5121). Two real cards, part by part (protein, and the word "candid":
 * their text is the storyboard's, `cards.ts`); then the person makes a first card in the course (type, tap a word,
 * add a back, check, answer: the WAITS steps, each calls `done()` once); then the same steps in the app, shown in a
 * copy of the app's own parts. The fractions are where the words land in the real voice.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SceneProps } from '../scene'
import { useUnit } from '../../vault/unitWord'
import { PAPERS } from './papers'
import { CANDID, MANY_TITLES, PROTEIN, SLEEP_DEBT, WALK } from './cards'
import { draftText, draftTitle, firstCardInput, makeFirstCard, type MadeCard } from './makeCard'
import {
  Answers,
  AppWindow,
  Caret,
  cardMenuItems,
  CardView,
  EditCard,
  Fit,
  IndexCard,
  Keys,
  Layer,
  MenuPreview,
  MiniCard,
  Paper,
  Pointer,
  SidebarPreview,
  SlashPreview,
  Stage,
  ToolbarPreview,
  Tree,
  Words,
  between,
  clamp,
  cue,
  editKey,
  hub,
  lerp,
  litFocus,
  moved,
  pop,
  rise,
  showFor,
  since,
  typedText,
  useBeat,
  type Answer,
  type Beat,
  type SidebarRow,
} from './kit'
import type { ChapterScenes } from './registry'

/** Part of a text, typed so far: `p` 0..1 of its letters (with reduced motion, all of it once it starts). */

const HUB = hub(['what it is', 'how it works', 'an example', 'a hook', 'links'], { r: 110 })

/** c2-01, c2-02 and c2-03, one span: the paper card from chapter 1; a line or two on paper; then a hub with spokes. */
function PaperToHub(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const cal = id === 'c2-01' ? showFor(since(b, 0, 0.6), since(b, 0.53, 0.6)) : 0
  const line = id === 'c2-02' ? since(b, 0.46, 1.6) : id === 'c2-03' ? 1 : 0
  const shrink = id === 'c2-03' ? moved(b, between(b, 0.12, 0.3)) : 0
  const card = id === 'c2-03' ? 1 - between(b, 0.2, 0.3) : 1
  const show: Record<string, number> = {
    hub: id === 'c2-03' ? since(b, 0.24, 0.5) : 0,
  }
  HUB.nodes.slice(1).forEach((n, i) => {
    const p = id === 'c2-03' ? since(b, 0.57 + i * 0.05, 0.6) : 0
    show[n.id] = p
    show[`hub>${n.id}`] = p
  })
  return (
    <Stage beat={b} label={id === 'c2-03' ? 'A card is the hub of one idea, with what you know about it around it' : 'A card, as most people picture it: a line or two on paper'}>
      <Layer style={{ opacity: cal * 0.5 }}>
        <svg viewBox="0 0 7 4" className="kit-calendar" aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <rect key={i} x={(i % 7) + 0.1} y={Math.floor(i / 7) + 0.1} width={0.8} height={0.8} rx={0.12} className={`kit-cal__day${i === 12 ? ' is-today' : ''}`} strokeWidth={0.02} />
          ))}
        </svg>
      </Layer>
      <Layer>
        <IndexCard
          lines={line > 0 ? [typedText(b, 'Mitochondria: the powerhouse of the cell', line)] : []}
          style={{
            opacity: clamp(since(b, 0, 0.5) * 2) * card,
            transform: b.reduced ? undefined : `scale(${lerp(1, 0.08, shrink).toFixed(3)})`,
          }}
        />
      </Layer>
      {id === 'c2-03' && (
        <Layer>
          <Tree beat={b} nodes={HUB.nodes} edges={HUB.edges} show={show} glow={since(b, 0.36, 0.8)} />
        </Layer>
      )}
    </Stage>
  )
}

/** c2-04, c2-05 and c2-22, one span: the protein card: its front; it turns; its back, part by part; its links. */
function ProteinCard(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const front = id === 'c2-04'
  const lit: number[] = []
  let dim = 0
  let flip = 1
  if (front) {
    lit[0] = since(b, 0.22, 0.6)
    lit[1] = since(b, 0.3, 0.6)
  } else if (id === 'c2-05') {
    flip = between(b, 0, 0.16)
    const parts: [number, number, number][] = [
      [2, cue(b, 0, 0.325) - 0.02, cue(b, 1, 0.493)],
      [3, cue(b, 1, 0.493) - 0.01, cue(b, 2, 0.687)],
      [4, cue(b, 2, 0.687) - 0.01, 1.2],
    ]
    for (const [part, from, to] of parts) lit[part] = showFor(since(b, from, 0.4), since(b, to, 0.4))
    dim = since(b, 0.25, 0.5)
  } else {
    lit[5] = since(b, 0.17, 0.6)
    dim = 1
  }
  return (
    <Stage
      beat={b}
      label={
        front
          ? 'A real card: the front is the short version, with the key part hidden'
          : id === 'c2-05'
          ? 'The back: how it works, an example, a hook'
          : 'At the bottom, links to the cards it connects to'
      }
    >
      <Layer>
        <Fit min={0.8} focus={litFocus(b, lit, 6)}>
          <div style={rise(b, front ? since(b, 0, 0.7) : 1, 16)}>
            <CardView
              beat={b}
              title={PROTEIN.title}
              text={PROTEIN.text}
              links={PROTEIN.links}
              shown={front ? 0 : PROTEIN.hidden}
              sides={front ? 1 : undefined}
              flip={flip}
              flipFrom={id === 'c2-05' ? { shown: 0, sides: 1 } : undefined}
              lit={lit}
              dim={dim}
              blanks={front ? since(b, 0.74, 0.6) : 0}
            />
          </div>
          <div className="kit-tags">
            {front && (
              <span className="kit-chip" style={pop(b, since(b, 0.22, 0.5))}>
                Front
              </span>
            )}
            {id === 'c2-05' && (
              <span className="kit-chip" style={pop(b, since(b, 0.04, 0.5))}>
                Back
              </span>
            )}
            {id === 'c2-22' && (
              <span className="kit-chip" style={pop(b, since(b, 0.78, 0.5))}>
                Chapter 10
              </span>
            )}
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c2-30 and c2-31, one span: the word card "candid": a sentence with the word, what it means; then its back. */
function CandidCard(props: SceneProps) {
  const b = useBeat(props)
  const front = props.clip.id === 'c2-30'
  const lit: number[] = []
  let dim = 0
  if (front) {
    lit[0] = showFor(since(b, 0.39, 0.5), since(b, 0.58, 0.5)) + since(b, 0.85, 0.5)
    lit[1] = since(b, 0.58, 0.5)
    dim = since(b, 0.39, 0.5) * (1 - since(b, 0.85, 0.5))
  } else {
    const parts: [number, number, number][] = [
      [2, 0.16, cue(b, 0, 0.372)],
      [3, cue(b, 0, 0.372), cue(b, 1, 0.53)],
      [4, cue(b, 1, 0.53), cue(b, 2, 0.719)],
      [6, cue(b, 2, 0.719), 1.2],
    ]
    for (const [part, from, to] of parts) lit[part] = showFor(since(b, from, 0.4), since(b, to, 0.4))
    dim = since(b, 0.14, 0.5)
  }
  return (
    <Stage beat={b} label={front ? 'A card for a word: a sentence that uses it, then what it means; the word is hidden in both' : 'Its back: how to say it, where it comes from, more examples'}>
      <Layer>
        <Fit min={0.8} focus={litFocus(b, lit, 7)}>
          <div style={rise(b, front ? since(b, 0, 0.7) : 1, 16)}>
            <CardView
              beat={b}
              title={CANDID.title}
              text={CANDID.text}
              id={CANDID.id}
              shown={front ? 0 : CANDID.hidden}
              sides={front ? 1 : undefined}
              flip={front ? 1 : between(b, 0, 0.14)}
              flipFrom={front ? undefined : { shown: 0, sides: 1 }}
              lit={lit}
              dim={dim}
              blanks={front ? since(b, 0.85, 0.6) : 0}
            />
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** c2-23: one bare line, the real card, a whole page; the card is the size that works. */
function Sizes(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const left = since(b, 0.1, 0.6)
  const right = since(b, 0.33, 0.6)
  const pick = since(b, 0.55, 0.6)
  return (
    <Stage beat={b} label={unit('More than one line, far less than a page: the short version on the front, the details on the back')}>
      <Layer>
        <div className="kit-sizes">
          <div
            className="kit-sizes__one"
            style={{
              ...rise(b, left),
              opacity: clamp(left) * lerp(1, 0.4, pick),
            }}
          >
            <span className="kit-sizes__bare">Protein: builds muscle</span>
            <Words size="page">One line</Words>
          </div>
          <div className="kit-sizes__card" style={rise(b, since(b, 0, 0.6))}>
            <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} links={PROTEIN.links} shown={PROTEIN.hidden} className="kit-cardview--small" lit={[pick, pick]} />
            <span className="kit-check" style={pop(b, pick)}>
              ✓
            </span>
          </div>
          <div
            className="kit-sizes__page"
            style={{
              ...rise(b, right),
              opacity: clamp(right) * lerp(1, 0.4, pick),
            }}
          >
            <span className="kit-sizes__sheet" aria-hidden="true">
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} style={{ width: `${70 + ((i * 37) % 30)}%` }} />
              ))}
            </span>
            <Words size="page">{unit('A whole page')}</Words>
          </div>
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, 0.55, 0.5))}>
            Front: the short version
          </span>
          <span className="kit-chip" style={pop(b, since(b, 0.76, 0.5))}>
            Back: the details
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c2-24: Wozniak's rule, 1999: keep the front simple; then the card's simple front, its blanks aglow. */
function SimpleFront(props: SceneProps) {
  const b = useBeat(props)
  const card = since(b, 0.62, 0.7)
  return (
    <Stage beat={b} label="Piotr Wozniak's rule: keep the front simple">
      <Layer>
        <Paper beat={b} paper={PAPERS.wozniak} at={{ in: 0, highlight: 0.44, lift: 0.62, out: 0.7 }} />
      </Layer>
      <Layer style={{ opacity: card }}>
        <div style={rise(b, card, 14)}>
          <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} sides={1} blanks={since(b, 0.66, 0.8)} lit={[card, card]} />
        </div>
      </Layer>
    </Stage>
  )
}

/** c2-25: the card starts light, with a short back; two more sections join it over time; it stays one card. */
function Grows(props: SceneProps) {
  const b = useBeat(props)
  const g3 = since(b, 0.63, 0.8)
  const g4 = since(b, 0.74, 0.8)
  const g5 = since(b, 0.86, 0.8)
  return (
    <Stage beat={b} label="A card starts light and grows as you learn more">
      <Layer>
        <Fit min={0.8} focus={litFocus(b, [0, 0, 0, g3, g4, g5], 6)}>
          <div style={rise(b, since(b, 0, 0.6), 12)}>
            <CardView
              beat={b}
              title={PROTEIN.title}
              text={PROTEIN.text}
              links={PROTEIN.links}
              shown={PROTEIN.hidden}
              grow={[undefined, undefined, undefined, g3, g4, g5]}
              lit={[0, 0, 0, showFor(g3, g4), showFor(g4, g5), g5 * 0.6]}
            />
          </div>
          <span className="kit-chip" style={pop(b, since(b, 0.4, 0.5))}>
            {b.progress < 0.63 ? 'Starts light' : 'Grows'}
          </span>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** Where each small card sits: in a grid first, then in three groups ("mixed and matched"). */
const GRID = MANY_TITLES.map((_, i) => [12 + (i % 4) * 25, 18 + Math.floor(i / 4) * 30] as const)
const GROUPS = [
  { label: 'For a talk', x: 17, cards: [0, 4, 8, 3] },
  { label: 'For a project', x: 50, cards: [1, 5, 9, 11] },
  { label: 'For a decision', x: 83, cards: [2, 6, 7, 10] },
]
const GROUPED = MANY_TITLES.map((_, i) => {
  const g = GROUPS.findIndex((group) => group.cards.includes(i))
  const k = GROUPS[g].cards.indexOf(i)
  return [GROUPS[g].x - 4 + k * 2.5, 26 + k * 15] as const
})

/** c2-26: all your cards: the card base; then they slide into new groups, like pieces that fit many ways. */
function CardBase(props: SceneProps) {
  const b = useBeat(props)
  const mix = moved(b, between(b, 0.66, 0.84))
  return (
    <Stage beat={b} label="All your cards are your card base; each is one idea, so cards mix and match">
      <Layer place="top">
        <Words
          size="title"
          style={{
            ...rise(b, since(b, 0.2, 0.6)),
            opacity: clamp(since(b, 0.2, 0.6)) * (1 - mix),
          }}
        >
          Card base
        </Words>
      </Layer>
      <Layer place="fill" style={{ padding: 0 }}>
        <div className="kit-base">
          {MANY_TITLES.map((title, i) => (
            <MiniCard
              key={title}
              title={title}
              style={{
                left: `${lerp(GRID[i][0], GROUPED[i][0], mix)}%`,
                top: `${lerp(GRID[i][1], GROUPED[i][1], mix)}%`,
                ...pop(b, since(b, 0.04 + i * 0.016, 0.5), 0.6),
              }}
            />
          ))}
          {GROUPS.map((group) => (
            <span key={group.label} className="kit-base__label" style={{ left: `${group.x}%`, opacity: clamp(mix * 2 - 1) }}>
              {group.label}
            </span>
          ))}
        </div>
      </Layer>
    </Stage>
  )
}

/** The example for the hands-on steps: a person who skips typing still makes a card. */
const EXAMPLE_FRONT = 'Your body builds and repairs with protein.'
const EXAMPLE_WORD = 'protein.'
const EXAMPLE_BACK = 'An egg is mostly protein and fat.'
/** The back's example when the person wrote their own front: true of any card made here. */
const EXAMPLE_BACK_ANY = 'I learned this this week.'
/** The label of each quiet button that fills in an example, the same everywhere in the course. */
export const USE_AN_EXAMPLE = 'Use an example'

/** A word's core, for the blank: no punctuation around it. */
const wordCore = (w: string): string => w.replace(/^[("“‘]+|[.,!?;:)"”’]+$/g, '')

/** The word the course suggests to hide: the example's key word; in the person's own front, the longest word. */
export function suggestedWord(words: readonly string[]): number {
  if (words.join(' ') === EXAMPLE_FRONT) return words.indexOf(EXAMPLE_WORD)
  let best = -1
  words.forEach((w, i) => {
    if (wordCore(w).length > 0 && (best < 0 || wordCore(w).length >= wordCore(words[best]).length)) best = i
  })
  return best
}

/**
 * c2-06 to c2-13, one span: the person makes a first card. The steps that wait (c2-07, c2-08, c2-28, c2-10, c2-11)
 * hold until the person acts, then call `done()` once each. The answer makes the card file through `host` (6F).
 */
function MakeCard(props: SceneProps) {
  const b = useBeat(props)
  const { clip, done, host, waits } = props
  const id = clip.id
  const [front, setFront] = useState('')
  const [draft, setDraft] = useState('')
  const [hide, setHide] = useState(-1)
  const [back, setBack] = useState<string | null>(null)
  const [backDraft, setBackDraft] = useState('')
  const [reveal, setReveal] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [made, setMade] = useState<MadeCard | null>(null)
  /** Each clip that waits calls `done` once each time it is entered. */
  const doneFor = useRef(new Set<string>())
  const finish = (clipId: string): void => {
    if (doneFor.current.has(clipId)) return
    doneFor.current.add(clipId)
    done()
  }
  // A step that is already done (the person came back to it with Back) lets the clip go on.
  useEffect(() => {
    // The layer holds a clip that waits each time it starts, so a clip entered again gets its own `done`.
    doneFor.current.delete(id)
    // The back starts with the example's detail as real text, so Add works at once; the person may change it.
    if (id === 'c2-28' && back === null && backDraft === '' && front === EXAMPLE_FRONT) setBackDraft(EXAMPLE_BACK)
    if (!waits) return
    const already = (id === 'c2-07' && front !== '') || (id === 'c2-08' && hide >= 0) || (id === 'c2-28' && back !== null) || (id === 'c2-10' && reveal >= 1) || (id === 'c2-11' && answer !== null)
    if (already) finish(id)
    // Only on a new clip: the state it reads is the state the clip starts with.
  }, [id])
  const field = useRef<HTMLTextAreaElement>(null)
  const backField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (id === 'c2-07' && front === '') field.current?.focus({ preventScroll: true })
    if (id === 'c2-28' && back === null) backField.current?.focus({ preventScroll: true })
  }, [id])

  const words = (front === '' ? EXAMPLE_FRONT : front).split(/\s+/).filter((w) => w !== '')
  const text = draftText(words, hide, back ?? '')
  const suggested = suggestedWord(words)
  const submitFront = (e?: FormEvent): void => {
    e?.preventDefault()
    if (front !== '') return
    const value = draft.replace(/\s+/g, ' ').trim() || EXAMPLE_FRONT
    setFront(value)
    finish('c2-07')
  }
  const useExample = (): void => {
    setDraft(EXAMPLE_FRONT)
    setFront(EXAMPLE_FRONT)
    finish('c2-07')
  }
  const onFrontKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submitFront(e as unknown as FormEvent)
  }
  const pick = (i: number): void => {
    if (wordCore(words[i]) === '') return
    setHide(i)
    finish('c2-08')
  }
  const submitBack = (e?: FormEvent, skip = false): void => {
    e?.preventDefault()
    if (back !== null) return
    setBack(skip ? '' : backDraft.trim())
    finish('c2-28')
  }
  const useExampleBack = (): void => {
    if (back !== null) return
    const value = front === EXAMPLE_FRONT ? EXAMPLE_BACK : EXAMPLE_BACK_ANY
    setBackDraft(value)
    setBack(value)
    finish('c2-28')
  }
  const tapCard = (): void => {
    const hasBack = (back ?? '') !== ''
    const next = Math.min(reveal + 1, hasBack ? 2 : 1)
    setReveal(next)
    if (next === (hasBack ? 2 : 1)) finish('c2-10')
  }
  const choose = (a: Answer): void => {
    if (answer !== null) return
    setAnswer(a)
    finish('c2-11')
    void makeFirstCard(host, { ...firstCardInput(words, hide, back ?? ''), answer: a }).then(setMade)
  }

  const order = ['c2-06', 'c2-07', 'c2-08', 'c2-09', 'c2-28', 'c2-10', 'c2-11', 'c2-12', 'c2-13']
  const step = order.indexOf(id)
  // Once the host made the file, its title (the host's title rule); until then the first words.
  const title = made !== null && 'path' in made ? made.title : draftTitle(words.join(' '))
  const cardIn = since(b, 0, 0.5)

  let stage
  if (id === 'c2-06') {
    stage = (
      <div className="kit-blank-card" style={pop(b, cardIn, 0.8)}>
        <Words size="label" tone="muted">
          Something you learned this week
        </Words>
      </div>
    )
  } else if (id === 'c2-07') {
    stage = (
      <form className="kit-make" onSubmit={submitFront} style={rise(b, cardIn)}>
        <label className="course__vh" htmlFor="kit-front">
          The short version, in a sentence or two
        </label>
        <textarea
          id="kit-front"
          ref={field}
          className="kit-field"
          value={front !== '' ? front : draft}
          readOnly={front !== ''}
          maxLength={280}
          rows={2}
          placeholder={EXAMPLE_FRONT}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onFrontKey}
        />
        <div className="kit-make__row">
          <button type="submit" className="course__btn course__btn--primary" disabled={front !== ''}>
            Next
          </button>
          <button type="button" className="kit-link" disabled={front !== ''} onClick={useExample}>
            {USE_AN_EXAMPLE}
          </button>
        </div>
      </form>
    )
  } else if (id === 'c2-08') {
    stage = (
      <div className="kit-make" style={rise(b, cardIn)}>
        <p className="kit-words-pick" role="group" aria-label="Tap the word to hide">
          {words.map((w, i) => (
            <span key={`${w}-${i}`}>
              <button type="button" className={`kit-word${hide < 0 && i === suggested ? ' is-suggested' : ''}`} aria-pressed={i === hide} onClick={() => pick(i)}>
                {w}
              </button>{' '}
            </span>
          ))}
        </p>
        {hide < 0 && suggested >= 0 && (
          <div className="kit-make__row">
            <button type="button" className="kit-link" onClick={() => pick(suggested)}>
              {USE_AN_EXAMPLE}
            </button>
          </div>
        )}
        {hide >= 0 && (
          <p className="kit-showonly">
            Saved as <code>{`{{${wordCore(words[hide])}}}`}</code>
          </p>
        )}
      </div>
    )
  } else if (step >= 3 && step <= 7) {
    const showBackLine = id === 'c2-28'
    const sides = id === 'c2-10' || id === 'c2-11' || id === 'c2-12' ? (reveal >= 2 || id !== 'c2-10' ? undefined : 1) : 1
    const shown = id === 'c2-10' ? (reveal >= 1 ? 1 : 0) : id === 'c2-11' || id === 'c2-12' ? 1 : 0
    const card = (
      <CardView
        beat={b}
        title={title}
        text={text}
        id="DEMO-11"
        state="New card"
        sides={sides}
        shown={shown}
        blanks={id === 'c2-09' ? since(b, 0.32, 0.6) : 0}
        footer={
          id === 'c2-11' || id === 'c2-12' ? (
            <>
              <Answers beat={b} forgot={id === 'c2-11' ? since(b, 0, 0.4) : 1} remembered={id === 'c2-11' ? since(b, 0.05, 0.4) : 1} chosen={answer} onAnswer={id === 'c2-11' ? choose : undefined} />
              <p
                className="card-inbox__last kit-quiet-line"
                style={{
                  opacity: id === 'c2-12' ? since(b, 0, 0.6) : answer !== null ? 1 : 0,
                }}
              >
                {answer === 'forgot' ? 'Forgot' : 'Remembered'}
                {made !== null && 'path' in made ? ' · saved with the card' : ''}
              </p>
            </>
          ) : undefined
        }
      />
    )
    stage = (
      <div className="kit-make">
        {id === 'c2-09' && (
          <span className="kit-chip" style={{ ...pop(b, since(b, 0.1, 0.5)), alignSelf: 'center' }}>
            Front
          </span>
        )}
        {id === 'c2-10' ? (
          <button type="button" className="kit-tap" aria-label={reveal === 0 ? 'Your card. Tap to show the hidden word.' : 'Tap to show the back.'} onClick={tapCard}>
            {card}
          </button>
        ) : (
          card
        )}
        {id === 'c2-10' && (
          <Words size="page">{reveal === 0 ? 'Tap the card to show the hidden word' : (back ?? '') !== '' && reveal === 1 ? 'Tap again to show the back' : 'That is the check'}</Words>
        )}
        {showBackLine && (
          <form className="kit-make kit-make--back" onSubmit={(e) => submitBack(e)} style={rise(b, since(b, 0.1, 0.5))}>
            <div className="card kit-side2">
              <div className="card__rule" role="separator" />
              <label className="course__vh" htmlFor="kit-back">
                One detail for the back
              </label>
              <input
                id="kit-back"
                ref={backField}
                className="kit-field kit-field--line"
                value={back !== null ? back : backDraft}
                readOnly={back !== null}
                maxLength={200}
                onChange={(e) => setBackDraft(e.target.value)}
              />
            </div>
            <div className="kit-make__row">
              <button type="submit" className="course__btn course__btn--primary" disabled={back !== null}>
                Add
              </button>
              {back === null && backDraft.trim() === '' && (
                <button type="button" className="kit-link" onClick={useExampleBack}>
                  {USE_AN_EXAMPLE}
                </button>
              )}
              <button type="button" className="kit-link" disabled={back !== null} onClick={() => submitBack(undefined, true)}>
                Skip
              </button>
            </div>
          </form>
        )}
      </div>
    )
  } else {
    // c2-13: the sidebar; the folder Course Cards opens and shows the new card file.
    const rows: SidebarRow[] = [
      {
        name: 'Course Cards',
        kind: 'folder',
        open: true,
        glow: showFor(since(b, 0.5, 0.5), since(b, 0.8, 0.5)),
      },
      {
        name: title,
        kind: 'card',
        depth: 1,
        p: since(b, 0.28, 0.5),
        active: true,
        glow: since(b, 0.3, 0.6) * (1 - since(b, 0.85, 0.6)),
      },
      { name: 'Projects', kind: 'folder' },
      { name: 'Reading list', kind: 'page' },
    ]
    stage = (
      <div className="kit-make" style={rise(b, cardIn)}>
        <AppWindow sidebar={<SidebarPreview rows={rows} inbox={1} />} style={{ height: 'min(60cqh, 18em)' }} label="The sidebar: the folder Course Cards, with your new card file">
          <div className="kit-app__tab">
            <p className="kit-app__bigtitle">{title}</p>
            <CardView beat={b} text={text} chrome="block" id="DEMO-11" shown={1} />
          </div>
        </AppWindow>
        {made !== null && 'showOnly' in made && <p className="kit-showonly">{made.showOnly}</p>}
      </div>
    )
  }
  return (
    <Stage beat={b} className="kit-stage--hands">
      <Layer>
        <Fit>{stage}</Fit>
      </Layer>
    </Stage>
  )
}

/** The card the walk-through makes in the app (made up). */
const { title: WALK_TITLE, renamed: WALK_NEW_TITLE, front: WALK_FRONT, word: WALK_WORD, back: WALK_BACK, section: WALK_SECTION } = WALK
const WALK_TEXT = SLEEP_DEBT.text

/** The folder's New rows, in the app's order (`sidebar/menuSections.ts`): page, card, drawing, folder. */
const NEW_MENU = ['New page', 'New card', 'New drawing', 'New folder']

/**
 * c2-15 to c2-21, one span: the same steps in the app, in a copy of its parts. A right-click on a folder, New card, the
 * name, Enter; the front; Hide word in the toolbar (Cmd + L); `/` New side (Cmd + Shift + Enter); three stars make a section; Esc or Done;
 * the title at the top of the tab; the card's menu, Title on the front.
 */
function InTheApp(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const id = props.clip.id
  const order = ['c2-15', 'c2-16', 'c2-17', 'c2-29', 'c2-20', 'c2-14', 'c2-21']
  const step = order.indexOf(id)
  const at = (clip: string): boolean => step >= order.indexOf(clip)

  // c2-15: the menu, New card, the name box, Enter, the tab.
  const menu = id === 'c2-15' ? showFor(since(b, 0.12, 0.3), since(b, 0.4, 0.2)) : 0
  const naming = id === 'c2-15' && b.progress >= 0.4 && b.progress < 0.69
  const created = !(id === 'c2-15' && b.progress < 0.69)
  const titleNow =
    id === 'c2-14'
      ? b.progress >= 0.66
        ? WALK_NEW_TITLE
        : b.progress >= 0.49
        ? typedText(b, WALK_NEW_TITLE, between(b, 0.5, 0.66))
        : WALK_TITLE
      : step > order.indexOf('c2-14')
      ? WALK_NEW_TITLE
      : WALK_TITLE
  const renamed = id === 'c2-21' || (id === 'c2-14' && b.progress >= 0.67)
  const rows: SidebarRow[] = [
    {
      name: 'Course Cards',
      kind: 'folder',
      open: true,
      glow: id === 'c2-15' ? showFor(since(b, 0.08, 0.4), since(b, 0.4, 0.3)) : 0,
    },
    ...(naming
      ? [
          {
            name: '',
            kind: 'card' as const,
            depth: 1,
            typing: typedText(b, WALK_TITLE, between(b, 0.54, 0.66)),
          },
        ]
      : []),
    ...(created
      ? [
          {
            name: renamed ? WALK_NEW_TITLE : WALK_TITLE,
            kind: 'card' as const,
            depth: 1,
            active: true,
            glow: id === 'c2-14' ? showFor(since(b, 0.76, 0.4), since(b, 0.95, 0.3)) : 0,
          },
        ]
      : []),
    { name: 'Projects', kind: 'folder' },
    { name: 'Reading list', kind: 'page' },
  ]

  // The editor: what is in the card so far.
  const editing = created && !at('c2-20') ? true : id === 'c2-20' ? b.progress < 0.43 : false
  const frontTyped = id === 'c2-15' ? '' : id === 'c2-16' ? typedText(b, `${WALK_FRONT} ${WALK_WORD}.`, between(b, 0.0, 0.15)) : `${WALK_FRONT} ${WALK_WORD}.`
  const selected = id === 'c2-16' && b.progress >= 0.16 && b.progress < 0.38
  const hidden = at('c2-16') && !(id === 'c2-16' && b.progress < 0.38)
  const sideBreak = at('c2-17') && !(id === 'c2-17' && b.progress < 0.47)
  const backTyped = !at('c2-17') ? '' : id === 'c2-17' ? typedText(b, WALK_BACK, between(b, 0.5, 0.64)) : WALK_BACK
  const stars = id === 'c2-29' ? (b.progress < 0.25 ? '' : b.progress < 0.49 ? typedText(b, '***', between(b, 0.25, 0.3)) : null) : at('c2-20') ? null : ''
  const section = at('c2-29') && stars === null
  const sectionTyped = id === 'c2-29' ? typedText(b, 'EXAMPLE', between(b, 0.53, 0.6)) : at('c2-20') ? 'EXAMPLE' : ''
  const sectionLine = id === 'c2-29' ? typedText(b, WALK_SECTION, between(b, 0.62, 0.78)) : at('c2-20') ? WALK_SECTION : ''

  // The pointer: where it goes in each clip ([x, y] in % of the window).
  let pointer: {
    from: [number, number]
    to: [number, number]
    move: number
    click: number
    show: number
  } = { from: [60, 80], to: [60, 80], move: 0, click: 0, show: 0 }
  if (id === 'c2-15')
    pointer = {
      from: [70, 70],
      to: [14, 19],
      move: between(b, 0, 0.11),
      click: since(b, 0.11, 0.4),
      show: 1 - since(b, 0.5, 0.3),
    }
  if (id === 'c2-15' && b.progress >= 0.3)
    pointer = {
      from: [14, 19],
      to: [24, 36],
      move: between(b, 0.3, 0.37),
      click: since(b, 0.39, 0.4),
      show: 1 - since(b, 0.5, 0.3),
    }
  if (id === 'c2-16')
    pointer = {
      from: [80, 80],
      to: [74, 24],
      move: between(b, 0.25, 0.36),
      click: since(b, 0.373, 0.4),
      show: showFor(since(b, 0.2, 0.3), since(b, 0.55, 0.3)),
    }
  if (id === 'c2-17')
    pointer = {
      from: [80, 80],
      to: [62, 64],
      move: between(b, 0.3, 0.42),
      click: since(b, 0.465, 0.4),
      show: showFor(since(b, 0.28, 0.3), since(b, 0.55, 0.3)),
    }
  if (id === 'c2-20')
    pointer = {
      from: [80, 85],
      to: [88, 23],
      move: between(b, 0.29, 0.42),
      click: since(b, 0.428, 0.4),
      show: showFor(since(b, 0.26, 0.3), since(b, 0.62, 0.3)),
    }
  if (id === 'c2-14')
    pointer = {
      from: [80, 85],
      to: [48, 15],
      move: between(b, 0.35, 0.46),
      click: since(b, 0.469, 0.4),
      show: showFor(since(b, 0.3, 0.3), since(b, 0.55, 0.3)),
    }
  if (id === 'c2-21')
    pointer =
      b.progress < 0.5
        ? {
            from: [80, 85],
            to: [95, 33],
            move: between(b, 0.18, 0.33),
            click: since(b, 0.34, 0.4),
            show: since(b, 0.15, 0.3),
          }
        : {
            from: [95, 33],
            to: [80, 58],
            move: between(b, 0.55, 0.66),
            click: since(b, 0.69, 0.4),
            show: 1 - since(b, 0.9, 0.3),
          }

  const cardMenu = id === 'c2-21' ? since(b, 0.36, 0.3) : 0
  const titleHidden = id === 'c2-21' && b.progress >= 0.69
  const tabTitle = renamed ? WALK_NEW_TITLE : WALK_TITLE
  const keys = id === 'c2-16' ? since(b, 0.66, 0.5) : id === 'c2-17' ? since(b, 0.72, 0.5) : 0

  return (
    <Stage beat={b} label="In the app: make a card, hide a word, add a side and a section, save, rename, and the card's menu">
      <Layer>
        <AppWindow
          sidebar={<SidebarPreview rows={rows} inbox={4} />}
          label={unit('The app, with made-up pages')}
          over={
            // c2-15 happens on the sidebar: the pointer and the folder's menu are placed in % of the whole window.
            <>
              <MenuPreview
                beat={b}
                x={17}
                y={27}
                p={menu}
                items={NEW_MENU.map((label) => ({
                  label,
                  active: label === 'New card' ? since(b, 0.34, 0.2) : 0,
                }))}
              />
              {id === 'c2-15' && <Pointer beat={b} from={pointer.from} to={pointer.to} move={pointer.move} click={pointer.click} show={pointer.show} />}
            </>
          }
        >
          <div className="kit-app__tabbar">{created && <span className="kit-app__tabname">{tabTitle}</span>}</div>
          {created && (
            <div className="kit-app__tab">
              <p className="kit-app__bigtitle">
                {titleNow}
                {id === 'c2-14' && b.progress >= 0.47 && b.progress < 0.67 && <Caret />}
              </p>
              {editing ? (
                <EditCard id={SLEEP_DEBT.id} title={tabTitle}>
                    <p>
                      {hidden ? (
                        <>
                          {WALK_FRONT} <span className="card__cloze">{WALK_WORD}</span>.
                        </>
                      ) : selected ? (
                        <>
                          {WALK_FRONT} <span className="kit-selection">{WALK_WORD}</span>.
                        </>
                      ) : (
                        frontTyped
                      )}
                      {(id === 'c2-15' && b.progress >= 0.8) || (id === 'c2-16' && b.progress < 0.15) ? <Caret /> : null}
                    </p>
                    {id === 'c2-17' && b.progress >= 0.2 && !sideBreak && (
                      <p>
                        /<Caret />
                      </p>
                    )}
                    {sideBreak && <div className="card__side-break" />}
                    {sideBreak && (
                      <p>
                        {backTyped}
                        {id === 'c2-17' && <Caret />}
                      </p>
                    )}
                    {at('c2-29') && stars !== null && stars !== '' && (
                      <p>
                        {stars}
                        <Caret />
                      </p>
                    )}
                    {section && <hr className="kit-editcard__rule" />}
                    {section && (
                      <p>
                        <b>{sectionTyped}</b>
                        <br />
                        {sectionLine}
                        {id === 'c2-29' && <Caret />}
                      </p>
                    )}
                </EditCard>
              ) : (
                <div className="kit-readcard">
                  {titleHidden && <span className="card__state card__notitle kit-notitle">Title hidden in review</span>}
                  <CardView beat={b} text={WALK_TEXT} chrome="block" id={SLEEP_DEBT.id} shown={1} />
                  {id === 'c2-20' && (
                    <span className="kit-chip" style={pop(b, since(b, 0.7, 0.5))}>
                      Saved
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <ToolbarPreview
            beat={b}
            x={58}
            y={30}
            p={id === 'c2-16' ? showFor(since(b, 0.2, 0.25), since(b, 0.42, 0.25)) : 0}
            items={[
              { label: 'H1' },
              { label: 'H2' },
              { label: 'H3' },
              { label: 'T' },
              {
                label: 'Hide word',
                key: editKey('hide word'),
                wide: true,
                active: since(b, 0.36, 0.2),
              },
              { label: 'B' },
              { label: 'I' },
            ]}
          />
          <SlashPreview
            beat={b}
            x={36}
            y={44}
            p={id === 'c2-17' ? showFor(since(b, 0.21, 0.25), since(b, 0.47, 0.2)) : 0}
            rows={[{ label: 'New side', active: since(b, 0.4, 0.2) }, { label: 'Heading 1' }, { label: 'Bullet list' }, { label: 'Quote' }]}
          />
          <MenuPreview
            beat={b}
            x={58}
            y={34}
            p={cardMenu}
            items={cardMenuItems('file', { 'Title on the front': since(b, 0.6, 0.2) }, titleHidden ? 'Hide' : 'Show', unit)}
          />
          {id !== 'c2-15' && <Pointer beat={b} from={pointer.from} to={pointer.to} move={pointer.move} click={pointer.click} show={pointer.show} />}
        </AppWindow>
        <Keys p={keys} items={id === 'c2-17' ? [{ keys: editKey('new side'), label: 'new side' }] : [{ keys: editKey('hide word'), label: 'hide word' }]} />
      </Layer>
    </Stage>
  )
}

/** c2-18: "Try it in the app", and Next chapter: the chapter's end, where the try step is. */
function TryInApp(props: SceneProps) {
  const b = useBeat(props)
  return (
    <Stage beat={b} label="Try it in the app, at the end of the chapter">
      <Layer>
        <div className="kit-try" style={pop(b, since(b, 0, 0.6), 0.85)}>
          <span
            className="course__btn course__btn--try"
            style={{
              boxShadow: `0 0 0 ${(4 * showFor(since(b, 0.58, 0.4), since(b, 0.9, 0.4))).toFixed(2)}px var(--accent-soft)`,
            }}
          >
            Try it in the app
          </span>
          <span className="course__btn">Next chapter</span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c2-19: the card as a hub: the short version, the details, room to grow; then the Inbox, where cards come back. */
function HubAndInbox(props: SceneProps) {
  const b = useBeat(props)
  const out = since(b, 0.66, 0.6)
  const spokes = [
    {
      id: 'f',
      label: 'The short version, on the front',
      x: 300,
      y: 30,
      at: 0.23,
    },
    { id: 'k', label: 'The details, on the back', x: 300, y: 318, at: 0.38 },
    { id: 'g', label: 'Room to grow', x: 545, y: 170, at: 0.51 },
  ]
  const nodes = [
    { id: 'hub', x: 300, y: 170, kind: 'hub' as const },
    ...spokes.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      label: s.label,
      kind: 'leaf' as const,
    })),
  ]
  const edges = spokes.map((s) => ({ from: 'hub', to: s.id }))
  const show: Record<string, number> = {}
  for (const s of spokes) {
    show[s.id] = since(b, s.at, 0.6)
    show[`hub>${s.id}`] = since(b, s.at, 0.6)
  }
  return (
    <Stage beat={b} label="A card is the hub of one idea. Next: the Inbox, where cards come back each day">
      <Layer style={{ opacity: 1 - out }}>
        <Tree beat={b} nodes={nodes} edges={edges} show={show} />
      </Layer>
      <Layer style={{ opacity: since(b, 0, 0.6) * (1 - out) }}>
        <div className="kit-hubcard">
          <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} sides={1} className="kit-cardview--small" />
        </div>
      </Layer>
      <Layer style={{ opacity: out }}>
        <AppWindow
          sidebar={
            <SidebarPreview
              inbox={4}
              inboxGlow={since(b, 0.74, 0.8)}
              rows={[
                { name: 'Course Cards', kind: 'folder', open: true },
                { name: 'Sleep debt adds up', kind: 'card', depth: 1 },
                { name: 'Projects', kind: 'folder' },
              ]}
            />
          }
          style={{ width: 'min(70cqw, 30em)' }}
          label="The sidebar's Inbox row"
        />
      </Layer>
    </Stage>
  )
}

export const FIRST_CARD_SCENES: ChapterScenes = {
  chapter: 'first-card',
  entries: [
    { clips: ['c2-01', 'c2-02', 'c2-03'], scene: PaperToHub },
    { clips: ['c2-04', 'c2-05', 'c2-22'], scene: ProteinCard },
    { clips: ['c2-30', 'c2-31'], scene: CandidCard },
    { clips: ['c2-23'], scene: Sizes },
    { clips: ['c2-24'], scene: SimpleFront },
    { clips: ['c2-25'], scene: Grows },
    { clips: ['c2-26'], scene: CardBase },
    {
      clips: ['c2-06', 'c2-07', 'c2-08', 'c2-09', 'c2-28', 'c2-10', 'c2-11', 'c2-12', 'c2-13'],
      scene: MakeCard,
    },
    {
      clips: ['c2-15', 'c2-16', 'c2-17', 'c2-29', 'c2-20', 'c2-14', 'c2-21'],
      scene: InTheApp,
    },
    { clips: ['c2-18'], scene: TryInApp },
    { clips: ['c2-19'], scene: HubAndInbox },
  ],
}
