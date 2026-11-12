/**
 * AN EDIT ATTEMPT IN A READ ONLY PAGE (YAZ-4446, D33 of YAZ-4278: "some message comes at the top right which has a red
 * arrow that points to read only"). The Read only guard that refuses an edit tells its pane, and the pane's "Read only"
 * chip shows a short message under itself (`ReadOnlyChip`). A note's guard is `readOnlyKeys.ts` (each `beforeinput`,
 * `paste` and `cut` it cancels); a board's is `ExcalidrawSurface` (the edit keys, paste, cut, drop and double-click
 * that the engine's view mode ignores).
 *
 * The event bubbles from the element the reader tried to change. The chip hears it on its pane (`section.editor`) and
 * keeps only an attempt from its own page (`READ_ONLY_PAGE`): a split view's other pane, and a drawing popup inside a
 * note, are not its own.
 */

export type ReadOnlyWhat = 'note' | 'drawing'

export const READ_ONLY_EDIT = 'mdapp:read-only-edit'

/** A page that can be Read only: a tab's pane, or a popup (the drawing popup of a note) inside one. */
export const READ_ONLY_PAGE = 'section.editor, [role="dialog"]'

/** The pane the chip listens on. */
export const READ_ONLY_PANE = 'section.editor'

/** The message goes this long after the last attempt. */
export const READ_ONLY_MESSAGE_MS = 2500

/** It shows again no sooner than this after it last showed. */
export const READ_ONLY_MESSAGE_GAP_MS = 1000

/** The guard refused an edit at `from`: tell the pane. */
export function tellReadOnlyEdit(from: Element, what: ReadOnlyWhat): void {
  from.dispatchEvent(new CustomEvent<ReadOnlyWhat>(READ_ONLY_EDIT, { bubbles: true, detail: what }))
}

/**
 * A VIEW CHANGE IN A READ ONLY NOTE (YAZ-4939: a table section collapsed or opened, `tableSubhead.ts`): the meta of its
 * transaction, which the read-only keys let through (`readOnlyKeys.ts`), and the event on the view's DOM that tells
 * the note's host (`Editor.tsx`): the live text is then taken as saved, so a locked note never writes it.
 */
export const VIEW_ONLY_CHANGE = 'mdapp:view-only-change'
