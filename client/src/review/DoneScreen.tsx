/**
 * THE FINISH SCREENS (YAZ-5665, Yaseen: "i want the desktop and the mobile to work the same"): what shows in place of
 * the card when nothing is left or Due today stops, ONE piece for the Mac's Inbox (`CardInbox`) and the phone's Review
 * tab (`ReviewView`). Each app gives its look (`DoneLook`: its classes, the phone's lighter confetti) and its own
 * controls (the adds, the folder pick, the Mac's course offer); the words, their order and the rules are these.
 *
 * MOCHI'S ORDER AND WORDS (YAZ-5678; YAZ-5671 findings 10, 12, 16, 19; no Skip and finish, Yaseen on YAZ-5672), each
 * with OUR 🎉 above the title, its green ✓ and one burst of confetti (`DoneCheer`: once per landing, none under Reduce
 * motion), and our Today line last:
 *  - The first pass with misses: its ring screen (`DueTodayEnd`), "You remembered 60% of cards." · Review missed cards.
 *  - Due today done: "Finished reviewing missed cards." (after a missed pass) or "Finished reviewing." (none missed);
 *    then "How about learning some new cards?" · Learn new cards N, or, with no new card left, what follows below.
 *  - Due today's list done with no stop (nothing answered there): "Finished reviewing." the same way.
 *  - New cards' list done: "Finished learning cards." / "Now let's review the cards you've learned." · Review cards N
 *    (the learned cards wait under Due today).
 *  - Up next's list done (ours; Mochi has no Up next): "No Up next cards left." and "3 more in All cards".
 *  - Nothing left in the vault: "Inbox complete.", then the course offer (the Mac, an empty vault), or "Review cards
 *    12" (a new day began, YAZ-5623), or what waits and "Add 10 new cards" (YAZ-5042), or "Nothing else is due today.
 *    Enjoy your day!".
 *  - A page or a folder done: "This page is done." / "This folder is done.", what waits and its Add, then Mochi's
 *    "You have cards due in other pages." · Review cards 21, which starts the vault's review.
 *  - LAST, on every one of them: "Today: 21 cards · 12 min", the cards menu's words and the time always (`todayDone`, YAZ-5710): the Time so far
 *    setting hides it only during the review.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { AddKind } from '@shared/cardSchedule'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { DoneCheer } from './DoneCheer'
import { DueTodayEnd, GoButton, PlusIcon, RefreshIcon, type DoneLook } from './DueTodayEnd'
import { reviewMoreCount } from './cardWords'
import { pickAddMoreQuestion, pickDoneMessage } from './doneMessages'
import { pickLabel } from './inboxMenu'
import { todayDone } from './reviewTime'

export type { DoneLook }

interface Props {
  review: Pick<CardReviewApi, 'dueCount' | 'start' | 'setFilter' | 'goOn'>
  session: CardReviewSession
  /** The screen's tab is the one on show (the ring and the confetti wait for it). */
  shown: boolean
  look: DoneLook
  /** The kinds that wait past today's number, with an add (under a filter, only its kind). */
  addKinds: readonly AddKind[]
  /** The app's add buttons for `addKinds`; null when nothing waits. */
  adds: ReactNode | null
  /** The new cards' folder pick, after "Learn new cards": "from Spanish ▾" (the Mac), "from Spanish ›" (the phone). */
  from: ReactNode
  /** The vault's word for "page". */
  unit: (text: string) => string
  /** The Mac's course offer in an empty vault (YAZ-5120), in place of the way on. */
  offer?: ReactNode
}

export function DoneScreen({ review, session, shown, look, addKinds, adds, from, unit, offer }: Props) {
  // YAZ-6041: 2-step add trigger — Click 1 expands the add controls in place, Click 2 adds immediately.
  const [addOpen, setAddOpen] = useState(false)
  useEffect(() => {
    setAddOpen(false)
  }, [session.landing, session.scope, session.filter])
  const more = (label: string, onClick: () => void) => (
    <button type="button" className={look.more} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )
  const line = (words: string) => <p className={look.line}>{words}</p>
  /** YAZ-6041: keeps "Enjoy your day!" intact on a clean second line on narrow phones while reading as one line when wide. */
  const splitLine = (first: string, second: string) => (
    <p className={look.line}>
      <span className="done-phrase">{first}</span>{' '}
      <span className="done-phrase">{second}</span>
    </p>
  )
  const go = (icon: ReactNode, words: string, count: number, onClick: () => void, after?: ReactNode) => (
    <div className="due-end__actions">
      <GoButton look={look} icon={icon} words={words} count={count} onClick={onClick} />
      {after}
    </div>
  )
  const learnNew = (count: number, onClick: () => void) => (
    <>
      {line('How about learning some new cards?')}
      {go(<PlusIcon />, 'Learn new cards', count, onClick, from)}
    </>
  )
  const cheer = (title: string) => (
    <DoneCheer className={look.title} landing={session.landing} shown={shown} area={look.area} burst={look.burst}>
      {title}
    </DoneCheer>
  )
  const today = todayDone(session.today)
  const todayEl = today !== '' ? <p className={look.today}>{today}</p> : null
  const [doneA, doneB] = pickDoneMessage({ landing: session.landing, todayCards: session.today.cards, answered: session.answered })
  const doneMsg = splitLine(doneA, doneB)
  const nothing = session.today.cards > 0 ? doneMsg : splitLine('Nothing else is due today.', 'Enjoy your day!')
  const picked = pickLabel(session.newFrom)
  const { counts, end } = session
  const vault = session.scope === 'vault'
  // The vault done while cards are still due (a new day began, a card came back; YAZ-5623): "Review cards 12".
  const again = vault ? reviewMoreCount(addKinds, review.dueCount) : 0
  // The rest of the vault, after a review of one page or one folder: Mochi's "cards due in other decks".
  const rest = vault ? 0 : review.dueCount
  // YAZ-6041: upbeat rotating completion line + Today stats right beneath it, then breathing room before 2-step Add more.
  const waits = addKinds.length > 0 && (
    <>
      {/* YAZ-5322, the fallback: said out loud, so a card's folder is never a surprise. */}
      {session.newFallback && addKinds.includes('new') && <p className={`${look.line} card-done__fallback`}>No new cards left in {picked}, so these come from All folders.</p>}
      {(vault || rest === 0) && doneMsg}
    </>
  )
  const gatedAdds =
    adds === null ? null : addOpen ? (
      <div className="done-add-expanded">
        {adds}
        <button type="button" className="done-add-cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => setAddOpen(false)}>
          Cancel
        </button>
      </div>
    ) : (
      <button type="button" className="done-add-trigger" onMouseDown={(e) => e.preventDefault()} onClick={() => setAddOpen(true)}>
        {pickAddMoreQuestion(session.landing)}
      </button>
    )
  const inlineToday = !(end?.kind === 'missed') && !(end?.kind === 'done' && (end.fresh > 0 || counts.all > 0)) && !(session.filter === 'new' && counts.all > 0) && !(session.filter === 'due' && counts.all > 0) && !(session.filter !== 'all' && counts.all > 0)
  const divider = <div className="done-divider" aria-hidden="true" />
  /** What follows when nothing of the session is left: the scope's own way on. */
  const after = vault ? (
    offer !== undefined ? (
      <>
        {inlineToday && todayEl}
        {offer}
      </>
    ) : again > 0 ? (
      <>
        {inlineToday && todayEl}
        {go(<RefreshIcon />, 'Review cards', again, () => review.start({}))}
      </>
    ) : gatedAdds === null ? (
      <>
        {nothing}
        {inlineToday && todayEl}
      </>
    ) : (
      <>
        {waits}
        {inlineToday && todayEl}
        {divider}
        {gatedAdds}
      </>
    )
  ) : (
    <>
      {waits}
      {rest === 0 && gatedAdds !== null && (
        <>
          {inlineToday && todayEl}
          {divider}
          {gatedAdds}
        </>
      )}
      {rest > 0 ? (
        <>
          {gatedAdds}
          {line(unit('You have cards due in other pages.'))}
          {go(<RefreshIcon />, 'Review cards', rest, () => review.start({}))}
          {inlineToday && todayEl}
        </>
      ) : (
        gatedAdds === null && (
          <>
            {nothing}
            {inlineToday && todayEl}
          </>
        )
      )}
    </>
  )
  const allLeft = more(`${counts.all} more in All cards`, () => review.setFilter('all'))

  let body: ReactNode
  if (end?.kind === 'missed') body = <DueTodayEnd end={end} shown={shown} look={look} onGoOn={review.goOn} />
  else if (end?.kind === 'done')
    body = (
      // Kept as the stop it is (`data-kind`), with no ring: a finish screen.
      <div className="due-end" data-kind="done">
        {cheer(end.remembered < end.count ? 'Finished reviewing missed cards.' : 'Finished reviewing.')}
        {end.fresh > 0 ? (
          learnNew(end.fresh, review.goOn)
        ) : counts.all > 0 ? (
          <>
            {gatedAdds}
            {allLeft}
          </>
        ) : (
          after
        )}
      </div>
    )
  else if (session.filter === 'new' && counts.all > 0)
    body = (
      <>
        {cheer('Finished learning cards.')}
        {counts.due > 0 ? (
          <>
            {line("Now let's review the cards you've learned.")}
            {go(<RefreshIcon />, 'Review cards', counts.due, () => review.setFilter('due'))}
          </>
        ) : (
          allLeft
        )}
        {gatedAdds}
      </>
    )
  else if (session.filter === 'due' && counts.all > 0)
    body = (
      <>
        {cheer('Finished reviewing.')}
        {counts.new > 0 ? learnNew(counts.new, () => review.setFilter('new')) : allLeft}
      </>
    )
  else if (session.filter !== 'all' && counts.all > 0)
    body = (
      <>
        {cheer('No Up next cards left.')}
        {gatedAdds}
        {allLeft}
      </>
    )
  else
    body = (
      <>
        {cheer(vault ? 'Inbox complete.' : session.scope === 'page' ? unit('This page is done.') : 'This folder is done.')}
        {after}
      </>
    )
  return (
    <>
      {body}
      {!inlineToday && todayEl}
    </>
  )
}
