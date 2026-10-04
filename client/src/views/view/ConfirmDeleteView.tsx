import type { ViewDef } from '../viewSchema'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** PURE copy (tested apart): what goes, then what stays. */
export function deleteViewMessage(view: ViewDef): string {
  const goes = view.type === 'outline' ? 'Its outline document goes with it' : 'Its columns, sort, filters and grouping go with it'
  return `Delete the view '${view.name}'? ${goes} — the pages themselves stay put.`
}

interface ConfirmDeleteViewProps {
  view: ViewDef
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for a view tab's Delete (YAZ-1471), on `ConfirmSheet`: initial focus on
 * CANCEL (a stray Space changes nothing — Enter is the sheet's own confirm). Unlike the remove
 * sheet the confirm IS `--danger`: a view's configuration — and an outline's document — has no
 * way back.
 */
export function ConfirmDeleteView({ view, onConfirm, onCancel }: ConfirmDeleteViewProps) {
  return <ConfirmSheet labelId="confirm-delete-view-text" text={deleteViewMessage(view)} confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel} />
}
