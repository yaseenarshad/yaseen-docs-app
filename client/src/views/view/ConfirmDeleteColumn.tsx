import { useMemo } from 'react'
import { propertyLabel } from '../engine'
import type { ViewSet } from '../viewSchema'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** The sheet's copy (YAZ-1513), the app's one delete pattern `Delete <thing>? <what happens>.` (YAZ-4608 C7): the column goes from the folder and every page under it (YAZ-4713 C7). */
export function deleteColumnMessage(label: string, folderName: string): string {
  return `Delete the column "${label}"? It goes from ${folderName} and every page under it.`
}

/** The main button (C7): "Delete column and clear 3 values"; with no value to clear, "Delete column". */
export function deleteColumnLabel(count: number): string {
  return count === 0 ? 'Delete column' : `Delete column and clear ${count} ${count === 1 ? 'value' : 'values'}`
}

interface ConfirmDeleteColumnProps {
  /** The column, any spelling — the sheet derives its label itself (YAZ-1549). */
  columnKey: string
  def: ViewSet
  /** The folder that owns the column: "It goes from Schema and every page under it". */
  folderName: string
  /** `FolderHost.valueCount`: asked ONCE, when the sheet opens. */
  count: (key: string) => number
  /** `clear`: the main button, the values go too; false: "Keep the values in the notes". */
  onConfirm: (clear: boolean) => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513), on `ConfirmSheet`. YAZ-4713 C7: the main button, `--danger` because
 * notes ARE rewritten, is "Delete column and clear N values"; "Keep the values in the notes" removes only the column.
 * With no value to clear, the one button is "Delete column". Its keys and click-away stay inside it
 * (`keys="contained"`), so a Popover hosting this sheet does not see the same Escape and close underneath it.
 */
export function ConfirmDeleteColumn({ columnKey, def, folderName, count, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const label = propertyLabel(def, columnKey)
  // Taken once at open: the number the user reads is the number the confirm meant.
  const holding = useMemo(() => count(columnKey), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ConfirmSheet
      labelId="confirm-delete-column-text"
      text={deleteColumnMessage(label, folderName)}
      confirmLabel={deleteColumnLabel(holding)}
      danger
      keys="contained"
      onConfirm={() => onConfirm(true)}
      onCancel={onCancel}
      other={
        holding > 0 && (
          <button type="button" className="confirm__btn confirm__btn--other" onClick={() => onConfirm(false)}>
            Keep the values in the notes
          </button>
        )
      }
    />
  )
}
