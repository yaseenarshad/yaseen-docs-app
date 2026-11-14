import { useEffect } from 'react'

/** The parts of the Screen Wake Lock API the review uses (Safari 16.4+). */
interface WakeLockSentinelLike {
  release(): Promise<void>
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

/**
 * Round 10, addition 4: the screen stays on while a card shows. iOS lets a page ask for it (the Screen Wake Lock API);
 * it ends the lock by itself when the app goes to the background, so the lock is asked for again when the app comes
 * back. Where the API is missing or says no (an older iOS, Low Power Mode), nothing shows: the screen dims as usual.
 */
export function useWakeLock(on: boolean, nav: { wakeLock?: WakeLockLike } = navigator as { wakeLock?: WakeLockLike }, doc: Document = document): void {
  useEffect(() => {
    const api = nav.wakeLock
    if (!on || api === undefined) return
    // ONE lock at most (YAZ-5232): an ask that is still open counts as held, and a lock that comes when one is held
    // already, or after the leave, is let go at once.
    let held: WakeLockSentinelLike | null = null
    let asking = false
    let live = true
    const ask = () => {
      if (doc.visibilityState !== 'visible' || held !== null || asking) return
      asking = true
      api.request('screen').then(
        (lock) => {
          asking = false
          if (live && held === null) held = lock
          else void lock.release().catch(() => undefined)
        },
        () => {
          asking = false // the quiet fallback
        },
      )
    }
    const seen = () => {
      // Hidden: iOS ends the lock itself (let go of ours too). Visible again: ask once more.
      if (doc.visibilityState === 'visible') ask()
      else if (held !== null) {
        void held.release().catch(() => undefined)
        held = null
      }
    }
    ask()
    doc.addEventListener('visibilitychange', seen)
    return () => {
      live = false
      doc.removeEventListener('visibilitychange', seen)
      if (held !== null) void held.release().catch(() => undefined)
      held = null
    }
  }, [on, nav, doc])
}
