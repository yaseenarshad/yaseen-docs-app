/**
 * The rename confirm (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes): a rename
 * triggers a chain — the file on disk, then links across the vault — so a NAME change asks first,
 * with the honest count from `countLinkReferences`. A move never asks THIS (a confirm on every
 * drag would be hostile, and bare links keep resolving); one that would clear a folder's values
 * asks through `ConfirmMove` (D21). The sheet itself lands with YAZ-888; the
 * LOCKED copy lives here first, `deleteConfirmMessage`'s idiom, so the component stays trivial.
 */
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { basename } from '../lib/paths'
import { ConfirmSheet } from '../components/ConfirmSheet'

/** The LOCKED copy (⚡ YAZ-888): both spellings, the honest count, and no promise about nothing. A title edit counts no id link (none is rewritten), so its zero says only that. */
export function renameConfirmMessage(oldName: string, newName: string, count: number, titleEdit: boolean): string {
  const none = titleEdit ? 'No links need updating.' : 'No other notes link to it.'
  const links = count === 0 ? none : `Links in ${count} ${count === 1 ? 'note' : 'notes'} will be updated.`
  return `Rename '${oldName}' to '${newName}'? ${links}`
}

/**
 * THE RULE (⚡ YAZ-888), asked at App's one rename door and nowhere else: a changed NAME asks,
 * a MOVE never asks this. Both gestures reach that door as (oldPath, newPath), and the whole
 * difference between them is the last segment — a drag-move keeps it, a rename replaces it.
 */
export const isNameChange = (oldPath: string, newPath: string): boolean => basename(oldPath) !== basename(newPath)

/**
 * Where a rename sends a page: to a new path — a rename, or a move — or to a new TITLE
 * (YAZ-2420 🔒 D16), from which main builds the name, so there is no path to state until it
 * answers. The sheet names a path by its page's title and a title as it was typed.
 */
export type RenameTo = { newPath: string; title?: never } | { title: string; newPath?: never }

type ConfirmRenameProps = {
  /** The page as it stands; only its NAME reaches the copy. */
  oldPath: string
  /** A folder is named whole: `Notes.md` may be one (YAZ-2290). */
  kind: 'file' | 'dir'
  /** The honest N: `countLinkReferences` over the window's own index snapshot. */
  count: number
  /** The window's titles (YAZ-2420 🔒 D14): what the copy names, it names by title. */
  titles: PathTitles
  onConfirm: () => void
  onCancel: () => void
} & RenameTo

/**
 * In-app confirm sheet for a NAME change (⚡ YAZ-888), on `ConfirmSheet`, so the behaviour is the
 * one users already know: initial focus on CANCEL so a stray Enter arriving from the tree or the
 * title input renames nothing.
 *
 * The same two omissions as the turn-back sheet, for the same reasons: the confirm button is NOT
 * `--danger` (nothing is destroyed — the copy promises the links follow), and there is no "Don't
 * ask me again" (a rename that silently rewrites N notes is exactly the gesture that earns a beat).
 *
 * ONE deliberate departure from its siblings, and it is load-bearing: the keys are bound to the
 * sheet (`keys="sheet"`), not to `window`. This is the first sheet a KEYSTROKE can open — Enter in the title
 * input, Enter in the sidebar's inline rename — and React flushes this component's effects inside
 * that very keydown's dispatch, so a window listener hears the Enter that opened the sheet and
 * confirms before the user has read a word (the e2e caught exactly that). Bound here, the sheet
 * only ever hears keys from inside itself, which is where focus is: Cancel takes it on mount.
 */
export function ConfirmRename({ oldPath, kind, count, titles, onConfirm, onCancel, ...to }: ConfirmRenameProps) {
  return (
    <ConfirmSheet
      labelId="confirm-rename-text"
      text={renameConfirmMessage(pageLabel(oldPath, kind === 'dir', titles), to.title ?? pageLabel(to.newPath, kind === 'dir', titles), count, to.title !== undefined)}
      confirmLabel="Rename"
      keys="sheet"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
