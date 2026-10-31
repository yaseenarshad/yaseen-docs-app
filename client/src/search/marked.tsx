/**
 * The marks of a search row (🔒 D5, YAZ-2620; YAZ-3748 D3, B3): one pure function, shared by the search tree (`Tree`)
 * and the flat result list (`SearchResults`), so the flat list does not load the tree module. The class stays
 * `tree__mark`: one look in both lists (`app.css`).
 */
import type { ReactNode } from 'react'
import { matchRanges, type Needle } from '../links/completion'

/**
 * `label` with the typed text marked where the matcher found it: one mark per range of `matchRanges` — the whole text
 * where it first sits, else each typed word, else the joined text. A label that does not hold it (an alias, an id or
 * the file name matched, B4) is drawn plain.
 */
export function marked(label: string, needle: Needle | undefined) {
  const ranges = needle === undefined ? [] : matchRanges(label, needle)
  if (ranges.length === 0) return label
  const parts: ReactNode[] = []
  let from = 0
  for (const [start, end] of ranges) {
    parts.push(label.slice(from, start), <mark key={start} className="tree__mark">{label.slice(start, end)}</mark>)
    from = end
  }
  parts.push(label.slice(from))
  return <>{parts}</>
}
