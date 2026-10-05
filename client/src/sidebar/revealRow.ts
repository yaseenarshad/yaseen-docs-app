import { basename } from '../lib/paths'

/** One "show this row in Files" gesture: a tab's menu, or a folder search row. */
export interface SidebarRevealRequest {
  id: number
  path: string
}

export const SIDEBAR_REVEAL_MS = 3000

export const revealMissingMessage = (path: string): string =>
  `Can't show "${basename(path)}" in Files — it is no longer there`

/** Flash every visible occurrence of `path`; the caller owns replacement/unmount cleanup. */
export function flashTreeRows(host: ParentNode, path: string): (() => void) | null {
  const rows = [...host.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
    .filter((row) => row.dataset.path === path)
  if (rows.length === 0) return null

  for (const row of rows) row.classList.add('tree__row--revealed')
  rows[0]?.scrollIntoView?.({ block: 'nearest' })
  const clear = () => rows.forEach((row) => row.classList.remove('tree__row--revealed'))
  const timer = setTimeout(clear, SIDEBAR_REVEAL_MS)
  return () => {
    clearTimeout(timer)
    clear()
  }
}
