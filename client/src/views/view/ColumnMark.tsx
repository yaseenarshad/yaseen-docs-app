import type { ColumnSources } from '../columnInheritance'

/** The four header states (YAZ-4713 C11, locked 2026-11-08): none (this folder's own), from a parent, from a subfolder, a separate value. */
type Mark = { icon: 'parent' | 'below' | 'lock'; title: string; name: string }

/** Where the column's mark says it comes from, or null for this folder's own column. `separate`: the page's declaration says so (C3). */
export function columnMark(sources: ColumnSources, key: string, separate: boolean): Mark | null {
  if (separate) return { icon: 'lock', title: `Separate value for ${sources.folderName}`, name: sources.folderName }
  const { from, below } = sources.of(key)
  if (from !== undefined) return { icon: 'parent', title: `From ${from}`, name: from }
  if (below !== undefined) return { icon: 'below', title: `From ${below}`, name: below }
  return null
}

/** Tabler-style strokes on a 24 grid: corner-down-right (↳), corner-left-up (↑), lock. */
const PATHS: Record<Mark['icon'], string> = {
  parent: 'M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4',
  below: 'M18 18h-6a3 3 0 0 1 -3 -3v-10l-4 4m8 0l-4 -4',
  lock: 'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2zM8 11v-4a4 4 0 1 1 8 0v4',
}

/**
 * The column header's tiny mark (C11): an icon after the name, the folder's name on hover; with "Icon and folder name"
 * the name in small muted text after it. It is inline after the label, so it clips with the name and never widens the column.
 */
export function ColumnMark({ mark, withName }: { mark: Mark; withName: boolean }) {
  return (
    <span className="view-column-mark" title={mark.title} data-mark={mark.icon}>
      <svg className="view-column-mark__icon" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label={mark.title} role="img">
        <path d={PATHS[mark.icon]} />
      </svg>
      {withName && <span className="view-column-mark__name">{mark.name}</span>}
    </span>
  )
}
