/**
 * Today's review work in the Inbox (YAZ-5033): "Today: 31 cards · 9 min", in the top row and on the done screen.
 *
 * TIME SO FAR (YAZ-5130, Yaseen: "having it in sight will be stressful"): the time follows Settings › Review › Time so
 * far. Hidden (the default): a small clock in the time's place; a click shows the time, and a click on the time hides it
 * again. Shown: the time, as before. Off: no time and no clock. With no seconds today there is no time, and no clock.
 * Only the words change: the answer timer runs and saves each answer's seconds in all three.
 */
import type { ReviewedToday } from '@shared/cardSchedule'
import type { TimeSoFar } from '@shared/reviews'
import { HoverTip } from '../components/HoverTip'
import { ClockIcon } from './cardInboxIcons'
import { todayCards, todayDuration } from './reviewTime'

/** How the time shows: the setting, and (hidden) whether a click showed it. The Inbox holds `open`, so the top row and the done screen agree. */
export interface TimeView {
  mode: TimeSoFar
  open: boolean
  setOpen: (open: boolean) => void
}

/** The words, inside the caller's own line; nothing with no card today. */
export function TodayWork({ today, time: { mode, open, setOpen } }: { today: ReviewedToday; time: TimeView }) {
  const cards = todayCards(today)
  if (cards === '') return null
  if (today.seconds === 0 || mode === 'off') return <>{cards}</>
  if (mode === 'shown') return <>{`${cards} · ${todayDuration(today.seconds)}`}</>
  const label = open ? 'Hide time so far' : 'Show time so far'
  return (
    <>
      {`${cards} · `}
      <HoverTip text={label} className="card-inbox__time-tip">
        <button type="button" className="card-inbox__time" aria-label={label} aria-pressed={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
          {open ? todayDuration(today.seconds) : <ClockIcon size={13} />}
        </button>
      </HoverTip>
    </>
  )
}
