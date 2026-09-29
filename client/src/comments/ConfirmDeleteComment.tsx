import { ConfirmSheet } from '../components/ConfirmSheet'

/**
 * The delete-comment sheet's copy (YAZ-1472) — PURE and separately tested, like every other
 * sheet's. A comment has no Trash behind it: the entry leaves the note's frontmatter for good,
 * and a parent takes its replies with it (🔒 D7), so the copy names both. `label` is the number
 * the row wears (`#3`, `#3.1`); a hand-written comment without one is "this comment".
 */
export function deleteCommentMessage(label: string | null, replies: number): string {
  const what = label === null ? 'this comment' : `comment ${label}`
  const tail = replies === 0 ? '' : ` and its ${replies === 1 ? 'reply' : `${replies} replies`}`
  return `Delete ${what}${tail}? This cannot be undone.`
}

interface ConfirmDeleteCommentProps {
  label: string | null
  replies: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The comment's delete sheet, on `ConfirmSheet` like `sidebar/ConfirmDelete`: initial focus on
 * CANCEL so a stray Enter destroys nothing, the confirm button `--danger` because something IS
 * destroyed. No "Don't ask me again": there is no Trash to recover a comment from, so the sheet
 * is the only undo there is.
 */
export function ConfirmDeleteComment({ label, replies, onConfirm, onCancel }: ConfirmDeleteCommentProps) {
  return <ConfirmSheet labelId="confirm-delete-comment-text" text={deleteCommentMessage(label, replies)} confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel} />
}
