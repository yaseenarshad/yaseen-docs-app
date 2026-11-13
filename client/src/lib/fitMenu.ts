import { cssZoom } from './cssZoom'

/** The gap a menu keeps from the window's top and bottom edges when it has to move or scroll to fit (13AO, YAZ-4970). */
export const MENU_EDGE = 8

/**
 * A menu taller than the window (YAZ-3746 13AO, YAZ-4970: the table's row menu ran off the bottom and did not scroll)
 * gets the window's height less `MENU_EDGE` at each end, and scrolls inside. Returns its box after the change, in screen px.
 */
function fitHeight(menu: HTMLElement): DOMRect {
  menu.style.maxHeight = ''
  menu.style.overflowY = ''
  const bounds = menu.getBoundingClientRect()
  const room = window.innerHeight - 2 * MENU_EDGE
  if (bounds.height <= room) return bounds
  menu.style.maxHeight = `${room / cssZoom(menu)}px`
  menu.style.overflowY = 'auto'
  return menu.getBoundingClientRect()
}

/**
 * A fixed `.ctx-menu` opened at `x`, `y` (screen px) made to fit the window (YAZ-4970): no taller than the window (it
 * scrolls), then moved left or up as far as it must to stay on screen. Returns the menu's own `left` and `top`: inside
 * a zoomed page they are scaled by the zoom (YAZ-3746 13AM).
 */
export function fitMenu(menu: HTMLElement, x: number, y: number): { left: number; top: number } {
  const bounds = fitHeight(menu)
  const z = cssZoom(menu)
  const left = Math.max(0, Math.min(x, window.innerWidth - bounds.width))
  const top = Math.max(MENU_EDGE, Math.min(y, window.innerHeight - MENU_EDGE - bounds.height))
  return { left: left / z, top: top / z }
}

/**
 * A submenu beside its parent row `row` (screen px), made to fit the window as `fitMenu` does: right of the row, else
 * left of it when it would spill (Finder's rule), top-aligned with the row and moved up to stay on screen.
 */
export function fitFlyout(menu: HTMLElement, row: DOMRect): { left: number; top: number } {
  const bounds = fitHeight(menu)
  const z = cssZoom(menu)
  const left = row.right + bounds.width > window.innerWidth ? Math.max(0, row.left - bounds.width) : row.right
  const top = Math.max(MENU_EDGE, Math.min(row.top, window.innerHeight - MENU_EDGE - bounds.height))
  return { left: left / z, top: top / z }
}
