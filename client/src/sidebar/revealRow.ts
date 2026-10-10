/** One "show this row in Files" gesture: a tab's menu, a row's menu, or Enter and Shift+Enter in the search bar. */
export interface SidebarRevealRequest {
  id: number
  path: string
  /** The keyboard asked (YAZ-2662 D1, D8): the row gets the keyboard focus too. A menu item leaves the focus where it is (S12). */
  focus?: boolean
}

export const SIDEBAR_REVEAL_MS = 3000

export const revealMissingMessage = (name: string): string =>
  `Can't show "${name}" in Files — it is no longer there`

/** Flash every visible occurrence of `path` — with `focus`, the first one gets the keyboard focus; the caller owns replacement/unmount cleanup. */
export function flashTreeRows(host: ParentNode, path: string, focus = false): (() => void) | null {
  const rows = [...host.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
    .filter((row) => row.dataset.path === path)
  if (rows.length === 0) return null

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
