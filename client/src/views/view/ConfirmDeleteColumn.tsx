import { useContext, useMemo } from 'react'
import type { IndexRecord } from '@shared/types'
import { livesIn } from '../../links/shortcuts'
import { residentsCarrying } from '../deleteColumn'
import { propertyLabel } from '../engine'
import type { ViewSet } from '../viewSchema'
import { ViewFolder } from './GroupHeader'
import { canonicalKey } from './keys'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** The sheet's copy (YAZ-1513) — pure and separately tested, like `deleteConfirmMessage` next door. */
export function deleteColumnMessage(label: string, key: string, count: number): string {
  return `Delete "${label}"? This removes the column from this folder and the "${key}" value from ${count} ${count === 1 ? 'note' : 'notes'}.`
}

interface ConfirmDeleteColumnProps {
  /** The column, any spelling — the sheet derives its label, bare key and count itself (YAZ-1549). */
  columnKey: string
  def: ViewSet
  /** The folder's rows: the count is taken ONCE, when the sheet opens, over the ones that live directly in it — a subfolder's row and a shortcut row are not stripped (E4). */
  records: readonly IndexRecord[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513), on `ConfirmSheet`: the confirm button
 * `--danger` because notes ARE rewritten. Its keys and click-away stay inside it
 * (`keys="contained"`), so a Popover hosting this sheet does not see the same Escape and close
 * underneath it.
 */
export function ConfirmDeleteColumn({ columnKey, def, records, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const label = propertyLabel(def, columnKey)
  const propKey = canonicalKey(columnKey).slice('note.'.length)
  const folder = useContext(ViewFolder)
  // Taken once at open: the number the user reads is the number the confirm meant.
  const count = useMemo(() => residentsCarrying(folder === null ? records : records.filter((r) => livesIn(r, folder)), columnKey).length, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ConfirmSheet
      labelId="confirm-delete-column-text"
      text={deleteColumnMessage(label, propKey, count)}
      confirmLabel="Delete"
      danger
      keys="contained"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
