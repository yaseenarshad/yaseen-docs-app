import type { ColumnSources } from '../columnInheritance'
import { HoverTip } from '../../components/HoverTip'

/**
 * The six header states (YAZ-4713 C11, locked 2026-11-08; C11B, demo 2026-11-09; YAZ-4769 demo): none (this folder's own),
 * from a parent, this folder's own settings over a parent's ("Desserts only", ✎), from a subfolder, a separate value, and
 * ◌, a field only in the notes, so "no mark" always means this folder's own column.
 */
type Mark = { icon: 'parent' | 'copy' | 'below' | 'lock' | 'loose'; title: string; name: string }

/** Where the column's mark says it comes from, or null for this folder's own column. `separate`: the page's declaration says so (C3). */
export function columnMark(sources: ColumnSources, key: string, separate: boolean): Mark | null {
  if (separate) return { icon: 'lock', title: `Separate value for ${sources.folderName}`, name: sources.folderName }
  const { from, over, below, loose } = sources.of(key)
  if (from !== undefined) return { icon: 'parent', title: `From ${from}`, name: from }
  // YAZ-4769 demo: a copy of a parent's column ("Change on Desserts only") was no mark at all, so it read as the folder's own.
  if (over !== undefined) return { icon: 'copy', title: `Own settings on ${sources.folderName} (${over} keeps the shared ones). Same values.`, name: sources.folderName }
  if (below !== undefined) return { icon: 'below', title: `From ${below}`, name: below }
  if (loose === true) return { icon: 'loose', title: 'Only in the notes. This page has no column for it.', name: 'Notes only' }
  return null
}

/** Tabler-style strokes on a 24 grid: corner-down-right (↳), pencil (✎), corner-left-up (↑), lock, circle-dashed (◌). */
const PATHS: Record<Mark['icon'], string> = {
  parent: 'M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4',
  copy: 'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4',
  below: 'M18 18h-6a3 3 0 0 1 -3 -3v-10l-4 4m8 0l-4 -4',
  lock: 'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2zM8 11v-4a4 4 0 1 1 8 0v4',
  loose: 'M8.56 3.69a9 9 0 0 0 -2.92 1.95M3.69 8.56a9 9 0 0 0 -.69 3.44M3.69 15.44a9 9 0 0 0 1.95 2.92M8.56 20.31a9 9 0 0 0 3.44 .69M15.44 20.31a9 9 0 0 0 2.92 -1.95M20.31 15.44a9 9 0 0 0 .69 -3.44M20.31 8.56a9 9 0 0 0 -1.95 -2.92M15.44 3.69a9 9 0 0 0 -3.44 -.69',
}

/** One mark's icon alone, as the header draws it: the (i) of "Where columns come from" lists them (YAZ-3746 13BP). */
export function MarkGlyph({ icon }: { icon: Mark['icon'] }) {
  return (
    <svg className="view-column-mark__icon" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[icon]} />
    </svg>
  )
}

/**
 * The column header's tiny mark (C11): an icon after the name, the folder's name on hover; with "Icon and folder name"
 * the name in small muted text after it. It is inline after the label, so it clips with the name and never widens the column.
 */
export function ColumnMark({ mark, withName }: { mark: Mark; withName: boolean }) {
  return (
    // The app's hover box (YAZ-4772): the folder's name, or what ◌ means, on hover; a native title showed nothing.
    <HoverTip className="view-column-mark" data-mark={mark.icon} text={mark.title}>
      <svg className="view-column-mark__icon" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label={mark.title} role="img">
        <path d={PATHS[mark.icon]} />
      </svg>
      {withName && <span className="view-column-mark__name">{mark.name}</span>}
    </HoverTip>
  )
}
