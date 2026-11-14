/**
 * Today's review work in the Inbox (YAZ-5033): "Today: 31 cards · 9 min", in the top row and on the done screen.
 *
 * TIME SO FAR (YAZ-5130, Yaseen: "having it in sight will be stressful"): the time follows Settings › Review › Time so
 * far. Hidden (the default): a small clock in the time's place, and the time ONLY in the clock's hover box (round 2,
 * Yaseen: "its not a click, its a only show if the mouse goes over it"): the mouse on the clock shows it, the mouse
 * off hides it, and it never stays on screen. A keyboard focus on the clock shows it too, until the blur. Shown: the
 * time, as before. Off: no time and no clock. With no seconds today there is no time, and no clock. Only the words
 * change: the answer timer runs and saves each answer's seconds in all three.
 */
import type { ReviewedToday } from '@shared/cardSchedule'
import type { TimeSoFar } from '@shared/reviews'
import { HoverTip } from '../components/HoverTip'
import { ClockIcon } from './cardInboxIcons'
import { todayCards, todayDuration } from './reviewTime'

/** The words, inside the caller's own line; nothing with no card today. */
export function TodayWork({ today, time }: { today: ReviewedToday; time: TimeSoFar }) {
  const cards = todayCards(today)
  if (cards === '') return null
  if (today.seconds === 0 || time === 'off') return <>{cards}</>
  const spent = todayDuration(today.seconds)
  if (time === 'shown') return <>{`${cards} · ${spent}`}</>
  const words = `Time so far: ${spent}`
  return (
    <>
      {`${cards} · `}
      <HoverTip text={words} focus className="card-inbox__time-tip">
        {/* The keyboard reaches it (Tab); a press takes no focus, so a click shows nothing that stays. */}
        <span className="card-inbox__time" role="img" aria-label={words} tabIndex={0} onMouseDown={(e) => e.preventDefault()}>
          <ClockIcon size={13} />
        </span>
      </HoverTip>
    </>
  )
}
