/**
 * THE INBOX CARD, shared (YAZ-5152): the card as the Inbox shows it — its front and its head title, Space's steps
 * (the next hidden word, then the next side), the scroll that follows them, the card's frame with its width edges,
 * "Side 1 of 2", and the step the Reviews strip waits for. The Inbox (`CardInbox`) and the card Preview
 * (`CardPreview`) both draw their card with these, so a preview IS the Inbox's card: no copy of its look or its steps.
 * What each adds is its own: the Inbox its answers, its timer and its session; the Preview none of them.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { reviewTitleOf, type CardTitleAt, type CardTitleShow } from '@shared/cardLine'
import { reviewTitleAt, titleShows, titleStepOf, type TitleStep } from '@shared/cardTitleShows'
import { cardSides, hiddenCount } from '@shared/cardText'
import type { ExploreVault } from '../explore/ExplorePage'
import { CardBody, type CardLinkDoors } from './cardParts'
import { CARD_MEDIA, CARD_OPENS, stopCardAudio } from '../editor/card/cardMedia'
import { glideToBottomIfNear, glideView, spaceMove } from './inboxScroll'
import { START, hide, markOf, nextStep, reveal, shownParts, type Reveal } from './cardSteps'

/** The step a card is at (D18): how many sides show, which hidden words, and the marked blank (`cardSteps.ts`, YAZ-5049 round 4). */
export interface CardStep extends Reveal {
  key: string | null
}

/**
 * The card's front and head title (YAZ-5030, YAZ-5308). The front is the card's text (its sides only) and the head shows
 * its title, off its card line: never part of the text, so it is never a Space step. "Title hidden in review" (`notitle`)
 * means no title at all, at every step (YAZ-5695, `reviewTitleOf`): no band, fully shown too; so does the global Never
 * (YAZ-5696 round 2) for a card with no timing of its own.
 */
export function useCardFront(pageText: string | null, card: { title: string; notitle?: boolean; titleAt?: CardTitleAt }, global: CardTitleShow): { text: string | null; title: string } {
  return { text: pageText, title: pageText === null ? '' : reviewTitleOf(card, global) }
}

/**
 * The band's title at this step (YAZ-5696): `title` is Review's (`reviewTitleOf`: '' when hidden in review, no band);
 * `waits` while `titleShows` says it is not time yet: the card's own choice (`own`), else the global `titleAt`.
 */
export function bandTitle(title: string, own: CardTitleAt | undefined, global: CardTitleShow, steps: Pick<CardSteps, 'counts' | 'step'>): { text: string; waits: boolean } {
  const at = reviewTitleAt(own, global)
  return { text: title, waits: title !== '' && !titleShows({ title, at, counts: steps.counts, sides: steps.step.sides, open: steps.step.open, titled: steps.step.titled }) }
}

/** Where the band's title is its own Space (YAZ-5709, `titleStepOf`): the same card, own and global choices as `bandTitle`. */
export const bandTitleStep = (title: string, own: CardTitleAt | undefined, global: CardTitleShow): TitleStep => titleStepOf(title, reviewTitleAt(own, global))

export interface CardSteps {
  /** Each side's hidden words. */
  counts: number[]
  step: CardStep
  /** Every side and every hidden word shows. */
  done: boolean
  /** YAZ-5048: the next Space shows the next side (the sides that show have no hidden word left, the title's own step past). */
  nextSide: boolean
  /** YAZ-5995: the next Space shows the title (its own step, YAZ-5709). */
  titleNow: boolean
  /** The blank the next Space shows (YAZ-5049 round 4: after a click, the next one still hidden after the clicked word); null when the title is next. */
  mark: number | null
  /** YAZ-5105 round 3: the last side shows, past the front (a one-side card: past its first Space, or nothing hidden). */
  onLastSide: boolean
  /**
   * One step (D18): the marked word, else the next side. `by` says what asked: a mouse never moves the view (YAZ-5049
   * round 4). A key (round 6): when what it would show is out of view, it only scrolls it in (`spaceMove`) and the next
   * key shows it; a key that shows never scrolls, so the word just shown stays still. At the end, a key brings the card's
   * end in first. False when nothing happened (the end, in view).
   */
  stepOn: (by?: 'key' | 'mouse') => boolean
  /** A click on a blank (YAZ-5049 round 4): THAT word shows, the view stays put. */
  showWord: (word: number) => void
  /** A click on a shown word (round 6): it hides again and is marked next. */
  hideWord: (word: number) => void
  /** Back to the front, at the top (the Preview's Space at the end, YAZ-5152). */
  restart: () => void
}

/**
 * Space's steps over `text`, the card `cardKey` (a new key starts at the front), in the scrolled view `viewRef`; `title`
 * where the title is its own step (YAZ-5709, `bandTitleStep`).
 */
export function useCardSteps(text: string | null, cardKey: string | null, viewRef: RefObject<HTMLElement | null>, title: TitleStep = null): CardSteps {
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<CardStep>({ ...START, key: cardKey })
  const step: CardStep = stepState.key === cardKey ? stepState : { ...START, key: cardKey }
  // A card that goes and comes back (⌘Z after the last answer) starts again from its first step.
  useEffect(() => setStep((s) => (s.key === cardKey ? s : { ...START, key: cardKey })), [cardKey])
  const hiddenUpTo = useCallback((sides: number): number => counts.slice(0, sides).reduce((a, b) => a + b, 0), [counts])
  const after = text === null ? null : nextStep(step, counts, title)
  const done = text !== null && after === null
  const nextSide = after !== null && after.sides > step.sides
  const titleNow = after !== null && after.titled && !step.titled
  const mark = titleNow ? null : markOf(step, hiddenUpTo(step.sides))
  const onLastSide = text !== null && step.sides >= counts.length && (step.sides > 1 || step.open.length > 0 || done)
  const scrollBottomRef = useRef(false)
  useEffect(() => {
    if (!done || !scrollBottomRef.current) return
    scrollBottomRef.current = false
    const view = viewRef.current
    if (view !== null) glideToBottomIfNear(view)
  }, [done, step.key, viewRef])
  const stepOn = useCallback(
    (by: 'key' | 'mouse' = 'key'): boolean => {
      if (text === null) return false
      // The title's own step (YAZ-5709) shows at the card's top, in the band: nothing to bring into view.
      // Round 5 (Yaseen: "Yes, build it"): Space never shows a blank you cannot see. Round 6 (Yaseen: "certain space
      // clicks that are actually oriented towards just moving the screen"): the same for the next side and the end.
      const view = viewRef.current
      if (by === 'key' && view !== null && !titleNow) {
        const dy = spaceMove(view, done ? 'end' : (mark ?? 'side'))
        if (dy !== 0) {
          glideView(view, dy)
          return true
        }
      }
      if (after === null) return false
      // YAZ-6058: on a final blank reveal (not a newly opened long Side 2), glide to the bottom only if already close.
      if (by === 'key' && !nextSide && nextStep(after, counts, title) === null) scrollBottomRef.current = true
      setStep({ ...after, key: step.key })
      return true
    },
    [done, after, text, step, viewRef, titleNow, mark, counts, title, nextSide],
  )
  const showWord = useCallback(
    (word: number) => {
      if (text === null) return
      const next = reveal(step, word, hiddenUpTo(step.sides))
      if (next !== step) setStep({ ...next, key: step.key })
    },
    [text, step, hiddenUpTo],
  )
  const hideWord = useCallback(
    (word: number) => {
      const next = hide(step, word)
      if (next !== step) setStep({ ...next, key: step.key })
    },
    [step],
  )
  const restart = useCallback(() => {
    setStep({ ...START, key: cardKey })
    if (viewRef.current !== null) viewRef.current.scrollTop = 0
  }, [cardKey, viewRef])
  return { counts, step, done, nextSide, titleNow, mark, onLastSide, stepOn, showWord, hideWord, restart }
}

/**
 * YAZ-5049: the Inbox's view and its steps. Round 2: the card is one long page, as in Mochi (no scroll bar of its own:
 * the view scrolls, its top and bottom rows stay). Round 6: a step never scrolls (`stepOn` scrolls INSTEAD of a step);
 * a new card starts at its top, at once.
 */
export function useStepScroll(steps: Pick<CardSteps, 'step'>, shown: boolean, viewRef: RefObject<HTMLElement | null>): void {
  const { key } = steps.step
  const lastKey = useMemo(() => ({ current: undefined as string | null | undefined }), [])
  useEffect(() => {
    const before = lastKey.current
    lastKey.current = key
    const view = viewRef.current
    if (shown && view !== null && before !== undefined && before !== key) view.scrollTop = 0
  }, [key, shown, lastKey, viewRef])
  // The card's sound never outlives it (YAZ-5014): the next card, a hidden view and its close stop it.
  useEffect(() => stopCardAudio, [key, shown])
}

/** "Side 1 of 2" (YAZ-5048), quiet, on the right of the row above the card; one side says nothing. */
export function CardSideCount({ steps }: { steps: Pick<CardSteps, 'counts' | 'step'> }) {
  const { counts, step } = steps
  if (counts.length <= 1) return null
  return <span className="card-inbox__sides">{`Side ${Math.min(step.sides, counts.length)} of ${counts.length}`}</span>
}

/** The card's frame (YAZ-5019): the panel, its two width edges (a drag sizes the card, centred), its title band (YAZ-5308 A3), and its body. */
export function InboxCardPanel({ startDrag, bodyRef, band, more, children }: { startDrag: (side: -1 | 1) => (event: ReactPointerEvent<HTMLElement>) => void; bodyRef: RefObject<HTMLDivElement | null>; band?: ReactNode; /** The card's ⋯ at the top right of the head band (YAZ-5963, the Inbox's; not the Preview's). */ more?: ReactNode; children: ReactNode }) {
  return (
    <div className="card-inbox__panel">
      <div className="card-inbox__edge" data-side="left" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(-1)} />
      <div className="card-inbox__edge" data-side="right" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(1)} />
      {band}
      {more}
      <div ref={bodyRef} className="card-inbox__body">
        {children}
      </div>
    </div>
  )
}

/**
 * The card itself at its step: the page's own render (`CardBody`), the marked blank coloured. A click (YAZ-5049 round 4):
 * on a blank, that word; on a shown word, it hides again (round 6); elsewhere on the card, the marked word — but not on
 * a link or a sound. A mouse never scrolls.
 */
export function InboxCardFace({ text, path, vault, steps, doors, onStep, tour }: { text: string; path: string; vault: ExploreVault; steps: Pick<CardSteps, 'step' | 'mark' | 'showWord' | 'hideWord'>; doors: CardLinkDoors; onStep: (by: 'mouse') => void; /** The guided tour's mark (YAZ-5123), in the Inbox only. */ tour?: string }) {
  const { step, mark, showWord, hideWord } = steps
  return (
    <div
      className="card card-screen card-inbox__card"
      data-tour={tour}
      onClick={(e) => {
        if (!(e.target instanceof Element) || e.target.closest(`a[href], ${CARD_OPENS}, ${CARD_MEDIA}`) !== null) return
        const word = e.target.closest<HTMLElement>('.card__blank, .card__hidden')
        if (word === null) return onStep('mouse')
        const n = Number(word.dataset.hidden)
        if (word.classList.contains('card__blank')) showWord(n)
        else hideWord(n)
      }}
    >
      <CardBody text={text} path={path} vault={vault} show={{ sides: step.sides, ...shownParts(step.open), next: mark }} doors={doors} />
    </div>
  )
}
