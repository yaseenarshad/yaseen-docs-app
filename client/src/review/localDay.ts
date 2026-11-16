import { useEffect, useRef, useState } from 'react'

/** The ms from `now` to the next local midnight, and a little more, so the clock has passed it when the timer fires. */
export const msToMidnight = (now = Date.now()): number => new Date(now).setHours(24, 0, 0, 0) - now + 50

/**
 * Today's local date (`toDateString`), live (YAZ-5611 spec 21, YAZ-5615): Review's day is the device's calendar day
 * from local midnight. A timer to the next midnight moves it, and so does the window or the page coming back (focus,
 * `visibilitychange`): a Mac that slept over midnight runs no timer (its timers stop while it sleeps), and a phone
 * app in the background runs none. Each wake sets the timer again from the clock. The same day sets nothing, so React
 * draws nothing. `on` false (a slot with no vault): no timer, no listener. The ONE day timer: Review and Recent (the
 * sidebar, Review rules v1 rule 17) both use it.
 */
export function useLocalDay(on = true): string {
  const [day, setDay] = useState(() => new Date().toDateString())
  const latest = useRef(day)
  useEffect(() => {
    if (!on) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      const now = new Date().toDateString()
      // Not even an update with the same day: a list that counts its draws (Recent) draws nothing.
      if (now !== latest.current) setDay((latest.current = now))
      clearTimeout(timer)
      timer = setTimeout(wake, msToMidnight())
    }
    wake()
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [on])
  return day
}
