import { useEffect, useState } from 'react'

/** The ms from `now` to the next local midnight, and a little more, so the clock has passed it when the timer fires. */
export const msToMidnight = (now = Date.now()): number => new Date(now).setHours(24, 0, 0, 0) - now + 50

/**
 * Today's local date (`toDateString`), live (YAZ-5611 spec 21, YAZ-5615): Review's day is the device's calendar day
 * from local midnight. A timer to the next midnight moves it, and so does the window or the page coming back (focus,
 * `visibilitychange`): a Mac that slept over midnight runs no timer (its timers stop while it sleeps), and a phone
 * app in the background runs none. Each wake sets the timer again from the clock. The same day sets the same string,
 * so React draws nothing. `on` false (a slot with no vault): no timer, no listener.
 */
export function useLocalDay(on = true): string {
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    if (!on) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setDay(new Date().toDateString())
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
