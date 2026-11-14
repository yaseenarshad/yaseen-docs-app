/**
 * How far a wide block may reach (YAZ-4783): a code block or a table may be wider than the text column, into the room on
 * its right, but never past the editor's scroll area, and never under the Contents rail that lies over the scroller's
 * right side (an edge there could not be grabbed again: the layer 1 demo check).
 *
 *  - `blockRightEdge`: that edge, in screen px. The code block's own drag (`code/codeWidth.ts`) stops at it.
 *  - `watchBlockRoom`: the same room for CSS, as `--block-room` on the editor's mount: px at 100% zoom from the right
 *    edge of `.ProseMirror` to that edge. app.css caps a code block or a table that takes the page's or Settings' width at
 *    `calc(100% + var(--block-room, 0px))`. Measured when the scroller or the body changes WIDTH (a window resize, the
 *    sidebar, the column width), when the zoom changes and when the host asks (`measure`, the table of contents turned on
 *    or off): never on a keystroke. A body that only grows taller is skipped before any measuring.
 */

/** The rightmost point a block of the page under `dom` may reach, in screen px: the scroller's inner right edge, or `gap` px left of a visible Contents rail. */
export function blockRightEdge(dom: HTMLElement, gap: number): number {
  const scroller = dom.closest<HTMLElement>('.editor-host') ?? dom
  // The ProseMirror root is an `.editor` too, so the rail is found from the page's side: the one whose editor holds `dom`.
  const rail = [...document.querySelectorAll<HTMLElement>('.toc__rail')].find((el) => el.parentElement?.closest('.editor')?.contains(dom) === true)
  const railLeft = rail?.checkVisibility?.() === true ?rail.getBoundingClientRect().left - gap : Infinity
  return Math.min(scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth, railLeft)
}

/** The rail's gap, as the code block's grip keeps it (`GRIP_WIDTH`). */
const RAIL_GAP = 8

/**
 * Keeps `--block-room` on `mount` up to date for the editor body `body` at zoom `zoom` (1 = 100%). Returns `measure`, to
 * call when something the observers do not see moved (the table of contents), and `stop`.
 */
export function watchBlockRoom(mount: HTMLElement, body: HTMLElement, zoom: number): { measure: () => void; stop: () => void } {
  const scroller = mount.closest<HTMLElement>('.editor-host')
  let last = ''
  const measure = (): void => {
    const room = scroller === null ? 0 : Math.max(0, Math.floor((blockRightEdge(body, RAIL_GAP) - body.getBoundingClientRect().right) / zoom))
    const value = `${room}px`
    if (value === last) return
    last = value
    mount.style.setProperty('--block-room', value)
  }
  const widths = new WeakMap<Element, number>()
  const observer = new ResizeObserver((entries) => {
    let moved = false
    for (const entry of entries) {
      const width = entry.contentRect.width
      if (widths.get(entry.target) !== width) moved = true
      widths.set(entry.target, width)
    }
    if (moved) measure()
  })
  observer.observe(body)
  if (scroller !== null) observer.observe(scroller)
  measure()
  return {
    measure,
    stop: () => {
      observer.disconnect()
      mount.style.removeProperty('--block-room')
    },
  }
}
