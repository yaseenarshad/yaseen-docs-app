/**
 * How many levels of folder rows stick at the top of the sidebar's list (YAZ-3440 D2), written on
 * `.sidebar__body` for app.css: `data-sticky-levels="N"`, so a folder row deeper than N - 1 does not stick, and
 * `--sticky-levels: N`, the number `scroll-margin-top` reads. VS Code's rule: the setting's levels at most
 * (`sidebarStickyLevels`, 7 by default), and the stuck stack
 * never covers more than 40% of the list. The stickiness itself is CSS alone (D1), so a scroll runs no script.
 *
 * No React state: both are written on the node, and only when the value changes, so a resize of the
 * list renders no level of the tree (`sameLevel` in Tree.tsx). Both heights are `getBoundingClientRect`, screen
 * px, so the sidebar zoom (`zoom: var(--sidebar-zoom)` on the list) cancels out. A zoom change resizes the rows
 * and not the list, which no `ResizeObserver` sees: the caller runs this again for it.
 *
 * Returns the cleanup, which also clears both.
 */

/** A tree row's height in CSS px: 13px * 1.5 + 2 * 3px (app.css `.tree__row`). */
export const TREE_ROW_H = 25.5

/** The most of the list's height the stuck rows may cover (VS Code's 40%). */
const STICKY_MAX_SHARE = 0.4

/**
 * The levels that stick: `levels`, cut to the rows that fit in 40% of `listHeight`. A list with no height yet
 * (not laid out, or hidden) gets `levels`: it shows nothing to cover, and its first resize measures it.
 */
export function stickyCap(levels: number, listHeight: number, rowHeight: number): number {
  if (levels <= 0) return 0
  if (!(listHeight > 0) || !(rowHeight > 0)) return levels
  return Math.max(0, Math.min(levels, Math.floor((STICKY_MAX_SHARE * listHeight) / rowHeight)))
}

/** Writes the cap on `body` now and on each resize. `zoom` is the sidebar zoom as a factor (1 = 100%): the row height while the list has no row to measure. */
export function stickyFolders(body: HTMLElement, levels: number, zoom: number): () => void {
  const write = () => {
    const row = body.querySelector('.tree__row')?.getBoundingClientRect().height ?? 0
    const cap = String(stickyCap(levels, body.getBoundingClientRect().height, row > 0 ? row : TREE_ROW_H * zoom))
    if (body.getAttribute('data-sticky-levels') === cap) return
    body.setAttribute('data-sticky-levels', cap)
    body.style.setProperty('--sticky-levels', cap)
  }
  write()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write)
  observer?.observe(body)
  return () => {
    observer?.disconnect()
    body.removeAttribute('data-sticky-levels')
    body.style.removeProperty('--sticky-levels')
  }
}
