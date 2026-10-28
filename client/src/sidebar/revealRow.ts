/** One "show this row in Files" gesture: a tab's menu, a row's menu, or Enter and Shift+Enter in the search bar. */
export interface SidebarRevealRequest {
  id: number
  path: string
  /** The keyboard asked (YAZ-2662 D1, D8): the row gets the keyboard focus too. A menu item leaves the focus where it is (S12). */
  focus?: boolean
  /**
   * Files follows the open tab (YAZ-3440 D13, `sidebarRevealActive`): the Sidebar's own request, never App's. The
   * folders above the row open, and nothing else shows: no flash, no focus, no notice for a row that is not there.
   * A folder opens only the folders above it, not itself. The row scrolls to the centre if it was off screen, and a
   * row that shows does not move. It acts one time: a folder above it that opens again later scrolls nothing.
   */
  quiet?: boolean
}

export const SIDEBAR_REVEAL_MS = 3000

export const revealMissingMessage = (name: string): string =>
  `Can't show "${name}" in Files — it is no longer there`

/**
 * The row shows, below the folder rows stuck at the top (YAZ-3440 D1): its box is inside the list's, under the
 * row's own `scroll-margin-top` — the height of the rows that stick above it (app.css). The list is zoomed
 * (YAZ-3389), its boxes too; the margin is not, so the zoom scales it. jsdom has no boxes: every row shows.
 */
function rowShows(host: Element, row: HTMLElement): boolean {
  const list = host.getBoundingClientRect()
  const box = row.getBoundingClientRect()
  const zoom = Number.parseFloat(getComputedStyle(host).zoom) || 1
  const under = (Number.parseFloat(getComputedStyle(row).scrollMarginTop) || 0) * zoom
  return box.top >= list.top + under && box.bottom <= list.bottom
}

/**
 * Flash every visible occurrence of `path` — with `focus`, the first one gets the keyboard focus; the caller owns replacement/unmount cleanup.
 * `quiet` (YAZ-3440 D13): no flash and no focus — the first row scrolls to the centre of `host`, the list, if it did not show, and else not at all.
 */
export function flashTreeRows(host: ParentNode, path: string, focus = false, { quiet = false }: { quiet?: boolean } = {}): (() => void) | null {
  const rows = [...host.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
    .filter((row) => row.dataset.path === path)
  if (rows.length === 0) return null
  if (quiet) {
    if (host instanceof Element && !rowShows(host, rows[0])) rows[0].scrollIntoView?.({ block: 'center' })
    return () => {}
  }

  for (const row of rows) row.classList.add('tree__row--revealed')
  rows[0]?.scrollIntoView?.({ block: 'nearest' })
  if (focus) rows[0]?.focus()
  const clear = () => rows.forEach((row) => row.classList.remove('tree__row--revealed'))
  const timer = setTimeout(clear, SIDEBAR_REVEAL_MS)
  return () => {
    clearTimeout(timer)
    clear()
  }
}
