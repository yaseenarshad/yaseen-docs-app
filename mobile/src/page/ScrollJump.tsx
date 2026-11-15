import { useEffect, useState, type RefObject } from 'react'
import './scrollJump.css'

/**
 * JUMP TO THE TOP OR THE BOTTOM (YAZ-5467). A small, quiet pill at the right edge, near its vertical middle (clear of the
 * page arrows and of a Comment button over them), with ⤒ and ⤓. It shows while the person scrolls and fades about 1.5 s
 * after the last move; faded, it takes no tap. A tap glides to the top or the bottom, at once with Reduce Motion.
 *
 * Only on a long text: one at least `LONG_SCREENS` screens tall. The document never scrolls (YAZ-5436): the pill moves
 * the scroller it is given (a page's or a card's `.screen`, Review's card box).
 */

/** How long the pill stays after the last scroll. */
export const FADE_MS = 1500
/** A text this many screens tall, or taller, is long. */
export const LONG_SCREENS = 2

const reduced = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Moves `scroller` to `top`: smooth, or at once with Reduce Motion (or where `scrollTo` is missing). */
function glideTo(scroller: HTMLElement, top: number): void {
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' })
  else scroller.scrollTop = top
}

/** `scroller`: the element that scrolls, or with `closest`, an element inside it (the scroller is its closest match). */
export function ScrollJump({ scroller: ref, closest }: { scroller: RefObject<HTMLElement | null>; closest?: string }) {
  const [shown, setShown] = useState(false)
  const [long, setLong] = useState(false)
  useEffect(() => {
    const at = ref.current
    const scroller = at === null ? null : closest === undefined ? at : at.closest<HTMLElement>(closest)
    if (scroller == null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      const isLong = scroller.scrollHeight >= LONG_SCREENS * scroller.clientHeight && scroller.clientHeight > 0
      setLong(isLong)
      if (!isLong) return
      setShown(true)
      clearTimeout(timer)
      timer = setTimeout(() => setShown(false), FADE_MS)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [ref, closest])
  if (!long) return null
  const go = (end: boolean) => {
    const at = ref.current
    const scroller = at === null ? null : closest === undefined ? at : at.closest<HTMLElement>(closest)
    if (scroller != null) glideTo(scroller, end ? scroller.scrollHeight - scroller.clientHeight : 0)
  }
  return (
    <div className="scroll-jump" data-on={shown || undefined}>
      <button type="button" className="scroll-jump__btn" aria-label="Go to top" onClick={() => go(false)}>
        ⤒
      </button>
      <button type="button" className="scroll-jump__btn" aria-label="Go to bottom" onClick={() => go(true)}>
        ⤓
      </button>
    </div>
  )
}
