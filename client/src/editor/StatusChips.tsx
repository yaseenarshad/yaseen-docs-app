import type { ReactNode } from 'react'
import type { GithubSyncStatus } from '@shared/types'
import type { SaveStatus } from '../lib/autosave'
import { DocumentZoom } from './DocumentZoom'
import { ReadOnlyChip } from './ReadOnlyChip'
import { SaveIndicator } from './SaveIndicator'
import { SyncIndicator } from './SyncIndicator'

/** The "Read only" chip's state and doors (YAZ-3076 D4): the chip shows while it is given. */
export interface ReadOnlyChipState {
  asking: boolean
  onAsk: () => void
  onAllow: () => void
  onCancel: () => void
}

/**
 * The page's top-right toolbar (YAZ-3746 D35): what a note page and a folder page share, in one order —
 * the host's own chips first (`children`: a note's fold-all button and cog, a folder page's cog), then the
 * zoom pill, the "Read only" chip while the page is locked, the sync chip when the vault has one, and the save chip.
 */
export function StatusChips({ children, zoom, onZoom, readOnly, sync, onSyncNow, save }: {
  children?: ReactNode
  /** This tab's text size, percent: per tab and never stored. */
  zoom: number
  onZoom: (zoom: number) => void
  /** null: the page is not read only, and no chip shows. */
  readOnly: ReadOnlyChipState | null
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  save: SaveStatus
}) {
  return (
    <div className="status-chips">
      {children}
      <DocumentZoom value={zoom} onChange={onZoom} />
      {readOnly !== null && <ReadOnlyChip asking={readOnly.asking} onAsk={readOnly.onAsk} onAllow={readOnly.onAllow} onCancel={readOnly.onCancel} />}
      {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
      <SaveIndicator status={save} />
    </div>
  )
}
