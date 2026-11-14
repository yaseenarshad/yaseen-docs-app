/**
 * THE INBOX CARD, shared (YAZ-5152): the card as the Inbox shows it — its front and its head title, Space's steps
 * (the next hidden word, then the next side), the scroll that follows them, the card's frame with its width edges,
 * "Side 1 of 2", and the step the Reviews strip waits for. The Inbox (`CardInbox`) and the card Preview
 * (`CardPreview`) both draw their card with these, so a preview IS the Inbox's card: no copy of its look or its steps.
 * What each adds is its own: the Inbox its answers, its timer and its session; the Preview none of them.
 */
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { cardSides, hiddenCount } from '@shared/cardText'
import type { ExploreVault } from '../explore/ExplorePage'
import { CardBody, type CardLinkDoors } from './cardParts'
import { CARD_MEDIA, CARD_OPENS, stopCardAudio } from '../editor/card/cardMedia'
import { glideView, inRoom, inboxRoom, readingScroll } from './inboxScroll'
import { START, markOf, reveal, shownParts, type Reveal } from './cardSteps'
import { SHOW_GAP, leastScroll } from '../editor/find/leastScroll'

/** The step a card is at (D18): how many sides show, which hidden words, and the marked blank (`cardSteps.ts`, YAZ-5049 round 4). */
export interface CardStep extends Reveal {
  key: string | null
}

/**
 * The card's front and head title (YAZ-5030, YAZ-5308). The front is the card's text (its sides only) and the head shows
 * its title, off its card line: never part of the text, so it is never a Space step. "Title on the front: Hide"
 * (`notitle`) makes the head's title wait for the card's last step.
 */
export function useCardFront(pageText: string | null, title: string, notitle: boolean): { text: string | null; title: { text: string; waits: boolean } } {
  const head = useMemo(() => ({ text: pageText === null ? '' : title, waits: notitle }), [pageText, title, notitle])
  return { text: pageText, title: head }
}

export interface CardSteps {
  /** Each side's hidden words. */
  counts: number[]
  step: CardStep
  /** Every side and every hidden word shows. */
  done: boolean
  /** YAZ-5048: the next Space shows the next side (the sides that show have no hidden word left). */
  nextSide: boolean
  /** The blank the next Space shows (YAZ-5049 round 4: after a click, the next one still hidden after the clicked word). */
  mark: number | null
  /** YAZ-5105 round 3: the last side shows, past the front (a one-side card: past its first Space, or nothing hidden). */
  onLastSide: boolean
  /**
   * One step (D18): the marked word, else the next side. `by` says what showed it: a key scrolls to follow the next
   * blank, a mouse never moves the view (YAZ-5049 round 4). Round 5: a key never shows a blank out of view (`view`):
   * it only glides it in, and the next key shows it. False at the end: nothing moved.
   */
  stepOn: (by?: 'key' | 'mouse') => boolean
  /** A click on a blank (YAZ-5049 round 4): THAT word shows, the view stays put. */
  showWord: (word: number) => void
  /** Back to the front (the Preview's Space at the end, YAZ-5152). */
  restart: () => void
}

/** Space's steps over `text`, the card `cardKey` (a new key starts at the front), in the scrolled view `viewRef`. */
export function useCardSteps(text: string | null, cardKey: string | null, viewRef: RefObject<HTMLElement | null>): CardSteps {
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<CardStep>({ ...START, key: cardKey })
  const step: CardStep = stepState.key === cardKey ? stepState : { ...START, key: cardKey }
  // A card that goes and comes back (⌘Z after the last answer) starts again from its first step.
  useEffect(() => setStep((s) => (s.key === cardKey ? s : { ...START, key: cardKey })), [cardKey])
  const hiddenUpTo = (sides: number): number => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.open.length >= hiddenUpTo(counts.length)
  const nextSide = !done && text !== null && step.open.length >= hiddenUpTo(step.sides)
  const mark = markOf(step, hiddenUpTo(step.sides))
  const onLastSide = text !== null && step.sides >= counts.length && (step.sides > 1 || step.open.length > 0 || done)
  const stepOn = useCallback(
    (by: 'key' | 'mouse' = 'key'): boolean => {
      if (done || text === null) return false
      const upTo = counts.slice(0, step.sides).reduce((a, b) => a + b, 0)
      const m = markOf(step, upTo)
      // Round 5 (Yaseen: "Yes, build it"): Space never shows a blank you cannot see. The marked blank not wholly in view
      // (a scroll by hand, a click that moved the mark, a blank under the buttons or the top row): this Space only brings
      // it in, a third of the way down, and the next Space shows it. A click shows its word as before (round 4).
      const view = viewRef.current
      const blank = by === 'key' && m !== null && view !== null ? view.querySelector(`[data-hidden="${m}"]`) : null
      if (blank !== null && view !== null) {
        const r = blank.getBoundingClientRect()
        const room = inboxRoom(view)
        if (!inRoom({ start: r.top, end: r.bottom }, room)) {
          glideView(view, readingScroll({ start: r.top, end: r.bottom }, room))
          return true
        }
      }
      setStep(m !== null ? { ...reveal(step, m, upTo, by), key: step.key } : { ...step, sides: step.sides + 1, next: null, last: null, by })
      return true
    },
    [done, text, counts, step, viewRef],
  )
  const showWord = useCallback(
    (word: number) => {
      if (text === null) return
      const upTo = counts.slice(0, step.sides).reduce((a, b) => a + b, 0)
      const next = reveal(step, word, upTo, 'mouse')
      if (next !== step) setStep({ ...next, key: step.key })
    },
    [text, counts, step],
  )
  const restart = useCallback(() => setStep({ ...START, key: cardKey }), [cardKey])
  return { counts, step, done, nextSide, mark, onLastSide, stepOn, showWord, restart }
}

/**
 * YAZ-5049 (Yaseen: "kinda like we have in the app our CMD F search"): the word a Space shows, or the side it adds,
 * comes into view, gliding; never centred. Only a step of the same card moves it. The card's render runs first.
 * Round 2: the card is one long page, as in Mochi (no scroll bar of its own: the view scrolls, its top and bottom rows
 * stay), and the rule keeps room below the word, to see what comes next (`inboxScroll.ts`). A new card starts at its
 * top, at once. Round 3: the blank the next Space shows leads; at the end, the card's end (the Reviews strip) comes in.
 * Round 4: a click shows that word and the view stays put.
 */
export function useStepScroll(steps: Pick<CardSteps, 'step' | 'done'>, shown: boolean, bodyRef: RefObject<HTMLDivElement | null>, viewRef: RefObject<HTMLElement | null>): void {
  const { step, done } = steps
  const lastStep = useMemo(() => ({ current: null as CardStep | null }), [])
  useEffect(() => {
    const before = lastStep.current
    lastStep.current = step
    const body = bodyRef.current
    const view = viewRef.current
    if (!shown || body === null || view === null) return
    if (before !== null && before.key !== step.key) {
      view.scrollTop = 0
      return
    }
    if (before === null) return
    // A step back to the front (the Preview's again, YAZ-5152): the top, at once.
    if (step.sides < before.sides || step.open.length < before.open.length) {
      view.scrollTop = 0
      return
    }
    // Round 4 (Yaseen: "with mouse clicking, you are trying to unveil that current one"): a click shows that word and
    // the view stays put, wherever the next blank is. The next Space follows from where the view is.
    if (step.by === 'mouse') return
    // What the step showed: the new side (by its top: its first line, the line between the sides above it), or the word.
    const side = step.sides > before.sides ? body.querySelector(`.card__side[data-side="${step.sides - 1}"]`) : null
    const word = side === null && step.open.length > before.open.length && step.last !== null ? body.querySelector(`[data-hidden="${step.last}"]`) : null
    const showed = side ?? word
    if (showed === null) return
    const s = showed.getBoundingClientRect()
    const shownSpan = side === null ? { start: s.top, end: s.bottom } : { start: s.top, end: s.top }
    // Round 3 (Yaseen: "the thing it should be following is the NEXT fill in"): the blank the next Space shows, the one
    // "Mark the next hidden word" colours (`data-next`, the render's own; never worked out again here). None shown yet
    // (the next Space shows a side): what the step showed, as round 2.
    const next = body.querySelector('[data-next]')
    const room = inboxRoom(view)
    let dy: number
    if (done) {
      // THE END: no blank left. The card's end — the Reviews strip under it (YAZ-5105) or the card's frame — comes in,
      // as far as what the step showed stays in sight (⌘F's rule over the two: a long end stops at the word).
      const end = (view.querySelector('.card-reviews--strip') ?? body.closest('.card-inbox__panel') ?? body).getBoundingClientRect()
      dy = leastScroll({ start: shownSpan.start, end: Math.max(shownSpan.end, end.bottom) }, room, SHOW_GAP)
    } else if (next !== null) {
      const n = next.getBoundingClientRect()
      dy = readingScroll({ start: n.top, end: n.bottom }, room)
    } else dy = readingScroll(shownSpan, room)
    if (dy !== 0) glideView(view, dy)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `done` follows the step: it changes only with it
  }, [step.key, step.sides, step.open.length, shown])
  // The card's sound never outlives it (YAZ-5014): the next card, a hidden view and its close stop it.
  useEffect(() => stopCardAudio, [step.key, shown])
}

/** "Side 1 of 2" (YAZ-5048), quiet, on the right of the row above the card; one side says nothing. */
export function CardSideCount({ steps }: { steps: Pick<CardSteps, 'counts' | 'step'> }) {
  const { counts, step } = steps
  if (counts.length <= 1) return null
  return <span className="card-inbox__sides">{`Side ${Math.min(step.sides, counts.length)} of ${counts.length}`}</span>
}

/** The card's frame (YAZ-5019): the panel, its two width edges (a drag sizes the card, centred), and its body. */
export function InboxCardPanel({ startDrag, bodyRef, children }: { startDrag: (side: -1 | 1) => (event: ReactPointerEvent<HTMLElement>) => void; bodyRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div className="card-inbox__panel">
      <div className="card-inbox__edge" data-side="left" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(-1)} />
      <div className="card-inbox__edge" data-side="right" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(1)} />
      <div ref={bodyRef} className="card-inbox__body">
        {children}
      </div>
    </div>
  )
}

/**
 * The card itself at its step: the page's own render (`CardBody`), the marked blank coloured. A click (YAZ-5049 round 4):
 * on a blank, that word; on a shown word, nothing new; elsewhere on the card, the marked word — but not on a link or a
 * sound. A mouse never scrolls.
 */
export function InboxCardFace({ text, path, vault, steps, doors, onStep }: { text: string; path: string; vault: ExploreVault; steps: Pick<CardSteps, 'step' | 'mark' | 'showWord'>; doors: CardLinkDoors; onStep: (by: 'mouse') => void }) {
  const { step, mark, showWord } = steps
  return (
    <div
      className="card card-screen card-inbox__card"
      onClick={(e) => {
        if (!(e.target instanceof Element) || e.target.closest(`a[href], ${CARD_OPENS}, ${CARD_MEDIA}`) !== null) return
        const word = e.target.closest<HTMLElement>('.card__blank, .card__hidden')
        if (word === null) return onStep('mouse')
        if (word.classList.contains('card__blank')) showWord(Number(word.dataset.hidden))
      }}
    >
      <CardBody text={text} path={path} vault={vault} show={{ sides: step.sides, ...shownParts(step.open), next: mark ?? undefined }} doors={doors} />
    </div>
  )
}
