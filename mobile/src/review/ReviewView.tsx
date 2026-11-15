import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useMenuToggle } from '../app/menuToggle'
import { useAnswerTimer } from '@client/review/answerTimer'
import { cardStateText } from '@client/review/cardInboxChip'
import { START, markOf, reveal, shownParts, type Reveal } from '@client/review/cardSteps'
import { newCardsFrom } from '@client/review/inboxMenu'
import { addedLine, resetLine, waitingLine } from '@client/review/cardWords'
import { reviewDuration, todayCards, todayDuration } from '@client/review/reviewTime'
import { useCardReview, type CardReviewApi, type CardReviewSession } from '@client/review/useCardReview'
import type { UnitText } from '@client/vault/unitWordText'
import { cardFileShape } from '@shared/cardFileFormat'
import { cardIdOf, isCardFix, pageCards, withCardFix, withCardNoTitle, type CardRating } from '@shared/cardLine'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardPieces, cardSides, hiddenCount } from '@shared/cardText'
import { splitFrontmatter } from '@shared/frontmatter'
import type { ReviewHost } from '@client/review/reviewHost'
import type { ReviewSettings } from '@shared/reviews'
import { openPhoneDays, phoneReviewHost } from '../answers/reviewHost'
import type { AnswersState } from '../answers/answers'
import type { ReviewLink } from './link'
import { storedMedia, type VaultMedia } from '../media/ui/vaultMedia'
import { lostRows } from '../status/dot'
import { PhoneCard, type CardLinkOpen } from './PhoneCard'
import { readCardLook } from '../media/ui/cardDraw'
import { createReviewSource, type ReviewSource } from './source'
import { setReviewInProgress } from './inProgress'
import { SEEN_MS, useTapGuard } from './tapGuard'
import { useWakeLock } from './wakeLock'
import { FILTER_ICON, NEEDS_FIX, UNDO_SHOWN_MS, filterDone, filterLabel, hintText, lostTitle } from './words'
import { DiscardAnswer } from '../screens/DiscardAnswer'
import { useReviewTop } from '../screens/reviewTop'
import { glideCard, moreBelow, tapMove, type TapTarget } from './cardScroll'
import { readNewFrom, saveNewFrom } from './newFromPick'
import { ReviewSheet } from './ReviewSheet'
import { DueEnd } from './DueEnd'
import { CardActions } from '../cardMenu/lazy'
import './review.css'

/**
 * THE REVIEW TAB (4B, YAZ-5078; decision 11): the Mac's Inbox with taps in place of keys, also with no signal. The
 * review RULES are the Mac's own hook (`useCardReview`, decision 3) with the phone's host (3C: it writes actions to the
 * answer list, never files); the card is the Mac's own drawing (`PhoneCard`). The mockup (version 9) is the spec.
 *
 *  - The top row: the filter "All cards ▾" (round 10, addition 1: All cards, Up next, Due today, New cards, with
 *    counts) and today's work, "Today: 31 cards · 9 min".
 *  - Above the card: its state ("Due today", "New card") and "3 of 12"; then the head, "Title · ID", with "in <page>"
 *    for a card in a page (round 15, item 4). The title is the card line's (decision D): never a
 *    line of the card's text, so the text is drawn whole. A card with no title: the ID alone, as the Mac's Inbox head.
 *    "Title on the front: Hide" (`notitle`): the ID alone until the card is fully shown; so too a title that holds a
 *    hidden-word mark (a title never gives the answer away). A card file that is not valid says so (round
 *    15, item 3).
 *  - A TAP ON THE CARD shows the next hidden word, else the next side: what Space does on the Mac. No swipes.
 *  - At the bottom, in reach of the thumb: ✕ Forgot and ✓ Remembered (or four by the setting), then ⋯: Archive card,
 *    Up next, Fix later, Open page (a card file: Open card). The answer buttons work at any step, as on the Mac.
 *  - "Answered · Undo" under the buttons: Undo takes back the last answer (or the last "Add more").
 *  - Done: "Inbox complete", today's work, and "Add more for today" (round 10, addition 2) when cards wait.
 *  - The end of Due today (the Mac's YAZ-5043, from the shared hook's `end`): after the first pass "You
 *    remembered 93% of 73 cards." with "Review missed cards 5"; then "Due today is done." with "Learn new cards 11"
 *    and its "from All folders ›" (the sheet's folder page). The ring and the confetti: `DueEnd.tsx`.
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
   * The tab is on the screen (the shell keeps it mounted behind a page, a card, another tab). Off the screen
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
/** `name` and `rating`: the hint line's "Last: Capital of Spain (Forgot) · ↶ Undo", right after the answer. */
type Line = { kind: 'answer'; count: number; id: string; name: string; rating: CardRating } | { kind: 'mark'; text: string; key: string | null; undo?: () => Promise<unknown> } | { kind: 'archive' }

function ReviewSession({ link, vault, vaultName, unit, open, source, host, media, pick: firstPick, shown = true }: ReviewViewProps & Setup) {
  const { ready, settings: vaultSettings } = useSourceState(source)
  // Where new cards come from — the Mac's rule (`setNewFrom` → `saveSettings` → `newFrom`), this phone's pick.
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
  // No inner error text reaches the screen: the hook's words before the reason, e.g. "Can't undo the answer.".
  const onNotice = useCallback((text: string) => setNotice(`${text.split(':')[0].trim()}.`), [])
  const review = useCardReview(vault, source, settings, onNotice, vaultName, host, saveSettings)
  const { session } = review

  // A session starts once the first index is in (an empty list is not "Inbox complete"), and again after review was off.
  const { start } = review
  useEffect(() => {
    if (ready && settings.enabled && session === null) start()
  }, [ready, settings.enabled, session, start])

  // The one fact the update logic reads: a card on show, or an Undo still to give, on any tab.
  const inProgress = session !== null && (session.card !== null || session.canUndo)
  useEffect(() => setReviewInProgress(inProgress), [inProgress])
  useEffect(() => () => setReviewInProgress(false), [])

  // The vault's card look (card-look.json, the Mac's card variables) on the card; read again with each index
  // the source takes in (a sync that brought a new file). No file: none, the look before.
  const [cardLook, setCardLook] = useState<Record<string, string>>({})
  const records = source.records
  useEffect(() => {
    let live = true
    void readCardLook(link.store, vault).then((next) => live && setCardLook((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)))
    return () => {
      live = false
    }
  }, [link, vault, records])

  const answers = useAnswersState(link)
  // A pass that ends well asks again for each picture that waited for a signal.
  const { engine } = link
  const retry = useCallback((fn: () => void) => engine.subscribe((e) => void (e.type === 'state' && e.state.status === 'synced' && fn())), [engine])
  // ONE owner of the Wake Lock: this session, while its card is on the screen.
  useWakeLock(shown && session?.card != null)

  if (!ready) return <Waiting />
  if (!settings.enabled)
    return (
      <div className="review review--off">
        <p className="muted">Review is off in this vault. Turn it on in Settings › Cards on the Mac.</p>
      </div>
    )
  if (session === null) return <Waiting />
  return <SessionScreen {...{ link, unit, open, source, host, media, retry, review, session, answers, notice, setNotice, shown, cardLook }} />
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
  cardLook,
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
  /** The vault's card look: the Mac's card variables, on the card. */
  cardLook: Record<string, string>
}) {
  // The end of Due today has its own screen (`DueEnd`); the YAZ-5465 shim that went on at once is gone.
  const card = session.card
  const page = card?.page ?? null
  const pageText = page?.text ?? null
  // The head's title, off the card line (the Mac's `useCardFront`): never part of the text, so the front is
  // the whole text. "Title on the front: Hide" makes it wait for the card's last step; so does a title that
  // holds a hidden-word mark: its words may be the answer.
  const text = pageText
  const cardName = page?.title ?? ''
  const hideTitle = page?.notitle === true
  const title = useMemo(() => ({ text: pageText === null ? '' : cardName, waits: hideTitle || hiddenCount(cardName) > 0 }), [pageText, cardName, hideTitle])
  const record = card === null ? undefined : source.records.find((r) => r.path === card.path)
  const cardFile = record?.kind === 'card'
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`

  // The step (D18; YAZ-5415 follows the Mac's `cardSteps.ts`): a tap shows the MARKED part (the next
  // hidden one), else the next side; a tap ON a hidden part shows THAT part, and the mark goes on after it.
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<Step>({ ...START, key: cardKey })
  const step: Step = stepState.key === cardKey ? stepState : { ...START, key: cardKey }
  const upTo = (sides: number) => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.open.length >= upTo(counts.length)
  const mark = markOf(step, upTo(step.sides))
  // What the hint line counts: the hidden parts not shown yet, and each side still to come.
  const left = text === null ? 0 : upTo(counts.length) - step.open.length + Math.max(0, counts.length - step.sides)
  // After an answer, taps wait until the next card is on the screen AND a short time has passed, so the
  // second tap of a double tap never lands on a card the person has not seen. The answer buttons still work at any
  // step of a card once it is seen (decision 11, as the Mac: "the buttons should always be there").
  const guard = useTapGuard()
  const guarded = !guard.taps
  const liveKey = useRef(cardKey)
  liveKey.current = cardKey
  // The guard's 400 ms start when the NEXT card is drawn on the screen (a new key, with its text).
  const { shown: cardShown } = guard
  // A DRAWING is one read of a card (its page object): the hook keeps the old card's object on the screen while the
  // next one reads, and a card that comes back is read again (a new object).
  // Only a card that is LIVE counts (its answers are fixed: the hook gives none to the card before, which it
  // keeps on show while the next one reads). So a sync pass that redraws the answered card starts no 400 ms.
  const drawing = page === null || session.answers === null ? null : drawingOf(page)
  useEffect(() => {
    if (drawing !== null) cardShown(drawing)
  }, [drawing, cardShown])
  // Sweep2 nit 3: a card drawn where the screen after the last card was ("Review missed cards", "Learn new
  // cards") takes no tap for 400 ms: the second tap of a double tap on the button showed its side 2.
  const { arrive } = guard
  const onDone = useRef(card === null)
  useEffect(() => {
    const was = onDone.current
    onDone.current = card === null
    if (was && card !== null) arrive()
  }, [card, arrive])
  // Hidden and shown again: the guard starts from `ready`.
  const { reset: resetGuard } = guard
  useEffect(() => resetGuard(), [shown, resetGuard])

  const cardBox = useRef<HTMLDivElement>(null)
  // The end of the card (the Mac's end cue): one more tap when every part shows makes ✕
  // and ✓ bounce once with a soft ring. Two names, so each new tap plays it again.
  const [nudge, setNudge] = useState<{ key: string | null; n: number }>({ key: null, n: 0 })
  // The part a step just showed: VoiceOver hears it (no flash; it simply shows).
  const lastShown = useRef<number | null>(null)
  const advance = () => {
    if (page === null || guarded) return
    firstAction()
    const target: TapTarget = mark !== null ? mark : step.sides < counts.length ? 'side' : 'end'
    // The Mac's reading scroll: a part out of view first comes into view; that tap shows nothing.
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
    firstAction()
    lastShown.current = word
    setStep({ ...reveal(step, word, upTo(step.sides)), key: step.key })
  }

  // VoiceOver hears ONLY what a step newly shows: a new side (its text), else the new word.
  const [revealed, setRevealed] = useState('')
  const lastStep = useRef<Step>(step)
  useEffect(() => {
    const before = lastStep.current
    lastStep.current = step
    if (before.key !== step.key || (step.open.length === 0 && step.sides === 1)) return setRevealed('')
    const body = cardBox.current?.querySelector('.phone-card__body')
    const word = step.open.length > before.open.length ? lastShown.current : null
    const id = setTimeout(() => {
      if (body == null) return
      if (step.sides > before.sides) {
        const side = body.querySelector(`.card__side[data-side="${step.sides - 1}"]`)
        // What VoiceOver reads of the side: a hidden word is "Hidden word", never its text.
        setRevealed(side === null ? '' : spokenText(side))
      } else if (word !== null) setRevealed((body.querySelector(`[data-hidden="${word}"]`)?.textContent ?? '').trim())
    }, 0)
    return () => clearTimeout(id)
  }, [step.key, step.sides, step.open]) // eslint-disable-line react-hooks/exhaustive-deps

  // No scroll bar (round 4): a soft fade and "↓ more" while more of the card lies below; both go at its end.
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

  // 'from': the sheet open at its folder page (the "from All folders ›" of "Learn new cards").
  const [menu, setMenu] = useState<'filter' | 'from' | 'more' | null>(null)
  const [line, setLine] = useState<Line | null>(null)
  // The answer's "Last: … · ↶ Undo" stays until the first thing done on the next card (a tap that
  // shows a part, ← or →, the deck drawer); then the hint line is the plain hint again. No timer. Undo stays in ⋯.
  const [putAway, setPutAway] = useState<Line | null>(null)
  const firstAction = () => void (line?.kind === 'answer' && putAway !== line && setPutAway(line))
  const ratings = answerRatings(review.settings)

  // An open menu closes on a tap outside it, and that tap does nothing else (as the mockup); a tap on its button again
  // closes it (YAZ-5539); Escape and Back close it. The app's one rule for menus (YAZ-5552).
  useMenuToggle(menu !== null, () => setMenu(null), MENU_OWN_TAPS)

  const answerWith = (rating: CardRating) => {
    if (page === null || card === null || guarded) return
    setMenu(null)
    setNotice(null)
    const fromDrawing = drawingOf(page)
    const earlier = line
    const answeredBefore = session.answered.length
    // The title's words as they read (a hidden-word mark gives its words: the card is answered), else the ID.
    const name = cardPieces(cardName).map((p) => p.text).join('').trim()
    setLine({ kind: 'answer', count: answeredBefore + 1, id: card.id, name: name === '' ? card.id : name, rating })
    // The guard's one way through an answer; a failed save keeps this card on the screen, and taps act again.
    // Whether the answer counted is the hook's own word (`answer` gives it), never read off the screen: on
    // the phone React may draw the next card AFTER a 0 ms timer, and the screen then still showed the old count, so a
    // saved answer looked failed and its line (with the 4-second Undo) was put back to the one before.
    let counted = false
    void guard.answer(
      async () => {
        counted = await review.answer(rating, seconds())
        // Let the next card draw before the guard reads the screen.
        await new Promise((r) => setTimeout(r, 0))
        // A save that failed counts no answer; the line goes back to what it said (the earlier Undo stays).
        if (!counted) setLine(earlier)
      },
      // `sameCard`: the save failed (no answer counted; the card stays). The next card's drawing starts the 400 ms.
      () => ({ sameCard: !counted, cardOnScreen: liveKey.current !== null }),
      fromDrawing,
    )
  }
  // An answer whose card was gone at the send is in the amber line. Its Undo takes it away cleanly (as
  // Discard), and never asks the host for a card that is not there.
  const lostRow = line?.kind === 'answer' ? lostRows(answers.lost).find((r) => r.id === line.id && answers.lost.some((l) => r.seqs.includes(l.seq) && l.op.kind === 'review')) : undefined
  const undo = () => {
    setMenu(null)
    setNotice(null)
    // sweep2 M-A: from the screen after the last card, the card that comes back takes no tap for 400 ms (its ✓ sits
    // under the finger that tapped Undo).
    guard.undo(card === null)
    // Undo of Up next or Fix later: the inverse, through the host (an unsent mark leaves the list).
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
    // The Undo waits for the mark's own save, so it never reads the line before the mark is in it (a tap
    // during the save was lost). Then the host's rule decides: an unsent mark leaves the list; a tried one gets its
    // inverse as an action. A mark that did not save has nothing to take back.
    const undoAfter = undoIt === undefined ? undefined : () => saved.then((ok) => (ok ? undoIt() : undefined))
    setLine({ kind: 'mark', text, key: cardKey, undo: undoAfter })
  }
  // Archive card is on the hook's Undo stack; the line says "Archived · Undo".
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
  // An add, a mark or Archive card sits IN the hint line for about 4 seconds, then goes; Undo stays
  // in ⋯. An answer has no timer: its "Last: … · ↶ Undo" (below) goes at the first action on the next card.
  const [fresh, setFresh] = useState<object | null>(null)
  const lineId = session.lastAdd ?? line
  useEffect(() => {
    if (lineId === null) return
    setFresh(lineId)
    const id = setTimeout(() => setFresh((f) => (f === lineId ? null : f)), UNDO_SHOWN_MS)
    return () => clearTimeout(id)
  }, [lineId])
  const quietLine = shownLine !== null && shownLine.kind !== 'answer' && fresh === lineId ? shownLine : null
  // Right after an answer, the hint line says it, with its Undo: "Last: Capital of Spain (Forgot) · ↶ Undo".
  const lastAnswer = shownLine?.kind === 'answer' && line?.kind === 'answer' && putAway !== line ? { ...line, undo: shownLine.undo } : null
  const lastLine = <LastLine last={lastAnswer} quiet={quietLine} undo={undo} settings={review.settings} />
  // ⋯'s "Undo last answer": whatever the line's Undo would take back, also after the line went.
  const canUndo = shownLine?.undo === true || session.canUndo

  const headTitle = title.waits && !done ? '' : title.text
  const addKinds = (['new', 'next'] as const).filter((k) => session.adds[k] > 0 && (session.filter === 'all' || session.filter === k))
  // The crumb (YAZ-5132's place, without the vault): "LEARNING / Memory", inside the card, on the chip's line.
  const crumb = session.place.filter((p) => p.kind !== 'vault').map((p) => p.label)

  // TAP ANYWHERE: a tap on the screen shows the next part — the card, the empty space, the hint line, the
  // crumb. Not: a button or a link (✕ ✓ ← → ⋯, Undo, the menus' rows), an open menu, and the card's own taps (a link,
  // a pill, a picture, a sound's Play: YAZ-5298). The CAPTURE phase: a sound player stops each click inside it (the
  // Mac's `cardMedia`), so a tap on its name or its empty part reaches here first.
  const onTap = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null
    if (target === null || card === null) return
    // A tap on the button that opened the menu is left to that button (its second tap closes it). On a real
    // tap the browser lets React draw between this capture handler and the button's own click: had this closed the
    // menu, the button's click would read "closed" and open it again.
    if (menu !== null) return void (target.closest(MENU_OWN_TAPS) === null && setMenu(null))
    if (target.closest(SCREEN_OWN_TAPS) !== null || target.closest(CARD_OWN_TAPS) !== null) return
    // The bar's own listener (the Mac's seek) never runs on the phone: the tap is a step.
    if (target.closest('.card__audio-bar') !== null) e.stopPropagation()
    const blank = target.closest<HTMLElement>('.card__blank[data-hidden]')
    if (blank !== null && cardBox.current?.contains(blank) === true) return showPart(Number(blank.dataset.hidden))
    advance()
  }

  const filter = session.filter
  const countButton = (
    <button
      type="button"
      className="review__count-btn"
      aria-haspopup="dialog"
      aria-expanded={menu === 'filter'}
      aria-label={`${filterLabel(session.filter)}${card !== null ? `, card ${session.position} of ${session.total}` : ''}. Choose what to review`}
      onClick={() => {
        if (menu !== 'filter') firstAction()
        setMenu(menu === 'filter' ? null : 'filter')
      }}
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
      {(menu === 'filter' || menu === 'from') && <ReviewSheet key={menu} session={session} review={review} today={<p className="review__sheet-today">{today}</p>} onClose={() => setMenu(null)} folders={menu === 'from'} />}

      {card !== null ? (
        <>
          <div className="review__stage">
            {/* The card is TEXT for VoiceOver (its question is read; a hidden word stays "Hidden word" until it
                shows), not one button with a label. The tap is the sighted way; VoiceOver has its own button below. */}
            <div ref={cardBox} className="review__card card card-screen" style={cardLook}>
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
          </div>
          <button type="button" className="sr-only" onClick={advance} disabled={done}>
            {done ? 'The card is fully shown' : 'Show the next part'}
          </button>
          <p className="sr-only" aria-live="polite">
            {revealed}
          </p>
          <div className="review__hint">
            {lastAnswer === null && quietLine === null && <span className="review__hint-text">{hintText(left)}</span>}
            {lastLine}
          </div>
        </>
      ) : (
        <DoneStage>
          {session.end !== null ? (
            // Due today stopped (its % after the first pass, or done): its own screen, the rest after it.
            <div className="review__done" role="status">
              <DueEnd
                end={session.end}
                shown={shown}
                onGoOn={review.goOn}
                from={
                  <button type="button" className="due-end__from" aria-haspopup="dialog" aria-expanded={menu === 'from'} aria-label={`New cards from ${newCardsFrom(session)}. Choose folders`} onClick={() => setMenu(menu === 'from' ? null : 'from')}>
                    from {newCardsFrom(session)} ›
                  </button>
                }
              >
                <DoneBody review={review} session={session} addKinds={addKinds} today={today} title={false} />
              </DueEnd>
            </div>
          ) : (
            <div className="review__done" role="status">
              <DoneBody review={review} session={session} addKinds={addKinds} today={today} title />
            </div>
          )}
          {(lastAnswer !== null || quietLine !== null) && <div className="review__hint">{lastLine}</div>}
        </DoneStage>
      )}

      {card !== null && (
        <div className="review__dock">
          <div className="review__ctrl">
            <div className="review__arrows">
              <button
                type="button"
                className="review__arrow"
                aria-label="Previous card"
                disabled={!session.canBack}
                onClick={() => {
                  firstAction()
                  review.move(-1)
                }}
              >
                ←
              </button>
              <button
                type="button"
                className="review__arrow"
                aria-label="Next card"
                disabled={!session.canNext}
                onClick={() => {
                  firstAction()
                  review.move(1)
                }}
              >
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
              {/* YAZ-5503/5505: the shared card actions (Up next, Archive card, Fix later, Title on the front), two taps each. */}
              <CardActions
                marks={page === null ? null : { off: false, next: page.next === true, fix: fixed, notitle: page.notitle === true }}
                upNext
                rowClassName="review__menu-row"
                onAction={(a) => {
                  if (a.kind === 'off') return archive()
                  if (a.kind === 'fix') return toggleFix()
                  if (a.kind === 'next') return act(a.done, () => review.setNext(card.path, card.id, a.on), () => review.setNext(card.path, card.id, !a.on))
                  act(a.done, () => host.changeCardLine(card.path, card.id, a.change), () => host.changeCardLine(card.path, card.id, (l) => withCardNoTitle(l, !a.on)))
                }}
              />
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

/**
 * The status part of the hint line. After an answer (Yaseen's pick A, text only): "Last: Capital of Spain
 * (Forgot) · ↶ Undo" — the answer in words, no ✕ or ✓ and no colour, so nothing leans on the next answer; one line, a
 * long title gives way with "…". Its words are not a tap (a tap on them never steps the card); its Undo takes the answer
 * back. Else an add, a mark or Archive card, with its Undo, for its few seconds.
 */
function LastLine({ last, quiet, undo, settings }: { last: { name: string; rating: CardRating; undo: boolean } | null; quiet: { text: string; undo: boolean } | null; undo: () => void; settings: ReviewSettings }) {
  const undoButton = (
    <button type="button" className="review__undo" aria-label="Undo" onClick={undo}>
      ↶ Undo
    </button>
  )
  return (
    <span className="review__last" role="status" aria-live="polite">
      {last !== null ? (
        <>
          <span className="review__lastanswer">
            Last: <span className="review__lastanswer-name">{last.name}</span>
            <span className="review__lastanswer-rating"> ({answerLabel(last.rating, settings)})</span>
            {last.undo && (
              <span className="review__lastanswer-sep" aria-hidden="true">
                {' · '}
              </span>
            )}
          </span>
          {last.undo && undoButton}
        </>
      ) : (
        quiet !== null && (
          <>
            <span className="review__line">{quiet.text}</span>
            {quiet.undo && undoButton}
          </>
        )
      )}
    </span>
  )
}

/** The answer buttons' glyphs (as Mochi): ✕ Forgot, ✓ Remembered; with four buttons, Hard and Easy too. */
const ANSWER_GLYPH: Record<CardRating, string> = { again: '✕', hard: '~', good: '✓', easy: '⇈' }

/** What an open menu keeps for itself: the menus, and the buttons that open them (a second tap there closes it: YAZ-5539). */
const MENU_OWN_TAPS = '.review__sheet, .review__menu, .review__count-btn, .review__more, .due-end__from'

/** What a tap on the screen keeps for itself: every control (its own rule), and the open menus. */
const SCREEN_OWN_TAPS = 'button, a[href], input, label, select, textarea, [role="menu"], [role="dialog"], .review__sheet, .review__menu, .review__lastanswer'

/**
 * The progress bar in steps (round 4; the Mac's YAZ-5020): one step for each card, in the order answered —
 * grey for Remembered, red for Forgot, so only a miss stands out. A long session draws runs. It counts ONLY the list
 * on show (the Mac's YAZ-5432, `session.progress`, the same answers as the end ring's %): Due today done fills it.
 */
function Progress({ session }: { session: CardReviewSession }) {
  // The Mac's bar: the filter on show only, `session.progress` (one rule for both apps).
  const { runs, done } = session.progress
  const size = Math.max(1, session.progress.size)
  const steps = size <= 80
  const marks = runs.flatMap((run) => Array.from({ length: run.count }, () => run.missed))
  return (
    <div className="review__progress" role="progressbar" aria-label="Cards answered" aria-valuemin={0} aria-valuemax={session.progress.size} aria-valuenow={done} data-steps={steps || undefined}>
      {steps
        ? Array.from({ length: size }, (_, i) => {
            const m = marks[i]
            return <span key={i} className="review__step" data-answer={m === undefined ? undefined : m ? 'forgot' : 'remembered'} />
          })
        : runs.map((run, i) => <span key={i} className="review__step" data-answer={run.missed ? 'forgot' : 'remembered'} style={{ flex: `0 0 ${(100 * run.count) / size}%` }} />)}
    </div>
  )
}

const drawings = new WeakMap<object, string>()
let drawingCount = 0
/** One name for each read of a card: the guard counts its 400 ms from a NEW drawing. */
function drawingOf(page: object): string {
  let name = drawings.get(page)
  if (name === undefined) drawings.set(page, (name = `d${++drawingCount}`))
  return name
}

/**
 * The accessible text of `el`: a part marked `aria-hidden` says nothing, a part with a role and a label (a
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
 * What a tap keeps for itself (never a step): a link, a pill, a picture, a board, and a sound's Play. The
 * sound's progress bar is NOT a control on the phone: a 4 px line is no tap target, and a
 * 44 pt box around it covered the middle of a short card. A tap on it steps, as anywhere on the card.
 */
const CARD_OWN_TAPS = 'a[href], [data-card-link], [data-card-board], img, .card__audio-play, .page-media'

/** "Today: 31 cards · 9 min", with the time as the setting says (hidden behind a tap by default). */
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

/**
 * S5 (sweep1): the screen after the last card, which takes no tap for `SEEN_MS` after it appears, as a new card (the tap
 * guard). Its "↶ Undo" sits where ✓ was: the second tap of a quick double tap on ✓ hit it and took the
 * answer back, with no word. A tap under 400 ms is that second tap: it is dropped, before any button sees it.
 */
function DoneStage({ children }: { children: React.ReactNode }) {
  const [settling, setSettling] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setSettling(false), SEEN_MS)
    return () => clearTimeout(timer)
  }, [])
  const drop = (e: React.MouseEvent) => {
    if (!settling) return
    e.preventDefault()
    e.stopPropagation()
  }
  // `data-settling` while it takes no tap (a test's person waits for it to go, as for the answer buttons' `data-guard`).
  return (
    <div className="review__stage review__stage--done" data-settling={settling ? '' : undefined} onClickCapture={drop}>
      {children}
    </div>
  )
}

/** What the done screen says; `title` false under the end of Due today, which has its own. */
function DoneBody({ review, session, addKinds, today, title }: { review: CardReviewApi; session: CardReviewSession; addKinds: readonly AddKind[]; today: React.ReactNode; title: boolean }) {
  const adds = addKinds.map((k) => (
    <button key={k} type="button" className="btn review__add" onClick={() => review.addCards(k)}>
      {k === 'new' ? `Add ${session.adds.new} new card${session.adds.new === 1 ? '' : 's'}` : `Add ${session.adds.next} Up next`}
    </button>
  ))
  if (session.filter !== 'all' && session.counts.all > 0)
    return (
      <>
        {title && <p className="review__done-title">{filterDone(session.filter)}</p>}
        {adds}
        <button type="button" className="link-btn" onClick={() => review.setFilter('all')}>
          {session.counts.all} more in All cards
        </button>
      </>
    )
  return (
    <>
      {title && <p className="review__done-title">Inbox complete</p>}
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
    </>
  )
}

/**
 * Round 12, item 9: the answers whose card was gone at the send. Amber; one row for each card, with every lost action
 * of that card, and Discard (with its ask) takes them all. The rows, the count and the words are 4D's own (`lostRows`
 * in `status/dot.ts`), so the dot and this line always agree.
 */
function LostAnswers({ answers, link }: { answers: AnswersState; link: ReviewLink }) {
  const rows = lostRows(answers.lost)
  return (
    <div className="review__lost" role="alert">
      <p className="review__lost-title">{lostTitle(rows.length)}</p>
      {rows.map((row) => {
        const title = row.title === '' ? row.id : row.title
        const what = `${row.answer} · ${title}${row.note === undefined ? '' : ` · ${row.note}`}`
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

/** The Review tab's lost rows ARE the dot's (one function). */
export { lostRows }
