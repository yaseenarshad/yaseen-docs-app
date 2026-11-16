/**
 * THE FINISH SCREENS (YAZ-5665, Yaseen: "i want the desktop and the mobile to work the same"): what shows in place of
 * the card when nothing is left, ONE piece for the Mac's Inbox (`CardInbox`) and the phone's Review tab (`ReviewView`).
 * Each app gives its look (`DoneLook`: its classes, the phone's lighter confetti) and its own controls (the adds, the
 * folder pick, the Mac's course offer); the words, their order and the rules are these.
 *
 *  - Due today stopped (`session.end`): its ring screen (`DueTodayEnd`), and under "Due today is done." with no new
 *    card left, the rest of the screen below (no second title).
 *  - A filter done with other cards left (YAZ-5017): "No new cards left.", the filter's Add, "3 more in All cards".
 *  - The vault: 🎉 "✓ Inbox complete." (`DoneCheer`, YAZ-5662), then the course offer (the Mac, an empty vault), or
 *    "Review 12 more" (a new day began, YAZ-5623), or what waits and "Add 10 new cards" (YAZ-5042), or "Nothing else is
 *    due today. Enjoy your day!".
 *  - A page or a folder: 🎉 "✓ This page is done." / "This folder is done.", what waits and its Add, then "21 more in
 *    the Inbox", which starts the vault's review.
 *  - LAST, on every one of them: "Today: 25 cards · 12 min", the time always (`todayDone`): the Time so far setting
 *    hides it only during the review.
 */
import type { ReactNode } from 'react'
import type { AddKind } from '@shared/cardSchedule'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { DoneCheer } from './DoneCheer'
import { DueTodayEnd, type DoneLook } from './DueTodayEnd'
import { filterDone, reviewMoreCount, reviewMoreLabel, waitingLine } from './cardWords'
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
  const more = (label: string, onClick: () => void) => (
    <button type="button" className={look.more} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )
  const cheer = (title: string) => (
    <DoneCheer className={look.title} landing={session.landing} shown={shown} area={look.area} burst={look.burst}>
      {title}
    </DoneCheer>
  )
  const nothing = <p className={look.line}>Nothing else is due today. Enjoy your day!</p>
  const picked = pickLabel(session.newFrom)
  const waits = addKinds.length > 0 && (
    <>
      {/* YAZ-5322, the fallback: said out loud, so a card's folder is never a surprise. */}
      {session.newFallback && addKinds.includes('new') && <p className={`${look.line} card-done__fallback`}>No new cards left in {picked}, so these come from All folders.</p>}
      <p className={look.line}>{waitingLine(session.more, addKinds, session.newFallback ? '' : picked)}</p>
    </>
  )
  // The vault done while cards are still due (a new day began, a card came back; YAZ-5623): "Review 12 more".
  const again = session.scope === 'vault' ? reviewMoreCount(addKinds, review.dueCount) : 0
  // The rest of the vault, after a review of one page or one folder: the way on.
  const rest = session.scope === 'vault' ? 0 : review.dueCount
  /** What the screen says; `title` false under the Due today end, which has its own. */
  const body = (title: boolean) =>
    session.filter !== 'all' && session.counts.all > 0 ? (
      <>
        {title && <p className={look.title}>{filterDone(session.filter)}</p>}
        {adds}
        {more(`${session.counts.all} more in All cards`, () => review.setFilter('all'))}
      </>
    ) : session.scope === 'vault' ? (
      <>
        {title && cheer('Inbox complete.')}
        {offer !== undefined ? (
          offer
        ) : again > 0 ? (
          more(reviewMoreLabel(again), () => review.start({}))
        ) : adds === null ? (
          nothing
        ) : (
          <>
            {waits}
            {adds}
          </>
        )}
      </>
    ) : (
      <>
        {title && cheer(session.scope === 'page' ? unit('This page is done.') : 'This folder is done.')}
        {waits}
        {adds}
        {rest > 0 ? more(`${rest} more in the Inbox`, () => review.start({})) : adds === null && nothing}
      </>
    )
  const today = todayDone(session.today)
  return (
    <>
      {session.end !== null ? (
        <DueTodayEnd end={session.end} shown={shown} look={look} onGoOn={review.goOn} from={from}>
          {body(false)}
        </DueTodayEnd>
      ) : (
        body(true)
      )}
      {today !== '' && <p className={look.today}>{today}</p>}
    </>
  )
}
