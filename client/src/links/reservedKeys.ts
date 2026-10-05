import { ALSO_IN_KEY } from '@shared/alsoIn'
import { COMMENTS_KEY } from '@shared/comments'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { NOTE_ID_KEY } from '@shared/noteId'
import { REVIEWS_KEY } from '@shared/reviews'

/**
 * The frontmatter keys the app OWNS on a note (YAZ-1513/1549), spelled from the real constants —
 * never a local literal: the comments store, the note id (YAZ-2293 — editing it would orphan every
 * link to the note), the review log (YAZ-2322), the note's shortcuts (YAZ-2290 D2 — folder ids,
 * set from the folder's own menu) and the folders' values (D19 — `in`, written by each folder's
 * views) — keys whose VALUE is the app's, not the user's. None is a name a property can be added
 * under, and none is deleted as a column: `deleteColumn.ts` refuses them. The properties panel
 * shows them as "Reserved" with no editor — `in` as no row at all: its blocks are the panel's
 * folder rows. A folder's settings block is the app's only in the folder's own `.folder.md`, whose
 * panel hides it; on a note that key is an ordinary property.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([COMMENTS_KEY, NOTE_ID_KEY, REVIEWS_KEY, ALSO_IN_KEY, FOLDER_VALUES_KEY])
