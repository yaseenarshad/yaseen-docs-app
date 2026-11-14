/**
 * THE AI STEP'S PANEL (YAZ-5124, chapter 8 `ai`): the scene builders (6C) mount it on the stage of clips `c8-11` to
 * `c8-16`. It is a view over `host.agentStep`, whose state lives in the host, so each clip can mount it again and find
 * the text, the copied prompt and the Read ticks as they were.
 *
 * 1. `text`: a box for the person's own digested text, and "Use the example".
 * 2. `prompt`: the prompt for the person's own agent, and Copy. Its first sentence is `AGENT_PROMPT` with the path of
 *    the card skill this vault uses; then 3 cards as card files in "Course Cards"; then the text.
 * 3. `cards`: each card that comes into "Course Cards" after Copy, as the agent writes it. After 60 seconds with no
 *    card, the one line `NO_CARDS_YET`; the panel keeps waiting. Each card opens here to be read; opened, it is ticked
 *    "Read". The app runs no agent and sends nothing anywhere.
 * 4. `skip`: "No agent? Skip": three example cards show; they become files only after "Make these cards".
 *
 * `onStep` tells the scene what the person did, so it can call `done()` on the clip that waits for it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cardPieces, cardSides } from '@shared/cardText'
import { NO_CARDS_YET } from './prompt'
import { courseCardKey, type CourseCard, type CourseCardText, type CourseHost } from './courseHost'
import { AGENT_LINES, EXAMPLE_CARDS } from './courseCards'
import './agentStep.css'

export type AgentStepPart = 'text' | 'prompt' | 'cards' | 'skip'

/**
 * What the person did: `text` (the box holds text: theirs or the example), `copied` (Copy put the prompt on the
 * clipboard), `arrived` (the first new card came into Course Cards), `read` (each new card was opened), `made` (the
 * three example cards are files).
 */
export type AgentStepEvent = 'text' | 'copied' | 'arrived' | 'read' | 'made'

export interface AgentStepPanelProps {
  host: CourseHost
  /** The parts to show, in this order. Default: all four. */
  parts?: readonly AgentStepPart[]
  /** Called once per event for each mount of the panel, when the person has done it (or had done it before this mount). */
  onStep?: (event: AgentStepEvent) => void
}

const ALL_PARTS: readonly AgentStepPart[] = ['text', 'prompt', 'cards', 'skip']

/** One side of a card, with its hidden words shown as marked words. */
function Side({ text }: { text: string }) {
  return (
    <p className="agent-step__side">
      {cardPieces(text).map((piece, i) => (piece.kind === 'hidden' ? <mark key={i}>{piece.text}</mark> : <span key={i}>{piece.text}</span>))}
    </p>
  )
}

/** A card to read: its title and its sides; a `***` line on the back is a section break. */
function CardText({ card }: { card: CourseCardText }) {
  return (
    <div className="agent-step__card">
      <p className="agent-step__card-title">{card.title}</p>
      {card.sides.map((side, i) => (
        <div key={i} className="agent-step__card-face">
          <span className="agent-step__face-label">{i === 0 ? 'Front' : i === 1 ? 'Back' : `Side ${i + 1}`}</span>
          {side.split(/\n[ \t]*\*\*\*[ \t]*\n/).map((section, j) => (
            <Side key={j} text={section} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function AgentStepPanel({ host, parts = ALL_PARTS, onStep }: AgentStepPanelProps) {
  const step = host.agentStep
  const state = useSyncExternalStore(step.subscribe, step.state)
  const [open, setOpen] = useState<{ key: string; card: CourseCardText | null } | null>(null)
  const [copying, setCopying] = useState(false)
  const told = useRef(new Set<AgentStepEvent>())
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const shows = (part: AgentStepPart): boolean => parts.includes(part)

  // The prompt is built when its part shows and the box holds text (the folder is made here, the first time).
  const hasText = state.text.trim() !== ''
  const preparing = useRef(false)
  useEffect(() => {
    if (!shows('prompt') || !hasText || state.prompt !== null || preparing.current) return
    preparing.current = true
    void step.preparePrompt().finally(() => (preparing.current = false))
  })

  // Each event once per mount: the scene calls `done()` on the clip that waits for it.
  const allRead = state.cards.length > 0 && state.cards.every((c) => state.read.includes(courseCardKey(c)))
  useEffect(() => {
    const tell = (event: AgentStepEvent, now: boolean): void => {
      if (!now || told.current.has(event)) return
      told.current.add(event)
      onStepRef.current?.(event)
    }
    tell('text', hasText)
    tell('copied', state.copiedAt !== null)
    tell('arrived', state.cards.length > 0)
    tell('read', allRead)
    tell('made', Array.isArray(state.examples))
  }, [hasText, state.copiedAt, state.cards.length, allRead, state.examples])

  const openCard = (card: CourseCard): void => {
    const key = courseCardKey(card)
    if (open?.key === key) return setOpen(null)
    setOpen({ key, card: null })
    void host.readCard(card).then((text) => {
      setOpen((now) => (now?.key === key ? { key, card: text } : now))
      if (text !== null) step.markRead(card)
    })
  }

  const prompt = state.prompt
  return (
    <div className="agent-step">
      {shows('text') && (
        <section className="agent-step__part" aria-label="Your text">
          <label className="agent-step__label" htmlFor="agent-step-text">
            Paste something you have digested
          </label>
          <textarea id="agent-step-text" className="agent-step__text" rows={6} value={state.text} onChange={(e) => step.setText(e.target.value)} />
          <button type="button" className="course__btn" onClick={() => step.useExample()} disabled={state.example}>
            Use the example
          </button>
        </section>
      )}

      {shows('prompt') && (
        <section className="agent-step__part" aria-label="The prompt for your agent">
          {!hasText ? (
            <p className="agent-step__line">{AGENT_LINES.noText}</p>
          ) : prompt === null ? null : 'showOnly' in prompt ? (
            <p className="agent-step__line" role="status">
              {prompt.showOnly}
            </p>
          ) : (
            <>
              <pre className="agent-step__prompt">{prompt.text}</pre>
              <button
                type="button"
                className="course__btn course__btn--primary"
                disabled={copying}
                onClick={() => {
                  setCopying(true)
                  void step.copy().finally(() => setCopying(false))
                }}
              >
                {state.copiedAt === null ? 'Copy' : 'Copy again'}
              </button>
              {state.copiedAt !== null && <span className="agent-step__copied">Copied. Paste it into your agent.</span>}
            </>
          )}
        </section>
      )}

      {shows('cards') && state.copiedAt !== null && (
        <section className="agent-step__part" aria-label="New cards">
          {state.cards.length === 0 ? (
            <p className="agent-step__line" role="status">
              {state.quiet ? NO_CARDS_YET : 'Waiting for cards in Course Cards…'}
            </p>
          ) : (
            <ul className="agent-step__list">
              {state.cards.map((card) => {
                const key = courseCardKey(card)
                const read = state.read.includes(key)
                return (
                  <li key={key} className="agent-step__item">
                    <button type="button" className="agent-step__open" aria-expanded={open?.key === key} onClick={() => openCard(card)}>
                      <span className="agent-step__title">{card.title}</span>
                      {read && <span className="agent-step__read">✓ Read</span>}
                    </button>
                    {open?.key === key && open.card !== null && <CardText card={open.card} />}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {shows('skip') && (
        <section className="agent-step__part" aria-label="No agent">
          {state.examples === 'hidden' ? (
            <button type="button" className="course__btn" onClick={() => step.showExamples()}>
              No agent? Skip
            </button>
          ) : (
            <>
              {EXAMPLE_CARDS.map((card) => (
                <CardText key={card.title} card={{ title: card.title, sides: cardSides(card.text) }} />
              ))}
              {Array.isArray(state.examples) ? (
                <p className="agent-step__line" role="status">
                  Made {state.examples.length} cards in Course Cards.
                </p>
              ) : (
                <button type="button" className="course__btn course__btn--primary" onClick={() => void step.makeExamples()}>
                  Make these cards
                </button>
              )}
            </>
          )}
        </section>
      )}

      {state.problem !== null && (
        <p className="agent-step__line agent-step__line--problem" role="alert">
          {state.problem}
        </p>
      )}
    </div>
  )
}
