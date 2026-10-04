import { useContext, useMemo } from 'react'
import type { IndexRecord } from '@shared/types'
import { notesCarrying } from '../deleteColumn'
import { propertyLabel } from '../engine'
import type { ViewSet } from '../viewSchema'
import { ViewFolder } from './GroupHeader'
import { canonicalKey } from './keys'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** The sheet's copy (YAZ-1513) — pure and separately tested, like `deleteConfirmMessage` next door: the notes that lose the value, then, when any, the notes that keep it. */
export function deleteColumnMessage(label: string, key: string, count: number, kept: number): string {
  const lost = `Delete "${label}"? This removes the column from this folder and the "${key}" value from ${count} ${count === 1 ? 'note' : 'notes'}.`
  return kept === 0 ? lost : `${lost} ${kept} ${kept === 1 ? 'note keeps' : 'notes keep'} it because another folder uses it.`
}

interface ConfirmDeleteColumnProps {
  /** The column, any spelling — the sheet derives its label, bare key and count itself (YAZ-1549). */
  columnKey: string
  def: ViewSet
  /** The folder's rows and every folder's settings record: both counts are taken ONCE, when the sheet opens (`notesCarrying`). */
  records: readonly IndexRecord[]
  folders: readonly IndexRecord[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513), on `ConfirmSheet`: the confirm button
 * `--danger` because notes ARE rewritten. Its keys and click-away stay inside it
 * (`keys="contained"`), so a Popover hosting this sheet does not see the same Escape and close
 * underneath it.
 */
export function ConfirmDeleteColumn({ columnKey, def, records, folders, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const label = propertyLabel(def, columnKey)
  const propKey = canonicalKey(columnKey).slice('note.'.length)
  const folder = useContext(ViewFolder)
  // Taken once at open: the numbers the user reads are the numbers the confirm meant.
  const { strip, keep } = useMemo(() => notesCarrying(records, columnKey, folder, folders), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ConfirmSheet
      labelId="confirm-delete-column-text"
      text={deleteColumnMessage(label, propKey, strip.length, keep.length)}
      confirmLabel="Delete"
      danger
      keys="contained"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
