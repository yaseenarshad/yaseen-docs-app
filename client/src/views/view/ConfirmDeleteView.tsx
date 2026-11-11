import type { ViewDef } from '../viewSchema'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { PAGE_VIEW_TYPE } from '../pageView'

/** PURE copy (tested apart): the app's one delete pattern, `Delete <thing>? <what happens>.` (YAZ-4608 C7). */
export function deleteViewMessage(view: ViewDef): string {
  // The Page tab takes nothing with it (YAZ-4584 D38): its text is the `.folder.md` body, which stays.
  if (view.type === PAGE_VIEW_TYPE) return `Delete the view "${view.name}"? The page's text stays in the folder. A new Page tab shows it again.`
  return `Delete the view "${view.name}"? Its columns, sort, filters and grouping go with it. The notes stay.`
}

interface ConfirmDeleteViewProps {
  view: ViewDef
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for a view tab's Delete (YAZ-1471), on `ConfirmSheet`: initial focus on
 * CANCEL (a stray Space changes nothing — Enter is the sheet's own confirm). Unlike the remove
 * sheet the confirm IS `--danger`: a view's configuration has no way back.
 */
export function ConfirmDeleteView({ view, onConfirm, onCancel }: ConfirmDeleteViewProps) {
  return <ConfirmSheet labelId="confirm-delete-view-text" text={deleteViewMessage(view)} confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel} />
}
