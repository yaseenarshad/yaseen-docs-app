import { useState, type ReactNode } from 'react'
import { ConfirmSheet } from '../../components/ConfirmSheet'

/** The sheet's words (YAZ-4592 S26), as the sidebar's delete sheet says them: one note by its title, several counted. */
export function deleteNotesMessage(titles: readonly string[]): string {
  return titles.length === 1 ? `Delete "${titles[0]}"? It moves to the Trash.` : `Delete ${titles.length} notes? They move to the Trash.`
}

/** A delete of more notes than this asks first whatever the setting says (YAZ-4612 S49). */
export const ALWAYS_ASK_OVER = 10

/**
 * Delete notes from a folder page (YAZ-4592 S26). `confirmDeleteNotes(paths)` opens the app's confirm sheet, or
 * trashes at once when Settings › Folder pages › "Ask before deleting notes" (`ask`) is off. That setting is its own:
 * the sidebar's Confirm before deleting does not touch it, and the sheet has no "Don't ask me again". The delete is
 * `trash`, App's own (`trashMany`: the Trash, the sound and the Undo toast, as the sidebar's). The row menu's
 * "Delete note…" calls it with one path; a selection's "Delete notes…" with several. No `trash`: no delete.
 * The sheet's keys are its own (`keys="sheet"`): an Enter that chose the menu item cannot confirm it unread.
 */
export function useDeleteNotes(
  ask: boolean,
  trash: ((paths: readonly string[]) => Promise<void>) | undefined,
  titleOf: (path: string) => string,
): { confirmDeleteNotes?: (paths: readonly string[]) => void; sheet: ReactNode } {
  /** The paths the open sheet asks about, and its words, taken once as it opens. */
  const [asking, setAsking] = useState<{ paths: readonly string[]; text: string } | null>(null)
  if (trash === undefined) return { sheet: null }
  const confirmDeleteNotes = (paths: readonly string[]): void => {
    if (paths.length === 0) return
    // More than 10 notes always ask (YAZ-4612 S49), also with the setting off.
    if (ask || paths.length > ALWAYS_ASK_OVER) setAsking({ paths, text: deleteNotesMessage(paths.map(titleOf)) })
    else void trash(paths)
  }
  const sheet =
    asking === null ? null : (
      <ConfirmSheet
        labelId="confirm-delete-notes-text"
        text={asking.text}
        confirmLabel="Delete"
        danger
        keys="sheet"
        onConfirm={() => {
          setAsking(null)
          void trash(asking.paths)
        }}
        onCancel={() => setAsking(null)}
      />
    )
  return { confirmDeleteNotes, sheet }
}
