/**
 * THE TIMED "ALLOW EDITS" OF ONE PAGE (YAZ-4939): the chip's box offers "Allow edits for 1 minute" · "10 minutes" ·
 * "Until I close this tab" (Yaseen's order, lowest first; 15 minutes and 1 hour were the first cut). The unlock is THIS tab's alone — a page's own switch, a board's and the vault's Read only
 * all stay as they are in their files — and `until` says it: null while the page is locked (nothing runs), `Infinity`
 * until the tab closes, else the moment it ends. ONE `setTimeout` per unlock, armed here and cleared on close or on
 * "Lock now"; no clock ticks here (the chip keeps its own 1-second tick, only while a timer runs). At zero the page
 * SAVES first (`beforeLock`: the host's flush), then locks again; the caret is the editor's own and stays.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type AllowFor = 'minute' | 'ten' | 'close'

/** The two timed choices, in ms. */
export const ALLOW_MS: Readonly<Record<Exclude<AllowFor, 'close'>, number>> = { minute: 60_000, ten: 10 * 60_000 }

export interface TimedUnlock {
  /** null: locked; Infinity: until the tab closes; else when the unlock ends (ms since the epoch). */
  until: number | null
  allow: (choice: AllowFor) => void
  /** "Lock now", and the cog's row while an unlock runs: save, then lock. */
  lock: () => void
}

export function useTimedUnlock(beforeLock: () => Promise<unknown> | void): TimedUnlock {
  const [until, setUntil] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Each allow is a run; a relock lands only for the run it belongs to (an allow during the save wins). */
  const run = useRef(0)
  const before = useRef(beforeLock)
  before.current = beforeLock
  const relock = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const own = ++run.current
    const done = () => {
      if (run.current === own) setUntil(null)
    }
    let saved: Promise<unknown> | void
    try {
      saved = before.current()
    } catch {
      saved = undefined
    }
    if (saved instanceof Promise) void saved.then(done, done)
    else done()
  }, [])
  const allow = useCallback(
    (choice: AllowFor) => {
      clearTimeout(timer.current)
      timer.current = undefined
      run.current++
      if (choice === 'close') {
        setUntil(Infinity)
        return
      }
      const ms = ALLOW_MS[choice]
      setUntil(Date.now() + ms)
      timer.current = setTimeout(relock, ms)
    },
    [relock],
  )
  // Cleared on close: a closed tab saves through its host's own unmount flush.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      timer.current = undefined
    },
    [],
  )
  return { until, allow, lock: relock }
}
