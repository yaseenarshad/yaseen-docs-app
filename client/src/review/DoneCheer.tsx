/**
 * THE DONE SCREEN'S CHEER (YAZ-5662, Yaseen: "the party emoji above the title, … the green check mark … and then also
 * the burst of confetti"): ONE look for "Inbox complete." and "This page is done." / "This folder is done.", on the Mac
 * (`CardInbox`), the phone (`ReviewView`) and the course's mock Inbox (`InboxView`, the look only).
 *
 *  - A big 🎉 above the title, and a green ✓ in front of it (`--ok`: the green of the Due today ring).
 *  - One burst of confetti (`confetti.ts`, loaded only then) from the 🎉, the first time the screen shows after an
 *    answer of this session (`CardReviewSession.landing`): not when the tab opens again or the app comes back, and
 *    each landing once. Hidden, it waits and plays when it shows; it stops if the tab or the app goes away.
 *  - Reduce motion: the 🎉 and the ✓ still, no confetti.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import type { ConfettiOptions } from './confetti'
import './doneCheer.css'

export const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Whether a screen is in front: its tab shows (`shown`) and the window or the app is not hidden. */
export function useInFront(shown: boolean): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return shown && visible
}

/** The landings whose cheer played: each once, also when the screen draws again. */
const cheered = new Set<string>()

/** When the confetti starts after the 🎉 lands (ms). */
const BURST_AT = 180

interface LookProps {
  /** The title's own class (`card-inbox__done-title`, `review__done-title`). */
  className: string
  children: ReactNode
  /** 'play' while the 🎉 pops in; 'still' otherwise. */
  motion?: 'play' | 'still'
  partyRef?: Ref<HTMLDivElement>
  /** The course's own scale of the title as it lands. */
  titleStyle?: CSSProperties
}

/** The look alone: the 🎉 above, the title with its ✓. The course's mock Inbox draws this. */
export function DoneCheerLook({ className, children, motion = 'still', partyRef, titleStyle }: LookProps) {
  return (
    <>
      <div ref={partyRef} className="done-cheer__party" data-motion={motion} aria-hidden="true">
        🎉
      </div>
      {/* The ✓ is the title's `::before` (doneCheer.css): it adds nothing to what the title says or reads. */}
      <p className={`${className} done-cheer__title`} style={titleStyle}>
        {children}
      </p>
    </>
  )
}

interface Props extends Omit<LookProps, 'motion' | 'partyRef'> {
  /** This landing on the done screen (`CardReviewSession.landing`); null: none (no answer this session), no confetti. */
  landing: string | null
  /** The tab is the one on show. */
  shown: boolean
  /** Where the confetti plays (a selector the 🎉 is inside; default the Inbox) and how (the phone's lighter burst). */
  area?: string
  burst?: Omit<ConfettiOptions, 'within'>
}

export function DoneCheer({ landing, shown, area, burst, ...look }: Props) {
  const inFront = useInFront(shown)
  const front = useRef(inFront)
  front.current = inFront
  const partyRef = useRef<HTMLDivElement>(null)
  const stop = useRef<(() => void) | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (landing === null || !inFront || cheered.has(landing)) return
    cheered.add(landing)
    if (reducedMotion()) return
    setPlaying(true)
    const party = partyRef.current
    setTimeout(() => {
      if (party === null || !party.isConnected || !front.current) return
      void import('./confetti').then((m) => {
        if (!party.isConnected || !front.current) return
        stop.current = m.confettiBurst(party, { ...burst, within: area === undefined ? undefined : party.closest(area) })
      })
    }, BURST_AT)
  }, [landing, inFront]) // eslint-disable-line react-hooks/exhaustive-deps
  // The tab or the app goes away, or the screen goes: the confetti stops (it never shows over another tab).
  useEffect(() => {
    if (inFront) return
    stop.current?.()
    stop.current = null
  }, [inFront])
  useEffect(() => () => stop.current?.(), [])
  // Played: still from now on, so a tab hidden and shown again does not pop the 🎉 again.
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => setPlaying(false), 900)
    return () => clearTimeout(timer)
  }, [playing])
  return <DoneCheerLook {...look} motion={playing ? 'play' : 'still'} partyRef={partyRef} />
}
