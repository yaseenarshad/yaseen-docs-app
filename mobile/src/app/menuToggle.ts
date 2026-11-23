import { useEffect, useRef } from 'react'
import { useOverlay } from './browserHistory'

/**
 * ONE RULE FOR EVERY MENU (YAZ-5552, after YAZ-5539): a tap on a menu's button opens it, a tap on it again closes it,
 * a tap anywhere else closes it and does nothing else, and Escape or Back closes it.
 *
 * The bug it ends: the screen's own tap listener closed the menu on the button's press, React drew, and the button's
 * click then read "closed" and opened it again (on a real tap the browser lets React draw between the two). So the
 * tap-outside listener leaves the menu's OWN taps (the menu, and the button that opens it) to them: the button's
 * click is the one toggle. Any other press closes the menu, and the click of that press is eaten (in the capture
 * phase, before React or the screen sees it): a tap outside an open menu only closes it.
 *
 * `own`: a selector for the menu and its button(s), or a test of a press's target. `close(why)`: the menu's own close.
 */
export type MenuClose = 'tap' | 'escape' | 'back'

export function useMenuToggle(open: boolean, close: (why: MenuClose) => void, own: string | ((target: Node) => boolean)): void {
  const latest = useRef({ close, own })
  latest.current = { close, own }
  // YAZ-5518: an open menu is an overlay of the app's one stack: a Back closes it, and the screen stays.
  useOverlay(open, () => latest.current.close('back'))
  useEffect(() => {
    if (!open) return
    const down = (e: Event) => {
      if (isOwn(e.target, latest.current.own)) return
      eatNextClick(e)
      latest.current.close('tap')
    }
    // One Escape closes the top thing: the menu, not the sheet or the screen under it too.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      latest.current.close('escape')
    }
    // The press at the document's bubble: after the screen's own listeners have read it (the edge swipe counts the
    // overlays open as the finger comes down: YAZ-5518), before its click.
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])
}

function isOwn(target: EventTarget | null, own: string | ((target: Node) => boolean)): boolean {
  if (!(target instanceof Node)) return false
  if (typeof own !== 'string') return own(target)
  const el = target instanceof Element ? target : target.parentElement
  return el?.closest(own) != null
}

/** After the finger lifts, its click comes this soon (ms), or not at all (the press was a scroll or a hold). */
const CLICK_WAIT_MS = 400

/** A finger that moves farther than this (px) scrolls or swipes: no click follows. */
const SLOP = 10

/**
 * The press that closed a menu: its click (if it comes) is eaten. A click comes only after its lift (`pointerup`,
 * `touchend`), so only a click after the lift is eaten: a click with none (a key, a screen reader) is no finger's. A
 * press that never becomes a click (a scroll, a swipe, a hold) leaves nothing behind: a move past `SLOP`, a cancel,
 * the next press, or `CLICK_WAIT_MS` after the lift ends the wait.
 */
function eatNextClick(down: Event): void {
  const lifts = ['pointerup', 'touchend'] as const
  const cancels = ['pointercancel', 'touchcancel'] as const
  const moves = ['pointermove', 'touchmove'] as const
  let timer: ReturnType<typeof setTimeout> | undefined
  const at = (e: Event): { x: number; y: number } | null => {
    const p = 'touches' in e ? (e as TouchEvent).touches[0] : (e as PointerEvent)
    return typeof p?.clientX === 'number' ? { x: p.clientX, y: p.clientY } : null
  }
  let from = at(down)
  const start = (e: Event) => void (from ??= at(e))
  const move = (e: Event) => {
    const now = at(e)
    if (from !== null && now !== null && Math.hypot(now.x - from.x, now.y - from.y) > SLOP) end()
  }
  const end = () => {
    clearTimeout(timer)
    document.removeEventListener('click', eat, true)
    document.removeEventListener('pointerdown', end, true)
    document.removeEventListener('touchstart', start, true)
    for (const type of lifts) document.removeEventListener(type, lift, true)
    for (const type of cancels) document.removeEventListener(type, end, true)
    for (const type of moves) document.removeEventListener(type, move, true)
  }
  const lift = () => void (timer ??= setTimeout(end, CLICK_WAIT_MS))
  const eat = (e: MouseEvent) => {
    const finger = timer !== undefined
    end()
    if (!finger) return
    e.preventDefault()
    e.stopPropagation()
  }
  document.addEventListener('click', eat, true)
  // The next press ends the wait (this press already passed the document's capture: it never calls this one).
  document.addEventListener('pointerdown', end, true)
  document.addEventListener('touchstart', start, true)
  for (const type of lifts) document.addEventListener(type, lift, true)
  for (const type of cancels) document.addEventListener(type, end, true)
  for (const type of moves) document.addEventListener(type, move, true)
}
