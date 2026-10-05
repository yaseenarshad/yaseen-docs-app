import { useMemo } from 'react'
import { propertyLabel } from '../engine'
import type { ViewSet } from '../viewSchema'
import { canonicalKey } from './keys'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** The sheet's copy (YAZ-1513) — pure and separately tested, like `deleteConfirmMessage` next door: the notes that lose the folder's value. */
export function deleteColumnMessage(label: string, key: string, count: number): string {
  return `Delete "${label}"? This removes the column from this folder and the "${key}" value from ${count} ${count === 1 ? 'note' : 'notes'}.`
}

interface ConfirmDeleteColumnProps {
  /** The column, any spelling — the sheet derives its label and bare key itself (YAZ-1549). */
  columnKey: string
  def: ViewSet
  /** `FolderHost.valueCount`: asked ONCE, when the sheet opens. */
  count: (key: string) => number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513), on `ConfirmSheet`: the confirm button
 * `--danger` because notes ARE rewritten. Its keys and click-away stay inside it
 * (`keys="contained"`), so a Popover hosting this sheet does not see the same Escape and close
 * underneath it.
 */
export function ConfirmDeleteColumn({ columnKey, def, count, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const label = propertyLabel(def, columnKey)
  const propKey = canonicalKey(columnKey).slice('note.'.length)
  // Taken once at open: the number the user reads is the number the confirm meant.
  const holding = useMemo(() => count(columnKey), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ConfirmSheet
      labelId="confirm-delete-column-text"
      text={deleteColumnMessage(label, propKey, holding)}
      confirmLabel="Delete"
      danger
      keys="contained"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
