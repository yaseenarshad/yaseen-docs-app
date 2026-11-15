import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useAnswerTimer } from '@client/review/answerTimer'
import { cardStateText } from '@client/review/cardInboxChip'
import { START, markOf, reveal, shownParts, type Reveal } from '@client/review/cardSteps'
import { progressRuns } from '@client/review/inboxMenu'
import { addedLine, resetLine, waitingLine } from '@client/review/cardWords'
import { reviewDuration, todayCards, todayDuration } from '@client/review/reviewTime'
import { useCardReview, type CardReviewApi, type CardReviewSession } from '@client/review/useCardReview'
import type { UnitText } from '@client/vault/unitWordText'
import { cardFileShape } from '@shared/cardFileFormat'
import { cardIdOf, isCardFix, pageCards, withCardFix, type CardRating } from '@shared/cardLine'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardSides, hiddenCount } from '@shared/cardText'
import { splitFrontmatter } from '@shared/frontmatter'
import type { ReviewHost } from '@client/review/reviewHost'
import type { ReviewSettings } from '@shared/reviews'
import { openPhoneDays, phoneReviewHost } from '../answers/reviewHost'
import type { AnswersState } from '../answers/answers'
import type { ReviewLink } from './link'
import { storedMedia, type VaultMedia } from '../media/ui/vaultMedia'
import { lostRows } from '../status/dot'
import { PhoneCard, type CardLinkOpen } from './PhoneCard'
import { createReviewSource, type ReviewSource } from './source'
import { setReviewInProgress } from './inProgress'
import { useTapGuard } from './tapGuard'
import { useWakeLock } from './wakeLock'
import { FILTER_ICON, NEEDS_FIX, UNDO_SHOWN_MS, filterDone, filterLabel, hintText, lostTitle } from './words'
import { DiscardAnswer } from '../screens/DiscardAnswer'
import { useReviewTop } from '../screens/reviewTop'
import { glideCard, moreBelow, tapMove, type TapTarget } from './cardScroll'
import { ScrollJump } from '../page/ScrollJump'
import { readNewFrom, saveNewFrom } from './newFromPick'
import { ReviewSheet } from './ReviewSheet'
import './review.css'

/**
 * THE REVIEW TAB (4B, YAZ-5078; decision 11): the Mac's Inbox with taps in place of keys, also with no signal. The
 * review RULES are the Mac's own hook (`useCardReview`, decision 3) with the phone's host (3C: it writes actions to the
 * answer list, never files); the card is the Mac's own drawing (`PhoneCard`). The mockup (version 9) is the spec.
 *
 *  - The top row: the filter "All cards ▾" (round 10, addition 1: All cards, Up next, Due today, New cards, with
 *    counts) and today's work, "Today: 31 cards · 9 min".
 *  - Above the card: its state ("Due today", "New card") and "3 of 12"; then the head, "Title · ID", with "in <page>"
 *    for a card in a page (round 15, item 4). The title is the card line's (YAZ-5308, decision D; YAZ-5309): never a
 *    line of the card's text, so the text is drawn whole. A card with no title: the ID alone, as the Mac's Inbox head.
 *    "Title on the front: Hide" (`notitle`): the ID alone until the card is fully shown; so too a title that holds a
 *    hidden-word mark (YAZ-5314: a title never gives the answer away). A card file that is not valid says so (round
 *    15, item 3).
 *  - A TAP ON THE CARD shows the next hidden word, else the next side: what Space does on the Mac. No swipes.
 *  - At the bottom, in reach of the thumb: ✕ Forgot and ✓ Remembered (or four by the setting), then ⋯: Archive card,
 *    Up next, Fix later, Open page (a card file: Open card). The answer buttons work at any step, as on the Mac.
 *  - "Answered · Undo" under the buttons: Undo takes back the last answer (or the last "Add more").
 *  - Done: "Inbox complete", today's work, and "Add more for today" (round 10, addition 2) when cards wait.
 *  - The amber line (round 12, item 9): an answer whose card is gone, with Discard.
 *  - The screen stays on while a card shows (round 10, addition 4). The answer timer stops in the background
 *    (addition 5: the Mac's `useAnswerTimer` pauses on `visibilitychange`).
 */
export interface ReviewViewProps {
  link: ReviewLink
  /** The open vault's id (`vaultId`). */
  vault: string
  /** Its name, as the top bar says it. */
  vaultName: string
  /** The vault's word for "page" (round 15, item 5). */
  unit: UnitText
  /** "Open page" and "Open card", and a tap on a pill: 4C's read-only views. */
  open: (to: CardLinkOpen) => void
  /** The app's media (`useVaultMedia`). Absent: `link.media`, else the store alone. */
  media?: VaultMedia
  /**
   * The tab is on the screen (YAZ-5224: the shell keeps it mounted behind a page, a card, another tab). Off the screen
   * the session stays; the answer timer and the Wake Lock rest. Default true.
   */
  shown?: boolean
}

interface Setup {
  host: ReviewHost
  source: ReviewSource
  media: VaultMedia
  /** This phone's pick of the folders new cards come from (`newFromPick.ts`); null: the Mac's. */
  pick: string[] | null
}

/** ONE source and ONE host for the life of the vault (the hook follows their identity). */
export function ReviewView(props: ReviewViewProps) {
  const { link, vault, vaultName } = props
  const given = props.media ?? link.media
  const [setup, setSetup] = useState<Setup | null>(null)
  useEffect(() => {
    let live = true
    const source = createReviewSource(link, vault, vaultName)
    const own = given === undefined ? storedMedia(link.store, vault) : null
    const media = given ?? own!
    void Promise.all([openPhoneDays(link.store, vault), readNewFrom(link.store, vault)]).then(([days, pick]) => {
      if (live) setSetup({ source, media, pick, host: phoneReviewHost({ answers: link.answers, days, vaultName: () => vaultName }) })
    })
    return () => {
      live = false
      source.stop()
      own?.release()
      setSetup(null)
    }
  }, [link, vault, vaultName, given])
  if (setup === null) return <Waiting />
  return <ReviewSession {...props} source={setup.source} host={setup.host} media={setup.media} pick={setup.pick} />
}

function Waiting() {
  return (
    <div className="review review--waiting" aria-busy="true">
      <p className="muted">Reading your cards…</p>
    </div>
  )
}

/** The source's state, read again on each change. */
function useSourceState(source: ReviewSource) {
  const version = useRef(0)
  const subscribe = useCallback((wake: () => void) => source.subscribe(() => (version.current++, wake())), [source])
  useSyncExternalStore(subscribe, () => version.current)
  return { ready: source.ready, settings: source.settings }
}

function useAnswersState(link: ReviewLink): AnswersState {
  const [state, setState] = useState(() => link.answers.state())
  useEffect(() => {
    setState(link.answers.state())
    return link.answers.subscribe((e) => void (e.type === 'state' && setState(e.state)))
  }, [link])
  return state
}

/** The step a card is at: how many sides show, which hidden words, and the marked one (the Mac's `cardSteps.ts`). */
type Step = Reveal & { key: string | null }

/** The line under the buttons: the last answer, the last add, or a ⋯ action. */
/** The line under the buttons: the last answer, the last ⋯ mark (with its own Undo: YAZ-5078), or Archive card. */
type Line = { kind: 'answer'; count: number; id: string } | { kind: 'mark'; text: string; key: string | null; undo?: () => Promise<unknown> } | { kind: 'archive' }

function ReviewSession({ link, vault, vaultName, unit, open, source, host, media, pick: firstPick, shown = true }: ReviewViewProps & Setup) {
  const { ready, settings: vaultSettings } = useSourceState(source)
  // YAZ-5415: where new cards come from — the Mac's rule (`setNewFrom` → `saveSettings` → `newFrom`), this phone's pick.
  const [pick, setPick] = useState(firstPick)
  const settings = useMemo(() => (pick === null ? vaultSettings : { ...vaultSettings, newFrom: pick }), [vaultSettings, pick])
  const saveSettings = useCallback(
    (next: ReviewSettings) => {
      setPick(next.newFrom)
      void saveNewFrom(link.store, vault, next.newFrom)
    },
    [link, vault],
  )
  const [notice, setNotice] = useState<string | null>(null)
  // No inner error text reaches the screen (YAZ-5076, YAZ-5228): the hook's words before the reason, e.g. "Can't undo the answer.".
  const onNotice = useCallback((text: string) => setNotice(`${text.split(':')[0].trim()}.`), [])
  const review = useCardReview(vault, source, settings, onNotice, vaultName, host, saveSettings)
  const { session } = review

  // A session starts once the first index is in (an empty list is not "Inbox complete"), and again after review was off.
  const { start } = review
  useEffect(() => {
    if (ready && settings.enabled && session === null) start()
  }, [ready, settings.enabled, session, start])

  // YAZ-5269: the one fact the update logic reads: a card on show, or an Undo still to give, on any tab.
  const inProgress = session !== null && (session.card !== null || session.canUndo)
  useEffect(() => setReviewInProgress(inProgress), [inProgress])
  useEffect(() => () => setReviewInProgress(false), [])

  const answers = useAnswersState(link)
  // A pass that ends well asks again for each picture that waited for a signal.
  const { engine } = link
  const retry = useCallback((fn: () => void) => engine.subscribe((e) => void (e.type === 'state' && e.state.status === 'synced' && fn())), [engine])
  // ONE owner of the Wake Lock (YAZ-5232): this session, while its card is on the screen.
  useWakeLock(shown && session?.card != null)

  if (!ready) return <Waiting />
  if (!settings.enabled)
    return (
      <div className="review review--off">
        <p className="muted">Review is off in this vault. Turn it on in Settings › Cards on the Mac.</p>
      </div>
    )
  if (session === null) return <Waiting />
  return <SessionScreen {...{ link, unit, open, source, host, media, retry, review, session, answers, notice, setNotice, shown }} />
}

function SessionScreen({
  link,
  unit,
  open,
  source,
  host,
  media,
  retry,
  review,
  session,
  answers,
  notice,
  setNotice,
  shown,
}: {
  link: ReviewLink
  unit: UnitText
  open: (to: CardLinkOpen) => void
  source: ReviewSource
  host: ReviewHost
  media: VaultMedia
  retry: (fn: () => void) => () => void
  review: CardReviewApi
  session: CardReviewSession
  answers: AnswersState
  notice: string | null
  setNotice: (text: string | null) => void
  shown: boolean
}) {
  const card = session.card
  const page = card?.page ?? null
  const pageText = page?.text ?? null
  // The head's title, off the card line (YAZ-5308; the Mac's `useCardFront`): never part of the text, so the front is
  // the whole text. "Title on the front: Hide" (YAZ-5030) makes it wait for the card's last step; so does a title that
  // holds a hidden-word mark (YAZ-5314): its words may be the answer.
  const text = pageText
  const cardName = page?.title ?? ''
  const hideTitle = page?.notitle === true
  const title = useMemo(() => ({ text: pageText === null ? '' : cardName, waits: hideTitle || hiddenCount(cardName) > 0 }), [pageText, cardName, hideTitle])
  const record = card === null ? undefined : source.records.find((r) => r.path === card.path)
  const cardFile = record?.kind === 'card'
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`

  // The step (D18; YAZ-5415 follows the Mac's `cardSteps.ts`, YAZ-5049 round 4): a tap shows the MARKED part (the next
  // hidden one), else the next side; a tap ON a hidden part shows THAT part, and the mark goes on after it.
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<Step>({ ...START, key: cardKey })
  const step: Step = stepState.key === cardKey ? stepState : { ...START, key: cardKey }
  const upTo = (sides: number) => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.open.length >= upTo(counts.length)
  const mark = markOf(step, upTo(step.sides))
  // What the hint line counts: the hidden parts not shown yet, and each side still to come.
  const left = text === null ? 0 : upTo(counts.length) - step.open.length + Math.max(0, counts.length - step.sides)
  // YAZ-5226: after an answer, taps wait until the next card is on the screen AND a short time has passed, so the
  // second tap of a double tap never lands on a card the person has not seen. The answer buttons still work at any
  // step of a card once it is seen (decision 11, as the Mac: "the buttons should always be there").
  const guard = useTapGuard()
  const guarded = !guard.taps
  const liveKey = useRef(cardKey)
  liveKey.current = cardKey
  const liveAnswered = useRef(session.answered.length)
  liveAnswered.current = session.answered.length
  // YAZ-5315: the guard's 400 ms start when the NEXT card is drawn on the screen (a new key, with its text).
  const { shown: cardShown } = guard
  // A DRAWING is one read of a card (its page object): the hook keeps the old card's object on the screen while the
  // next one reads, and a card that comes back is read again (a new object).
  // YAZ-5335: only a card that is LIVE counts (its answers are fixed: the hook gives none to the card before, which it
  // keeps on show while the next one reads). So a sync pass that redraws the answered card starts no 400 ms.
  const drawing = page === null || session.answers === null ? null : drawingOf(page)
  useEffect(() => {
    if (drawing !== null) cardShown(drawing)
  }, [drawing, cardShown])
  // Hidden and shown again: the guard starts from `ready` (YAZ-5266).
  const { reset: resetGuard } = guard
  useEffect(() => resetGuard(), [shown, resetGuard])

  const cardBox = useRef<HTMLDivElement>(null)
  // The end of the card (YAZ-5415; the Mac's end cue, YAZ-5049 round 3): one more tap when every part shows makes ✕
  // and ✓ bounce once with a soft ring. Two names, so each new tap plays it again.
  const [nudge, setNudge] = useState<{ key: string | null; n: number }>({ key: null, n: 0 })
  // The part a step just showed: it flashes once, and VoiceOver hears it.
  const lastShown = useRef<number | null>(null)
  const advance = () => {
    if (page === null || guarded) return
    const target: TapTarget = mark !== null ? mark : step.sides < counts.length ? 'side' : 'end'
    // The Mac's reading scroll (YAZ-5049 round 6): a part out of view first comes into view; that tap shows nothing.
    const view = cardBox.current
    const move = view === null ? 0 : tapMove(view, target)
    if (move !== 0 && view !== null) return glideCard(view, move)
    if (done || target === 'end') return setNudge({ key: cardKey, n: nudge.key === cardKey ? nudge.n + 1 : 1 })
    if (typeof target === 'number') {
      lastShown.current = target
      return setStep({ ...reveal(step, target, upTo(step.sides)), key: step.key })
    }
    lastShown.current = null
    setStep({ ...step, sides: step.sides + 1, next: null })
  }
  /** A tap on a hidden part (the Mac's click on a blank): THAT part shows. */
  const showPart = (word: number) => {
    if (page === null || guarded || step.open.includes(word) || word >= upTo(step.sides)) return
    lastShown.current = word
    setStep({ ...reveal(step, word, upTo(step.sides)), key: step.key })
  }

  // YAZ-5229, YAZ-5268: VoiceOver hears ONLY what a step newly shows: a new side (its text), else the new word.
  const [revealed, setRevealed] = useState('')
  const lastStep = useRef<Step>(step)
  useEffect(() => {
    const before = lastStep.current
    lastStep.current = step
    if (before.key !== step.key || (step.open.length === 0 && step.sides === 1)) return setRevealed('')
    const body = cardBox.current?.querySelector('.phone-card__body')
    // The part that shows flashes once (the drawing is in: the card draws in its own effect, before this one).
    const word = step.open.length > before.open.length ? lastShown.current : null
    if (word !== null) body?.querySelector(`[data-hidden="${word}"]`)?.classList.add('review__flash')
    const id = setTimeout(() => {
      if (body == null) return
      if (step.sides > before.sides) {
        const side = body.querySelector(`.card__side[data-side="${step.sides - 1}"]`)
        // YAZ-5314: what VoiceOver reads of the side: a hidden word is "Hidden word", never its text.
        setRevealed(side === null ? '' : spokenText(side))
      } else if (word !== null) setRevealed((body.querySelector(`[data-hidden="${word}"]`)?.textContent ?? '').trim())
    }, 0)
    return () => clearTimeout(id)
  }, [step.key, step.sides, step.open]) // eslint-disable-line react-hooks/exhaustive-deps

  // No scroll bar (YAZ-5415, round 4): a soft fade and "↓ more" while more of the card lies below; both go at its end.
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const view = cardBox.current
    if (view === null) return setMore(false)
    const check = () => setMore(moreBelow(view))
    check()
    view.addEventListener('scroll', check, { passive: true })
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null
    const body = view.querySelector('.phone-card__body')
    watch?.observe(view)
    if (body !== null) watch?.observe(body)
    return () => {
      view.removeEventListener('scroll', check)
      watch?.disconnect()
    }
  }, [cardKey, text, step.sides, step.open])
  // A new card starts at its top.
  useLayoutEffect(() => {
    if (cardBox.current !== null) cardBox.current.scrollTop = 0
  }, [cardKey])

  // The buttons' reviews are fixed when the card shows (D13): the answer writes what was fixed.
  const { showAnswers } = review
  useEffect(() => {
    if (page !== null && session.answers === null) showAnswers()
  }, [page, session.answers, showAnswers])

  // Addition 5: the seconds of this card, from the moment its text shows; they stop while the app is in the background.
  const seconds = useAnswerTimer(page === null ? null : cardKey, shown, review.settings.pauseAfter)

  // A card file that is not valid (round 15, item 3): its first card shows, with one line.
  const [needsFix, setNeedsFix] = useState<string | null>(null)
  // The Fix later mark of the card on show (the hook's card has no `fix`): read from the phone's view of its file.
  const [fixOn, setFixOn] = useState<{ key: string; on: boolean } | null>(null)
  useEffect(() => {
    if (card === null || page === null) return
    let live = true
    void link.answers.text(card.path).then((content) => {
      if (!live || content === null) return
      const line = pageCards(content).find((c) => cardIdOf(c.line) === card.id)?.line
      setFixOn({ key: `${card.path}\n${card.id}`, on: line !== undefined && isCardFix(line) })
      setNeedsFix(cardFile && cardFileShape(splitFrontmatter(content).body).problem !== 'ok' ? card.path : null)
    })
    return () => {
      live = false
    }
  }, [card, page, cardFile, link])
  const fixed = card !== null && fixOn?.key === `${card.path}\n${card.id}` && fixOn.on

  const [menu, setMenu] = useState<'filter' | 'more' | null>(null)
  const [line, setLine] = useState<Line | null>(null)
  const ratings = answerRatings(review.settings)

  // An open menu closes on a tap outside it, and that tap does nothing else (as the mockup).
  const closedByTap = useRef(false)
  useEffect(() => {
    if (menu === null) return
    const down = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.review__sheet, .review__menu, .review__count-btn, .review__more') !== null) return
      closedByTap.current = true
      // A press that never becomes a click on this screen (the tab bar, a scroll) leaves no flag behind.
      setTimeout(() => void (closedByTap.current = false), 600)
      setMenu(null)
    }
    const key = (e: KeyboardEvent) => void (e.key === 'Escape' && setMenu(null))
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  const answerWith = (rating: CardRating) => {
    if (page === null || card === null || guarded) return
    setMenu(null)
    setNotice(null)
    const fromDrawing = drawingOf(page)
    const earlier = line
    const answeredBefore = session.answered.length
    setLine({ kind: 'answer', count: answeredBefore + 1, id: card.id })
    // YAZ-5266: the guard's one way through an answer; a failed save keeps this card on the screen, and taps act again.
    void guard.answer(
      async () => {
        await review.answer(rating, seconds())
        // Let the next card draw before the guard reads the screen.
        await new Promise((r) => setTimeout(r, 0))
        // YAZ-5316: a save that failed counts no answer; the line goes back to what it said (the earlier Undo stays).
        if (liveAnswered.current === answeredBefore) setLine(earlier)
      },
      // `sameCard`: the save failed (no answer counted; the card stays). The next card's drawing starts the 400 ms.
      () => ({ sameCard: liveAnswered.current === answeredBefore, cardOnScreen: liveKey.current !== null }),
      fromDrawing,
    )
  }
  // YAZ-5228: an answer whose card was gone at the send is in the amber line. Its Undo takes it away cleanly (as
  // Discard), and never asks the host for a card that is not there.
  const lostRow = line?.kind === 'answer' ? lostRows(answers.lost).find((r) => r.id === line.id && answers.lost.some((l) => r.seqs.includes(l.seq) && l.op.kind === 'review')) : undefined
  const undo = () => {
    setMenu(null)
    setNotice(null)
    guard.undo()
    // YAZ-5078: Undo of Up next or Fix later: the inverse, through the host (an unsent mark leaves the list).
    if (line?.kind === 'mark' && line.undo !== undefined) {
      const run = line.undo
      setLine(null)
      return void run().catch(() => setNotice('That did not save. Try again.'))
    }
    if (lostRow === undefined) return void review.undo()
    setLine({ kind: 'mark', text: 'Answer removed', key: cardKey })
    void Promise.all(lostRow.seqs.map((seq) => link.answers.discard(seq)))
  }
  const act = (text: string, run: () => Promise<unknown>, undoIt?: () => Promise<unknown>) => {
    setMenu(null)
    setNotice(null)
    const saved = run().then(
      () => true,
      () => {
        setNotice('That did not save. Try again.')
        return false
      },
    )
    // YAZ-5334: the Undo waits for the mark's own save, so it never reads the line before the mark is in it (a tap
    // during the save was lost). Then the host's rule decides: an unsent mark leaves the list; a tried one gets its
    // inverse as an action. A mark that did not save has nothing to take back.
    const undoAfter = undoIt === undefined ? undefined : () => saved.then((ok) => (ok ? undoIt() : undefined))
    setLine({ kind: 'mark', text, key: cardKey, undo: undoAfter })
  }
  // YAZ-5078 (the phone's decision): Archive card is on the hook's Undo stack; the line says "Archived · Undo".
  const archive = () => {
    setMenu(null)
    setNotice(null)
    setLine({ kind: 'archive' })
    void review.turnOff()
  }
  const toggleFix = () => {
    if (card === null) return
    const on = !fixed
    const set = (to: boolean) => async () => {
      await host.changeCardLine(card.path, card.id, (l) => withCardFix(l, to))
      setFixOn({ key: `${card.path}\n${card.id}`, on: to })
    }
    act(on ? 'Marked: Fix later' : 'Removed: Fix later', set(on), set(!on))
  }

  // The line (an answer, an add or Reset, a mark, Archive card) shows while what it names is still the last thing done.
  const answeredNow = session.answered.length
  const shownLine =
    session.lastAdd !== null
      ? { kind: 'add', text: session.lastAdd.reset ? resetLine(session.lastAdd.kind) : addedLine(session.lastAdd.kind, session.lastAdd.count), undo: session.canUndo }
      : line?.kind === 'answer' && line.count === answeredNow && answeredNow > 0
        ? { kind: 'answer', text: 'Answered', undo: session.canUndo || lostRow !== undefined }
        : line?.kind === 'archive' && session.lastArchive !== null
          ? { kind: 'archive', text: 'Archived', undo: session.canUndo }
          : line?.kind === 'mark' && line.key === cardKey
            ? { kind: 'mark', text: line.text, undo: line.undo !== undefined }
            : line?.kind === 'mark' && line.text === 'Answer removed'
              ? { kind: 'mark', text: line.text, undo: false }
              : null
  // YAZ-5415 (round 5): the line sits IN the hint line for about 4 seconds, then goes; Undo stays in ⋯.
  const [fresh, setFresh] = useState<object | null>(null)
  const lineId = session.lastAdd ?? line
  useEffect(() => {
    if (lineId === null) return
    setFresh(lineId)
    const id = setTimeout(() => setFresh((f) => (f === lineId ? null : f)), UNDO_SHOWN_MS)
    return () => clearTimeout(id)
  }, [lineId])
  const quietLine = shownLine !== null && fresh === lineId ? shownLine : null
  // ⋯'s "Undo last answer": whatever the line's Undo would take back, also after the line went.
  const canUndo = shownLine?.undo === true || session.canUndo

  const headTitle = title.waits && !done ? '' : title.text
  const addKinds = (['new', 'next'] as const).filter((k) => session.adds[k] > 0 && (session.filter === 'all' || session.filter === k))
  // The crumb (YAZ-5132's place, without the vault): "LEARNING / Memory", inside the card, on the chip's line.
  const crumb = session.place.filter((p) => p.kind !== 'vault').map((p) => p.label)

  // TAP ANYWHERE (YAZ-5415): a tap on the screen shows the next part — the card, the empty space, the hint line, the
  // crumb. Not: a button or a link (✕ ✓ ← → ⋯, Undo, the menus' rows), an open menu, and the card's own taps (a link,
  // a pill, a picture, a sound's Play: YAZ-5298). The CAPTURE phase: a sound player stops each click inside it (the
  // Mac's `cardMedia`), so a tap on its name or its empty part reaches here first.
  const onTap = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null
    if (closedByTap.current) {
      closedByTap.current = false
      return
    }
    if (target === null || card === null) return
    if (menu !== null) return void (target.closest('.review__sheet, .review__menu') === null && setMenu(null))
    if (target.closest(SCREEN_OWN_TAPS) !== null || target.closest(CARD_OWN_TAPS) !== null) return
    // The bar's own listener (the Mac's seek) never runs on the phone: the tap is a step (YAZ-5333).
    if (target.closest('.card__audio-bar') !== null) e.stopPropagation()
    const blank = target.closest<HTMLElement>('.card__blank[data-hidden]')
    if (blank !== null && cardBox.current?.contains(blank) === true) return showPart(Number(blank.dataset.hidden))
    advance()
  }

  const filter = session.filter === 'fix' ? 'all' : session.filter
  const countButton = (
    <button
      type="button"
      className="review__count-btn"
      aria-haspopup="dialog"
      aria-expanded={menu === 'filter'}
      aria-label={`${filterLabel(session.filter)}${card !== null ? `, card ${session.position} of ${session.total}` : ''}. Choose what to review`}
      onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
    >
      <span className="review__mode">
        {FILTER_ICON[filter]} {filterLabel(session.filter)} ▾
      </span>
      {card !== null && (
        <span className="review__place">
          {session.position} <small>/ {session.total}</small>
        </span>
      )}
    </button>
  )
  const topBox = useReviewTop()
  const today = <TodayLine session={session} mode={review.settings.timeSoFar} />

  return (
    <div className="review review--mochi" onClickCapture={onTap} onTouchStart={NO_OP}>
      {topBox !== null && shown ? createPortal(countButton, topBox) : <div className="review__top">{countButton}</div>}
      <Progress session={session} />
      {answers.lost.length > 0 && <LostAnswers answers={answers} link={link} />}
      {notice !== null && (
        <p className="review__notice" role="alert">
          {notice}
        </p>
      )}
      {menu === 'filter' && <ReviewSheet session={session} review={review} today={<p className="review__sheet-today">{today}</p>} onClose={() => setMenu(null)} />}

      {card !== null ? (
        <>
          <div className="review__stage">
            {/* YAZ-5229: the card is TEXT for VoiceOver (its question is read; a hidden word stays "Hidden word" until it
                shows), not one button with a label. The tap is the sighted way; VoiceOver has its own button below. */}
            <div ref={cardBox} className="review__card card card-screen">
              <div className="review__cardtop">
                <span className="review__chip" data-new={card.isNew || undefined} title={cardStateText(card, Date.now())}>
                  <i aria-hidden="true" />
                  {card.isNew ? 'New' : 'Due'}
                </span>
                {crumb.length > 0 && (
                  <span className="review__crumb" title={crumb.join(' / ')}>
                    {crumb.slice(0, -1).map((c) => (
                      <span key={c} className="review__crumb-folder">
                        {c} /{' '}
                      </span>
                    ))}
                    <b>{crumb.at(-1)}</b>
                  </span>
                )}
                {counts.length > 1 && <span className="review__sides">{`Side ${Math.min(step.sides, counts.length)} of ${counts.length}`}</span>}
              </div>
              <p className="review__head">
                {headTitle !== '' && (
                  <>
                    <span className="review__title">{headTitle}</span>
                    <span aria-hidden> · </span>
                  </>
                )}
                <span className="review__id">{card.id}</span>
              </p>
              {needsFix === card.path && <p className="review__fix">{NEEDS_FIX}</p>}
              {text !== null && page !== null ? (
                <PhoneCard text={text} holder={card.path} show={{ sides: step.sides, ...shownParts(step.open), next: mark ?? undefined }} links={source.links} files={source.files} media={media} retry={retry} onOpen={open} />
              ) : (
                <div className="review__card-wait" aria-busy="true" />
              )}
            </div>
            <div className="review__fade" data-on={more || undefined} aria-hidden="true" />
            <div className="review__more-cue" data-on={more || undefined} aria-hidden="true">
              ↓ more
            </div>
            {/* YAZ-5467: a long card's own scroll, to its top or its end; its buttons are the screen's own taps, never a step. */}
            <ScrollJump scroller={cardBox} />
          </div>
          <button type="button" className="sr-only" onClick={advance} disabled={done}>
            {done ? 'The card is fully shown' : 'Show the next part'}
          </button>
          <p className="sr-only" aria-live="polite">
            {revealed}
          </p>
          <div className="review__hint">
            {(quietLine === null || quietLine.kind === 'answer') && <span className="review__hint-text">{hintText(left)}</span>}
            <span className="review__last" role="status" aria-live="polite">
              {quietLine !== null && (
                <>
                  <span className={quietLine.kind === 'answer' ? 'sr-only' : 'review__line'}>{quietLine.text}</span>
                  {quietLine.undo && (
                    <button type="button" className="review__undo" aria-label="Undo" onClick={undo}>
                      ↶ Undo
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
        </>
      ) : (
        <div className="review__stage review__stage--done">
          <DoneScreen review={review} session={session} addKinds={addKinds} today={today} />
          {quietLine !== null && (
            <p className="review__hint review__last" role="status" aria-live="polite">
              <span className="review__line">{quietLine.text}</span>
              {quietLine.undo && (
                <button type="button" className="review__undo" aria-label="Undo" onClick={undo}>
                  ↶ Undo
                </button>
              )}
            </p>
          )}
        </div>
      )}

      {card !== null && (
        <div className="review__dock">
          <div className="review__ctrl">
            <div className="review__arrows">
              <button type="button" className="review__arrow" aria-label="Previous card" disabled={!session.canBack} onClick={() => review.move(-1)}>
                ←
              </button>
              <button type="button" className="review__arrow" aria-label="Next card" disabled={!session.canNext} onClick={() => review.move(1)}>
                →
              </button>
            </div>
            <div className="review__answers" data-count={ratings.length} data-guard={guarded ? '' : undefined} data-nudge={nudge.key === cardKey && nudge.key !== null ? (nudge.n % 2 === 1 ? 'a' : 'b') : undefined}>
              {ratings.map((rating) => (
                <button key={rating} type="button" className="review__answer" data-rating={rating} aria-label={answerLabel(rating, review.settings)} disabled={page === null} onClick={() => answerWith(rating)}>
                  {ANSWER_GLYPH[rating]}
                </button>
              ))}
            </div>
            <div className="review__right">
              <button type="button" className="review__arrow review__more" aria-label="More card actions" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
                ⋯
              </button>
            </div>
          </div>
          {menu === 'more' && (
            <div className="review__menu review__menu--more" role="menu" aria-label="Card actions">
              <button type="button" role="menuitem" className="review__menu-row" disabled={!canUndo} onClick={undo}>
                Undo last answer
              </button>
              <button
                type="button"
                role="menuitem"
                className="review__menu-row"
                disabled={page === null}
                onClick={() => {
                  const on = page?.next !== true
                  act(on ? 'Marked: Up next' : 'Removed: Up next', () => review.setNext(card.path, card.id, on), () => review.setNext(card.path, card.id, !on))
                }}
              >
                {page?.next === true ? 'Remove from Up next' : 'Up next'}
              </button>
              <button type="button" role="menuitem" className="review__menu-row" disabled={page === null} onClick={toggleFix}>
                {fixed ? 'Remove Fix later' : 'Fix later'}
              </button>
              <button type="button" role="menuitem" className="review__menu-row" disabled={page === null} onClick={archive}>
                Archive card
              </button>
              <button
                type="button"
                role="menuitem"
                className="review__menu-row"
                onClick={() => {
                  setMenu(null)
                  open(cardFile ? { kind: 'card', path: card.path, id: card.id } : { kind: 'page', path: card.path, at: card.id })
                }}
              >
                {cardFile ? 'Open card' : unit('Open page')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const NO_OP = () => undefined

/** The answer buttons' glyphs (as Mochi): ✕ Forgot, ✓ Remembered; with four buttons, Hard and Easy too. */
const ANSWER_GLYPH: Record<CardRating, string> = { again: '✕', hard: '~', good: '✓', easy: '⇈' }

/** What a tap on the screen keeps for itself: every control (its own rule), and the open menus. */
const SCREEN_OWN_TAPS = 'button, a[href], input, label, select, textarea, [role="menu"], [role="dialog"], .review__sheet, .review__menu'

/**
 * The progress bar in steps (YAZ-5415, round 4; the Mac's YAZ-5020): one step for each card of the session, in the
 * order answered — grey for Remembered, red for Forgot, so only a miss stands out. A long session draws runs.
 */
function Progress({ session }: { session: CardReviewSession }) {
  const size = Math.max(1, session.size)
  const steps = size <= 80
  return (
    <div className="review__progress" role="progressbar" aria-label="Cards answered" aria-valuemin={0} aria-valuemax={session.size} aria-valuenow={session.answered.length} data-steps={steps || undefined}>
      {steps
        ? Array.from({ length: size }, (_, i) => {
            const r = session.answered[i]
            return <span key={i} className="review__step" data-answer={r === undefined ? undefined : r === 'again' ? 'forgot' : 'remembered'} />
          })
        : progressRuns(session.answered).map((run, i) => <span key={i} className="review__step" data-answer={run.missed ? 'forgot' : 'remembered'} style={{ flex: `0 0 ${(100 * run.count) / size}%` }} />)}
    </div>
  )
}

const drawings = new WeakMap<object, string>()
let drawingCount = 0
/** One name for each read of a card (YAZ-5315): the guard counts its 400 ms from a NEW drawing. */
function drawingOf(page: object): string {
  let name = drawings.get(page)
  if (name === undefined) drawings.set(page, (name = `d${++drawingCount}`))
  return name
}

/**
 * The accessible text of `el` (YAZ-5314): a part marked `aria-hidden` says nothing, a part with a role and a label (a
 * hidden word: `role="img"`, "Hidden word") says its label, any other text as it is. Built from what SHOWS only.
 */
export function spokenText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return void parts.push(node.textContent ?? '')
    if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return
    const label = node.getAttribute('aria-label')
    if (label !== null && node.hasAttribute('role')) return void parts.push(` ${label} `)
    for (const child of node.childNodes) walk(child)
    if (/^(P|DIV|LI|TR|H[1-6])$/.test(node.tagName)) parts.push(' ')
  }
  walk(el)
  return parts.join('').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
}

/**
 * What a tap keeps for itself (never a step): a link, a pill, a picture, a board, and a sound's Play (YAZ-5298). The
 * sound's progress bar is NOT a control on the phone (YAZ-5333): a 4 px line is no tap target (YAZ-5317), and a
 * 44 pt box around it covered the middle of a short card. A tap on it steps, as anywhere on the card.
 */
const CARD_OWN_TAPS = 'a[href], [data-card-link], [data-card-board], img, .card__audio-play, .page-media'

/** "Today: 31 cards · 9 min" (YAZ-5033), with the time as the setting says (YAZ-5130: hidden behind a tap by default). */
function TodayLine({ session, mode: setting }: { session: CardReviewSession; mode: CardReviewApi['settings']['timeSoFar'] }) {
  const [open, setOpen] = useState(false)
  const cards = todayCards(session.today)
  if (cards === '') return <span className="review__today" />
  const mode = session.today.seconds === 0 ? 'off' : setting
  return (
    <span className="review__today">
      {cards}
      {mode === 'shown' && ` · ${todayDuration(session.today.seconds)}`}
      {mode === 'hidden' && (
        <>
          {' · '}
          <button type="button" className="review__time" aria-label={open ? 'Hide time so far' : 'Show time so far'} aria-pressed={open} title={reviewDuration(session.today.seconds)} onClick={() => setOpen(!open)}>
            {open ? todayDuration(session.today.seconds) : '⏱'}
          </button>
        </>
      )}
    </span>
  )
}

function DoneScreen({ review, session, addKinds, today }: { review: CardReviewApi; session: CardReviewSession; addKinds: readonly AddKind[]; today: React.ReactNode }) {
  const adds = addKinds.map((k) => (
    <button key={k} type="button" className="btn review__add" onClick={() => review.addCards(k)}>
      {k === 'new' ? `Add ${session.adds.new} new card${session.adds.new === 1 ? '' : 's'}` : `Add ${session.adds.next} Up next`}
    </button>
  ))
  if (session.filter !== 'all' && session.counts.all > 0)
    return (
      <div className="review__done" role="status">
        <p className="review__done-title">{filterDone(session.filter)}</p>
        {adds}
        <button type="button" className="link-btn" onClick={() => review.setFilter('all')}>
          {session.counts.all} more in All cards
        </button>
      </div>
    )
  return (
    <div className="review__done" role="status">
      <p className="review__done-title">Inbox complete</p>
      <p className="muted review__done-today">{today}</p>
      {addKinds.length > 0 ? (
        <>
          <p className="muted review__waits">{waitingLine(session.more, addKinds)}</p>
          {adds}
        </>
      ) : review.dueCount > 0 ? (
        // A new day began during the review (local midnight): today's cards are due now.
        <button type="button" className="btn review__add" onClick={() => review.start()}>
          Review {review.dueCount} more
        </button>
      ) : (
        <p className="muted">Nothing else is due today.</p>
      )}
    </div>
  )
}

/**
 * Round 12, item 9: the answers whose card was gone at the send. Amber; one row for each card, with every lost action
 * of that card, and Discard (with its ask) takes them all. The rows, the count and the words are 4D's own (`lostRows`
 * in `status/dot.ts`), so the dot and this line always agree (YAZ-5227).
 */
function LostAnswers({ answers, link }: { answers: AnswersState; link: ReviewLink }) {
  const rows = lostRows(answers.lost)
  return (
    <div className="review__lost" role="alert">
      <p className="review__lost-title">{lostTitle(rows.length)}</p>
      {rows.map((row) => {
        const title = row.title === '' ? row.id : row.title
        const what = `${row.answer} · ${title}`
        return (
          <div key={row.id} className="review__lost-row">
            <span className="review__lost-what">{what}</span>
            <DiscardAnswer title={title} answer={row.answer} label={`Discard: ${what}`} onDiscard={() => Promise.all(row.seqs.map((seq) => link.answers.discard(seq)))} />
          </div>
        )
      })}
    </div>
  )
}

/** The Review tab's lost rows ARE the dot's (one function, YAZ-5227). */
export { lostRows }
