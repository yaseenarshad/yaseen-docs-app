import type { ReactNode } from 'react'
import type { GithubSyncStatus } from '@shared/types'
import type { SaveStatus } from '../lib/autosave'
import { DocumentZoom } from './DocumentZoom'
import { ReadOnlyChip } from './ReadOnlyChip'
import { SaveIndicator } from './SaveIndicator'
import { SyncIndicator } from './SyncIndicator'
import type { AllowFor } from './useTimedUnlock'

/** The "Read only" chip's state and doors (YAZ-3076 D4): the chip shows while it is given — locked, or editing for a time (YAZ-4939). */
export interface ReadOnlyChipState {
  asking: boolean
  onAsk: () => void
  /** A time choice: the host unlocks this page for that long (YAZ-4939). */
  onAllow: (choice: AllowFor) => void
  onCancel: () => void
  /** "Turn Read only off" in the box: the page's own switch, in its file. Absent: no such button. */
  onTurnOff?: () => void
  /** A timed unlock runs: when it ends, or Infinity until the tab closes; null = locked. */
  editingUntil?: number | null
  onLock?: () => void
  /** ⌘↵ and Esc lock the page again (YAZ-4997): the chip's hover says so. */
  lockKeys?: boolean
  /** The keyboard back to the page after the box or Lock now (YAZ-4997 round 2, `ReadOnlyChipProps.onReturn`). */
  onReturn?: (to: 'ask' | 'lock') => void
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
      {readOnly !== null && <ReadOnlyChip asking={readOnly.asking} onAsk={readOnly.onAsk} onAllow={readOnly.onAllow} onCancel={readOnly.onCancel} onTurnOff={readOnly.onTurnOff} editingUntil={readOnly.editingUntil} onLock={readOnly.onLock} lockKeys={readOnly.lockKeys} onReturn={readOnly.onReturn} />}
      {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
      <SaveIndicator status={save} />
    </div>
  )
}
