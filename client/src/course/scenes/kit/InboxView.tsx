/**
 * THE INBOX, IN THE COURSE (YAZ-5121, chapter 3 on): a calm copy of the app's Inbox tab on made-up cards, built from
 * the SAME class names as `review/CardInbox.tsx` and `CardInboxBar.tsx`, so the app's own `cardScreens.css` draws it:
 *
 * - The top row: the filter "All cards ▾" (its real glyphs), the card's place, "1 of 4"; the thin progress bar
 *   (a Remembered grey, a Forgot red).
 * - The card: `CardView` (the app's own `renderCard`, the state chip, "Title · ID", "Side 1 of 2").
 * - The buttons row: ← →, Forgot and Remembered (the real glyphs, the 1 and 2 keys), ⋯. `hover` shows the app's
 *   hover box over a button ("Remembered · 9 days"); `press` lights a button as a key or a click picks it.
 * - The last answer's line: "✓ Remembered · DEMO-2 · back in 9 days · Undo Cmd + Z" (`last`).
 * - The key row, in the app's words (`cardInboxHints`, `KeyLabel`: "Show (Space)"); `glowKey` lights one key ("Space").
 * - `done`: the done screen, "Inbox complete." and its quiet line.
 *
 * Everything is a pure function of its props (the beat and progress values), as every kit piece.
 */
import type { ReactNode } from 'react'
import { cardInboxHints } from '../../../review/cardInboxKeys'
import { ChevronIcon, ForgotIcon, InboxTrayIcon, RememberedIcon } from '../../../review/cardInboxIcons'
import { KeyLabel } from '../../../keys/KeyLabel'
import { clamp, ease, lerp, type Beat } from './beat'
import { CardView, type CardViewProps } from './CardView'
import { Pointer } from './AppFrame'
import './kit.css'

interface InboxAnswerLook {
  /** 0..1: the button comes in (default: shown). */
  p?: number
  /** 0..1: the button lights, as a click or its key picks it. */
  press?: number
  /** 0..1: its key (1 or 2) lights. */
  key?: number
}

interface InboxViewProps {
  beat: Beat
  /** The card (`CardView`'s props, less the beat and the frame). Absent with `done`. */
  card?: Omit<CardViewProps, 'beat' | 'chrome'>
  /** "1 of 4". */
  position?: number
  total?: number
  /** The progress bar: each answer so far, in order (true: a Forgot, red), out of `total`. */
  answered?: readonly boolean[]
  /** The card's place in the top row: "Course Cards › Light". */
  place?: readonly string[]
  forgot?: InboxAnswerLook
  remembered?: InboxAnswerLook
  /** The app's hover box over a button: its words and 0..1. */
  hover?: { on: 'forgot' | 'remembered'; text: string; p: number }
  /** A mouse pointer that glides onto a button (`move` 0..1), clicks (`click`), shows (`show`). */
  cursor?: { on: 'forgot' | 'remembered'; move: number; click?: number; show?: number }
  /** The last answer's line: `rating` 'again' is red. */
  last?: { rating: 'again' | 'good'; text: string; p: number; undo?: number }
  /** The key row: the next Space shows a side; an undo is there. */
  keys?: { nextSide?: boolean; canUndo?: boolean; answering?: boolean }
  /** 0..1 per key of the key row, by its label ("Show", "Undo"). */
  glowKey?: Readonly<Record<string, number>>
  /** 0..1: the done screen ("Inbox complete.") takes the card's place. */
  done?: number
  /** The done screen's quiet line. */
  doneLine?: string
  /** Over the whole screen (a pointer). */
  children?: ReactNode
  label?: string
}

const glow = (g: number): string | undefined => (g > 0 ? `0 0 0 ${(2.5 * clamp(g)).toFixed(2)}px var(--accent), 0 0 ${(16 * clamp(g)).toFixed(1)}px color-mix(in srgb, var(--accent) 40%, transparent)` : undefined)

function AnswerButton({ beat, kind, look, hover, cursor }: { beat: Beat; kind: 'forgot' | 'remembered'; look: InboxAnswerLook; hover?: InboxViewProps['hover']; cursor?: InboxViewProps['cursor'] }) {
  const p = clamp(look.p ?? 1)
  const press = clamp(look.press ?? 0)
  const key = clamp(look.key ?? 0)
  const Icon = kind === 'forgot' ? ForgotIcon : RememberedIcon
  const tip = hover !== undefined && hover.on === kind ? clamp(hover.p) : 0
  return (
    <span className="kit-inbox__answer-wrap">
      {tip > 0 && (
        <span className="hover-tip kit-inbox__tip" role="tooltip" style={{ opacity: tip, transform: beat.reduced ? 'translateX(-50%)' : `translate(-50%, ${lerp(4, 0, ease.out(tip)).toFixed(2)}px)` }}>
          {hover?.text}
        </span>
      )}
      <span
        className="explore__button card-inbox__answer"
        data-rating={kind === 'forgot' ? 'again' : 'good'}
        style={{
          opacity: p,
          boxShadow: glow(press),
          transform: beat.reduced || press <= 0 || press >= 1 ? undefined : `scale(${lerp(1, 0.96, Math.sin(press * Math.PI)).toFixed(4)})`,
        }}
      >
        <Icon />
        <span className="card-inbox__answer-label">{kind === 'forgot' ? 'Forgot' : 'Remembered'}</span>
        <kbd style={key > 0 ? { color: 'var(--accent)', borderColor: 'var(--accent)', opacity: 1, boxShadow: glow(key * 0.7) } : undefined}>{kind === 'forgot' ? '1' : '2'}</kbd>
      </span>
      {cursor !== undefined && cursor.on === kind && <Pointer beat={beat} from={[150, 320]} to={[58, 55]} move={cursor.move} click={cursor.click ?? 0} show={cursor.show ?? 1} />}
    </span>
  )
}

export function InboxView({ beat, card, position = 1, total = 4, answered = [], place, forgot = {}, remembered = {}, hover, cursor, last, keys = {}, glowKey = {}, done = 0, doneLine = 'Nothing else is due today. Enjoy your day!', children, label = 'The Inbox, on made-up cards' }: InboxViewProps) {
  const d = clamp(done)
  const showCard = card !== undefined && d < 1
  const hints = cardInboxHints({ card: d < 1 && card !== undefined, answering: keys.answering ?? false, canUndo: keys.canUndo ?? false, nextSide: keys.nextSide ?? false }).filter((h) => h.keys !== '⌘↵')
  return (
    <div className="kit-inbox" role="img" aria-label={label}>
      <div className="kit-app__tabbar">
        <span className="kit-app__tabname">Inbox</span>
      </div>
      <div className="kit-inbox__view">
        <div className="card-inbox__top">
          <div className="card-inbox__bar">
            <span className="card-inbox__filter">
              <InboxTrayIcon />
              <span>All cards</span>
              <ChevronIcon />
            </span>
            {place !== undefined && place.length > 0 && (
              <span className="card-inbox__path">
                {place.map((part, i) => (
                  <span key={part} className="kit-inbox__path-part">
                    {i > 0 && <span className="card-inbox__path-sep">›</span>}
                    <span className={`card-inbox__path-part${i === place.length - 1 ? ' kit-inbox__path-last' : ''}`}>
                      <span className="card-inbox__path-name">{part}</span>
                    </span>
                  </span>
                ))}
              </span>
            )}
            {showCard && (
              <span className="card-inbox__place">
                {position} of {total}
              </span>
            )}
          </div>
          <div className="card-inbox__progress">
            {answered.map((missed, i) => (
              <span key={i} className="card-inbox__progress-part" data-missed={missed || undefined} style={{ width: `${(100 / Math.max(1, total)).toFixed(3)}%` }} />
            ))}
          </div>
        </div>
        <div className="kit-inbox__column">
          {showCard ? (
            <div style={{ opacity: 1 - d }}>
              <CardView beat={beat} {...card} chrome="inbox" />
            </div>
          ) : (
            <div className="card-inbox__panel kit-inbox__done" style={{ opacity: clamp(d * 1.5) }}>
              <div className="card-inbox__body">
                <div className="card-inbox__done" role="status">
                  <p className="card-inbox__done-title" style={beat.reduced ? undefined : { transform: `scale(${lerp(0.94, 1, ease.back(d)).toFixed(4)})` }}>
                    Inbox complete.
                  </p>
                  <p className="card-inbox__done-line" style={{ opacity: clamp(d * 2 - 0.6) }}>
                    {doneLine}
                  </p>
                </div>
              </div>
            </div>
          )}
          {showCard && (
            <div className="card-inbox__actions" style={{ opacity: 1 - d }}>
              <div className="card-inbox__moves">
                <span className="explore__button card-inbox__move">←</span>
                <span className="explore__button card-inbox__move">→</span>
              </div>
              <div className="card-inbox__answers">
                <AnswerButton beat={beat} kind="forgot" look={forgot} hover={hover} cursor={cursor} />
                <AnswerButton beat={beat} kind="remembered" look={remembered} hover={hover} cursor={cursor} />
              </div>
              <div className="card-inbox__more">
                <span className="explore__button card-inbox__more-button">⋯</span>
              </div>
            </div>
          )}
          <div className="card-inbox__last" data-rating={last !== undefined && last.p > 0 ? last.rating : undefined} style={{ opacity: clamp(last?.p ?? 0) }}>
            {last !== undefined && last.p > 0 && (
              <>
                <span className="card-inbox__last-mark">{last.text.slice(0, last.text.indexOf(' '))}</span>
                <span className="card-inbox__last-text">{last.text.slice(last.text.indexOf(' '))} · </span>
                <span className="card-inbox__last-undo" style={{ boxShadow: glow(last.undo ?? 0) }}>
                  <KeyLabel action="Undo" keys="⌘Z" />
                </span>
              </>
            )}
          </div>
        </div>
        <div className="explore__foot card-inbox__hints kit-inbox__hints" aria-hidden="true">
          {hints.map((h) => {
            const g = clamp(glowKey[h.label] ?? 0)
            return (
              <span key={h.label} className={g > 0 ? 'kit-inbox__hint-on' : undefined} style={g > 0 ? { color: `color-mix(in srgb, var(--accent) ${(g * 100).toFixed(0)}%, var(--fg-muted))` } : undefined}>
                <KeyLabel action={h.label} keys={h.keys} />
              </span>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}
