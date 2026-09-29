import { ConfirmSheet } from '../../components/ConfirmSheet'

/**
 * The remove-from-folder-page sheet's copy (YAZ-820) — PURE and separately tested, exactly like
 * `sidebar/ConfirmTurnBack.tsx`'s `turnBackConfirmMessage` and `deleteConfirmMessage` next to it,
 * so the component around it stays trivial.
 *
 * The whole reason this gesture asks: an × on a row LOOKS like a delete and is not one. Removing
 * a member drops ONE entry from that page's own `folder_pages` list; the file stays exactly where
 * it is, with its body and every other key untouched. So the copy says what is NOT happening
 * first, then says where the page still lives — by name, because "it remains in: KPIs" is the
 * answer to the question the user is actually asking — or, when this was its last folder page,
 * names Uncategorized, which is where nothing can get lost.
 *
 * Pages are named the way the OUTLINE names them: `basename`, no extension — these are the rows
 * the user is looking at and the spelling the `[[…]]` entry itself carries. (The sidebar's two
 * sheets name FILES, extension and all; this one names PAGES.)
 */
export function removeMemberMessage(page: string, folderPage: string, othersInOrder: readonly string[]): string {
  const rest =
    othersInOrder.length > 0
      ? `It remains in: ${othersInOrder.join(', ')}.`
      : 'It has no other folder pages, so it moves to Uncategorized.'
  return `Remove '${page}' from '${folderPage}'? The page is not deleted — its file stays put. ${rest}`
}

interface ConfirmRemoveMemberProps {
  /** The member being un-tagged, by basename. */
  page: string
  /** The folder page it is being removed from, by basename. */
  folderPage: string
  /** Its OTHER folder pages, by basename, in entry order; empty = this was the last one. */
  others: readonly string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for the outline's hover × (YAZ-820), on `ConfirmSheet` like its siblings:
 * initial focus on CANCEL so a stray Enter changes nothing.
 *
 * Same two deliberate omissions as the turn-back sheet: no "Don't ask me again" (this neither
 * repeats blindly nor destroys anything), and the confirm button is NOT `--danger`, because
 * nothing is destroyed here and the copy says so — red would contradict its own text.
 * Buttons are Cancel / **Remove**.
 */
export function ConfirmRemoveMember({ page, folderPage, others, onConfirm, onCancel }: ConfirmRemoveMemberProps) {
  return <ConfirmSheet labelId="confirm-remove-member-text" text={removeMemberMessage(page, folderPage, others)} confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} />
}
