import type { TocLines } from '@shared/types'

/**
 * THE GUIDE LINES OF SEARCH'S TREE, the Mac sidebar's level lines (app.css
 * `.tree[role='group']::before`, `levelLinesHover.ts`): one thin grey line below the chevron of each open folder, down
 * past every row inside it. The Mac nests a list in each folder and draws one line on it; the phone's tree is one flat
 * list, so each row draws the lines of the levels above it (treeLook.css, one gradient on `::before`, no node more).
 *
 * When they show is the Mac's `sidebarLines`, written as `data-lines` on the list:
 *  - `always`, `off`: as on the Mac.
 *  - `hover` (the Mac's default: while the mouse is over the list): a phone has no mouse, so while a finger is on the
 *    list, and while it scrolls on after the finger lifts, then `LINES_LINGER` ms more. `data-touch` on the list, written
 *    only when it changes (the Mac's `data-mouse-in`, an attribute, never `:hover` on an ancestor of the rows).
 *
 * The look is the Mac's default `plain` (grey lines). Its `thread` style follows the mouse to the row under it, which a
 * phone has not: the phone draws it plain.
 *
 * Returns the cleanup, which also clears both attributes.
 */
export const LINES_LINGER = 800

export function guideLines(list: HTMLElement, scroller: HTMLElement, mode: TocLines): () => void {
  list.dataset.lines = mode
  if (mode !== 'hover') return () => delete list.dataset.lines
  let down = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const set = (on: boolean) => {
    if (list.hasAttribute('data-touch') === on) return
    if (on) list.setAttribute('data-touch', '')
    else list.removeAttribute('data-touch')
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(() => set(false), LINES_LINGER)
  }
  const start = () => {
    down = true
    clearTimeout(timer)
    set(true)
  }
  const end = () => {
    down = false
    later()
  }
  // A scroll the finger started goes on after it lifts (momentum): the lines stay until it stops.
  const scrolled = () => {
    if (!down && list.hasAttribute('data-touch')) later()
  }
  list.addEventListener('touchstart', start, { passive: true })
  list.addEventListener('touchend', end, { passive: true })
  list.addEventListener('touchcancel', end, { passive: true })
  scroller.addEventListener('scroll', scrolled, { passive: true })
  return () => {
    clearTimeout(timer)
    list.removeEventListener('touchstart', start)
    list.removeEventListener('touchend', end)
    list.removeEventListener('touchcancel', end)
    scroller.removeEventListener('scroll', scrolled)
    set(false)
    delete list.dataset.lines
  }
}
