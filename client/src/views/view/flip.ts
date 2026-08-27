import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Board motion (YAZ-944): FLIP — First, Last, Invert, Play. React re-renders the columns and the
 * cards JUMP to their new spots; we measure where each card WAS (First) and where it landed
 * (Last), then hand it back the difference as an inverted `translate` with transitions off
 * (Invert) so it paints exactly where the eye last saw it — and clear that transform one forced
 * reflow later so the CSS `transition: transform` slides it home (Play). No animation library, no
 * rAF loop: the browser's own compositor does the tweening. `flipPlan` is the measured half, kept
 * pure and pinned by tests; the DOM choreography around it is deliberately thin. One `useFlip`
 * covers the WHOLE board, so a card dragged between columns is a move, not a death and a birth.
 */

export interface FlipRect {
  x: number
  y: number
}

export interface FlipPlan {
  /** Inverted deltas (previous minus next) for the cards that actually shifted, by flip key. */
  moves: Map<string, { dx: number; dy: number }>
  /** Keys present only in the next frame — those get the entrance, never a move. */
  entered: string[]
}

/** Sub-pixel jitter is layout noise, not motion: below a pixel on both axes nothing animates. */
export function flipPlan(prev: Map<string, FlipRect>, next: Map<string, FlipRect>): FlipPlan {
  const moves = new Map<string, { dx: number; dy: number }>()
  const entered: string[] = []
  for (const [key, to] of next) {
    const from = prev.get(key)
    if (from === undefined) {
      entered.push(key)
      continue
    }
    const dx = from.x - to.x
    const dy = from.y - to.y
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    moves.set(key, { dx, dy })
  }
  return { moves, entered }
}

const ENTER = 'view-flip-enter'

/** Ref callback for the animated container; its `[data-flip-key]` descendants are what move. */
export function useFlip(): (el: HTMLElement | null) => void {
  const root = useRef<HTMLElement | null>(null)
  const prev = useRef<Map<string, FlipRect> | null>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (el === null) return
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-flip-key]'))
    const next = new Map<string, FlipRect>()
    for (const node of nodes) {
      const { x, y } = node.getBoundingClientRect()
      next.set(node.dataset.flipKey ?? '', { x, y })
    }
    const first = prev.current
    prev.current = next
    // The first commit has nothing to play from; reduced motion never plays at all.
    if (first === null || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) return
    const plan = flipPlan(first, next)
    const entered = new Set(plan.entered)
    for (const node of nodes) {
      const key = node.dataset.flipKey ?? ''
      const move = plan.moves.get(key)
      if (move !== undefined) {
        node.style.transition = 'none'
        node.style.transform = `translate(${move.dx}px, ${move.dy}px)`
        node.getBoundingClientRect() // the one forced reflow: the invert must paint before the play
        node.style.transition = ''
        node.style.transform = ''
      } else if (entered.has(key)) {
        node.classList.add(ENTER)
        node.addEventListener('animationend', () => node.classList.remove(ENTER), { once: true })
      }
    }
  })

  return useCallback((el: HTMLElement | null) => {
    root.current = el
  }, [])
}
