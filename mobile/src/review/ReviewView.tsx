import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAnswerTimer } from '@client/review/answerTimer'
import { answerIcon, cardStateText } from '@client/review/cardInboxChip'
import { addedLine, waitingLine } from '@client/review/cardWords'
import { reviewDuration, todayCards, todayDuration } from '@client/review/reviewTime'
import { useCardReview, type CardReviewApi, type CardReviewSession } from '@client/review/useCardReview'
import type { UnitText } from '@client/vault/unitWordText'
import { cardFileShape } from '@shared/cardFileFormat'
import { cardIdOf, isCardFix, pageCards, withCardFix, type CardRating } from '@shared/cardLine'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardSides, cardTitle, cardWithoutTitle, hiddenCount } from '@shared/cardText'
import { splitFrontmatter } from '@shared/frontmatter'
import type { ReviewHost } from '@client/review/reviewHost'
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
import { FILTERS, NEEDS_FIX, filterDone, filterLabel, lostTitle } from './words'
import { DiscardAnswer } from '../screens/DiscardAnswer'
import './review.css'

/**
 * THE REVIEW TAB (4B, YAZ-5078; decision 11): the Mac's Inbox with taps in place of keys, also with no signal. The
 * review RULES are the Mac's own hook (`useCardReview`, decision 3) with the phone's host (3C: it writes actions to the
 * answer list, never files); the card is the Mac's own drawing (`PhoneCard`). The mockup (version 9) is the spec.
 *
 *  - The top row: the filter "All cards ▾" (round 10, addition 1: All cards, Up next, Due today, New cards, with
 *    counts) and today's work, "Today: 31 cards · 9 min".
 *  - Above the card: its state ("Due today", "New card") and "3 of 12"; then the head, "Title · ID", with "in <page>"
 *    for a card in a page (round 15, item 4). "Title on the front: Hide" (`notitle`): the ID alone until the card is
 *    fully shown. A card file that is not valid says so (round 15, item 3).
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
    void openPhoneDays(link.store, vault).then((days) => {
      if (live) setSetup({ source, media, host: phoneReviewHost({ answers: link.answers, days, vaultName: () => vaultName }) })
    })
    return () => {
      live = false
      source.stop()
      own?.release()
      setSetup(null)
    }
  }, [link, vault, vaultName, given])
  if (setup === null) return <Waiting />
  return <ReviewSession {...props} source={setup.source} host={setup.host} media={setup.media} />
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

/** The step a card is at: how many sides show, and how many hidden words (as the Mac's Inbox). */
interface Step {
  key: string | null
  sides: number
  shown: number
}

/** The line under the buttons: the last answer, the last add, or a ⋯ action. */
type Line = { kind: 'answer'; count: number; id: string } | { kind: 'mark'; text: string; key: string | null }

function ReviewSession({ link, vault, vaultName, unit, open, source, host, media, shown = true }: ReviewViewProps & Setup) {
  const { ready, settings } = useSourceState(source)
  const [notice, setNotice] = useState<string | null>(null)
  // No inner error text reaches the screen (YAZ-5076, YAZ-5228): the hook's words before the reason, e.g. "Can't undo the answer.".
  const onNotice = useCallback((text: string) => setNotice(`${text.split(':')[0].trim()}.`), [])
  const review = useCardReview(vault, source, settings, onNotice, vaultName, host)
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
        <p className="muted">Review is off in this vault. Turn it on in Settings › Review on the Mac.</p>
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
  // "Title on the front: Hide" (YAZ-5030): the front is drawn without its title line; the head shows it at the end.
  const hideTitle = page?.notitle === true
  const text = useMemo(() => (pageText !== null && hideTitle ? cardWithoutTitle(pageText) : pageText), [pageText, hideTitle])
  const title = useMemo(() => {
    if (pageText === null) return { text: '', waits: false }
    const tells = hiddenCount(cardSides(pageText)[0]) > hiddenCount(cardSides(cardWithoutTitle(pageText))[0])
    return { text: cardTitle(pageText), waits: hideTitle || tells }
  }, [pageText, hideTitle])
  const record = card === null ? undefined : source.records.find((r) => r.path === card.path)
  const cardFile = record?.kind === 'card'
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`

  // The step: one tap, one hidden word, else one side (D18).
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<Step>({ key: cardKey, sides: 1, shown: 0 })
  const step = stepState.key === cardKey ? stepState : { key: cardKey, sides: 1, shown: 0 }
  const upTo = (sides: number) => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.shown >= upTo(counts.length)
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
  const drawing = page === null ? null : drawingOf(page)
  useEffect(() => {
    if (drawing !== null) cardShown(drawing)
  }, [drawing, cardShown])
  // Hidden and shown again: the guard starts from `ready` (YAZ-5266).
  const { reset: resetGuard } = guard
  useEffect(() => resetGuard(), [shown, resetGuard])
  const advance = () => {
    if (done || page === null || guarded) return
    setStep(step.shown < upTo(step.sides) ? { ...step, shown: step.shown + 1 } : { ...step, sides: step.sides + 1 })
  }

  // YAZ-5229, YAZ-5268: VoiceOver hears ONLY what a step newly shows: a new side (its text), else the new word.
  const [revealed, setRevealed] = useState('')
  const cardBox = useRef<HTMLDivElement>(null)
  const lastStep = useRef<Step>(step)
  useEffect(() => {
    const before = lastStep.current
    lastStep.current = step
    if (before.key !== step.key || (step.shown === 0 && step.sides === 1)) return setRevealed('')
    const id = setTimeout(() => {
      const body = cardBox.current?.querySelector('.phone-card__body')
      if (body == null) return
      if (step.sides > before.sides) {
        const side = body.querySelector(`.card__side[data-side="${step.sides - 1}"]`)
        // YAZ-5314: what VoiceOver reads of the side: a hidden word is "Hidden word", never its text.
        setRevealed(side === null ? '' : spokenText(side))
      } else if (step.shown > before.shown) setRevealed((body.querySelectorAll('.card__hidden')[step.shown - 1]?.textContent ?? '').trim())
    }, 0)
    return () => clearTimeout(id)
  }, [step.key, step.sides, step.shown]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setNotice(null)
    guard.undo()
    if (lostRow === undefined) return void review.undo()
    setLine({ kind: 'mark', text: 'Answer removed', key: cardKey })
    void Promise.all(lostRow.seqs.map((seq) => link.answers.discard(seq)))
  }
  const act = (text: string, run: () => Promise<unknown>) => {
    setMenu(null)
    setNotice(null)
    setLine({ kind: 'mark', text, key: cardKey })
    void run().catch(() => setNotice('That did not save. Try again.'))
  }
  const toggleFix = () => {
    if (card === null) return
    const on = !fixed
    act(on ? 'Marked: Fix later' : 'Removed: Fix later', async () => {
      await host.changeCardLine(card.path, card.id, (l) => withCardFix(l, on))
      setFixOn({ key: `${card.path}\n${card.id}`, on })
    })
  }

  // The line under the buttons shows while what it names is still the last thing done.
  const answeredNow = session.answered.length
  const shownLine =
    session.lastAdd !== null
      ? { text: `${addedLine(session.lastAdd.kind, session.lastAdd.count)}`, undo: session.canUndo }
      : line?.kind === 'answer' && line.count === answeredNow && answeredNow > 0
        ? { text: 'Answered', undo: session.canUndo || lostRow !== undefined }
        : line?.kind === 'mark' && (line.key === cardKey || line.text.startsWith('Archived'))
          ? { text: line.text, undo: false }
          : line?.kind === 'mark' && line.text === 'Answer removed'
            ? { text: line.text, undo: false }
          : null

  const headTitle = title.waits && !done ? '' : title.text
  const pageTitle = !cardFile && record !== undefined ? record.title : null
  const addKinds = (['new', 'next'] as const).filter((k) => session.adds[k] > 0 && (session.filter === 'all' || session.filter === k))

  return (
    <div className="review">
      {answers.lost.length > 0 && <LostAnswers answers={answers} link={link} />}
      {notice !== null && (
        <p className="review__notice" role="alert">
          {notice}
        </p>
      )}
      <div className="review__top">
        <button type="button" className="review__filter" aria-haspopup="menu" aria-expanded={menu === 'filter'} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
          {filterLabel(session.filter)} ▾
        </button>
        <TodayLine session={session} mode={review.settings.timeSoFar} />
      </div>
      {menu === 'filter' && (
        <div className="review__menu" role="menu" aria-label="Which cards">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitemradio"
              aria-checked={session.filter === f.id}
              className="review__menu-row"
              onClick={() => {
                setMenu(null)
                review.setFilter(f.id)
              }}
            >
              <span>{f.label}</span>
              <span className="review__count">{session.counts[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      {card !== null ? (
        <>
          <div className="review__meta">
            <span>{cardStateText(card, Date.now())}</span>
            <span>
              {session.position} of {session.total}
            </span>
          </div>
          <p className="review__head">
            {headTitle !== '' && (
              <>
                <span className="review__title">{headTitle}</span>
                <span aria-hidden> · </span>
              </>
            )}
            <span className="review__id">{card.id}</span>
            {pageTitle !== null && <span className="review__in"> · in {pageTitle}</span>}
          </p>
          {needsFix === card.path && <p className="review__fix">{NEEDS_FIX}</p>}
          {/* YAZ-5229: the card is TEXT for VoiceOver (its question is read; a hidden word stays "Hidden word" until it
              shows), not one button with a label. The tap is the sighted way; VoiceOver has its own button below. A tap
              on a link, a pill, a picture or a sound is theirs, never a step (YAZ-5078 checker, M1). */}
          <div
            ref={cardBox}
            className="review__card card card-screen"
            // YAZ-5298: the CAPTURE phase. A sound player stops each click inside it (the Mac's `cardMedia`, so its own
            // clicks never reach the Mac's editor). Then a tap on its name, its time or its empty part never stepped the
            // card. The capture sees every tap first; only the player's own controls keep theirs.
            onClickCapture={(e) => {
              if (e.target instanceof Element && e.target.closest(CARD_OWN_TAPS) !== null) return
              advance()
            }}
          >
            {text !== null && page !== null ? <PhoneCard text={text} holder={card.path} show={{ sides: step.sides, shown: step.shown }} links={source.links} files={source.files} media={media} retry={retry} onOpen={open} /> : <div className="review__card-wait" aria-busy="true" />}
          </div>
          <button type="button" className="sr-only" onClick={advance} disabled={done}>
            {done ? 'The card is fully shown' : 'Show the next part'}
          </button>
          <p className="sr-only" aria-live="polite">
            {revealed}
          </p>
          {counts.length > 1 && <p className="review__sides">{`Side ${Math.min(step.sides, counts.length)} of ${counts.length}`}</p>}
        </>
      ) : (
        <DoneScreen review={review} session={session} addKinds={addKinds} />
      )}

      <div className="review__dock">
        {card !== null && (
          <div className="review__answers" data-guard={guarded ? '' : undefined}>
            {ratings.map((rating) => (
              <button key={rating} type="button" className="review__answer" data-rating={rating} disabled={page === null} onClick={() => answerWith(rating)}>
                {answerIcon(rating, review.settings.buttons)}
                <span>{answerLabel(rating, review.settings)}</span>
              </button>
            ))}
            <button type="button" className="review__more" aria-label="More card actions" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
              ⋯
            </button>
          </div>
        )}
        {menu === 'more' && card !== null && (
          <div className="review__menu review__menu--more" role="menu" aria-label="Card actions">
            <button type="button" role="menuitem" className="review__menu-row" disabled={page === null} onClick={() => act(`Archived · ${shortName(card.page, card.id)}`, () => review.turnOff())}>
              Archive card
            </button>
            <button
              type="button"
              role="menuitem"
              className="review__menu-row"
              disabled={page === null}
              onClick={() => {
                const on = page?.next !== true
                act(on ? 'Marked: Up next' : 'Removed: Up next', () => review.setNext(card.path, card.id, on))
              }}
            >
              {page?.next === true ? 'Remove from Up next' : 'Up next'}
            </button>
            <button type="button" role="menuitem" className="review__menu-row" disabled={page === null} onClick={toggleFix}>
              {fixed ? 'Remove Fix later' : 'Fix later'}
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
        <div className="review__last" role="status" aria-live="polite">
          {shownLine !== null && (
            <>
              <span>{shownLine.text}</span>
              {shownLine.undo && (
                <>
                  <span aria-hidden>·</span>
                  <button type="button" className="link-btn review__undo" onClick={undo}>
                    Undo
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
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

/** A tap on these in a card is theirs (open, play, look), never a step. */
/** What a tap keeps for itself (never a step): a link, a pill, a picture, a board, and a sound's Play and bar (YAZ-5298). */
const CARD_OWN_TAPS = 'a[href], [data-card-link], [data-card-board], img, .card__audio-play, .card__audio-bar, .page-media'

const shortName = (page: { text: string; fileTitle?: string } | null, id: string): string => {
  const t = page === null ? '' : (page.fileTitle ?? cardTitle(page.text)).trim()
  return t === '' ? id : t
}

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

function DoneScreen({ review, session, addKinds }: { review: CardReviewApi; session: CardReviewSession; addKinds: readonly AddKind[] }) {
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
